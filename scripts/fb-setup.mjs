// Setup do banco novo via REST (Firestore Admin API + Firebase Rules API),
// autenticado com service-account.json. Faz:
//   1. Lê a região do banco antigo
//   2. Cria o banco novo (Native mode, mesma região)
//   3. Publica firestore.rules nesse banco novo
//
// Uso: node scripts/fb-setup.mjs <NEW_DB_ID>

import { readFileSync } from 'node:fs';
import { GoogleAuth } from 'google-auth-library';

const NEW_DB_ID = process.argv[2];
if (!NEW_DB_ID) {
  console.error('Uso: node scripts/fb-setup.mjs <NEW_DB_ID>');
  process.exit(1);
}

const sa = JSON.parse(readFileSync(new URL('../service-account.json', import.meta.url)));
const PROJECT = sa.project_id;
const appletConfig = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url)));
const OLD_DB_ID = appletConfig.firestoreDatabaseId;

const auth = new GoogleAuth({
  credentials: sa,
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});
const client = await auth.getClient();

async function api(url, method = 'GET', body) {
  const res = await client.request({ url, method, data: body });
  return res.data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) região do banco antigo
console.log(`Lendo região do banco antigo (${OLD_DB_ID})...`);
const oldDb = await api(
  `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${encodeURIComponent(OLD_DB_ID)}`
);
const locationId = oldDb.locationId;
console.log(`  região: ${locationId}`);

// 2) garante o banco novo — se já existe (criado no console), só segue;
//    senão tenta criar (precisa de datastore.databases.create).
console.log(`Verificando banco "${NEW_DB_ID}"...`);
let exists = false;
try {
  await api(
    `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${encodeURIComponent(NEW_DB_ID)}`
  );
  exists = true;
  console.log('  banco já existe — seguindo.');
} catch {
  exists = false;
}

if (!exists) {
  console.log(`Criando banco novo "${NEW_DB_ID}" em ${locationId}...`);
  try {
    const op = await api(
      `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases?databaseId=${encodeURIComponent(NEW_DB_ID)}`,
      'POST',
      { locationId, type: 'FIRESTORE_NATIVE' }
    );
    let opName = op.name;
    for (let i = 0; i < 60; i++) {
      const st = await api(`https://firestore.googleapis.com/v1/${opName}`);
      if (st.done) {
        if (st.error) throw new Error(JSON.stringify(st.error));
        console.log('  banco criado.');
        break;
      }
      await sleep(2000);
    }
  } catch (e) {
    const msg = e?.response?.data ? JSON.stringify(e.response.data) : e.message;
    console.error('  ERRO ao criar banco:', msg);
    console.error('  -> Crie o banco no console e rode de novo.');
    process.exit(1);
  }
}

// 3) publica as regras
console.log('Publicando firestore.rules no banco novo...');
const rulesSource = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const ruleset = await api(
  `https://firebaserules.googleapis.com/v1/projects/${PROJECT}/rulesets`,
  'POST',
  { source: { files: [{ name: 'firestore.rules', content: rulesSource }] } }
);
console.log(`  ruleset criado: ${ruleset.name}`);

const releaseName = `projects/${PROJECT}/releases/cloud.firestore/${NEW_DB_ID}`;
try {
  await api(
    `https://firebaserules.googleapis.com/v1/projects/${PROJECT}/releases`,
    'POST',
    { name: releaseName, rulesetName: ruleset.name }
  );
  console.log('  release criado (regras ativas).');
} catch (e) {
  const msg = e?.response?.data ? JSON.stringify(e.response.data) : e.message;
  if (msg.includes('ALREADY_EXISTS') || msg.includes('already exists')) {
    await api(
      `https://firebaserules.googleapis.com/v1/${releaseName}?updateMask=rulesetName`,
      'PATCH',
      { release: { name: releaseName, rulesetName: ruleset.name } }
    );
    console.log('  release atualizado (regras ativas).');
  } else {
    console.error('  ERRO ao publicar regras:', msg);
    process.exit(1);
  }
}

console.log('\nSetup concluído. Banco novo pronto e com regras.');
process.exit(0);
