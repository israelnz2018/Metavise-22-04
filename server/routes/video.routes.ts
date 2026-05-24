import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import admin from 'firebase-admin';
import { GENERATED_DIR } from '../config/paths.js';
import { getAssemblyAIKey } from '../config/apiKeys.js';
import { downloadFile } from '../utils/download.js';
import { processDataError } from '../utils/errorExtractor.js';
import { createLogger } from '../utils/logger.js';
import { withFfmpegQueue } from '../services/jobQueue.js';
import { ENCODE_BALANCED } from '../config/ffmpeg.js';

const log = createLogger('Video');

export const videoRouter = Router();

// POST /api/video/compress
// Downloads, compresses to Full HD via ffmpeg, uploads to Firebase, returns
// a signed URL. Files >= 500MB are compressed; smaller ones return the
// original URL unchanged. Rejects 422 when ffmpeg can't keep 1080p+.
//
// Queued through `ffmpegQueue` (concurrency 2) so a burst of uploads
// can't starve the event loop or pile encoders on a small box.
videoRouter.post(
  '/compress',
  withFfmpegQueue(async (req, res) => {
    const { filePath, originalUrl, userId } = req.body;
    if (!filePath || !originalUrl || !userId) {
      return res.status(400).json({ error: 'Faltam parâmetros (filePath, originalUrl, userId)' });
    }

    const localInputPath = path.join(GENERATED_DIR, `input_${Date.now()}.mp4`);
    const localOutputPath = path.join(GENERATED_DIR, `output_${Date.now()}.mp4`);

    try {
      await downloadFile(originalUrl, localInputPath);

      const stats = fs.statSync(localInputPath);
      const sizeInMB = stats.size / (1024 * 1024);

      if (sizeInMB < 500) {
        log.info(
          `[Video Compress] Arquivo pequeno (${sizeInMB.toFixed(2)}MB), ignorando compressão.`
        );
        return res.json({ compressed: false, url: originalUrl });
      }

      log.info(`[Video Compress] Comprimindo arquivo de ${sizeInMB.toFixed(2)}MB...`);

      await new Promise((resolve, reject) => {
        ffmpeg(localInputPath)
          // Shared balanced profile + a scale filter to clamp to 1920w.
          // The profile gives us multi-threading + decode-friendly output
          // out of the box.
          .outputOptions([...ENCODE_BALANCED, '-vf', 'scale=1920:-2'])
          .save(localOutputPath)
          .on('end', resolve)
          .on('error', reject);
      });

      const getResolution = () =>
        new Promise<{ width: number; height: number }>((resolve, reject) => {
          ffmpeg.ffprobe(localOutputPath, (err, metadata) => {
            if (err) return reject(err);
            const stream = metadata.streams.find((s) => s.codec_type === 'video');
            resolve({ width: stream?.width || 0, height: stream?.height || 0 });
          });
        });

      const { width, height } = await getResolution();
      const isFullHD = width >= 1920 || height >= 1080;

      if (!isFullHD) {
        return res.status(422).json({
          error:
            'Não foi possível processar seu vídeo. O arquivo é muito grande e não conseguimos reduzi-lo mantendo a qualidade Full HD. Por favor, exporte seu vídeo em 1080p e tente novamente.',
        });
      }

      const bucket = admin.storage().bucket();
      const destination = `video/${userId}/${Date.now()}_compressed.mp4`;
      await bucket.upload(localOutputPath, {
        destination,
        metadata: { contentType: 'video/mp4' },
      });

      const file = bucket.file(destination);
      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: '03-09-2491',
      });

      res.json({ compressed: true, url });
    } catch (err: any) {
      log.error('[Video Compress] Erro:', err.message);
      res.status(500).json({ error: processDataError(err) });
    } finally {
      if (fs.existsSync(localInputPath)) fs.unlinkSync(localInputPath);
      if (fs.existsSync(localOutputPath)) fs.unlinkSync(localOutputPath);
    }
  })
);

