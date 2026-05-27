/**
 * UX25-A2 + A3 — Copy Quality Panels
 *
 * Dois painéis pequenos que aparecem no CopyTab:
 *
 *   PreflightCheckPanel: aparece ACIMA do botão "Gerar Copy" quando
 *   detecta campos fracos. Avisa antes de mandar pra IA.
 *
 *   HallucinationBanner: aparece ABAIXO da copy gerada quando o
 *   detector encontra claims não suportados pela fonte.
 */

import { useState } from 'react';
import { AlertCircle, FlaskConical, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import type { PreflightIssue, HallucinationFlag } from '@/lib/claudeService';

// ─────────────────────────────────────────────
// Preflight Check Panel
// ─────────────────────────────────────────────
interface PreflightProps {
  issues: PreflightIssue[];
  onEnrichWithAI?: () => void;
  enriching?: boolean;
}

export function PreflightCheckPanel({ issues, onEnrichWithAI, enriching }: PreflightProps) {
  const [expanded, setExpanded] = useState(false);
  if (issues.length === 0) return null;

  const errors = issues.filter((i) => i.severity === 'error');
  const warns = issues.filter((i) => i.severity === 'warn');
  const isError = errors.length > 0;

  return (
    <div
      className={`w-full max-w-3xl rounded-2xl ring-1 ${
        isError
          ? 'bg-red-50/80 dark:bg-red-950/30 ring-red-300 dark:ring-red-800/60'
          : 'bg-amber-50/80 dark:bg-amber-950/30 ring-amber-300 dark:ring-amber-800/60'
      } overflow-hidden`}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
      >
        <div
          className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center shadow ${
            isError ? 'bg-red-500 text-white' : 'bg-amber-500 text-white'
          }`}
        >
          <AlertCircle size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <p
            className={`text-[10px] font-black uppercase tracking-widest ${
              isError ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'
            }`}
          >
            {isError ? 'Faltam campos obrigatórios' : 'Brief fraco — copy pode sair genérica'}
          </p>
          <p className="text-sm font-bold text-gray-900 dark:text-gray-50">
            {errors.length > 0 && `${errors.length} ${errors.length === 1 ? 'erro' : 'erros'}`}
            {errors.length > 0 && warns.length > 0 && ' · '}
            {warns.length > 0 && `${warns.length} ${warns.length === 1 ? 'aviso' : 'avisos'}`}
            <span className="ml-2 text-xs text-gray-600 dark:text-gray-400 normal-case tracking-normal font-medium">
              · clique pra ver
            </span>
          </p>
        </div>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-2">
          {issues.map((i, idx) => (
            <div
              key={idx}
              className="bg-white dark:bg-gray-900/60 rounded-xl p-3 ring-1 ring-gray-200 dark:ring-gray-800"
            >
              <div className="flex items-start gap-2">
                <span
                  className={`shrink-0 text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${
                    i.severity === 'error'
                      ? 'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300'
                      : 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
                  }`}
                >
                  {i.severity === 'error' ? 'ERRO' : 'AVISO'}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-gray-900 dark:text-gray-50">{i.label}</p>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{i.reason}</p>
                  <p className="text-xs text-gray-800 dark:text-gray-200 mt-1 italic">
                    💡 {i.suggestion}
                  </p>
                </div>
              </div>
            </div>
          ))}

          {onEnrichWithAI && (
            <button
              onClick={onEnrichWithAI}
              disabled={enriching}
              className="mt-2 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-[10px] font-black uppercase tracking-widest"
            >
              {enriching ? <Loader2 size={12} className="animate-spin" /> : null}
              Enriquecer campos com IA
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Hallucination Banner
// ─────────────────────────────────────────────
interface HallucinationProps {
  flags: HallucinationFlag[];
  onDismiss: () => void;
}

const SEV_COLORS: Record<HallucinationFlag['severity'], { ring: string; chip: string }> = {
  high: {
    ring: 'ring-red-300 dark:ring-red-800/60 bg-red-50/80 dark:bg-red-950/30',
    chip: 'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300',
  },
  medium: {
    ring: 'ring-orange-300 dark:ring-orange-800/60 bg-orange-50/80 dark:bg-orange-950/30',
    chip: 'bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300',
  },
  low: {
    ring: 'ring-amber-300 dark:ring-amber-800/60 bg-amber-50/80 dark:bg-amber-950/30',
    chip: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300',
  },
};

export function HallucinationBanner({ flags, onDismiss }: HallucinationProps) {
  const [expanded, setExpanded] = useState(true);
  if (flags.length === 0) return null;

  const maxSev = flags.reduce<HallucinationFlag['severity']>((acc, f) => {
    const rank = { low: 0, medium: 1, high: 2 };
    return rank[f.severity] > rank[acc] ? f.severity : acc;
  }, 'low');
  const colors = SEV_COLORS[maxSev];

  return (
    <div className={`rounded-2xl ring-1 ${colors.ring} overflow-hidden shadow-sm`}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
      >
        <div className="shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-red-600 text-white flex items-center justify-center shadow">
          <FlaskConical size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-200">
            Possíveis alucinações detectadas
          </p>
          <p className="text-sm font-bold text-gray-900 dark:text-gray-50">
            {flags.length} {flags.length === 1 ? 'trecho' : 'trechos'} sem suporte na fonte
          </p>
        </div>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-2">
          {flags.map((f, idx) => {
            const c = SEV_COLORS[f.severity];
            return (
              <div
                key={idx}
                className="bg-white dark:bg-gray-900/60 rounded-xl p-3 ring-1 ring-gray-200 dark:ring-gray-800"
              >
                <span
                  className={`inline-block text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded mb-1 ${c.chip}`}
                >
                  {f.severity}
                </span>
                <p className="text-xs text-gray-900 dark:text-gray-50 italic">"{f.excerpt}"</p>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">→ {f.reason}</p>
              </div>
            );
          })}
          <div className="flex justify-end pt-2">
            <button
              onClick={onDismiss}
              className="text-[10px] font-black uppercase tracking-widest text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
            >
              Dispensar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
