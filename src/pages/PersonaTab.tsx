// Persona discovery tab — 9-question form that feeds Claude to generate
// 3 ranked personas (principal / secondary / tertiary) with awareness
// levels. Receives state via props so App.tsx still owns the canonical
// `config`, `generatedPersona`, etc. Extracting this trimmed App.tsx
// by ~560 lines without changing any behavior.

import { toast } from 'react-hot-toast';
import { Users, Sparkles, Loader2, CheckCircle2 } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  PERSONA_CATEGORY_OPTIONS,
  PERSONA_URGENCY_OPTIONS,
  PERSONA_DIFFERENTIAL_OPTIONS,
  PERSONA_TRIED_BEFORE_OPTIONS,
  PERSONA_PAYING_CAPACITY_OPTIONS,
  PERSONA_HIDDEN_DESIRE_OPTIONS,
  COPY_SECTIONS,
} from '../lib/constants';
import { personaFromProduct, type ProductInfo } from '../lib/claudeService';

interface Props {
  // Single source of truth for the form. Read `config.copy.answers` and
  // `config.copy.productInfo`; write via `updateConfig` (deep merge) or
  // `setConfig` (full overwrite, used by the auto-fill button).
  config: any;
  // Typed loosely as `any` so it accepts App.tsx's tighter
  // `(section: keyof AdConfig, ...)` signature — AdConfig isn't exported.
  updateConfig: (section: any, sub: any, field: any, value: any) => void;
  setConfig: React.Dispatch<React.SetStateAction<any>>;

  // Result of the last persona generation. `personasSaved` gates the
  // "Enviar persona pra Copy" button.
  generatedPersona: any;
  personasSaved: boolean;

  // Parent-owned async handlers.
  loading: boolean;
  onGeneratePersona: (answers: Record<string, any>) => Promise<void> | void;
  onSavePersonas: () => Promise<void> | void;
  onSelectPersona: (persona: any) => void;
}

