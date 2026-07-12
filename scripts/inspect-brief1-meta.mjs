// READ-ONLY: imprime status, brief e alguns campos de controle do Criativo 1.
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const appletConfig = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url)));
const serviceAccount = JSON.parse(readFileSync(new URL('../service-account.json', import.meta.url)));
const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app, appletConfig.firestoreDatabaseId);

const PROJECT_ID = 'BNOpVXZ3kD5DLsKYEyBl';
const d = await db.collection('projects').doc(PROJECT_ID).collection('variants').doc('brief_1').get();
const v = d.data();
console.log('status:', JSON.stringify(v.status));
console.log('\nbrief:', JSON.stringify(v.brief, null, 2));
const c = v.config.copy;
console.log('\n-- control fields in config.copy --');
for (const k of ['activeBriefId','hookSelecionado','hookVideoUrl','hookAudioUrl','hookAudioStoragePath','hookVideoStoragePath','personaAutoFilled','mode','subMode','discoveryMode','targetWordCount']) {
  console.log(`${k}:`, JSON.stringify(c[k]));
}
console.log('\npersonasWithWeights:', JSON.stringify(c.personasWithWeights));
console.log('\nactiveBriefId in creativeBriefs? ids:', (c.creativeBriefs||[]).map(b=>b.id));
console.log('\nconfig.angle:', JSON.stringify(v.config.angle));
console.log('config.format:', JSON.stringify(v.config.format));
console.log('config.generationStage:', JSON.stringify(v.config.generationStage));
process.exit(0);
