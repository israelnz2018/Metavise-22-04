import { Router } from 'express';
import fs from 'fs';
import { logToFile } from '../utils/fileLogger.js';
import { formatApiError } from '../utils/errorExtractor.js';
import { getAssemblyAIKey } from '../config/apiKeys.js';
import { ASSEMBLYAI_CONFIG_PATH } from '../config/paths.js';

export const assemblyAIRouter = Router();

// POST /api/assemblyai/config
assemblyAIRouter.post('/config', async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'API Key is required.' });

  const trimmedKey = apiKey.trim().replace(/^["']|["']$/g, '');

  try {
    fs.writeFileSync(ASSEMBLYAI_CONFIG_PATH, JSON.stringify({ apiKey: trimmedKey }, null, 2));
    console.log('[AssemblyAI Config] API Key updated successfully.');
    res.json({ message: 'AssemblyAI API Key updated successfully.' });
  } catch (err: any) {
    console.error('[AssemblyAI Config] Error saving config:', err);
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
    console.log('[AssemblyAI] Iniciando transcrição para:', videoUrl);

    const requestBody = {
      audio_url: videoUrl,
      speech_models: ['universal-3-pro', 'universal-2'],
      language_detection: true,
      auto_highlights: true,
    };

    logToFile(`[AssemblyAI] Enviando requisição: ${JSON.stringify(requestBody, null, 2)}`);
    console.log('[AssemblyAI] Request Body:', requestBody);

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
    console.log('[AssemblyAI] Transcript ID:', transcriptId);

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
      console.log(`[AssemblyAI] Status (tentativa ${attempts}):`, data.status);

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

    console.log('[AssemblyAI Debug] FULL TRANSCRIPT DATA:', JSON.stringify(transcript, null, 2));
    logToFile(`[AssemblyAI] Full Transcript Keys: ${Object.keys(transcript).join(', ')}`);

    // 3. Deterministic post-processing
    const words = transcript.words || [];

    console.log(
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

    // [B-ROLL DEBUG] Sentence analysis for B-roll candidate selection
    console.log('[B-ROLL DEBUG] Total de highlights:', highlights.length);
    console.log('[B-ROLL DEBUG] Total de sentences:', sentences.length);
    logToFile('[B-ROLL DEBUG] Análise de Sentences para Seleção de B-Roll:');

    sentences.forEach((s: any, i: number) => {
      const duration = (s.end - s.start) / 1000;
      if (duration >= 2 && duration <= 8) {
        const relevantHighlights = highlights.filter((h: any) => {
          const hText = h.text || h.gist || h.headline || '';
          return s.text && hText && s.text.toLowerCase().includes(hText.toLowerCase());
        });
        const maxRank =
          relevantHighlights.length > 0
            ? Math.max(...relevantHighlights.map((h: any) => h.rank || 0))
            : 0;

        logToFile(
          `[CANDIDATO B-ROLL] i=${i} dur=${duration.toFixed(2)}s rank=${maxRank.toFixed(3)} text="${s.text}"`
        );
      }
    });

    logToFile(
      `[AssemblyAI] Highlights Data (Sample): ${JSON.stringify(highlights).substring(0, 300)}`
    );

    console.log(
      `[AssemblyAI] Análise completa: ${highlights.length} highlights, ${words.length} palavras`
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
    console.error('[AssemblyAI] Erro:', err);
    res.status(500).json({ error: `AssemblyAI falhou: ${err.message}` });
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
