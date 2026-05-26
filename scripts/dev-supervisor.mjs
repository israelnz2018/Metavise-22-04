#!/usr/bin/env node
// F8.1 — Dev supervisor pro backend.
//
// Roda `tsx server.ts` em loop: se morrer, reinicia em 2s. Limita a 5
// reinícios em janela de 60s pra evitar loop infinito quando o erro for
// sistêmico (porta ocupada, código quebrado, etc.).
//
// Motivação: o backend morre silenciosamente de vez em quando (causa #4
// — SIGKILL externo do macOS, terminal pai fechando, App Nap, etc.).
// Com supervisor, o cliente não vê "ERR_CONNECTION_REFUSED" — só uma
// pausa curta de 2s.
//
// Uso: `npm run dev` (já wirado no package.json) ou direto
//      `node scripts/dev-supervisor.mjs`.
//
// Pra rodar SEM supervisor (útil pra debug de crash, pra ver stack
// trace antes da reinicialização): `npm run dev:bare`.

import { spawn } from 'child_process';

const MAX_RESTARTS_IN_WINDOW = 5;
const WINDOW_MS = 60_000;
const RESTART_DELAY_MS = 2_000;
const SERVER_ENTRY = 'server.ts';

let shuttingDown = false;
let restartTimestamps = [];
let child = null;

function timestamp() {
  return new Date().toISOString().slice(11, 19); // HH:MM:SS
}

function log(msg, color = '\x1b[36m') {
  console.log(`${color}[supervisor ${timestamp()}]\x1b[0m ${msg}`);
}

function err(msg) {
  console.error(`\x1b[31m[supervisor ${timestamp()}]\x1b[0m ${msg}`);
}

function start() {
  if (shuttingDown) return;

  const now = Date.now();
  restartTimestamps = restartTimestamps.filter((t) => now - t < WINDOW_MS);
  restartTimestamps.push(now);

  if (restartTimestamps.length > MAX_RESTARTS_IN_WINDOW) {
    err(
      `💀 servidor morreu ${MAX_RESTARTS_IN_WINDOW}+ vezes em 60s — desistindo.\n` +
        '   Provavelmente bug de código ou config quebrada. Investigue\n' +
        '   manualmente com: npm run dev:bare'
    );
    process.exit(1);
  }

  const startNum = restartTimestamps.length;
  if (startNum === 1) {
    log(`📡 iniciando ${SERVER_ENTRY}...`, '\x1b[32m');
  } else {
    log(
      `🔁 reiniciando ${SERVER_ENTRY} (tentativa ${startNum}/${MAX_RESTARTS_IN_WINDOW} na janela)`,
      '\x1b[33m'
    );
  }

  child = spawn('npx', ['tsx', SERVER_ENTRY], {
    stdio: 'inherit',
    env: { ...process.env, SUPERVISED: '1' },
  });

  child.on('exit', (code, signal) => {
    child = null;
    if (shuttingDown) {
      log('🛑 encerrado.', '\x1b[90m');
      process.exit(code ?? 0);
    }
    const reason = signal ? `sinal ${signal}` : `código ${code}`;
    err(`💀 servidor morreu (${reason}). Reiniciando em ${RESTART_DELAY_MS / 1000}s...`);
    setTimeout(start, RESTART_DELAY_MS);
  });

  child.on('error', (e) => {
    err(`❌ erro ao spawnar: ${e.message}`);
  });
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`🛑 recebeu ${signal}, encerrando filho...`, '\x1b[90m');
  if (child) {
    // Passa o sinal pro filho. Se ele não morrer em 5s, força SIGKILL.
    child.kill(signal);
    setTimeout(() => {
      if (child) {
        err('filho não respondeu em 5s, mandando SIGKILL.');
        child.kill('SIGKILL');
      }
    }, 5_000);
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();
