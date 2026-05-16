import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import admin from 'firebase-admin';
import { getElevenLabsKey } from '../config/apiKeys.js';
import { CONFIG_PATH, GENERATED_DIR } from '../config/paths.js';
import { getCredits, hasCredits, deductCredits } from '../services/creditsService.js';

export const elevenLabsRouter = Router();

// POST /api/elevenlabs/tts/:voiceId
elevenLabsRouter.post('/tts/:voiceId', async (req, res) => {
  const { voiceId } = req.params;
  const { text, stability, similarity_boost } = req.body;

  const apiKey = getElevenLabsKey();

  if (!apiKey) {
    return res.status(500).json({
      error: 'ElevenLabs API Key is missing in backend environment variables (ELEVENLABS_API_KEY).',
    });
  }

  // 1 credit per 10 characters of synthesised text.
  const tokenCost = Math.ceil(text.length / 10);
  if (!hasCredits(tokenCost)) {
    return res
      .status(403)
      .json({ error: 'Créditos insuficientes. Por favor, recarregue seu saldo.' });
  }

  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    try {
      attempts++;
      console.log(`[ElevenLabs Proxy] Generating TTS for voice: ${voiceId} (Attempt ${attempts})`);
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_v3',
          voice_settings: {
            stability: stability || 0.5,
            similarity_boost: similarity_boost || 0.75,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `[ElevenLabs Proxy] TTS Error (${response.status}) on attempt ${attempts}:`,
          errorText
        );

        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText };
        }

        const isRateLimit = response.status === 429;
        const isSystemBusy =
          errorData.detail?.code === 'system_busy' || errorData.message?.includes('heavy traffic');

        if ((isRateLimit || isSystemBusy) && attempts < maxAttempts) {
          const delay = Math.pow(2, attempts) * 1000;
          console.log(`[ElevenLabs Proxy] System busy or rate limited, retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        return res.status(response.status).json(errorData);
      }

      deductCredits(tokenCost);

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Persist to disk so the SPA can re-fetch via /generated/.
      const filename = `audio_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`;
      const filePath = path.join(GENERATED_DIR, filename);
      fs.writeFileSync(filePath, buffer);

      const persistentUrl = `/generated/${filename}`;

      res.set('Access-Control-Expose-Headers', 'x-remaining-credits, x-audio-url');
      res.set('Content-Type', 'audio/mpeg');
      res.set('x-remaining-credits', getCredits().toString());
      res.set('x-audio-url', persistentUrl);
      return res.send(buffer);
    } catch (err: any) {
      console.error(`[ElevenLabs Proxy] TTS Exception on attempt ${attempts}:`, err);
      if (attempts < maxAttempts) {
        const delay = Math.pow(2, attempts) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      return res
        .status(500)
        .json({ error: `Failed to proxy request to ElevenLabs: ${err.message}` });
    }
  }
});

// GET /api/elevenlabs/voices
elevenLabsRouter.get('/voices', async (_req, res) => {
  const apiKey = getElevenLabsKey();

  try {
    console.log('[ElevenLabs Proxy] Fetching voices...');
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers['xi-api-key'] = apiKey;
    }

    let response = await fetch('https://api.elevenlabs.io/v1/voices', {
      method: 'GET',
      headers,
    });

    if (!response.ok && response.status === 401 && apiKey) {
      console.warn('[ElevenLabs Proxy] Invalid API key detected, falling back to public voices...');
      response = await fetch('https://api.elevenlabs.io/v1/voices', { method: 'GET' });
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[ElevenLabs Proxy] Voices Error (${response.status}):`, errorText);
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
    console.error('[ElevenLabs Proxy] Voices Exception:', err);
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
    console.log('[ElevenLabs Config] API Key updated successfully.');
    res.json({ message: 'ElevenLabs API Key updated successfully.' });
  } catch (err: any) {
    console.error('[ElevenLabs Config] Error saving config:', err);
    res.status(500).json({ error: `Failed to save API Key: ${err.message}` });
  }
});

// --- Premium voice features (mounted at /api/elevenlabs-premium) ---
export const elevenLabsPremiumRouter = Router();

elevenLabsPremiumRouter.get('/voices', async (req, res) => {
  const apiKey = getElevenLabsKey();
  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers['xi-api-key'] = apiKey;

    let r = await fetch('https://api.elevenlabs.io/v1/voices', { headers });

    if (!r.ok && r.status === 401) {
      console.warn(
        '[ElevenLabs Premium] Invalid API key detected, falling back to public voices...'
      );
      r = await fetch('https://api.elevenlabs.io/v1/voices', { method: 'GET' });
    }

    if (!r.ok) {
      console.error('ElevenLabs voices error:', await r.text());
      return res.status(r.status).json({ voices: [] });
    }

    const json = await r.json();
    let voices = json.voices || [];
    if (req.query.gender) voices = voices.filter((v: any) => v.labels?.gender === req.query.gender);
    if (req.query.age) voices = voices.filter((v: any) => v.labels?.age === req.query.age);
    if (req.query.language)
      voices = voices.filter((v: any) =>
        v.labels?.language?.toLowerCase().includes((req.query.language as string).toLowerCase())
      );
    if (req.query.use_case)
      voices = voices.filter((v: any) => v.labels?.use_case === req.query.use_case);
    if (req.query.search)
      voices = voices.filter((v: any) =>
        v.name.toLowerCase().includes((req.query.search as string).toLowerCase())
      );
    res.json({ voices });
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
      console.error(
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
    const { FormData, Blob } = await import('formdata-node');
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
      body: formData as any,
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
