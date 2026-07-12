import { Router } from 'express';
import fs from 'fs';
import { YoutubeTranscript } from 'youtube-transcript';
import ytdl from '@distube/ytdl-core';
import { getClaudeKey, getAssemblyAIKey } from '../config/apiKeys.js';
import { CLAUDE_CONFIG_PATH } from '../config/paths.js';
import { createLogger } from '../utils/logger.js';
import {
  recordUsage,
  parseUsageFromSSE,
  getUsage,
  resetUsage,
  setBalance,
} from '../utils/claudeUsage.js';
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

// GET /api/claude/usage — gasto REAL acumulado nesta chave da Claude (o app
// conta o próprio consumo; a Anthropic não expõe o saldo por chave).
claudeRouter.get('/usage', (_req, res) => {
  res.json({ success: true, usage: getUsage() });
});
// POST /api/claude/usage/reset — zera o contador (recomeça a medição).
claudeRouter.post('/usage/reset', (_req, res) => {
  res.json({ success: true, usage: resetUsage() });
});
// POST /api/claude/usage/balance — informa o saldo atual da conta (US$). A
// Anthropic não expõe saldo por chave, então o app desconta o gasto medido.
claudeRouter.post('/usage/balance', (req, res) => {
  const amount = Number((req.body || {}).amount);
  if (!Number.isFinite(amount) || amount < 0) {
    return res.status(400).json({ success: false, error: 'amount inválido' });
  }
  res.json({ success: true, usage: setBalance(amount) });
});

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
// Opus 4.8 is Anthropic's strongest model — best for the kind of nuanced,
// emotion-aware copy this app produces (mesmo preço do 4.7, modelo melhor).
// Sonnet 4.6 é mais barato/rápido, mas visivelmente pior em escrita criativa.
// Override per-call passando `model` no corpo da requisição.
const DEFAULT_MODEL = 'claude-opus-4-8';
// Modelo BARATO pras tarefas ESTRUTURADAS (extrair produto, gerar personas,
// plano de criativos, estatísticas, recomendação de avatar/voz) — não têm
// escrita criativa, então Sonnet 4.6 serve sem perder qualidade e corta custo.
// A COPY continua no DEFAULT_MODEL (Opus). Pra mudar o modelo da copy, edite
// DEFAULT_MODEL; pro estruturado, edite STRUCTURED_MODEL.
const STRUCTURED_MODEL = 'claude-sonnet-4-6';
// Extended thinking — Opus 4.7 uses the newer "adaptive" mode controlled by
// output_config.effort ('low' | 'medium' | 'high'). Higher effort = more
// internal reasoning, better copy quality, higher cost.
const THINKING_EFFORT = 'high';
const DEFAULT_MAX_TOKENS = 12000;

