// Rotas do fal.ai — geração de VÍDEO (Kling 3.0 / Seedance 2.0) pro fluxo do
// Metavise. Clipes MUDOS (generate_audio:false) que vão pra Montagem; a voz do
// ElevenLabs entra por cima depois. Usa a QUEUE API do fal via fetch (mesmo
// estilo do resto do backend, sem SDK novo).
//
// Chave: getFalKey() (fal-config.json ou FAL_KEY no .env). NUNCA commitada.

import { Router } from 'express';
import admin from 'firebase-admin';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';
// @ts-expect-error — ffprobe-static não tem types oficiais
import ffprobeStatic from 'ffprobe-static';
import { getFalKey, getFalAdminKey } from '../config/apiKeys.js';
import { persistVideo } from '../utils/persistVideo.js';
import { probeAudioDuration } from '../utils/audio.js';
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
    res.json({
      balance: d?.credits?.current_balance ?? null,
      currency: d?.credits?.currency || 'USD',
    });
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

// Extrai UM frame do vídeo no segundo `atSec` → PNG (buffer). Usa o ffmpeg-static
// que já shipamos. Serve de base pra capa (Nano Banana redesenha por cima).
function grabFrame(videoUrl: string, atSec: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const bin = (ffmpegStatic as unknown as string) || 'ffmpeg';
    const out = path.join(os.tmpdir(), `cover_${Date.now()}_${Math.round(atSec * 100)}.png`);
    const args = [
      '-y',
      '-ss',
      String(Math.max(0, atSec)),
      '-i',
      videoUrl,
      '-frames:v',
      '1',
      '-q:v',
      '2',
      out,
    ];
    const proc = spawn(bin, args);
    let errBuf = '';
    proc.stderr.on('data', (d) => (errBuf += d.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0 || !fs.existsSync(out)) {
        return reject(new Error(`ffmpeg frame falhou (code ${code}): ${errBuf.slice(-300)}`));
      }
      try {
        const buf = fs.readFileSync(out);
        fs.unlink(out, () => {});
        resolve(buf);
      } catch (e) {
        reject(e);
      }
    });
  });
}

// Parseia a saída do filtro `metadata=print:file=...` (formato
// "frame:N pts:N pts_time:T\nlavfi.signalstats.YAVG=V") em pares [tempo, valor].
function parseSignalstatsFile(filePath: string): Array<{ t: number; v: number }> {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const out: Array<{ t: number; v: number }> = [];
  let pendingT: number | null = null;
  for (const line of lines) {
    const tm = line.match(/pts_time:([\d.]+)/);
    if (tm) {
      pendingT = Number(tm[1]);
      continue;
    }
    const vm = line.match(/YAVG=([\d.]+)/);
    if (vm && pendingT !== null) {
      out.push({ t: pendingT, v: Number(vm[1]) });
      pendingT = null;
    }
  }
  return out;
}

