// Tiny level-aware logger. Two output modes:
//
//   - dev (NODE_ENV !== 'production'): pretty colorised single-line
//     output, easy to scan in the terminal. "[Module] message extras"
//   - prod: structured JSON, one object per line, machine-parseable.
//     Compatible with Datadog/Logflare/CloudWatch/etc. out of the box.
//
// Toggle pretty mode explicitly via LOG_PRETTY=1 or LOG_PRETTY=0 if
// you need to override the NODE_ENV default (handy for debugging
// staging environments).
//
// Use createLogger('Module') to get a scoped logger; respect LOG_LEVEL
// env var (debug | info | warn | error).

type Level = 'debug' | 'info' | 'warn' | 'error';
const LEVELS: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const envLevel = process.env.LOG_LEVEL as Level | undefined;
const isProd = process.env.NODE_ENV === 'production';
const defaultLevel: Level = isProd ? 'info' : 'debug';
const threshold = LEVELS[envLevel ?? defaultLevel] ?? LEVELS.info;
const prettyOverride = process.env.LOG_PRETTY;
const pretty = prettyOverride === '1' ? true : prettyOverride === '0' ? false : !isProd;

// ANSI colors for the pretty path. No external dep — these are
// universally supported in modern terminals.
const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
} as const;

const LEVEL_COLOR: Record<Level, string> = {
  debug: COLORS.gray,
  info: COLORS.cyan,
  warn: COLORS.yellow,
  error: COLORS.red,
};

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

function format(scope: string, level: Level, args: unknown[]): string {
  if (pretty) {
    const tag = `${COLORS.dim}[${scope}]${COLORS.reset}`;
    const lvl = `${LEVEL_COLOR[level]}${level.padEnd(5)}${COLORS.reset}`;
    const msg = args.map((a) => (typeof a === 'string' ? a : safeStringify(a))).join(' ');
    return `${lvl} ${tag} ${msg}`;
  }

  // Structured JSON path: extract first string arg as `msg`, fold
  // remaining args under `data` (joined when they're not objects).
  let msg = '';
  const extras: unknown[] = [];
  for (const a of args) {
    if (msg === '' && typeof a === 'string') {
      msg = a;
    } else {
      extras.push(a);
    }
  }
  const data = extras.length === 0 ? undefined : extras.length === 1 ? extras[0] : extras;
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    scope,
    msg,
  };
  if (data !== undefined) record.data = data;
  return safeStringify(record);
}

function safeStringify(v: unknown): string {
  if (v instanceof Error) {
    return JSON.stringify({
      name: v.name,
      message: v.message,
      stack: v.stack,
    });
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function createLogger(scope: string): Logger {
  return {
    debug: (...args: unknown[]) => {
      if (threshold <= LEVELS.debug) console.log(format(scope, 'debug', args));
    },
    info: (...args: unknown[]) => {
      if (threshold <= LEVELS.info) console.log(format(scope, 'info', args));
    },
    warn: (...args: unknown[]) => {
      if (threshold <= LEVELS.warn) console.warn(format(scope, 'warn', args));
    },
    error: (...args: unknown[]) => {
      if (threshold <= LEVELS.error) console.error(format(scope, 'error', args));
    },
  };
}
