import fs from 'fs';
import { createLogger } from './logger.js';
const log = createLogger('Download');

// Downloads a URL to disk with 3 retries and 2s backoff.
// Auto-appends GEMINI_API_KEY for Google Generative Language URLs.
export async function downloadFile(url: string, dest: string): Promise<void> {
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
