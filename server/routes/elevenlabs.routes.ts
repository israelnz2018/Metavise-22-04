import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import admin from 'firebase-admin';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { getElevenLabsKey, getClaudeKey } from '../config/apiKeys.js';
import { CONFIG_PATH, GENERATED_DIR } from '../config/paths.js';
import { createLogger } from '../utils/logger.js';
import { createTTLCache } from '../utils/cache.js';
const log = createLogger('ElevenLabs');
if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic as unknown as string);

// Shared-voices is a large upstream payload (~1k voices per page) and
// the same filter combination typically returns the same result for
// minutes — cache 10 min keyed by the full query string (after
// auto-relax, which we re-run on miss anyway). maxEntries=200 covers
// hundreds of distinct filter+page combinations before we LRU-evict.
const sharedVoicesCache = createTTLCache<unknown>({
  ttlMs: 10 * 60_000,
  maxEntries: 200,
});

// Account-level voice list rarely changes (only when the user explicitly
// clones/deletes a voice). 5 min TTL is generous enough to avoid most
// repeat hits during a single editing session.
const accountVoicesCache = createTTLCache<unknown>({
  ttlMs: 5 * 60_000,
  maxEntries: 2, // key by "has-api-key" / "no-api-key" — only 2 buckets
});

export const elevenLabsRouter = Router();

// GET /api/elevenlabs/voices
elevenLabsRouter.get('/voices', async (_req, res) => {
  const apiKey = getElevenLabsKey();
  const cacheKey = apiKey ? 'auth' : 'public';

  const cached = accountVoicesCache.get(cacheKey);
  if (cached) {
    log.info('[ElevenLabs Proxy] Voices served from cache');
    return res.json(cached);
  }

  try {
    log.info('[ElevenLabs Proxy] Fetching voices (cache miss)...');
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers['xi-api-key'] = apiKey;
    }

    let response = await fetch('https://api.elevenlabs.io/v1/voices', {
      method: 'GET',
      headers,
    });

    if (!response.ok && response.status === 401 && apiKey) {
      log.warn('[ElevenLabs Proxy] Invalid API key detected, falling back to public voices...');
      response = await fetch('https://api.elevenlabs.io/v1/voices', { method: 'GET' });
    }

    if (!response.ok) {
      const errorText = await response.text();
      log.error(`[ElevenLabs Proxy] Voices Error (${response.status}):`, errorText);
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: errorText };
      }
      return res.status(response.status).json(errorData);
    }

    const data = await response.json();
    accountVoicesCache.set(cacheKey, data);
    res.json(data);
  } catch (err: any) {
    log.error('[ElevenLabs Proxy] Voices Exception:', err);
    res.status(500).json({ error: `Failed to fetch voices from ElevenLabs: ${err.message}` });
  }
});

// POST /api/elevenlabs/concat-audio
// Junta vários áudios (URLs de blocos já gerados) num único mp3. Usado pela
// VSL: gera cada bloco (~2 min) separado e no fim concatena tudo — evita uma
// request contínua de 10+ min que pode falhar. Re-encoda pra libmp3lame com
// sample-rate/canais normalizados, então blocos levemente diferentes juntam ok.
elevenLabsRouter.post('/concat-audio', async (req, res) => {
  const urls: string[] = Array.isArray((req.body || {}).urls) ? req.body.urls : [];
  if (urls.length < 2) {
    return res.status(400).json({ success: false, error: 'Envie ao menos 2 áudios pra juntar.' });
  }
  const stamp = Date.now();
  const tmpFiles: string[] = [];
  try {
    for (let i = 0; i < urls.length; i++) {
      const r = await fetch(urls[i]!);
      if (!r.ok) throw new Error(`Falha ao baixar o bloco ${i + 1} (HTTP ${r.status})`);
      const buf = Buffer.from(await r.arrayBuffer());
      const p = path.join(GENERATED_DIR, `vslblock_${stamp}_${i}.mp3`);
      fs.writeFileSync(p, buf);
      tmpFiles.push(p);
    }
    const outName = `vsl_joined_${stamp}.mp3`;
    const outPath = path.join(GENERATED_DIR, outName);
    await new Promise<void>((resolve, reject) => {
      const cmd = ffmpeg();
      tmpFiles.forEach((f) => cmd.input(f));
      cmd
        .complexFilter([
          ...tmpFiles.map(
            (_, i) => `[${i}:a]aresample=44100,aformat=channel_layouts=mono[a${i}]`
          ),
          `${tmpFiles.map((_, i) => `[a${i}]`).join('')}concat=n=${tmpFiles.length}:v=0:a=1[out]`,
        ])
        .outputOptions(['-map', '[out]'])
        .audioCodec('libmp3lame')
        .on('end', () => resolve())
        .on('error', (e) => reject(e))
        .save(outPath);
    });

    const forwardedHost = req.headers['x-forwarded-host'];
    const host =
      (typeof forwardedHost === 'string' ? forwardedHost.split(',')[0]?.trim() : null) ||
      req.get('host') ||
      '';
    const protocol =
      req.headers['x-forwarded-proto'] || (host.includes('localhost') ? 'http' : 'https');
    const base = `${protocol}://${host}`;
    res.json({ success: true, audioUrl: `${base}/generated/${outName}` });
  } catch (err: any) {
    log.error('[ElevenLabs concat-audio]', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    for (const f of tmpFiles) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
  }
});

// POST /api/elevenlabs/trim-audio
// Corta um áudio pro trecho [start, end] (segundos) e devolve um novo mp3.
// Usado pra aparar efeitos sonoros longos / pegar só a parte boa. O resultado
// sobe pro Firebase (URL durável) — senão o efeito aparado ficava só local e
// quebrava ao recarregar/em outra máquina (fonte virava HTML → ffmpeg falhava).
// Body: { url, start, end, userId? } → { url }
elevenLabsRouter.post('/trim-audio', async (req, res) => {
  const url = String((req.body || {}).url || '');
  const start = Math.max(0, Number((req.body || {}).start) || 0);
  const end = Number((req.body || {}).end);
  const userId = String((req.body || {}).userId || '');
  if (!url || !Number.isFinite(end) || end <= start) {
    return res.status(400).json({ success: false, error: 'url, start e end (>start) obrigatórios.' });
  }
  const stamp = Date.now();
  const inPath = path.join(GENERATED_DIR, `trim_in_${stamp}.mp3`);
  const outName = `fx_trim_${stamp}.mp3`;
  const outPath = path.join(GENERATED_DIR, outName);
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Não consegui baixar o áudio (HTTP ${r.status}). Reenvie esse efeito.`);
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    const buf = Buffer.from(await r.arrayBuffer());
    // Guard: fonte quebrada devolve HTML (SPA) com 200 → não é áudio.
    if (ct.includes('text/html') || buf.slice(0, 15).toString('utf8').trim().toLowerCase().startsWith('<!doctype') || buf.length < 200) {
      throw new Error('Esse efeito está com o link quebrado (não é áudio). Reenvie o arquivo na biblioteca.');
    }
    fs.writeFileSync(inPath, buf);
    await new Promise((resolve, reject) => {
      ffmpeg(inPath)
        .setStartTime(start)
        .duration(end - start)
        .audioCodec('libmp3lame')
        .on('end', () => resolve(null))
        .on('error', reject)
        .save(outPath);
    });

    // Sobe pro Firebase pra URL durável; fallback local se não der.
    let outUrl = '';
    try {
      if (userId && admin.apps.length > 0) {
        const bucket = admin.storage().bucket();
        const firebasePath = `audio/${userId}/sound-library/${outName}`;
        const fileRef = bucket.file(firebasePath);
        await fileRef.save(fs.readFileSync(outPath), { metadata: { contentType: 'audio/mpeg' } });
        await fileRef.makePublic();
        outUrl = `https://storage.googleapis.com/${bucket.name}/${firebasePath}`;
      }
    } catch (upErr: any) {
      log.error('[trim-audio] upload Firebase falhou, usando local:', upErr.message);
    }
    if (!outUrl) {
      const forwardedHost = req.headers['x-forwarded-host'];
      const host =
        (typeof forwardedHost === 'string' ? forwardedHost.split(',')[0]?.trim() : null) ||
        req.get('host') ||
        '';
      const protocol =
        req.headers['x-forwarded-proto'] || (host.includes('localhost') ? 'http' : 'https');
      outUrl = `${protocol}://${host}/generated/${outName}`;
    }
    res.json({ success: true, url: outUrl });
  } catch (err: any) {
    log.error('[ElevenLabs trim-audio]', err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    try {
      fs.unlinkSync(inPath);
    } catch {
      /* ignore */
    }
  }
});

