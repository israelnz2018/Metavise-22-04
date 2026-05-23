// Copy step — biggest pre-Avatar tab. Holds:
//   1. Discovery flow: either "I know my customer" (skip to form) or
//      "help me discover" (5-question persona generator that lands you
//      back on /persona).
//   2. Active-persona card + apply-to-copy button.
//   3. Awareness-level switcher with confirm modal.
//   4. The 4-mode picker (questions / paste / video-paste / coming-soon)
//      gated by has-answers / has-script.
//   5. Form sections (COPY_SECTIONS), generate/optimize/regenerate
//      buttons, recommended duration + style, persona save button,
//      and the post-generation script editor with save → finalScript
//      Firestore write.
// All state stays in App.tsx; we receive it via props. `config` is
// typed with the canonical `AdConfig` exported from App.tsx.

import React from 'react';
import type { AdConfig } from '@/App';
import { toast } from 'react-hot-toast';
import {
  Users,
  Sparkles,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  Loader2,
  Edit3,
  Maximize,
  Star,
} from 'lucide-react';
import { motion } from 'motion/react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { AutoResizeTextarea } from '@/components/AutoResizeTextarea';
import {
  AD_STYLES,
  DURATION_OPTIONS,
  PERSONA_CATEGORY_OPTIONS,
  PERSONA_URGENCY_OPTIONS,
  PERSONA_DIFFERENTIAL_OPTIONS,
  PERSONA_TRIED_BEFORE_OPTIONS,
  PERSONA_PAYING_CAPACITY_OPTIONS,
  PERSONA_HIDDEN_DESIRE_OPTIONS,
  COPY_SECTIONS,
  COPY_MODES,
} from '@/lib/constants';
import { personaFromProduct, type ProductInfo } from '@/lib/claudeService';
import { getRecomendedEstilo, getRecomendacaoTempo, countWords } from '@/lib/helpers';

interface Props {
  config: AdConfig;
  updateConfig: (section: any, sub: any, field: any, value: any) => void;
  setConfig: React.Dispatch<React.SetStateAction<AdConfig>>;

  // Step navigation. Typed `any` so it accepts App.tsx's tighter
  // `Dispatch<SetStateAction<Step>>` signature.
  setCurrentStep: (step: any) => void;
  setVoiceSource: (src: any) => void;

  // Discovery sub-flow ("help me discover" path).
  copyDiscoveryMode: string;
  setCopyDiscoveryMode: (mode: any) => void;
  discoveryStep: number;
  setDiscoveryStep: React.Dispatch<React.SetStateAction<number>>;
  discoveryAnswers: Record<string, any>;
  setDiscoveryAnswers: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  generatedPersona: any;
  onGeneratePersona: (answers: Record<string, any>) => Promise<void> | void;

  // Active-persona card actions.
  copyFieldsApplied: boolean;
  applyPersonaToCopy: () => void;
  setShowEditPersonaModal: (v: boolean) => void;

  // Awareness change confirm modal.
  applyAwarenessLevelChange: (level: string) => void;
  setPendingAwarenessLevel: (level: string) => void;
  setShowAwarenessChangeModal: (v: boolean) => void;

  // Save / dirty state.
  hasUnsavedCopyChanges: boolean;
  setHasUnsavedCopyChanges: (v: boolean) => void;
  isSaving: boolean;
  currentProjectId: string | null;
  handleSaveProject: () => Promise<any> | void;

  // Generate copy.
  loading: boolean;
  handleGenerateCopy: () => void | Promise<void>;

  // Tab-level UX gates.
  isProjectLoading: boolean;
}

