// Migra os subprojetos do array `variants[]` (dentro do doc do projeto) para a
// subcoleção `projects/{id}/variants/{variantId}`. Cada subprojeto vira seu
// próprio documento, com seu próprio teto de 1 MiB.
//
// Uso:
//   node scripts/migrate-variants-subcol.mjs [--dry]
//
// - Faz BACKUP de cada doc de projeto que tiver variants antes de mexer.
// - Idempotente: rodar de novo só re-grava os mesmos docs (mesmo id) e remove
//   o array (já removido continua removido).
import { readFileSync, writeFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const DRY = process.argv.includes('--dry');
const appletConfig = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url)));
const serviceAccount = JSON.parse(readFileSync(new URL('../service-account.json', import.meta.url)));
const DB_ID = appletConfig.firestoreDatabaseId;

const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app, DB_ID);
const bytes = (o) => Buffer.byteLength(JSON.stringify(o ?? null), 'utf8');

console.log(`\nBanco: ${DB_ID}  ${DRY ? '*** DRY-RUN (não escreve) ***' : '*** MIGRANDO ***'}\n`);

const projectsSnap = await db.collection('projects').get();
let migrated = 0;
let totalVariants = 0;

for (const projDoc of projectsSnap.docs) {
  const data = projDoc.data();
  const variants = Array.isArray(data.variants) ? data.variants : [];
  if (variants.length === 0) continue;

  console.log(`Projeto ${projDoc.id} ("${data.name || '?'}"): ${variants.length} subprojetos, doc ${bytes(data).toLocaleString()} B`);

  if (!DRY) {
    // Backup do doc inteiro antes de tocar.
    writeFileSync(
      new URL(`../backup-migrate-${projDoc.id}.json`, import.meta.url),
      JSON.stringify(data, null, 2)
    );

    // 1) grava cada variant como doc da subcoleção
    const subcol = projDoc.ref.collection('variants');
    let batch = db.batch();
    let ops = 0;
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      const vid = v.id || `variant_migrated_${i}`;
      batch.set(subcol.doc(vid), { ...v, id: vid });
      totalVariants++;
      if (++ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; }
    }
    if (ops > 0) await batch.commit();

    // 2) remove o array do doc pai (já está na subcoleção agora)
    await projDoc.ref.update({ variants: FieldValue.delete() });
  } else {
    totalVariants += variants.length;
  }
  migrated++;
}

console.log(`\n${DRY ? '[dry] ' : ''}Projetos migrados: ${migrated} | subprojetos: ${totalVariants}`);
process.exit(0);
