import { Router } from 'express';
import fs from 'fs';
import { getRunwayKey } from '../config/apiKeys.js';
import { RUNWAY_CONFIG_PATH } from '../config/paths.js';

export const runwayRouter = Router();

const HOSTNAMES = ['api.dev.runwayml.com', 'api.runwayml.com'];

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
