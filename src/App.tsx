/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import HookVisualGenerator from './components/HookVisualGenerator';
import VozPremium from './components/VozPremium';
import { IntegrationsTab } from './pages/IntegrationsTab';
import { ProjectsTab } from './pages/ProjectsTab';
import { cn, getVideoAspectRatioClass } from './lib/utils';
import { VideoDurationBadge } from './components/VideoDurationBadge';
import {
  getRecomendedEstilo,
  getRecomendacaoTempo,
  countWords,
  detectDuration,
  detectVideoFormat,
  detectVideoFormatFromUrl,
} from './lib/helpers';
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
} from './types/project';


import {
  Video,
  User,
  Users,
  Volume2,
  Layout,
  Layers,
  Play,
  Star,
  ChevronRight,
  ChevronLeft,
  Folder,
  Sparkles,
  CheckCircle2,
  X,
  ChevronDown,
  Film,
  Loader2,
  Edit3,
  Download,
  RefreshCw,
  Maximize,
  Upload,
  LogOut,
  AlertCircle,
  Search,
  Filter,
  SortAsc,
  Tag,
  XCircle,
  Trash2,
  Monitor,
  Check,
  Info,
  Smartphone,
  Square,
  Zap,
  Smile,
  Plus,
  Scan,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Toaster, toast } from 'react-hot-toast';
import {
  getAuthorizedUrl,
} from './lib/gemini';
import {
  generateAdCopyWithClaude,
  discoverPersonaWithClaude,
} from './lib/claudeService';
import { auth, db, storage } from './lib/firebase';
import {
  DURATION_OPTIONS,
  AVATAR_ENRICHMENT,
  HEYGEN_NAME_KEYWORDS,
  AD_STYLES,
  STEPS,
  SUBTITLE_STYLES,
  AVATARS,
  PERSONA_CATEGORY_OPTIONS,
  PERSONA_URGENCY_OPTIONS,
  PERSONA_DIFFERENTIAL_OPTIONS,
  PERSONA_TRIED_BEFORE_OPTIONS,
  PERSONA_PAYING_CAPACITY_OPTIONS,
  PERSONA_HIDDEN_DESIRE_OPTIONS,
  COPY_SECTIONS,
} from './lib/constants';
import { AutoResizeTextarea } from './components/AutoResizeTextarea';
import { NewProjectModal } from './components/NewProjectModal';
import { ConfirmModal } from './components/ConfirmModal';
import { PersonaEditModal } from './components/PersonaEditModal';
import { PersonaPathModal } from './components/PersonaPathModal';
import { ElevenLabsConfigModal } from './components/ElevenLabsConfigModal';
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
  collection,
  addDoc,
  query,
  where,
  orderBy,
  deleteDoc,
  updateDoc,
} from 'firebase/firestore';

// --- Constants & Types ---


interface ProjectVariant {
  id: string;
  name: string;
  config: AdConfig;
  createdAt: any;
}

interface Project {
  id: string;
  userId: string;
  name: string;
  type: 'complete' | 'copy' | 'video' | 'editing';
  config: AdConfig;
  variants?: ProjectVariant[];
  createdAt: any;
}

