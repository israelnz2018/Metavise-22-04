// READ-ONLY: mostra a estrutura top-level dos variants do projeto Arialief.
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

console.log('Total variants:', sub.size, '\n');
console.log('--- docId | name | top-level keys | createdAt ---');
for (const d of sub.docs) {
  const v = d.data();
  console.log(`docId=${d.id}`);
  console.log(`  name: ${JSON.stringify(v.name)}`);
  console.log(`  topKeys: ${Object.keys(v).join(', ')}`);
  console.log(`  v.id field: ${JSON.stringify(v.id)}`);
  console.log(`  createdAt: ${JSON.stringify(v.createdAt)} (type ${typeof v.createdAt})`);
  if (v.config) console.log(`  config keys: ${Object.keys(v.config).join(', ')}`);
}

// estrutura detalhada do Criativo 1
const c1doc = sub.docs.find((d) => /criativo\s*1\b/i.test(d.data().name || ''));
if (c1doc) {
  const v = c1doc.data();
  console.log('\n=== Criativo 1 detalhe ===');
  console.log('config.copy keys:', v.config?.copy ? Object.keys(v.config.copy).join(', ') : '(sem copy)');
}
process.exit(0);
