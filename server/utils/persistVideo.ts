// F6.14 — Robust video persistence with retry + local fallback.
//
// The problem: lots of endpoints (zapcap mirror, intercut, headline, etc)
// generate a video and try to upload it to Firebase Storage so the URL
// the SPA persists is permanent. When the upload fails for ANY reason
// (network blip, quota, Firebase Admin not initialised), the caller
// historically returned a temporary URL (ZapCap CDN signed URL with TTL,
// or a /generated/foo.mp4 local path that was never expected to survive
// long). Result: videos go grey in the gallery after hours.
//
// This helper centralises the "make the URL durable" logic:
//
//   1. Save a local copy to GENERATED_DIR (always works as long as the
//      server has disk space — the Express static handler serves it).
//   2. Try to upload to Firebase Storage with up to 3 retries +
//      exponential backoff (1s, 2s, 4s). Returns the signed URL on success.
//   3. If all Firebase attempts fail, return the local /generated/<file>
//      URL — still served by Express. Reliable as long as the disk file
//      exists. Less durable than Firebase but DEFINITELY better than a
//      ZapCap CDN URL that vanishes in 24h.
//
// All callers benefit: zapcap.routes (uploadZapCapToFirebase),
// video.routes (/intercut, /headline, /concat) — they no longer need
// to write their own try/catch + fallback logic.

import fs from 'fs';
import path from 'path';
import admin from 'firebase-admin';
import { GENERATED_DIR } from '../config/paths.js';
import { logToFile } from './fileLogger.js';
import { createLogger } from './logger.js';

const log = createLogger('PersistVideo');

interface PersistOptions {
  /** Bytes to persist. */
  buffer: Buffer;
  /** Filename used both for the local copy and the Firebase object name. */
  filename: string;
  /** Firebase Storage folder (e.g. "zapcap", "intercut", "headline"). */
  storageFolder: string;
  /** Storage owner — used as path segment for organisational sanity. */
  userId?: string;
  /** MIME do objeto (default video/mp4). Use audio/mpeg pra .mp3. */
  contentType?: string;
  /** Override retry count (default 3). */
  maxRetries?: number;
}

interface PersistResult {
  /** Public URL the SPA should save. Either a Firebase signed URL or
   *  `/generated/<filename>`. Always reachable from the browser. */
  url: string;
  /** True when the Firebase upload succeeded. */
  persisted: boolean;
  /** Bytes written. */
  size: number;
}

/** Sleep for `ms` milliseconds. */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Persist a video buffer with retry + local fallback. Guarantees a URL
 * that the SPA can render — never returns a temporary CDN URL.
 */
export async function persistVideo(opts: PersistOptions): Promise<PersistResult> {
  const { buffer, filename, storageFolder, userId, contentType = 'video/mp4', maxRetries = 3 } = opts;
  const size = buffer.length;

  // Step 1 — always save local first. Cheap insurance.
  const localPath = path.join(GENERATED_DIR, filename);
  try {
    if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });
    fs.writeFileSync(localPath, buffer);
    log.info(`[persistVideo] local saved: ${localPath} (${Math.round(size / 1024)} KB)`);
  } catch (err: any) {
    log.error(`[persistVideo] FAILED to save local copy: ${err.message}`);
    // If we can't even save locally, propagate — nothing to fall back to.
    throw new Error(`Could not save video locally: ${err.message}`);
  }

  const localUrl = `/generated/${filename}`;

  // Step 2 — try Firebase upload with retry. Skip entirely if Firebase
  // Admin isn't initialised (dev mode without service account).
  if (admin.apps.length === 0) {
    log.warn('[persistVideo] Firebase Admin not initialised — keeping local URL only');
    return { url: localUrl, persisted: false, size };
  }

  const bucket = admin.storage().bucket();
  const destination = `${storageFolder}/${userId || 'anonymous'}/${filename}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const file = bucket.file(destination);
      await file.save(buffer, { metadata: { contentType } });
      // Year 2491 = effectively forever. Signed URLs work regardless of
      // bucket access mode (Uniform vs ACL).
      const [signedUrl] = await file.getSignedUrl({ action: 'read', expires: '03-09-2491' });
      log.info(
        `[persistVideo] Firebase OK (attempt ${attempt}/${maxRetries}): ${signedUrl.split('?')[0]}`
      );
      logToFile(`[persistVideo] persisted ${filename} (${size}B) attempt=${attempt}`);
      return { url: signedUrl, persisted: true, size };
    } catch (err: any) {
      const isLast = attempt === maxRetries;
      log.error(
        `[persistVideo] Firebase upload attempt ${attempt}/${maxRetries} failed: ${err.message}`
      );
      if (isLast) {
        // All retries exhausted. Return local URL — file is on disk and
        // Express serves /generated/ statically.
        logToFile(
          `[persistVideo] Firebase fully failed after ${maxRetries} attempts, using local URL ${localUrl}`
        );
        return { url: localUrl, persisted: false, size };
      }
      // Exponential backoff: 1s, 2s, 4s
      const delay = 1000 * Math.pow(2, attempt - 1);
      log.info(`[persistVideo] retrying after ${delay}ms...`);
      await sleep(delay);
    }
  }

  // Unreachable — loop always returns. Belt and braces.
  return { url: localUrl, persisted: false, size };
}

/**
 * Convenience wrapper that downloads `sourceUrl` and persists the result.
 * Used for "mirror this external URL into something durable" cases —
 * notably ZapCap's CDN URLs that expire.
 */
export async function downloadAndPersist(
  sourceUrl: string,
  opts: Omit<PersistOptions, 'buffer'>
): Promise<PersistResult> {
  const dl = await fetch(sourceUrl);
  if (!dl.ok) throw new Error(`Download from ${sourceUrl.substring(0, 80)} failed: ${dl.status}`);
  const buffer = Buffer.from(await dl.arrayBuffer());
  return persistVideo({ ...opts, buffer });
}
