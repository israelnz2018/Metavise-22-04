import fs from 'fs';
import path from 'path';
import admin from 'firebase-admin';
import { FIREBASE_CONFIG_PATH } from './paths.js';

// Initialises the Firebase Admin SDK if firebase-applet-config.json exists.
// A no-op when the file is absent, so the server still boots without Firebase
// (handlers that need it will fail at call time with admin.* throwing).
export function initFirebase(): void {
  if (!fs.existsSync(FIREBASE_CONFIG_PATH)) return;

  const firebaseConfig = JSON.parse(fs.readFileSync(FIREBASE_CONFIG_PATH, 'utf-8')) as {
    projectId: string;
    storageBucket: string;
  };

  // Em dev local, usa o service-account.json (mesmo do projeto) pra autenticar
  // o Admin SDK — sem ele, uploads server-side pro Storage (persistVideo)
  // falham com "Could not load the default credentials", e os vídeos gerados
  // ficam só locais (somem ao recarregar). Em produção (Cloud Run, sem o
  // arquivo) cai no Application Default Credentials do ambiente.
  const saPath = path.join(process.cwd(), 'service-account.json');
  let credential: admin.credential.Credential | undefined;
  if (fs.existsSync(saPath)) {
    try {
      const sa = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
      credential = admin.credential.cert(sa);
    } catch (err) {
      console.warn('[Firebase Admin] service-account.json inválido, caindo no ADC:', err);
    }
  }

  admin.initializeApp({
    projectId: firebaseConfig.projectId,
    storageBucket: firebaseConfig.storageBucket,
    ...(credential ? { credential } : {}),
  });

  console.log(
    `[Firebase Admin] Initialized with bucket: ${firebaseConfig.storageBucket}` +
      (credential ? ' (service-account)' : ' (ADC)')
  );
}
