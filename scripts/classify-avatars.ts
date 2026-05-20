// One-shot script: classify all HeyGen avatars using Claude vision.
// Run with: `npx tsx scripts/classify-avatars.ts`
//
// Reads avatars from local HeyGen proxy (server must be running at :3000).
// Writes incrementally to src/lib/avatar-enrichment-bulk.json so the script
// is resumable — if interrupted, re-run and it skips avatars already classified.
//
// Cost: ~$3-4 in Claude vision tokens for ~1300 avatars (batch size 10).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getClaudeKey } from '../server/config/apiKeys.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT = path.join(__dirname, '..', 'src', 'lib', 'avatar-enrichment-bulk.json');
const BATCH_SIZE = 10;
const HEYGEN_URL = 'http://localhost:3000/api/heygen/avatars';
const MODEL = 'claude-haiku-4-5-20251001'; // cheap vision model
const MAX_RETRIES = 6;
// Haiku 4.5 input rate limit on this org is 50k tokens/min. Each batch
// uses ~6k input tokens (10 images × ~500 tok). Wait 8s between batches
// = ~7.5 batches/min × 6k = 45k tok/min, comfortably under the cap.
const BATCH_THROTTLE_MS = 8000;

interface HeyGenAvatar {
  avatar_id: string;
  avatar_name: string;
  gender?: string;
  preview_image_url: string;
}

interface Enrichment {
  age: 'young' | 'adult' | 'mature' | 'elderly';
  ethnicity: 'white' | 'asian' | 'south_asian' | 'latino' | 'middle_eastern' | 'black' | 'mixed';
  style: 'professional' | 'lifestyle' | 'ugc' | 'creative';
  vibe: 'energetic' | 'calm' | 'authoritative' | 'friendly' | 'serious';
}

const SYSTEM = `You classify HeyGen avatar previews for an ad-creation tool.

For each avatar (name + image), respond with one JSON object:
{
  "age": "young" | "adult" | "mature" | "elderly",
  "ethnicity": "white" | "asian" | "south_asian" | "latino" | "middle_eastern" | "black" | "mixed",
  "style": "professional" | "lifestyle" | "ugc" | "creative",
  "vibe": "energetic" | "calm" | "authoritative" | "friendly" | "serious"
}

style guidelines:
- professional: business attire, suit, office, formal, clinical
- lifestyle: casual clothes, home, outdoor, sport, gym, restaurant
- ugc: selfie angle, vlog setup, content-creator vibe, phone-style framing
- creative: costume, stylized lighting, unusual setting, artistic

ethnicity is your best visual estimate; pick "mixed" only when truly ambiguous.

Return ONLY a JSON array, one object per avatar in the SAME ORDER as I provide. No prose, no markdown fences.`;

async function fetchAvatars(): Promise<HeyGenAvatar[]> {
  const r = await fetch(HEYGEN_URL);
  if (!r.ok) throw new Error(`HeyGen fetch failed: ${r.status}`);
  const data: any = await r.json();
  return data?.data?.avatars || [];
}

function loadExisting(): Record<string, Enrichment> {
  if (!fs.existsSync(OUTPUT)) return {};
  try {
    return JSON.parse(fs.readFileSync(OUTPUT, 'utf-8'));
  } catch {
    return {};
  }
}

function save(record: Record<string, Enrichment>) {
  fs.writeFileSync(OUTPUT, JSON.stringify(record, null, 2));
}

async function classifyBatch(
  batch: HeyGenAvatar[],
  apiKey: string,
  attempt = 1,
): Promise<Enrichment[]> {
  const content: any[] = [
    { type: 'text', text: `Classify these ${batch.length} avatars in order:\n\n` },
  ];

  batch.forEach((a, i) => {
    content.push({ type: 'text', text: `${i + 1}. ${a.avatar_name} (id: ${a.avatar_id})` });
    content.push({ type: 'image', source: { type: 'url', url: a.preview_image_url } });
  });

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    const retryable = resp.status === 529 || resp.status === 429 || resp.status >= 500;
    if (retryable && attempt < MAX_RETRIES) {
      // Linger longer on 429 (rate limit) since the bucket is per-minute.
      const delay = resp.status === 429 ? 15000 + 5000 * attempt : 2000 * attempt;
      console.warn(`  ⚠ ${resp.status}, retrying in ${delay}ms (${attempt}/${MAX_RETRIES})...`);
      await new Promise((r) => setTimeout(r, delay));
      return classifyBatch(batch, apiKey, attempt + 1);
    }
    throw new Error(`Claude ${resp.status}: ${errText.substring(0, 300)}`);
  }

  const data: any = await resp.json();
  const text = data?.content?.[0]?.text || '';
  // Strip any markdown fences just in case.
  const clean = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  const arr = JSON.parse(clean);
  if (!Array.isArray(arr)) throw new Error('Response is not an array');
  if (arr.length !== batch.length) {
    throw new Error(`Got ${arr.length} classifications, expected ${batch.length}`);
  }
  return arr;
}

async function main() {
  const apiKey = getClaudeKey();
  if (!apiKey) {
    console.error('❌ No Claude API key found. Set it in claude-config.json or CLAUDE_API_KEY env.');
    process.exit(1);
  }

  console.log('📡 Fetching avatars from HeyGen...');
  const avatars = await fetchAvatars();
  console.log(`   Got ${avatars.length} avatars.`);

  const existing = loadExisting();
  const remaining = avatars.filter((a) => !existing[a.avatar_id] && a.preview_image_url);
  console.log(`   ${Object.keys(existing).length} already classified, ${remaining.length} to do.`);

  if (remaining.length === 0) {
    console.log('✅ All avatars already classified. Nothing to do.');
    return;
  }

  let processed = 0;
  let failedBatches = 0;
  const startTime = Date.now();

  for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
    const batch = remaining.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(remaining.length / BATCH_SIZE);
    process.stdout.write(`  [${batchNum}/${totalBatches}] ${batch.length} avatars... `);

    try {
      const results = await classifyBatch(batch, apiKey);
      batch.forEach((a, idx) => {
        existing[a.avatar_id] = results[idx]!;
      });
      save(existing);
      processed += batch.length;
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processed / elapsed;
      const eta = Math.round((remaining.length - processed) / rate);
      console.log(`✓ (${processed}/${remaining.length}, ETA ${eta}s)`);
    } catch (err: any) {
      failedBatches++;
      console.log(`✗ ${err.message}`);
    }

    if (i + BATCH_SIZE < remaining.length) {
      await new Promise((r) => setTimeout(r, BATCH_THROTTLE_MS));
    }
  }

  console.log(`\n✅ Done. Classified ${processed}/${remaining.length}. Failed batches: ${failedBatches}.`);
  console.log(`   Output: ${OUTPUT}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
