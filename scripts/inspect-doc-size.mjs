// READ-ONLY: mede o tamanho de um documento de projeto e quebra por variant.
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_DOC = process.argv[2];
const appletConfig = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url)));
const serviceAccount = JSON.parse(readFileSync(new URL('../service-account.json', import.meta.url)));
const DB_ID = appletConfig.firestoreDatabaseId;

const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app, DB_ID);

const bytes = (o) => Buffer.byteLength(JSON.stringify(o ?? null), 'utf8');

const snap = await db.collection('projects').doc(PROJECT_DOC).get();
if (!snap.exists) { console.log('Doc não existe:', PROJECT_DOC); process.exit(0); }
const data = snap.data();

console.log(`\nDoc: ${PROJECT_DOC}  (banco ${DB_ID})`);
console.log(`Tamanho total (JSON aprox): ${bytes(data).toLocaleString()} bytes\n`);

// Top-level fields por tamanho
const fields = Object.entries(data)
  .map(([k, v]) => [k, bytes(v)])
  .sort((a, b) => b[1] - a[1]);
console.log('--- Campos top-level (maiores primeiro) ---');
for (const [k, sz] of fields) console.log(`${String(sz).padStart(9)} B  ${k}`);

// Quebra por variant
const variants = Array.isArray(data.variants) ? data.variants : [];
console.log(`\n--- Variants: ${variants.length} ---`);
const rows = variants
  .map((v, i) => ({
    i,
    id: v.id,
    name: v.name,
    createdAt: v.createdAt,
    size: bytes(v),
  }))
  .sort((a, b) => b.size - a.size);
for (const r of rows) {
  console.log(`${String(r.size).padStart(9)} B  [${r.i}] ${r.name || r.id}  (${r.createdAt || 's/data'})`);
}

// Dentro de cada variant, onde está o peso? (pega o maior)
if (rows.length) {
  const biggest = variants[rows[0].i];
  console.log(`\n--- Dentro do maior variant ("${biggest.name || biggest.id}") ---`);
  const walk = (obj, prefix = '') => {
    const out = [];
    for (const [k, v] of Object.entries(obj || {})) {
      out.push([prefix + k, bytes(v)]);
    }
    return out.sort((a, b) => b[1] - a[1]);
  };
  for (const [k, sz] of walk(biggest).slice(0, 8)) {
    console.log(`${String(sz).padStart(9)} B  ${k}`);
  }
  if (biggest.config) {
    console.log('  └─ config.* :');
    for (const [k, sz] of walk(biggest.config).slice(0, 10)) {
      console.log(`${String(sz).padStart(9)} B    config.${k}`);
    }
    if (biggest.config.copy) {
      console.log('     └─ config.copy.* :');
      for (const [k, sz] of walk(biggest.config.copy).slice(0, 12)) {
        console.log(`${String(sz).padStart(9)} B      config.copy.${k}`);
      }
    }
  }
}
process.exit(0);
