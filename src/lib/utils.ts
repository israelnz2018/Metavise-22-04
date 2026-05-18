import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Tailwind-aware className combiner. Resolves conflicts like `p-2 p-4` → `p-4`.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Maps a video's aspectRatio metadata to the matching Tailwind aspect class.
// Defaults to vertical 9:16 (the most common ad format) when missing.
// Accepts `any` so the dozens of legacy call sites in App.tsx that pass
// untyped video records work unchanged.
export const getVideoAspectRatioClass = (video: any) => {
  const ratio = video?.aspectRatio || '9:16';
  if (ratio === '9:16') return 'aspect-[9/16]';
  if (ratio === '4:5') return 'aspect-[4/5]';
  if (ratio === '1:1') return 'aspect-square';
  return 'aspect-video';
};

// Formats seconds → "m:ss" (e.g. 73 → "1:13"). Used by VideoDurationBadge
// and any other place that needs a compact duration label.
export function formatVideoDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
