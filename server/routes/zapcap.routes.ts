import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import admin from 'firebase-admin';
import { formatApiError, processDataError } from '../utils/errorExtractor.js';
import { logToFile } from '../utils/fileLogger.js';
import { getZapCapKey, getAssemblyAIKey } from '../config/apiKeys.js';
import { ZAPCAP_CONFIG_PATH, GENERATED_DIR } from '../config/paths.js';

// Mirrors a finished ZapCap video into our Firebase Storage so the URL
// the SPA persists is permanent. ZapCap's CDN URLs are signed and expire
// within hours, which is what makes saved versions go grey on reload.
// Returns the public Firebase URL on success, or null on failure (caller
// then falls back to the raw ZapCap URL).
async function uploadZapCapToFirebase(sourceUrl: string, taskId: string): Promise<string | null> {
  if (admin.apps.length === 0) {
    console.warn('[ZapCap Persist] Firebase Admin not initialised — skipping upload');
    return null;
  }
  try {
    const dl = await fetch(sourceUrl);
    if (!dl.ok) throw new Error(`Download from ZapCap failed: ${dl.status}`);
    const buf = Buffer.from(await dl.arrayBuffer());

    const bucket = admin.storage().bucket();
    const objectPath = `zapcap/${taskId}_${Date.now()}.mp4`;
    const file = bucket.file(objectPath);
    await file.save(buf, { metadata: { contentType: 'video/mp4' } });
    await file.makePublic();
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${objectPath}`;
    logToFile(`[ZapCap Persist] Uploaded to ${publicUrl} (${buf.length} bytes)`);
    return publicUrl;
  } catch (err: any) {
    console.error('[ZapCap Persist] upload failed:', err.message);
    logToFile(`[ZapCap Persist] FAILED: ${err.message}`);
    return null;
  }
}

const ZAPCAP_BASE = 'https://api.zapcap.ai';
const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB

// taskId → desired aspect (from /edit-simple). Used by /status to crop the
// ZapCap output back to the source aspect (ZapCap always renders at the
// template's canvas, so 1:1 / 16:9 / 4:5 sources come back letterboxed).
const taskToSourceAspect = new Map<string, string>();

const ASPECT_RATIOS: Record<string, number> = {
  '1:1': 1,
  '4:5': 4 / 5,
  '9:16': 9 / 16,
  '16:9': 16 / 9,
};

function probeVideoDimensions(filePath: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      const stream = metadata.streams.find((s) => s.codec_type === 'video');
      resolve({ width: stream?.width || 0, height: stream?.height || 0 });
    });
  });
}

// Centered crop to a target aspect ratio. Removes black bars added by
// ZapCap's letterboxing when the source aspect differs from the template's.
async function cropVideoToAspect(
  inputPath: string,
  outputPath: string,
  targetAspect: string
): Promise<{ cropped: boolean }> {
  const targetRatio = ASPECT_RATIOS[targetAspect];
  if (!targetRatio) {
    fs.copyFileSync(inputPath, outputPath);
    return { cropped: false };
  }

  const { width, height } = await probeVideoDimensions(inputPath);
  const currentRatio = width / height;

  // Already correct (within 1%) — skip ffmpeg.
  if (Math.abs(currentRatio - targetRatio) / targetRatio < 0.01) {
    fs.copyFileSync(inputPath, outputPath);
    return { cropped: false };
  }

  let cropW: number;
  let cropH: number;
  if (currentRatio > targetRatio) {
    // Too wide → crop sides.
    cropH = height;
    cropW = Math.round(height * targetRatio);
  } else {
    // Too tall → crop top/bottom (the 1:1-inside-9:16 case).
    cropW = width;
    cropH = Math.round(width / targetRatio);
  }
  // x264 requires even dimensions.
  if (cropW % 2 !== 0) cropW -= 1;
  if (cropH % 2 !== 0) cropH -= 1;

  const xOffset = Math.round((width - cropW) / 2);
  const yOffset = Math.round((height - cropH) / 2);

  console.log(
    `[ZapCap Crop] ${width}x${height} (${currentRatio.toFixed(3)}) → ${cropW}x${cropH} (${targetAspect}) offset=${xOffset},${yOffset}`
  );

  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .videoFilters(`crop=${cropW}:${cropH}:${xOffset}:${yOffset}`)
      .outputOptions(['-c:v libx264', '-preset fast', '-crf 23', '-c:a copy'])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });

  return { cropped: true };
}

// Shared helper for /edit and /edit-simple: chunked multipart upload to ZapCap.
// Returns the videoId assigned by ZapCap once the upload is complete.
async function uploadVideoMultipart(
  buffer: Buffer,
  filename: string,
  apiKey: string,
  logPrefix: string
): Promise<string> {
  const numParts = Math.ceil(buffer.length / CHUNK_SIZE);
  const uploadParts: { contentLength: number }[] = [];
  for (let i = 0; i < numParts; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, buffer.length);
    uploadParts.push({ contentLength: end - start });
  }

  logToFile(`${logPrefix} Iniciando multipart upload (${numParts} partes)...`);
  const initRes = await fetch(`${ZAPCAP_BASE}/videos/upload`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadParts, filename }),
  });
  if (!initRes.ok) {
    throw new Error(`ZapCap multipart init error: ${await formatApiError(initRes)}`);
  }
  const initData = await initRes.json();
  const { uploadId, videoId } = initData;
  const parts = initData.parts || initData.urls?.map((url: string) => ({ presignedUrl: url }));

  if (!parts || !Array.isArray(parts) || parts.length === 0) {
    throw new Error(
      `ZapCap multipart init falhou: 'parts' ou 'urls' vazio. Response: ${JSON.stringify(initData)}`
    );
  }

  const completedParts: { partNumber: number; etag: string | undefined }[] = [];
  for (let i = 0; i < parts.length; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, buffer.length);
    const chunk = buffer.slice(start, end);
    logToFile(`${logPrefix} Enviando parte ${i + 1}/${parts.length} (${chunk.length} bytes)...`);
    const partRes = await fetch(parts[i].presignedUrl, {
      method: 'PUT',
      headers: { 'Content-Length': String(chunk.length) },
      body: chunk,
    });
    if (!partRes.ok) throw new Error(`Erro ao enviar parte ${i + 1}: ${partRes.status}`);
    const etag = partRes.headers.get('ETag')?.replace(/["']/g, '');
    completedParts.push({ partNumber: i + 1, etag });
  }

  const completeRes = await fetch(`${ZAPCAP_BASE}/videos/upload/complete`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId, videoId, parts: completedParts }),
  });
  if (!completeRes.ok) {
    throw new Error(`ZapCap multipart complete error: ${await formatApiError(completeRes)}`);
  }
  logToFile(`${logPrefix} Multipart upload completo! videoId: ${videoId}`);
  return videoId;
}

export const zapCapRouter = Router();

// POST /api/zapcap/config
zapCapRouter.post('/config', async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'API Key is required.' });

  const trimmedKey = apiKey.trim().replace(/^["']|["']$/g, '');

  try {
    fs.writeFileSync(ZAPCAP_CONFIG_PATH, JSON.stringify({ apiKey: trimmedKey }, null, 2));
    console.log('[ZapCap Config] API Key updated successfully.');
    res.json({ message: 'ZapCap API Key updated successfully.' });
  } catch (err: any) {
    console.error('[ZapCap Config] Error saving config:', err);
    res.status(500).json({ error: `Failed to save API Key: ${err.message}` });
  }
});

// GET /api/zapcap/templates
zapCapRouter.get('/templates', async (_req, res) => {
  const apiKey = getZapCapKey();

  if (!apiKey) {
    return res.status(500).json({ error: 'ZAPCAP_API_KEY não configurada.' });
  }

  try {
    const maskedKey = `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`;
    logToFile(`[ZapCap] Carregando templates. Key: ${maskedKey}`);

    const response = await fetch(`${ZAPCAP_BASE}/templates`, {
      method: 'GET',
      headers: { 'x-api-key': apiKey },
    });

    logToFile(`[ZapCap] Status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorMsg = await formatApiError(response);
      logToFile(`[ZapCap] templates error: ${errorMsg}`);
      throw new Error(`ZapCap templates error: ${errorMsg}`);
    }

    const data = await response.json();
    const templatesFound = Array.isArray(data) ? data.length : data.templates?.length || 0;
    logToFile(`[ZapCap] Sucesso: ${templatesFound} templates encontrados.`);
    if (templatesFound > 0) {
      const sample = Array.isArray(data) ? data[0] : data.templates[0];
      logToFile(`[ZapCap] Exemplo de template: ${JSON.stringify(sample)}`);
    }
    console.log(`[ZapCap Debug] Success: Found ${templatesFound} templates.`);
    res.json(data);
  } catch (err: any) {
    logToFile(`[ZapCap Catch] ERRO: ${err.message}`);
    console.error('[ZapCap] Erro ao buscar templates:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/zapcap/edit
// BYOT flow: pulls AssemblyAI transcript, marks the top 30% of highlights
// as "important" words, then submits a ZapCap task with the pre-computed
// transcript.
zapCapRouter.post('/edit', async (req, res) => {
  logToFile(`[ZapCap Edit] Recebido. Body keys: ${Object.keys(req.body).join(', ')}`);
  const { videoUrl, transcriptId, selectedBrollIds, brollCandidates, config } = req.body;
  logToFile(`[ZapCap Edit] transcriptId: ${transcriptId}, videoUrl: ${videoUrl?.substring(0, 80)}`);

  const apiKey = getZapCapKey();
  const assemblyKey = getAssemblyAIKey();

  if (!apiKey) {
    return res.status(500).json({ error: 'ZAPCAP_API_KEY não configurada.' });
  }
  if (!assemblyKey) {
    return res.status(500).json({ error: 'ASSEMBLYAI_API_KEY não configurada.' });
  }

  if (!videoUrl || !config?.templateId || !transcriptId) {
    logToFile(`[ZapCap Edit] Erro: Faltando parâmetros obrigatórios`);
    return res.status(400).json({ error: 'videoUrl, templateId e transcriptId são obrigatórios.' });
  }

  const templateId = config.templateId;

  try {
    console.log('[ZapCap] Iniciando edição para:', videoUrl);

    // 1. Re-fetch the AssemblyAI transcript (already processed in an earlier step).
    logToFile(`[ZapCap Edit] Buscando dados do AssemblyAI para ${transcriptId}...`);
    const [transcriptRes, sentencesRes] = await Promise.all([
      fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
        headers: { authorization: assemblyKey },
      }),
      fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}/sentences`, {
        headers: { authorization: assemblyKey },
      }),
    ]);

    if (!transcriptRes.ok || !sentencesRes.ok) {
      throw new Error(
        `Erro ao buscar dados do AssemblyAI: ${transcriptRes.status} / ${sentencesRes.status}`
      );
    }

    const transcriptData = await transcriptRes.json();
    await sentencesRes.json(); // currently unused but draining keeps the connection clean

    const words = transcriptData.words || [];
    const highlights = transcriptData.auto_highlights_result?.results || [];
    const duration = words.length > 0 ? words[words.length - 1].end / 1000 : 0;
    const language = transcriptData.language_code === 'en' ? 'en' : 'pt';

    const brollMoments = (brollCandidates || []).filter((c: any) =>
      (selectedBrollIds || []).includes(c.id)
    );

    // 2. Download the source video and stream it to ZapCap via multipart upload.
    // We download via plain HTTP because Firebase public URLs already carry an
    // access token; no IAM dance required.
    logToFile(
      `[ZapCap Edit] Iniciando task. Template: ${templateId}, Brolls: ${brollMoments.length}`
    );
    logToFile(`[ZapCap Edit] Baixando vídeo do storage...`);

    let videoBuffer: Buffer;
    let videoFilename = 'video.mp4';

    if (videoUrl.includes('firebasestorage.googleapis.com')) {
      videoFilename = videoUrl.split('/').pop()?.split('?')[0] || 'video.mp4';
      logToFile(`[ZapCap Edit] Baixando vídeo via HTTP do Firebase URL...`);
      const downloadRes = await fetch(videoUrl);
      if (!downloadRes.ok) {
        throw new Error(
          `Falha ao baixar vídeo do Firebase: ${downloadRes.status} ${downloadRes.statusText}`
        );
      }
      const arrayBuffer = await downloadRes.arrayBuffer();
      videoBuffer = Buffer.from(arrayBuffer);
      logToFile(`[ZapCap Edit] Download do Firebase via HTTP OK: ${videoBuffer.length} bytes`);
    } else {
      const downloadRes = await fetch(videoUrl);
      if (!downloadRes.ok) throw new Error(`Falha ao baixar vídeo: ${downloadRes.status}`);
      const arrayBuffer = await downloadRes.arrayBuffer();
      videoBuffer = Buffer.from(arrayBuffer);
      videoFilename = videoUrl.split('/').pop()?.split('?')[0] || 'video.mp4';
      logToFile(`[ZapCap Edit] Download da URL externa OK: ${videoBuffer.length} bytes`);
    }

    const videoId = await uploadVideoMultipart(videoBuffer, videoFilename, apiKey, '[ZapCap Edit]');

    console.log('[ZapCap] Video ID:', videoId);
    logToFile(`[ZapCap Edit] Video ID recebido: ${videoId}`);

    // 3. Pick the top 30% of highlights by rank, then mark every word that
    // falls inside one of those highlights as "important" for ZapCap's
    // emphasis system.
    const sortedByRank = [...highlights].sort((a: any, b: any) => b.rank - a.rank);
    const topCount = Math.max(1, Math.ceil(sortedByRank.length * 0.3));
    const filteredHighlights = sortedByRank.slice(0, topCount);

    const zapCapTranscript = words.map((w: any) => {
      const isImportant = filteredHighlights.some((h: any) =>
        h.timestamps?.some((t: any) => w.start >= t.start && w.end <= t.end)
      );

      // ZapCap expects start/end in seconds (float).
      return {
        text: w.text,
        type: 'word',
        start_time: Math.round((w.start / 1000) * 100) / 100,
        end_time: Math.round((w.end / 1000) * 100) / 100,
        important: isImportant,
      };
    });

    const brollPercent = Math.max(20, Math.min(70, config.brollPercent ?? 30));
    const videoDuration = duration || 60;
    const adjustedBrollPercent =
      videoDuration < 90
        ? Math.max(20, brollPercent - 10) // shave 10% on short videos to preserve the intro
        : brollPercent;

    logToFile(
      `[BROLL CALC] brollPercent ajustado: ${adjustedBrollPercent}% (original: ${brollPercent}%)`
    );

    let importantWordsCount = zapCapTranscript.filter((w: any) => w.important).length;

    // Fallback: if no words were marked, use brollMoments to flag words.
    if (importantWordsCount === 0 && brollMoments.length > 0) {
      logToFile(`[ZapCap Edit] Fallback: marcando palavras dos brollMoments como importantes`);
      brollMoments.forEach((moment: any) => {
        const startMs = moment.start;
        const endMs = moment.end;
        zapCapTranscript.forEach((w: any) => {
          const wStartMs = w.start_time * 1000;
          const wEndMs = w.end_time * 1000;
          if (wStartMs >= startMs && wEndMs <= endMs) {
            w.important = true;
          }
        });
      });
      importantWordsCount = zapCapTranscript.filter((w: any) => w.important).length;
      logToFile(`[ZapCap Edit] Fallback aplicado: ${importantWordsCount} palavras marcadas`);
    }

    logToFile(`[ZAPCAP PAYLOAD] brollPercent enviado: ${adjustedBrollPercent}`);
    logToFile(
      `[ZapCap Edit] BYOT: ${zapCapTranscript.length} palavras, ${filteredHighlights.length} highlights filtrados. Palavras importantes: ${importantWordsCount}. Broll: ${adjustedBrollPercent}%`
    );

    // 4. Build the official "Intelligent Flow" payload (BYOT branch).
    const taskPayload: any = {
      templateId,
      autoApprove: true,
      language: language,
      transcript: zapCapTranscript,
      renderOptions: {
        subsOptions: {
          emoji: config.emoji ?? false,
          emojiAnimation: config.emoji ?? false,
          animation: config.animation ?? true,
        },
        styleOptions: {
          fontSize: 46,
          fontWeight: 800,
          fontShadow: 'm',
          stroke: 's',
          strokeColor: '#000000',
        },
      },
      transcribeSettings: {
        broll: {
          brollPercent: adjustedBrollPercent,
        },
      },
    };

    logToFile(
      `[TASK PAYLOAD] ${JSON.stringify({
        templateId,
        brollPercent,
        transcribeSettings: taskPayload.transcribeSettings,
        transcriptLength: zapCapTranscript.length,
        importantWords: zapCapTranscript.filter((w: any) => w.important).length,
      })}`
    );

    // 5. Create the task.
    const taskResponse = await fetch(`${ZAPCAP_BASE}/videos/${videoId}/task`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(taskPayload),
    });

    logToFile(`[ZapCap Edit] Task status: ${taskResponse.status} ${taskResponse.statusText}`);

    if (!taskResponse.ok) {
      const errorMsg = await formatApiError(taskResponse);
      logToFile(`[ZapCap Edit] Task error: ${errorMsg}`);
      throw new Error(`ZapCap task error: ${errorMsg}`);
    }

    const { taskId } = await taskResponse.json();
    console.log('[ZapCap] Task ID:', taskId);

    res.json({ videoId, taskId });
  } catch (err: any) {
    console.error('[ZapCap] Erro:', err);
    logToFile(`[ZapCap Edit] CATCH ERROR: ${err.message}`);
    if (err.stack) logToFile(`[ZapCap Edit] STACK: ${err.stack}`);
    res.status(500).json({ error: `ZapCap falhou: ${err.message}` });
  }
});

// POST /api/zapcap/edit-simple
// Skips AssemblyAI and BYOT — lets ZapCap do its own transcription + broll.
zapCapRouter.post('/edit-simple', async (req, res) => {
  logToFile(`[ZapCap Simple] Recebido. Body keys: ${Object.keys(req.body).join(', ')}`);

  const {
    videoUrl,
    templateId,
    brollPercent = 30,
    language = 'en',
    emoji = false,
    animation = true,
    emphasizeKeywords = true,
    displayWords,
    silenceRemoval,
    subtitleTop,
    subtitleWidth,
    fontUppercase,
    fontSize,
    highlightColorOne,
    highlightColorTwo,
    highlightColorThree,
    // Source aspect ratio kept for the optional post-process crop below.
    // Currently disabled per user preference — black bars stay.
    sourceAspectRatio: _sourceAspectRatio,
  } = req.body;

  const apiKey = getZapCapKey();

  if (!apiKey) {
    logToFile(`[ZapCap Simple] Erro: ZAPCAP_API_KEY não configurada`);
    return res.status(500).json({ error: 'ZAPCAP_API_KEY não configurada.' });
  }

  if (!videoUrl || !templateId) {
    logToFile(`[ZapCap Simple] Erro: Faltando parâmetros obrigatórios`);
    return res.status(400).json({ error: 'videoUrl e templateId são obrigatórios.' });
  }

  try {
    logToFile(`[ZapCap Simple] Iniciando. Template: ${templateId}, brollPercent: ${brollPercent}`);
    console.log('[ZapCap Simple] Iniciando edição para:', videoUrl);

    logToFile(`[ZapCap Simple] Baixando vídeo do storage...`);
    let videoBuffer: Buffer;
    try {
      const downloadRes = await fetch(videoUrl);
      if (!downloadRes.ok) {
        throw new Error(`Falha ao baixar vídeo: ${downloadRes.status} ${downloadRes.statusText}`);
      }
      const arrayBuffer = await downloadRes.arrayBuffer();
      videoBuffer = Buffer.from(arrayBuffer);
      logToFile(`[ZapCap Simple] Download OK: ${videoBuffer.length} bytes`);
    } catch (dErr: any) {
      logToFile(`[ZapCap Simple] Erro download: ${dErr.message}`);
      throw new Error(`Erro ao baixar vídeo: ${dErr.message}`);
    }

    const videoFilename = videoUrl.split('/').pop()?.split('?')[0] || 'video.mp4';
    const videoId = await uploadVideoMultipart(
      videoBuffer,
      videoFilename,
      apiKey,
      '[ZapCap Simple]'
    );

    logToFile(`[ZapCap Simple] Upload OK. Video ID: ${videoId}`);

    const adjustedBrollPercent = Math.max(0, Math.min(100, brollPercent));

    const subsOptions: any = {
      emoji: emoji ?? false,
      emojiAnimation: emoji ?? false,
      animation: animation ?? true,
      emphasizeKeywords: emphasizeKeywords ?? true,
    };
    if (displayWords && displayWords >= 1 && displayWords <= 8) {
      subsOptions.displayWords = displayWords;
    }

    const styleOptions: any = {
      fontSize: fontSize && fontSize >= 6 && fontSize <= 80 ? fontSize : 24,
      fontWeight: 800,
      fontShadow: 'm',
      stroke: 's',
      strokeColor: '#000000',
    };
    if (typeof subtitleTop === 'number' && subtitleTop >= 0 && subtitleTop <= 80) {
      // ZapCap caps `top` at 80 (returns 400 above that).
      styleOptions.top = subtitleTop;
    }
    // Subtitle horizontal width / left-right margin: ZapCap's API has NO
    // field for this (confirmed at platform.zapcap.ai/docs/guides/captions-
    // configuration). The visible width is controlled entirely by the
    // chosen template + the fontSize. Smaller fontSize = narrower text
    // block. We still accept subtitleWidth from the body for API
    // compatibility but ignore it server-side.
    void subtitleWidth;
    if (typeof fontUppercase === 'boolean') {
      styleOptions.fontUppercase = fontUppercase;
    }

    const renderOptions: any = {
      subsOptions,
      styleOptions,
    };
    if (highlightColorOne || highlightColorTwo || highlightColorThree) {
      renderOptions.highlightOptions = {
        randomColourOne: highlightColorOne || '#FFD700',
        randomColourTwo: highlightColorTwo || '#FFFFFF',
        randomColourThree: highlightColorThree || '#00FF7F',
      };
    }

    const taskPayload: any = {
      templateId,
      autoApprove: true,
      language: language,
      renderOptions,
      transcribeSettings: {
        broll: {
          brollPercent: adjustedBrollPercent,
        },
      },
    };

    // NB: ZapCap rejects all known aspect-ratio fields with 400 (tested
    // aspectRatio, outputAspectRatio, renderOptions.aspectRatio). The
    // output is always the template canvas, so for 1:1 / 16:9 / 4:5 sources
    // we instead crop the black bars off after download — see the
    // taskToSourceAspect map + /status post-process.

    if (silenceRemoval && silenceRemoval > 0 && silenceRemoval <= 1) {
      taskPayload.autoCutSettings = {
        silenceRemoval: silenceRemoval,
      };
    }

    logToFile(
      `[ZapCap Simple TASK PAYLOAD] ${JSON.stringify({
        templateId,
        brollPercent: adjustedBrollPercent,
        emphasizeKeywords,
        silenceRemoval: silenceRemoval || 'off',
        subtitleTop: subtitleTop ?? 'default',
        fontUppercase: fontUppercase ?? 'default',
        fontSize: fontSize ?? 'default',
        highlightColors: highlightColorOne ? 'custom' : 'default',
      })}`
    );

    const taskResponse = await fetch(`${ZAPCAP_BASE}/videos/${videoId}/task`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(taskPayload),
    });

    logToFile(`[ZapCap Simple] Task status: ${taskResponse.status} ${taskResponse.statusText}`);

    if (!taskResponse.ok) {
      const errorMsg = await formatApiError(taskResponse);
      logToFile(`[ZapCap Simple] Task error: ${errorMsg}`);
      throw new Error(`ZapCap task error: ${errorMsg}`);
    }

    const { taskId } = await taskResponse.json();
    console.log('[ZapCap Simple] Task ID:', taskId);
    logToFile(`[ZapCap Simple] Task criada com sucesso. taskId: ${taskId}`);

    // Crop post-process is intentionally NOT triggered (user prefers to
    // keep the black bars and just position the subtitle better). The
    // helper + map stay in the file so this can be re-enabled later.

    res.json({ videoId, taskId });
  } catch (err: any) {
    console.error('[ZapCap Simple] Erro:', err);
    logToFile(`[ZapCap Simple] CATCH ERROR: ${err.message}`);
    if (err.stack) logToFile(`[ZapCap Simple] STACK: ${err.stack}`);
    res.status(500).json({ error: `ZapCap Simple falhou: ${err.message}` });
  }
});

// Tracks tasks we've already returned a "completed" response for, so the SPA's
// repeated polling doesn't re-trigger downstream side effects. In-memory only.
const processedZapCapTasks = new Set<string>();

// GET /api/zapcap/status/:videoId/:taskId
zapCapRouter.get('/status/:videoId/:taskId', async (req, res) => {
  const { videoId, taskId } = req.params;
  const apiKey = getZapCapKey();

  if (!apiKey) {
    return res.status(500).json({ error: 'ZAPCAP_API_KEY não configurada.' });
  }

  try {
    const response = await fetch(`${ZAPCAP_BASE}/videos/${videoId}/task/${taskId}`, {
      headers: { 'x-api-key': apiKey },
    });

    if (!response.ok) {
      const errorMsg = await formatApiError(response);
      throw new Error(`ZapCap status error: ${errorMsg}`);
    }

    const data = await response.json();
    logToFile(`[ZapCap Poll] Status: ${data.status} | videoId: ${videoId} | taskId: ${taskId}`);
    if (data.status === 'failed' || data.status === 'error') {
      logToFile(`[ZapCap Poll] FAILED! Details: ${JSON.stringify(data)}`);
    }
    console.log(`[ZapCap] Status para ${taskId}:`, data.status);

    if (data.status === 'completed' && data.downloadUrl && !processedZapCapTasks.has(taskId)) {
      processedZapCapTasks.add(taskId);

      // Mirror the finished video into our Firebase Storage so the URL we
      // hand back to the SPA is permanent. ZapCap's CDN signs its
      // downloadUrls with a TTL — once they expire (within hours) any
      // saved version goes grey/403 on reload. Firebase URLs don't expire.
      // Falls back to the raw ZapCap URL if the upload fails for any
      // reason (no Firebase config, network hiccup, quota, etc.).
      const permanentUrl = await uploadZapCapToFirebase(data.downloadUrl, taskId);

      return res.json({
        status: 'completed',
        downloadUrl: permanentUrl || data.downloadUrl,
        originalUrl: data.downloadUrl,
        persisted: !!permanentUrl,
      });
    }

    res.json({
      status: data.status,
      downloadUrl: data.downloadUrl || null,
      error: data.error || null,
    });
  } catch (err: any) {
    const errorDetail = processDataError(err);
    console.error(`[ZapCap] Status check error: ${errorDetail}`);
    res.status(500).json({ error: errorDetail });
  }
});

// GET /api/zapcap/health
zapCapRouter.get('/health', async (_req, res) => {
  const apiKey = getZapCapKey();
  if (!apiKey) {
    return res.status(500).json({ status: 'error', message: 'ZAPCAP_API_KEY não configurada.' });
  }

  try {
    console.log(`[ZapCap Health Check] Pinging ${ZAPCAP_BASE}/templates...`);
    const response = await fetch(`${ZAPCAP_BASE}/templates`, {
      method: 'GET',
      headers: { 'x-api-key': apiKey },
    });

    console.log(`[ZapCap Health Check] Status: ${response.status}`);

    if (response.ok) {
      const data = await response.json();
      const templates = Array.isArray(data) ? data : data.templates || [];
      return res.json({
        status: 'ok',
        message: `Conectado! ${templates.length} templates disponíveis.`,
      });
    } else {
      const err = await response.text();
      console.error(`[ZapCap Health Check] Error: ${err}`);
      return res.status(response.status).json({ status: 'error', message: err });
    }
  } catch (err: any) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// --- Image proxy (used by ZapCap to bypass CDN CORS on template previews) ---
export const proxyImageRouter = Router();

proxyImageRouter.get('/proxy-image', async (req, res) => {
  const imageUrl = req.query.url as string;

  if (!imageUrl) return res.status(400).send('URL is required');

  try {
    console.log(`[Proxy Image] Fetching: ${imageUrl}`);
    // Add a UA header to dodge naive CDN bot-blocks.
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
    });

    if (!response.ok) {
      console.error(
        `[Proxy Image] Failed to fetch image: ${response.status} ${response.statusText} for URL: ${imageUrl}`
      );
      logToFile(`[Proxy Image] Error: ${response.status} fetching ${imageUrl}`);
      return res.status(response.status).send(`Failed to fetch image: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/jpeg';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(buffer));
  } catch (err: any) {
    console.error('[Proxy Image] Exception:', err.message);
    res.status(500).send('Proxy internal error');
  }
});
