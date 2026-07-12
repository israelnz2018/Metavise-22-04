// Migração de banco Firestore: copia TUDO do banco antigo (capado pelo AI Studio)
// para um banco novo no mesmo projeto. Recursivo — leva coleções de topo e todas
// as subcoleções (users/{uid}/copyLibrary, users/{uid}/billing/account/transactions).
//
// Uso:
//   node scripts/migrate-firestore.mjs <NEW_DB_ID> [--dry]
//
// Pré-requisitos:
//   - service-account.json na raiz do projeto (chave baixada do Firebase Console)
//   - O banco antigo só está bloqueado para ESCRITA; leitura funciona normalmente.
//   - O Admin SDK ignora regras de segurança, então não precisa de auth de usuário.

import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const NEW_DB_ID = process.argv[2];
const DRY = process.argv.includes('--dry');

if (!NEW_DB_ID) {
  console.error('Faltou o ID do banco novo.\n  node scripts/migrate-firestore.mjs <NEW_DB_ID> [--dry]');
  process.exit(1);
}

const appletConfig = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url)));
const OLD_DB_ID = appletConfig.firestoreDatabaseId;
const serviceAccount = JSON.parse(readFileSync(new URL('../service-account.json', import.meta.url)));

console.log(`\nProjeto:    ${appletConfig.projectId}`);
console.log(`Banco ORIGEM (antigo): ${OLD_DB_ID}`);
console.log(`Banco DESTINO (novo):  ${NEW_DB_ID}`);
console.log(DRY ? '\n*** MODO DRY-RUN: só conta, não escreve ***\n' : '\n*** MIGRANDO DE VERDADE ***\n');

const app = initializeApp({ credential: cert(serviceAccount) });
const srcDb = getFirestore(app, OLD_DB_ID);
const destDb = getFirestore(app, NEW_DB_ID);

const counts = {};

async function copyCollection(srcColRef, destColRef, label) {
  const snap = await srcColRef.get();
  if (snap.empty) return;

  // 1) copia os docs desta coleção em lotes de 400
  let batch = destDb.batch();
  let ops = 0;
  for (const doc of snap.docs) {
    counts[label] = (counts[label] || 0) + 1;
    if (!DRY) {
      batch.set(destColRef.doc(doc.id), doc.data());
      if (++ops >= 400) {
        await batch.commit();
        batch = destDb.batch();
        ops = 0;
      }
    }
  }
  if (!DRY && ops > 0) await batch.commit();

  // 2) recursão nas subcoleções de cada doc
  for (const doc of snap.docs) {
    const subcols = await doc.ref.listCollections();
    for (const sub of subcols) {
      await copyCollection(
        sub,
        destColRef.doc(doc.id).collection(sub.id),
        `${label}/${sub.id}`
      );
    }
  }
}

const topCols = await srcDb.listCollections();
if (topCols.length === 0) {
  console.log('Nenhuma coleção de topo encontrada no banco antigo. Nada a migrar.');
  process.exit(0);
}

for (const col of topCols) {
  console.log(`Copiando coleção: ${col.id} ...`);
  await copyCollection(col, destDb.collection(col.id), col.id);
}

console.log('\n=== Resultado (documentos por coleção) ===');
for (const [k, v] of Object.entries(counts).sort()) console.log(`  ${k}: ${v}`);
console.log(`\nTotal de documentos: ${Object.values(counts).reduce((a, b) => a + b, 0)}`);
console.log(DRY ? '\nDry-run concluído. Rode sem --dry para migrar.' : '\nMigração concluída.');
process.exit(0);