// Escolhe os melhores instantes do vídeo pra virar capa, num ÚNICO passe de
// ffmpeg (decode-only, sem reencode — barato). Pontua cada segundo por:
//   - exposição (brilho perto do meio da faixa, nem estourado nem escuro)
//   - nitidez (energia de borda via sobel — evita pegar frame borrado/em
//     transição/em movimento)
//   - posição (leve preferência pela primeira metade do vídeo, onde o gancho
//     visual costuma estar)
// Retorna até `count` timestamps distintos, espaçados entre si.
async function pickBestFrames(
  videoUrl: string,
  durationSec: number,
  count: number
): Promise<number[]> {
  const bin = (ffmpegStatic as unknown as string) || 'ffmpeg';
  const stamp = Date.now();
  const brightFile = path.join(os.tmpdir(), `cover_bright_${stamp}.txt`);
  const sharpFile = path.join(os.tmpdir(), `cover_sharp_${stamp}.txt`);
  // Amostra 1x/s, limitado aos primeiros 60s (capas costumam vir do gancho).
  const sampleWindow = Math.min(durationSec, 60);
  const filter =
    `fps=1,scale=192:-2,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=${escapeFilterPathLocal(brightFile)},` +
    `sobel,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=${escapeFilterPathLocal(sharpFile)}`;
  await new Promise<void>((resolve, reject) => {
    const args = [
      '-y',
      '-i',
      videoUrl,
      '-t',
      String(sampleWindow),
      '-an',
      '-vf',
      filter,
      '-f',
      'null',
      '-',
    ];
    const proc = spawn(bin, args);
    let errBuf = '';
    proc.stderr.on('data', (d) => (errBuf += d.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      // Mesmo com code!=0 tentamos ler o que foi escrito — só falha se nada saiu.
      if (fs.existsSync(brightFile) || code === 0) return resolve();
      reject(new Error(`ffmpeg score falhou (code ${code}): ${errBuf.slice(-300)}`));
    });
  });

  const bright = parseSignalstatsFile(brightFile);
  const sharp = parseSignalstatsFile(sharpFile);
  fs.unlink(brightFile, () => {});
  fs.unlink(sharpFile, () => {});
  const sharpByT = new Map(sharp.map((s) => [s.t, s.v]));

  const scored = bright
    .filter((b) => b.t >= 0.4 && b.t <= sampleWindow - 0.4) // pula fade-in/out das bordas
    .map((b) => {
      const brightScore = Math.max(0, 1 - Math.abs(b.v - 130) / 130);
      const sharpVal = sharpByT.get(b.t) ?? 0;
      const sharpScore = Math.min(sharpVal / 45, 1);
      const posBias = b.t < durationSec * 0.5 ? 1 : 0.75;
      return { t: b.t, score: 0.45 * brightScore + 0.45 * sharpScore + 0.1 * posBias };
    })
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return [Math.min(1, durationSec / 2)];

  // Pega os top N garantindo espaçamento mínimo entre eles (opções visualmente distintas).
  const minGap = Math.max(1.5, sampleWindow / 12);
  const picked: number[] = [];
  for (const s of scored) {
    if (picked.every((p) => Math.abs(p - s.t) >= minGap)) picked.push(s.t);
    if (picked.length >= count) break;
  }
  // Se o espaçamento mínimo deixou faltando opções, completa com os próximos melhores.
  for (const s of scored) {
    if (picked.length >= count) break;
    if (!picked.includes(s.t)) picked.push(s.t);
  }
  return picked.slice(0, count);
}

function escapeFilterPathLocal(p: string): string {
  return p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

// Descobre a resolução de uma imagem local (pra escalar o texto certo na capa).
function probeImageSize(filePath: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const bin = (ffprobeStatic as any)?.path || 'ffprobe';
    const args = [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'csv=p=0',
      filePath,
    ];
    const proc = spawn(bin, args);
    let out = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.on('error', reject);
    proc.on('close', () => {
      const [w, h] = out.trim().split(',').map(Number);
      if (!w || !h) return reject(new Error('Não foi possível ler as dimensões da capa.'));
      resolve({ w, h });
    });
  });
}

const COVER_FONTS_DIR = path.resolve(process.cwd(), 'server', 'assets', 'fonts');

