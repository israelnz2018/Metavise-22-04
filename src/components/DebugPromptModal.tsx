/**
 * UX25-C1 — Debug Prompt Modal
 *
 * Mostra o prompt EXATO que foi enviado ao Claude na última geração +
 * a resposta (script gerado). Útil pra:
 *   - Diagnosticar quando a copy sai estranha ("o que mandei pra IA?")
 *   - Verificar se referências/destination/avoid list chegaram no prompt
 *   - Confiança / transparência geral
 *
 * Dados vêm de config.copy.lastDebug (snapshot da última geração).
 * Não persiste em Firestore — só durante a sessão.
 */

import { useState } from 'react';
import { X, Copy as CopyIcon, Check, Terminal } from 'lucide-react';
import { toast } from 'react-hot-toast';

export interface DebugSnapshot {
  systemPrompt: string;
  userPrompt: string;
  response: string;
  model: 'opus' | 'sonnet';
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCost: number;
  timestamp: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  debug: DebugSnapshot | undefined;
}

export default function DebugPromptModal({ open, onClose, debug }: Props) {
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'user' | 'system' | 'response'>('user');

  if (!open) return null;

  const copySection = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSection(key);
      toast.success('Copiado!');
      setTimeout(() => setCopiedSection(null), 1500);
    } catch {
      toast.error('Não foi possível copiar.');
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-gray-950 rounded-3xl w-full max-w-5xl max-h-[92vh] overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 flex items-center justify-center">
              <Terminal size={16} />
            </div>
            <div>
              <h2 className="text-base font-black text-gray-900 dark:text-gray-50">
                Prompt enviado ao Claude
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {debug
                  ? `Modelo: ${debug.model.toUpperCase()} · ~${debug.estimatedInputTokens.toLocaleString()} input tokens · ~${debug.estimatedOutputTokens.toLocaleString()} output · ~$${debug.estimatedCost.toFixed(4)}`
                  : 'Nenhuma geração ainda nesta sessão.'}
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

        {/* Tabs */}
        {debug && (
          <div className="flex border-b border-gray-200 dark:border-gray-800 shrink-0">
            {[
              { id: 'user' as const, label: 'User prompt', chars: debug.userPrompt.length },
              { id: 'system' as const, label: 'System prompt', chars: debug.systemPrompt.length },
              { id: 'response' as const, label: 'Resposta', chars: debug.response.length },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`flex-1 px-4 py-3 text-xs font-black uppercase tracking-widest transition-all ${
                  activeTab === t.id
                    ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400 bg-blue-50/40 dark:bg-blue-950/20'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
                }`}
              >
                {t.label}
                <span className="ml-2 text-gray-400 dark:text-gray-500 normal-case tracking-normal">
                  ({(t.chars / 1000).toFixed(1)}k chars)
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {!debug ? (
            <div className="text-center py-16">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Sem snapshot de prompt nessa sessão.
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                Gere uma copy e o prompt enviado aparecerá aqui.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-end">
                <button
                  onClick={() =>
                    copySection(
                      activeTab === 'user'
                        ? debug.userPrompt
                        : activeTab === 'system'
                          ? debug.systemPrompt
                          : debug.response,
                      activeTab
                    )
                  }
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-[10px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-200"
                >
                  {copiedSection === activeTab ? <Check size={12} /> : <CopyIcon size={12} />}
                  {copiedSection === activeTab ? 'Copiado' : 'Copiar'}
                </button>
              </div>
              <pre className="bg-gray-50 dark:bg-gray-900/60 ring-1 ring-gray-200 dark:ring-gray-800 rounded-2xl p-4 text-xs text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-wrap font-mono">
                {activeTab === 'user'
                  ? debug.userPrompt
                  : activeTab === 'system'
                    ? debug.systemPrompt
                    : debug.response}
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-800 shrink-0 flex justify-between items-center">
          <p className="text-[10px] text-gray-400 dark:text-gray-500 italic">
            Custos são estimativas — Anthropic não retorna usage no streaming.
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
