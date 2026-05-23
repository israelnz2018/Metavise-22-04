import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';

/**
 * Web Vitals reporter.
 *
 * Subscribes to the five Core Web Vitals (CLS / FCP / INP / LCP / TTFB)
 * and forwards each measurement to the backend telemetry endpoint via
 * `navigator.sendBeacon` (survives page unloads, doesn't block
 * navigation) with a `fetch` fallback for older browsers.
 *
 * Set up once from `main.tsx` — runs in the background, no UI side
 * effects. In dev, also logs to the console so you can sanity-check
 * regressions while iterating.
 */

const ENDPOINT = '/api/telemetry/web-vitals';

function send(metric: Metric) {
  const payload = JSON.stringify({
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    delta: metric.delta,
    id: metric.id,
    navigationType: metric.navigationType,
    // Page context so we can group by route once the SPA grows beyond
    // the wizard tabs.
    path: window.location.pathname + window.location.search,
    ts: Date.now(),
  });

  // sendBeacon is fire-and-forget and explicitly designed for
  // unload-safe telemetry — exactly the shape we want here.
  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const blob = new Blob([payload], { type: 'application/json' });
    if (navigator.sendBeacon(ENDPOINT, blob)) return;
  }

  // Fallback for environments without sendBeacon (rare in practice).
  fetch(ENDPOINT, {
    method: 'POST',
    body: payload,
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
  }).catch(() => {
    // Swallow — telemetry must never break the page.
  });

  // Mirror to console in dev. Vite's `import.meta.env.DEV` flag isn't
  // typed without `vite/client` references — we just sniff for the
  // standard NODE_ENV mirror that Vite/Node both expose at build
  // time.
  const meta = import.meta as unknown as { env?: { DEV?: boolean } };
  if (meta?.env?.DEV) {
    console.log(`[WebVitals] ${metric.name} = ${metric.value.toFixed(2)} (${metric.rating})`);
  }
}

export function initWebVitals() {
  onCLS(send);
  onFCP(send);
  onINP(send);
  onLCP(send);
  onTTFB(send);
}
