import { Router } from 'express';
import fs from 'fs';
import { YoutubeTranscript } from 'youtube-transcript';
import { getClaudeKey } from '../config/apiKeys.js';
import { CLAUDE_CONFIG_PATH } from '../config/paths.js';

// Match common YouTube URL shapes (full, short, mobile, shorts) and pull
// out the 11-character video ID.
function extractYoutubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/,
    /^([A-Za-z0-9_-]{11})$/, // bare ID
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m && m[1]) return m[1];
  }
  return null;
}

export const claudeRouter = Router();

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
// Opus 4.7 is Anthropic's strongest model — best for the kind of nuanced,
// emotion-aware copy this app produces. Sonnet 4.6 is ~5× cheaper and faster
// but visibly worse at creative writing. Override per-call by passing a
// `model` field in the request body if you need to A/B compare.
const DEFAULT_MODEL = 'claude-opus-4-7';
// Extended thinking — Opus 4.7 uses the newer "adaptive" mode controlled by
// output_config.effort ('low' | 'medium' | 'high'). Higher effort = more
// internal reasoning, better copy quality, higher cost.
const THINKING_EFFORT = 'high';
const DEFAULT_MAX_TOKENS = 12000;

// POST /api/claude/config
claudeRouter.post('/config', async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'API Key is required.' });

  const trimmedKey = apiKey.trim().replace(/^["']|["']$/g, '');

  try {
    fs.writeFileSync(CLAUDE_CONFIG_PATH, JSON.stringify({ apiKey: trimmedKey }, null, 2));
    console.log('[Claude Config] API Key updated successfully.');
    res.json({ message: 'Claude API Key updated successfully.' });
  } catch (err: any) {
    console.error('[Claude Config] Error saving config:', err);
    res.status(500).json({ error: `Failed to save API Key: ${err.message}` });
  }
});

// GET /api/claude/health
// Pings Anthropic with a 4-token request to verify the key works.
claudeRouter.get('/health', async (_req, res) => {
  const apiKey = getClaudeKey();
  if (!apiKey) {
    return res.status(500).json({ status: 'error', message: 'CLAUDE_API_KEY is missing.' });
  }

  try {
    const response = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: 4,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });

    if (response.ok) {
      return res.json({ status: 'ok', message: `Conectado! Modelo: ${DEFAULT_MODEL}` });
    }
    const text = await response.text();
    return res.status(response.status).json({ status: 'error', message: text.substring(0, 200) });
  } catch (err: any) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// POST /api/claude/complete
