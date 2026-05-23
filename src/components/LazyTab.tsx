import React from 'react';

/**
 * Thin wrapper around React.Suspense that bakes in the standard
 * "Carregando..." fallback used while a lazy-loaded tab module is
 * being fetched.
 *
 * Before: every step branch in App.tsx wrapped its tab in a verbose
 *   <React.Suspense fallback={<div className="text-center py-20 text-gray-400">Carregando...</div>}>
 *     <TabComponent ... />
 *   </React.Suspense>
 *
 * After:
 *   <LazyTab>
 *     <TabComponent ... />
 *   </LazyTab>
 *
 * Override the fallback per-call if a tab needs a custom loading UI:
 *   <LazyTab fallback={<MySpinner />}>...</LazyTab>
 */
export function LazyTab({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  return (
    <React.Suspense
      fallback={fallback ?? <div className="text-center py-20 text-gray-400">Carregando...</div>}
    >
      {children}
    </React.Suspense>
  );
}
