import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { getRunwayKey } from '../config/apiKeys.js';
import { GENERATED_DIR, RUNWAY_CONFIG_PATH } from '../config/paths.js';
import { downloadFile } from '../utils/download.js';

export const runwayRouter = Router();

const HOSTNAMES = ['api.dev.runwayml.com', 'api.runwayml.com'];
const TASK_PATHS = ['/v1/tasks', '/tasks'];

// POST /api/runway/generate
runwayRouter.post('/generate', async (req, res) => {
  const { promptText, duration, ratio, model } = req.body;
  const runwayKey = getRunwayKey();

  if (!runwayKey) {
    return res.status(500).json({
      error:
        'Runway API Key is missing in backend environment variables (RUNWAY_API_KEY) or runway-config.json.',
    });
  }

  try {
    const runwayModel = (model as string) || 'gen3a_turbo';
    const runwayRatio = ratio === '16:9' ? '16:9' : '9:16';
    const runwaySeconds = Number(duration) === 10 ? 10 : 5;

    console.log(`[Runway Proxy] Initiating generation: ${promptText.substring(0, 50)}...`, {
      model: runwayModel,
      ratio: runwayRatio,
      seconds: runwaySeconds,
    });

    let lastError: Error | null = null;

    for (const hostname of HOSTNAMES) {
      for (const apiPath of TASK_PATHS) {
        try {
          console.log(`[Runway Proxy] Trying: https://${hostname}${apiPath}`);
          const response = await fetch(`https://${hostname}${apiPath}`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${runwayKey}`,
              'X-Runway-Version': '2024-11-06',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: runwayModel,
              promptText,
              ratio: runwayRatio,
              seconds: runwaySeconds,
            }),
          });

          if (!response.ok) {
            const status = response.status;
            const errorData = await response.json().catch(() => ({}));
            const msg = errorData.error || response.statusText;
            lastError = new Error(`${msg} (${status})`);

            if (status === 404) {
              console.warn(`[Runway Proxy] ${hostname}${apiPath} returned 404. Trying next...`);
              continue;
            }

            // When api.runwayml.com tells us to switch to api.dev, retry.
            if (
              status === 401 &&
              hostname === 'api.runwayml.com' &&
              JSON.stringify(errorData).includes('api.dev.runwayml.com')
            ) {
              console.warn(
                `[Runway Proxy] api.runwayml.com requested switch to api.dev.runwayml.com.`
              );
              continue;
            }

            console.error(
              `[Runway Proxy] ${hostname}${apiPath} failed with ${status}:`,
              JSON.stringify(errorData)
            );
            throw lastError;
          }

          const task = await response.json();
          console.log(`[Runway Proxy] Task created on ${hostname}: ${task.id}`);
          return res.json({ taskId: task.id, status: 'PENDING', hostname });
        } catch (err: any) {
          // Only bubble out once both loops are exhausted
          if (
            hostname === HOSTNAMES[HOSTNAMES.length - 1] &&
            apiPath === TASK_PATHS[TASK_PATHS.length - 1]
          ) {
            throw err;
          }
          console.warn(`[Runway Proxy] Failed with ${hostname}${apiPath}: ${err.message}.`);
        }
      }
    }
  } catch (err: any) {
    console.error('[Runway Proxy] Generation failed:', err);
    res.status(500).json({ error: err.message || 'Unknown Runway error' });
  }
});

// GET /api/runway/status/:taskId
runwayRouter.get('/status/:taskId', async (req, res) => {
  const { taskId } = req.params;
  const runwayKey = getRunwayKey();

  if (!runwayKey) return res.status(500).json({ error: 'Runway API Key missing.' });

  try {
    let task: any = null;

    for (const hostname of HOSTNAMES) {
      try {
        const response = await fetch(`https://${hostname}/v1/tasks/${taskId}`, {
          headers: {
            Authorization: `Bearer ${runwayKey}`,
            'X-Runway-Version': '2024-11-06',
          },
        });

        if (!response.ok) {
          if (response.status === 404) continue;
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData.error || `Runway API error: ${response.statusText} (${response.status})`
          );
        }

        task = await response.json();
        break;
      } catch (err) {
        if (hostname === HOSTNAMES[HOSTNAMES.length - 1]) throw err;
      }
    }

    if (!task) throw new Error('Task not found on any known Runway endpoint.');

    if (task.status === 'SUCCEEDED' && task.output && task.output.length > 0) {
      // Cache the result locally so the SPA can play it from /generated/.
      const videoUrl = task.output[0];
      const filename = `runway_${taskId}_${Date.now()}.mp4`;
      const filePath = path.join(GENERATED_DIR, filename);

      if (!fs.existsSync(filePath)) {
        console.log(`[Runway Proxy] Task succeeded. Downloading result: ${videoUrl}`);
        await downloadFile(videoUrl, filePath);
      }

      return res.json({
        status: task.status,
        videoUrl: `/generated/${filename}`,
        originalOutput: task.output,
      });
    }

    res.json({ status: task.status, progress: task.progress });
  } catch (err: any) {
    console.error(`[Runway Proxy] Status check failed for ${taskId}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/runway/config
runwayRouter.post('/config', async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'API Key is required.' });

  try {
    fs.writeFileSync(RUNWAY_CONFIG_PATH, JSON.stringify({ apiKey }, null, 2));
    res.json({ message: 'Runway API Key updated successfully.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/runway/health
runwayRouter.get('/health', async (_req, res) => {
  const runwayKey = getRunwayKey();
  if (!runwayKey) {
    return res.status(500).json({ status: 'error', message: 'RUNWAY_API_KEY is missing.' });
  }

  try {
    let org: any = null;

    for (const hostname of HOSTNAMES) {
      try {
        const response = await fetch(`https://${hostname}/v1/organization`, {
          headers: {
            Authorization: `Bearer ${runwayKey}`,
            'X-Runway-Version': '2024-11-06',
          },
        });

        if (!response.ok) {
          if (response.status === 404) continue;
          throw new Error(`Runway API error: ${response.statusText} (${response.status})`);
        }

        org = await response.json();
        break;
      } catch (err) {
        if (hostname === HOSTNAMES[HOSTNAMES.length - 1]) throw err;
      }
    }

    if (!org) {
      throw new Error('Could not fetch organization info from any known Runway endpoint.');
    }
    res.json({ status: 'ok', message: `Conexão bem-sucedida! Créditos: ${org.creditBalance}` });
  } catch (err: any) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});