// O modelo às vezes devolve JSON com quebras de linha / tabs CRUAS DENTRO das
// strings (ex: "summary": "...focado em ⏎ vídeos longos..."), o que é JSON
// inválido (control char precisa virar \n). Faz uma varredura de um passo só,
// rastreando se está dentro de string, e escapa control chars nesse contexto.
// Em JSON já válido não há control char cru dentro de string → no-op seguro.
function escapeControlCharsInStrings(s: string): string {
  let out = '';
  let inStr = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      out += ch;
      continue;
    }
    if (inStr) {
      if (ch === '\n') {
        out += '\\n';
        continue;
      }
      if (ch === '\r') {
        out += '\\r';
        continue;
      }
      if (ch === '\t') {
        out += '\\t';
        continue;
      }
    }
    out += ch;
  }
  return out;
}

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
    recordUsage(model, usage);
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
    let sseBuf = ''; // acumula o stream pra extrair o usage no final
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          sseBuf += chunk;
          res.write(chunk);
        }
      }
      recordUsage(model, parseUsageFromSSE(sseBuf));
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
  "productName": "nome EXATO do produto/serviço. Se o material tiver a grafia ESCRITA (landing page, título, site, descrição), USE essa grafia letra por letra — transcrições de áudio/VSL erram nomes de marca novos (ex: ouvem 'Aria Leaf' quando é 'Arialief'). Copie o nome ESCRITO quando existir; só caia no que foi falado se não houver versão escrita.",
  "category": "categoria (ex: emagrecimento, finanças, infoproduto, físico)",
  "offer": "oferta resumida (o que custa quanto e o que vem incluso)",
  "priceInfo": "preço encontrado no material com a moeda e o período, EXATAMENTE como aparece (ex: 'R$97/mês', 'US$197 único', '12x de R$39'). Se não houver preço explícito, string vazia.",
  "billingType": "'recorrente' se for assinatura/mensalidade/plano que cobra repetido; 'unico' se for compra avulsa; string vazia se não der pra saber",
  "promise": "promessa principal — o resultado que o cliente terá",
  "mainPain": "dor principal que o produto resolve",
  "secondaryPains": ["dor 2", "dor 3"],
  "emotionalDriver": "como ESTA VSL realmente vende — LEIA o material, não assuma (varia muito por oferta). Em 1-3 frases diga: (a) o DRIVER emocional PRINCIPAL que move o comprador (ex.: medo do que pode vir, autonomia/controle, segurança da família, desejo profundo, status, alívio, desconfiança...); (b) 1-2 ângulos SECUNDÁRIOS que a VSL também usa; (c) o TOM/postura do narrador que a VSL adota (ex.: pessoa que viveu, especialista, proativo se preparando, observador). Capte o que a VSL ESTÁ fazendo, não o sintoma de superfície.",
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
        model: STRUCTURED_MODEL,
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
    recordUsage(STRUCTURED_MODEL, data.usage);
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

