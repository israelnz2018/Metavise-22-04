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
import { SegmentedAvatarModal } from '@/components/SegmentedAvatarModal';
import { AvatarBackgroundPicker } from '@/components/AvatarBackgroundPicker';
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
import { useLanguage } from '@/lib/i18n/LanguageContext';

interface Props {
  config: AdConfig;
  setConfig: React.Dispatch<React.SetStateAction<AdConfig>>;

  // Step nav + general loading.
  setCurrentStep: (step: any) => void;
  loading: boolean;
  setLoading: (v: boolean) => void;

  // Mode toggle (body vs hook).
  avatarMode: 'body' | 'hook' | 'vsl';
  setAvatarMode: (mode: 'body' | 'hook' | 'vsl') => void;
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
  const { t } = useLanguage();
  const at = t.avatarTab;
  // Projetos antigos podem não ter config.format / config.avatar — a tela lia
  // esses campos sem guarda e quebrava inteira. Aliases seguros pro render.
  const fmtCfg = config.format || ({ aspectRatio: '9:16', duration: 10 } as any);
  const avatarCfg =
    config.avatar || ({ faceId: 'f1', customFaceUrl: null, voiceId: '', scale: 1.0 } as any);
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
  // "Meus avatares" — clones próprios (photo avatars), marcados com is_custom.
  const [showOnlyCustom, setShowOnlyCustom] = useState(false);
  // Áudio da VSL escolhido no seletor (vazio = usa o mais recente por padrão).
  const [vslAudioPick, setVslAudioPick] = useState<string>('');
  const customCount = heygenAvatars.filter((a: any) => a.is_custom).length;

  // F9.7 — Modo Econômico (avatar segmentado). Estado isolado pra abrir
  // modal sem mexer no flow normal de geração HeyGen.
  const [segmentedModalOpen, setSegmentedModalOpen] = useState(false);

  let filteredAvatars = heygenAvatars.filter((a) => {
    // "Meus avatares" sobrepõe TODOS os outros filtros — mostra só os clones
    // próprios, sem depender de busca/gênero (que eles nem têm preenchido).
    if (showOnlyCustom) return !!(a as any).is_custom;
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
    // "Meus avatares" — só os clones próprios.
    const matchesCustom = !showOnlyCustom || (a as any).is_custom;

    return (
      matchesSearch &&
      matchesGender &&
      matchesAge &&
      matchesStyle &&
      matchesEthnicity &&
      matchesFav &&
      matchesCustom
    );
  });

  // Fallback: If strict filtering returns zero, but we HAVE selected filters,
  // we show a friendly message or fallback to search results only
  const hasActiveFilters =
    avatarFilters.ages.length > 0 ||
    avatarFilters.styles.length > 0 ||
    avatarFilters.ethnicities.length > 0;
  const actualFilteredCount = filteredAvatars.length;
  // Só faz sentido "relaxar filtros" se existe avatar pra mostrar. Com a lista
  // vazia (ex.: catálogo do HeyGen não carregou), o fallback dizia "exibindo
  // todos" e mostrava 0 — mensagem contraditória e confusa.
  const isFallbackActive =
    actualFilteredCount === 0 && hasActiveFilters && heygenAvatars.length > 0;

