import dotenv from 'dotenv';
import { ensureGeneratedDir } from './config/paths.js';
import { initFirebase } from './config/firebase.js';
import { setupFfmpeg } from './config/ffmpeg.js';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT) || 3000;

dotenv.config();
setupFfmpeg();
ensureGeneratedDir();
initFirebase();

const app = await createApp();
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
