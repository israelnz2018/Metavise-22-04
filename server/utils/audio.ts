// F9.4 — Audio chunking + duration probing helpers.
//
// Usado pelo HeyGen segmented avatar gen pra fatiar o áudio do
// ElevenLabs em pedaços só nos trechos onde o avatar deve aparecer
// (economia de custo: HeyGen cobra por segundo de output, não por
// chamada).
//
// Stack: ffmpeg-static + fluent-ffmpeg (já usado em outros pontos).

import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
// @ts-expect-error — ffprobe-static não tem types oficiais
import ffprobeStatic from 'ffprobe-static';
import { createLogger } from './logger.js';

if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);
if (ffprobeStatic?.path) ffmpeg.setFfprobePath(ffprobeStatic.path);

const log = createLogger('Audio');

export interface AudioSegment {
  startSec: number;
  endSec: number;
}

/**
 * Probe audio duration via ffprobe. Throws se arquivo não puder ser lido.
 */
export async function probeAudioDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      const dur = Number(metadata?.format?.duration);
      if (!Number.isFinite(dur) || dur <= 0) {
        return reject(new Error(`Invalid audio duration in ${filePath}: ${dur}`));
      }
      resolve(dur);
    });
  });
}

/**
 * Corta um pedaço do áudio entre startSec e endSec, salva em outputPath.
 *
 * F9.11 — Pra HeyGen: usa MP3 (libmp3lame) com seek PRECISO via -ss
 * APÓS o input. Antes usava AAC com -ss antes do input que faz "fast
 * seek" por keyframe → cortes imprecisos + AAC com headers de duração
 * problemáticos. HeyGen confundia, mostrava avatar travado após 1s
 * com voz "default" misturada.
 *
 * Espera-se que outputPath termine em .mp3 (caller cuida).
 */
export async function cutAudioSegment(
  inputPath: string,
  startSec: number,
  endSec: number,
  outputPath: string
): Promise<void> {
  if (endSec <= startSec) {
    throw new Error(`Invalid segment: end (${endSec}) must be > start (${startSec})`);
  }
  const dur = endSec - startSec;
  log.info(
    `[cutAudioSegment] ${startSec.toFixed(2)}-${endSec.toFixed(2)} (${dur.toFixed(2)}s) → ${outputPath.split('/').pop()}`
  );

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      // Pattern testado manualmente que funciona:
      //   ffmpeg -accurate_seek -i INPUT -ss <start> -t <dur> -c:a libmp3lame ...
      // -accurate_seek antes do -i + -ss depois do -i = seek frame-exato.
      // fluent-ffmpeg's seekOutput() vinha falhando com exit code 234
      // (output 0KB) — provavelmente ordem de flags estava gerando
      // comando inválido. outputOptions direto é mais previsível.
      .inputOptions(['-accurate_seek'])
      .outputOptions([
        '-ss',
        String(startSec),
        '-t',
        String(dur),
        '-c:a',
        'libmp3lame',
        '-b:a',
        '128k',
        '-ac',
        '1',
        '-ar',
        '44100',
        '-vn',
      ])
      .output(outputPath)
      .on('start', (cmd) => log.info(`[cutAudioSegment] cmd: ${cmd.substring(0, 200)}`))
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}

/**
 * Valida lista de segments: ordem, não-sobreposição, dentro da duração total,
 * e mínimo de duração por segment (default 3s — HeyGen pode dar lip-sync ruim
 * em clips muito curtos).
 *
 * Retorna lista normalizada (mesma se válida) ou throws com mensagem clara.
 */
export function validateAndNormalizeSegments(
  segments: AudioSegment[],
  totalDurationSec: number,
  // Mínimo de 1.5s por segment. Tinha começado em 3s (conservador), mas
  // na prática HeyGen aceita clips de 2s sem problema de lip-sync e
  // muitas frases reais (palavras curtas tipo "Sim." ou "Got it.") ficam
  // entre 1.5 e 3s. Frases consecutivas continuam sendo fundidas no
  // cliente (gap<0.5s), então isso só afeta frases isoladas curtas.
  minSegmentDurationSec: number = 1.5
): AudioSegment[] {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error('Pelo menos 1 segment é obrigatório.');
  }

  const sorted = [...segments].sort((a, b) => a.startSec - b.startSec);

  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i]!;
    const startSec = Number(s.startSec);
    const endSec = Number(s.endSec);

    if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) {
      throw new Error(`Segment ${i + 1}: startSec e endSec devem ser números.`);
    }
    if (startSec < 0) {
      throw new Error(`Segment ${i + 1}: startSec não pode ser negativo (${startSec}).`);
    }
    if (endSec > totalDurationSec + 0.1) {
      throw new Error(
        `Segment ${i + 1}: endSec (${endSec.toFixed(2)}s) excede duração do áudio (${totalDurationSec.toFixed(2)}s).`
      );
    }
    const dur = endSec - startSec;
    if (dur < minSegmentDurationSec) {
      throw new Error(
        `Segment ${i + 1}: duração (${dur.toFixed(2)}s) menor que o mínimo (${minSegmentDurationSec}s). HeyGen pode dar lip-sync ruim em clips muito curtos.`
      );
    }
    // Overlap check
    if (i > 0 && sorted[i - 1]!.endSec > startSec + 0.05) {
      throw new Error(
        `Segments ${i} e ${i + 1} se sobrepõem (segment ${i} termina em ${sorted[i - 1]!.endSec.toFixed(2)}s, segment ${i + 1} começa em ${startSec.toFixed(2)}s).`
      );
    }
  }

  return sorted.map((s) => ({
    startSec: Number(s.startSec),
    endSec: Number(s.endSec),
  }));
}

/**
 * Dado segments[] (onde AVATAR deve aparecer) + duração total,
 * retorna a "timeline completa" intercalando segments de avatar
 * com gaps (onde não tem avatar — preto/Cortes/B-rolls depois).
 *
 * Exemplo: segments=[{0,10}, {25,30}], total=60
 * Retorna: [
 *   { kind:'avatar',  startSec:0,  endSec:10 },
 *   { kind:'gap',     startSec:10, endSec:25 },
 *   { kind:'avatar',  startSec:25, endSec:30 },
 *   { kind:'gap',     startSec:30, endSec:60 },
 * ]
 */
export type TimelineSegment = AudioSegment & { kind: 'avatar' | 'gap' };

export function buildTimeline(
  avatarSegments: AudioSegment[],
  totalDurationSec: number
): TimelineSegment[] {
  const sorted = [...avatarSegments].sort((a, b) => a.startSec - b.startSec);
  const result: TimelineSegment[] = [];
  let cursor = 0;

  for (const seg of sorted) {
    if (seg.startSec > cursor + 0.05) {
      result.push({ kind: 'gap', startSec: cursor, endSec: seg.startSec });
    }
    result.push({ kind: 'avatar', startSec: seg.startSec, endSec: seg.endSec });
    cursor = seg.endSec;
  }
  if (cursor < totalDurationSec - 0.05) {
    result.push({ kind: 'gap', startSec: cursor, endSec: totalDurationSec });
  }
  return result;
}

/**
 * Soma total de segundos de avatar nos segments dados. Usado pra
 * estimar custo HeyGen antes de gerar.
 */
export function sumAvatarSeconds(segments: AudioSegment[]): number {
  return segments.reduce((acc, s) => acc + (s.endSec - s.startSec), 0);
}
