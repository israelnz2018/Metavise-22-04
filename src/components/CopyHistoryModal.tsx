/**
 * UX25-B2 — Copy History Modal
 *
 * Mostra as últimas 5 gerações de copy salvas em config.copy.history.
 * User pode visualizar e restaurar uma versão anterior (substitui o
 * generatedScript atual). Lista por timestamp desc.
 *
 * Cada entry do histórico:
 *   { script, timestamp, model, wordCount }
 *
 * Persiste em Firestore (configurável) — só os scripts (sem prompts).
 */

import { useState } from 'react';
import { X, History, RotateCcw, Copy as CopyIcon, Trash2 } from 'lucide-react';
import { toast } from 'react-hot-toast';

export interface CopyHistoryEntry {
  script: string;
  timestamp: number;
  model: 'opus' | 'sonnet';
  wordCount: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  history: CopyHistoryEntry[];
  currentScript: string;
  onRestore: (script: string) => void;
  onClearHistory: () => void;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'agora';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}min atrás`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h atrás`;
  return `${Math.floor(diff / 86_400_000)}d atrás`;
}

export default function CopyHistoryModal({
  open,
  onClose,
  history,
  currentScript,
  onRestore,
  onClearHistory,
}: Props) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (!open) return null;

  const copyEntry = async (script: string) => {
    try {
      await navigator.clipboard.writeText(script);
      toast.success('Copiado!');
    } catch {
      toast.error('Não foi possível copiar.');
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-950 rounded-3xl w-full max-w-3xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center">
              <History size={16} />
            </div>
            <div>
              <h2 className="text-base font-black text-gray-900 dark:text-gray-50">
                Histórico de gerações
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {history.length === 0
                  ? 'Sem versões salvas ainda'
                  : `${history.length} ${history.length === 1 ? 'versão' : 'versões'} · até as últimas 5`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center text-gray-500 hover:text-gray-900 dark:hover:text-gray-50"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {history.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Histórico vazio. Cada vez que você gera uma copy, ela é salva aqui (limite: 5).
              </p>
            </div>
          ) : (
            history.map((entry, idx) => {
              const isCurrent = entry.script === currentScript;
              const isExpanded = expandedIdx === idx;
              return (
                <div
                  key={entry.timestamp}
                  className={`bg-white dark:bg-gray-900/60 ring-1 rounded-2xl p-4 ${
                    isCurrent
                      ? 'ring-green-300 dark:ring-green-700/60 bg-green-50/40 dark:bg-green-950/20'
                      : 'ring-gray-200 dark:ring-gray-800'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
                        #{history.length - idx}
                      </span>
                      <span className="text-[10px] font-bold text-gray-700 dark:text-gray-300">
                        {timeAgo(entry.timestamp)}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                        {entry.model.toUpperCase()}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                        {entry.wordCount} palavras
                      </span>
                      {isCurrent && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-300 font-black">
                          ATUAL
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => copyEntry(entry.script)}
                        className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
                        title="Copiar"
                      >
                        <CopyIcon size={12} />
                      </button>
                      {!isCurrent && (
                        <button
                          onClick={() => {
                            onRestore(entry.script);
                            toast.success('Versão restaurada!');
                            onClose();
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-black uppercase tracking-widest"
                          title="Restaurar essa versão"
                        >
                          <RotateCcw size={10} />
                          Restaurar
                        </button>
                      )}
                    </div>
                  </div>

                  <pre
                    className={`text-xs text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-wrap font-mono cursor-pointer ${
                      isExpanded ? '' : 'line-clamp-3'
                    }`}
                    onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                  >
                    {entry.script}
                  </pre>
                  {!isExpanded && entry.script.length > 250 && (
                    <button
                      onClick={() => setExpandedIdx(idx)}
                      className="mt-1 text-[10px] font-bold uppercase tracking-widest text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Ver tudo
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        {history.length > 0 && (
          <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-800 shrink-0 flex justify-between items-center">
            <button
              onClick={() => {
                if (confirm('Limpar todo o histórico?')) {
                  onClearHistory();
                  onClose();
                }
              }}
              className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-red-600 dark:text-red-400 hover:underline"
            >
              <Trash2 size={10} />
              Limpar histórico
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-black dark:hover:bg-white"
            >
              Fechar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
