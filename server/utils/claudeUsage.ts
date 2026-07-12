import fs from 'fs';
import path from 'path';

// Medidor de gasto REAL da API da Claude. A Anthropic não expõe o saldo da
// conta para uma chave normal, então o app conta o próprio consumo: cada
// resposta traz `usage` (tokens de entrada/saída/cache), e aqui multiplicamos
// pelo preço do modelo e acumulamos num arquivo. Serve pro contador "gasto em
// tempo real" no header do Metavise.

const USAGE_PATH = path.join(process.cwd(), 'claude-usage.json');

// Preço por 1M de tokens (USD). cache_read ~10% do input; cache_write (5min)
// ~125% do input. Modelos fora da tabela caem no preço do Opus (conservador).
type Price = { in: number; out: number; cacheRead: number; cacheWrite: number };
const PRICING: Record<string, Price> = {
  'claude-opus-4-8': { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-7': { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-6': { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-4-6': { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-4-5': { in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};
function priceFor(model: string): Price {
  return PRICING[model] || PRICING['claude-opus-4-8']!;
}

export interface UsageState {
  since: string; // ISO — primeira chamada registrada
  updated: string; // ISO — última chamada
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUSD: number;
  today: { date: string; costUSD: number; calls: number };
  /** Saldo que o usuário informou (US$) na última vez que definiu — a Anthropic
   *  não expõe o saldo por chave, então medimos disponível = balanceBase menos
   *  o gasto desde que ele foi definido. null = ainda não informado. */
  balanceBase: number | null;
  /** costUSD acumulado no momento em que o balanceBase foi definido. */
  balanceBaseSpent: number;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyState(): UsageState {
  const now = new Date().toISOString();
  return {
    since: now,
    updated: now,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUSD: 0,
    today: { date: todayStr(), costUSD: 0, calls: 0 },
    balanceBase: null,
    balanceBaseSpent: 0,
  };
}

function load(): UsageState {
  try {
    if (fs.existsSync(USAGE_PATH)) {
      const s = JSON.parse(fs.readFileSync(USAGE_PATH, 'utf-8')) as UsageState;
      // Zera o acumulado do dia se virou o dia.
      if (!s.today || s.today.date !== todayStr()) {
        s.today = { date: todayStr(), costUSD: 0, calls: 0 };
      }
      // Defaults pra arquivos antigos (antes do saldo).
      if (s.balanceBase === undefined) s.balanceBase = null;
      if (s.balanceBaseSpent === undefined) s.balanceBaseSpent = 0;
      return s;
    }
  } catch {
    /* arquivo corrompido → começa do zero */
  }
  return emptyState();
}

function save(s: UsageState): void {
  try {
    fs.writeFileSync(USAGE_PATH, JSON.stringify(s, null, 2));
  } catch {
    /* disco cheio/permissão — ignora, medidor não pode derrubar a request */
  }
}

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/** Registra o consumo de UMA chamada à Claude e atualiza o total gasto. */
export function recordUsage(model: string, usage: RawUsage | null | undefined): void {
  if (!usage) return;
  const p = priceFor(model);
  const inTok = usage.input_tokens || 0;
  const outTok = usage.output_tokens || 0;
  const crTok = usage.cache_read_input_tokens || 0;
  const cwTok = usage.cache_creation_input_tokens || 0;
  const cost =
    (inTok * p.in + outTok * p.out + crTok * p.cacheRead + cwTok * p.cacheWrite) / 1_000_000;

  const s = load();
  if (s.today.date !== todayStr()) s.today = { date: todayStr(), costUSD: 0, calls: 0 };
  s.calls += 1;
  s.inputTokens += inTok;
  s.outputTokens += outTok;
  s.cacheReadTokens += crTok;
  s.cacheWriteTokens += cwTok;
  s.costUSD += cost;
  s.today.calls += 1;
  s.today.costUSD += cost;
  s.updated = new Date().toISOString();
  save(s);
}

/** Extrai os tokens de um stream SSE já bufferizado (endpoint /complete-stream). */
export function parseUsageFromSSE(sse: string): RawUsage {
  const num = (re: RegExp): number => {
    let last = 0;
    let m: RegExpExecArray | null;
    const g = new RegExp(re.source, 'g');
    while ((m = g.exec(sse)) !== null) last = Number(m[1]) || 0;
    return last;
  };
  return {
    // input/cache aparecem no message_start (uma vez) → primeiro match basta,
    // mas usar o último é seguro pois só há um.
    input_tokens: num(/"input_tokens":\s*(\d+)/),
    cache_read_input_tokens: num(/"cache_read_input_tokens":\s*(\d+)/),
    cache_creation_input_tokens: num(/"cache_creation_input_tokens":\s*(\d+)/),
    // output_tokens é cumulativo; o ÚLTIMO message_delta traz o total final.
    output_tokens: num(/"output_tokens":\s*(\d+)/),
  };
}

/** Disponível estimado = saldo informado − gasto desde que ele foi definido. */
function availableUSD(s: UsageState): number | null {
  if (s.balanceBase === null || s.balanceBase === undefined) return null;
  return s.balanceBase - (s.costUSD - (s.balanceBaseSpent || 0));
}

export function getUsage(): UsageState & { availableUSD: number | null } {
  const s = load();
  return { ...s, availableUSD: availableUSD(s) };
}

/** Define o saldo atual da conta (US$) — ancora no gasto acumulado de agora. */
export function setBalance(amount: number): UsageState & { availableUSD: number | null } {
  const s = load();
  s.balanceBase = Number.isFinite(amount) ? amount : null;
  s.balanceBaseSpent = s.costUSD;
  save(s);
  return { ...s, availableUSD: availableUSD(s) };
}

export function resetUsage(): UsageState {
  const s = emptyState();
  save(s);
  return s;
}
