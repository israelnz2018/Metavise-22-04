/**
 * UX13 — Content Risk Banner.
 *
 * Mostrado quando o scanner detecta termos arriscados na copy/hook. Exibe
 * os hits agrupados por categoria com severidade colorida e 3 ações:
 *   1. Reescrever versão segura (chama Claude)
 *   2. Manter assim, assumo o risco (registra acknowledgment)
 *   3. Editar manualmente (foca no textarea — fica a cargo do parent)
 *
 * Não toma decisão pelo user — só informa e devolve a escolha pro parent.
 */

import { useState } from 'react';
import { AlertTriangle, ShieldCheck, Edit3, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import {
  CATEGORY_LABELS,
  SEVERITY_META,
  type RiskCategory,
  type RiskSeverity,
} from '@/data/contentRiskTerms';
import type { RiskHit } from '@/lib/contentRiskScanner';

interface Props {
  hits: RiskHit[];
  maxSeverity: RiskSeverity;
  /** Loading state quando "Reescrever" foi clicado (Claude rodando) */
  isRewriting?: boolean;
  /** Callback chamado quando user clica "Reescrever versão segura" */
  onRewrite: () => void;
  /** Callback chamado quando user clica "Manter assim" — parent persiste
   *  o hash da versão atual pra não mostrar banner de novo. */
  onAcknowledge: () => void;
  /** Opcional: callback pra focar/abrir edição manual */
  onEditManually?: () => void;
}

const SEVERITY_BORDER: Record<RiskSeverity, string> = {
  critical: 'border-red-300 dark:border-red-800/60 bg-red-50/80 dark:bg-red-950/30',
  high: 'border-orange-300 dark:border-orange-800/60 bg-orange-50/80 dark:bg-orange-950/30',
  medium: 'border-amber-300 dark:border-amber-800/60 bg-amber-50/80 dark:bg-amber-950/20',
  low: 'border-gray-300 dark:border-gray-700/60 bg-gray-50/80 dark:bg-gray-900/30',
};

const SEVERITY_ICON_BG: Record<RiskSeverity, string> = {
  critical: 'bg-red-600 text-white',
  high: 'bg-orange-500 text-white',
  medium: 'bg-amber-500 text-white',
  low: 'bg-gray-500 text-white',
};

const SEVERITY_CHIP: Record<RiskSeverity, string> = {
  critical:
    'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 ring-red-200/60 dark:ring-red-800/60',
  high: 'bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 ring-orange-200/60 dark:ring-orange-800/60',
  medium:
    'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-amber-200/60 dark:ring-amber-800/60',
  low: 'bg-gray-100 dark:bg-gray-900/40 text-gray-700 dark:text-gray-300 ring-gray-200/60 dark:ring-gray-700/60',
};

const SEVERITY_RANK: Record<RiskSeverity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export function ContentRiskBanner({
  hits,
  maxSeverity,
  isRewriting = false,
  onRewrite,
  onAcknowledge,
  onEditManually,
}: Props) {
  const [expanded, setExpanded] = useState(true);

  // Agrupa hits por categoria, ordenado por severidade desc
  const byCategory = new Map<RiskCategory, RiskHit[]>();
  for (const h of hits) {
    const arr = byCategory.get(h.term.category) || [];
    arr.push(h);
    byCategory.set(h.term.category, arr);
  }
  const categories = Array.from(byCategory.entries()).sort((a, b) => {
    const aMax = Math.max(...a[1].map((h) => SEVERITY_RANK[h.term.severity]));
    const bMax = Math.max(...b[1].map((h) => SEVERITY_RANK[h.term.severity]));
    return bMax - aMax;
  });

  const severityLabel = SEVERITY_META[maxSeverity].label;
  const totalHits = hits.length;

  return (
    <div
      className={`rounded-2xl border-2 ${SEVERITY_BORDER[maxSeverity]} shadow-sm overflow-hidden`}
    >
      {/* Header — sempre visível, clicável pra expandir/recolher */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
      >
        <div
          className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${SEVERITY_ICON_BG[maxSeverity]} shadow-md`}
        >
          <AlertTriangle size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-black text-gray-900 dark:text-gray-50">
              Risco detectado — {severityLabel}
            </p>
            <span
              className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ring-1 ${SEVERITY_CHIP[maxSeverity]}`}
            >
              {totalHits} {totalHits === 1 ? 'termo' : 'termos'}
            </span>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
            {maxSeverity === 'critical'
              ? 'Pode causar BAN imediato da conta de anúncios e ação legal.'
              : maxSeverity === 'high'
                ? 'Alta chance de reprovação no Meta Ads + risco legal.'
                : 'Pode reduzir o alcance do anúncio (shadow ban).'}
          </p>
        </div>
        {expanded ? (
          <ChevronUp size={18} className="text-gray-400 dark:text-gray-500 flex-shrink-0" />
        ) : (
          <ChevronDown size={18} className="text-gray-400 dark:text-gray-500 flex-shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-current/10">
          {/* Listagem por categoria */}
          <div className="space-y-3 pt-4">
            {categories.map(([cat, catHits]) => (
              <div key={cat} className="space-y-1.5">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
                  {CATEGORY_LABELS[cat]} ({catHits.length})
                </p>
                <ul className="space-y-1">
                  {catHits.map((h, idx) => (
                    <li
                      key={`${h.term.pattern}-${idx}-${h.start}`}
                      className="flex items-start gap-2 text-xs"
                    >
                      <span
                        className={`flex-shrink-0 text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ring-1 ${SEVERITY_CHIP[h.term.severity]}`}
                      >
                        {SEVERITY_META[h.term.severity].label}
                      </span>
                      <span className="flex-1 text-gray-700 dark:text-gray-300">
                        <span className="font-bold">"{h.matched}"</span>
                        <span className="text-gray-500 dark:text-gray-400"> — {h.term.reason}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Ações — 3 botões lado a lado */}
          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              onClick={onRewrite}
              disabled={isRewriting}
              className="flex items-center gap-2 px-4 py-2.5 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-black dark:hover:bg-white transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow"
            >
              {isRewriting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <ShieldCheck size={14} />
              )}
              {isRewriting ? 'Reescrevendo…' : 'Reescrever versão segura'}
            </button>
            <button
              type="button"
              onClick={onAcknowledge}
              disabled={isRewriting}
              className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-900/80 text-gray-700 dark:text-gray-200 rounded-xl text-xs font-black uppercase tracking-widest ring-1 ring-gray-300 dark:ring-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-all disabled:opacity-50"
              title="Registra que você foi avisado e quer manter o texto assim"
            >
              <AlertTriangle size={14} />
              Manter assim
            </button>
            {onEditManually && (
              <button
                type="button"
                onClick={onEditManually}
                disabled={isRewriting}
                className="flex items-center gap-2 px-4 py-2.5 text-gray-600 dark:text-gray-400 rounded-xl text-xs font-black uppercase tracking-widest hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800/60 transition-all disabled:opacity-50"
              >
                <Edit3 size={14} />
                Editar manualmente
              </button>
            )}
          </div>

          {/* Disclaimer */}
          <p className="text-[10px] text-gray-500 dark:text-gray-500 italic">
            ⓘ Detecção é "best effort" — pode haver falsos positivos ou termos que escaparam. Sempre
            revise manualmente antes de subir o anúncio.
          </p>
        </div>
      )}
    </div>
  );
}
