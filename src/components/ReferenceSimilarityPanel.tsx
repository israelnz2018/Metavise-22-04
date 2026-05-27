/**
 * UX23 — Reference Similarity Panel
 *
 * Painel compacto que aparece quando o user marcou copies como
 * referência na biblioteca. Mostra:
 *
 *   - Quantas copies estão marcadas + atalho pra biblioteca
 *   - Slider de similaridade 0-100 (controla a intensidade da imitação)
 *   - Resumo da última geração (quando existe lastUsedReferences)
 *   - Botão "Ver referências usadas" — abre modal LastUsedReferencesModal
 *
 * Buckets do slider (espelho do que claudeService usa):
 *   0-25   → Leve (estudar tom, não copiar)
 *   26-50  → Médio (espelhar o feel)
 *   51-75  → Forte (clone + fingerprint extraído)
 *   76-100 → Clone (voz indistinguível)
 */

import { Library, Sliders, History } from 'lucide-react';

export interface LastUsedReference {
  id: string;
  name?: string;
  scriptPreview: string;
  vertical?: string;
  language?: string;
}

interface Props {
  selectedCount: number;
  similarity: number;
  onChangeSimilarity: (next: number) => void;
  lastUsed?: LastUsedReference[];
  onOpenLibrary: () => void;
  onShowLastUsed: () => void;
}

function bucketLabel(s: number): { label: string; color: string; desc: string } {
  if (s <= 25)
    return {
      label: 'Leve',
      color: 'text-gray-600 dark:text-gray-400',
      desc: 'Estudar o tom — sem espelhar muito',
    };
  if (s <= 50)
    return {
      label: 'Médio',
      color: 'text-blue-600 dark:text-blue-400',
      desc: 'Espelhar o feel, cadência e abertura',
    };
  if (s <= 75)
    return {
      label: 'Forte',
      color: 'text-purple-600 dark:text-purple-400',
      desc: 'Imitação tight + fingerprint do estilo',
    };
  return {
    label: 'Clone',
    color: 'text-amber-600 dark:text-amber-400',
    desc: 'Voz indistinguível — só troca conteúdo',
  };
}

export default function ReferenceSimilarityPanel({
  selectedCount,
  similarity,
  onChangeSimilarity,
  lastUsed,
  onOpenLibrary,
  onShowLastUsed,
}: Props) {
  const b = bucketLabel(similarity);
  const hasLastUsed = lastUsed && lastUsed.length > 0;

  return (
    <div className="w-full max-w-3xl bg-gradient-to-br from-blue-50 via-purple-50 to-amber-50 dark:from-blue-950/30 dark:via-purple-950/30 dark:to-amber-950/30 ring-1 ring-blue-200/60 dark:ring-blue-900/40 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 text-white flex items-center justify-center shadow-md">
            <Sliders size={16} />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300">
              Copies de referência ativas
            </p>
            <p className="text-sm font-bold text-gray-900 dark:text-gray-50">
              {selectedCount} {selectedCount === 1 ? 'copy marcada' : 'copies marcadas'} · IA vai
              espelhar o estilo
            </p>
          </div>
        </div>
        <button
          onClick={onOpenLibrary}
          className="shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-gray-900/60 ring-1 ring-gray-200/60 dark:ring-gray-700/60 hover:ring-blue-400 text-[10px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-200 transition-all"
        >
          <Library size={12} />
          Gerenciar
        </button>
      </div>

      {/* Slider */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
            Similaridade com a referência
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-gray-900 dark:text-gray-50">
              {similarity}%
            </span>
            <span className={`text-xs font-black uppercase tracking-widest ${b.color}`}>
              {b.label}
            </span>
          </div>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={similarity}
          onChange={(e) => onChangeSimilarity(Number(e.target.value))}
          className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-gradient-to-r from-gray-300 via-blue-400 via-purple-500 to-amber-500 dark:from-gray-700"
          aria-label="Nível de similaridade"
        />
        <div className="flex justify-between text-[9px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
          <span>0 · Ignora</span>
          <span>50 · Espelha</span>
          <span>100 · Clona</span>
        </div>
        <p className="text-xs text-gray-600 dark:text-gray-400 italic">{b.desc}</p>
      </div>

      {/* Última geração */}
      {hasLastUsed && (
        <div className="pt-3 border-t border-blue-200/40 dark:border-blue-900/40 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <History size={12} className="text-gray-500 dark:text-gray-400" />
            <span className="text-xs text-gray-600 dark:text-gray-400 truncate">
              Última geração usou{' '}
              <strong className="text-gray-900 dark:text-gray-50">
                {lastUsed!.length} {lastUsed!.length === 1 ? 'cópia' : 'cópias'}
              </strong>{' '}
              como referência
            </span>
          </div>
          <button
            onClick={onShowLastUsed}
            className="shrink-0 text-[10px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300 hover:underline"
          >
            Ver →
          </button>
        </div>
      )}
    </div>
  );
}