  if (isFallbackActive) {
    // Relaxa idade/estilo/etnia MAS mantém busca e gênero. Se ainda assim der
    // zero, solta também o gênero — senão a mensagem "exibindo todos" seguia
    // mentindo (avatares próprios, por exemplo, vêm sem gênero preenchido).
    const relaxed = heygenAvatars.filter((a) => {
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
    filteredAvatars = relaxed.length
      ? relaxed
      : heygenAvatars.filter((a) =>
          avatarSearch ? a.avatar_name.toLowerCase().includes(avatarSearch.toLowerCase()) : true
        );
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
  const isVslMode = avatarMode === 'vsl';
  const hookAudioUrl = (config.copy?.hookAudioUrl as string | undefined) || '';
  const hookAudioStoragePath =
    (config.copy?.hookAudioStoragePath as string | null | undefined) || null;
  const hookVideos = (config.copy?.hookVideos as typeof videos | undefined) || [];
  const hookVideoUrl = (config.copy?.hookVideoUrl as string | undefined) || '';
  // VSL: usa a voz da VSL (config.copyVsl). Opções = ÁUDIOS FINAIS (juntados) +
  // BLOCOS prontos — assim dá pra gerar o avatar por bloco sem precisar juntar.
  const vslCfg = (config as any).copyVsl || {};
  const vslFinals = (((vslCfg.audios as any[]) || []).filter((a) => a?.url) as any[]).map(
    (a, i, arr) => ({
      url: a.url as string,
      storagePath: (a.storagePath as string | null) ?? null,
      label:
        `Áudio final ${i + 1}` +
        (i === arr.length - 1 ? ' (mais recente)' : '') +
        (a.createdAt ? ` — ${new Date(a.createdAt).toLocaleDateString('pt-BR')}` : ''),
    })
  );
  const vslBlocks = (((vslCfg.blockAudios as any[]) || []).map((b, i) => ({ b, i })) as any[])
    .filter((x) => x.b?.url && x.b?.status === 'done')
    .map((x) => ({
      url: x.b.url as string,
      storagePath: (x.b.storagePath as string | null) ?? null,
      label: `Bloco ${x.i + 1}`,
    }));
  const vslAudioOptions = [...vslBlocks, ...vslFinals];
  // Default = o áudio final mais recente; se não houver final, o último bloco.
  const defaultVslAudio =
    vslFinals[vslFinals.length - 1] || vslBlocks[vslBlocks.length - 1] || null;
  const activeVslAudio =
    (vslAudioPick && vslAudioOptions.find((o) => o.url === vslAudioPick)) || defaultVslAudio;
  const vslAudioUrl = activeVslAudio?.url || (vslCfg.audioUrl as string | undefined) || '';
  const vslAudioStoragePath =
    activeVslAudio?.storagePath ?? (vslCfg.audioStoragePath as string | null | undefined) ?? null;
  const vslVideos = (vslCfg.avatarVideos as typeof videos | undefined) || [];
  const vslVideoUrl = (vslCfg.avatarVideoUrl as string | undefined) || '';
  // Existe VSL neste subprojeto? (mostra o toggle só quando há voz/roteiro VSL)
  const hasVsl = !!(vslAudioUrl || vslCfg.finalScript || vslCfg.generatedScript);

  // Guarda qual bloco de voz está selecionado, pra a geração do avatar VSL gravar
  // esse rótulo no vídeo (aí o nome vira "Vídeo N · Bloco M" nas abas).
  useEffect(() => {
    if (!isVslMode || !activeVslAudio?.label) return;
    setConfig((prev: any) => {
      if (prev?.copyVsl?.avatarPendingBlock === activeVslAudio.label) return prev;
      return {
        ...prev,
        copyVsl: { ...(prev.copyVsl || {}), avatarPendingBlock: activeVslAudio.label },
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVslMode, activeVslAudio?.label]);
  const displayedAudioUrl = isVslMode ? vslAudioUrl : isHookMode ? hookAudioUrl : config.audioUrl;
  const displayedAudioStoragePath = isVslMode
    ? vslAudioStoragePath
    : isHookMode
      ? hookAudioStoragePath
      : config.audioStoragePath || null;
  // Big "current video" preview directly under the audio card. Same idea
  // as the gallery: in hook mode it must show the hook video, not the body's.
  const displayedVideoUrl = isVslMode ? vslVideoUrl : isHookMode ? hookVideoUrl : videoUrl;
  // Fonte da galeria/histórico conforme o modo.
  const galleryVideos = isVslMode ? vslVideos : isHookMode ? hookVideos : videos || [];
  const gallerySelectedUrl = isVslMode ? vslVideoUrl : isHookMode ? hookVideoUrl : videoUrl;
  const modeLabel = isVslMode
    ? at.modeLabel.vsl
    : isHookMode
      ? at.modeLabel.hook
      : at.modeLabel.body;
  // Aspect REAL do vídeo em preview (o vídeo pode ser 16:9 mesmo com o config
  // em 9:16) — evita as faixas pretas por mismatch container × vídeo.
  const displayedVideoObj = galleryVideos.find((v: any) => v.url === displayedVideoUrl);
  const previewAspect = ((displayedVideoObj as any)?.aspectRatio as string) || fmtCfg.aspectRatio;

  // Mantém config.copyVsl.audioUrl (usado pela GERAÇÃO) em sincronia com o áudio
  // efetivo do modo VSL (mais recente por padrão, ou o escolhido no seletor).
  useEffect(() => {
    if (isVslMode && vslAudioUrl && vslCfg.audioUrl !== vslAudioUrl) {
      setConfig((prev: any) => ({
        ...prev,
        copyVsl: {
          ...(prev.copyVsl || {}),
          audioUrl: vslAudioUrl,
          audioStoragePath: vslAudioStoragePath,
        },
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVslMode, vslAudioUrl]);

  return (
    <div className="max-w-[1600px] mx-auto space-y-12">
      {/* Caminho alternativo: usar os próprios vídeos (sem avatar IA) → Montagem. */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-blue-50 dark:bg-blue-950/30 border-2 border-blue-200 dark:border-blue-900 rounded-2xl p-4">
        <p className="text-sm text-blue-900 dark:text-blue-200 font-bold">{at.ownVideosBanner}</p>
        <button
          onClick={() => setCurrentStep('montagem')}
          className="shrink-0 px-4 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all"
        >
          {at.ownVideosButton}
        </button>
      </div>

      {/* Toggle: qual parte estamos produzindo? Aparece quando o projeto tem
          gancho separado OU uma VSL (voz VSL disponível). */}
      {(useHookFlow || hasVsl) && (
        <div className="bg-white dark:bg-gray-900/80 p-2 rounded-2xl border-2 border-gray-200 dark:border-gray-800 shadow-sm flex gap-1">
          <button
            onClick={() => setAvatarMode('body')}
            className={`flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
              !isHookMode && !isVslMode
                ? 'bg-gray-900 text-white shadow-md'
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60'
            }`}
          >
            {at.modeToggle.body}
            {(config.videos || []).length > 0 && (
              <span className="ml-2 text-[9px] opacity-70">({(config.videos || []).length})</span>
            )}
          </button>
          {useHookFlow && (
            <button
              onClick={() => setAvatarMode('hook')}
              className={`flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                isHookMode
                  ? 'bg-amber-500 text-white shadow-md'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-amber-50 dark:hover:bg-amber-950/40'
              }`}
            >
              {at.modeToggle.hook}
              {hookVideos.length > 0 && (
                <span className="ml-2 text-[9px] opacity-70">({hookVideos.length})</span>
              )}
            </button>
          )}
          {hasVsl && (
            <button
              onClick={() => setAvatarMode('vsl')}
              className={`flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                isVslMode
                  ? 'bg-violet-600 text-white shadow-md'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-violet-50 dark:hover:bg-violet-950/40'
              }`}
            >
              {at.modeToggle.vsl}
              {vslVideos.length > 0 && (
                <span className="ml-2 text-[9px] opacity-70">({vslVideos.length})</span>
              )}
            </button>
          )}
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
              {at.audio.heading(modeLabel)}
            </h3>
            <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">
              {at.audio.source}
            </span>
          </div>
          {/* Seletor do áudio VSL — finais juntados + blocos prontos. Escolha
              qualquer um (default: o final mais recente). */}
          {isVslMode && vslAudioOptions.length > 1 && (
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-violet-600 dark:text-violet-400 shrink-0">
                {at.audio.countLabel(vslAudioOptions.length)}
              </span>
              <select
                value={vslAudioUrl}
                onChange={(e) => setVslAudioPick(e.target.value)}
                className="flex-1 px-2 py-1.5 rounded-lg border border-violet-200 dark:border-violet-800 bg-white dark:bg-gray-900 text-xs dark:text-gray-100"
              >
                {vslBlocks.length > 0 && (
                  <optgroup label={at.audio.blocksGroup}>
                    {vslBlocks.map((o) => (
                      <option key={o.url} value={o.url}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                )}
                {vslFinals.length > 0 && (
                  <optgroup label={at.audio.finalGroup}>
                    {[...vslFinals].reverse().map((o) => (
                      <option key={o.url} value={o.url}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
          )}
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
              title={at.audio.deleteTitle}
            >
              <Trash2 size={18} />
            </button>
          </div>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2 italic">
            {isVslMode
              ? at.audio.footnoteVsl
              : isHookMode
                ? at.audio.footnoteHook
                : at.audio.footnoteBody}
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
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {isVslMode ? at.audio.emptyVsl : isHookMode ? at.audio.emptyHook : at.audio.emptyBody}
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
                {videoOp?.displayStatus || at.generationStatus.starting}
              </h3>
              <p className="text-blue-200 font-medium text-sm">
                {videoOp?.progress
                  ? at.generationStatus.progress(videoOp.progress)
                  : at.generationStatus.preparing}
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
                  toast.success(at.generationStatus.cancelledToast);
                }}
                className="px-6 py-3 bg-white/10 text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-white/20 transition-all border border-white/10"
              >
                {at.generationStatus.cancelButton}
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
        title={at.modals.deleteHistoryTitle}
        message={at.modals.deleteHistoryMessage}
        confirmLabel={at.modals.deleteLabel}
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
              <h4 className="text-lg font-black text-amber-900 dark:text-amber-200">
                {at.fallback.heading}
              </h4>
              <p className="text-amber-700 dark:text-amber-400 text-sm font-medium">
                {at.fallback.description}
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
              previewAspect === '9:16'
                ? 'aspect-[9/16] max-w-[400px]'
                : previewAspect === '1:1'
                  ? 'aspect-square max-w-[500px]'
                  : previewAspect === '4:5'
                    ? 'aspect-[4/5] max-w-[500px]'
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
              {isVslMode ? at.videoBadge.vsl : isHookMode ? at.videoBadge.hook : at.videoBadge.body}
            </div>
            <div className="absolute top-6 right-6 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => handleGenerateVideo(true)}
                className="p-3 bg-white/90 backdrop-blur-md text-gray-900 dark:text-gray-50 rounded-2xl shadow-xl hover:bg-white dark:hover:bg-gray-900/80 transition-all"
                title={at.videoActions.regenerateTitle}
              >
                <RefreshCw size={20} />
              </button>
              <button
                onClick={() => setShowDeleteVideoModal(true)}
                className="p-3 bg-white/90 backdrop-blur-md text-red-600 dark:text-red-400 rounded-2xl shadow-xl hover:bg-red-50 dark:hover:bg-red-950/40 transition-all"
                title={at.videoActions.deleteTitle}
              >
                <Trash2 size={20} />
              </button>
            </div>
          </div>

          {/* Delete Video Confirmation Modal */}
          <ConfirmModal
            open={showDeleteVideoModal}
            title={at.modals.deleteVideoTitle}
            message={at.modals.deleteVideoMessage}
            confirmLabel={at.modals.deleteLabel}
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
              {at.videoActions.generateAnother}
            </button>
            <button
              onClick={() => handleGenerateVideo(true)}
              className="flex-1 px-8 py-5 bg-white dark:bg-gray-900/80 border-2 border-gray-200 dark:border-gray-800 text-gray-900 dark:text-gray-50 rounded-2xl font-black uppercase tracking-widest hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-all flex items-center justify-center gap-3"
            >
              <RefreshCw size={20} />
              {at.videoActions.regenerateCurrent}
            </button>
            <button
              onClick={() => setCurrentStep('edit-zap')}
              className="flex-1 px-8 py-5 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest hover:bg-blue-700 transition-all flex items-center justify-center gap-3 shadow-xl shadow-blue-100"
            >
              {at.videoActions.continueToEditing}
              <ChevronRight size={20} />
            </button>
          </div>
        </motion.div>
      )}

      {/* Video History List */}
      {galleryVideos.length > 0 && (
        <div className="bg-white dark:bg-gray-900/80 p-8 rounded-[40px] border-2 border-gray-200 dark:border-gray-800 shadow-xl space-y-6">
          <div className="flex items-center justify-between border-b border-gray-50 pb-6">
            <div className="space-y-1">
              <h3 className="text-xl font-black text-gray-900 dark:text-gray-50 uppercase tracking-tight flex items-center gap-2">
                <Video
                  size={20}
                  className={isHookMode ? 'text-amber-500' : 'text-blue-600 dark:text-blue-400'}
                />
                {at.history.heading(modeLabel)}
              </h3>
              <p className="text-xs text-gray-400 dark:text-gray-500 font-medium">
                {at.history.description}
              </p>
            </div>
            <span className="px-3 py-1 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 rounded-full text-[10px] font-black uppercase tracking-widest">
              {galleryVideos.length}{' '}
              {galleryVideos.length === 1 ? at.history.countSingular : at.history.countPlural}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-start">
            {galleryVideos.map((video, idx) => (
              <div
                key={`variant-video-${idx}-${video.url || 'no-url'}`}
                onClick={() => {
                  // Route the "active video" to the slot matching the
                  // current mode — otherwise selecting a hook video would
                  // overwrite videoUrl (body state) and bleed across the
                  // toggle.
                  if (isVslMode) {
                    setConfig((prev: any) => ({
                      ...prev,
                      copyVsl: {
                        ...(prev.copyVsl || {}),
                        avatarVideoUrl: video.url,
                        avatarVideoStoragePath: video.storagePath,
                      },
                      format: {
                        ...prev.format,
                        aspectRatio: (video.aspectRatio as any) || prev.format.aspectRatio,
                      },
                    }));
                  } else if (isHookMode) {
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
                  toast.success(at.history.selectedToast);
                }}
                className={cn(
                  'group relative rounded-[32px] border-2 transition-all cursor-pointer overflow-hidden flex flex-col',
                  gallerySelectedUrl === video.url
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
                  {gallerySelectedUrl === video.url && (
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
                      {at.history.videoLabel(idx + 1)}
                      {(video as any).blockLabel ? ` · ${(video as any).blockLabel}` : ''}
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
          // UX7: resolve o brief ativo (quando subprojeto veio de um) e
          // passa pro painel. Recomendação fica alinhada ao ângulo/emoção.
          brief={(() => {
            const copyAny = config.copy as any;
            const activeId: string | undefined = copyAny?.activeBriefId;
            if (!activeId) return null;
            const briefs = Array.isArray(copyAny?.creativeBriefs) ? copyAny.creativeBriefs : [];
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
            toast.success(at.filtersAppliedToast);
          }}
        />

        <div className="flex items-center justify-between">
          <h3 className="text-2xl font-black text-gray-900 dark:text-gray-50 tracking-tight">
            {at.chooseAvatarHeading}
          </h3>
          <div className="flex items-center gap-2 px-4 py-2 bg-purple-50 dark:bg-purple-950/40 rounded-xl border border-purple-100">
            <User size={16} className="text-purple-600 dark:text-purple-400" />
            <span className="text-xs font-bold text-purple-700 dark:text-purple-300">
              {at.heygenActiveBadge}
            </span>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900/80 p-6 rounded-[40px] border-2 border-gray-200 dark:border-gray-800 shadow-xl space-y-6">
          {/* Chips: "Meus avatares" (clones próprios) + Favoritos. Linha própria
              pra ficarem sempre visíveis sem comer as colunas do grid. */}
          {(customCount > 0 || favorites.favoriteCount > 0) && (
            <div className="flex flex-wrap items-center gap-2">
              {customCount > 0 && (
                <button
                  onClick={() => setShowOnlyCustom((v) => !v)}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-black uppercase tracking-widest transition-all border-2 ${
                    showOnlyCustom
                      ? 'bg-emerald-500 text-white border-emerald-500 shadow-md'
                      : 'bg-white dark:bg-gray-900/80 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-emerald-300 hover:text-emerald-700 dark:hover:text-emerald-400'
                  }`}
                  title={at.chips.customTitle}
                >
                  <Sparkles size={14} className={showOnlyCustom ? 'fill-current' : ''} />
                  {at.chips.customLabel(customCount)}
                </button>
              )}
              {favorites.favoriteCount > 0 && (
                <button
                  onClick={() => setShowOnlyFavorites((v) => !v)}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-black uppercase tracking-widest transition-all border-2 ${
                    showOnlyFavorites
                      ? 'bg-amber-400 text-amber-950 border-amber-400 shadow-md'
                      : 'bg-white dark:bg-gray-900/80 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-amber-300 hover:text-amber-700 dark:hover:text-amber-400'
                  }`}
                  title={at.chips.favoritesTitle}
                >
                  <Star size={14} className={showOnlyFavorites ? 'fill-current' : ''} />
                  {at.chips.favoritesLabel(favorites.favoriteCount)}
                </button>
              )}
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
                placeholder={at.search.placeholder}
                value={avatarSearch || ''}
                onChange={(e) => setAvatarSearch(e.target.value)}
                className="w-full pl-12 pr-4 py-4 bg-gray-50 dark:bg-gray-800/60 border-2 border-transparent focus:border-blue-600 focus:bg-white dark:focus:bg-gray-900/80 rounded-2xl outline-none transition-all text-sm font-bold"
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
                className="w-full pl-10 pr-4 py-4 bg-gray-50 dark:bg-gray-800/60 border-2 border-transparent focus:border-blue-600 focus:bg-white dark:focus:bg-gray-900/80 rounded-2xl outline-none transition-all text-sm font-bold text-gray-600 dark:text-gray-400 appearance-none"
              >
                <option value="">{at.search.allGenders}</option>
                <option value="male">{at.search.male}</option>
                <option value="female">{at.search.female}</option>
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
                className="w-full pl-10 pr-4 py-4 bg-gray-50 dark:bg-gray-800/60 border-2 border-transparent focus:border-blue-600 focus:bg-white dark:focus:bg-gray-900/80 rounded-2xl outline-none transition-all text-sm font-bold text-gray-600 dark:text-gray-400 appearance-none"
              >
                <option value="name">{at.search.sortAZ}</option>
                <option value="ads">{at.search.sortAds}</option>
                <option value="natural">{at.search.sortNatural}</option>
              </select>
            </div>
          </div>

          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Style Filter */}
              <div className="space-y-3">
                <h4 className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                  {at.filters.styleHeading}
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
                  {at.filters.ethnicityHeading}
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
                  {at.filters.ageHeading}
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
                {at.filters.clearButton}
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col md:flex-row items-center justify-between gap-6 pt-8 border-t border-gray-50">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <h4 className="font-black text-gray-900 dark:text-gray-50 uppercase tracking-tight">
                {at.generation.heading}
              </h4>
              <span className="px-2 py-0.5 bg-purple-100 text-purple-700 dark:text-purple-300 rounded-md text-[10px] font-black uppercase tracking-widest">
                HeyGen
              </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium italic">
              {at.generation.hint}
            </p>

            <div className="flex items-center gap-4 mt-2">
              <div className="flex-1 space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                    {at.generation.scaleLabel}
                  </label>
                  <span className="text-xs font-bold text-blue-600 dark:text-blue-400">
                    {(avatarCfg.scale || 1.0).toFixed(1)}x
                  </span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  value={avatarCfg.scale || 1.0}
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
                  <span>{at.generation.scaleFar}</span>
                  <span>{at.generation.scaleDefault}</span>
                  <span>{at.generation.scaleZoom}</span>
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
                {at.generation.testModeButton}
              </button>
              {isTestMode && (
                <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400 animate-pulse">
                  {at.generation.testModeHint}
                </span>
              )}
            </div>

            <div className="mt-2 w-full md:max-w-md">
              <AvatarBackgroundPicker
                value={avatarCfg.background}
                aspectRatio={fmtCfg.aspectRatio as any}
                onChange={(bg) =>
                  setConfig((prev: any) => ({
                    ...prev,
                    avatar: { ...prev.avatar, background: bg },
                  }))
                }
                disabled={loading}
              />
            </div>
          </div>
          <div className="flex flex-col md:flex-row items-center gap-4 w-full md:w-auto">
            {isVideoUpToDate() && (
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/40 px-4 py-2 rounded-xl border border-green-100 shadow-sm">
                <CheckCircle2 size={16} />
                <div className="flex flex-col">
                  <span className="text-[10px] font-black uppercase tracking-widest">
                    {at.generation.videoUpToDate}
                  </span>
                  <span className="text-[8px] font-bold opacity-70">
                    {at.generation.generatedAt(
                      new Date(config.lastVideoMetadata?.createdAt || '').toLocaleString()
                    )}
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
                {at.generationStatus.cancelButton}
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
                {at.generation.retryButton}
              </button>
            )}

            <button
              onClick={() => handleGenerateVideo(!!displayedVideoUrl)}
              disabled={
                loading ||
                !config.avatar.faceId ||
                ((isVslMode ? !vslAudioUrl : isHookMode ? !hookAudioUrl : !audioUrl) &&
                  !isTestMode) ||
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
              {displayedVideoUrl ? at.generation.regenerateButton : at.generation.generateButton}
            </button>

            {/* F9.7 — Modo Econômico: gera HeyGen só nos trechos que cliente
                marca. Salva ~75% do custo HeyGen quando o anúncio final tem
                cortes/b-rolls. Botão escondido se não tem áudio (precisa do
                ElevenLabs gerado primeiro). */}
            <button
              onClick={() => setSegmentedModalOpen(true)}
              disabled={loading || !config.avatar.faceId || !displayedAudioUrl}
              title={at.generation.economicModeTitle}
              className="w-full md:w-auto px-6 py-5 bg-gradient-to-br from-green-500 to-emerald-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 hover:from-green-600 hover:to-emerald-700 disabled:opacity-50 transition-all shadow-xl shadow-green-100"
            >
              {at.generation.economicModeButton}
            </button>
          </div>
        </div>

        {/* F9.7 — Modal de avatar segmentado */}
        <SegmentedAvatarModal
          open={segmentedModalOpen}
          avatarId={config.avatar.faceId || ''}
          audioUrl={displayedAudioUrl || ''}
          aspectRatio={fmtCfg.aspectRatio as any}
          scale={avatarCfg.scale}
          background={avatarCfg.background}
          onVideoReady={(url, totalSec) => {
            // Por enquanto: copia URL pro slot principal de vídeo e adiciona
            // metadata mínima. Cliente vê o vídeo no preview de baixo.
            // Future: adiciona à galeria de versões com label "Segmentado".
            toast.success(at.generation.segmentedReadyToast(totalSec.toFixed(1)));
            // Setar como videoUrl atual via callback do parent. Por ora, parent
            // (App.tsx) só vê via lastVideoMetadata — vou expandir depois.
            console.log('[SegmentedAvatar] ready:', url, 'totalSec:', totalSec);
          }}
          onClose={() => setSegmentedModalOpen(false)}
        />

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
                  <h5 className="text-[10px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-[0.2em]">
                    {at.debug.heygenStatus}
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
                    <p className="text-[8px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1">
                      {at.debug.videoId}
                    </p>
                    <p className="text-[10px] font-mono text-blue-400 truncate">{videoOp.id}</p>
                  </div>
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                    <p className="text-[8px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1">
                      {at.debug.progress}
                    </p>
                    <p className="text-lg font-black text-white">{videoOp.progress}%</p>
                  </div>
                </div>

                {videoOp.isStuck && (
                  <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-3">
                    <AlertCircle size={16} className="text-red-500" />
                    <div>
                      <p className="text-[10px] font-black text-red-500 uppercase tracking-widest">
                        {at.debug.stuckAlert}
                      </p>
                      <p className="text-[10px] text-red-400 font-medium">{videoOp.stuckReason}</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex-1 space-y-4">
                <h5 className="text-[10px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-[0.2em]">
                  {at.debug.timeMetrics}
                </h5>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-[8px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                      {at.debug.queue}
                    </p>
                    <p className="text-xl font-black text-white">{videoOp.queuedTime || 0}s</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[8px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                      {at.debug.rendering}
                    </p>
                    <p className="text-xl font-black text-white">{videoOp.renderTime || 0}s</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[8px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                      {at.debug.totalElapsed}
                    </p>
                    <p className="text-xl font-black text-blue-400">{videoOp.totalTime || 0}s</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[8px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                      {at.debug.polls}
                    </p>
                    <p className="text-xl font-black text-gray-500 dark:text-gray-400">
                      {videoOp.pollCount || 0}
                    </p>
                  </div>
                </div>
                <div className="pt-2 border-t border-white/5">
                  <p className="text-[8px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">
                    {at.debug.startedAt(videoOp.requestSentTime)}
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        <div className="flex items-center justify-between px-2">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-bold text-gray-500 dark:text-gray-400">
              {at.results.showingPrefix}{' '}
              <span className="text-blue-600 dark:text-blue-400">{filteredAvatars.length}</span>{' '}
              {at.results.showingSuffix}
            </p>
            {isFallbackActive && (
              <p className="text-[10px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-widest animate-pulse flex items-center gap-1">
                <AlertCircle size={10} />
                {at.results.noExactMatch}
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
              <p className="text-red-900 dark:text-red-200 font-black text-xl">
                {at.errorState.title}
              </p>
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
              {at.errorState.retryButton}
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
                      // Select new one. Guardamos também o NOME/preview/gênero
                      // (não só o id) pro painel de info do criativo mostrar
                      // "Sarah" sem precisar resolver no catálogo depois.
                      setConfig((prev: any) => ({
                        ...prev,
                        avatar: {
                          ...prev.avatar,
                          faceId: a.avatar_id,
                          faceName: a.avatar_name || '',
                          facePreviewUrl: a.preview_image_url || '',
                          faceGender: a.gender || '',
                        },
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

                    // HeyGen NÃO fornece aspect_ratio confiável (o schema nem
                    // tem o campo) → default HORIZONTAL (16:9), IGUAL ao
                    // AvatarPreviewModal. Só cai em 9:16 quando explicitamente
                    // marcado como vertical. (Antes o default era 9:16, então o
                    // avatar horizontal gerava vídeo vertical com bordas.)
                    const isHorizontal =
                      a.aspect_ratio !== '9:16' &&
                      !a.avatar_id?.toLowerCase().includes('vertical') &&
                      !a.avatar_id?.toLowerCase().includes('portrait');

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
                            {age === 'young'
                              ? at.card.ageYoung
                              : age === 'adult'
                                ? at.card.ageAdult
                                : at.card.ageMature}
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
                  {/* Star toggle — pin/unpin this avatar to your favorites.
                      Sits in the top-right unless the "selected" badge is
                      already there, in which case we tuck the star into
                      top-left next to the IA badge.

                      Era `<button>` mas o card pai TAMBÉM é `<button>`, e
                      HTML não permite button dentro de button (warning
                      hidratação React). Trocado pra <div role="button"> com
                      keyboard handlers + stopPropagation pra preservar
                      acessibilidade sem violar o spec. */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      favorites.toggle(a.avatar_id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        favorites.toggle(a.avatar_id);
                      }
                    }}
                    className={`absolute z-10 cursor-pointer ${
                      config.avatar.faceId === a.avatar_id ? 'top-3 left-3' : 'top-3 right-3'
                    } w-8 h-8 rounded-full flex items-center justify-center shadow-lg border-2 border-white transition-all ${
                      favorites.isFavorite(a.avatar_id)
                        ? 'bg-amber-400 text-amber-950'
                        : 'bg-white/30 text-white hover:bg-amber-400 hover:text-amber-950 backdrop-blur-md'
                    }`}
                    title={
                      favorites.isFavorite(a.avatar_id)
                        ? at.card.removeFavoriteTitle
                        : at.card.addFavoriteTitle
                    }
                    aria-label={
                      favorites.isFavorite(a.avatar_id)
                        ? at.card.removeFavoriteTitle
                        : at.card.addFavoriteTitle
                    }
                    aria-pressed={favorites.isFavorite(a.avatar_id)}
                  >
                    <Star
                      size={14}
                      className={favorites.isFavorite(a.avatar_id) ? 'fill-current' : ''}
                    />
                  </div>
                  {config.avatar.faceId === a.avatar_id && (
                    <div className="absolute top-3 right-3 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-lg border-2 border-white">
                      <CheckCircle2 size={18} />
                    </div>
                  )}
                  {isRecommended && config.avatar.faceId !== a.avatar_id && (
                    <div
                      className="absolute top-3 left-3 px-2 py-1 bg-purple-600 text-white rounded-full text-[10px] font-black uppercase tracking-widest shadow-lg border-2 border-white flex items-center gap-1"
                      title={at.card.matchesRecommendationTitle}
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
          aspectRatio={fmtCfg.aspectRatio}
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
              toast.success(at.previewModal.removedToast);
            } else {
              setConfig((prev: any) => ({
                ...prev,
                avatar: {
                  ...prev.avatar,
                  faceId: previewAvatar.avatar_id,
                  faceName: previewAvatar.avatar_name || '',
                  facePreviewUrl: previewAvatar.preview_image_url || '',
                  faceGender: previewAvatar.gender || '',
                },
              }));
              toast.success(at.previewModal.selectedToast(previewAvatar.avatar_name));
            }
          }}
        />

        {/* Action Footer removed and moved to top */}
      </div>

      {/* Toggle gancho/corpo TAMBÉM no rodapé — pra não precisar rolar até o
          topo só pra trocar de lado. Mesmo comportamento do de cima. */}
      {useHookFlow && (
        <div className="bg-white dark:bg-gray-900/80 p-2 rounded-2xl border-2 border-gray-200 dark:border-gray-800 shadow-sm flex gap-1">
          <button
            onClick={() => setAvatarMode('body')}
            className={`flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
              !isHookMode
                ? 'bg-gray-900 text-white shadow-md'
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60'
            }`}
          >
            {at.modeToggle.body}
            {(config.videos || []).length > 0 && (
              <span className="ml-2 text-[9px] opacity-70">({(config.videos || []).length})</span>
            )}
          </button>
          <button
            onClick={() => setAvatarMode('hook')}
            className={`flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
              isHookMode
                ? 'bg-amber-500 text-white shadow-md'
                : 'text-gray-500 dark:text-gray-400 hover:bg-amber-50 dark:hover:bg-amber-950/40'
            }`}
          >
            {at.modeToggle.hook}
            {hookVideos.length > 0 && (
              <span className="ml-2 text-[9px] opacity-70">({hookVideos.length})</span>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
