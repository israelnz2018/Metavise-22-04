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

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { AutoResizeTextarea } from '@/components/AutoResizeTextarea';
import { CopySkillsButton } from '@/components/CopySkillsButton';
import {
  AD_STYLES,
  DURATION_OPTIONS,
  VSL_DURATION_OPTIONS,
  PERSONA_CATEGORY_OPTIONS,
  PERSONA_URGENCY_OPTIONS,
  PERSONA_DIFFERENTIAL_OPTIONS,
  PERSONA_TRIED_BEFORE_OPTIONS,
  PERSONA_PAYING_CAPACITY_OPTIONS,
  PERSONA_HIDDEN_DESIRE_OPTIONS,
  COPY_SECTIONS,
  COPY_MODES,
} from '@/lib/constants';
import {
  personaFromProduct,
  rewriteSafeCopy,
  critiqueAndRewriteCopy,
  generateAdCopyVariants,
  analyzeCopyForLibrary,
  describeDestinationFromProduct,
  reframeAudienceForLevel,
  preflightCheckCopy,
  detectHallucinations,
  detectNamedAuthorities,
  findStatistics,
  generateNarrator,
  generateInnovativeName,
  type ProductInfo,
  type HallucinationFlag,
  type AuthorityAnchor,
  type StatisticFinding,
} from '@/lib/claudeService';
// UX25-A2 + A3: pre-flight check + hallucination banner
import { PreflightCheckPanel, HallucinationBanner, AuthorityAnchorBanner } from '@/components/CopyQualityPanels';
import { getRecomendedEstilo, getRecomendacaoTempo, countWords } from '@/lib/helpers';
// UX13: content risk scanner — detecta medicamentos concorrentes, slurs,
// celebridades, alegações médicas. Banner aparece acima da textarea da
// copy gerada quando há detecção.
import { scanForRisks } from '@/lib/contentRiskScanner';
import { ContentRiskBanner } from '@/components/ContentRiskBanner';
import { CATEGORY_LABELS } from '@/data/contentRiskTerms';
// UX16: editor beat-by-beat (regenera só 1 beat, não a copy inteira)
import { ScriptBeatEditor } from '@/components/ScriptBeatEditor';
import { parseScriptBeats } from '@/lib/claudeService';
import { CopywriterChat } from '@/components/CopywriterChat';
// UX18: biblioteca pessoal de copies
import {
  loadPersonalLibrary,
  addToPersonalLibrary,
  toggleStarPersonalCopy,
  deletePersonalCopy,
  type PersonalCopyDoc,
} from '@/lib/personalCopyLibrary';
import { CopyLibraryModal } from '@/components/CopyLibraryModal';
import { inferVertical } from '@/data/copyLibrary';
import { auth } from '@/lib/firebase';
import { Library, BookmarkPlus } from 'lucide-react';
// UX23-E/F: painel de similaridade + modal de "Ver referências usadas"
import ReferenceSimilarityPanel from '@/components/ReferenceSimilarityPanel';
import LastUsedReferencesModal from '@/components/LastUsedReferencesModal';
import type { LastUsedReference } from '@/components/ReferenceSimilarityPanel';
// UX25-C1: debug modal "Ver prompt enviado ao Claude"
import DebugPromptModal from '@/components/DebugPromptModal';
import { Terminal, Zap, History } from 'lucide-react';
// UX25-B2: modal de histórico das últimas 5 gerações
import CopyHistoryModal from '@/components/CopyHistoryModal';
import type { CopyHistoryEntry } from '@/components/CopyHistoryModal';
// UX25-B3: modal de comparação A vs B com diff highlight
import VariantCompareModal from '@/components/VariantCompareModal';

// Recomendação de ângulo/emoção. Usada em DOIS lugares: (1) auto-preencher
// esses campos ao abrir a aba e (2) marcar o badge "Recomendado" no form.
// Mesma fonte pros dois — o valor auto-selecionado sempre bate com o badge.
function recommendedAnglesFor(level: string): string[] {
  const c = (level || '').charAt(0);
  if (c === '1' || c === '2') return ['Não é culpa sua', 'Você está fazendo errado'];
  if (c === '3') return ['Existe uma forma mais simples', 'O problema não é o que você pensa'];
  if (c === '4' || c === '5') return ['Resultado imediato', 'A solução definitiva'];
  return [];
}

function recommendedEmotionsFor(level: string, estilo: string): string[] {
  const c = (level || '').charAt(0);
  const scores: Record<string, number> = {};
  const addScore = (ems: string[], weight: number) => {
    ems.forEach((e) => (scores[e] = (scores[e] || 0) + weight));
  };
  const baseMap: Record<string, string[]> = {
    '1': ['Confusão', 'Desmotivação', 'Cansaço'],
    '2': ['Frustração', 'Vergonha', 'Ansiedade', 'Medo de julgamento'],
    '3': ['Esperança', 'Cansaço', 'Confusão', 'Desejo de controle'],
    '4': ['Insegurança', 'Desejo de reconhecimento', 'Ambição'],
    '5': ['Exclusividade', 'Alívio', 'Ambição'],
  };
  if (baseMap[c]) addScore(baseMap[c], 2);
  const estiloLower = (estilo || '').toLowerCase();
  if (estiloLower.includes('problema'))
    addScore(['Frustração', 'Ansiedade', 'Cansaço', 'Confusão'], 3);
  if (estiloLower.includes('prova social'))
    addScore(['Esperança', 'Alívio', 'Desejo de reconhecimento', 'Exclusividade'], 3);
  if (estiloLower.includes('urgência') || estiloLower.includes('escassez'))
    addScore(['Ansiedade', 'Medo de julgamento', 'Desejo de controle'], 3);
  if (estiloLower.includes('inspirador')) addScore(['Esperança', 'Ambição', 'Alívio'], 3);
  if (estiloLower.includes('curiosidade'))
    addScore(['Confusão', 'Desejo de controle', 'Insegurança'], 3);
  if (estiloLower.includes('storytelling'))
    addScore(['Esperança', 'Frustração', 'Ansiedade', 'Alívio'], 3);
  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map((entry) => entry[0]);
}

// Põe estilo/ângulo/emoção no valor RECOMENDADO pelo Metavise para o nível de
// consciência. Substitui quando o valor atual NÃO está no conjunto recomendado
// deste nível — cobre três casos: campo vazio, código de brief que não casa com
// as opções ('depoimento', 'curiosidade'...) e valor válido herdado de OUTRO
// nível (ex.: emoção do projeto-pai), que aparecia sem a estrelinha por não ser
// o recomendado daqui. Se o valor já é um dos recomendados, preserva (o cliente
// pode escolher entre os recomendados sem ser sobrescrito). Muta `ans`.
function fillRecommendedStrategyFields(ans: Record<string, any>): Record<string, any> {
  const level = (ans.awarenessLevel as string) || '';
  if (!level) return ans;
  const estiloRec = getRecomendedEstilo(level);
  if (estiloRec.length && !estiloRec.includes(ans.estiloAnuncio)) {
    ans.estiloAnuncio = estiloRec[0];
  }
  const angleRec = recommendedAnglesFor(level);
  if (angleRec.length && !angleRec.includes(ans.angleIdea)) {
    ans.angleIdea = angleRec[0];
  }
  const emotionRec = recommendedEmotionsFor(level, (ans.estiloAnuncio as string) || '');
  if (emotionRec.length && !emotionRec.includes(ans.emotion)) {
    ans.emotion = emotionRec[0];
  }
  return ans;
}

interface Props {
  /** Modo VSL: mesma aba, mas gera roteiro longo em blocos (aba "Copy da VSL"). */
  isVsl?: boolean;
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
  handleSaveProject: (overrides?: Partial<AdConfig>) => Promise<any> | void;

  // Generate copy.
  loading: boolean;
  handleGenerateCopy: () => void | Promise<void>;

  // Tab-level UX gates.
  isProjectLoading: boolean;

  // Validação visual: quando o cliente tenta sair da aba sem preencher os
  // campos obrigatórios, App liga isso → desenha outline vermelho nos campos
  // obrigatórios ainda vazios. Não bloqueia a navegação.
  showRequiredErrors?: boolean;
}