// The ffmpeg-static binary we ship doesn't include the drawtext filter, but
// it does ship libass — so we render text as an ASS subtitle file and
// composite it via the `subtitles` filter. ASS handles wrapping, centering,
// fonts, and multi-line on its own.
function writeAssFile(
  workDir: string,
  idx: number,
  raw: string,
  width: number,
  height: number,
  fontSize: number
): string {
  const p = path.join(workDir, `text_${idx}.ass`);
  // ASS uses \N for line breaks; remove \r and convert real newlines.
  // {, } and \ are control chars in ASS — escape them.
  const escaped = raw
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N');

  // Style fields: alignment=5 means middle-center. Outline=3 for legibility
  // on the off-chance text overlaps anything (here it's pure black anyway).
  // PrimaryColour is &H00FFFFFF (white, alpha 0).
  const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,${fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,3,0,5,80,80,80,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,9:59:59.99,Default,,0,0,0,,${escaped}
`;

  fs.writeFileSync(p, ass, 'utf8');
  return p;
}

// Escape a filesystem path for use as an argument inside an ffmpeg
// filtergraph. Filtergraph parses `:` as option separator and `\` as escape,
// so both need backslash-escaping. Single quotes wrap the result for safety.
function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

// F6.3 — convert ms → ASS timestamp "H:MM:SS.cc".
function msToAssTime(ms: number): string {
  const totalCs = Math.round(ms / 10);
  const cs = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

// F6.3 — convert hex color "#RRGGBB" → ASS "&H00BBGGRR".
// ASS uses BGR order (not RGB), alpha first (00=fully visible).
function hexToAssColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return '&H0099FFFF'; // fallback: yellow-ish
  const rgb = m[1];
  const r = rgb.slice(0, 2);
  const g = rgb.slice(2, 4);
  const b = rgb.slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}

// F6.3 — alignment digit per ASS spec (numpad layout, 1=BL, 5=MC, 8=TC).
function positionToAssAlignment(position: string): number {
  switch (position) {
    case 'top':
      return 8;
    case 'middle':
      return 5;
    case 'bottom':
      return 2;
    default:
      return 5; // default middle
  }
}

// F6.3 — generate ASS file with KARAOKE-style word highlight. Each word
// gets its own Dialogue line that's visible only during that word's
// spoken window, with the current word painted in `highlightColor`. The
// rest of the sentence stays in normal style. This matches how ZapCap-style
// captions emphasize the spoken word, so a black-screen insertion looks
// continuous with the rest of the captioned video.
//
// words[].offsetMs is RELATIVE to segment start (not absolute video time).
function writeAssFileKaraoke(
  workDir: string,
  idx: number,
  text: string,
  words: Array<{ text: string; offsetMs: number; durationMs: number }>,
  width: number,
  height: number,
  fontSize: number,
  position: string,
  highlightColorHex: string,
  totalDurationMs: number
): string {
  const p = path.join(workDir, `text_kara_${idx}.ass`);
  const escapeAss = (s: string) =>
    s.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\r?\n/g, '\\N');

  const alignment = positionToAssAlignment(position);
  const highlightAss = hexToAssColor(highlightColorHex);

  // Build Dialogue lines: one per word. Each spans the word's time window
  // and renders the whole sentence with ONLY this word inline-colored.
  // Stable order matters — the wordTokens list mirrors text exactly so
  // we can join with " " between them.
  const wordTokens = words.map((w) => w.text);
  const dialogueLines: string[] = [];

  if (words.length === 0) {
    // No word-level timing → fallback to static text for the whole duration.
    dialogueLines.push(
      `Dialogue: 0,${msToAssTime(0)},${msToAssTime(totalDurationMs)},Default,,0,0,0,,${escapeAss(text)}`
    );
  } else {
    const firstWord = words[0]!;
    const lastWord = words[words.length - 1]!;
    // Show static sentence before the first word starts (avoids flash of empty).
    if (firstWord.offsetMs > 50) {
      dialogueLines.push(
        `Dialogue: 0,${msToAssTime(0)},${msToAssTime(firstWord.offsetMs)},Default,,0,0,0,,${escapeAss(wordTokens.join(' '))}`
      );
    }

    words.forEach((w, i) => {
      const startMs = w.offsetMs;
      // Extend the highlight slightly into the gap before the next word
      // (looks smoother than abrupt color drops). Cap at totalDuration.
      const nextStart = words[i + 1]?.offsetMs ?? totalDurationMs;
      const endMs = Math.min(nextStart, totalDurationMs);
      if (endMs <= startMs) return;

      const parts = wordTokens.map((tok, j) => {
        if (j === i) return `{\\1c${highlightAss}\\b1}${escapeAss(tok)}{\\r}`;
        return escapeAss(tok);
      });
      dialogueLines.push(
        `Dialogue: 0,${msToAssTime(startMs)},${msToAssTime(endMs)},Default,,0,0,0,,${parts.join(' ')}`
      );
    });

    // After last word ends, hold the sentence static if there's time left.
    const lastEnd = Math.min(lastWord.offsetMs + lastWord.durationMs, totalDurationMs);
    if (totalDurationMs - lastEnd > 50) {
      dialogueLines.push(
        `Dialogue: 0,${msToAssTime(lastEnd)},${msToAssTime(totalDurationMs)},Default,,0,0,0,,${escapeAss(wordTokens.join(' '))}`
      );
    }
  }

  // MarginV: distance from edge in pixels. For middle (Alignment=5) it
  // is ignored. For top (8) it's distance from top; for bottom (2) from bottom.
  const marginV = position === 'middle' ? 0 : Math.round(height * 0.15);

  const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,${fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,3,0,${alignment},80,80,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${dialogueLines.join('\n')}
`;

  fs.writeFileSync(p, ass, 'utf8');
  return p;
}

// POST /api/video/intercut
// Takes a finished video and splices in black-screen text segments. Audio
// plays continuously through both avatar and black chunks (the avatar audio
// just keeps going behind the black frames).
//
// Two modes:
//
//   1) Legacy "cadence" mode (backwards compat) — alternates avatar/black
//      at a regular interval until the video ends.
//      Body: { videoUrl, userId, avatarChunkSec, blackChunkSec, blackTexts[], fontSize? }
//
//   2) F6.3 "manual insertions" mode — user picks WHERE and WHAT each black
//      screen shows. Each insertion can carry per-word timestamps so we
//      render the caption with the word-being-spoken highlighted in sync.
//      Body: {
//        videoUrl, userId, fontSize?,
//        insertions: [{
//          atSec: number,                  // when in the source video to insert
//          durationSec: number,            // how long the black screen lasts
//          text: string,                   // full sentence to display
//          position: 'top'|'middle'|'bottom',
//          words?: [{ text, offsetMs, durationMs }],   // karaoke timing
//          highlightColor?: string,        // e.g. "#9333EA" — default purple
//        }]
//      }
videoRouter.post(
  '/intercut',
  withFfmpegQueue(async (req, res) => {
    const {
      videoUrl,
      avatarChunkSec,
      blackChunkSec,
      blackTexts,
      userId,
      fontSize = 64,
      insertions,
    } = req.body || {};

    if (!videoUrl || !userId) {
      return res.status(400).json({ error: 'videoUrl and userId are required.' });
    }

    // Mode detection: insertions[] present and non-empty → manual mode.
    const isManualMode = Array.isArray(insertions) && insertions.length > 0;

    // Legacy mode validation (only runs if NOT manual).
    let A = 0;
    let B = 0;
    let texts: string[] = [];
    if (!isManualMode) {
      A = Number(avatarChunkSec);
      B = Number(blackChunkSec);
      if (!Number.isFinite(A) || A < 3 || A > 120) {
        return res.status(400).json({ error: 'avatarChunkSec must be between 3 and 120.' });
      }
      if (!Number.isFinite(B) || B < 1 || B > 120) {
        return res.status(400).json({ error: 'blackChunkSec must be between 1 and 120.' });
      }
      texts = Array.isArray(blackTexts) ? blackTexts.map((t) => String(t)) : [];
    } else {
      // Validate each insertion shape.
      for (const ins of insertions) {
        if (
          !Number.isFinite(Number(ins?.atSec)) ||
          !Number.isFinite(Number(ins?.durationSec)) ||
          Number(ins.durationSec) <= 0
        ) {
          return res.status(400).json({ error: 'Each insertion needs atSec and durationSec > 0.' });
        }
      }
    }

    const intercutId = `intercut_${Date.now()}`;
    const workDir = path.join(GENERATED_DIR, intercutId);
    if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

    const sourcePath = path.join(workDir, 'source.mp4');
    const audioPath = path.join(workDir, 'audio.aac');

    try {
      log.info('intercut request', {
        videoUrl: videoUrl.substring(0, 80),
        mode: isManualMode ? 'manual' : 'cadence',
        A,
        B,
        texts: texts.length,
        insertions: isManualMode ? insertions.length : 0,
      });

      await downloadFile(videoUrl, sourcePath);

      const metadata: any = await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(sourcePath, (err, m) => (err ? reject(err) : resolve(m)));
      });
      const totalDuration: number = Number(metadata.format.duration) || 0;
      const vStream = metadata.streams.find((s: any) => s.codec_type === 'video');
      const W = vStream?.width || 1080;
      const H = vStream?.height || 1080;
      if (!isManualMode && totalDuration < A + 1) {
        return res.status(400).json({
          error: `Vídeo muito curto (${totalDuration.toFixed(1)}s) para inserir cortes a cada ${A}s.`,
        });
      }
      // Manual mode validation: each insertion must fit inside the source.
      if (isManualMode) {
        for (const ins of insertions) {
          if (
            Number(ins.atSec) < 0 ||
            Number(ins.atSec) + Number(ins.durationSec) > totalDuration + 0.5
          ) {
            return res.status(400).json({
              error: `Inserção em ${ins.atSec}s (+${ins.durationSec}s) cai fora do vídeo (${totalDuration.toFixed(1)}s).`,
            });
          }
        }
      }

      // Extract the original audio track so we can re-mux it onto the new
      // visual timeline. Audio is continuous — only the picture alternates.
      // Use dedicated methods (not outputOptions varargs) so each FFmpeg flag
      // arrives as its own argv token.
      await new Promise((resolve, reject) => {
        ffmpeg(sourcePath)
          .noVideo()
          .audioCodec('aac')
          .audioBitrate('128k')
          .output(audioPath)
          .on('end', () => resolve(null))
          .on('error', reject)
          .run();
      });

      // Build the visual timeline. Two strategies:
      //
      // Cadence mode: avatar(0..A), black(A..A+B), avatar, black, ... until
      // the source audio runs out. Texts cycle if fewer than black segments.
      //
      // F6.3 manual mode: a list of explicit "insert black at X for Y seconds
      // showing TEXT" events. We sort them by atSec and stitch avatar chunks
      // around them. Each black chunk uses ASS karaoke (per-word highlight)
      // when the insertion includes words[].
      const segments: string[] = [];
      let segIdx = 0;
      let blackIdx = 0;

      // Helper: render the original video from `start` for `dur` seconds.
      // Reused by both modes — only difference is when we call it.
      const renderAvatarSegment = async (start: number, dur: number): Promise<void> => {
        if (dur <= 0.1) return;
        const segPath = path.join(workDir, `seg_${segIdx++}_avatar.mp4`);
        await new Promise((resolve, reject) => {
          ffmpeg(sourcePath)
            .inputOptions('-accurate_seek')
            .setStartTime(start)
            .setDuration(dur)
            .outputOptions([
              '-c:v libx264',
              '-preset superfast',
              '-crf 23',
              '-an',
              '-pix_fmt yuv420p',
              '-r 30',
              '-vf',
              `scale=${W}:${H},setsar=1`,
            ])
            .output(segPath)
            .on('end', () => resolve(null))
            .on('error', reject)
            .run();
        });
        segments.push(segPath);
      };

      // Helper: render a black segment with optional caption/karaoke.
      const renderBlackSegment = async (
        durSec: number,
        text: string,
        words: Array<{ text: string; offsetMs: number; durationMs: number }> | undefined,
        position: string,
        highlightColor: string
      ): Promise<void> => {
        if (durSec < 0.3) return;
        let subtitleFilter = '';
        if (text) {
          const assPath =
            words && words.length > 0
              ? writeAssFileKaraoke(
                  workDir,
                  segIdx,
                  text,
                  words,
                  W,
                  H,
                  fontSize,
                  position,
                  highlightColor,
                  durSec * 1000
                )
              : writeAssFile(workDir, segIdx, text, W, H, fontSize);
          subtitleFilter = `,subtitles=${escapeFilterPath(assPath)}`;
        }
        const segPath = path.join(workDir, `seg_${segIdx++}_black.mp4`);
        await new Promise((resolve, reject) => {
          ffmpeg(`color=c=black:s=${W}x${H}:d=${durSec}:r=30`)
            .inputFormat('lavfi')
            .outputOptions([
              '-c:v libx264',
              '-preset superfast',
              '-crf 23',
              '-an',
              '-pix_fmt yuv420p',
              '-vf',
              `setsar=1${subtitleFilter}`,
            ])
            .output(segPath)
            .on('end', () => resolve(null))
            .on('error', reject)
            .run();
        });
        segments.push(segPath);
        blackIdx++;
      };

      if (isManualMode) {
        // Sort insertions by start time so the timeline is monotonic.
        const sorted = [...insertions].sort((a: any, b: any) => Number(a.atSec) - Number(b.atSec));
        let cursor = 0;
        for (const ins of sorted) {
          const at = Number(ins.atSec);
          const dur = Number(ins.durationSec);
          // Avatar fill from current cursor up to the insertion point.
          if (at > cursor + 0.05) {
            await renderAvatarSegment(cursor, at - cursor);
          }
          // Black insertion (replaces the avatar visual for `dur` seconds —
          // original audio still plays underneath thanks to the remux step).
          await renderBlackSegment(
            dur,
            String(ins.text || ''),
            Array.isArray(ins.words) ? ins.words : undefined,
            String(ins.position || 'middle'),
            String(ins.highlightColor || '#9333EA')
          );
          cursor = at + dur;
        }
        // Tail: render the remaining avatar after the last insertion.
        if (cursor < totalDuration - 0.05) {
          await renderAvatarSegment(cursor, totalDuration - cursor);
        }
      } else {
        // Legacy cadence mode (preserved as-is for backwards compat).
        let cursor = 0;
        while (cursor < totalDuration - 0.05) {
          const aDur = Math.min(A, totalDuration - cursor);
          if (aDur > 0.1) {
            await renderAvatarSegment(cursor, aDur);
            cursor += aDur;
          }
          if (cursor >= totalDuration - 0.05) break;
          const bDur = Math.min(B, totalDuration - cursor);
          if (bDur < 0.5) break;
          const rawText = texts.length > 0 ? texts[blackIdx % texts.length] || '' : '';
          await renderBlackSegment(bDur, rawText, undefined, 'middle', '#9333EA');
          cursor += bDur;
        }
      }

      if (segments.length === 0) {
        return res.status(500).json({ error: 'No segments produced.' });
      }

      // Concat visual segments.
      const concatListPath = path.join(workDir, 'concat.txt');
      fs.writeFileSync(concatListPath, segments.map((p) => `file '${p}'`).join('\n'));

      const visualPath = path.join(workDir, 'visual.mp4');
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(concatListPath)
          .inputOptions(['-f concat', '-safe 0'])
          .outputOptions(['-c:v libx264', '-preset superfast', '-crf 23', '-pix_fmt yuv420p'])
          .output(visualPath)
          .on('end', () => resolve(null))
          .on('error', reject)
          .run();
      });

      // Re-mux original audio onto the stitched visual.
      const finalFilename = `${intercutId}.mp4`;
      const finalPath = path.join(GENERATED_DIR, finalFilename);
      await new Promise((resolve, reject) => {
        ffmpeg(visualPath)
          .input(audioPath)
          .outputOptions([
            '-c:v copy',
            '-c:a aac',
            '-b:a 128k',
            '-map 0:v:0',
            '-map 1:a:0',
            '-shortest',
            '-movflags +faststart',
          ])
          .output(finalPath)
          .on('end', () => resolve(null))
          .on('error', reject)
          .run();
      });

      // Persist to Firebase Storage so the URL doesn't depend on the local
      // /generated/ folder surviving restarts. getSignedUrl avoids the
      // makePublic-vs-Uniform-bucket-access pitfall.
      let publicUrl = `/generated/${finalFilename}`;
      if (admin.apps.length > 0) {
        try {
          const bucket = admin.storage().bucket();
          const destination = `intercut/${userId}/${intercutId}.mp4`;
          await bucket.upload(finalPath, {
            destination,
            metadata: { contentType: 'video/mp4' },
          });
          const [signedUrl] = await bucket.file(destination).getSignedUrl({
            action: 'read',
            expires: '03-09-2491',
          });
          publicUrl = signedUrl;
          log.info('intercut uploaded', { publicUrl: publicUrl.split('?')[0] });
        } catch (e: any) {
          log.error('intercut firebase upload failed (returning local URL):', e.message);
        }
      }

      res.json({ url: publicUrl, segments: segments.length, blackCount: blackIdx });
    } catch (err: any) {
      log.error('intercut failed:', err.message);
      res.status(500).json({ error: `Intercut failed: ${err.message}` });
    } finally {
      // Clean the work dir (keep the final file in GENERATED_DIR — it's
      // referenced by the local URL fallback).
      try {
        if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  })
);