// Queima o texto do gancho na capa via libass (ASS) — texto sempre legível e
// com a grafia exata (evita o problema comum de IA de imagem "inventar"
// letras ao gerar texto). Faixa preta translúcida no topo + fonte bold.
async function burnCoverText(buffer: Buffer, text: string): Promise<Buffer> {
  const stamp = `${Date.now()}_${Math.round(Math.random() * 1e6)}`;
  const inPath = path.join(os.tmpdir(), `cover_in_${stamp}.png`);
  const assPath = path.join(os.tmpdir(), `cover_text_${stamp}.ass`);
  const outPath = path.join(os.tmpdir(), `cover_out_${stamp}.png`);
  fs.writeFileSync(inPath, buffer);
  try {
    const { w, h } = await probeImageSize(inPath);
    const fontSize = Math.round(h * 0.075);
    const escaped = text
      .toUpperCase()
      .replace(/\\/g, '\\\\')
      .replace(/\{/g, '\\{')
      .replace(/\}/g, '\\}');
    const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: ${w}
PlayResY: ${h}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Anton,${fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,${Math.round(fontSize * 0.09)},0,8,${Math.round(w * 0.06)},${Math.round(w * 0.06)},${Math.round(h * 0.05)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,9:59:59.99,Cap,,0,0,0,,${escaped}
`;
    fs.writeFileSync(assPath, ass, 'utf8');
    const bin = (ffmpegStatic as unknown as string) || 'ffmpeg';
    await new Promise<void>((resolve, reject) => {
      const args = [
        '-y',
        '-i',
        inPath,
        '-vf',
        `subtitles=${escapeFilterPathLocal(assPath)}:fontsdir=${escapeFilterPathLocal(COVER_FONTS_DIR)}`,
        outPath,
      ];
      const proc = spawn(bin, args);
      let errBuf = '';
      proc.stderr.on('data', (d) => (errBuf += d.toString()));
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code !== 0 || !fs.existsSync(outPath)) {
          return reject(
            new Error(`ffmpeg texto da capa falhou (code ${code}): ${errBuf.slice(-300)}`)
          );
        }
        resolve();
      });
    });
    return fs.readFileSync(outPath);
  } finally {
    fs.unlink(inPath, () => {});
    fs.unlink(assPath, () => {});
    fs.unlink(outPath, () => {});
  }
}

// POST /api/fal/cover — CAPA/THUMBNAIL do criativo. Escolhe os melhores instantes
// do vídeo montado (brilho + nitidez + posição, 1 passe de ffmpeg), manda cada um
// pro Nano Banana redesenhar como thumbnail que para o scroll, e queima o texto
// do gancho por cima (legível, grafia exata). Gera N variações — cada uma num
// instante E estilo diferentes — pra escolha real.
// Body: { videoUrl, atSec?, text?, count?, prompt?, aspectRatio?, userId } → { urls, url }.
// atSec: se informado, força TODAS as variações nesse instante (override manual,
// pula a escolha automática).

// Estilos de thumbnail — cada variação puxa uma pegada visual diferente pra dar
// escolha real (não 3 imagens quase iguais).
const COVER_STYLES = [
  'Close no rosto, expressão marcante, cores quentes e vibrantes.',
  'Alto contraste, fundo bem desfocado, foco total no olhar.',
  'Estilo cinematográfico, iluminação dramática, tons ricos e saturados.',
];

async function makeCover(
  apiKey: string,
  frameUrl: string,
  aspectRatio: string,
  styleHint: string,
  extra: string,
  hookText: string,
  userId?: string
): Promise<string> {
  const prompt =
    `Transforme este frame numa THUMBNAIL de anúncio que para o scroll: ` +
    `mantenha o rosto e a cena reconhecíveis, aumente o contraste e a nitidez, ` +
    `foco no rosto/expressão, deixe uma área limpa no TOPO pra um texto curto. ` +
    `Sem adicionar texto/legenda. Estilo de thumbnail de vídeo de alta conversão. ` +
    styleHint +
    (extra ? ` ${extra}` : '');
  const model = 'fal-ai/nano-banana/edit';
  const r = await fetch(`https://fal.run/${model}`, {
    method: 'POST',
    headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      num_images: 1,
      aspect_ratio: aspectRatio,
      image_urls: [frameUrl],
    }),
  });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = d?.detail ? JSON.stringify(d.detail) : `HTTP ${r.status}`;
    throw new Error(`fal cover: ${msg}`);
  }
  const imgUrl = d?.images?.[0]?.url;
  if (!imgUrl) throw new Error(`fal não retornou capa: ${JSON.stringify(d).substring(0, 200)}`);
  const ir = await fetch(imgUrl);
  if (!ir.ok) throw new Error(`Falha ao baixar a capa do fal (HTTP ${ir.status}).`);
  let buffer = Buffer.from(await ir.arrayBuffer());
  if (hookText.trim()) {
    buffer = await burnCoverText(buffer, hookText.trim());
  }
  const { url } = await persistVideo({
    buffer,
    filename: `fal_cover_${Date.now()}_${Math.round(Math.random() * 1e6)}.png`,
    storageFolder: 'fal-image',
    userId,
    contentType: 'image/png',
  });
  return url;
}

