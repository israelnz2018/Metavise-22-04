// Avatar tab — biggest single tab in the app. Wires together:
//   1. AI recommendation panel (Claude suggests avatar+voice based on
//      persona).
//   2. HeyGen avatar gallery with filters (gender / age / style /
//      ethnicity / etc.) backed by the bulk-classified
//      `avatar-enrichment-bulk.json` dataset.
//   3. Voice picker + ElevenLabs config modal.
//   4. Body-vs-Hook mode toggle (writes to different config slots).
//   5. Video generation kick-off + progress + preview.
//   6. Delete confirmation modals for avatar-rendered videos.
//
// Same prop-passing pattern as the other extracted tabs. Uses the
// canonical `AdConfig` shape exported from App.tsx so the compiler
// catches typos in field reads.

import React, { useEffect, useState } from 'react';
import type { AdConfig } from '@/App';
import { toast } from 'react-hot-toast';
import { motion } from 'motion/react';
import { Skeleton } from '@/components/Skeleton';
import {
  User,
  Sparkles,
  Loader2,
  Search,
  Filter,
  SortAsc,
  Tag,
  XCircle,
  Plus,
  RefreshCw,
  Volume2,
  Trash2,
  Play,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Video,
  Star,
} from 'lucide-react';
import { cn, getVideoAspectRatioClass } from '@/lib/utils';
import { getAuthorizedUrl } from '@/lib/gemini';
import type { ProductInfo } from '@/lib/claudeService';
import { AVATAR_FILTER_TO_ENRICHMENT, HEYGEN_NAME_KEYWORDS } from '@/lib/constants';
import { loadAvatarEnrichment, type EnrichmentMap } from '@/lib/avatarEnrichment';
import { useAvatarFavorites } from '@/hooks/useAvatarFavorites';
import {
  AIRecommendationPanel,
  type CachedRecommendation,
} from '@/components/AIRecommendationPanel';
import { AvatarPreviewModal } from '@/components/AvatarPreviewModal';
import { ConfirmModal } from '@/components/ConfirmModal';
import { ElevenLabsConfigModal } from '@/components/ElevenLabsConfigModal';

interface Props {
  config: AdConfig;
  setConfig: React.Dispatch<React.SetStateAction<AdConfig>>;

  // Step nav + general loading.
  setCurrentStep: (step: any) => void;
  loading: boolean;
  setLoading: (v: boolean) => void;

  // Mode toggle (body vs hook).
  avatarMode: 'body' | 'hook';
  setAvatarMode: (mode: 'body' | 'hook') => void;
  useHookFlow: boolean;

  // Avatar gallery state.
  heygenAvatars: any[];
  setHeygenAvatars: React.Dispatch<React.SetStateAction<any[]>>;
  avatarFilters: any;
  setAvatarFilters: React.Dispatch<React.SetStateAction<any>>;
  avatarSearch: string;
  setAvatarSearch: (v: string) => void;
  previewAvatar: any;
  setPreviewAvatar: (v: any) => void;
  avatarRecommendation: CachedRecommendation | null | undefined;
  setAvatarRecommendation: (v: any) => void;

  // Source videos + outputs.
  videos: any[] | undefined;
  videoUrl: string | null | undefined;
  setVideoUrl: (v: any) => void;
  setVideoStoragePath: (v: any) => void;
  platformApiKey: string | null;

  // Generation state machine.
  videoOp: any;
  setVideoOp: (v: any) => void;
  setGenerationStage: (v: any) => void;
  isTestMode: boolean;
  setIsTestMode: (v: boolean) => void;
  useNativeFallback: boolean;
  setUseNativeFallback: (v: boolean) => void;
  logs: string[];
  pollIntervalRef: React.MutableRefObject<any>;
  isTestingKey: boolean;
  isUpdatingKey: boolean;
  audioUrl: string | null;
  isVideoUpToDate: () => boolean;
  loadingAvatars: boolean;
  avatarError: string | null;

  // ElevenLabs key + config modal.
  newElevenLabsKey: string;
  setNewElevenLabsKey: (v: string) => void;
  showElevenLabsConfig: boolean;
  setShowElevenLabsConfig: (v: boolean) => void;

