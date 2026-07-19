// Rotas do fal.ai — geração de VÍDEO (Kling 3.0 / Seedance 2.0) pro fluxo do
// Metavise. Clipes MUDOS (generate_audio:false) que vão pra Montagem; a voz do
// ElevenLabs entra por cima depois. Usa a QUEUE API do fal via fetch (mesmo
// estilo do resto do backend, sem SDK novo).
//
// Chave: getFalKey() (fal-config.json ou FAL_KEY no .env). NUNCA commitada.

import { Router } from 'express';
import admin from 'firebase-admin';
import { getFalKey, getFalAdminKey } from '../config/apiKeys.js';
import { persistVideo } from '../utils/persistVideo.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Fal');
export const falRouter = Router();

// Model IDs no fal. Os endpoints image-to-video foram confirmados nas páginas do
// fal; os text-to-video seguem o mesmo path trocando o sufixo. Se algum estiver
// errado, o fal devolve erro claro e é só ajustar aqui.
const FAL_VIDEO_MODELS: Record<string, { text: string; image: string }> = {
  kling: {
    text: 'fal-ai/kling-video/v3/pro/text-to-video',
    image: 'fal-ai/kling-video/v3/pro/image-to-video',
  },
  seedance: {
    text: 'bytedance/seedance-2.0/text-to-video',
    image: 'bytedance/seedance-2.0/image-to-video',
  },
};

