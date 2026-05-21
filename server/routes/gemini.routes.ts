import { Router } from 'express';
import fs from 'fs';
import { getGeminiKey } from '../config/apiKeys.js';
import { GEMINI_CONFIG_PATH } from '../config/paths.js';
import { createLogger } from '../utils/logger.js';
const log = createLogger('Gemini');

export const geminiRouter = Router();

// POST /api/gemini/config
// Saves the admin-supplied Gemini key to gemini-config.json. Mirrors the
// /heygen/config and /elevenlabs/config pattern.
geminiRouter.post('/config', async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'API Key is required.' });

  const trimmedKey = apiKey.trim().replace(/^["']|["']$/g, '');

  try {
    fs.writeFileSync(GEMINI_CONFIG_PATH, JSON.stringify({ apiKey: trimmedKey }, null, 2));
    log.info('[Gemini Config] API Key updated successfully.');
    res.json({ message: 'Gemini API Key updated successfully.' });
  } catch (err: any) {
    log.error('[Gemini Config] Error saving config:', err);
    res.status(500).json({ error: `Failed to save API Key: ${err.message}` });
  }
});

// GET /api/gemini/key
// Returns the configured Gemini key so the frontend can call Google's
// Generative Language API directly via @google/genai. The key is also
// embedded in any frontend bundle that hardcodes it, so this isn't a
// new exposure — it just lets the admin rotate keys without rebuilding.
// In a future hardening pass we should require auth here (admin only).
geminiRouter.get('/key', async (_req, res) => {
  const key = getGeminiKey();
  if (!key) {
    return res.status(404).json({ error: 'Gemini API Key not configured.' });
  }
  res.json({ apiKey: key });
});

// GET /api/gemini/health
// Pings Google's models list endpoint — returns 200 with a list when the
// key works, 401/403/etc. otherwise.
geminiRouter.get('/health', async (_req, res) => {
  const apiKey = getGeminiKey();
  if (!apiKey) {
    return res.status(500).json({ status: 'error', message: 'GEMINI_API_KEY is missing.' });
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );

    if (response.ok) {
      const data = await response.json();
      const modelCount = data.models?.length || 0;
      return res.json({
        status: 'ok',
        message: `Conectado! ${modelCount} modelos disponíveis.`,
      });
    } else {
      const errText = await response.text();
      return res
        .status(response.status)
        .json({ status: 'error', message: errText.substring(0, 200) });
    }
  } catch (err: any) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});
