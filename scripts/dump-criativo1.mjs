// READ-ONLY: imprime os campos de script do Criativo 1 do projeto Arialief.
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const appletConfig = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url)));
const serviceAccount = JSON.parse(readFileSync(new URL('../service-account.json', import.meta.url)));
const DB_ID = appletConfig.firestoreDatabaseId;

const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app, DB_ID);

const PROJECT_ID = 'BNOpVXZ3kD5DLsKYEyBl';
const sub = await db.collection('projects').doc(PROJECT_ID).collection('variants').get();

// acha o Criativo 1
const c1 = sub.docs.map((d) => d.data()).find((v) => /criativo\s*1\b/i.test(v.name || ''));
if (!c1) {
  console.log('Criativo 1 não encontrado. Variants:', sub.docs.map((d) => d.data().name).join(', '));
  process.exit(0);
}

console.log('=== Criativo 1 ===  (name:', c1.name, ')\n');
const cfg = c1.config || {};
const fields = ['copy', 'generatedScript', 'finalScript', 'optimizedScript', 'hookOptimizedScript'];
for (const f of fields) {
  const val = cfg[f] ?? c1[f];
  if (val == null) continue;
  console.log(`\n========== ${f} ==========\n`);
  console.log(typeof val === 'string' ? val : JSON.stringify(val, null, 2));
}
process.exit(0);
