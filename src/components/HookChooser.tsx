import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { toast } from 'react-hot-toast';
import {
  Search,
  CheckCircle2,
  Library,
  Check,
  Edit3,
  RotateCcw,
  Star,
  Sparkles,
  Loader2,
  History,
  Trash2,
} from 'lucide-react';
import hooksBibleEn from '@/data/hooksBible_en.json';
import hooksBiblePt from '@/data/hooksBible_pt.json';
import { chooseHooksFromCopy, type HookSelectionContext } from '@/lib/claudeService';

interface Props {
  language?: string;
  awarenessLevel?: string;
  approvedCopy?: string;
  hooksHistorico?: { hook: string; createdAt: string }[];
  onSaveHook?: (hook: string) => void;
  onDeleteHookFromHistory?: (hook: string) => void;
  // UX4: contexto rico vindo de Source/Persona/Plano. Quando presente,
  // a recomendação da IA usa esses dados pra escolher hooks aderentes
  // ao ângulo do criativo (não só ao texto da copy). Todos opcionais —
  // ausência cai no comportamento legacy de "só copy + awareness".
  selectionContext?: HookSelectionContext;
}

const HOOK_TYPES_BY_LEVEL: Record<string, string[]> = {
  '1': ['Surpresa / Choque', 'Curiosidade / Pergunta', 'Identificação'],
  '2': ['Identificação', 'Confissão / História', 'Quebra de Paradigma'],
  '3': ['Quebra de Paradigma', 'Contraste / Antes-Depois', 'Resultado / Promessa'],
  '4': ['Resultado / Promessa', 'Contraste / Antes-Depois', 'Surpresa / Choque'],
  '5': ['Resultado / Promessa', 'Urgência / Notícia', 'Humor / Absurdo'],
};

const ALL_HOOK_TYPES = [
  'Quebra de Paradigma',
  'Contraste / Antes-Depois',
  'Resultado / Promessa',
  'Identificação',
  'Confissão / História',
  'Surpresa / Choque',
  'Curiosidade / Pergunta',
  'Humor / Absurdo',
  'Urgência / Notícia',
];

const TONES = [
  { id: 'Direto' as const, label: 'Direto' },
  { id: 'Pergunta' as const, label: 'Pergunta' },
  { id: 'História' as const, label: 'História' },
  { id: 'Choque' as const, label: 'Choque' },
];

const getHooksBible = (language?: string) => {
  if (language === 'Português (Brasileiro)') {
    if (
      hooksBiblePt &&
      (hooksBiblePt as any).hooks &&
      Array.isArray((hooksBiblePt as any).hooks) &&
      (hooksBiblePt as any).hooks.length > 0
    ) {
      return hooksBiblePt as any;
    }
  }
  if (hooksBibleEn && (hooksBibleEn as any).hooks && Array.isArray((hooksBibleEn as any).hooks)) {
    return hooksBibleEn as any;
  }
  return { hooks: [], total: 0, idioma: 'en' };
};

