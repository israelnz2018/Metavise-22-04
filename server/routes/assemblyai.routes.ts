import { Router } from 'express';
import fs from 'fs';
import { logToFile } from '../utils/fileLogger.js';
import { formatApiError } from '../utils/errorExtractor.js';
import { getAssemblyAIKey } from '../config/apiKeys.js';
import { ASSEMBLYAI_CONFIG_PATH } from '../config/paths.js';
import { createLogger } from '../utils/logger.js';
const log = createLogger('AssemblyAI');

export const assemblyAIRouter = Router();

// POST /api/assemblyai/config
assemblyAIRouter.post('/config', async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'API Key is required.' });

  const trimmedKey = apiKey.trim().replace(/^["']|["']$/g, '');

  try {
    fs.writeFileSync(ASSEMBLYAI_CONFIG_PATH, JSON.stringify({ apiKey: trimmedKey }, null, 2));
    log.info('[AssemblyAI Config] API Key updated successfully.');
    res.json({ message: 'AssemblyAI API Key updated successfully.' });
  } catch (err: any) {
    log.error('[AssemblyAI Config] Error saving config:', err);
    res.status(500).json({ error: `Failed to save API Key: ${err.message}` });
  }
});

// POST /api/assemblyai/analyze
// Receives: { videoUrl: string }
// Returns: { transcriptId, words, sentiment, highlights, autoHighlights, ... }
assemblyAIRouter.post('/analyze', async (req, res) => {
  const { videoUrl } = req.body;
  const apiKey = getAssemblyAIKey();

  if (!apiKey) {
    return res.status(500).json({ error: 'ASSEMBLYAI_API_KEY não configurada.' });
  }

  if (!videoUrl) {
    return res.status(400).json({ error: 'videoUrl é obrigatório.' });
  }

  try {
    log.info('[AssemblyAI] Iniciando transcrição para:', videoUrl);

    const requestBody = {
      audio_url: videoUrl,
      speech_models: ['universal-3-pro', 'universal-2'],
      language_detection: true,
      auto_highlights: true,
    };

    logToFile(`[AssemblyAI] Enviando requisição: ${JSON.stringify(requestBody, null, 2)}`);
    log.info('[AssemblyAI] Request Body:', requestBody);

    const submitResponse = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: {
        authorization: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!submitResponse.ok) {
      const errorMsg = await formatApiError(submitResponse);
      logToFile(`[AssemblyAI] Erro na submissão: ${errorMsg}`);
      throw new Error(`AssemblyAI submit error: ${errorMsg}`);
    }

    const submitData = await submitResponse.json();
    const transcriptId = submitData.id;
    logToFile(`[AssemblyAI] Transcript ID gerado: ${transcriptId}`);
    log.info('[AssemblyAI] Transcript ID:', transcriptId);

    // 2. Poll until completion (5s interval, 10min ceiling)
    let transcript: any = null;
    let attempts = 0;
    const maxAttempts = 120;

    while (attempts < maxAttempts) {
      logToFile(`[AssemblyAI] Polling tentativa ${attempts + 1} status para ${transcriptId}...`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      attempts++;

      const statusResponse = await fetch(
        `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
        { headers: { authorization: apiKey } }
      );

      if (!statusResponse.ok) {
        logToFile(`[AssemblyAI] Polling server error status: ${statusResponse.status}`);
        continue;
      }

      const data = await statusResponse.json();
      logToFile(`[AssemblyAI] Status atual: ${data.status}`);
      log.info(`[AssemblyAI] Status (tentativa ${attempts}):`, data.status);

      if (data.status === 'completed') {
        transcript = data;
        break;
      } else if (data.status === 'error') {
        logToFile(`[AssemblyAI] Erro no processamento: ${data.error}`);
        throw new Error(`AssemblyAI error: ${data.error}`);
      }
    }

    if (!transcript) {
      logToFile('[AssemblyAI] Timeout - Processamento demorou demais');
      throw new Error('AssemblyAI timeout: transcrição demorou mais de 10 minutos.');
    }

    // Fetch sentences for higher-quality B-roll suggestions (natural phrases)
    logToFile(`[AssemblyAI] Buscando sentences para o transcript ${transcriptId}...`);
    const sentencesResponse = await fetch(
      `https://api.assemblyai.com/v2/transcript/${transcriptId}/sentences`,
      { headers: { authorization: apiKey } }
    );

    let sentences = [];
    if (sentencesResponse.ok) {
      const sentencesData = await sentencesResponse.json();
      sentences = sentencesData.sentences || [];
      logToFile(`[AssemblyAI] Sentences obtidas: ${sentences.length}`);
    } else {
      const errSent = await sentencesResponse.text();
      logToFile(
        `[AssemblyAI] Erro ao buscar sentences (Status: ${sentencesResponse.status}, Body: ${errSent})`
      );
    }

    logToFile(`[AssemblyAI] Iniciando mapeamento de dados. Words: ${transcript.words?.length}`);

    log.info('[AssemblyAI Debug] FULL TRANSCRIPT DATA:', JSON.stringify(transcript, null, 2));
    logToFile(`[AssemblyAI] Full Transcript Keys: ${Object.keys(transcript).join(', ')}`);

    // 3. Deterministic post-processing
    const words = transcript.words || [];

    log.info(
      '[AssemblyAI Debug] Highlights Source:',
      transcript.auto_highlights_result
        ? 'auto_highlights_result'
        : transcript.auto_highlights
          ? 'auto_highlights'
          : 'none'
    );

    // auto_highlights may return true (boolean) which breaks .length on the
    // frontend; guard with Array.isArray before iterating.
    let highlights: any[] = [];
    if (
      transcript.auto_highlights_result?.results &&
      Array.isArray(transcript.auto_highlights_result.results)
    ) {
      highlights = transcript.auto_highlights_result.results;
    } else if (Array.isArray(transcript.auto_highlights)) {
      highlights = transcript.auto_highlights;
    } else if (Array.isArray(transcript.chapters)) {
      highlights = transcript.chapters;
    }

    logToFile(`[AssemblyAI] Highlights encontrados: ${highlights.length}`);
    log.info(
      `[AssemblyAI] Análise completa: ${highlights.length} highlights, ${words.length} palavras, ${sentences.length} sentences`
    );

    res.json({
      transcriptId,
      text: transcript.text || '',
      words,
      sentences,
      duration: words.length > 0 ? Math.round((words[words.length - 1]?.end || 0) / 1000) : 0,
      highlights,
      language: transcript.language_code,
    });
  } catch (err: any) {
    logToFile(`[AssemblyAI Catch] ERRO: ${err.message}`);
    log.error('[AssemblyAI] Erro:', err);
    res.status(500).json({ error: `AssemblyAI falhou: ${err.message}` });
  }
});

// POST /api/assemblyai/analyze/submit
//
// F6.6 — non-blocking version of /analyze. Submits the video for transcription
// and returns the transcriptId IMMEDIATELY (~1-2s). The client then polls
// /analyze/status/:transcriptId until status='completed'.
//
// F6.8 — Optional `lightweight: true` flag for the Intercut/Cortes flow:
// uses a faster model, skips language detection (caller provides language),
// and disables auto_highlights. Result: ~40-50% faster transcription end-to-end.
// The default (no flag) preserves the heavy/feature-rich path used by Edit2Tab.
//
// Body:
//   videoUrl: string                — required
//   lightweight?: boolean           — true for fast path (Intercut)
//   languageCode?: string           — required if lightweight=true. ISO 639-1
//                                     codes: 'pt', 'en', 'es', etc.
assemblyAIRouter.post('/analyze/submit', async (req, res) => {
  const apiKey = getAssemblyAIKey();
  if (!apiKey) return res.status(500).json({ error: 'ASSEMBLYAI_API_KEY não configurada.' });
  const { videoUrl, lightweight, languageCode } = req.body || {};
  if (!videoUrl) return res.status(400).json({ error: 'videoUrl é obrigatório.' });

  // F6.8 — build request body based on mode.
  //
  // Heavy mode (default): universal-3-pro (best accuracy) + language detection
  //   (2 passes — detect, then transcribe) + auto_highlights (extra processing
  //   pass for B-roll picking). ~2-5min for a 5-min video.
  //
  // Lightweight mode: universal-2 (~20% faster than -3-pro, accuracy
  //   indistinguishable for karaoke captions) + explicit language_code
  //   (skips the detection pass) + no auto_highlights (we only need
  //   sentences/words for Intercut). Roughly ~1-2.5min for a 5-min video.
  const requestBody: any = lightweight
    ? {
        audio_url: videoUrl,
        speech_model: 'universal-2',
        language_code: languageCode || 'pt',
      }
    : {
        audio_url: videoUrl,
        speech_models: ['universal-3-pro', 'universal-2'],
        language_detection: true,
        auto_highlights: true,
      };

  try {
    log.info(
      '[AssemblyAI Submit] enviando:',
      videoUrl.substring(0, 80),
      lightweight ? '(lightweight)' : '(heavy)'
    );
    const submitResponse = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: { authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!submitResponse.ok) {
      const errorMsg = await formatApiError(submitResponse);
      return res.status(submitResponse.status).json({ error: `AssemblyAI submit: ${errorMsg}` });
    }

    const data = await submitResponse.json();
    logToFile(
      `[AssemblyAI Submit] OK transcriptId=${data.id} (${lightweight ? 'lightweight' : 'heavy'})`
    );
    return res.json({ transcriptId: data.id });
  } catch (err: any) {
    log.error('[AssemblyAI Submit] erro:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/assemblyai/analyze/status/:transcriptId
//
// F6.6 — Returns the current status of a transcription. Client polls this
// every 3s until status='completed' or 'error'. No server-side loop.
//
// Response: { status: 'queued'|'processing'|'completed'|'error', error?: string }
assemblyAIRouter.get('/analyze/status/:transcriptId', async (req, res) => {
  const apiKey = getAssemblyAIKey();
  if (!apiKey) return res.status(500).json({ error: 'ASSEMBLYAI_API_KEY não configurada.' });
  const { transcriptId } = req.params;

  try {
    const r = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
      headers: { authorization: apiKey },
    });
    if (!r.ok) {
      return res.status(r.status).json({ error: `AssemblyAI status fetch: ${r.status}` });
    }
    const data = await r.json();
    return res.json({ status: data.status, error: data.error || null });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/assemblyai/transcript/:transcriptId/sentences-with-words
//
// F6.2 (Blueprint Fase 6) — lightweight read of an EXISTING transcript.
// Returns the list of sentences PLUS the word-level timestamps belonging
// to each sentence, so the IntercutModal can present clickable cards
// with the spoken phrase and the karaoke-ready word breakdown.
//
// This reuses the transcript already created by the ZapCap edit flow —
// the client passes the transcriptId it received earlier; no new
// transcription is triggered (no extra cost).
//
// Response shape:
//   { sentences: [{
//       text: string,
//       startMs: number, endMs: number,
//       words: [{ text: string, startMs: number, endMs: number }]
//   }] }
assemblyAIRouter.get('/transcript/:transcriptId/sentences-with-words', async (req, res) => {
  const apiKey = getAssemblyAIKey();
  if (!apiKey) {
    return res.status(500).json({ error: 'ASSEMBLYAI_API_KEY não configurada.' });
  }
  const { transcriptId } = req.params;
  if (!transcriptId) {
    return res.status(400).json({ error: 'transcriptId é obrigatório.' });
  }

  try {
    logToFile(`[AssemblyAI Sentences] Buscando transcript ${transcriptId}...`);
    // Two parallel fetches: full transcript (for words[]) and sentences[]
    // (for sentence boundaries). AssemblyAI splits these into separate
    // endpoints so we batch them.
    const [transcriptRes, sentencesRes] = await Promise.all([
      fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
        headers: { authorization: apiKey },
      }),
      fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}/sentences`, {
        headers: { authorization: apiKey },
      }),
    ]);

    if (!transcriptRes.ok) {
      return res
        .status(transcriptRes.status)
        .json({ error: `AssemblyAI transcript fetch failed: ${transcriptRes.status}` });
    }
    if (!sentencesRes.ok) {
      return res
        .status(sentencesRes.status)
        .json({ error: `AssemblyAI sentences fetch failed: ${sentencesRes.status}` });
    }

    const transcriptData = await transcriptRes.json();
    const sentencesData = await sentencesRes.json();

    const allWords: Array<{ text: string; start: number; end: number }> =
      transcriptData.words || [];
    const sentences: Array<{ text: string; start: number; end: number }> =
      sentencesData.sentences || [];

    // For each sentence, slice the words that fall inside its time window.
    // AssemblyAI gives all timestamps in milliseconds.
    const enriched = sentences.map((s) => ({
      text: s.text,
      startMs: s.start,
      endMs: s.end,
      words: allWords
        .filter((w) => w.start >= s.start && w.end <= s.end)
        .map((w) => ({ text: w.text, startMs: w.start, endMs: w.end })),
    }));

    logToFile(
      `[AssemblyAI Sentences] OK ${transcriptId}: ${enriched.length} sentences, ${allWords.length} words`
    );

    return res.json({ sentences: enriched });
  } catch (err: any) {
    logToFile(`[AssemblyAI Sentences] FAIL: ${err.message}`);
    log.error('[AssemblyAI Sentences] erro:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/assemblyai/health
assemblyAIRouter.get('/health', async (_req, res) => {
  const apiKey = getAssemblyAIKey();
  if (!apiKey) {
    return res
      .status(500)
      .json({ status: 'error', message: 'ASSEMBLYAI_API_KEY não configurada.' });
  }

  try {
    const response = await fetch('https://api.assemblyai.com/v2/account', {
      headers: { Authorization: apiKey },
    });

    if (response.ok) {
      const data = await response.json();
      return res.json({
        status: 'ok',
        message: `Conectado! Créditos: $${data.current_period_credits_used || 0} usados.`,
      });
    } else {
      return res.status(response.status).json({ status: 'error', message: 'Chave inválida.' });
    }
  } catch (err: any) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});
