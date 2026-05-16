import { Router } from 'express';
import fs from 'fs';
import { getClaudeKey } from '../config/apiKeys.js';
import { CLAUDE_CONFIG_PATH } from '../config/paths.js';

export const claudeRouter = Router();

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6';

// POST /api/claude/config
claudeRouter.post('/config', async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'API Key is required.' });

  const trimmedKey = apiKey.trim().replace(/^["']|["']$/g, '');

  try {
    fs.writeFileSync(CLAUDE_CONFIG_PATH, JSON.stringify({ apiKey: trimmedKey }, null, 2));
    console.log('[Claude Config] API Key updated successfully.');
    res.json({ message: 'Claude API Key updated successfully.' });
  } catch (err: any) {
    console.error('[Claude Config] Error saving config:', err);
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

  const { system, user, max_tokens = 2000 } = req.body || {};
  if (!user) {
    return res.status(400).json({ success: false, error: 'O campo "user" é obrigatório.' });
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
        max_tokens,
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
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('[Claude] Anthropic API error:', response.status, text.substring(0, 500));
      return res.status(response.status).json({
        success: false,
        error: `Claude API error: ${response.status} ${text.substring(0, 300)}`,
      });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text;
    if (!text) {
      return res.status(500).json({
        success: false,
        error: 'Claude retornou resposta sem texto.',
      });
    }
    res.json({ success: true, text });
  } catch (err: any) {
    console.error('[Claude] Exception:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