const HookChooser: React.FC<Props> = ({
  language,
  awarenessLevel,
  approvedCopy = '',
  hooksHistorico = [],
  onSaveHook,
  onDeleteHookFromHistory,
  selectionContext,
}) => {
  const [search, setSearch] = useState('');
  const [tone, setTone] = useState<'Direto' | 'Pergunta' | 'História' | 'Choque' | 'Todos'>(
    'Todos'
  );
  const [levelFilters, setLevelFilters] = useState<number[]>([]);
  const [typeFilters, setTypeFilters] = useState<string[]>([]);
  const [chosenHook, setChosenHook] = useState<string>('');
  const [customHook, setCustomHook] = useState<string>('');
  const [isSaved, setIsSaved] = useState<boolean>(false);
  const [recommendedHookIds, setRecommendedHookIds] = useState<number[]>([]);
  const [isRecommending, setIsRecommending] = useState<boolean>(false);
  const [aiGeneratedGroups, setAiGeneratedGroups] = useState<{ type: string; hooks: any[] }[]>([]);
  const [activeBlock, setActiveBlock] = useState<'ai' | 'list' | 'custom' | null>(null);

  // Recommended types based on awareness level (the "stars" come from this)
  const recommendedTypes = useMemo(() => {
    const lvl = String(awarenessLevel || '').split('-')[0] ?? '';
    return HOOK_TYPES_BY_LEVEL[lvl] || [];
  }, [awarenessLevel]);

  const projectLevel = useMemo(() => {
    const lvl = String(awarenessLevel || '').split('-')[0] ?? '';
    return parseInt(lvl) || 0;
  }, [awarenessLevel]);

  // Não pré-popular chosenHook do savedHook — usuário começa sempre vazio.
  // O savedHook fica salvo no projeto e aparece no histórico abaixo.

  // (auto-seleção de filtros removida intencionalmente — usuário deve escolher manualmente)

  const bible = useMemo(() => getHooksBible(language), [language]);
  const allHooks = bible.hooks || [];

  // Filtragem para OPÇÃO 3 (Dropdown/Busca) — depende de Busca e Tom.
  const dropdownSet = useMemo(() => {
    let working = allHooks;
    if (search) {
      working = working.filter((h: any) =>
        h?.template?.toLowerCase()?.includes(search.toLowerCase())
      );
    }
    if (tone !== 'Todos') {
      if (tone === 'Pergunta') working = working.filter((h: any) => h?.template?.endsWith('?'));
      else if (tone === 'História')
        working = working.filter((h: any) => h.tipo === 'Confissão / História');
      else if (tone === 'Choque')
        working = working.filter((h: any) => h.tipo === 'Surpresa / Choque');
      else if (tone === 'Direto')
        working = working.filter(
          (h: any) =>
            h?.template &&
            !h.template.endsWith('?') &&
            h.tipo !== 'Confissão / História' &&
            h.tipo !== 'Surpresa / Choque'
        );
    }
    return working;
  }, [allHooks, search, tone]);

  const handleAIRecommend = async () => {
    if (!approvedCopy) {
      toast.error('A copy aprovada não está disponível. Volte à etapa anterior.');
      return;
    }
    if (!awarenessLevel) {
      toast.error('Defina o nível de consciência na etapa anterior.');
      return;
    }
    setIsRecommending(true);
    try {
      // Build candidates: top 15 per recommended type, filtered by level
      const lvlStr = String(awarenessLevel).split('-')[0] ?? '';
      const lvlNum = parseInt(lvlStr) || 3;
      const filteredByLevel = allHooks.filter(
        (h: any) => Array.isArray(h.niveis) && h.niveis.includes(lvlNum)
      );
      const candidates: any[] = [];
      recommendedTypes.forEach((t) => {
        const typeHooks = filteredByLevel.filter((h: any) => h.tipo === t).slice(0, 15);
        candidates.push(...typeHooks);
      });

      // Pré-selecionar os filtros da Opção 2 com o nível e tipos que geraram os 9 hooks
      setLevelFilters([lvlNum]);
      setTypeFilters(recommendedTypes);

      if (candidates.length === 0) {
        toast.error('Nenhum candidato disponível para esse nível de consciência.');
        setIsRecommending(false);
        return;
      }

      const result = await chooseHooksFromCopy(
        approvedCopy,
        String(awarenessLevel),
        candidates,
        selectionContext
      );
      if (result && result.grupos) {
        const recIds: number[] = [];
        const newGroups: { type: string; hooks: any[] }[] = [];
        result.grupos.forEach((grp: any) => {
          const hooksForGroup: any[] = [];
          (grp.hooks || []).forEach((h: any) => {
            const fullHook = candidates.find((c: any) => c.id === h.id);
            if (fullHook) {
              // UX10: merge `filled` text vindo da IA (versão preenchida sem
              // placeholders) com o template original. Se a IA não retornou
              // filled — fallback pro template (comportamento legacy).
              const filledRaw: string | undefined =
                typeof h.filled === 'string' && h.filled.trim() ? h.filled.trim() : undefined;
              // Se ainda restam placeholders evidentes no filled (___ ou [X]),
              // tratamos como falha e caímos pro template — evita mostrar
              // "Here's what no one tells you about ___" como se fosse pronto.
              const hasPlaceholders = filledRaw
                ? /(_{2,}|\[[a-zA-Zçãâáéíóôúû_ ]{2,}\])/.test(filledRaw)
                : true;
              const filled = filledRaw && !hasPlaceholders ? filledRaw : null;
              hooksForGroup.push({ ...fullHook, filled });
              if (h.recomendado) recIds.push(fullHook.id);
            }
          });
          if (hooksForGroup.length > 0) newGroups.push({ type: grp.tipo, hooks: hooksForGroup });
        });
        setRecommendedHookIds(recIds);
        setAiGeneratedGroups(newGroups);
        toast.success('9 hooks gerados e preenchidos pela IA!');
      } else {
        toast.error('A IA não conseguiu analisar. Tente novamente.');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao consultar a IA.');
    } finally {
      setIsRecommending(false);
    }
  };

  const handlePickHook = (text: string, fromBlock?: 'ai' | 'list' | 'custom') => {
    if (fromBlock && activeBlock !== fromBlock) {
      toast.error('Marque o checkbox deste bloco para usá-lo.');
      return;
    }
    if (chosenHook === text) {
      setChosenHook('');
      setIsSaved(false);
      return;
    }
    setChosenHook(text);
    if (fromBlock !== 'custom') setCustomHook('');
    setIsSaved(false);
  };

  const handleSave = () => {
    if (!chosenHook.trim()) {
      toast.error('Escolha ou escreva um hook antes de salvar.');
      return;
    }
    onSaveHook?.(chosenHook.trim());
    setIsSaved(true);
    toast.success('Hook salvo!');
  };

  const handleReset = () => {
    setChosenHook('');
    setCustomHook('');
    setIsSaved(false);
  };

  // BlockCheckbox is defined at module scope below to keep React happy
  // (creating components during render triggers cascading re-renders).
  const renderBlockCheckbox = (blockId: 'ai' | 'list' | 'custom', label: string) => (
    <BlockCheckbox
      blockId={blockId}
      label={label}
      isActive={activeBlock === blockId}
      onToggle={() => {
        if (activeBlock === blockId) {
          setActiveBlock(null);
        } else {
          setActiveBlock(blockId);
        }
        setChosenHook('');
        setIsSaved(false);
      }}
    />
  );

  return (
    <div className="space-y-8">
      {/* ─── TOPO: COPY APROVADA (read-only) ─── */}
      {approvedCopy ? (
        <div className="bg-blue-50 dark:bg-blue-950/40 rounded-3xl border-2 border-blue-200 p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <div className="bg-blue-600 p-1.5 rounded-lg text-white">
              <Library size={16} />
            </div>
            <h3 className="text-sm font-black text-blue-900 dark:text-blue-200 uppercase tracking-widest">
              Copy Aprovada
            </h3>
            <span className="text-xs text-blue-600 dark:text-blue-400 ml-auto">
              vinda da etapa anterior
            </span>
          </div>
          <div className="bg-white dark:bg-gray-900/80 rounded-2xl p-5 max-h-72 overflow-y-auto border border-blue-100 dark:border-blue-900">
            <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
              {approvedCopy}
            </p>
          </div>
          <p className="text-[10px] text-blue-600 dark:text-blue-400/70 mt-2 italic">
            Para editar a copy, volte para a etapa de Copywriting.
          </p>
        </div>
      ) : (
        <div className="bg-orange-50 dark:bg-orange-950/30 rounded-3xl border-2 border-orange-200 dark:border-orange-800/60 p-6 text-center">
          <p className="text-sm text-orange-700 font-bold">
            Nenhuma copy aprovada. Volte à aba Copywriting e gere uma copy primeiro.
          </p>
        </div>
      )}

      {/* ─── BOTÃO: ANALISAR COPY E GERAR HOOKS ─── */}
      {approvedCopy && (
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={handleAIRecommend}
            disabled={isRecommending}
            className="px-12 py-5 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-2xl font-black uppercase tracking-widest hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 transition-all shadow-xl shadow-purple-100 flex items-center gap-3 text-base"
          >
            {isRecommending ? (
              <Loader2 className="animate-spin" size={20} />
            ) : (
              <Sparkles size={20} />
            )}
            {isRecommending ? 'Analisando copy e gerando hooks...' : 'Analisar Copy e Gerar Hooks'}
          </button>
          {/* UX4: indicador de contexto rico. Quando productInfo/persona/brief
              chegam aqui (subprojeto criado a partir de um brief no Plano),
              a IA usa esses dados pra escolher hooks aderentes ao ângulo —
              não só ao texto cru da copy. Mostramos o que está conectado
              pro user saber que está enriquecido. */}
          {selectionContext &&
            (() => {
              const tags: string[] = [];
              if (
                selectionContext.productInfo?.produto ||
                selectionContext.productInfo?.dorPrincipal
              )
                tags.push('produto');
              if (selectionContext.persona?.mainPain || selectionContext.persona?.name)
                tags.push('persona');
              if (selectionContext.brief?.angle || selectionContext.brief?.emotion)
                tags.push('ângulo do plano');
              if (tags.length === 0) return null;
              return (
                <p className="text-[10px] font-bold uppercase tracking-widest text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
                  <Sparkles size={10} />
                  IA também usando: {tags.join(' · ')}
                </p>
              );
            })()}
        </div>
      )}

      {/* ─── BLOCO 1: HOOKS GERADOS PELA IA + FILTROS ─── */}
      {aiGeneratedGroups.length > 0 && (
        <div
          className={`bg-white dark:bg-gray-900/80 rounded-3xl border-2 p-6 shadow-sm transition-all ${activeBlock === 'ai' ? 'border-blue-500 shadow-lg ring-2 ring-blue-100' : 'border-gray-200 dark:border-gray-800 opacity-90'}`}
        >
          <div className="flex items-center gap-2 mb-4">
            <div className="bg-purple-600 p-1.5 rounded-lg text-white">
              <Sparkles size={16} />
            </div>
            <h3 className="text-sm font-black text-gray-900 dark:text-gray-50 uppercase tracking-widest flex-1">
              Opção 1: Hooks Recomendados pela IA
            </h3>
            {renderBlockCheckbox('ai', 'Usar este bloco')}
          </div>

          {/* Filtros pré-selecionados (visualização do que foi usado) */}
          <div className="mb-4 p-4 bg-purple-50 dark:bg-purple-950/40 rounded-2xl border border-purple-100">
            <p className="text-[10px] font-black text-purple-700 dark:text-purple-300 uppercase tracking-widest mb-3">
              Filtros usados para gerar os 9 hooks
            </p>
            <div className="mb-3">
              <p className="text-[9px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1">
                Nível de Consciência
              </p>
              <div className="flex gap-1.5">
                {[1, 2, 3, 4, 5].map((lvl) => {
                  const active = levelFilters.includes(lvl);
                  const showStar = lvl === projectLevel;
                  return (
                    <div
                      key={`ai-lvl-${lvl}`}
                      className={`relative w-9 h-9 rounded-lg font-black text-xs flex items-center justify-center gap-0.5 ${active ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'}`}
                    >
                      {lvl}
                      {showStar && <span className="text-[8px]">⭐</span>}
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-[9px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest">
                  Tipos de Hook
                </p>
                <p className="text-[9px] text-amber-600 dark:text-amber-400 font-bold">
                  ⭐ = recomendado pelo nível
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ALL_HOOK_TYPES.map((t) => {
                  const active = typeFilters.includes(t);
                  const showStar = recommendedTypes.includes(t);
                  return (
                    <div
                      key={`ai-type-${t}`}
                      className={`relative px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest flex items-center gap-1 ${active ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'}`}
                    >
                      <span>{t}</span>
                      {showStar && <span className="text-[8px]">⭐</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            {aiGeneratedGroups.map((g, gIdx) => (
              <div key={`ai-group-${g.type}-${gIdx}`} className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-4 bg-purple-600 rounded-full"></div>
                  <span className="text-[10px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest">
                    Grupo {gIdx + 1}: {g.type}
                  </span>
                </div>
                <div className="space-y-2">
                  {g.hooks.map((h: any, hIdx: number) => {
                    // UX10: usa `filled` (preenchido pela IA) como texto
                    // principal e clicável. Fallback pro template quando
                    // filled não chegou (rede ruim) ou veio com placeholders
                    // restantes. Template original fica como subtitle.
                    const displayText: string = h.filled || h.template;
                    const hasFilled = !!h.filled && h.filled !== h.template;
                    const isSelected = chosenHook === displayText && activeBlock === 'ai';
                    const isHookRecommended = recommendedHookIds.includes(h.id);
                    const isDisabled = activeBlock !== 'ai';
                    return (
                      <button
                        key={`ai-hook-${h.id}-${hIdx}`}
                        onClick={() => handlePickHook(displayText, 'ai')}
                        disabled={isDisabled}
                        className={`w-full text-left p-5 rounded-3xl border-2 transition-all relative ${
                          isSelected
                            ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 shadow-lg ring-2 ring-blue-100'
                            : isDisabled
                              ? 'border-gray-50 bg-gray-50/50 dark:bg-gray-800/60 cursor-not-allowed opacity-60'
                              : 'border-gray-50 bg-gray-50 dark:bg-gray-800/60 hover:border-blue-200 hover:bg-white dark:hover:bg-gray-900/80'
                        }`}
                      >
                        <div className="flex items-start gap-4">
                          <div
                            className={`mt-1 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all flex-shrink-0 ${
                              isSelected
                                ? 'bg-blue-600 border-blue-600'
                                : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/80'
                            }`}
                          >
                            {isSelected && (
                              <div className="w-2 h-2 bg-white dark:bg-gray-900/80 rounded-full"></div>
                            )}
                          </div>
                          <div className="flex-1 pr-16 space-y-1.5">
                            <p
                              className={`text-sm font-bold leading-relaxed ${isSelected ? 'text-blue-900' : 'text-gray-700 dark:text-gray-300'}`}
                            >
                              {displayText}
                            </p>
                            {hasFilled && (
                              // Mostra o template original em italico cinza
                              // pequeno — user entende a "fórmula" que foi
                              // preenchida. Hover no template não muda nada,
                              // só visual.
                              <p className="text-[10px] italic text-gray-400 dark:text-gray-500 leading-relaxed">
                                Estrutura: {h.template}
                              </p>
                            )}
                          </div>
                        </div>
                        {isHookRecommended && (
                          <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1 bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 px-3 py-1.5 rounded-xl border border-amber-200 shadow-sm">
                            <Star size={12} fill="currentColor" />
                            <span className="text-[10px] font-black uppercase tracking-tighter">
                              Recomendado
                            </span>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── BLOCO 2: BUSCAR PELA LISTA COMPLETA ─── */}
      <div
        className={`bg-white dark:bg-gray-900/80 rounded-3xl border-2 p-6 shadow-sm transition-all ${activeBlock === 'list' ? 'border-blue-500 shadow-lg ring-2 ring-blue-100' : 'border-gray-200 dark:border-gray-800 opacity-90'}`}
      >
        <div className="flex items-center gap-2 mb-4">
          <div className="bg-purple-600 p-1.5 rounded-lg text-white">
            <Search size={16} />
          </div>
          <h3 className="text-sm font-black text-gray-900 dark:text-gray-50 uppercase tracking-widest flex-1">
            Opção 2: Buscar pela Lista Completa
          </h3>
          {renderBlockCheckbox('list', 'Usar este bloco')}
        </div>

        <div className="flex items-center gap-2 mb-4">
          <Search size={14} className="text-gray-400 dark:text-gray-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar hook por palavra-chave..."
            className="flex-1 text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400"
          />
        </div>

        {/* Tom */}
        <div className="mb-4">
          <p className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">
            Tom do Hook
          </p>
          <div className="flex flex-wrap gap-2">
            {TONES.map((t) => {
              const active = tone === t.id;
              return (
                <button
                  key={`opt3-tone-${t.id}`}
                  onClick={() => setTone(active ? 'Todos' : t.id)}
                  className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition ${active ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200'}`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* DROPDOWN */}
        <div className="mb-2">
          <p className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">
            Selecione um Hook ({dropdownSet.length}{' '}
            {dropdownSet.length === 1 ? 'disponível' : 'disponíveis'})
          </p>
          <select
            value=""
            disabled={activeBlock !== 'list'}
            onChange={(e) => {
              const idx = parseInt(e.target.value);
              if (!isNaN(idx) && dropdownSet[idx]) {
                handlePickHook(dropdownSet[idx].template, 'list');
                setTimeout(() => {
                  if (typeof window !== 'undefined') {
                    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
                  }
                }, 100);
              }
            }}
            className="w-full text-sm border-2 border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 bg-white dark:bg-gray-900/80 focus:outline-none focus:border-blue-400 cursor-pointer disabled:bg-gray-100 dark:bg-gray-800 disabled:cursor-not-allowed"
          >
            <option value="">— Escolha um hook da lista —</option>
            {dropdownSet.map((h: any, i: number) => (
              <option key={`drop-${h.id || i}-${i}`} value={i}>
                [{h.tipo}]{' '}
                {h.template.length > 80 ? h.template.substring(0, 80) + '...' : h.template}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2 italic">
            Ao selecionar um hook, ele vai direto para o card "Hook Final" abaixo.
          </p>
        </div>
      </div>

      {/* ─── BLOCO 3: HOOK CUSTOMIZADO ─── */}
      <div
        className={`bg-white dark:bg-gray-900/80 rounded-3xl border-2 p-6 shadow-sm transition-all ${activeBlock === 'custom' ? 'border-blue-500 shadow-lg ring-2 ring-blue-100' : 'border-gray-200 dark:border-gray-800 opacity-90'}`}
      >
        <div className="flex items-center gap-2 mb-4">
          <div className="bg-purple-600 p-1.5 rounded-lg text-white">
            <Edit3 size={16} />
          </div>
          <h3 className="text-sm font-black text-gray-900 dark:text-gray-50 uppercase tracking-widest flex-1">
            Opção 3: Escreva seu próprio hook
          </h3>
          {renderBlockCheckbox('custom', 'Usar este bloco')}
        </div>
        <div className="flex gap-2">
          <input
            value={customHook}
            onChange={(e) => setCustomHook(e.target.value)}
            disabled={activeBlock !== 'custom'}
            placeholder="Escreva seu hook aqui..."
            className="flex-1 text-sm border-2 border-gray-200 dark:border-gray-800 rounded-xl px-4 py-3 focus:outline-none focus:border-blue-400 disabled:bg-gray-100 dark:bg-gray-800 disabled:cursor-not-allowed"
          />
          <button
            onClick={() => {
              const t = customHook.trim();
              if (!t) {
                toast.error('Escreva um hook antes.');
                return;
              }
              setChosenHook(t);
              setIsSaved(false);
            }}
            disabled={activeBlock !== 'custom'}
            className="px-5 py-3 bg-gray-900 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-black transition disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            Usar
          </button>
        </div>
      </div>

      {/* ─── HISTÓRICO DE HOOKS SALVOS ─── */}
      {hooksHistorico && hooksHistorico.length > 0 && (
        <div className="bg-white dark:bg-gray-900/80 rounded-3xl border-2 border-gray-200 dark:border-gray-800 p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <div className="bg-gray-700 p-1.5 rounded-lg text-white">
              <History size={16} />
            </div>
            <h3 className="text-sm font-black text-gray-900 dark:text-gray-50 uppercase tracking-widest">
              Hooks Salvos Anteriormente
            </h3>
            <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">
              {hooksHistorico.length} no histórico
            </span>
          </div>
          <div className="space-y-2 max-h-80 overflow-y-auto pr-2">
            {hooksHistorico.map((item, idx) => {
              const isSelected = chosenHook === item.hook;
              const date = new Date(item.createdAt);
              const dateStr = date.toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              });
              return (
                <div
                  key={`hist-${idx}`}
                  className={`group p-4 rounded-2xl border-2 transition-all ${isSelected ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40' : 'border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 hover:border-blue-200'}`}
                >
                  <div className="flex items-start gap-3">
                    <button onClick={() => handlePickHook(item.hook)} className="flex-1 text-left">
                      <p
                        className={`text-sm font-bold leading-relaxed ${isSelected ? 'text-blue-900' : 'text-gray-700 dark:text-gray-300'}`}
                      >
                        {item.hook}
                      </p>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                        Salvo em {dateStr}
                      </p>
                    </button>
                    {onDeleteHookFromHistory && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm('Remover este hook do histórico?')) {
                            onDeleteHookFromHistory(item.hook);
                          }
                        }}
                        className="opacity-0 group-hover:opacity-100 p-2 text-gray-400 dark:text-gray-500 hover:text-red-500 transition-all"
                        title="Remover do histórico"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── HOOK FINAL / SALVAR ─── */}
      {chosenHook && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-blue-600 rounded-3xl p-6 shadow-xl text-white sticky bottom-4 z-10"
        >
          <p className="text-[10px] font-black uppercase tracking-widest text-white/70 mb-2">
            🔵 Hook Final
          </p>
          <input
            value={chosenHook}
            onChange={(e) => {
              setChosenHook(e.target.value);
              setIsSaved(false);
            }}
            className="w-full bg-transparent text-xl font-bold text-white border-b-2 border-white/30 focus:border-white outline-none pb-2"
          />
          <div className="flex items-center justify-between gap-3 mt-5">
            <button
              onClick={handleReset}
              className="text-xs text-white/70 font-bold uppercase tracking-widest flex items-center gap-2 hover:text-white"
            >
              <RotateCcw size={14} /> Limpar
            </button>
            <button
              onClick={handleSave}
              disabled={isSaved}
              className={`px-6 py-3 rounded-xl font-black text-xs uppercase tracking-widest flex items-center gap-2 transition ${isSaved ? 'bg-green-600 text-white' : 'bg-white dark:bg-gray-900/80 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40'}`}
            >
              {isSaved ? <CheckCircle2 size={16} /> : <Check size={16} />}
              {isSaved ? 'Hook salvo' : 'Salvar Hook'}
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
};

// Module-scope component so React doesn't see it being created during
// each render of HookChooser (which would trigger cascading re-renders).
function BlockCheckbox({
  label,
  isActive,
  onToggle,
}: {
  blockId: 'ai' | 'list' | 'custom';
  label: string;
  isActive: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition border-2 ${
        isActive
          ? 'bg-blue-600 border-blue-600 text-white shadow-md'
          : 'bg-white dark:bg-gray-900/80 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-blue-300'
      }`}
    >
      <div
        className={`w-4 h-4 rounded-md border-2 flex items-center justify-center transition ${
          isActive ? 'bg-white dark:bg-gray-900/80 border-white' : 'border-gray-300'
        }`}
      >
        {isActive && <Check size={12} className="text-blue-600 dark:text-blue-400" />}
      </div>
      {label}
    </button>
  );
}

export default HookChooser;
