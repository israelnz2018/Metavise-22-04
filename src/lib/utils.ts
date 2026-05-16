import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Tailwind-aware className combiner. Resolves conflicts like `p-2 p-4` → `p-4`.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Maps a video's aspectRatio metadata to the matching Tailwind aspect class.
// Defaults to vertical 9:16 (the most common ad format) when missing.
export const getVideoAspectRatioClass = (video: { aspectRatio?: string }) => {
  const ratio = video.aspectRatio || '9:16';
  if (ratio === '9:16') return 'aspect-[9/16]';
  if (ratio === '4:5') return 'aspect-[4/5]';
  if (ratio === '1:1') return 'aspect-square';
  return 'aspect-video';
};