  // Delete confirmation modals.
  setShowDeleteModal: (v: boolean) => void;
  videoToDelete: any;
  setVideoToDelete: (v: any) => void;
  setAudioToDelete: (v: any) => void;
  showDeleteVideoModal: boolean;
  setShowDeleteVideoModal: (v: boolean) => void;
  showDeleteHistoryVideoModal: boolean;
  setShowDeleteHistoryVideoModal: (v: any) => void;

  // Handlers.
  handleGenerateVideo: (forceRegenerate?: boolean) => void | Promise<void>;
  handleCancelGeneration: () => void | Promise<void>;
  handleDeleteVideo: () => void | Promise<void>;
  handleDeleteVideoFromArray: (video: {
    url: string;
    storagePath: string | null;
  }) => void | Promise<void>;
  handleTestElevenLabsKey: (key?: any) => any;
  handleUpdateElevenLabsKey: (key?: any) => any;
}

export function AvatarTab({
  config,
  setConfig,
  setCurrentStep,
  loading,
  setLoading,
  avatarMode,
  setAvatarMode,
  useHookFlow,
  heygenAvatars,
  setHeygenAvatars,
  avatarFilters,
  setAvatarFilters,
  avatarSearch,
  setAvatarSearch,
  previewAvatar,
  setPreviewAvatar,
  avatarRecommendation,
  setAvatarRecommendation,
  videos,
  videoUrl,
  setVideoUrl,
  setVideoStoragePath,
  platformApiKey,
  videoOp,
  setVideoOp,
  setGenerationStage,
  isTestMode,
  setIsTestMode,
  useNativeFallback,
  setUseNativeFallback,
  logs,
  pollIntervalRef,
  isTestingKey,
  isUpdatingKey,
  audioUrl,
  isVideoUpToDate,
  loadingAvatars,
  avatarError,
  newElevenLabsKey,
  setNewElevenLabsKey,
  showElevenLabsConfig,
  setShowElevenLabsConfig,
  setShowDeleteModal,
  videoToDelete,
  setVideoToDelete,
  setAudioToDelete,
  showDeleteVideoModal,
  setShowDeleteVideoModal,
  showDeleteHistoryVideoModal,
  setShowDeleteHistoryVideoModal,
  handleGenerateVideo,
  handleCancelGeneration,
  handleDeleteVideo,
  handleDeleteVideoFromArray,
  handleTestElevenLabsKey,
  handleUpdateElevenLabsKey,
}: Props) {
  // Avatar enrichment data is ~175KB — loaded on demand the first time
  // this tab mounts. While the promise is in flight, AVATAR_ENRICHMENT
  // is `{}` and the filter falls back to legacy keyword-on-name matching.
  // Cached at module level so revisits are instant.
  const [AVATAR_ENRICHMENT, setAvatarEnrichment] = useState<EnrichmentMap>({});
  useEffect(() => {
    let alive = true;
    loadAvatarEnrichment().then((map) => {
      if (alive) setAvatarEnrichment(map);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Per-browser favorites (localStorage). Star icon on each card toggles.
  // `showOnlyFavorites` is a chip in the filter row.
  const favorites = useAvatarFavorites();
  const [showOnlyFavorites, setShowOnlyFavorites] = useState(false);

  let filteredAvatars = heygenAvatars.filter((a) => {
    const enrichment = AVATAR_ENRICHMENT[a.avatar_id] || {};
    const matchesSearch = a.avatar_name.toLowerCase().includes(avatarSearch.toLowerCase());
    const matchesGender =
      !avatarFilters.gender ||
      a.gender?.toLowerCase() === avatarFilters.gender.toLowerCase() ||
      enrichment.gender === avatarFilters.gender;

    const avatarName = a.avatar_name.toLowerCase();

    // For each UI filter pick, prefer the bulk-classified enrichment data
    // (precise — derived from Claude vision); fall back to keyword match on
    // the avatar name (lossy heuristic) when the avatar isn't in the JSON.
    const matchesFilter = (
      selectedItems: string[],
      filterType: keyof typeof HEYGEN_NAME_KEYWORDS
    ) => {
      if (selectedItems.length === 0) return true;
      return selectedItems.some((selectedItem) => {
        const enrichmentValues = AVATAR_FILTER_TO_ENRICHMENT[filterType][selectedItem] || [];
        const enrichmentField =
          filterType === 'ages'
            ? enrichment.age
            : filterType === 'styles'
              ? enrichment.style
              : enrichment.ethnicity;
        if (enrichmentField && enrichmentValues.includes(enrichmentField)) {
          return true;
        }
        // Fallback to legacy keyword-on-name match for unclassified avatars.
        if (!enrichmentField) {
          const keywords = (HEYGEN_NAME_KEYWORDS[filterType] as any)[selectedItem] || [];
          return keywords.some((kw: string) => avatarName.includes(kw.toLowerCase()));
        }
        return false;
      });
    };

    const matchesAge = matchesFilter(avatarFilters.ages, 'ages');
    const matchesStyle = matchesFilter(avatarFilters.styles, 'styles');
    const matchesEthnicity = matchesFilter(avatarFilters.ethnicities, 'ethnicities');
    // Favorites overrides everything when toggled on — that's the point.
    const matchesFav = !showOnlyFavorites || favorites.isFavorite(a.avatar_id);

    return (
      matchesSearch && matchesGender && matchesAge && matchesStyle && matchesEthnicity && matchesFav
    );
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
  const hookAudioUrl = (config.copy?.hookAudioUrl as string | undefined) || '';
  const hookAudioStoragePath =
    (config.copy?.hookAudioStoragePath as string | null | undefined) || null;
  const hookVideos = (config.copy?.hookVideos as typeof videos | undefined) || [];
  const hookVideoUrl = (config.copy?.hookVideoUrl as string | undefined) || '';
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
        <div className="bg-white dark:bg-gray-900/80 p-2 rounded-2xl border-2 border-gray-200 dark:border-gray-800 shadow-sm flex gap-1">
          <button
            onClick={() => setAvatarMode('body')}
            className={`flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
              !isHookMode
                ? 'bg-gray-900 text-white shadow-md'
                : 'text-gray-500 dark:text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/60'
            }`}
          >
            Avatar do Corpo
            {(config.videos || []).length > 0 && (
              <span className="ml-2 text-[9px] opacity-70">({(config.videos || []).length})</span>
            )}
          </button>
          <button
            onClick={() => setAvatarMode('hook')}
            className={`flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
              isHookMode
                ? 'bg-amber-500 text-white shadow-md'
                : 'text-gray-500 dark:text-gray-400 dark:text-gray-500 hover:bg-amber-50 dark:hover:bg-amber-950/40'
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
          className={`p-6 bg-white dark:bg-gray-900/80 rounded-[40px] border-2 shadow-lg ${
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
            <h3 className="text-sm font-black text-gray-900 dark:text-gray-50 uppercase tracking-widest">
              Áudio Aprovado {isHookMode ? '(Gancho)' : '(Corpo)'}
            </h3>
            <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">vindo da Voz</span>
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
              className="p-2 text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors rounded-xl hover:bg-red-50 dark:hover:bg-red-950/40 flex-shrink-0"
              title="Deletar áudio"
            >
              <Trash2 size={18} />
            </button>
          </div>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2 italic">
            {isHookMode
              ? 'Áudio do gancho. Para trocar, volte à aba Voz e ative "Voz do Gancho".'
              : 'Áudio do corpo. Para trocar, volte à aba Voz.'}
          </p>
        </div>
      )}
      {!displayedAudioUrl && (
        <div
          className={`p-6 rounded-[40px] border-2 border-dashed ${
            isHookMode
              ? 'border-amber-200 bg-amber-50/40 dark:bg-amber-950/40'
              : 'border-blue-200 bg-blue-50/40 dark:bg-blue-950/40'
          }`}
        >
          <p className="text-sm text-gray-600 dark:text-gray-400 dark:text-gray-500">
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
                  setConfig((prev: any) => ({
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
              {logs.slice(-3).map((log: any, i: number) => (
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
        <div className="bg-amber-50 dark:bg-amber-950/40 p-6 rounded-[32px] border-2 border-amber-100 flex items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-amber-100 dark:bg-amber-950/30 rounded-2xl text-amber-600 dark:text-amber-400">
              <RefreshCw size={24} />
            </div>
            <div className="space-y-1">
              <h4 className="text-lg font-black text-amber-900">Modo de Fallback (Diagnóstico)</h4>
              <p className="text-amber-700 dark:text-amber-400 text-sm font-medium">
                Se a geração com áudio externo falhar, use esta opção para testar com uma voz nativa
                do HeyGen.
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
            <div className="w-14 h-8 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-amber-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-white dark:bg-gray-900/80 after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-amber-600"></div>
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
                : config.format.aspectRatio === '1:1'
                  ? 'aspect-square max-w-[500px]'
                  : 'aspect-video w-full'
            )}
          >
            <video
              src={
                getAuthorizedUrl(displayedVideoUrl || '', platformApiKey || undefined) || undefined
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
                className="p-3 bg-white/90 backdrop-blur-md text-gray-900 dark:text-gray-50 rounded-2xl shadow-xl hover:bg-white dark:hover:bg-gray-900/80 transition-all"
                title="Regerar"
              >
                <RefreshCw size={20} />
              </button>
              <button
                onClick={() => setShowDeleteVideoModal(true)}
                className="p-3 bg-white/90 backdrop-blur-md text-red-600 dark:text-red-400 rounded-2xl shadow-xl hover:bg-red-50 dark:hover:bg-red-950/40 transition-all"
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
                setGenerationStage('idle');
                setCurrentStep('avatar');
                // Ensure current config for next video starts fresh but keeps previous videos history
                setConfig((prev: any) => ({
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
              className="flex-1 px-8 py-5 bg-white dark:bg-gray-900/80 border-2 border-gray-200 dark:border-gray-800 text-gray-900 dark:text-gray-50 rounded-2xl font-black uppercase tracking-widest hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-all flex items-center justify-center gap-3"
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
      {(isHookMode ? hookVideos : videos || []).length > 0 && (
        <div className="bg-white dark:bg-gray-900/80 p-8 rounded-[40px] border-2 border-gray-200 dark:border-gray-800 shadow-xl space-y-6">
          <div className="flex items-center justify-between border-b border-gray-50 pb-6">
            <div className="space-y-1">
              <h3 className="text-xl font-black text-gray-900 dark:text-gray-50 uppercase tracking-tight flex items-center gap-2">
                <Video
                  size={20}
                  className={isHookMode ? 'text-amber-500' : 'text-blue-600 dark:text-blue-400'}
                />
                Histórico de Vídeos {isHookMode ? '(Gancho)' : '(Corpo)'}
              </h3>
              <p className="text-xs text-gray-400 dark:text-gray-500 font-medium">
                Selecione o vídeo que deseja usar no projeto.
              </p>
            </div>
            <span className="px-3 py-1 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 dark:text-gray-500 rounded-full text-[10px] font-black uppercase tracking-widest">
              {(isHookMode ? hookVideos : videos || []).length}{' '}
              {(isHookMode ? hookVideos : videos || []).length === 1 ? 'Vídeo' : 'Vídeos'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-start">
            {(isHookMode ? hookVideos : videos || []).map((video, idx) => (
              <div
                key={`variant-video-${idx}-${video.url || 'no-url'}`}
                onClick={() => {
                  // Route the "active video" to the slot matching the
                  // current mode — otherwise selecting a hook video would
                  // overwrite videoUrl (body state) and bleed across the
                  // toggle.
                  if (isHookMode) {
                    setConfig((prev: any) => ({
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
                    setConfig((prev: any) => ({
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
                    ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 shadow-lg'
                    : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/80 hover:border-blue-200'
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
                        ? ('no-referrer' as const)
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
                    <p className="text-[10px] font-black text-gray-900 dark:text-gray-50 uppercase tracking-tight">
                      Vídeo {idx + 1}
                    </p>
                    <p className="text-[8px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-widest">
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
                    className="p-2 text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors"
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
        <AIRecommendationPanel
          persona={config.copy.answers}
          copyAnswers={config.copy.answers}
          copy={
            config.copy.finalScript || config.copy.optimizedScript || config.copy.generatedScript
          }
          productInfo={(config.copy?.productInfo as ProductInfo | null) || undefined}
          variant="avatar"
          cached={avatarRecommendation}
          onChange={setAvatarRecommendation}
          onApplyFilters={(rec) => {
            const ageReverse: Record<string, string> = {
              young: 'Young Adult',
              adult: 'Adult',
              mature: 'Mature',
              elderly: 'Mature',
            };
            const styleReverse: Record<string, string> = {
              professional: 'Professional',
              lifestyle: 'Lifestyle',
              ugc: 'UGC',
              creative: 'UGC',
            };
            const ethReverse: Record<string, string> = {
              white: 'White',
              asian: 'Asian',
              south_asian: 'South Asian',
              latino: 'Latino',
              middle_eastern: 'Middle Eastern',
              black: 'Black',
              mixed: 'White',
            };
            setAvatarFilters((prev: any) => ({
              ...prev,
              gender: rec.avatar.gender,
              ages: ageReverse[rec.avatar.age] ? [ageReverse[rec.avatar.age]!] : [],
              styles: styleReverse[rec.avatar.style] ? [styleReverse[rec.avatar.style]!] : [],
              ethnicities: ethReverse[rec.avatar.ethnicity]
                ? [ethReverse[rec.avatar.ethnicity]!]
                : [],
            }));
            toast.success('Filtros sugeridos aplicados!');
          }}
        />

        <div className="flex items-center justify-between">
          <h3 className="text-2xl font-black text-gray-900 dark:text-gray-50 tracking-tight">
            Escolher Avatar
          </h3>
          <div className="flex items-center gap-2 px-4 py-2 bg-purple-50 dark:bg-purple-950/40 rounded-xl border border-purple-100">
            <User size={16} className="text-purple-600 dark:text-purple-400" />
            <span className="text-xs font-bold text-purple-700 dark:text-purple-300">
              HeyGen Ativo
            </span>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900/80 p-6 rounded-[40px] border-2 border-gray-200 dark:border-gray-800 shadow-xl space-y-6">
          {/* Favorites chip — own row so it's always visible without
              eating the grid columns. Hidden when the user has zero
              favorites yet (avoids tempting an empty list). */}
          {favorites.favoriteCount > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setShowOnlyFavorites((v) => !v)}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-black uppercase tracking-widest transition-all border-2 ${
                  showOnlyFavorites
                    ? 'bg-amber-400 text-amber-950 border-amber-400 shadow-md'
                    : 'bg-white dark:bg-gray-900/80 text-gray-500 dark:text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-700 hover:border-amber-300 hover:text-amber-700 dark:hover:text-amber-400'
                }`}
                title="Mostrar somente seus avatares favoritos"
              >
                <Star size={14} className={showOnlyFavorites ? 'fill-current' : ''} />
                Favoritos ({favorites.favoriteCount})
              </button>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2 relative">
              <Search
                className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500"
                size={18}
              />
              <input
                type="text"
                placeholder="Buscar avatar por nome..."
                value={avatarSearch || ''}
                onChange={(e) => setAvatarSearch(e.target.value)}
                className="w-full pl-12 pr-4 py-4 bg-gray-50 dark:bg-gray-800/60 border-2 border-transparent focus:border-blue-600 focus:bg-white dark:bg-gray-900/80 rounded-2xl outline-none transition-all text-sm font-bold"
              />
            </div>

            <div className="relative">
              <Filter
                className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500"
                size={16}
              />
              <select
                value={avatarFilters.gender || ''}
                onChange={(e) =>
                  setAvatarFilters((prev: any) => ({
                    ...prev,
                    gender: e.target.value,
                  }))
                }
                className="w-full pl-10 pr-4 py-4 bg-gray-50 dark:bg-gray-800/60 border-2 border-transparent focus:border-blue-600 focus:bg-white dark:bg-gray-900/80 rounded-2xl outline-none transition-all text-sm font-bold text-gray-600 dark:text-gray-400 dark:text-gray-500 appearance-none"
              >
                <option value="">Todos Gêneros</option>
                <option value="male">Masculino</option>
                <option value="female">Feminino</option>
              </select>
            </div>

            <div className="relative">
              <SortAsc
                className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500"
                size={16}
              />
              <select
                value={avatarFilters.sort || 'name'}
                onChange={(e) =>
                  setAvatarFilters((prev: any) => ({
                    ...prev,
                    sort: e.target.value,
                  }))
                }
                className="w-full pl-10 pr-4 py-4 bg-gray-50 dark:bg-gray-800/60 border-2 border-transparent focus:border-blue-600 focus:bg-white dark:bg-gray-900/80 rounded-2xl outline-none transition-all text-sm font-bold text-gray-600 dark:text-gray-400 dark:text-gray-500 appearance-none"
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
                <h4 className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                  Estilo (Style)
                </h4>
                <div className="flex flex-wrap gap-2">
                  {['Professional', 'Lifestyle', 'UGC'].map((style) => (
                    <button
                      key={style}
                      onClick={() =>
                        setAvatarFilters((prev: any) => ({
                          ...prev,
                          styles: prev.styles.includes(style)
                            ? prev.styles.filter((s: string) => s !== style)
                            : [...prev.styles, style],
                        }))
                      }
                      className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border-2 ${
                        avatarFilters.styles.includes(style)
                          ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-200'
                          : 'bg-white dark:bg-gray-900/80 border-gray-200 dark:border-gray-800 text-gray-400 dark:text-gray-500 hover:border-gray-200 dark:hover:border-gray-700'
                      }`}
                    >
                      {style}
                    </button>
                  ))}
                </div>
              </div>

              {/* Ethnicity Filter */}
              <div className="space-y-3">
                <h4 className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                  Etnia (Ethnicity)
                </h4>
                <div className="flex flex-wrap gap-2">
                  {['White', 'Asian', 'South Asian', 'Latino', 'Middle Eastern', 'Black'].map(
                    (eth) => (
                      <button
                        key={eth}
                        onClick={() =>
                          setAvatarFilters((prev: any) => ({
                            ...prev,
                            ethnicities: prev.ethnicities.includes(eth)
                              ? prev.ethnicities.filter((e: string) => e !== eth)
                              : [...prev.ethnicities, eth],
                          }))
                        }
                        className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border-2 ${
                          avatarFilters.ethnicities.includes(eth)
                            ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-200'
                            : 'bg-white dark:bg-gray-900/80 border-gray-200 dark:border-gray-800 text-gray-400 dark:text-gray-500 hover:border-gray-200 dark:hover:border-gray-700'
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
                <h4 className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                  Idade (Age)
                </h4>
                <div className="flex flex-wrap gap-2">
                  {['Young Adult', 'Adult', 'Mature'].map((age) => (
                    <button
                      key={age}
                      onClick={() =>
                        setAvatarFilters((prev: any) => ({
                          ...prev,
                          ages: prev.ages.includes(age)
                            ? prev.ages.filter((a: string) => a !== age)
                            : [...prev.ages, age],
                        }))
                      }
                      className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all border-2 ${
                        avatarFilters.ages.includes(age)
                          ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-200'
                          : 'bg-white dark:bg-gray-900/80 border-gray-200 dark:border-gray-800 text-gray-400 dark:text-gray-500 hover:border-gray-200 dark:hover:border-gray-700'
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
                className="ml-auto text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
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
              <h4 className="font-black text-gray-900 dark:text-gray-50 uppercase tracking-tight">
                Geração do Vídeo
              </h4>
              <span className="px-2 py-0.5 bg-purple-100 text-purple-700 dark:text-purple-300 rounded-md text-[10px] font-black uppercase tracking-widest">
                HeyGen
              </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 font-medium italic">
              Selecione o avatar acima para iniciar a geração.
            </p>

            <div className="flex items-center gap-4 mt-2">
              <div className="flex-1 space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                    Escala do Avatar (Zoom)
                  </label>
                  <span className="text-xs font-bold text-blue-600 dark:text-blue-400">
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
                    setConfig((prev: any) => ({
                      ...prev,
                      avatar: {
                        ...prev.avatar,
                        scale: parseFloat(e.target.value),
                      },
                    }))
                  }
                  className="w-full h-2 bg-gray-100 dark:bg-gray-800 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
                <div className="flex justify-between text-[8px] text-gray-400 dark:text-gray-500 font-bold uppercase">
                  <span>Afastado</span>
                  <span>Padrão (1.0)</span>
                  <span>Zoom</span>
                </div>
              </div>

              <button
                onClick={() => setIsTestMode(!isTestMode)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all border-2 ${
                  isTestMode
                    ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 text-amber-700 dark:text-amber-400 shadow-sm'
                    : 'bg-white dark:bg-gray-900/80 border-gray-200 dark:border-gray-800 text-gray-400 dark:text-gray-500 hover:border-gray-200 dark:hover:border-gray-700'
                }`}
              >
                <Tag size={12} />
                Modo Teste (Clip Curto)
              </button>
              {isTestMode && (
                <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400 animate-pulse">
                  Gera apenas 3 segundos para validação rápida
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col md:flex-row items-center gap-4 w-full md:w-auto">
            {isVideoUpToDate() && (
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/40 px-4 py-2 rounded-xl border border-green-100 shadow-sm">
                <CheckCircle2 size={16} />
                <div className="flex flex-col">
                  <span className="text-[10px] font-black uppercase tracking-widest">
                    Vídeo Atualizado
                  </span>
                  <span className="text-[8px] font-bold opacity-70">
                    Gerado em {new Date(config.lastVideoMetadata?.createdAt || '').toLocaleString()}
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
                className="w-full md:w-auto px-8 py-5 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-red-100 transition-all border-2 border-red-100"
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
                  <h5 className="text-[10px] font-black text-gray-500 dark:text-gray-400 dark:text-gray-500 uppercase tracking-[0.2em]">
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
                    <p className="text-[8px] font-black text-gray-500 dark:text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1">
                      ID do Vídeo
                    </p>
                    <p className="text-[10px] font-mono text-blue-400 truncate">{videoOp.id}</p>
                  </div>
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                    <p className="text-[8px] font-black text-gray-500 dark:text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1">
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
                      <p className="text-[10px] text-red-400 font-medium">{videoOp.stuckReason}</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex-1 space-y-4">
                <h5 className="text-[10px] font-black text-gray-500 dark:text-gray-400 dark:text-gray-500 uppercase tracking-[0.2em]">
                  Métricas de Tempo
                </h5>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-[8px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                      Fila (Queue)
                    </p>
                    <p className="text-xl font-black text-white">{videoOp.queuedTime || 0}s</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[8px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                      Renderização
                    </p>
                    <p className="text-xl font-black text-white">{videoOp.renderTime || 0}s</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[8px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                      Total Decorrido
                    </p>
                    <p className="text-xl font-black text-blue-400">{videoOp.totalTime || 0}s</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[8px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                      Polls (Consultas)
                    </p>
                    <p className="text-xl font-black text-gray-500 dark:text-gray-400 dark:text-gray-500">
                      {videoOp.pollCount || 0}
                    </p>
                  </div>
                </div>
                <div className="pt-2 border-t border-white/5">
                  <p className="text-[8px] font-black text-gray-600 dark:text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                    Iniciado às: {videoOp.requestSentTime}
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        <div className="flex items-center justify-between px-2">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-bold text-gray-500 dark:text-gray-400 dark:text-gray-500">
              Exibindo{' '}
              <span className="text-blue-600 dark:text-blue-400">{filteredAvatars.length}</span>{' '}
              avatares encontrados
            </p>
            {isFallbackActive && (
              <p className="text-[10px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-widest animate-pulse flex items-center gap-1">
                <AlertCircle size={10} />
                Nenhum resultado exato. Exibindo todos para facilitar sua busca.
              </p>
            )}
          </div>
        </div>

        {loadingAvatars ? (
          // Skeleton grid: feels much faster than a spinner because the
          // user immediately sees the layout that will appear.
          <Skeleton.GalleryGrid count={12} />
        ) : avatarError ? (
          <div className="p-12 bg-red-50 dark:bg-red-950/40 border-2 border-red-100 rounded-[40px] text-center space-y-6">
            <div className="w-16 h-16 bg-red-100 text-red-600 dark:text-red-400 rounded-2xl flex items-center justify-center mx-auto">
              <AlertCircle size={32} />
            </div>
            <div className="space-y-2">
              <p className="text-red-900 font-black text-xl">Erro ao carregar avatares</p>
              <p className="text-red-600 dark:text-red-400 font-medium">{avatarError}</p>
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
              // Star marker: avatar fully matches the IA recommendation
              // (gender + age + style + ethnicity). Elderly maps to mature
              // and creative maps to ugc for matching purposes.
              const recAvatar = avatarRecommendation?.rec?.avatar;
              const ageMatches =
                recAvatar?.age === enrichment.age ||
                (recAvatar?.age === 'mature' && enrichment.age === 'elderly') ||
                (recAvatar?.age === 'elderly' && enrichment.age === 'mature');
              const styleMatches =
                recAvatar?.style === enrichment.style ||
                (recAvatar?.style === 'ugc' && enrichment.style === 'creative') ||
                (recAvatar?.style === 'creative' && enrichment.style === 'ugc');
              const isRecommended =
                !!recAvatar &&
                recAvatar.gender === a.gender &&
                recAvatar.ethnicity === enrichment.ethnicity &&
                ageMatches &&
                styleMatches;

              return (
                <button
                  key={a.avatar_id}
                  onClick={() => {
                    // Toggle selection logic
                    if (config.avatar.faceId === a.avatar_id) {
                      // Deselect if already selected
                      setConfig((prev: any) => ({
                        ...prev,
                        avatar: { ...prev.avatar, faceId: '' },
                        videoUrl: null,
                        videoStoragePath: null,
                      }));
                    } else {
                      // Select new one
                      setConfig((prev: any) => ({
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
                    setConfig((prev: any) => {
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
                      : 'border-transparent hover:border-gray-200 dark:hover:border-gray-700 shadow-sm'
                  }`}
                >
                  {/* Native lazy-load (loading="lazy") + async decode
                      saves a lot of initial JS work and network on
                      the avatar gallery — 1281 images × 200KB+ each
                      otherwise queue up on the first render. The
                      browser only fetches images that are about to
                      scroll into view. */}
                  <img
                    src={a.preview_image_url || undefined}
                    className="w-full h-full object-cover bg-gray-100 dark:bg-gray-800"
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    decoding="async"
                    alt={a.avatar_name}
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
                  {/* Star button — pin/unpin this avatar to your
                      favorites. Sits in the top-right unless the
                      "selected" badge is already there, in which case
                      we tuck the star into top-left next to the IA
                      badge (which only shows when NOT selected). */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      favorites.toggle(a.avatar_id);
                    }}
                    className={`absolute z-10 ${
                      config.avatar.faceId === a.avatar_id ? 'top-3 left-3' : 'top-3 right-3'
                    } w-8 h-8 rounded-full flex items-center justify-center shadow-lg border-2 border-white transition-all ${
                      favorites.isFavorite(a.avatar_id)
                        ? 'bg-amber-400 text-amber-950'
                        : 'bg-white/30 text-white hover:bg-amber-400 hover:text-amber-950 backdrop-blur-md'
                    }`}
                    title={
                      favorites.isFavorite(a.avatar_id)
                        ? 'Remover dos favoritos'
                        : 'Adicionar aos favoritos'
                    }
                  >
                    <Star
                      size={14}
                      className={favorites.isFavorite(a.avatar_id) ? 'fill-current' : ''}
                    />
                  </button>
                  {config.avatar.faceId === a.avatar_id && (
                    <div className="absolute top-3 right-3 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-lg border-2 border-white">
                      <CheckCircle2 size={18} />
                    </div>
                  )}
                  {isRecommended && config.avatar.faceId !== a.avatar_id && (
                    <div
                      className="absolute top-3 left-3 px-2 py-1 bg-purple-600 text-white rounded-full text-[10px] font-black uppercase tracking-widest shadow-lg border-2 border-white flex items-center gap-1"
                      title="Combina com a recomendação da IA"
                    >
                      ⭐ IA
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Avatar Preview Modal */}
        <AvatarPreviewModal
          avatar={previewAvatar}
          selectedFaceId={config.avatar.faceId}
          avatarFormat={config.avatar.avatarFormat}
          cropOffset={config.avatar.cropOffset || 0}
          aspectRatio={config.format.aspectRatio}
          onClose={() => setPreviewAvatar(null)}
          onFormatChange={(format, nextAspectRatio) =>
            setConfig((prev: any) => ({
              ...prev,
              avatar: { ...prev.avatar, avatarFormat: format },
              format: { ...prev.format, aspectRatio: nextAspectRatio },
            }))
          }
          onCropOffsetChange={(offset) =>
            setConfig((prev: any) => ({
              ...prev,
              avatar: { ...prev.avatar, cropOffset: offset },
            }))
          }
          onToggleSelected={() => {
            if (!previewAvatar) return;
            const isSelected = config.avatar.faceId === previewAvatar.avatar_id;
            if (isSelected) {
              setConfig((prev: any) => ({
                ...prev,
                avatar: { ...prev.avatar, faceId: '' },
              }));
              toast.success('Avatar removido.');
            } else {
              setConfig((prev: any) => ({
                ...prev,
                avatar: { ...prev.avatar, faceId: previewAvatar.avatar_id },
              }));
              toast.success(`${previewAvatar.avatar_name} selecionado!`);
            }
          }}
        />

        {/* Action Footer removed and moved to top */}
      </div>
    </div>
  );
}
