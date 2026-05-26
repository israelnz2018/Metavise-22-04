/**
 * UX18 — Modal "Biblioteca de Copies".
 *
 * 2 abas:
 *   1. "Minhas" — copies do user. CRUD: ver, favoritar, deletar.
 *   2. "Metavise" — copies do sistema (read-only).
 *
 * Atribuição visível em cada item: vertical + awareness + language.
 * Click expande o card pra ler o script completo.
 */

import { useState } from 'react';
import { X, Star, Trash2, Library, BookOpen, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { COPY_LIBRARY, type CopyExample, type CopyVertical } from '@/data/copyLibrary';
import type { PersonalCopyDoc } from '@/lib/personalCopyLibrary';

const VERTICAL_LABEL: Record<CopyVertical, string> = {
  saude: 'Saúde',
  emagrecimento: 'Emagrecimento',
  financas: 'Finanças',
  info_produto: 'Info-produto',
  beleza: 'Beleza',
  fisico: 'Físico/Lifestyle',
  espiritual: 'Espiritual',
};

interface Props {
  open: boolean;
  onClose: () => void;
  personalLibrary: PersonalCopyDoc[];
  onToggleStar: (copyId: string, starred: boolean) => void;
  onDelete: (copyId: string) => void;
}

export function CopyLibraryModal({
  open,
  onClose,
  personalLibrary,
  onToggleStar,
  onDelete,
}: Props) {
  const [tab, setTab] = useState<'mine' | 'system'>('mine');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!open) return null;

  const renderItem = (
    item: CopyExample | PersonalCopyDoc,
    isPersonal: boolean,
    starred?: boolean
  ) => {
    const isExpanded = expandedId === item.id;
    return (
      <div
        key={item.id}
        className={`bg-white dark:bg-gray-900/80 rounded-2xl border-2 transition-all ${
          starred
            ? 'border-amber-300 dark:border-amber-700 shadow-sm shadow-amber-100/40'
            : 'border-gray-200 dark:border-gray-800'
        }`}
      >
        <div className="p-4 space-y-2">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-1.5 flex-wrap text-[9px] font-black uppercase tracking-widest">
                <span className="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300">
                  {VERTICAL_LABEL[item.vertical] || item.vertical}
                </span>
                <span className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                  Consc. {item.awareness}
                </span>
                <span className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                  {item.language === 'pt' ? 'PT' : 'EN'}
                </span>
                {item.angle && (
                  <span className="px-2 py-0.5 rounded bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 truncate max-w-[180px]">
                    {item.angle}
                  </span>
                )}
                {!isPersonal && (
                  <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300">
                    Metavise
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-700 dark:text-gray-300 line-clamp-2 leading-relaxed">
                {item.script.substring(0, 200)}
                {item.script.length > 200 ? '…' : ''}
              </p>
            </div>
            <div className="flex flex-col gap-1 flex-shrink-0">
              {isPersonal && (
                <>
                  <button
                    onClick={() => onToggleStar(item.id, !starred)}
                    className={`p-1.5 rounded-lg ${
                      starred
                        ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/40'
                        : 'text-gray-400 hover:text-amber-500 hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                    title={starred ? 'Desfavoritar' : 'Favoritar'}
                  >
                    <Star size={14} fill={starred ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    onClick={() => {
                      if (
                        window.confirm(
                          'Deletar esta copy da sua biblioteca? A ação não pode ser desfeita.'
                        )
                      ) {
                        onDelete(item.id);
                      }
                    }}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                    title="Deletar"
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
              <button
                onClick={() => setExpandedId(isExpanded ? null : item.id)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                title={isExpanded ? 'Recolher' : 'Ver completo'}
              >
                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>
          </div>
          {isExpanded && (
            <div className="pt-3 border-t border-gray-100 dark:border-gray-800 space-y-2">
              <pre className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap font-mono">
                {item.script}
              </pre>
              {item.whyItWorks && (
                <p className="text-[10px] italic text-gray-500 dark:text-gray-400 pt-2 border-t border-gray-50 dark:border-gray-800">
                  💡 {item.whyItWorks}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 text-white rounded-xl">
              <Library size={20} />
            </div>
            <div>
              <h2 className="text-lg font-black text-gray-900 dark:text-gray-50">
                Biblioteca de Copies
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Exemplos usados pela IA pra gerar suas copies
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-gray-400 hover:text-gray-900 dark:hover:text-gray-50 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-6 pt-4 border-b border-gray-100 dark:border-gray-800">
          <button
            onClick={() => setTab('mine')}
            className={`px-4 py-2.5 rounded-t-xl text-xs font-black uppercase tracking-widest transition-colors ${
              tab === 'mine'
                ? 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-50'
            }`}
          >
            <BookOpen size={12} className="inline mr-1.5" />
            Minhas ({personalLibrary.length})
          </button>
          <button
            onClick={() => setTab('system')}
            className={`px-4 py-2.5 rounded-t-xl text-xs font-black uppercase tracking-widest transition-colors ${
              tab === 'system'
                ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-50'
            }`}
          >
            <Sparkles size={12} className="inline mr-1.5" />
            Metavise ({COPY_LIBRARY.length})
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'mine' && (
            <>
              {personalLibrary.length === 0 ? (
                <div className="text-center py-12 space-y-3">
                  <BookOpen size={32} className="mx-auto text-gray-300 dark:text-gray-700" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Você ainda não tem copies na sua biblioteca.
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 max-w-md mx-auto">
                    Quando você gerar uma copy que gostou, clique em "✓ Marcar como copy boa" pra
                    adicioná-la aqui. A IA vai usar suas favoritas como referência nas próximas
                    gerações.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {personalLibrary.map((item) => renderItem(item, true, item.starred))}
                </div>
              )}
            </>
          )}
          {tab === 'system' && (
            <div className="space-y-2">
              <p className="text-[10px] text-gray-500 dark:text-gray-400 italic pb-2">
                Exemplos curados que a IA usa como referência quando você não tem copies próprias da
                mesma vertical. Não dá pra editar — sua biblioteca pessoal substitui essas.
              </p>
              {COPY_LIBRARY.map((item) => renderItem(item, false))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