falRouter.post('/cover', async (req, res) => {
  try {
    const apiKey = getFalKey();
    if (!apiKey) {
      return res
        .status(400)
        .json({ error: 'Configure a chave do fal (FAL_KEY no .env ou fal-config.json).' });
    }
    const b = (req.body || {}) as Record<string, any>;
    const videoUrl = String(b.videoUrl || '');
    const manualAtSec = Number.isFinite(b.atSec) ? Math.max(0, Number(b.atSec)) : null;
    const aspectRatio = String(b.aspectRatio || '9:16');
    const userId = b.userId ? String(b.userId) : undefined;
    const extra = String(b.prompt || '').trim();
    const hookText = String(b.text || '').trim();
    const count = Math.max(1, Math.min(3, Number(b.count) || 3));
    if (!videoUrl) return res.status(400).json({ error: 'Informe o vídeo (videoUrl).' });

    // Escolhe os instantes: manual (playhead do usuário) ou automático (o
    // melhor de cada, via pontuação de brilho/nitidez/posição).
    let atSecs: number[];
    if (manualAtSec !== null) {
      atSecs = Array.from({ length: count }, () => manualAtSec);
      log.info(`[fal/cover] frame manual @${manualAtSec}s ×${count} de ${videoUrl.slice(0, 60)}…`);
    } else {
      const duration = await probeAudioDuration(videoUrl).catch(() => 20);
      atSecs = await pickBestFrames(videoUrl, duration, count);
      log.info(
        `[fal/cover] auto-pick @[${atSecs.map((t) => t.toFixed(1)).join(', ')}]s de ${videoUrl.slice(0, 60)}…`
      );
    }

    // Extrai um frame por instante escolhido e sobe cada um (URL pública que
    // o Nano Banana baixa).
    const framePersists = await Promise.all(
      atSecs.map(async (atSec) => {
        const buf = await grabFrame(videoUrl, atSec);
        return persistVideo({
          buffer: buf,
          filename: `cover_src_${Date.now()}_${Math.round(atSec * 100)}.png`,
          storageFolder: 'fal-cover',
          userId,
          contentType: 'image/png',
        });
      })
    );

    // Gera as N variações em paralelo (frame + estilo diferentes cada). Se
    // uma falhar, mantém as que deram certo.
    const settled = await Promise.allSettled(
      framePersists.map((fp, i) =>
        makeCover(
          apiKey,
          fp.url,
          aspectRatio,
          COVER_STYLES[i % COVER_STYLES.length]!,
          extra,
          hookText,
          userId
        )
      )
    );
    const urls = settled
      .filter((s): s is PromiseFulfilledResult<string> => s.status === 'fulfilled')
      .map((s) => s.value);
    if (urls.length === 0) {
      const firstErr = settled.find((s) => s.status === 'rejected') as
        | PromiseRejectedResult
        | undefined;
      throw new Error(firstErr?.reason?.message || 'Nenhuma capa foi gerada.');
    }
    log.info(`[fal/cover] OK → ${urls.length} capa(s)`);
    res.json({ urls, url: urls[0], frameUrl: framePersists[0]?.url, atSecs });
  } catch (err: any) {
    log.error('[fal/cover] erro:', err.message);
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
    const mp4s = files
      .filter((f) => f.name.endsWith('.mp4'))
      .sort((a, b) => b.name.localeCompare(a.name))
      .slice(0, 60);
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
