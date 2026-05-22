// Lazy loader for the 175KB bulk-classified avatar enrichment dataset.
// Imported dynamically so Vite/Rollup put it in its own chunk that's only
// downloaded when the user actually opens the Avatar tab — keeps the
// initial app payload lean.
//
// Used by AvatarTab via a useEffect that calls loadAvatarEnrichment() on
// mount and stores the result in component state. Until the promise
// resolves, components see an empty map and fall through to legacy
// keyword-on-name filtering.

import { MANUAL_AVATAR_ENRICHMENT } from './constants';

export type EnrichmentMap = Record<string, any>;

let cached: EnrichmentMap | null = null;
let inflight: Promise<EnrichmentMap> | null = null;

export function loadAvatarEnrichment(): Promise<EnrichmentMap> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = import('./avatar-enrichment-bulk.json').then((mod) => {
    const bulk = (mod.default ?? mod) as EnrichmentMap;
    const merged: EnrichmentMap = { ...bulk };
    for (const [id, m] of Object.entries(MANUAL_AVATAR_ENRICHMENT)) {
      merged[id] = { ...(merged[id] || {}), ...m };
    }
    cached = merged;
    inflight = null;
    return merged;
  });
  return inflight;
}
