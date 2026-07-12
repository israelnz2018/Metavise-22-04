// F9.5 — Segmented HeyGen avatar job runner.
//
// Orquestra: cortar áudio em N pedaços → chamar HeyGen N vezes em
// paralelo → polling cada uma → costurar vídeos finais com gaps pretos
// onde NÃO tem avatar (mas com áudio contínuo). Resultado: vídeo
// "esqueleto" onde avatar aparece só nos momentos pedidos, e o resto
// é tela preta esperando Cortes/b-rolls serem aplicados depois.
//
// Por que: HeyGen cobra por segundo de output. Gerar 60s de avatar
// quando só vai aparecer 15s = desperdício de ~75% do custo HeyGen.
// Segmentado salva proporcionalmente.

import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import admin from 'firebase-admin';
import { GENERATED_DIR } from '../config/paths.js';
import { getHeyGenKey } from '../config/apiKeys.js';
import { createLogger } from '../utils/logger.js';
import { downloadFile } from '../utils/download.js';
import { buildHeyGenBackground } from '../utils/heygenBackground.js';
import {
  cutAudioSegment,
  buildTimeline,
  sumAvatarSeconds,
  type AudioSegment,
} from '../utils/audio.js';

const log = createLogger('HeyGenSegmented');

// ────────────────────────────────────────────────────────────────────────
// Job state
// ────────────────────────────────────────────────────────────────────────

export type SegmentedJobStatus =
  | 'queued'
  | 'cutting-audio'
  | 'submitting-heygen'
  | 'rendering-heygen'
  | 'downloading-segments'
  | 'stitching'
  | 'completed'
  | 'failed';

export interface SegmentedJob {
  jobId: string;
  status: SegmentedJobStatus;
  /** Progress 0.0-1.0 baseado em fases ponderadas. */
  progress: number;
  /** Mensagem human-readable do que está acontecendo agora. */
  message: string;
  /** Set quando terminado com sucesso. */
  resultUrl?: string;
  /** Set em failure. */
  error?: string;
  /** Total de segundos de avatar (pra estimativa de custo). */
  totalAvatarSec: number;
  startedAt: number;
  finishedAt?: number;
  /** Sub-jobs HeyGen, um por segment. */
  subJobs: Array<{
    index: number;
    startSec: number;
    endSec: number;
    heygenVideoId?: string;
    heygenStatus?: string;
    downloadedPath?: string;
    error?: string;
  }>;
}

const jobs = new Map<string, SegmentedJob>();

// Cleanup jobs > 24h pra não vazar memória.
setInterval(() => {
  const now = Date.now();
  for (const [id, j] of jobs.entries()) {
    const age = now - j.startedAt;
    if (age > 24 * 60 * 60_000) jobs.delete(id);
  }
}, 60 * 60_000).unref?.();

export function getSegmentedJob(jobId: string): SegmentedJob | undefined {
  return jobs.get(jobId);
}

// ────────────────────────────────────────────────────────────────────────
// Job runner — kicked off async after POST /generate-segmented
// ────────────────────────────────────────────────────────────────────────

export interface StartJobOpts {
  jobId: string;
  avatarId: string;
  audioUrl: string;
  audioFilename: string; // basename of audio file in /generated/
  segments: AudioSegment[];
  totalAudioDurationSec: number;
  aspectRatio: '9:16' | '1:1' | '16:9' | '4:5';
  scale?: number;
  title?: string;
  /** Full public URL prefix (e.g. http://localhost:3000) pra HeyGen fetchar os áudios. */
  publicUrlPrefix: string;
  /** Fundo do avatar ({ type:'color'|'image'|'video', value }). Ausente = preto. */
  background?: { type: 'color' | 'image' | 'video'; value: string };
}

const HEYGEN_API = 'https://api.heygen.com';
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 15 * 60_000; // 15min por sub-job
const MAX_PARALLEL_HEYGEN = 3; // não bombardear API

/**
 * F9.9 — Upload um arquivo local pro Firebase Storage e torna público.
 * Necessário pros chunks de áudio: HeyGen é cloud e não consegue fetchar
 * `http://localhost:3000/generated/...`. Solução: subir pro Firebase
 * (que ElevenLabs já usa pra própria voz) e passar URL pública pro HeyGen.
 *
 * Throws se Firebase falhar — caller cai no fallback 0x0.st.
 */