export function PersonaTab({
  config,
  updateConfig,
  setConfig,
  generatedPersona,
  personasSaved,
  loading,
  onGeneratePersona,
  onSavePersonas,
  onSelectPersona,
}: Props) {
  const a = config.copy.answers;
  const differentials: string[] = a.differentials || [];
  const personaTriedBefore: string[] = a.personaTriedBefore || [];
  const hiddenDesires: string[] = a.hiddenDesires || [];

  const toggleArrayValue = (field: string, value: string, max?: number) => {
    const current: string[] = a[field] || [];
    let next: string[];
    if (current.includes(value)) {
      next = current.filter((v) => v !== value);
    } else {
      if (max && current.length >= max) {
        toast.error(`Máximo de ${max} opções.`);
        return;
      }
      next = [...current, value];
    }
    updateConfig('copy', 'answers', field, next);
  };

  const allRequired =
    (a.product || '').trim().length > 0 &&
    (a.category || '').trim().length > 0 &&
    (a.whatItDoes || '').trim().length > 0 &&
    (a.transformationFrom || '').trim().length > 0 &&
    (a.transformationTo || '').trim().length > 0 &&
    (a.urgency || '').trim().length > 0 &&
    differentials.length > 0 &&
    personaTriedBefore.length > 0 &&
    (a.payingCapacity || '').trim().length > 0 &&
    hiddenDesires.length > 0;

  const personas: any[] = generatedPersona?.personas || [];
  const productInfo = (config.copy as any)?.productInfo as ProductInfo | null;

  const handleFillFromSource = async () => {
    if (!productInfo) return;
    const toastId = 'fill-from-source';
    toast.loading('Preenchendo campos com IA...', { id: toastId });
    try {
      // Pull enum options out of the COPY_SECTIONS schema so Claude
      // returns exact values the form accepts.
      const allQuestions = COPY_SECTIONS.flatMap((s) => s.questions);
      const optionsFor = (id: string): string[] => {
        const q = allQuestions.find((q) => q.id === id);
        return (q as any)?.options || [];
      };
      const filled = await personaFromProduct({
        productInfo,
        options: {
          categories: PERSONA_CATEGORY_OPTIONS,
          urgencies: PERSONA_URGENCY_OPTIONS.map((o) => o.value),
          differentials: PERSONA_DIFFERENTIAL_OPTIONS,
          triedBefores: PERSONA_TRIED_BEFORE_OPTIONS,
          payingCapacities: PERSONA_PAYING_CAPACITY_OPTIONS,
          hiddenDesires: PERSONA_HIDDEN_DESIRE_OPTIONS.map((o) => o.label),
          languages: optionsFor('language'),
          ageBuckets: optionsFor('age'),
          businessModels: optionsFor('businessModel'),
          emotions: optionsFor('emotion'),
          angles: optionsFor('angleIdea'),
        },
      });
      setConfig((prev: any) => ({
        ...prev,
        copy: {
          ...prev.copy,
          answers: { ...prev.copy.answers, ...filled },
        },
      }));
      toast.success('Campos preenchidos!', { id: toastId });
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao preencher.', { id: toastId });
    }
  };

  return (
    <div className="max-w-[1100px] mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-2xl font-black text-gray-900 tracking-tight flex items-center gap-2">
            <Users size={28} className="text-blue-600" />
            Identificar Persona
          </h3>
          <p className="text-gray-500 text-sm mt-1">
            Responda 9 perguntas — a IA gera 3 personas com nível de consciência. Escolha uma para
            continuar.
          </p>
        </div>
        {productInfo && (
          <button
            onClick={handleFillFromSource}
            className="shrink-0 px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow flex items-center gap-2"
            title="Usa a IA pra preencher os 9 campos com base na Fonte do Produto"
          >
            <Sparkles size={14} />
            Preencher com fonte
          </button>
        )}
      </div>

      {/* ETAPA 1 — Produto */}
      <div className="bg-white p-6 md:p-8 rounded-[32px] border-2 border-gray-100 shadow-sm space-y-5">
        <div className="flex items-center gap-3">
          <span className="px-3 py-1 bg-blue-600 text-white rounded-full text-[10px] font-black uppercase tracking-widest">
            Etapa 1
          </span>
          <h4 className="text-lg font-black text-gray-900">Sobre o produto</h4>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-black text-gray-900">1. O que você está vendendo?</label>
          <input
            type="text"
            value={a.product || ''}
            onChange={(e) => updateConfig('copy', 'answers', 'product', e.target.value)}
            placeholder="Ex: Suplemento natural pra neuropatia"
            className="w-full px-4 py-3 border-2 border-gray-100 rounded-2xl focus:border-blue-600 focus:outline-none text-sm"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-black text-gray-900">2. Categoria do produto</label>
          <div className="flex flex-wrap gap-2">
            {PERSONA_CATEGORY_OPTIONS.map((cat) => (
              <button
                key={cat}
                onClick={() => updateConfig('copy', 'answers', 'category', cat)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all',
                  a.category === cat
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300',
                )}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-black text-gray-900">
            3. Em uma frase, o que ele faz?
          </label>
          <input
            type="text"
            value={a.whatItDoes || ''}
            onChange={(e) => updateConfig('copy', 'answers', 'whatItDoes', e.target.value)}
            placeholder="Ex: Reduz queimação e formigamento causados por nervos danificados"
            className="w-full px-4 py-3 border-2 border-gray-100 rounded-2xl focus:border-blue-600 focus:outline-none text-sm"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-black text-gray-900">4. Transformação prometida</label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                De:
              </span>
              <input
                type="text"
                value={a.transformationFrom || ''}
                onChange={(e) =>
                  updateConfig('copy', 'answers', 'transformationFrom', e.target.value)
                }
                placeholder="Ex: acordando com pés ardendo"
                className="w-full px-4 py-3 border-2 border-gray-100 rounded-2xl focus:border-blue-600 focus:outline-none text-sm"
              />
            </div>
            <div>
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                Para:
              </span>
              <input
                type="text"
                value={a.transformationTo || ''}
                onChange={(e) =>
                  updateConfig('copy', 'answers', 'transformationTo', e.target.value)
                }
                placeholder="Ex: dormindo a noite inteira"
                className="w-full px-4 py-3 border-2 border-gray-100 rounded-2xl focus:border-blue-600 focus:outline-none text-sm"
              />
            </div>
          </div>
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer text-blue-600 font-bold text-xs uppercase tracking-widest">
            + Adicionar contexto sobre o produto (opcional)
          </summary>
          <textarea
            value={a.productComment || ''}
            onChange={(e) => updateConfig('copy', 'answers', 'productComment', e.target.value)}
            placeholder="Algo específico que a IA precisa saber sobre o produto?"
            rows={2}
            className="mt-2 w-full px-4 py-3 border-2 border-gray-100 rounded-2xl focus:border-blue-600 focus:outline-none text-sm resize-none"
          />
        </details>
      </div>

      {/* ETAPA 2 — Problema */}
      <div className="bg-white p-6 md:p-8 rounded-[32px] border-2 border-gray-100 shadow-sm space-y-5">
        <div className="flex items-center gap-3">
          <span className="px-3 py-1 bg-blue-600 text-white rounded-full text-[10px] font-black uppercase tracking-widest">
            Etapa 2
          </span>
          <h4 className="text-lg font-black text-gray-900">Sobre o problema</h4>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-black text-gray-900">
            5. Quão urgente é o problema pra quem compra?
          </label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {PERSONA_URGENCY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => updateConfig('copy', 'answers', 'urgency', opt.value)}
                className={cn(
                  'p-3 rounded-2xl border-2 transition-all text-left',
                  a.urgency === opt.value
                    ? 'bg-blue-50 border-blue-600'
                    : 'bg-white border-gray-100 hover:border-blue-200',
                )}
              >
                <div className="text-sm font-black text-gray-900">{opt.label}</div>
                <div className="text-[10px] text-gray-500 font-bold">{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-black text-gray-900">
            6. Diferenciais do seu produto
            <span className="text-[10px] text-gray-400 font-bold ml-2">(escolha 2-5)</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {PERSONA_DIFFERENTIAL_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => toggleArrayValue('differentials', d, 5)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all',
                  differentials.includes(d)
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300',
                )}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer text-blue-600 font-bold text-xs uppercase tracking-widest">
            + Adicionar contexto sobre o problema (opcional)
          </summary>
          <textarea
            value={a.problemComment || ''}
            onChange={(e) => updateConfig('copy', 'answers', 'problemComment', e.target.value)}
            rows={2}
            className="mt-2 w-full px-4 py-3 border-2 border-gray-100 rounded-2xl focus:border-blue-600 focus:outline-none text-sm resize-none"
          />
        </details>
      </div>

      {/* ETAPA 3 — Cliente */}
      <div className="bg-white p-6 md:p-8 rounded-[32px] border-2 border-gray-100 shadow-sm space-y-5">
        <div className="flex items-center gap-3">
          <span className="px-3 py-1 bg-blue-600 text-white rounded-full text-[10px] font-black uppercase tracking-widest">
            Etapa 3
          </span>
          <h4 className="text-lg font-black text-gray-900">Sobre o cliente</h4>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-black text-gray-900">
            7. O que esse cliente já tentou e não funcionou?
            <span className="text-[10px] text-gray-400 font-bold ml-2">(1-5 opções)</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {PERSONA_TRIED_BEFORE_OPTIONS.map((t) => (
              <button
                key={t}
                onClick={() => toggleArrayValue('personaTriedBefore', t, 5)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all',
                  personaTriedBefore.includes(t)
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300',
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-black text-gray-900">
            8. Capacidade de pagar do cliente típico
          </label>
          <div className="flex flex-wrap gap-2">
            {PERSONA_PAYING_CAPACITY_OPTIONS.map((p) => (
              <button
                key={p}
                onClick={() => updateConfig('copy', 'answers', 'payingCapacity', p)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all',
                  a.payingCapacity === p
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300',
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-black text-gray-900">
            9. Qual é o maior desejo profundo que esse produto realiza?
            <span className="text-[10px] text-gray-400 font-bold ml-2">(escolha 1-3)</span>
          </label>
          <p className="text-xs text-gray-500 italic leading-relaxed">
            Não é o que o produto faz na superfície (ex: "perder peso") — é o que a pessoa
            REALMENTE quer ao resolver o problema (ex: "ser admirada nas fotos", "se sentir
            desejada de novo"). Pense no que ela diria se ninguém estivesse ouvindo.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
            {PERSONA_HIDDEN_DESIRE_OPTIONS.map((d) => (
              <button
                key={d.label}
                onClick={() => toggleArrayValue('hiddenDesires', d.label, 3)}
                className={cn(
                  'p-3 rounded-2xl border-2 transition-all text-left flex items-start gap-2',
                  hiddenDesires.includes(d.label)
                    ? 'bg-blue-50 border-blue-600'
                    : 'bg-white border-gray-100 hover:border-blue-200',
                )}
              >
                <span className="text-xl shrink-0">{d.emoji}</span>
                <span className="text-xs font-bold text-gray-900 leading-tight">{d.label}</span>
              </button>
            ))}
          </div>
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer text-blue-600 font-bold text-xs uppercase tracking-widest">
            + Adicionar contexto sobre o cliente (opcional)
          </summary>
          <textarea
            value={a.clientComment || ''}
            onChange={(e) => updateConfig('copy', 'answers', 'clientComment', e.target.value)}
            rows={2}
            className="mt-2 w-full px-4 py-3 border-2 border-gray-100 rounded-2xl focus:border-blue-600 focus:outline-none text-sm resize-none"
          />
        </details>
      </div>

      {/* Botão Gerar */}
      <button
        onClick={() => onGeneratePersona(a as any)}
        disabled={!allRequired || loading}
        className="w-full py-6 bg-blue-600 text-white rounded-[32px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all shadow-2xl shadow-blue-100 disabled:opacity-50 flex items-center justify-center gap-3 text-lg"
      >
        {loading ? <Loader2 className="animate-spin" size={24} /> : <Sparkles size={24} />}
        {personas.length > 0 ? 'Regerar 3 Personas' : 'Gerar 3 Personas com IA'}
      </button>
      {!allRequired && (
        <p className="text-center text-xs text-gray-400 font-bold uppercase tracking-widest">
          Preencha todas as 9 perguntas obrigatórias para gerar
        </p>
      )}

      {/* RESULTADO — 3 personas */}
      {personas.length > 0 && (
        <div className="space-y-4 pt-8">
          <h4 className="text-xl font-black text-gray-900 text-center">
            ✨ 3 Personas Identificadas — Escolha uma para continuar
          </h4>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {personas.map((p, idx) => {
              const rankColor =
                p.rank === 'principal' ? 'blue' : p.rank === 'secundaria' ? 'purple' : 'gray';
              return (
                <div
                  key={idx}
                  className={cn(
                    'bg-white p-6 rounded-[28px] border-4 shadow-sm space-y-3 flex flex-col',
                    rankColor === 'blue' && 'border-blue-600',
                    rankColor === 'purple' && 'border-purple-400',
                    rankColor === 'gray' && 'border-gray-200',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        'px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest',
                        rankColor === 'blue' && 'bg-blue-600 text-white',
                        rankColor === 'purple' && 'bg-purple-400 text-white',
                        rankColor === 'gray' && 'bg-gray-200 text-gray-700',
                      )}
                    >
                      {p.rank}
                    </span>
                    <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest">
                      Nível {p.awarenessLevel}
                    </span>
                  </div>
                  <div>
                    <h5 className="text-lg font-black text-gray-900">{p.name}</h5>
                    <p className="text-xs text-gray-500 leading-snug mt-1">{p.description}</p>
                  </div>
                  <div className="bg-blue-50 p-3 rounded-2xl border border-blue-100">
                    <p className="text-[10px] font-black text-blue-900 uppercase tracking-widest mb-1">
                      🎯 Nível {p.awarenessLevel} de Consciência
                    </p>
                    <p className="text-xs text-blue-800 leading-snug">{p.awarenessReason}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <div className="text-gray-500">
                      <strong className="text-gray-900">Idade:</strong> {p.age}
                    </div>
                    <div className="text-gray-500">
                      <strong className="text-gray-900">Gênero:</strong> {p.gender}
                    </div>
                  </div>
                  <div className="space-y-2 text-xs flex-1">
                    <div>
                      <strong className="text-gray-900 block text-[10px] uppercase tracking-widest">
                        Dor principal
                      </strong>{' '}
                      <span className="text-gray-700">{p.mainPain}</span>
                    </div>
                    <div>
                      <strong className="text-gray-900 block text-[10px] uppercase tracking-widest">
                        Desejo oculto
                      </strong>{' '}
                      <span className="text-gray-700">{p.hiddenDesire}</span>
                    </div>
                    <div>
                      <strong className="text-gray-900 block text-[10px] uppercase tracking-widest">
                        Medo dominante
                      </strong>{' '}
                      <span className="text-gray-700">{p.dominantFear}</span>
                    </div>
                    <div>
                      <strong className="text-gray-900 block text-[10px] uppercase tracking-widest">
                        Objeção principal
                      </strong>{' '}
                      <span className="text-gray-700">{p.mainObjection}</span>
                    </div>
                    <div>
                      <strong className="text-gray-900 block text-[10px] uppercase tracking-widest">
                        Gatilho emocional
                      </strong>{' '}
                      <span className="text-gray-700">{p.emotionalTrigger}</span>
                    </div>
                    <div className="pt-2 border-t border-gray-100">
                      <strong className="text-gray-900 block text-[10px] uppercase tracking-widest">
                        Ângulo de vídeo
                      </strong>{' '}
                      <span className="text-gray-700">{p.recommendedVideoAngle}</span>
                    </div>
                    <div>
                      <strong className="text-gray-900 block text-[10px] uppercase tracking-widest">
                        Hook recomendado
                      </strong>{' '}
                      <span className="text-gray-700">{p.recommendedHookType}</span>
                    </div>
                    <div>
                      <strong className="text-gray-900 block text-[10px] uppercase tracking-widest">
                        Tom
                      </strong>{' '}
                      <span className="text-gray-700">{p.communicationTone}</span>
                    </div>
                    <div>
                      <strong className="text-gray-900 block text-[10px] uppercase tracking-widest">
                        Promessa
                      </strong>{' '}
                      <span className="text-gray-700">{p.strongestPromise}</span>
                    </div>
                    <div>
                      <strong className="text-gray-900 block text-[10px] uppercase tracking-widest">
                        CTA
                      </strong>{' '}
                      <span className="text-gray-700">{p.recommendedCTA}</span>
                    </div>
                    <div className="pt-2 border-t border-gray-100">
                      <strong className="text-gray-900 block text-[10px] uppercase tracking-widest">
                        Por que é {p.rank}?
                      </strong>{' '}
                      <span className="text-gray-700 italic">{p.whyMainOrSecondaryOrTertiary}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => onSelectPersona(p)}
                    disabled={!personasSaved}
                    className={cn(
                      'w-full mt-3 py-3 rounded-2xl font-black uppercase tracking-widest text-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed',
                      rankColor === 'blue' && 'bg-blue-600 text-white hover:bg-blue-700',
                      rankColor === 'purple' && 'bg-purple-500 text-white hover:bg-purple-600',
                      rankColor === 'gray' && 'bg-gray-900 text-white hover:bg-black',
                    )}
                  >
                    {personasSaved ? 'Enviar este Persona pra Copy →' : '🔒 Salve os 3 primeiro'}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="pt-4">
            <button
              onClick={onSavePersonas}
              disabled={personasSaved}
              className="w-full py-5 bg-green-600 text-white rounded-[28px] font-black uppercase tracking-widest text-sm hover:bg-green-700 transition-all shadow-2xl shadow-green-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
            >
              {personasSaved ? (
                <>
                  <CheckCircle2 size={20} />3 Personas Salvos no Projeto
                </>
              ) : (
                <>💾 Salvar os 3 Personas no Projeto</>
              )}
            </button>
            {personasSaved && (
              <p className="text-center text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-2">
                Agora escolha um persona acima para enviar pra Copy
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