export function CopyTab({
  config,
  updateConfig,
  setConfig,
  setCurrentStep,
  setVoiceSource,
  copyDiscoveryMode,
  setCopyDiscoveryMode,
  discoveryStep,
  setDiscoveryStep,
  discoveryAnswers,
  setDiscoveryAnswers,
  generatedPersona,
  onGeneratePersona,
  copyFieldsApplied,
  applyPersonaToCopy,
  setShowEditPersonaModal,
  applyAwarenessLevelChange,
  setPendingAwarenessLevel,
  setShowAwarenessChangeModal,
  hasUnsavedCopyChanges,
  setHasUnsavedCopyChanges,
  isSaving,
  currentProjectId,
  handleSaveProject,
  loading,
  handleGenerateCopy,
  isProjectLoading,
}: Props) {
  // Stand-in for the parent's `handleGeneratePersona` — kept here so the
  // discovery-flow JSX below reads natural without renaming.
  const handleGeneratePersona = onGeneratePersona;

  const sections = COPY_SECTIONS;
  const modes = COPY_MODES;
  const productInfo = config.copy?.productInfo as ProductInfo | null;

  const handleFillFromSource = async () => {
    if (!productInfo) return;
    const toastId = 'fill-from-source-copy';
    toast.loading('Preenchendo campos com IA...', { id: toastId });
    try {
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
    <div className="space-y-8 max-w-[1600px] mx-auto pb-20 overflow-x-hidden w-full">
      {/* Sticky fill-from-source button when productInfo exists */}
      {productInfo && (
        <div className="flex justify-end">
          <button
            onClick={handleFillFromSource}
            className="px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow flex items-center gap-2"
            title="Preenche todos os campos de Copy com base na Fonte do Produto"
          >
            <Sparkles size={14} />
            Preencher com fonte
          </button>
        </div>
      )}

      {/* Loading Overlay for project opening */}
      {isProjectLoading && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-white/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="flex flex-col items-center space-y-4">
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-sm font-black text-gray-900 uppercase tracking-widest italic">
              Carregando Projeto...
            </p>
          </div>
        </div>
      )}

      {copyDiscoveryMode === 'unknown' && !isProjectLoading && (
        <div className="flex flex-col items-center justify-center min-h-[400px] space-y-8 max-w-lg mx-auto text-center animate-in fade-in zoom-in duration-500">
          <div className="space-y-2">
            <h2 className="text-2xl font-black text-gray-900 uppercase tracking-tight">
              Antes de criar sua copy...
            </h2>
            <p className="text-sm text-gray-500">
              Precisamos saber quem vai assistir este vídeo. Isso garante uma copy muito mais
              eficaz.
            </p>
          </div>

          <div className="w-full space-y-3">
            <button
              onClick={() => {
                setCopyDiscoveryMode('known');
                setConfig((prev: any) => ({
                  ...prev,
                  copy: { ...prev.copy, discoveryMode: 'known' },
                }));
              }}
              className="w-full p-5 rounded-2xl border-2 border-gray-100 hover:border-blue-300 text-left transition-all bg-white group shadow-sm hover:shadow-md"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl group-hover:scale-110 transition-transform">✅</span>
                <div>
                  <p className="font-black text-gray-900 uppercase italic">
                    Já sei quem é meu cliente
                  </p>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                    Vou preencher as informações diretamente
                  </p>
                </div>
              </div>
            </button>

            <button
              onClick={() => {
                setCurrentStep('persona');
              }}
              className="w-full p-5 rounded-2xl border-2 border-gray-100 hover:border-blue-300 text-left transition-all bg-white group shadow-sm hover:shadow-md"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl group-hover:scale-110 transition-transform">🔍</span>
                <div>
                  <p className="font-black text-gray-900 uppercase italic">Me ajuda a descobrir</p>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                    A IA gera 3 personas com nível de consciência
                  </p>
                </div>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Card do Persona Ativo — só aparece no modo questions com persona selecionado */}
      {config.copy.mode === 'questions' &&
        config.copy?.answers?.selectedPersonaFull &&
        (() => {
          let activePersona: any = null;
          try {
            activePersona = JSON.parse(config.copy.answers.selectedPersonaFull);
          } catch (e) {
            return null;
          }
          return (
            <div className="bg-gradient-to-br from-blue-50 to-purple-50 border-4 border-blue-200 rounded-[40px] p-6 md:p-8 shadow-sm space-y-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white shrink-0">
                    <Users size={24} />
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">
                      Persona Ativo
                    </p>
                    <h4 className="text-xl font-black text-gray-900">{activePersona.name}</h4>
                  </div>
                </div>
                <span className="px-3 py-1 bg-blue-600 text-white rounded-full text-[10px] font-black uppercase tracking-widest">
                  Nível {activePersona.awarenessLevel}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="bg-white p-3 rounded-2xl border border-blue-100">
                  <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1">
                    Dor principal
                  </p>
                  <p className="text-gray-800 leading-snug">{activePersona.mainPain}</p>
                </div>
                <div className="bg-white p-3 rounded-2xl border border-blue-100">
                  <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1">
                    Desejo profundo
                  </p>
                  <p className="text-gray-800 leading-snug">{activePersona.hiddenDesire}</p>
                </div>
                <div className="bg-white p-3 rounded-2xl border border-blue-100">
                  <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1">
                    Objeção principal
                  </p>
                  <p className="text-gray-800 leading-snug">{activePersona.mainObjection}</p>
                </div>
                <div className="bg-white p-3 rounded-2xl border border-blue-100">
                  <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1">
                    Idade · Gênero
                  </p>
                  <p className="text-gray-800 leading-snug">
                    {activePersona.age} · {activePersona.gender}
                  </p>
                </div>
              </div>

              <div className="flex flex-col md:flex-row gap-3 pt-2">
                <button
                  onClick={() => setShowEditPersonaModal(true)}
                  className="flex-1 py-3 px-6 bg-white border-2 border-gray-200 text-gray-900 rounded-2xl font-black uppercase tracking-widest text-xs hover:border-blue-300 transition-all flex items-center justify-center gap-2"
                >
                  <Edit3 size={16} />
                  Editar Persona
                </button>
                <button
                  onClick={applyPersonaToCopy}
                  className="flex-1 py-3 px-6 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 flex items-center justify-center gap-2"
                >
                  <Sparkles size={16} />
                  {copyFieldsApplied ? 'Re-Atualizar Campos da Copy' : 'Atualizar Campos da Copy'}
                </button>
              </div>

              {!copyFieldsApplied && (
                <p className="text-center text-[10px] text-blue-700 font-bold uppercase tracking-widest">
                  Clique em "Atualizar Campos da Copy" para preencher os campos abaixo
                  automaticamente
                </p>
              )}
            </div>
          );
        })()}

      {copyDiscoveryMode === 'discovering' && (
        <div className="max-w-lg mx-auto space-y-6 animate-in fade-in slide-in-from-top-4 duration-500">
          {!generatedPersona && (
            <>
              {/* Barra de progresso */}
              <div className="flex gap-2 mb-8">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${
                      i <= discoveryStep ? 'bg-blue-600 shadow-sm shadow-blue-200' : 'bg-gray-100'
                    }`}
                  />
                ))}
              </div>

              {/* Perguntas sequenciais */}
              {[
                {
                  id: 'product',
                  label: 'Qual é o seu produto ou serviço?',
                  placeholder: 'Ex: Curso online de finanças pessoais para iniciantes',
                  hint: 'Descreva em uma frase clara o que você vende',
                },
                {
                  id: 'problem',
                  label: 'Qual problema ele resolve?',
                  placeholder:
                    'Ex: Pessoas que vivem no vermelho e não sabem por onde começar a organizar o dinheiro',
                  hint: 'Foque no problema real, não na solução',
                },
                {
                  id: 'result',
                  label: 'Qual resultado concreto ele entrega?',
                  placeholder: 'Ex: Em 30 dias a pessoa consegue quitar dívidas e começar a poupar',
                  hint: 'Seja específico — números e tempo ajudam',
                },
                {
                  id: 'customer',
                  label: 'Já vendeu para alguém? Descreva essa pessoa.',
                  placeholder:
                    'Ex: Mulher de 35 anos, trabalha como CLT, tem dois filhos, sempre no limite do cartão',
                  hint: 'Se nunca vendeu, descreva quem você imagina que compraria',
                },
                {
                  id: 'benefit',
                  label: 'Quem se beneficia MAIS do seu produto?',
                  placeholder:
                    'Ex: Pessoas entre 30-45 anos que ganham bem mas não conseguem guardar dinheiro',
                  hint: 'Pense em quem teria a maior transformação',
                },
              ].map(
                (q, idx) =>
                  discoveryStep === idx && (
                    <div
                      key={q.id}
                      className="bg-white p-10 rounded-[48px] border-4 border-gray-50 shadow-2xl space-y-6 animate-in fade-in zoom-in duration-500"
                    >
                      <div className="space-y-2">
                        <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest text-center">
                          Pergunta {idx + 1} de 5
                        </p>
                        <p className="text-xl font-black text-gray-900 text-center uppercase italic tracking-tight">
                          {q.label}
                        </p>
                        {q.hint && (
                          <p className="text-[10px] text-gray-400 font-bold uppercase text-center tracking-tighter">
                            {q.hint}
                          </p>
                        )}
                      </div>

                      <AutoResizeTextarea
                        className="w-full p-6 bg-gray-50 rounded-[32px] border-2 border-transparent focus:border-blue-400 focus:bg-white outline-none text-sm transition-all font-medium"
                        placeholder={q.placeholder}
                        value={discoveryAnswers[q.id] || ''}
                        onChange={(e: any) =>
                          setDiscoveryAnswers((prev: any) => ({
                            ...prev,
                            [q.id]: e.target.value,
                          }))
                        }
                        minHeight="150px"
                      />

                      <div className="flex gap-4 pt-4">
                        {idx > 0 && (
                          <button
                            onClick={() => setDiscoveryStep(idx - 1)}
                            className="px-8 py-4 rounded-2xl border-2 border-gray-100 text-[10px] font-black text-gray-400 uppercase tracking-widest hover:border-gray-200 hover:text-gray-600 transition-all"
                          >
                            Voltar
                          </button>
                        )}
                        <button
                          onClick={() => {
                            if (idx < 4) {
                              setDiscoveryStep(idx + 1);
                            } else {
                              // Última pergunta — gerar persona com IA
                              handleGeneratePersona(discoveryAnswers);
                            }
                          }}
                          disabled={!discoveryAnswers[q.id]?.trim() || loading}
                          className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-blue-700 transition-all shadow-xl shadow-blue-100 disabled:opacity-40 flex items-center justify-center gap-2"
                        >
                          {loading ? (
                            <Loader2 className="animate-spin" size={16} />
                          ) : idx < 4 ? (
                            'Próxima →'
                          ) : (
                            '✨ Descobrir meu cliente ideal'
                          )}
                        </button>
                      </div>
                    </div>
                  )
              )}
            </>
          )}
        </div>
      )}

      {(copyDiscoveryMode === 'known' || copyDiscoveryMode === 'done') && (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex flex-wrap gap-3 mb-8">
            {modes.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  const newMode = m.id as any;
                  if (config.copy.mode !== newMode) {
                    setConfig((prev: any) => ({
                      ...prev,
                      copy: {
                        ...prev.copy,
                        mode: newMode,
                        generatedScript: '',
                        optimizedScript: '',
                        finalScript: '',
                      },
                    }));
                    setHasUnsavedCopyChanges(false);
                  }
                }}
                className={`flex-1 min-w-[150px] p-6 rounded-3xl border-2 transition-all flex flex-col items-center gap-3 ${
                  config.copy.mode === m.id
                    ? 'border-blue-600 bg-blue-50 shadow-lg shadow-blue-50'
                    : 'border-gray-100 hover:border-gray-200 bg-white'
                }`}
              >
                <div
                  className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${
                    config.copy.mode === m.id
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-50 text-gray-400'
                  }`}
                >
                  <m.icon size={24} />
                </div>
                <span
                  className={`text-sm font-black uppercase tracking-tight ${config.copy.mode === m.id ? 'text-blue-900' : 'text-gray-500'}`}
                >
                  {m.label}
                </span>
              </button>
            ))}
          </div>

          {config.copy.mode === 'as-is' ? (
            !config.copy.generatedScript ? (
              <div className="space-y-6 animate-in fade-in duration-500">
                <div className="p-10 bg-white rounded-[48px] border-4 border-blue-50 shadow-2xl space-y-6">
                  <div className="space-y-2">
                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest ml-1">
                      Cole sua copy total aqui...
                    </label>
                    <AutoResizeTextarea
                      className="w-full p-8 rounded-[32px] border-2 border-gray-100 focus:border-blue-600 focus:ring-0 outline-none transition-all text-sm leading-relaxed bg-gray-50 font-medium"
                      placeholder="Cole sua copy aqui..."
                      value={config.copy.answers['pastedCopy'] || ''}
                      onChange={(e: any) => {
                        setConfig((prev: any) => ({
                          ...prev,
                          copy: {
                            ...prev.copy,
                            answers: {
                              ...prev.copy.answers,
                              pastedCopy: e.target.value,
                            },
                          },
                        }));
                      }}
                      minHeight="400px"
                    />
                  </div>

                  <button
                    onClick={() => {
                      const textoColado = config.copy.answers['pastedCopy'] || '';
                      setConfig((prev: any) => ({
                        ...prev,
                        copy: { ...prev.copy, generatedScript: textoColado },
                      }));
                      setHasUnsavedCopyChanges(false);
                      toast.success('Copy salva com sucesso!');
                    }}
                    disabled={(config.copy.answers['pastedCopy']?.length || 0) < 50}
                    className="w-full py-6 bg-blue-600 text-white rounded-[32px] font-black text-xl uppercase tracking-widest hover:bg-blue-700 transition-all shadow-2xl shadow-blue-100 disabled:opacity-40"
                  >
                    Salvar e continuar
                  </button>
                </div>
              </div>
            ) : null
          ) : config.copy.mode === 'improve' ? (
            <div className="p-8 bg-white rounded-[40px] border-4 border-blue-50 shadow-xl space-y-6">
              <div className="space-y-2">
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">
                  Cole sua copy existente
                </label>
                <AutoResizeTextarea
                  className="w-full p-6 rounded-3xl border-2 border-gray-100 focus:border-blue-600 focus:ring-0 outline-none transition-all text-sm leading-relaxed bg-gray-50 font-medium"
                  placeholder="Cole sua copy aqui..."
                  value={config.copy.answers['existingCopy'] || ''}
                  onChange={(e: any) => {
                    setConfig((prev: any) => ({
                      ...prev,
                      copy: {
                        ...prev.copy,
                        answers: {
                          ...prev.copy.answers,
                          existingCopy: e.target.value,
                        },
                      },
                    }));
                    setHasUnsavedCopyChanges(true);
                  }}
                  minHeight="300px"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-10">
              {/* SEÇÃO 1 — Sua Audiência */}
              <div className="space-y-6 bg-white p-8 rounded-[40px] border-2 border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 bg-blue-600 text-white rounded-xl flex items-center justify-center text-xs font-black">
                    1
                  </div>
                  <h4 className="font-black text-gray-900 text-lg tracking-tight uppercase">
                    1. Sua Audiência
                  </h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {(sections[0]?.questions || []).map((q) => {
                    const awarenessLevel = (config.copy.answers.awarenessLevel || '').toString();
                    if (q.id === 'painPoints' && awarenessLevel === '1') return null;
                    if (q.id === 'triedBefore' && awarenessLevel === '1') return null;
                    return (
                      <div key={q.id} className="space-y-2">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">
                          {q.label}
                        </label>
                        {q.type === 'multi-select' ? (
                          <div className="flex flex-wrap gap-2">
                            {(q.options || []).map((opt) => {
                              const isSelected = (config.copy.answers[q.id] || []).includes(opt);
                              return (
                                <button
                                  key={opt}
                                  onClick={() => {
                                    const current = config.copy.answers[q.id] || [];
                                    const next = isSelected
                                      ? current.filter((i: string) => i !== opt)
                                      : [...current, opt];
                                    updateConfig('copy', 'answers', q.id, next);
                                  }}
                                  className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border-2 ${
                                    isSelected
                                      ? 'bg-blue-600 border-blue-600 text-white shadow-md'
                                      : 'bg-white border-gray-100 text-gray-500 hover:border-gray-200'
                                  }`}
                                >
                                  {opt}
                                </button>
                              );
                            })}
                          </div>
                        ) : q.type === 'select' ? (
                          <div className="relative">
                            <select
                              className="w-full p-4 rounded-2xl border-2 border-gray-100 outline-none transition-all text-sm font-bold appearance-none bg-gray-50 focus:border-blue-600 focus:bg-white"
                              value={(config.copy.answers[q.id] as string) || ''}
                              onChange={(e) =>
                                updateConfig('copy', 'answers', q.id, e.target.value)
                              }
                            >
                              <option value="">Selecione...</option>
                              {(q.options || []).map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                            <ChevronDown
                              className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                              size={16}
                            />
                          </div>
                        ) : (
                          <AutoResizeTextarea
                            className="w-full p-4 rounded-2xl border-2 border-gray-100 focus:border-blue-600 focus:bg-white outline-none transition-all text-sm font-bold bg-gray-50"
                            placeholder={q.placeholder}
                            value={config.copy.answers[q.id] || ''}
                            onChange={(e: any) =>
                              updateConfig('copy', 'answers', q.id, e.target.value)
                            }
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* SEÇÃO 2 — Nível de consciência */}
              <div className="space-y-6 bg-white p-8 rounded-[40px] border-2 border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 bg-blue-600 text-white rounded-xl flex items-center justify-center text-xs font-black">
                    2
                  </div>
                  <h4 className="font-black text-gray-900 text-lg tracking-tight uppercase">
                    2. Nível de Consciência
                  </h4>
                </div>
                <div className="space-y-3">
                  {[
                    {
                      id: '1',
                      emoji: '🔴',
                      label: 'Inconsciente',
                      desc: 'Não sabe que tem o problema',
                    },
                    {
                      id: '2',
                      emoji: '🟠',
                      label: 'Consciente do Problema',
                      desc: 'Sabe que sofre mas não sabe a causa',
                    },
                    {
                      id: '3',
                      emoji: '🟡',
                      label: 'Consciente da Solução',
                      desc: 'Busca uma solução mas não sabe qual',
                    },
                    {
                      id: '4',
                      emoji: '🟢',
                      label: 'Consciente do Produto',
                      desc: 'Compara você com concorrentes',
                    },
                    {
                      id: '5',
                      emoji: '⚡',
                      label: 'Totalmente Consciente',
                      desc: 'Pronto para comprar',
                    },
                  ].map((nivel) => (
                    <button
                      key={nivel.id}
                      onClick={() => {
                        const hasGeneratedCopy = !!config.copy.generatedScript;
                        if (hasGeneratedCopy && config.copy.answers.awarenessLevel !== nivel.id) {
                          setPendingAwarenessLevel(nivel.id);
                          setShowAwarenessChangeModal(true);
                        } else {
                          applyAwarenessLevelChange(nivel.id);
                        }
                      }}
                      className={`w-full p-4 rounded-2xl border-2 text-left transition-all flex items-center gap-4 ${config.copy.answers.awarenessLevel === nivel.id ? 'border-blue-600 bg-blue-50 shadow-sm' : 'border-gray-50 hover:border-blue-100 bg-gray-50/30'}`}
                    >
                      <span className="text-2xl">{nivel.emoji}</span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-black text-gray-900 uppercase italic tracking-tight">
                            {nivel.label}
                          </p>
                          {config.copy.answers.discoveredPersona &&
                            JSON.parse(config.copy.answers.discoveredPersona || '{}')
                              .awarenessLevel === nivel.id && (
                              <span className="text-[9px] bg-blue-600 text-white font-black uppercase tracking-widest px-2 py-1 rounded-full shadow-lg shadow-blue-100 animate-pulse">
                                ⭐ Recomendado
                              </span>
                            )}
                        </div>
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">
                          {nivel.desc}
                        </p>
                      </div>
                      {config.copy.answers.awarenessLevel === nivel.id && (
                        <div className="w-3 h-3 bg-blue-600 rounded-full" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* SEÇÃO 3 — Configurações do Anúncio */}
              <div className="space-y-6 bg-white p-8 rounded-[40px] border-2 border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 bg-blue-600 text-white rounded-xl flex items-center justify-center text-xs font-black">
                    3
                  </div>
                  <h4 className="font-black text-gray-900 text-lg tracking-tight uppercase">
                    3. Configurações do Anúncio
                  </h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4 md:col-span-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1 flex items-center justify-between">
                      Estilo do Anúncio
                      <span className="text-[9px] bg-green-100 text-green-600 px-2 py-0.5 rounded-full">
                        RECOMENDADO
                      </span>
                    </label>
                    <div className="relative">
                      <select
                        className="w-full p-4 rounded-2xl border-2 border-gray-100 outline-none transition-all text-sm font-bold appearance-none bg-gray-50 focus:border-blue-600 focus:bg-white"
                        value={config.copy.answers.estiloAnuncio || ''}
                        onChange={(e) =>
                          updateConfig('copy', 'answers', 'estiloAnuncio', e.target.value)
                        }
                      >
                        <option value="">Selecione...</option>
                        {AD_STYLES.map((style: any) => {
                          const recs = getRecomendedEstilo(
                            config.copy.answers.awarenessLevel || ''
                          );
                          const isRec = recs.includes(style.label);
                          return (
                            <option key={style.id} value={style.label}>
                              {style.emoji} {style.label} {isRec ? '⭐ (Recomendado)' : ''}
                            </option>
                          );
                        })}
                      </select>
                      <ChevronDown
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                        size={16}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Outras Seções Mapeadas do Array Sections */}
              {(sections.slice(1) || []).map((section, sIdx) => {
                const isRecommended = (qId: string, val: string) => {
                  const answers = config.copy.answers;
                  const level = answers.awarenessLevel;
                  const levelChar = (level || '').charAt(0);
                  const estilo = answers.estiloAnuncio || '';

                  if (qId === 'angleIdea') {
                    if (levelChar === '1' || levelChar === '2')
                      return ['Não é culpa sua', 'Você está fazendo errado'].includes(val);
                    if (levelChar === '3')
                      return [
                        'Existe uma forma mais simples',
                        'O problema não é o que você pensa',
                      ].includes(val);
                    if (levelChar === '4' || levelChar === '5')
                      return ['Resultado imediato', 'A solução definitiva'].includes(val);
                  }

                  if (qId === 'emotion') {
                    const scores: Record<string, number> = {};
                    const addScore = (ems: string[], weight: number) => {
                      ems.forEach((e) => (scores[e] = (scores[e] || 0) + weight));
                    };

                    // 1. Nível de Consciência (Base - NOVAS REGRAS)
                    const baseMap: Record<string, string[]> = {
                      '1': ['Confusão', 'Desmotivação', 'Cansaço'],
                      '2': ['Frustração', 'Vergonha', 'Ansiedade', 'Medo de julgamento'],
                      '3': ['Esperança', 'Cansaço', 'Confusão', 'Desejo de controle'],
                      '4': ['Insegurança', 'Desejo de reconhecimento', 'Ambição'],
                      '5': ['Exclusividade', 'Alívio', 'Ambição'],
                    };
                    if (baseMap[levelChar]) addScore(baseMap[levelChar], 2);

                    // 2. Estilo do Anúncio (Multiplicador Forte)
                    const estiloLower = estilo.toLowerCase();

                    if (estiloLower.includes('problema'))
                      addScore(['Frustração', 'Ansiedade', 'Cansaço', 'Confusão'], 3);
                    if (estiloLower.includes('prova social'))
                      addScore(
                        ['Esperança', 'Alívio', 'Desejo de reconhecimento', 'Exclusividade'],
                        3
                      );
                    if (estiloLower.includes('urgência') || estiloLower.includes('escassez'))
                      addScore(['Ansiedade', 'Medo de julgamento', 'Desejo de controle'], 3);
                    if (estiloLower.includes('inspirador'))
                      addScore(['Esperança', 'Ambição', 'Alívio'], 3);
                    if (estiloLower.includes('curiosidade'))
                      addScore(['Confusão', 'Desejo de controle', 'Insegurança'], 3);
                    if (estiloLower.includes('storytelling'))
                      addScore(['Esperança', 'Frustração', 'Ansiedade', 'Alívio'], 3);

                    const topEmotions = Object.entries(scores)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 3) // Limitar a 2-3 emoções
                      .map((entry) => entry[0]);

                    return topEmotions.includes(val);
                  }

                  return false;
                };

                return (
                  <div
                    key={section.title}
                    className="space-y-6 bg-white p-8 rounded-[40px] border-2 border-gray-100 shadow-sm hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-8 h-8 bg-blue-600 text-white rounded-xl flex items-center justify-center text-xs font-black">
                        {sIdx + 4}
                      </div>
                      <h4 className="font-black text-gray-900 text-lg tracking-tight uppercase">
                        {sIdx + 4}. {section.title}
                      </h4>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {(section.questions || []).map((q: any) => {
                        if (q.condition && !q.condition(config.copy.answers)) return null;

                        return (
                          <div key={q.id} className="space-y-2">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1 flex items-center justify-between">
                              {q.label}
                              {q.type === 'select' &&
                                config.copy.answers[q.id] &&
                                isRecommended(q.id, config.copy.answers[q.id]) && (
                                  <span className="text-[9px] bg-green-100 text-green-600 px-2 py-0.5 rounded-full">
                                    Recomendado
                                  </span>
                                )}
                            </label>
                            {q.type === 'select' ? (
                              <div className="relative">
                                <select
                                  className="w-full p-4 rounded-2xl border-2 border-gray-100 outline-none transition-all text-sm font-bold appearance-none bg-gray-50 focus:border-blue-600 focus:bg-white"
                                  value={
                                    (config.copy.answers[
                                      q.id as keyof typeof config.copy.answers
                                    ] as string) || ''
                                  }
                                  onChange={(e) =>
                                    updateConfig('copy', 'answers', q.id, e.target.value)
                                  }
                                >
                                  <option value="">Selecione...</option>
                                  {(q.options || []).map((opt: string) => (
                                    <option key={opt} value={opt}>
                                      {opt} {isRecommended(q.id, opt) ? '⭐ (Recomendado)' : ''}
                                    </option>
                                  ))}
                                </select>
                                <ChevronDown
                                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                                  size={16}
                                />
                              </div>
                            ) : q.type === 'date' ? (
                              <input
                                type="date"
                                className="w-full p-4 rounded-2xl border-2 border-gray-100 focus:border-blue-600 focus:bg-white outline-none transition-all text-sm font-bold bg-gray-50 uppercase"
                                value={
                                  (config.copy.answers[
                                    q.id as keyof typeof config.copy.answers
                                  ] as string) || ''
                                }
                                onChange={(e) =>
                                  updateConfig('copy', 'answers', q.id, e.target.value)
                                }
                              />
                            ) : q.type === 'number' ? (
                              <input
                                type="number"
                                className="w-full p-4 rounded-2xl border-2 border-gray-100 focus:border-blue-600 focus:bg-white outline-none transition-all text-sm font-bold bg-gray-50"
                                placeholder={q.placeholder}
                                value={
                                  (config.copy.answers[
                                    q.id as keyof typeof config.copy.answers
                                  ] as string) || ''
                                }
                                onChange={(e) =>
                                  updateConfig('copy', 'answers', q.id, e.target.value)
                                }
                              />
                            ) : (
                              <AutoResizeTextarea
                                className="w-full p-4 rounded-2xl border-2 border-gray-100 focus:border-blue-600 focus:bg-white outline-none transition-all text-sm font-bold bg-gray-50"
                                placeholder={q.placeholder}
                                value={
                                  (config.copy.answers[
                                    q.id as keyof typeof config.copy.answers
                                  ] as string) || ''
                                }
                                onChange={(e: any) =>
                                  updateConfig('copy', 'answers', q.id, e.target.value)
                                }
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* SEÇÃO FINAL — Destino do Clique */}
              <div className="space-y-6 bg-white p-8 rounded-[40px] border-2 border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 bg-blue-600 text-white rounded-xl flex items-center justify-center text-xs font-black">
                    {sections.length + 3}
                  </div>
                  <h4 className="font-black text-gray-900 text-lg tracking-tight uppercase">
                    {sections.length + 3}. Destino do Clique
                  </h4>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">
                    Para onde vai ao clicar?
                  </label>
                  <div className="space-y-2">
                    {[
                      {
                        id: 'video',
                        emoji: '🎥',
                        label: 'Assistir a um vídeo explicativo',
                        desc: 'Ideal para público que ainda não te conhece',
                        levels: ['1', '2', '3'],
                      },
                      {
                        id: 'article',
                        emoji: '📄',
                        label: 'Ler um artigo ou conteúdo',
                        desc: 'Educa o público antes de vender',
                        levels: ['1', '2', '3'],
                      },
                      {
                        id: 'salespage',
                        emoji: '🛒',
                        label: 'Página de vendas direta',
                        desc: 'Para quem já conhece e está pronto',
                        levels: ['4', '5'],
                      },
                      {
                        id: 'whatsapp',
                        emoji: '💬',
                        label: 'WhatsApp ou formulário',
                        desc: 'Contato direto para qualificar',
                        levels: ['4'],
                      },
                      {
                        id: 'checkout',
                        emoji: '⚡',
                        label: 'Direto para o checkout',
                        desc: 'Compra imediata — remarketing',
                        levels: ['5'],
                      },
                    ].map((destino) => {
                      const currentLevel = (config.copy.answers.awarenessLevel || '').charAt(0);
                      const isRecommended = destino.levels.includes(currentLevel);
                      return (
                        <button
                          key={destino.id}
                          onClick={() =>
                            updateConfig('copy', 'answers', 'clickDestination', destino.id)
                          }
                          className={`w-full p-3 rounded-2xl border-2 text-left transition-all flex items-center gap-3 ${
                            config.copy.answers.clickDestination === destino.id
                              ? 'border-blue-600 bg-blue-50'
                              : 'border-gray-100 hover:border-blue-200'
                          }`}
                        >
                          <span className="text-xl">{destino.emoji}</span>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-bold text-gray-900">{destino.label}</p>
                              {isRecommended && (
                                <span className="text-[10px] bg-blue-100 text-blue-700 font-bold px-2 py-0.5 rounded-full">
                                  ⭐
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-gray-400">{destino.desc}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-3">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                      Outro destino (opcional)
                    </label>
                    <AutoResizeTextarea
                      placeholder="Escreva aqui se quiser um destino diferente..."
                      value={config.copy.answers.clickDestinationCustom || ''}
                      onChange={(e: any) =>
                        updateConfig('copy', 'answers', 'clickDestinationCustom', e.target.value)
                      }
                      className="w-full mt-1 p-3 bg-gray-50 rounded-xl border border-gray-100 text-sm outline-none focus:border-blue-400"
                    />
                  </div>
                </div>
              </div>

              {/* SEÇÃO — Estratégia da Copy */}
              <div className="space-y-6 bg-white p-8 rounded-[40px] border-2 border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 bg-blue-600 text-white rounded-xl flex items-center justify-center text-xs font-black">
                    {sections.length + 4}
                  </div>
                  <h4 className="font-black text-gray-900 text-lg tracking-tight uppercase">
                    {sections.length + 4}. Estratégia da Copy
                  </h4>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">
                    O ad vai vender ou só fazer o viewer clicar?
                  </label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {[
                      {
                        id: 'vsl-curiosity',
                        emoji: '🎯',
                        label: 'Criar curiosidade',
                        desc: 'Pro funil com VSL, webinar ou conteúdo longo. O ad só convence a clicar — quem vende é o vídeo.',
                        bullets: [
                          'Não revela produto / mecanismo',
                          'Sem garantia, preço ou oferta',
                          'Abre loop, fecha no vídeo',
                        ],
                      },
                      {
                        id: 'direct-sale',
                        emoji: '💰',
                        label: 'Vender no próprio ad',
                        desc: 'Pro funil direto: ad → página de vendas / checkout. O ad já apresenta o produto, mecanismo e oferta.',
                        bullets: [
                          'Apresenta produto e mecanismo',
                          'Pode usar prova social e garantia',
                          'Fecha com CTA direto',
                        ],
                      },
                    ].map((strat) => (
                      <button
                        key={strat.id}
                        onClick={() => updateConfig('copy', 'answers', 'copyStrategy', strat.id)}
                        className={`p-4 rounded-2xl border-2 text-left transition-all ${
                          config.copy.answers.copyStrategy === strat.id
                            ? 'border-blue-600 bg-blue-50'
                            : 'border-gray-100 hover:border-blue-200'
                        }`}
                      >
                        <div className="flex items-center gap-3 mb-2">
                          <span className="text-2xl">{strat.emoji}</span>
                          <p className="font-black text-gray-900 uppercase tracking-tight text-sm">
                            {strat.label}
                          </p>
                        </div>
                        <p className="text-[11px] text-gray-500 font-medium mb-3 leading-relaxed">
                          {strat.desc}
                        </p>
                        <ul className="space-y-1">
                          {strat.bullets.map((b) => (
                            <li
                              key={b}
                              className="text-[10px] text-gray-400 font-bold flex items-start gap-1.5"
                            >
                              <span className="text-blue-500 mt-0.5">•</span>
                              <span>{b}</span>
                            </li>
                          ))}
                        </ul>
                      </button>
                    ))}
                  </div>
                  {!config.copy.answers.copyStrategy && (
                    <p className="text-[10px] text-amber-600 font-bold uppercase tracking-widest mt-2 ml-1">
                      ⚠️ Sem escolha, usaremos os beats baseados no nível de consciência.
                    </p>
                  )}
                </div>
              </div>

              {/* SEÇÃO 9 — Call to Action */}
              <div className="space-y-6 bg-white p-8 rounded-[40px] border-2 border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 bg-blue-600 text-white rounded-xl flex items-center justify-center text-xs font-black">
                    {sections.length + 4}
                  </div>
                  <h4 className="font-black text-gray-900 text-lg tracking-tight uppercase">
                    {sections.length + 4}. Call to Action (CTA)
                  </h4>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">
                    Como o viewer deve agir ao final do anúncio?
                  </label>
                  <div className="space-y-3">
                    <button
                      onClick={() => updateConfig('copy', 'answers', 'ctaMode', 'auto')}
                      className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${
                        config.copy.answers.ctaMode === 'auto' || !config.copy.answers.ctaMode
                          ? 'border-blue-600 bg-blue-50'
                          : 'border-gray-100 hover:border-blue-200'
                      }`}
                    >
                      <p className="text-sm font-bold text-gray-900">✨ Deixar a IA criar o CTA</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        A IA vai criar o melhor CTA baseado no nível de consciência e destino do
                        clique
                      </p>
                    </button>

                    <button
                      onClick={() => updateConfig('copy', 'answers', 'ctaMode', 'custom')}
                      className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${
                        config.copy.answers.ctaMode === 'custom'
                          ? 'border-blue-600 bg-blue-50'
                          : 'border-gray-100 hover:border-blue-200'
                      }`}
                    >
                      <p className="text-sm font-bold text-gray-900">✏️ Escrever meu próprio CTA</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        Você controla exatamente o que será dito no final do anúncio
                      </p>
                    </button>

                    {config.copy.answers.ctaMode === 'custom' && (
                      <AutoResizeTextarea
                        placeholder='Ex: Clique no botão "Watch More" abaixo agora e assista ao vídeo completo...'
                        value={config.copy.answers.ctaCustom || ''}
                        onChange={(e: any) =>
                          updateConfig('copy', 'answers', 'ctaCustom', e.target.value)
                        }
                        className="w-full mt-1 p-3 bg-gray-50 rounded-xl border border-gray-100 text-sm outline-none focus:border-blue-400"
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {config.copy.mode !== 'as-is' && (
            <div className="bg-white p-8 rounded-[40px] border-2 border-gray-100 shadow-xl space-y-8 mt-12">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600">
                  <Maximize size={20} />
                </div>
                <div>
                  <h4 className="font-black text-gray-900 uppercase tracking-widest text-xs">
                    Tamanho do Roteiro
                  </h4>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                    Defina a extensão ideal para seu anúncio
                  </p>
                </div>
              </div>

              <div className="space-y-6">
                {getRecomendacaoTempo(config.copy.answers.awarenessLevel) && (
                  <div className="space-y-3 animate-in fade-in slide-in-from-top-4 duration-500">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="bg-green-600 text-white rounded-full p-1 shadow-md shadow-green-100">
                        <Star size={10} fill="currentColor" />
                      </div>
                      <span className="text-[10px] font-black text-green-600 uppercase tracking-widest">
                        Recomendado para o seu público
                      </span>
                    </div>
                    <div className="p-6 bg-blue-50/50 rounded-3xl border-2 border-blue-100 shadow-sm hover:shadow-md transition-all">
                      <h5 className="text-2xl font-black text-blue-900 mb-2">
                        {getRecomendacaoTempo(config.copy.answers.awarenessLevel)?.faixaSegundos}
                      </h5>
                      <p className="text-sm font-medium text-blue-800/70 leading-relaxed italic">
                        "{getRecomendacaoTempo(config.copy.answers.awarenessLevel)?.frase}"
                      </p>
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">
                    Selecione a Duração Alvo
                  </label>

                  <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                    {DURATION_OPTIONS.map((opt: any) => (
                      <button
                        key={opt.label}
                        onClick={() => {
                          setConfig((prev: any) => ({
                            ...prev,
                            copy: {
                              ...prev.copy,
                              targetWordCount: opt.words,
                            },
                          }));
                          setHasUnsavedCopyChanges(true);
                        }}
                        className={`py-3 px-1 rounded-xl border-2 transition-all text-xs font-black uppercase tracking-tighter ${
                          config.copy.targetWordCount === opt.words
                            ? 'border-blue-600 bg-blue-600 text-white shadow-lg shadow-blue-100 scale-105'
                            : 'border-gray-100 bg-gray-50 text-gray-600 hover:border-blue-200 hover:bg-white'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
                    <div className="flex items-center gap-3">
                      <p className="text-sm font-bold text-gray-600">
                        {config.copy.targetWordCount
                          ? `✍️ ${config.copy.targetWordCount} palavras`
                          : 'Dica: 150 palavras'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {config.copy.mode !== 'as-is' && (
            <div className="flex justify-center mt-12">
              <button
                onClick={handleGenerateCopy}
                disabled={loading}
                className="px-12 py-8 bg-blue-700 text-white rounded-[32px] font-black text-2xl flex items-center justify-center gap-4 shadow-2xl shadow-blue-500/30 hover:bg-blue-800 transition-all hover:scale-[1.02] active:scale-95 ring-8 ring-blue-500/10 border-4 border-blue-400/20 disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 className="animate-spin" size={32} />
                ) : (
                  <Sparkles size={32} className="animate-pulse" />
                )}
                {config.copy.generatedScript ? '✨ Regerar Copy com IA' : '✨ Gerar Copy com IA'}
              </button>
            </div>
          )}

          {config.copy.generatedScript && (
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-8 mt-16"
            >
              <div className="grid grid-cols-1 gap-6">
                {config.copy.finalScript && (
                  <div className="bg-green-50 p-6 rounded-[32px] border-2 border-green-100 flex items-center justify-between gap-6 animate-in fade-in slide-in-from-top-4 duration-500">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-green-600 text-white rounded-2xl">
                        <CheckCircle2 size={24} />
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-green-600 uppercase tracking-widest mb-1">
                          Cópia Final Salva
                        </p>
                        <p className="text-sm font-bold text-gray-900 line-clamp-1 opacity-70">
                          A copy completa com hook e script foi salva.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(config.copy.finalScript || '');
                        toast.success('Cópia copiada!');
                      }}
                      className="px-6 py-2 bg-white text-green-600 rounded-xl text-[10px] font-black uppercase tracking-widest border border-green-100 hover:bg-green-100 transition-all whitespace-nowrap"
                    >
                      Copiar
                    </button>
                  </div>
                )}

                {config.copy.generatedScript && (
                  <div className="bg-white p-8 rounded-[40px] border-2 border-gray-100 shadow-xl space-y-6">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Edit3 className="text-blue-600" size={20} />
                        <h4 className="font-black text-gray-900 uppercase tracking-widest text-xs">
                          Copy Original
                        </h4>
                      </div>
                      <button
                        onClick={() =>
                          setConfig((prev: any) => ({
                            ...prev,
                            copy: { ...prev.copy, generatedScript: '' },
                          }))
                        }
                        className="text-[10px] font-black text-red-500 hover:underline uppercase tracking-widest"
                      >
                        Limpar
                      </button>
                    </div>
                    <AutoResizeTextarea
                      className="w-full p-8 bg-gray-50 rounded-[32px] border-2 border-transparent focus:border-blue-600 focus:bg-white outline-none text-gray-700 leading-relaxed font-mono text-sm transition-all"
                      value={config.copy.generatedScript || ''}
                      onChange={(e: any) => {
                        setConfig((prev: any) => ({
                          ...prev,
                          copy: {
                            ...prev.copy,
                            generatedScript: e.target.value,
                            optimizedScript: '',
                          },
                        }));
                        setHasUnsavedCopyChanges(true);
                      }}
                      minHeight="300px"
                    />
                    {config.copy.generatedScript && (
                      <div className="text-xs text-gray-400 text-right mt-2">
                        ✍️ {countWords(config.copy.generatedScript)} palavras
                      </div>
                    )}

                    <div className="flex flex-col items-center gap-4 pt-4">
                      <div className="flex items-center gap-4 w-full">
                        <button
                          onClick={async () => {
                            try {
                              const selectedHookText = config.copy.hookSelecionado;
                              const generatedCopy = config.copy.generatedScript;
                              const finalScript = generatedCopy; // hook já está incluído pelo Claude

                              setConfig((prev: any) => ({
                                ...prev,
                                copy: {
                                  ...prev.copy,
                                  finalScript: finalScript,
                                },
                              }));

                              // Salvar no Firestore se o projeto existe
                              if (currentProjectId) {
                                await updateDoc(doc(db, 'projects', currentProjectId), {
                                  'config.copy.finalScript': finalScript,
                                  'config.copy.hookSelecionado': selectedHookText,
                                  updatedAt: serverTimestamp(),
                                });
                                // Also call the standard save logic to keep everything in sync
                                await handleSaveProject();
                              }

                              toast.success('Copy salva com sucesso!');
                            } catch (error) {
                              console.error('Erro ao salvar:', error);
                              toast.error('Erro ao salvar a copy');
                            }
                          }}
                          disabled={isSaving || !hasUnsavedCopyChanges}
                          className={`flex-1 py-4 rounded-2xl font-black text-sm uppercase tracking-widest flex items-center justify-center gap-3 transition-all shadow-lg ${
                            hasUnsavedCopyChanges
                              ? 'bg-green-600 text-white hover:bg-green-700 shadow-green-100'
                              : 'bg-gray-100 text-gray-400 cursor-not-allowed shadow-none'
                          }`}
                        >
                          {isSaving ? (
                            <Loader2 className="animate-spin" size={18} />
                          ) : (
                            <CheckCircle2 size={18} />
                          )}
                          Salvar
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {config.copy.generatedScript && !hasUnsavedCopyChanges && (
                  <div className="flex flex-wrap justify-center gap-4 pt-12">
                    <button
                      onClick={() => {
                        setVoiceSource('copy');
                        setCurrentStep('voz-premium');
                      }}
                      className="flex items-center gap-3 px-12 py-6 bg-gray-900 text-white rounded-[32px] font-black uppercase tracking-widest hover:bg-black transition-all shadow-2xl shadow-gray-200 group"
                    >
                      Configurar Voz do Anúncio
                      <ChevronRight
                        size={24}
                        className="group-hover:translate-x-1 transition-transform"
                      />
                    </button>
                    <button
                      onClick={() => {
                        setCurrentStep('hook-visual');
                      }}
                      className="flex items-center gap-3 px-12 py-6 bg-white text-gray-900 border-2 border-gray-900 rounded-[32px] font-black uppercase tracking-widest hover:bg-gray-100 transition-all shadow-2xl shadow-gray-200 group"
                    >
                      Gerar Hook Visual
                      <ChevronRight
                        size={24}
                        className="group-hover:translate-x-1 transition-transform"
                      />
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </div>
      )}
    </div>
  );
}