interface AdConfig {
  angle: string;
  copy: {
    mode: 'improve' | 'as-is' | 'questions';
    subMode?: 'zero' | 'improve' | 'ready';
    discoveryMode?: 'unknown' | 'known' | 'discovering' | 'done';
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
  };
  hookVisual: HookVisualData;
  avatar: {
    faceId: string;
    customFaceUrl: string | null;
    voiceId: string;
    scale?: number;
    avatarFormat?: 'original' | 'square';
    cropOffset?: number; // -50 to 50
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
  const [currentStep, setCurrentStep] = useState<Step>('projects');
  const [deleteProjectConfirmId, setDeleteProjectConfirmId] = useState<string | null>(null);
  const [voiceSource, setVoiceSource] = useState<'copy' | 'hook'>('copy');
  const [previewAvatar, setPreviewAvatar] = useState<any>(null);
  const [credits, setCredits] = useState<number>(0);
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
      aspectRatio?: string;
    }[]
  >([]);
  const [lastVideoMetadata, setLastVideoMetadata] = useState<any | null>(null);
  const [showDeleteVideoModal, setShowDeleteVideoModal] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [platformApiKey, setPlatformApiKey] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isProjectLoading, setIsProjectLoading] = useState(false);
  const [hasUnsavedCopyChanges, setHasUnsavedCopyChanges] = useState(false);

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
    if (!video.storagePath) {
      const newVideos = videos.filter((v) => v.url !== video.url);
      setVideos(newVideos);

      let newVideoUrl = videoUrl;
      let newVideoStoragePath = videoStoragePath;
      let newLastMetadata = lastVideoMetadata;

      if (videoUrl === video.url) {
        newVideoUrl = newVideos.length > 0 ? newVideos[newVideos.length - 1].url : null;
        newVideoStoragePath =
          newVideos.length > 0 ? newVideos[newVideos.length - 1].storagePath : null;
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

      toast.success('Vídeo removido do histórico!');

      handleSaveProject({
        videos: newVideos,
        videoUrl: newVideoUrl,
        videoStoragePath: newVideoStoragePath,
        lastVideoMetadata: newLastMetadata,
      });
      return;
    }

    try {
      if (video.storagePath) {
        await safeDeleteObject(video.storagePath);
      }

      const newVideos = videos.filter((v) => v.url !== video.url);
      setVideos(newVideos);

      let newVideoUrl = videoUrl;
      let newVideoStoragePath = videoStoragePath;
      let newLastMetadata = lastVideoMetadata;

      if (videoUrl === video.url) {
        newVideoUrl = newVideos.length > 0 ? newVideos[newVideos.length - 1].url : null;
        newVideoStoragePath =
          newVideos.length > 0 ? newVideos[newVideos.length - 1].storagePath : null;
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
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(config));
    } catch (err) {
      console.warn('[AutoSave] localStorage write failed:', err);
    }
  }, [config]);

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
      // Sanity-check the restored object has the nested shapes downstream
      // code reads from. If anything is missing we drop the draft rather
      // than crash the render tree.
      const looksValid =
        parsed &&
        typeof parsed === 'object' &&
        parsed.copy &&
        typeof parsed.copy === 'object' &&
        parsed.copy.answers &&
        parsed.avatar &&
        parsed.edit &&
        parsed.format;
      if (looksValid) {
        setConfig(parsed);
        toast.success('Rascunho restaurado da sessão anterior.', { icon: '💾' });
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
          ...prev[section],
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
  const [pendingNewSubproject, setPendingNewSubproject] = useState<Project | null>(null);
  const [copyFieldsApplied, setCopyFieldsApplied] = useState(false);
  const [personasSaved, setPersonasSaved] = useState(false);

  useEffect(() => {
    // Quando carrega projeto que já tem personas salvos, marca como salvo
    if (config.copy?.answers?.savedPersonas) {
      try {
        const saved = JSON.parse(config.copy.answers.savedPersonas);
        if (Array.isArray(saved) && saved.length > 0) {
          setPersonasSaved(true);
          // Se ainda não tem generatedPersona em memória, restaura dos saved
          if (!generatedPersona?.personas) {
            setGeneratedPersona({ personas: saved });
          }
        }
      } catch (e) {}
    } else {
      setPersonasSaved(false);
    }
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
  const [zapState, setZapState] = useState<{
    status: 'idle' | 'uploading' | 'rendering' | 'completed' | 'error';
    step: string;
    progress: number;
    videoId?: string;
    taskId?: string;
    finalVideoUrl?: string;
    originalVideoUrl?: string;
    versions: string[];
    videoFormat: '16:9' | '1:1' | '9:16';
  }>({
    status: 'idle',
    step: '',
    progress: 0,
    versions: [],
    videoFormat: '9:16',
  });
  const [zapVideoUrl, setZapVideoUrl] = useState<string | null>(null);
  const [zapTemplateId, setZapTemplateId] = useState<string>('');
  const [zapBrollPercent, setZapBrollPercent] = useState<number>(10);
  const [zapEmoji, setZapEmoji] = useState<boolean>(false);
  const [zapAnimation, setZapAnimation] = useState<boolean>(true);
  const [zapEmphasizeKeywords, setZapEmphasizeKeywords] = useState<boolean>(true);
  const [zapSilenceRemoval, setZapSilenceRemoval] = useState<number>(0);
  const [zapLanguage, setZapLanguage] = useState<string>('en');
  // Estados de personalização da legenda (Edição Zap)
  const [zapVideoFormat, setZapVideoFormat] = useState<'auto' | '9:16' | '1:1' | '16:9'>('auto');
  const [zapSubtitleTop, setZapSubtitleTop] = useState<number>(65);
  const [zapFontUppercase, setZapFontUppercase] = useState<boolean>(false);
  const [zapFontSize, setZapFontSize] = useState<number>(26);
  const [zapDisplayWords, setZapDisplayWords] = useState<number>(4);
  // Independent color controls for Edição Zap subtitles. Sent to ZapCap as
  // styleOptions.fontColor / styleOptions.strokeColor + highlight colors.
  // Empty string means "use template default" (don't send).
  const [zapFontColor, setZapFontColor] = useState<string>('#FFFFFF');
  const [zapStrokeColor, setZapStrokeColor] = useState<string>('#000000');
  const [zapUseCustomHighlight, setZapUseCustomHighlight] = useState<boolean>(false);
  const [zapHl1, setZapHl1] = useState<string>('#FFD700');
  const [zapHl2, setZapHl2] = useState<string>('#FFFFFF');
  const [zapHl3, setZapHl3] = useState<string>('#00FF7F');
  const zapPollRef = useRef<NodeJS.Timeout | null>(null);
  const isZapRenderingRef = useRef(false);
  // True while we're auto-retrying after a ZapCap failure with b-rolls
  // disabled. Stops us from looping if the retry ALSO fails.
  const zapAutoRetryRef = useRef(false);

  // Avatar tab mode: 'body' (default — corpo do vídeo) or 'hook' (gancho).
  // The toggle lives at the top of the Avatar tab; the ref lets the HeyGen
  // polling callback know which slot to write to when generation finishes
  // (the closure may outlive the user toggling back).
  const [avatarMode, setAvatarMode] = useState<'body' | 'hook'>('body');
  const avatarModeRef = useRef<'body' | 'hook'>('body');
  useEffect(() => {
    avatarModeRef.current = avatarMode;
  }, [avatarMode]);

  // Edição Zap tab mode — same pattern as avatarMode. Body versions live
  // in config.edit.zapVersions (existing); hook versions live in
  // config.edit.zapHookVersions (new). The ZapCap polling/intercut
  // callbacks read editZapModeRef so they write to the correct slot
  // even if the user toggled away mid-render.
  const [editZapMode, setEditZapMode] = useState<'body' | 'hook'>('body');
  const editZapModeRef = useRef<'body' | 'hook'>('body');
  useEffect(() => {
    editZapModeRef.current = editZapMode;
  }, [editZapMode]);
  const [joinRendering, setJoinRendering] = useState(false);
  // Picker state for the "Juntar" feature in Edição Zap. Holds the URL of
  // the hook + body version the user picked. Empty string means "use the
  // latest of each" (the default).
  const [selectedJoinHookUrl, setSelectedJoinHookUrl] = useState<string>('');
  const [selectedJoinBodyUrl, setSelectedJoinBodyUrl] = useState<string>('');

  // Project-level flag: does this project use a separate hook? Defaults to
  // true when the field is missing (backward-compat with older projects).
  // When false: hook-visual step is skipped in navigation, hook-mode
  // toggles in Voz/Avatar/Edição Zap hide, Juntar button hides.
  const useHookFlow = (config as any).useHook !== false;
  const setUseHookFlow = (next: boolean) => {
    setConfig((prev) => ({ ...(prev as any), useHook: next } as any));
    handleSaveProject({ useHook: next } as any);
    if (!next) {
      // Snap any active hook modes back to body so nothing references the
      // hidden side after the flag flips.
      setAvatarMode('body');
      setEditZapMode('body');
      setVoiceSource('copy');
    }
  };

  // Headline modal state (Meta-style colored bar at the top of the video).
  // Only used in Edição Zap hook mode. headlineSourceUrl=null means closed.
  const [headlineSourceUrl, setHeadlineSourceUrl] = useState<string | null>(null);
  const [headlineText, setHeadlineText] = useState<string>('');
  const [headlineBgColor, setHeadlineBgColor] = useState<string>('#000000');
  const [headlineTextColor, setHeadlineTextColor] = useState<string>('#FFFFFF');
  const [headlineStrokeColor, setHeadlineStrokeColor] = useState<string>('#000000');
  const [headlineStrokeWidth, setHeadlineStrokeWidth] = useState<number>(0);
  const [headlineHl1, setHeadlineHl1] = useState<string>('#FFD700');
  const [headlineHl2, setHeadlineHl2] = useState<string>('#FF3B30');
  const [headlineHl3, setHeadlineHl3] = useState<string>('#00FF7F');
  const [headlineBgHl1, setHeadlineBgHl1] = useState<string>('#FF3B30');
  const [headlineBgHl2, setHeadlineBgHl2] = useState<string>('#FFD700');
  const [headlineBgHl3, setHeadlineBgHl3] = useState<string>('#0066FF');
  // Per-word styling. tc = text color index (0|1|2|3, 0=default), bg = bg
  // highlight index (same). Indexed by word position when text is split
  // on whitespace.
  const [headlineWordStyles, setHeadlineWordStyles] = useState<
    Array<{ tc: number; bg: number }>
  >([]);
  // Optional second headline that replaces the first mid-clip.
  // When enabled, switchPct (10-90) controls the % of the video duration
  // where headline 2 takes over from headline 1.
  const [headline2Enabled, setHeadline2Enabled] = useState<boolean>(false);
  const [headlineSwitchPct, setHeadlineSwitchPct] = useState<number>(50);
  // When true, backend transcribes the audio + matches each headline text to
  // the spoken transcript so headlines appear exactly when the avatar says
  // them. Replaces the manual switchPct slider.
  const [headlineAutoTime, setHeadlineAutoTime] = useState<boolean>(false);
  // Dimensions of the source video being edited — used to make the preview
  // exactly proportional to the actual rendered output (so what you see
  // in the modal matches what comes out of FFmpeg).
  const [headlineSourceDims, setHeadlineSourceDims] = useState<{
    width: number;
    height: number;
  } | null>(null);
  useEffect(() => {
    if (!headlineSourceUrl) {
      setHeadlineSourceDims(null);
      return;
    }
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.crossOrigin = headlineSourceUrl.includes('generativelanguage.googleapis.com')
      ? 'anonymous'
      : '';
    v.onloadedmetadata = () => {
      if (v.videoWidth && v.videoHeight) {
        setHeadlineSourceDims({ width: v.videoWidth, height: v.videoHeight });
      }
    };
    v.src = headlineSourceUrl;
  }, [headlineSourceUrl]);
  const [headline2Text, setHeadline2Text] = useState<string>('');
  const [headline2BgColor, setHeadline2BgColor] = useState<string>('#000000');
  const [headline2WordStyles, setHeadline2WordStyles] = useState<
    Array<{ tc: number; bg: number }>
  >([]);
  const [headlineFontSize, setHeadlineFontSize] = useState<number>(60);
  const [headlineBarHeightPct, setHeadlineBarHeightPct] = useState<number>(13);
  const [headlineRendering, setHeadlineRendering] = useState(false);

  // Intercut modal state (alternating avatar / black-screen-with-text cuts).
  // intercutSourceUrl = null means the modal is closed.
  const [intercutSourceUrl, setIntercutSourceUrl] = useState<string | null>(null);
  const [intercutAvatarSec, setIntercutAvatarSec] = useState<number>(15);
  const [intercutBlackSec, setIntercutBlackSec] = useState<number>(20);
  const [intercutFontSize, setIntercutFontSize] = useState<number>(64);
  const [intercutTexts, setIntercutTexts] = useState<string[]>(['', '', '', '']);
  const [intercutRendering, setIntercutRendering] = useState(false);

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
  const [viewingVariant, setViewingVariant] = useState<ProjectVariant | null>(null);
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

  useEffect(() => {
    localStorage.setItem('avatarFilters_gender', avatarFilters.gender);
    localStorage.setItem('avatarFilters_ages', JSON.stringify(avatarFilters.ages));
    localStorage.setItem('avatarFilters_styles', JSON.stringify(avatarFilters.styles));
    localStorage.setItem('avatarFilters_ethnicities', JSON.stringify(avatarFilters.ethnicities));
    localStorage.setItem('avatarFilters_sort', avatarFilters.sort);
  }, [avatarFilters]);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

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
      ? config.copy.generatedScript.split('[AVATAR]:')[1].split('[SCENE]:')[0].trim()
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

  useEffect(() => {
    if (!user) {
      setProjects([]);
      return;
    }

    const q = query(
      collection(db, 'projects'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const projectsData = snapshot.docs.map((doc) => {
        const data = doc.data() as any;

        // Migration: ensure hookVisual exists in config
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

        return {
          id: doc.id,
          ...data,
        } as Project;
      });
      setProjects(projectsData);
    });

    return () => unsubscribe();
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

  const handleCreateProject = async () => {
    if (!user || !newProjectName.trim()) return;

    setIsSaving(true);
    try {
      const projectData = {
        userId: user.uid,
        name: newProjectName,
        type: newProjectType,
        config: {
          angle: 'podcast',
          copy: {
            mode: 'questions',
            subMode: copySubMode,
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
          audios: [],
        },
        createdAt: serverTimestamp(),
      };

      const docRef = await addDoc(collection(db, 'projects'), projectData);
      setCurrentProjectId(docRef.id);
      setConfig(projectData.config);
      setShowNewProjectModal(false);
      setNewProjectName('');
      const firstStepByType: Record<string, any> = {
        complete: 'copy',
        copy: 'copy',
        video: 'voz-premium',
        editing: 'edit2',
      };
      setCurrentStep(firstStepByType[newProjectType] || 'copy');
    } catch (err) {
      console.error('Error creating project:', err);
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
        },
      };
      await handleSaveProject(overrideConfig);
      toast.success('3 Personas salvos no projeto! Agora escolha um para enviar à Copy.');
    } catch (e) {
      console.error('Erro ao persistir personas:', e);
      toast.error('Personas salvos localmente, mas houve erro ao gravar no servidor.');
    }
  };

  const handleSelectPersona = (persona: any) => {
    const personaForAutoPopulate = {
      persona: `${persona.name}. ${persona.description}`,
      age: persona.age,
      gender: persona.gender,
      awarenessLevel: persona.awarenessLevel,
      awarenessReason: persona.awarenessReason,
      mainPain: persona.mainPain,
      triedBefore: persona.currentSituation,
      desiredTransformation: persona.strongestPromise,
      productName: config.copy.answers.product || '',
      productProblem: config.copy.answers.whatItDoes || '',
      productResult: persona.strongestPromise,
    };
    updateConfig('copy', 'answers', 'discoveredPersona', JSON.stringify(personaForAutoPopulate));
    updateConfig('copy', 'answers', 'selectedPersonaFull', JSON.stringify(persona));
    // Pula o pop-up "unknown" e vai direto pros campos da Copy
    setCopyDiscoveryMode('done');
    setConfig((prev) => ({
      ...prev,
      copy: {
        ...prev.copy,
        discoveryMode: 'done',
      },
    }));
    // Reset o flag de campos aplicados — usuário precisa clicar "Atualizar Campos" pra preencher
    setCopyFieldsApplied(false);
    toast.success(
      `Persona "${persona.name}" enviado! Clique em "Atualizar Campos da Copy" para preencher.`
    );
    setCurrentStep('copy');
  };

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

  const handleSaveProject = async (overridesOrEvent?: Partial<AdConfig> | React.MouseEvent) => {
    // Robust event detection to prevent circular structure errors
    const isEvent = !!(
      overridesOrEvent &&
      typeof overridesOrEvent === 'object' &&
      ('nativeEvent' in overridesOrEvent ||
        'target' in overridesOrEvent ||
        ('type' in overridesOrEvent && (overridesOrEvent as any).type.includes('click')))
    );

    const overrides = isEvent ? {} : (overridesOrEvent as Partial<AdConfig>) || {};
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
      const projectSnap = await getDoc(projectRef);
      let variants = [];
      let existingVariant = null;

      if (projectSnap.exists()) {
        const data = projectSnap.data();
        variants = data.variants || [];
        if (currentVariantId) {
          existingVariant = variants.find((v: any) => v.id === currentVariantId);
        }
      }

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
        return cloned;
      };

      const newVariant: ProjectVariant = {
        id: variantId,
        name: awarenessLevel,
        config: configToSave,
        createdAt: existingVariant ? existingVariant.createdAt : new Date(),
      };

      if (currentVariantId) {
        const index = variants.findIndex((v: any) => v.id === currentVariantId);
        if (index !== -1) {
          variants[index] = newVariant;
        } else {
          variants.push(newVariant);
        }
      } else {
        variants.push(newVariant);
        setCurrentVariantId(variantId);
      }

      // Keep only last 5 variants to save space
      const prunedVariants = variants.slice(-5).map((v: ProjectVariant) => ({
        ...v,
        config: cleanConfigForStorage(v.config),
      }));

      await setDoc(
        projectRef,
        {
          config: cleanConfigForStorage(configToSave),
          variants: prunedVariants,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      addLog('PROJETO_SALVO');
      if (process.env.NODE_ENV !== 'production') console.log('VOICE_SAVE_COMPLETED');
      toast.success(
        currentVariantId
          ? `Versão "${awarenessLevel}" atualizada com sucesso!`
          : `Versão "${awarenessLevel}" arquivada com sucesso!`
      );
    } catch (err) {
      console.error('Error saving project:', err);
      setError('Falha ao salvar projeto.');
    } finally {
      setIsSaving(false);
      setHasUnsavedCopyChanges(false);
    }
  };

  const handleLoadVariant = async (variant: ProjectVariant, step: Step = 'copy') => {
    if (process.env.NODE_ENV !== 'production') console.log('[Debug] Loading Variant:', variant.id);
    setIsProjectLoading(true);

    try {
      // Set project context
      const parentProject = projects.find((p) => p.variants?.some((v) => v.id === variant.id));
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
      const loadedConfig = hydrateProjectConfig({ ...variant.config });

      if (process.env.NODE_ENV !== 'production') {
        console.log('[Debug] Variant Config Hydrated:', {
          discoveryMode: loadedConfig.copy.discoveryMode,
          hasAnswers: Object.keys(loadedConfig.copy.answers || {}).length,
          hasScript: !!loadedConfig.copy.generatedScript,
        });
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
      setCurrentStep(step);
      toast.success(`Versão "${variant.name}" carregada!`);
    } catch (err) {
      console.error('[Debug] Error loading variant:', err);
      toast.error('Erro ao carregar versão.');
    } finally {
      setIsProjectLoading(false);
    }
  };

  const handleRenameVariant = async (projectId: string, variantId: string, newName: string) => {
    if (!newName.trim()) {
      toast.error('Nome não pode ser vazio.');
      return;
    }
    try {
      const projectRef = doc(db, 'projects', projectId);
      const projectSnap = await getDoc(projectRef);
      if (projectSnap.exists()) {
        const data = projectSnap.data();
        const variants = (data.variants || []).map((v: any) =>
          v.id === variantId ? { ...v, name: newName.trim() } : v
        );
        await setDoc(projectRef, { variants }, { merge: true });
        toast.success('Subprojeto renomeado!');
      }
    } catch (err) {
      console.error('Error renaming variant:', err);
      toast.error('Falha ao renomear subprojeto.');
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
                  const projectRef = doc(db, 'projects', projectId);
                  const projectSnap = await getDoc(projectRef);
                  if (projectSnap.exists()) {
                    const data = projectSnap.data();
                    const variants = (data.variants || []).filter((v: any) => v.id !== variantId);
                    await setDoc(projectRef, { variants }, { merge: true });
                    if (currentVariantId === variantId) {
                      setCurrentVariantId(null);
                    }
                    toast.success('Versão excluída!');
                  }
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

  // --- Auto-save layer 2: Firestore debounced auto-save ---
  // Once a project is loaded (currentProjectId is set), every change to
  // config schedules a Firestore save 2 seconds later. If config changes
  // again before the timer fires, the previous save is cancelled and a
  // new one is scheduled — so we batch fast typing into one write.
  useEffect(() => {
    if (!currentProjectId || !user || isProjectLoading) return;
    const t = setTimeout(() => {
      handleSaveProject().catch((err) => {
        console.warn('[AutoSave] Firestore save failed:', err);
      });
    }, 2000);
    return () => clearTimeout(t);
    // handleSaveProject is intentionally NOT in deps — it changes every
    // render (no useCallback), and we don't want to reset the timer just
    // because of an unrelated re-render. config + currentProjectId + user
    // are what should trigger a save.

    // videos / audios / videoUrl / audioUrl are top-level state arrays that
    // handleSaveProject reads via closure; include them here so the timer
    // also re-arms when only those change (e.g. ZapCap finishes and pushes
    // the edited video into the videos array without touching config).
  }, [config, videos, audios, videoUrl, audioUrl, currentProjectId, user, isProjectLoading]);

  const handleDeleteProject = (projectId: string) => {
    setDeleteProjectConfirmId(projectId);
  };

  const confirmDeleteProject = async () => {
    if (!deleteProjectConfirmId) return;
    const projectId = deleteProjectConfirmId;
    setDeleteProjectConfirmId(null);
    try {
      await deleteDoc(doc(db, 'projects', projectId));
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

    try {
      setCurrentProjectId(project.id);

      const loadedConfig = hydrateProjectConfig({ ...project.config });

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

      const firstStepByType: Record<string, string> = {
        complete: 'copy',
        copy: 'copy',
        video: 'voz-premium',
        editing: 'edit2',
      };
      const resolvedStep = step || firstStepByType[project.type] || 'copy';
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
    // Em vez de criar o subprojeto direto, abre o modal pra perguntar sobre persona primeiro
    setPendingNewSubproject(project);
  };

  const proceedNewSubproject = (project: Project, personaPath: 'known' | 'discover') => {
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

    const finalDiscoveryMode = personaPath === 'known' ? 'known' : 'unknown';
    setCopyDiscoveryMode(finalDiscoveryMode);
    newConfig.copy.discoveryMode = finalDiscoveryMode;

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

    if (personaPath === 'discover') {
      setCurrentStep('persona');
      toast.success('Iniciando novo subprojeto! Vamos identificar o persona primeiro.');
    } else {
      setCurrentStep('copy');
      toast.success('Iniciando novo subprojeto!');
    }
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
      const selectedStyle = AD_STYLES.find((s) => s.label === config.copy.answers.estiloAnuncio);
      const styleWithDesc = selectedStyle
        ? `${selectedStyle.label} — ${selectedStyle.desc}`
        : config.copy.answers.estiloAnuncio;

      const result = await generateAdCopyWithClaude(
        { ...config.copy.answers, estiloAnuncio: styleWithDesc },
        config.copy.mode,
        config.angle,
        config.copy.scriptLength,
        config.copy.targetWordCount,
        config.copy.hookSelecionado || ''
      );
      if (!result) throw new Error('A IA retornou uma resposta vazia.');

      setConfig((prev) => ({
        ...prev,
        copy: {
          ...prev.copy,
          generatedScript: result.script || result,
          optimizedScript: '',
        },
      }));
      setHasUnsavedCopyChanges(true);
      toast.success('Copy gerada com sucesso!');
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
            if (timeInStatus > 360) {
              isStuck = true;
              stuckReason = 'No status change detected for >6m';
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
                  if (avatarModeRef.current === 'hook') {
                    setConfig((prev) => {
                      const prevHookVideos =
                        ((prev.copy as any)?.hookVideos as typeof newVideo[] | undefined) || [];
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
                if (avatarModeRef.current === 'hook') {
                  setConfig((prev) => {
                    const prevHookVideos =
                      ((prev.copy as any)?.hookVideos as typeof newVideo[] | undefined) || [];
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

                // Auto-save after video generation
                handleSaveProject({
                  videoUrl: result.url,
                  videoStoragePath: result.path,
                  videos: [...(videos || []), newVideo],
                  lastVideoMetadata: lastVideoMetadata
                    ? {
                        ...lastVideoMetadata,
                        url: result.url,
                        status: 'completed',
                      }
                    : undefined,
                  generationStage: 'video_ready',
                });
              });
            } else {
              setVideoUrl(statusData.video_url);
              setGenerationStage('video_ready');
              setLoading(false);
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

  const handleGenerateVideo = async (forceRegenerate = false) => {
    if (!isOnline) {
      setError('Você está offline. Verifique sua conexão com a internet.');
      return;
    }

    if (audioUrl && audioUrl.startsWith('blob:')) {
      setError(
        'O áudio ainda está sendo processado ou falhou no upload. Tente gerar o áudio novamente.'
      );
      return;
    }

    if (!audioUrl && !isTestMode) {
      setError('Áudio não encontrado. Por favor, gere o áudio no passo anterior.');
      return;
    }

    setLoading(true);
    setError(null);

    // Check if video already exists and matches current config
    if (!forceRegenerate && config.lastVideoMetadata && config.videoUrl) {
      let avatarScript = (config.copy.generatedScript || '').includes('[AVATAR]:')
        ? config.copy.generatedScript.split('[AVATAR]:')[1].split('[SCENE]:')[0].trim()
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
        ? config.copy.generatedScript.split('[AVATAR]:')[1].split('[SCENE]:')[0].trim()
        : config.copy.generatedScript || '';

      if (isTestMode) {
        avatarScript = 'Olá! Este é um teste rápido de 3 segundos para validar a geração.';
      }

      if (!avatarScript || avatarScript.trim() === '') {
        throw new Error('Script está vazio. Por favor, gere a copy primeiro.');
      }

      setGenerationStage('video');
      addLog('VIDEO_STARTED');
      console.log(`[Video Generation] Starting with Aspect Ratio: ${config.format.aspectRatio}`);

      // If we are in 'square' mode, we generate at native aspect ratio and then crop locally
      // to support the manual cropOffset.
      let requestedRatioForHeyGen = config.format.aspectRatio;
      if (config.avatar.avatarFormat === 'square') {
        // Determine native ratio - we default to Horizontal 16:9 as HeyGen metadata is unreliable
        const avatarObj = heygenAvatars.find((a) => a.avatar_id === config.avatar.faceId);
        const isHorizontal = avatarObj?.aspect_ratio !== '9:16';
        requestedRatioForHeyGen = isHorizontal ? '16:9' : '9:16';
      }

      const startTime = Date.now();
      // In hook mode, the audio source must be the hook audio (the one the
      // user generated in the Voz tab with the toggle on "Gancho").
      // We also override the script with hookSelecionado so HeyGen's native
      // TTS fallback path produces hook content if the audio is missing.
      const isHookGen = avatarModeRef.current === 'hook';
      const hookAudioUrl =
        ((config.copy as any)?.hookAudioUrl as string | undefined) || '';
      const effectiveAudioUrl = isHookGen ? hookAudioUrl || audioUrl : audioUrl;
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
        title: isTestMode
          ? `Test Clip - ${Date.now()}`
          : isHookGen
            ? `Hook Clip - ${config.angle}`
            : `Video Ad - ${config.angle}`,
      };
      const response = await fetch('/api/heygen/generate', {
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

      // Auto-save immediately to persist videoId
      handleSaveProject({
        lastVideoMetadata: initialMetadata,
        generationStage: 'video',
      });

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
      const candidate = STEPS[i].id;
      if (!useHookFlow && candidate === 'hook-visual') continue;
      if (canNavigateTo(candidate)) {
        setCurrentStep(candidate);
      }
      return;
    }
  };

  const prevStep = () => {
    const currentIndex = STEPS.findIndex((s) => s.id === currentStep);
    for (let i = currentIndex - 1; i >= 0; i--) {
      const candidate = STEPS[i].id;
      if (!useHookFlow && candidate === 'hook-visual') continue;
      setCurrentStep(candidate);
      return;
    }
  };

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


  const renderPersonaStep = () => {
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

    return (
      <div className="max-w-[1100px] mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
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

        {/* ETAPA 1 — Produto */}
        <div className="bg-white p-6 md:p-8 rounded-[32px] border-2 border-gray-100 shadow-sm space-y-5">
          <div className="flex items-center gap-3">
            <span className="px-3 py-1 bg-blue-600 text-white rounded-full text-[10px] font-black uppercase tracking-widest">
              Etapa 1
            </span>
            <h4 className="text-lg font-black text-gray-900">Sobre o produto</h4>
          </div>

          {/* P1 */}
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

          {/* P2 */}
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
                      : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300'
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* P3 */}
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

          {/* P4 */}
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

          {/* Comentário opcional */}
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

          {/* P5 — Urgência */}
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
                      : 'bg-white border-gray-100 hover:border-blue-200'
                  )}
                >
                  <div className="text-sm font-black text-gray-900">{opt.label}</div>
                  <div className="text-[10px] text-gray-500 font-bold">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* P6 — Diferenciais */}
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
                      : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300'
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

          {/* P7 — Tried Before */}
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
                      : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300'
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* P8 — Capacidade de pagar */}
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
                      : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300'
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* P9 — Desejo Oculto */}
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
                      : 'bg-white border-gray-100 hover:border-blue-200'
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
          onClick={() => handleGeneratePersona(a as any)}
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
                      rankColor === 'gray' && 'border-gray-200'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={cn(
                          'px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest',
                          rankColor === 'blue' && 'bg-blue-600 text-white',
                          rankColor === 'purple' && 'bg-purple-400 text-white',
                          rankColor === 'gray' && 'bg-gray-200 text-gray-700'
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
                        <span className="text-gray-700 italic">
                          {p.whyMainOrSecondaryOrTertiary}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleSelectPersona(p)}
                      disabled={!personasSaved}
                      className={cn(
                        'w-full mt-3 py-3 rounded-2xl font-black uppercase tracking-widest text-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed',
                        rankColor === 'blue' && 'bg-blue-600 text-white hover:bg-blue-700',
                        rankColor === 'purple' && 'bg-purple-500 text-white hover:bg-purple-600',
                        rankColor === 'gray' && 'bg-gray-900 text-white hover:bg-black'
                      )}
                    >
                      {personasSaved ? 'Enviar este Persona pra Copy →' : '🔒 Salve os 3 primeiro'}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Botão para salvar os 3 personas no projeto */}
            <div className="pt-4">
              <button
                onClick={handleSavePersonas}
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
  };

  const renderCopyStep = () => {
    const sections = COPY_SECTIONS;

    const modes = [
      { id: 'questions', label: 'Gerar com IA (Q&A)', icon: Sparkles },
      { id: 'improve', label: 'Melhorar minha copy', icon: RefreshCw },
      { id: 'as-is', label: 'Usar como está', icon: CheckCircle2 },
    ];

    return (
      <div className="space-y-8 max-w-[1600px] mx-auto pb-20 overflow-x-hidden w-full">
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
                  setConfig((prev) => ({
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
                    <p className="font-black text-gray-900 uppercase italic">
                      Me ajuda a descobrir
                    </p>
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
                    placeholder:
                      'Ex: Em 30 dias a pessoa consegue quitar dívidas e começar a poupar',
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
                            setDiscoveryAnswers((prev) => ({
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
                      setConfig((prev) => ({
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
                          setConfig((prev) => ({
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
                        setConfig((prev) => ({
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
                      setConfig((prev) => ({
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
                    {(sections[0].questions || []).map((q) => {
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
                          {AD_STYLES.map((style) => {
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
                        <p className="text-sm font-bold text-gray-900">
                          ✨ Deixar a IA criar o CTA
                        </p>
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
                        <p className="text-sm font-bold text-gray-900">
                          ✏️ Escrever meu próprio CTA
                        </p>
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
                      {DURATION_OPTIONS.map((opt) => (
                        <button
                          key={opt.label}
                          onClick={() => {
                            setConfig((prev) => ({
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
                            setConfig((prev) => ({
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
                          setConfig((prev) => ({
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

                                setConfig((prev) => ({
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
  };



  const renderAvatarStep = () => {
    let filteredAvatars = heygenAvatars.filter((a) => {
      const enrichment = AVATAR_ENRICHMENT[a.avatar_id] || {};
      const matchesSearch = a.avatar_name.toLowerCase().includes(avatarSearch.toLowerCase());
      const matchesGender =
        !avatarFilters.gender ||
        a.gender?.toLowerCase() === avatarFilters.gender.toLowerCase() ||
        enrichment.gender === avatarFilters.gender;

      const avatarName = a.avatar_name.toLowerCase();

      const checkNameMatch = (
        selectedItems: string[],
        filterType: keyof typeof HEYGEN_NAME_KEYWORDS
      ) => {
        if (selectedItems.length === 0) return true;
        const nameToCheck = avatarName.toLowerCase();
        return selectedItems.some((selectedItem) => {
          const keywords = (HEYGEN_NAME_KEYWORDS[filterType] as any)[selectedItem] || [];
          return keywords.some((kw: string) => nameToCheck.includes(kw.toLowerCase()));
        });
      };

      // Best effort matching
      const matchesAge = checkNameMatch(avatarFilters.ages, 'ages');
      const matchesStyle = checkNameMatch(avatarFilters.styles, 'styles');
      const matchesEthnicity = checkNameMatch(avatarFilters.ethnicities, 'ethnicities');

      return matchesSearch && matchesGender && matchesAge && matchesStyle && matchesEthnicity;
    });

    // Fallback: If strict filtering returns zero, but we HAVE selected filters,
    // we show a friendly message or fallback to search results only
    const hasActiveFilters =
      avatarFilters.ages.length > 0 ||
      avatarFilters.styles.length > 0 ||
      avatarFilters.ethnicities.length > 0;
    const actualFilteredCount = filteredAvatars.length;
    const isFallbackActive = actualFilteredCount === 0 && hasActiveFilters;

    if (isFallbackActive) {
      filteredAvatars = heygenAvatars.filter((a) => {
        const enrichment = AVATAR_ENRICHMENT[a.avatar_id] || {};
        const matchesSearch = avatarSearch
          ? a.avatar_name.toLowerCase().includes(avatarSearch.toLowerCase())
          : true;
        const matchesGender =
          !avatarFilters.gender ||
          a.gender?.toLowerCase() === avatarFilters.gender.toLowerCase() ||
          enrichment.gender === avatarFilters.gender;
        return matchesSearch && matchesGender;
      });
    }

    filteredAvatars = filteredAvatars.sort((a, b) => {
      if (avatarFilters.sort === 'name') return a.avatar_name.localeCompare(b.avatar_name);
      if (avatarFilters.sort === 'ads') {
        const enrichmentA = AVATAR_ENRICHMENT[a.avatar_id] || {};
        const enrichmentB = AVATAR_ENRICHMENT[b.avatar_id] || {};
        const aIsAds = enrichmentA.type === 'realistic';
        const bIsAds = enrichmentB.type === 'realistic';
        if (aIsAds && !bIsAds) return -1;
        if (!aIsAds && bIsAds) return 1;
        return a.avatar_name.localeCompare(b.avatar_name);
      }
      if (avatarFilters.sort === 'natural') {
        const enrichmentA = AVATAR_ENRICHMENT[a.avatar_id] || {};
        const enrichmentB = AVATAR_ENRICHMENT[b.avatar_id] || {};
        const aIsNatural = enrichmentA.type === 'realistic';
        const bIsNatural = enrichmentB.type === 'realistic';
        if (aIsNatural && !bIsNatural) return -1;
        if (!aIsNatural && bIsNatural) return 1;
        return a.avatar_name.localeCompare(b.avatar_name);
      }
      return 0;
    });

    const isHookMode = avatarMode === 'hook';
    const hookAudioUrl =
      ((config.copy as any)?.hookAudioUrl as string | undefined) || '';
    const hookAudioStoragePath =
      ((config.copy as any)?.hookAudioStoragePath as string | null | undefined) || null;
    const hookVideos =
      ((config.copy as any)?.hookVideos as typeof videos | undefined) || [];
    const hookVideoUrl =
      ((config.copy as any)?.hookVideoUrl as string | undefined) || '';
    const displayedAudioUrl = isHookMode ? hookAudioUrl : config.audioUrl;
    const displayedAudioStoragePath = isHookMode
      ? hookAudioStoragePath
      : config.audioStoragePath || null;
    // Big "current video" preview directly under the audio card. Same idea
    // as the gallery: in hook mode it must show the hook video, not the body's.
    const displayedVideoUrl = isHookMode ? hookVideoUrl : videoUrl;

    return (
      <div className="max-w-[1600px] mx-auto space-y-12">
        {/* Toggle: which side of the video are we producing? Hidden when
            the project doesn't use a separate hook. */}
        {useHookFlow && (
          <div className="bg-white p-2 rounded-2xl border-2 border-gray-100 shadow-sm flex gap-1">
            <button
              onClick={() => setAvatarMode('body')}
              className={`flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                !isHookMode
                  ? 'bg-gray-900 text-white shadow-md'
                  : 'text-gray-500 hover:bg-gray-50'
              }`}
            >
              Avatar do Corpo
              {(config.videos || []).length > 0 && (
                <span className="ml-2 text-[9px] opacity-70">
                  ({(config.videos || []).length})
                </span>
              )}
            </button>
            <button
              onClick={() => setAvatarMode('hook')}
              className={`flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                isHookMode
                  ? 'bg-amber-500 text-white shadow-md'
                  : 'text-gray-500 hover:bg-amber-50'
              }`}
            >
              Avatar do Gancho
              {hookVideos.length > 0 && (
                <span className="ml-2 text-[9px] opacity-70">({hookVideos.length})</span>
              )}
            </button>
          </div>
        )}

        {/* Áudio aprovado da Voz Premium */}
        {displayedAudioUrl && (
          <div
            className={`p-6 bg-white rounded-[40px] border-2 shadow-lg ${
              isHookMode ? 'border-amber-200' : 'border-blue-200'
            }`}
          >
            <div className="flex items-center gap-2 mb-4">
              <div
                className={`p-1.5 rounded-lg text-white ${
                  isHookMode ? 'bg-amber-500' : 'bg-blue-600'
                }`}
              >
                <Volume2 size={16} />
              </div>
              <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest">
                Áudio Aprovado {isHookMode ? '(Gancho)' : '(Corpo)'}
              </h3>
              <span className="ml-auto text-xs text-gray-400">vindo da Voz</span>
            </div>
            <div className="flex items-center gap-2">
              <audio controls src={displayedAudioUrl} className="w-full flex-1" />
              <button
                onClick={() => {
                  setAudioToDelete({
                    url: displayedAudioUrl as string,
                    storagePath: displayedAudioStoragePath,
                  });
                  setShowDeleteModal(true);
                }}
                className="p-2 text-gray-400 hover:text-red-500 transition-colors rounded-xl hover:bg-red-50 flex-shrink-0"
                title="Deletar áudio"
              >
                <Trash2 size={18} />
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-2 italic">
              {isHookMode
                ? 'Áudio do gancho. Para trocar, volte à aba Voz e ative "Voz do Gancho".'
                : 'Áudio do corpo. Para trocar, volte à aba Voz.'}
            </p>
          </div>
        )}
        {!displayedAudioUrl && (
          <div
            className={`p-6 rounded-[40px] border-2 border-dashed ${
              isHookMode ? 'border-amber-200 bg-amber-50/40' : 'border-blue-200 bg-blue-50/40'
            }`}
          >
            <p className="text-sm text-gray-600">
              {isHookMode
                ? '⚠ Você ainda não gerou o áudio do gancho. Vá em "Voz" → toggle "Voz do Gancho" → gerar.'
                : '⚠ Você ainda não gerou o áudio do corpo. Vá em "Voz" → gerar.'}
            </p>
          </div>
        )}

        {/* Video Generation Status */}
        {(loading || videoOp) && (
          <div className="p-8 bg-gray-900 rounded-[40px] border-4 border-blue-500/30 shadow-2xl relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-600/10 to-purple-600/10" />
            <div className="relative z-10 flex flex-col items-center text-center space-y-6">
              <div className="w-20 h-20 bg-blue-600 rounded-3xl flex items-center justify-center text-white shadow-xl shadow-blue-500/40 animate-pulse">
                <Video size={40} />
              </div>
              <div className="space-y-2">
                <h3 className="text-2xl font-black text-white uppercase tracking-tight">
                  {videoOp?.displayStatus || 'Iniciando...'}
                </h3>
                <p className="text-blue-200 font-medium text-sm">
                  {videoOp?.progress
                    ? `Progresso: ${videoOp.progress}%`
                    : 'Estamos preparando seu avatar...'}
                </p>
              </div>
              {videoOp?.progress !== undefined && (
                <div className="w-full max-w-xs bg-white/10 h-3 rounded-full overflow-hidden border border-white/10">
                  <motion.div
                    className="h-full bg-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.5)]"
                    initial={{ width: 0 }}
                    animate={{ width: `${videoOp.progress}%` }}
                  />
                </div>
              )}
              <div className="flex flex-wrap justify-center gap-4">
                <button
                  onClick={() => {
                    setLoading(false);
                    setVideoOp(null);
                    if (pollIntervalRef.current) {
                      clearInterval(pollIntervalRef.current);
                      pollIntervalRef.current = null;
                    }
                    setConfig((prev) => ({
                      ...prev,
                      lastVideoMetadata: null,
                      generationStage: 'idle',
                    }));
                    toast.success('Geração interrompida.');
                  }}
                  className="px-6 py-3 bg-white/10 text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-white/20 transition-all border border-white/10"
                >
                  Cancelar Geração
                </button>
              </div>
              <div className="flex flex-wrap justify-center gap-2 opacity-60">
                {logs.slice(-3).map((log, i) => (
                  <span
                    key={`recent-log-${i}`}
                    className="text-[10px] text-blue-100 font-mono bg-white/5 px-2 py-1 rounded border border-white/5"
                  >
                    {log}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ElevenLabs Config Modal */}
        <ElevenLabsConfigModal
          open={showElevenLabsConfig}
          apiKey={newElevenLabsKey}
          isTesting={isTestingKey}
          isUpdating={isUpdatingKey}
          onApiKeyChange={setNewElevenLabsKey}
          onTest={handleTestElevenLabsKey}
          onSave={handleUpdateElevenLabsKey}
          onClose={() => setShowElevenLabsConfig(false)}
        />
        <ConfirmModal
          open={showDeleteHistoryVideoModal && !!videoToDelete}
          title="Deletar do Histórico?"
          message="Este vídeo será removido permanentemente do seu histórico e do armazenamento."
          confirmLabel="Deletar"
          onCancel={() => {
            setShowDeleteHistoryVideoModal(false);
            setVideoToDelete(null);
          }}
          onConfirm={async () => {
            if (!videoToDelete) return;
            await handleDeleteVideoFromArray(videoToDelete);
            setShowDeleteHistoryVideoModal(false);
            setVideoToDelete(null);
          }}
        />

        {/* Fallback Option */}
        {!displayedVideoUrl && !loading && !videoOp && (
          <div className="bg-amber-50 p-6 rounded-[32px] border-2 border-amber-100 flex items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-amber-100 rounded-2xl text-amber-600">
                <RefreshCw size={24} />
              </div>
              <div className="space-y-1">
                <h4 className="text-lg font-black text-amber-900">
                  Modo de Fallback (Diagnóstico)
                </h4>
                <p className="text-amber-700 text-sm font-medium">
                  Se a geração com áudio externo falhar, use esta opção para testar com uma voz
                  nativa do HeyGen.
                </p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={useNativeFallback}
                onChange={(e) => setUseNativeFallback(e.target.checked)}
              />
              <div className="w-14 h-8 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-amber-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-amber-600"></div>
            </label>
          </div>
        )}
        {displayedVideoUrl && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div
              className={cn(
                'bg-black rounded-[40px] overflow-hidden shadow-2xl border-4 border-white relative group mx-auto transition-all duration-500',
                config.format.aspectRatio === '9:16'
                  ? 'aspect-[9/16] max-w-[400px]'
                  : config.format.aspectRatio === '4:5'
                    ? 'aspect-[4/5] max-w-[450px]'
                    : config.format.aspectRatio === '1:1'
                      ? 'aspect-square max-w-[500px]'
                      : 'aspect-video w-full'
              )}
            >
              <video
                src={
                  getAuthorizedUrl(displayedVideoUrl || '', platformApiKey || undefined) ||
                  undefined
                }
                controls
                className="w-full h-full object-contain"
              />
              <div
                className={`absolute top-3 left-3 text-white text-[9px] font-black px-2 py-1 rounded uppercase tracking-widest ${
                  isHookMode ? 'bg-amber-500' : 'bg-blue-600'
                }`}
              >
                {isHookMode ? 'Vídeo do Gancho' : 'Vídeo do Corpo'}
              </div>
              <div className="absolute top-6 right-6 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => handleGenerateVideo(true)}
                  className="p-3 bg-white/90 backdrop-blur-md text-gray-900 rounded-2xl shadow-xl hover:bg-white transition-all"
                  title="Regerar"
                >
                  <RefreshCw size={20} />
                </button>
                <button
                  onClick={() => setShowDeleteVideoModal(true)}
                  className="p-3 bg-white/90 backdrop-blur-md text-red-600 rounded-2xl shadow-xl hover:bg-red-50 transition-all"
                  title="Deletar Vídeo"
                >
                  <Trash2 size={20} />
                </button>
              </div>
            </div>

            {/* Delete Video Confirmation Modal */}
            <ConfirmModal
              open={showDeleteVideoModal}
              title="Deletar Vídeo?"
              message="Esta ação não pode ser desfeita. O vídeo será removido do Firebase e do projeto."
              confirmLabel="Deletar"
              onCancel={() => setShowDeleteVideoModal(false)}
              onConfirm={() => handleDeleteVideo()}
            />

            <div className="flex flex-col md:flex-row gap-4">
              <button
                onClick={() => {
                  setVideoUrl(null);
                  setVideoStoragePath(null);
                  setGenerationStage('avatar');
                  setCurrentStep('avatar');
                  // Ensure current config for next video starts fresh but keeps previous videos history
                  setConfig((prev) => ({
                    ...prev,
                    videoUrl: null,
                    videoStoragePath: null,
                    lastVideoMetadata: null,
                    edit: { ...prev.edit, timelineEdits: [] },
                  }));
                }}
                className="flex-1 px-8 py-5 bg-purple-600 text-white rounded-2xl font-black uppercase tracking-widest hover:bg-purple-700 transition-all flex items-center justify-center gap-3 shadow-xl shadow-purple-100"
              >
                <Plus size={20} />
                Gerar Outro Vídeo
              </button>
              <button
                onClick={() => handleGenerateVideo(true)}
                className="flex-1 px-8 py-5 bg-white border-2 border-gray-100 text-gray-900 rounded-2xl font-black uppercase tracking-widest hover:bg-gray-50 transition-all flex items-center justify-center gap-3"
              >
                <RefreshCw size={20} />
                Regerar Atual
              </button>
              <button
                onClick={() => setCurrentStep('edit-zap')}
                className="flex-1 px-8 py-5 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest hover:bg-blue-700 transition-all flex items-center justify-center gap-3 shadow-xl shadow-blue-100"
              >
                Continuar para Edição Zap
                <ChevronRight size={20} />
              </button>
              <button
                onClick={() => setCurrentStep('edit2')}
                className="flex-1 px-8 py-5 bg-purple-600 text-white rounded-2xl font-black uppercase tracking-widest hover:bg-purple-700 transition-all flex items-center justify-center gap-3 shadow-xl shadow-purple-100"
              >
                Continuar para Edição Premium
                <ChevronRight size={20} />
              </button>
            </div>
          </motion.div>
        )}

        {/* Video History List */}
        {(isHookMode ? hookVideos : videos).length > 0 && (
          <div className="bg-white p-8 rounded-[40px] border-2 border-gray-100 shadow-xl space-y-6">
            <div className="flex items-center justify-between border-b border-gray-50 pb-6">
              <div className="space-y-1">
                <h3 className="text-xl font-black text-gray-900 uppercase tracking-tight flex items-center gap-2">
                  <Video size={20} className={isHookMode ? 'text-amber-500' : 'text-blue-600'} />
                  Histórico de Vídeos {isHookMode ? '(Gancho)' : '(Corpo)'}
                </h3>
                <p className="text-xs text-gray-400 font-medium">
                  Selecione o vídeo que deseja usar no projeto.
                </p>
              </div>
              <span className="px-3 py-1 bg-gray-100 text-gray-500 rounded-full text-[10px] font-black uppercase tracking-widest">
                {(isHookMode ? hookVideos : videos).length}{' '}
                {(isHookMode ? hookVideos : videos).length === 1 ? 'Vídeo' : 'Vídeos'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-start">
              {(isHookMode ? hookVideos : videos).map((video, idx) => (
                <div
                  key={`variant-video-${idx}-${video.url || 'no-url'}`}
                  onClick={() => {
                    // Route the "active video" to the slot matching the
                    // current mode — otherwise selecting a hook video would
                    // overwrite videoUrl (body state) and bleed across the
                    // toggle.
                    if (isHookMode) {
                      setConfig((prev) => ({
                        ...prev,
                        copy: {
                          ...prev.copy,
                          hookVideoUrl: video.url,
                          hookVideoStoragePath: video.storagePath,
                        } as any,
                        format: {
                          ...prev.format,
                          aspectRatio: (video.aspectRatio as any) || prev.format.aspectRatio,
                        },
                      }));
                    } else {
                      setVideoUrl(video.url);
                      setVideoStoragePath(video.storagePath);
                      setConfig((prev) => ({
                        ...prev,
                        videoUrl: video.url,
                        videoStoragePath: video.storagePath,
                        format: {
                          ...prev.format,
                          aspectRatio: (video.aspectRatio as any) || prev.format.aspectRatio,
                        },
                        avatar: {
                          ...prev.avatar,
                          scale: video.scale || prev.avatar.scale || 1.0,
                        },
                        edit: {
                          ...prev.edit,
                          timelineEdits: (video as any).timelineEdits || [],
                        },
                      }));
                    }
                    toast.success('Vídeo selecionado como ativo!');
                  }}
                  className={cn(
                    'group relative rounded-[32px] border-2 transition-all cursor-pointer overflow-hidden flex flex-col',
                    (isHookMode ? hookVideoUrl : videoUrl) === video.url
                      ? 'border-blue-600 bg-blue-50 shadow-lg'
                      : 'border-gray-100 bg-white hover:border-blue-200'
                  )}
                >
                  <div
                    className={cn(
                      'relative bg-black flex items-center justify-center w-full',
                      getVideoAspectRatioClass(video)
                    )}
                  >
                    <video
                      src={
                        getAuthorizedUrl(video.url || '', platformApiKey || undefined) || undefined
                      }
                      className="w-full h-full object-contain opacity-80 group-hover:opacity-100 transition-opacity"
                      referrerPolicy={
                        video.url?.includes('generativelanguage.googleapis.com')
                          ? 'no-referrer'
                          : undefined
                      }
                      crossOrigin={
                        video.url?.includes('generativelanguage.googleapis.com')
                          ? 'anonymous'
                          : undefined
                      }
                      onError={(e) => {
                        if (video.url?.startsWith('/generated/')) {
                          console.warn('[Video Expired] Grid Item:', video.url);
                          e.currentTarget.style.display = 'none';
                        } else {
                          console.error(
                            '[Video Error] Grid Item:',
                            e.currentTarget.error?.message,
                            video.url
                          );
                        }
                      }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                      <Play size={32} className="text-white fill-white" />
                    </div>
                    {(isHookMode ? hookVideoUrl : videoUrl) === video.url && (
                      <div className="absolute top-4 right-4 bg-blue-600 text-white p-1.5 rounded-full shadow-lg">
                        <CheckCircle2 size={16} />
                      </div>
                    )}
                    <div className="absolute bottom-2 left-2 flex gap-1">
                      <div className="px-2 py-0.5 bg-black/60 backdrop-blur-md text-white text-[8px] font-black rounded uppercase tracking-widest border border-white/10">
                        {video.aspectRatio || '9:16'}
                      </div>
                      {video.scale && (
                        <div className="px-2 py-0.5 bg-blue-600/80 backdrop-blur-md text-white text-[8px] font-black rounded uppercase tracking-widest border border-blue-400/20">
                          {video.scale.toFixed(1)}x
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="p-4 flex items-center justify-between">
                    <div className="space-y-0.5">
                      <p className="text-[10px] font-black text-gray-900 uppercase tracking-tight">
                        Vídeo {idx + 1}
                      </p>
                      <p className="text-[8px] text-gray-400 font-bold uppercase tracking-widest">
                        {new Date(video.createdAt).toLocaleDateString()} •{' '}
                        {new Date(video.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setVideoToDelete(video);
                        setShowDeleteHistoryVideoModal(true);
                      }}
                      className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-2xl font-black text-gray-900 tracking-tight">Escolher Avatar</h3>
            <div className="flex items-center gap-2 px-4 py-2 bg-purple-50 rounded-xl border border-purple-100">
              <User size={16} className="text-purple-600" />
              <span className="text-xs font-bold text-purple-700">HeyGen Ativo</span>
            </div>
          </div>

          <div className="bg-white p-6 rounded-[40px] border-2 border-gray-100 shadow-xl space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="md:col-span-2 relative">
                <Search
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
                  size={18}
                />
                <input
                  type="text"
                  placeholder="Buscar avatar por nome..."
                  value={avatarSearch || ''}
                  onChange={(e) => setAvatarSearch(e.target.value)}
                  className="w-full pl-12 pr-4 py-4 bg-gray-50 border-2 border-transparent focus:border-blue-600 focus:bg-white rounded-2xl outline-none transition-all text-sm font-bold"
                />
              </div>

              <div className="relative">
                <Filter
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
                  size={16}
                />
                <select
                  value={avatarFilters.gender || ''}
                  onChange={(e) =>
                    setAvatarFilters((prev) => ({
                      ...prev,
                      gender: e.target.value,
                    }))
                  }
                  className="w-full pl-10 pr-4 py-4 bg-gray-50 border-2 border-transparent focus:border-blue-600 focus:bg-white rounded-2xl outline-none transition-all text-sm font-bold text-gray-600 appearance-none"
                >
                  <option value="">Todos Gêneros</option>
                  <option value="male">Masculino</option>
                  <option value="female">Feminino</option>
                </select>
              </div>

              <div className="relative">
                <SortAsc
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
                  size={16}
                />
                <select
                  value={avatarFilters.sort || 'name'}
                  onChange={(e) =>
                    setAvatarFilters((prev) => ({
                      ...prev,
                      sort: e.target.value,
                    }))
                  }
                  className="w-full pl-10 pr-4 py-4 bg-gray-50 border-2 border-transparent focus:border-blue-600 focus:bg-white rounded-2xl outline-none transition-all text-sm font-bold text-gray-600 appearance-none"
                >
                  <option value="name">A a Z</option>
                  <option value="ads">Melhores para Anúncios</option>
                  <option value="natural">Mais Realistas</option>
                </select>
              </div>
            </div>

            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Style Filter */}
                <div className="space-y-3">
                  <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                    Estilo (Style)
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {['Professional', 'Lifestyle', 'UGC', 'Community'].map((style) => (
                      <button
                        key={style}
                        onClick={() =>
                          setAvatarFilters((prev) => ({
                            ...prev,
                            styles: prev.styles.includes(style)
                              ? prev.styles.filter((s: string) => s !== style)
                              : [...prev.styles, style],
                          }))
                        }
                        className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border-2 ${
                          avatarFilters.styles.includes(style)
                            ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-200'
                            : 'bg-white border-gray-100 text-gray-400 hover:border-gray-200'
                        }`}
                      >
                        {style}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Ethnicity Filter */}
                <div className="space-y-3">
                  <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                    Etnia (Ethnicity)
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {['White', 'Asian', 'South Asian', 'Latino', 'Middle Eastern', 'Black'].map(
                      (eth) => (
                        <button
                          key={eth}
                          onClick={() =>
                            setAvatarFilters((prev) => ({
                              ...prev,
                              ethnicities: prev.ethnicities.includes(eth)
                                ? prev.ethnicities.filter((e: string) => e !== eth)
                                : [...prev.ethnicities, eth],
                            }))
                          }
                          className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border-2 ${
                            avatarFilters.ethnicities.includes(eth)
                              ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-200'
                              : 'bg-white border-gray-100 text-gray-400 hover:border-gray-200'
                          }`}
                        >
                          {eth}
                        </button>
                      )
                    )}
                  </div>
                </div>

                {/* Age Filter */}
                <div className="space-y-3">
                  <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                    Idade (Age)
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {['Young Adult', 'Middle Aged', 'Elderly'].map((age) => (
                      <button
                        key={age}
                        onClick={() =>
                          setAvatarFilters((prev) => ({
                            ...prev,
                            ages: prev.ages.includes(age)
                              ? prev.ages.filter((a: string) => a !== age)
                              : [...prev.ages, age],
                          }))
                        }
                        className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all border-2 ${
                          avatarFilters.ages.includes(age)
                            ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-200'
                            : 'bg-white border-gray-100 text-gray-400 hover:border-gray-200'
                        }`}
                      >
                        {age}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {(avatarSearch ||
                avatarFilters.gender ||
                avatarFilters.ages.length > 0 ||
                avatarFilters.styles.length > 0 ||
                avatarFilters.ethnicities.length > 0) && (
                <button
                  onClick={() => {
                    setAvatarSearch('');
                    setAvatarFilters({
                      gender: '',
                      ages: [],
                      styles: [],
                      ethnicities: [],
                      sort: 'name',
                    });
                  }}
                  className="ml-auto text-xs font-bold text-blue-600 hover:underline flex items-center gap-1"
                >
                  <RefreshCw size={12} />
                  Limpar Filtros
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-col md:flex-row items-center justify-between gap-6 pt-8 border-t border-gray-50">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <h4 className="font-black text-gray-900 uppercase tracking-tight">
                  Geração do Vídeo
                </h4>
                <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-md text-[10px] font-black uppercase tracking-widest">
                  HeyGen
                </span>
              </div>
              <p className="text-xs text-gray-500 font-medium italic">
                Selecione o avatar acima para iniciar a geração.
              </p>

              <div className="flex items-center gap-4 mt-2">
                <div className="flex-1 space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                      Escala do Avatar (Zoom)
                    </label>
                    <span className="text-xs font-bold text-blue-600">
                      {(config.avatar.scale || 1.0).toFixed(1)}x
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="2.0"
                    step="0.1"
                    value={config.avatar.scale || 1.0}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        avatar: {
                          ...prev.avatar,
                          scale: parseFloat(e.target.value),
                        },
                      }))
                    }
                    className="w-full h-2 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <div className="flex justify-between text-[8px] text-gray-400 font-bold uppercase">
                    <span>Afastado</span>
                    <span>Padrão (1.0)</span>
                    <span>Zoom</span>
                  </div>
                </div>

                <button
                  onClick={() => setIsTestMode(!isTestMode)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all border-2 ${
                    isTestMode
                      ? 'bg-amber-50 border-amber-200 text-amber-700 shadow-sm'
                      : 'bg-white border-gray-100 text-gray-400 hover:border-gray-200'
                  }`}
                >
                  <Tag size={12} />
                  Modo Teste (Clip Curto)
                </button>
                {isTestMode && (
                  <span className="text-[9px] font-bold text-amber-600 animate-pulse">
                    Gera apenas 3 segundos para validação rápida
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-col md:flex-row items-center gap-4 w-full md:w-auto">
              {isVideoUpToDate() && (
                <div className="flex items-center gap-2 text-green-600 bg-green-50 px-4 py-2 rounded-xl border border-green-100 shadow-sm">
                  <CheckCircle2 size={16} />
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black uppercase tracking-widest">
                      Vídeo Atualizado
                    </span>
                    <span className="text-[8px] font-bold opacity-70">
                      Gerado em{' '}
                      {new Date(config.lastVideoMetadata?.createdAt || '').toLocaleString()}
                    </span>
                  </div>
                </div>
              )}
              {(loading ||
                (videoOp &&
                  videoOp.status !== 'completed' &&
                  videoOp.status !== 'failed' &&
                  videoOp.status !== 'cancelled')) && (
                <button
                  onClick={handleCancelGeneration}
                  className="w-full md:w-auto px-8 py-5 bg-red-50 text-red-600 rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-red-100 transition-all border-2 border-red-100"
                >
                  <XCircle size={20} />
                  Cancelar Geração
                </button>
              )}

              {(videoOp?.status === 'cancelled' ||
                videoOp?.isStuck ||
                videoOp?.status === 'failed') && (
                <button
                  onClick={() => handleGenerateVideo(true)}
                  className="w-full md:w-auto px-8 py-5 bg-amber-500 text-white rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-amber-600 transition-all shadow-lg shadow-amber-100"
                >
                  <RefreshCw size={20} />
                  Tentar Novamente
                </button>
              )}

              <button
                onClick={() => handleGenerateVideo(!!videoUrl)}
                disabled={
                  loading ||
                  !config.avatar.faceId ||
                  (!audioUrl && !isTestMode) ||
                  (videoOp &&
                    videoOp.status !== 'completed' &&
                    videoOp.status !== 'failed' &&
                    videoOp.status !== 'cancelled' &&
                    !videoOp.isStuck)
                }
                className="w-full md:w-auto px-12 py-5 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-blue-700 disabled:opacity-50 transition-all shadow-xl shadow-blue-100"
              >
                {loading ||
                (videoOp &&
                  videoOp.status !== 'completed' &&
                  videoOp.status !== 'failed' &&
                  videoOp.status !== 'cancelled' &&
                  !videoOp.isStuck) ? (
                  <Loader2 className="animate-spin" size={20} />
                ) : (
                  <Sparkles size={20} />
                )}
                {videoUrl ? 'Regerar Avatar' : 'Gerar Avatar'}
              </button>
            </div>
          </div>

          {/* Debug/Details Area */}
          {videoOp && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mt-6 p-6 bg-gray-900 rounded-[32px] border-2 border-gray-800 overflow-hidden"
            >
              <div className="flex flex-col md:flex-row gap-8">
                <div className="flex-1 space-y-4">
                  <div className="flex items-center justify-between">
                    <h5 className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">
                      Status HeyGen
                    </h5>
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full animate-pulse ${
                          videoOp.status === 'processing'
                            ? 'bg-green-500'
                            : videoOp.status === 'failed'
                              ? 'bg-red-500'
                              : videoOp.status === 'completed'
                                ? 'bg-blue-500'
                                : 'bg-amber-500'
                        }`}
                      />
                      <span className="text-xs font-black text-white uppercase tracking-widest">
                        {videoOp.displayStatus}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                      <p className="text-[8px] font-black text-gray-500 uppercase tracking-widest mb-1">
                        ID do Vídeo
                      </p>
                      <p className="text-[10px] font-mono text-blue-400 truncate">{videoOp.id}</p>
                    </div>
                    <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                      <p className="text-[8px] font-black text-gray-500 uppercase tracking-widest mb-1">
                        Progresso
                      </p>
                      <p className="text-lg font-black text-white">{videoOp.progress}%</p>
                    </div>
                  </div>

                  {videoOp.isStuck && (
                    <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-3">
                      <AlertCircle size={16} className="text-red-500" />
                      <div>
                        <p className="text-[10px] font-black text-red-500 uppercase tracking-widest">
                          Alerta de Travamento
                        </p>
                        <p className="text-[10px] text-red-400 font-medium">
                          {videoOp.stuckReason}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex-1 space-y-4">
                  <h5 className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">
                    Métricas de Tempo
                  </h5>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest">
                        Fila (Queue)
                      </p>
                      <p className="text-xl font-black text-white">{videoOp.queuedTime || 0}s</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest">
                        Renderização
                      </p>
                      <p className="text-xl font-black text-white">{videoOp.renderTime || 0}s</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest">
                        Total Decorrido
                      </p>
                      <p className="text-xl font-black text-blue-400">{videoOp.totalTime || 0}s</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest">
                        Polls (Consultas)
                      </p>
                      <p className="text-xl font-black text-gray-500">{videoOp.pollCount || 0}</p>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-white/5">
                    <p className="text-[8px] font-black text-gray-600 uppercase tracking-widest">
                      Iniciado às: {videoOp.requestSentTime}
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          <div className="flex items-center justify-between px-2">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-bold text-gray-500">
                Exibindo <span className="text-blue-600">{filteredAvatars.length}</span> avatares
                encontrados
              </p>
              {isFallbackActive && (
                <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest animate-pulse flex items-center gap-1">
                  <AlertCircle size={10} />
                  Nenhum resultado exato. Exibindo todos para facilitar sua busca.
                </p>
              )}
            </div>
          </div>

          {loadingAvatars ? (
            <div className="flex flex-col items-center justify-center py-24 space-y-4">
              <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
              <p className="text-sm text-gray-500 font-bold uppercase tracking-widest">
                Carregando Avatares...
              </p>
            </div>
          ) : avatarError ? (
            <div className="p-12 bg-red-50 border-2 border-red-100 rounded-[40px] text-center space-y-6">
              <div className="w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mx-auto">
                <AlertCircle size={32} />
              </div>
              <div className="space-y-2">
                <p className="text-red-900 font-black text-xl">Erro ao carregar avatares</p>
                <p className="text-red-600 font-medium">{avatarError}</p>
              </div>
              <button
                onClick={() => {
                  setHeygenAvatars([]);
                  setCurrentStep('integrations');
                  setTimeout(() => setCurrentStep('avatar'), 100);
                }}
                className="px-8 py-4 bg-red-600 text-white rounded-2xl font-black hover:bg-red-700 transition-all"
              >
                Tentar Novamente
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
              {filteredAvatars.map((a) => {
                const enrichment = AVATAR_ENRICHMENT[a.avatar_id] || {};
                const age = enrichment.age;

                return (
                  <button
                    key={a.avatar_id}
                    onClick={() => {
                      // Toggle selection logic
                      if (config.avatar.faceId === a.avatar_id) {
                        // Deselect if already selected
                        setConfig((prev) => ({
                          ...prev,
                          avatar: { ...prev.avatar, faceId: '' },
                          videoUrl: null,
                          videoStoragePath: null,
                        }));
                      } else {
                        // Select new one
                        setConfig((prev) => ({
                          ...prev,
                          avatar: { ...prev.avatar, faceId: a.avatar_id },
                          videoUrl: null,
                          videoStoragePath: null,
                        }));
                      }

                      // Always reset video when switching or toggling
                      setVideoUrl(null);
                      setVideoStoragePath(null);
                      setVideoOp(null);

                      // Open modal regardless of selection state to show details
                      setPreviewAvatar(a);

                      const isHorizontal =
                        a.aspect_ratio === '16:9' ||
                        a.avatar_id?.toLowerCase().includes('horizontal') ||
                        a.avatar_id?.toLowerCase().includes('landscape');

                      // Only reset format/crop when SWITCHING to a different avatar.
                      // Clicking the already-selected avatar should preserve the user's
                      // chosen avatarFormat, cropOffset, and aspectRatio.
                      setConfig((prev) => {
                        const isSwitchingAvatar = prev.avatar.faceId !== a.avatar_id;
                        if (!isSwitchingAvatar) {
                          return prev;
                        }
                        return {
                          ...prev,
                          avatar: {
                            ...prev.avatar,
                            avatarFormat: 'original',
                            cropOffset: 0,
                          },
                          format: {
                            ...prev.format,
                            aspectRatio: isHorizontal ? '16:9' : '9:16',
                          },
                        };
                      });
                    }}
                    className={`group relative aspect-[3/4] rounded-[32px] overflow-hidden border-4 transition-all ${
                      config.avatar.faceId === a.avatar_id
                        ? 'border-blue-600 scale-[1.02] shadow-2xl shadow-blue-100'
                        : 'border-transparent hover:border-gray-200 shadow-sm'
                    }`}
                  >
                    <img
                      src={a.preview_image_url || undefined}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent flex items-end p-4">
                      <div className="text-left w-full">
                        <p className="text-white text-sm font-black truncate w-full mb-1">
                          {a.avatar_name}
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {age && (
                            <span className="px-2 py-0.5 bg-white/20 backdrop-blur-md text-white rounded-md text-[8px] font-black uppercase tracking-tighter">
                              {age === 'young' ? 'Jovem' : age === 'adult' ? 'Adulto' : 'Maduro'}
                            </span>
                          )}
                          {a.avatar_type && (
                            <span className="px-2 py-0.5 bg-blue-500/40 backdrop-blur-md text-white rounded-md text-[8px] font-black uppercase tracking-tighter">
                              {a.avatar_type}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {config.avatar.faceId === a.avatar_id && (
                      <div className="absolute top-3 right-3 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-lg border-2 border-white">
                        <CheckCircle2 size={18} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Avatar Preview Modal */}
          <AnimatePresence>
            {previewAvatar && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8">
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setPreviewAvatar(null)}
                  className="absolute inset-0 bg-black/80 backdrop-blur-xl"
                />

                <motion.div
                  initial={{ opacity: 0, scale: 0.9, y: 40 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 40 }}
                  className="bg-white rounded-[40px] max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col md:flex-row shadow-2xl relative z-20"
                >
                  <button
                    onClick={() => setPreviewAvatar(null)}
                    className="absolute top-6 right-6 z-10 p-3 bg-white/10 hover:bg-white/20 text-white rounded-2xl backdrop-blur-md transition-all md:text-gray-900 md:bg-gray-100 md:hover:bg-gray-200"
                  >
                    <X size={24} />
                  </button>

                  {/* Image Preview Area */}
                  <div className="flex-1 bg-gray-950 flex items-center justify-center p-8 relative overflow-hidden group">
                    <div className="absolute inset-0 opacity-20 pointer-events-none">
                      <div className="absolute inset-0 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:20px_20px]" />
                    </div>

                    {(() => {
                      // Default to horizontal (16:9) as HeyGen metadata is unreliable
                      const isHorizontal = previewAvatar.aspect_ratio !== '9:16';

                      return (
                        <div
                          className={cn(
                            'relative transition-all duration-700 shadow-2xl rounded-2xl overflow-hidden ring-1 ring-white/10',
                            config.avatar.avatarFormat === 'square'
                              ? 'aspect-square h-[80%] max-w-full'
                              : isHorizontal
                                ? 'aspect-video w-[90%] max-h-[80%]'
                                : 'aspect-[9/16] h-[90%] max-w-full'
                          )}
                        >
                          <p className="w-full h-full transition-all duration-1000 ease-in-out">
                            <img
                              src={previewAvatar.preview_image_url || undefined}
                              className={cn(
                                'w-full h-full transition-all duration-500 ease-in-out',
                                config.avatar.avatarFormat === 'square'
                                  ? 'object-cover'
                                  : 'object-contain'
                              )}
                              style={
                                config.avatar.avatarFormat === 'square'
                                  ? {
                                      objectPosition:
                                        config.format.aspectRatio === '9:16' ||
                                        config.format.aspectRatio === '1:1'
                                          ? `${50 + (config.avatar.cropOffset || 0)}% 50%`
                                          : `50% ${50 + (config.avatar.cropOffset || 0)}%`,
                                    }
                                  : undefined
                              }
                              referrerPolicy="no-referrer"
                              alt={previewAvatar.avatar_name}
                            />
                          </p>

                          {/* Format Overlay */}
                          <div className="absolute inset-0 pointer-events-none border-2 border-blue-500/0 group-hover:border-blue-500/20 transition-all duration-500" />

                          {/* Orientation Labels */}
                          <div className="absolute top-4 left-4 flex flex-col gap-2">
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-black/60 backdrop-blur-md text-white rounded-xl text-[10px] font-black uppercase tracking-widest border border-white/10">
                              {isHorizontal ? (
                                <>
                                  <Monitor size={12} className="text-blue-400" />
                                  Horizontal (16:9)
                                </>
                              ) : (
                                <>
                                  <Smartphone size={12} className="text-purple-400" />
                                  Vertical (9:16)
                                </>
                              )}
                            </div>
                            {config.avatar.avatarFormat === 'square' && (
                              <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-600/60 backdrop-blur-md text-white rounded-xl text-[10px] font-black uppercase tracking-widest border border-blue-400/20 animate-pulse">
                                <Square size={12} />
                                Adaptado para Quadrado
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Controls Area */}
                  <div className="w-full md:w-[400px] p-10 flex flex-col justify-between bg-white border-l border-gray-100 overflow-y-auto">
                    <div className="space-y-10">
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 px-3 py-1 bg-gray-100 rounded-lg w-fit">
                          <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                            Avatar ID: {previewAvatar.avatar_id}
                          </span>
                        </div>
                        <h3 className="text-4xl font-black text-gray-900 tracking-tight leading-tight">
                          {previewAvatar.avatar_name}
                        </h3>
                        <p className="text-gray-500 font-medium leading-relaxed">
                          Ideal para{' '}
                          {previewAvatar.avatar_type === 'realistic'
                            ? 'anúncios de alta conversão'
                            : 'conteúdos naturais e autênticos'}
                          .
                        </p>
                      </div>

                      <div className="space-y-6">
                        <div className="flex items-center justify-between">
                          <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                            Output Format
                          </h4>
                          <span className="text-[10px] font-bold text-blue-600 uppercase">
                            Ajuste de Composição
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          {[
                            {
                              id: 'original',
                              label: 'Original',
                              desc: 'Nativo',
                              icon: Scan,
                            },
                            {
                              id: 'square',
                              label: '1:1',
                              desc: 'Square',
                              icon: Square,
                            },
                          ].map((opt) => (
                            <button
                              key={opt.id}
                              onClick={() => {
                                // Default to horizontal (16:9) as HeyGen metadata is unreliable
                                const isHorizontal = previewAvatar.aspect_ratio !== '9:16';

                                const newRatio =
                                  opt.id === 'original' ? (isHorizontal ? '16:9' : '9:16') : '1:1';

                                setConfig((prev) => ({
                                  ...prev,
                                  avatar: {
                                    ...prev.avatar,
                                    avatarFormat: opt.id as any,
                                  },
                                  format: {
                                    ...prev.format,
                                    aspectRatio: newRatio,
                                  },
                                }));
                              }}
                              className={cn(
                                'p-3 rounded-[20px] border-2 text-left transition-all group/opt relative overflow-hidden',
                                config.avatar.avatarFormat === opt.id ||
                                  (!config.avatar.avatarFormat && opt.id === 'original')
                                  ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-sm'
                                  : 'border-gray-100 text-gray-500 hover:border-gray-200 hover:bg-gray-50'
                              )}
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <opt.icon
                                  size={14}
                                  className="opacity-60 group-hover/opt:opacity-100 transition-opacity"
                                />
                                <p className="font-black text-xs leading-none">{opt.label}</p>
                              </div>
                              <p className="text-[8px] font-bold opacity-60 uppercase tracking-widest">
                                {opt.desc}
                              </p>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="p-6 bg-amber-50 rounded-3xl border border-amber-100 space-y-4">
                        <div className="flex items-center gap-2 text-amber-900">
                          <Info size={16} />
                          <h5 className="font-black text-xs uppercase tracking-tight">
                            Enquadramento Inteligente
                          </h5>
                        </div>

                        {config.avatar.avatarFormat === 'square' && (
                          <div className="space-y-4 pt-2">
                            {(() => {
                              // Default to horizontal (16:9) as HeyGen metadata is unreliable
                              const isHorizontal = previewAvatar.aspect_ratio !== '9:16';

                              return (
                                <div className="space-y-3">
                                  <div className="flex justify-between items-center">
                                    <label className="text-[10px] font-black text-amber-900 uppercase tracking-widest">
                                      {isHorizontal ? 'Posição Horizontal' : 'Posição Vertical'}
                                    </label>
                                    <button
                                      onClick={() =>
                                        setConfig((prev) => ({
                                          ...prev,
                                          avatar: {
                                            ...prev.avatar,
                                            cropOffset: 0,
                                          },
                                        }))
                                      }
                                      className="text-[9px] font-black text-amber-600 bg-amber-100/50 px-2 py-1 rounded hover:bg-amber-100 transition-colors uppercase"
                                    >
                                      Resetar para o Centro
                                    </button>
                                  </div>
                                  <input
                                    type="range"
                                    min="-50"
                                    max="50"
                                    step="1"
                                    value={config.avatar.cropOffset || 0}
                                    onChange={(e) =>
                                      setConfig((prev) => ({
                                        ...prev,
                                        avatar: {
                                          ...prev.avatar,
                                          cropOffset: parseInt(e.target.value),
                                        },
                                      }))
                                    }
                                    className="w-full h-2 bg-amber-200 rounded-lg appearance-none cursor-pointer accent-amber-600"
                                  />
                                  <div className="flex justify-between text-[8px] text-amber-600/60 font-black uppercase tracking-tighter">
                                    <span>{isHorizontal ? 'Esquerda' : 'Topo'}</span>
                                    <span>Centro (IA)</span>
                                    <span>{isHorizontal ? 'Direita' : 'Base'}</span>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        )}

                        <p className="text-[11px] text-amber-700 font-medium leading-relaxed">
                          {config.avatar.avatarFormat === 'square'
                            ? 'Use o controle acima para ajustar o foco manualmente. O IA centraliza no sujeito por padrão.'
                            : 'Ao selecionar **Square**, o enquadramento é ajustado para formato quadrado preservando a altura ou largura original do sujeito conforme a orientação nativa.'}
                        </p>
                      </div>
                    </div>

                    <div className="pt-10 space-y-4">
                      <button
                        onClick={() => {
                          if (config.avatar.faceId === previewAvatar.avatar_id) {
                            setConfig((prev) => ({
                              ...prev,
                              avatar: { ...prev.avatar, faceId: '' },
                            }));
                            toast.success('Avatar removido.');
                          } else {
                            setConfig((prev) => ({
                              ...prev,
                              avatar: {
                                ...prev.avatar,
                                faceId: previewAvatar.avatar_id,
                              },
                            }));
                            toast.success(`${previewAvatar.avatar_name} selecionado!`);
                          }
                        }}
                        className={cn(
                          'w-full py-6 rounded-[24px] font-black uppercase tracking-[0.2em] text-xs transition-all flex items-center justify-center gap-3 active:scale-95',
                          config.avatar.faceId === previewAvatar.avatar_id
                            ? 'bg-red-50 text-red-600 border-2 border-red-100 hover:bg-red-100'
                            : 'bg-blue-600 text-white shadow-2xl shadow-blue-100 hover:bg-blue-700'
                        )}
                      >
                        {config.avatar.faceId === previewAvatar.avatar_id ? (
                          <>
                            <Trash2 size={18} />
                            Desmarcar Avatar
                          </>
                        ) : (
                          <>
                            <CheckCircle2 size={18} />
                            Escolher este Avatar
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => setPreviewAvatar(null)}
                        className="w-full py-4 text-gray-400 font-black uppercase tracking-widest text-[10px] hover:text-gray-900 transition-all"
                      >
                        Voltar para Galeria
                      </button>
                    </div>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/* Action Footer removed and moved to top */}
        </div>
      </div>
    );
  };









  const handleStartAutoEdit = async () => {
    if (!videoUrl) {
      toast.error('Nenhum vídeo disponível para analisar.');
      return;
    }

    setLoading(true);
    setAutoEditState({
      status: 'analyzing',
      step: 'Explorando conteúdo com AssemblyAI...',
      progress: 10,
      editMode: 'auto',
    });

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
    const msg = typeof err === 'string' ? err : err.message || JSON.stringify(err);
    if (typeof msg === 'string' && msg.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(msg);
        return (
          parsed.error ||
          parsed.message ||
          (typeof parsed === 'string' ? parsed : JSON.stringify(parsed))
        );
      } catch (e) {
        return msg;
      }
    }
    return msg;
  };

  const handleRenderZapSimple = async (overrideBrollPercent?: number) => {
    // Allow callers (notably the auto-retry on failure) to force a
    // different b-roll % than the slider currently shows.
    const effectiveBrollPercent =
      typeof overrideBrollPercent === 'number' ? overrideBrollPercent : zapBrollPercent;
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
      setZapState((prev) => ({
        ...prev,
        status: 'completed',
        step: 'Versão sem legenda criada.',
        progress: 100,
        originalVideoUrl: zapState.originalVideoUrl || zapVideoUrl,
        finalVideoUrl: zapVideoUrl,
        versions: wasHookEdit
          ? prev.versions
          : [...(prev.versions || []), zapVideoUrl],
      }));
      setConfig((prev) => {
        const key = wasHookEdit ? 'zapHookVersions' : 'zapVersions';
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

      console.log('[ZAP SIMPLE PAYLOAD]', payload);

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
    const startTime = Date.now();
    const TIMEOUT_MS = 10 * 60 * 1000;

    zapPollRef.current = setInterval(async () => {
      try {
        if (alreadyCompleted) return;

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
        console.log(`[ZAP SIMPLE Poll] status=${data.status}`);

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

          const wasHookEdit = editZapModeRef.current === 'hook';
          setZapState((prev) => {
            // Only body versions live in zapState.versions (the in-memory
            // gallery state). Hook versions are read from config directly.
            const newVersions = wasHookEdit
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
            const key = wasHookEdit ? 'zapHookVersions' : 'zapVersions';
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
          const wasAutoRetry = zapAutoRetryRef.current;
          zapAutoRetryRef.current = false;
          toast.success(
            wasAutoRetry
              ? 'Vídeo editado (sem b-rolls — primeira tentativa falhou).'
              : 'Vídeo editado com sucesso!',
            { id: 'zap-simple-render' }
          );
          setLoading(false);
        } else if (data.status === 'failed' || data.status === 'error') {
          isZapRenderingRef.current = false;
          clearInterval(zapPollRef.current!);
          zapPollRef.current = null;

          // Auto-retry once with b-rolls disabled — we confirmed empirically
          // that ZapCap's render step fails on long videos when many b-rolls
          // are stitched in. The retry without b-rolls produces a usable
          // (legend-only) video so the user isn't left empty-handed.
          const usedBroll = (zapBrollPercent ?? 0) > 0;
          if (usedBroll && !zapAutoRetryRef.current) {
            zapAutoRetryRef.current = true;
            console.warn(
              '[ZAP SIMPLE] Render falhou com b-rolls. Tentando novamente sem b-rolls automaticamente...'
            );
            toast.loading('B-roll causou falha — tentando de novo sem b-rolls...', {
              id: 'zap-simple-render',
              duration: 8000,
            });
            // Re-enter the same flow with brollPercent=0. handleRenderZapSimple
            // sets isZapRenderingRef back to true and re-arms the poll loop.
            handleRenderZapSimple(0);
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
        const current =
          ((prev.edit as any).zapHookVersions as string[] | undefined) || [];
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

  const handleRenderIntercut = async () => {
    if (!intercutSourceUrl) return;
    if (!user?.uid) {
      toast.error('Faça login antes de gerar cortes pretos.');
      return;
    }
    const texts = intercutTexts.map((t) => t.trim()).filter(Boolean);
    if (texts.length === 0) {
      toast.error('Adicione pelo menos um texto para o corte preto.');
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
          avatarChunkSec: intercutAvatarSec,
          blackChunkSec: intercutBlackSec,
          blackTexts: texts,
          fontSize: intercutFontSize,
          userId: user.uid,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      const newUrl: string = data.url;
      const isHookEdit = editZapModeRef.current === 'hook';
      // Append to local versions only for body (gallery state). Persist to
      // the slot matching the current edit mode.
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
        `Vídeo com cortes pretos criado (${data.blackCount ?? texts.length} cortes).`,
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

      console.log('[RENDER PAYLOAD] campos enviados:', Object.keys(payload));
      console.log('[RENDER PAYLOAD] config keys:', Object.keys(payload.config));

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

    const startTime = Date.now();
    const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutos

    zapcapPollRef.current = setInterval(async () => {
      try {
        if (alreadyCompleted) return;

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

  const renderEditZapStep = () => {
    const isRendering = zapState.status === 'rendering' || zapState.status === 'uploading';

    const isHookEdit = editZapMode === 'hook';
    const hookVideosForEdit =
      ((config.copy as any)?.hookVideos as typeof videos | undefined) || [];
    const bodyZapVersions =
      ((config.edit as any)?.zapVersions as string[] | undefined) || [];
    const hookZapVersions =
      ((config.edit as any)?.zapHookVersions as string[] | undefined) || [];
    const activeZapVersions = isHookEdit ? hookZapVersions : bodyZapVersions;

    // Source video picker pulls from hook or body depending on mode.
    const availableVideos = (isHookEdit ? hookVideosForEdit : videos || []).filter(
      (v) => v.url
    );

    return (
      <div className="max-w-[1100px] mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h3 className="text-2xl font-black text-gray-900 tracking-tight flex items-center gap-2">
              <Zap size={28} className="text-yellow-500" />
              Edição Zap
            </h3>
            <p className="text-gray-500 text-sm mt-1">
              Versão simplificada — ZapCap faz tudo (transcrição + b-rolls automaticamente).
            </p>
          </div>
          <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-[10px] font-black uppercase tracking-widest">
            Beta
          </span>
        </div>

        {/* Toggle: editing the body or the hook? Versions are kept separate.
            Hidden when the project doesn't use a separate hook. */}
        {useHookFlow && (
          <div className="bg-white p-2 rounded-2xl border-2 border-gray-100 shadow-sm flex gap-1">
            <button
              onClick={() => {
                setEditZapMode('body');
                setZapVideoUrl(null);
              }}
              className={`flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                !isHookEdit
                  ? 'bg-yellow-500 text-white shadow-md'
                  : 'text-gray-500 hover:bg-yellow-50'
              }`}
            >
              Editar Corpo
              {bodyZapVersions.length > 0 && (
                <span className="ml-2 text-[9px] opacity-70">({bodyZapVersions.length})</span>
              )}
            </button>
            <button
              onClick={() => {
                setEditZapMode('hook');
                setZapVideoUrl(null);
              }}
              className={`flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                isHookEdit
                  ? 'bg-amber-500 text-white shadow-md'
                  : 'text-gray-500 hover:bg-amber-50'
              }`}
            >
              Editar Gancho
              {hookZapVersions.length > 0 && (
                <span className="ml-2 text-[9px] opacity-70">({hookZapVersions.length})</span>
              )}
            </button>
          </div>
        )}

        {/* ETAPA 1 — Selecionar Vídeo */}
        <div className="bg-white p-6 md:p-8 rounded-[32px] border-2 border-gray-100 shadow-sm space-y-4">
          <div className="flex items-center gap-3">
            <span className="px-3 py-1 bg-yellow-500 text-white rounded-full text-[10px] font-black uppercase tracking-widest">
              Etapa 1
            </span>
            <h4 className="text-lg font-black text-gray-900">Selecione o Vídeo</h4>
          </div>

          {availableVideos.length === 0 ? (
            <div className="p-8 text-center bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
              <p className="text-sm text-gray-500 font-bold">
                Nenhum vídeo disponível. Gere um vídeo em "Gerar Vídeo com Avatar" primeiro.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {availableVideos.map((v: any, idx: number) => (
                <div
                  key={`zap-video-${idx}-${v.url}`}
                  onClick={() => {
                    setZapVideoUrl(v.url);
                    setZapState((prev) => ({ ...prev, originalVideoUrl: v.url }));
                  }}
                  className={cn(
                    'relative rounded-2xl overflow-hidden border-4 transition-all bg-black cursor-pointer',
                    // Use the video's actual aspect ratio instead of forcing
                    // 16:9 — otherwise 1:1 / 9:16 generations get letterboxed
                    // and look broken in the picker.
                    getVideoAspectRatioClass(v),
                    zapVideoUrl === v.url
                      ? 'border-yellow-500 ring-4 ring-yellow-100'
                      : 'border-gray-100 hover:border-yellow-200'
                  )}
                >
                  <video
                    src={getAuthorizedUrl(v.url, platformApiKey || undefined) || undefined}
                    className="w-full h-full object-cover pointer-events-none"
                    preload="metadata"
                    muted
                    loop
                    playsInline
                    autoPlay
                    // crossOrigin="anonymous" only when the host actually sends
                    // the CORS headers — Google's Generative Language API does.
                    // HeyGen / Firebase Storage / etc. don't, and asking for
                    // CORS makes the request fail and the preview stays black.
                    crossOrigin={
                      v.url?.includes('generativelanguage.googleapis.com')
                        ? ('anonymous' as const)
                        : undefined
                    }
                    referrerPolicy={
                      v.url?.includes('generativelanguage.googleapis.com')
                        ? ('no-referrer' as const)
                        : undefined
                    }
                  />
                  <span className="absolute bottom-2 left-2 px-2 py-0.5 bg-black/70 text-white text-[9px] font-black rounded uppercase tracking-widest pointer-events-none">
                    {v.aspectRatio || '9:16'}
                  </span>
                  <VideoDurationBadge src={v.url} />
                  {zapVideoUrl === v.url && (
                    <span className="absolute top-2 left-2 px-2 py-0.5 bg-yellow-500 text-white text-[9px] font-black rounded uppercase tracking-widest pointer-events-none">
                      ✓ Selecionado
                    </span>
                  )}
                  {/* Delete X — overlays the thumbnail. stopPropagation so it
                      doesn't trigger the "select" click on the wrapper. */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!window.confirm('Excluir este vídeo da lista?')) return;
                      handleDeleteVideoFromArray({
                        url: v.url,
                        storagePath: v.storagePath ?? null,
                      });
                      // If we were selecting this one, clear the selection.
                      if (zapVideoUrl === v.url) {
                        setZapVideoUrl(null);
                        setZapState((prev) => ({ ...prev, originalVideoUrl: undefined }));
                      }
                    }}
                    className="absolute top-2 right-2 w-7 h-7 bg-red-500/90 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-lg transition-colors"
                    title="Excluir vídeo"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ETAPA 2 — Template de Legenda */}
        <div className="bg-white p-6 md:p-8 rounded-[32px] border-2 border-gray-100 shadow-sm space-y-4">
          <div className="flex items-center gap-3">
            <span className="px-3 py-1 bg-yellow-500 text-white rounded-full text-[10px] font-black uppercase tracking-widest">
              Etapa 2
            </span>
            <h4 className="text-lg font-black text-gray-900">Escolha o Template de Legenda</h4>
          </div>

          {zapCapTemplates.length === 0 ? (
            <div className="p-8 text-center bg-gray-50 rounded-2xl">
              <p className="text-sm text-gray-500 font-bold mb-3">Carregando templates...</p>
              <button
                onClick={fetchZapCapTemplates}
                className="px-5 py-2 bg-yellow-500 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-yellow-600"
              >
                Recarregar Templates
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {/* "Nenhuma legenda" — pula o ZapCap inteiro e cria uma
                  versão = cópia do vídeo fonte. Útil quando o usuário quer
                  só aplicar Cortes/Headline sem legendas queimadas. */}
              <button
                onClick={() => setZapTemplateId('__none__')}
                className={cn(
                  'relative rounded-2xl overflow-hidden border-4 transition-all bg-gradient-to-br from-gray-100 to-gray-200 aspect-[9/16] flex flex-col items-center justify-center text-center p-3',
                  zapTemplateId === '__none__'
                    ? 'border-yellow-500 ring-4 ring-yellow-100'
                    : 'border-gray-200 hover:border-yellow-200'
                )}
              >
                <div className="text-3xl mb-2">🚫</div>
                <p className="text-xs font-black text-gray-700 uppercase tracking-widest">
                  Nenhuma
                </p>
                <p className="text-[9px] text-gray-500 mt-1 leading-tight">
                  Pula a legenda. Útil pra aplicar só Cortes/Headline.
                </p>
                {zapTemplateId === '__none__' && (
                  <span className="absolute top-2 right-2 px-2 py-0.5 bg-yellow-500 text-white text-[9px] font-black rounded">
                    ✓
                  </span>
                )}
              </button>
              {zapCapTemplates.map((tpl: any) => (
                <button
                  key={`zap-tpl-${tpl.id}`}
                  onClick={() => setZapTemplateId(tpl.id)}
                  className={cn(
                    'relative rounded-2xl overflow-hidden border-4 transition-all bg-black aspect-[9/16]',
                    zapTemplateId === tpl.id
                      ? 'border-yellow-500 ring-4 ring-yellow-100'
                      : 'border-gray-100 hover:border-yellow-200'
                  )}
                >
                  {tpl.previewUrl ? (
                    <video
                      src={tpl.previewUrl}
                      className="w-full h-full object-cover"
                      muted
                      loop
                      autoPlay
                      playsInline
                      preload="metadata"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-white text-xs font-bold p-2 text-center">
                      {tpl.name}
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                    <p className="text-white text-[10px] font-black truncate">{tpl.name}</p>
                  </div>
                  {zapTemplateId === tpl.id && (
                    <span className="absolute top-2 right-2 px-2 py-0.5 bg-yellow-500 text-white text-[9px] font-black rounded">
                      ✓
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ETAPA 3 — Ajustes */}
        <div className="bg-white p-6 md:p-8 rounded-[32px] border-2 border-gray-100 shadow-sm space-y-5">
          <div className="flex items-center gap-3">
            <span className="px-3 py-1 bg-yellow-500 text-white rounded-full text-[10px] font-black uppercase tracking-widest">
              Etapa 3
            </span>
            <h4 className="text-lg font-black text-gray-900">Ajustes</h4>
          </div>

          {/* Idioma */}
          <div className="space-y-2">
            <label className="text-xs font-black text-gray-900 uppercase tracking-widest">
              Idioma do Vídeo
            </label>
            <div className="flex flex-wrap gap-2">
              {[
                { value: 'en', label: '🇺🇸 Inglês' },
                { value: 'pt', label: '🇧🇷 Português' },
                { value: 'es', label: '🇪🇸 Espanhol' },
              ].map((lang) => (
                <button
                  key={lang.value}
                  onClick={() => setZapLanguage(lang.value)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all',
                    zapLanguage === lang.value
                      ? 'bg-yellow-500 text-white border-yellow-500'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-yellow-300'
                  )}
                >
                  {lang.label}
                </button>
              ))}
            </div>
          </div>

          {/* B-Roll Percent */}
          <div className="space-y-2">
            <label className="text-xs font-black text-gray-900 uppercase tracking-widest flex items-center justify-between">
              <span>Quantidade de B-Rolls</span>
              <span className="text-yellow-600">{zapBrollPercent}%</span>
            </label>
            <input
              type="range"
              min="0"
              max="80"
              step="10"
              value={zapBrollPercent}
              onChange={(e) => setZapBrollPercent(Number(e.target.value))}
              className="w-full"
            />
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
              0% = sem b-rolls · 30-50% = balanceado · 70-80% = bastante
            </p>
          </div>

          {/* Toggles */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              onClick={() => setZapEmoji(!zapEmoji)}
              className={cn(
                'p-3 rounded-2xl border-2 text-left transition-all',
                zapEmoji
                  ? 'bg-yellow-50 border-yellow-500'
                  : 'bg-white border-gray-100 hover:border-yellow-200'
              )}
            >
              <p className="text-sm font-black text-gray-900">
                {zapEmoji ? '✅' : '⬜'} Emojis na Legenda
              </p>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                ZapCap insere emojis automaticamente
              </p>
            </button>

            <button
              onClick={() => setZapAnimation(!zapAnimation)}
              className={cn(
                'p-3 rounded-2xl border-2 text-left transition-all',
                zapAnimation
                  ? 'bg-yellow-50 border-yellow-500'
                  : 'bg-white border-gray-100 hover:border-yellow-200'
              )}
            >
              <p className="text-sm font-black text-gray-900">
                {zapAnimation ? '✅' : '⬜'} Animação na Legenda
              </p>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                Texto animado conforme o template
              </p>
            </button>

            <button
              onClick={() => setZapEmphasizeKeywords(!zapEmphasizeKeywords)}
              className={cn(
                'p-3 rounded-2xl border-2 text-left transition-all',
                zapEmphasizeKeywords
                  ? 'bg-yellow-50 border-yellow-500'
                  : 'bg-white border-gray-100 hover:border-yellow-200'
              )}
            >
              <p className="text-sm font-black text-gray-900">
                {zapEmphasizeKeywords ? '✅' : '⬜'} Destacar Palavras-Chave
              </p>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                ZapCap detecta e destaca palavras importantes
              </p>
            </button>

            <button
              onClick={() => setZapFontUppercase(!zapFontUppercase)}
              className={cn(
                'p-3 rounded-2xl border-2 text-left transition-all',
                zapFontUppercase
                  ? 'bg-yellow-50 border-yellow-500'
                  : 'bg-white border-gray-100 hover:border-yellow-200'
              )}
            >
              <p className="text-sm font-black text-gray-900">
                {zapFontUppercase ? '✅' : '⬜'} Legenda em MAIÚSCULAS
              </p>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                Estilo viral / Hormozi
              </p>
            </button>
          </div>

          {/* Formato do vídeo */}
          <div className="space-y-2">
            <label className="text-xs font-black text-gray-900 uppercase tracking-widest">
              Formato do Vídeo
            </label>
            <div className="flex flex-wrap gap-2">
              {[
                { value: 'auto', label: '🤖 Auto' },
                { value: '9:16', label: '📱 9:16 (Vertical)' },
                { value: '1:1', label: '⬜ 1:1 (Quadrado)' },
                { value: '16:9', label: '🖥️ 16:9 (Horizontal)' },
              ].map((fmt) => (
                <button
                  key={fmt.value}
                  onClick={() => setZapVideoFormat(fmt.value as any)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all',
                    zapVideoFormat === fmt.value
                      ? 'bg-yellow-500 text-white border-yellow-500'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-yellow-300'
                  )}
                >
                  {fmt.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
              Por enquanto informativo — ZapCap usa o formato do vídeo de entrada
            </p>
          </div>

          {/* Posição vertical da legenda */}
          <div className="space-y-2">
            <label className="text-xs font-black text-gray-900 uppercase tracking-widest flex items-center justify-between">
              <span>Posição Vertical da Legenda</span>
              <span className="text-yellow-600">{zapSubtitleTop}%</span>
            </label>
            <input
              type="range"
              min="0"
              max="80"
              step="5"
              value={zapSubtitleTop}
              onChange={(e) => setZapSubtitleTop(Number(e.target.value))}
              className="w-full"
            />
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
              0% = topo · 50% = centro · 70-80% = padrão para avatares (máximo 80%)
            </p>
          </div>

          {/* Largura da legenda: ZapCap não expõe um campo de largura/margem
              na API (confirmado na doc oficial). Controle real é via fontSize
              e escolha do template. */}
          <div className="space-y-2 p-3 bg-yellow-50 rounded-xl border border-yellow-200">
            <p className="text-[10px] font-black text-yellow-700 uppercase tracking-widest">
              💡 Como controlar a largura da legenda
            </p>
            <p className="text-[11px] text-gray-600 leading-relaxed">
              ZapCap não tem ajuste direto de largura. Pra deixar a legenda{' '}
              <strong>mais estreita</strong>:
            </p>
            <ul className="text-[11px] text-gray-600 space-y-1 list-disc list-inside">
              <li>Diminua o tamanho da fonte abaixo (36-40px)</li>
              <li>Troque para um template que renderize menos texto por linha</li>
              <li>
                Reduza <em>Palavras por bloco</em> (mostrar 2-3 palavras por vez em vez de 5+)
              </li>
            </ul>
          </div>

          {/* Tamanho da fonte */}
          <div className="space-y-2">
            <label className="text-xs font-black text-gray-900 uppercase tracking-widest flex items-center justify-between">
              <span>Tamanho da Fonte</span>
              <span className="text-yellow-600">{zapFontSize}px</span>
            </label>
            <input
              type="range"
              min="6"
              max="80"
              step="2"
              value={zapFontSize}
              onChange={(e) => setZapFontSize(Number(e.target.value))}
              className="w-full"
            />
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
              6-18 = bem pequeno · 24 = padrão · 30-40 = médio · 50-80 = grande (estilo viral)
            </p>
          </div>

          {/* Palavras por linha */}
          <div className="space-y-2">
            <label className="text-xs font-black text-gray-900 uppercase tracking-widest flex items-center justify-between">
              <span>Palavras por Linha</span>
              <span className="text-yellow-600">{zapDisplayWords}</span>
            </label>
            <input
              type="range"
              min="1"
              max="8"
              step="1"
              value={zapDisplayWords}
              onChange={(e) => setZapDisplayWords(Number(e.target.value))}
              className="w-full"
            />
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
              1-2 = estilo viral / Hormozi · 4 = padrão · 6-8 = tutoriais longos
            </p>
          </div>

          {/* Cores da legenda — picker livre + presets rápidos */}
          <div className="space-y-4 p-4 bg-gray-50 rounded-2xl">
            <label className="text-xs font-black text-gray-900 uppercase tracking-widest">
              Cores da Legenda
            </label>

            {/* Cor da fonte + borda — sempre visíveis */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="bg-white p-3 rounded-xl border-2 border-gray-100">
                <div className="text-[10px] font-black text-gray-700 uppercase tracking-widest mb-2">
                  Cor das letras
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={zapFontColor}
                    onChange={(e) => setZapFontColor(e.target.value)}
                    className="h-10 w-14 rounded-lg border-2 border-gray-200 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={zapFontColor}
                    onChange={(e) => setZapFontColor(e.target.value)}
                    placeholder="#FFFFFF"
                    className="flex-1 p-2 border-2 border-gray-200 rounded-lg text-xs font-mono focus:border-yellow-500 focus:outline-none"
                  />
                </div>
              </div>
              <div className="bg-white p-3 rounded-xl border-2 border-gray-100">
                <div className="text-[10px] font-black text-gray-700 uppercase tracking-widest mb-2">
                  Cor da borda (contorno)
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={zapStrokeColor}
                    onChange={(e) => setZapStrokeColor(e.target.value)}
                    className="h-10 w-14 rounded-lg border-2 border-gray-200 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={zapStrokeColor}
                    onChange={(e) => setZapStrokeColor(e.target.value)}
                    placeholder="#000000"
                    className="flex-1 p-2 border-2 border-gray-200 rounded-lg text-xs font-mono focus:border-yellow-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Preview da legenda. paint-order: stroke fill garante que o
                contorno é desenhado ATRÁS do preenchimento, evitando o
                visual quebrado (stroke comendo o miolo da letra) que o
                -webkit-text-stroke padrão causa em fontes finas. */}
            <div
              className="rounded-xl p-6 flex items-center justify-center bg-gradient-to-br from-gray-700 to-gray-900"
              style={{ minHeight: '80px' }}
            >
              <span
                className="text-3xl font-black uppercase tracking-wider"
                style={{
                  color: zapFontColor,
                  WebkitTextStroke: `2px ${zapStrokeColor}`,
                  paintOrder: 'stroke fill',
                }}
              >
                EXEMPLO LEGENDA
              </span>
            </div>

            {/* Destaque de palavras — checkbox + 3 color pickers */}
            <div className="bg-white p-3 rounded-xl border-2 border-gray-100 space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={zapUseCustomHighlight}
                  onChange={(e) => setZapUseCustomHighlight(e.target.checked)}
                  className="w-4 h-4 accent-yellow-500"
                />
                <span className="text-[11px] font-black text-gray-700 uppercase tracking-widest">
                  Cores customizadas pra palavras em destaque
                </span>
              </label>
              {zapUseCustomHighlight && (
                <>
                  {/* Critical dependency: these colors ONLY apply when
                      emphasizeKeywords is ON. If it's off, ZapCap doesn't
                      emphasize any words and the random colors silently do
                      nothing. */}
                  {!zapEmphasizeKeywords && (
                    <div className="bg-red-50 border-2 border-red-300 rounded-lg p-3 space-y-1">
                      <p className="text-[11px] text-red-900 font-black uppercase tracking-widest">
                        ⚠ Pré-requisito desligado
                      </p>
                      <p className="text-[10px] text-red-800 leading-tight">
                        As cores customizadas só aparecem quando{' '}
                        <strong>"Destacar Palavras-Chave" está LIGADO</strong> (lá embaixo
                        em "Ajustes"). Sem isso, o ZapCap não destaca nenhuma palavra e
                        as cores são ignoradas.
                      </p>
                      <button
                        onClick={() => setZapEmphasizeKeywords(true)}
                        className="text-[10px] font-black text-red-700 underline hover:text-red-900 mt-1"
                      >
                        Ligar agora →
                      </button>
                    </div>
                  )}
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 space-y-1">
                    <p className="text-[10px] text-amber-900 leading-tight">
                      <strong>O ZapCap expõe só 3 cores</strong> ({'randomColour 1/2/3'}) e
                      cada template usa elas de um jeito.
                    </p>
                    <p className="text-[10px] text-amber-800 leading-tight">
                      Em templates como o <strong>Viktor</strong>, a cor 1 costuma virar o
                      fundo da palavra falada e a cor 2 a letra por dentro. Em outros
                      templates as 3 cores são rotacionadas aleatoriamente. Teste mudando
                      uma de cada vez pra mapear o seu template.
                    </p>
                    <p className="text-[10px] text-amber-800 leading-tight">
                      Alguns templates simples (sem destaque embutido) podem ignorar essas
                      cores — se nada mudar, tente outro template.
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      {
                        v: zapHl1,
                        set: setZapHl1,
                        label: 'Cor 1',
                        hint: 'Fundo da palavra (Viktor)',
                      },
                      {
                        v: zapHl2,
                        set: setZapHl2,
                        label: 'Cor 2',
                        hint: 'Letras por dentro (Viktor)',
                      },
                      { v: zapHl3, set: setZapHl3, label: 'Cor 3', hint: 'Acento extra' },
                    ].map((hl, i) => (
                      <div key={i}>
                        <div
                          className="text-[9px] font-black text-gray-600 uppercase tracking-widest mb-1"
                          title={hl.hint}
                        >
                          {hl.label}
                        </div>
                        <div className="flex items-center gap-1">
                          <input
                            type="color"
                            value={hl.v}
                            onChange={(e) => hl.set(e.target.value)}
                            className="h-9 w-12 rounded-lg border-2 border-gray-200 cursor-pointer"
                          />
                          <input
                            type="text"
                            value={hl.v}
                            onChange={(e) => hl.set(e.target.value)}
                            className="flex-1 p-1.5 border-2 border-gray-200 rounded-lg text-[10px] font-mono focus:border-yellow-500 focus:outline-none min-w-0"
                          />
                        </div>
                        <p className="text-[8px] text-gray-400 mt-1 leading-tight">
                          {hl.hint}
                        </p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Presets rápidos — preenchem font + stroke + highlights de uma vez */}
            <div>
              <div className="text-[10px] font-black text-gray-600 uppercase tracking-widest mb-2">
                Presets rápidos (clica pra preencher tudo)
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {[
                  {
                    label: '🎯 Viral Amarela',
                    font: '#FFFFFF',
                    stroke: '#000000',
                    hl: ['#FFD700', '#FFFFFF', '#FFA500'],
                  },
                  {
                    label: '🔥 Viral Vermelha',
                    font: '#FFFFFF',
                    stroke: '#000000',
                    hl: ['#FF3B30', '#FFFFFF', '#FFD700'],
                  },
                  {
                    label: '💚 Viral Verde',
                    font: '#FFFFFF',
                    stroke: '#000000',
                    hl: ['#00FF7F', '#FFFFFF', '#FFD700'],
                  },
                  {
                    label: '⚡ Neon Vibrante',
                    font: '#FFFFFF',
                    stroke: '#000000',
                    hl: ['#FF00FF', '#00FFFF', '#FFFF00'],
                  },
                  {
                    label: '⚪ Clássico',
                    font: '#FFFFFF',
                    stroke: '#000000',
                    hl: ['#FFFFFF', '#FFD700', '#FFFFFF'],
                  },
                  {
                    label: '🌫 Sutil Cinza',
                    font: '#FFFFFF',
                    stroke: '#444444',
                    hl: ['#D3D3D3', '#FFFFFF', '#A9A9A9'],
                  },
                ].map((p, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setZapFontColor(p.font);
                      setZapStrokeColor(p.stroke);
                      setZapHl1(p.hl[0]);
                      setZapHl2(p.hl[1]);
                      setZapHl3(p.hl[2]);
                      setZapUseCustomHighlight(true);
                    }}
                    className="p-2 rounded-xl border-2 border-gray-200 hover:border-yellow-300 bg-white text-left transition-all"
                  >
                    <div className="flex gap-1 mb-1">
                      {p.hl.map((c, j) => (
                        <div
                          key={j}
                          className="w-4 h-4 rounded-full border border-gray-200"
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                    <p className="text-[10px] font-black text-gray-900">{p.label}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Intensidade de remoção de silêncios (slider, substitui o toggle) */}
          <div className="space-y-2">
            <label className="text-xs font-black text-gray-900 uppercase tracking-widest flex items-center justify-between">
              <span>Remoção de Silêncios</span>
              <span className="text-yellow-600">
                {zapSilenceRemoval === 0 ? 'Desligado' : zapSilenceRemoval.toFixed(1)}
              </span>
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={zapSilenceRemoval}
              onChange={(e) => setZapSilenceRemoval(Number(e.target.value))}
              className="w-full"
            />
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
              0 = desligado · 0.2-0.4 = corte suave · 0.5-0.7 = corte médio · 0.8-1 = corte
              agressivo
            </p>
          </div>
        </div>

        {/* BOTÃO GERAR */}
        <button
          onClick={handleRenderZapSimple}
          disabled={!zapVideoUrl || !zapTemplateId || isRendering || isZapRenderingRef.current}
          className="w-full py-6 bg-yellow-500 text-white rounded-[32px] font-black uppercase tracking-widest hover:bg-yellow-600 transition-all shadow-2xl shadow-yellow-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 text-lg"
        >
          {isRendering ? (
            <>
              <Loader2 className="animate-spin" size={24} />
              {zapState.step || 'Renderizando...'}
            </>
          ) : (
            <>
              <Zap size={24} />
              Gerar Vídeo Editado
            </>
          )}
        </button>
        {!zapVideoUrl && (
          <p className="text-center text-xs text-gray-400 font-bold uppercase tracking-widest">
            Selecione um vídeo na Etapa 1
          </p>
        )}
        {zapVideoUrl && !zapTemplateId && (
          <p className="text-center text-xs text-gray-400 font-bold uppercase tracking-widest">
            Selecione um template na Etapa 2
          </p>
        )}

        {/* Progresso quando renderizando */}
        {isRendering && (
          <div className="bg-yellow-50 p-6 rounded-2xl border-2 border-yellow-200">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-black text-yellow-900">{zapState.step}</p>
              <p className="text-sm font-black text-yellow-900">{zapState.progress}%</p>
            </div>
            <div className="w-full bg-yellow-200 rounded-full h-2 overflow-hidden">
              <div
                className="bg-yellow-600 h-full transition-all duration-500"
                style={{ width: `${zapState.progress}%` }}
              />
            </div>
          </div>
        )}

        {/* GALERIA DE VERSÕES — body or hook depending on the toggle */}
        {activeZapVersions.length > 0 && (
          <div className="space-y-4 pt-8">
            <h4 className="text-xl font-black text-gray-900 uppercase italic">
              Galeria de Versões {isHookEdit ? '(Gancho)' : '(Corpo)'}
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Original (only meaningful for the body side right now) */}
              {!isHookEdit && zapState.originalVideoUrl && (
                <div className="space-y-3">
                  <div className="relative bg-black rounded-[28px] overflow-hidden border-4 border-gray-100 aspect-[9/16]">
                    <video
                      src={
                        getAuthorizedUrl(zapState.originalVideoUrl, platformApiKey || undefined) ||
                        undefined
                      }
                      className="w-full h-full object-contain"
                      controls
                      crossOrigin={
                        zapState.originalVideoUrl?.includes('generativelanguage.googleapis.com')
                          ? ('anonymous' as const)
                          : undefined
                      }
                    />
                    <div className="absolute top-3 left-3 bg-gray-900 text-white text-[9px] font-black px-2 py-1 rounded uppercase tracking-widest">
                      Original
                    </div>
                    <VideoDurationBadge src={zapState.originalVideoUrl} />
                  </div>
                </div>
              )}
              {activeZapVersions.map((vUrl, idx) => (
                <div key={`zap-v-${idx}-${vUrl}`} className="space-y-3">
                  <div
                    className={`relative bg-black rounded-[28px] overflow-hidden border-4 ring-4 aspect-[9/16] ${
                      isHookEdit
                        ? 'border-amber-200 ring-amber-50'
                        : 'border-yellow-200 ring-yellow-50'
                    }`}
                  >
                    <video
                      src={getAuthorizedUrl(vUrl, platformApiKey || undefined) || undefined}
                      className="w-full h-full object-contain"
                      controls
                      crossOrigin={
                        vUrl?.includes('generativelanguage.googleapis.com')
                          ? ('anonymous' as const)
                          : undefined
                      }
                    />
                    <div
                      className={`absolute top-3 left-3 text-white text-[9px] font-black px-2 py-1 rounded uppercase tracking-widest ${
                        isHookEdit ? 'bg-amber-500' : 'bg-yellow-500'
                      }`}
                    >
                      {isHookEdit ? 'Gancho' : 'Versão'} {idx + 1}
                    </div>
                    <VideoDurationBadge src={vUrl} />
                  </div>
                  <div className="flex gap-2">
                    <a
                      href={vUrl}
                      download={`video_zap_${isHookEdit ? 'hook' : 'body'}_v${idx + 1}.mp4`}
                      className="flex-1 py-2 bg-gray-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-black flex items-center justify-center gap-2"
                    >
                      <Download size={12} />
                      Baixar
                    </a>
                    <button
                      onClick={() => {
                        setIntercutSourceUrl(vUrl);
                      }}
                      className="px-3 py-2 bg-purple-50 text-purple-700 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-purple-100 flex items-center justify-center gap-1"
                      title="Inserir cortes pretos com texto entre trechos do avatar"
                    >
                      ✂ Cortes
                    </button>
                    {isHookEdit && (
                      <button
                        onClick={() => {
                          setHeadlineSourceUrl(vUrl);
                        }}
                        className="px-3 py-2 bg-pink-50 text-pink-700 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-pink-100 flex items-center justify-center gap-1"
                        title="Adicionar headline colorida no topo (estilo anúncio Meta)"
                      >
                        📰 Headline
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Excluir Versão ${idx + 1}? Esta ação não pode ser desfeita.`
                          )
                        )
                          return;
                        // Body mode also updates the transient zapState.versions
                        // (gallery state). Hook mode reads straight from config.
                        if (!isHookEdit) {
                          setZapState((prev) => ({
                            ...prev,
                            versions: (prev.versions || []).filter((u) => u !== vUrl),
                            finalVideoUrl:
                              prev.finalVideoUrl === vUrl ? undefined : prev.finalVideoUrl,
                          }));
                        }
                        setConfig((prev) => {
                          const key = isHookEdit ? 'zapHookVersions' : 'zapVersions';
                          const current = ((prev.edit as any)[key] as string[] | undefined) || [];
                          return {
                            ...prev,
                            edit: {
                              ...prev.edit,
                              [key]: current.filter((u) => u !== vUrl),
                            },
                          };
                        });
                        toast.success(`Versão ${idx + 1} excluída.`);
                      }}
                      className="px-3 py-2 bg-red-50 text-red-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-100 flex items-center justify-center gap-1"
                      title="Excluir esta versão"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* JUNTAR Gancho + Corpo — picker livre (escondido se o projeto
            não usa gancho). Defaults para a última versão de cada lado,
            mas qualquer combinação é permitida. */}
        {useHookFlow && hookZapVersions.length > 0 && bodyZapVersions.length > 0 && (() => {
          const effectiveHookUrl =
            selectedJoinHookUrl && hookZapVersions.includes(selectedJoinHookUrl)
              ? selectedJoinHookUrl
              : hookZapVersions[hookZapVersions.length - 1];
          const effectiveBodyUrl =
            selectedJoinBodyUrl && bodyZapVersions.includes(selectedJoinBodyUrl)
              ? selectedJoinBodyUrl
              : bodyZapVersions[bodyZapVersions.length - 1];

          return (
            <div className="bg-gradient-to-br from-amber-50 to-yellow-50 p-8 rounded-[40px] border-4 border-amber-200 shadow-xl space-y-5 mt-8">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-amber-500 rounded-2xl flex items-center justify-center text-white">
                  <Layers size={22} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-gray-900 uppercase italic">
                    Juntar Gancho + Corpo
                  </h3>
                  <p className="text-xs text-gray-500">
                    Escolha qualquer versão do gancho e qualquer versão do corpo. O
                    resultado vai pra galeria "Vídeos Completos" abaixo.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Hook picker */}
                <div className="bg-white p-4 rounded-2xl border-2 border-amber-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black text-amber-600 uppercase tracking-widest">
                      Gancho (1º)
                    </span>
                    <span className="text-[10px] text-gray-400 font-bold">
                      {hookZapVersions.length}{' '}
                      {hookZapVersions.length === 1 ? 'versão' : 'versões'}
                    </span>
                  </div>
                  <select
                    value={effectiveHookUrl}
                    onChange={(e) => setSelectedJoinHookUrl(e.target.value)}
                    className="w-full p-2 border-2 border-gray-200 rounded-xl text-xs focus:border-amber-500 focus:outline-none"
                  >
                    {hookZapVersions.map((url, i) => (
                      <option key={url} value={url}>
                        Gancho {i + 1}
                        {i === hookZapVersions.length - 1 ? ' (mais recente)' : ''}
                      </option>
                    ))}
                  </select>
                  <div className="relative bg-black rounded-xl overflow-hidden aspect-[9/16] max-h-48 mx-auto">
                    <video
                      src={
                        getAuthorizedUrl(effectiveHookUrl, platformApiKey || undefined) ||
                        undefined
                      }
                      className="w-full h-full object-contain"
                      controls
                      muted
                    />
                    <VideoDurationBadge src={effectiveHookUrl} />
                  </div>
                </div>

                {/* Body picker */}
                <div className="bg-white p-4 rounded-2xl border-2 border-yellow-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black text-yellow-600 uppercase tracking-widest">
                      Corpo (2º)
                    </span>
                    <span className="text-[10px] text-gray-400 font-bold">
                      {bodyZapVersions.length}{' '}
                      {bodyZapVersions.length === 1 ? 'versão' : 'versões'}
                    </span>
                  </div>
                  <select
                    value={effectiveBodyUrl}
                    onChange={(e) => setSelectedJoinBodyUrl(e.target.value)}
                    className="w-full p-2 border-2 border-gray-200 rounded-xl text-xs focus:border-yellow-500 focus:outline-none"
                  >
                    {bodyZapVersions.map((url, i) => (
                      <option key={url} value={url}>
                        Versão {i + 1}
                        {i === bodyZapVersions.length - 1 ? ' (mais recente)' : ''}
                      </option>
                    ))}
                  </select>
                  <div className="relative bg-black rounded-xl overflow-hidden aspect-[9/16] max-h-48 mx-auto">
                    <video
                      src={
                        getAuthorizedUrl(effectiveBodyUrl, platformApiKey || undefined) ||
                        undefined
                      }
                      className="w-full h-full object-contain"
                      controls
                      muted
                    />
                    <VideoDurationBadge src={effectiveBodyUrl} />
                  </div>
                </div>
              </div>

              <button
                onClick={async () => {
                  if (!user?.uid) {
                    toast.error('Faça login antes de juntar.');
                    return;
                  }
                  setJoinRendering(true);
                  const toastId = 'join-render';
                  toast.loading('Juntando gancho + corpo...', { id: toastId, duration: 60000 });
                  try {
                    const res = await fetch('/api/video/concat', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        videos: [effectiveHookUrl, effectiveBodyUrl],
                        userId: user.uid,
                      }),
                    });
                    const json = await res.json();
                    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
                    // Persist into the dedicated "joined" array — visible in
                    // both Body and Hook modes so the user always sees it.
                    setConfig((prev) => {
                      const current =
                        ((prev.edit as any).zapJoinedVersions as string[] | undefined) || [];
                      return {
                        ...prev,
                        edit: {
                          ...prev.edit,
                          zapJoinedVersions: [...current, json.url],
                        },
                      };
                    });
                    toast.success('Vídeo completo (gancho + corpo) criado!', {
                      id: toastId,
                      duration: 5000,
                    });
                  } catch (err: any) {
                    toast.error(`Falha ao juntar: ${err.message}`, {
                      id: toastId,
                      duration: 6000,
                    });
                  } finally {
                    setJoinRendering(false);
                  }
                }}
                disabled={joinRendering}
                className="w-full py-4 bg-amber-600 text-white rounded-2xl text-sm font-black uppercase tracking-widest hover:bg-amber-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {joinRendering ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Juntando...
                  </>
                ) : (
                  <>
                    <Layers size={16} />
                    Juntar agora (gancho → corpo)
                  </>
                )}
              </button>
            </div>
          );
        })()}

        {/* Galeria compartilhada de vídeos completos (gancho+corpo). Sempre
            visível, em qualquer modo, porque o "juntado" não pertence a
            nenhum dos dois lados isoladamente. */}
        {useHookFlow && (() => {
          const joined =
            ((config.edit as any)?.zapJoinedVersions as string[] | undefined) || [];
          if (joined.length === 0) return null;
          return (
            <div className="space-y-4 pt-8">
              <h4 className="text-xl font-black text-gray-900 uppercase italic flex items-center gap-2">
                <Layers size={20} className="text-amber-500" />
                Vídeos Completos (Gancho + Corpo)
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {joined.map((vUrl, idx) => (
                  <div key={`zap-joined-${idx}-${vUrl}`} className="space-y-3">
                    <div className="relative bg-black rounded-[28px] overflow-hidden border-4 border-amber-300 ring-4 ring-amber-50 aspect-[9/16]">
                      <video
                        src={getAuthorizedUrl(vUrl, platformApiKey || undefined) || undefined}
                        className="w-full h-full object-contain"
                        controls
                        crossOrigin={
                          vUrl?.includes('generativelanguage.googleapis.com')
                            ? ('anonymous' as const)
                            : undefined
                        }
                      />
                      <div className="absolute top-3 left-3 bg-amber-600 text-white text-[9px] font-black px-2 py-1 rounded uppercase tracking-widest">
                        Completo {idx + 1}
                      </div>
                      <VideoDurationBadge src={vUrl} />
                    </div>
                    <div className="flex gap-2">
                      <a
                        href={vUrl}
                        download={`video_completo_${idx + 1}.mp4`}
                        className="flex-1 py-2 bg-gray-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-black flex items-center justify-center gap-2"
                      >
                        <Download size={12} />
                        Baixar
                      </a>
                      <button
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Excluir Vídeo Completo ${idx + 1}? Esta ação não pode ser desfeita.`
                            )
                          )
                            return;
                          setConfig((prev) => {
                            const current =
                              ((prev.edit as any).zapJoinedVersions as string[] | undefined) ||
                              [];
                            return {
                              ...prev,
                              edit: {
                                ...prev.edit,
                                zapJoinedVersions: current.filter((u) => u !== vUrl),
                              },
                            };
                          });
                          toast.success(`Vídeo Completo ${idx + 1} excluído.`);
                        }}
                        className="px-3 py-2 bg-red-50 text-red-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-100 flex items-center justify-center gap-1"
                        title="Excluir este vídeo completo"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {intercutSourceUrl && (
          <div
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={() => !intercutRendering && setIntercutSourceUrl(null)}
          >
            <div
              className="bg-white rounded-[28px] max-w-2xl w-full max-h-[90vh] overflow-y-auto p-8 space-y-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="space-y-2">
                <h3 className="text-2xl font-black text-gray-900 uppercase italic">
                  ✂ Cortes pretos com texto
                </h3>
                <p className="text-sm text-gray-600">
                  Alterna entre o avatar e tela preta com texto grande. O áudio continua tocando
                  durante a tela preta — só a imagem muda.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-[11px] font-black uppercase tracking-widest text-gray-700">
                    Duração do avatar entre cortes:{' '}
                    <span className="text-purple-700">{intercutAvatarSec}s</span>
                  </label>
                  <input
                    type="range"
                    min={5}
                    max={60}
                    step={1}
                    value={intercutAvatarSec}
                    onChange={(e) => setIntercutAvatarSec(parseInt(e.target.value))}
                    className="w-full accent-purple-600"
                    disabled={intercutRendering}
                  />
                </div>

                <div>
                  <label className="text-[11px] font-black uppercase tracking-widest text-gray-700">
                    Duração da tela preta:{' '}
                    <span className="text-purple-700">{intercutBlackSec}s</span>
                  </label>
                  <input
                    type="range"
                    min={3}
                    max={60}
                    step={1}
                    value={intercutBlackSec}
                    onChange={(e) => setIntercutBlackSec(parseInt(e.target.value))}
                    className="w-full accent-purple-600"
                    disabled={intercutRendering}
                  />
                  <p className="text-[10px] text-gray-500 mt-1">
                    Pode ir até 60s por corte se quiser segurar o texto na tela.
                  </p>
                </div>

                <div>
                  <label className="text-[11px] font-black uppercase tracking-widest text-gray-700">
                    Tamanho da fonte:{' '}
                    <span className="text-purple-700">{intercutFontSize}px</span>
                  </label>
                  <input
                    type="range"
                    min={28}
                    max={120}
                    step={2}
                    value={intercutFontSize}
                    onChange={(e) => setIntercutFontSize(parseInt(e.target.value))}
                    className="w-full accent-purple-600"
                    disabled={intercutRendering}
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-black uppercase tracking-widest text-gray-700">
                    Textos das telas pretas
                  </label>
                  <button
                    type="button"
                    onClick={() => setIntercutTexts((prev) => [...prev, ''])}
                    className="text-[10px] font-black uppercase tracking-widest text-purple-700 hover:text-purple-900"
                    disabled={intercutRendering}
                  >
                    + Adicionar
                  </button>
                </div>
                <p className="text-[10px] text-gray-500 -mt-2">
                  Se houver mais cortes que textos, eles são reutilizados em ciclo.
                </p>
                {intercutTexts.map((t, i) => (
                  <div key={`intercut-text-${i}`} className="flex gap-2">
                    <textarea
                      value={t}
                      onChange={(e) => {
                        const next = [...intercutTexts];
                        next[i] = e.target.value;
                        setIntercutTexts(next);
                      }}
                      placeholder={`Texto ${i + 1} (ex.: "ESSA IA TRANSCREVE EM 30 SEGUNDOS")`}
                      rows={2}
                      className="flex-1 p-3 border-2 border-gray-200 rounded-xl text-sm focus:border-purple-500 focus:outline-none resize-none"
                      disabled={intercutRendering}
                    />
                    {intercutTexts.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setIntercutTexts((prev) => prev.filter((_, j) => j !== i))
                        }
                        className="px-3 bg-red-50 text-red-600 rounded-xl hover:bg-red-100"
                        disabled={intercutRendering}
                        title="Remover este texto"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setIntercutSourceUrl(null)}
                  disabled={intercutRendering}
                  className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-gray-200 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleRenderIntercut}
                  disabled={intercutRendering}
                  className="flex-1 py-3 bg-purple-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-purple-700 disabled:opacity-50"
                >
                  {intercutRendering ? 'Gerando...' : 'Gerar com cortes pretos'}
                </button>
              </div>
            </div>
          </div>
        )}

        {headlineSourceUrl && (
          <div
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={() => !headlineRendering && setHeadlineSourceUrl(null)}
          >
            <div
              className="bg-white rounded-[28px] max-w-2xl w-full max-h-[90vh] overflow-y-auto p-8 space-y-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="space-y-2">
                <h3 className="text-2xl font-black text-gray-900 uppercase italic">
                  📰 Headline no topo do vídeo
                </h3>
                <p className="text-sm text-gray-600">
                  Adiciona uma barra colorida com texto no topo do gancho —
                  estilo anúncio do Meta. Cria uma nova versão; o original fica
                  intacto.
                </p>
              </div>

              <div>
                <label className="text-[11px] font-black uppercase tracking-widest text-gray-700">
                  Texto da headline
                </label>
                <input
                  type="text"
                  value={headlineText}
                  onChange={(e) => setHeadlineText(e.target.value)}
                  placeholder='Ex.: "ÚLTIMAS VAGAS — 50% OFF HOJE"'
                  className="w-full p-3 border-2 border-gray-200 rounded-xl text-sm focus:border-pink-500 focus:outline-none"
                  disabled={headlineRendering}
                  maxLength={140}
                />
                <p className="text-[10px] text-gray-500 mt-1">
                  {headlineText.length}/140 caracteres. Use os chips abaixo pra colorir
                  palavras individuais.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] font-black uppercase tracking-widest text-gray-700">
                    Cor do fundo
                  </label>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="color"
                      value={headlineBgColor}
                      onChange={(e) => setHeadlineBgColor(e.target.value)}
                      disabled={headlineRendering}
                      className="h-12 w-16 rounded-xl border-2 border-gray-200 cursor-pointer"
                    />
                    <input
                      type="text"
                      value={headlineBgColor}
                      onChange={(e) => setHeadlineBgColor(e.target.value)}
                      disabled={headlineRendering}
                      className="flex-1 p-3 border-2 border-gray-200 rounded-xl text-xs font-mono focus:border-pink-500 focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-black uppercase tracking-widest text-gray-700">
                    Cor das letras (padrão)
                  </label>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="color"
                      value={headlineTextColor}
                      onChange={(e) => setHeadlineTextColor(e.target.value)}
                      disabled={headlineRendering}
                      className="h-12 w-16 rounded-xl border-2 border-gray-200 cursor-pointer"
                    />
                    <input
                      type="text"
                      value={headlineTextColor}
                      onChange={(e) => setHeadlineTextColor(e.target.value)}
                      disabled={headlineRendering}
                      className="flex-1 p-3 border-2 border-gray-200 rounded-xl text-xs font-mono focus:border-pink-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Stroke (contorno) — opcional */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] font-black uppercase tracking-widest text-gray-700">
                    Cor da borda
                  </label>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="color"
                      value={headlineStrokeColor}
                      onChange={(e) => setHeadlineStrokeColor(e.target.value)}
                      disabled={headlineRendering}
                      className="h-12 w-16 rounded-xl border-2 border-gray-200 cursor-pointer"
                    />
                    <input
                      type="text"
                      value={headlineStrokeColor}
                      onChange={(e) => setHeadlineStrokeColor(e.target.value)}
                      disabled={headlineRendering}
                      className="flex-1 p-3 border-2 border-gray-200 rounded-xl text-xs font-mono focus:border-pink-500 focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-black uppercase tracking-widest text-gray-700">
                    Espessura da borda:{' '}
                    <span className="text-pink-700">
                      {headlineStrokeWidth === 0 ? 'sem borda' : `${headlineStrokeWidth}px`}
                    </span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={6}
                    step={1}
                    value={headlineStrokeWidth}
                    onChange={(e) => setHeadlineStrokeWidth(parseInt(e.target.value))}
                    disabled={headlineRendering}
                    className="w-full accent-pink-600 mt-3"
                  />
                </div>
              </div>

              {/* Paletas: 3 cores de letra + 3 cores de fundo */}
              <div className="bg-gray-50 p-3 rounded-xl border-2 border-gray-100 space-y-3">
                <div>
                  <label className="text-[11px] font-black uppercase tracking-widest text-gray-700">
                    Paleta — cor das letras (palavras destacadas)
                  </label>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    {[
                      { v: headlineHl1, set: setHeadlineHl1, label: 'Letra 1' },
                      { v: headlineHl2, set: setHeadlineHl2, label: 'Letra 2' },
                      { v: headlineHl3, set: setHeadlineHl3, label: 'Letra 3' },
                    ].map((hl, i) => (
                      <div key={i}>
                        <div className="text-[9px] font-black text-gray-600 uppercase tracking-widest mb-1">
                          {hl.label}
                        </div>
                        <div className="flex items-center gap-1">
                          <input
                            type="color"
                            value={hl.v}
                            onChange={(e) => hl.set(e.target.value)}
                            disabled={headlineRendering}
                            className="h-9 w-12 rounded-lg border-2 border-gray-200 cursor-pointer"
                          />
                          <input
                            type="text"
                            value={hl.v}
                            onChange={(e) => hl.set(e.target.value)}
                            disabled={headlineRendering}
                            className="flex-1 p-1.5 border-2 border-gray-200 rounded-lg text-[10px] font-mono focus:border-pink-500 focus:outline-none min-w-0"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-black uppercase tracking-widest text-gray-700">
                    Paleta — cor de fundo (palavras destacadas)
                  </label>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    {[
                      { v: headlineBgHl1, set: setHeadlineBgHl1, label: 'Fundo 1' },
                      { v: headlineBgHl2, set: setHeadlineBgHl2, label: 'Fundo 2' },
                      { v: headlineBgHl3, set: setHeadlineBgHl3, label: 'Fundo 3' },
                    ].map((hl, i) => (
                      <div key={i}>
                        <div className="text-[9px] font-black text-gray-600 uppercase tracking-widest mb-1">
                          {hl.label}
                        </div>
                        <div className="flex items-center gap-1">
                          <input
                            type="color"
                            value={hl.v}
                            onChange={(e) => hl.set(e.target.value)}
                            disabled={headlineRendering}
                            className="h-9 w-12 rounded-lg border-2 border-gray-200 cursor-pointer"
                          />
                          <input
                            type="text"
                            value={hl.v}
                            onChange={(e) => hl.set(e.target.value)}
                            disabled={headlineRendering}
                            className="flex-1 p-1.5 border-2 border-gray-200 rounded-lg text-[10px] font-mono focus:border-pink-500 focus:outline-none min-w-0"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Live preview of the bar styling. Uses the SOURCE video's
                  actual dimensions (loaded via the hidden metadata <video>
                  in headlineSourceDims) to scale font + bar proportionally
                  to a fixed preview width, so what the user sees here
                  matches what FFmpeg outputs. Positioned right above the
                  word picker so the user sees the live result while
                  customizing per-word colors. */}
              {(() => {
                const previewWidth = 480; // CSS px allocated to preview
                const videoW = headlineSourceDims?.width || 1080;
                const videoH = headlineSourceDims?.height || 1920;
                const scale = previewWidth / videoW;
                const previewBarH = Math.round(videoH * (headlineBarHeightPct / 100) * scale);
                const previewFontPx = Math.round(headlineFontSize * scale);
                // ASS uses Arial; mirror in CSS so wrapping behaves similarly.
                const previewStroke =
                  headlineStrokeWidth > 0
                    ? `${Math.max(1, headlineStrokeWidth * scale)}px ${headlineStrokeColor}`
                    : undefined;

                const renderPreview = (
                  t: string,
                  ws: Array<{ tc: number; bg: number }>,
                  barBg: string
                ) => {
                  const words = t.split(/\s+/).filter(Boolean);
                  const tcMap = [
                    headlineTextColor,
                    headlineHl1,
                    headlineHl2,
                    headlineHl3,
                  ];
                  const bgMap = ['', headlineBgHl1, headlineBgHl2, headlineBgHl3];
                  return (
                    <div
                      className="mt-1 flex items-center justify-center rounded-xl border-2 border-gray-200 overflow-hidden mx-auto"
                      style={{
                        backgroundColor: barBg,
                        color: headlineTextColor,
                        width: `${previewWidth}px`,
                        height: `${Math.max(20, previewBarH)}px`,
                        maxWidth: '100%',
                      }}
                    >
                      <span
                        className="font-black text-center leading-tight"
                        style={{
                          fontFamily: 'Arial, sans-serif',
                          fontSize: `${previewFontPx}px`,
                          WebkitTextStroke: previewStroke,
                          paintOrder: 'stroke fill',
                          padding: `0 ${Math.round(40 * scale)}px`,
                          wordBreak: 'normal',
                        }}
                      >
                        {words.map((w, i) => {
                          const wst = ws[i] || { tc: 0, bg: 0 };
                          const color = tcMap[wst.tc] || headlineTextColor;
                          const bg = bgMap[wst.bg] || 'transparent';
                          return (
                            <span key={`prev-${i}`}>
                              <span
                                style={{
                                  color,
                                  backgroundColor: bg,
                                  padding: wst.bg > 0 ? '0 0.12em' : 0,
                                }}
                              >
                                {w}
                              </span>
                              {i < words.length - 1 ? ' ' : ''}
                            </span>
                          );
                        })}
                      </span>
                    </div>
                  );
                };

                return (
                  <div>
                    <label className="text-[11px] font-black uppercase tracking-widest text-gray-700">
                      Pré-visualização da barra
                      {headlineSourceDims && (
                        <span className="ml-2 text-[9px] text-gray-400 normal-case font-normal">
                          (escala real do vídeo: {videoW}×{videoH})
                        </span>
                      )}
                    </label>
                    {renderPreview(
                      headlineText || 'SUA HEADLINE AQUI',
                      headlineWordStyles,
                      headlineBgColor
                    )}
                    {headline2Enabled && headline2Text.trim() && (
                      <>
                        <p className="text-[10px] text-gray-500 mt-3 mb-1">
                          ↓ 2ª headline (substitui a 1ª na hora certa)
                        </p>
                        {renderPreview(
                          headline2Text,
                          headline2WordStyles,
                          headline2BgColor
                        )}
                      </>
                    )}
                  </div>
                );
              })()}

              {/* Word-by-word picker: each chip has 2 cycle buttons (L/F)
                  that step through the palette (none → 1 → 2 → 3 → none). */}
              {(() => {
                const words = headlineText.split(/\s+/).filter(Boolean);
                if (words.length === 0) {
                  return (
                    <div className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl p-4 text-center">
                      <p className="text-xs text-gray-500">
                        Digite o texto acima pra escolher as cores de cada palavra.
                      </p>
                    </div>
                  );
                }
                const textColorMap = [
                  headlineTextColor,
                  headlineHl1,
                  headlineHl2,
                  headlineHl3,
                ];
                const bgColorMap = ['', headlineBgHl1, headlineBgHl2, headlineBgHl3];
                return (
                  <div className="bg-gray-50 p-3 rounded-xl border-2 border-gray-100 space-y-2">
                    <label className="text-[11px] font-black uppercase tracking-widest text-gray-700">
                      Personalizar palavras (clique nos botões L=Letra / F=Fundo)
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {words.map((w, i) => {
                        const ws = headlineWordStyles[i] || { tc: 0, bg: 0 };
                        const tcColor = textColorMap[ws.tc] || headlineTextColor;
                        const bgC = bgColorMap[ws.bg] || '';
                        const cycle = (
                          field: 'tc' | 'bg'
                        ): void => {
                          setHeadlineWordStyles((prev) => {
                            const next = words.map(
                              (_, j) => prev[j] || { tc: 0, bg: 0 }
                            );
                            const cur = next[i] || { tc: 0, bg: 0 };
                            next[i] = {
                              ...cur,
                              [field]: ((cur[field] || 0) + 1) % 4,
                            };
                            return next;
                          });
                        };
                        return (
                          <div
                            key={`word-${i}-${w}`}
                            className="flex flex-col items-center gap-1 p-2 rounded-lg border-2 border-gray-100"
                            style={{ backgroundColor: headlineBgColor }}
                          >
                            <span
                              className="text-xs font-black px-2 py-1 rounded"
                              style={{
                                color: tcColor,
                                backgroundColor: bgC || 'transparent',
                              }}
                            >
                              {w}
                            </span>
                            <div className="flex gap-1">
                              <button
                                onClick={() => cycle('tc')}
                                title={`Letra: ${ws.tc === 0 ? 'padrão' : `cor ${ws.tc}`}`}
                                className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/90 hover:bg-white text-[9px] font-black text-gray-700"
                              >
                                L
                                <span
                                  className="w-2 h-2 rounded-full border border-gray-300"
                                  style={{ backgroundColor: tcColor }}
                                />
                                <span className="text-gray-400">{ws.tc}</span>
                              </button>
                              <button
                                onClick={() => cycle('bg')}
                                title={`Fundo: ${ws.bg === 0 ? 'nenhum' : `cor ${ws.bg}`}`}
                                className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/90 hover:bg-white text-[9px] font-black text-gray-700"
                              >
                                F
                                <span
                                  className="w-2 h-2 rounded-full border border-gray-300"
                                  style={{
                                    backgroundColor: bgC || 'transparent',
                                  }}
                                />
                                <span className="text-gray-400">{ws.bg}</span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <button
                      onClick={() => setHeadlineWordStyles([])}
                      disabled={headlineRendering}
                      className="text-[10px] font-black text-gray-500 hover:text-gray-700 underline"
                    >
                      Limpar todas as cores
                    </button>
                  </div>
                );
              })()}

              {/* Optional second headline — appears after switching at
                  switchPct % of the video duration. Inherits the global
                  palette / stroke / font size; only the text, bar bg color
                  and word styles are configured separately. */}
              <div className="border-t-2 border-gray-100 pt-4 space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={headline2Enabled}
                    onChange={(e) => setHeadline2Enabled(e.target.checked)}
                    disabled={headlineRendering}
                    className="w-4 h-4 accent-pink-500"
                  />
                  <span className="text-[11px] font-black text-gray-700 uppercase tracking-widest">
                    ➕ Adicionar segunda headline
                  </span>
                </label>
                <p className="text-[10px] text-gray-500 -mt-1 ml-6">
                  A 1ª aparece no início, a 2ª substitui no ponto que você
                  escolher. Ambas usam a mesma paleta e borda.
                </p>

                {headline2Enabled && (
                  <div className="space-y-3 ml-6 pl-4 border-l-4 border-pink-100">
                    {/* Auto-sync: backend transcribes audio + matches each
                        headline text to the avatar's speech timestamps. */}
                    <label className="flex items-start gap-2 cursor-pointer p-2 bg-blue-50 border-2 border-blue-200 rounded-lg">
                      <input
                        type="checkbox"
                        checked={headlineAutoTime}
                        onChange={(e) => setHeadlineAutoTime(e.target.checked)}
                        disabled={headlineRendering}
                        className="w-4 h-4 accent-blue-500 mt-0.5"
                      />
                      <div className="flex-1">
                        <span className="text-[11px] font-black text-blue-900 uppercase tracking-widest block">
                          🎙 Sincronizar com a fala (auto)
                        </span>
                        <span className="text-[10px] text-blue-800 leading-tight">
                          Transcreve o áudio e detecta o momento exato que o avatar fala
                          cada headline. As headlines aparecem só durante a fala (some quando
                          ele para de falar). Demora +30-90s (transcrição via AssemblyAI).
                        </span>
                      </div>
                    </label>

                    {/* Manual switch slider — só aparece quando auto-sync está OFF */}
                    {!headlineAutoTime && (
                      <div>
                        <label className="text-[11px] font-black uppercase tracking-widest text-gray-700">
                          Trocar headline em:{' '}
                          <span className="text-pink-700">{headlineSwitchPct}%</span>{' '}
                          do vídeo
                        </label>
                        <input
                          type="range"
                          min={10}
                          max={90}
                          step={5}
                          value={headlineSwitchPct}
                          onChange={(e) => setHeadlineSwitchPct(parseInt(e.target.value))}
                          disabled={headlineRendering}
                          className="w-full accent-pink-600"
                        />
                      </div>
                    )}

                    <div>
                      <label className="text-[11px] font-black uppercase tracking-widest text-gray-700">
                        Texto da 2ª headline
                      </label>
                      <input
                        type="text"
                        value={headline2Text}
                        onChange={(e) => setHeadline2Text(e.target.value)}
                        placeholder='Ex.: "AGORA POR APENAS R$ 97"'
                        className="w-full p-3 border-2 border-gray-200 rounded-xl text-sm focus:border-pink-500 focus:outline-none"
                        disabled={headlineRendering}
                        maxLength={140}
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-black uppercase tracking-widest text-gray-700">
                        Cor do fundo da 2ª barra
                      </label>
                      <div className="flex items-center gap-2 mt-1">
                        <input
                          type="color"
                          value={headline2BgColor}
                          onChange={(e) => setHeadline2BgColor(e.target.value)}
                          disabled={headlineRendering}
                          className="h-10 w-14 rounded-lg border-2 border-gray-200 cursor-pointer"
                        />
                        <input
                          type="text"
                          value={headline2BgColor}
                          onChange={(e) => setHeadline2BgColor(e.target.value)}
                          disabled={headlineRendering}
                          className="flex-1 p-2 border-2 border-gray-200 rounded-lg text-xs font-mono focus:border-pink-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* Word picker for 2nd headline — same UX as 1st */}
                    {(() => {
                      const words = headline2Text.split(/\s+/).filter(Boolean);
                      if (words.length === 0) {
                        return (
                          <div className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl p-3 text-center">
                            <p className="text-[11px] text-gray-500">
                              Digite o texto da 2ª headline pra customizar palavras.
                            </p>
                          </div>
                        );
                      }
                      const textColorMap = [
                        headlineTextColor,
                        headlineHl1,
                        headlineHl2,
                        headlineHl3,
                      ];
                      const bgColorMap = [
                        '',
                        headlineBgHl1,
                        headlineBgHl2,
                        headlineBgHl3,
                      ];
                      return (
                        <div className="bg-gray-50 p-3 rounded-xl border-2 border-gray-100 space-y-2">
                          <label className="text-[11px] font-black uppercase tracking-widest text-gray-700">
                            Personalizar palavras da 2ª headline
                          </label>
                          <div className="flex flex-wrap gap-2">
                            {words.map((w, i) => {
                              const ws = headline2WordStyles[i] || { tc: 0, bg: 0 };
                              const tcColor = textColorMap[ws.tc] || headlineTextColor;
                              const bgC = bgColorMap[ws.bg] || '';
                              const cycle = (field: 'tc' | 'bg'): void => {
                                setHeadline2WordStyles((prev) => {
                                  const next = words.map(
                                    (_, j) => prev[j] || { tc: 0, bg: 0 }
                                  );
                                  const cur = next[i] || { tc: 0, bg: 0 };
                                  next[i] = {
                                    ...cur,
                                    [field]: ((cur[field] || 0) + 1) % 4,
                                  };
                                  return next;
                                });
                              };
                              return (
                                <div
                                  key={`word2-${i}-${w}`}
                                  className="flex flex-col items-center gap-1 p-2 rounded-lg border-2 border-gray-100"
                                  style={{ backgroundColor: headline2BgColor }}
                                >
                                  <span
                                    className="text-xs font-black px-2 py-1 rounded"
                                    style={{
                                      color: tcColor,
                                      backgroundColor: bgC || 'transparent',
                                    }}
                                  >
                                    {w}
                                  </span>
                                  <div className="flex gap-1">
                                    <button
                                      onClick={() => cycle('tc')}
                                      className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/90 hover:bg-white text-[9px] font-black text-gray-700"
                                    >
                                      L
                                      <span
                                        className="w-2 h-2 rounded-full border border-gray-300"
                                        style={{ backgroundColor: tcColor }}
                                      />
                                      <span className="text-gray-400">{ws.tc}</span>
                                    </button>
                                    <button
                                      onClick={() => cycle('bg')}
                                      className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/90 hover:bg-white text-[9px] font-black text-gray-700"
                                    >
                                      F
                                      <span
                                        className="w-2 h-2 rounded-full border border-gray-300"
                                        style={{ backgroundColor: bgC || 'transparent' }}
                                      />
                                      <span className="text-gray-400">{ws.bg}</span>
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <button
                            onClick={() => setHeadline2WordStyles([])}
                            disabled={headlineRendering}
                            className="text-[10px] font-black text-gray-500 hover:text-gray-700 underline"
                          >
                            Limpar cores da 2ª headline
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>


              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] font-black uppercase tracking-widest text-gray-700">
                    Tamanho da fonte:{' '}
                    <span className="text-pink-700">{headlineFontSize}px</span>
                  </label>
                  <input
                    type="range"
                    min={24}
                    max={140}
                    step={2}
                    value={headlineFontSize}
                    onChange={(e) => setHeadlineFontSize(parseInt(e.target.value))}
                    className="w-full accent-pink-600"
                    disabled={headlineRendering}
                  />
                </div>
                <div>
                  <label className="text-[11px] font-black uppercase tracking-widest text-gray-700">
                    Altura da barra:{' '}
                    <span className="text-pink-700">{headlineBarHeightPct}%</span>
                  </label>
                  <input
                    type="range"
                    min={5}
                    max={30}
                    step={1}
                    value={headlineBarHeightPct}
                    onChange={(e) => setHeadlineBarHeightPct(parseInt(e.target.value))}
                    className="w-full accent-pink-600"
                    disabled={headlineRendering}
                  />
                  <p className="text-[10px] text-gray-500 mt-1">
                    % da altura total do vídeo
                  </p>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setHeadlineSourceUrl(null)}
                  disabled={headlineRendering}
                  className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-gray-200 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleRenderHeadline}
                  disabled={headlineRendering || !headlineText.trim()}
                  className="flex-1 py-3 bg-pink-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-pink-700 disabled:opacity-50"
                >
                  {headlineRendering ? 'Aplicando...' : 'Aplicar headline'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderEdit2Step = () => {
    const isAnalyzed =
      autoEditState.status === 'analyzed' ||
      autoEditState.status === 'rendering' ||
      autoEditState.status === 'completed';
    const isCompleted = autoEditState.status === 'completed';

    return (
      <div className="max-w-[1200px] mx-auto p-6 space-y-10">
        {/* Header Section */}
        <div className="bg-white p-10 rounded-[48px] border-4 border-gray-50 shadow-2xl space-y-4">
          <div className="flex items-center gap-6">
            <div className="w-20 h-20 bg-blue-600 rounded-[28px] flex items-center justify-center text-white shadow-xl shadow-blue-100">
              <Zap size={40} className="fill-current" />
            </div>
            <div>
              <h2 className="text-4xl font-black text-gray-900 tracking-tighter uppercase italic">
                Edição Inteligente <span className="text-blue-600">V2</span>
              </h2>
              <p className="text-gray-400 font-bold uppercase text-[10px] tracking-[0.3em]">
                Análise Neural + Legendas Animadas + B-Roll + Zooms
              </p>
            </div>
          </div>
        </div>

        {/* PARTE 1 — Interface de Upload */}
        <div className="bg-white p-10 rounded-[48px] border-4 border-gray-50 shadow-2xl space-y-8 animate-in fade-in zoom-in duration-500">
          <div className="flex flex-col items-center text-center gap-4">
            <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center">
              <Upload size={32} />
            </div>
            <div>
              <h3 className="text-2xl font-black text-gray-900 uppercase italic tracking-tighter">
                Primeiro, vamos carregar seu vídeo
              </h3>
              <p className="text-gray-400 font-bold uppercase text-[10px] tracking-widest">
                Siga as instruções abaixo para iniciar a edição inteligente.
              </p>
            </div>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) handleUploadVideo(file);
            }}
            onClick={() => {
              if (autoEditState.status === 'uploading') return;
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = 'video/mp4,video/quicktime,video/x-msvideo,video/webm';
              input.onchange = (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) handleUploadVideo(file);
              };
              input.click();
            }}
            className={cn(
              'relative border-4 border-dashed rounded-[32px] p-12 transition-all cursor-pointer flex flex-col items-center gap-6',
              isDragging
                ? 'border-blue-600 bg-blue-50 scale-[0.98]'
                : 'border-gray-100 hover:border-blue-200 hover:bg-gray-50',
              autoEditState.status === 'uploading' && 'pointer-events-none opacity-50'
            )}
          >
            <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-lg text-blue-600">
              {autoEditState.status === 'uploading' ? (
                <Loader2 className="animate-spin" size={40} />
              ) : (
                <Upload size={40} />
              )}
            </div>

            <div className="text-center space-y-2">
              <p className="text-lg font-black text-gray-900 uppercase italic">
                {autoEditState.status === 'uploading'
                  ? `Carregando... ${Math.round(uploadProgress)}%`
                  : 'Arraste seu vídeo aqui ou clique para selecionar'}
              </p>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
                MP4, MOV, AVI, WEBM • Máximo 3 minutos
              </p>
            </div>

            {autoEditState.status === 'uploading' && (
              <div className="w-full max-w-md h-3 bg-gray-100 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${uploadProgress}%` }}
                  className="h-full bg-blue-600 shadow-lg shadow-blue-200"
                />
              </div>
            )}
            {autoEditState.compressing && (
              <div className="flex flex-col items-center gap-2">
                <span className="text-[10px] font-black text-blue-600 uppercase animate-pulse">
                  Otimizando vídeo... ⚡
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-4 text-gray-300">
            <div className="flex-1 h-px bg-gray-100" />
            <span className="text-[10px] font-black uppercase tracking-[0.5em]">OU</span>
            <div className="flex-1 h-px bg-gray-100" />
          </div>

          <div className="space-y-4">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block text-center">
              Escolha um vídeo já carregado
            </label>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {userVideos.length > 0 ? (
                userVideos.map((video, idx) => {
                  const isSelected = autoEditState.originalVideoUrl === video.url;
                  return (
                    <button
                      key={`user-bib-video-${idx}-${video.url || 'no-url'}`}
                      onClick={async () => {
                        setVideoUrl(video.url);
                        const format = await detectVideoFormatFromUrl(video.url);
                        setAutoEditState((prev) => ({
                          ...prev,
                          originalVideoUrl: video.url,
                          videoFormat: format,
                        }));
                        toast.success(`Vídeo selecionado! Formato: ${format}`);
                      }}
                      className={cn(
                        'relative rounded-2xl overflow-hidden border-2 transition-all text-left group flex flex-col',
                        isSelected
                          ? 'border-blue-600 shadow-lg shadow-blue-100 ring-2 ring-blue-400 ring-offset-2'
                          : 'border-gray-100 hover:border-blue-300 hover:shadow-md'
                      )}
                    >
                      {/* Thumbnail */}
                      <div className="relative w-full aspect-video bg-black">
                        <video
                          src={video.url}
                          className="w-full h-full object-cover"
                          muted
                          playsInline
                          preload="metadata"
                        />
                        {/* Play overlay on hover */}
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
                          <Play size={24} className="text-white fill-white" />
                        </div>
                        {/* Selected badge */}
                        {isSelected && (
                          <div className="absolute top-2 right-2 bg-blue-600 text-white rounded-full p-1 shadow-lg">
                            <CheckCircle2 size={14} />
                          </div>
                        )}
                        {/* "Em uso" label */}
                        {isSelected && (
                          <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-blue-600 text-white text-[8px] font-black rounded uppercase tracking-widest">
                            Em uso
                          </div>
                        )}
                      </div>
                      {/* Info */}
                      <div className="p-2 bg-white">
                        <p className="font-black text-gray-900 truncate text-[10px] uppercase italic">
                          {video.name}
                        </p>
                      </div>
                    </button>
                  );
                })
              ) : (
                <p className="col-span-full text-center py-8 text-gray-400 text-xs font-bold uppercase tracking-widest italic border-2 border-dashed border-gray-100 rounded-2xl">
                  Nenhum vídeo encontrado na biblioteca
                </p>
              )}
            </div>
          </div>
        </div>

        {autoEditState.originalVideoUrl && (
          <div className="bg-green-50 p-6 rounded-[32px] border-2 border-green-100 flex items-center justify-between gap-6 animate-in fade-in slide-in-from-top-4 duration-500">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-green-600 text-white rounded-2xl">
                <CheckCircle2 size={24} />
              </div>
              <div>
                <h4 className="font-black text-green-900 text-sm">
                  ✅ Vídeo carregado com sucesso
                </h4>
                <p className="text-[10px] font-bold text-green-600 uppercase tracking-widest">
                  Formato detectado:{' '}
                  {autoEditState.videoFormat === '9:16'
                    ? 'Vertical 9:16'
                    : autoEditState.videoFormat === '16:9'
                      ? 'Horizontal 16:9'
                      : 'Quadrado 1:1'}
                </p>
              </div>
            </div>
            <button
              onClick={() =>
                setAutoEditState((prev) => ({
                  ...prev,
                  originalVideoUrl: undefined,
                }))
              }
              className="px-4 py-2 bg-white text-gray-400 hover:text-red-600 border border-gray-200 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
            >
              Trocar Vídeo
            </button>
          </div>
        )}

        {isCompleted ? (
          <div className="space-y-10">
            {/* Gallery of Versions */}
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-black text-gray-900 uppercase italic">
                  Galeria de Versões
                </h3>
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                  Role para o lado
                </span>
              </div>
              <div className="flex gap-6 overflow-x-auto pb-6 no-scrollbar snap-x">
                {/* Original */}
                <div
                  className={cn(
                    'space-y-4 snap-start',
                    autoEditState.videoFormat === '16:9'
                      ? 'min-w-[320px] max-w-[320px]'
                      : 'min-w-[240px] max-w-[240px]'
                  )}
                >
                  <div
                    className={cn(
                      'relative bg-black rounded-[32px] overflow-hidden shadow-2xl border-4 border-gray-100',
                      autoEditState.videoFormat === '16:9'
                        ? 'aspect-video'
                        : autoEditState.videoFormat === '1:1'
                          ? 'aspect-square'
                          : 'aspect-[9/16]'
                    )}
                  >
                    <video
                      src={
                        getAuthorizedUrl(
                          autoEditState.originalVideoUrl || '',
                          platformApiKey || undefined
                        ) || undefined
                      }
                      className="w-full h-full object-contain"
                      style={{ objectFit: 'contain', backgroundColor: '#000' }}
                      crossOrigin="anonymous"
                    />
                    <div className="absolute top-4 left-4 bg-gray-900 text-white text-[8px] font-black px-2 py-0.5 rounded uppercase tracking-widest">
                      Original
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => handleApproveAndDownload(autoEditState.originalVideoUrl || '')}
                      className="w-full py-3 bg-gray-100 text-gray-900 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-gray-200 flex items-center justify-center gap-2"
                    >
                      <Download size={12} />
                      Baixar
                    </button>
                  </div>
                </div>

                {/* Versions */}
                {(autoEditState.versions || []).map((vUrl, idx) => (
                  <div
                    key={`edit-version-${idx}-${vUrl || 'no-url'}`}
                    className={cn(
                      'space-y-4 snap-start',
                      autoEditState.videoFormat === '16:9'
                        ? 'min-w-[320px] max-w-[320px]'
                        : 'min-w-[240px] max-w-[240px]'
                    )}
                  >
                    <div
                      className={cn(
                        'relative bg-black rounded-[32px] overflow-hidden shadow-2xl border-4 border-blue-100 ring-8 ring-blue-50/50',
                        autoEditState.videoFormat === '16:9'
                          ? 'aspect-video'
                          : autoEditState.videoFormat === '1:1'
                            ? 'aspect-square'
                            : 'aspect-[9/16]'
                      )}
                    >
                      <video
                        src={getAuthorizedUrl(vUrl || '', platformApiKey || undefined) || undefined}
                        className="w-full h-full object-contain"
                        style={{
                          objectFit: 'contain',
                          backgroundColor: '#000',
                        }}
                        crossOrigin="anonymous"
                        controls
                      />
                      <div className="absolute top-4 left-4 bg-blue-600 text-white text-[8px] font-black px-2 py-0.5 rounded uppercase tracking-widest">
                        v{idx + 1}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <button
                        onClick={() => handleApproveAndDownload(vUrl)}
                        className="w-full py-3 bg-blue-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 flex items-center justify-center gap-2 shadow-lg shadow-blue-100"
                      >
                        <Download size={12} />
                        Baixar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Re-render Option */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white p-10 rounded-[48px] border-4 border-gray-50 shadow-2xl flex flex-col items-center text-center gap-6"
            >
              <div className="space-y-2">
                <h3 className="text-2xl font-black text-gray-900 uppercase italic tracking-tighter">
                  Deseja criar outra versão?
                </h3>
                <p className="text-gray-400 font-bold uppercase text-[10px] tracking-widest">
                  Altere o template ou densidade de b-roll e gere uma nova variação.
                </p>
              </div>

              <button
                onClick={() => setAutoEditState((prev) => ({ ...prev, status: 'analyzed' }))}
                className="px-12 py-5 bg-gray-900 text-white rounded-[24px] font-black uppercase text-xs tracking-[0.2em] hover:bg-black transition-all flex items-center justify-center gap-3 active:scale-95 shadow-xl"
              >
                <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                Configurar Nova Versão
              </button>
            </motion.div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left Column: Preview and Controls */}
            <div className="lg:col-span-4 space-y-8">
              <div className="bg-gray-900 p-4 rounded-[40px] shadow-2xl relative group overflow-hidden border-8 border-gray-800">
                <div
                  className={cn(
                    'relative rounded-[32px] overflow-hidden bg-black w-full',
                    autoEditState.videoFormat === '16:9'
                      ? 'aspect-video'
                      : autoEditState.videoFormat === '1:1'
                        ? 'aspect-square'
                        : 'aspect-[9/16]'
                  )}
                >
                  <video
                    src={getAuthorizedUrl(videoUrl || '', platformApiKey || undefined) || undefined}
                    controls
                    className="w-full h-full object-contain"
                    crossOrigin="anonymous"
                  />
                </div>
                <div className="mt-4 flex items-center justify-between px-4">
                  <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                    Preview
                  </p>
                  <div className="flex gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-[10px] font-black text-green-500 uppercase">Live</span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              {!isAnalyzed ? (
                <button
                  onClick={handleStartAutoEdit}
                  disabled={loading || !videoUrl}
                  className="w-full py-8 bg-blue-600 text-white rounded-[32px] font-black uppercase text-lg tracking-widest hover:bg-blue-700 transition-all shadow-2xl shadow-blue-200 active:scale-95 disabled:opacity-50 flex flex-col items-center gap-3"
                >
                  {loading ? <Loader2 className="animate-spin" size={32} /> : <Scan size={32} />}
                  <span>Analisar com AssemblyAI</span>
                  <span className="text-[10px] font-bold opacity-60 normal-case">
                    Sentimentos • Capítulos • Momentos
                  </span>
                </button>
              ) : (
                <div className="space-y-4">
                  <div className="p-6 bg-green-50 border-2 border-green-100 rounded-[32px] flex items-center gap-4">
                    <div className="p-3 bg-green-600 text-white rounded-2xl">
                      <CheckCircle2 size={24} />
                    </div>
                    <div>
                      <h4 className="font-black text-green-900 border-none p-0 text-sm">
                        Análise Pronta
                      </h4>
                      <p className="text-[10px] font-bold text-green-600 uppercase">
                        100% Processado
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() =>
                      setAutoEditState({
                        status: 'idle',
                        step: '',
                        progress: 0,
                        brollCandidates: [],
                        selectedBrollIds: [],
                        versions: [],
                      })
                    }
                    className="w-full py-4 text-gray-400 font-black uppercase text-[10px] tracking-widest hover:text-gray-600"
                  >
                    Reiniciar Edição
                  </button>
                </div>
              )}
            </div>

            {/* Right Column: Configuration and Results */}
            <div className="lg:col-span-8 space-y-8">
              {autoEditState.status === 'analyzing' || autoEditState.status === 'rendering' ? (
                <div className="bg-white p-16 rounded-[48px] border-4 border-gray-50 shadow-2xl flex flex-col items-center justify-center text-center gap-8">
                  <div className="relative">
                    <div className="w-32 h-32 rounded-full border-8 border-blue-50 border-t-blue-600 animate-spin" />
                    <div className="absolute inset-0 flex items-center justify-center text-blue-600">
                      <Zap size={40} className="animate-pulse" />
                    </div>
                  </div>
                  <div className="space-y-4">
                    <h3 className="text-3xl font-black text-gray-900 uppercase italic tracking-tighter">
                      {autoEditState.status === 'analyzing'
                        ? 'IA Analisando...'
                        : 'IA Renderizando...'}
                    </h3>
                    <div className="flex flex-col items-center gap-2">
                      <p className="text-gray-400 font-bold uppercase tracking-widest text-xs max-w-md">
                        {autoEditState.step}
                      </p>
                      <span className="text-blue-600 font-black text-2xl">
                        {Math.round(autoEditState.progress)}%
                      </span>
                    </div>
                  </div>
                  <div className="w-full max-w-sm h-4 bg-gray-100 rounded-full overflow-hidden border-2 border-gray-50">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${autoEditState.progress}%` }}
                      className="h-full bg-blue-600 shadow-[0_0_20px_rgba(37,99,235,0.5)] transition-all duration-500"
                    />
                  </div>
                </div>
              ) : autoEditState.status === 'error' ? (
                <div className="bg-white p-16 rounded-[48px] border-4 border-red-50 shadow-2xl flex flex-col items-center justify-center text-center gap-8">
                  <div className="w-24 h-24 bg-red-100 rounded-full flex items-center justify-center text-red-600">
                    <AlertCircle size={48} />
                  </div>
                  <div className="space-y-4">
                    <h3 className="text-3xl font-black text-gray-900 uppercase italic tracking-tighter">
                      Ops! Algo deu errado
                    </h3>
                    <p className="text-red-500 font-bold uppercase tracking-widest text-xs px-10">
                      {autoEditState.step}
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      setAutoEditState((prev) => ({
                        ...prev,
                        status: 'analyzed',
                        step: '',
                        progress: 0,
                      }))
                    }
                    className="px-10 py-4 bg-gray-900 text-white rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-black transition-all"
                  >
                    Tentar Novamente
                  </button>
                </div>
              ) : autoEditState.status === 'analyzed' ? (
                <div className="bg-white p-8 rounded-[48px] border-4 border-gray-50 shadow-2xl space-y-12">
                  {/* ETAPA 1: B-Roll Mode */}
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-[10px] font-black">
                            1
                          </span>
                          <h3 className="text-xl font-black text-gray-900 uppercase italic">
                            Ilustrações B-Roll
                          </h3>
                        </div>
                      </div>
                      <div className="flex bg-gray-100 p-1.5 rounded-2xl">
                        <button
                          onClick={() =>
                            setAutoEditState((prev) => ({
                              ...prev,
                              editMode: 'auto',
                            }))
                          }
                          className={cn(
                            'px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all',
                            autoEditState.editMode === 'auto'
                              ? 'bg-white text-blue-600 shadow-lg'
                              : 'text-gray-400 hover:text-gray-600'
                          )}
                        >
                          Modo Automático
                        </button>
                        <button
                          onClick={() =>
                            setAutoEditState((prev) => ({
                              ...prev,
                              editMode: 'manual',
                            }))
                          }
                          className={cn(
                            'px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all',
                            autoEditState.editMode === 'manual'
                              ? 'bg-white text-blue-600 shadow-lg'
                              : 'text-gray-400 hover:text-gray-600'
                          )}
                        >
                          Modo Manual
                        </button>
                      </div>
                    </div>

                    {autoEditState.editMode === 'auto' ? (
                      <div className="p-8 bg-blue-50/50 border-2 border-dashed border-blue-100 rounded-[32px] flex flex-col items-center justify-center gap-3 text-center">
                        <Sparkles className="text-blue-600" size={32} />
                        <div>
                          <p className="text-sm font-black text-blue-900 uppercase">
                            ⭐ IA selecionou os melhores momentos
                          </p>
                          <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest">
                            Encontramos {(autoEditState.selectedBrollIds || []).length} cenas ideais
                            para ilustrar seu áudio
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 animate-in fade-in slide-in-from-top-2">
                        {autoEditState.brollCandidates.map((candidate) => {
                          const isSelected = autoEditState.selectedBrollIds.includes(candidate.id);
                          return (
                            <button
                              key={candidate.id}
                              onClick={() => toggleBrollSelection(candidate.id)}
                              className={cn(
                                'flex flex-col p-4 rounded-2xl border-2 transition-all text-left relative group',
                                isSelected
                                  ? 'bg-blue-50 border-blue-600 shadow-sm'
                                  : 'bg-white border-gray-100 hover:border-gray-200'
                              )}
                            >
                              <div className="flex justify-between items-start mb-2">
                                <span className="text-[10px] font-black text-gray-400">
                                  Tempo: {(candidate.start / 1000).toFixed(1)}s
                                </span>
                                <span
                                  className={cn(
                                    'text-[8px] font-black px-1.5 py-0.5 rounded uppercase',
                                    candidate.rank >= 0.7
                                      ? 'bg-green-100 text-green-700'
                                      : 'bg-gray-100 text-gray-500'
                                  )}
                                >
                                  {Math.round(candidate.rank * 100)}%
                                </span>
                              </div>
                              <p className="text-[11px] font-bold text-gray-800 line-clamp-2 italic leading-tight">
                                "{candidate.text}"
                              </p>
                              {isSelected && (
                                <div className="absolute top-2 right-2 p-1 bg-blue-600 text-white rounded-full">
                                  <Check size={10} />
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* ETAPA 2: Template Selection */}
                  <div className="space-y-6 pt-6 border-t border-gray-100">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-[10px] font-black">
                        2
                      </span>
                      <h3 className="text-xl font-black text-gray-900 uppercase italic">
                        Estilo da Legenda
                      </h3>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {zapCapTemplates.map((template) => (
                        <button
                          key={template.id}
                          onClick={() =>
                            setZapCapRenderConfig((prev) => ({
                              ...prev,
                              templateId: template.id,
                            }))
                          }
                          className={cn(
                            'relative aspect-video rounded-2xl border-4 transition-all overflow-hidden group',
                            zapCapRenderConfig.templateId === template.id
                              ? 'border-blue-600 scale-95 shadow-inner'
                              : 'border-gray-50 hover:border-blue-100'
                          )}
                        >
                          <video
                            src={template.previewUrl || template.previews?.previewMp4 || undefined}
                            autoPlay
                            loop
                            muted
                            playsInline
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity p-4 text-center">
                            <p className="text-white font-black text-[10px] uppercase tracking-widest">
                              {template.name}
                            </p>
                          </div>
                          {zapCapRenderConfig.templateId === template.id && (
                            <div className="absolute inset-0 bg-blue-600/20 flex items-center justify-center">
                              <div className="bg-white text-blue-600 p-2 rounded-full shadow-2xl">
                                <Check size={24} />
                              </div>
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ETAPA 3: Visual Adjustments */}
                  <div className="space-y-6 pt-6 border-t border-gray-100">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-[10px] font-black">
                        3
                      </span>
                      <h3 className="text-xl font-black text-gray-900 uppercase italic">
                        Ajustes Visuais
                      </h3>
                    </div>
                    <div className="flex gap-4">
                      <button
                        onClick={() =>
                          setZapCapRenderConfig((prev) => ({
                            ...prev,
                            animation: !prev.animation,
                          }))
                        }
                        className={cn(
                          'flex-1 py-5 rounded-[24px] border-2 transition-all flex flex-col items-center gap-2 group',
                          zapCapRenderConfig.animation
                            ? 'bg-gray-900 border-gray-900 text-white'
                            : 'bg-white border-gray-100 text-gray-400'
                        )}
                      >
                        <Zap
                          size={24}
                          className={
                            zapCapRenderConfig.animation
                              ? 'text-yellow-400 fill-yellow-400'
                              : 'text-gray-300'
                          }
                        />
                        <span className="text-[10px] font-black uppercase tracking-widest">
                          Animação
                        </span>
                      </button>
                      <button
                        onClick={() =>
                          setZapCapRenderConfig((prev) => ({
                            ...prev,
                            emoji: !prev.emoji,
                          }))
                        }
                        className={cn(
                          'flex-1 py-5 rounded-[24px] border-2 transition-all flex flex-col items-center gap-2 group',
                          zapCapRenderConfig.emoji
                            ? 'bg-gray-900 border-gray-900 text-white'
                            : 'bg-white border-gray-100 text-gray-400'
                        )}
                      >
                        <Smile
                          size={24}
                          className={zapCapRenderConfig.emoji ? 'text-blue-400' : 'text-gray-300'}
                        />
                        <span className="text-[10px] font-black uppercase tracking-widest">
                          Emojis
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* ETAPA 4: Density Slider */}
                  <div className="space-y-6 pt-6 border-t border-gray-100">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-[10px] font-black">
                        4
                      </span>
                      <h3 className="text-xl font-black text-gray-900 uppercase italic">
                        Frequência de B-Roll
                      </h3>
                    </div>

                    <div className="p-8 bg-gray-50 rounded-[32px] border border-gray-100 space-y-6">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                          Densidade
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-2xl font-black text-blue-600">{brollPercent}%</span>
                          {brollPercent === recommendedBrollPercent && (
                            <span className="text-[8px] bg-blue-600 text-white px-2 py-0.5 rounded-full font-black uppercase">
                              Fiel ao áudio
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="relative pt-4">
                        <input
                          type="range"
                          min={20}
                          max={70}
                          value={brollPercent}
                          onChange={(e) => setBrollPercent(Number(e.target.value))}
                          className="w-full h-3 bg-gray-200 rounded-full appearance-none cursor-pointer accent-blue-600"
                        />
                        <div className="flex justify-between mt-3 px-1">
                          <span className="text-[10px] font-black text-gray-400 uppercase">
                            20%
                          </span>
                          <div className="flex flex-col items-center">
                            <div className="w-1 h-1 bg-blue-600 rounded-full mb-1" />
                            <span className="text-[10px] font-black text-blue-600 uppercase">
                              ⭐ {recommendedBrollPercent}% recomendado
                            </span>
                          </div>
                          <span className="text-[10px] font-black text-gray-400 uppercase">
                            70%
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ETAPA 5: Render Button */}
                  <div className="pt-6 border-t border-gray-100">
                    <button
                      onClick={handleRenderZapCap}
                      disabled={
                        loading ||
                        isRenderingRef.current ||
                        !zapCapRenderConfig.templateId ||
                        autoEditState.status === 'rendering' ||
                        autoEditState.status === 'processing'
                      }
                      className="w-full py-8 bg-blue-600 text-white rounded-[32px] font-black uppercase text-xl tracking-[0.2em] hover:bg-blue-700 transition-all shadow-2xl flex items-center justify-center gap-4 active:scale-95 disabled:opacity-50"
                    >
                      {loading ? (
                        <Loader2 className="animate-spin" size={24} />
                      ) : (
                        <Film size={24} />
                      )}
                      Renderizar Nova Versão
                    </button>
                    <p className="text-center mt-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                      O processo leva de 1 a 3 minutos
                    </p>
                  </div>
                </div>
              ) : (
                <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-center opacity-30 gap-6">
                  <Scan size={80} className="text-gray-200" />
                  <div>
                    <h3 className="text-2xl font-black text-gray-300 uppercase">
                      Aguardando Análise
                    </h3>
                    <p className="text-sm font-bold text-gray-300 uppercase">
                      Inicie o processamento com AssemblyAI no painel lateral
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };
  const renderFinalStep = () => {
    const aspectRatioClass =
      config.format.aspectRatio === '9:16'
        ? 'aspect-[9/16]'
        : config.format.aspectRatio === '4:5'
          ? 'aspect-[4/5]'
          : config.format.aspectRatio === '1:1'
            ? 'aspect-square'
            : 'aspect-[16/9]';
    const maxWidthClass = isExpanded ? 'max-w-4xl' : 'max-w-[320px]';

    const avatarScript = (config.copy.generatedScript || '').includes('[AVATAR]:')
      ? config.copy.generatedScript.split('[AVATAR]:')[1].split('[SCENE]:')[0].trim()
      : config.copy.generatedScript || '';

    // Simple subtitle logic: split script into 5 parts for 10s
    const words = avatarScript.split(' ');
    const partSize = Math.ceil(words.length / 5);
    const subtitleParts = [
      words.slice(0, partSize).join(' '),
      words.slice(partSize, partSize * 2).join(' '),
      words.slice(partSize * 2, partSize * 3).join(' '),
      words.slice(partSize * 3, partSize * 4).join(' '),
      words.slice(partSize * 4).join(' '),
    ];

    const currentSubtitle =
      currentTime < 2
        ? subtitleParts[0]
        : currentTime < 4
          ? subtitleParts[1]
          : currentTime < 6
            ? subtitleParts[2]
            : currentTime < 8
              ? subtitleParts[3]
              : subtitleParts[4];
    const subtitleStyle = SUBTITLE_STYLES.find((s) => s.id === config.subtitles.style);

    const posterUrl =
      config.avatar.faceId === 'custom'
        ? config.avatar.customFaceUrl || undefined
        : heygenAvatars.find((a) => a.avatar_id === config.avatar.faceId)?.preview_image_url;

    return (
      <div className="space-y-8 max-w-[1600px] mx-auto text-center">
        <div
          className={`relative ${aspectRatioClass} ${maxWidthClass} mx-auto bg-gray-900 rounded-[32px] overflow-hidden shadow-2xl border-8 border-gray-800 transition-all duration-500`}
        >
          {videoUrl ? (
            <>
              <video
                ref={videoRef}
                key={videoUrl}
                src={getAuthorizedUrl(videoUrl || '', platformApiKey || undefined) || undefined}
                controls
                muted
                playsInline
                poster={posterUrl}
                className="w-full h-full object-contain bg-black"
                referrerPolicy={
                  videoUrl?.includes('generativelanguage.googleapis.com')
                    ? 'no-referrer'
                    : undefined
                }
                onError={(e) => {
                  if (videoUrl?.startsWith('/generated/')) {
                    console.warn('[Video Expired] Final Preview:', videoUrl);
                    e.currentTarget.style.display = 'none';
                  } else {
                    console.error(
                      '[Video Error] Final Preview:',
                      e.currentTarget.error?.message,
                      videoUrl
                    );
                  }
                }}
                onTimeUpdate={(e) => {
                  const video = e.target as HTMLVideoElement;
                  if (!audioUrl) setCurrentTime(video.currentTime);
                }}
              />
              {(generationStage === 'completed' ||
                generationStage === 'subtitles' ||
                generationStage === 'edit') && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="max-w-[80%] text-center">
                    <div
                      className={`inline-block px-4 py-2 rounded-lg backdrop-blur-md shadow-2xl ${subtitleStyle?.class || ''}`}
                      style={{
                        fontSize: isExpanded ? '2rem' : '1.2rem',
                      }}
                    >
                      {currentSubtitle}
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center p-8 text-gray-500">
              {loading ||
              (videoOp && videoOp.status !== 'completed' && videoOp.status !== 'failed') ? (
                <>
                  <Loader2 className="animate-spin mb-4 text-blue-500" size={48} />
                  <p className="text-sm font-black text-white uppercase tracking-widest animate-pulse">
                    {generationStage === 'audio'
                      ? 'Gerando Voz...'
                      : generationStage === 'video'
                        ? `Criando Vídeo (${videoOp?.displayStatus || 'Iniciando'} - ${videoOp?.progress || 0}%)`
                        : generationStage === 'subtitles'
                          ? 'Adicionando Legendas...'
                          : generationStage === 'edit'
                            ? 'Aplicando Edições...'
                            : 'Iniciando Geração...'}
                  </p>

                  {generationStage === 'video' && videoOp && (
                    <div className="mt-4 space-y-2 w-full max-w-[240px]">
                      <div className="flex justify-between text-[10px] font-black text-gray-500 uppercase tracking-widest">
                        <span>Fila: {videoOp.queuedTime || 0}s</span>
                        <span>Render: {videoOp.renderTime || 0}s</span>
                      </div>
                      <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${videoOp.progress}%` }}
                          className="h-full bg-blue-500"
                        />
                      </div>
                      <div className="flex justify-between text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                        <span>Status: {videoOp.displayStatus}</span>
                        <span>
                          {videoOp.lastPoll
                            ? `Atualizado: ${new Date(videoOp.lastPoll).toLocaleTimeString()}`
                            : ''}
                        </span>
                      </div>
                      {videoOp.error && (
                        <p className="text-[9px] text-red-500 font-black uppercase tracking-widest">
                          Erro: {videoOp.error}
                        </p>
                      )}
                      <p className="text-[9px] text-blue-400 font-bold uppercase tracking-widest truncate">
                        ID: {videoOp.id}
                      </p>
                      {videoOp.isStuck && (
                        <p className="text-[9px] text-red-500 font-black uppercase tracking-widest animate-pulse">
                          ⚠️ {videoOp.stuckReason}
                        </p>
                      )}
                    </div>
                  )}

                  {generationStage === 'video' && (
                    <p className="text-[10px] text-blue-400 font-bold uppercase tracking-widest mt-2">
                      Usando voz e script selecionados para gerar o vídeo
                    </p>
                  )}
                  {generationStage === 'audio_ready' && audioUrl && (
                    <div className="mt-6 space-y-4 w-full max-w-xs">
                      <div className="p-4 bg-white/10 rounded-2xl border border-white/20">
                        <p className="text-xs font-bold text-white mb-3 uppercase tracking-widest">
                          Ouça a voz gerada:
                        </p>
                        <audio
                          src={audioUrl || undefined}
                          autoPlay
                          controls
                          className="w-full h-8"
                        />
                      </div>
                      <div className="flex gap-2 w-full">
                        <button
                          onClick={() => handleGenerateVideo(true)}
                          className="flex-1 py-4 bg-white/10 text-white rounded-2xl font-bold hover:bg-white/20 transition-all border border-white/20 text-xs uppercase tracking-tighter"
                        >
                          Regerar Voz
                        </button>
                        <button
                          onClick={() => handleGenerateVideo(false)}
                          className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-black shadow-xl hover:bg-blue-700 transition-all text-xs uppercase tracking-tighter"
                        >
                          Gerar Avatar
                        </button>
                      </div>
                    </div>
                  )}
                  {generationStage === 'video_ready' && videoUrl && (
                    <div className="mt-6 space-y-4 w-full max-w-xs">
                      <div className="flex gap-2 w-full">
                        <button
                          onClick={() => handleGenerateVideo(false)}
                          className="flex-1 py-4 bg-white/10 text-white rounded-2xl font-bold hover:bg-white/20 transition-all border border-white/20 text-xs uppercase tracking-tighter"
                        >
                          Regerar Avatar
                        </button>
                        <button
                          onClick={handleGenerateSubtitles}
                          className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-black shadow-xl hover:bg-blue-700 transition-all text-xs uppercase tracking-tighter"
                        >
                          Legendas e Formato
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="mt-8 w-full max-w-xs space-y-2 max-h-32 overflow-y-auto pr-2 custom-scrollbar">
                    {logs.map((log, i) => (
                      <p
                        key={`log-item-${i}`}
                        className="text-[10px] text-gray-500 font-mono text-left opacity-60"
                      >
                        {log}
                      </p>
                    ))}
                  </div>
                </>
              ) : videoOp?.status === 'failed' ? (
                <div className="text-center space-y-4">
                  <AlertCircle size={48} className="text-red-500 mx-auto" />
                  <p className="text-red-400 font-bold">Falha na geração do vídeo</p>
                  <button
                    onClick={handleGenerateVideo}
                    className="px-6 py-2 bg-red-600 text-white rounded-xl font-bold"
                  >
                    Tentar Novamente
                  </button>
                </div>
              ) : (
                <div className="text-center space-y-6">
                  <div className="w-20 h-20 bg-blue-600/20 text-blue-500 rounded-3xl flex items-center justify-center mx-auto">
                    <Sparkles size={40} />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-xl font-black text-white uppercase tracking-tight">
                      Pronto para Gerar?
                    </h3>
                    <p className="text-sm text-gray-400 max-w-xs mx-auto">
                      Clique no botão abaixo para iniciar a geração do vídeo com o avatar e voz
                      selecionados.
                    </p>
                  </div>
                  <button
                    onClick={handleGenerateVideo}
                    className="px-10 py-4 bg-blue-600 text-white rounded-2xl font-black text-lg hover:bg-blue-700 transition-all shadow-xl shadow-blue-900/40"
                  >
                    Gerar Vídeo Final
                  </button>
                  <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">
                    Custo: 100 Créditos
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4 max-w-md mx-auto">
          <button
            onClick={() => handleGenerateVideo()}
            disabled={
              loading || (videoOp && videoOp.status !== 'completed' && videoOp.status !== 'failed')
            }
            className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-blue-700 disabled:opacity-50 transition-all shadow-xl shadow-blue-200"
          >
            {loading ||
            (videoOp && videoOp.status !== 'completed' && videoOp.status !== 'failed') ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Sparkles />
            )}
            {videoUrl ? 'Regerar Vídeo' : `Gerar Vídeo Final`}
          </button>

          {videoUrl && (
            <a
              href={videoUrl}
              download
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-4 bg-gray-900 text-white rounded-2xl font-black flex items-center justify-center gap-3 hover:bg-black transition-all shadow-xl"
            >
              <Download size={20} />
              Baixar Vídeo Final
            </a>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-left">
          <div className="p-4 bg-gray-50 rounded-xl">
            <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">
              Ângulo
            </span>
            <p className="text-sm font-bold text-gray-700 truncate">{config.angle}</p>
          </div>
          <div className="p-4 bg-gray-50 rounded-xl">
            <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">
              Avatar
            </span>
            <p className="text-sm font-bold text-gray-700 truncate">
              {config.avatar.faceId === 'custom'
                ? 'Personalizado'
                : AVATARS.find((a) => a.id === config.avatar.faceId)?.name}
            </p>
          </div>
          <div className="p-4 bg-gray-50 rounded-xl">
            <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">
              Edição
            </span>
            <p className="text-sm font-bold text-gray-700 truncate">
              {config.edit.transition !== 'none' ? 'Com Efeitos' : 'Básica'}
            </p>
          </div>
          <div className="p-4 bg-gray-50 rounded-xl">
            <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">
              Trilha
            </span>
            <p className="text-sm font-bold text-gray-700 truncate">
              {config.edit.backgroundMusic !== 'none' ? 'Ativa' : 'Sem Música'}
            </p>
          </div>
        </div>
      </div>
    );
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
    <div className="min-h-screen bg-[#F8FAFC] text-gray-900 font-sans selection:bg-blue-100">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-4 h-20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-200">
              <Sparkles className="text-white" size={24} />
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tight text-gray-900">METAVISE</h1>
              <p className="text-[10px] font-bold text-blue-600 tracking-[0.2em] uppercase">
                Criador de Anúncios
              </p>
            </div>
          </div>

          {currentProjectId && (
            <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-xl border border-gray-100">
              <Folder size={14} className="text-gray-400" />
              <span className="text-[10px] font-black text-gray-600 uppercase tracking-widest truncate max-w-[120px]">
                {projects.find((p) => p.id === currentProjectId)?.name || 'Projeto Ativo'}
              </span>
            </div>
          )}

          <div className="hidden md:flex items-center gap-1 bg-gray-50 p-1 rounded-2xl border border-gray-100">
            {STEPS.map((step, idx) => {
              const Icon = step.icon;
              const isActive = currentStep === step.id;
              const isSkipped = !useHookFlow && step.id === 'hook-visual';

              return (
                <div key={step.id} className="flex items-center">
                  <button
                    onClick={() => {
                      if (canNavigateTo(step.id)) {
                        setCurrentStep(step.id);
                      }
                    }}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all ${
                      isActive
                        ? 'bg-white text-blue-600 shadow-sm'
                        : isSkipped
                          ? 'text-gray-300 italic hover:text-gray-500'
                          : 'text-gray-400 hover:text-gray-600'
                    }`}
                    title={isSkipped ? 'Gancho pulado — clique pra reativar' : undefined}
                  >
                    <Icon size={16} />
                    <span className="text-sm font-bold">
                      {step.label}
                      {isSkipped && (
                        <span className="ml-1 text-[9px] font-black uppercase tracking-widest opacity-70">
                          · pulado
                        </span>
                      )}
                    </span>
                  </button>
                  {idx < STEPS.length - 1 && (
                    <ChevronRight size={14} className="text-gray-300 mx-1" />
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 px-4 py-2 bg-blue-50 rounded-xl border border-blue-100">
              <Sparkles className="text-blue-600" size={16} />
              <span className="text-sm font-black text-blue-700">{credits}</span>
              <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">
                Créditos
              </span>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 text-gray-400 hover:text-red-500 transition-colors"
              title="Sair"
            >
              <LogOut size={20} />
            </button>
            <button className="p-2 text-gray-400 hover:text-gray-600 md:hidden">
              <Layout size={24} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1600px] mx-auto px-4 py-12">
        {!isOnline && (
          <div className="mb-6 p-4 bg-red-50 border-2 border-red-100 rounded-2xl flex items-center gap-3 text-red-700 font-bold text-sm">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            Você está offline. Verifique sua conexão.
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 bg-red-50 border-2 border-red-100 rounded-2xl flex items-center justify-between gap-3 text-red-700 text-sm">
            <span className="font-medium">{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
              ✕
            </button>
          </div>
        )}

        {providerError && (
          <div className="mb-6 p-4 bg-amber-50 border-2 border-amber-200 rounded-2xl flex items-center justify-between gap-3 text-amber-800 text-sm shadow-sm">
            <div className="flex items-center gap-3">
              <div className="px-2 py-1 bg-amber-200 text-amber-900 rounded-md text-[10px] font-black uppercase tracking-widest">
                {providerError.provider} Error
              </div>
              <span className="font-medium">{providerError.message}</span>
            </div>
            <button
              onClick={() => setProviderError(null)}
              className="text-amber-500 hover:text-amber-700"
            >
              ✕
            </button>
          </div>
        )}

        <div className="mb-12 text-center">
          <h2 className="text-3xl font-black text-gray-900 tracking-tight">
            {STEPS.find((s) => s.id === currentStep)?.label}
          </h2>
          <p className="text-gray-500 mt-2">
            Passo {STEPS.findIndex((s) => s.id === currentStep) + 1} de {STEPS.length}
          </p>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
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
                onDeleteAudio={(audio) => {
                  setAudioToDelete(audio);
                  setShowDeleteModal(true);
                }}
                onDeleteVideoFromArray={handleDeleteVideoFromArray}
              />
            )}
            {currentStep === 'persona' && renderPersonaStep()}
            {currentStep === 'copy' && renderCopyStep()}
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
                approvedCopy={config.copy?.generatedScript || ''}
                hooksHistorico={config.copy?.hooksHistorico || []}
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
                  handleSaveProject({
                    copy: {
                      ...config.copy,
                      hookSelecionado: hook,
                      hooksHistorico: newHistorico,
                    },
                  } as any);
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
                    setTimeout(() => handleSaveProject(), 50);
                  }
                  setVoiceSource('hook');
                  setCurrentStep('voz-premium');
                }}
              />
            )}
            {currentStep === 'voz-premium' && (() => {
              const isHook = voiceSource === 'hook';
              const bodyAudios = config.audios || [];
              const hookAudios =
                (((config.copy as any)?.hookAudios as typeof bodyAudios | undefined) || []);
              const lastBodyVoice = bodyAudios.length > 0 ? bodyAudios[bodyAudios.length - 1].voiceId : '';
              const lastHookVoice = hookAudios.length > 0 ? hookAudios[hookAudios.length - 1].voiceId : '';
              // Auto-preselect: prefer the mode's own last voice; fall back
              // to the OTHER mode's last voice so the user doesn't have to
              // reselect every time. Then they can override in the UI.
              const defaultVoiceId = isHook
                ? lastHookVoice || lastBodyVoice || config.avatar?.voiceId || ''
                : lastBodyVoice || lastHookVoice || config.avatar?.voiceId || '';

              const activeAudioUrl = isHook
                ? ((config.copy as any)?.hookAudioUrl as string | undefined) || ''
                : config.audioUrl || '';
              const activeAudios = isHook ? hookAudios : bodyAudios;
              const activeScript = isHook
                ? config.copy?.hookSelecionado ||
                  config.copy?.finalScript ||
                  config.copy?.generatedScript ||
                  ''
                : config.copy?.finalScript || config.copy?.generatedScript || '';

              return (
                <>
                  {/* Toggle: which audio are we working on? Hidden when the
                      project doesn't use a separate hook. */}
                  {useHookFlow && (
                    <div className="max-w-4xl mx-auto px-6 pt-6">
                      <div className="bg-white p-2 rounded-2xl border-2 border-gray-100 shadow-sm flex gap-1">
                        <button
                          onClick={() => setVoiceSource('copy')}
                          className={`flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                            !isHook
                              ? 'bg-gray-900 text-white shadow-md'
                              : 'text-gray-500 hover:bg-gray-50'
                          }`}
                        >
                          Voz do Corpo
                          {bodyAudios.length > 0 && (
                            <span className="ml-2 text-[9px] opacity-70">
                              ({bodyAudios.length})
                            </span>
                          )}
                        </button>
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
                      </div>
                      <p className="text-[10px] text-gray-500 mt-2 px-2">
                        {isHook
                          ? 'Você está gerando o áudio do gancho (parte inicial curta).'
                          : 'Você está gerando o áudio do corpo do vídeo (script principal).'}
                      </p>
                    </div>
                  )}

                  <VozPremium
                    key={isHook ? 'voz-hook' : 'voz-body'}
                    approvedScript={activeScript}
                    projectId={currentProjectId || undefined}
                    personaGender={config.copy?.answers?.personaGender || ''}
                    personaAge={config.copy?.answers?.personaAgePrimary || ''}
                    savedAudioUrl={activeAudioUrl || undefined}
                    savedAudios={activeAudios}
                    copyAnswers={config.copy?.answers || {}}
                    savedOptimizedScript={
                      isHook
                        ? ((config.copy as any)?.hookOptimizedScript as string | undefined) || ''
                        : config.copy?.optimizedScript || ''
                    }
                    defaultVoiceId={defaultVoiceId || undefined}
                    onApprovedScriptEdit={(edited) => {
                      // The "approved script" is the editable source text shown
                      // in VozPremium. Body edits go to finalScript (existing).
                      // Hook edits go to hookSelecionado so the next render in
                      // hook mode picks them up too.
                      if (isHook) {
                        setConfig((prev) => ({
                          ...prev,
                          copy: { ...prev.copy, hookSelecionado: edited },
                        }));
                        handleSaveProject({
                          copy: { ...config.copy, hookSelecionado: edited },
                        } as any);
                      } else {
                        setConfig((prev) => ({
                          ...prev,
                          copy: { ...prev.copy, finalScript: edited },
                        }));
                        handleSaveProject({
                          copy: { ...config.copy, finalScript: edited },
                        } as any);
                      }
                    }}
                    onOptimizedScript={(optimized) => {
                      if (isHook) {
                        setConfig((prev) => ({
                          ...prev,
                          copy: {
                            ...prev.copy,
                            hookOptimizedScript: optimized,
                          } as any,
                        }));
                        handleSaveProject({
                          copy: { ...config.copy, hookOptimizedScript: optimized },
                        } as any);
                      } else {
                        setConfig((prev) => ({
                          ...prev,
                          copy: { ...prev.copy, optimizedScript: optimized },
                        }));
                        handleSaveProject({
                          copy: { ...config.copy, optimizedScript: optimized },
                        } as any);
                      }
                    }}
                    onGoToVideo={() => setCurrentStep('avatar')}
                    onAudioReady={(audioUrl, voiceId, storagePath) => {
                      // Clearing the active audio.
                      if (!audioUrl) {
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
                      const newAudios = existing
                        ? currentAudios
                        : [...currentAudios, newAudio];

                      if (isHook) {
                        setConfig((prev) => ({
                          ...prev,
                          copy: {
                            ...prev.copy,
                            hookAudioUrl: audioUrl,
                            hookAudioStoragePath: storagePath || null,
                            hookAudios: newAudios,
                          } as any,
                        }));
                        handleSaveProject({
                          copy: {
                            ...config.copy,
                            hookAudioUrl: audioUrl,
                            hookAudioStoragePath: storagePath || null,
                            hookAudios: newAudios,
                          },
                        } as any);
                      } else {
                        if (!existing) setAudios(newAudios);
                        setAudioUrl(audioUrl);
                        setConfig((prev) => ({
                          ...prev,
                          audioUrl,
                          audioStoragePath: storagePath || null,
                          audios: newAudios,
                          ...(voiceId ? { avatar: { ...prev.avatar, voiceId } } : {}),
                        }));
                        handleSaveProject({
                          audioUrl,
                          audioStoragePath: storagePath || null,
                          audios: newAudios,
                          ...(voiceId ? { 'avatar.voiceId': voiceId } : {}),
                        });
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
                </>
              );
            })()}
            {currentStep === 'avatar' && renderAvatarStep()}
            {currentStep === 'edit-zap' && renderEditZapStep()}
            {currentStep === 'edit2' && renderEdit2Step()}

            {currentStep === 'final' && renderFinalStep()}
          </motion.div>
        </AnimatePresence>

        {/* Footer Navigation */}
        <div className="mt-16 flex items-center justify-between pt-8 border-t border-gray-100">
          <button
            onClick={prevStep}
            disabled={currentStep === STEPS[0].id}
            className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-gray-500 hover:bg-gray-100 disabled:opacity-0 transition-all"
          >
            <ChevronLeft size={20} />
            Voltar
          </button>

          {currentStep !== 'copy' && (
            <div className="flex items-center gap-4">
              <button
                onClick={() => handleSaveProject()}
                disabled={isSaving}
                className="flex items-center gap-2 px-6 py-3 bg-white border-2 border-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-50 transition-all disabled:opacity-50"
              >
                {isSaving ? (
                  <Loader2 className="animate-spin" size={18} />
                ) : currentProjectId ? (
                  <CheckCircle2 size={18} className="text-green-500" />
                ) : (
                  <Download size={18} className="text-blue-500" />
                )}
                {currentProjectId ? 'Salvar' : 'Salvar Projeto'}
              </button>

              <button
                onClick={nextStep}
                disabled={currentStep === 'final'}
                className="flex items-center gap-2 px-8 py-3 bg-gray-900 text-white rounded-xl font-bold hover:bg-black transition-all shadow-lg disabled:opacity-50"
              >
                Continuar
                <ChevronRight size={20} />
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
        isSaving={isSaving}
        onNameChange={setNewProjectName}
        onTypeChange={setNewProjectType}
        onCopySubModeChange={setCopySubMode}
        onClose={() => setShowNewProjectModal(false)}
        onCreate={handleCreateProject}
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
          toast.success(
            "Persona atualizado! Clique em 'Atualizar Campos da Copy' para aplicar."
          );
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

      <Toaster position="bottom-right" />
    </div>
  );
}
