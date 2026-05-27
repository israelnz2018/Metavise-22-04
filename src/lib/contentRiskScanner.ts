/**
 * UX13 — Content Risk Scanner: varre texto em busca de termos da lista
 * curada em src/data/contentRiskTerms.ts e retorna os hits agrupados.
 *
 * Filosofia: detecção é "best effort" — busca padrões mais óbvios sem
 * tentar entender contexto (isso seria uma chamada de LLM, mais custo).
 * Cliente sempre tem opção de "manter assim, assumo o risco".
 */

import {
  RISK_TERMS,
  type RiskTerm,
  type RiskCategory,
  type RiskSeverity,
} from '@/data/contentRiskTerms';

export interface RiskHit {
  term: RiskTerm;
  /** Trecho exato que casou no texto (preserva caps originais) */
  matched: string;
  /** Posição no texto original */
  start: number;
  end: number;
}

export interface RiskScanResult {
  hits: RiskHit[];
  /** Total agrupado por categoria — útil pra UI */
  byCategory: Map<RiskCategory, RiskHit[]>;
  /** Maior severidade encontrada — null se nenhum hit */
  maxSeverity: RiskSeverity | null;
  /** True se há QUALQUER hit */
  hasRisk: boolean;
  /** Fingerprint do texto (pra cache de "acknowledgment") */
  textHash: string;
}

const SEVERITY_RANK: Record<RiskSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

/** Hash simples e estável pra usar como key de acknowledgment.
 *  Não precisa ser crypto-safe — só precisa mudar quando o texto muda. */
function hashText(text: string): string {
  let h = 0;
  const s = text.trim().toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0; // força int32
  }
  return `h${h.toString(36)}_${s.length}`;
}

/** Escapa caracteres de regex em uma string (pra usar string como pattern) */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Varre o texto e retorna todos os hits ordenados por posição. Aplica
 * dedup de overlapping matches — quando dois termos casam no mesmo
 * trecho, mantém o de maior severidade (e em empate, o que casou primeiro).
 */
export function scanForRisks(text: string): RiskScanResult {
  if (!text || !text.trim()) {
    return {
      hits: [],
      byCategory: new Map(),
      maxSeverity: null,
      hasRisk: false,
      textHash: hashText(''),
    };
  }

  const rawHits: RiskHit[] = [];

  for (const term of RISK_TERMS) {
    const pattern = term.isRegex
      ? new RegExp(term.pattern, 'gi')
      : new RegExp(`\\b${escapeRegex(term.pattern)}\\b`, 'gi');

    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      rawHits.push({
        term,
        matched: m[0],
        start: m.index,
        end: m.index + m[0].length,
      });
      // Avoid infinite loop em regex que casam string vazia
      if (m.index === pattern.lastIndex) pattern.lastIndex++;
    }
  }

  // Dedup overlapping: agrupa hits que se sobrepõem no texto, mantém o
  // de maior severidade. Ex: "ao contrário do Ozempic" pode casar tanto
  // "Ozempic" (medication critical) quanto "ao contrário do..." (compar.
  // high) — ficamos com Ozempic.
  rawHits.sort((a, b) => a.start - b.start || b.end - a.end);
  const deduped: RiskHit[] = [];
  for (const h of rawHits) {
    const overlap = deduped.find(
      (d) => (h.start >= d.start && h.start < d.end) || (h.end > d.start && h.end <= d.end)
    );
    if (!overlap) {
      deduped.push(h);
      continue;
    }
    // Se o novo hit é mais severo, troca
    if (SEVERITY_RANK[h.term.severity] > SEVERITY_RANK[overlap.term.severity]) {
      const idx = deduped.indexOf(overlap);
      deduped[idx] = h;
    }
  }

  // Group by category
  const byCategory = new Map<RiskCategory, RiskHit[]>();
  for (const h of deduped) {
    const arr = byCategory.get(h.term.category) || [];
    arr.push(h);
    byCategory.set(h.term.category, arr);
  }

  // Max severity
  let maxSeverity: RiskSeverity | null = null;
  for (const h of deduped) {
    if (!maxSeverity || SEVERITY_RANK[h.term.severity] > SEVERITY_RANK[maxSeverity]) {
      maxSeverity = h.term.severity;
    }
  }

  return {
    hits: deduped,
    byCategory,
    maxSeverity,
    hasRisk: deduped.length > 0,
    textHash: hashText(text),
  };
}

/** Útil pra mostrar texto com termos destacados (ex: span vermelho).
 *  Retorna array de "tokens" alternando trechos normais e hits. */
export interface TextToken {
  type: 'text' | 'hit';
  value: string;
  hit?: RiskHit;
}

export function tokenizeWithHits(text: string, hits: RiskHit[]): TextToken[] {
  if (hits.length === 0) return [{ type: 'text', value: text }];
  const tokens: TextToken[] = [];
  let cursor = 0;
  for (const h of [...hits].sort((a, b) => a.start - b.start)) {
    if (h.start > cursor) {
      tokens.push({ type: 'text', value: text.slice(cursor, h.start) });
    }
    tokens.push({ type: 'hit', value: text.slice(h.start, h.end), hit: h });
    cursor = h.end;
  }
  if (cursor < text.length) {
    tokens.push({ type: 'text', value: text.slice(cursor) });
  }
  return tokens;
}