async function uploadChunkToFirebase(
  localPath: string,
  firebasePath: string,
  contentType: string = 'audio/mpeg'
): Promise<string> {
  if (admin.apps.length === 0) {
    throw new Error('Firebase Admin não inicializado.');
  }
  const bucket = admin.storage().bucket();
  const fileRef = bucket.file(firebasePath);
  await fileRef.save(fs.readFileSync(localPath), {
    metadata: { contentType },
  });
  await fileRef.makePublic();
  return `https://storage.googleapis.com/${bucket.name}/${firebasePath}`;
}

/**
 * F9.9/F9.10 — Fallback pra Firebase. Quando rodando local sem service
 * account configurada, `firebase-admin` Storage falha. Sobe o chunk pra
 * catbox.moe (anonymous file hosting, sem signup, online há anos —
 * substituiu 0x0.st que desabilitou uploads em 2026 por causa de bot spam).
 *
 * ⚠️ Privacy note: o arquivo fica publicamente acessível por qualquer um
 * com a URL. Aceitável pra áudio de anúncio (conteúdo de marketing
 * publicado de qualquer forma). Catbox mantém arquivos indefinidamente
 * pra contas anônimas; chunks têm <500KB.
 */
async function uploadChunkToCatbox(localPath: string): Promise<string> {
  const buf = fs.readFileSync(localPath);
  const form = new FormData();
  // Catbox usa multipart com reqtype=fileupload.
  form.append('reqtype', 'fileupload');
  form.append('fileToUpload', new Blob([buf]), path.basename(localPath));
  const r = await fetch('https://catbox.moe/user/api.php', {
    method: 'POST',
    body: form,
  });
  if (!r.ok) {
    throw new Error(`catbox upload HTTP ${r.status}: ${(await r.text()).substring(0, 100)}`);
  }
  const url = (await r.text()).trim();
  if (!url.startsWith('https://')) {
    throw new Error(`catbox resposta inesperada: ${url.substring(0, 100)}`);
  }
  return url;
}

/**
 * Tenta Firebase primeiro (produção / dev com creds). Cai pro catbox.moe
 * se Firebase falhar (dev local sem service account).
 */
async function uploadChunkPublic(
  localPath: string,
  firebasePath: string
): Promise<{ url: string; via: 'firebase' | 'catbox' }> {
  try {
    const url = await uploadChunkToFirebase(localPath, firebasePath);
    return { url, via: 'firebase' };
  } catch (err: any) {
    log.warn(`[upload] Firebase falhou (${err.message?.substring(0, 80)}), tentando catbox.moe...`);
    const url = await uploadChunkToCatbox(localPath);
    return { url, via: 'catbox' };
  }
}

function setJob(jobId: string, patch: Partial<SegmentedJob>) {
  const j = jobs.get(jobId);
  if (!j) return;
  Object.assign(j, patch);
}

function setSubJob(jobId: string, index: number, patch: Partial<SegmentedJob['subJobs'][number]>) {
  const j = jobs.get(jobId);
  if (!j) return;
  const s = j.subJobs[index];
  if (!s) return;
  Object.assign(s, patch);
}

export async function startSegmentedJob(opts: StartJobOpts): Promise<void> {
  const job: SegmentedJob = {
    jobId: opts.jobId,
    status: 'queued',
    progress: 0,
    message: 'Iniciando...',
    totalAvatarSec: sumAvatarSeconds(opts.segments),
    startedAt: Date.now(),
    subJobs: opts.segments.map((s, i) => ({
      index: i,
      startSec: s.startSec,
      endSec: s.endSec,
    })),
  };
  jobs.set(opts.jobId, job);

  // Roda em background, não esperamos.
  runJob(opts).catch((err) => {
    log.error(`[Job ${opts.jobId}] uncaught:`, err.message);
    setJob(opts.jobId, {
      status: 'failed',
      error: err.message,
      finishedAt: Date.now(),
    });
  });
}

