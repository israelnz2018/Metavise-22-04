/**
 * UX25-C3 — Inline Diff Viewer
 *
 * Componente reusable que mostra 2 textos lado-a-lado com diff por
 * palavra. Usado em:
 *   - VozPremium (original aprovada vs otimizada ElevenLabs)
 *   - Em qualquer lugar onde queremos comparar duas versions inline
 *     sem abrir modal.
 *
 * Não tem ações (não pega versão A nem B). Só leitura. Pra fluxos
 * com picker, usar VariantCompareModal.
 */

import { useMemo } from 'react';
import { wordDiff, type DiffToken } from '@/lib/wordDiff';

function renderTokens(tokens: DiffToken[], side: 'a' | 'b') {
  const highlightClass =
    side === 'a'
      ? 'bg-emerald-200 dark:bg-emerald-900/40 text-emerald-900 dark:text-emerald-200 rounded px-0.5'
      : 'bg-red-200 dark:bg-red-900/40 text-red-900 dark:text-red-200 rounded px-0.5';
  return tokens.map((t, idx) => {
    if (t.op === 'eq') return <span key={idx}>{t.text}</span>;
    const isHighlighted = (side === 'a' && t.op === 'del') || (side === 'b' && t.op === 'add');
    if (isHighlighted)
      return (
        <span key={idx} className={highlightClass}>
          {t.text}
        </span>
      );
    return <span key={idx}>{t.text}</span>;
  });
}

interface Props {
  /** Texto "original" (esquerda) — diferenças aparecem em verde. */
  textA: string;
  labelA?: string;
  /** Texto "novo / modificado" (direita) — diferenças aparecem em vermelho. */
  textB: string;
  labelB?: string;
  /** Estilo do contêiner. */
  className?: string;
}

export default function InlineDiffViewer({
  textA,
  textB,
  labelA = 'Original',
  labelB = 'Modificado',
  className = '',
}: Props) {
  const diff = useMemo(() => wordDiff(textA, textB), [textA, textB]);

  if (!textA && !textB) {
    return null;
  }

  return (
    <div className={`grid grid-cols-1 lg:grid-cols-2 gap-3 ${className}`}>
      <div className="bg-emerald-50/40 dark:bg-emerald-950/20 ring-1 ring-emerald-200 dark:ring-emerald-900/40 rounded-2xl p-4">
        <h4 className="text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300 mb-2">
          {labelA} · {diff.onlyLeft} palavras exclusivas
        </h4>
        <pre className="text-xs text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-wrap font-mono">
          {renderTokens(diff.left, 'a')}
        </pre>
      </div>
      <div className="bg-red-50/40 dark:bg-red-950/20 ring-1 ring-red-200 dark:ring-red-900/40 rounded-2xl p-4">
        <h4 className="text-[10px] font-black uppercase tracking-widest text-red-700 dark:text-red-300 mb-2">
          {labelB} · {diff.onlyRight} palavras exclusivas
        </h4>
        <pre className="text-xs text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-wrap font-mono">
          {renderTokens(diff.right, 'b')}
        </pre>
      </div>
    </div>
  );
}
