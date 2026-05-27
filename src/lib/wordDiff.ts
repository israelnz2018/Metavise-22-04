/**
 * UX25 — Word-level diff helper (LCS-based).
 *
 * Compara 2 strings token-a-token (palavras + whitespace) e retorna 2
 * listas marcando o que existe só na esquerda, só na direita, ou em
 * ambas. Usado tanto por VariantCompareModal (A vs B) quanto pela
 * Voz/Otimizador (original vs ElevenLabs-optimized).
 *
 * Algoritmo: DP de Longest Common Subsequence, O(n*m). Cap em 200k
 * células pra evitar travamento em casos patológicos — acima disso,
 * retorna sem highlight.
 */

export type DiffOp = 'eq' | 'add' | 'del';
export interface DiffToken {
  text: string;
  op: DiffOp;
}
export interface DiffResult {
  left: DiffToken[];
  right: DiffToken[];
  /** Estatísticas — quantas palavras (ignorando whitespace) só na A / só na B */
  onlyLeft: number;
  onlyRight: number;
}

export function wordDiff(a: string, b: string): DiffResult {
  const tokA = a.split(/(\s+)/).filter((t) => t.length > 0);
  const tokB = b.split(/(\s+)/).filter((t) => t.length > 0);
  const n = tokA.length;
  const m = tokB.length;

  // Cap pra textos enormes — diff fica caro e raramente útil.
  if (n * m > 200_000) {
    return {
      left: tokA.map((t) => ({ text: t, op: 'eq' as DiffOp })),
      right: tokB.map((t) => ({ text: t, op: 'eq' as DiffOp })),
      onlyLeft: 0,
      onlyRight: 0,
    };
  }

  // DP LCS
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (tokA[i - 1] === tokB[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  const ops: Array<{ op: DiffOp; a?: string; b?: string }> = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (tokA[i - 1] === tokB[j - 1]) {
      ops.unshift({ op: 'eq', a: tokA[i - 1], b: tokB[j - 1] });
      i--;
      j--;
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
      ops.unshift({ op: 'del', a: tokA[i - 1] });
      i--;
    } else {
      ops.unshift({ op: 'add', b: tokB[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    ops.unshift({ op: 'del', a: tokA[i - 1] });
    i--;
  }
  while (j > 0) {
    ops.unshift({ op: 'add', b: tokB[j - 1] });
    j--;
  }

  const left: DiffToken[] = [];
  const right: DiffToken[] = [];
  let onlyLeft = 0;
  let onlyRight = 0;
  const isWord = (s: string) => /\S/.test(s);
  for (const o of ops) {
    if (o.op === 'eq') {
      left.push({ text: o.a!, op: 'eq' });
      right.push({ text: o.b!, op: 'eq' });
    } else if (o.op === 'del') {
      left.push({ text: o.a!, op: 'del' });
      if (isWord(o.a!)) onlyLeft++;
    } else {
      right.push({ text: o.b!, op: 'add' });
      if (isWord(o.b!)) onlyRight++;
    }
  }
  return { left, right, onlyLeft, onlyRight };
}
