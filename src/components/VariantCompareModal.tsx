/**
 * UX25-B3 — Variant Compare Modal
 *
 * Mostra 2 versions A/B (geradas em paralelo via variants) lado-a-lado
 * com diff por palavra. Permite decidir qual ficar em segundos.
 *
 * Diff word-level via LCS (longest common subsequence). Suficiente
 * pra texto curto-médio (≤500 palavras) — O(n*m) é OK nesse range.
 *
 * Cores:
 *   verde (bg-emerald) — palavra existe SÓ na A
 *   vermelho (bg-red) — palavra existe SÓ na B
 *   cinza neutro — palavras iguais
 */

import { useMemo } from 'react';
import { X, Copy as CopyIcon } from 'lucide-react';
import { toast } from 'react-hot-toast';
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
  open: boolean;
  onClose: () => void;
  scriptA: string;
  scriptB: string;
  onPickA: () => void;
  onPickB: () => void;
}

export default function VariantCompareModal({
  open,
  onClose,
  scriptA,
  scriptB,
  onPickA,
  onPickB,
}: Props) {
  const diff = useMemo(() => wordDiff(scriptA, scriptB), [scriptA, scriptB]);

  if (!open) return null;

  const diffStats = { onlyA: diff.onlyLeft, onlyB: diff.onlyRight };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copiado!');
    } catch {
      toast.error('Não foi possível copiar.');
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-950 rounded-3xl w-full max-w-6xl max-h-[92vh] overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800 shrink-0">
          <div>
            <h2 className="text-base font-black text-gray-900 dark:text-gray-50">
              Comparar A vs B
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Verde = só na A · Vermelho = só na B · {diffStats.onlyA + diffStats.onlyB} palavras
              diferentes
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center text-gray-500 hover:text-gray-900 dark:hover:text-gray-50"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Versão A */}
          <div className="bg-emerald-50/40 dark:bg-emerald-950/20 ring-1 ring-emerald-200 dark:ring-emerald-900/40 rounded-2xl p-4 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
                Versão A · {diffStats.onlyA} palavras exclusivas
              </h3>
              <button
                onClick={() => copy(scriptA)}
                className="p-1 rounded hover:bg-emerald-100 dark:hover:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300"
                title="Copiar"
              >
                <CopyIcon size={12} />
              </button>
            </div>
            <pre className="flex-1 text-xs text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-wrap font-mono">
              {renderTokens(diff.left, 'a')}
            </pre>
            <button
              onClick={() => {
                onPickA();
                onClose();
              }}
              className="mt-3 w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black uppercase tracking-widest"
            >
              Usar Versão A
            </button>
          </div>

          {/* Versão B */}
          <div className="bg-red-50/40 dark:bg-red-950/20 ring-1 ring-red-200 dark:ring-red-900/40 rounded-2xl p-4 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-red-700 dark:text-red-300">
                Versão B · {diffStats.onlyB} palavras exclusivas
              </h3>
              <button
                onClick={() => copy(scriptB)}
                className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/40 text-red-700 dark:text-red-300"
                title="Copiar"
              >
                <CopyIcon size={12} />
              </button>
            </div>
            <pre className="flex-1 text-xs text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-wrap font-mono">
              {renderTokens(diff.right, 'b')}
            </pre>
            <button
              onClick={() => {
                onPickB();
                onClose();
              }}
              className="mt-3 w-full py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-black uppercase tracking-widest"
            >
              Usar Versão B
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
