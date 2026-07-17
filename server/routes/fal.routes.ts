// Rotas do fal.ai — geração de VÍDEO (Kling 3.0 / Seedance 2.0) pro fluxo do
// Metavise. Clipes MUDOS (generate_audio:false) que vão pra Montagem; a voz do
// ElevenLabs entra por cima depois. Usa a QUEUE API do fal via fetch (mesmo
// estilo do resto do backend, sem SDK novo).
//
// Chave: getFalKey() (fal-config.json ou FAL_KEY no .env). NUNCA commitada.

import { Router } from 'express';
import { getFalKey } from '../config/apiKeys.js';
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
    // Menos de 10s por pedido do usuário: clamp 3–9s.
    const durationSec = Math.max(3, Math.min(9, Math.round(Number(b.durationSec) || 5)));
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
