import dotenv from 'dotenv';
import { ensureGeneratedDir } from './config/paths.js';
import { initFirebase } from './config/firebase.js';
import { setupFfmpeg } from './config/ffmpeg.js';
import { createApp } from './app.js';
import { flushJobStore } from './services/jobStore.js';

const PORT = Number(process.env.PORT) || 3000;

dotenv.config();
setupFfmpeg();
ensureGeneratedDir();
initFirebase();

const app = await createApp();
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Graceful shutdown — flush the persistent job store synchronously so
// in-flight upserts buffered inside the 500ms debounce window don't get
// lost when a deploy / Ctrl+C happens. SIGTERM is what Docker / k8s
// send; SIGINT is Ctrl+C in the terminal.
const shutdown = (signal: string) => {
  console.log(`Received ${signal}, flushing job store + closing server…`);
  flushJobStore();
  server.close(() => process.exit(0));
  // Hard kill if .close() doesn't return within 10s (stuck connections).
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
