// Thin entry point — all setup and routing lives under server/.
// package.json's `dev` script (tsx server.ts) and any production runner
// (node dist/server.js if you ever transpile) keep pointing here.
import './server/index.js';
