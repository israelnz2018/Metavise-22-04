import { useState } from 'react';
import { formatVideoDuration } from '@/lib/utils';

// Loads only the metadata of `src` in a hidden <video> and renders an
// absolute-positioned badge with the duration. Drops into any positioned
// container — particularly the version cards in Edição Zap where two
// videos of the same avatar are otherwise indistinguishable.
export function VideoDurationBadge({ src }: { src: string }) {
  const [duration, setDuration] = useState<number | null>(null);
  if (!src) return null;
  return (
    <>
      <video
        src={src}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        muted
        playsInline
      />
      {duration !== null && (
        <div className="absolute bottom-3 right-3 bg-black/75 text-white text-[10px] font-black px-2 py-1 rounded pointer-events-none">
          {formatVideoDuration(duration)}
        </div>
      )}
    </>
  );
}