// POST /api/video/concat
// Joins 2+ videos into one. Normalises every input to the first input's
// WxH/fps (scale + pad to fit, keeping aspect), then concats video+audio.
//
// Body:
//   videos: string[]   — URLs of the videos to concat, in order
//   userId: string
videoRouter.post(
  '/concat',
  withFfmpegQueue(async (req, res) => {
    const { videos, userId } = req.body || {};
    if (!Array.isArray(videos) || videos.length < 2) {
      return res.status(400).json({ error: 'videos must be an array of at least 2 URLs.' });
    }
    if (!userId) return res.status(400).json({ error: 'userId is required.' });

    const jobId = `concat_${Date.now()}`;
    const workDir = path.join(GENERATED_DIR, jobId);
    fs.mkdirSync(workDir, { recursive: true });

    try {
      log.info('concat request', { count: videos.length });

      // Download / copy each input. Videos that live on this server (e.g.
      // intercut/ZapCap output kept locally when Firebase upload failed) come
      // through as "/generated/foo.mp4" — those need a filesystem copy, not
      // an HTTP fetch, since downloadFile() can't resolve relative URLs.
      const localPaths: string[] = [];
      for (let i = 0; i < videos.length; i++) {
        const src = String(videos[i]);
        const p = path.join(workDir, `in_${i}.mp4`);
        if (src.startsWith('/generated/')) {
          const sourcePath = path.join(GENERATED_DIR, src.replace('/generated/', ''));
          if (!fs.existsSync(sourcePath)) {
            throw new Error(`Local video not found: ${src}`);
          }
          fs.copyFileSync(sourcePath, p);
        } else {
          await downloadFile(src, p);
        }
        localPaths.push(p);
      }

      // Probe the first input for target dimensions/fps.
      const firstMeta: any = await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(localPaths[0]!, (err, m) => (err ? reject(err) : resolve(m)));
      });
      const v0 = firstMeta.streams.find((s: any) => s.codec_type === 'video');
      const W = v0?.width || 1080;
      const H = v0?.height || 1920;

      // Re-encode each input to identical WxH (scale + pad), 30 fps, AAC
      // stereo audio. Generate silent audio for inputs without sound so the
      // concat filter always sees v+a per input.
      const normalised: string[] = [];
      for (let i = 0; i < localPaths.length; i++) {
        const inPath = localPaths[i]!;
        const outPath = path.join(workDir, `norm_${i}.mp4`);
        const meta: any = await new Promise((resolve, reject) => {
          ffmpeg.ffprobe(inPath, (err, m) => (err ? reject(err) : resolve(m)));
        });
        const hasAudio = !!meta.streams.find((s: any) => s.codec_type === 'audio');

        await new Promise((resolve, reject) => {
          const cmd = ffmpeg(inPath);
          if (!hasAudio) {
            cmd.input('anullsrc=channel_layout=stereo:sample_rate=48000').inputFormat('lavfi');
          }
          cmd
            .videoFilters(
              `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`
            )
            .outputOptions([
              '-c:v',
              'libx264',
              '-preset',
              'superfast',
              '-crf',
              '20',
              '-c:a',
              'aac',
              '-b:a',
              '160k',
              '-ar',
              '48000',
              '-ac',
              '2',
              '-pix_fmt',
              'yuv420p',
              '-shortest',
            ])
            .output(outPath)
            .on('end', () => resolve(null))
            .on('error', reject)
            .run();
        });
        normalised.push(outPath);
      }

      // Use the concat demuxer now that all inputs share codec params.
      const listPath = path.join(workDir, 'concat.txt');
      fs.writeFileSync(listPath, normalised.map((p) => `file '${p}'`).join('\n'));

      const finalFilename = `${jobId}.mp4`;
      const finalPath = path.join(GENERATED_DIR, finalFilename);

      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(listPath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions(['-c', 'copy', '-movflags', '+faststart'])
          .output(finalPath)
          .on('end', () => resolve(null))
          .on('error', reject)
          .run();
      });

      let publicUrl = `/generated/${finalFilename}`;
      if (admin.apps.length > 0) {
        try {
          const bucket = admin.storage().bucket();
          const destination = `concat/${userId}/${jobId}.mp4`;
          await bucket.upload(finalPath, {
            destination,
            metadata: { contentType: 'video/mp4' },
          });
          const [signedUrl] = await bucket.file(destination).getSignedUrl({
            action: 'read',
            expires: '03-09-2491',
          });
          publicUrl = signedUrl;
        } catch (e: any) {
          log.error('concat firebase upload failed (returning local URL):', e.message);
        }
      }

      res.json({ url: publicUrl, count: videos.length });
    } catch (err: any) {
      log.error('concat failed:', err.message);
      res.status(500).json({ error: `Concat failed: ${err.message}` });
    } finally {
      try {
        if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  })
);