// Drop-in replacement for the Railway /metavise/claude proxy that
// src/lib/claudeService.ts used to call. Same request/response shape so the
// frontend caller only needs to change the URL.
//
// Request:  { system?: string; user: string; max_tokens?: number }
// Response: { success: true; text: string } | { success: false; error: string }
claudeRouter.post('/complete', async (req, res) => {
  const apiKey = getClaudeKey();
  if (!apiKey) {
    return res.status(500).json({ success: false, error: 'CLAUDE_API_KEY não configurada.' });
  }

  const {
    system,
    user,
    // Callers in claudeService.ts pass max_tokens=2000, not enough for the
    // 5000-token thinking budget + actual reply. Treat the caller value as
    // a floor and bump up to DEFAULT_MAX_TOKENS when needed.
    max_tokens: requestedMaxTokens = DEFAULT_MAX_TOKENS,
    model = DEFAULT_MODEL,
    thinking = true,
  } = req.body || {};
  if (!user) {
    return res.status(400).json({ success: false, error: 'O campo "user" é obrigatório.' });
  }

  const max_tokens = Math.max(requestedMaxTokens, DEFAULT_MAX_TOKENS);

  console.log(
    `[Claude] /complete model=${model} thinking=${thinking ? THINKING_EFFORT : 'off'} ` +
      `max_tokens=${max_tokens} user_len=${user.length}`
  );

  const body = JSON.stringify({
    model,
    max_tokens,
    // Extended thinking — Claude reasons internally before replying.
    // Disable per-call by sending `"thinking": false`. Opus 4.7 only
    // accepts the 'adaptive' shape; older models used 'enabled' with a
    // budget_tokens field.
    ...(thinking
      ? {
          thinking: { type: 'adaptive' },
          output_config: { effort: THINKING_EFFORT },
        }
      : {}),
    // Cache the (typically large, repeated) system prompt — copy
    // generation reuses the same beats Schwartz instructions across
    // many requests, so caching cuts cost noticeably.
    ...(system
      ? {
          system: [
            {
              type: 'text',
              text: system,
              cache_control: { type: 'ephemeral' },
            },
          ],
        }
      : {}),
    messages: [{ role: 'user', content: user }],
  });

  // Retry on Anthropic's transient overload (529) and rate-limit (429)
  // responses with exponential backoff (1s, 2s, 4s). 5xx server errors
  // also retried since they're typically intermittent. Other failures
  // (auth, bad request) bubble up immediately.
  const MAX_ATTEMPTS = 4;
  try {
    let response: Response | null = null;
    let lastText = '';

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      response = await fetch(ANTHROPIC_API, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body,
      });

      if (response.ok) break;

      lastText = await response.text();
      const retryable = response.status === 529 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS) {
        console.error(
          `[Claude] Anthropic API error (attempt ${attempt}/${MAX_ATTEMPTS}):`,
          response.status,
          lastText.substring(0, 500)
        );
        return res.status(response.status).json({
          success: false,
          error: `Claude API error: ${response.status} ${lastText.substring(0, 300)}`,
        });
      }

      const delay = 1000 * Math.pow(2, attempt - 1);
      console.warn(
        `[Claude] ${response.status} on attempt ${attempt}/${MAX_ATTEMPTS}, retrying in ${delay}ms…`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    if (!response || !response.ok) {
      return res.status(503).json({
        success: false,
        error: 'Claude indisponível após múltiplas tentativas. Tente novamente em alguns minutos.',
      });
    }

    const data = await response.json();
    // With extended thinking enabled, response.content has a 'thinking' block
    // followed by a 'text' block. Pick by type, not by index.
    const textBlock = Array.isArray(data.content)
      ? data.content.find((b: any) => b?.type === 'text')
      : null;
    const text = textBlock?.text;
    if (!text) {
      console.error('[Claude] No text block in response:', JSON.stringify(data).substring(0, 500));
      return res.status(500).json({
        success: false,
        error: 'Claude retornou resposta sem texto.',
      });
    }

    const usage = data.usage || {};
    console.log(
      `[Claude] reply ok — input=${usage.input_tokens} cache_read=${usage.cache_read_input_tokens ?? 0} cache_write=${usage.cache_creation_input_tokens ?? 0} output=${usage.output_tokens} stop_reason=${data.stop_reason}`
    );
    res.json({ success: true, text });
  } catch (err: any) {
    console.error('[Claude] Exception:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/claude/extract-product-info
// Takes raw product source material (pasted VSL transcript, landing page
// text, or any free-form description of the product/offer) and returns
// structured info that auto-populates the persona + copy tabs.
//
// Request:  { text?: string, url?: string }
// Response: { success: true, product: {...} }
claudeRouter.post('/extract-product-info', async (req, res) => {
  const apiKey = getClaudeKey();
  if (!apiKey) {
    return res.status(500).json({ success: false, error: 'CLAUDE_API_KEY não configurada.' });
  }

  const { text: bodyText, url, youtubeUrl } = req.body || {};
  if (!bodyText && !url && !youtubeUrl) {
    return res.status(400).json({
      success: false,
      error: 'Forneça pelo menos um: text, url ou youtubeUrl.',
    });
  }

  let sourceText = bodyText || '';

  // YouTube → fetch caption track directly (no download). Fails if the
  // video has no captions available (rare for monetized creators).
  if (youtubeUrl) {
    const videoId = extractYoutubeId(youtubeUrl);
    if (!videoId) {
      return res.status(400).json({
        success: false,
        error: 'URL do YouTube inválida — não consegui extrair o ID do vídeo.',
      });
    }
    try {
      const segments = await YoutubeTranscript.fetchTranscript(videoId);
      const transcript = segments.map((s: any) => s.text).join(' ').replace(/\s+/g, ' ').trim();
      if (!transcript) {
        return res.status(400).json({
          success: false,
          error: 'Vídeo do YouTube não tem legendas disponíveis.',
        });
      }
      sourceText = [sourceText, transcript].filter(Boolean).join('\n\n');
    } catch (err: any) {
      return res.status(400).json({
        success: false,
        error: `Não consegui pegar a transcrição do YouTube: ${err.message}. Tente colar a transcrição manualmente.`,
      });
    }
  }

  // Resolve landing page URL → plain text (strip HTML tags, limit length).
  if (url) {
    try {
      const fetchResp = await fetch(url, {
        headers: {
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 MetaVise/1.0',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!fetchResp.ok) {
        return res.status(400).json({
          success: false,
          error: `Não consegui acessar a URL (status ${fetchResp.status}).`,
        });
      }
      const html = await fetchResp.text();
      // Cheap text extraction: strip scripts/styles/tags, collapse whitespace.
      const stripped = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
      sourceText = [sourceText, stripped].filter(Boolean).join('\n\n');
    } catch (err: any) {
      return res.status(400).json({
        success: false,
        error: `Erro ao buscar URL: ${err.message}`,
      });
    }
  }

  // Cap input — Claude can handle a lot, but landing pages have huge tail
  // content (footers, terms, related posts) that's pure noise. 40k chars
  // ≈ 10k tokens — plenty for the headline + above-the-fold + first VSL act.
  if (sourceText.length > 40000) {
    sourceText = sourceText.substring(0, 40000);
  }

  const SYSTEM = `Você analisa material de marketing (VSLs, landing pages, copy bruta) e extrai informações estruturadas sobre o produto, oferta e público-alvo. Sua saída alimenta a próxima etapa: identificação de persona + geração de copy de anúncios Meta.

Responda APENAS um JSON com esta estrutura (sem prosa, sem markdown):
{
  "productName": "nome do produto/serviço",
  "category": "categoria (ex: emagrecimento, finanças, infoproduto, físico)",
  "offer": "oferta resumida (o que custa quanto e o que vem incluso)",
  "promise": "promessa principal — o resultado que o cliente terá",
  "mainPain": "dor principal que o produto resolve",
  "secondaryPains": ["dor 2", "dor 3"],
  "benefits": ["benefício 1", "benefício 2", "benefício 3"],
  "audience": "descrição do público-alvo (idade, gênero, situação, profissão se relevante)",
  "awarenessLevel": "unaware|problem-aware|solution-aware|product-aware|most-aware",
  "tone": "tom recomendado (ex: profissional, casual, urgente, inspirador)",
  "differentiator": "o que diferencia esse produto dos concorrentes",
  "socialProof": ["depoimento/resultado mencionado", "..."],
  "guarantee": "garantia se mencionada, senão null",
  "urgency": "elemento de urgência se houver, senão null",
  "hookAngles": ["ângulo 1 pra hook", "ângulo 2", "ângulo 3"]
}

Inferências razoáveis são esperadas — se o texto não menciona idade explicitamente mas o contexto sugere 30-50, infira "30-50 anos". Para campos genuinamente sem dado, use string vazia ou array vazio.`;

  const USER = `MATERIAL DO PRODUTO:
${sourceText}

Extraia as informações estruturadas. Retorne APENAS o JSON.`;

  try {
    const resp = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: 2500,
        system: SYSTEM,
        messages: [{ role: 'user', content: USER }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return res.status(resp.status).json({
        success: false,
        error: `Claude API error: ${resp.status} ${errText.substring(0, 200)}`,
      });
    }

    const data = await resp.json();
    const textBlock = Array.isArray(data.content)
      ? data.content.find((b: any) => b?.type === 'text')
      : null;
    const responseText = textBlock?.text || '';
    const clean = responseText.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();

    let product;
    try {
      product = JSON.parse(clean);
    } catch {
      return res.status(500).json({
        success: false,
        error: 'Claude retornou resposta inválida (não-JSON).',
        raw: responseText.substring(0, 500),
      });
    }

    res.json({ success: true, product });
  } catch (err: any) {
    console.error('[Claude extract-product-info] Exception:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/claude/marketing-plan
// Builds a complete Meta Ads launch plan tailored to the product + persona,
// considering Andromeda (Meta's optimization system that favors volume +
// diversity over per-creative perfection). Output drives the "Plano de
// Marketing" tab so the user knows exactly how many variations to produce
// and which angles to cover.
//
// Request:  { productInfo?: any, persona?: any, copyAnswers?: any }
// Response: { success: true, plan: {...} }
claudeRouter.post('/marketing-plan', async (req, res) => {
  const apiKey = getClaudeKey();
  if (!apiKey) {
    return res.status(500).json({ success: false, error: 'CLAUDE_API_KEY não configurada.' });
  }

  const { productInfo = {}, persona = {}, copyAnswers = {} } = req.body || {};

  const SYSTEM = `Você é um estrategista de Meta Ads com domínio dos updates recentes (Andromeda 2025+). Recebe info do produto + persona e gera um PLANO COMPLETO de lançamento.

Princípios Andromeda que DEVE guiar o plano:
- Volume e diversidade vencem perfeição individual. Meta escolhe melhor que humanos quando tem N criativos pra testar.
- Múltiplos hooks > um hook "perfeito". Mínimo 3-5 ângulos diferentes por ad set.
- Cobrir TODOS os níveis de consciência relevantes (cold, problem-aware, solution-aware, product-aware).
- Mix de durações: 15-30s (scroll-stoppers) + 30-60s (storytelling) + 60-180s (VSL profunda) quando faz sentido pro produto.
- Vídeo > estático na maioria dos casos. Avatar IA é viável e escala.
- Iterar rápido: rodar 5-7 dias, matar perdedores, dobrar nos vencedores.

Responda APENAS um JSON com esta estrutura (sem prosa, sem markdown):
{
  "summary": "1-2 parágrafos em PT-BR resumindo a estratégia macro",
  "creativeVolume": {
    "totalCreatives": 12,
    "rationale": "explicação curta do número escolhido",
    "perAudience": 4
  },
  "hookMix": [
    {
      "angle": "Curiosidade",
      "count": 3,
      "example": "exemplo concreto de hook desse ângulo pra esse produto",
      "awarenessLevel": "unaware",
      "rationale": "por que esse ângulo serve essa awareness"
    }
  ],
  "awarenessCoverage": [
    {
      "level": "unaware|problem-aware|solution-aware|product-aware|most-aware",
      "creativeCount": 3,
      "approach": "como abordar esse público especificamente"
    }
  ],
  "durations": [
    {
      "length": "15-30s",
      "purpose": "scroll stopper / disrupt",
      "count": 5
    }
  ],
  "adStructure": {
    "campaigns": 1,
    "adSets": 3,
    "creativesPerAdSet": 4,
    "rationale": "explicação da estrutura escolhida"
  },
  "budget": {
    "dailyMin": 50,
    "dailyRecommended": 150,
    "rationale": "PT-BR — explicação considerando que Andromeda precisa de volume mínimo pra otimizar"
  },
  "iterationPlan": {
    "testDays": 5,
    "killThreshold": "métrica + valor (ex: CPL > R$X depois de Yk impressões)",
    "scaleThreshold": "métrica + valor pra dobrar budget",
    "iterationFrequency": "a cada quantos dias revisar"
  },
  "andromedaTips": [
    "tip específico aplicável a esse produto"
  ],
  "nextSteps": [
    "ação concreta 1 que o usuário toma agora dentro do MetaVise",
    "ação 2"
  ]
}

Os valores numéricos devem ser realistas pro produto. Não invente totalCreatives=100 se o orçamento sugere produto pequeno. Para affiliates / produtos info novos, 8-15 criativos é típico. Para escala maior (ecom estabelecido), 20-40+.`;

  const USER = `INFO DO PRODUTO:
${JSON.stringify(productInfo, null, 2)}

PERSONA:
${JSON.stringify(persona, null, 2)}

COPY ANSWERS:
${JSON.stringify(copyAnswers, null, 2)}

Gere o plano completo. Retorne APENAS o JSON.`;

  // Use Opus 4.7 — strategy is creative judgment + product domain knowledge.
  // Retry on overload (same pattern as /complete).
  const requestBody = JSON.stringify({
    model: DEFAULT_MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{ role: 'user', content: USER }],
  });

  const MAX_ATTEMPTS = 5;
  try {
    let resp: Response | null = null;
    let lastText = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      resp = await fetch(ANTHROPIC_API, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: requestBody,
      });
      if (resp.ok) break;
      lastText = await resp.text();
      const retryable = resp.status === 529 || resp.status === 429 || resp.status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS) {
        return res.status(resp.status).json({
          success: false,
          error: `Claude API error: ${resp.status} ${lastText.substring(0, 200)}`,
        });
      }
      const delay =
        resp.status === 529 || resp.status === 429 ? 10000 + 5000 * attempt : 1000 * Math.pow(2, attempt - 1);
      console.warn(
        `[Claude marketing-plan] ${resp.status} attempt ${attempt}/${MAX_ATTEMPTS}, retrying in ${delay}ms…`
      );
      await new Promise((r) => setTimeout(r, delay));
    }

    if (!resp || !resp.ok) {
      return res.status(503).json({
        success: false,
        error: 'Claude indisponível após múltiplas tentativas. Tente novamente em alguns minutos.',
      });
    }

    const data = await resp.json();
    const textBlock = Array.isArray(data.content)
      ? data.content.find((b: any) => b?.type === 'text')
      : null;
    const responseText = textBlock?.text || '';
    const clean = responseText.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();

    let plan;
    try {
      plan = JSON.parse(clean);
    } catch {
      return res.status(500).json({
        success: false,
        error: 'Claude retornou resposta inválida (não-JSON).',
        raw: responseText.substring(0, 500),
      });
    }

    res.json({ success: true, plan });
  } catch (err: any) {
    console.error('[Claude marketing-plan] Exception:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/claude/recommend-avatar-voice
// Returns structured avatar + voice criteria for the current project based on
// persona answers + the approved copy. Used by the Avatar/Voz tabs to:
//   1. show a "🤖 IA recomenda" panel at the top of the tab,
//   2. populate the "Aplicar filtros sugeridos" button,
//   3. mark matching avatars/voices with a star.
//
// Request: { persona?: any, copyAnswers?: any, copy?: string }
// Response: { success: true, recommendation: { avatar: {...}, voice: {...}, reasoning: string } }
claudeRouter.post('/recommend-avatar-voice', async (req, res) => {
  const apiKey = getClaudeKey();
  if (!apiKey) {
    return res.status(500).json({ success: false, error: 'CLAUDE_API_KEY não configurada.' });
  }

  const { persona = {}, copyAnswers = {}, copy = '' } = req.body || {};

  const SYSTEM = `You recommend the ideal HeyGen avatar profile and ElevenLabs voice profile for a Meta (Facebook/Instagram) video ad, based on the persona and approved copy.

Return ONLY a JSON object with this exact shape (no prose, no markdown):
{
  "avatar": {
    "gender": "male" | "female",
    "age": "young" | "adult" | "mature" | "elderly",
    "ethnicity": "white" | "asian" | "south_asian" | "latino" | "middle_eastern" | "black" | "mixed",
    "style": "professional" | "lifestyle" | "ugc" | "creative",
    "vibe": "energetic" | "calm" | "authoritative" | "friendly" | "serious"
  },
  "voice": {
    "gender": "male" | "female",
    "age": "young" | "middle_aged" | "old",
    "accent": "brazilian" | "european" | "american" | "british" | "latin american",
    "use_case": "advertisement" | "social_media" | "narrative_story" | "conversational" | "informative_educational",
    "descriptive": "professional" | "confident" | "calm" | "casual" | "deep" | "upbeat" | "pleasant" | "excited"
  },
  "reasoning": "<one short paragraph in pt-BR explaining the choice — who would best convince this persona to buy>"
}

Match the avatar/voice to who the persona would TRUST most. Energetic upbeat voice for hype/youth products. Calm authoritative voice for B2B/health. Brazilian accent unless the copy or persona suggests otherwise.`;

  const USER = `PERSONA:
${JSON.stringify(persona, null, 2)}

COPY ANSWERS:
${JSON.stringify(copyAnswers, null, 2)}

APPROVED COPY:
${copy || '(none)'}

Recommend the ideal avatar + voice profile. Respond with the JSON object only.`;

  // Opus 4.7 — same model used for ad copy generation. Choosing the right
  // avatar/voice for a persona is high-stakes creative judgment, not a
  // mechanical classification, so we pay for the strongest model. If Opus
  // is sustainedly overloaded after all retries, we fall back to Sonnet 4.6
  // — slightly worse output, but better than failing entirely.
  const makeBody = (model: string) =>
    JSON.stringify({
      model,
      max_tokens: 1500,
      // Use Claude's default temperature so each Recalcular click can
      // produce a different high-quality alternative. The persisted cache
      // (config.copy.aiRecommendation) prevents unintended drift between
      // tab reopens — only explicit Recalcular triggers a new fetch.
      system: SYSTEM,
      messages: [{ role: 'user', content: USER }],
    });
  const PRIMARY_MODEL = DEFAULT_MODEL;
  const FALLBACK_MODEL = 'claude-sonnet-4-6';
  let requestBody = makeBody(PRIMARY_MODEL);

  // Retry with backoff. Anthropic's 529 (overloaded) can persist for
  // several minutes during peak load — short backoffs just burn attempts
  // and surface the error to the user. We give it real time to recover,
  // and switch to the fallback model halfway through if Opus stays down.
  const MAX_ATTEMPTS = 6;
  const SWITCH_MODEL_AFTER = 3; // attempts on primary before falling back
  try {
    let resp: Response | null = null;
    let lastText = '';
    let currentModel = PRIMARY_MODEL;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt === SWITCH_MODEL_AFTER + 1 && currentModel !== FALLBACK_MODEL) {
        currentModel = FALLBACK_MODEL;
        requestBody = makeBody(FALLBACK_MODEL);
        console.warn(`[Claude recommend] switching to fallback model ${FALLBACK_MODEL}`);
      }
      resp = await fetch(ANTHROPIC_API, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: requestBody,
      });
      if (resp.ok) break;
      lastText = await resp.text();
      const retryable = resp.status === 529 || resp.status === 429 || resp.status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS) {
        console.error('[Claude recommend] error', resp.status, lastText.substring(0, 300));
        return res.status(resp.status).json({
          success: false,
          error: `Claude API error: ${resp.status} ${lastText.substring(0, 200)}`,
        });
      }
      // Long waits for 529 (overload) and 429 (rate limit) — both are
      // capacity issues that don't resolve in a few seconds.
      const delay =
        resp.status === 529 || resp.status === 429
          ? 10000 + 5000 * attempt // 15s, 20s, 25s, 30s, 35s, 40s
          : 1000 * Math.pow(2, attempt - 1);
      console.warn(
        `[Claude recommend] ${resp.status} attempt ${attempt}/${MAX_ATTEMPTS} (${currentModel}), retrying in ${delay}ms…`
      );
      await new Promise((r) => setTimeout(r, delay));
    }

    if (!resp || !resp.ok) {
      return res.status(503).json({
        success: false,
        error: 'Claude indisponível após múltiplas tentativas. Tente novamente em alguns minutos.',
      });
    }

    const data = await resp.json();
    const textBlock = Array.isArray(data.content)
      ? data.content.find((b: any) => b?.type === 'text')
      : null;
    const text = textBlock?.text || '';
    const clean = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();

    let recommendation;
    try {
      recommendation = JSON.parse(clean);
    } catch {
      return res.status(500).json({
        success: false,
        error: 'Claude retornou resposta inválida (não-JSON).',
        raw: text.substring(0, 300),
      });
    }

    res.json({ success: true, recommendation });
  } catch (err: any) {
    console.error('[Claude recommend] Exception:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
