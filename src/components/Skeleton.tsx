/**
 * Loading skeleton primitives — animated placeholders shown while data
 * loads. Replaces "Carregando..." text affordances.
 *
 * Pure CSS shimmer via @keyframes in index.css — no animation libs.
 */
import { cn } from '@/lib/utils';

interface BaseProps {
  className?: string;
}

export function Skeleton({ className }: BaseProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'relative overflow-hidden rounded-md bg-gray-200/60 dark:bg-gray-800/70',
        'before:absolute before:inset-0 before:-translate-x-full before:animate-shimmer',
        'before:bg-gradient-to-r before:from-transparent before:via-white/40 dark:before:via-white/5 before:to-transparent',
        className
      )}
    />
  );
}

Skeleton.Line = function SkeletonLine({ className }: BaseProps) {
  return <Skeleton className={cn('h-3.5 rounded-full', className)} />;
};

Skeleton.Block = function SkeletonBlock({ className }: BaseProps) {
  return <Skeleton className={cn('rounded-2xl', className)} />;
};

Skeleton.Circle = function SkeletonCircle({ className }: BaseProps) {
  return <Skeleton className={cn('rounded-full', className)} />;
};

Skeleton.ProjectCard = function SkeletonProjectCard() {
  return (
    <div className="p-5 rounded-2xl ring-1 ring-gray-200/60 dark:ring-gray-800/60 bg-white dark:bg-gray-900/80 space-y-4">
      <div className="flex items-start justify-between">
        <Skeleton className="w-11 h-11 rounded-xl" />
      </div>
      <div className="space-y-2">
        <Skeleton.Line className="w-2/3" />
        <Skeleton.Line className="w-1/3 h-2" />
      </div>
      <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-gray-800">
        <Skeleton.Line className="w-16 h-2" />
        <Skeleton.Line className="w-20 h-2" />
      </div>
    </div>
  );
};

Skeleton.ProjectGrid = function SkeletonProjectGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton.ProjectCard key={i} />
      ))}
    </div>
  );
};

Skeleton.GalleryTile = function SkeletonGalleryTile() {
  return (
    <div className="p-4 rounded-xl ring-1 ring-gray-200/60 dark:ring-gray-800/60 bg-white dark:bg-gray-900/80 space-y-3">
      <Skeleton className="aspect-square w-full rounded-xl" />
      <Skeleton.Line className="w-2/3" />
      <div className="flex gap-1.5">
        <Skeleton.Line className="w-10 h-2 rounded-full" />
        <Skeleton.Line className="w-12 h-2 rounded-full" />
      </div>
    </div>
  );
};

Skeleton.GalleryGrid = function SkeletonGalleryGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton.GalleryTile key={i} />
      ))}
    </div>
  );
};
