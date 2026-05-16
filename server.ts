import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import dotenv from 'dotenv';
import fs from 'fs';

import { HEYGEN_CONFIG_PATH, GENERATED_DIR, ensureGeneratedDir } from './server/config/paths.js';
import { initFirebase } from './server/config/firebase.js';
import { setupFfmpeg } from './server/config/ffmpeg.js';
import { formatApiError } from './server/utils/errorExtractor.js';
import { logToFile } from './server/utils/fileLogger.js';
import { getHeyGenKey } from './server/config/apiKeys.js';
import { requestLogger } from './server/middleware/requestLogger.js';
import { cors } from './server/middleware/cors.js';
import { errorHandler } from './server/middleware/errorHandler.js';
import { apiNotFound } from './server/middleware/notFound.js';
import { hasCredits, deductCredits } from './server/services/creditsService.js';
import { userRouter } from './server/routes/user.routes.js';
import { healthRouter } from './server/routes/health.routes.js';
import { staticRouter } from './server/routes/static.routes.js';
import { adminRouter } from './server/routes/admin.routes.js';
import { assemblyAIRouter } from './server/routes/assemblyai.routes.js';
import { runwayRouter } from './server/routes/runway.routes.js';
import { elevenLabsRouter, elevenLabsPremiumRouter } from './server/routes/elevenlabs.routes.js';
import { videoRouter } from './server/routes/video.routes.js';

