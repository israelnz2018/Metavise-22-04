import { Router } from 'express';
import fs from 'fs';
import { getPexelsKey } from '../config/apiKeys.js';
import { PEXELS_CONFIG_PATH } from '../config/paths.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Pexels');
const PEXELS_BASE = 'https://api.pexels.com/videos';

export const pexelsRouter = Router();

// POST /api/pexels/config  { apiKey }
// Grava pexels-config.json (mesmo padrão das outras chaves).
pexelsRouter.post('/config', async (req, res) => {
  const { apiKey } = req.body || {};
  if (!apiKey) return res.status(400).json({ error: 'API Key is required.' });
  const trimmed = String(apiKey).trim().replace(/^["']|["']$/g, '');
  try {
    fs.writeFileSync(PEXELS_CONFIG_PATH, JSON.stringify({ apiKey: trimmed }, null, 2));
    log.info('[Pexels Config] API Key salva.');
    res.json({ message: 'Pexels API Key salva com sucesso.' });
  } catch (err: any) {
    res.status(500).json({ error: `Falha ao salvar a chave: ${err.message}` });
  }
});

// GET /api/pexels/search?query=&perPage=&orientation=
// Busca clipes de vídeo no Pexels e devolve candidatos já curados (1 mp4 bom
// por clipe + thumbnail + duração). É só BUSCA — quem insere no vídeo é o
// /api/video/broll. Pexels é grátis e permite uso comercial.
pexelsRouter.get('/search', async (req, res) => {
  const apiKey = getPexelsKey();
  if (!apiKey) {
    return res.status(500).json({ error: 'PEXELS_API_KEY não configurada.' });
  }
  const query = String(req.query.query || '').trim();
  if (!query) return res.status(400).json({ error: 'query é obrigatório.' });

  const perPage = Math.max(1, Math.min(Number(req.query.perPage) || 8, 30));
  const orientationRaw = String(req.query.orientation || '');
  const orientation = ['landscape', 'portrait', 'square'].includes(orientationRaw)
    ? orientationRaw
    : undefined;

  try {
    const url = new URL(`${PEXELS_BASE}/search`);
    url.searchParams.set('query', query);
    url.searchParams.set('per_page', String(perPage));
    if (orientation) url.searchParams.set('orientation', orientation);

    const r = await fetch(url, { headers: { Authorization: apiKey } });
    if (!r.ok) {
      const t = await r.text();
      return res
        .status(r.status)
        .json({ error: `Pexels error: ${r.status} ${t.substring(0, 150)}` });
    }
    const data: any = await r.json();

    // Pra cada vídeo, escolhe UM mp4 razoável (maior largura até 1920p) —
    // evita baixar 4K à toa e mantém qualidade boa pro render.
    const clips = ((data.videos as any[]) || [])
      .map((v: any) => {
        const files = ((v.video_files as any[]) || []).filter(
          (f: any) => f.file_type === 'video/mp4' && f.link
        );
        const sorted = files.slice().sort((a: any, b: any) => (b.width || 0) - (a.width || 0));
        const pick =
          sorted.find((f: any) => (f.width || 0) <= 1920) || sorted[sorted.length - 1] || files[0];
        return {
          id: v.id,
          duration: v.duration,
          thumb: v.image,
          width: pick?.width,
          height: pick?.height,
          url: pick?.link,
          author: v.user?.name,
        };
      })
      .filter((c: any) => c.url);

    res.json({ success: true, clips });
  } catch (err: any) {
    log.error('[Pexels search] erro:', err);
    res.status(500).json({ error: err.message });
  }
});
