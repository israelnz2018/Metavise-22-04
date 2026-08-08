/**
 * MODO CONCORRENTE — cola o texto de um anúncio rival, a IA lê o ângulo/hook/
 * driver emocional por trás dele e sugere 3 ângulos ORIGINAIS pro nosso
 * produto (nunca copia frases — só reaproveita o insight estratégico).
 *
 * Não escreve direto na copy: mostra as sugestões com "copiar" pra o usuário
 * colar onde fizer sentido (ângulo, hook, brief) — mantém o pipeline de
 * geração de copy existente intacto.
 */

import { useState } from 'react';
import { X, Swords, Loader2, Copy as CopyIcon, Sparkles } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { analyzeCompetitorAd, type CompetitorAnalysis } from '@/lib/claudeService';

interface Props {
  open: boolean;
  onClose: () => void;
  productInfo?: {
    produto?: string;
    oferta?: string;
    dorPrincipal?: string;
    [k: string]: any;
  } | null;
  persona?: {
    name?: string;
    mainPain?: string;
    dominantFear?: string;
    hiddenDesire?: string;
    [k: string]: any;
  } | null;
  language?: string;
}

export default function CompetitorAngleModal({
  open,
  onClose,
  productInfo,
  persona,
  language,
}: Props) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CompetitorAnalysis | null>(null);

  if (!open) return null;

  const analyze = async () => {
    if (!text.trim()) {
      toast.error('Cole o texto do anúncio do concorrente primeiro.');
      return;
    }
    setLoading(true);
    try {
      const r = await analyzeCompetitorAd({ competitorText: text, productInfo, persona, language });
      if (!r) {
        toast.error('A IA não conseguiu analisar. Tente novamente.');
        return;
      }
      setResult(r);
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao analisar.');
    } finally {
      setLoading(false);
    }
  };

  const copy = async (t: string) => {
    try {
      await navigator.clipboard.writeText(t);
      toast.success('Copiado!');
    } catch {
      toast.error('Não foi possível copiar.');
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-950 rounded-3xl w-full max-w-3xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gray-700 to-gray-900 text-white flex items-center justify-center">
              <Swords size={16} />
            </div>
            <div>
              <h2 className="text-base font-black text-gray-900 dark:text-gray-50">
                Modo concorrente
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Cole o anúncio de um rival — a IA lê o ângulo dele e sugere 3 próprios, originais.
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

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              Texto do anúncio do concorrente (copie e cole)
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              placeholder="Cole aqui a copy, transcrição do vídeo ou legenda do anúncio do concorrente…"
              className="w-full px-3 py-2.5 rounded-xl ring-1 ring-gray-200 dark:ring-gray-800 bg-white dark:bg-gray-900 text-sm text-gray-800 dark:text-gray-100 font-mono resize-y"
            />
          </div>

          <button
            onClick={analyze}
            disabled={loading}
            className="w-full py-3 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-black dark:hover:bg-white transition-all disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Analisando…
              </>
            ) : (
              <>
                <Swords size={16} /> Analisar e sugerir ângulo próprio
              </>
            )}
          </button>

          {result && (
            <div className="space-y-4 pt-2">
              <div className="rounded-2xl bg-gray-50 dark:bg-gray-900/60 ring-1 ring-gray-200 dark:ring-gray-800 p-4 space-y-1.5">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                  O que o concorrente está fazendo
                </p>
                <p className="text-sm text-gray-800 dark:text-gray-200">
                  <span className="font-bold">Ângulo:</span> {result.competitorAngle}
                </p>
                <p className="text-sm text-gray-800 dark:text-gray-200">
                  <span className="font-bold">Fórmula de hook:</span> {result.hookFormula}
                </p>
                <p className="text-sm text-gray-800 dark:text-gray-200">
                  <span className="font-bold">Driver emocional:</span> {result.emotionalDriver}
                </p>
                <p className="text-sm text-gray-800 dark:text-gray-200">
                  <span className="font-bold">Estrutura:</span> {result.structureNotes}
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 flex items-center gap-1.5">
                  <Sparkles size={12} /> Ângulos próprios sugeridos — originais, não copiados
                </p>
                {result.suggestions.map((s, i) => (
                  <div
                    key={i}
                    className="rounded-2xl bg-blue-50/60 dark:bg-blue-950/20 ring-1 ring-blue-200/60 dark:ring-blue-900/40 p-4 space-y-1.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-black text-gray-900 dark:text-gray-100">
                        {s.angle}
                      </p>
                      <button
                        onClick={() => copy(s.angle)}
                        className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900/40 text-blue-700 dark:text-blue-300 shrink-0"
                        title="Copiar ângulo"
                      >
                        <CopyIcon size={12} />
                      </button>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400">{s.rationale}</p>
                    {s.sampleHook && (
                      <div className="flex items-start justify-between gap-2 pt-1">
                        <p className="text-xs italic text-gray-700 dark:text-gray-300">
                          "{s.sampleHook}"
                        </p>
                        <button
                          onClick={() => copy(s.sampleHook)}
                          className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900/40 text-blue-700 dark:text-blue-300 shrink-0"
                          title="Copiar hook"
                        >
                          <CopyIcon size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 dark:text-gray-500 italic">
                ⓘ Use como inspiração de ângulo — cole no campo de ângulo/hook e gere a copy
                normalmente.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