const FAL_QUEUE = 'https://queue.fal.run';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Submete um job na fila do fal e faz polling até COMPLETED (vídeo demora
// minutos). Até ~6 min (120 × 3s). Retorna o JSON de saída do modelo.
async function runFalJob(
  modelId: string,
  input: Record<string, unknown>,
  apiKey: string
): Promise<any> {
  const headers = { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' };
  const sub = await fetch(`${FAL_QUEUE}/${modelId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });
  const subData: any = await sub.json().catch(() => ({}));
  if (!sub.ok) {
    const d = subData?.detail ? JSON.stringify(subData.detail) : `HTTP ${sub.status}`;
    throw new Error(`fal submit: ${d}`);
  }
  const statusUrl = subData.status_url;
  const responseUrl = subData.response_url;
  if (!statusUrl || !responseUrl) throw new Error('fal não retornou status_url/response_url.');

  const started = Date.now();
  for (let i = 0; i < 120; i++) {
    await sleep(3000);
    const st = await fetch(statusUrl, { headers });
    const stData: any = await st.json().catch(() => ({}));
    const status = stData?.status;
    if (status === 'COMPLETED') {
      const rr = await fetch(responseUrl, { headers });
      const out: any = await rr.json().catch(() => ({}));
      if (!rr.ok) {
        const d = out?.detail ? JSON.stringify(out.detail) : `HTTP ${rr.status}`;
        throw new Error(`fal result: ${d}`);
      }
      return out;
    }
    if (status === 'FAILED' || status === 'ERROR') {
      throw new Error(`fal job falhou: ${JSON.stringify(stData).substring(0, 200)}`);
    }
    // IN_QUEUE / IN_PROGRESS → segue no loop.
  }
  throw new Error(`fal timeout após ${Math.round((Date.now() - started) / 1000)}s.`);
}

// GET /api/fal/balance — saldo de créditos do fal (usa a chave ADMIN).
// Retorna { balance, currency } ou { error } se não houver chave admin.
falRouter.get('/balance', async (_req, res) => {
  const adminKey = getFalAdminKey();
  if (!adminKey) {
    return res.status(400).json({ error: 'Sem chave Admin do fal (adminKey em fal-config.json).' });
  }
  try {
    const r = await fetch('https://api.fal.ai/v1/account/billing?expand=credits', {
      headers: { Authorization: `Key ${adminKey}` },
    });
    const d: any = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = d?.error?.message || `HTTP ${r.status}`;
      return res.status(r.status).json({ error: `fal billing: ${msg}` });
    }
    res.json({ balance: d?.credits?.current_balance ?? null, currency: d?.credits?.currency || 'USD' });
  } catch (err: any) {
    log.error('[fal/balance] erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/fal/image — gera IMAGEM com Nano Banana. Sem referência = texto→imagem
// (fal-ai/nano-banana); com imageUrls = edição/composição (fal-ai/nano-banana/edit,
// ex.: "a mulher segurando ESSA boneca"). Persiste no Storage → URL estável.
// Body: { prompt, imageUrls?, aspectRatio?, userId } → { url }.
falRouter.post('/image', async (req, res) => {
  try {
    const apiKey = getFalKey();
    if (!apiKey) {
      return res
        .status(400)
        .json({ error: 'Configure a chave do fal (FAL_KEY no .env ou fal-config.json).' });
    }
    const b = (req.body || {}) as Record<string, any>;
    const prompt = String(b.prompt || '').trim();
    const imageUrls = Array.isArray(b.imageUrls) ? b.imageUrls.map(String).filter(Boolean) : [];
    const aspectRatio = String(b.aspectRatio || '1:1');
    const userId = b.userId ? String(b.userId) : undefined;
    if (!prompt && imageUrls.length === 0) {
      return res.status(400).json({ error: 'Informe um prompt (e/ou imagem de referência).' });
    }
    const hasRefs = imageUrls.length > 0;
    const model = hasRefs ? 'fal-ai/nano-banana/edit' : 'fal-ai/nano-banana';
    const input: Record<string, unknown> = { prompt, num_images: 1, aspect_ratio: aspectRatio };
    if (hasRefs) input.image_urls = imageUrls;

    log.info(`[fal/image] ${model} refs=${imageUrls.length} ${aspectRatio}`);
    // Nano Banana é rápido → chamada SÍNCRONA (fal.run), sem fila.
    const r = await fetch(`https://fal.run/${model}`, {
      method: 'POST',
      headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const d: any = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = d?.detail ? JSON.stringify(d.detail) : `HTTP ${r.status}`;
      throw new Error(`fal image: ${msg}`);
    }
    const imgUrl = d?.images?.[0]?.url;
    if (!imgUrl) throw new Error(`fal não retornou imagem: ${JSON.stringify(d).substring(0, 200)}`);

    const ir = await fetch(imgUrl);
    if (!ir.ok) throw new Error(`Falha ao baixar a imagem do fal (HTTP ${ir.status}).`);
    const buffer = Buffer.from(await ir.arrayBuffer());
    const { url } = await persistVideo({
      buffer,
      filename: `fal_img_${Date.now()}.png`,
      storageFolder: 'fal-image',
      userId,
      contentType: 'image/png',
    });
    log.info(`[fal/image] OK → ${url}`);
    res.json({ url, model });
  } catch (err: any) {
    log.error('[fal/image] erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/fal/videos?userId=... — lista os clipes fal já gerados (do Storage),
// pra a aba repopular a galeria ao abrir (nunca "some" um vídeo).
falRouter.get('/videos', async (req, res) => {
  const userId = String((req.query as any).userId || '');
  if (!userId) return res.status(400).json({ error: 'userId obrigatório.' });
  try {
    if (admin.apps.length === 0) return res.json({ videos: [] });
    const bucket = admin.storage().bucket();
    const [files] = await bucket.getFiles({ prefix: `fal/${userId}/` });
    const mp4s = files.filter((f) => f.name.endsWith('.mp4')).sort((a, b) => b.name.localeCompare(a.name)).slice(0, 60);
    const videos = await Promise.all(
      mp4s.map(async (f) => {
        const [url] = await f.getSignedUrl({ action: 'read', expires: '03-09-2491' });
        const name = f.name.split('/').pop() || '';
        return {
          url,
          // "synced" cobre tanto o antigo talking (VEED) quanto o lip-sync novo.
          talking: name.includes('talking') || name.includes('lipsync'),
          provider: name.includes('seedance') ? 'seedance' : 'kling',
          createdAt: (f.metadata?.timeCreated as string) || null,
        };
      })
    );
    res.json({ videos });
  } catch (err: any) {
    log.error('[fal/videos] erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/fal/images?userId=... — lista as imagens já geradas (Nano Banana) do
// Storage, pra galeria da aba Imagem IA não sumir.
falRouter.get('/images', async (req, res) => {
  const userId = String((req.query as any).userId || '');
  if (!userId) return res.status(400).json({ error: 'userId obrigatório.' });
  try {
    if (admin.apps.length === 0) return res.json({ images: [] });
    const bucket = admin.storage().bucket();
    const [files] = await bucket.getFiles({ prefix: `fal-image/${userId}/` });
    const pngs = files
      .filter((f) => f.name.endsWith('.png'))
      .sort((a, b) => b.name.localeCompare(a.name))
      .slice(0, 60);
    const images = await Promise.all(
      pngs.map(async (f) => {
        const [url] = await f.getSignedUrl({ action: 'read', expires: '03-09-2491' });
        return { url, createdAt: (f.metadata?.timeCreated as string) || null };
      })
    );
    res.json({ images });
  } catch (err: any) {
    log.error('[fal/images] erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/fal/lipsync — LIP-SYNC: casa a boca de um VÍDEO (clipe do Kling)
// com um ÁUDIO (voz do ElevenLabs). Só mexe na boca do rosto principal — não
// "dá vida" à boneca. Retorna { url }. Modelo: Sync Lipsync 2.0.
const FAL_LIPSYNC_MODEL = 'fal-ai/sync-lipsync/v2';
falRouter.post('/lipsync', async (req, res) => {
  try {
    const apiKey = getFalKey();
    if (!apiKey) {
      return res
        .status(400)
        .json({ error: 'Configure a chave do fal (FAL_KEY no .env ou fal-config.json).' });
    }
    const b = (req.body || {}) as Record<string, any>;
    const videoUrl = String(b.videoUrl || '');
    const audioUrl = String(b.audioUrl || '');
    const userId = b.userId ? String(b.userId) : undefined;
    if (!videoUrl || !audioUrl) {
      return res.status(400).json({ error: 'Informe o vídeo e o áudio (voz).' });
    }
    // loop: se o áudio for mais longo que o clipe, o vídeo dá loop pra cobrir a
    // fala inteira (mantém a boca falando até o fim do áudio).
    const input = { video_url: videoUrl, audio_url: audioUrl, sync_mode: 'loop' };
    log.info(`[fal/lipsync] ${FAL_LIPSYNC_MODEL}`);
    const out = await runFalJob(FAL_LIPSYNC_MODEL, input, apiKey);
    const outUrl = out?.video?.url;
    if (!outUrl) {
      throw new Error(`fal não retornou vídeo: ${JSON.stringify(out).substring(0, 200)}`);
    }
    const vr = await fetch(outUrl);
    if (!vr.ok) throw new Error(`Falha ao baixar o vídeo do fal (HTTP ${vr.status}).`);
    const buffer = Buffer.from(await vr.arrayBuffer());
    const { url } = await persistVideo({
      buffer,
      filename: `fal_lipsync_${Date.now()}.mp4`,
      storageFolder: 'fal',
      userId,
    });
    log.info(`[fal/lipsync] OK → ${url}`);
    res.json({ url, model: FAL_LIPSYNC_MODEL });
  } catch (err: any) {
    log.error('[fal/lipsync] erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/fal/video
// Body: { provider:'kling'|'seedance', prompt, imageUrl?, durationSec?,
//         aspectRatio?, resolution?, userId }
// Gera um clipe MUDO e persiste. Retorna { url, provider, model, durationSec }.
falRouter.post('/video', async (req, res) => {
  try {
    const apiKey = getFalKey();
    if (!apiKey) {
      return res
        .status(400)
        .json({ error: 'Configure a chave do fal (FAL_KEY no .env ou fal-config.json).' });
    }
    const b = (req.body || {}) as Record<string, any>;
    const provider = b.provider === 'seedance' ? 'seedance' : 'kling';
    const prompt = String(b.prompt || '').trim();
    const imageUrl = b.imageUrl ? String(b.imageUrl) : '';
    const userId = b.userId ? String(b.userId) : undefined;
    if (!prompt && !imageUrl) {
      return res.status(400).json({ error: 'Informe um prompt (e/ou uma imagem inicial).' });
    }
    // Duração EXATA escolhida pelo usuário — Kling aceita segundos inteiros 3–15.
    const durationSec = Math.max(3, Math.min(15, Math.round(Number(b.durationSec) || 5)));
    const aspectRatio = String(b.aspectRatio || '16:9');
    const resolution = String(b.resolution || '720p');
    const mode: 'text' | 'image' = imageUrl ? 'image' : 'text';
    const modelId = FAL_VIDEO_MODELS[provider]![mode];

    // Os campos de input diferem por modelo (Kling: start_image_url + duration
    // string; Seedance: image_url + duration número + resolution).
    let input: Record<string, unknown>;
    if (provider === 'kling') {
      input = { prompt, duration: String(durationSec), generate_audio: false };
      if (mode === 'image') input.start_image_url = imageUrl;
      else input.aspect_ratio = aspectRatio;
    } else {
      input = {
        prompt,
        duration: durationSec,
        resolution,
        aspect_ratio: aspectRatio,
        generate_audio: false,
      };
      if (mode === 'image') input.image_url = imageUrl;
    }

    log.info(`[fal/video] ${provider} ${mode} ${durationSec}s modelo=${modelId}`);
    const out = await runFalJob(modelId, input, apiKey);
    const videoUrl = out?.video?.url;
    if (!videoUrl) {
      throw new Error(`fal não retornou vídeo: ${JSON.stringify(out).substring(0, 200)}`);
    }

    // Baixa o vídeo do fal e persiste (mesmo padrão dos outros — URL estável).
    const vr = await fetch(videoUrl);
    if (!vr.ok) throw new Error(`Falha ao baixar o vídeo do fal (HTTP ${vr.status}).`);
    const buffer = Buffer.from(await vr.arrayBuffer());
    const { url } = await persistVideo({
      buffer,
      filename: `fal_${provider}_${Date.now()}.mp4`,
      storageFolder: 'fal',
      userId,
    });
    log.info(`[fal/video] OK ${provider} → ${url}`);
    res.json({ url, provider, model: modelId, durationSec });
  } catch (err: any) {
    log.error('[fal/video] erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/fal/talking — FOTO FALANDO (lip-sync): imagem + áudio (voz do
// ElevenLabs) → vídeo com a boca SINCRONIZADA (VEED Fabric 1.0). A duração
// segue o áudio. Retorna { url }.
const FAL_TALKING_MODEL = 'veed/fabric-1.0';
falRouter.post('/talking', async (req, res) => {
  try {
    const apiKey = getFalKey();
    if (!apiKey) {
      return res
        .status(400)
        .json({ error: 'Configure a chave do fal (FAL_KEY no .env ou fal-config.json).' });
    }
    const b = (req.body || {}) as Record<string, any>;
    const imageUrl = String(b.imageUrl || '');
    const audioUrl = String(b.audioUrl || '');
    const userId = b.userId ? String(b.userId) : undefined;
    const resolution = b.resolution === '720p' ? '720p' : '480p';
    if (!imageUrl || !audioUrl) {
      return res.status(400).json({ error: 'Informe a imagem e o áudio (voz).' });
    }
    const input = { image_url: imageUrl, audio_url: audioUrl, resolution };
    log.info(`[fal/talking] ${resolution} img+audio → ${FAL_TALKING_MODEL}`);
    const out = await runFalJob(FAL_TALKING_MODEL, input, apiKey);
    const videoUrl = out?.video?.url;
    if (!videoUrl) {
      throw new Error(`fal não retornou vídeo: ${JSON.stringify(out).substring(0, 200)}`);
    }
    const vr = await fetch(videoUrl);
    if (!vr.ok) throw new Error(`Falha ao baixar o vídeo do fal (HTTP ${vr.status}).`);
    const buffer = Buffer.from(await vr.arrayBuffer());
    const { url } = await persistVideo({
      buffer,
      filename: `fal_talking_${Date.now()}.mp4`,
      storageFolder: 'fal',
      userId,
    });
    log.info(`[fal/talking] OK → ${url}`);
    res.json({ url, model: FAL_TALKING_MODEL });
  } catch (err: any) {
    log.error('[fal/talking] erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});
