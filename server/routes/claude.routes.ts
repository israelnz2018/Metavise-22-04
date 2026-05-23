import { Router } from 'express';
import fs from 'fs';
import { YoutubeTranscript } from 'youtube-transcript';
import ytdl from '@distube/ytdl-core';
import { getClaudeKey, getAssemblyAIKey } from '../config/apiKeys.js';
import { CLAUDE_CONFIG_PATH } from '../config/paths.js';
import { createLogger } from '../utils/logger.js';
const log = createLogger('Claude');

// Fallback path when YouTube captions are unavailable: download the audio
// stream via ytdl + send to AssemblyAI for transcription. Returns the full
// text or throws. Polls for up to 5 minutes.
async function transcribeYoutubeWithAssemblyAI(videoId: string): Promise<string> {
  const apiKey = getAssemblyAIKey();
  if (!apiKey) throw new Error('AssemblyAI API key não configurada — não dá pra usar fallback.');

  log.info(`[YouTube fallback] Fetching audio stream for ${videoId}...`);
  const info = await ytdl.getInfo(videoId);
  const audioFormat = ytdl.chooseFormat(info.formats, { quality: 'lowestaudio' });
  if (!audioFormat?.url) {
    throw new Error('Não consegui obter o áudio desse vídeo do YouTube.');
  }

  // Stream the audio bytes from YouTube into AssemblyAI's /v2/upload.
  // AssemblyAI accepts arbitrary binary uploads and returns an `upload_url`
  // that we then point /v2/transcript at.
  log.info(`[YouTube fallback] Streaming audio to AssemblyAI...`);
  const audioResp = await fetch(audioFormat.url);
  if (!audioResp.ok || !audioResp.body) {
    throw new Error(`Falha ao baixar áudio do YouTube (status ${audioResp.status}).`);
  }
  const audioBuffer = Buffer.from(await audioResp.arrayBuffer());

  const uploadResp = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: { authorization: apiKey, 'content-type': 'application/octet-stream' },
    body: audioBuffer,
  });
  if (!uploadResp.ok) {
    throw new Error(`AssemblyAI upload falhou: ${uploadResp.status}`);
  }
  const { upload_url } = (await uploadResp.json()) as { upload_url: string };

  // Submit for transcription.
  const submitResp = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: { authorization: apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ audio_url: upload_url, language_detection: true }),
  });
  if (!submitResp.ok) {
    throw new Error(`AssemblyAI submit falhou: ${submitResp.status}`);
  }
  const { id: transcriptId } = (await submitResp.json()) as { id: string };
  log.info(`[YouTube fallback] AssemblyAI transcript ${transcriptId} submitted, polling...`);

  // Poll. 5s interval, up to 5min ceiling. VSLs are usually transcribed
  // in 30-90s; longer videos take proportionally longer.
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise((r) => setTimeout(r, 5000));
    const statusResp = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
      headers: { authorization: apiKey },
    });
    if (!statusResp.ok) continue;
    const data: any = await statusResp.json();
    if (data.status === 'completed') {
      log.info(`[YouTube fallback] AssemblyAI done — ${data.text?.length || 0} chars`);
      return data.text || '';
    }
    if (data.status === 'error') {
      throw new Error(`AssemblyAI error: ${data.error}`);
    }
  }
  throw new Error('AssemblyAI transcrição passou de 5 minutos sem terminar.');
}

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
    log.info('[Claude Config] API Key updated successfully.');
    res.json({ message: 'Claude API Key updated successfully.' });
  } catch (err: any) {
    log.error('[Claude Config] Error saving config:', err);
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

  log.info(
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
      const retryable =
        response.status === 529 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS) {
        log.error(
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
      log.warn(
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
      log.error('[Claude] No text block in response:', JSON.stringify(data).substring(0, 500));
      return res.status(500).json({
        success: false,
        error: 'Claude retornou resposta sem texto.',
      });
    }

    const usage = data.usage || {};
    log.info(
      `[Claude] reply ok — input=${usage.input_tokens} cache_read=${usage.cache_read_input_tokens ?? 0} cache_write=${usage.cache_creation_input_tokens ?? 0} output=${usage.output_tokens} stop_reason=${data.stop_reason}`
    );
    res.json({ success: true, text });
  } catch (err: any) {
    log.error('[Claude] Exception:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/claude/complete-stream
// Same prompt shape as /complete but pipes Anthropic's SSE stream
// straight through to the client. Used by long copy generations where
// "..." for 15s feels broken — with streaming the user sees the first
// tokens within ~1s. Client unwraps the stream via fetch + ReadableStream.
//
// We forward raw Anthropic SSE events (event/data lines). On the
// client, parse only `content_block_delta` events with text deltas.
claudeRouter.post('/complete-stream', async (req, res) => {
  const apiKey = getClaudeKey();
  if (!apiKey) {
    return res.status(500).json({ success: false, error: 'CLAUDE_API_KEY não configurada.' });
  }

  const {
    system,
    user,
    max_tokens: requestedMaxTokens = DEFAULT_MAX_TOKENS,
    model = DEFAULT_MODEL,
    thinking = true,
  } = req.body || {};
  if (!user) {
    return res.status(400).json({ success: false, error: 'O campo "user" é obrigatório.' });
  }

  const max_tokens = Math.max(requestedMaxTokens, DEFAULT_MAX_TOKENS);

  log.info(
    `[Claude] /complete-stream model=${model} thinking=${
      thinking ? THINKING_EFFORT : 'off'
    } max_tokens=${max_tokens} user_len=${user.length}`
  );

  const body = JSON.stringify({
    model,
    max_tokens,
    stream: true,
    ...(thinking
      ? {
          thinking: { type: 'adaptive' },
          output_config: { effort: THINKING_EFFORT },
        }
      : {}),
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

  try {
    const upstream = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body,
    });

    if (!upstream.ok || !upstream.body) {
      const errText = upstream.body ? await upstream.text() : 'No response body';
      log.error(`[Claude stream] upstream error ${upstream.status}: ${errText.substring(0, 300)}`);
      return res.status(upstream.status || 500).json({
        success: false,
        error: `Claude API error: ${upstream.status} ${errText.substring(0, 300)}`,
      });
    }

    // Set up SSE response headers. Disable nginx buffering with the
    // x-accel header so chunks reach the client immediately.
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    // Anthropic streams `event: <name>\ndata: <json>\n\n` — we forward
    // those raw so the client can parse the same protocol.
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) res.write(decoder.decode(value, { stream: true }));
      }
      res.end();
    } catch (streamErr: any) {
      log.error('[Claude stream] pipe error:', streamErr);
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
  } catch (err: any) {
    log.error('[Claude stream] exception:', err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: err.message });
    } else {
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
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
    let transcript = '';
    try {
      const segments = await YoutubeTranscript.fetchTranscript(videoId);
      transcript = segments
        .map((s: any) => s.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    } catch (err: any) {
      log.info(`[YouTube] captions fetch failed: ${err.message}, trying AssemblyAI fallback...`);
    }

    // Fallback: when YouTube doesn't expose captions (creator disabled them,
    // or auto-captions failed to generate), stream the audio through
    // AssemblyAI. Slower (~30-90s) and costs ~$0.10/10min audio, but works
    // for the ~10% of videos without captions.
    if (!transcript) {
      try {
        transcript = await transcribeYoutubeWithAssemblyAI(videoId);
      } catch (err: any) {
        return res.status(400).json({
          success: false,
          error: `Não consegui transcrever esse vídeo (sem legendas E fallback falhou: ${err.message}). Tente colar a transcrição manualmente.`,
        });
      }
    }

    if (!transcript) {
      return res.status(400).json({
        success: false,
        error: 'Vídeo do YouTube sem texto utilizável. Tente colar a transcrição manualmente.',
      });
    }
    sourceText = [sourceText, transcript].filter(Boolean).join('\n\n');
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
    log.error('[Claude extract-product-info] Exception:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/claude/persona-from-product
// Maps the ProductInfo extracted from a VSL/landing page into the exact
// persona answers schema the front-end form expects. Claude picks the
// best-fitting option from each enum and writes free-text fields directly.
//
// Request:  { productInfo: any, options: { categories, urgencies, differentials, triedBefores, payingCapacities, hiddenDesires } }
// Response: { success: true, answers: {...} }
claudeRouter.post('/persona-from-product', async (req, res) => {
  const apiKey = getClaudeKey();
  if (!apiKey) {
    return res.status(500).json({ success: false, error: 'CLAUDE_API_KEY não configurada.' });
  }

  const { productInfo, options } = req.body || {};
  if (!productInfo || !options) {
    return res.status(400).json({
      success: false,
      error: 'productInfo e options são obrigatórios.',
    });
  }

  const SYSTEM = `Você recebe informações de um produto + listas de opções pré-definidas. Sua tarefa: preencher TODOS os campos dos formulários "Identificar Persona" E "Copy" — eles compartilham o mesmo objeto answers no front-end, então retorne tudo de uma vez.

Responda APENAS um JSON com esta estrutura exata (sem prosa, sem markdown):
{
  "product": "nome curto do produto (1 frase)",
  "category": "<UM valor exato de categories>",
  "whatItDoes": "frase única: o que o produto faz",
  "transformationFrom": "estado/dor antes de usar (curto)",
  "transformationTo": "estado/resultado depois (curto)",
  "productComment": "contexto rico (1-2 frases)",
  "urgency": "<UM valor exato de urgencies>",
  "differentials": ["2-5 valores exatos de differentials"],
  "problemComment": "contexto sobre o problema (1 frase)",
  "personaTriedBefore": ["1-5 valores exatos de triedBefores"],
  "payingCapacity": "<UM valor exato de payingCapacities>",
  "hiddenDesires": ["1-3 valores exatos de hiddenDesires"],
  "clientComment": "contexto sobre o cliente (1 frase)",

  "language": "<UM valor exato de languages>",
  "audience": "descrição do público em 1 frase",
  "age": ["faixas etárias relevantes — 1-3 valores exatos de ageBuckets"],
  "situation": "situação atual do cliente em 1 frase",
  "painPoints": "problema principal em 1 frase",
  "triedBefore": "o que já tentou (free-text, 1 frase resumida)",
  "mainObjection": "objeção principal que o cliente teria",
  "hiddenDesire": "desejo profundo (free-text, NÃO o resultado superficial)",

  "productName": "nome do produto",
  "productProblem": "qual problema o produto resolve",
  "productResult": "resultado concreto que entrega",
  "uniqueMechanism": "o que torna o produto diferente",
  "socialProof": "depoimento, número ou resultado mencionável",

  "businessModel": "<UM valor exato de businessModels>",
  "emotion": "<UM valor exato de emotions>",
  "angleIdea": "<UM valor exato de angles>",
  "basePhrase": "frase base no padrão 'O verdadeiro problema não é X, é Y' adaptada ao produto"
}

Regras:
- Enums: SEMPRE escolha valores EXATOS das listas (case-sensitive). Nunca invente.
- differentials: 2-5 itens. personaTriedBefore: 1-5. hiddenDesires: 1-3. age: 1-3.
- Free-text CURTO e específico (não genérico).
- Se a informação não estiver clara no produto, use o melhor palpite com base no contexto.`;

  const USER = `INFORMAÇÕES DO PRODUTO:
${JSON.stringify(productInfo, null, 2)}

OPÇÕES DISPONÍVEIS:
${JSON.stringify(options, null, 2)}

Preencha todos os campos do formulário. Retorne APENAS o JSON.`;

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
        max_tokens: 1500,
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

    let answers;
    try {
      answers = JSON.parse(clean);
    } catch {
      return res.status(500).json({
        success: false,
        error: 'Claude retornou resposta inválida (não-JSON).',
        raw: responseText.substring(0, 500),
      });
    }

    res.json({ success: true, answers });
  } catch (err: any) {
    log.error('[Claude persona-from-product] Exception:', err);
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

  // Accept both shapes:
  //   Legacy: { productInfo, persona, copyAnswers }
  //   New v2: { productInfo, personas: WeightedPersona[], selectedPersonaIds?: string[],
  //             copyAnswers, targetCount?: number }
  const {
    productInfo = {},
    persona = null, // legacy single persona (kept for back-compat)
    personas = null, // new: array of WeightedPersona
    selectedPersonaIds = null, // new: user's subset of personas (defaults to all non-stretch)
    copyAnswers = {},
    targetCount = 15, // default to 15 briefs per Andromeda guidance
  } = req.body || {};

  // Build the personas array the prompt will consume:
  //   - If `personas` provided, use it (filtered by selectedPersonaIds if any)
  //   - Otherwise wrap legacy `persona` as a single persona with weight=1
  let personasForPrompt: any[] = [];
  if (Array.isArray(personas) && personas.length > 0) {
    personasForPrompt =
      selectedPersonaIds && Array.isArray(selectedPersonaIds) && selectedPersonaIds.length > 0
        ? personas.filter((p: any) => selectedPersonaIds.includes(p.id))
        : personas;
    // Re-normalize weights so the SELECTED subset sums to 1.0
    const total = personasForPrompt.reduce((acc, p) => acc + (Number(p.suggestedWeight) || 0), 0);
    if (total > 0) {
      personasForPrompt = personasForPrompt.map((p: any) => ({
        ...p,
        suggestedWeight: (Number(p.suggestedWeight) || 0) / total,
      }));
    }
  } else if (persona && typeof persona === 'object') {
    personasForPrompt = [{ id: 'legacy-persona', ...persona, suggestedWeight: 1.0 }];
  }

  if (personasForPrompt.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Forneça `personas` (array com weights) ou `persona` (objeto único).',
    });
  }

  // Compute the exact distribution: how many briefs per persona, given weights.
  // Floor each to integer, distribute the remainder to the highest-weight personas.
  const computeDistribution = (
    personasList: any[],
    total: number
  ): Array<{ personaId: string; personaName: string; count: number }> => {
    const raw = personasList.map((p) => ({
      personaId: p.id,
      personaName: p.name,
      raw: (Number(p.suggestedWeight) || 0) * total,
    }));
    const floored = raw.map((r) => ({ ...r, count: Math.floor(r.raw) }));
    let allocated = floored.reduce((acc, r) => acc + r.count, 0);
    // Distribute remainder to entries with the largest fractional part.
    const remainders = raw
      .map((r, i) => ({ index: i, frac: r.raw - Math.floor(r.raw) }))
      .sort((a, b) => b.frac - a.frac);
    for (const { index } of remainders) {
      if (allocated >= total) break;
      floored[index]!.count += 1;
      allocated += 1;
    }
    return floored.map(({ personaId, personaName, count }) => ({
      personaId,
      personaName,
      count,
    }));
  };

  const distribution = computeDistribution(personasForPrompt, targetCount);

  const SYSTEM = `Você é um estrategista de Meta Ads com domínio dos updates recentes (Andromeda 2025+). Recebe info do produto + 1-3 personas com pesos + uma distribuição já calculada de quantos criativos cada persona recebe, e gera DOIS outputs em um JSON único: (1) o PLANO MACRO de lançamento, e (2) os N CRIATIVOS específicos (briefs) que serão produzidos.

Princípios Andromeda que DEVE guiar tudo:
- Volume e diversidade vencem perfeição individual. Meta escolhe melhor que humanos quando tem N criativos pra testar.
- Múltiplos hooks > um hook "perfeito". Cobrir 5-7 ângulos diferentes.
- Cobrir TODOS os níveis de consciência relevantes DENTRO de cada persona (não pular awareness só porque é um nicho mais "frio").
- Mix de durações: 15-30s (scroll-stoppers) + 30-60s (storytelling) + 60-180s (VSL profunda) quando faz sentido pro produto.
- Diversidade conceitual REAL — não 15 versões da mesma ideia, mas 15 ângulos psicologicamente distintos.
- Vídeo > estático na maioria dos casos. Avatar IA é viável e escala.

Responda APENAS um JSON com esta estrutura (sem prosa, sem markdown):
{
  "plan": {
    "summary": "1-2 parágrafos em PT-BR resumindo a estratégia macro",
    "creativeVolume": {
      "totalCreatives": ${targetCount},
      "rationale": "por que esse número faz sentido pra esse produto/personas",
      "perAudience": número inteiro
    },
    "hookMix": [
      { "angle": "Curiosidade", "count": 3, "example": "exemplo de hook", "awarenessLevel": "unaware", "rationale": "..." }
    ],
    "awarenessCoverage": [
      { "level": "unaware|problem_aware|solution_aware|product_aware|most_aware", "creativeCount": 3, "approach": "..." }
    ],
    "durations": [
      { "length": "15-30s", "purpose": "scroll stopper / disrupt", "count": 5 }
    ],
    "adStructure": {
      "campaigns": 1,
      "adSets": 1,
      "creativesPerAdSet": ${targetCount},
      "rationale": "Andromeda 2025+: 1 ad set Advantage+ broad com TODOS os criativos rodando juntos. Personas vivem nos criativos, não nos ad sets."
    },
    "budget": {
      "dailyMin": 50,
      "dailyRecommended": 150,
      "rationale": "PT-BR — Andromeda precisa de ~50 conversões/semana por ad set pra otimizar bem"
    },
    "iterationPlan": {
      "testDays": 5,
      "killThreshold": "métrica + valor (ex: CPA > R$X depois de Y impressões)",
      "scaleThreshold": "métrica + valor pra dobrar budget",
      "iterationFrequency": "a cada quantos dias revisar"
    },
    "andromedaTips": ["tip específico 1", "tip 2", "tip 3"],
    "nextSteps": ["ação 1 dentro do MetaVise", "ação 2"]
  },
  "briefs": [
    {
      "id": "brief_1",
      "index": 1,
      "targetPersonaId": "<id de uma das personas do input>",
      "targetPersonaName": "<nome da mesma persona>",
      "awareness": "unaware|problem_aware|solution_aware|product_aware|most_aware",
      "angle": "Curiosidade|Urgência|Prova Social|Transformação|Mecanismo Revelado|Autoridade|Contra-Intuitivo|Medo de Perda|Desejo Aspiracional",
      "hook": "TEXTO COMPLETO DA PRIMEIRA FRASE DO ANÚNCIO — não conceito, mas o que o avatar vai falar literalmente. 1-2 sentenças.",
      "durationTarget": 15|30|45|60|90|120,
      "emotion": "Curiosidade|Medo|Desejo|Validação|Raiva|Esperança|Urgência|Pertencimento",
      "style": "Depoimento|Mecanismo Revelado|Antes e Depois|Demo|História Pessoal|Comparação|Lista de Benefícios|Autoridade Explica",
      "ctaStyle": "soft|hard|curiosity_gap",
      "promiseFocus": "qual benefício específico do produto esse criativo destaca (1 frase)",
      "rationale": "1 linha — por que essa combinação faz sentido pra essa persona e esse momento do funil"
    }
    // ... repetir até totalizar exatamente ${targetCount} briefs
  ]
}

🚨 REGRAS CRÍTICAS PARA OS BRIEFS:
1. Total EXATO de ${targetCount} briefs. Nem mais, nem menos.
2. Distribuição POR PERSONA DEVE SER:
${distribution.map((d) => `   - ${d.personaName} (id: ${d.personaId}): ${d.count} briefs`).join('\n')}
3. Cada brief usa EXATAMENTE o targetPersonaId/Name de uma das personas listadas acima.
4. Dentro de cada bucket de persona, cubra MÚLTIPLOS awareness levels (não 5 briefs todos em "solution_aware" — varie).
5. Dentro de cada bucket de persona, varie os ângulos psicológicos (não repita "Curiosidade" 4 vezes pro mesmo persona).
6. Hook deve ser TEXTO PRONTO, não placeholder genérico. Use vocabulário específico das dores/desejos da persona.
7. durationTarget realista pra duração necessária do hook (15s não dá pra "História Pessoal" elaborada).
8. ids únicos no formato "brief_1", "brief_2", ..., "brief_${targetCount}".

Os valores numéricos do PLAN devem refletir a realidade do produto (não invente budget de R$5000/d se for infoproduto novo).`;

  const USER = `INFO DO PRODUTO:
${JSON.stringify(productInfo, null, 2)}

PERSONAS (${personasForPrompt.length}, com pesos já normalizados):
${JSON.stringify(personasForPrompt, null, 2)}

DISTRIBUIÇÃO PRÉ-CALCULADA (use EXATAMENTE essa contagem por persona):
${JSON.stringify(distribution, null, 2)}

COPY ANSWERS (contexto adicional, pode usar pra refinar mas não é fonte primária):
${JSON.stringify(copyAnswers, null, 2)}

TARGET COUNT: ${targetCount} briefs no total.

Gere o JSON completo com "plan" + "briefs" (exatamente ${targetCount} entradas).`;

  // Use Opus 4.7 — strategy is creative judgment + product domain knowledge.
  // Retry on overload (same pattern as /complete).
  // max_tokens bumped from 4000 → 12000 to fit plan + 15 briefs.
  const requestBody = JSON.stringify({
    model: DEFAULT_MODEL,
    max_tokens: 12000,
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
        resp.status === 529 || resp.status === 429
          ? 10000 + 5000 * attempt
          : 1000 * Math.pow(2, attempt - 1);
      log.warn(
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

    let parsed: any;
    try {
      parsed = JSON.parse(clean);
    } catch {
      return res.status(500).json({
        success: false,
        error: 'Claude retornou resposta inválida (não-JSON).',
        raw: responseText.substring(0, 500),
      });
    }

    // Backwards-compat: if Claude returns the old flat shape (just plan
    // fields, no `plan`/`briefs` wrapper), wrap it.
    const responsePayload =
      parsed && typeof parsed === 'object' && ('plan' in parsed || 'briefs' in parsed)
        ? { plan: parsed.plan ?? null, briefs: Array.isArray(parsed.briefs) ? parsed.briefs : [] }
        : { plan: parsed, briefs: [] };

    // Sanity-check: brief count matches request (log warning, don't fail —
    // user can re-roll). The frontend can show a "X of 15 generated" hint.
    if (responsePayload.briefs.length !== targetCount && responsePayload.briefs.length > 0) {
      log.warn(
        `[Claude marketing-plan] expected ${targetCount} briefs, got ${responsePayload.briefs.length}`
      );
    }

    res.json({ success: true, ...responsePayload });
  } catch (err: any) {
    log.error('[Claude marketing-plan] Exception:', err);
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

  const { persona = {}, copyAnswers = {}, copy = '', productInfo = null } = req.body || {};

  const SYSTEM = `You recommend the ideal HeyGen avatar profile and ElevenLabs voice profile for a Meta (Facebook/Instagram) video ad, based on the product, persona, and approved copy.

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

  const USER = `${productInfo ? `PRODUCT INFO:\n${JSON.stringify(productInfo, null, 2)}\n\n` : ''}PERSONA:
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
        log.warn(`[Claude recommend] switching to fallback model ${FALLBACK_MODEL}`);
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
        log.error('[Claude recommend] error', resp.status, lastText.substring(0, 300));
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
      log.warn(
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
    log.error('[Claude recommend] Exception:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
