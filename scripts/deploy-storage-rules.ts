// Deploys storage.rules via firebase-admin (no CLI auth needed — uses the
// same credentials the server already uses for Firestore/Storage).
// Run with: `npx tsx scripts/deploy-storage-rules.ts`

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES_PATH = path.join(__dirname, '..', 'storage.rules');
const CONFIG_PATH = path.join(__dirname, '..', 'firebase-applet-config.json');

async function main() {
  if (!fs.existsSync(RULES_PATH)) {
    console.error('❌ storage.rules not found');
    process.exit(1);
  }
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('❌ firebase-applet-config.json not found');
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  const source = fs.readFileSync(RULES_PATH, 'utf-8');

  admin.initializeApp({
    projectId: config.projectId,
    storageBucket: config.storageBucket,
  });

  console.log(`📡 Bucket: ${config.storageBucket}`);
  console.log(`📄 Source: ${source.length} chars`);
  console.log(`🚀 Deploying storage.rules to ${config.projectId}...`);

  const rules = admin.securityRules();
  const ruleset = await rules.releaseStorageRulesetFromSource(source, config.storageBucket);

  console.log(`✅ Deployed. Ruleset name: ${ruleset.name}`);
  console.log(`   Created at: ${ruleset.createTime}`);
}

main().catch((err) => {
  console.error('❌ Deploy failed:', err.message);
  if (err.code) console.error('   code:', err.code);
  process.exit(1);
});