dotenv.config();
setupFfmpeg();
ensureGeneratedDir();
initFirebase();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  app.use(requestLogger);
  app.use(cors);

  // Mounted routers
  app.use('/api/user', userRouter);
  app.use('/generated', staticRouter);
  app.use('/api/assemblyai', assemblyAIRouter);
  app.use('/api/runway', runwayRouter);
  app.use('/api/elevenlabs', elevenLabsRouter);
  app.use('/api/elevenlabs-premium', elevenLabsPremiumRouter);
  app.use('/api/video', videoRouter);

  // --- HeyGen Integration ---

  // API route to get HeyGen avatars
  app.get('/api/heygen/avatars', async (req, res) => {
    const apiKey = getHeyGenKey();
    if (!apiKey) {
      return res.status(500).json({ error: 'HeyGen API Key is missing.' });
    }

    try {
      console.log('[HeyGen Proxy] Fetching avatars...');
      const response = await fetch('https://api.heygen.com/v2/avatars', {
        method: 'GET',
        headers: {
          'X-Api-Key': apiKey,
        },
      });

      if (!response.ok) {
        const errorMsg = await formatApiError(response);
        return res.status(response.status).json({ error: errorMsg });
      }

      const data = await response.json();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Health check for HeyGen
  app.get('/api/heygen/health', async (req, res) => {
    const apiKey = getHeyGenKey();
    if (!apiKey) {
      return res.status(500).json({ status: 'error', message: 'HEYGEN_API_KEY is missing.' });
    }

    try {
      const response = await fetch('https://api.heygen.com/v2/user/remaining_quota', {
        method: 'GET',
        headers: {
          'X-Api-Key': apiKey,
        },
      });

      if (response.ok) {
        const data = await response.json();
        return res.json({
          status: 'ok',
          message: 'HeyGen connection successful.',
          quota: data.data?.remaining_quota || 0,
        });
      } else {
        const errorMsg = await formatApiError(response);
        return res.status(response.status).json({ status: 'error', message: errorMsg });
      }
    } catch (err: any) {
      return res.status(500).json({ status: 'error', message: err.message });
    }
  });

  // API route to update HeyGen API Key
  app.post('/api/heygen/config', async (req, res) => {
    const { apiKey } = req.body;
    if (!apiKey) return res.status(400).json({ error: 'API Key is required.' });

    const trimmedKey = apiKey.trim().replace(/^["']|["']$/g, '');

    try {
      fs.writeFileSync(HEYGEN_CONFIG_PATH, JSON.stringify({ apiKey: trimmedKey }, null, 2));
      res.json({ message: 'HeyGen API Key updated successfully.' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // API route to generate video (Avatar + Voice)
  app.post('/api/heygen/generate', async (req, res) => {
    const { avatarId, voiceId, script, title, audioUrl, scale } = req.body;
    const heygenKey = getHeyGenKey();

    if (!heygenKey) return res.status(500).json({ error: 'HeyGen API Key missing.' });

    // Validation
    if (!avatarId) return res.status(400).json({ error: 'Avatar ID is required.' });
    if (!audioUrl && (!voiceId || !script))
      return res.status(400).json({ error: 'Voice ID and Script OR Audio URL are required.' });

    // Credit check
    const videoCost = 100; // Fixed cost for video generation
    if (!hasCredits(videoCost)) {
      return res.status(403).json({ error: 'Créditos insuficientes para gerar vídeo.' });
    }

    try {
      // In Cloud Run, x-forwarded-proto is usually 'https'. Default to https if we're not local.
      const forwardedHost = req.headers['x-forwarded-host'];
      const host =
        (typeof forwardedHost === 'string' ? forwardedHost.split(',')[0].trim() : null) ||
        req.get('host') ||
        '';
      const protocol =
        req.headers['x-forwarded-proto'] || (host.includes('localhost') ? 'http' : 'https');

      // Ensure we have a valid public URL for HeyGen to fetch
      let fullAudioUrl = null;
      if (audioUrl) {
        if (audioUrl.startsWith('/generated/')) {
          fullAudioUrl = `${protocol}://${host}${audioUrl}`;

          // Verify file exists locally
          const localPath = path.join(GENERATED_DIR, audioUrl.replace('/generated/', ''));
          if (!fs.existsSync(localPath)) {
            console.error(`[HeyGen Proxy] CRITICAL: Audio file not found locally at ${localPath}`);
          } else {
            const stats = fs.statSync(localPath);
            console.log(`[HeyGen Proxy] Audio file verified: ${localPath} (${stats.size} bytes)`);
            console.log(`[HeyGen Proxy] Public Audio URL: ${fullAudioUrl}`);
          }
        } else if (audioUrl.startsWith('http')) {
          fullAudioUrl = audioUrl;
        } else {
          console.warn('[HeyGen Proxy] Invalid audioUrl format (possibly a Blob URL):', audioUrl);
        }
      }

      // Determine Generation Mode
      // Mode A: Native Voice (Text-to-Speech via HeyGen)
      // Mode B: External Audio (Audio-to-Video via ElevenLabs asset)
      const useNativeFallback = req.body.useNativeFallback === true;
      const mode = fullAudioUrl && !useNativeFallback ? 'EXTERNAL_AUDIO' : 'NATIVE_VOICE';

      console.log(`[HeyGen Proxy] Mode: ${mode}, Audio URL: ${fullAudioUrl || 'N/A'}`);

      // Fallback HeyGen Voice ID (Brenda - Portuguese) if no audio is provided
      const DEFAULT_HEYGEN_VOICE = '990e6677947141569a4734898e82a611';

      const isLikelyElevenLabs = voiceId && voiceId.length > 15 && !voiceId.includes('-');
      const finalVoiceId = isLikelyElevenLabs || !voiceId ? DEFAULT_HEYGEN_VOICE : voiceId;

      const sanitizedScript = script
        ? script.substring(0, 4000).replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // eslint-disable-line no-control-regex
        : '';

      const isTalkingPhoto =
        avatarId && (avatarId.startsWith('talking_photo_') || avatarId.includes('talking_photo'));

      // Dynamic dimensions based on config
      const requestedAspectRatio = req.body.aspectRatio || '9:16';
      console.log(`[HeyGen Proxy] Requested Aspect Ratio: ${requestedAspectRatio}`);

      let dimension = { width: 1080, height: 1920 }; // Default 9:16
      if (requestedAspectRatio === '1:1') {
        dimension = { width: 1080, height: 1080 };
      } else if (requestedAspectRatio === '16:9') {
        dimension = { width: 1920, height: 1080 };
      } else if (requestedAspectRatio === '4:5') {
        dimension = { width: 1080, height: 1350 };
      }

      console.log(`[HeyGen Proxy] Calculated Dimension:`, dimension);

      // Construct Voice Object based on Mode
      let voiceConfig: any = {};
      if (mode === 'EXTERNAL_AUDIO') {
        voiceConfig = {
          type: 'audio',
          audio_url: fullAudioUrl,
        };
      } else {
        voiceConfig = {
          type: 'text',
          input_text: sanitizedScript,
          voice_id: finalVoiceId,
        };
      }

      let characterConfig: any = {};
      if (isTalkingPhoto) {
        characterConfig = {
          type: 'talking_photo',
          talking_photo_id: avatarId,
        };
      } else {
        characterConfig = {
          type: 'avatar',
          avatar_id: avatarId,
          avatar_style: 'normal',
        };

        // Use the scale provided by the user, or default based on aspect ratio
        if (scale) {
          characterConfig.scale = Number(scale);
        } else if (requestedAspectRatio === '1:1') {
          characterConfig.scale = 1.2; // Default 20% zoom for square
        } else if (requestedAspectRatio === '4:5') {
          characterConfig.scale = 1.15; // 15% zoom for 4:5
        } else if (requestedAspectRatio === '9:16') {
          characterConfig.scale = 1.0;
        }
      }

      const payload: any = {
        video_inputs: [
          {
            character: characterConfig,
            voice: voiceConfig,
            background: {
              type: 'color',
              value: '#000000',
            },
          },
        ],
        // For standard formats, aspect_ratio is often more reliable in V2
        aspect_ratio:
          requestedAspectRatio === '1:1'
            ? '1:1'
            : requestedAspectRatio === '16:9'
              ? '16:9'
              : requestedAspectRatio === '4:5'
                ? '4:5'
                : '9:16',
        // Keep dimension as fallback/precision
        dimension: dimension,
      };

      // Optional fields that are safe
      if (title) {
        payload.title = title.substring(0, 50).replace(/[^\w\s-]/g, '');
      }

      // CRITICAL: Log the exact outgoing payload for debugging
      console.log(`[HeyGen Proxy] Outgoing Payload (${mode}):`, JSON.stringify(payload, null, 2));

      const response = await fetch('https://api.heygen.com/v2/video/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': heygenKey,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorBody: any = {};
        try {
          errorBody = JSON.parse(errorText);
        } catch (e) {
          errorBody = { message: errorText };
        }

        console.error(
          `[HeyGen Proxy] API Error Response (Mode: ${mode}, Status: ${response.status}):`,
          errorText
        );

        // Provide more helpful error messages for common failures
        let userMessage = 'Erro ao iniciar geração do vídeo.';
        const apiMsg = errorBody.error?.message || errorBody.message || '';

        if (apiMsg.includes('Voice validation failed')) {
          userMessage = 'Falha na validação da voz. Tente usar uma voz nativa do HeyGen.';
        } else if (apiMsg.includes('word time metadata')) {
          userMessage = 'Erro de metadados de legenda. Tente gerar sem legendas primeiro.';
        } else if (apiMsg.includes('avatar') && apiMsg.includes('not found')) {
          userMessage = 'Avatar não encontrado ou não suportado para este modo.';
        } else if (response.status === 401) {
          userMessage = 'Chave de API do HeyGen inválida ou expirada.';
        } else if (
          response.status === 402 ||
          apiMsg.toLowerCase().includes('quota') ||
          apiMsg.toLowerCase().includes('balance') ||
          apiMsg.toLowerCase().includes('insufficient')
        ) {
          userMessage =
            'HeyGen quota/balance exceeded. Please top up or wait before generating again.';
        }

        return res.status(response.status).json({
          error: userMessage,
          details: errorBody,
        });
      }

      const data = await response.json();

      // Deduct credits
      const remaining = deductCredits(videoCost);

      res.json({
        videoId: data.data?.video_id,
        remainingCredits: remaining,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // API route to check video status
  app.get('/api/heygen/status/:videoId', async (req, res) => {
    const { videoId } = req.params;
    const apiKey = getHeyGenKey();

    if (!apiKey) {
      return res.status(500).json({ error: 'HeyGen API Key missing.' });
    }

    try {
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[HeyGen Proxy] Checking status for video ID: ${videoId}`);
      }

      // Try v2 first
      let response = await fetch(`https://api.heygen.com/v2/video/${videoId}`, {
        method: 'GET',
        headers: { 'X-Api-Key': apiKey },
      });

      // If v2 fails with 404, try v1
      if (response.status === 404) {
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[HeyGen Proxy] v2 status 404 for ${videoId}, trying v1 fallback...`);
        }
        response = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${videoId}`, {
          method: 'GET',
          headers: { 'X-Api-Key': apiKey },
        });
      }

      if (!response.ok) {
        const errorMsg = await formatApiError(response);
        console.error(`[HeyGen Proxy] Status Error (${response.status}) for ${videoId}:`, errorMsg);
        return res.status(response.status).json({ error: errorMsg });
      }

      const data = await response.json();
      const status = data.data?.status || data.status;

      // If the status is 'failed', log the error details
      if (status === 'failed') {
        const errorDetail =
          data.data?.error || data.error || data.data?.error_message || data.error_message || data;
        console.error(
          `[HeyGen Proxy] Job failed for ${videoId}:`,
          typeof errorDetail === 'object' ? JSON.stringify(errorDetail, null, 2) : errorDetail
        );
        // We still return the data so the frontend can handle it, but we've logged the detail
      }

      if (process.env.NODE_ENV !== 'production') {
        console.log(`[HeyGen Proxy] Status result for ${videoId}:`, status);
      }

      res.json(data.data || data);
    } catch (err: any) {
      console.error(`[HeyGen Proxy] Status Exception for ${videoId}:`, err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // --- HeyGen Premium (Avatar III / IV / V) ---
  const premiumStatusCache = new Map<string, any>();
  const premiumSSE = new Map<string, Set<any>>();

  app.get('/api/heygen-premium/avatars', async (_req, res) => {
    const apiKey = getHeyGenKey();
    if (!apiKey) return res.status(500).json({ error: 'HeyGen API Key ausente.' });
    try {
      const r = await fetch('https://api.heygen.com/v2/avatars', {
        headers: { 'X-Api-Key': apiKey },
      });
      if (!r.ok) {
        const text = await r.text();
        return res
          .status(500)
          .json({ error: `HeyGen API Error: ${r.status} ${text.substring(0, 500)}` });
      }
      const json = await r.json();
      res.json(json);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/heygen-premium/upload-asset', async (req, res) => {
    const apiKey = getHeyGenKey();
    if (!apiKey) return res.status(500).json({ error: 'HeyGen API Key ausente.' });
    const { fileBase64, contentType } = req.body || {};
    if (!fileBase64) return res.status(400).json({ error: 'fileBase64 é obrigatório.' });
    try {
      const buffer = Buffer.from(fileBase64, 'base64');
      const r = await fetch('https://upload.heygen.com/v1/asset', {
        method: 'POST',
        headers: { 'X-Api-Key': apiKey, 'Content-Type': contentType || 'application/octet-stream' },
        body: buffer,
      });
      if (!r.ok) {
        const text = await r.text();
        return res
          .status(500)
          .json({ error: `HeyGen API Error: ${r.status} ${text.substring(0, 500)}` });
      }
      const json = await r.json();
      res.json({ assetId: json.data?.id, url: json.data?.url });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/heygen-premium/generate', async (req, res) => {
    const apiKey = getHeyGenKey();
    if (!apiKey) return res.status(500).json({ error: 'HeyGen API Key ausente.' });
    const {
      engine,
      aspectRatio = '9:16',
      voiceId,
      audioUrl,
      script,
      background,
      title,
      avatarId,
      imageAssetId,
      referenceVideoAssetId,
    } = req.body || {};
    if (!script && !audioUrl)
      return res.status(400).json({ error: 'script ou audioUrl é obrigatório.' });

    const dims: Record<string, { width: number; height: number }> = {
      '9:16': { width: 1080, height: 1920 },
      '1:1': { width: 1080, height: 1080 },
      '16:9': { width: 1920, height: 1080 },
      '4:5': { width: 1080, height: 1350 },
    };
    const dimension = dims[aspectRatio] || dims['9:16'];
    const DEFAULT_VOICE = '990e6677947141569a4734898e82a611';
    const voiceConfig = audioUrl
      ? { type: 'audio', audio_url: audioUrl }
      : {
          type: 'text',
          input_text: (script || '').substring(0, 4000),
          voice_id: voiceId || DEFAULT_VOICE,
        };
    const bgConfig =
      background?.type === 'color'
        ? { type: 'color', value: background.value || '#000000' }
        : background?.assetId
          ? {
              type: background.type,
              [`${background.type}_asset_id`]: background.assetId,
              ...(background.type === 'video'
                ? { play_style: background.playStyle || 'loop' }
                : {}),
            }
          : { type: 'color', value: '#000000' };

    const protocol =
      req.headers['x-forwarded-proto'] ||
      (req.get('host')?.includes('localhost') ? 'http' : 'https');
    const callbackUrl = `${protocol}://${req.get('host')}/api/heygen-premium/webhook`;

    try {
      let endpoint = 'https://api.heygen.com/v2/video/generate';
      let payload: any;

      if (engine === 'avatar4') {
        endpoint = 'https://api.heygen.com/v2/video/av4/generate';
        payload = {
          image_key: imageAssetId,
          script: (script || '').substring(0, 4000),
          voice_id: voiceId || DEFAULT_VOICE,
          callback_url: callbackUrl,
          dimension,
        };
      } else if (engine === 'avatar5') {
        payload = {
          video_inputs: [
            {
              character: { type: 'video_reference', video_asset_id: referenceVideoAssetId },
              voice: voiceConfig,
              background: bgConfig,
            },
          ],
          use_avatar_v_model: true,
          aspect_ratio: aspectRatio,
          dimension,
          callback_url: callbackUrl,
        };
      } else {
        const isTalkingPhoto = avatarId?.startsWith('talking_photo_');
        payload = {
          video_inputs: [
            {
              character: isTalkingPhoto
                ? { type: 'talking_photo', talking_photo_id: avatarId, use_avatar_iv_model: true }
                : { type: 'avatar', avatar_id: avatarId, avatar_style: 'normal' },
              voice: voiceConfig,
              background: bgConfig,
            },
          ],
          use_avatar_iv_model: true,
          aspect_ratio: aspectRatio,
          dimension,
          callback_url: callbackUrl,
        };
      }
      if (title) payload.title = title.substring(0, 50);

      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const txt = await r.text();
        return res.status(r.status).json({ error: txt });
      }
      const json = await r.json();
      const videoId = json.data?.video_id;
      if (!videoId) return res.status(500).json({ error: 'Resposta sem video_id.', raw: json });
      const words = (script || '').trim().split(/\s+/).filter(Boolean).length;
      const minutes = audioUrl ? 1 : Math.max(words / 150, 0.25);
      const costMap: Record<string, number> = { avatar3: 1, avatar4: 4, avatar5: 5 };
      res.json({
        videoId,
        engine,
        estimatedCostUsd: Number((minutes * (costMap[engine] || 1)).toFixed(2)),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/heygen-premium/webhook', (req, res) => {
    const event = req.body;
    const videoId = event?.event_data?.video_id || event?.video_id;
    const status =
      event?.event_type === 'avatar_video.success'
        ? 'completed'
        : event?.event_type === 'avatar_video.fail'
          ? 'failed'
          : 'processing';
    const videoUrl = event?.event_data?.url;
    const errorMessage = event?.event_data?.message;
    if (videoId) {
      const payload = { videoId, status, videoUrl, errorMessage };
      premiumStatusCache.set(videoId, payload);
      premiumSSE.get(videoId)?.forEach((r) => r.write(`data: ${JSON.stringify(payload)}\n\n`));
    }
    res.json({ received: true });
  });

  app.get('/api/heygen-premium/status/:videoId', async (req, res) => {
    const apiKey = getHeyGenKey();
    if (!apiKey) return res.status(500).json({ error: 'HeyGen API Key ausente.' });
    const { videoId } = req.params;
    if (premiumStatusCache.has(videoId)) return res.json(premiumStatusCache.get(videoId));
    try {
      const r = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${videoId}`, {
        headers: { 'X-Api-Key': apiKey },
      });
      if (!r.ok) {
        const text = await r.text();
        return res
          .status(500)
          .json({ error: `HeyGen API Error: ${r.status} ${text.substring(0, 500)}` });
      }
      const json = await r.json();
      const s = json.data?.status;
      const mapped =
        s === 'completed'
          ? 'completed'
          : s === 'failed'
            ? 'failed'
            : s === 'processing'
              ? 'processing'
              : 'pending';
      const payload = {
        videoId,
        status: mapped,
        videoUrl: json.data?.video_url,
        errorMessage: json.data?.error?.message,
      };
      premiumStatusCache.set(videoId, payload);
      res.json(payload);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/heygen-premium/status-stream/:videoId', (req, res) => {
    const { videoId } = req.params;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    if (premiumStatusCache.has(videoId))
      res.write(`data: ${JSON.stringify(premiumStatusCache.get(videoId))}\n\n`);
    if (!premiumSSE.has(videoId)) premiumSSE.set(videoId, new Set());
    premiumSSE.get(videoId)!.add(res);
    const hb = setInterval(() => res.write(': ping\n\n'), 30000);
    req.on('close', () => {
      clearInterval(hb);
      premiumSSE.get(videoId)?.delete(res);
    });
  });
  app.use('/api', healthRouter);

  // GET /api/zapcap/templates
  // Retorna lista de templates disponíveis com ID e preview
  app.get('/api/zapcap/templates', async (req, res) => {
    const apiKey = process.env.ZAPCAP_API_KEY?.trim();

    if (!apiKey) {
      return res.status(500).json({ error: 'ZAPCAP_API_KEY não configurada.' });
    }

    try {
      const maskedKey = apiKey
        ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`
        : 'missing';
      logToFile(`[ZapCap] Carregando templates. Key: ${maskedKey}`);

      const response = await fetch('https://api.zapcap.ai/templates', {
        method: 'GET',
        headers: {
          'x-api-key': apiKey || '',
        },
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
  // Recebe: { videoUrl, templateId, renderOptions, brollMoments, language }
  // Retorna: { videoId, taskId }
  app.post('/api/zapcap/edit', async (req, res) => {
    logToFile(`[ZapCap Edit] Recebido. Body keys: ${Object.keys(req.body).join(', ')}`);
    const { videoUrl, transcriptId, selectedBrollIds, brollCandidates, config } = req.body;
    logToFile(
      `[ZapCap Edit] transcriptId: ${transcriptId}, videoUrl: ${videoUrl?.substring(0, 80)}`
    );

    const apiKey = process.env.ZAPCAP_API_KEY?.trim();
    const assemblyKey = process.env.ASSEMBLYAI_API_KEY?.trim();

    if (!apiKey) {
      return res.status(500).json({ error: 'ZAPCAP_API_KEY não configurada.' });
    }
    if (!assemblyKey) {
      return res.status(500).json({ error: 'ASSEMBLYAI_API_KEY não configurada.' });
    }

    if (!videoUrl || !config?.templateId || !transcriptId) {
      logToFile(`[ZapCap Edit] Erro: Faltando parâmetros obrigatórios`);
      return res
        .status(400)
        .json({ error: 'videoUrl, templateId e transcriptId são obrigatórios.' });
    }

    const templateId = config.templateId;

    try {
      console.log('[ZapCap] Iniciando edição para:', videoUrl);

      // 1. Buscar transcript completo do AssemblyAI (já foi processado antes)
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
      const sentencesData = await sentencesRes.json();

      const words = transcriptData.words || [];
      const highlights = transcriptData.auto_highlights_result?.results || [];
      // const sentences = sentencesData.sentences || []; // Not used directly but good to have
      const duration = words.length > 0 ? words[words.length - 1].end / 1000 : 0;
      const language = transcriptData.language_code === 'en' ? 'en' : 'pt';

      // Calcular brollMoments a partir dos IDs selecionados
      const brollMoments = (brollCandidates || []).filter((c: any) =>
        (selectedBrollIds || []).includes(c.id)
      );

      // 2. Baixar vídeo do Firebase Storage e fazer upload direto ao ZapCap (multipart)
      // Isso elimina TODOS os problemas de URL pública, IAM e proxies
      logToFile(
        `[ZapCap Edit] Iniciando task. Template: ${templateId}, Brolls: ${brollMoments.length}`
      );
      logToFile(`[ZapCap Edit] Baixando vídeo do storage...`);

      let videoBuffer: Buffer;
      let videoFilename = 'video.mp4';

      if (videoUrl.includes('firebasestorage.googleapis.com')) {
        // Baixar via HTTP direto da URL pública do Firebase (não requer IAM)
        // A URL do Firebase já tem token=... que a torna acessível
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
        // URL externa normal (ex: YouTube ou outra URL pública)
        const downloadRes = await fetch(videoUrl);
        if (!downloadRes.ok) throw new Error(`Falha ao baixar vídeo: ${downloadRes.status}`);
        const arrayBuffer = await downloadRes.arrayBuffer();
        videoBuffer = Buffer.from(arrayBuffer);
        videoFilename = videoUrl.split('/').pop()?.split('?')[0] || 'video.mp4';
        logToFile(`[ZapCap Edit] Download da URL externa OK: ${videoBuffer.length} bytes`);
      }

      // Upload multipart ao ZapCap (para arquivos grandes)
      const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB por parte
      const numParts = Math.ceil(videoBuffer.length / CHUNK_SIZE);
      const uploadParts = [];
      for (let i = 0; i < numParts; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, videoBuffer.length);
        uploadParts.push({ contentLength: end - start });
      }

      // Etapa 1: Inicializar upload
      logToFile(`[ZapCap Edit] Iniciando multipart upload (${numParts} partes)...`);
      const initRes = await fetch('https://api.zapcap.ai/videos/upload', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadParts, filename: videoFilename }),
      });
      if (!initRes.ok) {
        const errorMsg = await formatApiError(initRes);
        throw new Error(`ZapCap multipart init error: ${errorMsg}`);
      }
      const initData = await initRes.json();
      logToFile(`[ZapCap Edit] Multipart Init Response: ${JSON.stringify(initData)}`);
      const { uploadId, videoId } = initData;
      // Suporte para resposta com 'parts' ou 'urls'
      const parts = initData.parts || initData.urls?.map((url: string) => ({ presignedUrl: url }));

      logToFile(
        `[ZapCap Edit] Multipart iniciado. videoId: ${videoId}, partes: ${parts?.length || 0}`
      );

      // Etapa 2: Upload de cada parte via presigned URL
      if (!parts || !Array.isArray(parts) || parts.length === 0) {
        throw new Error(
          `ZapCap multipart init falhou: 'parts' ou 'urls' não retornado ou vazio. Response: ${JSON.stringify(initData)}`
        );
      }

      const completedParts = [];
      for (let i = 0; i < parts.length; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, videoBuffer.length);
        const chunk = videoBuffer.slice(start, end);
        logToFile(
          `[ZapCap Edit] Enviando parte ${i + 1}/${parts.length} (${chunk.length} bytes)...`
        );
        const partRes = await fetch(parts[i].presignedUrl, {
          method: 'PUT',
          headers: { 'Content-Length': String(chunk.length) },
          body: chunk,
        });
        if (!partRes.ok) throw new Error(`Erro ao enviar parte ${i + 1}: ${partRes.status}`);

        const etag = partRes.headers.get('ETag')?.replace(/["']/g, ''); // Remover aspas se houver
        logToFile(`[ZapCap Edit] Parte ${i + 1} enviada OK. ETag: ${etag}`);
        completedParts.push({ partNumber: i + 1, etag });
      }

      // Etapa 3: Finalizar upload
      logToFile(`[ZapCap Edit] Finalizando multipart upload...`);
      const completeRes = await fetch('https://api.zapcap.ai/videos/upload/complete', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId, videoId, parts: completedParts }),
      });
      if (!completeRes.ok) {
        const errorMsg = await formatApiError(completeRes);
        throw new Error(`ZapCap multipart complete error: ${errorMsg}`);
      }
      logToFile(`[ZapCap Edit] Multipart upload completo! videoId: ${videoId}`);

      console.log('[ZapCap] Video ID:', videoId);
      logToFile(`[ZapCap Edit] Video ID recebido: ${videoId}`);

      // 3. Processamento inteligente: Filtrar highlights e marcar palavras importantes (BYOT)
      // Rank relativo: top 30% de maior rank do próprio vídeo
      const sortedByRank = [...highlights].sort((a: any, b: any) => b.rank - a.rank);
      const topCount = Math.max(1, Math.ceil(sortedByRank.length * 0.3));
      const filteredHighlights = sortedByRank.slice(0, topCount);

      const zapCapTranscript = words.map((w: any) => {
        // Uma palavra é "important" se estiver contida em um highlight
        const isImportant = filteredHighlights.some((h: any) =>
          h.timestamps?.some((t: any) => w.start >= t.start && w.end <= t.end)
        );

        // ZapCap espera segundos (float)
        return {
          text: w.text,
          type: 'word',
          start_time: Math.round((w.start / 1000) * 100) / 100,
          end_time: Math.round((w.end / 1000) * 100) / 100,
          important: isImportant,
        };
      });

      // Usar EXATAMENTE o brollPercent enviado pelo usuário via slider
      const brollPercent = Math.max(20, Math.min(70, config.brollPercent ?? 30));
      const videoDuration = duration || 60;
      const adjustedBrollPercent =
        videoDuration < 90
          ? Math.max(20, brollPercent - 10) // reduz 10% em vídeos curtos para preservar início
          : brollPercent;

      logToFile(
        `[BROLL CALC] brollPercent ajustado: ${adjustedBrollPercent}% (original: ${brollPercent}%)`
      );

      let importantWordsCount = zapCapTranscript.filter((w: any) => w.important).length;

      // Fallback: se nenhuma palavra foi marcada, usar brollMoments para marcar
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

      // 4. Montar o payload simplificado conforme documentação oficial (Fluxo Inteligente)
      const taskPayload: any = {
        templateId,
        autoApprove: true,
        language: language,
        transcript: zapCapTranscript, // ENVIANDO O TRANSCRIPT QUE CALCULAMOS (BYOT)
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

      // 5. Criar a task
      const taskResponse = await fetch(`https://api.zapcap.ai/videos/${videoId}/task`, {
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
  // Endpoint simplificado: SEM AssemblyAI, SEM BYOT, deixa ZapCap fazer tudo
  // Recebe: { videoUrl, templateId, brollPercent, language, emoji, animation, emphasizeKeywords, displayWords, silenceRemoval }
  app.post('/api/zapcap/edit-simple', async (req, res) => {
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
      // Novos parâmetros de personalização da legenda
      subtitleTop,
      fontUppercase,
      fontSize,
      highlightColorOne,
      highlightColorTwo,
      highlightColorThree,
    } = req.body;

    const apiKey = process.env.ZAPCAP_API_KEY?.trim();

    if (!apiKey) {
      logToFile(`[ZapCap Simple] Erro: ZAPCAP_API_KEY não configurada`);
      return res.status(500).json({ error: 'ZAPCAP_API_KEY não configurada.' });
    }

    if (!videoUrl || !templateId) {
      logToFile(`[ZapCap Simple] Erro: Faltando parâmetros obrigatórios`);
      return res.status(400).json({ error: 'videoUrl e templateId são obrigatórios.' });
    }

    try {
      logToFile(
        `[ZapCap Simple] Iniciando. Template: ${templateId}, brollPercent: ${brollPercent}`
      );
      console.log('[ZapCap Simple] Iniciando edição para:', videoUrl);

      // 1. Baixar vídeo do Firebase Storage
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

      // 2. Upload pro ZapCap via multipart (corrigido para arquivos grandes)
      logToFile(`[ZapCap Simple] Upload pro ZapCap via multipart...`);
      const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB por parte
      const numParts = Math.ceil(videoBuffer.length / CHUNK_SIZE);
      const uploadParts = [];
      for (let i = 0; i < numParts; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, videoBuffer.length);
        uploadParts.push({ contentLength: end - start });
      }

      const videoFilename = videoUrl.split('/').pop()?.split('?')[0] || 'video.mp4';
      const initRes = await fetch('https://api.zapcap.ai/videos/upload', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadParts, filename: videoFilename }),
      });
      if (!initRes.ok)
        throw new Error(`ZapCap multipart init error: ${await formatApiError(initRes)}`);

      const initData = await initRes.json();
      const { uploadId, videoId } = initData;
      const parts = initData.parts || initData.urls?.map((url: string) => ({ presignedUrl: url }));

      if (!parts || !parts.length) throw new Error('ZapCap multipart init falhou: parts vazias');

      const completedParts = [];
      for (let i = 0; i < parts.length; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, videoBuffer.length);
        const chunk = videoBuffer.slice(start, end);
        const partRes = await fetch(parts[i].presignedUrl, {
          method: 'PUT',
          headers: { 'Content-Length': String(chunk.length) },
          body: chunk,
        });
        if (!partRes.ok) throw new Error(`Erro ao enviar parte ${i + 1}: ${partRes.status}`);
        const etag = partRes.headers.get('ETag')?.replace(/["']/g, '');
        completedParts.push({ partNumber: i + 1, etag });
      }

      const completeRes = await fetch('https://api.zapcap.ai/videos/upload/complete', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId, videoId, parts: completedParts }),
      });
      if (!completeRes.ok)
        throw new Error(`ZapCap multipart complete error: ${await formatApiError(completeRes)}`);

      logToFile(`[ZapCap Simple] Upload OK. Video ID: ${videoId}`);

      // 3. Montar payload SIMPLES (sem BYOT, deixa ZapCap fazer tudo)
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

      // Monta styleOptions de forma dinâmica
      const styleOptions: any = {
        fontSize: fontSize && fontSize >= 20 && fontSize <= 100 ? fontSize : 46,
        fontWeight: 800,
        fontShadow: 'm',
        stroke: 's',
        strokeColor: '#000000',
      };
      if (typeof subtitleTop === 'number' && subtitleTop >= 0 && subtitleTop <= 100) {
        styleOptions.top = subtitleTop;
      }
      if (typeof fontUppercase === 'boolean') {
        styleOptions.fontUppercase = fontUppercase;
      }

      // Monta highlightOptions se cores foram fornecidas
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

      // Adicionar autoCutSettings se silenceRemoval foi pedido
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

      // 4. Criar a task
      const taskResponse = await fetch(`https://api.zapcap.ai/videos/${videoId}/task`, {
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

      res.json({ videoId, taskId });
    } catch (err: any) {
      console.error('[ZapCap Simple] Erro:', err);
      logToFile(`[ZapCap Simple] CATCH ERROR: ${err.message}`);
      if (err.stack) logToFile(`[ZapCap Simple] STACK: ${err.stack}`);
      res.status(500).json({ error: `ZapCap Simple falhou: ${err.message}` });
    }
  });

  // Cache local para evitar uploads redundantes de vídeos já processados pelo ZapCap
  const processedZapCapTasks = new Set<string>();

  // GET /api/zapcap/status/:videoId/:taskId
  // Retorna: { status, downloadUrl }
  app.get('/api/zapcap/status/:videoId/:taskId', async (req, res) => {
    const { videoId, taskId } = req.params;
    const userId = (req.query.userId as string) || 'anonymous';
    const apiKey = process.env.ZAPCAP_API_KEY?.trim();

    if (!apiKey) {
      return res.status(500).json({ error: 'ZAPCAP_API_KEY não configurada.' });
    }

    try {
      const response = await fetch(`https://api.zapcap.ai/videos/${videoId}/task/${taskId}`, {
        headers: {
          'x-api-key': apiKey || '',
        },
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

      // Só processar "completed" se ainda não tivermos processado esta taskId
      if (data.status === 'completed' && data.downloadUrl && !processedZapCapTasks.has(taskId)) {
        // Marcamos como processado no log
        processedZapCapTasks.add(taskId);
        return res.json({
          status: 'completed',
          downloadUrl: data.downloadUrl,
          originalUrl: data.downloadUrl,
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

  // POST /api/zapcap/status/:videoId/:taskId
  // (existing code...)

  // API Proxy para imagens do ZapCap (contornar CORS)
  app.get('/api/proxy-image', async (req, res) => {
    const imageUrl = req.query.url as string;
    const apiKey = process.env.ZAPCAP_API_KEY?.trim();

    if (!imageUrl) return res.status(400).send('URL is required');

    try {
      console.log(`[Proxy Image] Fetching: ${imageUrl}`);
      // Tentando adicionar um User-Agent para evitar bloqueios de CDN
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

  app.use('/api/admin', adminRouter);

  // GET /api/zapcap/health
  app.get('/api/zapcap/health', async (req, res) => {
    const apiKey = process.env.ZAPCAP_API_KEY?.trim();
    if (!apiKey) {
      return res.status(500).json({ status: 'error', message: 'ZAPCAP_API_KEY não configurada.' });
    }

    try {
      console.log(`[ZapCap Health Check] Pinging api.zapcap.ai/templates...`);
      const response = await fetch('https://api.zapcap.ai/templates', {
        method: 'GET',
        headers: {
          'x-api-key': apiKey || '',
        },
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

  app.all('/api/*', apiNotFound);
  app.use(errorHandler);

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      // Only serve index.html for non-API routes
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: `API route ${req.method} ${req.path} not found.` });
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
