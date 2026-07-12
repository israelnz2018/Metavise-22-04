// READ-ONLY: localiza projeto por nome e imprime a copy das variants.
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const NAME_QUERY = (process.argv[2] || '').toLowerCase();
const appletConfig = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url)));
const serviceAccount = JSON.parse(readFileSync(new URL('../service-account.json', import.meta.url)));
const DB_ID = appletConfig.firestoreDatabaseId;

const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app, DB_ID);

const snap = await db.collection('projects').get();
const matches = snap.docs.filter((d) => {
  const data = d.data();
  return (data.name || '').toLowerCase().includes(NAME_QUERY);
});

if (!matches.length) {
  console.log('Nenhum projeto com nome contendo:', NAME_QUERY);
  console.log('Projetos existentes:');
  for (const d of snap.docs) console.log(' -', d.id, '|', d.data().name);
  process.exit(0);
}

for (const doc of matches) {
  const data = doc.data();
  console.log('=== Projeto:', data.name, '| id:', doc.id, '===');

  // variants no doc principal
  const inline = Array.isArray(data.variants) ? data.variants : [];
  // variants em subcoleção
  const sub = await db.collection('projects').doc(doc.id).collection('variants').get();
  const variants = [...inline, ...sub.docs.map((d) => d.data())];

  console.log('Variants encontradas:', variants.map((v) => v.name || v.id).join(', ') || '(nenhuma)');
  for (const v of variants) {
    console.log('\n--- Variant:', v.name || v.id, '---');
    console.log(JSON.stringify(v.config?.copy ?? v.copy ?? '(sem copy)', null, 2));
  }
}
process.exit(0);