// GET /api/elevenlabs/health
elevenLabsRouter.get('/health', async (req, res) => {
  // Allow a one-shot key in the request header for connection testing.
  let headerKey = req.headers['xi-api-key'] as string;
  if (headerKey) headerKey = headerKey.trim().replace(/^["']|["']$/g, '');
  const apiKey = headerKey || getElevenLabsKey();

  if (!apiKey) {
    return res.status(500).json({ status: 'error', message: 'ELEVENLABS_API_KEY is missing.' });
  }

  try {
    const response = await fetch('https://api.elevenlabs.io/v1/user', {
      method: 'GET',
      headers: { 'xi-api-key': apiKey },
    });

    if (response.ok) {
      const userData = await response.json();
      return res.json({
        status: 'ok',
        message: 'ElevenLabs connection successful.',
        tier: userData.subscription?.tier || 'unknown',
      });
    } else {
      const error = await response.text();
      return res.status(response.status).json({ status: 'error', message: error });
    }
  } catch (err: any) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// POST /api/elevenlabs/config
elevenLabsRouter.post('/config', async (req, res) => {
  const { apiKey } = req.body;

  if (!apiKey) {
    return res.status(400).json({ error: 'API Key is required.' });
  }

  const trimmedKey = apiKey.trim().replace(/^["']|["']$/g, '');

  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ apiKey: trimmedKey }, null, 2));
    log.info('[ElevenLabs Config] API Key updated successfully.');
    res.json({ message: 'ElevenLabs API Key updated successfully.' });
  } catch (err: any) {
    log.error('[ElevenLabs Config] Error saving config:', err);
    res.status(500).json({ error: `Failed to save API Key: ${err.message}` });
  }
});

// --- Premium voice features (mounted at /api/elevenlabs-premium) ---
export const elevenLabsPremiumRouter = Router();

// Pulls from the shared voice library (~12k voices, ~1k in pt-BR) instead
// of the user's own library (~146 voices). Filters are forwarded to the
// upstream endpoint so server-side filtering is done by ElevenLabs.
// Response shape is normalized to match the old user-library shape so the
// frontend keeps working without changes: {voice_id, name, preview_url,
// labels:{gender,age,language,accent,use_case,descriptive}, category}.
//
// Auto-relax: ElevenLabs lookups with many combined filters often return
// 0 voices even when each individual filter has hundreds of matches. To
// avoid dead-end states, the server progressively drops the most narrow
// filters (descriptive → use_case → accent) until a non-empty result is
// found, and reports which filters it had to drop via `relaxed`.
elevenLabsPremiumRouter.get('/voices', async (req, res) => {
  const apiKey = getElevenLabsKey();
  if (!apiKey) return res.status(500).json({ error: 'ElevenLabs API Key ausente.' });

  // Build the cache key from the full request query — same filter combo +
  // page = same response. include_low_quality flips a post-filter so
  // it's part of the key too.
  const cacheKey = new URLSearchParams(req.query as Record<string, string>).toString();
  const cached = sharedVoicesCache.get(cacheKey);
  if (cached) {
    log.info(`[ElevenLabs Premium] voices served from cache (${cacheKey})`);
    return res.json(cached);
  }

  // Filters that may be safely relaxed when the combination yields 0
  // voices. Order matters only as a tiebreaker when multiple single-drop
  // candidates produce the same count — earlier = preferred to drop.
  const OPTIONAL: ('descriptive' | 'use_case' | 'accent')[] = ['descriptive', 'use_case', 'accent'];

  const buildParams = (drop: Set<string>) => {
    const params = new URLSearchParams();
    const pageSize = Math.min(Number(req.query.page_size) || 100, 100);
    params.set('page_size', String(pageSize));
    if (req.query.page) params.set('page', String(req.query.page));
    if (req.query.gender) params.set('gender', String(req.query.gender));
    if (req.query.age) params.set('age', String(req.query.age));
    if (req.query.language) params.set('language', String(req.query.language));
    if (req.query.accent && !drop.has('accent')) params.set('accent', String(req.query.accent));
    if (req.query.use_case && !drop.has('use_case'))
      params.set('use_cases', String(req.query.use_case));
    if (req.query.descriptive && !drop.has('descriptive'))
      params.set('descriptives', String(req.query.descriptive));
    if (req.query.search) params.set('search', String(req.query.search));
    return params;
  };

  const fetchPage = async (drop: Set<string>) => {
    const params = buildParams(drop);
    const r = await fetch(`https://api.elevenlabs.io/v1/shared-voices?${params.toString()}`, {
      headers: { 'xi-api-key': apiKey },
    });
    if (!r.ok) {
      const errText = await r.text();
      throw new Error(`shared-voices ${r.status}: ${errText.substring(0, 200)}`);
    }
    return r.json();
  };

  try {
    let json = await fetchPage(new Set());
    let relaxed: string[] = [];

    // Relax only on page 1 — pagination subsequent pages keep the agreed
    // combo so the user's scroll position stays consistent.
    const isFirstPage = !req.query.page || String(req.query.page) === '1';
    if (isFirstPage && (json.voices?.length ?? 0) === 0) {
      // Minimum-drop strategy: try dropping each optional filter
      // individually in parallel. Pick the candidate that returns the
      // MOST voices (closest to the user's intent). Tie-break by
      // OPTIONAL order (descriptive first — generally the most subjective).
      const presentOptional = OPTIONAL.filter((k) => req.query[k]);
      const singleAttempts = await Promise.all(
        presentOptional.map(async (k) => {
          const r = await fetchPage(new Set([k]));
          return { drop: k, count: r.voices?.length ?? 0, json: r };
        })
      );
      const bestSingle = singleAttempts
        .filter((a) => a.count > 0)
        .sort((a, b) => b.count - a.count)[0];

      if (bestSingle) {
        json = bestSingle.json;
        relaxed = [bestSingle.drop];
      } else {
        // No single drop unblocks the result set — fall back to the
        // priority sweep that drops progressively more filters until
        // something comes back.
        const drop = new Set<string>();
        for (const key of OPTIONAL) {
          if (!req.query[key]) continue;
          drop.add(key);
          relaxed.push(key);
          json = await fetchPage(drop);
          if ((json.voices?.length ?? 0) > 0) break;
        }
      }
    }

    // Quality floor: filter out the long-tail of shared voices with very
    // few clones (typically poor-mic recordings from random users). The
    // shared-voices feed is sorted by popularity so the top page is
    // usually clean, but uncommon filter combos can surface low-clone
    // voices. The client can opt out with `include_low_quality=1`.
    const QUALITY_FLOOR = 10;
    const includeLowQuality = req.query.include_low_quality === '1';
    const filtered = includeLowQuality
      ? json.voices || []
      : (json.voices || []).filter((v: any) => (v.cloned_by_count ?? 0) >= QUALITY_FLOOR);

    const voices = filtered.map((v: any) => ({
      voice_id: v.voice_id,
      name: v.name,
      preview_url: v.preview_url,
      category: v.category,
      cloned_by_count: v.cloned_by_count,
      labels: {
        gender: v.gender,
        age: v.age,
        language: v.language,
        accent: v.accent,
        use_case: v.use_case,
        descriptive: v.descriptive,
      },
    }));

    const payload = {
      voices,
      has_more: json.has_more,
      total_count: json.total_count,
      relaxed,
    };
    sharedVoicesCache.set(cacheKey, payload);
    res.json(payload);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/elevenlabs-premium/voice/:id
// Resolve UM voice_id pro nome legível. Usado pelo painel de info do criativo
// pra mostrar "Sarah" em vez do id cru em criativos antigos (que só salvaram o
// id). Voz fora da biblioteca do user pode dar 404 — o cliente cai pro id.
elevenLabsPremiumRouter.get('/voice/:id', async (req, res) => {
  const apiKey = getElevenLabsKey();
  if (!apiKey) return res.status(500).json({ error: 'ElevenLabs API Key ausente.' });
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: 'voice id obrigatório.' });
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/voices/${id}`, {
      headers: { 'xi-api-key': apiKey },
    });
    if (!r.ok) {
      // 404/403 = voz não está na biblioteca; não é erro fatal pro painel.
      return res.json({ voice_id: id, name: null });
    }
    const v: any = await r.json();
    res.json({
      voice_id: v.voice_id || id,
      name: v.name || null,
      preview_url: v.preview_url,
      labels: v.labels || {},
    });
  } catch (err: any) {
    res.json({ voice_id: id, name: null });
  }
});

elevenLabsPremiumRouter.post('/generate', async (req, res) => {
  const apiKey = getElevenLabsKey();
  if (!apiKey) return res.status(500).json({ error: 'ElevenLabs API Key ausente.' });
  const {
    voiceId,
    script,
    modelId = 'eleven_multilingual_v2',
    stability = 0.5,
    similarityBoost = 0.75,
    speed = 1.0,
    userId,
  } = req.body || {};
  if (!voiceId || !script)
    return res.status(400).json({ error: 'voiceId e script são obrigatórios.' });
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: script,
        model_id: modelId,
        voice_settings: { stability, similarity_boost: similarityBoost, speed },
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(r.status).json({ error: t });
    }
    const audioBuffer = await r.arrayBuffer();
    const audioBlob = Buffer.from(audioBuffer);

    // Always cache locally first as a fallback.
    const fileName = `premium-audio-${Date.now()}.mp3`;
    const filePath = path.join(GENERATED_DIR, fileName);
    fs.writeFileSync(filePath, audioBlob);
    let audioUrl = `/generated/${fileName}`;
    let storagePath: string | null = null;

    // Upload to Firebase Storage for cross-instance durability.
    try {
      if (userId && admin.apps.length > 0) {
        const bucket = admin.storage().bucket();
        const firebasePath = `audio/${userId}/${Date.now()}.mp3`;
        const fileRef = bucket.file(firebasePath);
        await fileRef.save(audioBlob, { metadata: { contentType: 'audio/mpeg' } });
        await fileRef.makePublic();
        audioUrl = `https://storage.googleapis.com/${bucket.name}/${firebasePath}`;
        storagePath = firebasePath;
      }
    } catch (uploadErr: any) {
      log.error('[VozPremium] Firebase Storage upload falhou, usando local:', uploadErr.message);
    }

    res.json({ audioUrl, storagePath });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

elevenLabsPremiumRouter.post('/clone-voice', async (req, res) => {
  const apiKey = getElevenLabsKey();
  if (!apiKey) return res.status(500).json({ error: 'ElevenLabs API Key ausente.' });
  const { fileBase64, fileName, contentType, name, removeNoise = true } = req.body || {};
  if (!fileBase64 || !name)
    return res.status(400).json({ error: 'fileBase64 e name são obrigatórios.' });
  try {
    const buffer = Buffer.from(fileBase64, 'base64');
    // Node 18+ has native FormData/Blob — no third-party dependency needed.
    const formData = new FormData();
    formData.set('name', name);
    formData.set('description', 'Voz clonada via Metavise');
    formData.set('remove_background_noise', String(removeNoise));
    formData.set(
      'files',
      new Blob([buffer], { type: contentType || 'audio/mp3' }),
      fileName || 'voice.mp3'
    );
    const r = await fetch('https://api.elevenlabs.io/v1/voices/add', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: formData,
    });
    const text = await r.text();
    if (!r.ok) return res.status(r.status).json({ error: text });
    const json = JSON.parse(text);
    res.json({ voiceId: json.voice_id, name });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

elevenLabsPremiumRouter.post('/clean-audio', async (req, res) => {
  const apiKey = getElevenLabsKey();
  if (!apiKey) return res.status(500).json({ error: 'ElevenLabs API Key ausente.' });
  const { fileBase64, contentType } = req.body || {};
  if (!fileBase64) return res.status(400).json({ error: 'fileBase64 é obrigatório.' });
  try {
    const buffer = Buffer.from(fileBase64, 'base64');
    const formData = new FormData();
    formData.append('audio', new Blob([buffer], { type: contentType || 'audio/mp3' }), 'audio.mp3');
    const r = await fetch('https://api.elevenlabs.io/v1/audio-isolation', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: formData,
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(r.status).json({ error: t });
    }
    const audioBuffer = await r.arrayBuffer();
    const fileName = `cleaned-audio-${Date.now()}.mp3`;
    const filePath = path.join(GENERATED_DIR, fileName);
    fs.writeFileSync(filePath, Buffer.from(audioBuffer));
    res.json({ audioUrl: `/generated/${fileName}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

elevenLabsPremiumRouter.post('/upload-ready-audio', async (req, res) => {
  const { fileBase64, fileName, contentType: _contentType } = req.body || {};
  if (!fileBase64) return res.status(400).json({ error: 'fileBase64 é obrigatório.' });
  try {
    const buffer = Buffer.from(fileBase64, 'base64');
    const savedFileName = `ready-audio-${Date.now()}-${fileName || 'audio.mp3'}`;
    const filePath = path.join(GENERATED_DIR, savedFileName);
    fs.writeFileSync(filePath, buffer);
    res.json({ audioUrl: `/generated/${savedFileName}`, storagePath: filePath });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// F7.4 — Helper: write a .json sidecar next to the saved music file so the
// library endpoint can show context (prompt used, original filename, source).
// Failure here is non-fatal — the audio file still works without metadata.
function writeMusicSidecar(
  filePath: string,
  meta: {
    source: 'upload' | 'ai';
    fileName?: string;
    prompt?: string;
    lengthMs?: number;
    instrumental?: boolean;
    sizeBytes: number;
  }
) {
  try {
    const sidecar = filePath + '.json';
    fs.writeFileSync(
      sidecar,
      JSON.stringify({ ...meta, createdAt: new Date().toISOString() }, null, 2)
    );
  } catch (err: any) {
    log.warn(`[Music] failed to write sidecar for ${path.basename(filePath)}: ${err.message}`);
  }
}

// F7.1 — Upload um MP3 do cliente pra usar como música de fundo. Reusa a
// mesma pasta /generated/ + base64 pattern. Cliente faz fetch da response
// e usa { audioUrl } como musicUrl no /api/video/add-music depois.
// NOTA: montado em elevenLabsRouter (não premium) pra bater com o path
// usado pelo frontend (/api/elevenlabs/upload-music). Antes estava em
// elevenLabsPremiumRouter por engano e o upload nunca funcionou.
elevenLabsRouter.post('/upload-music', async (req, res) => {
  const { fileBase64, fileName } = req.body || {};
  if (!fileBase64) return res.status(400).json({ error: 'fileBase64 é obrigatório.' });
  try {
    const buffer = Buffer.from(fileBase64, 'base64');
    const safe = (fileName || 'music.mp3').replace(/[^a-z0-9.-]/gi, '_');
    const savedFileName = `music-${Date.now()}-${safe}`;
    const filePath = path.join(GENERATED_DIR, savedFileName);
    fs.writeFileSync(filePath, buffer);
    writeMusicSidecar(filePath, {
      source: 'upload',
      fileName: fileName || 'music.mp3',
      sizeBytes: buffer.length,
    });
    log.info(`[Music Upload] saved ${savedFileName} (${buffer.length} bytes)`);
    res.json({ audioUrl: `/generated/${savedFileName}`, sizeBytes: buffer.length });
  } catch (err: any) {
    log.error('[Music Upload] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// F7.3 — GET /api/elevenlabs/music/library
//
// Lista todas as músicas salvas em /generated/ (uploads + geradas pela IA),
// com metadata vinda dos sidecars .json quando disponíveis. Ordenado por
// mais recente primeiro (mtime do arquivo). Pra cliente poder voltar e
// reusar trilhas em projetos futuros.
elevenLabsRouter.get('/music/library', async (_req, res) => {
  try {
    const all = fs.readdirSync(GENERATED_DIR);
    // Aceita os 2 prefixos usados pelos endpoints de música:
    //   music-*               (upload)
    //   eleven-music-*        (gerado pela IA)
    const musicFiles = all.filter(
      (f) =>
        (f.startsWith('music-') || f.startsWith('eleven-music-')) &&
        !f.endsWith('.json') &&
        /\.(mp3|wav|aac|m4a)$/i.test(f)
    );

    const tracks = musicFiles.map((fileName) => {
      const filePath = path.join(GENERATED_DIR, fileName);
      const stat = fs.statSync(filePath);
      // Tenta ler sidecar — pode não existir (arquivos antigos pré-F7.4).
      let meta: any = {};
      const sidecarPath = filePath + '.json';
      if (fs.existsSync(sidecarPath)) {
        try {
          meta = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'));
        } catch {
          // sidecar corrompido — ignora
        }
      }
      // Inferência fallback pra arquivos sem sidecar.
      const inferredSource: 'ai' | 'upload' = fileName.startsWith('eleven-music-')
        ? 'ai'
        : 'upload';
      return {
        url: `/generated/${fileName}`,
        fileName,
        sizeBytes: stat.size,
        createdAt: meta.createdAt || stat.mtime.toISOString(),
        source: meta.source || inferredSource,
        prompt: meta.prompt,
        originalFileName: meta.fileName,
        lengthMs: meta.lengthMs,
      };
    });

    // Mais recentes primeiro.
    tracks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ tracks });
  } catch (err: any) {
    log.error('[Music Library] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// F7.3 — DELETE /api/elevenlabs/music/:fileName
//
// Apaga uma música salva (mp3 + sidecar). Valida o nome de arquivo pra
// evitar path traversal — só aceita o pattern dos prefixos legítimos.
elevenLabsRouter.delete('/music/:fileName', async (req, res) => {
  const { fileName } = req.params;
  // Path-traversal guard: só basename, só prefixos conhecidos, só extensões de audio.
  if (!fileName || fileName.includes('/') || fileName.includes('..')) {
    return res.status(400).json({ error: 'fileName inválido.' });
  }
  if (!/^(music-|eleven-music-)/.test(fileName) || !/\.(mp3|wav|aac|m4a)$/i.test(fileName)) {
    return res.status(400).json({ error: 'Nome de arquivo não corresponde a uma música salva.' });
  }
  try {
    const filePath = path.join(GENERATED_DIR, fileName);
    const sidecarPath = filePath + '.json';
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    if (fs.existsSync(sidecarPath)) fs.unlinkSync(sidecarPath);
    log.info(`[Music Delete] removed ${fileName}`);
    res.json({ ok: true });
  } catch (err: any) {
    log.error('[Music Delete] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// F7.1 — POST /api/elevenlabs/music/generate
//
// Proxy pro endpoint ElevenLabs Music API. Recebe prompt, gera track
// instrumental copyright-free, salva em /generated/, retorna URL local.
// Custa créditos ElevenLabs (Pro plan = 100 gerações/mês).
//
// Body (dois modos, mutuamente exclusivos):
//   MODO SIMPLES:
//     prompt: string                — descrição da track (ex: "upbeat pop")
//     lengthMs?: number             — duração (3000-600000, default 30000)
//   MODO ARCO EMOCIONAL (composition_plan):
//     compositionPlan: {            — gerado por /music/plan e editável no cliente
//       positiveGlobalStyles: string[]
//       negativeGlobalStyles: string[]
//       sections: { sectionName, positiveLocalStyles, negativeLocalStyles, durationMs }[]
//     }
//   forceInstrumental?: boolean     — sem voz (default true pra ad background)
elevenLabsRouter.post('/music/generate', async (req, res) => {
  const apiKey = getElevenLabsKey();
  if (!apiKey) {
    return res.status(500).json({ error: 'ELEVENLABS_API_KEY não configurada.' });
  }
  const { prompt, lengthMs, forceInstrumental, compositionPlan } = req.body || {};
  const instrumental = forceInstrumental !== false; // default true

  const hasPlan =
    compositionPlan &&
    Array.isArray(compositionPlan.sections) &&
    compositionPlan.sections.length > 0;

  if (!hasPlan && (!prompt || typeof prompt !== 'string')) {
    return res
      .status(400)
      .json({ error: 'Informe um prompt (string) ou um compositionPlan com seções.' });
  }

  // Monta o corpo pra ElevenLabs — composition_plan tem prioridade sobre prompt
  // (a API não aceita os dois juntos). Cada SEÇÃO da API: 3000–120000ms (2min);
  // a MÚSICA inteira pode ir até 600000ms (10min). Seções longas são fatiadas
  // automaticamente abaixo pra respeitar o teto por seção sem perder duração.
  let elevenBody: Record<string, any>;
  let durationMs = Math.max(3000, Math.min(600000, Number(lengthMs) || 30000));
  let logLabel: string;

  if (hasPlan) {
    // A API limita cada SEÇÃO a 120000ms (2 min), mas a música inteira pode ir
    // até 600000ms (10 min). Então, em vez de TRUNCAR uma seção longa (o que
    // perdia a duração pedida — ex: 245s virava 120s), FATIAMOS qualquer seção
    // acima de 120s em pedaços de ≤120s, preservando o estilo e a duração total.
    const MAX_SECTION_MS = 120000;
    const sections: any[] = [];
    for (const s of compositionPlan.sections) {
      const name = String(s.sectionName || 'Section').substring(0, 100);
      const pos = Array.isArray(s.positiveLocalStyles) ? s.positiveLocalStyles : [];
      const neg = Array.isArray(s.negativeLocalStyles) ? s.negativeLocalStyles : [];
      let remaining = Math.max(3000, Number(s.durationMs) || 10000);
      let part = 1;
      while (remaining > 0) {
        // Evita deixar um "rabo" menor que 3000ms (mínimo da API): se o resto
        // depois de um pedaço de 120s ficaria <3s, junta tudo num pedaço só
        // (a API aceita exatamente 120s; >120s seria rejeitado).
        let chunk = Math.min(MAX_SECTION_MS, remaining);
        if (remaining - chunk > 0 && remaining - chunk < 3000) chunk = remaining;
        if (chunk > MAX_SECTION_MS) chunk = MAX_SECTION_MS;
        sections.push({
          section_name: remaining === Math.max(3000, Number(s.durationMs) || 10000) && chunk === remaining
            ? name
            : `${name} (${part})`,
          positive_local_styles: pos,
          negative_local_styles: neg,
          duration_ms: chunk,
          lines: [],
        });
        remaining -= chunk;
        part++;
      }
    }
    durationMs = sections.reduce((acc: number, s: any) => acc + s.duration_ms, 0);
    // Nota: a API NÃO aceita force_instrumental junto com composition_plan.
    // O "sem voz" vem das `lines` vazias em cada seção + os estilos globais
    // negativos ("vocals", "lyrics") que o /music/plan já injeta.
    const negativeGlobal = Array.isArray(compositionPlan.negativeGlobalStyles)
      ? [...compositionPlan.negativeGlobalStyles]
      : [];
    if (instrumental) {
      for (const tok of ['vocals', 'lyrics']) {
        if (!negativeGlobal.some((s: string) => String(s).toLowerCase().includes(tok))) {
          negativeGlobal.push(tok);
        }
      }
    }
    elevenBody = {
      composition_plan: {
        positive_global_styles: Array.isArray(compositionPlan.positiveGlobalStyles)
          ? compositionPlan.positiveGlobalStyles
          : [],
        negative_global_styles: negativeGlobal,
        sections,
      },
      model_id: 'music_v1',
    };
    logLabel = `plan(${sections.length} seções, ${durationMs}ms)`;
  } else {
    elevenBody = {
      prompt,
      music_length_ms: durationMs,
      model_id: 'music_v1',
      force_instrumental: instrumental,
    };
    logLabel = `prompt="${String(prompt).substring(0, 60)}" ${durationMs}ms`;
  }

  try {
    log.info(`[Music Gen] ${logLabel} instrumental=${instrumental}`);
    const r = await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128', {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(elevenBody),
    });

    if (!r.ok) {
      const errText = await r.text();
      log.error(`[Music Gen] FAILED HTTP ${r.status}: ${errText.substring(0, 200)}`);
      return res.status(r.status).json({
        error: `ElevenLabs Music: ${errText.substring(0, 200)}`,
      });
    }

    const arrayBuffer = await r.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const filename = `eleven-music-${Date.now()}.mp3`;
    const filePath = path.join(GENERATED_DIR, filename);
    fs.writeFileSync(filePath, buffer);
    writeMusicSidecar(filePath, {
      source: 'ai',
      prompt: hasPlan
        ? `Arco emocional: ${compositionPlan.sections.map((s: any) => s.sectionName).join(' → ')}`
        : prompt,
      lengthMs: durationMs,
      instrumental,
      sizeBytes: buffer.length,
    });
    log.info(`[Music Gen] OK saved ${filename} (${buffer.length} bytes)`);
    res.json({ audioUrl: `/generated/${filename}`, sizeBytes: buffer.length });
  } catch (err: any) {
    log.error('[Music Gen] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/elevenlabs/music/plan
//
// Lê a copy/roteiro do anúncio e propõe um "arco emocional" pra trilha:
// calmo/tenso enquanto fala do problema → esperançoso quando entra nos
// benefícios → lift no CTA. Devolve um composition_plan EDITÁVEL que o
// cliente revisa antes de gerar. Usa Claude (Sonnet, sem thinking — tarefa
// leve) pra não pesar no custo.
//
// Body:
//   copy: string            — roteiro/copy aprovada do anúncio (obrigatório)
//   totalDurationSec: number — duração-alvo (= duração do vídeo)
//   style?: string          — gênero escolhido (ex: "cinematográfico")
//   energy?: string         — "baixa" | "média" | "alta"
//   tempo?: string          — "calmo" | "médio" | "acelerado"
//   instruments?: string[]  — instrumentos em destaque
elevenLabsRouter.post('/music/plan', async (req, res) => {
  const apiKey = getClaudeKey();
  if (!apiKey) {
    return res.status(500).json({ error: 'CLAUDE_API_KEY não configurada.' });
  }
  const { copy, totalDurationSec, style, energy, tempo, instruments, dominantEmotion, productInfo } =
    req.body || {};
  if (!copy || typeof copy !== 'string' || copy.trim().length < 20) {
    return res
      .status(400)
      .json({ error: 'copy (roteiro do anúncio) é obrigatória pra propor o arco.' });
  }
  // Música inteira pode ir até 10 min (600s). O teto de 120s é POR SEÇÃO e o
  // /generate fatia seções longas sozinho — então aqui o alvo total é livre.
  const totalSec = Math.max(5, Math.min(600, Number(totalDurationSec) || 30));
  const totalMs = Math.round(totalSec * 1000);

  const prefs = [
    style ? `Gênero/vibe: ${style}.` : '',
    energy ? `Energia geral: ${energy}.` : '',
    tempo ? `Andamento: ${tempo}.` : '',
    Array.isArray(instruments) && instruments.length
      ? `Instrumentos em destaque: ${instruments.join(', ')}.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  const SYSTEM = `Você é um diretor musical de anúncios. Recebe o ROTEIRO (texto falado) de um anúncio e monta o ARCO EMOCIONAL da trilha instrumental de fundo, dividido em SEÇÕES com tempos, onde CADA seção reflete a parte da copy que ela cobre.

Princípio central: a trilha é baseada 100% na COPY/TEXTO FALADO — NÃO existe uma "emoção-base" pré-definida. LEIA a copy e deixe a música REFLETIR CADA PARTE dela, seguindo a emoção real de cada trecho do texto. A faixa é uma JORNADA que se TRANSFORMA conforme a copy avança, nunca uma emoção só do início ao fim. Mapeie o texto: onde a copy dói, a música tensiona; onde a copy dá esperança, a música floresce; onde chama pra ação, a música levanta.
- Parte do PROBLEMA/dor → contida, tensa ou minimalista (ex: "tense ambient", "sparse piano", "uneasy strings"). Aqui SIM pode ser sombrio/pesado se a copy for de dor.
- VIRADA/descoberta → alívio, primeira luz (ex: "warm pad", "hopeful build").
- SOLUÇÃO/benefícios → emoção floresce, ascendente e cheia (ex: "uplifting strings", "bright arpeggio").
- CTA/fechamento → lift final confiante, com energia ("confident percussion", "triumphant").

Regras:
- Some das durações das seções = EXATAMENTE ${totalMs}ms (a duração do vídeo). Isso é OBRIGATÓRIO — não entregue um total menor. Distribua proporcionalmente ao peso de cada parte no roteiro.
- Use de 2 a 6 seções. Cada seção mínimo 3000ms. Se o vídeo for longo, use seções MAIORES e/ou MAIS seções pra fechar o total — NÃO encolha a música pra caber em poucas seções curtas. O sistema fatia seções longas sozinho depois, então não se preocupe com teto por seção; foque em bater o total ${totalMs}ms.
- Estilos descritos em INGLÊS curto (a API de música espera inglês), ex: "soft piano", "tense ambient pad", "uplifting strings", "hopeful build", "confident percussion".
- negativeLocalStyles: o que EVITAR naquela seção (ex: "drums" na parte calma, "melancholic" na parte de esperança).
- positiveGlobalStyles: o estilo que vale pra faixa inteira (gênero, instrumentação base, "instrumental", "no vocals").
${prefs ? `\nPreferências do cliente (RESPEITE): ${prefs}` : ''}

Responda APENAS um JSON, sem markdown, sem prosa:
{
  "positiveGlobalStyles": ["instrumental", "no vocals", "..."],
  "negativeGlobalStyles": ["vocals", "lyrics"],
  "sections": [
    { "sectionName": "Problema (calmo)", "positiveLocalStyles": ["soft piano", "tense ambient"], "negativeLocalStyles": ["drums", "upbeat"], "durationMs": 8000 },
    { "sectionName": "Solução (esperança)", "positiveLocalStyles": ["uplifting strings", "hopeful build"], "negativeLocalStyles": ["melancholic"], "durationMs": 14000 },
    { "sectionName": "CTA (lift)", "positiveLocalStyles": ["confident percussion", "triumphant"], "negativeLocalStyles": [], "durationMs": 8000 }
  ]
}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: `Duração-alvo: ${totalSec}s (${totalMs}ms).${dominantEmotion ? `\nEMOÇÃO DOMINANTE: ${dominantEmotion} (respeite — é o tom-base da faixa inteira).` : ''}${productInfo?.productName || productInfo?.audience ? `\nPRODUTO/PÚBLICO: ${productInfo.productName || ''} ${productInfo.audience ? `— público: ${productInfo.audience}` : ''}` : ''}\n\nROTEIRO DO ANÚNCIO:\n${copy.trim().substring(0, 6000)}`,
          },
        ],
      }),
    });
    if (!r.ok) {
      const errText = await r.text();
      log.error(`[Music Plan] Claude HTTP ${r.status}: ${errText.substring(0, 200)}`);
      return res.status(r.status).json({ error: `Claude: ${errText.substring(0, 200)}` });
    }
    const data = await r.json();
    const textBlock = Array.isArray(data.content)
      ? data.content.find((b: any) => b?.type === 'text')
      : null;
    const raw = textBlock?.text || '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Claude não retornou um plano válido.' });
    }
    const plan = JSON.parse(jsonMatch[0]);

    // Normaliza pro total bater exatamente com a duração do vídeo (ajusta a
    // última seção pra absorver arredondamentos).
    if (Array.isArray(plan.sections) && plan.sections.length) {
      plan.sections = plan.sections.map((s: any) => ({
        sectionName: String(s.sectionName || 'Seção'),
        positiveLocalStyles: Array.isArray(s.positiveLocalStyles) ? s.positiveLocalStyles : [],
        negativeLocalStyles: Array.isArray(s.negativeLocalStyles) ? s.negativeLocalStyles : [],
        durationMs: Math.max(3000, Math.min(600000, Number(s.durationMs) || 8000)),
      }));
      const sum = plan.sections.reduce((a: number, s: any) => a + s.durationMs, 0);
      const diff = totalMs - sum;
      const last = plan.sections[plan.sections.length - 1];
      last.durationMs = Math.max(3000, last.durationMs + diff);
    }
    res.json({
      positiveGlobalStyles: Array.isArray(plan.positiveGlobalStyles)
        ? plan.positiveGlobalStyles
        : ['instrumental', 'no vocals'],
      negativeGlobalStyles: Array.isArray(plan.negativeGlobalStyles)
        ? plan.negativeGlobalStyles
        : ['vocals', 'lyrics'],
      sections: plan.sections || [],
    });
  } catch (err: any) {
    log.error('[Music Plan] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/elevenlabs/music/recommend
//
// Recomenda os MELHORES controles de trilha (estilo, energia, ritmo,
// instrumentos) de forma PERSONALIZADA pro projeto: usa a copy + oferta/
// produto + persona + plano de marketing. Devolve ids que casam EXATAMENTE
// com os presets do front (STYLE/ENERGY/TEMPO/INSTRUMENT _OPTIONS) + um
// porquê curto. Claude Sonnet sem thinking (tarefa leve, custo baixo).
//
// Body:
//   copy?: string
//   productInfo?: object   — oferta/produto
//   personas?: object[]    — personasWithWeights (name/description/painPoints)
//   marketingPlan?: object — plano (tom/emoção/awareness)
//   creativeBriefs?: object[] — briefs (emotion/angle)
elevenLabsRouter.post('/music/recommend', async (req, res) => {
  const apiKey = getClaudeKey();
  if (!apiKey) {
    return res.status(500).json({ error: 'CLAUDE_API_KEY não configurada.' });
  }
  const { copy, productInfo, personas, marketingPlan, creativeBriefs } = req.body || {};

  // Monta um briefing compacto do projeto (corta pra não estourar tokens).
  const trim = (s: any, n: number) =>
    typeof s === 'string' ? s.substring(0, n) : s ? JSON.stringify(s).substring(0, n) : '';
  const personaSummary = Array.isArray(personas)
    ? personas
        .slice(0, 3)
        .map(
          (p: any) =>
            `- ${p?.name || 'Persona'}: ${trim(p?.description, 200)}${
              Array.isArray(p?.painPoints) && p.painPoints.length
                ? ` | dores: ${p.painPoints.slice(0, 3).join('; ')}`
                : ''
            }`
        )
        .join('\n')
    : '';
  const briefSummary = Array.isArray(creativeBriefs)
    ? Array.from(
        new Set(
          creativeBriefs
            .slice(0, 12)
            .map((b: any) => `${b?.emotion || ''}/${b?.angle || ''}`)
            .filter((s) => s !== '/')
        )
      ).join(', ')
    : '';

  const SYSTEM = `Você é um diretor musical de anúncios de resposta direta. Recebe o contexto de um projeto (oferta, persona, copy, plano) e recomenda a MELHOR trilha instrumental de fundo pra esse anúncio específico.

Escolha SOMENTE entre estas opções (devolva os IDs exatos):
- styleId: cinematic | corporate | lofi | epic | acoustic | electronic | pop
- energyId: baixa | media | alta
- tempoId: calmo | medio | acelerado
- instrumentIds (1 a 3): piano | strings | guitar | drums | synth | perc

Pense no público e na emoção: oferta séria/saúde/dor crônica → mais sóbrio/cinematográfico, energia baixa-média; oferta aspiracional/ganhar dinheiro/transformação → épico/uplifting, energia média-alta; oferta jovem/digital → electronic/pop. A trilha NUNCA pode competir com a voz — é fundo.

Responda APENAS um JSON, sem markdown:
{
  "styleId": "...",
  "energyId": "...",
  "tempoId": "...",
  "instrumentIds": ["...", "..."],
  "reasoning": "1-2 frases em PT-BR explicando por que essa combinação funciona pra ESTE projeto (cite a persona/oferta)."
}`;

  const userMsg = `OFERTA/PRODUTO:\n${trim(productInfo, 1200) || '(não informado)'}\n\nPERSONA(S):\n${
    personaSummary || '(não informado)'
  }\n\nEMOÇÕES/ÂNGULOS DOS CRIATIVOS: ${briefSummary || '(não informado)'}\n\nPLANO DE MARKETING:\n${
    trim(marketingPlan, 800) || '(não informado)'
  }\n\nROTEIRO/COPY DO ANÚNCIO:\n${trim(copy, 4000) || '(não informado)'}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        system: SYSTEM,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });
    if (!r.ok) {
      const errText = await r.text();
      log.error(`[Music Rec] Claude HTTP ${r.status}: ${errText.substring(0, 200)}`);
      return res.status(r.status).json({ error: `Claude: ${errText.substring(0, 200)}` });
    }
    const data = await r.json();
    const textBlock = Array.isArray(data.content)
      ? data.content.find((b: any) => b?.type === 'text')
      : null;
    const raw = textBlock?.text || '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Claude não retornou recomendação válida.' });
    }
    const rec = JSON.parse(jsonMatch[0]);

    // Valida contra os presets aceitos (defensivo — se o modelo inventar id,
    // cai num default seguro).
    const STYLES = ['cinematic', 'corporate', 'lofi', 'epic', 'acoustic', 'electronic', 'pop'];
    const ENERGIES = ['baixa', 'media', 'alta'];
    const TEMPOS = ['calmo', 'medio', 'acelerado'];
    const INSTR = ['piano', 'strings', 'guitar', 'drums', 'synth', 'perc'];
    res.json({
      styleId: STYLES.includes(rec.styleId) ? rec.styleId : 'cinematic',
      energyId: ENERGIES.includes(rec.energyId) ? rec.energyId : 'media',
      tempoId: TEMPOS.includes(rec.tempoId) ? rec.tempoId : 'medio',
      instrumentIds: Array.isArray(rec.instrumentIds)
        ? rec.instrumentIds.filter((x: string) => INSTR.includes(x)).slice(0, 3)
        : [],
      reasoning: typeof rec.reasoning === 'string' ? rec.reasoning : '',
    });
  } catch (err: any) {
    log.error('[Music Rec] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
