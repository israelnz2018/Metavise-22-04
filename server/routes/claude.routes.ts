import { Router } from 'express';
import fs from 'fs';
import { getClaudeKey } from '../config/apiKeys.js';
import { CLAUDE_CONFIG_PATH } from '../config/paths.js';

export const claudeRouter = Router();

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
// Opus 4.7 is Anthropic's strongest model — best for the kind of nuanced,
// emotion-aware copy this app produces. Sonnet 4.6 is ~5× cheaper and faster
// but visibly worse at creative writing. Override per-call by passing a
// `model` field in the request body if you need to A/B compare.
const DEFAULT_MODEL = 'claude-opus-4-7';
// Extended thinking — Opus 4.7 uses the newer "adaptive" mode controlled by
// output_config.effort ('low' | 'medium' | 'high'). Higher effort = more
// internal reasoning, better copy quality, higher cost.
const THINKING_EFFORT = 'high';
const DEFAULT_MAX_TOKENS = 12000;

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

  const {
    system,
    user,
    // Callers in claudeService.ts pass max_tokens=2000, not enough for the
    // 5000-token thinking budget + actual reply. Treat the caller value as
    // a floor and bump up to DEFAULT_MAX_TOKENS when needed.
    max_tokens: requestedMaxTokens = DEFAULT_MAX_TOKENS,
    model = DEFAULT_MODEL,
    thinking = true,
  } = req.body || {};
  if (!user) {
    return res.status(400).json({ success: false, error: 'O campo "user" é obrigatório.' });
  }

  const max_tokens = Math.max(requestedMaxTokens, DEFAULT_MAX_TOKENS);

  console.log(
    `[Claude] /complete model=${model} thinking=${thinking ? THINKING_EFFORT : 'off'} ` +
      `max_tokens=${max_tokens} user_len=${user.length}`
  );

  const body = JSON.stringify({
    model,
    max_tokens,
    // Extended thinking — Claude reasons internally before replying.
    // Disable per-call by sending `"thinking": false`. Opus 4.7 only
    // accepts the 'adaptive' shape; older models used 'enabled' with a
    // budget_tokens field.
    ...(thinking
      ? {
          thinking: { type: 'adaptive' },
          output_config: { effort: THINKING_EFFORT },
        }
      : {}),
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
  });

  // Retry on Anthropic's transient overload (529) and rate-limit (429)
  // responses with exponential backoff (1s, 2s, 4s). 5xx server errors
  // also retried since they're typically intermittent. Other failures
  // (auth, bad request) bubble up immediately.
  const MAX_ATTEMPTS = 4;
  try {
    let response: Response | null = null;
    let lastText = '';

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      response = await fetch(ANTHROPIC_API, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body,
      });

      if (response.ok) break;

      lastText = await response.text();
      const retryable = response.status === 529 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS) {
        console.error(
          `[Claude] Anthropic API error (attempt ${attempt}/${MAX_ATTEMPTS}):`,
          response.status,
          lastText.substring(0, 500)
        );
        return res.status(response.status).json({
          success: false,
          error: `Claude API error: ${response.status} ${lastText.substring(0, 300)}`,
        });
      }

      const delay = 1000 * Math.pow(2, attempt - 1);
      console.warn(
        `[Claude] ${response.status} on attempt ${attempt}/${MAX_ATTEMPTS}, retrying in ${delay}ms…`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    if (!response || !response.ok) {
      return res.status(503).json({
        success: false,
        error: 'Claude indisponível após múltiplas tentativas. Tente novamente em alguns minutos.',
      });
    }

    const data = await response.json();
    // With extended thinking enabled, response.content has a 'thinking' block
    // followed by a 'text' block. Pick by type, not by index.
    const textBlock = Array.isArray(data.content)
      ? data.content.find((b: any) => b?.type === 'text')
      : null;
    const text = textBlock?.text;
    if (!text) {
      console.error('[Claude] No text block in response:', JSON.stringify(data).substring(0, 500));
      return res.status(500).json({
        success: false,
        error: 'Claude retornou resposta sem texto.',
      });
    }

    const usage = data.usage || {};
    console.log(
      `[Claude] reply ok — input=${usage.input_tokens} cache_read=${usage.cache_read_input_tokens ?? 0} cache_write=${usage.cache_creation_input_tokens ?? 0} output=${usage.output_tokens} stop_reason=${data.stop_reason}`
    );
    res.json({ success: true, text });
  } catch (err: any) {
    console.error('[Claude] Exception:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