// POST /api/claude/broll-queries
// Pra cada TRECHO de narração da VSL, gera um termo de busca VISUAL (2-3 palavras,
// inglês) que captura a IDEIA da frase — não uma palavra solta. Usado pelo
// Auto-editar pra buscar b-roll relevante no Pexels. Se `effects` (nomes de
// efeitos sonoros disponíveis) vier no body, também escolhe — só quando encaixa
// MUITO bem — um efeito contextual por trecho (ou null).
// Body: { segments: string[], effects?: string[] }
//   → { queries: string[], effects: (string|null)[] } (mesma ordem/tamanho)
claudeRouter.post('/broll-queries', async (req, res) => {
  const apiKey = getClaudeKey();
  if (!apiKey) return res.status(500).json({ success: false, error: 'CLAUDE_API_KEY não configurada.' });
  const segments: string[] = Array.isArray((req.body || {}).segments)
    ? (req.body as any).segments.map((s: any) => String(s || '').slice(0, 400))
    : [];
  if (segments.length === 0) return res.status(400).json({ success: false, error: 'segments vazio.' });
  const fxList: string[] = Array.isArray((req.body || {}).effects)
    ? (req.body as any).effects.map((s: any) => String(s || '').slice(0, 40)).filter(Boolean)
    : [];

  const FX_RULES = fxList.length
    ? `
"fx" — a contextual SOUND EFFECT, ONLY from this exact list: ${JSON.stringify(fxList)}.
- Use one ONLY when it clearly fits the snippet's meaning (e.g. "Cash Register" for money/price/earnings, "Clock Ticking" for urgency/time running out, "Censor Beep" for something forbidden/secret, "Grilos" for awkward silence, "Vinyl Stop" for a sudden stop/plot-twist, "Mouse Click" for clicking/buying online). Match the name to the idea.
- Be selective but NOT rare: aim for about 1 effect every 2-3 snippets. Output the effect name EXACTLY as in the list, or null.`
    : '\n"fx": always null.';

  const SYSTEM = `You are an expert direct-response video editor cutting a Video Sales Letter. For each narration snippet (Portuguese) you receive, decide how to illustrate it. Output one JSON object per snippet with these fields:

"q" — a B-ROLL stock-footage search query for Pexels:
- 2 to 4 words, in ENGLISH.
- Visual and concrete (a scene/action/object/emotion), NOT abstract words. Think what IMAGE illustrates the idea.
- NEVER proper names, brand names, or numbers.

"style" — "animation" or "real":
- "animation" whenever the idea is scientific/internal/conceptual, better shown as a diagram/3D medical or explainer animation (gut/intestine/bacteria/microbiome, blood flow, how something works inside the body, a mechanism, a chart/graph concept) — use it freely here.
- Even for NON-scientific snippets, still sprinkle "animation" occasionally (about 1 in 6) for visual variety.
- Otherwise "real" for people, emotions, lifestyle, food, everyday scenes. Keep the majority "real".

"tone" — "past" or "now":
- "past" ONLY in the RARE, EXPLICIT "before" moments — the narrator literally describing how the person USED TO suffer in the PAST tense ("eu vivia...", "antes eu...", "eu sofria com...", "costumava..."). This gets a black-and-white look, so it must be reserved for unmistakable before-state lines.
- This is the EXCEPTION: at most ~1 in 10 snippets should be "past". If there's ANY doubt, use "now".
- "now" for everything else (present, solution, hope, results, neutral narration) — the default.

"hl" — a short IMPACTFUL PHRASE to burn big on screen, or null:
- It MUST be a VERBATIM contiguous slice of the snippet — the SAME words, SAME order, no paraphrase, nothing added or removed — 2 to 5 words, the punchiest fragment (a promise, a pain, an emotional hook). It has to be an exact substring so the app can sync it to the exact moment it's SPOKEN.
- Be SELECTIVE: only about 1 in 3 snippets deserves a highlight. Use null for filler/connective snippets. Never the whole sentence — just the striking fragment.

"split" — true or false:
- true OCCASIONALLY (about 1 in 7) when showing TWO complementary visuals side by side fits: before/after, a comparison, "inside and outside", two related ideas at once. Most snippets false.
${FX_RULES}
Respond with ONLY a JSON array, one object per snippet, SAME order and length: [{"q":"...","style":"real|animation","tone":"now|past","hl":"frase curta" or null,"split":true|false,"fx":${fxList.length ? '"Effect Name" or null' : 'null'}}]`;

  const USER = `Snippets (JSON array, ${segments.length} items):\n${JSON.stringify(segments)}\n\nReturn ONLY the JSON array of ${segments.length} objects {q, style, tone, hl, split, fx}.`;

  try {
    const resp = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: STRUCTURED_MODEL,
        // ~80 tokens por trecho (query + style + tone + hl + split + fx). Teto
        // baixo TRUNCA a resposta → JSON.parse falha → cai no fallback (palavra
        // solta). Por isso generoso.
        max_tokens: Math.min(16000, 200 + segments.length * 80),
        system: SYSTEM,
        messages: [{ role: 'user', content: USER }],
      }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      return res.status(resp.status).json({ success: false, error: `Claude ${resp.status} ${t.slice(0, 200)}` });
    }
    const data = await resp.json();
    recordUsage(STRUCTURED_MODEL, data.usage);
    const textBlock = Array.isArray(data.content) ? data.content.find((b: any) => b?.type === 'text') : null;
    const raw = (textBlock?.text || '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    let queries: string[] = [];
    let effects: (string | null)[] = [];
    let styles: string[] = [];
    let tones: string[] = [];
    let highlights: (string | null)[] = [];
    let splits: boolean[] = [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        queries = parsed.map((o) => String((o && typeof o === 'object' ? o.q : o) || '').trim());
        effects = parsed.map((o) => {
          const fx = o && typeof o === 'object' ? o.fx : null;
          return fx && fxList.includes(String(fx)) ? String(fx) : null;
        });
        styles = parsed.map((o) => (o && o.style === 'animation' ? 'animation' : 'real'));
        tones = parsed.map((o) => (o && o.tone === 'past' ? 'past' : 'now'));
        highlights = parsed.map((o) => {
          const hl = o && typeof o === 'object' ? o.hl : null;
          const s = hl ? String(hl).trim() : '';
          return s && s.length >= 3 && s.length <= 60 ? s : null;
        });
        splits = parsed.map((o) => o && o.split === true);
      }
    } catch {
      queries = [];
    }
    res.json({ success: true, queries, effects, styles, tones, highlights, splits });
  } catch (err: any) {
    log.error('[Claude broll-queries] Exception:', err);
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
  "billingModel": "EXATAMENTE 'Pagamento único' OU 'Recorrente (mensal/assinatura)'. Detecte de productInfo.billingType/priceInfo: se aparece /mês, /mo, mensal, assinatura, plano, subscription = Recorrente; senão Pagamento único.",
  "salePrice": "NÚMERO puro (sem moeda, sem texto) do preço de venda, NA MOEDA ORIGINAL do material (NÃO converta). Use productInfo.priceInfo. Se recorrente, o valor POR MÊS. Se houver vários planos, use o marcado como popular/recomendado, senão o do meio. Ex: '$9.99/mo' → salePrice 9.99. Vazio só se não houver preço no material.",
  "saleCurrency": "código ISO 4217 da moeda do salePrice (ex: USD, BRL, EUR, GBP, CAD, AUD, MXN, ARS, JPY, INR...). Detecte do símbolo/contexto: $ ou US$ = USD; R$ = BRL; € = EUR; £ = GBP; ¥ = JPY; ₹ = INR. Se só houver '$' sem país, default USD.",
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
- PREÇO/COBRANÇA: preencha billingModel + salePrice + saleCurrency de productInfo.priceInfo/billingType.
  Se billingType='recorrente' (ou priceInfo tiver "/mês","/mo","/ano","mensal","assinatura",
  "subscription","plano") → billingModel="Recorrente (mensal/assinatura)" e salePrice = valor
  POR MÊS. Senão → billingModel="Pagamento único" e salePrice = valor da compra.
  Se houver vários planos, use o marcado como popular/recomendado; senão o do meio.
  NUNCA converta moeda — mantenha o valor e a moeda ORIGINAIS. Ex: "$9.99/mo" → recorrente,
  salePrice 9.99, saleCurrency "USD". salePrice é NÚMERO puro (sem símbolo). Vazio só se não
  houver preço algum no material.
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
        model: STRUCTURED_MODEL,
        // F7.4 — bumped from 1500 → 4000. The schema has ~30 fields with
        // string values 50-200 chars each. 1500 tokens was hitting the
        // ceiling and truncating mid-string, breaking JSON.parse and
        // surfacing "Claude retornou resposta inválida (não-JSON)".
        max_tokens: 4000,
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
    recordUsage(STRUCTURED_MODEL, data.usage);
    const textBlock = Array.isArray(data.content)
      ? data.content.find((b: any) => b?.type === 'text')
      : null;
    const responseText = textBlock?.text || '';
    const clean = responseText.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    // F7.4 — log raw response when stop reason is `max_tokens` so we can
    // diagnose truncation in future bumps. data.stop_reason comes from the
    // Anthropic API directly.
    if (data.stop_reason === 'max_tokens') {
      log.warn(
        `[persona-from-product] hit max_tokens cap (${responseText.length} chars) — bump if this keeps happening`
      );
    }

    let answers;
    try {
      answers = JSON.parse(clean);
    } catch {
      return res.status(500).json({
        success: false,
        error: `Claude retornou resposta inválida (não-JSON). Stop reason: ${data.stop_reason || 'unknown'}`,
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
    persona = null, // single persona (back-compat)
    personas = null, // array de WeightedPersona
    selectedPersonaIds = null,
    copyAnswers = {},
  } = req.body || {};

  // GUIA DA COPY — Plano de criativos (foco: VENDA). Inputs de mídia:
  // número de criativos = orçamento/dia ÷ custo por criativo (conta, não chute).
  // Custo/criativo recomendado: CBO ~0,5× CPA · ABO ~1× CPA (piso 0,5× CPA).
  const dailyBudget = Number((req.body || {}).dailyBudget) || 0;
  const targetCpa = Number((req.body || {}).targetCpa) || 0;
  const productPrice = Number((req.body || {}).productPrice) || 0;
  const structure =
    String((req.body || {}).structure || 'cbo').toLowerCase() === 'abo' ? 'abo' : 'cbo';
  const costPerCreative = Number((req.body || {}).costPerCreative) || 0;
  // nº de criativos: o cliente DECIDE (desiredCount). Quando ausente, cai pro
  // recomendado (orçamento ÷ custo) e, por fim, pro back-compat (targetCount).
  const desiredCount = Number((req.body || {}).desiredCount) || 0;
  let numCreatives =
    desiredCount > 0
      ? desiredCount
      : dailyBudget > 0 && costPerCreative > 0
        ? Math.floor(dailyBudget / costPerCreative)
        : Number((req.body || {}).targetCount) || 6;
  numCreatives = Math.max(1, Math.min(numCreatives, 40));
  // Aviso (não bloqueia): CPA >= preço = prejuízo.
  const cpaWarning =
    targetCpa > 0 && productPrice > 0 && targetCpa >= productPrice
      ? `CPA-alvo (${targetCpa}) é maior ou igual ao preço (${productPrice}) — isso dá prejuízo por venda.`
      : null;

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

  // Distribuição: reparte os N criativos entre as personas pelos pesos.
  const distribution = computeDistribution(personasForPrompt, numCreatives);

  const SYSTEM = `Você é um estrategista de criativos para Meta Ads. Você NÃO escreve copy nem hooks — você monta o PLANO DE CRIATIVOS: para cada criativo, define a PERSONA, o NÍVEL DE CONSCIÊNCIA e o ÂNGULO. Nada mais.

REGRAS GERAIS:
- IDIOMA: português do Brasil.
- Responda APENAS um JSON válido — sem markdown, sem texto fora do JSON.
- NÃO gere: hook, texto de copy, preço, oferta, orçamento, estrutura de campanha, duração, emoção, estilo. SÓ os campos do schema.

1) DEDUZA O NÍVEL DE CONSCIÊNCIA de cada persona, pelos sinais nas informações:
   - não sabe que tem o problema / não liga os sintomas → "unaware"
   - sente a dor, mas não conhece causa nem solução → "problem_aware"
   - já sabe que existem soluções / já tentou métodos → "solution_aware"
   - conhece o tipo de produto, quer prova / "por que esse" → "product_aware"
   - quase comprando, só falta o empurrão → "most_aware"
   Devolva o nível PRINCIPAL e 1-2 SECUNDÁRIOS quando os sinais aparecerem (uma persona raramente é um nível só).

2) DISTRIBUA os criativos de cada persona pelos níveis dela: o PRINCIPAL leva MAIS criativos; os secundários levam alguns.

3) ATRIBUA um ÂNGULO a cada criativo, escolhido do MENU FIXO:
   choque, curiosidade, historia, dor, medo_de_perda, prova, autoridade, mecanismo, comparacao, transformacao, urgencia
   Regras do ângulo:
   - Compatível com o nível: unaware→choque,curiosidade,historia · problem_aware→dor,medo_de_perda,choque,prova,autoridade · solution_aware→mecanismo,comparacao,autoridade · product_aware→prova,transformacao,comparacao · most_aware→urgencia
   - NÃO repita o mesmo ângulo entre criativos do MESMO nível (variedade = leque de teste).
   - Ancore na dor/desejo REAIS da persona (das informações dadas).

SCHEMA (responda exatamente assim, sem outros campos):
{
  "awareness": [
    { "personaId": "id", "personaName": "nome", "principal": "problem_aware", "secundarios": ["unaware", "solution_aware"], "motivo": "1 frase do porquê desses níveis" }
  ],
  "briefs": [
    { "id": "brief_1", "index": 1, "targetPersonaId": "id", "targetPersonaName": "nome", "awareness": "problem_aware", "angle": "dor" }
  ]
}

NÃO inclua nenhum outro campo nos briefs (sem hook, sem style, sem emotion, sem durationTarget, sem narrator, sem rationale).`;

  const USER = `INFO DO PRODUTO:
${JSON.stringify(productInfo, null, 2)}

PERSONAS (${personasForPrompt.length}):
${JSON.stringify(personasForPrompt, null, 2)}

CONTEXTO ADICIONAL (copyAnswers — use só pra refinar a leitura de consciência):
${JSON.stringify(copyAnswers, null, 2)}

DISTRIBUIÇÃO POR PERSONA (use EXATAMENTE esta contagem de criativos por persona):
${distribution.map((d) => `- ${d.personaName} (id: ${d.personaId}): ${d.count} criativos`).join('\n')}

TOTAL DE CRIATIVOS: ${numCreatives}.

Gere o JSON com "awareness" (um item por persona) e "briefs" (exatamente ${numCreatives} entradas, respeitando a contagem por persona).`;

  // Use Opus 4.7 — strategy is creative judgment + product domain knowledge.
  // Retry on overload (same pattern as /complete).
  // O plano agora só devolve awareness + briefs enxutos (persona·nível·ângulo),
  // sem copy/hook/macro. 8000 tokens sobram pra fechar o JSON mesmo com ~40
  // briefs. Sem web_search: não estimamos nada — os números vêm do cliente.
  const messages: Array<{ role: string; content: any }> = [{ role: 'user', content: USER }];
  const buildBody = () =>
    JSON.stringify({
      model: STRUCTURED_MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      messages,
    });

  const MAX_ATTEMPTS = 5;
  const MAX_PAUSE_CONTINUES = 4;
  try {
    let data: any = null;
    for (let turn = 0; turn <= MAX_PAUSE_CONTINUES; turn++) {
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
          body: buildBody(),
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
          error:
            'Claude indisponível após múltiplas tentativas. Tente novamente em alguns minutos.',
        });
      }

      data = await resp.json();
      recordUsage(STRUCTURED_MODEL, data.usage);
      // Turno pausado pela busca web: devolve o conteúdo do assistant e
      // pede pra continuar. Repete até o modelo fechar a resposta.
      if (data?.stop_reason === 'pause_turn' && Array.isArray(data.content)) {
        log.warn(
          `[Claude marketing-plan] pause_turn — continuando (${turn + 1}/${MAX_PAUSE_CONTINUES})`
        );
        messages.push({ role: 'assistant', content: data.content });
        continue;
      }
      break;
    }
    // Com web_search a resposta tem VÁRIOS blocos de texto (o modelo comenta
    // antes/depois de buscar). O JSON final está embutido — concatena todos os
    // blocos de texto e extrai o objeto JSON pra ser robusto.
    const textBlocks = Array.isArray(data.content)
      ? data.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text || '')
      : [];
    const joined = textBlocks.join('\n');
    const jsonMatch = joined.match(/\{[\s\S]*\}/);
    const responseText = jsonMatch ? jsonMatch[0] : textBlocks[textBlocks.length - 1] || '';
    const clean = responseText.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();

    let parsed: any;
    try {
      parsed = JSON.parse(clean);
    } catch {
      // Fallback: o modelo quebrou linha no meio de uma string (control char
      // cru). Escapa e tenta de novo antes de desistir.
      try {
        parsed = JSON.parse(escapeControlCharsInStrings(clean));
        log.warn('[Claude marketing-plan] JSON reparado (control chars em string).');
      } catch {
        log.error(
          `[Claude marketing-plan] JSON.parse falhou. stop_reason=${data?.stop_reason} len=${responseText.length}`
        );
        return res.status(500).json({
          success: false,
          error: `Claude retornou resposta inválida (não-JSON). stop_reason: ${
            data?.stop_reason || 'unknown'
          }`,
          raw: responseText.substring(0, 500),
        });
      }
    }

    // Novo shape enxuto: { awareness: [...], briefs: [{ persona·nível·ângulo }] }.
    let briefs: any[] = Array.isArray(parsed?.briefs) ? parsed.briefs : [];
    const awareness: any[] = Array.isArray(parsed?.awareness) ? parsed.awareness : [];

    // O modelo às vezes gera mais briefs que o pedido (numCreatives já é
    // calibrado por orçamento ÷ custo). Corta o excedente e re-indexa/IDs.
    if (briefs.length > numCreatives) {
      log.warn(`[Claude marketing-plan] trimming briefs ${briefs.length} → ${numCreatives}`);
      briefs = briefs.slice(0, numCreatives);
    } else if (briefs.length > 0 && briefs.length < numCreatives) {
      log.warn(`[Claude marketing-plan] got fewer briefs (${briefs.length}) than ${numCreatives}`);
    }
    briefs = briefs.map((b: any, i: number) => ({
      ...b,
      index: i + 1,
      id: b?.id || `brief_${i + 1}`,
    }));

    res.json({ success: true, briefs, awareness, numCreatives, structure, cpaWarning });
  } catch (err: any) {
    log.error('[Claude marketing-plan] Exception:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/claude/find-statistics
// Busca estatísticas FACTUAIS com FONTE na web (web_search nativo) pra o
// cliente que não tem números próprios. NUNCA inventa: só devolve dados que
// vêm com uma fonte real (URL). O cliente revisa e escolhe quais usar — o
// front nunca auto-injeta. Princípio nunca-bloquear: o default é não inventar,
// e o número só entra na copy se o cliente aprovar.
//
// Request: { productInfo?: any, niche?: string, language?: string, count?: number }
// Response: { success: true, statistics: [{ stat, source, url, year }] }
claudeRouter.post('/find-statistics', async (req, res) => {
  const apiKey = getClaudeKey();
  if (!apiKey) {
    return res.status(500).json({ success: false, error: 'CLAUDE_API_KEY não configurada.' });
  }

  const {
    productInfo = null,
    niche = '',
    language = 'pt-BR',
    count = 6,
  } = req.body || {};
  const wantCount = Math.min(Math.max(Number(count) || 6, 3), 10);

  const SYSTEM = `You are a fact-checking research assistant finding REAL, SOURCED statistics a marketer can use in a health/supplement ad. You have web_search — USE IT to find current, verifiable figures.

HARD RULES (a violation makes the whole result useless):
- Every statistic MUST come with a real, specific source URL you actually found via search. If you cannot find a credible source for a figure, DO NOT include it. Never invent, estimate, round, or "improve" a number.
- Prefer authoritative sources (peer-reviewed studies, NIH/CDC/WHO/PubMed, major medical institutions, reputable health orgs). Avoid random blogs, the product's own marketing, or competitor sales pages.
- Disease/condition links must be framed as ASSOCIATION or RISK only — "linked to", "associated with a higher risk of" — never as a certainty that any individual has or will develop the condition.
- Keep each stat exact as the source states it. Include the publication/org name and the year if available.
- Do NOT name a specific company or drug brand. General categories are fine.

Return ONLY this JSON (no prose, no markdown):
{
  "statistics": [
    { "stat": "<the factual claim, phrased ready to drop into copy, in ${language}>", "source": "<publication/org name>", "url": "<the source URL>", "year": "<year or empty string>" }
  ]
}
Aim for up to ${wantCount} of the STRONGEST, most relevant, well-sourced statistics. Fewer well-sourced beats more weakly-sourced. If you genuinely find none, return { "statistics": [] }.`;

  const USER = `NICHE / TOPIC: ${niche || '(see product info)'}

${productInfo ? `PRODUCT INFO (use to understand the niche, the condition, and the audience — do NOT pull stats from here, find them on the web):\n${JSON.stringify(productInfo, null, 2)}` : '(no product info provided — use the niche/topic above)'}

Find verifiable, well-sourced statistics relevant to this niche that would make an ad more credible (prevalence, risk associations, demographics, costs, treatment outcomes). Search the web, then return the JSON.`;

  const messages: Array<{ role: string; content: any }> = [{ role: 'user', content: USER }];
  const buildBody = () =>
    JSON.stringify({
      model: STRUCTURED_MODEL,
      max_tokens: 6000,
      system: SYSTEM,
      messages,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
    });

  const MAX_ATTEMPTS = 5;
  const MAX_PAUSE_CONTINUES = 4;
  try {
    let data: any = null;
    for (let turn = 0; turn <= MAX_PAUSE_CONTINUES; turn++) {
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
          body: buildBody(),
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
          `[Claude find-statistics] ${resp.status} attempt ${attempt}/${MAX_ATTEMPTS}, retrying in ${delay}ms…`
        );
        await new Promise((r) => setTimeout(r, delay));
      }

      if (!resp || !resp.ok) {
        return res.status(503).json({
          success: false,
          error: 'Claude indisponível após múltiplas tentativas. Tente novamente em alguns minutos.',
        });
      }

      data = await resp.json();
      recordUsage(STRUCTURED_MODEL, data.usage);
      if (data?.stop_reason === 'pause_turn' && Array.isArray(data.content)) {
        log.warn(
          `[Claude find-statistics] pause_turn — continuando (${turn + 1}/${MAX_PAUSE_CONTINUES})`
        );
        messages.push({ role: 'assistant', content: data.content });
        continue;
      }
      break;
    }

    const textBlocks = Array.isArray(data.content)
      ? data.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text || '')
      : [];
    const joined = textBlocks.join('\n');
    const jsonMatch = joined.match(/\{[\s\S]*\}/);
    const responseText = jsonMatch ? jsonMatch[0] : textBlocks[textBlocks.length - 1] || '';
    const clean = responseText.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();

    let parsed: any;
    try {
      parsed = JSON.parse(clean);
    } catch {
      try {
        parsed = JSON.parse(escapeControlCharsInStrings(clean));
      } catch {
        log.error(
          `[Claude find-statistics] JSON.parse falhou. stop_reason=${data?.stop_reason} len=${responseText.length}`
        );
        return res.status(500).json({
          success: false,
          error: `Claude retornou resposta inválida (não-JSON). stop_reason: ${data?.stop_reason || 'unknown'}`,
          raw: responseText.substring(0, 500),
        });
      }
    }

    // Só devolve itens que vieram COM URL — a regra dura é "sem fonte, não
    // entra". Filtra defensivamente caso o modelo escape um item sem url.
    const statistics = (Array.isArray(parsed?.statistics) ? parsed.statistics : [])
      .filter((s: any) => s && typeof s.stat === 'string' && typeof s.url === 'string' && s.url.trim())
      .map((s: any) => ({
        stat: String(s.stat).trim(),
        source: String(s.source || '').trim(),
        url: String(s.url).trim(),
        year: String(s.year || '').trim(),
      }));

    res.json({ success: true, statistics });
  } catch (err: any) {
    log.error('[Claude find-statistics] Exception:', err);
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

  const {
    persona = {},
    copyAnswers = {},
    copy = '',
    productInfo = null,
    brief = null,
  } = req.body || {};

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

  // UX7: bloco opcional de brief — quando o subprojeto nasceu de um brief
  // do Plano de Marketing, passamos angle/emotion/style/painPoint
  // explicitamente. Antes esses dados ficavam diluídos em copyAnswers como
  // angleIdea/primaryEmotion/estiloAnuncio e o modelo as vezes ignorava.
  const briefBlock = brief
    ? `CREATIVE BRIEF (este subprojeto foi criado a partir deste brief específico do plano de marketing — voz/avatar devem REFLETIR este ângulo e emoção):
${JSON.stringify(brief, null, 2)}

`
    : '';

  const USER = `${productInfo ? `PRODUCT INFO:\n${JSON.stringify(productInfo, null, 2)}\n\n` : ''}${briefBlock}PERSONA:
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
  const PRIMARY_MODEL = STRUCTURED_MODEL;
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
    recordUsage(currentModel, data.usage);
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
