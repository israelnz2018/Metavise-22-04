/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import HookVisualGenerator from './components/HookVisualGenerator';
import VozPremium from './components/VozPremium';
import { IntegrationsTab } from './pages/IntegrationsTab';
import { ProjectsTab } from './pages/ProjectsTab';
// SourceTab + PlanTab are lazy-loaded — they pull in jsPDF / heavy CSS
// that aren't needed for the initial app boot. React.lazy splits them
// into their own chunks loaded only when the user navigates there.
const SourceTab = React.lazy(() =>
  import('./pages/SourceTab').then((m) => ({ default: m.SourceTab }))
);
const PlanTab = React.lazy(() => import('./pages/PlanTab').then((m) => ({ default: m.PlanTab })));
import type { ProductInfo } from './lib/claudeService';
import { authedFetch } from './lib/authedFetch';
import { detectDuration, detectVideoFormat } from './lib/helpers';
import type {
  Step,
  Scene,
  TimelineEdit,
  VideoSegment,
  HookVisualData,
  AssemblyAnalysis,
  ZapCapTemplate,
  BrollCandidate,
  AutoEditState,
  ZapCapRenderConfig,
  Project,
  ProjectVariant,
  MusicTrack,
} from './types/project';

import {
  Video,
  Layout,
  ChevronRight,
  ChevronLeft,
  Folder,
  Sparkles,
  CheckCircle2,
  Loader2,
  Save,
  Download,
  LogOut,
  Settings,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Toaster, toast } from 'react-hot-toast';
import { getAuthorizedUrl } from './lib/gemini';
import {
  generateAdCopyWithClaude,
  discoverPersonaWithClaude,
  estimateCopyCost,
} from './lib/claudeService';
// UX18: carrega biblioteca pessoal do user pra injetar como few-shot
// na geração de copy. Pega na hora — ~200ms, aceitável.
import { loadPersonalLibrary } from './lib/personalCopyLibrary';
import { auth, db, storage } from './lib/firebase';
import { loadVariants, saveVariant, deleteVariantDoc } from './lib/variantStore';
import firebaseConfig from '../firebase-applet-config.json';
import { type CachedRecommendation } from './components/AIRecommendationPanel';
import { STEPS, AD_STYLES } from './lib/constants';
import { NewProjectModal } from './components/NewProjectModal';
import { ConfirmModal } from './components/ConfirmModal';
import { PersonaEditModal } from './components/PersonaEditModal';
import { PersonaPathModal } from './components/PersonaPathModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LazyTab } from './components/LazyTab';
import { ToastLimiter } from './components/ToastLimiter';
// UX2: AutoSaveIndicator removido do header (poluía a barra de abas).
// Componente ainda existe em ./components/AutoSaveIndicator caso a gente
// queira recolocar em outro lugar no futuro.
// import { AutoSaveIndicator } from './components/AutoSaveIndicator';
import { DarkModeToggle } from './components/DarkModeToggle';
import { RecentProjectsButton } from './components/RecentProjectsButton';
import { pushRecentProject } from './lib/recentProjects';
import { useDarkMode } from './hooks/useDarkMode';
import { ensureNotificationPermission, notifyIfHidden } from './lib/notifications';
import { COSTS } from './lib/costs';
import { CostConfirmModal } from './components/CostConfirmModal';
import { BriefEditModal } from './components/BriefEditModal';
import type { CreativeBrief, WeightedPersona } from './types/project';
// Step tabs are lazy-loaded so the initial JS payload stays small.
// Each tab is a ~600-1500 line module pulling its own helpers; loading
// them on demand drops the main chunk significantly. AvatarTab is the
// heaviest because it imports the bulk-classified avatar enrichment
// JSON (~175KB) via dynamic import inside the tab itself.
const PersonaTab = React.lazy(() =>
  import('./pages/PersonaTab').then((m) => ({ default: m.PersonaTab }))
);
const Edit2Tab = React.lazy(() =>
  import('./pages/Edit2Tab').then((m) => ({ default: m.Edit2Tab }))
);
const FinalTab = React.lazy(() =>
  import('./pages/FinalTab').then((m) => ({ default: m.FinalTab }))
);
const CopyTab = React.lazy(() => import('./pages/CopyTab').then((m) => ({ default: m.CopyTab })));
const RemotionTab = React.lazy(() =>
  import('./pages/RemotionTab').then((m) => ({ default: m.RemotionTab }))
);
const EditZapTab = React.lazy(() =>
  import('./pages/EditZapTab').then((m) => ({ default: m.EditZapTab }))
);
const MergeTab = React.lazy(() =>
  import('./pages/MergeTab').then((m) => ({ default: m.MergeTab }))
);
const MontagemTab = React.lazy(() =>
  import('./pages/MontagemTab').then((m) => ({ default: m.MontagemTab }))
);
const AvatarTab = React.lazy(() =>
  import('./pages/AvatarTab').then((m) => ({ default: m.AvatarTab }))
);
const VideoIATab = React.lazy(() =>
  import('./pages/VideoIATab').then((m) => ({ default: m.VideoIATab }))
);
import { useZapState } from './hooks/useZapState';

const CREATE_PROJECT_TIMEOUT_MS = 8000;

const toFirestoreValue = (value: any): any => {
  if (value === null) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value)
            .filter(([, entryValue]) => entryValue !== undefined)
            .map(([key, entryValue]) => [key, toFirestoreValue(entryValue)])
        ),
      },
    };
  }
  return { stringValue: String(value) };
};

const toFirestoreFields = (data: Record<string, any>) =>
  Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, toFirestoreValue(value)])
  );

const createProjectViaRest = async (
  user: FirebaseUser,
  documentId: string,
  projectData: Record<string, any>
): Promise<string> => {
  const token = await user.getIdToken();
  const databaseId = encodeURIComponent(firebaseConfig.firestoreDatabaseId || '(default)');
  const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${databaseId}/documents/projects?documentId=${documentId}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: toFirestoreFields({
        ...projectData,
        createdAt: new Date(),
      }),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    if (response.status === 409 && text.includes('ALREADY_EXISTS')) return documentId;
    try {
      const payload = JSON.parse(text);
      const apiError = payload?.error;
      const detail = [apiError?.status, apiError?.code, apiError?.message]
        .filter(Boolean)
        .join(' - ');
      throw new Error(detail || text || `Firestore REST create failed (${response.status})`);
    } catch (parseErr) {
      if (parseErr instanceof SyntaxError) {
        throw new Error(text || `Firestore REST create failed (${response.status})`);
      }
      throw parseErr;
    }
  }

  return documentId;
};
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  uploadBytesResumable,
  listAll,
} from 'firebase/storage';
import {
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User as FirebaseUser,
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp,
  getDocFromServer,
  getDocs as fbGetDocs,
  collection,
  query,
  where,
  orderBy,
  deleteDoc,
} from 'firebase/firestore';

// --- Constants & Types ---

// Project + ProjectVariant types now live in src/types/project.ts as
// generics; we parameterise them with AdConfig here so all the project
// reads/writes in this file stay fully typed.

// Exported so the extracted tab components in src/pages/*Tab.tsx can
// type their `config` prop with the real shape instead of `any`. The
// `useHook?: boolean` flag (project-level "does this project use a
// separate hook?") lives at the top level alongside the section maps.
//
// Several fields here were originally accessed via `as any` casts in
// the extracted tabs because they were added incrementally during the
// migration (productInfo, hookVideos, zapVersions, etc.). They're now
// part of the canonical shape — when you grep for `(config\.\w+ as
// any)` in src/pages/* you should find none.
export interface AdConfig {
  angle: string;
  /** Set by setUseHookFlow; missing/`true` means use the hook flow. */
  useHook?: boolean;
  /** Campo próprio da aba "Copy da VSL" — mesma forma de `copy`, guarda o
   *  roteiro longo (VSL) separado do anúncio, pra os dois coexistirem. */
  copyVsl?: AdConfig['copy'];
  copy: {
    mode: 'improve' | 'as-is' | 'questions';
    subMode?: 'zero' | 'improve' | 'ready';
    discoveryMode?: 'unknown' | 'known' | 'discovering' | 'done';
    /** Blueprint Fase 4 — escolhido no NewProjectModal pro tipo 'complete'.
     *  'vsl'     = cliente tem material pronto (VSL/landing) — vai pra SourceTab modo auto
     *  'product' = cliente só tem o produto — vai pro PersonaPathModal direto
     *  Indefinido em projetos legacy. Roteamento real fica na Fase 4.2. */
    sourceMode?: 'vsl' | 'product';
    answers: Record<string, any>;
    generatedScript: string;
    generatedHooks: any[];
    selectedHookIdx?: number;
    optimizedScript?: string;
    finalScript?: string;
    scriptLength?: 'short' | 'medium' | 'long';
    targetWordCount?: number;
    hookSelecionado?: string;
    hooksHistorico?: { hook: string; createdAt: string }[];
    // Persisted by SourceTab (auto-extracted ProductInfo via Claude).
    productInfo?: ProductInfo | null;
    // PlanTab output (meta do plano: inputs + leitura de consciência).
    marketingPlan?: any;
    // PlanTab v2 — weighted personas (replaces the single-persona model)
    // and the 15 creative briefs derived from them. Both optional so
    // pre-blueprint projects keep working.
    personasWithWeights?: import('@/types/project').WeightedPersona[] | null;
    creativeBriefs?: import('@/types/project').CreativeBrief[] | null;
    // UX28: monthly plan configuration (setup + calibrated output)
    monthlyPlan?: import('@/types/project').MonthlyPlanConfig | null;
    // AIRecommendationPanel cache (auto-invalidates when copy/persona
    // hashes change).
    aiRecommendation?: CachedRecommendation | null;
    // Hook-flow assets generated separately from the body.
    hookAudioUrl?: string;
    hookAudioStoragePath?: string | null;
    hookVideoUrl?: string;
    hookVideos?: AdConfig['videos'];
    // UX13: hash do texto da copy quando o user clicou "Manter assim"
    // no content risk banner. Banner não aparece de novo enquanto o texto
    // não mudar. Hash invalida automaticamente quando texto muda.
    contentRiskAcknowledgedHash?: string;
    // UX22: IDs das copies da biblioteca pessoal que o user marcou como
    // referência pra próxima geração. Quando vazio/undefined, algoritmo
    // de auto-select escolhe (vertical/awareness/language). Quando tem
    // entradas, IA usa SÓ essas — ignora o resto da biblioteca.
    referenceCopyIds?: string[];
    // UX23-F: Slider 0-100 controlando intensidade da influência da
    // referência. Buckets internos:
    //   0-25  → "light reference" (prompt antigo: study tone, don't copy)
    //   26-50 → "medium" (mirror feel + reference no topo)
    //   51-75 → "strong" (fingerprint extraído + mirror tight)
    //   76-100 → "clone" (fingerprint + voice indistinguishable)
    // Default 65 quando user marca a primeira copy.
    referenceSimilarity?: number;
    // UX23-E: snapshot das copies que efetivamente entraram na última
    // geração (id + name/script preview). Permite "Ver referências
    // usadas" sem depender da biblioteca atual (user pode ter deletado).
    lastUsedReferences?: Array<{
      id: string;
      name?: string;
      scriptPreview: string; // primeiras ~280 chars
      vertical?: string;
      language?: string;
    }>;
    // UX25-C1/C2: snapshot do prompt EXATO enviado pro Claude na última
    // geração + custo estimado. Não persiste em Firestore (heavy).
    lastDebug?: {
      systemPrompt: string;
      userPrompt: string;
      response: string;
      model: 'opus' | 'sonnet';
      estimatedInputTokens: number;
      estimatedOutputTokens: number;
      estimatedCost: number;
      timestamp: number;
    };
    // UX25-A4: modo rascunho usa Sonnet (mais rápido/barato). Default false.
    draftMode?: boolean;
    // UX25-B2: últimas 5 gerações pra restauração rápida. Salva script
    // + metadata leve. Persiste em Firestore (pequeno o suficiente).
    history?: Array<{
      script: string;
      timestamp: number;
      model: 'opus' | 'sonnet';
      wordCount: number;
    }>;
  };
  hookVisual: HookVisualData;
  avatar: {
    faceId: string;
    customFaceUrl: string | null;
    voiceId: string;
    scale?: number;
    avatarFormat?: 'original' | 'square';
    cropOffset?: number; // -50 to 50
    // Fundo que o HeyGen compõe atrás do avatar. Ausente = preto sólido
    // (comportamento legado). `value` é hex (#RRGGBB) p/ cor, ou URL pública
    // do arquivo (Firebase Storage) p/ imagem/vídeo.
    background?: {
      type: 'color' | 'image' | 'video';
      value: string;
    };
  };
  subtitles: {
    style: string;
  };
  format: {
    aspectRatio: '16:9' | '9:16' | '1:1';
    duration: number;
  };
  edit: {
    transition: string;
    backgroundMusic: string;
    veoModel?: string;
    timelineEdits?: TimelineEdit[];
    scenes?: Scene[];
    segments?: VideoSegment[];
    // EditZapTab render outputs. Body / hook versions are kept
    // separate because the UI lets you toggle which one you're editing.
    // joined = "Juntar" feature output (hook+body concat).
    zapVersions?: string[];
    zapHookVersions?: string[];
    zapVslVersions?: string[];
    zapJoinedVersions?: string[];
    // Músicas geradas/enviadas NESTE subprojeto (independentes de outros).
    musicTracks?: MusicTrack[];
  };
  audioUrl?: string | null;
  audioStoragePath?: string | null;
  audios?: {
    url: string;
    storagePath: string | null;
    voiceId: string;
    createdAt: string;
  }[];
  videoUrl?: string | null;
  videoStoragePath?: string | null;
  videos?: {
    url: string;
    storagePath: string | null;
    createdAt: string;
    aspectRatio?: '16:9' | '9:16' | '1:1';
    scale?: number;
    timelineEdits?: TimelineEdit[];
  }[];
  generationStage?: string;
  lastVideoMetadata?: {
    videoId: string;
    url: string;
    status: string;
    createdAt: string;
    avatarId: string;
    voiceId: string;
    script: string;
    audioUrl: string | null;
    aspectRatio: string;
    isTestMode: boolean;
  } | null;
}