// Convert "#RRGGBB" → ASS-friendly "&H00BBGGRR&" (ASS uses BGR, reversed).
function hexToAssBgr(hex: string): string {
  const clean = hex.replace('#', '').padStart(6, '0').slice(0, 6);
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  return `&H00${b}${g}${r}&`.toUpperCase();
}

// Normalise a string for word-by-word matching against an AssemblyAI
// transcript: lowercase, strip punctuation, collapse whitespace, return tokens.
function normaliseForMatch(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

// Find a contiguous run of transcript words that matches the headline
// tokens. Returns the [startMs, endMs] of the matched run, or null if
// no match. Match is exact-token; we don't do fuzzy yet because the
// avatar usually reads the script verbatim.
function findHeadlineTimingInTranscript(
  headlineText: string,
  words: Array<{ text: string; start: number; end: number }>
): { startMs: number; endMs: number } | null {
  const headlineTokens = normaliseForMatch(headlineText);
  if (headlineTokens.length === 0 || words.length === 0) return null;
  const transcriptTokens = words.map((w) => normaliseForMatch(w.text)[0] || '');
  for (let i = 0; i <= transcriptTokens.length - headlineTokens.length; i++) {
    let ok = true;
    for (let j = 0; j < headlineTokens.length; j++) {
      if (transcriptTokens[i + j] !== headlineTokens[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      const first = words[i]!;
      const last = words[i + headlineTokens.length - 1]!;
      return { startMs: first.start, endMs: last.end };
    }
  }
  return null;
}

// Uploads a local file to AssemblyAI's /upload endpoint and returns the
// resulting transient URL, which can then be passed as audio_url in a
// transcript request. Needed when our source video lives at /generated/...
// (not reachable from AssemblyAI's servers).
async function uploadToAssemblyAI(localPath: string, apiKey: string): Promise<string | null> {
  try {
    const buf = fs.readFileSync(localPath);
    const resp = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: { authorization: apiKey, 'content-type': 'application/octet-stream' },
      body: buf,
    });
    if (!resp.ok) {
      log.error('assemblyai upload failed', { status: resp.status });
      return null;
    }
    const data = await resp.json();
    return data.upload_url || null;
  } catch (err: any) {
    log.error('assemblyai upload exception', { err: err.message });
    return null;
  }
}

// Submits a video URL (must be publicly fetchable) to AssemblyAI, polls
// until completion, returns word-level timestamps. Returns null on any
// failure so the caller can fall back to manual timing.
async function fetchAssemblyAIWords(
  audioUrl: string,
  apiKey: string
): Promise<Array<{ text: string; start: number; end: number }> | null> {
  try {
    const submit = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: { authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio_url: audioUrl,
        speech_models: ['universal-2'],
        language_detection: true,
      }),
    });
    if (!submit.ok) {
      log.error('assemblyai submit failed', { status: submit.status });
      return null;
    }
    const submitData = await submit.json();
    const id = submitData.id;
    if (!id) return null;

    // Poll up to ~3 minutes (24 * 7.5s) — short hooks usually complete
    // under 30s, but headroom for AssemblyAI queue spikes.
    for (let attempt = 0; attempt < 24; attempt++) {
      await new Promise((r) => setTimeout(r, 7500));
      const status = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
        headers: { authorization: apiKey },
      });
      if (!status.ok) continue;
      const data = await status.json();
      if (data.status === 'completed') return data.words || [];
      if (data.status === 'error') {
        log.error('assemblyai transcript errored', { error: data.error });
        return null;
      }
    }
    log.error('assemblyai polling timed out');
    return null;
  } catch (err: any) {
    log.error('assemblyai exception', { err: err.message });
    return null;
  }
}

