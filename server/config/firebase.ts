import fs from 'fs';
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

  admin.initializeApp({
    projectId: firebaseConfig.projectId,
    storageBucket: firebaseConfig.storageBucket,
  });

  console.log('[Firebase Admin] Initialized with bucket:', firebaseConfig.storageBucket);
}