export default function App() {
  // Theme (light/dark). Owned at the top so the whole tree re-renders
  // exactly once when the user toggles. `.dark` class is set on <html>
  // by the hook; Tailwind's `dark:` variant takes care of the rest.
  const { isDark, toggle: toggleDarkMode } = useDarkMode();
  const [currentStep, setCurrentStep] = useState<Step>('projects');
  // Ref pro container scrollável da wizard nav. Quando currentStep muda,
  // useEffect abaixo rola a aba ativa pra ficar visível (necessário quando
  // a nav é mais larga que o viewport e overflow-x-auto fica ativo).
  const wizardNavRef = useRef<HTMLDivElement | null>(null);
  // Estado dos chevrons (esquerda/direita): mostra/esconde conforme há
  // overflow restante em cada direção. Atualizado em scroll, resize e
  // troca de step. Default false pra não piscar no primeiro paint.
  const [navScrollState, setNavScrollState] = useState<{ canLeft: boolean; canRight: boolean }>({
    canLeft: false,
    canRight: false,
  });
  const updateNavScrollState = useCallback(() => {
    const c = wizardNavRef.current;
    if (!c) return;
    // UX21: threshold 0 — qualquer scroll > 0 já mostra a seta esquerda.
    // Antes era 4px que dava sensação de "atraso" pro user.
    const canLeft = c.scrollLeft > 0;
    const canRight = c.scrollLeft + c.clientWidth < c.scrollWidth - 1;
    setNavScrollState((prev) =>
      prev.canLeft === canLeft && prev.canRight === canRight ? prev : { canLeft, canRight }
    );
  }, []);
  useEffect(() => {
    const container = wizardNavRef.current;
    if (!container) return;
    const active = container.querySelector(`[data-step-id="${currentStep}"]`) as HTMLElement | null;
    if (!active) return;
    // scrollIntoView com inline:center deixa a aba ativa centralizada na
    // viewport da nav, sem mexer no scroll vertical da página.
    active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    // UX21: smooth scroll dura ~300ms. O scroll listener nativo cobre na
    // maioria dos browsers, mas Safari às vezes atrasa. Pra garantir que
    // o estado final (depois que parou) seja capturado, polling RAF por
    // ~400ms. Cancelado se step mudar de novo.
    let cancelled = false;
    const startedAt = performance.now();
    const tick = () => {
      if (cancelled) return;
      updateNavScrollState();
      if (performance.now() - startedAt < 400) {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
    return () => {
      cancelled = true;
    };
  }, [currentStep, updateNavScrollState]);
  useEffect(() => {
    const c = wizardNavRef.current;
    if (!c) return;
    // Estado inicial + listeners de scroll/resize. passive:true porque só
    // estamos lendo scrollLeft (não preventDefault).
    updateNavScrollState();
    c.addEventListener('scroll', updateNavScrollState, { passive: true });
    window.addEventListener('resize', updateNavScrollState);
    // Observa mudanças de tamanho do container (ex: sidebar aberto/fechado)
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => updateNavScrollState());
      ro.observe(c);
    }
    return () => {
      c.removeEventListener('scroll', updateNavScrollState);
      window.removeEventListener('resize', updateNavScrollState);
      ro?.disconnect();
    };
  }, [updateNavScrollState]);
  // Wheel handler: converte scroll vertical do mouse em scroll horizontal
  // da nav. Só intercepta quando há overflow horizontal real (senão deixa
  // o scroll vertical da página passar normal). Trackpads com deltaX já
  // funcionam — esse handler é pra mouse de roda.
  useEffect(() => {
    const c = wizardNavRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      if (c.scrollWidth <= c.clientWidth) return; // sem overflow → não intercepta
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (delta === 0) return;
      e.preventDefault();
      c.scrollBy({ left: delta, behavior: 'auto' });
    };
    // passive:false porque precisamos chamar preventDefault
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, []);
  const scrollNavBy = useCallback((dir: 'left' | 'right') => {
    const c = wizardNavRef.current;
    if (!c) return;
    // Rola ~70% da viewport visível — passa de uma aba só, mas não tanto
    // a ponto de pular varias de uma vez. Smooth pra ficar elegante.
    const offset = Math.max(160, c.clientWidth * 0.7);
    c.scrollBy({ left: dir === 'left' ? -offset : offset, behavior: 'smooth' });
  }, []);
  const [deleteProjectConfirmId, setDeleteProjectConfirmId] = useState<string | null>(null);
  const [voiceSource, setVoiceSource] = useState<'copy' | 'hook' | 'vsl'>('copy');
  const [previewAvatar, setPreviewAvatar] = useState<any>(null);
  const [credits, setCredits] = useState<number>(0);
  // Gasto REAL da API da Claude (o servidor conta o próprio consumo). Poll leve
  // pra mostrar "quanto foi gasto" em tempo quase-real no header.
  const [apiSpend, setApiSpend] = useState<{
    costUSD: number;
    calls: number;
    since: string;
    today: { costUSD: number; calls: number };
    balanceBase: number | null;
    availableUSD: number | null;
  } | null>(null);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [userRole, setUserRole] = useState<'user' | 'admin'>('user');
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [testStatus, setTestStatus] = useState<{
    status: 'idle' | 'loading' | 'success' | 'error';
    message?: string;
  }>({ status: 'idle' });
  const [heygenKey, setHeygenKey] = useState('');
  const [heygenShowKey, setHeygenShowKey] = useState(false);
  const [heygenTestStatus, setHeygenTestStatus] = useState<{
    status: 'idle' | 'loading' | 'success' | 'error';
    message?: string;
  }>({ status: 'idle' });
  const [runwayKey, setRunwayKey] = useState('');
  const [runwayShowKey, setRunwayShowKey] = useState(false);
  const [runwayTestStatus, setRunwayTestStatus] = useState<{
    status: 'idle' | 'loading' | 'success' | 'error';
    message?: string;
  }>({ status: 'idle' });
  const [geminiKey, setGeminiKey] = useState('');
  const [geminiShowKey, setGeminiShowKey] = useState(false);
  const [geminiTestStatus, setGeminiTestStatus] = useState<{
    status: 'idle' | 'loading' | 'success' | 'error';
    message?: string;
  }>({ status: 'idle' });
  const [claudeKey, setClaudeKey] = useState('');
  const [claudeShowKey, setClaudeShowKey] = useState(false);
  const [claudeTestStatus, setClaudeTestStatus] = useState<{
    status: 'idle' | 'loading' | 'success' | 'error';
    message?: string;
  }>({ status: 'idle' });
  const [assemblyTestStatus, setAssemblyTestStatus] = useState<{
    status: 'idle' | 'loading' | 'success' | 'error';
    message?: string;
  }>({ status: 'idle' });
  const [assemblyKey, setAssemblyKey] = useState('');
  const [assemblyShowKey, setAssemblyShowKey] = useState(false);
  const [zapcapTestStatus, setZapcapTestStatus] = useState<{
    status: 'idle' | 'loading' | 'success' | 'error';
    message?: string;
  }>({ status: 'idle' });
  const [zapcapKey, setZapcapKey] = useState('');
  const [zapcapShowKey, setZapcapShowKey] = useState(false);
  const [generationStage, setGenerationStage] = useState<
    | 'idle'
    | 'audio'
    | 'audio_ready'
    | 'video'
    | 'video_ready'
    | 'subtitles'
    | 'subtitles_ready'
    | 'edit'
    | 'completed'
  >('idle');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioStoragePath, setAudioStoragePath] = useState<string | null>(null);
  const [audios, setAudios] = useState<
    {
      url: string;
      storagePath: string | null;
      voiceId: string;
      createdAt: string;
    }[]
  >([]);
  const [audioToDelete, setAudioToDelete] = useState<{
    url: string;
    storagePath: string | null;
  } | null>(null);
  const [audioToDeleteFromHistory, setAudioToDeleteFromHistory] = useState<{
    url: string;
    storagePath: string | null;
  } | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoStoragePath, setVideoStoragePath] = useState<string | null>(null);

  const [videos, setVideos] = useState<
    {
      url: string;
      storagePath: string | null;
      createdAt: string;
      aspectRatio?: '9:16' | '1:1' | '16:9';
      scale?: number;
      timelineEdits?: TimelineEdit[];
    }[]
  >([]);
  const [lastVideoMetadata, setLastVideoMetadata] = useState<any | null>(null);
  const [showDeleteVideoModal, setShowDeleteVideoModal] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [platformApiKey, setPlatformApiKey] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project<AdConfig>[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isProjectLoading, setIsProjectLoading] = useState(false);
  const [hasUnsavedCopyChanges, setHasUnsavedCopyChanges] = useState(false);
  // Timestamp of the last successful save (any field, any tab). UX2:
  // AutoSaveIndicator removido, então o setter está unused mas o estado
  // continua sendo "stampado" depois de cada save pra caso a gente queira
  // mostrar isso de novo. Underscore-prefix evita warning de unused.

  const [_lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  // Mudanças não salvas: liga ao editar qualquer coisa do projeto; desliga ao
  // salvar ou ao carregar/trocar de projeto-subprojeto. Alimenta o pop-up que
  // avisa "salve antes de mudar de aba" (auto-save foi removido por lentidão,
  // então o usuário perdia trabalho sem perceber).
  const [isDirty, setIsDirty] = useState(false);
  // Quando o usuário clica numa aba com mudanças pendentes, guardamos o destino
  // aqui e abrimos o modal em vez de navegar direto.
  const [pendingStepChange, setPendingStepChange] = useState<Step | null>(null);

  const hydrateProjectConfig = (loadedConfig: AdConfig) => {
    // 0. Garantir hookVisual
    if (!loadedConfig.hookVisual) {
      loadedConfig.hookVisual = {
        promptImagem: '',
        imagensGeradas: [],
        imagemEscolhida: '',
        promptVideo: '',
        videoGerado: '',
        duracaoVideo: 4,
        modeloImagem: 'imagen-4.0-generate-001',
        modeloVideo: 'veo-3.1-fast-generate-preview',
      };
    }

    // 0.1. Retrocompat: garantir format e avatar. Projetos antigos podem não
    // ter esses campos — a AvatarTab lê config.format.aspectRatio / config.avatar
    // sem guarda e quebrava a tela inteira.
    if (!loadedConfig.format) {
      (loadedConfig as any).format = { aspectRatio: '9:16', duration: 10 };
    }
    if (!loadedConfig.avatar) {
      (loadedConfig as any).avatar = {
        faceId: 'f1',
        customFaceUrl: null,
        voiceId: '',
        scale: 1.0,
      };
    }

    // 1. Retrocompatibilidade: Garantir campos básicos de edit
    if (!loadedConfig.edit) {
      loadedConfig.edit = {
        transition: 'none',
        backgroundMusic: 'none',
        timelineEdits: [],
      };
    } else if (!loadedConfig.edit.timelineEdits) {
      loadedConfig.edit.timelineEdits = [];
    }

    // 2. Retrocompatibilidade: Garantir campos de copy
    if (!loadedConfig.copy) {
      (loadedConfig as any).copy = {
        mode: 'questions',
        answers: {},
        generatedScript: '',
        generatedHooks: [],
        discoveryMode: 'unknown',
      };
    }

    // 3. Inferir discoveryMode se estiver faltando
    if (!loadedConfig.copy.discoveryMode) {
      if (loadedConfig.copy.finalScript) {
        loadedConfig.copy.discoveryMode = 'done';
      } else if (
        loadedConfig.copy.answers?.audience ||
        loadedConfig.copy.answers?.productName ||
        Object.keys(loadedConfig.copy.answers || {}).length > 0
      ) {
        loadedConfig.copy.discoveryMode = 'known';
      } else {
        loadedConfig.copy.discoveryMode = 'unknown';
      }
    }

    // 4. Garantir campos de answers (Bug 2)
    const answers = loadedConfig.copy.answers || {};
    const defaultAnswers: Record<string, any> = {
      language: answers.language || 'Português (Brasileiro)',
      awarenessLevel: answers.awarenessLevel || '',
      estiloAnuncio: answers.estiloAnuncio || '',
      clickDestination: answers.clickDestination || '',
      primaryEmotion: answers.primaryEmotion || '',
      angleIdea: answers.angleIdea || '',
      businessModel: answers.businessModel || '',
    };
    loadedConfig.copy.answers = { ...defaultAnswers, ...answers };

    return loadedConfig;
  };

  // AISTUDIO: Effect to keep track of the selected API key for VEO authorization
  useEffect(() => {
    const syncPlatformKey = async () => {
      const g = window as any;
      if (g.aistudio?.getSelectedApiKey) {
        try {
          const key = await g.aistudio.getSelectedApiKey();
          if (key && key !== platformApiKey) {
            setPlatformApiKey(key);
            console.log('[AI Studio Debug] Platform API Key synchronized.');
          }
        } catch (e) {
          console.warn('[AI Studio Debug] Failed to sync platform API key:', e);
        }
      }
    };

    syncPlatformKey();
    const interval = setInterval(syncPlatformKey, 10000); // Check every 10s
    return () => clearInterval(interval);
  }, [platformApiKey]);

  // Hydrate Gemini API key from the backend on app boot so all the existing
  // call sites (which read window.process.env.GEMINI_API_KEY) work even when
  // the key was set via the in-app admin UI rather than the .env file.
  useEffect(() => {
    const hydrateGeminiKey = async () => {
      try {
        const r = await fetch('/api/gemini/key');
        if (!r.ok) return;
        const { apiKey } = await r.json();
        if (!apiKey) return;
        const w = window as any;
        w.process = w.process || { env: {} };
        w.process.env = w.process.env || {};
        w.process.env.GEMINI_API_KEY = apiKey;
        // Tell the rest of the app that a key is available, otherwise the
        // checkKey() effect that ran earlier on mount (synchronously, before
        // this async fetch finished) leaves hasApiKey=false and downstream
        // guards try to open the AI Studio key selector (which doesn't
        // exist outside Google AI Studio).
        setHasApiKey(true);
        console.log('[Gemini] API Key hydrated from server config.');
      } catch (e) {
        console.warn('[Gemini] Could not fetch saved API key:', e);
      }
    };
    hydrateGeminiKey();
  }, []);

  const safeDeleteObject = async (path: string) => {
    try {
      const storageRef = ref(storage, path);
      await deleteObject(storageRef);
    } catch (err: any) {
      // If the object is already gone, we consider it a success
      if (err.code === 'storage/object-not-found') {
        console.warn(`Object not found in storage, skipping deletion: ${path}`);
        return;
      }
      throw err;
    }
  };

  const handleDeleteAudio = async (audioArg?: { url: string; storagePath: string | null }) => {
    const targetAudio = audioArg || audioToDelete;
    if (!targetAudio) return;
    try {
      if (targetAudio.storagePath) {
        await safeDeleteObject(targetAudio.storagePath);
      }

      const newAudios = audios.filter((a) => a.url !== targetAudio.url);
      setAudios(newAudios);

      if (audioUrl === targetAudio.url) {
        setAudioUrl(null);
        setAudioStoragePath(null);
        setConfig((prev) => ({
          ...prev,
          audioUrl: null,
          audioStoragePath: null,
          audios: newAudios,
        }));
      } else {
        setConfig((prev) => ({ ...prev, audios: newAudios }));
      }

      setAudioToDelete(null);
      setShowDeleteModal(false);
      toast.success('Áudio deletado com sucesso!');

      // Auto-save after deletion
      handleSaveProject({
        audios: newAudios,
        audioUrl: audioUrl === targetAudio.url ? null : audioUrl,
        audioStoragePath: audioUrl === targetAudio.url ? null : audioStoragePath,
      });
    } catch (err) {
      console.error('Erro ao deletar áudio:', err);
      toast.error('Erro ao deletar áudio.');
    }
  };

  const handleDeleteVideo = async () => {
    try {
      if (videoStoragePath) {
        await safeDeleteObject(videoStoragePath);
      }

      const newVideos = videos.filter((v) => v.url !== videoUrl);
      setVideos(newVideos);

      setVideoUrl(null);
      setVideoStoragePath(null);
      setLoading(false);
      setVideoOp(null);
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }

      setConfig((prev) => ({
        ...prev,
        videoUrl: null,
        videoStoragePath: null,
        videos: newVideos,
        lastVideoMetadata: null,
        generationStage: 'idle',
      }));
      setShowDeleteVideoModal(false);
      toast.success('Vídeo deletado com sucesso!');

      // Auto-save
      setTimeout(() => {
        handleSaveProject({
          videoUrl: null,
          videoStoragePath: null,
          videos: newVideos,
          lastVideoMetadata: null,
          generationStage: 'idle',
        });
      }, 500);
    } catch (err) {
      console.error('Erro ao deletar vídeo:', err);
      toast.error('Erro ao deletar vídeo.');
    }
  };

  const handleDeleteVideoFromArray = async (video: { url: string; storagePath: string | null }) => {
    // Hook-mode videos live on config.copy.hookVideos (not the top-level
    // `videos` array). The trash button doesn't know which bucket it's
    // in, so locate the video by URL and route the removal accordingly.
    const hookVideos = ((config.copy as any)?.hookVideos as typeof videos | undefined) || [];
    const isHookVideo =
      hookVideos.some((v) => v.url === video.url) && !videos.some((v) => v.url === video.url);

    try {
      if (video.storagePath) {
        await safeDeleteObject(video.storagePath);
      }

      if (isHookVideo) {
        const newHookVideos = hookVideos.filter((v) => v.url !== video.url);
        const currentHookUrl = (config.copy as any)?.hookVideoUrl as string | undefined;
        const wasActive = currentHookUrl === video.url;
        const newHookUrl = wasActive
          ? newHookVideos.length > 0
            ? newHookVideos[newHookVideos.length - 1]!.url
            : ''
          : currentHookUrl;
        const newHookStoragePath = wasActive
          ? newHookVideos.length > 0
            ? newHookVideos[newHookVideos.length - 1]!.storagePath
            : null
          : (((config.copy as any)?.hookVideoStoragePath as string | null | undefined) ?? null);

        setConfig((prev) => ({
          ...prev,
          copy: {
            ...prev.copy,
            hookVideos: newHookVideos,
            hookVideoUrl: newHookUrl,
            hookVideoStoragePath: newHookStoragePath,
          } as any,
        }));

        toast.success('Vídeo do gancho deletado!');

        handleSaveProject({
          copy: {
            ...config.copy,
            hookVideos: newHookVideos,
            hookVideoUrl: newHookUrl,
            hookVideoStoragePath: newHookStoragePath,
          } as any,
        });
        return;
      }

      // Body-mode delete (top-level videos array).
      const newVideos = videos.filter((v) => v.url !== video.url);
      setVideos(newVideos);

      let newVideoUrl = videoUrl;
      let newVideoStoragePath = videoStoragePath;
      let newLastMetadata = lastVideoMetadata;

      if (videoUrl === video.url) {
        newVideoUrl = newVideos.length > 0 ? newVideos[newVideos.length - 1]!.url : null;
        newVideoStoragePath =
          newVideos.length > 0 ? newVideos[newVideos.length - 1]!.storagePath : null;
        setVideoUrl(newVideoUrl);
        setVideoStoragePath(newVideoStoragePath);

        if (!newVideoUrl) {
          setLoading(false);
          setVideoOp(null);
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          newLastMetadata = null;
        }
      }

      setConfig((prev) => ({
        ...prev,
        videos: newVideos,
        videoUrl: newVideoUrl,
        videoStoragePath: newVideoStoragePath,
        lastVideoMetadata: newLastMetadata,
      }));

      toast.success('Vídeo deletado com sucesso!');

      handleSaveProject({
        videos: newVideos,
        videoUrl: newVideoUrl,
        videoStoragePath: newVideoStoragePath,
        lastVideoMetadata: newLastMetadata,
      });
    } catch (err) {
      console.error('Erro ao deletar vídeo:', err);
      toast.error('Erro ao deletar vídeo.');
    }
  };

  const handleSaveVideoToFirebase = async (heygenVideoUrl: string) => {
    if (!auth.currentUser) return { url: heygenVideoUrl, path: null };
    try {
      addLog('Salvando vídeo no Firebase...');
      let response;
      for (let i = 0; i < 3; i++) {
        response = await fetch(heygenVideoUrl);
        if (response.ok) break;
        console.warn(`Attempt ${i + 1} failed with status ${response.status}. Retrying...`);
        if (i < 2) await new Promise((r) => setTimeout(r, 2000));
      }

      if (!response || !response.ok) {
        throw new Error(`HTTP Error ${response?.status}`);
      }
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('text/html')) {
        throw new Error('Received HTML instead of media');
      }

      const blob = await response.blob();
      const storageRef = ref(storage, `video/${auth.currentUser.uid}/${Date.now()}.mp4`);
      await uploadBytes(storageRef, blob);
      const downloadUrl = await getDownloadURL(storageRef);
      addLog('Vídeo salvo no Firebase com sucesso.');
      return { url: downloadUrl, path: storageRef.fullPath };
    } catch (err) {
      console.error('Erro ao salvar vídeo no Firebase:', err);
      addLog('Falha ao salvar no Firebase, usando URL original.');
      return { url: heygenVideoUrl, path: null };
    }
  };
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectType, setNewProjectType] = useState<'complete' | 'copy' | 'video' | 'editing'>(
    'complete'
  );
  const [config, setConfig] = useState<AdConfig>({
    angle: 'podcast',
    copy: {
      mode: 'questions',
      answers: {},
      generatedScript: '',
      generatedHooks: [],
      hookSelecionado: '',
    },
    avatar: { faceId: 'f1', customFaceUrl: null, voiceId: '', scale: 1.0 },
    subtitles: { style: 'bold_ad' },
    format: { aspectRatio: '9:16', duration: 10 },
    edit: {
      transition: 'none',
      backgroundMusic: 'none',
      timelineEdits: [],
      veoModel: 'veo-3.1-lite-generate-preview',
    },
    hookVisual: {
      promptImagem: '',
      imagensGeradas: [],
      imagemEscolhida: '',
      promptVideo: '',
      videoGerado: '',
      duracaoVideo: 4,
      modeloImagem: 'imagen-4.0-generate-001',
      modeloVideo: 'veo-3.1-fast-generate-preview',
    },
  });

  // --- Auto-save layer 1: localStorage backup ---
  // Writes every config change to localStorage so the form survives page
  // refreshes even before the user has created a Firestore project. Fast
  // (~1ms), works offline, no auth required. Must live AFTER the config
  // useState above — otherwise the [config] dep array hits the TDZ on
  // the first render and crashes the whole tree.
  const AUTOSAVE_KEY = 'metavise-draft-config-v1';
  useEffect(() => {
    try {
      // Carimba o rascunho com o projeto dono. Sem isso o rascunho é global
      // e vaza o config de um projeto pro próximo (ex: neuropatia aparecendo
      // num projeto novo). projectId=null = rascunho de projeto ainda não salvo.
      localStorage.setItem(
        AUTOSAVE_KEY,
        JSON.stringify({ projectId: currentProjectId ?? null, config })
      );
    } catch (err) {
      console.warn('[AutoSave] localStorage write failed:', err);
    }
  }, [config, currentProjectId]);

  // Restore the last-edited config from localStorage on mount, but ONLY if
  // we haven't yet loaded a real project from Firestore. If the user opens
  // a project later, setConfig overwrites this and the localStorage effect
  // above just rewrites the new value.
  useEffect(() => {
    if (currentProjectId) return;
    try {
      const stored = localStorage.getItem(AUTOSAVE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      // Novo formato: { projectId, config }. Formato antigo (legado): config
      // cru. Só restauramos um rascunho que NUNCA pertenceu a um projeto salvo
      // (projectId == null) — senão o config de um projeto vaza pro próximo.
      // Rascunho carimbado com id real já vive no Firestore; descartamos aqui.
      const draftProjectId = parsed?.projectId ?? undefined;
      const draftConfig = parsed?.config;
      if (draftProjectId != null || !draftConfig) {
        // Pertencia a um projeto salvo, ou é legado/cru → não ressuscita.
        localStorage.removeItem(AUTOSAVE_KEY);
        return;
      }
      // Sanity-check the restored object has the nested shapes downstream
      // code reads from. If anything is missing we drop the draft rather
      // than crash the render tree.
      const looksValid =
        draftConfig &&
        typeof draftConfig === 'object' &&
        draftConfig.copy &&
        typeof draftConfig.copy === 'object' &&
        draftConfig.copy.answers &&
        draftConfig.avatar &&
        draftConfig.edit &&
        draftConfig.format;
      if (looksValid) {
        setConfig(draftConfig);
        // UX25-D3: silencia o toast de restauração — autosave deve ser
        // 100% invisível. Quem quiser confirmação tem o indicador no header.
      } else {
        console.warn('[AutoSave] Saved draft has unexpected shape, dropping it.');
        localStorage.removeItem(AUTOSAVE_KEY);
      }
    } catch (err) {
      console.warn('[AutoSave] localStorage restore failed:', err);
      localStorage.removeItem(AUTOSAVE_KEY);
    }
    // Intentionally only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [loading, setLoading] = useState(false);

  const [currentVariantId, setCurrentVariantId] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [error, setError] = useState<string | null>(null);

  // ─── Detecção de "mudanças não salvas" ───────────────────────────────────
  // Por CONTEÚDO (não por referência): só fica "sujo" se o conteúdo persistível
  // realmente mudou em relação ao último estado salvo/carregado. Isso evita o
  // falso-positivo de pedir pra salvar ao só trocar de aba (quando algo dá um
  // setConfig programático sem o usuário ter editado nada). O custo de serializar
  // já existe hoje (o rascunho em localStorage faz JSON.stringify(config) a cada
  // mudança). Baseline reinicia ao carregar/trocar de projeto-subprojeto e após
  // salvar (ver handleSaveProject).
  const dirtyIdentityRef = useRef<string>(`${currentProjectId}|${currentVariantId}`);
  const dirtyBaselineRef = useRef<string>('');
  const dirtyMountRef = useRef(false);
  useEffect(() => {
    const identity = `${currentProjectId}|${currentVariantId}`;
    const snapshot = JSON.stringify({ config, audios, videos, audioUrl, videoUrl });
    if (!dirtyMountRef.current) {
      dirtyMountRef.current = true;
      dirtyIdentityRef.current = identity;
      dirtyBaselineRef.current = snapshot;
      return;
    }
    if (identity !== dirtyIdentityRef.current) {
      // Carregou/trocou de projeto ou subprojeto → novo baseline, começa limpo.
      dirtyIdentityRef.current = identity;
      dirtyBaselineRef.current = snapshot;
      setIsDirty(false);
      return;
    }
    // Mesma identidade: só é "sujo" se o conteúdo difere do baseline salvo.
    setIsDirty(snapshot !== dirtyBaselineRef.current);
  }, [config, audios, videos, audioUrl, videoUrl, currentProjectId, currentVariantId]);

  // Validação visual da aba Copy. Liga quando o cliente tenta sair da aba
  // (pela barra de navegação) sem ter preenchido os campos obrigatórios →
  // CopyTab desenha outline vermelho nos campos vazios. Não bloqueia a saída.
  const [showCopyRequiredErrors, setShowCopyRequiredErrors] = useState(false);

  // Pedido de troca de aba pela barra de navegação. Se há trabalho não salvo,
  // abre o modal; senão navega direto. Transições programáticas (após salvar,
  // carregar, gerar) seguem usando setCurrentStep e NÃO passam por aqui.
  const requestStepChange = (target: Step) => {
    if (target === currentStep) return;
    // Saindo da Copy → sinaliza os obrigatórios ainda vazios (uma vez basta;
    // depois disso o vermelho some sozinho conforme o cliente preenche).
    if (currentStep === 'copy' && target !== 'copy') setShowCopyRequiredErrors(true);
    if (isDirty && currentProjectId) {
      setPendingStepChange(target);
    } else {
      setCurrentStep(target);
    }
  };

  const updateProjectHookVisual = (projectId: string, data: Partial<HookVisualData>) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId
          ? {
              ...p,
              config: {
                ...p.config,
                hookVisual: { ...p.config.hookVisual, ...data },
              },
            }
          : p
      )
    );

    if (projectId === currentProjectId) {
      setConfig((prev) => ({
        ...prev,
        hookVisual: { ...(prev?.hookVisual || {}), ...data },
      }));
    }
  };

  const [providerError, setProviderError] = useState<{
    provider: 'Model' | 'ElevenLabs' | 'HeyGen';
    message: string;
  } | null>(null);
  const [videoOp, setVideoOp] = useState<any>(null);
  const [isTestMode, setIsTestMode] = useState(false);
  const [useNativeFallback, setUseNativeFallback] = useState(false);
  const [copySubMode, setCopySubMode] = useState<'zero' | 'improve' | 'ready'>('zero');
  // Blueprint Fase 4 — só aplicável quando type === 'complete'. Null antes
  // do cliente escolher, força a UI a perguntar antes de habilitar "Criar".
  const [newSourceMode, setNewSourceMode] = useState<'vsl' | 'product' | null>(null);

  const [copyDiscoveryMode, setCopyDiscoveryMode] = useState<
    'unknown' | 'known' | 'discovering' | 'done'
  >('unknown');

  const updateConfig = (section: keyof AdConfig, subSection: string, field: string, value: any) => {
    setConfig((prev) => {
      const currentSub = (prev[section] as any)[subSection] || {};
      const newSub = { ...currentSub, [field]: value };

      // Auto-suggestion for basePhrase if field is angleIdea
      if (section === 'copy' && subSection === 'answers' && field === 'angleIdea' && value) {
        const suggestions: Record<string, string> = {
          'Você está fazendo errado':
            'O verdadeiro problema não é o que você está fazendo, é COMO você está fazendo.',
          'Não é culpa sua': 'Você não falhou, o sistema que te ensinaram é que está quebrado.',
          'Ninguém te contou isso':
            'Existe um segredo que os especialistas não querem que você saiba.',
          'O problema não é o que você pensa':
            'A causa real da sua dor não é X, é algo muito mais profundo.',
          'Existe uma forma mais simples': 'Pare de complicar. Existe um caminho 10x mais rápido.',
        };
        if (suggestions[value]) newSub.basePhrase = suggestions[value];
      }

      return {
        ...prev,
        [section]: {
          ...(prev[section] as any),
          [subSection]: newSub,
        },
      };
    });
    if (section === 'copy') setHasUnsavedCopyChanges(true);
  };

  const applyAwarenessLevelChange = (newLevel: string) => {
    setConfig((prev) => ({
      ...prev,
      copy: {
        ...prev.copy,
        answers: {
          ...prev.copy.answers,
          awarenessLevel: newLevel,
        },
      },
    }));
    setHasUnsavedCopyChanges(true);
  };

  const handleConfirmAwarenessChange = () => {
    if (!pendingAwarenessLevel) return;
    applyAwarenessLevelChange(pendingAwarenessLevel);
    setShowAwarenessChangeModal(false);
    setPendingAwarenessLevel(null);
  };

  useEffect(() => {
    if (config.copy?.answers?.discoveredPersona) {
      try {
        const persona = JSON.parse(config.copy.answers.discoveredPersona);
        // Só preenche se o campo estiver vazio
        if (!config.copy.answers.audience && persona.persona) {
          updateConfig('copy', 'answers', 'audience', persona.persona);
        }
        if (!config.copy.answers.situation && persona.mainPain) {
          updateConfig('copy', 'answers', 'situation', persona.mainPain);
        }
        if (!config.copy.answers.awarenessLevel && persona.awarenessLevel) {
          updateConfig('copy', 'answers', 'awarenessLevel', persona.awarenessLevel);
        }
        if ((!config.copy.answers.age || config.copy.answers.age.length === 0) && persona.age) {
          const ageOptions = ['18-24', '25-34', '35-44', '45-54', '55+'];
          const personaAgeStr = String(persona.age);
          const matched = ageOptions.filter((opt) => personaAgeStr.includes(opt));
          if (matched.length > 0) {
            updateConfig('copy', 'answers', 'age', matched);
          } else {
            const num = parseInt(personaAgeStr);
            if (!isNaN(num)) {
              if (num >= 18 && num <= 24) updateConfig('copy', 'answers', 'age', ['18-24']);
              else if (num >= 25 && num <= 34) updateConfig('copy', 'answers', 'age', ['25-34']);
              else if (num >= 35 && num <= 44) updateConfig('copy', 'answers', 'age', ['35-44']);
              else if (num >= 45 && num <= 54) updateConfig('copy', 'answers', 'age', ['45-54']);
              else if (num >= 55) updateConfig('copy', 'answers', 'age', ['55+']);
            }
          }
        }
        if (!config.copy.answers.painPoints && persona.mainPain) {
          updateConfig('copy', 'answers', 'painPoints', persona.mainPain);
        }
        if (!config.copy.answers.triedBefore && persona.triedBefore) {
          updateConfig('copy', 'answers', 'triedBefore', persona.triedBefore);
        }
      } catch (e) {}
    }
  }, [config.copy?.answers?.discoveredPersona]);

  const [discoveryStep, setDiscoveryStep] = useState<number>(0);
  const [discoveryAnswers, setDiscoveryAnswers] = useState<Record<string, string>>({});
  const [generatedPersona, setGeneratedPersona] = useState<any>(null);
  const [showEditPersonaModal, setShowEditPersonaModal] = useState(false);
  const [pendingNewSubproject, setPendingNewSubproject] = useState<Project<AdConfig> | null>(null);
  const [copyFieldsApplied, setCopyFieldsApplied] = useState(false);
  const [personasSaved, setPersonasSaved] = useState(false);

  useEffect(() => {
    // Sincroniza as personas mostradas com o PROJETO ATUAL. Sem isso, as
    // personas de um projeto vazavam pra outro ao trocar de projeto (estado
    // global que não zerava). Por isso restauramos SEMPRE do projeto (sem a
    // trava antiga `!generatedPersona?.personas`) e LIMPAMOS quando o projeto
    // não tem personas salvas.
    const raw = config.copy?.answers?.savedPersonas;
    if (raw) {
      try {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved) && saved.length > 0) {
          setPersonasSaved(true);
          setGeneratedPersona({ personas: saved });
          return;
        }
      } catch (e) {}
    }
    // Projeto sem personas salvas → limpa o que sobrou de outro projeto.
    setPersonasSaved(false);
    setGeneratedPersona(null);
  }, [config.copy?.answers?.savedPersonas]);
  const [showAwarenessChangeModal, setShowAwarenessChangeModal] = useState(false);
  const [pendingAwarenessLevel, setPendingAwarenessLevel] = useState<string | null>(null);

  // Estados da Edição 2 (AssemblyAI + ZapCap)
  const [autoEditState, setAutoEditState] = useState<AutoEditState>({
    status: 'idle',
    step: '',
    progress: 0,
    brollCandidates: [],
    selectedBrollIds: [],
    editMode: 'auto',
    versions: [],
  });
  const [userVideos, setUserVideos] = useState<{ name: string; url: string; path: string }[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  // Fetch user videos from Firebase Storage
  useEffect(() => {
    const fetchUserVideos = async () => {
      if (!user?.uid) return;
      try {
        const videoFolderRef = ref(storage, `video/${user.uid}/`);
        const result = await listAll(videoFolderRef);
        const videoPromises = result.items.slice(0, 10).map(async (item) => {
          const url = await getDownloadURL(item);
          return { name: item.name, url, path: item.fullPath };
        });
        const videos = await Promise.all(videoPromises);
        setUserVideos(videos);
      } catch (err) {
        console.error('[Fetch Videos] Error:', err);
      }
    };
    if (user?.uid && currentStep === 'edit2') {
      fetchUserVideos();
    }
  }, [user?.uid, currentStep]);

  const handleUploadVideo = async (file: File) => {
    if (!user?.uid) {
      toast.error('Você precisa estar logado para fazer upload.');
      return;
    }

    try {
      const duration = await detectDuration(file);
      if (duration > 180) {
        toast.error('Vídeo muito longo. O máximo permitido é 3 minutos.');
        return;
      }

      const format = await detectVideoFormat(file);

      setAutoEditState((prev) => ({
        ...prev,
        status: 'uploading',
        progress: 0,
      }));

      const timestamp = Date.now();
      const filePath = `video/${user.uid}/${timestamp}.mp4`;
      const storageRef = ref(storage, filePath);
      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on(
        'state_changed',
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploadProgress(progress);
        },
        (error) => {
          console.error('[Upload Error]:', error);
          toast.error('Erro ao fazer upload do vídeo.');
          setAutoEditState((prev) => ({ ...prev, status: 'idle' }));
        },
        async () => {
          const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);

          let finalUrl = downloadUrl;
          if (file.size > 500 * 1024 * 1024) {
            toast(
              'Seu vídeo é grande. Vamos otimizá-lo automaticamente mantendo a qualidade Full HD... ⚡',
              { icon: '⚡' }
            );
            setAutoEditState((prev) => ({ ...prev, compressing: true }));

            try {
              const res = await fetch('/api/video/compress', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  filePath,
                  originalUrl: downloadUrl,
                  userId: user.uid,
                }),
              });

              if (res.status === 422) {
                const data = await res.json();
                toast.error(data.error || 'Erro na compressão.');
                setAutoEditState((prev) => ({
                  ...prev,
                  status: 'idle',
                  originalVideoUrl: undefined,
                }));
                return;
              }

              if (!res.ok) throw new Error('Erro desconhecido na compressão.');

              const data = await res.json();
              finalUrl = data.url;
              toast.success('Vídeo otimizado com sucesso!');
            } catch (err) {
              console.error('[Compression Error]:', err);
              toast.error('Falha ao otimizar vídeo.');
            } finally {
              setAutoEditState((prev) => ({ ...prev, compressing: false }));
            }
          }

          setAutoEditState((prev) => ({
            ...prev,
            status: 'idle',
            originalVideoUrl: finalUrl,
            videoFormat: format,
          }));
          setVideoUrl(finalUrl);
          toast.success(
            `✅ Vídeo carregado — Formato detectado: ${format === '9:16' ? 'Vertical 9:16' : format === '16:9' ? 'Horizontal 16:9' : 'Quadrado 1:1'}`
          );
        }
      );
    } catch (err) {
      console.error('[Pre-upload Error]:', err);
      toast.error('Erro ao processar arquivo.');
      setAutoEditState((prev) => ({ ...prev, status: 'idle' }));
    }
  };
  const [zapCapTemplates, setZapCapTemplates] = useState<ZapCapTemplate[]>([]);
  const [zapCapRenderConfig, setZapCapRenderConfig] = useState<ZapCapRenderConfig>({
    templateId: '',
    emoji: false,
    emphasizeKeywords: true,
    animation: true,
    fontUppercase: true,
    fontSize: 46,
    fontColor: '#ffffff',
    highlightColor1: '#2bf82a',
    highlightColor2: '#fdfa14',
    highlightColor3: '#f01916',
    top: 75,
    brollPercent: 30,
  });
  const [brollPercent, setBrollPercent] = useState<number>(50);
  const [recommendedBrollPercent, setRecommendedBrollPercent] = useState<number>(50);
  const zapcapPollRef = useRef<NodeJS.Timeout | null>(null);
  const isRenderingRef = useRef(false);

  // Estados isolados da aba Edição Zap (separados da Edição Premium)
  // Avatar tab mode: 'body' (default — corpo do vídeo) or 'hook' (gancho).
  // The toggle lives at the top of the Avatar tab; the ref lets the HeyGen
  // polling callback know which slot to write to when generation finishes
  // (the closure may outlive the user toggling back).
  const [avatarMode, setAvatarMode] = useState<'body' | 'hook' | 'vsl'>('body');
  const avatarModeRef = useRef<'body' | 'hook' | 'vsl'>('body');
  useEffect(() => {
    avatarModeRef.current = avatarMode;
  }, [avatarMode]);

  // Edição Zap state — captions, headline overlay, intercut modal, join
  // picker, and the long-running render-status object. See useZapState.
  const zap = useZapState();
  const {
    zapState,
    setZapState,
    zapPollRef,
    isZapRenderingRef,
    zapAutoRetryRef,
    zapVideoUrl,
    zapTemplateId,
    zapBrollPercent,
    zapBrollStartSec,
    zapEmoji,
    zapAnimation,
    zapEmphasizeKeywords,
    zapSilenceRemoval,
    zapLanguage,
    zapSubtitleTop,
    zapFontUppercase,
    zapFontSize,
    zapDisplayWords,
    zapFontColor,
    zapStrokeColor,
    zapUseCustomHighlight,
    zapHl1,
    zapHl2,
    zapHl3,
    setEditZapMode,
    editZapModeRef,
    headlineSourceUrl,
    setHeadlineSourceUrl,
    headlineText,
    headlineBgColor,
    headlineTextColor,
    headlineStrokeColor,
    headlineStrokeWidth,
    headlineHl1,
    headlineHl2,
    headlineHl3,
    headlineBgHl1,
    headlineBgHl2,
    headlineBgHl3,
    headlineWordStyles,
    headline2Enabled,
    headlineSwitchPct,
    headlineAutoTime,
    headline2Text,
    headline2BgColor,
    headline2WordStyles,
    headlineFontSize,
    headlineBarHeightPct,
    setHeadlineRendering,
    intercutSourceUrl,
    setIntercutSourceUrl,
    // F6.5 — intercutAvatarSec/intercutBlackSec/intercutTexts são legacy
    // (modo cadência). O novo modal manual usa apenas intercutFontSize +
    // insertions[] que vem como parâmetro. Mantidos no useZapState pra compat
    // mas não destructured aqui.
    intercutFontSize,
    setIntercutRendering,
  } = zap;

  // Project-level flag: does this project use a separate hook? Defaults to
  // true when the field is missing (backward-compat with older projects).
  // When false: hook-visual step is skipped in navigation, hook-mode
  // toggles in Voz/Avatar/Edição Zap hide, Juntar button hides.
  const useHookFlow = (config as any).useHook !== false;
  const setUseHookFlow = (next: boolean) => {
    setConfig((prev) => ({ ...(prev as any), useHook: next }) as any);
    // (auto-save removido — salvar manualmente)
    if (!next) {
      // Snap any active hook modes back to body so nothing references the
      // hidden side after the flag flips.
      setAvatarMode('body');
      setEditZapMode('body');
      setVoiceSource('copy');
    }
  };

  // Initialize Scene Builder
  useEffect(() => {
    if (
      currentStep === 'edit2' &&
      videoUrl &&
      (!config.edit.scenes || config.edit.scenes.length === 0)
    ) {
      const initialScene: Scene = {
        id: 'initial-avatar',
        type: 'avatar',
        duration: config.format.duration || 10,
        settings: { trimStart: 0, trimEnd: config.format.duration || 10 },
      };
      setConfig((prev) => ({
        ...prev,
        edit: { ...prev.edit, scenes: [initialScene] },
      }));
    }
  }, [currentStep, videoUrl]);

  // Scroll to top whenever the user changes step
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [currentStep]);

  // Live timer for video generation metrics
  useEffect(() => {
    let timer: any = null;

    const isRunning =
      videoOp && ['pending', 'waiting', 'processing'].includes(videoOp.status) && !videoOp.isStuck;

    if (isRunning) {
      if (process.env.NODE_ENV !== 'production')
        console.log('[HeyGen Timer] Starting live clock...');
      timer = setInterval(() => {
        const now = Date.now();
        setVideoOp((prev: any) => {
          if (!prev || !['pending', 'waiting', 'processing'].includes(prev.status)) return prev;

          const totalTime = Math.round((now - prev.startTime) / 1000);
          let queuedTime = prev.queuedTime || 0;
          let renderTime = prev.renderTime || 0;

          if (prev.status === 'processing') {
            if (prev.processingStartTime) {
              renderTime = Math.round((now - prev.processingStartTime) / 1000);
            }
          } else {
            queuedTime = Math.round((now - prev.startTime) / 1000);
          }

          return {
            ...prev,
            totalTime,
            queuedTime,
            renderTime,
          };
        });
      }, 1000);
    }

    return () => {
      if (timer) {
        if (process.env.NODE_ENV !== 'production')
          console.log('[HeyGen Timer] Stopping live clock.');
        clearInterval(timer);
      }
    };
  }, [videoOp?.status, videoOp?.startTime, videoOp?.isStuck]);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [elevenLabsVoices, setElevenLabsVoices] = useState<any[]>([]);

  const [viewingProjectId, setViewingProjectId] = useState<string | null>(null);
  const [viewingVariant, setViewingVariant] = useState<ProjectVariant<AdConfig> | null>(null);
  const [heygenAvatars, setHeygenAvatars] = useState<any[]>([]);
  const [loadingAvatars, setLoadingAvatars] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarSearch, setAvatarSearch] = useState('');
  const [videoToDelete, setVideoToDelete] = useState<any>(null);
  const [showDeleteHistoryVideoModal, setShowDeleteHistoryVideoModal] = useState(false);
  const [avatarFilters, setAvatarFilters] = useState({
    gender: localStorage.getItem('avatarFilters_gender') || '',
    ages: JSON.parse(localStorage.getItem('avatarFilters_ages') || '[]'),
    styles: JSON.parse(localStorage.getItem('avatarFilters_styles') || '[]'),
    ethnicities: JSON.parse(localStorage.getItem('avatarFilters_ethnicities') || '[]'),
    sort: localStorage.getItem('avatarFilters_sort') || 'name',
  });
  // Recommendation cache. Read from config.copy.aiRecommendation so it
  // survives tab reopens and project reloads (avoids re-spending Claude
  // tokens on every visit). The cache embeds an `inputsKey` fingerprint
  // — when persona/copy edits change the inputs, the panel auto-refetches.
  const avatarRecommendation =
    ((config.copy as any)?.aiRecommendation as CachedRecommendation | null | undefined) || null;
  const setAvatarRecommendation = (cached: CachedRecommendation) => {
    setConfig((prev) => ({
      ...prev,
      copy: { ...prev.copy, aiRecommendation: cached } as any,
    }));
    // (auto-save removido — salvar manualmente)
  };

  useEffect(() => {
    localStorage.setItem('avatarFilters_gender', avatarFilters.gender);
    localStorage.setItem('avatarFilters_ages', JSON.stringify(avatarFilters.ages));
    localStorage.setItem('avatarFilters_styles', JSON.stringify(avatarFilters.styles));
    localStorage.setItem('avatarFilters_ethnicities', JSON.stringify(avatarFilters.ethnicities));
    localStorage.setItem('avatarFilters_sort', avatarFilters.sort);
  }, [avatarFilters]);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  // % de b-roll REALMENTE usado na tentativa em andamento (pode ser menor que o
  // slider por causa da degradação suave). O loop de polling lê daqui pra saber
  // pra quanto reduzir no próximo retry e o que mostrar na mensagem de sucesso.
  const zapEffectiveBrollRef = useRef<number>(0);

  const [isExpanded] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [showElevenLabsConfig, setShowElevenLabsConfig] = useState(false);
  const [newElevenLabsKey, setNewElevenLabsKey] = useState('');
  const [isUpdatingKey, setIsUpdatingKey] = useState(false);
  const [isTestingKey, setIsTestingKey] = useState(false);

  const handleTestElevenLabsKey = async () => {
    if (!newElevenLabsKey) return;
    const trimmedKey = newElevenLabsKey.trim();
    setIsTestingKey(true);
    try {
      const response = await fetch('/api/elevenlabs/health', {
        headers: { 'xi-api-key': trimmedKey }, // We'll update the server to accept this header for testing
      });
      const data = await response.json();
      if (response.ok) {
        toast.success(`Conexão bem-sucedida! Plano: ${data.tier}`);
      } else {
        toast.error(`Falha na conexão: ${data.message || 'Chave inválida'}`);
      }
    } catch (err) {
      toast.error('Erro ao testar conexão');
    } finally {
      setIsTestingKey(false);
    }
  };

  const handleUpdateElevenLabsKey = async () => {
    if (!newElevenLabsKey) return;
    const trimmedKey = newElevenLabsKey.trim();
    setIsUpdatingKey(true);
    try {
      const response = await fetch('/api/elevenlabs/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: trimmedKey }),
      });
      if (response.ok) {
        toast.success('API Key do ElevenLabs atualizada!');
        setShowElevenLabsConfig(false);
        // Retry fetching voices
        setCurrentStep('copy'); // Toggle step to trigger useEffect
        setTimeout(() => setCurrentStep('voz-premium'), 10);
      } else {
        const data = await response.json();
        toast.error(data.error || 'Erro ao atualizar API Key');
      }
    } catch (err) {
      toast.error('Erro de conexão ao atualizar API Key');
    } finally {
      setIsUpdatingKey(false);
    }
  };
  const videoRef = React.useRef<HTMLVideoElement>(null);

  // Se o modo de voz ficou em 'vsl' mas não há VSL (ex.: projeto sem VSL, ou
  // VSL apagada), volta pra 'copy' pra não travar num script vazio sem toggle.
  useEffect(() => {
    if (voiceSource === 'vsl') {
      const vc = (config as any).copyVsl;
      const hasVsl = !!(vc && (vc.finalScript || vc.generatedScript));
      if (!hasVsl) setVoiceSource('copy');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceSource, currentStep, (config as any).copyVsl]);

  useEffect(() => {
    const fetchVoices = async () => {
      if (currentStep === 'voz-premium' && elevenLabsVoices.length === 0) {
        try {
          const response = await fetch('/api/elevenlabs/voices');
          if (!response.ok) {
            const errorData = await response.json();
            const errorMessage =
              errorData.detail?.message ||
              errorData.error?.message ||
              errorData.message ||
              errorData.error ||
              `Erro ${response.status}`;
            throw new Error(`ElevenLabs: ${errorMessage}`);
          }
          const contentType = response.headers.get('content-type');
          let data;
          if (contentType && contentType.includes('application/json')) {
            data = await response.json();
          } else {
            const text = await response.text();
            throw new Error(`Resposta inválida do servidor: ${text.substring(0, 100)}`);
          }

          // Log raw response for inspection
          console.log('[ElevenLabs] Raw Voices Response:', data);

          setElevenLabsVoices(data.voices || []);
        } catch (err: any) {
          console.error('Error fetching voices:', err);
        }
      }
    };
    fetchVoices();
  }, [currentStep]);

  useEffect(() => {
    const fetchAvatars = async () => {
      if (currentStep === 'avatar' && heygenAvatars.length === 0) {
        setLoadingAvatars(true);
        setAvatarError(null);
        try {
          const response = await fetch('/api/heygen/avatars');
          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Erro ${response.status}`);
          }
          const contentType = response.headers.get('content-type');
          let data;
          if (contentType && contentType.includes('application/json')) {
            data = await response.json();
          } else {
            const text = await response.text();
            throw new Error(`Resposta inválida do servidor: ${text.substring(0, 100)}`);
          }
          setHeygenAvatars(data.data?.avatars || []);

          if (data.data?.avatars?.length > 0) {
            console.log(
              '[HeyGen Avatar Tags Sample]',
              data.data.avatars.slice(0, 3).map((a: any) => ({
                name: a.avatar_name,
                tags: a.tags,
                gender: a.gender,
              }))
            );
            if (!config.avatar.faceId) {
              setConfig((prev) => ({
                ...prev,
                avatar: {
                  ...prev.avatar,
                  faceId: data.data.avatars[0].avatar_id,
                },
              }));
            }
          }
        } catch (err: any) {
          console.error('Error fetching avatars:', err);
          setAvatarError(err.message);
        } finally {
          setLoadingAvatars(false);
        }
      }
    };
    fetchAvatars();
  }, [currentStep]);

  useEffect(() => {
    const checkKey = async () => {
      // Check if key is already in env
      const envKey =
        (window as any).process?.env?.API_KEY ||
        (window as any).process?.env?.GEMINI_API_KEY ||
        (typeof process !== 'undefined'
          ? process.env.API_KEY || process.env.GEMINI_API_KEY
          : undefined);
      if (envKey) {
        setHasApiKey(true);
        return;
      }

      if ((window as any).aistudio?.hasSelectedApiKey) {
        try {
          const hasKey = await (window as any).aistudio.hasSelectedApiKey();
          setHasApiKey(hasKey);
        } catch (err) {
          console.error('Error checking API key status:', err);
        }
      }
    };
    checkKey();
  }, []);

  const isVideoUpToDate = () => {
    if (!config.lastVideoMetadata || !config.videoUrl) return false;

    let avatarScript = (config.copy.generatedScript || '').includes('[AVATAR]:')
      ? config.copy.generatedScript.split('[AVATAR]:')[1]?.split('[SCENE]:')[0]?.trim() || ''
      : config.copy.generatedScript || '';

    if (isTestMode) {
      avatarScript = 'Olá! Este é um teste rápido de 3 segundos para validar a geração.';
    }

    return (
      config.lastVideoMetadata.avatarId === config.avatar.faceId &&
      config.lastVideoMetadata.voiceId === config.avatar.voiceId &&
      config.lastVideoMetadata.script === avatarScript &&
      config.lastVideoMetadata.audioUrl === audioUrl &&
      config.lastVideoMetadata.aspectRatio === config.format.aspectRatio &&
      config.lastVideoMetadata.isTestMode === isTestMode &&
      config.lastVideoMetadata.status === 'completed'
    );
  };

  useEffect(() => {
    if (
      config.lastVideoMetadata &&
      config.lastVideoMetadata.status === 'pending' &&
      !videoOp &&
      !loading &&
      currentStep === 'avatar'
    ) {
      const videoId = config.lastVideoMetadata.videoId;
      const startTime = new Date(config.lastVideoMetadata.createdAt).getTime();

      if (process.env.NODE_ENV !== 'production') {
        console.log(`[Persistence] Resuming polling for video ${videoId}`);
      }

      const initialOp = {
        id: videoId,
        status: 'pending',
        displayStatus: 'Resuming...',
        progress: 0,
        startTime,
        requestSentTime: new Date(startTime).toLocaleTimeString(),
        queuedStartTime: startTime,
        processingStartTime: null,
        totalTime: 0,
        pollCount: 0,
        lastStatus: 'pending',
        lastStatusChangeTime: startTime,
        isStuck: false,
        stuckReason: null,
      };
      setVideoOp(initialOp);
      startPolling(videoId);
    }
  }, [config.lastVideoMetadata, currentStep]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Projects loader — ONE-TIME getDocs em vez de onSnapshot em tempo real.
  // O onSnapshot re-baixava TODOS os projetos (configs inteiros, MBs cada) a
  // CADA escrita (criar/salvar/deletar) — travava a UI (criar projeto rodava
  // sem fim). Agora carrega 1x ao logar; as mutações atualizam a lista local
  // (setProjects) na hora, sem re-baixar tudo.
  useEffect(() => {
    if (!user) {
      setProjects([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const q = query(
          collection(db, 'projects'),
          where('userId', '==', user.uid),
          orderBy('createdAt', 'desc')
        );
        const snapshot = await fbGetDocs(q);
        if (cancelled) return;
        const projectsData = snapshot.docs.map((d) => {
          const data = d.data() as any;
          if (data.config && !data.config.hookVisual) {
            data.config.hookVisual = {
              promptImagem: '',
              imagensGeradas: [],
              imagemEscolhida: '',
              promptVideo: '',
              videoGerado: '',
              duracaoVideo: 4,
              modeloImagem: 'imagen-4.0-generate-001',
              modeloVideo: 'veo-3.1-fast-generate-preview',
            };
          }
          return { id: d.id, ...data } as Project<AdConfig>;
        });
        // Subprojetos moram numa subcoleção (cada um com seu próprio teto de
        // 1 MiB). Carrega-os por projeto e popula `project.variants` em memória,
        // de modo que o resto do app (que lê o array) não muda. Fallback pro
        // array inline cobre projetos ainda não migrados.
        const withVariants = await Promise.all(
          projectsData.map(async (p) => {
            try {
              const sub = await loadVariants(p.id);
              return { ...p, variants: sub.length ? sub : p.variants || [] };
            } catch {
              return { ...p, variants: p.variants || [] };
            }
          })
        );
        if (cancelled) return;
        setProjects(withVariants);
      } catch (error) {
        if (!cancelled) console.error('Error loading projects:', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    // Test connection to Firestore
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes('the client is offline') ||
            error.message.includes('unavailable') ||
            error.message.includes('Failed to get document'))
        ) {
          // Ignore the offline/unavailable warning during boot negotiation
          console.warn('Firebase connection might be in offline mode or negotiating fallback.');
        }
      }
    };
    testConnection();

    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setIsAuthReady(true);

      if (firebaseUser) {
        // Ensure user document exists
        const userRef = doc(db, 'users', firebaseUser.uid);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
          const isAdmin = firebaseUser.email === 'israelnz2018@hotmail.com';
          await setDoc(userRef, {
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            credits: 1000,
            role: isAdmin ? 'admin' : 'user',
            createdAt: serverTimestamp(),
          });
          setUserRole(isAdmin ? 'admin' : 'user');
        } else {
          const data = userSnap.data();
          const isAdmin = firebaseUser.email === 'israelnz2018@hotmail.com';
          setUserRole(isAdmin ? 'admin' : data.role || 'user');
        }
      }
    });

    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!user) {
      setCredits(0);
      return;
    }

    const unsubscribeCredits = onSnapshot(
      doc(db, 'users', user.uid),
      (doc) => {
        if (doc.exists()) {
          setCredits(doc.data().credits);
        }
      },
      (error) => {
        console.error('Firestore Error (Credits):', error);
      }
    );

    return () => unsubscribeCredits();
  }, [user]);

  useEffect(() => {
    const handleCreditsUpdate = (e: any) => setCredits(e.detail);
    window.addEventListener('credits-updated', handleCreditsUpdate);
    return () => window.removeEventListener('credits-updated', handleCreditsUpdate);
  }, []);

  // Gasto REAL da API da Claude: poll a cada 10s + refetch imediato quando uma
  // geração termina (evento 'claude-usage-changed').
  useEffect(() => {
    let alive = true;
    const fetchSpend = async () => {
      try {
        const r = await fetch('/api/claude/usage');
        const d = await r.json();
        if (alive && d?.success && d.usage) setApiSpend(d.usage);
      } catch {
        /* servidor offline — ignora */
      }
    };
    fetchSpend();
    const id = setInterval(fetchSpend, 10000);
    const onChange = () => fetchSpend();
    window.addEventListener('claude-usage-changed', onChange);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener('claude-usage-changed', onChange);
    };
  }, []);

  // Informa o saldo atual da conta Anthropic (a API não expõe saldo por chave).
  // O app desconta o gasto medido a partir daí pra mostrar o disponível.
  const promptSetApiBalance = async () => {
    const atual = apiSpend?.availableUSD;
    const input = window.prompt(
      'Qual o saldo ATUAL da conta Anthropic em US$?\n(veja em console.anthropic.com → Plans & Billing).\nO app desconta o gasto medido daqui pra frente.',
      atual != null ? atual.toFixed(2) : ''
    );
    if (input == null) return;
    const amount = Number(input.replace(',', '.').replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error('Valor inválido.');
      return;
    }
    try {
      const r = await fetch('/api/claude/usage/balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      });
      const d = await r.json();
      if (d?.success && d.usage) {
        setApiSpend(d.usage);
        toast.success(`Saldo definido: US$ ${amount.toFixed(2)}`);
      }
    } catch {
      toast.error('Falha ao salvar o saldo.');
    }
  };

  const handleCreateProject = async () => {
    if (!user || !newProjectName.trim()) return;

    setIsSaving(true);
    try {
      const projectConfig = {
        angle: 'podcast',
        copy: {
          mode: 'questions',
          subMode: copySubMode,
          // Blueprint Fase 4 — só persiste pra projetos 'complete'. Pros
          // outros tipos fica undefined (e.g. video-only não precisa).
          answers: {},
          generatedScript: '',
          generatedHooks: [],
        },
        avatar: { faceId: '', customFaceUrl: null, voiceId: '' },
        subtitles: { style: 'simple' },
        format: { aspectRatio: '9:16', duration: 15 },
        hookVisual: {
          promptImagem: '',
          imagensGeradas: [],
          imagemEscolhida: '',
          promptVideo: '',
          videoGerado: '',
          duracaoVideo: 4,
          modeloImagem: 'imagen-4.0-generate-001',
          modeloVideo: 'veo-3.1-fast-generate-preview',
        },
        edit: {
          transition: 'none',
          backgroundMusic: 'none',
          timelineEdits: [],
        },
        audios: [],
      };

      const projectData = {
        userId: user.uid,
        name: newProjectName,
        type: newProjectType,
        createdAt: serverTimestamp(),
      };

      // Cria primeiro um "shell" minimo do projeto. O config completo fica
      // no estado local imediatamente e vai para o Firestore no primeiro save
      // normal do projeto. Isso evita spinner infinito na criacao quando
      // algum campo mais novo do config prende a escrita inicial.
      const docRef = doc(collection(db, 'projects'));
      const createWithSdk = setDoc(docRef, projectData);
      let projectId = docRef.id;
      try {
        await Promise.race([
          createWithSdk,
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('Firestore SDK create timed out')),
              CREATE_PROJECT_TIMEOUT_MS
            )
          ),
        ]);
      } catch (err) {
        console.warn('[ProjectCreate] SDK write did not finish, trying REST fallback.', err);
        projectId = await createProjectViaRest(user, docRef.id, projectData);
      }

      setCurrentProjectId(projectId);
      setConfig(projectConfig as AdConfig);
      // UX8: reset comprehensive — antes só config era trocado. Top-level
      // state (audios, videos, audioUrl, etc) + currentVariantId continuavam
      // apontando pro projeto ANTERIOR. Auto-save 2s depois persistia esses
      // assets antigos no projeto novo. Mesma família de bugs que UX6
      // (variant) e agora aplicado pra criar projeto novo. Espelha o reset
      // que handleLoadProject ja faz.
      setCurrentVariantId(null);
      setAudioUrl(null);
      setAudioStoragePath(null);
      setAudios([]);
      setVideoUrl(null);
      setVideoStoragePath(null);
      setVideos([]);
      setLastVideoMetadata(null);
      setGenerationStage('idle');
      // Limpa personas de QUALQUER projeto anterior (mesmo geradas e não
      // salvas) pra não vazar pro projeto novo.
      setGeneratedPersona(null);
      setPersonasSaved(false);
      setHasUnsavedCopyChanges(false);
      setShowNewProjectModal(false);
      setNewProjectName('');
      // Reset Blueprint Fase 4 escolha pra não vazar pra próximo projeto.
      setNewSourceMode(null);
      if (newProjectType === 'complete') {
        setCurrentVariantId(null);
        setCopyDiscoveryMode('known');
        setCurrentStep('persona');
      } else {
        // Tipos legacy (não criados mais pelo modal).
        const firstStepByType: Record<string, any> = {
          copy: 'persona',
          video: 'voz-premium',
          editing: 'edit-zap',
        };
        setCurrentStep(firstStepByType[newProjectType] || 'persona');
      }
      setProjects((prev) => [
        { id: projectId, ...projectData, config: projectConfig, createdAt: new Date() } as any,
        ...prev,
      ]);
    } catch (err) {
      const message = getErrorMessage(err);
      console.error('Error creating project:', message, err);
      toast.error(`Nao consegui gravar o projeto: ${message}`, {
        duration: 12000,
      });
      setError('Falha ao criar projeto.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleGeneratePersona = async (answers: Record<string, any>) => {
    setLoading(true);
    try {
      const result = await discoverPersonaWithClaude(answers);
      setGeneratedPersona(result);
      setPersonasSaved(false);
      toast.success('3 Personas geradas com sucesso! Escolha uma para continuar. ✨');
      addLog('PERSONAS_IDENTIFICADAS');
    } catch (err: any) {
      console.error('Erro ao gerar personas:', err);
      toast.error(`Erro ao gerar personas: ${err.message || 'Tente novamente.'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSavePersonas = async () => {
    if (!generatedPersona?.personas || generatedPersona.personas.length === 0) {
      toast.error('Nenhum persona gerado para salvar.');
      return;
    }
    if (!currentProjectId) {
      toast.error('Nenhum projeto ativo. Crie ou abra um projeto primeiro.');
      return;
    }
    // Atualiza o estado local
    const personasJson = JSON.stringify(generatedPersona.personas);
    updateConfig('copy', 'answers', 'savedPersonas', personasJson);
    setPersonasSaved(true);

    // Alimenta o plano (logo abaixo na mesma aba): os 3 personas viram
    // WeightedPersona[] pra a seção de Plano de Marketing aparecer. O
    // usuário escolhe quais incluir lá nos checkboxes do próprio plano.
    const weighted = buildWeightedPersonas(generatedPersona.personas);
    setConfig((prev) => ({
      ...prev,
      copy: { ...prev.copy, personasWithWeights: weighted as any },
    }));

    // Persiste no Firestore via handleSaveProject com override explícito
    try {
      const overrideConfig = {
        ...config,
        copy: {
          ...config.copy,
          answers: {
            ...config.copy.answers,
            savedPersonas: personasJson,
          },
          personasWithWeights: weighted as any,
        },
      };
      await handleSaveProject(overrideConfig);
      toast.success('3 Personas salvos! Role pra baixo pra gerar o plano de marketing.');
    } catch (e) {
      console.error('Erro ao persistir personas:', e);
      toast.error('Personas salvos localmente, mas houve erro ao gravar no servidor.');
    }
  };

  /**
   * Blueprint Path 2 — user wants to generate the full marketing plan
   * (with 15 creative briefs) using a SUBSET of the 3 discovered
   * personas. Selected list comes from the checkboxes in PersonaTab.
   *
   * What this does:
   *   1. Maps the raw LLM persona objects into the WeightedPersona shape
   *      (assigns stable IDs, copies the confidence/weight fields, falls
   *      back to sensible defaults when the new fields aren't present
   *      — back-compat with old saved personas).
   *   2. Re-normalises suggestedWeight across the SELECTED subset so it
   *      sums to 1.0 (the server expects this).
   *   3. Persists to `config.copy.personasWithWeights` (new field added
   *      in Phase 1.1). Survives reloads / re-opens.
   *   4. Navigates to the Plan step. The plan tab reads from
   *      personasWithWeights and lets the user trigger generation.
   *
   * Does NOT generate the plan here — that's an explicit click in
   * PlanTab. Tab-to-tab transitions just carry data.
   */
  // Map raw LLM personas → WeightedPersona[] (back-compat defaults when
  // fields are missing). Stable IDs use rank-based slugs so they're
  // predictable across re-generations. Weights re-normalise to sum 1.0.
  const buildWeightedPersonas = (personas: any[]) => {
    const mapped = personas.map((p: any, idx: number) => {
      const rank = (p.rank || '').toString().toLowerCase();
      const id = rank
        ? `persona_${rank}`
        : `persona_${idx}_${p.name?.toLowerCase().replace(/\s+/g, '_').slice(0, 12) || 'unknown'}`;
      const conf = typeof p.confidence === 'number' ? p.confidence : 0.6;
      const weight =
        typeof p.suggestedWeight === 'number'
          ? p.suggestedWeight
          : // Sensible default when LLM didn't return the field:
            // ranked weights 0.55/0.30/0.15
            idx === 0
            ? 0.55
            : idx === 1
              ? 0.3
              : 0.15;
      return {
        id,
        name: p.name || `Persona ${idx + 1}`,
        description: p.description || '',
        awareness:
          typeof p.awarenessLevel === 'string' || typeof p.awarenessLevel === 'number'
            ? mapNumericAwarenessToString(p.awarenessLevel)
            : 'solution_aware',
        painPoints: [p.mainPain, p.dominantFear, p.hiddenDesire].filter(Boolean) as string[],
        confidence: conf,
        suggestedWeight: weight,
        evidence: Array.isArray(p.evidence) ? p.evidence : [],
        isStretch: p.isStretch === true,
        // Stash the original LLM object so PlanTab/CopyTab can still
        // access fields like recommendedVideoAngle, recommendedHookType,
        // etc. when building briefs.
        raw: p,
      };
    });

    const total = mapped.reduce((acc, p) => acc + (p.suggestedWeight || 0), 0);
    return total > 0
      ? mapped.map((p) => ({ ...p, suggestedWeight: p.suggestedWeight / total }))
      : mapped;
  };

  const handleGoToPlan = (selectedPersonas: any[]) => {
    if (!Array.isArray(selectedPersonas) || selectedPersonas.length === 0) {
      toast.error('Selecione pelo menos 1 persona para montar o planejamento.');
      return;
    }

    const weighted = buildWeightedPersonas(selectedPersonas);
    setConfig((prev) => ({
      ...prev,
      copy: { ...prev.copy, personasWithWeights: weighted as any },
    }));

    requestAnimationFrame(() => {
      document.getElementById('plan-section')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  };

  // Backfill: projetos antigos têm `savedPersonas` mas não
  // `personasWithWeights` (esse campo só era setado pelo botão "Ir pro Plano",
  // já removido). Sem ele, a seção de Plano de Marketing (isV2) não aparece.
  // Deriva os pesos a partir dos personas salvos quando faltam. Muta e
  // retorna o próprio config.
  const ensurePersonaWeights = (cfg: any) => {
    const existing = cfg?.copy?.personasWithWeights;
    if (Array.isArray(existing) && existing.length > 0) return cfg;
    const savedRaw = cfg?.copy?.answers?.savedPersonas;
    if (!savedRaw) return cfg;
    try {
      const parsed = JSON.parse(savedRaw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        cfg.copy.personasWithWeights = buildWeightedPersonas(parsed) as any;
      }
    } catch {
      /* savedPersonas malformado — ignora, segue sem plano */
    }
    return cfg;
  };

  // ─── Blueprint brief handlers ────────────────────────────────────
  // State + callbacks for the Phase 3.3 edit modal and Phase 3.4
  // subproject-creation popup. All brief data is persisted into
  // config.copy.creativeBriefs[] (added to AdConfig in Phase 1.1).

  /** Brief being edited (null = modal closed). */
  const [editingBrief, setEditingBrief] = useState<CreativeBrief | null>(null);
  /** Brief being "executed" (turned into a subprojeto). null = popup closed. */
  const [pendingBriefExec, setPendingBriefExec] = useState<CreativeBrief | null>(null);
  /** Blueprint Fase 4 — Porta A: persona escolhida pra virar subprojeto sem
   *  passar pelo plano de 15. Subprojeto nasce com productInfo + persona
   *  carregados, brief = null (cliente preenche tudo na Copy depois). */
  const [pendingPersonaExec, setPendingPersonaExec] = useState<WeightedPersona | null>(null);
  /** Blueprint Fase 5 — Criativo 16+. Quando setado, abre BriefEditModal em
   *  mode='create' com o draft pré-preenchido. Reusa BriefEditModal pra não
   *  duplicar UI. Salvar → vira novo brief no plano + popup de subprojeto. */
  const [creatingNewBrief, setCreatingNewBrief] = useState<CreativeBrief | null>(null);

  /** Persist the briefs array to config (deep-merge into copy.creativeBriefs). */
  const persistBriefs = (updated: CreativeBrief[]) => {
    setConfig((prev) => ({
      ...prev,
      copy: { ...prev.copy, creativeBriefs: updated } as any,
    }));
    // (auto-save removido — salvar manualmente)
  };

  /** Save an edited brief back into the list, keyed by id. */
  const handleSaveEditedBrief = (updated: CreativeBrief) => {
    const current = ((config.copy as any)?.creativeBriefs as CreativeBrief[] | undefined) || [];
    const next = current.map((b) => (b.id === updated.id ? updated : b));
    persistBriefs(next);
    setEditingBrief(null);
    toast.success(`Criativo ${updated.index} atualizado.`);
  };

  /** Build the suggested subproject name from a brief — the popup shows
   *  this without an input. User just confirms. */
  const briefToSubprojectName = (b: CreativeBrief): string => {
    const awarenessNum =
      b.awareness === 'unaware'
        ? '1'
        : b.awareness === 'problem_aware'
          ? '2'
          : b.awareness === 'solution_aware'
            ? '3'
            : b.awareness === 'product_aware'
              ? '4'
              : '5';
    return `Criativo ${b.index} - Consc.${awarenessNum} - ${b.angle}`;
  };

  /** Click on a brief card — either open the existing variant or open the
   *  confirmation popup. Wired to PlanTab.onBriefClick.
   *
   *  UX3 fix: o lookup agora usa as MESMAS 3 condições do isBriefExecuted
   *  no ProjectsTab. Antes só tinha 2, então quando o auto-save descartava
   *  o campo `brief` do variant (vide handleSaveProject), o popup falso de
   *  "Criar este subprojeto?" reaparecia mesmo pra subprojeto já criado. */
  const handleBriefClick = (brief: CreativeBrief, projectId?: string) => {
    // projectId explícito evita depender do currentProjectId (que pode estar
    // desatualizado logo após um handleLoadProject — corrida de estado na
    // navegação "Porta B"). Sem ele, usa o projeto atual.
    const targetProjectId = projectId || currentProjectId;
    // If the brief already spawned a variant, just open it. Busca SEMPRE
    // dentro do projeto-alvo — os ids de brief colidem entre projetos.
    const existing = projects
      .find((p) => p.id === targetProjectId)
      ?.variants?.find(
        (v: any) =>
          v.brief?.id === brief.id ||
          v.id === brief.id || // ← variant.id == brief.id (set em handleConfirmBriefExec)
          v.id === brief.executedVariantId
      );
    if (existing) {
      setCurrentVariantId(existing.id);
      // Use the existing handler to load the variant config into the UI.
      const v = existing as any;
      const targetStep: Step = v.config?.copy?.generatedScript ? 'copy' : 'copy';
      handleLoadVariant(v, targetStep, targetProjectId || undefined);
      return;
    }
    // Otherwise show the "create subprojeto" popup.
    setPendingBriefExec(brief);
  };

  /** Confirmed in the popup → create variant from brief snapshot + load
   *  into CopyTab. Pre-populates config.copy.* with brief fields so the
   *  existing copy generation pipeline sees the same answers it always
   *  saw (no change to generation logic). */
  const handleConfirmBriefExec = async () => {
    const brief = pendingBriefExec;
    if (!brief || !currentProjectId) return;
    setPendingBriefExec(null);

    // Find the persona this brief targets so we can copy its data into answers.
    const personas =
      ((config.copy as any)?.personasWithWeights as WeightedPersona[] | undefined) || [];
    const persona = personas.find((p) => p.id === brief.targetPersonaId);
    const personaRaw = (persona as any)?.raw || {};

    // Build the variant config — take the current config as base and
    // overlay the brief's specifics + persona-derived answers. This is
    // the same shape every other variant uses; downstream tabs don't
    // know it was created from a brief.
    const overlayAnswers = {
      ...config.copy.answers,
      // Persona-derived answers (so CopyTab + AvatarTab can read them).
      audience: personaRaw.description || config.copy.answers.audience || '',
      age: personaRaw.age || config.copy.answers.age || '',
      gender: personaRaw.gender || config.copy.answers.gender || '',
      situation: personaRaw.currentSituation || config.copy.answers.situation || '',
      painPoints: personaRaw.mainPain || config.copy.answers.painPoints || '',
      // Awareness as a numeric string (existing field convention).
      awarenessLevel:
        brief.awareness === 'unaware'
          ? '1'
          : brief.awareness === 'problem_aware'
            ? '2'
            : brief.awareness === 'solution_aware'
              ? '3'
              : brief.awareness === 'product_aware'
                ? '4'
                : '5',
      // Angle for the Schwartz beats system.
      angleIdea: brief.angle,
      // Style + emotion notes for the writer prompt.
      estiloAnuncio: typeof brief.style === 'string' ? brief.style : '',
      primaryEmotion: typeof brief.emotion === 'string' ? brief.emotion : '',
      // Campo `emotion` (Seção 6 da Copy). O brief traz um CÓDIGO ('curiosidade',
      // 'medo'...) que não casa com as opções do select — a CopyTab normaliza
      // pra opção recomendada deste subprojeto. Setamos aqui (em vez de herdar)
      // pra que a emoção seja recalculada por subprojeto, não copiada do anterior.
      emotion: typeof brief.emotion === 'string' ? brief.emotion : '',
      // Narrador (quem conta a história em 1ª pessoa) decidido no plano —
      // auto-preenche a aba Copy pra a copy segurar UMA voz.
      narrator: brief.narrator || config.copy.answers.narrator || '',
    };
    // Derive a target word count from the duration (≈ 2.5 words/sec).
    const targetWordCount = Math.round(brief.durationTarget * 2.5);

    const variantConfig: AdConfig = {
      ...config,
      copy: {
        ...config.copy,
        answers: overlayAnswers,
        // A persona/nível/ângulo já vieram do plano — o subprojeto NÃO deve cair
        // no gate "quem é o cliente". Entra direto no editor de copy.
        discoveryMode: 'known',
        // Hook from the brief is the starting point — user can regenerate.
        hookSelecionado: brief.hook,
        // Reset generated outputs so the variant starts fresh.
        generatedScript: '',
        generatedHooks: [],
        optimizedScript: '',
        finalScript: '',
        targetWordCount,
        // Track which brief spawned this variant for the "abrir" path.
        activeBriefId: brief.id,
        // Cada subprojeto é INDEPENDENTE: zera TODO o material do gancho, senão
        // o novo criativo herda os vídeos/áudios de gancho do anterior.
        hookOptimizedScript: '',
        hookVideos: [],
        hookVideoUrl: '',
        hookVideoStoragePath: null,
        hookAudios: [],
        hookAudioUrl: '',
        hookAudioStoragePath: null,
      } as any,
      // Reset render outputs (same as MM — A/B variant pattern).
      videoUrl: null,
      videoStoragePath: null,
      videos: [],
      // Áudio do corpo também NÃO herda do subprojeto anterior.
      audioUrl: null,
      audioStoragePath: null,
      audios: [],
      lastVideoMetadata: null,
      generationStage: 'idle',
      edit: {
        ...config.edit,
        zapVersions: [],
        zapHookVersions: [],
        zapJoinedVersions: [],
      },
      // Cada subprojeto tem sua PRÓPRIA VSL — não herda a do subprojeto anterior.
      copyVsl: undefined,
    };

    // Use the brief's id as the variant id (deterministic mapping).
    const newVariant = {
      id: brief.id,
      name: briefToSubprojectName(brief),
      config: variantConfig,
      brief, // snapshot for later inspection
      status: 'brief_only' as const,
      createdAt: new Date().toISOString(),
    };

    try {
      // Idempotente: cria/sobrescreve o subprojeto na subcoleção
      // `projects/{id}/variants` (cada variant = 1 doc, sem o teto de 1 MiB do
      // doc do projeto).
      await saveVariant(currentProjectId, newVariant);
      // Atualiza a lista local (sem onSnapshot, não recarrega sozinha).
      setProjects((prev) =>
        prev.map((p) => {
          if (p.id !== currentProjectId) return p;
          const next = ((p.variants as any[]) || []).slice();
          const idx = next.findIndex((v) => v.id === newVariant.id);
          if (idx !== -1) next[idx] = newVariant;
          else next.push(newVariant);
          return { ...p, variants: next } as any;
        })
      );

      // Also persist the executedVariantId back onto the brief so the
      // PlanTab "✓ executado" badge appears on next render.
      const currentBriefs = ((config.copy as any)?.creativeBriefs as CreativeBrief[]) || [];
      const updatedBriefs = currentBriefs.map((b) =>
        b.id === brief.id ? { ...b, executedVariantId: brief.id } : b
      );
      persistBriefs(updatedBriefs);

      // Activate the variant + navigate to Copy.
      setCurrentVariantId(brief.id);
      setConfig(variantConfig);
      // UX6: top-level state precisa ser zerado JUNTO com config, senão o
      // auto-save 2s depois lê o audios/videos da variant ANTERIOR (que
      // ainda está em React state) e grava no novo subprojeto. Mesma
      // limpeza que handleLoadVariant faz quando carrega outra variant.
      setAudioUrl(null);
      setAudioStoragePath(null);
      setAudios([]);
      setVideoUrl(null);
      setVideoStoragePath(null);
      setVideos([]);
      setGenerationStage('idle');
      setCurrentStep('copy');
      toast.success(`Subprojeto "${newVariant.name}" criado. Agora gere a copy.`);
    } catch (err) {
      console.error('Error executing brief:', err);
      toast.error('Falha ao criar subprojeto: ' + String((err as any)?.message || err).slice(0, 220));
    }
  };

  /** Blueprint Fase 4 — Porta B: cliente clica num brief dentro da seção
   *  "Dados do Projeto" do ProjectsTab. O brief pode ser de QUALQUER projeto
   *  (não só o current), então primeiro tornamos esse projeto current e
   *  depois delegamos pro handleBriefClick que faz o resto. */
  const handleSelectBriefFromProject = async (project: Project, brief: CreativeBrief) => {
    if (project.id !== currentProjectId) {
      // Carrega o projeto sem trocar de aba (step='projects' = fica aqui).
      await handleLoadProject(project, 'projects');
    }
    // Passa project.id EXPLÍCITO — não depende do currentProjectId ter
    // propagado (evita carregar o subprojeto do projeto errado).
    setTimeout(() => handleBriefClick(brief, project.id), 0);
  };

  /** Blueprint Fase 4 — Porta A: cliente clica em 1 persona da seção
   *  "Dados do Projeto". Abre popup de confirmação (handleConfirmPersonaExec). */
  const handleSelectPersonaFromProject = async (project: Project, persona: WeightedPersona) => {
    if (project.id !== currentProjectId) {
      await handleLoadProject(project, 'projects');
    }
    setTimeout(() => setPendingPersonaExec(persona), 0);
  };

  /** Blueprint Fase 4 — Porta A confirmada: cria variant a partir da persona
   *  selecionada, SEM brief associado. Carrega productInfo + persona.raw nos
   *  answers (mesma forma que handleConfirmBriefExec faz com brief.persona).
   *  A diferença é que ângulo/hook/duração ficam vazios — cliente escolhe
   *  tudo na Copy. */
  const handleConfirmPersonaExec = async () => {
    const persona = pendingPersonaExec;
    if (!persona || !currentProjectId) return;
    setPendingPersonaExec(null);

    const personaRaw = (persona as any)?.raw || {};

    // Mesma shape de answers que handleConfirmBriefExec produz — assim a
    // CopyTab e AvatarTab leem do jeito que sempre leram. Sem angle/style/
    // emotion explícitos porque não tem brief associado.
    const overlayAnswers = {
      ...config.copy.answers,
      audience: personaRaw.description || config.copy.answers.audience || '',
      age: personaRaw.age || config.copy.answers.age || '',
      gender: personaRaw.gender || config.copy.answers.gender || '',
      situation: personaRaw.currentSituation || config.copy.answers.situation || '',
      painPoints: personaRaw.mainPain || config.copy.answers.painPoints || '',
      // Awareness vem da persona (não de brief.awareness).
      awarenessLevel: personaRaw.awarenessLevel || config.copy.answers.awarenessLevel || '3',
      // Marca qual persona originou pra UI conseguir destacar.
      selectedPersonaFull: JSON.stringify(personaRaw),
    };

    const variantId = `persona-${persona.id}-${Date.now()}`;
    const variantConfig: AdConfig = {
      ...config,
      copy: {
        ...config.copy,
        answers: overlayAnswers,
        // Reset gerados — variant nova começa limpa.
        generatedScript: '',
        generatedHooks: [],
        optimizedScript: '',
        finalScript: '',
        // Cada subprojeto é INDEPENDENTE: zera TODO o material do gancho.
        hookSelecionado: '',
        hookOptimizedScript: '',
        hookVideos: [],
        hookVideoUrl: '',
        hookVideoStoragePath: null,
        hookAudios: [],
        hookAudioUrl: '',
        hookAudioStoragePath: null,
        // Marca qual persona originou (debug + futura UI).
        activePersonaId: persona.id,
      } as any,
      videoUrl: null,
      videoStoragePath: null,
      audioUrl: null,
      audioStoragePath: null,
      audios: [],
      videos: [],
      lastVideoMetadata: null,
      generationStage: 'idle',
      // Edições Zap também não herdam (corpo, gancho e juntados zerados).
      edit: {
        ...config.edit,
        zapVersions: [],
        zapHookVersions: [],
        zapJoinedVersions: [],
      },
    };

    const newVariant = {
      id: variantId,
      name: `Persona: ${persona.name || (persona as any).name || 'sem nome'}`,
      config: variantConfig,
      createdAt: new Date().toISOString(),
      // Marca persona-origin pra distinguir de brief-origin no histórico.
      personaOrigin: { id: persona.id, label: persona.name },
    };

    try {
      // Novo subprojeto na subcoleção (cada variant = 1 doc próprio).
      await saveVariant(currentProjectId, newVariant);
      // Atualiza a lista local (sem onSnapshot, não recarrega sozinha).
      setProjects((prev) =>
        prev.map((p) =>
          p.id === currentProjectId
            ? ({ ...p, variants: [...((p.variants as any[]) || []), newVariant] } as any)
            : p
        )
      );

      setCurrentVariantId(variantId);
      setConfig(variantConfig);
      // UX6: mesma limpeza de top-level state que Porta B (brief) faz.
      // Sem isso o auto-save persiste audios/videos da variant anterior
      // no novo subprojeto criado a partir da persona.
      setAudioUrl(null);
      setAudioStoragePath(null);
      setAudios([]);
      setVideoUrl(null);
      setVideoStoragePath(null);
      setVideos([]);
      setGenerationStage('idle');
      setCurrentStep('copy');
      toast.success(`Subprojeto criado a partir da persona "${persona.name}".`);
    } catch (err) {
      console.error('Error creating persona-based variant:', err);
      toast.error('Falha ao criar subprojeto: ' + String((err as any)?.message || err).slice(0, 220));
    }
  };

  /** Blueprint Fase 5 — "Criar variação grande" (Criativo 16+).
   *  Inicia o fluxo abrindo o BriefEditModal pré-preenchido. NÃO cria o
   *  brief ainda — só quando o cliente salvar no modal (handleSaveNewBigVariation).
   *  Pré-preenche a partir do projeto (productInfo + 1ª persona disponível). */
  const handleStartBigVariation = async (project: Project) => {
    if (project.id !== currentProjectId) {
      await handleLoadProject(project, 'projects');
    }
    setTimeout(() => {
      const cfg: any = project.config || {};
      const copy: any = cfg.copy || {};
      const briefs: CreativeBrief[] = Array.isArray(copy.creativeBriefs) ? copy.creativeBriefs : [];
      const personas: WeightedPersona[] = Array.isArray(copy.personasWithWeights)
        ? copy.personasWithWeights
        : [];

      const nextIndex = briefs.length > 0 ? Math.max(...briefs.map((b) => b.index || 0)) + 1 : 16;
      const firstPersona = personas[0];
      const lastBrief = briefs[briefs.length - 1]; // pra derivedFromBriefId opcional

      // Pré-preenchemos com defaults razoáveis (cliente edita tudo no modal).
      // Awareness/angle/style/emotion são "solution_aware/curiosidade/depoimento"
      // por serem combinação segura. Hook e rationale vazios — cliente preenche.
      const draft: CreativeBrief = {
        id: `brief-custom-${Date.now()}`,
        index: nextIndex,
        targetPersonaId: firstPersona?.id || '',
        targetPersonaName: firstPersona?.name || 'Sem persona',
        awareness: 'solution_aware',
        angle: 'curiosidade',
        hook: '',
        durationTarget: 30,
        emotion: 'curiosidade',
        style: 'depoimento',
        ctaStyle: 'soft',
        promiseFocus: '',
        rationale: '',
        // Marca origem pra rastrear "esse criativo derivou do brief X".
        derivedFromBriefId: lastBrief?.id,
      };
      setCreatingNewBrief(draft);
    }, 0);
  };

  /** Blueprint Fase 5 — cliente confirmou no modal o novo brief.
   *  Persiste no plano + dispara handleBriefClick (Porta B) pra criar variant
   *  na sequência. O fluxo termina igual aos outros: ConfirmModal → variant
   *  → CopyTab. */
  const handleSaveNewBigVariation = (newBrief: CreativeBrief) => {
    setCreatingNewBrief(null);
    const currentBriefs =
      ((config.copy as any)?.creativeBriefs as CreativeBrief[] | undefined) || [];
    // Garante index único (caso draft tenha conflito com brief recém-adicionado).
    const finalIndex =
      Math.max(newBrief.index, ...currentBriefs.map((b) => b.index || 0).concat([0])) +
      (currentBriefs.some((b) => b.index === newBrief.index) ? 1 : 0);
    const persisted: CreativeBrief = { ...newBrief, index: finalIndex };
    const updated = [...currentBriefs, persisted];
    persistBriefs(updated);
    toast.success(`Criativo ${finalIndex} adicionado ao plano.`);
    // Imediatamente dispara o popup de criar subprojeto.
    setPendingBriefExec(persisted);
  };

  /** Maps the persona's awarenessLevel field (which can come back as
   *  "1"-"5", "1=Inconsciente", or a string like "solution_aware") to
   *  the canonical AwarenessLevel enum used by the blueprint shape. */
  function mapNumericAwarenessToString(value: any): string {
    const s = String(value).toLowerCase().trim();
    if (s.startsWith('1')) return 'unaware';
    if (s.startsWith('2')) return 'problem_aware';
    if (s.startsWith('3')) return 'solution_aware';
    if (s.startsWith('4')) return 'product_aware';
    if (s.startsWith('5')) return 'most_aware';
    if (s.includes('unaware')) return 'unaware';
    if (s.includes('problem')) return 'problem_aware';
    if (s.includes('solution')) return 'solution_aware';
    if (s.includes('product')) return 'product_aware';
    if (s.includes('most')) return 'most_aware';
    return 'solution_aware';
  }

  // Mapeamento de emotionalTrigger / hiddenDesire → emoção das 15 opções
  const mapToEmotion = (persona: any): string => {
    const trigger = (persona.emotionalTrigger || '').toLowerCase();
    const desire = (persona.hiddenDesire || '').toLowerCase();
    const fear = (persona.dominantFear || '').toLowerCase();
    const combined = `${trigger} ${desire} ${fear}`;

    if (/frustra|cansad|exaust|nada funciona/.test(combined)) return 'Frustração';
    if (/vergonh|envergonhad/.test(combined)) return 'Vergonha';
    if (/ansied|preocup|nervos/.test(combined)) return 'Ansiedade';
    if (/julgamento|julgad|opini/.test(combined)) return 'Medo de julgamento';
    if (/insegur|incapaz|n[aã]o sei/.test(combined)) return 'Insegurança';
    if (/raiv|injusti|frustrad/.test(combined)) return 'Raiva leve';
    if (/confus|perdid|n[aã]o entend/.test(combined)) return 'Confusão';
    if (/cansad|exaust|esgotad/.test(combined)) return 'Cansaço';
    if (/desmotiva|desanim|sem [aâ]nimo/.test(combined)) return 'Desmotivação';
    if (/ambi[cç]|conquist|alcan[cç]/.test(combined)) return 'Ambição';
    if (/reconhec|admir|respeit/.test(combined)) return 'Desejo de reconhecimento';
    if (/control|aut[oó]nom|liberdade/.test(combined)) return 'Desejo de controle';
    if (/exclusiv|elite|premium/.test(combined)) return 'Exclusividade';
    if (/esperan[cç]|sonh|querer mais/.test(combined)) return 'Esperança';
    if (/al[ií]vio|paz|tranquil/.test(combined)) return 'Alívio';
    return 'Frustração'; // default
  };

  // Mapeamento de communicationTone → estilo de anúncio
  const mapToStyle = (tone: string): string => {
    const t = (tone || '').toLowerCase();
    if (/empat|hist[oó]ria|jornada|pessoal/.test(t)) return 'Storytelling Pessoal';
    if (/autoridade|especialista|cient[ií]fico/.test(t)) return 'Autoridade / Educativo';
    if (/direto|objetivo|sem rodeios/.test(t)) return 'Direto ao Ponto';
    if (/divertid|leve|humor/.test(t)) return 'Humor / Descontraído';
    if (/urg[eê]nc|escasse/.test(t)) return 'Urgência / Escassez';
    return 'Direto ao Ponto';
  };

  // Aplica os dados do persona aos campos da Copy. Chamado pelo botão "Atualizar Campos da Copy".
  const applyPersonaToCopy = () => {
    if (!config.copy?.answers?.selectedPersonaFull) {
      toast.error('Nenhum persona selecionado.');
      return;
    }
    let persona: any;
    try {
      persona = JSON.parse(config.copy.answers.selectedPersonaFull);
    } catch (e) {
      toast.error('Erro ao ler persona salvo.');
      return;
    }

    // Audiência rica: nome + descrição + desejo oculto
    const richAudience = [
      persona.name,
      persona.description,
      persona.hiddenDesire ? `Desejo profundo: ${persona.hiddenDesire}.` : '',
    ]
      .filter(Boolean)
      .join(' ');

    // Situação rica: situação atual + razão do nível de consciência
    const richSituation = [
      persona.currentSituation,
      persona.awarenessReason ? `(${persona.awarenessReason})` : '',
    ]
      .filter(Boolean)
      .join(' ');

    // Dor rica: dor principal + medo dominante
    const richPain = [
      persona.mainPain,
      persona.dominantFear ? `Medo: ${persona.dominantFear}.` : '',
    ]
      .filter(Boolean)
      .join(' ');

    // Mapear idade pra opções fixas
    const ageOptions = ['18-24', '25-34', '35-44', '45-54', '55+'];
    const personaAgeStr = String(persona.age || '');
    let mappedAge: string[] = ageOptions.filter((opt) => personaAgeStr.includes(opt));
    if (mappedAge.length === 0) {
      const num = parseInt(personaAgeStr);
      if (!isNaN(num)) {
        if (num >= 18 && num <= 24) mappedAge = ['18-24'];
        else if (num >= 25 && num <= 34) mappedAge = ['25-34'];
        else if (num >= 35 && num <= 44) mappedAge = ['35-44'];
        else if (num >= 45 && num <= 54) mappedAge = ['45-54'];
        else if (num >= 55) mappedAge = ['55+'];
      }
    }

    setConfig((prev) => ({
      ...prev,
      copy: {
        ...prev.copy,
        answers: {
          ...prev.copy.answers,
          audience: richAudience,
          age: mappedAge.length > 0 ? mappedAge : prev.copy.answers.age,
          situation: richSituation,
          painPoints: richPain,
          triedBefore: persona.currentSituation || prev.copy.answers.triedBefore,
          awarenessLevel: persona.awarenessLevel || prev.copy.answers.awarenessLevel,
          mainObjection: persona.mainObjection || '',
          hiddenDesire: persona.hiddenDesire || '',
          productResult: persona.strongestPromise || prev.copy.answers.productResult,
          emotion: mapToEmotion(persona),
          estiloAnuncio: mapToStyle(persona.communicationTone),
        },
      },
    }));
    setCopyFieldsApplied(true);
    toast.success('Campos da Copy atualizados a partir do persona! ✨');
  };

  const handleSaveProject = async (
    overridesOrEvent?: Partial<AdConfig> | React.MouseEvent,
    opts?: { silent?: boolean }
  ) => {
    // Robust event detection to prevent circular structure errors
    const isEvent = !!(
      overridesOrEvent &&
      typeof overridesOrEvent === 'object' &&
      ('nativeEvent' in overridesOrEvent ||
        'target' in overridesOrEvent ||
        ('type' in overridesOrEvent && (overridesOrEvent as any).type.includes('click')))
    );

    const overrides = isEvent ? {} : (overridesOrEvent as Partial<AdConfig>) || {};
    // UX2: auto-save é silencioso por padrão. Toast só aparece quando o
    // chamador explicita { silent: false } (botão "Salvar" do header).
    // Antes esse toast pipocava a cada 2s porque o debounce roda em todo
    // change de config.
    const silent = opts?.silent !== false;
    if (!user || isProjectLoading) return;

    if (!currentProjectId) {
      setShowNewProjectModal(true);
      return;
    }

    setIsSaving(true);
    if (process.env.NODE_ENV !== 'production') console.log('VOICE_SAVE_STARTED');
    try {
      const awarenessLevel = config.copy.answers.awarenessLevel || 'Geral';
      const variantId = currentVariantId || Date.now().toString();

      // Update config with current videoUrl and audioUrl before saving, allowing overrides
      const configToSave = JSON.parse(
        JSON.stringify({
          ...config,
          videoUrl: overrides?.videoUrl !== undefined ? overrides.videoUrl : videoUrl,
          videoStoragePath:
            overrides?.videoStoragePath !== undefined
              ? overrides.videoStoragePath
              : videoStoragePath,
          audioUrl: overrides?.audioUrl !== undefined ? overrides.audioUrl : audioUrl,
          audioStoragePath:
            overrides?.audioStoragePath !== undefined
              ? overrides.audioStoragePath
              : audioStoragePath,
          audios: overrides?.audios !== undefined ? overrides.audios : audios,
          videos: overrides?.videos !== undefined ? overrides.videos : videos,
          lastVideoMetadata:
            overrides?.lastVideoMetadata !== undefined
              ? overrides.lastVideoMetadata
              : lastVideoMetadata,
          generationStage:
            overrides?.generationStage !== undefined ? overrides.generationStage : generationStage,
          ...overrides,
        })
      );

      const projectRef = doc(db, 'projects', currentProjectId);
      // Subprojeto existente vem do estado em memória — a subcoleção
      // `projects/{id}/variants` já foi carregada no loader. Não relê o doc do
      // projeto: ele não guarda mais o array de variants.
      const currentProj = projects.find((p) => p.id === currentProjectId);
      const existingVariant = currentVariantId
        ? ((currentProj?.variants as any[]) || []).find((v) => v.id === currentVariantId) || null
        : null;

      // Cleanup and Pruning to solve the 1MB Firestore limit (3.8MB reported)
      const cleanConfigForStorage = (cfg: any) => {
        if (!cfg) return cfg;
        const cloned = JSON.parse(JSON.stringify(cfg));
        if (cloned.edit?.segments) {
          cloned.edit.segments = cloned.edit.segments.map((s: any) => {
            if (s.visualConcept?.imageUrl?.startsWith('data:')) {
              // We prune base64 instead of uploading it in a loop to avoid hitting storage too hard
              // The user can re-generate if needed, or we hope they approval/upload happened elsewhere
              s.visualConcept.imageUrl = '';
            }
            return s;
          });
        }
        // UX25-C1: lastDebug é um snapshot de até 50KB do prompt + resposta.
        // Útil em runtime mas estoura o budget do Firestore se persistido.
        // Remove na hora de salvar — fica só na memória durante a sessão.
        if (cloned.copy?.lastDebug) {
          delete cloned.copy.lastDebug;
        }
        // aiRecommendation é cache da recomendação de avatar (~34KB por
        // subprojeto). É regenerável — se refaz sozinho via inputsKey quando
        // o painel reabre. Multiplicado por todos os variants num único doc,
        // era o maior responsável por estourar o limite de 1MB do Firestore.
        // Mesmo critério do lastDebug: fica em runtime, não é persistido.
        if (cloned.copy?.aiRecommendation) {
          delete cloned.copy.aiRecommendation;
        }
        return cloned;
      };

      // UX3: preserva campos do variant existente que NÃO derivam de config:
      //   - `name`: pode ser "Criativo X - Consc.Y - Angle" (set por
      //     handleConfirmBriefExec). Antes era sobrescrito por awarenessLevel.
      //   - `brief`: snapshot do CreativeBrief que gerou o subprojeto. Sem
      //     ele, handleBriefClick não acha o variant e mostra popup falso
      //     de "Criar este subprojeto?". (Sintoma reportado pelo user.)
      //   - `status`: 'brief_only' / outros. Apenas metadata, mas perder
      //     ela é confuso pro futuro.
      const existingAny = existingVariant as any;
      const newVariant: ProjectVariant = {
        id: variantId,
        name: existingAny?.name || awarenessLevel,
        config: configToSave,
        createdAt: existingVariant ? existingVariant.createdAt : new Date(),
        ...(existingAny?.brief ? { brief: existingAny.brief } : {}),
        ...(existingAny?.status ? { status: existingAny.status } : {}),
      } as ProjectVariant;

      // Fase de ESTRATÉGIA (sem subprojeto ativo): NÃO cria subprojeto. O
      // subprojeto/criativo só nasce ao "Produzir" um brief/persona; aqui sem
      // currentVariantId salvamos só o config do projeto.
      const cleanedVariant: ProjectVariant | null = currentVariantId
        ? ({ ...newVariant, config: cleanConfigForStorage(newVariant.config) } as ProjectVariant)
        : null;

      // Timeout de segurança: o Firestore às vezes fica em retry SILENCIOSO
      // (conexão ruim) e o setDoc nunca resolve nem rejeita — o botão "Salvar"
      // girava pra sempre. Se passar de 15s, lança erro pra o finally resetar o
      // botão e avisar. O rascunho local (metavise-draft-config-v1) preserva o
      // conteúdo de qualquer forma.
      const withTimeout = (p: Promise<unknown>) =>
        Promise.race([
          p,
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('Firestore não respondeu em 15s (timeout de save).')),
              15000
            )
          ),
        ]);

      // Doc do projeto SEM o array de variants (eles vivem na subcoleção, cada
      // um com seu próprio teto de 1 MiB) + o subprojeto ativo na subcoleção.
      await withTimeout(
        Promise.all([
          setDoc(
            projectRef,
            { config: cleanConfigForStorage(configToSave), updatedAt: serverTimestamp() },
            { merge: true }
          ),
          ...(cleanedVariant ? [saveVariant(currentProjectId, cleanedVariant)] : []),
        ])
      );

      addLog('PROJETO_SALVO');
      if (process.env.NODE_ENV !== 'production') console.log('VOICE_SAVE_COMPLETED');
      // Salvou com sucesso → não há mais trabalho pendente. Atualiza o baseline
      // pro estado atual virar o "limpo" (senão o detector reabriria o pop-up).
      dirtyBaselineRef.current = JSON.stringify({ config, audios, videos, audioUrl, videoUrl });
      setIsDirty(false);

      // Atualiza a lista local pra refletir o que foi salvo (sem onSnapshot,
      // o array `projects` não se atualiza sozinho). Mantém "Dados do Projeto",
      // contagem de subprojetos e badges de brief executado em sincronia.
      setProjects((prev) =>
        prev.map((p) => {
          if (p.id !== currentProjectId) return p;
          const nextVariants = ((p.variants as any[]) || []).slice();
          if (cleanedVariant) {
            const idx = nextVariants.findIndex((v) => v.id === cleanedVariant.id);
            if (idx !== -1) nextVariants[idx] = cleanedVariant;
            else nextVariants.push(cleanedVariant);
          }
          return { ...p, config: configToSave, variants: nextVariants } as any;
        })
      );

      if (!silent) {
        toast.success(
          currentVariantId
            ? `Versão "${awarenessLevel}" atualizada com sucesso!`
            : 'Projeto salvo com sucesso!'
        );
      }
    } catch (err: any) {
      console.error('Error saving project:', err);
      setError('Falha ao salvar projeto.');
      // Aviso visível quando NÃO é auto-save (botão manual). Sem isso, o
      // timeout só resetava o botão sem explicar — parecia que sumiu.
      if (!silent) {
        const msg = String(err?.message || '');
        if (msg.includes('timeout')) {
          toast.error(
            'O salvar demorou demais (Firestore não respondeu). Seu rascunho está guardado localmente — tente salvar de novo.',
            { duration: 7000 }
          );
        } else {
          toast.error('Falha ao salvar. Seu rascunho local está guardado — tente de novo.', {
            duration: 6000,
          });
        }
      }
    } finally {
      setIsSaving(false);
      setHasUnsavedCopyChanges(false);
      // Stamp the last-saved time so AutoSaveIndicator can show
      // "Salvo agora" → "Salvo há Xmin" instead of staying stale.
      setLastSavedAt(Date.now());
    }
  };

  // Dado um config de variante, descobre a aba MAIS avançada que já tem
  // conteúdo gerado — pra "Carregar Versão" cair direto onde o usuário parou,
  // não na primeira etapa. Ordem do mais fundo pro mais raso.
  const resolveDeepestStep = (cfg: any): Step => {
    const edit = cfg?.edit || {};
    const hasZap = Array.isArray(edit.zapVersions) && edit.zapVersions.length > 0;
    const hasVideo = !!cfg?.videoUrl || (Array.isArray(cfg?.videos) && cfg.videos.length > 0);
    const hasAudio = !!cfg?.audioUrl || (Array.isArray(cfg?.audios) && cfg.audios.length > 0);
    const hasHooks =
      Array.isArray(cfg?.copy?.generatedHooks) && cfg.copy.generatedHooks.length > 0;
    const hasScript = !!cfg?.copy?.generatedScript;

    if (hasZap) return 'edit-zap';
    if (hasVideo) return 'avatar';
    if (hasAudio) return 'voz-premium';
    if (hasHooks) return 'hook-visual';
    if (hasScript) return 'copy';
    return 'persona';
  };

  const handleLoadVariant = async (variant: ProjectVariant, step?: Step, projectId?: string) => {
    if (process.env.NODE_ENV !== 'production') console.log('[Debug] Loading Variant:', variant.id);
    setIsProjectLoading(true);

    try {
      // Set project context. CRÍTICO: resolver o projeto-pai pelo projectId
      // EXPLÍCITO de quem chamou — NUNCA por `variants.some(v => v.id === variant.id)`,
      // porque os ids de subprojeto (brief_1, brief_2…) SE REPETEM entre projetos,
      // e a busca por id pegava o primeiro projeto da lista (errado), corrompendo
      // currentProjectId e contaminando o config entre projetos. Ver memória
      // bug-colisao-id-variant. Fallback por id só se nenhum projectId vier.
      const parentProject =
        (projectId ? projects.find((p) => p.id === projectId) : null) ||
        projects.find((p) => p.variants?.some((v) => v.id === variant.id));
      if (parentProject) {
        setCurrentProjectId(parentProject.id);
      }

      // Reset local states before loading new ones
      setAudioUrl(null);
      setAudioStoragePath(null);
      setAudios([]);
      setVideoUrl(null);
      setVideoStoragePath(null);
      setVideos([]);
      setGenerationStage('idle');

      // Hydrate and set config
      const loadedConfig = ensurePersonaWeights(hydrateProjectConfig({ ...variant.config }));

      if (process.env.NODE_ENV !== 'production') {
        console.log('[Debug] Variant Config Hydrated:', {
          discoveryMode: loadedConfig.copy.discoveryMode,
          hasAnswers: Object.keys(loadedConfig.copy.answers || {}).length,
          hasScript: !!loadedConfig.copy.generatedScript,
        });
      }

      // Um subprojeto vindo do plano já tem persona/answers — nunca deve cair no
      // gate "quem é o cliente". Se ficou 'unknown' mas há conteúdo, sobe pra
      // 'done' (tem script) ou 'known' (tem answers/brief). Corrige os variants
      // antigos, criados antes do fix na criação.
      const ans = loadedConfig.copy.answers || {};
      const hasContent =
        !!loadedConfig.copy.finalScript ||
        !!loadedConfig.copy.generatedScript ||
        !!(loadedConfig.copy as any).activeBriefId ||
        !!ans.audience ||
        !!ans.productName ||
        !!ans.awarenessLevel;
      if (
        (!loadedConfig.copy.discoveryMode || loadedConfig.copy.discoveryMode === 'unknown') &&
        hasContent
      ) {
        loadedConfig.copy.discoveryMode =
          loadedConfig.copy.finalScript || loadedConfig.copy.generatedScript ? 'done' : 'known';
      }

      setConfig(loadedConfig);
      setCopyDiscoveryMode(loadedConfig.copy.discoveryMode as any);

      // Restaurar states independentes do config se necessário
      setVideoUrl(loadedConfig.videoUrl || null);
      setVideoStoragePath(loadedConfig.videoStoragePath || null);
      setVideos(loadedConfig.videos || []);
      setLastVideoMetadata(loadedConfig.lastVideoMetadata || null);
      setAudioUrl(loadedConfig.audioUrl || null);
      setAudioStoragePath(loadedConfig.audioStoragePath || null);
      setAudios(loadedConfig.audios || []);

      // Restore the Edição Zap version gallery from config so previously
      // edited videos show up after a reload.
      const persistedZapVersions =
        ((loadedConfig.edit as any)?.zapVersions as string[] | undefined) || [];
      setZapState((prev) => ({
        ...prev,
        versions: persistedZapVersions,
        status: persistedZapVersions.length > 0 ? 'completed' : prev.status,
        finalVideoUrl: persistedZapVersions[persistedZapVersions.length - 1] || prev.finalVideoUrl,
      }));

      if (loadedConfig.generationStage) {
        setGenerationStage(loadedConfig.generationStage as any);
      }

      if (loadedConfig.copy?.subMode) {
        setCopySubMode(loadedConfig.copy.subMode as any);
      }

      setCurrentVariantId(variant.id);
      setHasUnsavedCopyChanges(false);
      // step explícito (botões "Voz", "Avatar", etc.) tem prioridade; sem ele
      // ("Carregar Versão"), cai na aba mais avançada com conteúdo.
      setCurrentStep(step || resolveDeepestStep(loadedConfig));
      toast.success(`Versão "${variant.name}" carregada!`);
    } catch (err) {
      console.error('[Debug] Error loading variant:', err);
      toast.error('Erro ao carregar versão.');
    } finally {
      setIsProjectLoading(false);
    }
  };

  /**
   * MM — Duplicate current project as an A/B variant.
   *
   * Clones the current in-memory config (copy, persona, plan, hook visual)
   * but resets the avatar + generated outputs so the user can pick a
   * different avatar on the same script. Saves the new variant onto the
   * SAME parent project (variants[] grows), loads it as the active
   * variant, then jumps to the Avatar tab where the actual A/B work
   * happens.
   *
   * If there's no currentProjectId yet (the user hasn't created the
   * project), we no-op and toast a friendlier prompt.
   */
  const handleDuplicateAsVariant = async () => {
    if (!currentProjectId) {
      toast.error('Salve o projeto antes de criar uma variante.');
      return;
    }
    try {
      const existingVariants =
        ((projects.find((p) => p.id === currentProjectId)?.variants as any[]) || []);
      const variantNumber = existingVariants.length + 1;

      // Strip generated outputs — the whole point is to re-render
      // with a different avatar. Keep all the upstream creative work
      // (copy, persona, plan, hook visual, format).
      const clonedConfig: AdConfig = {
        ...config,
        // Reset render outputs so the user is forced to re-generate
        // them against the new avatar choice.
        videoUrl: null,
        videoStoragePath: null,
        videos: [],
        lastVideoMetadata: null,
        generationStage: 'idle',
        edit: {
          ...config.edit,
          zapVersions: [],
          zapHookVersions: [],
          zapJoinedVersions: [],
        },
      };

      const newVariant = {
        id: `variant_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: `Variante A/B ${variantNumber}`,
        config: clonedConfig,
        createdAt: new Date().toISOString(),
      };

      await saveVariant(currentProjectId, newVariant);
      setProjects((prev) =>
        prev.map((p) =>
          p.id === currentProjectId
            ? ({ ...p, variants: [...((p.variants as any[]) || []), newVariant] } as any)
            : p
        )
      );

      // Activate the new variant in the UI and navigate to the Avatar
      // tab — that's where the A/B differentiation lives.
      setCurrentVariantId(newVariant.id);
      setConfig(clonedConfig);
      setCurrentStep('avatar');

      toast.success(`Variante criada! Escolha um avatar diferente pra rodar o A/B.`);
    } catch (err) {
      console.error('Error duplicating as variant:', err);
      toast.error('Falha ao criar variante.');
    }
  };

  const handleRenameVariant = async (projectId: string, variantId: string, newName: string) => {
    if (!newName.trim()) {
      toast.error('Nome não pode ser vazio.');
      return;
    }
    try {
      // Renomeia direto no doc do subprojeto (subcoleção). Acha o variant na
      // memória pra reescrever só ele com o nome novo.
      const proj = projects.find((p) => p.id === projectId);
      const target = ((proj?.variants as any[]) || []).find((v) => v.id === variantId);
      if (!target) {
        toast.error('Subprojeto não encontrado.');
        return;
      }
      const renamed = { ...target, name: newName.trim() };
      await saveVariant(projectId, renamed);
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? ({
                ...p,
                variants: ((p.variants as any[]) || []).map((v) =>
                  v.id === variantId ? renamed : v
                ),
              } as any)
            : p
        )
      );
      toast.success('Subprojeto renomeado!');
    } catch (err) {
      console.error('Error renaming variant:', err);
      toast.error('Falha ao renomear subprojeto.');
    }
  };

  const handleRenameProject = async (projectId: string, newName: string) => {
    if (!newName.trim()) {
      toast.error('Nome não pode ser vazio.');
      return;
    }
    try {
      const projectRef = doc(db, 'projects', projectId);
      await setDoc(projectRef, { name: newName.trim() }, { merge: true });
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? ({ ...p, name: newName.trim() } as any) : p))
      );
      toast.success('Projeto renomeado!');
    } catch (err) {
      console.error('Error renaming project:', err);
      toast.error('Falha ao renomear projeto.');
    }
  };

  const handleDeleteVariant = async (projectId: string, variantId: string) => {
    toast(
      (t) => (
        <div className="flex flex-col gap-3">
          <p className="font-bold text-gray-900">Deseja excluir esta versão do projeto?</p>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => toast.dismiss(t.id)}
              className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-bold hover:bg-gray-200"
            >
              Cancelar
            </button>
            <button
              onClick={async () => {
                toast.dismiss(t.id);
                try {
                  // Remove o doc do subprojeto na subcoleção + atualiza memória.
                  await deleteVariantDoc(projectId, variantId);
                  setProjects((prev) =>
                    prev.map((p) =>
                      p.id === projectId
                        ? ({
                            ...p,
                            variants: ((p.variants as any[]) || []).filter(
                              (v) => v.id !== variantId
                            ),
                          } as any)
                        : p
                    )
                  );
                  if (currentVariantId === variantId) {
                    setCurrentVariantId(null);
                  }
                  toast.success('Versão excluída!');
                } catch (err) {
                  console.error('Error deleting variant:', err);
                  setError('Falha ao excluir versão.');
                }
              }}
              className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm font-bold hover:bg-red-700"
            >
              Excluir
            </button>
          </div>
        </div>
      ),
      { duration: Infinity }
    );
  };

  // --- AUTO-SAVE REMOVIDO (pedido do usuário) ---
  // Antes havia um auto-save debounced que gravava no Firestore a cada 2s em
  // QUALQUER mudança de config/videos/audios. Isso deixava o app inteiro lento
  // (escritas grandes empilhadas o tempo todo) e gravava sem o usuário pedir.
  // Agora NADA vai pro Firestore automaticamente — só ao clicar "Salvar".
  // Rede de segurança: o rascunho em localStorage (metavise-draft-config-v1)
  // continua, é leve e não toca o Firestore. Deletes seguem gravando na hora.

  // --- Sessão: lembrar projeto + aba ativos pra sobreviver ao reload ---
  // Os dados já são salvos no Firestore (acima), mas ao dar F5 o app perdia
  // QUAL projeto/aba estava aberto e caía na lista — dando a sensação de
  // "começar do zero". Aqui guardamos o ponteiro (id + step) e reabrimos
  // automaticamente quando os projetos terminam de carregar.
  const LAST_SESSION_KEY = 'metavise-last-session-v1';
  useEffect(() => {
    if (!currentProjectId) return;
    try {
      localStorage.setItem(
        LAST_SESSION_KEY,
        JSON.stringify({ projectId: currentProjectId, step: currentStep })
      );
    } catch {
      /* ignore */
    }
  }, [currentProjectId, currentStep]);

  const sessionRestoredRef = useRef(false);
  useEffect(() => {
    if (sessionRestoredRef.current) return;
    if (!user || currentProjectId || projects.length === 0) return;
    let saved: { projectId?: string; step?: Step } | null = null;
    try {
      const raw = localStorage.getItem(LAST_SESSION_KEY);
      saved = raw ? JSON.parse(raw) : null;
    } catch {
      saved = null;
    }
    if (!saved?.projectId) return;
    const proj = projects.find((p) => p.id === saved!.projectId);
    if (!proj) return;
    sessionRestoredRef.current = true;
    // Reabre o projeto; depois força a aba que estava aberta (handleLoadProject
    // cairia na aba "mais avançada", mas o usuário quer voltar onde parou).
    void Promise.resolve(handleLoadProject(proj, saved.step as Step)).then(() => {
      if (saved?.step) setCurrentStep(saved.step as Step);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, projects, currentProjectId]);

  const handleDeleteProject = (projectId: string) => {
    setDeleteProjectConfirmId(projectId);
  };

  // Creates a copy of the project at its current state (config snapshot,
  // variants NOT carried over — those are per-render and re-makeable),
  // assigns a "(cópia)" name, persists to Firestore, and opens it in
  // the Copy step so the user can immediately tweak the duplicate.
  const handleDuplicateProject = async (source: Project) => {
    if (!user) {
      toast.error('Você precisa estar logado para duplicar.');
      return;
    }
    try {
      const dup = {
        userId: user.uid,
        name: `${source.name} (cópia)`,
        type: source.type,
        // Strip variants — they're per-render artifacts, not source data.
        // Same for the top-level audio/video URLs (kept on `audios`/`videos`).
        config: {
          ...source.config,
          audios: source.config.audios || [],
          videos: source.config.videos || [],
        } as AdConfig,
        createdAt: serverTimestamp(),
      };
      // Espera a gravação confirmar antes de abrir — garante que a cópia
      // REALMENTE existe no Firestore (não some ao recarregar).
      const newId = doc(collection(db, 'projects')).id;
      await setDoc(doc(db, 'projects', newId), dup);
      setProjects((prev) => [
        { id: newId, ...dup, createdAt: new Date() } as any,
        ...prev,
      ]);
      setCurrentProjectId(newId);
      setConfig(dup.config);
      setCurrentStep('copy');
      toast.success(`"${source.name}" duplicado!`);
    } catch (err: any) {
      toast.error(`Erro ao duplicar: ${err?.message || 'tente novamente'}`);
    }
  };

  const confirmDeleteProject = async () => {
    if (!deleteProjectConfirmId) return;
    const projectId = deleteProjectConfirmId;
    setDeleteProjectConfirmId(null);
    try {
      await deleteDoc(doc(db, 'projects', projectId));
      // Remove da lista local (sem onSnapshot, o estado não some sozinho).
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
      if (currentProjectId === projectId) {
        setCurrentProjectId(null);
      }
      if (viewingProjectId === projectId) {
        setViewingProjectId(null);
      }
      toast.success('Projeto excluído!');
    } catch (err) {
      console.error('Error deleting project:', err);
      setError('Falha ao excluir projeto.');
    }
  };

  const handleLoadProject = async (project: Project, step?: Step) => {
    if (process.env.NODE_ENV !== 'production') console.log('[Debug] Loading Project:', project.id);
    setIsProjectLoading(true);

    // Track for the "recent projects" quick-back chip in the header.
    pushRecentProject({ id: project.id, name: project.name, type: project.type });

    try {
      setCurrentProjectId(project.id);

      const loadedConfig = ensurePersonaWeights(hydrateProjectConfig({ ...project.config }));

      // Sincroniza as personas com ESTE projeto (evita vazar de outro).
      const savedRaw = loadedConfig.copy?.answers?.savedPersonas;
      let loadedPersonas: any[] = [];
      if (savedRaw) {
        try {
          const parsed = JSON.parse(savedRaw);
          if (Array.isArray(parsed)) loadedPersonas = parsed;
        } catch (e) {}
      }
      setGeneratedPersona(loadedPersonas.length ? { personas: loadedPersonas } : null);
      setPersonasSaved(loadedPersonas.length > 0);

      // Tentar encontrar uma variante que coincida com o config atual do projeto (Bug 1)
      const matchingVariant = (project.variants || []).find(
        (v: any) =>
          v.config.copy.generatedScript === loadedConfig.copy.generatedScript &&
          v.config.copy.answers.awarenessLevel === loadedConfig.copy.answers.awarenessLevel
      );

      if (matchingVariant) {
        setCurrentVariantId(matchingVariant.id);
      } else {
        setCurrentVariantId(null);
      }

      if (process.env.NODE_ENV !== 'production') {
        console.log('[Debug] Project Config Hydrated:', {
          discoveryMode: loadedConfig.copy.discoveryMode,
          hasAnswers: Object.keys(loadedConfig.copy.answers || {}).length,
          hasScript: !!loadedConfig.copy.generatedScript,
        });
      }

      if (loadedConfig.copy?.subMode) {
        setCopySubMode(loadedConfig.copy.subMode as any);
      }

      setConfig(loadedConfig);
      setCopyDiscoveryMode(loadedConfig.copy.discoveryMode as any);

      setVideoUrl(loadedConfig.videoUrl || null);
      setVideoStoragePath(loadedConfig.videoStoragePath || null);
      setAudioUrl(loadedConfig.audioUrl || null);
      setAudioStoragePath(loadedConfig.audioStoragePath || null);
      setAudios(loadedConfig.audios || []);
      setVideos(loadedConfig.videos || []);
      setLastVideoMetadata(loadedConfig.lastVideoMetadata || null);
      setGenerationStage((loadedConfig.generationStage as any) || 'idle');

      setHasUnsavedCopyChanges(false);

      // Carregar projeto cai na aba Produto e Persona (que agora tem o
      // material/VSL no topo). Tipos especiais pulam mais fundo no fluxo.
      const firstStepByType: Record<string, string> = {
        complete: 'persona',
        copy: 'persona',
        video: 'voz-premium',
        editing: 'edit-zap',
      };
      const resolvedStep = step || firstStepByType[project.type] || 'persona';
      setCurrentStep(resolvedStep as Step);
      toast.success(`Projeto "${project.name}" carregado!`);
    } catch (err) {
      console.error('[Debug] Error loading project:', err);
      toast.error('Erro ao carregar projeto.');
    } finally {
      setIsProjectLoading(false);
    }
  };

  const handleNewSubproject = (project: Project) => {
    // Fluxo ÚNICO de "novo criativo": reaproveita material/VSL + personas +
    // plano que já existem e abre o editor de UM brief. Não regera persona
    // nem o plano dos demais — cria só este criativo e segue pra Copy.
    handleStartBigVariation(project);
  };

  const proceedNewSubproject = (project: Project, _personaPath: 'known' | 'discover') => {
    setCurrentProjectId(project.id);
    setCurrentVariantId(null);
    const newConfig = JSON.parse(JSON.stringify(project.config));
    newConfig.copy.generatedScript = '';
    newConfig.copy.generatedHooks = [];
    newConfig.copy.optimizedScript = '';
    newConfig.videoUrl = null;
    newConfig.videoStoragePath = null;
    newConfig.audioUrl = null;
    newConfig.audioStoragePath = null;
    newConfig.audios = [];
    newConfig.videos = [];
    newConfig.edit = {
      transition: 'none',
      backgroundMusic: 'none',
      timelineEdits: [],
    };
    newConfig.generationStage = 'idle';

    if (newConfig.copy.answers.awarenessLevel) {
      delete newConfig.copy.answers.awarenessLevel;
    }

    // Fluxo unificado — todo novo subprojeto cai na aba Planejamento, que
    // tem o material/VSL no topo, as perguntas de persona e o plano embaixo.
    // discoveryMode='known' evita disparar o fluxo órfão de descoberta na Copy.
    const finalDiscoveryMode: 'known' | 'unknown' | 'discovering' = 'known';

    setCopyDiscoveryMode(finalDiscoveryMode);
    newConfig.copy.discoveryMode = finalDiscoveryMode;

    // Estratégia (personas/plano) é do projeto e herda pros subprojetos —
    // garante os pesos pra seção de Plano aparecer já no Planejamento.
    ensurePersonaWeights(newConfig);

    // Restaura os 3 personas herdados pra os cards aparecerem no Planejamento
    // (PlanTab lê personasWithWeights do config; a grade de personas usa state).
    let inheritedPersonas: any[] = [];
    try {
      const raw = newConfig.copy?.answers?.savedPersonas;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) inheritedPersonas = parsed;
      }
    } catch {
      /* ignora savedPersonas malformado */
    }
    setGeneratedPersona(inheritedPersonas.length ? { personas: inheritedPersonas } : null);
    setPersonasSaved(inheritedPersonas.length > 0);

    setConfig(newConfig);
    setVideoUrl(null);
    setVideoStoragePath(null);
    setVideos([]);
    setAudioUrl(null);
    setAudioStoragePath(null);
    setAudios([]);
    setGenerationStage('idle');
    setPendingNewSubproject(null);
    setCopyFieldsApplied(false);

    setCurrentStep('persona');
    toast.success('Novo subprojeto! Defina a persona e gere o plano abaixo.');
  };

  const handleOpenKeySelector = async () => {
    // If the admin already saved a key via the Integrações tab, it's in
    // window.process.env.GEMINI_API_KEY. Trust that over the React state,
    // which can lag the async /api/gemini/key hydration on first paint.
    const w = window as any;
    const liveKey = w.process?.env?.GEMINI_API_KEY || w.process?.env?.API_KEY;
    if (liveKey) {
      setHasApiKey(true);
      return true;
    }

    // Try one last fetch from the server in case hydration was skipped.
    try {
      const r = await fetch('/api/gemini/key');
      if (r.ok) {
        const { apiKey } = await r.json();
        if (apiKey) {
          w.process = w.process || { env: {} };
          w.process.env = w.process.env || {};
          w.process.env.GEMINI_API_KEY = apiKey;
          setHasApiKey(true);
          return true;
        }
      }
    } catch {
      // fall through to AI Studio / final error message
    }

    if ((window as any).aistudio?.openSelectKey) {
      try {
        await (window as any).aistudio.openSelectKey();
        setHasApiKey(true);
        return true;
      } catch (err) {
        console.error('Error opening key selector:', err);
        setError('Não foi possível abrir o seletor de chaves. Tente novamente.');
        return false;
      }
    } else {
      setError(
        'Chave Gemini não configurada. Vá em Integrações → Google Gemini → Gerenciar API Key e cole sua chave.'
      );
      return false;
    }
  };

  const handleGenerateCopy = async () => {
    if (!isOnline) {
      setError('Você está offline. Verifique sua conexão com a internet.');
      return;
    }

    if (!hasApiKey) {
      const opened = await handleOpenKeySelector();
      if (!opened) return;
      setError('Por favor, selecione sua chave API e clique em Gerar Copy novamente.');
      return;
    }

    setLoading(true);
    setError(null);
    setProviderError(null);
    try {
      // Fatia ativa: a aba 'Copy da VSL' lê/escreve config.copyVsl (campo
      // próprio), a aba 'Copy' usa config.copy. Assim anúncio e VSL coexistem.
      const copyKey: 'copy' | 'copyVsl' = currentStep === 'copy-vsl' ? 'copyVsl' : 'copy';
      const activeCopy: any = (config as any)[copyKey] || config.copy;

      const selectedStyle = AD_STYLES.find(
        (s: any) => s.label === activeCopy.answers.estiloAnuncio
      );
      const styleWithDesc = selectedStyle
        ? `${selectedStyle.label} — ${selectedStyle.desc}`
        : activeCopy.answers.estiloAnuncio;

      // Stream tokens into the script field as they arrive — the user
      // sees text appearing live instead of waiting 15s for a blob.
      // The model wraps the real script in JSON, so the stream shows
      // raw JSON-ish text first; on completion we parse + replace
      // with the clean script.
      // UX18: carrega biblioteca pessoal do user (se logado) e injeta no
      // answers como __clientCopyLibrary — claudeService.selectCopyExamples
      // prioriza esses sobre os sistema-wide. Falha silenciosa se não der.
      // UX22: se user marcou copies específicas como referência, filtra a
      // biblioteca pra ENVIAR APENAS essas. Senão (vazio), manda tudo e
      // o algoritmo escolhe automaticamente (top 2 por vertical/awareness).
      let clientCopyLibrary: any[] = [];
      try {
        if (user?.uid) {
          const fullLib = await loadPersonalLibrary(user.uid);
          const selectedIds = (activeCopy?.referenceCopyIds as string[] | undefined) || [];
          if (selectedIds.length > 0) {
            clientCopyLibrary = fullLib.filter((c) => selectedIds.includes(c.id));
          } else {
            clientCopyLibrary = fullLib;
          }
        }
      } catch {
        clientCopyLibrary = [];
      }

      // UX22: flag indicando se a clientCopyLibrary é seleção manual.
      // Quando true, claudeService usa TODAS as copies como exemplo
      // (não filtra por vertical/awareness pelo algoritmo).
      const referenceIds = (activeCopy?.referenceCopyIds as string[] | undefined) || [];
      const isManualSelection = referenceIds.length > 0;
      // UX23-F: similarity slider (default 65 quando há seleção manual)
      const referenceSimilarity =
        typeof activeCopy?.referenceSimilarity === 'number' ? activeCopy.referenceSimilarity : 65;

      // UX23-C: log + persist snapshot das referências efetivamente usadas
      if (isManualSelection && clientCopyLibrary.length > 0) {
        console.info(
          `[handleGenerateCopy] sending ${clientCopyLibrary.length} reference copies | similarity=${referenceSimilarity}%`,
          clientCopyLibrary.map((c) => ({
            id: c.id,
            name: c.name,
            vertical: c.vertical,
            language: c.language,
          }))
        );
      }

      // UX25-A4: modo rascunho (Sonnet) vs final (Opus)
      const draftMode = !!activeCopy?.draftMode;

      // UX25-C1: debug snapshot do prompt — capturado via onDebug
      let capturedDebug: import('./lib/claudeService').CopyDebugInfo | null = null;

      let streamed = '';
      const result = await generateAdCopyWithClaude(
        {
          ...activeCopy.answers,
          // Driver emocional real lido da VSL (só preenche se o usuário não tiver
          // posto o seu nas respostas).
          emotionalDriver:
            (activeCopy.answers as any)?.emotionalDriver ||
            (activeCopy?.productInfo as ProductInfo | null)?.emotionalDriver ||
            '',
          estiloAnuncio: styleWithDesc,
          __clientCopyLibrary: clientCopyLibrary,
          __manualSelection: isManualSelection,
          __referenceSimilarity: referenceSimilarity,
          __draftMode: draftMode,
          // O tipo é definido pela ABA: 'Copy da VSL' gera roteiro longo; 'Copy'
          // gera anúncio curto. Sem toggle — a aba manda.
          __creativeType: currentStep === 'copy-vsl' ? 'vsl' : 'ad',
        },
        activeCopy.mode,
        config.angle,
        activeCopy.scriptLength,
        activeCopy.targetWordCount,
        activeCopy.hookSelecionado || '',
        (chunk) => {
          streamed += chunk;
          setConfig((prev) => ({
            ...prev,
            [copyKey]: {
              ...(prev as any)[copyKey],
              // Show the live token stream. Strip code-fence markers so
              // the user sees natural text instead of ```json prefix.
              generatedScript: streamed.replace(/```json\n?/g, '').replace(/```\n?/g, ''),
            },
          }));
        },
        // UX25-C1: captura o prompt enviado pro modal de debug
        (debug) => {
          capturedDebug = debug;
        }
      );
      if (!result) throw new Error('A IA retornou uma resposta vazia.');

      // UX23-E: snapshot das copies usadas — sobrevive deleção da
      // biblioteca e permite "Ver referências usadas" depois.
      const lastUsedReferences =
        isManualSelection && clientCopyLibrary.length > 0
          ? clientCopyLibrary.map((c) => ({
              id: c.id,
              name: c.name,
              scriptPreview: (c.script || '').slice(0, 280),
              vertical: c.vertical,
              language: c.language,
            }))
          : undefined;

      // UX25-C1+C2: snapshot do prompt + custo estimado
      const finalScript = typeof result === 'string' ? result : result.script || '';
      // Atualiza o medidor de gasto real da API na hora (além do poll de 10s).
      window.dispatchEvent(new Event('claude-usage-changed'));
      const dbg = capturedDebug as import('./lib/claudeService').CopyDebugInfo | null;
      const costEstimate = dbg
        ? estimateCopyCost({
            inputTokens: dbg.estimatedInputTokens,
            outputChars: finalScript.length,
            model: dbg.model,
            withThinking: dbg.model === 'opus',
          })
        : null;
      const lastDebug = dbg
        ? {
            systemPrompt: dbg.systemPrompt,
            userPrompt: dbg.userPrompt,
            response: finalScript,
            model: dbg.model,
            estimatedInputTokens: dbg.estimatedInputTokens,
            estimatedOutputTokens: costEstimate?.outputTokens || 0,
            estimatedCost: costEstimate?.cost || 0,
            timestamp: dbg.timestamp,
          }
        : undefined;

      // UX25-B2: append-to-history — mantém últimas 5 gerações.
      // Evita duplicar quando user só regenera sem mudar nada.
      const newHistoryEntry = finalScript
        ? {
            script: finalScript,
            timestamp: Date.now(),
            model: (dbg?.model || 'opus') as 'opus' | 'sonnet',
            wordCount: finalScript.split(/\s+/).filter(Boolean).length,
          }
        : null;

      // Final, clean replacement (parses the JSON envelope properly).
      setConfig((prev) => {
        const prevSlice = (prev as any)[copyKey] || prev.copy;
        const prevHistory = (prevSlice as any)?.history || [];
        const dedupedHistory = newHistoryEntry
          ? [
              newHistoryEntry,
              ...prevHistory.filter((h: any) => h.script !== newHistoryEntry.script),
            ].slice(0, 5)
          : prevHistory;
        return {
          ...prev,
          [copyKey]: {
            ...prevSlice,
            generatedScript: finalScript,
            // Limpa o finalScript de uma copy aprovada anterior. Sem isso, o
            // scan de risco (CopyTab lê finalScript || generatedScript) varria
            // o texto VELHO e não avisava sobre termos novos (ex.: gabapentina)
            // na copy recém-gerada. Também some o ack de risco antigo.
            finalScript: '',
            contentRiskAcknowledgedHash: undefined,
            optimizedScript: '',
            ...(lastUsedReferences ? { lastUsedReferences } : {}),
            ...(lastDebug ? { lastDebug } : {}),
            history: dedupedHistory,
          },
        };
      });
      setHasUnsavedCopyChanges(true);

      // UX23-C: toast diferente quando usou referências manuais — confirma
      // pro user que a seleção dele teve efeito.
      if (isManualSelection && clientCopyLibrary.length > 0) {
        const bucket =
          referenceSimilarity <= 25
            ? 'leve'
            : referenceSimilarity <= 50
              ? 'médio'
              : referenceSimilarity <= 75
                ? 'forte'
                : 'clone';
        toast.success(
          `Copy gerada com ${clientCopyLibrary.length} ${
            clientCopyLibrary.length === 1 ? 'referência' : 'referências'
          } · similaridade ${referenceSimilarity}% (${bucket})`,
          { duration: 4500 }
        );
      } else {
        toast.success('Copy gerada com sucesso!');
      }
    } catch (err: any) {
      console.error('Generation error:', err);
      const msg = err.message || String(err);
      if (msg.includes('Requested entity was not found') || msg.includes('API_KEY_INVALID')) {
        setHasApiKey(false);
        setProviderError({
          provider: 'Model',
          message: 'Sua chave API parece inválida. Por favor, selecione-a novamente.',
        });
      } else if (msg.includes('fetch')) {
        setProviderError({
          provider: 'Model',
          message: 'Erro de conexão com o servidor da IA. Verifique sua internet.',
        });
      } else {
        setProviderError({
          provider: 'Model',
          message: `Erro ao gerar copy: ${msg}`,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const addLog = (message: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  const handleGenerateSubtitles = async () => {
    setLoading(true);
    setError(null);
    try {
      setGenerationStage('subtitles');
      addLog('SUBTITLES_STARTED');
      await new Promise((resolve) => setTimeout(resolve, 2000));
      addLog('SUBTITLES_COMPLETED');
      setGenerationStage('subtitles_ready');
    } catch (err: any) {
      console.error('Subtitles error:', err);
      setError(err.message || 'Erro ao gerar legendas.');
    } finally {
      setLoading(false);
    }
  };

  const startPolling = (videoId: string) => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    const pollStatus = async () => {
      try {
        const now = Date.now();
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[HeyGen Polling] Attempting poll for ${videoId}...`);
        }

        if (!videoId) {
          console.error('[HeyGen Polling] Skipping poll: videoId is null or empty.');
          return;
        }

        const statusRes = await fetch(`/api/heygen/status/${videoId}`);
        if (!statusRes.ok) {
          console.error(`[HeyGen Polling] Status check failed for ${videoId}: ${statusRes.status}`);
          return;
        }

        const contentType = statusRes.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          console.error(`[HeyGen Polling] Invalid content-type for ${videoId}: ${contentType}`);
          return;
        }

        const statusData = await statusRes.json();
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[HeyGen Polling] Status for ${videoId}:`, statusData);
        }

        if (statusData.status === 'failed') {
          console.error(
            `[HeyGen Polling] Job failed for ${videoId}:`,
            statusData.error || 'Unknown error'
          );
          setVideoOp((prev: any) => ({
            ...prev,
            status: 'failed',
            displayStatus: 'Error',
            error: statusData.error || 'Unknown error',
          }));
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          return; // Stop polling
        }

        setVideoOp((prev: any) => {
          if (!prev || prev.id !== videoId) return prev;

          const statusMap: Record<string, string> = {
            pending: 'Queued',
            waiting: 'Waiting',
            processing: 'Processing',
            rendering: 'Rendering',
            completed: 'Done',
            failed: 'Error',
          };

          const currentStatus = statusData.status;
          let processingStartTime = prev.processingStartTime;
          if (currentStatus === 'processing' && !processingStartTime) {
            processingStartTime = now;
          }

          // Stuck detection
          let isStuck = false;
          let stuckReason = null;
          let lastStatusChangeTime = prev.lastStatusChangeTime;

          if (currentStatus === prev.lastStatus) {
            const timeInStatus = (now - prev.lastStatusChangeTime) / 1000;
            // O HeyGen fica em 'processing'/'rendering' o RENDER INTEIRO sem
            // mudar de status — e vídeos longos (3-4 min de fala) levam ~20 min.
            // Por isso o threshold antigo de 6 min dava falso alarme em todo
            // vídeo longo. Render ativo ganha 25 min; outros estados, 6 min.
            const isActiveRender =
              currentStatus === 'processing' || currentStatus === 'rendering';
            const stuckThreshold = isActiveRender ? 1500 : 360;
            if (timeInStatus > stuckThreshold) {
              isStuck = true;
              stuckReason = isActiveRender
                ? 'Sem concluir há >25min — provavelmente travou no HeyGen'
                : 'No status change detected for >6m';
            }
          } else {
            lastStatusChangeTime = now;
          }

          if (
            (currentStatus === 'pending' || currentStatus === 'waiting') &&
            now - prev.startTime > 300000
          ) {
            isStuck = true;
            stuckReason = 'Likely stuck in queue (>5m)';
          }

          return {
            ...prev,
            status: currentStatus,
            displayStatus: statusMap[currentStatus] || currentStatus,
            progress: statusData.progress,
            pollCount: prev.pollCount + 1,
            lastStatus: currentStatus,
            lastStatusChangeTime,
            processingStartTime,
            isStuck,
            stuckReason,
            videoUrl: statusData.video_url,
            lastPoll: now,
          };
        });

        if (statusData.status === 'completed' || statusData.status === 'failed') {
          if (process.env.NODE_ENV !== 'production') {
            console.log(
              `[HeyGen Polling] Stopping for ${videoId} (Final Status: ${statusData.status})`
            );
          }
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }

          if (statusData.status === 'completed') {
            addLog('VIDEO_COMPLETED');

            // Post-process crop via Railway (Cloud Run FFmpeg is broken).
            // Returns a Firebase Storage URL of the cropped video.
            const finalizeVideo = async (url: string): Promise<string> => {
              if (config.avatar.avatarFormat !== 'square') return url;
              if (!auth.currentUser) {
                console.warn('[Crop Railway] No authenticated user, skipping crop');
                return url;
              }
              try {
                console.log('[Crop Railway] Requesting crop:', url.substring(0, 80));
                const cropRes = await fetch(
                  'https://analises-production.up.railway.app/metavise/crop',
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      videoUrl: url,
                      aspectRatio: '1:1',
                      cropOffset: config.avatar.cropOffset || 0,
                    }),
                  }
                );
                if (!cropRes.ok) {
                  console.error('[Crop Railway] Failed with status', cropRes.status);
                  return url;
                }
                const blob = await cropRes.blob();
                console.log('[Crop Railway] Got cropped blob, size:', blob.size);
                // Use the same path pattern as handleSaveVideoToFirebase: video/{uid}/{timestamp}.mp4
                const storageRef = ref(
                  storage,
                  `video/${auth.currentUser.uid}/cropped_${Date.now()}.mp4`
                );
                await uploadBytes(storageRef, blob, { contentType: 'video/mp4' });
                const downloadUrl = await getDownloadURL(storageRef);
                console.log('[Crop Railway] Uploaded to Firebase:', downloadUrl.substring(0, 80));
                return downloadUrl;
              } catch (e: any) {
                console.error('[Crop Railway] Error, falling back to original:', e);
                return url;
              }
            };

            // Save to Firebase
            if (statusData.video_url) {
              console.log('[Video] HeyGen returned URL:', statusData.video_url);

              // Crop first (if square), then save the (possibly cropped) URL to Firebase
              const finalUrl = await finalizeVideo(statusData.video_url);
              handleSaveVideoToFirebase(finalUrl).then((result) => {
                if (!result || !result.url) {
                  console.error(
                    '[Video Debug] handleSaveVideoToFirebase failed, using HeyGen URL as final fallback'
                  );
                  // Last fallback — use HeyGen URL directly (works for ~24h before expiring)
                  const newVideo = {
                    url: statusData.video_url,
                    storagePath: null,
                    createdAt: new Date().toISOString(),
                    aspectRatio: config.format.aspectRatio,
                    scale: config.avatar.scale || 1.0,
                    timelineEdits: [],
                  };
                  if (avatarModeRef.current === 'vsl') {
                    setConfig((prev) => {
                      const prevVslVideos =
                        ((prev as any)?.copyVsl?.avatarVideos as (typeof newVideo)[] | undefined) ||
                        [];
                      return {
                        ...prev,
                        copyVsl: {
                          ...((prev as any).copyVsl || {}),
                          avatarVideoUrl: statusData.video_url,
                          avatarVideoStoragePath: null,
                          avatarVideos: [...prevVslVideos, newVideo],
                        } as any,
                      } as any;
                    });
                  } else if (avatarModeRef.current === 'hook') {
                    setConfig((prev) => {
                      const prevHookVideos =
                        ((prev.copy as any)?.hookVideos as (typeof newVideo)[] | undefined) || [];
                      return {
                        ...prev,
                        copy: {
                          ...prev.copy,
                          hookVideoUrl: statusData.video_url,
                          hookVideoStoragePath: null,
                          hookVideos: [...prevHookVideos, newVideo],
                        } as any,
                      };
                    });
                  } else {
                    setVideoUrl(statusData.video_url);
                    setVideos((prev) => [...prev, newVideo]);
                  }
                  setLoading(false);
                  toast(
                    'Vídeo gerado mas falha ao salvar no storage. Use o vídeo agora — link expira em ~24h.',
                    { icon: '⚠️', duration: 6000 }
                  );
                  return;
                }

                const newVideo = {
                  url: result.url,
                  storagePath: result.path,
                  createdAt: new Date().toISOString(),
                  aspectRatio: config.format.aspectRatio,
                  scale: config.avatar.scale || 1.0,
                  timelineEdits: [],
                };

                // In hook mode, persist to config.copy.hookVideos and the
                // hookVideoUrl/StoragePath fields — keeps the body slots
                // untouched so the two videos remain independent.
                if (avatarModeRef.current === 'vsl') {
                  setConfig((prev) => {
                    const prevVslVideos =
                      ((prev as any)?.copyVsl?.avatarVideos as (typeof newVideo)[] | undefined) || [];
                    return {
                      ...prev,
                      copyVsl: {
                        ...((prev as any).copyVsl || {}),
                        avatarVideoUrl: result.url,
                        avatarVideoStoragePath: result.path,
                        avatarVideos: [...prevVslVideos, newVideo],
                      } as any,
                      generationStage: 'video_ready',
                    } as any;
                  });
                } else if (avatarModeRef.current === 'hook') {
                  setConfig((prev) => {
                    const prevHookVideos =
                      ((prev.copy as any)?.hookVideos as (typeof newVideo)[] | undefined) || [];
                    return {
                      ...prev,
                      copy: {
                        ...prev.copy,
                        hookVideoUrl: result.url,
                        hookVideoStoragePath: result.path,
                        hookVideos: [...prevHookVideos, newVideo],
                      } as any,
                      generationStage: 'video_ready',
                    };
                  });
                } else {
                  setVideoUrl(result.url);
                  setVideoStoragePath(result.path);
                  setVideos((prev) => [...prev, newVideo]);

                  setConfig((prev) => ({
                    ...prev,
                    videoUrl: result.url,
                    videoStoragePath: result.path,
                    videos: [...(prev.videos || []), newVideo],
                    generationStage: 'video_ready',
                  }));
                }
                setLastVideoMetadata((prev: any) =>
                  prev
                    ? {
                        ...prev,
                        url: result.url,
                        status: 'completed',
                      }
                    : null
                );
                setGenerationStage('video_ready');
                setLoading(false);
                notifyIfHidden('Vídeo pronto!', {
                  body: 'Seu render do HeyGen terminou.',
                  tag: 'metavise-render',
                });

                // (auto-save removido — clique "Salvar" pra guardar o vídeo)
              });
            } else {
              setVideoUrl(statusData.video_url);
              setGenerationStage('video_ready');
              setLoading(false);
              notifyIfHidden('Vídeo pronto!', {
                body: 'Seu render do HeyGen terminou.',
                tag: 'metavise-render',
              });
            }
          } else {
            addLog('VIDEO_FAILED');
            const rawError =
              statusData.error ||
              statusData.error_message ||
              statusData.data?.error ||
              statusData.data?.error_message;
            let errorMsg = 'Erro desconhecido';

            if (typeof rawError === 'string') {
              errorMsg = rawError;
            } else if (rawError && typeof rawError === 'object') {
              errorMsg = rawError.message || rawError.exception_class || JSON.stringify(rawError);
            }

            if (
              errorMsg.toLowerCase().includes('quota') ||
              errorMsg.toLowerCase().includes('balance')
            ) {
              setProviderError({
                provider: 'HeyGen',
                message:
                  'HeyGen quota/balance exceeded. Please top up or wait before generating again.',
              });
            } else {
              setProviderError({
                provider: 'HeyGen',
                message: `Geração falhou: ${errorMsg}`,
              });
            }
            setLoading(false);
          }
        }
      } catch (err: any) {
        if (err.message && err.message.includes('Failed to fetch')) {
          // Ignore network errors (like load balancer timeouts or momentary drops)
        } else {
          console.error('Polling error:', err);
        }
      }
    };

    pollIntervalRef.current = setInterval(pollStatus, 5000);
    pollStatus();
  };

  // Cost-confirm gate. handleGenerateVideo (the public name the tabs
  // call) opens the preview modal; executeGenerateVideo holds the real
  // generation body and is only invoked from the modal's Confirm.
  // Skips the modal when localStorage flag 'metavise-skip-cost-preview'
  // is set (power-user opt-out).
  const [pendingVideoGen, setPendingVideoGen] = useState<{
    forceRegenerate: boolean;
  } | null>(null);

  const handleGenerateVideo = async (forceRegenerate = false) => {
    if (!isOnline) {
      setError('Você está offline. Verifique sua conexão com a internet.');
      return;
    }

    if (localStorage.getItem('metavise-skip-cost-preview') === '1') {
      return executeGenerateVideo(forceRegenerate);
    }
    setPendingVideoGen({ forceRegenerate });
  };

  const executeGenerateVideo = async (forceRegenerate = false) => {
    if (!isOnline) {
      setError('Você está offline. Verifique sua conexão com a internet.');
      return;
    }

    // Hook mode pulls its audio from config.copy.hookAudioUrl, not the
    // top-level (body) audioUrl. Compute the effective source up front so the
    // guards below validate the audio that will actually be sent to HeyGen —
    // otherwise generating a hook video silently no-ops when no body audio
    // exists yet.
    const isHookGen = avatarModeRef.current === 'hook';
    const isVslGen = avatarModeRef.current === 'vsl';
    const hookAudioUrl = ((config.copy as any)?.hookAudioUrl as string | undefined) || '';
    const vslAudioUrl = ((config as any)?.copyVsl?.audioUrl as string | undefined) || '';
    const effectiveAudioUrl = isVslGen
      ? vslAudioUrl || audioUrl
      : isHookGen
        ? hookAudioUrl || audioUrl
        : audioUrl;

    if (effectiveAudioUrl && effectiveAudioUrl.startsWith('blob:')) {
      setError(
        'O áudio ainda está sendo processado ou falhou no upload. Tente gerar o áudio novamente.'
      );
      return;
    }

    if (!effectiveAudioUrl && !isTestMode) {
      setError('Áudio não encontrado. Por favor, gere o áudio no passo anterior.');
      return;
    }

    setLoading(true);
    setError(null);

    // Check if video already exists and matches current config
    if (!forceRegenerate && config.lastVideoMetadata && config.videoUrl) {
      let avatarScript = (config.copy.generatedScript || '').includes('[AVATAR]:')
        ? config.copy.generatedScript.split('[AVATAR]:')[1]?.split('[SCENE]:')[0]?.trim() || ''
        : config.copy.generatedScript || '';

      if (isTestMode) {
        avatarScript = 'Olá! Este é um teste rápido de 3 segundos para validar a geração.';
      }

      const isMatch =
        config.lastVideoMetadata.avatarId === config.avatar.faceId &&
        config.lastVideoMetadata.voiceId === config.avatar.voiceId &&
        config.lastVideoMetadata.script === avatarScript &&
        config.lastVideoMetadata.audioUrl === audioUrl &&
        config.lastVideoMetadata.aspectRatio === config.format.aspectRatio &&
        config.lastVideoMetadata.isTestMode === isTestMode &&
        config.lastVideoMetadata.status === 'completed';

      if (isMatch) {
        setVideoUrl(config.videoUrl);
        setGenerationStage('video_ready');
        setLoading(false);
        toast.success('Vídeo já gerado para estas configurações.');
        return;
      }
    }

    // Reset video states if forceRegenerate
    if (forceRegenerate) {
      // We don't clear videoUrl immediately to allow user to see current video while generating new one
      setVideoOp(null);
      setConfig((prev) => ({
        ...prev,
        lastVideoMetadata: null,
        edit: { ...prev.edit, timelineEdits: [] }, // Clear edits for new generation
      }));
    }

    if (!config.avatar.faceId || config.avatar.faceId === 'f1' || config.avatar.faceId === '') {
      setError('Por favor, selecione um avatar válido na lista antes de gerar o vídeo.');
      setLoading(false);
      return;
    }

    try {
      let avatarScript = (config.copy.generatedScript || '').includes('[AVATAR]:')
        ? config.copy.generatedScript.split('[AVATAR]:')[1]?.split('[SCENE]:')[0]?.trim() || ''
        : config.copy.generatedScript || '';

      if (isTestMode) {
        avatarScript = 'Olá! Este é um teste rápido de 3 segundos para validar a geração.';
      }

      if (!avatarScript || avatarScript.trim() === '') {
        throw new Error('Script está vazio. Por favor, gere a copy primeiro.');
      }

      setGenerationStage('video');
      addLog('VIDEO_STARTED');
      // Ask once (silently no-ops on re-entry) — the user is about to
      // wait 3–5 min, so the notification is the payoff for granting.
      ensureNotificationPermission();
      console.log(`[Video Generation] Starting with Aspect Ratio: ${config.format.aspectRatio}`);

      // Proporção enviada pro HeyGen. HeyGen NÃO fornece aspect_ratio confiável
      // → o NATIVO do avatar é HORIZONTAL (16:9) por padrão (igual ao modal e ao
      // branch 'square'); só 9:16 quando marcado como vertical. Antes o 'original'
      // usava config.format.aspectRatio, que a seleção gravava errado (9:16) → o
      // avatar horizontal saía vertical com bordas.
      let requestedRatioForHeyGen = config.format.aspectRatio;
      const avatarObj = heygenAvatars.find((a) => a.avatar_id === config.avatar.faceId);
      const nativeIsVertical =
        avatarObj?.aspect_ratio === '9:16' ||
        !!avatarObj?.avatar_id?.toLowerCase().includes('vertical') ||
        !!avatarObj?.avatar_id?.toLowerCase().includes('portrait');
      if (config.avatar.avatarFormat === 'square') {
        // Gera no nativo e recorta pra 1:1 localmente (cropOffset).
        requestedRatioForHeyGen = nativeIsVertical ? '9:16' : '16:9';
      } else {
        // 'original' = proporção NATIVA do avatar (não o config, que pode estar velho).
        requestedRatioForHeyGen = nativeIsVertical ? '9:16' : '16:9';
      }

      const startTime = Date.now();
      // In hook mode we also override the script with hookSelecionado so
      // HeyGen's native TTS fallback path produces hook content if the audio
      // is missing. (isHookGen / effectiveAudioUrl were computed up front,
      // next to the audio guards.)
      const effectiveScript = isHookGen
        ? config.copy?.hookSelecionado || avatarScript
        : avatarScript;
      const finalPayload = {
        avatarId: config.avatar.faceId,
        voiceId: config.avatar.voiceId,
        script: effectiveScript,
        audioUrl: effectiveAudioUrl,
        aspectRatio: requestedRatioForHeyGen,
        scale: config.avatar.scale || 1.0,
        useNativeFallback: useNativeFallback,
        // Fundo escolhido na aba Avatar (cor/imagem/vídeo). Ausente → servidor
        // usa preto sólido (comportamento legado).
        background: config.avatar.background,
        title: isTestMode
          ? `Test Clip - ${Date.now()}`
          : isHookGen
            ? `Hook Clip - ${config.angle}`
            : `Video Ad - ${config.angle}`,
      };
      const response = await authedFetch('/api/heygen/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalPayload),
      });

      if (!response.ok) {
        let errorMsg = 'Erro ao iniciar geração do vídeo.';
        try {
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const errorData = await response.json();
            errorMsg = errorData.error || errorMsg;
          } else {
            const text = await response.text();
            errorMsg = `Erro do servidor (${response.status}): ${text.substring(0, 100)}`;
          }
        } catch (e) {
          errorMsg = `Erro na resposta: ${response.statusText}`;
        }
        throw new Error(errorMsg);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        throw new Error(`Resposta inválida do servidor: ${text.substring(0, 100)}`);
      }

      const { videoId, remainingCredits } = await response.json();
      setCredits(remainingCredits);

      // Save initial metadata for persistence across refresh
      const initialMetadata = {
        videoId,
        url: '',
        status: 'pending',
        createdAt: new Date().toISOString(),
        avatarId: config.avatar.faceId,
        voiceId: config.avatar.voiceId,
        script: avatarScript,
        audioUrl: audioUrl,
        aspectRatio: config.format.aspectRatio,
        isTestMode: isTestMode,
      };

      setLastVideoMetadata(initialMetadata);

      // (auto-save removido — salvar manualmente)

      const initialOp = {
        id: videoId,
        status: 'pending',
        displayStatus: 'Queued',
        progress: 0,
        startTime,
        requestSentTime: new Date(startTime).toLocaleTimeString(),
        queuedStartTime: startTime,
        processingStartTime: null,
        totalTime: 0,
        pollCount: 0,
        lastStatus: 'pending',
        lastStatusChangeTime: startTime,
        isStuck: false,
        stuckReason: null,
      };
      setVideoOp(initialOp);

      // Start Polling
      startPolling(videoId);
    } catch (err: any) {
      console.error('Pipeline error:', err);
      const msg = err.message || 'Erro na pipeline de geração.';
      if (msg.includes('quota') || msg.includes('balance')) {
        setProviderError({
          provider: 'HeyGen',
          message: 'HeyGen quota/balance exceeded. Please top up or wait before generating again.',
        });
      } else {
        setProviderError({ provider: 'HeyGen', message: msg });
      }
      setLoading(false);
    }
  };

  const handleCancelGeneration = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setLoading(false);
    setVideoOp((prev: any) =>
      prev ? { ...prev, status: 'cancelled', displayStatus: 'Cancelado' } : null
    );
    addLog('VIDEO_CANCELLED_BY_USER');
    toast.error('Geração cancelada pelo usuário.');
  };

  const canNavigateTo = (stepId: Step) => {
    if (stepId === 'projects' || stepId === 'integrations') return true;
    if (!currentProjectId) {
      toast.error("Por favor, selecione um projeto primeiro em 'Meus Projetos'.", {
        icon: '📁',
        duration: 4000,
      });
      setCurrentStep('projects');
      return false;
    }
    return true;
  };

  const nextStep = () => {
    const currentIndex = STEPS.findIndex((s) => s.id === currentStep);
    // Walk forward, skipping any steps disabled by the project config
    // (right now only 'hook-visual' when useHook is off).
    for (let i = currentIndex + 1; i < STEPS.length; i++) {
      const candidate = STEPS[i]!.id;
      if (!useHookFlow && candidate === 'hook-visual') continue;
      if (candidate === 'copy-vsl') continue; // aba neutra: fluxo do anúncio pula a VSL
      if (candidate === 'merge') continue; // aba neutra: fora do fluxo Próximo/Anterior
      if (candidate === 'montagem') continue; // aba neutra (alcançada pelo botão do Avatar)
      if (candidate === 'video-ia') continue; // aba neutra (gerador, alcançada pela aba)
      if (canNavigateTo(candidate)) {
        setCurrentStep(candidate);
      }
      return;
    }
  };

  const prevStep = () => {
    const currentIndex = STEPS.findIndex((s) => s.id === currentStep);
    for (let i = currentIndex - 1; i >= 0; i--) {
      const candidate = STEPS[i]!.id;
      if (!useHookFlow && candidate === 'hook-visual') continue;
      if (candidate === 'copy-vsl') continue; // aba neutra: fluxo do anúncio pula a VSL
      if (candidate === 'merge') continue; // aba neutra: fora do fluxo Próximo/Anterior
      if (candidate === 'montagem') continue; // aba neutra (alcançada pelo botão do Avatar)
      if (candidate === 'video-ia') continue; // aba neutra (gerador, alcançada pela aba)
      setCurrentStep(candidate);
      return;
    }
  };

  // ─── Aba "Copy da VSL": campo próprio (config.copyVsl) ────────────────────
  // A CopyTab é reaproveitada em modo VSL. Pra não sobrescrever o anúncio, ela
  // recebe config.copyVsl NO LUGAR de config.copy, e os setters roteiam de
  // volta pra copyVsl. Semeamos copyVsl a partir do config.copy (herda persona/
  // contexto), zerando só os OUTPUTS (roteiro/histórico) — os dois coexistem.
  const seedVslCopy = (base: AdConfig['copy']): AdConfig['copy'] =>
    ({
      ...base,
      generatedScript: '',
      optimizedScript: '',
      finalScript: '',
      generatedHooks: [],
      history: [],
      lastDebug: undefined,
      targetWordCount: undefined,
      creativeType: 'vsl',
      contentRiskAcknowledgedHash: undefined,
    }) as any;

  const vslCopy: AdConfig['copy'] = (config as any).copyVsl || seedVslCopy(config.copy);
  const vslView: AdConfig = { ...config, copy: vslCopy };

  // setConfig proxied: aplica o update sobre a VIEW (copy=copyVsl) e grava o
  // resultado de volta em copyVsl, preservando o config.copy (anúncio) intacto.
  const setConfigVsl: React.Dispatch<React.SetStateAction<AdConfig>> = (update) => {
    setConfig((real) => {
      const currentVsl = (real as any).copyVsl || seedVslCopy(real.copy);
      const view = { ...real, copy: currentVsl } as AdConfig;
      const nextView: any = typeof update === 'function' ? (update as any)(view) : update;
      const { copy: nextVsl, copyVsl: _drop, ...restNonCopy } = nextView;
      return { ...real, ...restNonCopy, copy: real.copy, copyVsl: nextVsl } as AdConfig;
    });
  };

  // updateConfig granular: quando a seção é 'copy', redireciona pra 'copyVsl'.
  const updateConfigVsl = (section: keyof AdConfig, sub: string, field: string, value: any) => {
    if (section !== 'copy') {
      updateConfig(section, sub, field, value);
      return;
    }
    setConfig((prev) => {
      const currentVsl: any = (prev as any).copyVsl || seedVslCopy(prev.copy);
      const currentSub = currentVsl[sub] || {};
      return {
        ...prev,
        copyVsl: { ...currentVsl, [sub]: { ...currentSub, [field]: value } },
      } as AdConfig;
    });
  };

  const setDiscoveryVsl = (m: any) =>
    setConfig((prev) => {
      const currentVsl: any = (prev as any).copyVsl || seedVslCopy(prev.copy);
      return { ...prev, copyVsl: { ...currentVsl, discoveryMode: m } } as AdConfig;
    });

  // Semeia config.copyVsl na 1ª vez que entra na aba (persiste o campo).
  useEffect(() => {
    if (currentStep === 'copy-vsl' && !(config as any).copyVsl) {
      setConfig((prev) =>
        (prev as any).copyVsl
          ? prev
          : ({ ...prev, copyVsl: seedVslCopy(prev.copy) } as AdConfig)
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  // --- Step Renderers ---

  const handleSaveElevenLabsKey = async () => {
    if (!elevenLabsKey) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/elevenlabs/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: elevenLabsKey }),
      });
      if (!response.ok) throw new Error('Falha ao salvar a chave API.');
      toast.success('Chave API do ElevenLabs atualizada com sucesso!');
      setElevenLabsKey('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTestElevenLabsConnection = async () => {
    setTestStatus({ status: 'loading' });
    try {
      const response = await fetch('/api/elevenlabs/health');
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const data = await response.json();
        if (response.ok && data.status === 'ok') {
          setTestStatus({
            status: 'success',
            message: `Conectado! Plano: ${data.tier}`,
          });
        } else {
          setTestStatus({
            status: 'error',
            message: data.message || 'Falha na conexão.',
          });
        }
      } else {
        const text = await response.text();
        throw new Error(`Resposta inválida do servidor: ${text.substring(0, 100)}`);
      }
    } catch (err: any) {
      setTestStatus({ status: 'error', message: err.message });
    }
  };

  const handleSaveHeyGenKey = async () => {
    if (!heygenKey) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/heygen/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: heygenKey }),
      });
      if (!response.ok) throw new Error('Falha ao salvar a chave API do HeyGen.');
      toast.success('Chave API do HeyGen atualizada com sucesso!');
      setHeygenKey('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTestHeyGenConnection = async () => {
    setHeygenTestStatus({ status: 'loading' });
    try {
      const response = await fetch('/api/heygen/health');
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const data = await response.json();
        if (response.ok && data.status === 'ok') {
          setHeygenTestStatus({
            status: 'success',
            message: `Conectado! Quota: ${data.quota}`,
          });
        } else {
          setHeygenTestStatus({
            status: 'error',
            message: data.message || 'Falha na conexão.',
          });
        }
      } else {
        const text = await response.text();
        throw new Error(`Resposta inválida do servidor: ${text.substring(0, 100)}`);
      }
    } catch (err: any) {
      setHeygenTestStatus({ status: 'error', message: err.message });
    }
  };

  const handleSaveGeminiKey = async () => {
    if (!geminiKey) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/gemini/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: geminiKey }),
      });
      if (!response.ok) throw new Error('Falha ao salvar a chave API do Gemini.');
      // Make the new key available to existing Gemini call sites without
      // forcing a page reload — they all read window.process.env.GEMINI_API_KEY.
      const w = window as any;
      w.process = w.process || { env: {} };
      w.process.env = w.process.env || {};
      w.process.env.GEMINI_API_KEY = geminiKey;
      // Skip the AI Studio key selector for any subsequent IA call.
      setHasApiKey(true);
      toast.success('Chave API do Gemini atualizada com sucesso!');
      setGeminiKey('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTestGeminiConnection = async () => {
    setGeminiTestStatus({ status: 'loading' });
    try {
      const response = await fetch('/api/gemini/health');
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const data = await response.json();
        if (response.ok && data.status === 'ok') {
          setGeminiTestStatus({
            status: 'success',
            message: data.message || 'Conectado!',
          });
        } else {
          setGeminiTestStatus({
            status: 'error',
            message: data.message || 'Falha na conexão.',
          });
        }
      } else {
        const text = await response.text();
        throw new Error(`Resposta inválida do servidor: ${text.substring(0, 100)}`);
      }
    } catch (err: any) {
      setGeminiTestStatus({ status: 'error', message: err.message });
    }
  };

  const handleSaveClaudeKey = async () => {
    if (!claudeKey) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/claude/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: claudeKey }),
      });
      if (!response.ok) throw new Error('Falha ao salvar a chave API do Claude.');
      toast.success('Chave API do Claude atualizada com sucesso!');
      setClaudeKey('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTestClaudeConnection = async () => {
    setClaudeTestStatus({ status: 'loading' });
    try {
      const response = await fetch('/api/claude/health');
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const data = await response.json();
        if (response.ok && data.status === 'ok') {
          setClaudeTestStatus({
            status: 'success',
            message: data.message || 'Conectado!',
          });
        } else {
          setClaudeTestStatus({
            status: 'error',
            message: data.message || 'Falha na conexão.',
          });
        }
      } else {
        const text = await response.text();
        throw new Error(`Resposta inválida do servidor: ${text.substring(0, 100)}`);
      }
    } catch (err: any) {
      setClaudeTestStatus({ status: 'error', message: err.message });
    }
  };

  const handleSaveAssemblyAIKey = async () => {
    if (!assemblyKey) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/assemblyai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: assemblyKey }),
      });
      if (!response.ok) throw new Error('Falha ao salvar a chave API do AssemblyAI.');
      toast.success('Chave API do AssemblyAI atualizada com sucesso!');
      setAssemblyKey('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveZapCapKey = async () => {
    if (!zapcapKey) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/zapcap/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: zapcapKey }),
      });
      if (!response.ok) throw new Error('Falha ao salvar a chave API do ZapCap.');
      toast.success('Chave API do ZapCap atualizada com sucesso!');
      setZapcapKey('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveRunwayKey = async () => {
    if (!runwayKey) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/runway/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: runwayKey }),
      });
      if (!response.ok) throw new Error('Falha ao salvar a chave API da Runway.');
      toast.success('Chave API da Runway atualizada com sucesso!');
      setRunwayKey('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTestRunwayConnection = async () => {
    setRunwayTestStatus({ status: 'loading' });
    try {
      const response = await fetch('/api/runway/health');
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const data = await response.json();
        if (response.ok && data.status === 'ok') {
          setRunwayTestStatus({
            status: 'success',
            message: data.message || 'Conectado com sucesso!',
          });
        } else {
          setRunwayTestStatus({
            status: 'error',
            message: data.message || 'Falha na conexão.',
          });
        }
      } else {
        const text = await response.text();
        throw new Error(`Resposta inválida do servidor: ${text.substring(0, 100)}`);
      }
    } catch (err: any) {
      setRunwayTestStatus({ status: 'error', message: err.message });
    }
  };

  const handleTestAssemblyAIConnection = async () => {
    setAssemblyTestStatus({ status: 'loading' });
    try {
      const response = await fetch('/api/assemblyai/health');
      if (!response.ok) throw new Error('Falha na conexão com AssemblyAI');
      const data = await response.json();
      setAssemblyTestStatus({
        status: 'success',
        message: data.message || 'Conectado com sucesso!',
      });
    } catch (err: any) {
      setAssemblyTestStatus({ status: 'error', message: err.message });
    }
  };

  const handleTestZapCapConnection = async () => {
    setZapcapTestStatus({ status: 'loading' });
    try {
      const response = await fetch('/api/zapcap/health');
      if (!response.ok) throw new Error('Falha na conexão com ZapCap');
      const data = await response.json();
      setZapcapTestStatus({
        status: 'success',
        message: data.message || 'Conectado com sucesso!',
      });
    } catch (err: any) {
      setZapcapTestStatus({ status: 'error', message: err.message });
    }
  };

  const handleStartAutoEdit = async () => {
    if (!videoUrl) {
      toast.error('Nenhum vídeo disponível para analisar.');
      return;
    }

    setLoading(true);
    setAutoEditState((prev) => ({
      ...prev,
      status: 'analyzing',
      step: 'Explorando conteúdo com AssemblyAI...',
      progress: 10,
      editMode: 'auto',
    }));

    try {
      toast.loading('Iniciando análise inteligente...', { id: 'auto-edit' });

      const authorizedUrl = getAuthorizedUrl(videoUrl, platformApiKey || undefined);

      const response = await fetch('/api/assemblyai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: authorizedUrl }),
      });

      if (!response.ok) {
        let errorMsg = 'Erro na análise AssemblyAI';
        try {
          const errData = await response.json();
          errorMsg = errData.details || errData.error || errorMsg;
        } catch (e) {
          const text = await response.text();
          console.error('[AssemblyAI Fail] Non-JSON error:', text.substring(0, 500));
          errorMsg = `Erro do servidor (Status ${response.status}): ${text.substring(0, 100)}...`;
        }
        throw new Error(errorMsg);
      }

      const analysis: AssemblyAnalysis = await response.json();

      // 1. Gerar candidatos a B-Roll (Sentences entre 2-8 segundos)
      const candidates: BrollCandidate[] = [];
      const rawSentences = analysis.sentences || [];
      const rawHighlights = analysis.highlights || [];

      rawSentences.forEach((s, idx) => {
        const duration = (s.end - s.start) / 1000;
        if (duration >= 2 && duration <= 8) {
          // Calcular rank baseado nos highlights contidos na frase
          const relevantHighlights = rawHighlights.filter((h) =>
            s.text.toLowerCase().includes(h.text.toLowerCase())
          );
          const maxRank =
            relevantHighlights.length > 0 ? Math.max(...relevantHighlights.map((h) => h.rank)) : 0;

          candidates.push({
            id: `sent-${idx}`,
            text: s.text,
            rank: maxRank,
            start: s.start,
            end: s.end,
            duration: Math.round(duration * 100) / 100,
          });
        }
      });

      // 2. Lógica de Seleção Hierárquica
      let finalCandidates: BrollCandidate[] = [];

      // Tentativa 1: Rank >= 0.7
      const highRank = candidates.filter((c) => c.rank >= 0.7).sort((a, b) => b.rank - a.rank);
      if (highRank.length > 0) {
        finalCandidates = highRank.slice(0, 10);
      }
      // Tentativa 2: Rank >= 0.5
      else {
        const medRank = candidates.filter((c) => c.rank >= 0.5).sort((a, b) => b.rank - a.rank);
        if (medRank.length > 0) {
          finalCandidates = medRank.slice(0, 8);
        }
        // Tentativa 3: Qualquer Rank (Sentences que contém qualquer highlight)
        else {
          const anyRank = candidates.filter((c) => c.rank > 0).sort((a, b) => b.rank - a.rank);
          if (anyRank.length > 0) {
            finalCandidates = anyRank.slice(0, 6);
          }
          // Fallback: As 3 sentences mais longas (dentro de 2-8s)
          else {
            finalCandidates = candidates.sort((a, b) => b.duration - a.duration).slice(0, 3);
          }
        }
      }

      const message =
        finalCandidates.length > 0
          ? `Encontramos ${finalCandidates.length} frases ideais para destacar seu conteúdo.`
          : 'Análise concluída. Nenhuma cena sugerida automaticamente.';

      // Calcular brollPercent recomendado
      const totalBrollDuration = finalCandidates.reduce((sum, c) => sum + c.duration, 0);
      const videoDuration = analysis.duration || 60;
      const recommended = Math.round((totalBrollDuration / videoDuration) * 100);
      const safeRecommended = Math.min(70, Math.max(10, recommended));

      setRecommendedBrollPercent(safeRecommended);
      setBrollPercent(safeRecommended);

      setAutoEditState((prev) => ({
        ...prev,
        status: 'analyzed',
        analysis,
        brollCandidates: finalCandidates.length > 0 ? finalCandidates : candidates.slice(0, 12),
        selectedBrollIds: finalCandidates.map((c) => c.id), // PRÉ-MARCADO POR PADRÃO
        step: message,
        progress: 100,
      }));

      toast.success('Análise concluída com sucesso!', { id: 'auto-edit' });

      if (zapCapTemplates.length === 0) {
        fetchZapCapTemplates();
      }
    } catch (err: any) {
      console.error('Auto edit analysis failed:', err);
      setAutoEditState((prev) => ({
        ...prev,
        status: 'error',
        step: `Erro: ${err.message}`,
        progress: 0,
      }));
      toast.error(`Falha na análise: ${err.message}`, { id: 'auto-edit' });
    } finally {
      setLoading(false);
    }
  };

  const fetchZapCapTemplates = async () => {
    try {
      const response = await fetch('/api/zapcap/templates');
      if (response.ok) {
        const data = await response.json();
        const templates = Array.isArray(data) ? data : data.templates || [];
        if (templates.length > 0) {
          setZapCapTemplates(templates);
        }
      }
    } catch (err) {
      console.error('Failed to fetch ZapCap templates:', err);
    }
  };

  const getErrorMessage = (err: any) => {
    if (!err) return 'Erro desconhecido';
    const msg =
      typeof err === 'string'
        ? err
        : err.message && err.message !== '[object Object]'
          ? err.message
          : err.error || err.code || err.status || JSON.stringify(err, Object.getOwnPropertyNames(err));
    if (typeof msg === 'string' && msg.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(msg);
        return (
          parsed.error?.message ||
          parsed.error?.status ||
          parsed.error?.code ||
          parsed.error ||
          parsed.message ||
          parsed.code ||
          parsed.status ||
          (typeof parsed === 'string' ? parsed : JSON.stringify(parsed))
        );
      } catch (e) {
        return msg;
      }
    }
    return msg;
  };

  // ─── Fluxo "b-roll começa em Xs" (corpo) ────────────────────────────────
  // Monta o body do /edit-simple reusando TODAS as configs de legenda atuais,
  // variando só videoUrl + brollPercent. Usado pelas duas partes do split.
  const buildZapEditPayload = (videoUrl: string, brollPercent: number) => {
    const selectedSourceVideo = (videos || []).find((v: any) => v.url === zapVideoUrl);
    const sourceAspect = selectedSourceVideo?.aspectRatio || '9:16';
    const payload: any = {
      videoUrl,
      templateId: zapTemplateId,
      brollPercent,
      language: zapLanguage,
      emoji: zapEmoji,
      animation: zapAnimation,
      emphasizeKeywords: zapEmphasizeKeywords,
      silenceRemoval: zapSilenceRemoval > 0 ? zapSilenceRemoval : undefined,
      subtitleTop: zapSubtitleTop,
      fontUppercase: zapFontUppercase,
      fontSize: zapFontSize,
      displayWords: zapDisplayWords,
      sourceAspectRatio: sourceAspect,
    };
    if (/^#[0-9a-fA-F]{6}$/.test(zapFontColor)) payload.fontColor = zapFontColor;
    if (/^#[0-9a-fA-F]{6}$/.test(zapStrokeColor)) payload.strokeColor = zapStrokeColor;
    if (zapUseCustomHighlight) {
      payload.highlightColorOne = zapHl1;
      payload.highlightColorTwo = zapHl2;
      payload.highlightColorThree = zapHl3;
    }
    return payload;
  };

  // Dispara um edit-simple e ESPERA (promise) o ZapCap concluir, devolvendo a
  // downloadUrl. Loop de polling próprio, separado do poll da UI.
  const renderZapAndWait = async (payload: any): Promise<string> => {
    const res = await fetch('/api/zapcap/edit-simple', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || 'Falha ao iniciar o ZapCap.');
    }
    const { videoId, taskId } = await res.json();
    const uid = user?.uid;
    // até ~25 min (375 × 4s)
    for (let i = 0; i < 375; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      let s: Response;
      try {
        s = await fetch(
          `/api/zapcap/status/${videoId}/${taskId}${uid ? `?userId=${uid}` : ''}`
        );
      } catch {
        continue;
      }
      if (!s.ok) continue;
      const d = await s.json();
      if (d.status === 'completed' && d.downloadUrl) return d.downloadUrl as string;
      if (d.status === 'failed' || d.status === 'error') {
        throw new Error(d.error || 'O ZapCap falhou nessa parte.');
      }
    }
    throw new Error('Tempo esgotado esperando o ZapCap.');
  };

  // Orquestra o corpo com b-roll atrasado: corta em X → ZapCap parte 1 (sem
  // b-roll) + parte 2 (com b-roll) → junta → adiciona na galeria do corpo.
  const handleRenderZapSplit = async () => {
    if (!zapVideoUrl || !zapTemplateId) {
      toast.error('Selecione um vídeo e um template antes de gerar.');
      return;
    }
    if (!user?.uid) {
      toast.error('Faça login antes de gerar.');
      return;
    }
    if (isZapRenderingRef.current) return;
    isZapRenderingRef.current = true;
    setLoading(true);
    const tid = 'zap-simple-render';
    setZapState((prev) => ({
      ...prev,
      status: 'rendering',
      step: 'Cortando o vídeo...',
      progress: 5,
      originalVideoUrl: zapVideoUrl,
    }));
    toast.loading('Cortando o vídeo...', { id: tid });
    try {
      const splitRes = await fetch('/api/video/split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: zapVideoUrl, atSec: zapBrollStartSec }),
      });
      const splitData = await splitRes.json();
      if (!splitRes.ok) throw new Error(splitData.error || 'Falha ao cortar o vídeo.');
      const { part1Url, part2Url } = splitData;

      setZapState((prev) => ({ ...prev, step: 'Legendando a intro (sem b-roll)...', progress: 25 }));
      toast.loading('Legendando a intro (sem b-roll)...', { id: tid });
      const p1 = await renderZapAndWait(buildZapEditPayload(part1Url, 0));

      // Parte 2 (corpo com b-roll) com DEGRADAÇÃO: se o render do ZapCap falhar
      // com b-roll alto (problema recorrente deles), baixa o % aos poucos
      // (30→20→0) até funcionar, em vez de derrubar o split inteiro.
      let p2: string | null = null;
      let p2pct = zapBrollPercent;
      while (p2 === null) {
        try {
          setZapState((prev) => ({
            ...prev,
            step: `Gerando b-rolls no corpo (${p2pct}%)...`,
            progress: 60,
          }));
          toast.loading(`Gerando b-rolls no corpo (${p2pct}%)...`, { id: tid });
          p2 = await renderZapAndWait(buildZapEditPayload(part2Url, p2pct));
        } catch (e) {
          if (p2pct > 0) {
            const next = p2pct > 20 ? Math.max(20, p2pct - 20) : 0;
            toast.loading(
              next > 0
                ? `B-roll ${p2pct}% pesado demais pro ZapCap — tentando ${next}%...`
                : 'B-rolls não couberam — gerando o corpo só com legendas...',
              { id: tid, duration: 8000 }
            );
            p2pct = next;
          } else {
            throw e; // nem o corpo só com legenda passou
          }
        }
      }

      setZapState((prev) => ({ ...prev, step: 'Juntando as partes...', progress: 90 }));
      toast.loading('Juntando as partes...', { id: tid });
      const concatRes = await fetch('/api/video/concat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videos: [p1, p2], userId: user.uid }),
      });
      const concatData = await concatRes.json();
      if (!concatRes.ok) throw new Error(concatData.error || 'Falha ao juntar as partes.');
      const finalUrl = concatData.url as string;

      const wasVslEdit = editZapModeRef.current === 'vsl';
      setZapState((prev) => ({
        ...prev,
        status: 'completed',
        step: 'Edição finalizada!',
        progress: 100,
        finalVideoUrl: finalUrl,
        versions: wasVslEdit ? prev.versions : [...(prev.versions || []), finalUrl],
      }));
      setConfig((prev: any) => {
        const key = wasVslEdit ? 'zapVslVersions' : 'zapVersions';
        const current = ((prev.edit as any)[key] as string[] | undefined) || [];
        return { ...prev, edit: { ...prev.edit, [key]: [...current, finalUrl] } };
      });
      toast.success(`Vídeo pronto — b-roll a partir de ${zapBrollStartSec}s!`, {
        id: tid,
        duration: 6000,
      });
    } catch (err: any) {
      setZapState((prev) => ({ ...prev, status: 'error', step: err.message }));
      toast.error(`Falha: ${err.message}`, { id: tid, duration: 8000 });
    } finally {
      isZapRenderingRef.current = false;
      setLoading(false);
    }
  };

  const handleRenderZapSimple = async (overrideBrollPercent?: number) => {
    // Allow callers (notably the auto-retry on failure) to force a
    // different b-roll % than the slider currently shows.
    const effectiveBrollPercent =
      typeof overrideBrollPercent === 'number' ? overrideBrollPercent : zapBrollPercent;
    // Espelha o % efetivo num ref pro loop de polling (escopo separado) saber
    // pra quanto reduzir no retry e refletir na mensagem.
    zapEffectiveBrollRef.current = effectiveBrollPercent;
    console.log('[ZAP SIMPLE] Clicked', {
      isRendering: isZapRenderingRef.current,
      videoUrl: zapVideoUrl?.substring(0, 60),
      templateId: zapTemplateId,
      brollPercent: effectiveBrollPercent,
      isAutoRetry: zapAutoRetryRef.current,
    });

    if (isZapRenderingRef.current) {
      console.warn('[ZAP SIMPLE] Blocked: already rendering');
      return;
    }
    if (!zapVideoUrl || !zapTemplateId) {
      toast.error('Selecione um vídeo e um template para continuar.');
      return;
    }

    // "Nenhuma legenda" shortcut: skip ZapCap entirely and append the source
    // video as a new version. Useful when the user just wants the video in
    // the versions list so they can apply Cortes/Headline without burning
    // captions first.
    if (zapTemplateId === '__none__') {
      const wasHookEdit = editZapModeRef.current === 'hook';
      const wasVslEdit = editZapModeRef.current === 'vsl';
      setZapState((prev) => ({
        ...prev,
        status: 'completed',
        step: 'Versão sem legenda criada.',
        progress: 100,
        originalVideoUrl: zapState.originalVideoUrl || zapVideoUrl,
        finalVideoUrl: zapVideoUrl,
        versions:
          wasHookEdit || wasVslEdit ? prev.versions : [...(prev.versions || []), zapVideoUrl],
      }));
      setConfig((prev) => {
        const key = wasVslEdit ? 'zapVslVersions' : wasHookEdit ? 'zapHookVersions' : 'zapVersions';
        const current = ((prev.edit as any)[key] as string[] | undefined) || [];
        return {
          ...prev,
          edit: {
            ...prev.edit,
            [key]: [...current, zapVideoUrl],
          },
        };
      });
      toast.success('Versão sem legenda salva na galeria.', {
        id: 'zap-simple-render',
        duration: 4000,
      });
      return;
    }

    isZapRenderingRef.current = true;
    setLoading(true);

    const originalUrl = zapState.originalVideoUrl || zapVideoUrl;
    setZapState((prev) => ({
      ...prev,
      status: 'rendering',
      step: 'Enviando para o ZapCap...',
      progress: 5,
      originalVideoUrl: originalUrl,
    }));

    try {
      toast.loading('Iniciando renderização...', { id: 'zap-simple-render' });

      // Look up the selected source video's aspect ratio so ZapCap renders
      // the output in the same shape. Otherwise its default template canvas
      // (9:16) pads non-9:16 sources with black bars, and percentage-based
      // subtitle positions ("60% from top") land on the black instead of
      // on the visible content.
      const selectedSourceVideo = (videos || []).find((v: any) => v.url === zapVideoUrl);
      const sourceAspect = selectedSourceVideo?.aspectRatio || '9:16';

      const payload: any = {
        videoUrl: zapVideoUrl,
        templateId: zapTemplateId,
        brollPercent: effectiveBrollPercent,
        language: zapLanguage,
        emoji: zapEmoji,
        animation: zapAnimation,
        emphasizeKeywords: zapEmphasizeKeywords,
        silenceRemoval: zapSilenceRemoval > 0 ? zapSilenceRemoval : undefined,
        // Novos parâmetros
        subtitleTop: zapSubtitleTop,
        fontUppercase: zapFontUppercase,
        fontSize: zapFontSize,
        displayWords: zapDisplayWords,
        // Aspect of the source video, forwarded to ZapCap so its output
        // canvas matches and the subtitles land on the visible frame.
        sourceAspectRatio: sourceAspect,
      };
      // Cor da fonte e da borda — sempre enviadas (defaults branco/preto).
      if (/^#[0-9a-fA-F]{6}$/.test(zapFontColor)) {
        payload.fontColor = zapFontColor;
      }
      if (/^#[0-9a-fA-F]{6}$/.test(zapStrokeColor)) {
        payload.strokeColor = zapStrokeColor;
      }
      // Cores de destaque — só envia se o usuário ativou customizadas.
      if (zapUseCustomHighlight) {
        payload.highlightColorOne = zapHl1;
        payload.highlightColorTwo = zapHl2;
        payload.highlightColorThree = zapHl3;
      }

      if (process.env.NODE_ENV !== 'production') {
        console.log('[ZAP SIMPLE PAYLOAD]', payload);
      }

      const response = await fetch('/api/zapcap/edit-simple', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Falha ao iniciar renderização');
      }

      const data = await response.json();
      const { videoId, taskId } = data;

      setZapState((prev) => ({
        ...prev,
        videoId,
        taskId,
        step: 'Processando legendas...',
        progress: 15,
      }));

      startZapSimplePolling(videoId, taskId);
    } catch (err: any) {
      console.error('[ZAP SIMPLE] failed:', err);
      const errorMsg = getErrorMessage(err);
      setZapState((prev) => ({ ...prev, status: 'error', step: errorMsg }));
      toast.error(`Erro: ${errorMsg}`, { id: 'zap-simple-render' });
      setLoading(false);
      isZapRenderingRef.current = false;
    }
  };

  const startZapSimplePolling = (videoId: string, taskId: string) => {
    if (zapPollRef.current) clearInterval(zapPollRef.current);

    let alreadyCompleted = false;
    // F6.1 — race condition fix. ANTES o check `if (alreadyCompleted) return`
    // estava só ANTES do fetch. Quando o backend demorava mais que o intervalo
    // de 3s (comum na fase final do ZapCap), vários requests in-flight
    // simultâneos retornavam "completed" ao mesmo tempo e cada um appendava
    // a downloadUrl no `versions` → 4 vídeos duplicados na galeria.
    // Agora: (1) `inFlight` previne fetches concorrentes; (2) re-check após
    // o fetch defende em profundidade.
    let inFlight = false;
    const startTime = Date.now();
    const TIMEOUT_MS = 10 * 60 * 1000;

    zapPollRef.current = setInterval(async () => {
      if (alreadyCompleted) return;
      if (inFlight) return;
      inFlight = true;

      try {
        if (Date.now() - startTime > TIMEOUT_MS) {
          isZapRenderingRef.current = false;
          clearInterval(zapPollRef.current!);
          zapPollRef.current = null;
          setZapState((prev) => ({
            ...prev,
            status: 'error',
            step: 'Tempo limite excedido (10 min)',
          }));
          toast.error('Tempo limite excedido', { id: 'zap-simple-render' });
          setLoading(false);
          return;
        }

        const userId = auth.currentUser?.uid || 'anonymous';
        const response = await fetch(`/api/zapcap/status/${videoId}/${taskId}?userId=${userId}`);
        const data = await response.json();
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[ZAP SIMPLE Poll] status=${data.status}`);
        }

        // F6.1 — defense in depth: o inFlight guard já previne concorrência,
        // mas se algo escapar (e.g. setInterval re-armado), esse re-check
        // garante que só 1 fetch "vence" o completion.
        if (alreadyCompleted) return;

        if (!response.ok) {
          const errorMsg = data.error || 'Erro no servidor (Polling)';
          setZapState((prev) => ({ ...prev, status: 'error', step: errorMsg }));
          toast.error(`Erro: ${errorMsg}`, { id: 'zap-simple-render' });
          isZapRenderingRef.current = false;
          clearInterval(zapPollRef.current!);
          zapPollRef.current = null;
          setLoading(false);
          return;
        }

        if (data.status === 'completed' && data.downloadUrl) {
          alreadyCompleted = true;
          isZapRenderingRef.current = false;
          clearInterval(zapPollRef.current!);
          zapPollRef.current = null;
          notifyIfHidden('Edição finalizada!', {
            body: 'Sua edição ZapCap está pronta.',
            tag: 'metavise-zapcap',
          });

          const wasHookEdit = editZapModeRef.current === 'hook';
          const wasVslEdit = editZapModeRef.current === 'vsl';
          setZapState((prev) => {
            // Only body versions live in zapState.versions (the in-memory
            // gallery state). Hook/VSL versions are read from config directly.
            const newVersions =
              wasHookEdit || wasVslEdit
                ? prev.versions
                : [...(prev.versions || []), data.downloadUrl];
            return {
              ...prev,
              status: 'completed',
              step: 'Edição finalizada!',
              progress: 100,
              finalVideoUrl: data.downloadUrl,
              versions: newVersions,
            };
          });

          // Mirror to config under the slot matching the mode that started
          // this render. Auto-save persists it across reloads.
          setConfig((prev) => {
            const key = wasVslEdit ? 'zapVslVersions' : wasHookEdit ? 'zapHookVersions' : 'zapVersions';
            const current = ((prev.edit as any)[key] as string[] | undefined) || [];
            return {
              ...prev,
              edit: {
                ...prev.edit,
                [key]: [...current, data.downloadUrl],
              },
            };
          });

          // Reset the auto-retry guard so the NEXT user-initiated render
          // can also auto-retry if it hits the same b-roll failure.
          zapAutoRetryRef.current = false;
          const userPct = zapBrollPercent ?? 0;
          const usedPct = zapEffectiveBrollRef.current;
          const reduced = usedPct < userPct;
          toast.success(
            usedPct === 0 && userPct > 0
              ? 'Vídeo editado (só legendas — o ZapCap não conseguiu inserir b-rolls neste vídeo).'
              : reduced
                ? `Vídeo editado com ${usedPct}% de b-roll (reduzi de ${userPct}% pro render do ZapCap aguentar).`
                : 'Vídeo editado com sucesso!',
            { id: 'zap-simple-render' }
          );
          setLoading(false);
        } else if (data.status === 'failed' || data.status === 'error') {
          isZapRenderingRef.current = false;
          clearInterval(zapPollRef.current!);
          zapPollRef.current = null;

          // Degradação suave: o render do ZapCap falha quando há muitos b-rolls
          // num vídeo longo. Em vez de cair DIRETO pra zero b-roll (o que te
          // deixava "sem edição"), baixamos o % aos poucos (80→60→40→20) e
          // ficamos com o MÁXIMO de b-rolls que o render aguenta. Só vai a 0
          // (só legendas) se nem 20% passar — assim você nunca fica sem vídeo.
          const failedPct = zapEffectiveBrollRef.current;
          if (failedPct > 0) {
            const next = failedPct > 20 ? Math.max(20, failedPct - 20) : 0;
            zapAutoRetryRef.current = true;
            console.warn(
              `[ZAP SIMPLE] Render falhou com b-roll ${failedPct}%. Tentando com ${next}%...`
            );
            toast.loading(
              next > 0
                ? `B-roll ${failedPct}% pesado demais pro ZapCap — tentando com ${next}%...`
                : 'B-rolls não couberam neste vídeo — gerando só com legendas...',
              { id: 'zap-simple-render', duration: 8000 }
            );
            // Re-entra no mesmo fluxo com o % reduzido. handleRenderZapSimple
            // re-arma o poll e o isZapRenderingRef.
            handleRenderZapSimple(next);
            return;
          }

          // Either no b-rolls were requested or the retry also failed.
          // Surface the ZapCap task ID + actionable next steps.
          zapAutoRetryRef.current = false;
          const baseMsg = data.error || 'Falha no ZapCap';
          const fullMsg = taskId
            ? `${baseMsg}\n\nTask ID (para suporte ZapCap): ${taskId}\n\nDicas: tente outro template, simplifique as opções (sem emoji/animação) ou aguarde uns minutos e tente novamente.`
            : baseMsg;
          setZapState((prev) => ({ ...prev, status: 'error', step: fullMsg }));
          toast.error(`Falha do ZapCap: ${baseMsg}`, {
            id: 'zap-simple-render',
            duration: 6000,
          });
          setLoading(false);
        } else {
          let stepText = 'Renderizando vídeo final...';
          let baseProgress = 50;
          if (data.status === 'processing' || data.status === 'transcribing') {
            stepText = 'Transcrevendo e processando...';
            baseProgress = 30;
          } else if (data.status === 'rendering') {
            stepText = 'Aplicando legendas e b-rolls...';
            baseProgress = 70;
          } else if (data.status === 'queued') {
            stepText = 'Na fila de espera...';
            baseProgress = 10;
          }
          setZapState((prev) => ({ ...prev, step: stepText, progress: baseProgress }));
        }
      } catch (err: any) {
        console.error('[ZAP SIMPLE Poll] error:', err);
      } finally {
        // F6.1 — libera o lock pra próxima tick poder fazer fetch.
        // Crítico: se essa linha falhar, todo o polling trava.
        inFlight = false;
      }
    }, 3000);
  };

  const handleRenderHeadline = async () => {
    if (!headlineSourceUrl) return;
    if (!user?.uid) {
      toast.error('Faça login antes de aplicar headline.');
      return;
    }
    const text = headlineText.trim();
    if (!text) {
      toast.error('Digite o texto da headline.');
      return;
    }

    setHeadlineRendering(true);
    const toastId = 'headline-render';
    // Auto-sync needs to transcribe via AssemblyAI which can take 30-90s on
    // top of the FFmpeg render, so bump the toast duration when it's on.
    toast.loading(
      headlineAutoTime
        ? 'Transcrevendo áudio e aplicando headlines sincronizadas...'
        : 'Aplicando headline no topo do vídeo...',
      {
        id: toastId,
        duration: headlineAutoTime ? 180000 : 60000,
      }
    );
    try {
      // Build the headlines array. Trim each headline's wordStyles to its
      // actual word count in case the user edited the text after assigning
      // colors.
      const trimWs = (
        t: string,
        ws: Array<{ tc: number; bg: number }>
      ): Array<{ tc: number; bg: number }> => {
        const count = t.split(/\s+/).filter(Boolean).length;
        return ws.slice(0, count).map((s) => ({ tc: s.tc || 0, bg: s.bg || 0 }));
      };
      const headlinesPayload: Array<{
        text: string;
        wordStyles: Array<{ tc: number; bg: number }>;
        bgColor: string;
      }> = [
        {
          text,
          wordStyles: trimWs(text, headlineWordStyles),
          bgColor: headlineBgColor,
        },
      ];
      if (headline2Enabled && headline2Text.trim()) {
        headlinesPayload.push({
          text: headline2Text.trim(),
          wordStyles: trimWs(headline2Text, headline2WordStyles),
          bgColor: headline2BgColor,
        });
      }

      const res = await fetch('/api/video/add-headline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: headlineSourceUrl,
          userId: user.uid,
          // Top-level palette + globals shared by both headlines.
          bgColor: headlineBgColor,
          textColor: headlineTextColor,
          strokeColor: headlineStrokeColor,
          strokeWidth: headlineStrokeWidth,
          highlightColor1: headlineHl1,
          highlightColor2: headlineHl2,
          highlightColor3: headlineHl3,
          bgHighlight1: headlineBgHl1,
          bgHighlight2: headlineBgHl2,
          bgHighlight3: headlineBgHl3,
          fontSize: headlineFontSize,
          barHeightPct: headlineBarHeightPct,
          // Multi-headline shape: array of per-headline content.
          headlines: headlinesPayload,
          switchPct: headlineSwitchPct,
          autoTime: headlineAutoTime,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

      const newUrl: string = json.url;
      // Headline is hook-only, so always append to zapHookVersions.
      setConfig((prev) => {
        const current = ((prev.edit as any).zapHookVersions as string[] | undefined) || [];
        return {
          ...prev,
          edit: {
            ...prev.edit,
            zapHookVersions: [...current, newUrl],
          },
        };
      });
      // Surface what the backend actually did with auto-sync so the user
      // knows whether to trust the timing or to adjust manually.
      const autoStatus = json.autoTimeStatus as
        | 'off'
        | 'applied'
        | 'failed'
        | 'partial'
        | undefined;
      let successMsg = 'Headline aplicada — nova versão criada.';
      if (autoStatus === 'applied') {
        successMsg = '✅ Headlines sincronizadas com a fala do avatar.';
      } else if (autoStatus === 'partial') {
        successMsg =
          '⚠ Sincronização parcial — uma das headlines não foi achada na fala (caiu no timing manual).';
      } else if (autoStatus === 'failed' && headlineAutoTime) {
        successMsg =
          '⚠ Não consegui transcrever o áudio — voltei pro timing manual. Verifique o texto vs a fala do avatar.';
      }
      toast.success(successMsg, {
        id: toastId,
        duration: autoStatus === 'applied' ? 5000 : 8000,
      });
      setHeadlineSourceUrl(null);
    } catch (err: any) {
      console.error('[HEADLINE] error:', err);
      toast.error(`Falha na headline: ${err.message}`, {
        id: toastId,
        duration: 6000,
      });
    } finally {
      setHeadlineRendering(false);
    }
  };

  /** F6.5 — IntercutModal redesenhado entrega insertions[] (modo manual)
   *  com texto, words[] e posição por inserção. O backend renderiza tela
   *  preta com karaoke (palavra falada destacada) em cada momento. */
  const handleRenderIntercut = async (
    insertions: Array<{
      id: string;
      atSec: number;
      durationSec: number;
      text: string;
      position: 'top' | 'middle' | 'bottom';
      words: Array<{ text: string; offsetMs: number; durationMs: number }>;
    }>,
    // F6.11/F6.12/F6.15 — settings global passados pelo modal: palavras por linha,
    // threshold de fusão de cortes, uppercase toggle, cor base do texto,
    // cor de destaque, modo de destaque da palavra falada.
    settings?: {
      wordsPerLine?: number;
      mergeThresholdSec?: number;
      uppercase?: boolean;
      textColor?: string;
      highlightColor?: string;
      highlightMode?: 'text' | 'background' | 'rectangle' | 'both' | 'none';
      popAnimation?: boolean;
      outlineColor?: string;
      fontFamily?: string;
      background?: 'black' | 'space' | 'gradient';
    }
  ) => {
    if (!intercutSourceUrl) return;
    if (!user?.uid) {
      toast.error('Faça login antes de gerar cortes pretos.');
      return;
    }
    if (!Array.isArray(insertions) || insertions.length === 0) {
      toast.error('Adicione pelo menos uma frase pra inserir como tela preta.');
      return;
    }

    setIntercutRendering(true);
    const toastId = 'intercut-render';
    toast.loading('Gerando cortes pretos com texto...', { id: toastId, duration: 60000 });

    try {
      const res = await fetch('/api/video/intercut', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: intercutSourceUrl,
          fontSize: intercutFontSize,
          userId: user.uid,
          // F6.11/F6.12/F6.15 — passa settings globais. Backend usa defaults se omitidos.
          wordsPerLine: settings?.wordsPerLine ?? 4,
          mergeThresholdSec: settings?.mergeThresholdSec ?? 0.5,
          uppercase: settings?.uppercase ?? true,
          // F6.18 — fonte agora vem do modal (default Impact pra compat).
          fontFamily: settings?.fontFamily ?? 'Impact',
          // F6.15 — cor base do texto + modo de destaque (global). Cor de
          // destaque vai por insertion abaixo pra permitir variar no futuro.
          textColor: settings?.textColor ?? '#FFFFFF',
          highlightMode: settings?.highlightMode ?? 'text',
          // F6.16 — animação pop do retângulo (default off)
          popAnimation: settings?.popAnimation === true,
          // F6.17 — cor da borda das letras
          outlineColor: settings?.outlineColor ?? '#000000',
          // F6.19 — fundo do segmento
          background: settings?.background ?? 'black',
          // F6.5 — novo formato manual. Backend detecta insertions[] presente
          // e usa o modo "manual insertion" (alternativa: cadência legada).
          insertions: insertions.map((ins) => ({
            atSec: ins.atSec,
            durationSec: ins.durationSec,
            text: ins.text,
            position: ins.position,
            words: ins.words,
            highlightColor: settings?.highlightColor ?? '#9333EA',
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      const newUrl: string = data.url;
      const isHookEdit = editZapModeRef.current === 'hook';
      setZapState((prev) => ({
        ...prev,
        versions: isHookEdit ? prev.versions : [...(prev.versions || []), newUrl],
        finalVideoUrl: newUrl,
      }));
      setConfig((prev) => {
        const key = isHookEdit ? 'zapHookVersions' : 'zapVersions';
        const current = ((prev.edit as any)[key] as string[] | undefined) || [];
        return {
          ...prev,
          edit: {
            ...prev.edit,
            [key]: [...current, newUrl],
          },
        };
      });
      toast.success(
        `Vídeo com ${data.blackCount ?? insertions.length} corte${(data.blackCount ?? insertions.length) === 1 ? '' : 's'} preto${(data.blackCount ?? insertions.length) === 1 ? '' : 's'} criado.`,
        { id: toastId, duration: 5000 }
      );
      setIntercutSourceUrl(null);
    } catch (err: any) {
      console.error('[INTERCUT] error:', err);
      toast.error(`Falha ao gerar cortes pretos: ${err.message}`, {
        id: toastId,
        duration: 6000,
      });
    } finally {
      setIntercutRendering(false);
    }
  };

  const handleRenderZapCap = async () => {
    if (process.env.NODE_ENV !== 'production')
      console.log('[RENDER DEBUG] Clicked. State at click time:', {
        isRendering: isRenderingRef.current,
        videoUrl: videoUrl?.substring(0, 60),
        templateId: zapCapRenderConfig.templateId,
        animation: zapCapRenderConfig.animation,
        emoji: zapCapRenderConfig.emoji,
        versionsCount: autoEditState.versions?.length || 0,
        autoEditStatus: autoEditState.status,
      });
    if (isRenderingRef.current) {
      console.warn('[RENDER DEBUG] Blocked: already rendering');
      return;
    }
    if (!videoUrl || !zapCapRenderConfig.templateId) {
      console.warn('[RENDER DEBUG] Blocked: missing videoUrl or templateId');
      toast.error('Selecione um template para continuar.');
      return;
    }

    if ((autoEditState.versions?.length || 0) >= 3) {
      toast.error('Limite de 3 versões atingido.');
      return;
    }

    isRenderingRef.current = true;
    setLoading(true);
    // Salvar URL original se for a primeira tentativa
    const originalUrl = autoEditState.originalVideoUrl || videoUrl;

    setAutoEditState((prev) => ({
      ...prev,
      status: 'rendering',
      step: 'Enviando para o ZapCap...',
      progress: 5,
      originalVideoUrl: originalUrl,
    }));

    try {
      toast.loading('Iniciando renderização...', { id: 'zapcap-render' });

      console.log('[RENDER] brollPercent sendo enviado:', brollPercent);

      const { transcript, byotTranscript, words, ...cleanConfig } = zapCapRenderConfig as any;
      const payload = {
        videoUrl,
        transcriptId: autoEditState.analysis?.transcriptId,
        selectedBrollIds: autoEditState.selectedBrollIds || [],
        brollCandidates: autoEditState.brollCandidates || [],
        config: {
          ...cleanConfig,
          brollPercent: brollPercent,
          renderOptions: {
            subsOptions: {
              emoji: zapCapRenderConfig.emoji,
              emojiAnimation: zapCapRenderConfig.emoji,
              animation: zapCapRenderConfig.animation,
            },
            styleOptions: {
              fontSize: 46,
              fontWeight: 800,
              fontShadow: 'm',
              stroke: 's',
              strokeColor: '#000000',
            },
          },
        },
      };

      if (process.env.NODE_ENV !== 'production') {
        console.log('[RENDER PAYLOAD] campos enviados:', Object.keys(payload));
        console.log('[RENDER PAYLOAD] config keys:', Object.keys(payload.config));
      }

      const response = await fetch('/api/zapcap/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Falha ao iniciar renderização');
      }

      const data = await response.json();
      const { videoId, taskId } = data;

      setAutoEditState((prev) => ({
        ...prev,
        status: 'rendering',
        step: 'Processando legendas...',
        videoId,
        taskId,
        progress: 15,
      }));

      startZapCapPolling(videoId, taskId);
    } catch (err: any) {
      console.error('ZapCap render failed:', err);
      const errorMsg = getErrorMessage(err);
      setAutoEditState((prev) => ({
        ...prev,
        status: 'error',
        step: errorMsg,
      }));
      toast.error(`Erro: ${errorMsg}`, { id: 'zapcap-render' });
      setLoading(false);
      isRenderingRef.current = false; // libera o lock SÓ em caso de erro
    }
    // NOTA: em caso de sucesso, o lock isRenderingRef.current = false é liberado
    // pelo startZapCapPolling quando a renderização termina (success ou timeout)
  };

  const startZapCapPolling = (videoId: string, taskId: string) => {
    if (zapcapPollRef.current) clearInterval(zapcapPollRef.current);

    let alreadyCompleted = false;
    // F6.1 — mesmo race condition fix do startZapSimplePolling. Sem o inFlight
    // guard, requests in-flight concorrentes na fase final do ZapCap appendam
    // a downloadUrl 4× no autoEditState.versions.
    let inFlight = false;

    const startTime = Date.now();
    const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutos

    zapcapPollRef.current = setInterval(async () => {
      if (alreadyCompleted) return;
      if (inFlight) return;
      inFlight = true;

      try {
        // Verificar Timeout
        if (Date.now() - startTime > TIMEOUT_MS) {
          isRenderingRef.current = false;
          clearInterval(zapcapPollRef.current!);
          zapcapPollRef.current = null;
          setAutoEditState((prev) => ({
            ...prev,
            status: 'error',
            step: 'Tempo limite excedido (10 min)',
          }));
          toast.error('Tempo limite excedido', { id: 'zapcap-render' });
          setLoading(false);
          return;
        }

        const userId = auth.currentUser?.uid || 'anonymous';
        const response = await fetch(`/api/zapcap/status/${videoId}/${taskId}?userId=${userId}`);
        const data = await response.json();
        console.log(
          `[Poll] videoId=${videoId} taskId=${taskId} status=${data.status} ok=${response.ok}`
        );

        // F6.1 — defense in depth após o fetch (caso o inFlight escape).
        if (alreadyCompleted) return;

        if (!response.ok) {
          console.error(`[Poll] Erro no polling:`, data);
          const errorMsg = data.error || 'Erro no servidor (Polling)';
          setAutoEditState((prev) => ({
            ...prev,
            status: 'error',
            step: errorMsg,
          }));
          toast.error(`Erro no Status: ${errorMsg}`, { id: 'zapcap-render' });
          isRenderingRef.current = false;
          clearInterval(zapcapPollRef.current!);
          zapcapPollRef.current = null;
          setLoading(false);
          return;
        }

        const status = data.status;

        if (status === 'completed' && data.downloadUrl) {
          alreadyCompleted = true;
          isRenderingRef.current = false;
          clearInterval(zapcapPollRef.current!);
          zapcapPollRef.current = null;

          setVideoUrl(data.downloadUrl);
          setAutoEditState((prev) => {
            const newVersions = [...(prev.versions || []), data.downloadUrl];
            return {
              ...prev,
              status: 'completed',
              step: 'Edição finalizada!',
              progress: 100,
              finalVideoUrl: data.downloadUrl,
              versions: newVersions,
            };
          });

          toast.success('Vídeo editado com sucesso!', { id: 'zapcap-render' });
          setLoading(false);
        } else if (status === 'failed' || status === 'error') {
          isRenderingRef.current = false;
          clearInterval(zapcapPollRef.current!);
          zapcapPollRef.current = null;
          const errorMsg = getErrorMessage(data.error || 'Falha no processamento do ZapCap');
          setAutoEditState((prev) => ({
            ...prev,
            status: 'error',
            step: errorMsg,
          }));
          toast.error(`Falha: ${errorMsg}`, { id: 'zapcap-render' });
          setLoading(false);
        } else {
          // Mapear status para progresso e texto
          let stepText = 'Renderizando vídeo final...';
          let baseProgress = 50;

          if (status === 'processing' || status === 'transcribing') {
            stepText = 'Processando legendas...';
            baseProgress = 20;
          } else if (status === 'rendering') {
            stepText = 'Renderizando vídeo final...';
            baseProgress = 60;
          } else if (status === 'queued') {
            stepText = 'Na fila de espera...';
            baseProgress = 10;
          }

          setAutoEditState((prev) => ({
            ...prev,
            step: stepText,
            progress: Math.min(baseProgress + Math.random() * 5, 98),
          }));
        }
      } catch (err: any) {
        if (err.message && err.message.includes('Failed to fetch')) {
          // Ignore network errors (like load balancer timeouts or momentary drops)
        } else {
          console.error('Polling error:', err);
        }
      } finally {
        // F6.1 — libera o lock pra próxima tick poder fazer fetch.
        inFlight = false;
      }
    }, 5000);
  };

  const toggleBrollSelection = (id: string) => {
    setAutoEditState((prev) => {
      const current = prev.selectedBrollIds || [];
      if (current.includes(id)) {
        return { ...prev, selectedBrollIds: current.filter((i) => i !== id) };
      }
      return { ...prev, selectedBrollIds: [...current, id] };
    });
  };

  const handleApproveAndDownload = async (url: string) => {
    try {
      toast.loading('Iniciando download...', { id: 'download' });
      const res = await fetch(url);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `video_renderizado_v${autoEditState.versions?.length || 1}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success('Download iniciado!', { id: 'download' });
    } catch (err) {
      toast.error('Erro ao baixar vídeo.', { id: 'download' });
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (authMode === 'signup') {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      console.error('Email Auth Error:', err);
      let msg = 'Erro na autenticação.';
      if (err.code === 'auth/email-already-in-use') msg = 'Este e-mail já está em uso.';
      if (err.code === 'auth/invalid-email') msg = 'E-mail inválido.';
      if (err.code === 'auth/weak-password') msg = 'Senha muito fraca.';
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password')
        msg = 'E-mail ou senha incorretos.';
      if (err.code === 'auth/operation-not-allowed')
        msg = 'O login por e-mail/senha não está habilitado no Console do Firebase.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error('Login Error:', err);
      setError('Falha ao entrar com Google.');
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error('Logout Error:', err);
    }
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-[#F8F9FB] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#F8F9FB] flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-white p-10 rounded-[40px] shadow-2xl border-4 border-blue-50 text-center space-y-6">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center text-white mx-auto shadow-xl shadow-blue-100">
            <Video size={32} />
          </div>
          <div className="space-y-1">
            <h1 className="text-3xl font-black text-gray-900 tracking-tight uppercase">Metavise</h1>
            <p className="text-sm text-gray-500 font-medium">
              {authMode === 'login' ? 'Entre na sua conta' : 'Crie sua conta gratuita'}
            </p>
          </div>

          <form onSubmit={handleEmailAuth} className="space-y-4 text-left">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">
                E-mail
              </label>
              <input
                type="email"
                required
                value={email || ''}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all outline-none text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">
                Senha
              </label>
              <input
                type="password"
                required
                value={password || ''}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all outline-none text-sm"
              />
            </div>

            {error && (
              <p className="text-xs text-red-500 font-bold text-center bg-red-50 p-2 rounded-lg border border-red-100">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="animate-spin" size={20} />
              ) : authMode === 'login' ? (
                'Entrar'
              ) : (
                'Cadastrar'
              )}
            </button>
          </form>

          <div className="relative py-2">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-100"></div>
            </div>
            <div className="relative flex justify-center text-[10px] uppercase font-bold text-gray-300 bg-white px-4">
              Ou continue com
            </div>
          </div>

          <button
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-3 bg-white border-2 border-gray-100 text-gray-700 py-4 rounded-2xl font-bold hover:bg-gray-50 transition-all hover:scale-[1.01] active:scale-[0.99]"
          >
            <img
              src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
              className="w-5 h-5"
            />
            Google
          </button>

          <p className="text-xs text-gray-500">
            {authMode === 'login' ? 'Não tem uma conta?' : 'Já tem uma conta?'}
            <button
              onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}
              className="ml-1 text-blue-600 font-bold hover:underline"
            >
              {authMode === 'login' ? 'Cadastre-se' : 'Faça Login'}
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen app-shell text-gray-900 dark:text-gray-100 font-sans selection:bg-blue-100 dark:selection:bg-blue-900 overflow-x-hidden">
      {/* Header. Frosted-glass: semi-transparent + backdrop blur so
          the app-shell gradient bleeds through subtly. Industry-standard
          modern SaaS pattern (Stripe, Linear, Vercel, Raycast). */}
      <header className="bg-white/75 dark:bg-gray-900/60 backdrop-blur-xl border-b border-gray-200/60 dark:border-gray-800/60 sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-4 h-20 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 via-blue-600 to-blue-700 rounded-xl flex items-center justify-center shadow-xl shadow-blue-200/60 dark:shadow-blue-900/30 ring-1 ring-inset ring-white/20">
              <Sparkles className="text-white drop-shadow-sm" size={22} />
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tight text-gray-900 dark:text-white">
                METAVISE
              </h1>
              <p className="text-[10px] font-bold text-blue-600 dark:text-blue-400 tracking-[0.2em] uppercase">
                Criador de Anúncios
              </p>
            </div>
          </div>

          {currentProjectId && (
            <div className="hidden lg:flex items-center gap-3 flex-shrink-0">
              {/* Active project chip. Subtle gradient, softer ring,
                  small dot indicator that the project is live. */}
              <div className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-br from-gray-50 to-gray-100/60 dark:from-gray-800/80 dark:to-gray-800/40 rounded-xl ring-1 ring-gray-200/60 dark:ring-gray-700/60">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-sm shadow-green-500/40 animate-pulse" />
                <Folder size={13} className="text-gray-400 dark:text-gray-500" />
                <span className="text-[10px] font-black text-gray-600 dark:text-gray-300 uppercase tracking-widest truncate max-w-[140px]">
                  {projects.find((p) => p.id === currentProjectId)?.name || 'Projeto Ativo'}
                </span>
              </div>
              {/* AutoSaveIndicator removido — ocupava espaço da wizard nav
                  e o auto-save agora é silencioso (sem toast a cada mudança).
                  Estados isSaving/hasUnsavedCopyChanges/lastSavedAt continuam
                  populados internamente caso a gente queira readicionar. */}
            </div>
          )}

          {/* Wizard nav. Refined styling — same behavior as before.
              Active step uses a subtle white-to-blue gradient with a
              ring for stronger pop. Skipped state is line-through.
              Container has softer borders and an inner shadow.

              Overflow strategy (fix pra screen-overflow + área branca):
              - flex-1 + min-w-0 → encolhe quando não cabe (não empurra resto)
              - overflow-x-auto + scrollbar-hide → scroll interno se precisar
              - data-step-id no botão + useEffect fora → aba ativa rola pra view
              - flex-shrink-0 nos botões → cada um mantém tamanho próprio
              Resultado: página nunca scrolla horizontal; só a nav scrolla
              internamente, e a aba atual sempre fica visível. */}
          {/* Wrapper que segura os chevrons + a nav rolável. min-w-0 deixa
              encolher; gap-1 dá um respiro pequeno entre seta e container. */}
          <div className="hidden md:flex min-w-0 items-center gap-1">
            {/* Seta esquerda — só aparece quando há overflow pra esquerda.
                tabindex=-1 + aria-hidden quando inativa pra não poluir tab
                navigation. */}
            <button
              type="button"
              onClick={() => scrollNavBy('left')}
              aria-label="Rolar abas para esquerda"
              tabIndex={navScrollState.canLeft ? 0 : -1}
              aria-hidden={!navScrollState.canLeft}
              // UX21: maior (w-10 h-10), mais contraste (blue tint),
              // sem transição lenta de opacidade — toggle instantâneo.
              className={`flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-xl bg-blue-600 dark:bg-blue-500 text-white ring-1 ring-blue-700/40 dark:ring-blue-400/40 hover:bg-blue-700 dark:hover:bg-blue-600 shadow-sm ${
                navScrollState.canLeft
                  ? 'opacity-100 pointer-events-auto'
                  : 'opacity-0 pointer-events-none'
              }`}
            >
              <ChevronLeft size={20} strokeWidth={2.5} />
            </button>
            <div
              ref={wizardNavRef}
              className="min-w-0 flex items-center gap-0.5 bg-gray-100/70 dark:bg-gray-800/60 p-1 rounded-2xl border border-gray-200/60 dark:border-gray-700/60 shadow-inner shadow-gray-200/30 dark:shadow-black/20 overflow-x-auto scrollbar-hide"
            >
              {STEPS.map((step, idx) => {
                const Icon = step.icon;
                const isActive = currentStep === step.id;
                const isSkipped = !useHookFlow && step.id === 'hook-visual';

                return (
                  <div key={step.id} className="flex items-center flex-shrink-0">
                    <button
                      data-step-id={step.id}
                      onClick={() => {
                        if (canNavigateTo(step.id)) {
                          requestStepChange(step.id);
                        }
                      }}
                      onMouseEnter={() => {
                        // Pre-fetch lazy chunks on hover so the navigation
                        // click feels instant. No-op for non-lazy steps.
                        if (step.id === 'source') void import('./pages/SourceTab');
                        else if (step.id === 'plan') void import('./pages/PlanTab');
                      }}
                      className={`flex items-center gap-2 px-3.5 py-2 rounded-xl transition-all duration-150 ${
                        isActive
                          ? 'bg-white text-blue-600 shadow-sm ring-1 ring-blue-100/80 dark:bg-gray-900 dark:text-blue-300 dark:ring-blue-900/60'
                          : isSkipped
                            ? 'text-gray-400/70 dark:text-gray-600 line-through hover:text-gray-500 dark:hover:text-gray-400'
                            : 'text-gray-500 hover:text-gray-800 hover:bg-white/60 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700/40'
                      }`}
                      title={isSkipped ? 'Gancho pulado — clique pra reativar' : undefined}
                    >
                      <Icon size={16} />
                      <span className="text-sm font-bold whitespace-nowrap">
                        {step.label}
                        {isSkipped && (
                          <span className="ml-1 text-[9px] font-black uppercase tracking-widest opacity-70 no-underline">
                            · pulado
                          </span>
                        )}
                      </span>
                    </button>
                    {idx < STEPS.length - 1 && (
                      <ChevronRight
                        size={12}
                        className="text-gray-300/70 dark:text-gray-600 mx-0.5"
                      />
                    )}
                  </div>
                );
              })}
            </div>
            {/* Seta direita — mirror da esquerda. Mostra quando ainda há
                abas escondidas além do viewport. */}
            <button
              type="button"
              onClick={() => scrollNavBy('right')}
              aria-label="Rolar abas para direita"
              tabIndex={navScrollState.canRight ? 0 : -1}
              aria-hidden={!navScrollState.canRight}
              // UX21: mirror da esquerda — maior, mais contraste, instant toggle
              className={`flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-xl bg-blue-600 dark:bg-blue-500 text-white ring-1 ring-blue-700/40 dark:ring-blue-400/40 hover:bg-blue-700 dark:hover:bg-blue-600 shadow-sm ${
                navScrollState.canRight
                  ? 'opacity-100 pointer-events-auto'
                  : 'opacity-0 pointer-events-none'
              }`}
            >
              <ChevronRight size={20} strokeWidth={2.5} />
            </button>
          </div>

          <div className="flex items-center gap-4 flex-shrink-0">
            {/* Credits chip. F7.6 — agora clicável: clique abre prompt pra
                adicionar créditos rapidamente (dev convenience). Em produção
                isso deve virar fluxo de pagamento real. */}
            <button
              onClick={async () => {
                const raw = window.prompt('Quantos créditos adicionar?', '10000');
                if (!raw) return;
                const amount = Math.max(1, Math.min(100000, parseInt(raw, 10) || 0));
                if (!amount) return;
                try {
                  const { authedFetch } = await import('@/lib/authedFetch');
                  const res = await authedFetch('/api/user/credits/grant', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ amount }),
                  });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
                  setCredits(data.newBalance);
                  toast.success(`+${data.granted} créditos! Saldo: ${data.newBalance}`);
                } catch (err: any) {
                  toast.error(`Falha: ${err.message}`);
                }
              }}
              className="hidden sm:flex items-center gap-2 px-3.5 py-2 bg-gradient-to-br from-blue-50 to-blue-100/60 dark:from-blue-950/40 dark:to-blue-900/30 rounded-xl ring-1 ring-blue-200/60 dark:ring-blue-800/60 shadow-sm shadow-blue-200/30 dark:shadow-blue-900/20 hover:ring-blue-400 transition-all"
              title="Clique pra adicionar créditos (dev)"
            >
              <Sparkles className="text-blue-600 dark:text-blue-400" size={15} />
              <span className="text-sm font-black text-blue-700 dark:text-blue-300 tabular-nums">
                {credits}
              </span>
              <span className="text-[10px] font-bold text-blue-500/70 dark:text-blue-500 uppercase tracking-widest">
                Créditos
              </span>
            </button>
            {apiSpend &&
              (() => {
                const hasBalance = apiSpend.balanceBase != null && apiSpend.availableUSD != null;
                const avail = apiSpend.availableUSD ?? 0;
                // Cor por faixa de saldo: verde ok, âmbar baixo, vermelho crítico.
                const tone = !hasBalance
                  ? 'gray'
                  : avail <= 1
                    ? 'red'
                    : avail <= 5
                      ? 'amber'
                      : 'emerald';
                const toneCls: Record<string, string> = {
                  emerald:
                    'from-emerald-50 to-emerald-100/60 dark:from-emerald-950/40 dark:to-emerald-900/30 ring-emerald-200/60 dark:ring-emerald-800/60 text-emerald-700 dark:text-emerald-300',
                  amber:
                    'from-amber-50 to-amber-100/60 dark:from-amber-950/40 dark:to-amber-900/30 ring-amber-200/60 dark:ring-amber-800/60 text-amber-700 dark:text-amber-300',
                  red: 'from-red-50 to-red-100/60 dark:from-red-950/40 dark:to-red-900/30 ring-red-200/60 dark:ring-red-800/60 text-red-700 dark:text-red-300',
                  gray: 'from-gray-50 to-gray-100/60 dark:from-gray-900/40 dark:to-gray-800/30 ring-gray-200/60 dark:ring-gray-800/60 text-gray-600 dark:text-gray-300',
                };
                return (
                  <button
                    onClick={promptSetApiBalance}
                    className={`hidden sm:flex items-center gap-2 px-3.5 py-2 bg-gradient-to-br rounded-xl ring-1 shadow-sm hover:brightness-105 transition-all ${toneCls[tone]}`}
                    title={
                      hasBalance
                        ? `Saldo estimado da conta Anthropic.\nSaldo informado: US$ ${apiSpend.balanceBase!.toFixed(2)}\nGasto desde então: US$ ${(apiSpend.balanceBase! - avail).toFixed(4)}\nGasto total medido: US$ ${apiSpend.costUSD.toFixed(4)}\n\nA Anthropic não expõe o saldo — clique pra atualizar após adicionar fundos.`
                        : 'A Anthropic não expõe o saldo por chave. Clique e informe seu saldo atual (console.anthropic.com) — o app desconta o gasto daí pra frente.'
                    }
                  >
                    <span className="text-sm font-black tabular-nums">
                      {hasBalance ? `US$ ${avail.toFixed(2)}` : 'Definir saldo'}
                    </span>
                    {hasBalance && (
                      <span className="text-[10px] font-bold opacity-70 uppercase tracking-widest">
                        Saldo API
                      </span>
                    )}
                  </button>
                );
              })()}
            <RecentProjectsButton
              projects={projects}
              currentProjectId={currentProjectId}
              onPick={(p) => handleLoadProject(p)}
            />
            <DarkModeToggle isDark={isDark} onToggle={toggleDarkMode} />
            <button
              onClick={() => setCurrentStep('integrations')}
              className={`p-2 transition-colors ${
                currentStep === 'integrations'
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-500 dark:hover:text-gray-300'
              }`}
              title="Configurações"
              aria-label="Configurações"
            >
              <Settings size={20} />
            </button>
            <button
              onClick={handleLogout}
              className="p-2 text-gray-400 hover:text-red-500 dark:hover:text-gray-500 dark:hover:text-red-400 transition-colors"
              title="Sair"
            >
              <LogOut size={20} />
            </button>
            <button className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 md:hidden">
              <Layout size={24} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1600px] mx-auto px-4 py-12">
        {!isOnline && (
          <div className="mb-6 p-4 bg-red-50/80 dark:bg-red-950/30 ring-1 ring-red-200/60 dark:ring-red-900/40 rounded-2xl flex items-center gap-3 text-red-700 dark:text-red-300 font-bold text-sm">
            <div className="w-2 h-2 bg-red-500 dark:bg-red-400 rounded-full animate-pulse shadow shadow-red-500/50" />
            Você está offline. Verifique sua conexão.
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 bg-red-50/80 dark:bg-red-950/30 ring-1 ring-red-200/60 dark:ring-red-900/40 rounded-2xl flex items-center justify-between gap-3 text-red-700 dark:text-red-300 text-sm">
            <span className="font-medium">{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-red-400 dark:text-red-500 hover:text-red-600 dark:hover:text-red-300 transition-colors"
              aria-label="Fechar"
            >
              ✕
            </button>
          </div>
        )}

        {providerError && (
          <div className="mb-6 p-4 bg-amber-50/80 dark:bg-amber-950/30 ring-1 ring-amber-200/60 dark:ring-amber-900/40 rounded-2xl flex items-center justify-between gap-3 text-amber-800 dark:text-amber-300 text-sm shadow-sm">
            <div className="flex items-center gap-3">
              <div className="px-2 py-0.5 bg-amber-200 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200 rounded-md text-[10px] font-black uppercase tracking-widest">
                {providerError.provider} Error
              </div>
              <span className="font-medium">{providerError.message}</span>
            </div>
            <button
              onClick={() => setProviderError(null)}
              className="text-amber-500 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-200 transition-colors"
              aria-label="Fechar"
            >
              ✕
            </button>
          </div>
        )}

        {/* Step header: title + slim progress bar. Replaces the
            previous "Passo X de Y" plain text — same info, more
            visual hierarchy. Counter sits to the right of the bar. */}
        <div className="mb-12 max-w-2xl mx-auto">
          <h2 className="text-3xl font-black text-gray-900 dark:text-gray-50 tracking-tight text-center mb-5">
            {STEPS.find((s) => s.id === currentStep)?.label}
          </h2>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 bg-gray-200/70 dark:bg-gray-800/80 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-[width] duration-500 ease-out"
                style={{
                  width: `${
                    ((STEPS.findIndex((s) => s.id === currentStep) + 1) / STEPS.length) * 100
                  }%`,
                }}
              />
            </div>
            <span className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest tabular-nums shrink-0">
              {STEPS.findIndex((s) => s.id === currentStep) + 1} / {STEPS.length}
            </span>
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {/* Per-step error boundary — a crash inside one tab shows a
                friendly recovery screen instead of taking down the app.
                Keyed by step so navigating away resets the error state. */}
            <ErrorBoundary key={`eb-${currentStep}`} scope={currentStep}>
              {currentStep === 'integrations' && (
                <IntegrationsTab
                  userRole={userRole}
                  credits={credits}
                  loading={loading}
                  elevenlabs={{
                    apiKey: elevenLabsKey,
                    onApiKeyChange: setElevenLabsKey,
                    showKey,
                    onToggleShowKey: () => setShowKey(!showKey),
                    testStatus,
                    onSave: handleSaveElevenLabsKey,
                    onTest: handleTestElevenLabsConnection,
                  }}
                  heygen={{
                    apiKey: heygenKey,
                    onApiKeyChange: setHeygenKey,
                    showKey: heygenShowKey,
                    onToggleShowKey: () => setHeygenShowKey(!heygenShowKey),
                    testStatus: heygenTestStatus,
                    onSave: handleSaveHeyGenKey,
                    onTest: handleTestHeyGenConnection,
                  }}
                  runway={{
                    apiKey: runwayKey,
                    onApiKeyChange: setRunwayKey,
                    showKey: runwayShowKey,
                    onToggleShowKey: () => setRunwayShowKey(!runwayShowKey),
                    testStatus: runwayTestStatus,
                    onSave: handleSaveRunwayKey,
                    onTest: handleTestRunwayConnection,
                  }}
                  gemini={{
                    apiKey: geminiKey,
                    onApiKeyChange: setGeminiKey,
                    showKey: geminiShowKey,
                    onToggleShowKey: () => setGeminiShowKey(!geminiShowKey),
                    testStatus: geminiTestStatus,
                    onSave: handleSaveGeminiKey,
                    onTest: handleTestGeminiConnection,
                  }}
                  claude={{
                    apiKey: claudeKey,
                    onApiKeyChange: setClaudeKey,
                    showKey: claudeShowKey,
                    onToggleShowKey: () => setClaudeShowKey(!claudeShowKey),
                    testStatus: claudeTestStatus,
                    onSave: handleSaveClaudeKey,
                    onTest: handleTestClaudeConnection,
                  }}
                  assemblyai={{
                    apiKey: assemblyKey,
                    onApiKeyChange: setAssemblyKey,
                    showKey: assemblyShowKey,
                    onToggleShowKey: () => setAssemblyShowKey(!assemblyShowKey),
                    testStatus: assemblyTestStatus,
                    onSave: handleSaveAssemblyAIKey,
                    onTest: handleTestAssemblyAIConnection,
                  }}
                  zapcap={{
                    apiKey: zapcapKey,
                    onApiKeyChange: setZapcapKey,
                    showKey: zapcapShowKey,
                    onToggleShowKey: () => setZapcapShowKey(!zapcapShowKey),
                    testStatus: zapcapTestStatus,
                    onSave: handleSaveZapCapKey,
                    onTest: handleTestZapCapConnection,
                  }}
                />
              )}
              {currentStep === 'projects' && (
                <ProjectsTab
                  projects={projects}
                  currentProjectId={currentProjectId}
                  viewingProjectId={viewingProjectId}
                  setViewingProjectId={setViewingProjectId}
                  viewingVariant={viewingVariant}
                  setViewingVariant={setViewingVariant}
                  platformApiKey={platformApiKey}
                  setShowNewProjectModal={setShowNewProjectModal}
                  onDeleteProject={handleDeleteProject}
                  onLoadProject={handleLoadProject}
                  onNewSubproject={handleNewSubproject}
                  onLoadVariant={handleLoadVariant}
                  onDeleteVariant={handleDeleteVariant}
                  onRenameVariant={handleRenameVariant}
                  onRenameProject={handleRenameProject}
                  onDeleteAudio={(audio) => {
                    setAudioToDelete(audio);
                    setShowDeleteModal(true);
                  }}
                  onDeleteVideoFromArray={handleDeleteVideoFromArray}
                  onDuplicateProject={handleDuplicateProject}
                  onSelectBriefFromProject={handleSelectBriefFromProject}
                  onSelectPersonaFromProject={handleSelectPersonaFromProject}
                  heygenAvatars={heygenAvatars}
                />
              )}
              {currentStep === 'source' && (
                <LazyTab>
                  <SourceTab
                    // Blueprint Fase 4 — afiliado (sourceMode='vsl') já decidiu
                    // que tem material no NewProjectModal. Pula a tela de
                    // escolha "Manual vs Auto" e abre direto no modo auto.
                    // Projetos legacy (sem sourceMode) caem no default 'choose'.
                    initialMode={(config.copy as any)?.sourceMode === 'vsl' ? 'auto' : 'choose'}
                    existingInfo={((config.copy as any)?.productInfo as ProductInfo | null) || null}
                    onExtracted={(info, rawText) => {
                      // Persist extracted info AND seed the persona/copy answers
                      // so the user lands in the next tab pre-filled. Manual
                      // edits in those tabs override these seeds.
                      setConfig((prev) => ({
                        ...prev,
                        copy: {
                          ...prev.copy,
                          productInfo: info,
                          sourceText: rawText,
                          answers: {
                            ...prev.copy.answers,
                            audience: prev.copy.answers?.audience || info.audience,
                            situation: prev.copy.answers?.situation || info.mainPain,
                            painPoints:
                              prev.copy.answers?.painPoints ||
                              [info.mainPain, ...(info.secondaryPains || [])]
                                .filter(Boolean)
                                .join('. '),
                            awarenessLevel:
                              prev.copy.answers?.awarenessLevel || info.awarenessLevel,
                            productName: info.productName,
                            offer: info.offer,
                            promise: info.promise,
                            differentiator: info.differentiator,
                            tone: info.tone,
                            guarantee: info.guarantee || '',
                          },
                        } as any,
                      }));
                      // (auto-save removido — salvar manualmente)
                    }}
                    onContinueManual={() => setCurrentStep('persona')}
                    onContinueAuto={() => setCurrentStep('persona')}
                  />
                </LazyTab>
              )}
              {currentStep === 'persona' && (
                <LazyTab>
                  <PersonaTab
                    config={config}
                    updateConfig={updateConfig}
                    setConfig={setConfig}
                    generatedPersona={generatedPersona}
                    personasSaved={personasSaved}
                    loading={loading}
                    onGeneratePersona={handleGeneratePersona}
                    onSavePersonas={handleSavePersonas}
                    onGoToPlan={handleGoToPlan}
                  />
                </LazyTab>
              )}
              {currentStep === 'persona' &&
                Array.isArray((config.copy as any)?.personasWithWeights) &&
                (config.copy as any).personasWithWeights.length > 0 && (
                <div id="plan-section" className="mt-12">
                <LazyTab>
                  <PlanTab
                    projectName={
                      projects.find((p) => p.id === currentProjectId)?.name || undefined
                    }
                    productInfo={
                      ((config.copy as any)?.productInfo as ProductInfo | null) || undefined
                    }
                    persona={config.copy?.answers || {}}
                    copyAnswers={config.copy?.answers || {}}
                    sourceMode={((config.copy as any)?.sourceMode as 'vsl' | 'product' | null) || null}
                    onSourceModeChange={(next) => {
                      setConfig((prev) => ({
                        ...prev,
                        copy: { ...prev.copy, sourceMode: next } as any,
                      }));
                    }}
                    cached={((config.copy as any)?.marketingPlan as any) || null}
                    // Blueprint v2 wiring
                    personasWithWeights={
                      ((config.copy as any)?.personasWithWeights as WeightedPersona[] | null) ||
                      null
                    }
                    cachedBriefs={
                      ((config.copy as any)?.creativeBriefs as CreativeBrief[] | null) || null
                    }
                    onBriefsChange={(briefs) => persistBriefs(briefs)}
                    onBriefEdit={(b) => setEditingBrief(b)}
                    onBriefClick={(b) => handleBriefClick(b)}
                    onCreateVsl={(recommendedWords) => {
                      // Abre a aba "Copy da VSL". Preserva uma VSL já começada;
                      // só semeia/preenche a duração recomendada se ainda vazia.
                      setConfig((prev) => {
                        const base: any = (prev as any).copyVsl || seedVslCopy(prev.copy);
                        return {
                          ...prev,
                          copyVsl: {
                            ...base,
                            targetWordCount: base.targetWordCount || recommendedWords,
                          },
                        } as AdConfig;
                      });
                      setCurrentStep('copy-vsl');
                    }}
                    briefToVariantMap={(() => {
                      // Build the brief→variant map from the project's variants:
                      // any variant whose id matches a brief id (or whose `brief.id`
                      // field matches) is considered "executed".
                      const project = projects.find((p) => p.id === currentProjectId);
                      const map: Record<string, string> = {};
                      for (const v of (project?.variants as any[]) || []) {
                        if (v.brief?.id) map[v.brief.id] = v.id;
                        else if (v.id) map[v.id] = v.id;
                      }
                      return map;
                    })()}
                    onChange={(plan) => {
                      setConfig((prev) => ({
                        ...prev,
                        copy: { ...prev.copy, marketingPlan: plan } as any,
                      }));
                      // (auto-save removido — salvar manualmente)
                    }}
                    onContinue={() => setCurrentStep('copy')}
                  />
                </LazyTab>
                </div>
              )}
              {(currentStep === 'copy' || currentStep === 'copy-vsl') && (
                <LazyTab>
                  <CopyTab
                    isVsl={currentStep === 'copy-vsl'}
                    config={currentStep === 'copy-vsl' ? vslView : config}
                    updateConfig={currentStep === 'copy-vsl' ? updateConfigVsl : updateConfig}
                    setConfig={currentStep === 'copy-vsl' ? setConfigVsl : setConfig}
                    setCurrentStep={setCurrentStep}
                    setVoiceSource={setVoiceSource}
                    copyDiscoveryMode={
                      currentStep === 'copy-vsl'
                        ? (vslCopy.discoveryMode as any) || 'unknown'
                        : copyDiscoveryMode
                    }
                    setCopyDiscoveryMode={
                      currentStep === 'copy-vsl' ? setDiscoveryVsl : setCopyDiscoveryMode
                    }
                    discoveryStep={discoveryStep}
                    setDiscoveryStep={setDiscoveryStep}
                    discoveryAnswers={discoveryAnswers}
                    setDiscoveryAnswers={setDiscoveryAnswers}
                    generatedPersona={generatedPersona}
                    onGeneratePersona={handleGeneratePersona}
                    copyFieldsApplied={copyFieldsApplied}
                    applyPersonaToCopy={applyPersonaToCopy}
                    setShowEditPersonaModal={setShowEditPersonaModal}
                    applyAwarenessLevelChange={applyAwarenessLevelChange}
                    setPendingAwarenessLevel={setPendingAwarenessLevel}
                    setShowAwarenessChangeModal={setShowAwarenessChangeModal}
                    hasUnsavedCopyChanges={hasUnsavedCopyChanges}
                    setHasUnsavedCopyChanges={setHasUnsavedCopyChanges}
                    isSaving={isSaving}
                    currentProjectId={currentProjectId}
                    handleSaveProject={handleSaveProject}
                    loading={loading}
                    handleGenerateCopy={handleGenerateCopy}
                    isProjectLoading={isProjectLoading}
                    showRequiredErrors={showCopyRequiredErrors}
                  />
                </LazyTab>
              )}
              {currentStep === 'hook-visual' && (
                <HookVisualGenerator
                  approvedHook={config.copy.hookSelecionado || ''}
                  projectId={currentProjectId || 'temp-project'}
                  hookVisual={config.hookVisual}
                  useHookFlow={useHookFlow}
                  onToggleUseHook={setUseHookFlow}
                  onSave={(data) => updateProjectHookVisual(currentProjectId || '', data)}
                  language={config.copy?.answers?.language}
                  awarenessLevel={config.copy?.answers?.awarenessLevel}
                  approvedCopy={
                    config.copy?.finalScript ||
                    config.copy?.optimizedScript ||
                    config.copy?.generatedScript ||
                    ''
                  }
                  hooksHistorico={config.copy?.hooksHistorico || []}
                  // UX4: contexto rico pra recomendação de hooks. Resolve
                  // brief ativo + persona alvo do brief + productInfo, e passa
                  // tudo pro HookChooser usar no prompt do Claude. Quando o
                  // user veio de "criar subprojeto" no Plano, esses 3 vêm
                  // populados; em fluxos legacy (sem brief), cai pro
                  // comportamento antigo (só copy + awareness).
                  selectionContext={(() => {
                    const copyAny = config.copy as any;
                    const activeBriefId: string | undefined = copyAny?.activeBriefId;
                    const briefs: CreativeBrief[] = Array.isArray(copyAny?.creativeBriefs)
                      ? copyAny.creativeBriefs
                      : [];
                    const personas: WeightedPersona[] = Array.isArray(copyAny?.personasWithWeights)
                      ? copyAny.personasWithWeights
                      : [];
                    const activeBrief = activeBriefId
                      ? briefs.find((b) => b.id === activeBriefId)
                      : undefined;
                    const targetPersona = activeBrief
                      ? personas.find((p) => p.id === activeBrief.targetPersonaId)
                      : undefined;
                    const personaRaw = (targetPersona as any)?.raw || {};
                    return {
                      productInfo: copyAny?.productInfo
                        ? {
                            produto: copyAny.productInfo.produto || copyAny.productInfo.name,
                            oferta: copyAny.productInfo.oferta || copyAny.productInfo.offer,
                            dorPrincipal:
                              copyAny.productInfo.dorPrincipal ||
                              copyAny.productInfo.painPoint ||
                              copyAny.productInfo.mainPain,
                          }
                        : null,
                      persona: targetPersona
                        ? {
                            name: targetPersona.name,
                            description: targetPersona.description,
                            age: personaRaw.age,
                            mainPain: personaRaw.mainPain || targetPersona.painPoints?.[0],
                            dominantFear: personaRaw.dominantFear,
                            hiddenDesire: personaRaw.hiddenDesire,
                            mainObjection: personaRaw.mainObjection,
                            currentSituation: personaRaw.currentSituation,
                          }
                        : null,
                      brief: activeBrief
                        ? {
                            angle: String(activeBrief.angle || ''),
                            emotion: String(activeBrief.emotion || ''),
                            style: String(activeBrief.style || ''),
                            painPoint: activeBrief.promiseFocus,
                            hook: activeBrief.hook,
                          }
                        : null,
                    };
                  })()}
                  onDeleteHookFromHistory={(hook) => {
                    const newHistorico = (config.copy?.hooksHistorico || []).filter(
                      (h) => h.hook !== hook
                    );
                    setConfig((prev) => ({
                      ...prev,
                      copy: { ...prev.copy, hooksHistorico: newHistorico },
                    }));
                    handleSaveProject({
                      copy: { ...config.copy, hooksHistorico: newHistorico },
                    } as any);
                  }}
                  onGoToVoz={() => {
                    setVoiceSource('hook');
                    setCurrentStep('voz-premium');
                  }}
                  onGoToAvatar={() => setCurrentStep('avatar')}
                  onSaveHook={(hook) => {
                    const existing = config.copy?.hooksHistorico || [];
                    const alreadyInHistory = existing.some((h) => h.hook === hook);
                    const newHistorico = alreadyInHistory
                      ? existing
                      : [{ hook, createdAt: new Date().toISOString() }, ...existing].slice(0, 50);
                    setConfig((prev) => ({
                      ...prev,
                      copy: {
                        ...prev.copy,
                        hookSelecionado: hook,
                        hooksHistorico: newHistorico,
                      },
                    }));
                    // (auto-save removido — salvar manualmente)
                  }}
                  onProceedToVoice={() => {
                    const generatedCopy =
                      config.copy?.optimizedScript || config.copy?.generatedScript;
                    const hook = (config.copy?.hookSelecionado || '').trim();
                    let finalScriptToSave = config.copy?.finalScript || '';
                    if (generatedCopy && hook) {
                      const copyStart = generatedCopy
                        .trim()
                        .substring(0, hook.length + 5)
                        .toLowerCase();
                      const hookLower = hook.toLowerCase();
                      const alreadyHasHook = copyStart.includes(
                        hookLower.substring(0, Math.min(40, hookLower.length))
                      );
                      finalScriptToSave = alreadyHasHook
                        ? generatedCopy.trim()
                        : hook + '\n\n' + generatedCopy.trim();
                    } else if (hook && !generatedCopy) {
                      finalScriptToSave = hook;
                    }
                    if (finalScriptToSave && finalScriptToSave !== config.copy?.finalScript) {
                      setConfig((prev) => ({
                        ...prev,
                        copy: { ...prev.copy, finalScript: finalScriptToSave },
                      }));
                      // (auto-save removido — salvar manualmente)
                    }
                    setVoiceSource('hook');
                    setCurrentStep('voz-premium');
                  }}
                />
              )}
              {currentStep === 'voz-premium' &&
                (() => {
                  const isHook = voiceSource === 'hook';
                  const isVslVoice = voiceSource === 'vsl';
                  const vslCopyCfg = (config as any).copyVsl as AdConfig['copy'] | undefined;
                  const hasVslVoice = !!(
                    vslCopyCfg &&
                    (vslCopyCfg.finalScript || vslCopyCfg.generatedScript)
                  );
                  const bodyAudios = config.audios || [];
                  const hookAudios =
                    ((config.copy as any)?.hookAudios as typeof bodyAudios | undefined) || [];
                  const vslAudios =
                    ((vslCopyCfg as any)?.audios as typeof bodyAudios | undefined) || [];
                  const lastBodyVoice =
                    bodyAudios.length > 0 ? bodyAudios[bodyAudios.length - 1]!.voiceId : '';
                  const lastHookVoice =
                    hookAudios.length > 0 ? hookAudios[hookAudios.length - 1]!.voiceId : '';
                  const lastVslVoice =
                    vslAudios.length > 0 ? vslAudios[vslAudios.length - 1]!.voiceId : '';
                  // Auto-preselect: prefer the mode's own last voice; fall back
                  // to the OTHER mode's last voice so the user doesn't have to
                  // reselect every time. Then they can override in the UI.
                  const defaultVoiceId = isVslVoice
                    ? lastVslVoice || lastBodyVoice || config.avatar?.voiceId || ''
                    : isHook
                      ? lastHookVoice || lastBodyVoice || config.avatar?.voiceId || ''
                      : lastBodyVoice || lastHookVoice || config.avatar?.voiceId || '';

                  const activeAudioUrl = isVslVoice
                    ? ((vslCopyCfg as any)?.audioUrl as string | undefined) || ''
                    : isHook
                      ? ((config.copy as any)?.hookAudioUrl as string | undefined) || ''
                      : config.audioUrl || '';
                  const activeAudios = isVslVoice ? vslAudios : isHook ? hookAudios : bodyAudios;
                  const activeScript = isVslVoice
                    ? vslCopyCfg?.finalScript || vslCopyCfg?.generatedScript || ''
                    : isHook
                      ? config.copy?.hookSelecionado ||
                        config.copy?.finalScript ||
                        config.copy?.generatedScript ||
                        ''
                      : config.copy?.finalScript || config.copy?.generatedScript || '';

                  return (
                    <>
                      {/* Toggle: which audio are we working on? Aparece quando o
                      projeto usa gancho separado OU quando existe uma VSL. */}
                      {(useHookFlow || hasVslVoice) && (
                        <div className="max-w-4xl mx-auto px-6 pt-6">
                          <div className="bg-white dark:bg-gray-900/80 p-2 rounded-2xl border-2 border-gray-100 dark:border-gray-800 shadow-sm flex gap-1">
                            <button
                              onClick={() => setVoiceSource('copy')}
                              className={`flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                                !isHook && !isVslVoice
                                  ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 shadow-md'
                                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60'
                              }`}
                            >
                              Voz do Corpo
                              {bodyAudios.length > 0 && (
                                <span className="ml-2 text-[9px] opacity-70">
                                  ({bodyAudios.length})
                                </span>
                              )}
                            </button>
                            {useHookFlow && (
                              <button
                                onClick={() => setVoiceSource('hook')}
                                className={`flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                                  isHook
                                    ? 'bg-amber-500 text-white shadow-md'
                                    : 'text-gray-500 hover:bg-amber-50'
                                }`}
                              >
                                Voz do Gancho
                                {hookAudios.length > 0 && (
                                  <span className="ml-2 text-[9px] opacity-70">
                                    ({hookAudios.length})
                                  </span>
                                )}
                              </button>
                            )}
                            {hasVslVoice && (
                              <button
                                onClick={() => setVoiceSource('vsl')}
                                className={`flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                                  isVslVoice
                                    ? 'bg-purple-600 text-white shadow-md'
                                    : 'text-gray-500 hover:bg-purple-50'
                                }`}
                              >
                                Voz da VSL
                                {vslAudios.length > 0 && (
                                  <span className="ml-2 text-[9px] opacity-70">
                                    ({vslAudios.length})
                                  </span>
                                )}
                              </button>
                            )}
                          </div>
                          <p className="text-[10px] text-gray-500 mt-2 px-2">
                            {isVslVoice
                              ? 'Você está gerando o áudio da VSL (roteiro longo em blocos).'
                              : isHook
                                ? 'Você está gerando o áudio do gancho (parte inicial curta).'
                                : 'Você está gerando o áudio do corpo do vídeo (script principal).'}
                          </p>
                        </div>
                      )}

                      <VozPremium
                        key={isVslVoice ? 'voz-vsl' : isHook ? 'voz-hook' : 'voz-body'}
                        approvedScript={activeScript}
                        personaGender={config.copy?.answers?.personaGender || ''}
                        personaAge={config.copy?.answers?.personaAgePrimary || ''}
                        savedAudioUrl={activeAudioUrl || undefined}
                        savedAudios={activeAudios}
                        savedBlockAudios={
                          isVslVoice ? ((vslCopyCfg as any)?.blockAudios as any) : undefined
                        }
                        onBlockAudiosChange={
                          isVslVoice
                            ? (arr) =>
                                setConfig((prev) => ({
                                  ...prev,
                                  copyVsl: { ...(prev as any).copyVsl, blockAudios: arr } as any,
                                }))
                            : undefined
                        }
                        copyAnswers={config.copy?.answers || {}}
                        cachedRecommendation={avatarRecommendation}
                        onRecommendationChange={setAvatarRecommendation}
                        productInfo={
                          ((config.copy as any)?.productInfo as ProductInfo | null) || undefined
                        }
                        // UX7: resolve brief ativo (quando subprojeto veio de
                        // um brief do Plano) e passa pro painel de IA. Mesmo
                        // padrão usado em AvatarTab logo abaixo — recomendação
                        // fica alinhada ao ângulo/emoção/estilo do criativo.
                        brief={(() => {
                          const copyAny = config.copy as any;
                          const activeId: string | undefined = copyAny?.activeBriefId;
                          if (!activeId) return null;
                          const briefs = Array.isArray(copyAny?.creativeBriefs)
                            ? copyAny.creativeBriefs
                            : [];
                          const b = briefs.find((x: any) => x?.id === activeId);
                          if (!b) return null;
                          return {
                            index: b.index,
                            angle: String(b.angle || ''),
                            emotion: String(b.emotion || ''),
                            style: String(b.style || ''),
                            promiseFocus: b.promiseFocus,
                            hook: b.hook,
                            rationale: b.rationale,
                            durationTarget: b.durationTarget,
                          };
                        })()}
                        savedOptimizedScript={
                          isVslVoice
                            ? (vslCopyCfg?.optimizedScript as string | undefined) || ''
                            : isHook
                              ? ((config.copy as any)?.hookOptimizedScript as
                                  | string
                                  | undefined) || ''
                              : config.copy?.optimizedScript || ''
                        }
                        defaultVoiceId={defaultVoiceId || undefined}
                        onApprovedScriptEdit={(edited) => {
                          // The "approved script" is the editable source text shown
                          // in VozPremium. Body edits go to finalScript (existing).
                          // Hook edits go to hookSelecionado so the next render in
                          // hook mode picks them up too. VSL edits go to copyVsl.
                          if (isVslVoice) {
                            setConfig((prev) => ({
                              ...prev,
                              copyVsl: { ...(prev as any).copyVsl, finalScript: edited },
                            }));
                          } else if (isHook) {
                            setConfig((prev) => ({
                              ...prev,
                              copy: { ...prev.copy, hookSelecionado: edited },
                            }));
                            // (auto-save removido — salvar manualmente)
                          } else {
                            setConfig((prev) => ({
                              ...prev,
                              copy: { ...prev.copy, finalScript: edited },
                            }));
                            // (auto-save removido — salvar manualmente)
                          }
                        }}
                        onOptimizedScript={(optimized) => {
                          if (isVslVoice) {
                            setConfig((prev) => ({
                              ...prev,
                              copyVsl: { ...(prev as any).copyVsl, optimizedScript: optimized },
                            }));
                          } else if (isHook) {
                            setConfig((prev) => ({
                              ...prev,
                              copy: {
                                ...prev.copy,
                                hookOptimizedScript: optimized,
                              } as any,
                            }));
                            // (auto-save removido — salvar manualmente)
                          } else {
                            setConfig((prev) => ({
                              ...prev,
                              copy: { ...prev.copy, optimizedScript: optimized },
                            }));
                            // (auto-save removido — salvar manualmente)
                          }
                        }}
                        onGoToVideo={() => setCurrentStep('avatar')}
                        onAudioReady={(audioUrl, voiceId, storagePath, voiceName) => {
                          // Clearing the active audio.
                          if (!audioUrl) {
                            if (isVslVoice) {
                              setConfig((prev) => ({
                                ...prev,
                                copyVsl: {
                                  ...(prev as any).copyVsl,
                                  audioUrl: '',
                                  audioStoragePath: null,
                                } as any,
                              }));
                              return;
                            }
                            if (isHook) {
                              setConfig((prev) => ({
                                ...prev,
                                copy: {
                                  ...prev.copy,
                                  hookAudioUrl: '',
                                  hookAudioStoragePath: null,
                                } as any,
                              }));
                              handleSaveProject({
                                copy: {
                                  ...config.copy,
                                  hookAudioUrl: '',
                                  hookAudioStoragePath: null,
                                },
                              } as any);
                            } else {
                              setAudioUrl('');
                              setConfig((prev) => ({
                                ...prev,
                                audioUrl: '',
                                audioStoragePath: null,
                              }));
                              handleSaveProject({
                                audioUrl: '',
                                audioStoragePath: null,
                              });
                            }
                            return;
                          }

                          const currentAudios = activeAudios;
                          const existing = currentAudios.find((a) => a.url === audioUrl);
                          const newAudio = {
                            url: audioUrl,
                            storagePath: storagePath || null,
                            voiceId: voiceId || '',
                            createdAt: new Date().toISOString(),
                          };
                          const newAudios = existing ? currentAudios : [...currentAudios, newAudio];

                          if (isVslVoice) {
                            setConfig((prev) => ({
                              ...prev,
                              copyVsl: {
                                ...(prev as any).copyVsl,
                                audioUrl,
                                audioStoragePath: storagePath || null,
                                audios: newAudios,
                              } as any,
                              ...(voiceId
                                ? {
                                    avatar: {
                                      ...prev.avatar,
                                      voiceId,
                                      ...(voiceName ? { voiceName } : {}),
                                    },
                                  }
                                : {}),
                            }));
                          } else if (isHook) {
                            setConfig((prev) => ({
                              ...prev,
                              copy: {
                                ...prev.copy,
                                hookAudioUrl: audioUrl,
                                hookAudioStoragePath: storagePath || null,
                                hookAudios: newAudios,
                              } as any,
                            }));
                            // (auto-save removido — salvar manualmente)
                          } else {
                            if (!existing) setAudios(newAudios);
                            setAudioUrl(audioUrl);
                            setConfig((prev) => ({
                              ...prev,
                              audioUrl,
                              audioStoragePath: storagePath || null,
                              audios: newAudios,
                              ...(voiceId
                                ? {
                                    avatar: {
                                      ...prev.avatar,
                                      voiceId,
                                      // Guarda o nome legível pro painel de info.
                                      ...(voiceName ? { voiceName } : {}),
                                    },
                                  }
                                : {}),
                            }));
                            // (auto-save removido — salvar manualmente)
                          }
                        }}
                        onDeleteAudioFromHistory={(
                          urlToDelete: string,
                          storagePathToDelete: string | null
                        ) => {
                          setAudioToDeleteFromHistory({
                            url: urlToDelete,
                            storagePath: storagePathToDelete,
                          });
                        }}
                      />

                      {/* Toggle voz gancho/corpo/VSL TAMBÉM no rodapé — pra trocar
                          de lado sem rolar até o topo. */}
                      {(useHookFlow || hasVslVoice) && (
                        <div className="max-w-4xl mx-auto px-6 pb-6">
                          <div className="bg-white dark:bg-gray-900/80 p-2 rounded-2xl border-2 border-gray-100 dark:border-gray-800 shadow-sm flex gap-1">
                            <button
                              onClick={() => setVoiceSource('copy')}
                              className={`flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                                !isHook && !isVslVoice
                                  ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 shadow-md'
                                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60'
                              }`}
                            >
                              Voz do Corpo
                              {bodyAudios.length > 0 && (
                                <span className="ml-2 text-[9px] opacity-70">
                                  ({bodyAudios.length})
                                </span>
                              )}
                            </button>
                            {useHookFlow && (
                              <button
                                onClick={() => setVoiceSource('hook')}
                                className={`flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                                  isHook
                                    ? 'bg-amber-500 text-white shadow-md'
                                    : 'text-gray-500 hover:bg-amber-50'
                                }`}
                              >
                                Voz do Gancho
                                {hookAudios.length > 0 && (
                                  <span className="ml-2 text-[9px] opacity-70">
                                    ({hookAudios.length})
                                  </span>
                                )}
                              </button>
                            )}
                            {hasVslVoice && (
                              <button
                                onClick={() => setVoiceSource('vsl')}
                                className={`flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                                  isVslVoice
                                    ? 'bg-purple-600 text-white shadow-md'
                                    : 'text-gray-500 hover:bg-purple-50'
                                }`}
                              >
                                Voz da VSL
                                {vslAudios.length > 0 && (
                                  <span className="ml-2 text-[9px] opacity-70">
                                    ({vslAudios.length})
                                  </span>
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              {currentStep === 'remotion' && (
                <LazyTab>
                  <RemotionTab
                    config={config}
                    setConfig={setConfig}
                    setCurrentStep={setCurrentStep}
                  />
                </LazyTab>
              )}
              {currentStep === 'avatar' && (
                <LazyTab>
                  <AvatarTab
                    config={config}
                    setConfig={setConfig}
                    setCurrentStep={setCurrentStep}
                    loading={loading}
                    setLoading={setLoading}
                    avatarMode={avatarMode}
                    setAvatarMode={setAvatarMode}
                    useHookFlow={useHookFlow}
                    heygenAvatars={heygenAvatars}
                    setHeygenAvatars={setHeygenAvatars}
                    avatarFilters={avatarFilters}
                    setAvatarFilters={setAvatarFilters}
                    avatarSearch={avatarSearch}
                    setAvatarSearch={setAvatarSearch}
                    previewAvatar={previewAvatar}
                    setPreviewAvatar={setPreviewAvatar}
                    avatarRecommendation={avatarRecommendation}
                    setAvatarRecommendation={setAvatarRecommendation}
                    videos={videos}
                    videoUrl={videoUrl}
                    setVideoUrl={setVideoUrl}
                    setVideoStoragePath={setVideoStoragePath}
                    platformApiKey={platformApiKey}
                    videoOp={videoOp}
                    setVideoOp={setVideoOp}
                    setGenerationStage={setGenerationStage}
                    isTestMode={isTestMode}
                    setIsTestMode={setIsTestMode}
                    useNativeFallback={useNativeFallback}
                    setUseNativeFallback={setUseNativeFallback}
                    logs={logs}
                    pollIntervalRef={pollIntervalRef}
                    isTestingKey={isTestingKey}
                    isUpdatingKey={isUpdatingKey}
                    audioUrl={audioUrl}
                    isVideoUpToDate={isVideoUpToDate}
                    loadingAvatars={loadingAvatars}
                    avatarError={avatarError}
                    newElevenLabsKey={newElevenLabsKey}
                    setNewElevenLabsKey={setNewElevenLabsKey}
                    showElevenLabsConfig={showElevenLabsConfig}
                    setShowElevenLabsConfig={setShowElevenLabsConfig}
                    setShowDeleteModal={setShowDeleteModal}
                    videoToDelete={videoToDelete}
                    setVideoToDelete={setVideoToDelete}
                    setAudioToDelete={setAudioToDelete}
                    showDeleteVideoModal={showDeleteVideoModal}
                    setShowDeleteVideoModal={setShowDeleteVideoModal}
                    showDeleteHistoryVideoModal={showDeleteHistoryVideoModal}
                    setShowDeleteHistoryVideoModal={setShowDeleteHistoryVideoModal}
                    handleGenerateVideo={handleGenerateVideo}
                    handleCancelGeneration={handleCancelGeneration}
                    handleDeleteVideo={handleDeleteVideo}
                    handleDeleteVideoFromArray={handleDeleteVideoFromArray}
                    handleTestElevenLabsKey={handleTestElevenLabsKey}
                    handleUpdateElevenLabsKey={handleUpdateElevenLabsKey}
                  />
                </LazyTab>
              )}
              {currentStep === 'video-ia' && (
                <LazyTab>
                  <VideoIATab
                    user={user}
                    onAddClip={(clip) => {
                      // Clipe do fal entra na BIBLIOTECA da Montagem
                      // (config.montagem.clips) — de onde a timeline puxa os
                      // b-rolls. A Montagem lê isso no mount (draft.clips).
                      setConfig((prev) => {
                        const montagem = ((prev as any).montagem || {}) as any;
                        const clips = Array.isArray(montagem.clips) ? montagem.clips : [];
                        return {
                          ...prev,
                          montagem: { ...montagem, clips: [...clips, clip] },
                        } as any;
                      });
                    }}
                    onGoToMontagem={() => setCurrentStep('montagem')}
                    audios={[
                      ...(((config as any).audios as any[]) || []).map((a, i) => ({
                        url: a?.url,
                        label: `🎙 Corpo #${i + 1}`,
                      })),
                      ...(((config.copy as any)?.hookAudios as any[]) || []).map((a, i) => ({
                        url: a?.url,
                        label: `🎣 Gancho #${i + 1}`,
                      })),
                    ].filter((a) => a.url)}
                  />
                </LazyTab>
              )}
              {currentStep === 'edit-zap' && (
                <LazyTab>
                  <EditZapTab
                    zap={zap}
                    config={config}
                    setConfig={setConfig}
                    videos={videos}
                    platformApiKey={platformApiKey}
                    user={user}
                    useHookFlow={useHookFlow}
                    loading={loading}
                    handleRenderZapSimple={handleRenderZapSimple}
                    handleRenderZapSplit={handleRenderZapSplit}
                    handleDeleteVideoFromArray={handleDeleteVideoFromArray}
                    handleRenderHeadline={handleRenderHeadline}
                    handleRenderIntercut={handleRenderIntercut}
                    fetchZapCapTemplates={fetchZapCapTemplates}
                    zapCapTemplates={zapCapTemplates}
                    onAddUploadedVideo={(newVideo: any, isHook: boolean) => {
                      // Vídeo enviado pelo user vira fonte do pipeline de edição,
                      // exatamente como um vídeo gerado pelo avatar. Corpo: state
                      // `videos` (alimenta o picker) + config.videos (persiste).
                      // Gancho: config.copy.hookVideos.
                      if (isHook) {
                        setConfig((prev) => {
                          const prevHook =
                            ((prev.copy as any)?.hookVideos as any[] | undefined) || [];
                          return {
                            ...prev,
                            copy: { ...prev.copy, hookVideos: [...prevHook, newVideo] } as any,
                          };
                        });
                      } else {
                        setVideos((prev) => [...prev, newVideo]);
                        setConfig((prev) => ({
                          ...prev,
                          videos: [...((prev.videos as any[]) || []), newVideo],
                        }));
                      }
                    }}
                  />
                </LazyTab>
              )}
              {currentStep === 'merge' && (
                <LazyTab>
                  <MergeTab config={config} setConfig={setConfig} user={user} />
                </LazyTab>
              )}
              {currentStep === 'montagem' && (
                <LazyTab>
                  <MontagemTab
                    config={config}
                    setConfig={setConfig}
                    user={user}
                    onAddUploadedVideo={(newVideo: any, isHook: boolean) => {
                      if (isHook) {
                        setConfig((prev) => {
                          const prevHook =
                            ((prev.copy as any)?.hookVideos as any[] | undefined) || [];
                          return {
                            ...prev,
                            copy: { ...prev.copy, hookVideos: [...prevHook, newVideo] } as any,
                          };
                        });
                      } else {
                        setVideos((prev) => [...prev, newVideo]);
                        setConfig((prev) => ({
                          ...prev,
                          videos: [...((prev.videos as any[]) || []), newVideo],
                        }));
                      }
                    }}
                    onGoToEdit={() => setCurrentStep('edit-zap')}
                  />
                </LazyTab>
              )}
              {currentStep === 'edit2' && (
                <LazyTab>
                  <Edit2Tab
                    videoUrl={videoUrl}
                    setVideoUrl={setVideoUrl}
                    uploadProgress={uploadProgress}
                    userVideos={userVideos}
                    platformApiKey={platformApiKey}
                    autoEditState={autoEditState}
                    setAutoEditState={setAutoEditState}
                    brollPercent={brollPercent}
                    setBrollPercent={setBrollPercent}
                    recommendedBrollPercent={recommendedBrollPercent}
                    zapCapTemplates={zapCapTemplates}
                    zapCapRenderConfig={zapCapRenderConfig}
                    setZapCapRenderConfig={setZapCapRenderConfig}
                    loading={loading}
                    isDragging={isDragging}
                    setIsDragging={setIsDragging}
                    isRenderingRef={isRenderingRef}
                    handleUploadVideo={handleUploadVideo}
                    handleStartAutoEdit={handleStartAutoEdit}
                    handleRenderZapCap={handleRenderZapCap}
                    handleApproveAndDownload={handleApproveAndDownload}
                    toggleBrollSelection={toggleBrollSelection}
                  />
                </LazyTab>
              )}

              {currentStep === 'final' && (
                <LazyTab>
                  <FinalTab
                    config={config}
                    videoUrl={videoUrl}
                    audioUrl={audioUrl}
                    videoOp={videoOp}
                    loading={loading}
                    currentTime={currentTime}
                    setCurrentTime={setCurrentTime}
                    isExpanded={isExpanded}
                    generationStage={generationStage}
                    heygenAvatars={heygenAvatars}
                    platformApiKey={platformApiKey}
                    videoRef={videoRef}
                    logs={logs}
                    handleGenerateVideo={handleGenerateVideo}
                    handleGenerateSubtitles={handleGenerateSubtitles}
                    onDuplicateAsVariant={handleDuplicateAsVariant}
                  />
                </LazyTab>
              )}
            </ErrorBoundary>
          </motion.div>
        </AnimatePresence>

        {/* Footer Navigation */}
        <div className="mt-16 flex items-center justify-between pt-8 border-t border-gray-200/60 dark:border-gray-800/60">
          <button
            onClick={prevStep}
            disabled={currentStep === STEPS[0]?.id}
            className="group flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/60 disabled:opacity-0 transition-all"
          >
            <ChevronLeft size={18} className="group-hover:-translate-x-0.5 transition-transform" />
            Voltar
          </button>

          {currentStep !== 'copy' && (
            <div className="flex items-center gap-3">
              <button
                // UX2: silent:false → este é o ÚNICO save com toast.
                // Auto-save e saves programáticos rodam silenciosos.
                onClick={() => handleSaveProject(undefined, { silent: false })}
                disabled={isSaving}
                className="flex items-center gap-2 px-5 py-2.5 bg-white dark:bg-gray-900/80 ring-1 ring-gray-200/60 dark:ring-gray-800/60 text-gray-700 dark:text-gray-200 rounded-xl font-bold hover:bg-gray-50 dark:hover:bg-gray-800 hover:ring-gray-300 dark:hover:ring-gray-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : currentProjectId ? (
                  <CheckCircle2 size={16} className="text-green-500" />
                ) : (
                  <Download size={16} className="text-blue-500" />
                )}
                {currentProjectId ? 'Salvar' : 'Salvar Projeto'}
              </button>

              <button
                onClick={nextStep}
                disabled={currentStep === 'final'}
                className="group flex items-center gap-2 px-7 py-2.5 bg-gradient-to-br from-gray-900 to-gray-800 dark:from-blue-500 dark:to-blue-600 text-white rounded-xl font-bold hover:from-black hover:to-gray-900 dark:hover:from-blue-600 dark:hover:to-blue-700 active:scale-[0.98] transition-all shadow-lg shadow-gray-900/20 dark:shadow-blue-900/40 ring-1 ring-inset ring-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continuar
                <ChevronRight
                  size={18}
                  className="group-hover:translate-x-0.5 transition-transform"
                />
              </button>
            </div>
          )}
        </div>
      </main>
      <NewProjectModal
        isOpen={showNewProjectModal}
        name={newProjectName}
        type={newProjectType}
        copySubMode={copySubMode}
        sourceMode={newSourceMode}
        isSaving={isSaving}
        onNameChange={setNewProjectName}
        onTypeChange={(next) => {
          setNewProjectType(next);
          // Source choice só faz sentido pro tipo 'complete' (Blueprint).
          // Se trocar pra outro tipo, limpa pra não persistir lixo.
          if (next !== 'complete') setNewSourceMode(null);
        }}
        onCopySubModeChange={setCopySubMode}
        onSourceModeChange={setNewSourceMode}
        onClose={() => {
          setShowNewProjectModal(false);
          setNewSourceMode(null);
        }}
        onCreate={handleCreateProject}
      />

      {/* Lembrete de salvar ao trocar de aba com mudanças pendentes. O trabalho
          não some ao navegar (config é estado global), mas sem salvar no
          Firestore ele se perde ao recarregar/sair — daí o aviso. */}
      {pendingStepChange && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-[28px] shadow-2xl border-2 border-gray-200 dark:border-gray-800 p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center text-amber-600 dark:text-amber-400">
                <Save size={20} />
              </div>
              <div>
                <h3 className="text-lg font-black text-gray-900 dark:text-gray-50">
                  Você tem alterações não salvas
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Salve antes de mudar de aba pra não perder o que fez ao recarregar.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                disabled={isSaving}
                onClick={async () => {
                  const target = pendingStepChange;
                  await handleSaveProject(undefined, { silent: false });
                  setPendingStepChange(null);
                  if (target) setCurrentStep(target);
                }}
                className="w-full py-3 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="animate-spin" size={16} /> Salvando...
                  </>
                ) : (
                  <>
                    <Save size={16} /> Salvar e continuar
                  </>
                )}
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => {
                  const target = pendingStepChange;
                  setPendingStepChange(null);
                  if (target) setCurrentStep(target);
                }}
                className="w-full py-3 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-2xl font-bold text-sm hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                Continuar sem salvar
              </button>
              <button
                type="button"
                onClick={() => setPendingStepChange(null)}
                className="w-full py-2 text-gray-500 dark:text-gray-400 text-xs font-bold hover:text-gray-700 dark:hover:text-gray-200"
              >
                Cancelar (ficar nesta aba)
              </button>
            </div>
          </div>
        </div>
      )}

      <CostConfirmModal
        isOpen={!!pendingVideoGen}
        action="heygen_video"
        cost={COSTS.heygen_video}
        currentCredits={credits}
        onCancel={() => setPendingVideoGen(null)}
        onConfirm={() => {
          const pending = pendingVideoGen;
          setPendingVideoGen(null);
          if (pending) executeGenerateVideo(pending.forceRegenerate);
        }}
      />

      {/* Brief edit modal — Phase 3.3 */}
      <BriefEditModal
        isOpen={!!editingBrief}
        brief={editingBrief}
        personas={
          ((config.copy as any)?.personasWithWeights as WeightedPersona[] | undefined) || []
        }
        onClose={() => setEditingBrief(null)}
        onSave={handleSaveEditedBrief}
      />

      {/* Blueprint Fase 5 — mesmo BriefEditModal em mode='create' pro fluxo
          Criativo 16+. Banner amber loud avisa que vai gerar novo criativo
          fora dos 15. Save → vira brief + dispara popup de subprojeto. */}
      <BriefEditModal
        isOpen={!!creatingNewBrief}
        brief={creatingNewBrief}
        personas={
          ((config.copy as any)?.personasWithWeights as WeightedPersona[] | undefined) || []
        }
        mode="create"
        onClose={() => setCreatingNewBrief(null)}
        onSave={handleSaveNewBigVariation}
      />

      {/* Create-subprojeto popup — Phase 3.4. Just confirmation, no edit. */}
      <ConfirmModal
        open={!!pendingBriefExec}
        title="Criar este subprojeto?"
        message={
          pendingBriefExec
            ? `Nome: ${briefToSubprojectName(pendingBriefExec)}\n\nHook: "${pendingBriefExec.hook.substring(0, 80)}${pendingBriefExec.hook.length > 80 ? '…' : ''}"`
            : ''
        }
        confirmLabel="Criar e ir pra Copy"
        cancelLabel="Cancelar"
        tone="warning"
        onCancel={() => setPendingBriefExec(null)}
        onConfirm={handleConfirmBriefExec}
      />

      {/* Blueprint Fase 4 — Porta A: criar subprojeto a partir de uma
          persona (sem brief). Pula o Plano de 15. */}
      <ConfirmModal
        open={!!pendingPersonaExec}
        title="Criar subprojeto com essa persona?"
        message={
          pendingPersonaExec
            ? `Persona: ${pendingPersonaExec.name}\n\n${
                (pendingPersonaExec as any)?.raw?.mainPain
                  ? `Dor principal: ${(pendingPersonaExec as any).raw.mainPain}\n`
                  : ''
              }\nO subprojeto vai começar vazio na Copy — sem brief de ângulo/hook pré-definidos. Você escolhe tudo na hora de gerar a copy.`
            : ''
        }
        confirmLabel="Criar e ir pra Copy"
        cancelLabel="Cancelar"
        tone="warning"
        onCancel={() => setPendingPersonaExec(null)}
        onConfirm={handleConfirmPersonaExec}
      />

      {/* Delete Audio Modal — renderizado no topo para evitar z-index/overflow issues */}
      <ConfirmModal
        open={showDeleteModal}
        title="Deletar Áudio?"
        onCancel={() => {
          setShowDeleteModal(false);
          setAudioToDelete(null);
        }}
        onConfirm={() => handleDeleteAudio()}
      />

      <ConfirmModal
        open={!!audioToDeleteFromHistory}
        title="Deletar áudio?"
        onCancel={() => setAudioToDeleteFromHistory(null)}
        onConfirm={() => {
          if (!audioToDeleteFromHistory) return;
          const urlToDelete = audioToDeleteFromHistory.url;
          const storagePathToDelete = audioToDeleteFromHistory.storagePath;

          if (storagePathToDelete) {
            safeDeleteObject(storagePathToDelete).catch(() => {});
          }

          const currentAudios = config.audios || audios || [];
          const newAudios = currentAudios.filter((a) => a.url !== urlToDelete);

          setAudios(newAudios);

          const wasActive = audioUrl === urlToDelete || config.audioUrl === urlToDelete;
          if (wasActive) {
            setAudioUrl('');
          }

          setConfig((prev) => ({
            ...prev,
            audios: newAudios,
            ...(wasActive ? { audioUrl: '', audioStoragePath: null } : {}),
          }));

          handleSaveProject({
            audios: newAudios,
            ...(wasActive ? { audioUrl: null, audioStoragePath: null } : {}),
          });

          setAudioToDeleteFromHistory(null);
        }}
      />

      <ConfirmModal
        open={showAwarenessChangeModal}
        tone="warning"
        title="Mudar nível de consciência?"
        message="As recomendações de Emoção, Ângulo, Destino do Clique e Tamanho do Roteiro mudam conforme o nível. Confira os campos abaixo depois e ajuste se quiser."
        confirmLabel="Continuar"
        onCancel={() => {
          setShowAwarenessChangeModal(false);
          setPendingAwarenessLevel(null);
        }}
        onConfirm={() => handleConfirmAwarenessChange()}
      />

      {/* Modal: Persona Path Selector (ao criar novo subprojeto) */}
      <PersonaPathModal
        project={pendingNewSubproject}
        onClose={() => setPendingNewSubproject(null)}
        onProceed={(p, path) => proceedNewSubproject(p, path)}
      />

      {/* Modal: Editar Persona */}
      <PersonaEditModal
        open={showEditPersonaModal && !!config.copy?.answers?.selectedPersonaFull}
        persona={(() => {
          try {
            return JSON.parse(config.copy?.answers?.selectedPersonaFull || 'null');
          } catch {
            return null;
          }
        })()}
        onChange={(next) =>
          updateConfig('copy', 'answers', 'selectedPersonaFull', JSON.stringify(next))
        }
        onClose={() => setShowEditPersonaModal(false)}
        onSave={() => {
          setShowEditPersonaModal(false);
          setCopyFieldsApplied(false);
          toast.success("Persona atualizado! Clique em 'Atualizar Campos da Copy' para aplicar.");
        }}
      />

      <ConfirmModal
        open={!!deleteProjectConfirmId}
        title="Excluir projeto?"
        message="Esta ação não pode ser desfeita. Todo o conteúdo deste projeto (copy, hooks, áudios, vídeos) será perdido permanentemente."
        confirmLabel="Sim, excluir"
        onCancel={() => setDeleteProjectConfirmId(null)}
        onConfirm={() => confirmDeleteProject()}
      />

      {/* Toast notifications. Custom theme to match the app's
          frosted/glass aesthetic and respect dark mode. Default
          styling is a flat white pill with a basic shadow — we use
          a tinted ring + bg/text that flips for dark.
          ToastLimiter caps visible toasts at 3 so a burst of errors
          doesn't pile up off-screen. */}
      <ToastLimiter max={3} />
      <Toaster
        position="bottom-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: isDark ? 'rgb(17 24 39 / 0.95)' : 'rgb(255 255 255 / 0.95)',
            color: isDark ? 'rgb(243 244 246)' : 'rgb(17 24 39)',
            backdropFilter: 'blur(12px)',
            border: isDark ? '1px solid rgb(55 65 81 / 0.6)' : '1px solid rgb(229 231 235 / 0.8)',
            borderRadius: '12px',
            boxShadow: isDark
              ? '0 10px 40px -10px rgb(0 0 0 / 0.6), 0 0 0 1px rgb(255 255 255 / 0.04)'
              : '0 10px 40px -10px rgb(0 0 0 / 0.2), 0 0 0 1px rgb(0 0 0 / 0.02)',
            fontSize: '14px',
            fontWeight: 600,
            padding: '12px 16px',
          },
          success: {
            iconTheme: {
              primary: 'rgb(34 197 94)',
              secondary: isDark ? 'rgb(17 24 39)' : 'rgb(255 255 255)',
            },
          },
          error: {
            iconTheme: {
              primary: 'rgb(239 68 68)',
              secondary: isDark ? 'rgb(17 24 39)' : 'rgb(255 255 255)',
            },
          },
        }}
      />
    </div>
  );
}