export function CopyTab({
  isVsl = false,
  config,
  updateConfig,
  setConfig,
  setCurrentStep,
  // UX12: setVoiceSource nao e mais usado aqui (botao "Configurar Voz"
  // foi removido). Mantemos na interface Props pra nao quebrar callers,
  // mas marcamos com underscore prefix pra dizer "ciente, intencional".
  setVoiceSource: _setVoiceSource,
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
  showRequiredErrors = false,
}: Props) {
  // Stand-in for the parent's `handleGeneratePersona` — kept here so the
  // discovery-flow JSX below reads natural without renaming.
  const handleGeneratePersona = onGeneratePersona;

  const sections = COPY_SECTIONS;
  const modes = COPY_MODES;
  const productInfo = config.copy?.productInfo as ProductInfo | null;

  // UX13: scan da copy gerada por termos arriscados. Memoizado pelo
  // texto + hash do acknowledgment — só re-roda quando texto muda.
  const scriptToScan = config.copy?.finalScript || config.copy?.generatedScript || '';
  const scanResult = useMemo(() => scanForRisks(scriptToScan), [scriptToScan]);
  const acknowledgedHash = (config.copy as any)?.contentRiskAcknowledgedHash as string | undefined;
  // Banner aparece quando há risco E o user ainda não disse "manter assim"
  // pra ESSA versão do texto. Se o texto mudar (hash novo), o ack invalida.
  const showRiskBanner = scanResult.hasRisk && acknowledgedHash !== scanResult.textHash;
  const [isRewriting, setIsRewriting] = useState(false);

  const handleRewriteSafe = async () => {
    if (!scriptToScan || scanResult.hits.length === 0) return;
    setIsRewriting(true);
    const toastId = 'rewrite-safe';
    toast.loading('Reescrevendo versão segura...', { id: toastId });
    try {
      const hits = scanResult.hits.map((h) => ({
        matched: h.matched,
        category: CATEGORY_LABELS[h.term.category],
        reason: h.term.reason,
      }));
      const safeText = await rewriteSafeCopy({
        text: scriptToScan,
        hits,
        textType: 'script',
      });
      // Sobrescreve o campo correto: prefere finalScript se existia (versão
      // editada/aprovada pelo user), senão atualiza generatedScript.
      setConfig((prev: any) => ({
        ...prev,
        copy: {
          ...prev.copy,
          ...(prev.copy.finalScript ? { finalScript: safeText } : { generatedScript: safeText }),
          // Limpa optimized — vai precisar refazer com texto novo
          optimizedScript: '',
          // Reset ack — texto novo vai ser re-escaneado naturalmente
          contentRiskAcknowledgedHash: undefined,
        },
      }));
      toast.success('Copy reescrita em versão segura!', { id: toastId });
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao reescrever.', { id: toastId });
    } finally {
      setIsRewriting(false);
    }
  };

  const handleAcknowledgeRisk = () => {
    setConfig((prev: any) => ({
      ...prev,
      copy: {
        ...prev.copy,
        contentRiskAcknowledgedHash: scanResult.textHash,
      },
    }));
    toast('Aviso registrado. Você assumiu o risco — boa sorte! 🤞', { icon: '⚠️' });
  };

  // UX15: Self-critique pass. Manual trigger DEPOIS que a copy foi
  // gerada — user clica botão "Revisar com IA". Pontua 6 dimensões,
  // reescreve se algum score < 8. Custo: 1 chamada Claude extra.
  const [isCritiquing, setIsCritiquing] = useState(false);
  const handleSelfCritique = async () => {
    if (!scriptToScan) return;
    setIsCritiquing(true);
    const toastId = 'critique';
    toast.loading('Revisando copy com IA...', { id: toastId });
    try {
      const result = await critiqueAndRewriteCopy({
        script: scriptToScan,
        answers: config.copy?.answers || {},
        angle: (config.copy?.answers?.angleIdea as string) || 'Direto',
      });
      const avg =
        Object.values(result.scores).reduce((a, b) => a + b, 0) /
        Math.max(1, Object.values(result.scores).length);
      if (result.needsRewrite && result.rewritten) {
        // Sobrescreve campo certo: prefere finalScript (versão editada),
        // senão atualiza generatedScript. Limpa optimized.
        setConfig((prev: any) => ({
          ...prev,
          copy: {
            ...prev.copy,
            ...(prev.copy.finalScript
              ? { finalScript: result.rewritten }
              : { generatedScript: result.rewritten }),
            optimizedScript: '',
            contentRiskAcknowledgedHash: undefined,
          },
        }));
        toast.success(`Copy aprimorada! Score médio: ${avg.toFixed(1)}/10. ${result.notes || ''}`, {
          id: toastId,
          duration: 5000,
        });
      } else {
        toast.success(`Copy já está em ${avg.toFixed(1)}/10 — sem necessidade de reescrever.`, {
          id: toastId,
          duration: 4000,
        });
      }
    } catch (err: any) {
      toast.error(err?.message || 'Erro na revisão.', { id: toastId });
    } finally {
      setIsCritiquing(false);
    }
  };

  // AGENTE COPYWRITER — Chat.
  const [showCopywriterChat, setShowCopywriterChat] = useState(false);
  const [isGenNarrator, setIsGenNarrator] = useState(false);
  const [isGenInnovative, setIsGenInnovative] = useState(false);
  const autoTriedInnovativeRef = useRef(false);
  const seenInnovativeRef = useRef<string[]>([]);

  // Gera (ou re-gera) o nome do "produto inovador" / gancho de curiosidade.
  // Passa os nomes já vistos pra cada re-gerar vir com ângulo DIFERENTE.
  const runGenInnovative = async (silent = false) => {
    setIsGenInnovative(true);
    const toastId = 'gen-innovative';
    if (!silent) toast.loading('Gerando nome...', { id: toastId });
    try {
      const current = (config.copy?.answers?.innovativeProductName || '').toString().trim();
      if (current && !seenInnovativeRef.current.includes(current))
        seenInnovativeRef.current.push(current);
      const sourceText =
        ((config.copy as any)?.sourceText as string) ||
        ((config.copy?.productInfo as any)?.transcript as string) ||
        '';
      const n = await generateInnovativeName(
        config.copy?.answers || {},
        seenInnovativeRef.current.slice(-6),
        sourceText
      );
      if (n) {
        seenInnovativeRef.current.push(n);
        updateConfig('copy', 'answers', 'innovativeProductName', n);
        if (!silent) toast.success('Nome gerado — edite se quiser.', { id: toastId });
      } else if (!silent) {
        toast.error('Não consegui gerar agora.', { id: toastId });
      }
    } catch (err: any) {
      if (!silent) toast.error(err?.message || 'Erro ao gerar.', { id: toastId });
    } finally {
      setIsGenInnovative(false);
    }
  };

  // Auto-preenche 1× quando a aba já tem dados da fonte (produto/mecanismo) e o
  // campo está vazio. Não sobrescreve o que o usuário digitou; roda só uma vez.
  useEffect(() => {
    const a = config.copy?.answers || {};
    const hasSourceData = !!(a.uniqueMechanism || a.productName || a.productResult);
    const empty = !(a.innovativeProductName || '').toString().trim();
    if (hasSourceData && empty && !autoTriedInnovativeRef.current) {
      autoTriedInnovativeRef.current = true;
      runGenInnovative(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.copy?.answers?.uniqueMechanism, config.copy?.answers?.productName]);

  const seenNarratorRef = useRef<string[]>([]);

  // Gera (ou re-gera) o narrador. Passa os anteriores pra cada re-gerar vir com
  // um TIPO de voz diferente. O campo continua editável pra escrever o seu.
  const handleGenNarrator = async () => {
    setIsGenNarrator(true);
    const toastId = 'gen-narrator';
    toast.loading('Gerando narrador...', { id: toastId });
    try {
      const current = (config.copy?.answers?.narrator || '').toString().trim();
      if (current && !seenNarratorRef.current.includes(current))
        seenNarratorRef.current.push(current);
      const answersWithDriver = {
        ...(config.copy?.answers || {}),
        emotionalDriver:
          (config.copy?.answers as any)?.emotionalDriver ||
          ((config.copy?.productInfo as any)?.emotionalDriver as string) ||
          '',
      };
      const n = await generateNarrator(answersWithDriver, seenNarratorRef.current.slice(-6));
      if (n) {
        seenNarratorRef.current.push(n);
        updateConfig('copy', 'answers', 'narrator', n);
        toast.success('Narrador gerado — edite se quiser.', { id: toastId });
      } else {
        toast.error('Não consegui gerar agora.', { id: toastId });
      }
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao gerar narrador.', { id: toastId });
    } finally {
      setIsGenNarrator(false);
    }
  };

  // Aplica um script novo no campo certo (finalScript editado, senão
  // generatedScript) e limpa o optimized. Usado pelo Polir e pelo Chat.
  const applyScriptToCopy = (newText: string) => {
    setConfig((prev: any) => ({
      ...prev,
      copy: {
        ...prev.copy,
        ...(prev.copy.finalScript ? { finalScript: newText } : { generatedScript: newText }),
        optimizedScript: '',
        contentRiskAcknowledgedHash: undefined,
      },
    }));
  };


  // UX15: Variants A/B. Gera 2 versões em paralelo. User escolhe.
  const [isGeneratingVariants, setIsGeneratingVariants] = useState(false);
  const [variants, setVariants] = useState<{ script: string }[] | null>(null);
  const handleGenerateVariants = async () => {
    // Reusa os answers já configurados + angleIdea ou default.
    const answers = config.copy?.answers || {};
    const mode = (config.copy?.mode || 'questions') as 'improve' | 'as-is' | 'questions';
    const angle = (answers.angleIdea as string) || 'Direto';
    setIsGeneratingVariants(true);
    setVariants(null);
    const toastId = 'variants';
    toast.loading('Gerando 2 versões em paralelo...', { id: toastId });
    try {
      const results = await generateAdCopyVariants(
        answers,
        mode,
        angle,
        2,
        (config.copy?.targetWordCount as number) || undefined
      );
      setVariants(results);
      toast.success('2 versões prontas — escolha uma abaixo.', { id: toastId, duration: 4000 });
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao gerar variantes.', { id: toastId });
    } finally {
      setIsGeneratingVariants(false);
    }
  };
  // UX16: toggle entre modo "textarea monolítico" e "beat-by-beat editor".
  // Beat mode só está disponível quando o script tem markers [BEAT].
  // Default: usa beat mode se houver markers.
  const parsedBeats = useMemo(
    () => parseScriptBeats(config.copy?.generatedScript || ''),
    [config.copy?.generatedScript]
  );
  const hasBeatMarkers = parsedBeats.length >= 2;
  const [beatMode, setBeatMode] = useState<boolean>(true);

  // UX18: biblioteca pessoal. Carrega na montagem, recarrega quando user
  // muda. Modal mostra sistema + minhas, com CRUD nas minhas.
  const [personalLibrary, setPersonalLibrary] = useState<PersonalCopyDoc[]>([]);
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  // UX25-D2: loading state pra skeleton no modal
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
  const currentUid = auth.currentUser?.uid || null;
  React.useEffect(() => {
    if (!currentUid) return;
    setIsLoadingLibrary(true);
    loadPersonalLibrary(currentUid)
      .then(setPersonalLibrary)
      .catch((err) => console.warn('[loadPersonalLibrary] failed:', err))
      .finally(() => setIsLoadingLibrary(false));
  }, [currentUid]);

  const reloadLibrary = async () => {
    if (!currentUid) return;
    try {
      const list = await loadPersonalLibrary(currentUid);
      setPersonalLibrary(list);
    } catch (err) {
      console.warn(err);
    }
  };

  // Botão "Marcar como copy boa" no script atual. Salva no Firestore com
  // vertical inferida do productInfo, awareness do answers, etc.
  const handleSaveAsExample = async () => {
    if (!currentUid) {
      toast.error('Você precisa estar logado pra salvar copies.');
      return;
    }
    if (!scriptToScan) {
      toast.error('Não há copy pra salvar.');
      return;
    }
    const ansLang = (config.copy?.answers?.language as string) || '';
    const lang: 'pt' | 'en' = /port|brasil/i.test(ansLang) ? 'pt' : 'en';
    const vertical = inferVertical({
      produto: config.copy?.answers?.productName,
      oferta: config.copy?.answers?.productResult,
      dorPrincipal: config.copy?.answers?.painPoints || config.copy?.answers?.situation,
      audience: config.copy?.answers?.audience,
    });
    const awareness = (String(config.copy?.answers?.awarenessLevel || '3').charAt(0) ||
      '3') as PersonalCopyDoc['awareness'];
    const angle = (config.copy?.answers?.angleIdea as string) || '';
    try {
      await addToPersonalLibrary(currentUid, {
        vertical: vertical || 'fisico',
        awareness,
        angle,
        language: lang,
        script: scriptToScan,
        whyItWorks: '',
        starred: false,
        source: 'auto-from-generated',
      });
      await reloadLibrary();
      toast.success('Copy salva na sua biblioteca! IA vai usar como referência.', {
        duration: 4000,
      });
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao salvar.');
    }
  };

  const handleToggleStar = async (copyId: string, starred: boolean) => {
    if (!currentUid) return;
    try {
      await toggleStarPersonalCopy(currentUid, copyId, starred);
      await reloadLibrary();
    } catch (err: any) {
      toast.error(err?.message || 'Erro.');
    }
  };

  const handleDeleteLibraryItem = async (copyId: string) => {
    if (!currentUid) return;
    try {
      await deletePersonalCopy(currentUid, copyId);
      await reloadLibrary();
      toast.success('Copy removida da biblioteca.');
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao remover.');
    }
  };

  // UX22: seleção manual de copies como referência. Persistido em
  // config.copy.referenceCopyIds — sobrevive reload e troca de aba.
  const referenceCopyIds: string[] =
    ((config.copy as any)?.referenceCopyIds as string[] | undefined) || [];
  const handleToggleReference = (copyId: string) => {
    setConfig((prev: any) => {
      const current = (prev.copy?.referenceCopyIds as string[] | undefined) || [];
      const next = current.includes(copyId)
        ? current.filter((id) => id !== copyId)
        : [...current, copyId];
      return {
        ...prev,
        copy: {
          ...prev.copy,
          referenceCopyIds: next,
          // UX23-F: quando user marca a primeira copy, inicializa similarity
          // em 65 (medium-strong) se ainda não tiver valor. User pode
          // ajustar depois.
          referenceSimilarity:
            typeof prev.copy?.referenceSimilarity === 'number' ? prev.copy.referenceSimilarity : 65,
        },
      };
    });
  };

  // UX23-F: slider de similaridade. Default 65 quando user já tem
  // seleção mas o campo ainda não existe (ex: projetos antigos).
  const referenceSimilarity: number =
    typeof (config.copy as any)?.referenceSimilarity === 'number'
      ? (config.copy as any).referenceSimilarity
      : 65;
  const handleChangeSimilarity = (next: number) => {
    setConfig((prev: any) => ({
      ...prev,
      copy: {
        ...prev.copy,
        referenceSimilarity: Math.max(0, Math.min(100, Math.round(next))),
      },
    }));
  };

  // UX23-E: snapshot das copies usadas na última geração + modal de view
  const lastUsedReferences: LastUsedReference[] | undefined =
    ((config.copy as any)?.lastUsedReferences as LastUsedReference[] | undefined) || undefined;
  const [showLastUsedModal, setShowLastUsedModal] = useState(false);

  // UX25-C1: snapshot do prompt enviado + modal de debug
  const lastDebug = (config.copy as any)?.lastDebug as
    | import('@/components/DebugPromptModal').DebugSnapshot
    | undefined;
  const [showDebugModal, setShowDebugModal] = useState(false);

  // UX25-B2: histórico das últimas 5 gerações
  const history: CopyHistoryEntry[] = ((config.copy as any)?.history as CopyHistoryEntry[]) || [];
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // UX25-B3: modal de comparação A vs B
  const [showCompareModal, setShowCompareModal] = useState(false);

  // UX25-B4: keyboard shortcuts globais quando CopyTab está ativa
  //   Cmd/Ctrl + Enter → Gerar (ou Regerar) copy
  //   Cmd/Ctrl + B    → abrir Biblioteca
  //   Cmd/Ctrl + H    → abrir Histórico (quando tem)
  //   Cmd/Ctrl + D    → ver Prompt enviado (debug)
  //   ?                → mostrar atalhos (toast)
  React.useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // Ignora quando está digitando em input/textarea
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        // Cmd+Enter ainda funciona dentro de textarea (atalho clássico de "submit")
        if (!(e.key === 'Enter' && (e.metaKey || e.ctrlKey))) return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        if (!loading && !isGeneratingVariants && config.copy.mode !== 'as-is') {
          handleGenerateCopy();
        }
        return;
      }
      if (mod && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        setShowLibraryModal(true);
        return;
      }
      if (mod && (e.key === 'h' || e.key === 'H') && history.length > 0) {
        e.preventDefault();
        setShowHistoryModal(true);
        return;
      }
      if (mod && (e.key === 'd' || e.key === 'D') && lastDebug) {
        e.preventDefault();
        setShowDebugModal(true);
        return;
      }
      if (e.key === '?' && !mod) {
        e.preventDefault();
        toast('⌨️ Atalhos: ⌘+↵ gerar · ⌘+B biblioteca · ⌘+H histórico · ⌘+D debug', {
          duration: 5000,
        });
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, isGeneratingVariants, config.copy.mode, history.length, !!lastDebug]);
  const handleRestoreHistory = (script: string) => {
    setConfig((prev: any) => ({
      ...prev,
      copy: {
        ...prev.copy,
        generatedScript: script,
        optimizedScript: '',
        finalScript: '',
      },
    }));
  };
  const handleClearHistory = () => {
    setConfig((prev: any) => ({ ...prev, copy: { ...prev.copy, history: [] } }));
    toast.success('Histórico limpo.');
  };

  // UX25-A4: toggle modo rascunho (Sonnet) vs final (Opus)
  const draftMode: boolean = !!(config.copy as any)?.draftMode;
  const handleToggleDraftMode = () => {
    setConfig((prev: any) => ({
      ...prev,
      copy: {
        ...prev.copy,
        draftMode: !prev.copy?.draftMode,
      },
    }));
  };

  // UX25-A2: pre-flight check — roda local, sem chamar IA. Atualiza
  // em tempo real quando user edita campos.
  const preflightIssues = useMemo(
    () => preflightCheckCopy(config.copy.answers || {}),
    [config.copy.answers]
  );

  // UX25-A3: hallucination detector — roda DEPOIS de gerar. Estado local
  // (não persiste). User pode dispensar.
  const [hallucinationFlags, setHallucinationFlags] = useState<HallucinationFlag[] | null>(null);
  const [isCheckingHallucinations, setIsCheckingHallucinations] = useState(false);
  const handleCheckHallucinations = async () => {
    if (!config.copy.generatedScript || !productInfo) {
      toast.error('Gere uma copy + tenha Fonte do Produto configurada.');
      return;
    }
    setIsCheckingHallucinations(true);
    try {
      const flags = await detectHallucinations({
        generatedCopy: config.copy.generatedScript,
        productInfo,
        language: config.copy.answers.language,
      });
      setHallucinationFlags(flags);
      if (flags.length === 0) {
        toast.success('Nenhuma alucinação detectada — copy parece consistente com a fonte.');
      } else {
        toast(
          `${flags.length} trecho${flags.length > 1 ? 's' : ''} suspeito${flags.length > 1 ? 's' : ''} detectado${flags.length > 1 ? 's' : ''}.`,
          { icon: '⚠️' }
        );
      }
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao checar.');
    } finally {
      setIsCheckingHallucinations(false);
    }
  };

  // Quick-fix: generalizar autoridades nomeadas (instituição/expert + localização)
  // achadas na copy → âncora genérica. Nomes que estão na Fonte do Produto não
  // são flagados (são ancorados/permitidos). Funciona mesmo sem fonte.
  const [authorityFlags, setAuthorityFlags] = useState<AuthorityAnchor[] | null>(null);
  const [isCheckingAuthorities, setIsCheckingAuthorities] = useState(false);
  const handleCheckAuthorities = async () => {
    if (!config.copy.generatedScript) {
      toast.error('Gere uma copy primeiro.');
      return;
    }
    setIsCheckingAuthorities(true);
    try {
      const anchors = await detectNamedAuthorities({
        generatedCopy: config.copy.generatedScript,
        productInfo,
        language: config.copy.answers.language,
      });
      setAuthorityFlags(anchors);
      if (anchors.length === 0) {
        toast.success('Nenhum nome específico de instituição/autoridade pra generalizar.');
      } else {
        toast(
          `${anchors.length} ${anchors.length === 1 ? 'nome específico' : 'nomes específicos'} — revise as trocas.`,
          { icon: '🏛️' }
        );
      }
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao checar.');
    } finally {
      setIsCheckingAuthorities(false);
    }
  };
  const handleApplyAnchor = (flag: AuthorityAnchor) => {
    const current = config.copy.generatedScript || '';
    if (!current.includes(flag.excerpt)) {
      toast.error('Trecho não encontrado (talvez já editado).');
      setAuthorityFlags((prev) => (prev ? prev.filter((f) => f !== flag) : prev));
      return;
    }
    const next = current.split(flag.excerpt).join(flag.suggestion);
    setConfig((prev: any) => ({
      ...prev,
      copy: { ...prev.copy, generatedScript: next, optimizedScript: '' },
    }));
    setHasUnsavedCopyChanges(true);
    setAuthorityFlags((prev) => {
      const left = prev ? prev.filter((f) => f !== flag) : [];
      return left.length ? left : null;
    });
    toast.success('Trocado por âncora genérica.');
  };
  const handleApplyAllAnchors = () => {
    if (!authorityFlags || authorityFlags.length === 0) return;
    // Aplica numa só passada (setConfig é async — não dá pra encadear via state)
    let text = config.copy.generatedScript || '';
    let applied = 0;
    const remaining: AuthorityAnchor[] = [];
    for (const f of authorityFlags) {
      if (text.includes(f.excerpt)) {
        text = text.split(f.excerpt).join(f.suggestion);
        applied++;
      } else {
        remaining.push(f);
      }
    }
    if (applied > 0) {
      setConfig((prev: any) => ({
        ...prev,
        copy: { ...prev.copy, generatedScript: text, optimizedScript: '' },
      }));
      setHasUnsavedCopyChanges(true);
      toast.success(`${applied} ${applied === 1 ? 'âncora generalizada' : 'âncoras generalizadas'}.`);
    }
    setAuthorityFlags(remaining.length ? remaining : null);
  };

  // Item 2: buscar estatísticas FACTUAIS com fonte na web (web_search no
  // servidor) pra quem não tem números próprios. NUNCA auto-injeta — devolve
  // candidatos com link da fonte e o cliente clica "Adicionar" pra mandar pro
  // campo de estatísticas. Princípio nunca-bloquear: o cliente revisa e decide.
  const [statFindings, setStatFindings] = useState<StatisticFinding[] | null>(null);
  const [isFindingStats, setIsFindingStats] = useState(false);
  const handleFindStatistics = async () => {
    if (!productInfo) {
      toast.error('Configure a Fonte do Produto pra eu saber o nicho da busca.');
      return;
    }
    setIsFindingStats(true);
    try {
      const stats = await findStatistics({
        productInfo,
        niche: productInfo?.productName || productInfo?.category || '',
        language: config.copy.answers.language,
      });
      setStatFindings(stats);
      if (stats.length === 0) {
        toast('Não achei estatísticas com fonte confiável pra esse nicho.', { icon: '🔍' });
      } else {
        toast.success(`${stats.length} estatística${stats.length > 1 ? 's' : ''} com fonte — revise e adicione.`);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao buscar estatísticas.');
    } finally {
      setIsFindingStats(false);
    }
  };
  const handleAddStat = (s: StatisticFinding) => {
    const line = `${s.stat} (fonte: ${s.source}${s.year ? ', ' + s.year : ''})`;
    const current = (config.copy.answers.statistics || '').toString().trim();
    if (current.includes(s.stat.trim())) {
      toast('Essa estatística já está no campo.', { icon: 'ℹ️' });
      return;
    }
    updateConfig('copy', 'answers', 'statistics', current ? `${current}\n${line}` : line);
    setStatFindings((prev) => (prev ? prev.filter((x) => x !== s) : prev));
    toast.success('Adicionada ao campo de estatísticas.');
  };

  // UX24-A: auto-fill da descrição do destino do clique usando productInfo.
  // Chama Claude (~1s) e popula config.copy.answers.destinationDescription.
  // User pode revisar/editar antes de gerar a copy.
  const [isAutoFillingDestination, setIsAutoFillingDestination] = useState(false);
  const handleAutoFillDestination = async () => {
    if (!productInfo) {
      toast.error('Configure a Fonte do Produto antes de auto-preencher.');
      return;
    }
    setIsAutoFillingDestination(true);
    try {
      const description = await describeDestinationFromProduct({
        productInfo,
        clickDestination: config.copy.answers.clickDestination,
        language: config.copy.answers.language,
      });
      updateConfig('copy', 'answers', 'destinationDescription', description);
      toast.success('Descrição preenchida — revise antes de gerar.');
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao preencher destino.');
    } finally {
      setIsAutoFillingDestination(false);
    }
  };

  // Auto-preenche estilo/ângulo/emoção (seções 3/6/7) com o RECOMENDADO pelo
  // Metavise. É instantâneo e só depende do nível de consciência — por isso NÃO
  // espera productInfo (separado do auto-fill do destino abaixo, que usa IA).
  // Chave por SUBPROJETO + NÍVEL: cada subprojeto recalcula a partir da SUA
  // estratégia, e se o cliente muda o nível de consciência os recomendados são
  // recalculados. Roda uma vez por (subprojeto, nível): depois disso o cliente
  // pode trocar livremente entre os recomendados sem ser sobrescrito.
  const recommendedFilledFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    const subprojectKey =
      (config.copy as any)?.activeBriefId || currentProjectId || '__no-project__';
    const level = config.copy.answers.awarenessLevel || '';

    // Sem nível de consciência não há base de recomendação. Quando o projeto não
    // veio de brief nem de persona (caso em que o nível já é herdado), o Metavise
    // aplica um nível RECOMENDADO automaticamente (escolha do cliente): da persona
    // descoberta se houver, senão o padrão '3' (Consciente da Solução) — mesmo
    // fallback já usado no resto do código. O cliente pode trocar na Seção 2.
    // Ao aplicar, o effect re-roda com o nível setado e preenche 3/6/7 abaixo.
    if (!level) {
      if (recommendedFilledFor.current === subprojectKey + '::auto') return;
      recommendedFilledFor.current = subprojectKey + '::auto';
      let derived = '';
      try {
        derived = JSON.parse(config.copy.answers.discoveredPersona || '{}').awarenessLevel || '';
      } catch {
        /* discoveredPersona ausente ou malformado — usa o padrão */
      }
      applyAwarenessLevelChange(derived || '3');
      return;
    }

    const key = subprojectKey + '::' + level;
    if (recommendedFilledFor.current === key) return;
    recommendedFilledFor.current = key;

    setConfig((prev: any) => {
      const before = prev.copy.answers;
      const ans = fillRecommendedStrategyFields({ ...before });
      const changed =
        ans.estiloAnuncio !== before.estiloAnuncio ||
        ans.angleIdea !== before.angleIdea ||
        ans.emotion !== before.emotion;
      return changed ? { ...prev, copy: { ...prev.copy, answers: ans } } : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId, (config.copy as any)?.activeBriefId, config.copy.answers.awarenessLevel]);

  // Força a aplicação dos campos RECOMENDADOS pro nível atual (estilo/ângulo/
  // emoção), sobrescrevendo o que estiver lá — a "opção" de alinhar os outros
  // campos ao novo nível de consciência sob demanda (sem overwrite silencioso).
  const applyLevelRecommendations = () => {
    const level = config.copy.answers.awarenessLevel || '';
    if (!level) return toast.error('Escolha um nível de consciência primeiro.');
    const estilo = getRecomendedEstilo(level)[0];
    const angle = recommendedAnglesFor(level)[0];
    const emotion = recommendedEmotionsFor(level, estilo || '')[0];
    setConfig((prev: any) => ({
      ...prev,
      copy: {
        ...prev.copy,
        answers: {
          ...prev.copy.answers,
          ...(estilo ? { estiloAnuncio: estilo } : {}),
          ...(angle ? { angleIdea: angle } : {}),
          ...(emotion ? { emotion } : {}),
        },
      },
    }));
    setHasUnsavedCopyChanges(true);
    toast.success(`Estilo, ângulo e emoção ajustados pro nível ${level}.`);
  };

  // Reescreve os campos da AUDIÊNCIA (Seção 1) pro nível de consciência atual via
  // IA — SOBRESCREVE o texto. Mantém quem é a audiência; muda o enquadramento.
  const [reframingAudience, setReframingAudience] = React.useState(false);
  const AUDIENCE_FIELDS = ['audience', 'situation', 'painPoints', 'triedBefore', 'mainObjection', 'hiddenDesire'];
  const reframeAudience = async () => {
    const level = config.copy.answers.awarenessLevel || '';
    if (!level) return toast.error('Escolha um nível de consciência primeiro.');
    const fields: Record<string, string> = {};
    for (const id of AUDIENCE_FIELDS) {
      const v = (config.copy.answers as any)[id];
      if (typeof v === 'string' && v.trim()) fields[id] = v;
    }
    if (Object.keys(fields).length === 0) return toast.error('Preencha a audiência primeiro.');
    setReframingAudience(true);
    const tid = 'reframe-audience';
    toast.loading('Reescrevendo a audiência pro nível…', { id: tid });
    try {
      const out = await reframeAudienceForLevel({
        level,
        language: config.copy.answers.language,
        fields,
      });
      setConfig((prev: any) => {
        const next = { ...prev.copy.answers };
        for (const id of AUDIENCE_FIELDS) {
          if (typeof out[id] === 'string' && out[id].trim()) next[id] = out[id].trim();
        }
        return { ...prev, copy: { ...prev.copy, answers: next } };
      });
      setHasUnsavedCopyChanges(true);
      toast.success(`Audiência reescrita pro nível ${level}.`, { id: tid });
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao reescrever a audiência.', { id: tid });
    } finally {
      setReframingAudience(false);
    }
  };

  // Auto-preenche a descrição do destino do clique via IA (~1s). Só roda quando
  // há productInfo e o campo está vazio; uma vez por subprojeto.
  const destFilledFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!productInfo) return;
    const subprojectKey =
      (config.copy as any)?.activeBriefId || currentProjectId || '__no-project__';
    if (destFilledFor.current === subprojectKey) return;
    destFilledFor.current = subprojectKey;
    if (!config.copy.answers.destinationDescription) void handleAutoFillDestination();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId, (config.copy as any)?.activeBriefId, productInfo]);

  // UX20: upload manual SIMPLIFICADO — só name + script. IA infere o
  // resto (vertical, awareness, language, angle, whyItWorks) via
  // analyzeCopyForLibrary. Fallback razoável se IA falhar.
  const handleAddManualCopy = async (input: { name?: string; script: string }) => {
    if (!currentUid) {
      toast.error('Você precisa estar logado pra salvar copies.');
      return;
    }
    try {
      // 1) IA classifica vertical/awareness/language/angle/whyItWorks
      const analysis = await analyzeCopyForLibrary(input.script);
      // 2) Salva no Firestore com tudo já preenchido
      await addToPersonalLibrary(currentUid, {
        name: input.name,
        vertical: analysis.vertical,
        awareness: analysis.awareness,
        language: analysis.language,
        angle: analysis.angle,
        script: input.script,
        whyItWorks: analysis.whyItWorks,
        starred: false,
        source: 'manual',
      });
      await reloadLibrary();
      toast.success(
        `Copy salva! Detectado: ${analysis.vertical} · Consc.${analysis.awareness} · ${analysis.language.toUpperCase()}`,
        { duration: 4500 }
      );
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao salvar.');
    }
  };

  const handlePickVariant = (script: string) => {
    setConfig((prev: any) => ({
      ...prev,
      copy: {
        ...prev.copy,
        generatedScript: script,
        finalScript: '',
        optimizedScript: '',
        contentRiskAcknowledgedHash: undefined,
      },
    }));
    setVariants(null);
    toast.success('Versão selecionada!');
  };

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
      // "Encaixa" os valores de campos de seleção na opção EXATA. A IA às vezes
      // devolve com acento/caixa um pouco diferente da opção (ex: "frustracao"
      // vs "Frustração"), e aí o <select> não marca — parecia que "não
      // auto-selecionou". Normalizamos pra casar com a opção certa.
      const norm = (s: string) =>
        s
          .normalize('NFD')
          .replace(/\p{Diacritic}/gu, '')
          .toLowerCase()
          .trim();
      const snapped: any = { ...filled };
      for (const q of allQuestions) {
        const opts = (q as any)?.options as string[] | undefined;
        if (!opts || !opts.length) continue;
        const val = (filled as any)[q.id];
        if ((q as any).type === 'multi-select' && Array.isArray(val)) {
          snapped[q.id] = val.map((v: string) => opts.find((o) => norm(o) === norm(v)) || v);
        } else if (typeof val === 'string' && val) {
          const exact = opts.find((o) => norm(o) === norm(val));
          if (exact) snapped[q.id] = exact;
        }
      }
      setConfig((prev: any) => {
        // Seções 3/6/7 (Estilo, Emoção, Ângulo): auto-seleciona a opção
        // RECOMENDADA pro nível de consciência quando o campo está vazio ou
        // com valor fora da lista. Antes só o estilo era preenchido.
        const merged = fillRecommendedStrategyFields({ ...prev.copy.answers, ...snapped });
        return { ...prev, copy: { ...prev.copy, answers: merged } };
      });
      toast.success('Campos preenchidos!', { id: toastId });
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao preencher.', { id: toastId });
    }
  };

  // Blueprint v2 — show a small banner when this CopyTab session was
  // opened from a creative brief (via PlanTab → "Criar Subprojeto").
  // Read activeBriefId + creativeBriefs from config to find the brief
  // metadata. Read-only display — user can still edit any field below.
  const activeBriefId = (config.copy as any)?.activeBriefId as string | undefined;
  const briefList = ((config.copy as any)?.creativeBriefs as any[] | undefined) || [];
  const activeBrief = activeBriefId ? briefList.find((b: any) => b?.id === activeBriefId) : null;

  // --- Sinalização visual dos campos ---
  // VERMELHO: campos obrigatórios ainda vazios, mostrado só DEPOIS que o
  // cliente tentou sair da aba sem terminar (showRequiredErrors). AMBAR: campos
  // que o cliente precisa escolher mas ainda não tocou — guia o fluxo, some
  // sozinho quando preenchido. Os dois sinais são mutuamente exclusivos por
  // campo (vermelho = erro, âmbar = "a fazer").
  const REQUIRED_FIELD_IDS = [
    'audience',
    'situation',
    'painPoints',
    'awarenessLevel',
    'estiloAnuncio',
    'emotion',
    'angleIdea',
  ];
  const isFieldEmpty = (id: string): boolean => {
    const v = (config.copy.answers as any)[id];
    if (Array.isArray(v)) return v.length === 0;
    return !v || (typeof v === 'string' && !v.trim());
  };
  const requiredMissing = (id: string): boolean => {
    if (!showRequiredErrors || !REQUIRED_FIELD_IDS.includes(id)) return false;
    // painPoints é escondido no nível 1 (inconsciente) → não exigir lá.
    if (id === 'painPoints' && (config.copy.answers.awarenessLevel || '').charAt(0) === '1')
      return false;
    return isFieldEmpty(id);
  };
  const redRing = (id: string) =>
    requiredMissing(id)
      ? ' ring-2 ring-red-500 ring-offset-4 dark:ring-offset-gray-900 rounded-2xl'
      : '';
  // Âmbar de seção: aplicado no container enquanto `filled` for falso.
  const amberRing = (filled: boolean) =>
    !filled ? ' ring-2 ring-amber-400/80 dark:ring-amber-500/70 ring-offset-4 dark:ring-offset-gray-900' : '';

  return (
    <div className="space-y-8 max-w-[1600px] mx-auto pb-20 overflow-x-hidden w-full">
      {/* Active brief banner — visible only when user came from PlanTab */}
      {activeBrief && (
        <div className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950/30 dark:to-purple-950/30 ring-1 ring-blue-200/60 dark:ring-blue-900/40 rounded-2xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <span className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 text-white text-xs font-black shadow-sm shadow-blue-200/60 dark:shadow-blue-900/30">
              {activeBrief.index}
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300">
                Executando criativo do plano
              </p>
              <p className="text-sm font-bold text-gray-900 dark:text-gray-50 truncate">
                {activeBrief.targetPersonaName} · {activeBrief.angle} · Consc.
                {activeBrief.awareness === 'unaware'
                  ? '1'
                  : activeBrief.awareness === 'problem_aware'
                    ? '2'
                    : activeBrief.awareness === 'solution_aware'
                      ? '3'
                      : activeBrief.awareness === 'product_aware'
                        ? '4'
                        : '5'}{' '}
                · {activeBrief.durationTarget}s
              </p>
            </div>
          </div>
          <button
            onClick={() => setCurrentStep('plan')}
            className="shrink-0 text-[10px] font-black uppercase tracking-widest text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-50 px-3 py-1.5 rounded-lg bg-white dark:bg-gray-900/60 ring-1 ring-gray-200/60 dark:ring-gray-700/60 hover:ring-gray-400 transition-all"
          >
            ← Voltar ao plano
          </button>
        </div>
      )}

      {/* UX20: botão "Biblioteca" foi movido pra perto do "Gerar Copy" lá
          embaixo. Aqui em cima fica só o "Preencha automaticamente". */}
      {productInfo && (
        <div className="flex justify-end">
          <button
            onClick={handleFillFromSource}
            className="px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow flex items-center gap-2"
            title="Preenche todos os campos de Copy automaticamente com base na Fonte do Produto"
          >
            <Sparkles size={14} />
            Preencha automaticamente
          </button>
        </div>
      )}

      {/* UX18: modal da biblioteca */}
      <CopyLibraryModal
        open={showLibraryModal}
        onClose={() => setShowLibraryModal(false)}
        personalLibrary={personalLibrary}
        onToggleStar={handleToggleStar}
        onDelete={handleDeleteLibraryItem}
        onAddManual={handleAddManualCopy}
        selectedReferenceIds={referenceCopyIds}
        onToggleReference={handleToggleReference}
        isLoading={isLoadingLibrary}
      />

      {/* UX23-E: modal "Ver referências usadas" — mostra snapshot do
          que efetivamente entrou na última geração, ao lado da copy
          resultante pra comparação. */}
      <LastUsedReferencesModal
        open={showLastUsedModal}
        onClose={() => setShowLastUsedModal(false)}
        references={lastUsedReferences}
        generatedScript={config.copy.generatedScript || ''}
      />

      {/* UX25-C1: modal "Ver prompt enviado" — debug */}
      <DebugPromptModal
        open={showDebugModal}
        onClose={() => setShowDebugModal(false)}
        debug={lastDebug}
      />

      {/* UX25-B2: modal de histórico */}
      <CopyHistoryModal
        open={showHistoryModal}
        onClose={() => setShowHistoryModal(false)}
        history={history}
        currentScript={config.copy.generatedScript || ''}
        onRestore={handleRestoreHistory}
        onClearHistory={handleClearHistory}
      />

      {/* Agente copywriter — chat conversacional sobre a copy atual */}
      <CopywriterChat
        open={showCopywriterChat}
        onClose={() => setShowCopywriterChat(false)}
        script={scriptToScan}
        answers={config.copy?.answers || {}}
        angle={(config.copy?.answers?.angleIdea as string) || 'Direto'}
        onApplyScript={applyScriptToCopy}
      />

      {/* UX25-B3: modal de comparação A vs B com diff */}
      {variants && variants.length === 2 && (
        <VariantCompareModal
          open={showCompareModal}
          onClose={() => setShowCompareModal(false)}
          scriptA={variants[0]?.script || ''}
          scriptB={variants[1]?.script || ''}
          onPickA={() => handlePickVariant(variants[0]?.script || '')}
          onPickB={() => handlePickVariant(variants[1]?.script || '')}
        />
      )}

      {/* Loading Overlay for project opening */}
      {isProjectLoading && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-white/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="flex flex-col items-center space-y-4">
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-sm font-black text-gray-900 dark:text-gray-50 uppercase tracking-widest italic">
              Carregando Projeto...
            </p>
          </div>
        </div>
      )}

      {copyDiscoveryMode === 'unknown' && !isProjectLoading && (
        <div className="flex flex-col items-center justify-center min-h-[400px] space-y-8 max-w-lg mx-auto text-center animate-in fade-in zoom-in duration-500">
          <div className="space-y-2">
            <h2 className="text-2xl font-black text-gray-900 dark:text-gray-50 uppercase tracking-tight">
              Antes de criar sua copy...
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
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
              className="w-full p-5 rounded-2xl border-2 border-gray-200 dark:border-gray-800 hover:border-blue-300 text-left transition-all bg-white dark:bg-gray-900/80 group shadow-sm hover:shadow-md"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl group-hover:scale-110 transition-transform">✅</span>
                <div>
                  <p className="font-black text-gray-900 dark:text-gray-50 uppercase italic">
                    Já sei quem é meu cliente
                  </p>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-widest">
                    Vou preencher as informações diretamente
                  </p>
                </div>
              </div>
            </button>

            <button
              onClick={() => {
                setCurrentStep('persona');
              }}
              className="w-full p-5 rounded-2xl border-2 border-gray-200 dark:border-gray-800 hover:border-blue-300 text-left transition-all bg-white dark:bg-gray-900/80 group shadow-sm hover:shadow-md"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl group-hover:scale-110 transition-transform">🔍</span>
                <div>
                  <p className="font-black text-gray-900 dark:text-gray-50 uppercase italic">
                    Me ajuda a descobrir
                  </p>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-widest">
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
            <div className="bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950/40 dark:to-purple-950/40 border-4 border-blue-200 dark:border-blue-800/60 rounded-[40px] p-6 md:p-8 shadow-sm space-y-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white shrink-0">
                    <Users size={24} />
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest">
                      Persona Ativo
                    </p>
                    <h4 className="text-xl font-black text-gray-900 dark:text-gray-50">
                      {activePersona.name}
                    </h4>
                  </div>
                </div>
                <span className="px-3 py-1 bg-blue-600 text-white rounded-full text-[10px] font-black uppercase tracking-widest">
                  Nível {activePersona.awarenessLevel}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="bg-white dark:bg-gray-900/80 p-3 rounded-2xl border border-blue-100 dark:border-blue-900">
                  <p className="text-[9px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1">
                    Dor principal
                  </p>
                  <p className="text-gray-800 dark:text-gray-200 leading-snug">
                    {activePersona.mainPain}
                  </p>
                </div>
                <div className="bg-white dark:bg-gray-900/80 p-3 rounded-2xl border border-blue-100 dark:border-blue-900">
                  <p className="text-[9px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1">
                    Desejo profundo
                  </p>
                  <p className="text-gray-800 dark:text-gray-200 leading-snug">
                    {activePersona.hiddenDesire}
                  </p>
                </div>
                <div className="bg-white dark:bg-gray-900/80 p-3 rounded-2xl border border-blue-100 dark:border-blue-900">
                  <p className="text-[9px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1">
                    Objeção principal
                  </p>
                  <p className="text-gray-800 dark:text-gray-200 leading-snug">
                    {activePersona.mainObjection}
                  </p>
                </div>
                <div className="bg-white dark:bg-gray-900/80 p-3 rounded-2xl border border-blue-100 dark:border-blue-900">
                  <p className="text-[9px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1">
                    Idade · Gênero
                  </p>
                  <p className="text-gray-800 dark:text-gray-200 leading-snug">
                    {activePersona.age} · {activePersona.gender}
                  </p>
                </div>
              </div>

              <div className="flex flex-col md:flex-row gap-3 pt-2">
                <button
                  onClick={() => setShowEditPersonaModal(true)}
                  className="flex-1 py-3 px-6 bg-white dark:bg-gray-900/80 border-2 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-50 rounded-2xl font-black uppercase tracking-widest text-xs hover:border-blue-300 transition-all flex items-center justify-center gap-2"
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
                <p className="text-center text-[10px] text-blue-700 dark:text-blue-300 font-bold uppercase tracking-widest">
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
                      i <= discoveryStep
                        ? 'bg-blue-600 shadow-sm shadow-blue-200'
                        : 'bg-gray-100 dark:bg-gray-800'
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
                      className="bg-white dark:bg-gray-900/80 p-10 rounded-[48px] border-4 border-gray-50 shadow-2xl space-y-6 animate-in fade-in zoom-in duration-500"
                    >
                      <div className="space-y-2">
                        <p className="text-[10px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest text-center">
                          Pergunta {idx + 1} de 5
                        </p>
                        <p className="text-xl font-black text-gray-900 dark:text-gray-50 text-center uppercase italic tracking-tight">
                          {q.label}
                        </p>
                        {q.hint && (
                          <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold uppercase text-center tracking-tighter">
                            {q.hint}
                          </p>
                        )}
                      </div>

                      <AutoResizeTextarea
                        className="w-full p-6 bg-gray-50 dark:bg-gray-800/60 rounded-[32px] border-2 border-transparent focus:border-blue-400 focus:bg-white dark:focus:bg-gray-900/80 outline-none text-sm transition-all font-medium"
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
                            className="px-8 py-4 rounded-2xl border-2 border-gray-200 dark:border-gray-800 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest hover:border-gray-200 dark:hover:border-gray-700 hover:text-gray-600 dark:hover:text-gray-400 dark:text-gray-500 transition-all"
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
                    ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 shadow-lg shadow-blue-50'
                    : 'border-gray-200 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700 bg-white dark:bg-gray-900/80'
                }`}
              >
                <div
                  className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${
                    config.copy.mode === m.id
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-50 dark:bg-gray-800/60 text-gray-400 dark:text-gray-500'
                  }`}
                >
                  <m.icon size={24} />
                </div>
                <span
                  className={`text-sm font-black uppercase tracking-tight ${config.copy.mode === m.id ? 'text-blue-900' : 'text-gray-500 dark:text-gray-400'}`}
                >
                  {m.label}
                </span>
              </button>
            ))}
          </div>

          {config.copy.mode === 'as-is' ? (
            !config.copy.generatedScript ? (
              <div className="space-y-6 animate-in fade-in duration-500">
                <div className="p-10 bg-white dark:bg-gray-900/80 rounded-[48px] border-4 border-blue-50 shadow-2xl space-y-6">
                  <div className="space-y-2">
                    <label className="block text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest ml-1">
                      Cole sua copy total aqui...
                    </label>
                    <AutoResizeTextarea
                      className="w-full p-8 rounded-[32px] border-2 border-gray-200 dark:border-gray-800 focus:border-blue-600 focus:ring-0 outline-none transition-all text-sm leading-relaxed bg-gray-50 dark:bg-gray-800/60 font-medium"
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
            <div className="p-8 bg-white dark:bg-gray-900/80 rounded-[40px] border-4 border-blue-50 shadow-xl space-y-6">
              <div className="space-y-2">
                <label className="block text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest ml-1">
                  Cole sua copy existente
                </label>
                <AutoResizeTextarea
                  className="w-full p-6 rounded-3xl border-2 border-gray-200 dark:border-gray-800 focus:border-blue-600 focus:ring-0 outline-none transition-all text-sm leading-relaxed bg-gray-50 dark:bg-gray-800/60 font-medium"
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
              <div className="space-y-6 bg-white dark:bg-gray-900/80 p-8 rounded-[40px] border-2 border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <div className="w-8 h-8 bg-blue-600 text-white rounded-xl flex items-center justify-center text-xs font-black">
                    1
                  </div>
                  <h4 className="font-black text-gray-900 dark:text-gray-50 text-lg tracking-tight uppercase">
                    1. Sua Audiência
                  </h4>
                  {config.copy.answers.awarenessLevel && (
                    <button
                      onClick={reframeAudience}
                      disabled={reframingAudience}
                      title="A IA reescreve os campos da audiência pro nível de consciência atual (sobrescreve o texto)"
                      className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border-2 border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 text-[10px] font-black uppercase tracking-widest hover:bg-purple-50 dark:hover:bg-purple-950/40 disabled:opacity-50"
                    >
                      {reframingAudience ? '⏳ Reescrevendo…' : `🔄 Reescrever pro nível ${config.copy.answers.awarenessLevel} (IA)`}
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {(sections[0]?.questions || []).map((q) => {
                    const awarenessLevel = (config.copy.answers.awarenessLevel || '').toString();
                    if (q.id === 'painPoints' && awarenessLevel === '1') return null;
                    if (q.id === 'triedBefore' && awarenessLevel === '1') return null;
                    return (
                      <div key={q.id} className={'space-y-2' + redRing(q.id)}>
                        <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest ml-1">
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
                                      : 'bg-white dark:bg-gray-900/80 border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400 hover:border-gray-200 dark:hover:border-gray-700'
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
                              className="w-full p-4 rounded-2xl border-2 border-gray-200 dark:border-gray-800 outline-none transition-all text-sm font-bold appearance-none bg-gray-50 dark:bg-gray-800/60 focus:border-blue-600 focus:bg-white dark:focus:bg-gray-900/80"
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
                              className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none"
                              size={16}
                            />
                          </div>
                        ) : (
                          <AutoResizeTextarea
                            className="w-full p-4 rounded-2xl border-2 border-gray-200 dark:border-gray-800 focus:border-blue-600 focus:bg-white dark:focus:bg-gray-900/80 outline-none transition-all text-sm font-bold bg-gray-50 dark:bg-gray-800/60"
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
              <div className="space-y-6 bg-white dark:bg-gray-900/80 p-8 rounded-[40px] border-2 border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 bg-blue-600 text-white rounded-xl flex items-center justify-center text-xs font-black">
                    2
                  </div>
                  <h4 className="font-black text-gray-900 dark:text-gray-50 text-lg tracking-tight uppercase">
                    2. Nível de Consciência
                  </h4>
                </div>
                <div className={'space-y-3' + redRing('awarenessLevel')}>
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
                      className={`w-full p-4 rounded-2xl border-2 text-left transition-all flex items-center gap-4 ${config.copy.answers.awarenessLevel === nivel.id ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 shadow-sm' : 'border-gray-50 hover:border-blue-100 dark:hover:border-blue-900 bg-gray-50/30 dark:bg-gray-800/60'}`}
                    >
                      <span className="text-2xl">{nivel.emoji}</span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-black text-gray-900 dark:text-gray-50 uppercase italic tracking-tight">
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
                        <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-widest mt-0.5">
                          {nivel.desc}
                        </p>
                      </div>
                      {config.copy.answers.awarenessLevel === nivel.id && (
                        <div className="w-3 h-3 bg-blue-600 rounded-full" />
                      )}
                    </button>
                  ))}
                </div>
                {config.copy.answers.awarenessLevel && (
                  <button
                    onClick={applyLevelRecommendations}
                    className="mt-3 w-full py-2.5 rounded-2xl border-2 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-xs font-black uppercase tracking-widest hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors"
                    title="Ajusta estilo, ângulo e emoção pros recomendados deste nível de consciência"
                  >
                    🔄 Aplicar recomendações do nível {config.copy.answers.awarenessLevel} (estilo · ângulo · emoção)
                  </button>
                )}
              </div>

              {/* SEÇÃO 3 — Configurações do Anúncio */}
              <div className="space-y-6 bg-white dark:bg-gray-900/80 p-8 rounded-[40px] border-2 border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 bg-blue-600 text-white rounded-xl flex items-center justify-center text-xs font-black">
                    3
                  </div>
                  <h4 className="font-black text-gray-900 dark:text-gray-50 text-lg tracking-tight uppercase">
                    3. Configurações do Anúncio
                  </h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4 md:col-span-2">
                    <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest ml-1 flex items-center justify-between">
                      Estilo do Anúncio
                      <span className="text-[9px] bg-green-100 text-green-600 dark:text-green-400 px-2 py-0.5 rounded-full">
                        RECOMENDADO
                      </span>
                    </label>
                    <div className="relative">
                      <select
                        // UX11: faltava text color + o `focus:bg-white` sem
                        // par `dark:focus:bg-X` deixava o select branco-no-
                        // branco no dark quando o user selecionava uma opção.
                        // `dark:bg-gray-900/80` no final do className antigo
                        // era classe duplicada — colocamos a versão correta:
                        // bg base + bg focus por tema, e text color em ambos.
                        className={
                          'w-full p-4 rounded-2xl border-2 border-gray-200 dark:border-gray-800 outline-none transition-all text-sm font-bold appearance-none bg-gray-50 dark:bg-gray-800/60 text-gray-900 dark:text-gray-100 focus:border-blue-600 focus:bg-white dark:focus:bg-gray-900/80' +
                          redRing('estiloAnuncio')
                        }
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
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none"
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
                  const level = answers.awarenessLevel || '';
                  const estilo = answers.estiloAnuncio || '';
                  if (qId === 'angleIdea') return recommendedAnglesFor(level).includes(val);
                  if (qId === 'emotion') return recommendedEmotionsFor(level, estilo).includes(val);
                  return false;
                };

                return (
                  <div
                    key={section.title}
                    className="space-y-6 bg-white dark:bg-gray-900/80 p-8 rounded-[40px] border-2 border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-8 h-8 bg-blue-600 text-white rounded-xl flex items-center justify-center text-xs font-black">
                        {sIdx + 4}
                      </div>
                      <h4 className="font-black text-gray-900 dark:text-gray-50 text-lg tracking-tight uppercase">
                        {sIdx + 4}. {section.title}
                      </h4>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {(section.questions || []).map((q: any) => {
                        if (q.condition && !q.condition(config.copy.answers)) return null;

                        return (
                          <div key={q.id} className={'space-y-2' + redRing(q.id)}>
                            <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest ml-1 flex items-center justify-between">
                              {q.label}
                              {q.type === 'select' &&
                                config.copy.answers[q.id] &&
                                isRecommended(q.id, config.copy.answers[q.id]) && (
                                  <span className="text-[9px] bg-green-100 text-green-600 dark:text-green-400 px-2 py-0.5 rounded-full">
                                    Recomendado
                                  </span>
                                )}
                            </label>
                            {q.type === 'select' ? (
                              <div className="relative">
                                <select
                                  className="w-full p-4 rounded-2xl border-2 border-gray-200 dark:border-gray-800 outline-none transition-all text-sm font-bold appearance-none bg-gray-50 dark:bg-gray-800/60 focus:border-blue-600 focus:bg-white dark:focus:bg-gray-900/80"
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
                                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none"
                                  size={16}
                                />
                              </div>
                            ) : q.type === 'date' ? (
                              <input
                                type="date"
                                className="w-full p-4 rounded-2xl border-2 border-gray-200 dark:border-gray-800 focus:border-blue-600 focus:bg-white dark:focus:bg-gray-900/80 outline-none transition-all text-sm font-bold bg-gray-50 dark:bg-gray-800/60 uppercase"
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
                                className="w-full p-4 rounded-2xl border-2 border-gray-200 dark:border-gray-800 focus:border-blue-600 focus:bg-white dark:focus:bg-gray-900/80 outline-none transition-all text-sm font-bold bg-gray-50 dark:bg-gray-800/60"
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
                                className="w-full p-4 rounded-2xl border-2 border-gray-200 dark:border-gray-800 focus:border-blue-600 focus:bg-white dark:focus:bg-gray-900/80 outline-none transition-all text-sm font-bold bg-gray-50 dark:bg-gray-800/60"
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
              <div className="space-y-6 bg-white dark:bg-gray-900/80 p-8 rounded-[40px] border-2 border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 bg-blue-600 text-white rounded-xl flex items-center justify-center text-xs font-black">
                    {sections.length + 3}
                  </div>
                  <h4 className="font-black text-gray-900 dark:text-gray-50 text-lg tracking-tight uppercase">
                    {sections.length + 3}. Destino do Clique
                  </h4>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest ml-1">
                    {isVsl ? 'Para onde leva o CTA da VSL?' : 'Para onde vai ao clicar?'}
                  </label>
                  <div
                    className={
                      'space-y-2 rounded-2xl' + amberRing(!!config.copy.answers.clickDestination)
                    }
                  >
                    {(isVsl
                      ? [
                          {
                            id: 'oferta',
                            emoji: '🛒',
                            label: 'Botão da oferta',
                            desc: 'CTA "quero acesso" — leva direto pra compra do produto',
                            levels: [] as string[],
                          },
                          {
                            id: 'checkout',
                            emoji: '⚡',
                            label: 'Checkout direto',
                            desc: 'Compra imediata, sem página intermediária',
                            levels: [] as string[],
                          },
                          {
                            id: 'inscricao',
                            emoji: '📋',
                            label: 'Inscrição / lista de espera',
                            desc: 'Quando o carrinho ainda vai abrir',
                            levels: [] as string[],
                          },
                          {
                            id: 'whatsapp',
                            emoji: '💬',
                            label: 'WhatsApp / grupo',
                            desc: 'Fechar a venda no atendimento',
                            levels: [] as string[],
                          },
                        ]
                      : [
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
                        ]
                    ).map((destino) => {
                      const currentLevel = (config.copy.answers.awarenessLevel || '').charAt(0);
                      const isRecommended = !isVsl && destino.levels.includes(currentLevel);
                      return (
                        <button
                          key={destino.id}
                          onClick={() =>
                            updateConfig('copy', 'answers', 'clickDestination', destino.id)
                          }
                          className={`w-full p-3 rounded-2xl border-2 text-left transition-all flex items-center gap-3 ${
                            config.copy.answers.clickDestination === destino.id
                              ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40'
                              : 'border-gray-200 dark:border-gray-800 hover:border-blue-200'
                          }`}
                        >
                          <span className="text-xl">{destino.emoji}</span>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-bold text-gray-900 dark:text-gray-50">
                                {destino.label}
                              </p>
                              {isRecommended && (
                                <span className="text-[10px] bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 font-bold px-2 py-0.5 rounded-full">
                                  ⭐
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-gray-400 dark:text-gray-500">
                              {destino.desc}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* UX24-A: campo "Descreva o destino" — substitui o
                      "Outro destino (opcional)" que era confusamente
                      posicionado como ALTERNATIVA aos botões. Agora é
                      uma DESCRIÇÃO do destino escolhido, sempre visível,
                      pra IA saber o que vai ter lá e não inventar
                      "apresentação curta", "vídeo rápido", etc.
                      Escondido na VSL: lá o destino é sempre o botão da oferta. */}
                  {!isVsl && (
                  <div className="mt-4 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <label className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest">
                        Descreva o destino do clique
                        <span className="ml-2 text-amber-600 dark:text-amber-400 normal-case tracking-normal">
                          (recomendado — evita IA inventar formato)
                        </span>
                      </label>
                      {productInfo && (
                        <button
                          type="button"
                          onClick={handleAutoFillDestination}
                          disabled={isAutoFillingDestination}
                          className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-[10px] font-black uppercase tracking-widest transition-all"
                          title="Usa a Fonte do Produto pra descrever o destino"
                        >
                          {isAutoFillingDestination ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Sparkles size={12} />
                          )}
                          Preencher do projeto
                        </button>
                      )}
                    </div>
                    <AutoResizeTextarea
                      placeholder={
                        isVsl
                          ? 'Ex: Botão logo abaixo do vídeo escrito "QUERO ACESSO AO CURSO". Leva pro checkout do produto (curso completo + bônus). CTA da VSL deve mandar a pessoa clicar no botão da oferta e garantir a vaga agora.'
                          : "Ex: Live gratuita de 1h onde um pesquisador conta como criou a vitamina amarela pra ajudar a mãe com neuropatia. Aparecem ele, a mãe e um host. Tom: depoimento de família. NÃO chamar de 'apresentação curta', 'vídeo rápido' ou 'audio'."
                      }
                      value={config.copy.answers.destinationDescription || ''}
                      onChange={(e: any) =>
                        updateConfig('copy', 'answers', 'destinationDescription', e.target.value)
                      }
                      className="w-full p-3 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-800 text-sm outline-none focus:border-blue-400 min-h-[80px]"
                    />
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 italic">
                      A IA vai usar essa descrição literalmente pra falar do destino. Diga formato,
                      quem aparece, sobre o que falam, e o que NÃO chamar.
                    </p>
                  </div>
                  )}
                </div>
              </div>

              {/* SEÇÃO — Estratégia da Copy. Só no anúncio: a VSL SEMPRE vende o
                  produto nela mesma, então essa escolha não faz sentido. */}
              {!isVsl && (
              <div
                className={
                  'space-y-6 bg-white dark:bg-gray-900/80 p-8 rounded-[40px] border-2 border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-md transition-shadow' +
                  amberRing(!!config.copy.answers.copyStrategy)
                }
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 bg-blue-600 text-white rounded-xl flex items-center justify-center text-xs font-black">
                    {sections.length + 4}
                  </div>
                  <h4 className="font-black text-gray-900 dark:text-gray-50 text-lg tracking-tight uppercase">
                    {sections.length + 4}. Estratégia da Copy
                  </h4>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest ml-1">
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
                            ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40'
                            : 'border-gray-200 dark:border-gray-800 hover:border-blue-200'
                        }`}
                      >
                        <div className="flex items-center gap-3 mb-2">
                          <span className="text-2xl">{strat.emoji}</span>
                          <p className="font-black text-gray-900 dark:text-gray-50 uppercase tracking-tight text-sm">
                            {strat.label}
                          </p>
                        </div>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 font-medium mb-3 leading-relaxed">
                          {strat.desc}
                        </p>
                        <ul className="space-y-1">
                          {strat.bullets.map((b) => (
                            <li
                              key={b}
                              className="text-[10px] text-gray-400 dark:text-gray-500 font-bold flex items-start gap-1.5"
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
                    <p className="text-[10px] text-blue-600 dark:text-blue-400 font-bold uppercase tracking-widest mt-2 ml-1">
                      Padrão: Criar curiosidade (tráfego pra VSL). Escolha "Vender no próprio ad" só se o ad leva direto pra página de vendas.
                    </p>
                  )}
                </div>
              </div>
              )}

              {/* UX24-B: SEÇÃO — Evite mencionar (avoid list)
                  Vai pro PROHIBITED block do prompt principal. Cada termo
                  (vírgula, nova linha ou ;) vira uma regra "NEVER use X".
                  Útil pra cortar clichês recorrentes ou termos que o
                  modelo continua puxando do training data. */}
              <div
                className={
                  'space-y-4 bg-white dark:bg-gray-900/80 p-8 rounded-[40px] border-2 border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-md transition-shadow' +
                  amberRing(!!config.copy.answers.avoidList)
                }
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 bg-red-600 text-white rounded-xl flex items-center justify-center text-xs font-black">
                    !
                  </div>
                  <h4 className="font-black text-gray-900 dark:text-gray-50 text-lg tracking-tight uppercase">
                    Evite mencionar
                    <span className="ml-2 text-[10px] text-gray-400 dark:text-gray-500 normal-case tracking-normal">
                      (opcional)
                    </span>
                  </h4>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest ml-1">
                    Palavras / frases / formatos que a IA NUNCA pode usar
                  </label>
                  <AutoResizeTextarea
                    placeholder="Ex: podcast, apresentação curta, vídeo rápido, áudio, ofereço, garantia de devolução"
                    value={config.copy.answers.avoidList || ''}
                    onChange={(e: any) =>
                      updateConfig('copy', 'answers', 'avoidList', e.target.value)
                    }
                    className="w-full p-3 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-800 text-sm outline-none focus:border-red-400 min-h-[60px]"
                  />
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 italic">
                    Separe por vírgula. Vira regra dura no prompt — a IA não pode usar nada daqui no
                    texto final.
                  </p>
                </div>
              </div>

              {/* SEÇÃO — Termos obrigatórios + Produto inovador ("truque especial")
                  mandatoryTerms → REQUIRED TERMS no prompt (oposto do avoidList).
                  innovativeProductName → nome do "produto inovador"/gancho de
                  curiosidade (ex: "yellow vitamin", "truque da banana"). Ambos
                  opcionais; vão pra config.copy.answers e fluem pro gerador. */}
              <div
                className={
                  'space-y-6 bg-white dark:bg-gray-900/80 p-8 rounded-[40px] border-2 border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-md transition-shadow' +
                  amberRing(
                    !!config.copy.answers.mandatoryTerms ||
                      !!config.copy.answers.innovativeProductName
                  )
                }
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 bg-emerald-600 text-white rounded-xl flex items-center justify-center text-xs font-black">
                    ★
                  </div>
                  <h4 className="font-black text-gray-900 dark:text-gray-50 text-lg tracking-tight uppercase">
                    Termos obrigatórios &amp; produto inovador
                    <span className="ml-2 text-[10px] text-gray-400 dark:text-gray-500 normal-case tracking-normal">
                      (opcional)
                    </span>
                  </h4>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest ml-1">
                    Palavras / termos que a copy TEM que conter
                  </label>
                  <AutoResizeTextarea
                    placeholder='Ex: "yellow vitamin", neuropathy, Dr. Moore, 30 segundos'
                    value={config.copy.answers.mandatoryTerms || ''}
                    onChange={(e: any) =>
                      updateConfig('copy', 'answers', 'mandatoryTerms', e.target.value)
                    }
                    className="w-full p-3 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-800 text-sm outline-none focus:border-emerald-400 min-h-[60px]"
                  />
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 italic">
                    Separe por vírgula. Vira regra dura no prompt — a IA é obrigada a usar cada termo
                    no texto final (encaixados de forma natural).
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest ml-1">
                      Nome do "produto inovador" / truque especial
                    </label>
                    <button
                      onClick={() => runGenInnovative(false)}
                      disabled={isGenInnovative}
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-black uppercase tracking-widest disabled:opacity-50 transition-all"
                      title="A IA cria um gancho de curiosidade (estilo 'yellow vitamin'). Re-gere quantas vezes quiser, ou escreva o seu."
                    >
                      {isGenInnovative ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Sparkles size={12} />
                      )}
                      {isGenInnovative
                        ? 'Gerando...'
                        : config.copy.answers.innovativeProductName
                          ? 'Re-gerar'
                          : 'Gerar'}
                    </button>
                  </div>
                  <input
                    type="text"
                    placeholder='Ex: "yellow vitamin", "truque da banana", "5-second ritual"'
                    value={config.copy.answers.innovativeProductName || ''}
                    onChange={(e: any) =>
                      updateConfig('copy', 'answers', 'innovativeProductName', e.target.value)
                    }
                    className="w-full p-3 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-800 text-sm outline-none focus:border-emerald-400"
                  />
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 italic">
                    A IA vai usar esse nome como gancho de curiosidade — cita o nome pra intrigar, mas
                    NUNCA explica o que é (isso fica no vídeo).
                  </p>
                </div>
              </div>

              {/* SEÇÃO — Narrador (quem conta a história em 1ª pessoa)
                  answers.narrator → bloco no CONTEXT do prompt. Decidido no
                  planejamento (vem do brief) e auto-preenchido aqui. Faz a copy
                  segurar UMA voz e não oscilar entre "eu tenho" e "cuidei de
                  alguém". Editável. */}
              <div
                className={
                  'space-y-4 bg-white dark:bg-gray-900/80 p-8 rounded-[40px] border-2 border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-md transition-shadow' +
                  amberRing(!!config.copy.answers.narrator)
                }
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 bg-emerald-600 text-white rounded-xl flex items-center justify-center text-xs font-black">
                    🎙
                  </div>
                  <h4 className="font-black text-gray-900 dark:text-gray-50 text-lg tracking-tight uppercase">
                    Quem conta a história
                    <span className="ml-2 text-[10px] text-gray-400 dark:text-gray-500 normal-case tracking-normal">
                      (auto pelo plano · editável)
                    </span>
                  </h4>
                  <button
                    onClick={handleGenNarrator}
                    disabled={isGenNarrator}
                    className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-black uppercase tracking-widest disabled:opacity-50 transition-all"
                    title="A IA escolhe o narrador mais convincente. Pode clicar de novo pra re-gerar, ou escrever o seu no campo."
                  >
                    {isGenNarrator ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Sparkles size={12} />
                    )}
                    {isGenNarrator
                      ? 'Gerando...'
                      : config.copy.answers.narrator
                        ? 'Re-gerar'
                        : 'Gerar narrador'}
                  </button>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest ml-1">
                    Quem narra — quem é, idade, relação com o problema (não precisa ser 1ª pessoa)
                  </label>
                  <AutoResizeTextarea
                    placeholder={'Ex: Sofredor de 58 anos que conviveu 6 anos com a dor até achar a resposta\nEx: Filha que cuidou do pai com neuropatia e foi atrás da causa\nEx: Um pesquisador que reúne histórias de quem viveu isso (3ª pessoa)'}
                    value={config.copy.answers.narrator || ''}
                    onChange={(e: any) =>
                      updateConfig('copy', 'answers', 'narrator', e.target.value)
                    }
                    className="w-full p-3 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-800 text-sm outline-none focus:border-emerald-400 min-h-[64px]"
                  />
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 italic">
                    Pode ser quem viveu, um cuidador, um profissional, ou alguém contando histórias
                    de outros (3ª pessoa). É UMA voz só, mantida do início ao fim. Edite ou re-gere
                    se quiser outra.
                  </p>
                </div>
              </div>

              {/* SEÇÃO — Estatísticas / dados (grounded)
                  answers.statistics → bloco GROUNDED STATISTICS no prompt.
                  São os ÚNICOS números que a IA pode afirmar como fato (junto
                  com os que já estão na fonte do produto). Sem isso, a IA é
                  proibida de inventar estatística — faz o ponto qualitativo.
                  (O botão "Buscar no Google" — fonte confiável — vem depois,
                  precisa de web search no servidor.) */}
              <div
                className={
                  'space-y-4 bg-white dark:bg-gray-900/80 p-8 rounded-[40px] border-2 border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-md transition-shadow' +
                  amberRing(!!config.copy.answers.statistics)
                }
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 bg-indigo-600 text-white rounded-xl flex items-center justify-center text-xs font-black">
                    %
                  </div>
                  <h4 className="font-black text-gray-900 dark:text-gray-50 text-lg tracking-tight uppercase">
                    Estatísticas &amp; dados
                    <span className="ml-2 text-[10px] text-gray-400 dark:text-gray-500 normal-case tracking-normal">
                      (opcional)
                    </span>
                  </h4>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest ml-1">
                    Números reais que a copy pode usar (com a fonte, se tiver)
                  </label>
                  <AutoResizeTextarea
                    placeholder={'Ex: 90% dos adultos 50+ têm algum grau de degeneração nervosa (fonte: ...)\n48.000 pessoas já usam\nligado a maior risco de demência e doença cardíaca (estudo X)'}
                    value={config.copy.answers.statistics || ''}
                    onChange={(e: any) =>
                      updateConfig('copy', 'answers', 'statistics', e.target.value)
                    }
                    className="w-full p-3 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-800 text-sm outline-none focus:border-indigo-400 min-h-[80px]"
                  />
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 italic">
                    Um por linha. A IA só pode afirmar números que estejam aqui ou na fonte do produto
                    — sem isso, ela não inventa estatística. Ligação com doença sai só como "ligado
                    a / aumenta o risco", nunca "você tem / vai ter".
                  </p>
                </div>

                {/* Não tem números? Busca na web com fonte (item 2). Nunca
                    auto-injeta — o cliente revisa cada um e clica "Adicionar". */}
                <div className="space-y-3 pt-1">
                  <button
                    type="button"
                    onClick={handleFindStatistics}
                    disabled={isFindingStats}
                    className="text-xs font-bold px-4 py-2 rounded-xl border-2 border-indigo-200 dark:border-indigo-900 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors disabled:opacity-50"
                  >
                    {isFindingStats ? '🔍 Buscando na web...' : '🔍 Não tenho números — buscar com fonte'}
                  </button>

                  {statFindings && statFindings.length > 0 && (
                    <div className="space-y-2 bg-indigo-50/60 dark:bg-indigo-950/20 p-4 rounded-2xl border border-indigo-100 dark:border-indigo-900">
                      <p className="text-[10px] font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-widest">
                        Estatísticas com fonte — revise antes de usar
                      </p>
                      {statFindings.map((s, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-3 bg-white dark:bg-gray-900/60 p-3 rounded-xl border border-indigo-100 dark:border-indigo-900/60"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-800 dark:text-gray-100">{s.stat}</p>
                            <a
                              href={s.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline break-all"
                            >
                              {s.source || 'fonte'}
                              {s.year ? ` (${s.year})` : ''} ↗
                            </a>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleAddStat(s)}
                            className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
                          >
                            Adicionar
                          </button>
                        </div>
                      ))}
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 italic">
                        Confira a fonte antes de adicionar. Só números com fonte real aparecem aqui — nada inventado.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* SEÇÃO 9 — Call to Action */}
              <div className="space-y-6 bg-white dark:bg-gray-900/80 p-8 rounded-[40px] border-2 border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 bg-blue-600 text-white rounded-xl flex items-center justify-center text-xs font-black">
                    {sections.length + 4}
                  </div>
                  <h4 className="font-black text-gray-900 dark:text-gray-50 text-lg tracking-tight uppercase">
                    {sections.length + 4}. Call to Action (CTA)
                  </h4>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest ml-1">
                    Como o viewer deve agir ao final do anúncio?
                  </label>
                  <div className="space-y-3">
                    <button
                      onClick={() => updateConfig('copy', 'answers', 'ctaMode', 'auto')}
                      className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${
                        config.copy.answers.ctaMode === 'auto' || !config.copy.answers.ctaMode
                          ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40'
                          : 'border-gray-200 dark:border-gray-800 hover:border-blue-200'
                      }`}
                    >
                      <p className="text-sm font-bold text-gray-900 dark:text-gray-50">
                        ✨ Deixar a IA criar o CTA
                      </p>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                        A IA vai criar o melhor CTA baseado no nível de consciência e destino do
                        clique
                      </p>
                    </button>

                    <button
                      onClick={() => updateConfig('copy', 'answers', 'ctaMode', 'custom')}
                      className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${
                        config.copy.answers.ctaMode === 'custom'
                          ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40'
                          : 'border-gray-200 dark:border-gray-800 hover:border-blue-200'
                      }`}
                    >
                      <p className="text-sm font-bold text-gray-900 dark:text-gray-50">
                        ✏️ Escrever meu próprio CTA
                      </p>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
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
                        className="w-full mt-1 p-3 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-800 text-sm outline-none focus:border-blue-400"
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {config.copy.mode !== 'as-is' && (
            <div className="bg-white dark:bg-gray-900/80 p-8 rounded-[40px] border-2 border-gray-200 dark:border-gray-800 shadow-xl space-y-8 mt-12">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-blue-50 dark:bg-blue-950/40 rounded-xl flex items-center justify-center text-blue-600 dark:text-blue-400">
                  <Maximize size={20} />
                </div>
                <div>
                  <h4 className="font-black text-gray-900 dark:text-gray-50 uppercase tracking-widest text-xs">
                    Tamanho do Roteiro
                  </h4>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-widest">
                    Defina a extensão ideal para seu anúncio
                  </p>
                </div>
              </div>

              <div className="space-y-6">
                {/* Quando o subprojeto veio de um brief do PLANO, a recomendação
                    bate com a durationTarget daquele criativo específico (não só
                    com o awareness). O plano manda. */}
                {activeBrief?.durationTarget ? (
                  <div className="space-y-3 animate-in fade-in slide-in-from-top-4 duration-500">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="bg-purple-600 text-white rounded-full p-1 shadow-md shadow-purple-100">
                        <Star size={10} fill="currentColor" />
                      </div>
                      <span className="text-[10px] font-black text-purple-600 dark:text-purple-400 uppercase tracking-widest">
                        Recomendado pelo plano de marketing
                      </span>
                    </div>
                    <div className="p-6 bg-purple-50/50 dark:bg-purple-950/40 rounded-3xl border-2 border-purple-100 dark:border-purple-900 shadow-sm hover:shadow-md transition-all">
                      <h5 className="text-2xl font-black text-purple-900 dark:text-purple-200 mb-2">
                        {activeBrief.durationTarget}s
                      </h5>
                      <p className="text-sm font-medium text-purple-800 dark:text-purple-300/70 leading-relaxed italic">
                        "Este criativo do seu plano foi pensado para {activeBrief.durationTarget}s —
                        ângulo {activeBrief.angle}. Manter a duração alinha o roteiro com a estratégia."
                      </p>
                    </div>
                  </div>
                ) : (
                  getRecomendacaoTempo(config.copy.answers.awarenessLevel) && (
                    <div className="space-y-3 animate-in fade-in slide-in-from-top-4 duration-500">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="bg-green-600 text-white rounded-full p-1 shadow-md shadow-green-100">
                          <Star size={10} fill="currentColor" />
                        </div>
                        <span className="text-[10px] font-black text-green-600 dark:text-green-400 uppercase tracking-widest">
                          Recomendado para o seu público
                        </span>
                      </div>
                      <div className="p-6 bg-blue-50/50 dark:bg-blue-950/40 rounded-3xl border-2 border-blue-100 dark:border-blue-900 shadow-sm hover:shadow-md transition-all">
                        <h5 className="text-2xl font-black text-blue-900 dark:text-blue-200 mb-2">
                          {getRecomendacaoTempo(config.copy.answers.awarenessLevel)?.faixaSegundos}
                        </h5>
                        <p className="text-sm font-medium text-blue-800 dark:text-blue-300/70 leading-relaxed italic">
                          "{getRecomendacaoTempo(config.copy.answers.awarenessLevel)?.frase}"
                        </p>
                      </div>
                    </div>
                  )
                )}

                <div className="space-y-4">
                  <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest ml-1">
                    {isVsl ? 'Duração da VSL' : 'Selecione a Duração Alvo'}
                  </label>

                  <div className={`grid grid-cols-4 ${isVsl ? 'sm:grid-cols-8' : 'sm:grid-cols-9'} gap-2`}>
                    {(isVsl ? VSL_DURATION_OPTIONS : DURATION_OPTIONS).map((opt: any) => {
                      // Marca a duração recomendada pelo brief do plano (★). Só no
                      // modo anúncio — o brief planeja durações de anúncio (em s).
                      const isPlanRec =
                        !isVsl &&
                        !!activeBrief?.durationTarget &&
                        opt.label === `${activeBrief.durationTarget}s`;
                      return (
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
                          className={`relative py-3 px-1 rounded-xl border-2 transition-all text-xs font-black uppercase tracking-tighter ${
                            config.copy.targetWordCount === opt.words
                              ? 'border-blue-600 bg-blue-600 text-white shadow-lg shadow-blue-100 scale-105'
                              : isPlanRec
                                ? 'border-purple-400 dark:border-purple-600 bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300'
                                : 'border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 text-gray-600 dark:text-gray-400 hover:border-blue-200 hover:bg-white dark:hover:bg-gray-900/80'
                          }`}
                        >
                          {isPlanRec && (
                            <span className="absolute -top-1.5 -right-1.5 text-[9px]">★</span>
                          )}
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/60 rounded-2xl border border-gray-200 dark:border-gray-800">
                    <div className="flex items-center gap-3">
                      <p className="text-sm font-bold text-gray-600 dark:text-gray-400">
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
            <div className="flex flex-col items-center mt-12 gap-3">
              {/* UX25-A2: pre-flight check — aparece quando há campos
                  fracos. Não bloqueia, só avisa. */}
              {preflightIssues.length > 0 && (
                <PreflightCheckPanel
                  issues={preflightIssues}
                  onEnrichWithAI={productInfo ? handleFillFromSource : undefined}
                />
              )}

              {/* UX23-F: painel de referências + slider de similaridade.
                  Só aparece quando user marcou pelo menos 1 copy como
                  referência. Slider persiste em config.copy.referenceSimilarity. */}
              {referenceCopyIds.length > 0 && (
                <ReferenceSimilarityPanel
                  selectedCount={referenceCopyIds.length}
                  similarity={referenceSimilarity}
                  onChangeSimilarity={handleChangeSimilarity}
                  lastUsed={lastUsedReferences}
                  onOpenLibrary={() => setShowLibraryModal(true)}
                  onShowLastUsed={() => setShowLastUsedModal(true)}
                />
              )}

              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  onClick={handleGenerateCopy}
                  disabled={loading || isGeneratingVariants}
                  className="px-12 py-8 bg-blue-700 text-white rounded-[32px] font-black text-2xl flex items-center justify-center gap-4 shadow-xl shadow-blue-200/60 dark:shadow-blue-900/30 hover:bg-blue-800 transition-all hover:scale-[1.02] active:scale-95 ring-8 ring-blue-500/10 border-4 border-blue-400/20 disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2 className="animate-spin" size={32} />
                  ) : (
                    <Sparkles size={32} className="animate-pulse" />
                  )}
                  {config.copy.generatedScript ? '✨ Regerar Copy com IA' : '✨ Gerar Copy com IA'}
                </button>
                {/* UX15: variants A/B — gera 2 versões em paralelo */}
                <button
                  onClick={handleGenerateVariants}
                  disabled={loading || isGeneratingVariants}
                  className="px-6 py-6 bg-white dark:bg-gray-900/80 text-gray-900 dark:text-gray-100 border-2 border-gray-300 dark:border-gray-700 rounded-[32px] font-black text-sm uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-all disabled:opacity-50"
                  title="Gera 2 versões diferentes pra você escolher — custa 2x o normal"
                >
                  {isGeneratingVariants ? (
                    <Loader2 className="animate-spin" size={18} />
                  ) : (
                    <Sparkles size={18} />
                  )}
                  Gerar 2 versões
                </button>
                {/* UX20: botão Biblioteca movido pra cá — perto do "Gerar Copy"
                    em vez de no topo da página */}
                <button
                  onClick={() => setShowLibraryModal(true)}
                  className="px-6 py-6 bg-white dark:bg-gray-900/80 text-gray-900 dark:text-gray-100 border-2 border-gray-300 dark:border-gray-700 rounded-[32px] font-black text-sm uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-all"
                  title="Adiciona/edita copies de referência que a IA usa pra gerar melhor"
                >
                  <Library size={18} />
                  Biblioteca ({personalLibrary.length})
                </button>
              </div>

              {/* UX25-A4 + C1 + C2: linha de controles secundários abaixo dos
                  3 botões principais. Toggle Rascunho/Final + chip de custo
                  da última geração + botão "Ver prompt enviado". */}
              <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
                {/* Toggle modo Rascunho (Sonnet) vs Final (Opus) */}
                <button
                  onClick={handleToggleDraftMode}
                  className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl ring-1 text-[10px] font-black uppercase tracking-widest transition-all ${
                    draftMode
                      ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 ring-amber-300 dark:ring-amber-800/60'
                      : 'bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300 ring-purple-300 dark:ring-purple-800/60'
                  }`}
                  title={
                    draftMode
                      ? 'Modo Rascunho: Sonnet 4.6 — rápido (~3s), barato. Bom pra iterar.'
                      : 'Modo Final: Opus 4.7 — premium (~15s), melhor qualidade.'
                  }
                >
                  <Zap size={12} />
                  {draftMode ? 'Rascunho · Sonnet' : 'Final · Opus'}
                </button>

                {/* Chip de custo da última geração */}
                {lastDebug && (
                  <div className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-100 dark:bg-gray-800/60 text-gray-700 dark:text-gray-300 text-[10px] font-black uppercase tracking-widest ring-1 ring-gray-200 dark:ring-gray-700">
                    Última: ~${lastDebug.estimatedCost.toFixed(4)} · {lastDebug.model.toUpperCase()}
                  </div>
                )}

                {/* Botão "Ver prompt enviado" — só visível se já houve geração */}
                {lastDebug && (
                  <button
                    onClick={() => setShowDebugModal(true)}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-[10px] font-black uppercase tracking-widest hover:bg-black dark:hover:bg-white transition-all"
                    title="Mostra o prompt EXATO que foi enviado ao Claude"
                  >
                    <Terminal size={12} />
                    Ver prompt
                  </button>
                )}

                {/* UX25-B2: botão Histórico — visível se há ao menos 1 geração */}
                {history.length > 0 && (
                  <button
                    onClick={() => setShowHistoryModal(true)}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-200 dark:ring-indigo-800/60 text-[10px] font-black uppercase tracking-widest hover:bg-indigo-200 dark:hover:bg-indigo-900/40 transition-all"
                    title="Últimas 5 versões geradas — pra restaurar versão anterior"
                  >
                    <History size={12} />
                    Histórico ({history.length})
                  </button>
                )}
              </div>

              <p className="text-[10px] text-gray-400 dark:text-gray-500 italic">
                Tip: "Gerar 2 versões" duplica o custo · "Biblioteca" são copies que a IA usa como
                referência pra calibrar o estilo · Modo Rascunho usa Sonnet (mais barato) pra iterar
                antes do Final.
              </p>
            </div>
          )}

          {/* UX15: picker das 2 variantes geradas em paralelo */}
          {variants && variants.length > 0 && (
            <div className="mt-8 space-y-4">
              <div className="text-center space-y-1">
                <h3 className="text-2xl font-black text-gray-900 dark:text-gray-50">
                  Escolha a versão que prefere
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  As duas usam o mesmo brief — variações naturais do modelo.
                </p>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {variants.map((v, idx) => (
                  <div
                    key={idx}
                    className="bg-white dark:bg-gray-900/80 rounded-3xl border-2 border-gray-200 dark:border-gray-800 p-6 space-y-4 flex flex-col"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">
                        Versão {String.fromCharCode(65 + idx)}
                      </span>
                      <span className="text-[10px] text-gray-400 dark:text-gray-500">
                        {v.script.split(/\s+/).filter(Boolean).length} palavras
                      </span>
                    </div>
                    <pre className="flex-1 text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap font-mono max-h-[400px] overflow-y-auto">
                      {v.script}
                    </pre>
                    <button
                      onClick={() => handlePickVariant(v.script)}
                      className="w-full py-3 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-black dark:hover:bg-white transition-all"
                    >
                      Usar Versão {String.fromCharCode(65 + idx)}
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-center gap-4">
                {/* UX25-B3: botão "Comparar A vs B" com diff highlight */}
                {variants.length === 2 && (
                  <button
                    onClick={() => setShowCompareModal(true)}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 ring-1 ring-purple-200 dark:ring-purple-800/60 text-[10px] font-black uppercase tracking-widest hover:bg-purple-200 dark:hover:bg-purple-900/40 transition-all"
                  >
                    Comparar A vs B (diff)
                  </button>
                )}
                <button
                  onClick={() => setVariants(null)}
                  className="text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                >
                  Descartar ambas
                </button>
              </div>
            </div>
          )}

          {config.copy.generatedScript && (
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-8 mt-16"
            >
              <div className="grid grid-cols-1 gap-6">
                {/* UX13: banner de risco. Aparece quando scan detecta termos
                    arriscados (medicamento concorrente, celebridade, slur,
                    cura definitiva, etc) E o user ainda nao deu ack. */}
                {showRiskBanner && scanResult.maxSeverity && (
                  <ContentRiskBanner
                    hits={scanResult.hits}
                    maxSeverity={scanResult.maxSeverity}
                    isRewriting={isRewriting}
                    onRewrite={handleRewriteSafe}
                    onAcknowledge={handleAcknowledgeRisk}
                  />
                )}

                {/* UX25-A3: banner de alucinações detectadas via Claude */}
                {hallucinationFlags && hallucinationFlags.length > 0 && (
                  <HallucinationBanner
                    flags={hallucinationFlags}
                    onDismiss={() => setHallucinationFlags(null)}
                  />
                )}

                {/* Quick-fix: trocar autoridades nomeadas por âncora genérica */}
                {authorityFlags && authorityFlags.length > 0 && (
                  <AuthorityAnchorBanner
                    flags={authorityFlags}
                    onApply={handleApplyAnchor}
                    onApplyAll={handleApplyAllAnchors}
                    onDismiss={() => setAuthorityFlags(null)}
                  />
                )}

                {/* Botões de checagem da copy gerada */}
                {(!authorityFlags || (productInfo && !hallucinationFlags)) && (
                  <div className="flex justify-end gap-2 flex-wrap">
                    {/* Quick-fix: generalizar autoridades nomeadas */}
                    {!authorityFlags && (
                      <button
                        onClick={handleCheckAuthorities}
                        disabled={isCheckingAuthorities}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-50 dark:bg-blue-950/30 ring-1 ring-blue-300 dark:ring-blue-800/60 text-blue-700 dark:text-blue-300 text-[10px] font-black uppercase tracking-widest hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-all disabled:opacity-50"
                        title="Acha instituições/autoridades nomeadas (ex.: 'Instituto Karolinska na Suécia') e oferece trocar por âncora genérica. Nomes que estão na Fonte do Produto são mantidos."
                      >
                        {isCheckingAuthorities ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          '🏛️'
                        )}
                        Generalizar autoridades
                      </button>
                    )}
                    {/* UX25-A3: botão "Checar alucinações" — só visível quando
                        tem productInfo (fonte) configurada */}
                    {productInfo && !hallucinationFlags && (
                      <button
                        onClick={handleCheckHallucinations}
                        disabled={isCheckingHallucinations}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-orange-50 dark:bg-orange-950/30 ring-1 ring-orange-300 dark:ring-orange-800/60 text-orange-700 dark:text-orange-300 text-[10px] font-black uppercase tracking-widest hover:bg-orange-100 dark:hover:bg-orange-900/40 transition-all disabled:opacity-50"
                        title="Compara a copy gerada com a Fonte do Produto e flagra claims sem suporte"
                      >
                        {isCheckingHallucinations ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          '🔬'
                        )}
                        Checar alucinações
                      </button>
                    )}
                  </div>
                )}
                {config.copy.finalScript && (
                  <div className="bg-green-50 dark:bg-green-950/40 p-6 rounded-[32px] border-2 border-green-100 flex items-center justify-between gap-6 animate-in fade-in slide-in-from-top-4 duration-500">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-green-600 text-white rounded-2xl">
                        <CheckCircle2 size={24} />
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-green-600 dark:text-green-400 uppercase tracking-widest mb-1">
                          Cópia Final Salva
                        </p>
                        <p className="text-sm font-bold text-gray-900 dark:text-gray-50 line-clamp-1 opacity-70">
                          A copy completa com hook e script foi salva.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(config.copy.finalScript || '');
                        toast.success('Cópia copiada!');
                      }}
                      className="px-6 py-2 bg-white dark:bg-gray-900/80 text-green-600 dark:text-green-400 rounded-xl text-[10px] font-black uppercase tracking-widest border border-green-100 hover:bg-green-100 transition-all whitespace-nowrap"
                    >
                      Copiar
                    </button>
                  </div>
                )}

                {config.copy.generatedScript && (
                  <div className="bg-white dark:bg-gray-900/80 p-8 rounded-[40px] border-2 border-gray-200 dark:border-gray-800 shadow-xl space-y-6">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Edit3 className="text-blue-600 dark:text-blue-400" size={20} />
                        <h4 className="font-black text-gray-900 dark:text-gray-50 uppercase tracking-widest text-xs">
                          Copy Original
                        </h4>
                      </div>
                      <div className="flex items-center gap-3 flex-wrap">
                        {/* UX18: salva na biblioteca pessoal pra IA usar de referência */}
                        <button
                          onClick={handleSaveAsExample}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-all"
                          title="Adiciona esta copy à sua biblioteca pessoal — IA usará como referência nas próximas gerações"
                        >
                          <BookmarkPlus size={12} />
                          Marcar como copy boa
                        </button>
                        {/* UX15: botão self-critique. IA pontua 6 dimensões e
                            reescreve se score baixo. Custo extra: 1 chamada. */}
                        <button
                          onClick={handleSelfCritique}
                          disabled={isCritiquing}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-[10px] font-black uppercase tracking-widest disabled:opacity-50 transition-all"
                          title="IA pontua 6 dimensões e reescreve se identificar pontos fracos"
                        >
                          {isCritiquing ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Sparkles size={12} />
                          )}
                          {isCritiquing ? 'Revisando...' : 'Revisar com IA'}
                        </button>
                        {/* Estágio 2 — melhorar a copy aplicando uma skill */}
                        <CopySkillsButton
                          script={scriptToScan}
                          answers={config.copy?.answers}
                          onApply={applyScriptToCopy}
                          disabled={!scriptToScan}
                        />
                        {/* Agente copywriter: Chat */}
                        <button
                          onClick={() => setShowCopywriterChat(true)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 dark:bg-gray-100 dark:text-gray-900 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-all"
                          title="Converse com o copywriter mestre sobre esta copy — ele discute e revisa em diálogo"
                        >
                          <Sparkles size={12} />
                          Falar com o copywriter
                        </button>
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
                    </div>

                    {/* UX16: toggle entre modo beat-by-beat e textarea
                        monolítica. Só mostra toggle se há beats parseaveis
                        (script tem markers [BEAT]). Default = beat mode. */}
                    {hasBeatMarkers && (
                      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
                        <button
                          onClick={() => setBeatMode(true)}
                          className={`px-3 py-1.5 rounded-lg transition-all ${
                            beatMode
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                          }`}
                        >
                          🎬 Beat-by-Beat
                        </button>
                        <button
                          onClick={() => setBeatMode(false)}
                          className={`px-3 py-1.5 rounded-lg transition-all ${
                            !beatMode
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                          }`}
                        >
                          📝 Texto Único
                        </button>
                      </div>
                    )}

                    {hasBeatMarkers && beatMode ? (
                      // UX16: editor beat-by-beat
                      <ScriptBeatEditor
                        script={config.copy.generatedScript || ''}
                        onChange={(newScript) => {
                          setConfig((prev: any) => ({
                            ...prev,
                            copy: {
                              ...prev.copy,
                              generatedScript: newScript,
                              optimizedScript: '',
                            },
                          }));
                          setHasUnsavedCopyChanges(true);
                        }}
                        answers={config.copy?.answers || {}}
                        angle={(config.copy?.answers?.angleIdea as string) || 'Direto'}
                      />
                    ) : (
                      <AutoResizeTextarea
                        className="w-full p-8 bg-gray-50 dark:bg-gray-800/60 rounded-[32px] border-2 border-transparent focus:border-blue-600 focus:bg-white dark:focus:bg-gray-900/80 outline-none text-gray-700 dark:text-gray-300 leading-relaxed font-mono text-sm transition-all"
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
                    )}
                    {config.copy.generatedScript && (
                      <div className="text-xs text-gray-400 dark:text-gray-500 text-right mt-2">
                        ✍️ {countWords(config.copy.generatedScript)} palavras
                      </div>
                    )}

                    <div className="flex flex-col items-center gap-4 pt-4">
                      <div className="flex items-center gap-4 w-full">
                        <button
                          onClick={async () => {
                            try {
                              // A copy aprovada (com o hook já incluído pelo Claude)
                              // é o generatedScript. Grava como finalScript no
                              // config e deixa o handleSaveProject persistir —
                              // ele salva no lugar certo (subprojeto/variant),
                              // diferente do updateDoc antigo que apontava pro
                              // doc do projeto-pai e falhava ("erro ao salvar").
                              const finalScript = config.copy.generatedScript;
                              const updatedCopy = { ...config.copy, finalScript };

                              setConfig((prev: any) => ({
                                ...prev,
                                copy: { ...prev.copy, finalScript },
                              }));

                              // Passa o copy atualizado como OVERRIDE pro save —
                              // setConfig é assíncrono e o handleSaveProject lê o
                              // config do closure (ainda sem finalScript). Sem o
                              // override, salvava a versão antiga. O override
                              // garante que o finalScript vai pro Firestore agora.
                              await handleSaveProject({ copy: updatedCopy });

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
                              : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed shadow-none'
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
                  // UX12: unificado em um unico botao que leva pra Copy do
                  // Gancho (proxima aba do wizard). Antes tinha 2 botoes
                  // ("Configurar Voz" e "Gerar Hook Visual") que pulavam
                  // etapas do fluxo — user pediu pra seguir a ordem natural.
                  <div className="flex flex-wrap justify-center gap-4 pt-12">
                    <button
                      onClick={() => {
                        setCurrentStep('hook-visual');
                      }}
                      className="flex items-center gap-3 px-12 py-6 bg-gray-900 text-white rounded-[32px] font-black uppercase tracking-widest hover:bg-black transition-all shadow-2xl shadow-gray-200 group"
                    >
                      Ir para Copy do Gancho
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
