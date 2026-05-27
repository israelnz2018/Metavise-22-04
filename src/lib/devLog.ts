/**
 * UX25-D1 — Dev-only logging helpers.
 *
 * Wraps console.log/info pra ser no-op em produção. Mantém warn/error
 * sempre. Vite expõe `import.meta.env.DEV` (true em `vite dev`, false em
 * `vite build`).
 *
 * Uso:
 *   import { devLog } from '@/lib/devLog';
 *   devLog('[area] mensagem', extraData);
 *
 * Pra logs estruturados com tag fixa, use devLogger:
 *   const log = devLogger('[Foo]');
 *   log('something happened', payload);
 */

const isDev = typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV !== false;

export function devLog(...args: unknown[]): void {
  if (isDev) console.log(...args);
}

export function devInfo(...args: unknown[]): void {
  if (isDev) console.info(...args);
}

export function devLogger(tag: string): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    if (isDev) console.log(tag, ...args);
  };
}
