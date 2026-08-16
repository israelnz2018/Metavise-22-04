import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { getHeyGenKey } from '../config/apiKeys.js';
import { GENERATED_DIR, HEYGEN_CONFIG_PATH } from '../config/paths.js';
import { formatApiError } from '../utils/errorExtractor.js';
import { hasCredits, deductCredits } from '../services/creditsService.js';
import { requireAuth } from '../middleware/auth.js';
import { createLogger } from '../utils/logger.js';
import { createTTLCache } from '../utils/cache.js';
import { startSegmentedJob, getSegmentedJob } from '../services/heygenSegmentedJob.js';
import {
  probeAudioDuration,
  validateAndNormalizeSegments,
  sumAvatarSeconds,
} from '../utils/audio.js';
import { buildHeyGenBackground } from '../utils/heygenBackground.js';
const log = createLogger('HeyGen');

export const heygenRouter = Router();

// HeyGen avatar catalog rarely changes — cache 10 min so users opening
// the Avatar tab repeatedly don't pay the upstream round-trip every
// time. Cache key is constant (the endpoint takes no params).
const avatarsCache = createTTLCache<unknown>({ ttlMs: 10 * 60_000, maxEntries: 1 });
const AVATARS_CACHE_KEY = 'all';

// GET /api/heygen/avatars
heygenRouter.get('/avatars', async (_req, res) => {
  const apiKey = getHeyGenKey();
  if (!apiKey) {
    return res.status(500).json({ error: 'HeyGen API Key is missing.' });
  }

  const cached = avatarsCache.get(AVATARS_CACHE_KEY);
  if (cached) {
    log.info('[HeyGen Proxy] Avatars served from cache');
    return res.json(cached);
  }

  try {
    log.info('[HeyGen Proxy] Fetching avatars (cache miss)...');
    // /v2/avatars (avatares PÚBLICOS do HeyGen) às vezes TRAVA / demora >60s.
    // Como não tinha timeout, pendurava o endpoint inteiro e o Cloud Run
    // devolvia HTML ("Unexpected token '<'"). Agora é best-effort com timeout:
    // se falhar, segue SÓ com os avatares do usuário (que é o que ele usa).
    let data: any = { error: null, data: { avatars: [] } };
    // publicOk = a lista PÚBLICA veio mesmo. Se falhar, NÃO cacheamos o
    // resultado (senão a lista vazia ficava presa por 10 min) e avisamos o
    // front, que antes não tinha como distinguir "deu erro" de "não tem
    // avatar" — mostrava "0 avatares" sem nenhum aviso.
    let publicOk = false;
    try {
      const response = await fetch('https://api.heygen.com/v2/avatars', {
        method: 'GET',
        headers: { 'X-Api-Key': apiKey },
        // O payload tem ~3.7MB e leva 10-13s tipicamente — com 12s o abort
        // disparava direto, devolvia lista vazia e ainda cacheava isso.
        signal: AbortSignal.timeout(45000),
      });
      if (response.ok) {
        data = await response.json();
        publicOk = true;
      } else {
        log.warn(
          `[HeyGen Proxy] /v2/avatars ${response.status} — seguindo só com os avatares do usuário`
        );
      }
    } catch (e: any) {
      log.warn(
        `[HeyGen Proxy] /v2/avatars falhou/timeout (${e?.message}) — seguindo só com os do usuário`
      );
    }

    // Injeta os PHOTO AVATARS do usuário (clones próprios — ficam em "avatar
    // groups", não no /v2/avatars). Cada look vira um avatar com id `pa_<lookId>`
    // (o /generate reconhece esse prefixo e usa type talking_photo). Best-effort:
    // se falhar, segue só com os avatares públicos.
    try {
      const groupsResp = await fetch('https://api.heygen.com/v2/avatar_group.list', {
        headers: { 'X-Api-Key': apiKey },
      });
      if (groupsResp.ok) {
        const groupsData = await groupsResp.json();
        const groups: any[] = groupsData?.data?.avatar_group_list || [];
        // Paraleliza as chamadas por grupo. Antes era SEQUENCIAL (um fetch por
        // grupo, em fila) → com vários grupos o endpoint levava 40s+ e travava,
        // fazendo o Cloud Run devolver uma página HTML de erro (o "Unexpected
        // token '<'" no front). Em paralelo, cai pra ~2-3s.
        const perGroup = await Promise.all(
          groups.map(async (g) => {
            try {
              const looksResp = await fetch(
                `https://api.heygen.com/v2/avatar_group/${g.id}/avatars`,
                { headers: { 'X-Api-Key': apiKey }, signal: AbortSignal.timeout(20000) }
              );
              if (!looksResp.ok) return [] as any[];
              const looksData = await looksResp.json();
              const looks: any[] = looksData?.data?.avatar_list || [];
              return looks
                .filter(
                  (lk) =>
                    !(
                      (lk.train_status || lk.status) &&
                      (lk.train_status || lk.status) !== 'completed'
                    ) &&
                    (lk.id || lk.avatar_id)
                )
                .map((lk) => ({
                  avatar_id: `pa_${lk.id || lk.avatar_id}`,
                  avatar_name: `${g.name} — ${lk.name || 'look'}`,
                  gender: g.gender || '',
                  preview_image_url: lk.image_url || lk.preview_image_url || '',
                  // Looks de photo avatar são cenas LANDSCAPE → default 16:9.
                  aspect_ratio: '16:9',
                  is_public: false,
                  is_custom: true,
                }));
            } catch {
              return [] as any[];
            }
          })
        );
        const custom: any[] = perGroup.flat();
        if (custom.length) {
          data.data = data.data || {};
          // Custom PRIMEIRO, pra o usuário achar fácil.
          data.data.avatars = [...custom, ...(data.data.avatars || [])];
        }
      }
    } catch {
      /* segue só com públicos */
    }

    // Só cacheia resultado BOM. Cachear a falha deixava o usuário 10 min
    // vendo "0 avatares" mesmo depois do HeyGen voltar ao normal.
    if (publicOk) {
      avatarsCache.set(AVATARS_CACHE_KEY, data);
    } else {
      data.publicAvatarsFailed = true;
    }
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/heygen/health
heygenRouter.get('/health', async (_req, res) => {
  const apiKey = getHeyGenKey();
  if (!apiKey) {
    return res.status(500).json({ status: 'error', message: 'HEYGEN_API_KEY is missing.' });
  }

  try {
    const response = await fetch('https://api.heygen.com/v2/user/remaining_quota', {
      method: 'GET',
      headers: { 'X-Api-Key': apiKey },
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

// POST /api/heygen/config
heygenRouter.post('/config', async (req, res) => {
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

// POST /api/heygen/generate
heygenRouter.post('/generate', requireAuth, async (req, res) => {
  const { avatarId, voiceId, script, title, audioUrl, scale } = req.body;
  const heygenKey = getHeyGenKey();

  if (!heygenKey) return res.status(500).json({ error: 'HeyGen API Key missing.' });

  if (!avatarId) return res.status(400).json({ error: 'Avatar ID is required.' });
  if (!audioUrl && (!voiceId || !script))
    return res.status(400).json({ error: 'Voice ID and Script OR Audio URL are required.' });

  const videoCost = 100;
  const uid = req.user!.uid;
  if (!(await hasCredits(uid, videoCost))) {
    return res.status(403).json({ error: 'Créditos insuficientes para gerar vídeo.' });
  }

  try {
    // On Cloud Run, x-forwarded-proto is usually 'https'. Default to https
    // unless we know the host is localhost.
    const forwardedHost = req.headers['x-forwarded-host'];
    const host =
      (typeof forwardedHost === 'string' ? forwardedHost.split(',')[0]?.trim() : null) ||
      req.get('host') ||
      '';
    const protocol =
      req.headers['x-forwarded-proto'] || (host.includes('localhost') ? 'http' : 'https');

    // Build a public URL for HeyGen to fetch the audio asset.
    let fullAudioUrl = null;
    if (audioUrl) {
      if (audioUrl.startsWith('/generated/')) {
        fullAudioUrl = `${protocol}://${host}${audioUrl}`;

        const localPath = path.join(GENERATED_DIR, audioUrl.replace('/generated/', ''));
        if (!fs.existsSync(localPath)) {
          log.error(`[HeyGen Proxy] CRITICAL: Audio file not found locally at ${localPath}`);
        } else {
          const stats = fs.statSync(localPath);
          log.info(`[HeyGen Proxy] Audio file verified: ${localPath} (${stats.size} bytes)`);
          log.info(`[HeyGen Proxy] Public Audio URL: ${fullAudioUrl}`);
        }
      } else if (audioUrl.startsWith('http')) {
        fullAudioUrl = audioUrl;
      } else {
        log.warn('[HeyGen Proxy] Invalid audioUrl format (possibly a Blob URL):', audioUrl);
      }
    }

    // Mode A (NATIVE_VOICE): HeyGen text-to-speech.
    // Mode B (EXTERNAL_AUDIO): use the supplied ElevenLabs audio asset.
    const useNativeFallback = req.body.useNativeFallback === true;
    const mode = fullAudioUrl && !useNativeFallback ? 'EXTERNAL_AUDIO' : 'NATIVE_VOICE';

    log.info(`[HeyGen Proxy] Mode: ${mode}, Audio URL: ${fullAudioUrl || 'N/A'}`);

    // Fallback HeyGen voice (Brenda, pt-BR) when none supplied.
    const DEFAULT_HEYGEN_VOICE = '990e6677947141569a4734898e82a611';

    const isLikelyElevenLabs = voiceId && voiceId.length > 15 && !voiceId.includes('-');
    const finalVoiceId = isLikelyElevenLabs || !voiceId ? DEFAULT_HEYGEN_VOICE : voiceId;

    const sanitizedScript = script
      ? script.substring(0, 4000).replace(/[ --]/g, '') // eslint-disable-line no-control-regex
      : '';

    // `pa_<id>` = PHOTO AVATAR do usuário (clone próprio) → também vira
    // talking_photo, mas o id real é sem o prefixo.
    const isPhotoAvatar = avatarId && avatarId.startsWith('pa_');
    const isTalkingPhoto =
      avatarId &&
      (isPhotoAvatar ||
        avatarId.startsWith('talking_photo_') ||
        avatarId.includes('talking_photo'));
    const talkingPhotoId = isPhotoAvatar ? avatarId.slice(3) : avatarId;

    const requestedAspectRatio = req.body.aspectRatio || '9:16';
    log.info(`[HeyGen Proxy] Requested Aspect Ratio: ${requestedAspectRatio}`);

    let dimension = { width: 1080, height: 1920 };
    if (requestedAspectRatio === '1:1') {
      dimension = { width: 1080, height: 1080 };
    } else if (requestedAspectRatio === '16:9') {
      dimension = { width: 1920, height: 1080 };
    } else if (requestedAspectRatio === '4:5') {
      dimension = { width: 1080, height: 1350 };
    }

    log.info(`[HeyGen Proxy] Calculated Dimension:`, dimension);

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
        talking_photo_id: talkingPhotoId,
      };
      // Photo avatar NÃO preenchia o canvas em 16:9 (sobrava borda preta) porque
      // o scale era ignorado. Agora respeita o scale do usuário e, sem ele, usa
      // um default por proporção pra PREENCHER (16:9 precisa ampliar mais).
      if (scale) {
        characterConfig.scale = Number(scale);
      } else if (requestedAspectRatio === '16:9') {
        characterConfig.scale = 1.1;
      } else if (requestedAspectRatio === '4:5') {
        characterConfig.scale = 1.1;
      }
      // 1:1 e 9:16: default do HeyGen (já preenche bem).
    } else {
      characterConfig = {
        type: 'avatar',
        avatar_id: avatarId,
        avatar_style: 'normal',
      };

      // Default scale per aspect ratio when the caller doesn't override.
      if (scale) {
        characterConfig.scale = Number(scale);
      } else if (requestedAspectRatio === '1:1') {
        characterConfig.scale = 1.2;
      } else if (requestedAspectRatio === '4:5') {
        characterConfig.scale = 1.15;
      } else if (requestedAspectRatio === '9:16') {
        characterConfig.scale = 1.0;
      }
    }

    const payload: any = {
      video_inputs: [
        {
          character: characterConfig,
          voice: voiceConfig,
          background: buildHeyGenBackground(req.body.background),
        },
      ],
      aspect_ratio:
        requestedAspectRatio === '1:1'
          ? '1:1'
          : requestedAspectRatio === '16:9'
            ? '16:9'
            : requestedAspectRatio === '4:5'
              ? '4:5'
              : '9:16',
      dimension: dimension,
    };

    if (title) {
      payload.title = title.substring(0, 50).replace(/[^\w\s-]/g, '');
    }

    log.info(`[HeyGen Proxy] Outgoing Payload (${mode}):`, JSON.stringify(payload, null, 2));

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
      } catch {
        errorBody = { message: errorText };
      }

      log.error(
        `[HeyGen Proxy] API Error Response (Mode: ${mode}, Status: ${response.status}):`,
        errorText
      );

      // Map a few common failure patterns to friendlier messages for the SPA.
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

    const remaining = await deductCredits(uid, videoCost, 'heygen-generate', {
      avatarId,
      videoId: data.data?.video_id,
    });

    res.json({
      videoId: data.data?.video_id,
      remainingCredits: remaining,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/heygen/status/:videoId
heygenRouter.get('/status/:videoId', async (req, res) => {
  const { videoId } = req.params;
  const apiKey = getHeyGenKey();

  if (!apiKey) {
    return res.status(500).json({ error: 'HeyGen API Key missing.' });
  }

  try {
    if (process.env.NODE_ENV !== 'production') {
      log.info(`[HeyGen Proxy] Checking status for video ID: ${videoId}`);
    }

    let response = await fetch(`https://api.heygen.com/v2/video/${videoId}`, {
      method: 'GET',
      headers: { 'X-Api-Key': apiKey },
    });

    // Fall back to v1 when v2 returns 404.
    if (response.status === 404) {
      if (process.env.NODE_ENV !== 'production') {
        log.info(`[HeyGen Proxy] v2 status 404 for ${videoId}, trying v1 fallback...`);
      }
      response = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${videoId}`, {
        method: 'GET',
        headers: { 'X-Api-Key': apiKey },
      });
    }

    if (!response.ok) {
      const errorMsg = await formatApiError(response);
      log.error(`[HeyGen Proxy] Status Error (${response.status}) for ${videoId}:`, errorMsg);
      return res.status(response.status).json({ error: errorMsg });
    }

    const data = await response.json();
    const status = data.data?.status || data.status;

    if (status === 'failed') {
      const errorDetail =
        data.data?.error || data.error || data.data?.error_message || data.error_message || data;
      log.error(
        `[HeyGen Proxy] Job failed for ${videoId}:`,
        typeof errorDetail === 'object' ? JSON.stringify(errorDetail, null, 2) : errorDetail
      );
    }

    if (process.env.NODE_ENV !== 'production') {
      log.info(`[HeyGen Proxy] Status result for ${videoId}:`, status);
    }

    res.json(data.data || data);
  } catch (err: any) {
    log.error(`[HeyGen Proxy] Status Exception for ${videoId}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// F9.5 — POST /api/heygen/generate-segmented
//
// Gera avatar APENAS nos segments pedidos pra economizar custo HeyGen.
// HeyGen cobra por segundo de output → se você só vai mostrar 15s de
// avatar num vídeo de 60s, gerar 60s é desperdício de 75%.
//
// Body:
//   avatarId: string
//   audioUrl: string (ex: '/generated/voice_abc.mp3')
//   segments: [{ startSec, endSec }, ...]   ← onde avatar deve aparecer
//   aspectRatio?: '9:16' | '1:1' | '16:9' | '4:5' (default '9:16')
//   scale?: number
//   title?: string
//
// Retorna: { jobId, totalAvatarSec, estimatedCreditCost }
//
// Cliente faz polling em GET /api/heygen/generate-segmented/status/:jobId
// pra acompanhar progresso. Resposta inclui resultUrl quando completo.
heygenRouter.post('/generate-segmented', requireAuth, async (req, res) => {
  const heygenKey = getHeyGenKey();
  if (!heygenKey) return res.status(500).json({ error: 'HeyGen API Key ausente.' });

  const { avatarId, audioUrl, segments, aspectRatio, scale, title, background } = req.body || {};
  if (!avatarId) return res.status(400).json({ error: 'avatarId é obrigatório.' });
  if (!audioUrl || typeof audioUrl !== 'string') {
    return res.status(400).json({ error: 'audioUrl é obrigatório (string).' });
  }
  if (!Array.isArray(segments) || segments.length === 0) {
    return res.status(400).json({ error: 'segments[] não pode estar vazio.' });
  }

  // Pra HeyGen baixar via URL pública depois, precisamos do áudio local.
  // Aceitamos dois formatos:
  //   - /generated/<arquivo>  → já tá local, perfeito
  //   - https://...            → baixamos pra /generated/ primeiro
  // Voice gerado pelo ElevenLabs sobe pro Firebase Storage quando dá
  // certo, então URL https://storage.googleapis.com/... é o caso comum.
  let audioFilename: string;
  let audioPath: string;
  if (audioUrl.startsWith('/generated/')) {
    audioFilename = audioUrl.replace('/generated/', '');
    audioPath = path.join(GENERATED_DIR, audioFilename);
    if (!fs.existsSync(audioPath)) {
      return res.status(404).json({ error: `Arquivo de áudio não existe: ${audioFilename}` });
    }
  } else if (/^https?:\/\//.test(audioUrl)) {
    // Download remoto pra cache local. Reusa filename do path da URL,
    // sanitizado pra evitar caracteres estranhos.
    try {
      const urlObj = new URL(audioUrl);
      const basename = path.basename(urlObj.pathname).replace(/[^a-z0-9.-]/gi, '_');
      const safeName = basename.match(/\.(mp3|wav|aac|m4a)$/i) ? basename : `${basename}.mp3`;
      audioFilename = `segjob_remote_${Date.now()}_${safeName}`;
      audioPath = path.join(GENERATED_DIR, audioFilename);
      const { downloadFile } = await import('../utils/download.js');
      await downloadFile(audioUrl, audioPath);
      log.info(`[Segmented] baixou áudio remoto pra ${audioFilename}`);
    } catch (err: any) {
      return res.status(400).json({
        error: `Falha ao baixar áudio da URL: ${err.message}`,
      });
    }
  } else {
    return res.status(400).json({
      error: 'audioUrl precisa ser /generated/<arquivo> ou URL https://',
    });
  }

  // Probe duração total + valida segments
  let totalAudioDurationSec: number;
  let validSegments;
  try {
    totalAudioDurationSec = await probeAudioDuration(audioPath);
    validSegments = validateAndNormalizeSegments(segments, totalAudioDurationSec);
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }

  // Pro-rata credit cost: 100 cr/60s ≈ 1.67 cr/s. Min 20 pra cobrir overhead.
  const totalAvatarSec = sumAvatarSeconds(validSegments);
  const creditCost = Math.max(20, Math.round((totalAvatarSec / 60) * 100));

  const uid = req.user!.uid;
  if (!(await hasCredits(uid, creditCost))) {
    return res.status(403).json({
      error: `Créditos insuficientes. Precisa de ${creditCost} cr pra ${totalAvatarSec.toFixed(1)}s de avatar.`,
    });
  }

  // Public URL prefix pra HeyGen fetchar os chunks do nosso /generated/.
  const forwardedHost = req.headers['x-forwarded-host'];
  const host =
    (typeof forwardedHost === 'string' ? forwardedHost.split(',')[0]?.trim() : null) ||
    req.get('host') ||
    '';
  const protocol =
    req.headers['x-forwarded-proto'] || (host.includes('localhost') ? 'http' : 'https');
  const publicUrlPrefix = `${protocol}://${host}`;

  const jobId = `heygen_seg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Deduz créditos AGORA. Se job falhar depois, poderia ter um refund
  // automático — por simplicidade do MVP, cliente vê falha e nós refundamos
  // manualmente se reclamar. TODO: auto-refund on failure.
  await deductCredits(uid, creditCost, 'heygen-segmented', {
    avatarId,
    segments: validSegments.length,
    totalAvatarSec,
    jobId,
  });

  // Dispara job async — retorna imediato.
  startSegmentedJob({
    jobId,
    avatarId,
    audioUrl,
    audioFilename,
    segments: validSegments,
    totalAudioDurationSec,
    aspectRatio: (aspectRatio || '9:16') as any,
    scale,
    title,
    publicUrlPrefix,
    background,
  });

  res.json({
    jobId,
    totalAvatarSec,
    estimatedCreditCost: creditCost,
    totalAudioDurationSec,
    avatarPercent: Math.round((totalAvatarSec / totalAudioDurationSec) * 100),
    savings: {
      // Quanto custaria gerando full em vez de segmentado
      fullCostCredits: 100,
      segmentedCostCredits: creditCost,
      savedCredits: 100 - creditCost,
    },
  });
});

// F9.6 — GET /api/heygen/generate-segmented/status/:jobId
//
// Polling endpoint. Retorna estado atual do job + progress 0-1.
// Quando status='completed' resposta inclui resultUrl.
heygenRouter.get('/generate-segmented/status/:jobId', (req, res) => {
  const job = getSegmentedJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job não encontrado (ou expirou após 24h).' });
  }
  res.json({
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    message: job.message,
    resultUrl: job.resultUrl,
    error: job.error,
    totalAvatarSec: job.totalAvatarSec,
    subJobs: job.subJobs.map((s) => ({
      index: s.index,
      startSec: s.startSec,
      endSec: s.endSec,
      heygenStatus: s.heygenStatus,
      ready: !!s.downloadedPath,
      error: s.error,
    })),
  });
});
