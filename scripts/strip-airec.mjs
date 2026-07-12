// Remove o cache regenerável config.copy.aiRecommendation de um doc de projeto
// (top-level config + cada variant). Faz BACKUP local antes de gravar.
import { readFileSync, writeFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_DOC = process.argv[2];
const appletConfig = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url)));
const serviceAccount = JSON.parse(readFileSync(new URL('../service-account.json', import.meta.url)));
const DB_ID = appletConfig.firestoreDatabaseId;

const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app, DB_ID);
const bytes = (o) => Buffer.byteLength(JSON.stringify(o ?? null), 'utf8');

const ref = db.collection('projects').doc(PROJECT_DOC);
const snap = await ref.get();
if (!snap.exists) { console.log('Doc não existe.'); process.exit(1); }
const data = snap.data();

// 1) Backup
const backupPath = new URL(`../backup-${PROJECT_DOC}.json`, import.meta.url);
writeFileSync(backupPath, JSON.stringify(data, null, 2));
console.log(`Backup salvo: backup-${PROJECT_DOC}.json (${bytes(data).toLocaleString()} bytes)`);

// 2) Strip aiRecommendation
let removed = 0;
const stripCopy = (cfg) => {
  if (cfg?.copy && 'aiRecommendation' in cfg.copy) {
    delete cfg.copy.aiRecommendation;
    removed++;
  }
};
stripCopy(data.config);
if (Array.isArray(data.variants)) {
  for (const v of data.variants) stripCopy(v.config);
}

const newSize = bytes(data);
console.log(`Removido aiRecommendation de ${removed} locais.`);
console.log(`Novo tamanho (aprox): ${newSize.toLocaleString()} bytes`);

// 3) Grava de volta (substitui o doc pela versão enxuta)
await ref.set(data);
console.log('✅ Gravado. Documento atualizado.');
process.exit(0);