// POST /api/video/add-headline
// Burns a Meta-style colored bar with a headline across the top of the
// video. The bar is rendered via FFmpeg's drawbox filter; the text via the
// ASS subtitles filter (libass) which our ffmpeg-static build supports.
//
// Body:
//   videoUrl: string            — source video (HTTP or /generated/...)
//   userId: string
//   text: string                — the headline text
//   bgColor?: string            — hex like "#000000" (default black)
//   textColor?: string          — hex like "#FFFFFF" (default white)
//   fontSize?: number           — px, default ~10% of video height
//   barHeightPct?: number       — 5..30 (% of video height), default 14
videoRouter.post(
  '/add-headline',
  withFfmpegQueue(async (req, res) => {
    const {
      videoUrl,
      userId,
      text,
      bgColor = '#000000',
      textColor = '#FFFFFF',
      strokeColor = '',
      strokeWidth = 0,
      highlightColor1 = '',
      highlightColor2 = '',
      highlightColor3 = '',
      bgHighlight1 = '',
      bgHighlight2 = '',
      bgHighlight3 = '',
      wordStyles,
      // New multi-headline shape: array of { text, wordStyles, bgColor? }.
      // Each headline gets its own bar color (inherits global bgColor if absent)
      // and ASS dialogue. switchPct (10-90) controls when the second one starts
      // in manual mode. When autoTime=true, we ignore switchPct and instead
      // transcribe the audio + find each headline's spoken timestamps.
      headlines: headlinesArr,
      switchPct = 50,
      autoTime = false,
      fontSize,
      barHeightPct = 14,
    } = req.body || {};

    if (!videoUrl || !userId) {
      return res.status(400).json({ error: 'videoUrl and userId are required.' });
    }
    // Build the headlines list. Backwards-compat: if no `headlines` array, treat
    // the top-level text/wordStyles as a single headline.
    const incomingHeadlines: Array<{ text?: string; wordStyles?: any; bgColor?: string }> =
      Array.isArray(headlinesArr) && headlinesArr.length > 0
        ? headlinesArr
        : [{ text, wordStyles, bgColor }];
    const headlinesList = incomingHeadlines
      .map((h) => ({
        text: String(h?.text || '').trim(),
        wordStyles: Array.isArray(h?.wordStyles) ? h.wordStyles : [],
        bgColor: typeof h?.bgColor === 'string' && h.bgColor ? h.bgColor : bgColor,
      }))
      .filter((h) => h.text.length > 0);
    if (headlinesList.length === 0) {
      return res.status(400).json({ error: 'At least one headline text is required.' });
    }
    if (headlinesList.length > 2) {
      return res.status(400).json({ error: 'Maximum 2 headlines supported.' });
    }
    const switchAtPct = Math.max(10, Math.min(90, Number(switchPct) || 50));
    const barPct = Math.max(5, Math.min(30, Number(barHeightPct) || 14));
    const isHex = (s: any) => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
    const strokeW = Math.max(0, Math.min(8, Number(strokeWidth) || 0));

    const jobId = `headline_${Date.now()}`;
    const workDir = path.join(GENERATED_DIR, jobId);
    fs.mkdirSync(workDir, { recursive: true });

    try {
      log.info('add-headline request', {
        videoUrl: String(videoUrl).substring(0, 60),
        headlinesCount: headlinesList.length,
        switchPct: switchAtPct,
        bgColor,
        textColor,
      });

      const sourcePath = path.join(workDir, 'source.mp4');
      const src = String(videoUrl);
      if (src.startsWith('/generated/')) {
        const localPath = path.join(GENERATED_DIR, src.replace('/generated/', ''));
        if (!fs.existsSync(localPath)) throw new Error(`Local video not found: ${src}`);
        fs.copyFileSync(localPath, sourcePath);
      } else {
        await downloadFile(src, sourcePath);
      }

      const metadata: any = await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(sourcePath, (err, m) => (err ? reject(err) : resolve(m)));
      });
      const vStream = metadata.streams.find((s: any) => s.codec_type === 'video');
      const W = vStream?.width || 1080;
      const H = vStream?.height || 1920;
      const barHeight = Math.round((H * barPct) / 100);
      const fSize = Math.max(20, Math.min(160, Number(fontSize) || Math.round(barHeight * 0.55)));

      // Per-word styling: each headline carries its own `wordStyles` array
      // (Array<{tc: 0|1|2|3, bg: 0|1|2|3}>) indexed by non-whitespace token.
      //   tc = which letter color from the 3-color palette (0 = default)
      //   bg = which background highlight from the 3-color palette (0 = none)
      // We tokenize the text keeping whitespace, walk word by word, and emit
      // ASS chunks that switch between the HL (normal+stroke) and HLBG
      // (BorderStyle=3 = opaque colored box per character) styles inline.
      const assPath = path.join(workDir, 'headline.ass');
      const textColors: (string | null)[] = [
        isHex(highlightColor1) ? highlightColor1 : null,
        isHex(highlightColor2) ? highlightColor2 : null,
        isHex(highlightColor3) ? highlightColor3 : null,
      ];
      const bgColors: (string | null)[] = [
        isHex(bgHighlight1) ? bgHighlight1 : null,
        isHex(bgHighlight2) ? bgHighlight2 : null,
        isHex(bgHighlight3) ? bgHighlight3 : null,
      ];

      const escAss = (s: string): string =>
        s
          .replace(/\\/g, '\\\\')
          .replace(/\{/g, '\\{')
          .replace(/\}/g, '\\}')
          .replace(/\r?\n/g, '\\N');

      // Padding for the per-char bg box. Big enough to look like a tight
      // highlight bar at this font size, small enough not to swallow letters.
      const bgPadding = Math.max(4, Math.round(fSize * 0.12));

      // Build the inline ASS text for one headline. Suffix lets the caller
      // target style HL_<suffix> / HLBG_<suffix> so we can have per-headline
      // styles when there are two.
      function renderHeadlineText(
        txt: string,
        ws: Array<{ tc?: number; bg?: number }>,
        suffix: string
      ): string {
        const tokens = txt.split(/(\s+)/);
        let wordIdx = 0;
        let prevTc = 0;
        let prevBg = 0;
        let out = '';
        for (const tok of tokens) {
          if (tok === '') continue;
          const isWhitespace = /^\s+$/.test(tok);
          const style = isWhitespace ? null : ws[wordIdx] || {};
          if (!isWhitespace) wordIdx++;
          const tc = isWhitespace ? 0 : Number(style?.tc) || 0;
          const bg = isWhitespace ? prevBg : Number(style?.bg) || 0;

          const overrides: string[] = [];
          if (bg > 0 && prevBg === 0) {
            overrides.push(`\\rHLBG_${suffix}`);
          } else if (bg === 0 && prevBg > 0) {
            overrides.push(`\\rHL_${suffix}`);
          }
          if (bg > 0 && (bg !== prevBg || prevBg === 0)) {
            const bgHex = bgColors[bg - 1];
            if (bgHex) {
              overrides.push(`\\3c${hexToAssBgr(bgHex)}\\bord${bgPadding}`);
            }
          }
          if (tc !== prevTc) {
            if (tc === 0) {
              overrides.push(`\\c${hexToAssBgr(textColor)}`);
            } else {
              const tcHex = textColors[tc - 1];
              if (tcHex) overrides.push(`\\c${hexToAssBgr(tcHex)}`);
            }
          }

          if (overrides.length > 0) {
            out += `{${overrides.join('')}}`;
          }
          out += escAss(tok);
          prevTc = tc;
          prevBg = bg;
        }
        return out;
      }

      // Probe duration so we can split timing across 2 headlines.
      const durationSec: number = Number(metadata.format?.duration) || 0;
      if (durationSec <= 0) {
        throw new Error('Could not detect video duration.');
      }
      const switchAtSec =
        headlinesList.length === 2 ? (durationSec * switchAtPct) / 100 : durationSec;

      // Auto-sync: if the user asked for it, transcribe the source audio via
      // AssemblyAI, find each headline's spoken timestamps, and use those for
      // ASS dialogue + drawbox timing. perHeadlineTimings stays null if any
      // step fails — the loop below then falls back to manual percent timing.
      let perHeadlineTimings: Array<{ startSec: number; endSec: number } | null> | null = null;
      let autoTimeStatus: 'off' | 'applied' | 'failed' | 'partial' = autoTime ? 'failed' : 'off';
      if (autoTime) {
        const aaKey = getAssemblyAIKey();
        if (!aaKey) {
          log.warn('add-headline: autoTime requested but ASSEMBLYAI_API_KEY missing');
        } else {
          // Use the source URL directly if HTTP, else upload the local file.
          const srcStr = String(videoUrl);
          let assemblyAudioUrl: string | null = null;
          if (srcStr.startsWith('http')) {
            assemblyAudioUrl = srcStr;
          } else {
            log.info('add-headline autoTime: uploading local source to AssemblyAI');
            assemblyAudioUrl = await uploadToAssemblyAI(sourcePath, aaKey);
          }
          if (assemblyAudioUrl) {
            log.info('add-headline autoTime: requesting transcript');
            const words = await fetchAssemblyAIWords(assemblyAudioUrl, aaKey);
            if (words && words.length > 0) {
              const detected = headlinesList.map((h) => {
                const m = findHeadlineTimingInTranscript(h.text, words);
                return m ? { startSec: m.startMs / 1000, endSec: m.endMs / 1000 } : null;
              });
              const matched = detected.filter((t) => t !== null).length;
              if (matched === headlinesList.length) {
                perHeadlineTimings = detected;
                autoTimeStatus = 'applied';
              } else if (matched > 0) {
                // Partial match: use detected for matched headlines, fall back
                // for unmatched ones (start=0/switchAtSec, end=switchAtSec/duration).
                perHeadlineTimings = detected.map((t, idx) => {
                  if (t) return t;
                  const fallbackStart = idx === 0 ? 0 : switchAtSec;
                  const fallbackEnd =
                    idx === 0 && headlinesList.length === 2 ? switchAtSec : durationSec;
                  return { startSec: fallbackStart, endSec: fallbackEnd };
                });
                autoTimeStatus = 'partial';
                log.warn('add-headline autoTime: partial match', {
                  matchedCount: matched,
                  total: headlinesList.length,
                });
              } else {
                log.warn('add-headline autoTime: no headline found in transcript');
              }

              // Normalise the auto-detected timings so the displayed headlines
              // match what the user expects:
              //   1. Headline #1 ALWAYS starts at 0 — the first headline should
              //      be visible from the very first frame of the hook, not when
              //      its first matching word happens to be spoken.
              //   2. Each headline's end is clamped to the next one's start
              //      (no overlap, no gap). libass treats Dialogue End as
              //      exclusive, so an exact boundary produces a clean handoff.
              //   3. The last headline stays on until the end of the video.
              if (perHeadlineTimings) {
                const first = perHeadlineTimings[0];
                if (first) first.startSec = 0;

                for (let i = 0; i < perHeadlineTimings.length - 1; i++) {
                  const cur = perHeadlineTimings[i];
                  const next = perHeadlineTimings[i + 1];
                  if (cur && next) {
                    // Bridge gap AND clamp overlap — either way, cur.end ==
                    // next.start exactly so the user never sees both at once.
                    cur.endSec = next.startSec;
                  }
                }
                const last = perHeadlineTimings[perHeadlineTimings.length - 1];
                if (last && last.endSec < durationSec) {
                  last.endSec = durationSec;
                }
                log.info('add-headline autoTime: timings after normalization', {
                  status: autoTimeStatus,
                  timings: perHeadlineTimings,
                });
              }
            }
          }
        }
      }
      const toAssTime = (sec: number): string => {
        const totalCs = Math.max(0, Math.round(sec * 100));
        const cs = totalCs % 100;
        const totalS = Math.floor(totalCs / 100);
        const s = totalS % 60;
        const totalM = Math.floor(totalS / 60);
        const mm = totalM % 60;
        const h = Math.floor(totalM / 60);
        return `${h}:${String(mm).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(
          cs
        ).padStart(2, '0')}`;
      };

      const centerX = Math.round(W / 2);
      const centerY = Math.round(barHeight / 2);
      // Stroke (outline): if user supplied a stroke color + non-zero width,
      // bake it into the HL Style. HLBG always uses BorderStyle=3 with
      // dynamic outline width set inline via \bord.
      const outlineColourAss = isHex(strokeColor) ? hexToAssBgr(strokeColor) : '&H00000000';
      const outlineWidthForStyle = isHex(strokeColor) && strokeW > 0 ? strokeW : 0;
      const textColourAss = hexToAssBgr(textColor);

      // Build styles + dialogues per headline. With 2 headlines we suffix
      // styles _1 / _2 so per-headline style switches don't collide.
      const styleLines: string[] = [];
      const dialogueLines: string[] = [];
      headlinesList.forEach((h, idx) => {
        const suffix = String(idx + 1);
        styleLines.push(
          `Style: HL_${suffix},Arial,${fSize},${textColourAss},${textColourAss},${outlineColourAss},&H00000000,1,0,0,0,100,100,0,0,1,${outlineWidthForStyle},0,5,40,40,0,1`
        );
        styleLines.push(
          `Style: HLBG_${suffix},Arial,${fSize},${textColourAss},${textColourAss},&H00000000,&H00000000,1,0,0,0,100,100,0,0,3,0,0,5,40,40,0,1`
        );
        const auto = perHeadlineTimings?.[idx] ?? null;
        const start = auto ? auto.startSec : idx === 0 ? 0 : switchAtSec;
        const end = auto
          ? auto.endSec
          : idx === 0 && headlinesList.length === 2
            ? switchAtSec
            : durationSec;
        const rendered = renderHeadlineText(h.text, h.wordStyles, suffix);
        dialogueLines.push(
          `Dialogue: 0,${toAssTime(start)},${toAssTime(end)},HL_${suffix},,0,0,0,,{\\an5\\pos(${centerX},${centerY})}${rendered}`
        );
      });

      const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styleLines.join('\n')}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${dialogueLines.join('\n')}
`;
      fs.writeFileSync(assPath, ass, 'utf8');

      // FFmpeg pipeline: chain ONE drawbox per headline, each timed via the
      // drawbox `enable` expression. Bar timings match the ASS dialogue
      // timings exactly — no overlap, no gap. Per user request: when H2
      // appears, H1 should disappear in the same frame.
      const drawboxFilters = headlinesList.map((h, idx) => {
        const color = (h.bgColor || bgColor).replace('#', '').toLowerCase();
        const auto = perHeadlineTimings?.[idx] ?? null;
        const start = auto ? auto.startSec : idx === 0 ? 0 : switchAtSec;
        const end = auto
          ? auto.endSec
          : idx === 0 && headlinesList.length === 2
            ? switchAtSec
            : durationSec;
        const needsGate = !!auto || headlinesList.length > 1;
        const enable = needsGate
          ? `:enable='between(t,${start.toFixed(2)},${end.toFixed(2)})'`
          : '';
        return `drawbox=x=0:y=0:w=${W}:h=${barHeight}:color=0x${color}:t=fill${enable}`;
      });
      const videoFilter = `${drawboxFilters.join(',')},subtitles=${escapeFilterPath(assPath)}`;

      const finalFilename = `${jobId}.mp4`;
      const finalPath = path.join(GENERATED_DIR, finalFilename);

      await new Promise((resolve, reject) => {
        ffmpeg(sourcePath)
          .videoFilters(videoFilter)
          .outputOptions([
            '-c:v',
            'libx264',
            '-preset',
            'superfast',
            '-crf',
            '20',
            '-c:a',
            'copy',
            '-pix_fmt',
            'yuv420p',
            '-movflags',
            '+faststart',
          ])
          .output(finalPath)
          .on('end', () => resolve(null))
          .on('error', reject)
          .run();
      });

      // Persist to Firebase via signed URL (same robust pattern as the
      // other endpoints).
      let publicUrl = `/generated/${finalFilename}`;
      if (admin.apps.length > 0) {
        try {
          const bucket = admin.storage().bucket();
          const destination = `headline/${userId}/${jobId}.mp4`;
          await bucket.upload(finalPath, {
            destination,
            metadata: { contentType: 'video/mp4' },
          });
          const [signedUrl] = await bucket.file(destination).getSignedUrl({
            action: 'read',
            expires: '03-09-2491',
          });
          publicUrl = signedUrl;
          log.info('headline uploaded', { url: publicUrl.split('?')[0] });
        } catch (e: any) {
          log.error('headline firebase upload failed (returning local URL):', e.message);
        }
      }

      res.json({ url: publicUrl, autoTimeStatus });
    } catch (err: any) {
      log.error('add-headline failed:', err.message);
      res.status(500).json({ error: `Add headline failed: ${err.message}` });
    } finally {
      try {
        if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  })
);
