import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
// @ts-expect-error ffprobe-static ships no .d.ts; the runtime shape we use is { path: string }
import ffprobeStatic from 'ffprobe-static';

// Points fluent-ffmpeg at the bundled static binaries. fluent-ffmpeg keeps
// these in module state, so any later import of 'fluent-ffmpeg' inherits
// the paths. ffmpeg-static doesn't ship ffprobe — without setFfprobePath
// any ffprobe() call fails with "Cannot find ffprobe".
export function setupFfmpeg(): void {
  if (ffmpegPath) {
    ffmpeg.setFfmpegPath(ffmpegPath);
  }
  if (ffprobeStatic?.path) {
    ffmpeg.setFfprobePath(ffprobeStatic.path);
  }
}

// ---------------------------------------------------------------------------
// Shared encode profiles. Use these instead of inlining raw flags so a single
// edit propagates to every route.
//
// `-threads 0` tells x264 to auto-detect core count. Without it some
// environments default to 1 thread, leaving 80% of the CPU idle during long
// encodes. `-tune fastdecode` produces a stream that decoders start playing
// faster (relevant for previews in the browser).
//
// `pix_fmt yuv420p` is mandatory for QuickTime / Safari compatibility on the
// resulting MP4. Without it, the file plays in VLC but breaks in Safari.
// ---------------------------------------------------------------------------

/** Output flags for ad renders where size matters more than speed. Used by
 *  /compress where the goal is to bring a >500MB upload down for storage. */
export const ENCODE_BALANCED = [
  '-c:v libx264',
  '-crf 23',
  '-preset fast',
  '-threads 0',
  '-pix_fmt yuv420p',
  '-tune fastdecode',
  '-c:a aac',
  '-b:a 128k',
  '-movflags +faststart',
];

/** Output flags for interactive edits (intercut, headline, concat) where the
 *  user is waiting in the UI — favour speed; the file is short-lived. */
export const ENCODE_FAST = [
  '-c:v libx264',
  '-crf 23',
  '-preset superfast',
  '-threads 0',
  '-pix_fmt yuv420p',
  '-tune fastdecode',
  '-movflags +faststart',
];

/** Output flags for cuts/joins where we don't need to re-encode at all —
 *  -c copy is free relative to re-encoding. Use this whenever the inputs
 *  are already in the right codec/format. */
export const ENCODE_COPY = ['-c copy', '-movflags +faststart'];
