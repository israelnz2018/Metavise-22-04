import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
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
