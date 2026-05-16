import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const CONFIG_PATH = path.join(process.cwd(), 'elevenlabs-config.json');
export const HEYGEN_CONFIG_PATH = path.join(process.cwd(), 'heygen-config.json');
export const RUNWAY_CONFIG_PATH = path.join(process.cwd(), 'runway-config.json');
export const GEMINI_CONFIG_PATH = path.join(process.cwd(), 'gemini-config.json');
export const FIREBASE_CONFIG_PATH = path.join(process.cwd(), 'firebase-applet-config.json');

// generated/ lives next to server.ts (one level above server/config/).
export const GENERATED_DIR = path.resolve(__dirname, '..', '..', 'generated');

export function ensureGeneratedDir(): void {
  if (!fs.existsSync(GENERATED_DIR)) {
    fs.mkdirSync(GENERATED_DIR);
  }
}
