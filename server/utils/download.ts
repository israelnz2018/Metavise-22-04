import fs from 'fs';
import path from 'path';
import { GENERATED_DIR } from '../config/paths.js';
import { createLogger } from './logger.js';
const log = createLogger('Download');

// Downloads a URL to disk with 3 retries and 2s backoff.
// Auto-appends GEMINI_API_KEY for Google Generative Language URLs.
//
// F6.12 — Also supports local paths (e.g. "/generated/foo.mp4" or absolute
// fs paths). Useful when intercut/headline videos come back as local URLs
// because Firebase upload failed; downstream endpoints can just copy them
// instead of trying to HTTP-fetch a non-URL.
export async function downloadFile(url: string, dest: string): Promise<void> {
  // Local-path shortcut: skip fetch, do a filesystem copy. Detects both
  // "/generated/foo.mp4" (served URL) and absolute fs paths.
  if (!/^https?:\/\//i.test(url)) {
    let localPath = url;
    if (url.startsWith('/generated/')) {
      localPath = path.join(GENERATED_DIR, url.replace('/generated/', ''));
    } else if (!path.isAbsolute(url)) {
      localPath = path.join(GENERATED_DIR, url);
    }
    if (!fs.existsSync(localPath)) {
      throw new Error(`Local file not found: ${localPath} (resolved from ${url})`);
    }
    log.info(`[downloadFile] local copy ${localPath} → ${dest}`);
    fs.copyFileSync(localPath, dest);
    return;
  }

  let finalUrl = url;
  if (url.includes('generativelanguage.googleapis.com')) {
    finalUrl = finalUrl.replace(':download', '');
    const key = process.env.GEMINI_API_KEY;
    if (key && !finalUrl.includes('key=')) {
      finalUrl += (finalUrl.includes('?') ? '&' : '?') + `key=${key}`;
    }
  }

  let response: Response | undefined;
  for (let i = 0; i < 3; i++) {
    response = await fetch(finalUrl);
    if (response.ok) break;
    log.warn(`[downloadFile] Attempt ${i + 1} failed: ${response.statusText}. Retrying...`);
    if (i < 2) await new Promise((r) => setTimeout(r, 2000));
  }

  if (!response || !response.ok) {
    throw new Error(`Failed to download file from ${finalUrl}: ${response?.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(dest, Buffer.from(arrayBuffer));
}
