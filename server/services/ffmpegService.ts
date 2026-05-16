// Returns an ffmpeg -vf filter string that scales+crops a source to the target
// aspect ratio. cropOffset shifts the crop window from -50 (left/top) to +50
// (right/bottom). Defaults to centred (0).
export function getFFmpegFilter(targetRatio: string, cropOffset = 0): string {
  let w = 1080;
  let h = 1920;
  if (targetRatio === '16:9') {
    w = 1920;
    h = 1080;
  } else if (targetRatio === '1:1') {
    w = 1080;
    h = 1080;
  } else if (targetRatio === '4:5') {
    w = 1080;
    h = 1350;
  }

  const xExpr = `((in_w-out_w)/2)+((in_w-out_w)*(${cropOffset}/100))`;
  const yExpr = `((in_h-out_h)/2)+((in_h-out_h)*(${cropOffset}/100))`;

  return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}:${xExpr}:${yExpr},setsar=1`;
}
