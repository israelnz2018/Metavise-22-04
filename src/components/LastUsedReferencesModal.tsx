/**
 * UX23-E — Last Used References Modal
 *
 * Mostra um snapshot das copies que efetivamente entraram como
 * referência na última geração. Útil pra:
 *   - Verificar que a seleção manual realmente foi enviada pra IA
 *   - Comparar a copy gerada lado-a-lado com o que serviu de modelo
 *   - Auditar quando o resultado não saiu como esperado
 *
 * O snapshot é independente da biblioteca atual (vem de
 * config.copy.lastUsedReferences), então funciona mesmo se o user
 * deletou a copy da biblioteca depois.
 */

import { X, FileText } from 'lucide-react';
import type { LastUsedReference } from './ReferenceSimilarityPanel';

interface Props {
  open: boolean;
  onClose: () => void;
  references: LastUsedReference[] | undefined;
  generatedScript?: string;
}

export default function LastUsedReferencesModal({
  open,
  onClose,
  references,
  generatedScript,
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-gray-950 rounded-3xl w-full max-w-6xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 text-white flex items-center justify-center">
              <FileText size={16} />
            </div>
            <div>
              <h2 className="text-base font-black text-gray-900 dark:text-gray-50">
                Referências usadas na última geração
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {references?.length || 0} copies serviram de modelo · compare com o resultado
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
        <div className="flex-1 overflow-y-auto p-6">
          {!references || references.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Nenhuma geração com referência manual ainda.
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                Marque copies na biblioteca como referência e clique em Gerar Copy.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Coluna esquerda: copies de referência */}
              <div className="space-y-3">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400 sticky top-0 bg-white dark:bg-gray-950 py-2 z-10">
                  Modelos enviados pra IA ({references.length})
                </h3>
                {references.map((r, idx) => (
                  <div
                    key={r.id}
                    className="bg-blue-50/60 dark:bg-blue-950/30 ring-1 ring-blue-200/60 dark:ring-blue-900/40 rounded-2xl p-4 space-y-2"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300">
                        Referência {idx + 1}
                      </span>
                      {r.name && (
                        <span className="text-xs font-bold text-gray-900 dark:text-gray-50 truncate">
                          {r.name}
                        </span>
                      )}
                      {r.vertical && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 ring-1 ring-gray-200 dark:ring-gray-800">
                          {r.vertical}
                        </span>
                      )}
                      {r.language && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 ring-1 ring-gray-200 dark:ring-gray-800">
                          {r.language.toUpperCase()}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-wrap font-mono">
                      {r.scriptPreview}
                      {r.scriptPreview.length >= 280 ? '…' : ''}
                    </p>
                  </div>
                ))}
              </div>

              {/* Coluna direita: copy gerada */}
              <div className="space-y-3">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400 sticky top-0 bg-white dark:bg-gray-950 py-2 z-10">
                  Resultado gerado
                </h3>
                {generatedScript && generatedScript.trim() ? (
                  <div className="bg-purple-50/60 dark:bg-purple-950/30 ring-1 ring-purple-200/60 dark:ring-purple-900/40 rounded-2xl p-4">
                    <pre className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-wrap font-mono">
                      {generatedScript}
                    </pre>
                  </div>
                ) : (
                  <div className="bg-gray-50 dark:bg-gray-900/60 ring-1 ring-gray-200 dark:ring-gray-800 rounded-2xl p-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400 italic">
                      Nenhuma copy gerada ainda — gere uma pra comparar lado-a-lado.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-800 shrink-0 flex justify-between items-center">
          <p className="text-[10px] text-gray-400 dark:text-gray-500 italic">
            Dica: se o resultado não estiver parecido o suficiente, aumente a similaridade.
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-black dark:hover:bg-white transition-all"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
