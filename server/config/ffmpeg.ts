import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';

// Points fluent-ffmpeg at the bundled static binary. fluent-ffmpeg keeps this
// in module state, so any later import of 'fluent-ffmpeg' inherits the path.
export function setupFfmpeg(): void {
  if (ffmpegPath) {
    ffmpeg.setFfmpegPath(ffmpegPath);
  }
}
