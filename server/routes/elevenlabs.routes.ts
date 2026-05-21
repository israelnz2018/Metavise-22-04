import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import admin from 'firebase-admin';
import { getElevenLabsKey } from '../config/apiKeys.js';
import { CONFIG_PATH, GENERATED_DIR } from '../config/paths.js';
import { createLogger } from '../utils/logger.js';
const log = createLogger('ElevenLabs');

export const elevenLabsRouter = Router();

// GET /api/elevenlabs/voices
elevenLabsRouter.get('/voices', async (_req, res) => {
  const apiKey = getElevenLabsKey();

  try {
    log.info('[ElevenLabs Proxy] Fetching voices...');
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
    res.json(data);
  } catch (err: any) {
    log.error('[ElevenLabs Proxy] Voices Exception:', err);
    res.status(500).json({ error: `Failed to fetch voices from ElevenLabs: ${err.message}` });
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

  // Filters that may be safely relaxed when the combination yields 0
  // voices. Order matters only as a tiebreaker when multiple single-drop
  // candidates produce the same count — earlier = preferred to drop.
  const OPTIONAL: ('descriptive' | 'use_case' | 'accent')[] = [
    'descriptive',
    'use_case',
    'accent',
  ];

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
      : (json.voices || []).filter(
          (v: any) => (v.cloned_by_count ?? 0) >= QUALITY_FLOOR
        );

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

    res.json({
      voices,
      has_more: json.has_more,
      total_count: json.total_count,
      relaxed,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
      log.error(
        '[VozPremium] Firebase Storage upload falhou, usando local:',
        uploadErr.message
      );
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
