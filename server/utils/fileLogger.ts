import fs from 'fs';

const LOG_FILE = 'debug_logs.txt';

// Truncate the log on first import (i.e. server boot). Mirrors the original
// behaviour where server.ts wrote "=== Server Start ===" at module top.
fs.writeFileSync(LOG_FILE, '=== Server Start ===\n');

export function logToFile(msg: string): void {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(LOG_FILE, `[${timestamp}] ${msg}\n`);
}
