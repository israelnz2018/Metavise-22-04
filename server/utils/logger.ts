// Tiny level-aware console wrapper. Use createLogger('Module') to get a
// scoped logger that prefixes every line with [Module] and respects the
// LOG_LEVEL env var (debug | info | warn | error). Defaults to 'debug' in
// development and 'info' in production.
//
// This intentionally stays a thin shim around console so we can swap in
// Pino or another structured logger later without touching call sites.

type Level = 'debug' | 'info' | 'warn' | 'error';
const LEVELS: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const envLevel = process.env.LOG_LEVEL as Level | undefined;
const defaultLevel: Level = process.env.NODE_ENV === 'production' ? 'info' : 'debug';
const threshold = LEVELS[envLevel ?? defaultLevel] ?? LEVELS.info;

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export function createLogger(scope: string): Logger {
  const tag = `[${scope}]`;
  return {
    debug: (...args: unknown[]) => {
      if (threshold <= LEVELS.debug) console.log(tag, ...args);
    },
    info: (...args: unknown[]) => {
      if (threshold <= LEVELS.info) console.log(tag, ...args);
    },
    warn: (...args: unknown[]) => {
      if (threshold <= LEVELS.warn) console.warn(tag, ...args);
    },
    error: (...args: unknown[]) => {
      if (threshold <= LEVELS.error) console.error(tag, ...args);
    },
  };
}