async function runJob(opts: StartJobOpts): Promise<void> {
  const { jobId, segments, totalAudioDurationSec, audioFilename } = opts;
  const workDir = path.join(GENERATED_DIR, `segjob_${jobId}`);
  if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

  try {
    // ── Fase 1: cortar áudio em N pedaços (0% → 5%) ───────────────────
    setJob(jobId, {
      status: 'cutting-audio',
      message: `Cortando áudio em ${segments.length} pedaços...`,
      progress: 0.02,
    });

    const fullAudioPath = path.join(GENERATED_DIR, audioFilename);
    if (!fs.existsSync(fullAudioPath)) {
      throw new Error(`Audio file não encontrado: ${audioFilename}`);
    }

    // F9.11 — chunks em MP3 (não AAC). HeyGen confunde AAC mid-stream
    // cortado e mostra avatar travado + voz mismatched. MP3 com headers
    // próprios e seek frame-exato resolve.
    const audioChunks: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const chunkPath = path.join(workDir, `chunk_${i}.mp3`);
      await cutAudioSegment(fullAudioPath, seg.startSec, seg.endSec, chunkPath);
      audioChunks.push(chunkPath);
    }
    setJob(jobId, { progress: 0.05 });

    // ── Fase 2: submeter N jobs HeyGen (5% → 10%) ─────────────────────
    setJob(jobId, {
      status: 'submitting-heygen',
      message: `Enviando ${segments.length} pedaços pro HeyGen...`,
      progress: 0.05,
    });

    const heygenKey = getHeyGenKey();
    if (!heygenKey) throw new Error('HEYGEN_API_KEY ausente.');

    // Submeter em parallelo, mas limitado (não bombardear API).
    const submitTasks = segments.map((seg, i) => async () => {
      // F9.9 — Upload do chunk pra um URL público pra HeyGen poder
      // fetchar. Tenta Firebase primeiro; cai pro 0x0.st se Firebase
      // falhar (dev local sem service account). Sem isso, jobs ficavam
      // pendurados pra sempre tentando acessar localhost:3000.
      const localChunkPath = audioChunks[i]!;
      const firebasePath = `heygen-chunks/${jobId}/chunk_${i}.mp3`;
      log.info(`[Job ${jobId}] uploading chunk ${i}...`);
      const { url: audioUrlForHeygen, via } = await uploadChunkPublic(localChunkPath, firebasePath);
      log.info(`[Job ${jobId}] chunk ${i} via=${via} → ${audioUrlForHeygen.substring(0, 100)}`);

      // `pa_<id>` = photo avatar (clone próprio) → talking_photo, id sem prefixo.
      const isPhotoAvatar = opts.avatarId.startsWith('pa_');
      const isTalkingPhoto = isPhotoAvatar || opts.avatarId.includes('talking_photo');
      const talkingPhotoId = isPhotoAvatar ? opts.avatarId.slice(3) : opts.avatarId;
      const dimension =
        opts.aspectRatio === '1:1'
          ? { width: 1080, height: 1080 }
          : opts.aspectRatio === '16:9'
            ? { width: 1920, height: 1080 }
            : opts.aspectRatio === '4:5'
              ? { width: 1080, height: 1350 }
              : { width: 1080, height: 1920 };

      const characterConfig = isTalkingPhoto
        ? {
            type: 'talking_photo',
            talking_photo_id: talkingPhotoId,
            // Preenche o canvas (16:9 sobrava borda preta sem scale).
            scale: opts.scale ?? (opts.aspectRatio === '16:9' ? 1.1 : opts.aspectRatio === '4:5' ? 1.1 : undefined),
          }
        : {
            type: 'avatar',
            avatar_id: opts.avatarId,
            avatar_style: 'normal',
            scale: opts.scale ?? (opts.aspectRatio === '1:1' ? 1.2 : 1.0),
          };

      const payload = {
        video_inputs: [
          {
            character: characterConfig,
            voice: { type: 'audio', audio_url: audioUrlForHeygen },
            background: buildHeyGenBackground(opts.background),
          },
        ],
        aspect_ratio: opts.aspectRatio,
        dimension,
        title: opts.title?.substring(0, 50).replace(/[^\w\s-]/g, '') + `_seg${i}`,
      };

      log.info(
        `[Job ${jobId}] submitting segment ${i} (${seg.startSec.toFixed(1)}-${seg.endSec.toFixed(1)}s)`
      );
      const res = await fetch(`${HEYGEN_API}/v2/video/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': heygenKey },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HeyGen submit segment ${i} HTTP ${res.status}: ${txt.substring(0, 300)}`);
      }
      const data = await res.json();
      const videoId = data?.data?.video_id;
      if (!videoId) throw new Error(`HeyGen segment ${i}: no video_id in response`);
      setSubJob(jobId, i, { heygenVideoId: videoId });
      log.info(`[Job ${jobId}] segment ${i} → heygen video_id=${videoId}`);
    });

    // Limita concorrência: processa em batches de MAX_PARALLEL_HEYGEN.
    for (let start = 0; start < submitTasks.length; start += MAX_PARALLEL_HEYGEN) {
      const batch = submitTasks.slice(start, start + MAX_PARALLEL_HEYGEN);
      await Promise.all(batch.map((task) => task()));
    }
    setJob(jobId, { progress: 0.1 });

    // ── Fase 3: polling de TODOS os sub-jobs (10% → 85%) ──────────────
    setJob(jobId, {
      status: 'rendering-heygen',
      message: 'Renderizando avatar nos pedaços...',
      progress: 0.1,
    });

    const pollStart = Date.now();
    while (true) {
      if (Date.now() - pollStart > POLL_TIMEOUT_MS) {
        throw new Error('HeyGen polling timeout (>15min)');
      }
      const job = jobs.get(jobId)!;
      const pending = job.subJobs.filter((s) => !s.downloadedPath && !s.error);
      if (pending.length === 0) break;

      // Poll each pending sub-job. v2 endpoint as primary, v1 as fallback
      // (HeyGen migrou pra v2 mas alguns video_ids só batem em v1 — o
      // código existente do /api/heygen/status/:id faz a mesma coisa).
      for (const sub of pending) {
        if (!sub.heygenVideoId) continue;
        try {
          let res = await fetch(`${HEYGEN_API}/v2/video/${sub.heygenVideoId}`, {
            headers: { 'X-Api-Key': heygenKey },
          });
          if (res.status === 404) {
            // Fallback v1 — sem isso polling fica preso em 404 silencioso e
            // job nunca completa mesmo com vídeo pronto no HeyGen.
            res = await fetch(`${HEYGEN_API}/v1/video_status.get?video_id=${sub.heygenVideoId}`, {
              headers: { 'X-Api-Key': heygenKey },
            });
          }
          if (!res.ok) continue;
          const data = await res.json();
          const status = data?.data?.status || data?.status;
          setSubJob(jobId, sub.index, { heygenStatus: status });
          if (status === 'completed') {
            const videoUrl = data?.data?.video_url || data?.video_url;
            if (!videoUrl) {
              setSubJob(jobId, sub.index, { error: 'completed but no video_url' });
              continue;
            }
            // Baixar pro disk
            const downloadPath = path.join(workDir, `avatar_${sub.index}.mp4`);
            log.info(`[Job ${jobId}] segment ${sub.index} ready, downloading...`);
            await downloadFile(videoUrl, downloadPath);
            setSubJob(jobId, sub.index, { downloadedPath: downloadPath });
          } else if (status === 'failed') {
            const errMsg =
              data?.data?.error?.message || data?.data?.error_message || 'HeyGen rendering failed';
            setSubJob(jobId, sub.index, { error: errMsg });
          }
        } catch (err: any) {
          log.warn(`[Job ${jobId}] poll segment ${sub.index} err: ${err.message}`);
        }
      }

      // Update overall progress
      const done = job.subJobs.filter((s) => s.downloadedPath).length;
      const failed = job.subJobs.filter((s) => s.error).length;
      if (failed > 0) {
        throw new Error(
          `${failed}/${segments.length} segments falharam no HeyGen: ${job.subJobs
            .filter((s) => s.error)
            .map((s) => `seg${s.index}: ${s.error}`)
            .join('; ')}`
        );
      }
      // 10% → 85% spread sobre proporção pronta
      const progress = 0.1 + 0.75 * (done / segments.length);
      setJob(jobId, {
        progress,
        message: `Renderizando avatar: ${done}/${segments.length} prontos`,
      });

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    // ── Fase 4: stitching final (85% → 100%) ──────────────────────────
    setJob(jobId, {
      status: 'stitching',
      message: 'Costurando vídeo final...',
      progress: 0.85,
    });

    // Build timeline (avatar segments + gaps)
    const timeline = buildTimeline(segments, totalAudioDurationSec);

    // Probe dimensão do primeiro avatar pra usar nos gaps pretos.
    const firstAvatar = jobs.get(jobId)!.subJobs[0]!.downloadedPath!;
    const meta: any = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(firstAvatar, (err, m) => (err ? reject(err) : resolve(m)));
    });
    const vStream = meta.streams.find((s: any) => s.codec_type === 'video');
    const W = vStream?.width || 1080;
    const H = vStream?.height || 1920;

    // ── Spec CANÔNICO pra TODOS os segmentos antes do concat ──────────────
    // Causa do "travado + sem lip sync": os vídeos do HeyGen vêm com
    // fps/timebase/sample-rate VARIÁVEIS, e o concat demuxer do ffmpeg exige
    // parâmetros idênticos — colar fontes desencontradas desincroniza A/V e
    // engasga nos cortes. Forçamos todo segmento (avatar e gap) pro MESMO
    // padrão: 30fps CFR, mesma resolução (com pad), yuv420p, áudio 48k estéreo.
    const CANON_FPS = 30;
    const CANON_AR = 48000;
    const canonOutputOptions = [
      '-vf',
      `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,fps=${CANON_FPS},setsar=1,format=yuv420p`,
      '-r',
      String(CANON_FPS),
      '-vsync',
      'cfr',
      '-c:v',
      'libx264',
      '-preset',
      'superfast',
      '-crf',
      '23',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ar',
      String(CANON_AR),
      '-ac',
      '2',
    ];
    // Re-encoda um trecho do HeyGen pro spec canônico, preservando o A/V sync
    // interno dele (cada segmento já vem sincronizado do HeyGen).
    const normalizeSegment = (input: string, output: string): Promise<void> =>
      new Promise((resolve, reject) => {
        ffmpeg(input)
          .outputOptions(canonOutputOptions)
          .output(output)
          .on('end', () => resolve())
          .on('error', reject)
          .run();
      });

    // Pra cada gap: gera um segmento "tela preta + áudio do trecho original"
    // ─ corta o áudio original do gap → muxa com lavfi color=black → MP4 sem áudio,
    // depois adiciona o áudio do gap.
    const segmentFiles: string[] = [];
    let avatarIdx = 0;
    for (const t of timeline) {
      if (t.kind === 'avatar') {
        // Normaliza o vídeo do HeyGen pro spec canônico antes de entrar no
        // concat (sem isso, fps/timebase diferentes desincronizam o lip sync).
        const avPath = jobs.get(jobId)!.subJobs[avatarIdx]!.downloadedPath!;
        const avNormPath = path.join(workDir, `avatar_${avatarIdx}_norm.mp4`);
        await normalizeSegment(avPath, avNormPath);
        segmentFiles.push(avNormPath);
        avatarIdx++;
      } else {
        // Gap: render black with audio
        const gapDur = t.endSec - t.startSec;
        // F9.12 — gap audio em .mp3 (não .aac) pra match com o codec
        // libmp3lame que cutAudioSegment usa agora. ffmpeg recusava
        // escrever MP3 stream em .aac container (exit 234, 0kB output).
        const gapAudioPath = path.join(workDir, `gap_${t.startSec.toFixed(0)}_audio.mp3`);
        const gapMp4Path = path.join(workDir, `gap_${t.startSec.toFixed(0)}.mp4`);
        await cutAudioSegment(fullAudioPath, t.startSec, t.endSec, gapAudioPath);

        await new Promise((resolve, reject) => {
          ffmpeg(`color=c=black:s=${W}x${H}:d=${gapDur}:r=30`)
            .inputFormat('lavfi')
            .input(gapAudioPath)
            // Mesmo spec canônico dos trechos de avatar — sem isso, o gap (30fps,
            // áudio do mp3) diverge do avatar e o concat desincroniza.
            .outputOptions([...canonOutputOptions, '-shortest'])
            .output(gapMp4Path)
            .on('end', () => resolve(null))
            .on('error', reject)
            .run();
        });
        segmentFiles.push(gapMp4Path);
      }
    }

    setJob(jobId, { progress: 0.92, message: 'Concatenando...' });

    // Concat tudo
    const concatListPath = path.join(workDir, 'concat.txt');
    fs.writeFileSync(concatListPath, segmentFiles.map((p) => `file '${p}'`).join('\n'));

    const finalFileName = `segjob_${jobId}_final.mp4`;
    const finalPath = path.join(GENERATED_DIR, finalFileName);
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatListPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions([
          '-c:v',
          'libx264',
          '-preset',
          'superfast',
          '-crf',
          '23',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
        ])
        .output(finalPath)
        .on('end', () => resolve(null))
        .on('error', reject)
        .run();
    });

    setJob(jobId, {
      status: 'completed',
      progress: 1,
      message: 'Vídeo pronto!',
      resultUrl: `/generated/${finalFileName}`,
      finishedAt: Date.now(),
    });

    log.info(
      `[Job ${jobId}] DONE — ${segments.length} segments, ${jobs.get(jobId)!.totalAvatarSec.toFixed(1)}s de avatar`
    );
  } catch (err: any) {
    log.error(`[Job ${jobId}] failed: ${err.message}`);
    setJob(opts.jobId, {
      status: 'failed',
      error: err.message,
      finishedAt: Date.now(),
    });
  }
}
