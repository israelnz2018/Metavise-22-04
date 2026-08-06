// Edição Zap tab — biggest "render-heavy" tab. Handles:
//   1. Source video picker (toggles between body videos + hook videos).
//   2. ZapCap render config form (template, format, font, b-rolls, etc.).
//   3. Hook-mode headline overlay editor (Meta-ad style top banner).
//   4. Intercut modal (alternating avatar / text cuts).
//   5. Versions gallery with per-version actions (download / delete /
//      intercut / headline / set-as-final).
//   6. Juntar (hook+body join) picker and render.
//
// All transient editor state comes through the `zap: ZapBundle` prop
// from `useZapState` — that's the whole reason for the hook: turn
// what would be ~100 individual setter props into one. Parent-scope
// state (config, videos, currentProjectId, etc.) still passes as
// individual named props.

import React, { useState } from 'react';
import type { AdConfig } from '@/App';
import { toast } from 'react-hot-toast';
import { AlertTriangle, Loader2, Layers, Trash2, Zap, Download, Upload } from 'lucide-react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { BrollSection } from '../components/BrollSection';
import { storage, auth } from '@/lib/firebase';
import { cn, getVideoAspectRatioClass } from '@/lib/utils';
import { getAuthorizedUrl } from '@/lib/gemini';
import { VideoDurationBadge } from '@/components/VideoDurationBadge';
import { VslJoinPanel } from '@/components/VslJoinPanel';
import { VideoJoinPanel } from '@/components/VideoJoinPanel';
import { AudioJoinPanel } from '@/components/AudioJoinPanel';
import { CaptionPresetBar } from '@/components/CaptionPresetBar';
import { VslStyleReference } from '@/components/VslStyleReference';
import { HeadlineModal } from '@/components/HeadlineModal';
import { IntercutModal } from '@/components/IntercutModal';
import { MusicSection } from '@/components/MusicSection';
import { SpeedSection } from '@/components/SpeedSection';
import type { ZapBundle } from '@/hooks/useZapState';

interface Video {
  url: string;
  storagePath?: string | null;
  durationSeconds?: number;
  [key: string]: any;
}

interface Props {
  // Single transient-state bundle from the parent's `useZapState()` call.
  zap: ZapBundle;

  // Persisted config + parent-owned state.
  config: AdConfig;
  setConfig: React.Dispatch<React.SetStateAction<AdConfig>>;
  videos: Video[] | undefined;
  platformApiKey: string | null;
  user: any;
  useHookFlow: boolean;
  /** Currently unused inside the tab but kept on the interface so the
   *  parent can pass its loading flag in without an extra refactor. */
  loading?: boolean;

  // Parent-owned handlers.
  handleRenderZapSimple: (overrideBrollPercent?: number) => Promise<void> | void;
  handleRenderZapSplit: () => Promise<void> | void;
  handleDeleteVideoFromArray: (video: {
    url: string;
    storagePath: string | null;
  }) => Promise<void> | void;
  /** Registra um vídeo enviado pelo user como fonte do pipeline (corpo: state
   *  `videos` + config.videos; gancho: config.copy.hookVideos). Vem do App. */
  onAddUploadedVideo?: (video: any, isHook: boolean) => void;
  handleRenderHeadline: () => Promise<void> | void;
  /** F6.5 — aceita insertions[] (modo manual). F6.11 — opcional settings
   *  com wordsPerLine + mergeThresholdSec do modal.
   *  F6.15 — adiciona textColor, highlightColor, highlightMode. */
  handleRenderIntercut: (
    insertions: Array<{
      id: string;
      atSec: number;
      durationSec: number;
      text: string;
      position: 'top' | 'middle' | 'bottom';
      words: Array<{ text: string; offsetMs: number; durationMs: number }>;
    }>,
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
  ) => Promise<void> | void;
  fetchZapCapTemplates: () => Promise<void> | void;
  zapCapTemplates: any[];
}

export function EditZapTab({
  zap,
  config,
  setConfig,
  videos,
  platformApiKey,
  user,
  useHookFlow,
  loading: _loading,
  handleRenderZapSimple,
  handleRenderZapSplit,
  handleDeleteVideoFromArray,
  handleRenderHeadline,
  handleRenderIntercut,
  fetchZapCapTemplates,
  zapCapTemplates,
  onAddUploadedVideo,
}: Props) {
  // Destructure everything from `zap` — the giant union exists so the
  // body below reads exactly like the pre-extraction code.
  const {
    zapState,
    setZapState,
    zapPollRef,
    isZapRenderingRef,
    zapAutoRetryRef,
    zapVideoUrl,
    setZapVideoUrl,
    zapTemplateId,
    setZapTemplateId,
    zapBrollPercent,
    setZapBrollPercent,
    zapBrollStartSec,
    setZapBrollStartSec,
    zapEmoji,
    setZapEmoji,
    zapAnimation,
    setZapAnimation,
    zapEmphasizeKeywords,
    setZapEmphasizeKeywords,
    zapSilenceRemoval,
    setZapSilenceRemoval,
    zapLanguage,
    setZapLanguage,
    zapVideoFormat,
    setZapVideoFormat,
    zapSubtitleTop,
    setZapSubtitleTop,
    zapFontUppercase,
    setZapFontUppercase,
    zapFontSize,
    setZapFontSize,
    zapDisplayWords,
    setZapDisplayWords,
    zapFontColor,
    setZapFontColor,
    zapStrokeColor,
    setZapStrokeColor,
    zapUseCustomHighlight,
    setZapUseCustomHighlight,
    zapHl1,
    setZapHl1,
    zapHl2,
    setZapHl2,
    zapHl3,
    setZapHl3,
    editZapMode,
    setEditZapMode,
    joinRendering,
    setJoinRendering,
    selectedJoinHookUrl,
    setSelectedJoinHookUrl,
    selectedJoinBodyUrl,
    setSelectedJoinBodyUrl,
    headlineSourceUrl,
    setHeadlineSourceUrl,
    headlineText,
    setHeadlineText,
    headlineBgColor,
    setHeadlineBgColor,
    headlineTextColor,
    setHeadlineTextColor,
    headlineStrokeColor,
    setHeadlineStrokeColor,
    headlineStrokeWidth,
    setHeadlineStrokeWidth,
    headlineHl1,
    setHeadlineHl1,
    headlineHl2,
    setHeadlineHl2,
    headlineHl3,
    setHeadlineHl3,
    headlineBgHl1,
    setHeadlineBgHl1,
    headlineBgHl2,
    setHeadlineBgHl2,
    headlineBgHl3,
    setHeadlineBgHl3,
    headlineWordStyles,
    setHeadlineWordStyles,
    headline2Enabled,
    setHeadline2Enabled,
    headlineSwitchPct,
    setHeadlineSwitchPct,
    headlineAutoTime,
    setHeadlineAutoTime,
    headlineSourceDims,
    headline2Text,
    setHeadline2Text,
    headline2BgColor,
    setHeadline2BgColor,
    headline2WordStyles,
    setHeadline2WordStyles,
    headlineFontSize,
    setHeadlineFontSize,
    headlineBarHeightPct,
    setHeadlineBarHeightPct,
    headlineRendering,
    intercutSourceUrl,
    setIntercutSourceUrl,
    // F6.5 — intercutAvatarSec/intercutBlackSec/intercutTexts são legacy
    // (modo cadência). O novo IntercutModal usa só fontSize + insertions[]
    // construídas internamente. Mantidos no useZapState por compat.
    intercutFontSize,
    setIntercutFontSize,
    intercutRendering,
  } = zap;
  // Touch refs/state we destructure but might not use directly here so
  // TS6133 doesn't complain (the body uses them via closures it inlines).
  void zapPollRef;
  void isZapRenderingRef;
  void zapAutoRetryRef;

  const isRendering = zapState.status === 'rendering' || zapState.status === 'uploading';

  const isHookEdit = editZapMode === 'hook';
  const isVslEdit = editZapMode === 'vsl';
  const hookVideosForEdit = (config.copy?.hookVideos as typeof videos | undefined) || [];
  const bodyZapVersions = (config.edit?.zapVersions as string[] | undefined) || [];
  const hookZapVersions = (config.edit?.zapHookVersions as string[] | undefined) || [];
  const vslZapVersions = (config.edit?.zapVslVersions as string[] | undefined) || [];
  // A Montagem no modo VSL salva em config.montagemVsl (NÃO em config.montagem,
  // que é o modo anúncio/creative). É de lá que vêm os vídeos da VSL.
  const vslMontage = ((config as any)?.montagemVsl as any) || {};
  const vslGroupUrls = ((vslMontage.groupUrls as string[] | undefined) || []).filter(Boolean);
  // Passa o formato escolhido na Montagem pra a caixa do picker não forçar 9:16.
  const vslMontageAspect = (vslMontage.aspect as string | undefined) || '1:1';
  const vslGroupVideos = vslGroupUrls.map((url, i) => ({
    url,
    label: `Grupo ${i + 1}`,
    aspectRatio: vslMontageAspect,
  }));
  const hasVslGroups = vslGroupVideos.length > 0;
  // Fontes VSL pro editor: vídeo(s) montado(s) da VSL (montagemVsl.resultUrl +
  // histórico) + grupos + os vídeos do avatar VSL (aba Avatar).
  // A Montagem VSL agora guarda um workflow por BLOCO (montagemVsl.blockDrafts);
  // cada bloco tem seu resultado. Listamos o de cada bloco como "Bloco N".
  const vslBlockDrafts =
    vslMontage.blockDrafts && typeof vslMontage.blockDrafts === 'object'
      ? (vslMontage.blockDrafts as Record<string, any>)
      : {};
  const vslBlockKeys = Object.keys(vslBlockDrafts)
    .map(Number)
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);
  const vslMontageEntries =
    vslBlockKeys.length > 0
      ? vslBlockKeys.flatMap((k) => {
          const b = vslBlockDrafts[k] || {};
          const urls = [
            b.resultUrl as string | undefined,
            ...((b.resultHistory as { url: string }[] | undefined) || []).map((v) => v.url),
          ].filter((u, i, a) => u && a.indexOf(u) === i) as string[];
          return urls.map((url, j) => ({
            url,
            label: `Bloco ${k + 1}${urls.length > 1 ? ` · v${j + 1}` : ''}`,
            aspectRatio: vslMontageAspect,
            source: 'montagem' as const,
          }));
        })
      : [
          ...(vslMontage.resultUrl ? [vslMontage.resultUrl as string] : []),
          ...(((vslMontage.resultHistory as { url: string }[] | undefined) || []).map(
            (v) => v.url
          )),
        ]
          .filter((u, i, a) => u && a.indexOf(u) === i)
          .map((url, i, a) => ({
            url,
            label: `Montagem VSL${a.length > 1 ? ` ${i + 1}` : ''}`,
            aspectRatio: vslMontageAspect,
            source: 'montagem' as const,
          }));
  // Nome = idêntico ao da aba Avatar: "Vídeo {idx+1}" pelo índice no array
  // COMPLETO (config.copyVsl.avatarVideos), por isso mapeamos antes de filtrar.
  const vslAvatarVideos = (((config as any)?.copyVsl?.avatarVideos as any[]) || [])
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => v?.url);
  const vslSourceVideos = [
    ...vslMontageEntries,
    ...vslGroupVideos.map((g) => ({ ...g, source: 'montagem' as const })),
    ...vslAvatarVideos.map(({ v, i }) => ({
      url: v.url as string,
      label: `Vídeo ${i + 1}${v.blockLabel ? ` · ${v.blockLabel}` : ''}`,
      aspectRatio: (v.aspectRatio as string) || vslMontageAspect,
      source: 'avatar' as const,
    })),
  ].filter((o, i, a) => o.url && a.findIndex((x) => x.url === o.url) === i);
  const hasVslContent = vslSourceVideos.length > 0;
  const activeZapVersions = isVslEdit ? vslZapVersions : isHookEdit ? hookZapVersions : bodyZapVersions;
  // Opções de CORPO pro "Juntar": versões normais + os vídeos MESCLADOS.
  const bodyJoinOptions: { url: string; label: string }[] = [
    ...bodyZapVersions.map((url, i) => ({ url, label: `Versão ${i + 1}` })),
    ...(((config.edit as any)?.mergeVersions as string[] | undefined) || []).map((url, i) => ({
      url,
      label: `Mesclado ${i + 1}`,
    })),
  ].filter((o, i, a) => o.url && a.findIndex((x) => x.url === o.url) === i);

  // Source video picker pulls from hook, body, or the VSL groups depending on mode.
  const availableVideos = (
    isVslEdit
      ? (vslSourceVideos as any)
      : isHookEdit
        ? hookVideosForEdit
        : videos || []
  ).filter((v: any) => v.url);

  // ── Upload do próprio vídeo ───────────────────────────────────────────────
  // Sobe um vídeo externo pro Storage e registra como fonte do pipeline, igual
  // a um vídeo gerado pelo avatar. A partir daí legenda/tela-preta/b-roll/
  // música funcionam normalmente.
  const [uploadingVideo, setUploadingVideo] = useState(false);

  const detectAspect = (file: File): Promise<string | undefined> =>
    new Promise((resolve) => {
      try {
        const url = URL.createObjectURL(file);
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.onloadedmetadata = () => {
          const w = v.videoWidth;
          const h = v.videoHeight;
          URL.revokeObjectURL(url);
          if (!w || !h) return resolve(undefined);
          const r = w / h;
          resolve(r > 1.2 ? '16:9' : r < 0.85 ? '9:16' : '1:1');
        };
        v.onerror = () => {
          URL.revokeObjectURL(url);
          resolve(undefined);
        };
        v.src = url;
      } catch {
        resolve(undefined);
      }
    });

  const handleUploadOwnVideo = async (file: File | null | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      toast.error('Selecione um arquivo de vídeo (mp4, mov...).');
      return;
    }
    const uid = user?.uid || auth.currentUser?.uid;
    if (!uid) {
      toast.error('Faça login para enviar um vídeo.');
      return;
    }
    setUploadingVideo(true);
    const toastId = 'upload-own-video';
    toast.loading('Enviando seu vídeo...', { id: toastId });
    try {
      const aspectRatio = await detectAspect(file);
      const safeName = file.name.replace(/[^a-z0-9.-]/gi, '_');
      const path = `video/${uid}/zap-upload/${Date.now()}-${safeName}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file, { contentType: file.type || 'video/mp4' });
      const url = await getDownloadURL(storageRef);
      const newVideo: any = {
        url,
        storagePath: storageRef.fullPath,
        createdAt: new Date().toISOString(),
        uploaded: true,
        ...(aspectRatio ? { aspectRatio } : {}),
      };
      // Registra na lista certa (corpo vs gancho) — vira thumbnail no picker e
      // persiste no config.
      onAddUploadedVideo?.(newVideo, isHookEdit);
      // Já seleciona como fonte ativa do pipeline.
      setZapVideoUrl(url);
      setZapState((prev) => ({ ...prev, originalVideoUrl: url }));
      toast.success('Vídeo enviado e selecionado! Edite como quiser.', {
        id: toastId,
        duration: 4000,
      });
    } catch (err: any) {
      toast.error(err?.message || 'Falha ao enviar o vídeo.', { id: toastId });
    } finally {
      setUploadingVideo(false);
    }
  };

  return (
    <div className="max-w-[1100px] mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h3 className="text-2xl font-black text-gray-900 dark:text-gray-50 tracking-tight flex items-center gap-2">
            <Zap size={28} className="text-yellow-500" />
            Edição
          </h3>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
            Versão simplificada — ZapCap faz tudo (transcrição + b-rolls automaticamente).
          </p>
        </div>
        <span className="px-3 py-1 bg-yellow-100 text-yellow-800 dark:text-yellow-300 rounded-full text-[10px] font-black uppercase tracking-widest">
          Beta
        </span>
      </div>

      {/* Toggle: editing the body, the hook, or the VSL (em grupos)? Cada um
          guarda versões separadas. Aparece quando há gancho OU grupos de VSL. */}
      {(useHookFlow || hasVslContent) && (
        <div className="bg-white dark:bg-gray-900/80 p-2 rounded-2xl border-2 border-gray-200 dark:border-gray-800 shadow-sm flex gap-1">
          <button
            onClick={() => {
              setEditZapMode('body');
              setZapVideoUrl(null);
            }}
            className={`flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
              !isHookEdit && !isVslEdit
                ? 'bg-yellow-500 text-white shadow-md'
                : 'text-gray-500 dark:text-gray-400 hover:bg-yellow-50 dark:hover:bg-yellow-950/40'
            }`}
          >
            Editar Corpo
            {bodyZapVersions.length > 0 && (
              <span className="ml-2 text-[9px] opacity-70">({bodyZapVersions.length})</span>
            )}
          </button>
          {useHookFlow && (
            <button
              onClick={() => {
                setEditZapMode('hook');
                setZapVideoUrl(null);
              }}
              className={`flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                isHookEdit
                  ? 'bg-amber-500 text-white shadow-md'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-amber-50 dark:hover:bg-amber-950/40'
              }`}
            >
              Editar Gancho
              {hookZapVersions.length > 0 && (
                <span className="ml-2 text-[9px] opacity-70">({hookZapVersions.length})</span>
              )}
            </button>
          )}
          {hasVslContent && (
            <button
              onClick={() => {
                setEditZapMode('vsl');
                setZapVideoUrl(null);
              }}
              className={`flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                isVslEdit
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-purple-50 dark:hover:bg-purple-950/40'
              }`}
            >
              Editar VSL
              <span className="ml-2 text-[9px] opacity-70">({vslGroupVideos.length} grupos)</span>
            </button>
          )}
        </div>
      )}

      {/* VSL: estilo de referência (upload da VSL campeã + análise do ritmo). */}
      {isVslEdit && <VslStyleReference userId={user?.uid} />}

      {/* VSL: painel de junção dos grupos editados. Pra cada grupo você escolhe
          qual vídeo usar (o grupo cru ou uma versão editada) e junta tudo. */}
      {isVslEdit && hasVslGroups && (
        <VslJoinPanel
          groups={vslGroupUrls}
          versions={vslZapVersions}
          userId={user?.uid}
          chosen={((config as any)?.montagem?.groupChosen as string[] | undefined) || []}
          onChoose={(gi, url) => {
            setConfig((prev: any) => {
              const cur = [...(((prev?.montagem?.groupChosen as string[]) || []) as string[])];
              while (cur.length < vslGroupUrls.length) cur.push('');
              cur[gi] = url;
              return { ...prev, montagem: { ...(prev.montagem || {}), groupChosen: cur } };
            });
          }}
          onJoined={(url) => {
            onAddUploadedVideo?.(
              { url, uploaded: true, aspectRatio: '1:1', createdAt: new Date().toISOString() },
              false
            );
          }}
        />
      )}

      {/* ETAPA 1 — Selecionar Vídeo */}
      <div className="bg-white dark:bg-gray-900/80 p-6 md:p-8 rounded-[32px] border-2 border-gray-200 dark:border-gray-800 shadow-sm space-y-4">
        <div className="flex items-center gap-3">
          <span className="px-3 py-1 bg-yellow-500 text-white rounded-full text-[10px] font-black uppercase tracking-widest">
            Etapa 1
          </span>
          <h4 className="text-lg font-black text-gray-900 dark:text-gray-50">Selecione o Vídeo</h4>
        </div>

        {/* Upload do próprio vídeo — vira fonte do pipeline (legenda, tela
            preta, b-rolls, música) igual a um vídeo gerado no Metavise. */}
        <label
          className={cn(
            'flex items-center justify-center gap-3 p-5 rounded-2xl border-2 border-dashed cursor-pointer transition-all',
            uploadingVideo
              ? 'border-blue-300 bg-blue-50/60 dark:bg-blue-950/30 cursor-wait'
              : 'border-blue-300 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-950/20 hover:bg-blue-50 dark:hover:bg-blue-950/40'
          )}
        >
          <input
            type="file"
            accept="video/*"
            disabled={uploadingVideo}
            className="hidden"
            onChange={(e) => {
              handleUploadOwnVideo(e.target.files?.[0]);
              e.target.value = ''; // permite reenviar o mesmo arquivo
            }}
          />
          {uploadingVideo ? (
            <Loader2 size={18} className="animate-spin text-blue-600 dark:text-blue-400" />
          ) : (
            <Upload size={18} className="text-blue-600 dark:text-blue-400" />
          )}
          <span className="text-sm font-bold text-blue-700 dark:text-blue-300">
            {uploadingVideo
              ? 'Enviando seu vídeo...'
              : `Enviar meu próprio vídeo${isHookEdit ? ' (para o gancho)' : ''}`}
          </span>
          <span className="text-[11px] text-blue-500/70 dark:text-blue-400/60 hidden sm:inline">
            mp4, mov — edite como se tivesse feito aqui
          </span>
        </label>

        {availableVideos.length === 0 ? (
          <div className="p-8 text-center bg-gray-50 dark:bg-gray-800/60 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400 font-bold">
              Nenhum vídeo gerado ainda. Gere um em "Gerar Vídeo com Avatar" — ou
              <span className="text-blue-600 dark:text-blue-400"> envie o seu próprio acima</span>.
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
                    : 'border-gray-200 dark:border-gray-800 hover:border-yellow-200'
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
                <div className="absolute top-2 left-2 flex flex-col items-start gap-1 pointer-events-none">
                  {/* Selo de origem: distingue vídeo da Montagem (azul) do
                      vídeo do Avatar (roxo). Só no Editar VSL, onde as fontes
                      se misturam. */}
                  {v.source && (
                    <span
                      className={cn(
                        'px-2 py-0.5 text-white text-[9px] font-black rounded uppercase tracking-widest shadow',
                        v.source === 'avatar' ? 'bg-purple-600' : 'bg-blue-600'
                      )}
                    >
                      {v.source === 'avatar' ? 'Avatar' : 'Montagem'}
                    </span>
                  )}
                  {/* Nome do vídeo — igual ao da aba de origem (ex.: "Vídeo 3"). */}
                  {v.label && (
                    <span className="px-2 py-0.5 bg-black/70 text-white text-[9px] font-black rounded shadow">
                      {v.label}
                    </span>
                  )}
                  {zapVideoUrl === v.url && (
                    <span className="px-2 py-0.5 bg-yellow-500 text-white text-[9px] font-black rounded uppercase tracking-widest">
                      ✓ Selecionado
                    </span>
                  )}
                </div>
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

      {/* ETAPA 2 — B-roll (Pexels): entra ANTES da legenda. Atualiza zapVideoUrl
          pro vídeo já com b-roll virar a fonte do ZapCap. */}
      {!isHookEdit && (
        <BrollSection
          videoUrl={zapVideoUrl}
          userId={user?.uid}
          format={zapState.videoFormat}
          onApplied={(url) => {
            setZapVideoUrl(url);
            // Adiciona como NOVA versão na galeria (aparece ao lado do original).
            setConfig((prev: any) => {
              const key = isVslEdit ? 'zapVslVersions' : isHookEdit ? 'zapHookVersions' : 'zapVersions';
              const cur = ((prev.edit as any)?.[key] as string[] | undefined) || [];
              if (cur.includes(url)) return prev;
              return { ...prev, edit: { ...(prev.edit as any), [key]: [...cur, url] } };
            });
            toast.success('B-roll aplicado e salvo como nova versão! Agora é só gerar a legenda.');
          }}
          disabled={isRendering}
        />
      )}

      {/* ETAPA 3 — Template de Legenda */}
      <div className="bg-white dark:bg-gray-900/80 p-6 md:p-8 rounded-[32px] border-2 border-gray-200 dark:border-gray-800 shadow-sm space-y-4">
        <div className="flex items-center gap-3">
          <span className="px-3 py-1 bg-yellow-500 text-white rounded-full text-[10px] font-black uppercase tracking-widest">
            Etapa 3
          </span>
          <h4 className="text-lg font-black text-gray-900 dark:text-gray-50">
            Escolha o Template de Legenda
          </h4>
        </div>

        {zapCapTemplates.length === 0 ? (
          <div className="p-8 text-center bg-gray-50 dark:bg-gray-800/60 rounded-2xl">
            <p className="text-sm text-gray-500 dark:text-gray-400 font-bold mb-3">
              Carregando templates...
            </p>
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
                  : 'border-gray-200 dark:border-gray-700 hover:border-yellow-200'
              )}
            >
              <div className="text-3xl mb-2">🚫</div>
              <p className="text-xs font-black text-gray-700 dark:text-gray-300 uppercase tracking-widest">
                Nenhuma
              </p>
              <p className="text-[9px] text-gray-500 dark:text-gray-400 mt-1 leading-tight">
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
                    : 'border-gray-200 dark:border-gray-800 hover:border-yellow-200'
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

      {/* ETAPA 4 — Ajustes */}
      <div className="bg-white dark:bg-gray-900/80 p-6 md:p-8 rounded-[32px] border-2 border-gray-200 dark:border-gray-800 shadow-sm space-y-5">
        <div className="flex items-center gap-3">
          <span className="px-3 py-1 bg-yellow-500 text-white rounded-full text-[10px] font-black uppercase tracking-widest">
            Etapa 4
          </span>
          <h4 className="text-lg font-black text-gray-900 dark:text-gray-50">Ajustes</h4>
        </div>

        {/* Presets: salva/reaplica todos os ajustes de estilo da legenda. */}
        <CaptionPresetBar
          current={{
            zapTemplateId,
            zapLanguage,
            zapBrollPercent,
            zapBrollStartSec,
            zapEmoji,
            zapAnimation,
            zapEmphasizeKeywords,
            zapFontUppercase,
            zapFontSize,
            zapDisplayWords,
            zapFontColor,
            zapStrokeColor,
            zapUseCustomHighlight,
            zapHl1,
            zapHl2,
            zapHl3,
            zapSubtitleTop,
          }}
          onApply={(s) => {
            if (s.zapTemplateId !== undefined) setZapTemplateId(s.zapTemplateId);
            if (s.zapLanguage !== undefined) setZapLanguage(s.zapLanguage);
            if (s.zapBrollPercent !== undefined) setZapBrollPercent(s.zapBrollPercent);
            if (s.zapBrollStartSec !== undefined) setZapBrollStartSec(s.zapBrollStartSec);
            if (s.zapEmoji !== undefined) setZapEmoji(s.zapEmoji);
            if (s.zapAnimation !== undefined) setZapAnimation(s.zapAnimation);
            if (s.zapEmphasizeKeywords !== undefined) setZapEmphasizeKeywords(s.zapEmphasizeKeywords);
            if (s.zapFontUppercase !== undefined) setZapFontUppercase(s.zapFontUppercase);
            if (s.zapFontSize !== undefined) setZapFontSize(s.zapFontSize);
            if (s.zapDisplayWords !== undefined) setZapDisplayWords(s.zapDisplayWords);
            if (s.zapFontColor !== undefined) setZapFontColor(s.zapFontColor);
            if (s.zapStrokeColor !== undefined) setZapStrokeColor(s.zapStrokeColor);
            if (s.zapUseCustomHighlight !== undefined) setZapUseCustomHighlight(s.zapUseCustomHighlight);
            if (s.zapHl1 !== undefined) setZapHl1(s.zapHl1);
            if (s.zapHl2 !== undefined) setZapHl2(s.zapHl2);
            if (s.zapHl3 !== undefined) setZapHl3(s.zapHl3);
            if (s.zapSubtitleTop !== undefined) setZapSubtitleTop(s.zapSubtitleTop);
          }}
        />

        {/* Idioma */}
        <div className="space-y-2">
          <label className="text-xs font-black text-gray-900 dark:text-gray-50 uppercase tracking-widest">
            Idioma do Vídeo
          </label>
          <div className="flex flex-wrap gap-2">
            {[
              { value: 'en', label: '🇺🇸 Inglês' },
              { value: 'pt', label: '🇧🇷 Português' },
              { value: 'es', label: '🇪🇸 Espanhol' },
            ].map((lang: any) => (
              <button
                key={lang.value}
                onClick={() => setZapLanguage(lang.value)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all',
                  zapLanguage === lang.value
                    ? 'bg-yellow-500 text-white border-yellow-500'
                    : 'bg-white dark:bg-gray-900/80 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-yellow-300'
                )}
              >
                {lang.label}
              </button>
            ))}
          </div>
        </div>

        {/* B-Roll Percent */}
        <div className="space-y-2">
          <label className="text-xs font-black text-gray-900 dark:text-gray-50 uppercase tracking-widest flex items-center justify-between">
            <span>Quantidade de B-Rolls</span>
            <span className="text-yellow-600 dark:text-yellow-400">{zapBrollPercent}%</span>
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
          <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-widest">
            0% = sem b-rolls · 30-50% = balanceado · 70-80% = bastante
          </p>
        </div>

        {/* B-roll começa em Xs — só no Corpo. Mantém o avatar na intro. */}
        {!isHookEdit && (
          <div className="space-y-2">
            <label className="text-xs font-black text-gray-900 dark:text-gray-50 uppercase tracking-widest flex items-center justify-between">
              <span>B-roll começa em</span>
              <span className="text-yellow-600 dark:text-yellow-400">
                {zapBrollStartSec > 0 ? `${zapBrollStartSec}s` : 'início'}
              </span>
            </label>
            <input
              type="number"
              min="0"
              step="1"
              value={zapBrollStartSec}
              onChange={(e) =>
                setZapBrollStartSec(Math.max(0, Math.floor(Number(e.target.value) || 0)))
              }
              className="w-full p-2.5 bg-gray-50 dark:bg-gray-800/60 ring-1 ring-gray-200/60 dark:ring-gray-700/60 rounded-xl text-sm focus:ring-2 focus:ring-yellow-500 outline-none dark:text-gray-100"
            />
            <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-widest leading-snug">
              0 = b-roll desde o começo. Maior que 0 = a intro até esse segundo fica só avatar +
              legenda (sem b-roll) e o b-roll entra depois. Escolha um segundo onde uma frase
              termina, pra não cortar no meio.
            </p>
          </div>
        )}

        {/* Toggles */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            onClick={() => setZapEmoji(!zapEmoji)}
            className={cn(
              'p-3 rounded-2xl border-2 text-left transition-all',
              zapEmoji
                ? 'bg-yellow-50 dark:bg-yellow-950/40 border-yellow-500'
                : 'bg-white dark:bg-gray-900/80 border-gray-200 dark:border-gray-800 hover:border-yellow-200'
            )}
          >
            <p className="text-sm font-black text-gray-900 dark:text-gray-50">
              {zapEmoji ? '✅' : '⬜'} Emojis na Legenda
            </p>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-widest">
              ZapCap insere emojis automaticamente
            </p>
          </button>

          <button
            onClick={() => setZapAnimation(!zapAnimation)}
            className={cn(
              'p-3 rounded-2xl border-2 text-left transition-all',
              zapAnimation
                ? 'bg-yellow-50 dark:bg-yellow-950/40 border-yellow-500'
                : 'bg-white dark:bg-gray-900/80 border-gray-200 dark:border-gray-800 hover:border-yellow-200'
            )}
          >
            <p className="text-sm font-black text-gray-900 dark:text-gray-50">
              {zapAnimation ? '✅' : '⬜'} Animação na Legenda
            </p>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-widest">
              Texto animado conforme o template
            </p>
          </button>

          <button
            onClick={() => setZapEmphasizeKeywords(!zapEmphasizeKeywords)}
            className={cn(
              'p-3 rounded-2xl border-2 text-left transition-all',
              zapEmphasizeKeywords
                ? 'bg-yellow-50 dark:bg-yellow-950/40 border-yellow-500'
                : 'bg-white dark:bg-gray-900/80 border-gray-200 dark:border-gray-800 hover:border-yellow-200'
            )}
          >
            <p className="text-sm font-black text-gray-900 dark:text-gray-50">
              {zapEmphasizeKeywords ? '✅' : '⬜'} Destacar Palavras-Chave
            </p>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-widest">
              ZapCap detecta e destaca palavras importantes
            </p>
          </button>

          <button
            onClick={() => setZapFontUppercase(!zapFontUppercase)}
            className={cn(
              'p-3 rounded-2xl border-2 text-left transition-all',
              zapFontUppercase
                ? 'bg-yellow-50 dark:bg-yellow-950/40 border-yellow-500'
                : 'bg-white dark:bg-gray-900/80 border-gray-200 dark:border-gray-800 hover:border-yellow-200'
            )}
          >
            <p className="text-sm font-black text-gray-900 dark:text-gray-50">
              {zapFontUppercase ? '✅' : '⬜'} Legenda em MAIÚSCULAS
            </p>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-widest">
              Estilo viral / Hormozi
            </p>
          </button>
        </div>

        {/* Formato do vídeo */}
        <div className="space-y-2">
          <label className="text-xs font-black text-gray-900 dark:text-gray-50 uppercase tracking-widest">
            Formato do Vídeo
          </label>
          <div className="flex flex-wrap gap-2">
            {[
              { value: 'auto', label: '🤖 Auto' },
              { value: '9:16', label: '📱 9:16 (Vertical)' },
              { value: '1:1', label: '⬜ 1:1 (Quadrado)' },
              { value: '16:9', label: '🖥️ 16:9 (Horizontal)' },
            ].map((fmt: any) => (
              <button
                key={fmt.value}
                onClick={() => setZapVideoFormat(fmt.value as any)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all',
                  zapVideoFormat === fmt.value
                    ? 'bg-yellow-500 text-white border-yellow-500'
                    : 'bg-white dark:bg-gray-900/80 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-yellow-300'
                )}
              >
                {fmt.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-widest">
            Por enquanto informativo — ZapCap usa o formato do vídeo de entrada
          </p>
        </div>

        {/* Posição vertical da legenda */}
        <div className="space-y-2">
          <label className="text-xs font-black text-gray-900 dark:text-gray-50 uppercase tracking-widest flex items-center justify-between">
            <span>Posição Vertical da Legenda</span>
            <span className="text-yellow-600 dark:text-yellow-400">{zapSubtitleTop}%</span>
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
          <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-widest">
            0% = topo · 50% = centro · 70-80% = padrão para avatares (máximo 80%)
          </p>
        </div>

        {/* Largura da legenda: ZapCap não expõe um campo de largura/margem
            na API (confirmado na doc oficial). Controle real é via fontSize
            e escolha do template. */}
        <div className="space-y-2 p-3 bg-yellow-50 dark:bg-yellow-950/40 rounded-xl border border-yellow-200">
          <p className="text-[10px] font-black text-yellow-700 uppercase tracking-widest">
            💡 Como controlar a largura da legenda
          </p>
          <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
            ZapCap não tem ajuste direto de largura. Pra deixar a legenda{' '}
            <strong>mais estreita</strong>:
          </p>
          <ul className="text-[11px] text-gray-600 dark:text-gray-400 space-y-1 list-disc list-inside">
            <li>Diminua o tamanho da fonte abaixo (36-40px)</li>
            <li>Troque para um template que renderize menos texto por linha</li>
            <li>
              Reduza <em>Palavras por bloco</em> (mostrar 2-3 palavras por vez em vez de 5+)
            </li>
          </ul>
        </div>

        {/* Tamanho da fonte */}
        <div className="space-y-2">
          <label className="text-xs font-black text-gray-900 dark:text-gray-50 uppercase tracking-widest flex items-center justify-between">
            <span>Tamanho da Fonte</span>
            <span className="text-yellow-600 dark:text-yellow-400">{zapFontSize}px</span>
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
          <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-widest">
            6-18 = bem pequeno · 24 = padrão · 30-40 = médio · 50-80 = grande (estilo viral)
          </p>
        </div>

        {/* Palavras por linha */}
        <div className="space-y-2">
          <label className="text-xs font-black text-gray-900 dark:text-gray-50 uppercase tracking-widest flex items-center justify-between">
            <span>Palavras por Linha</span>
            <span className="text-yellow-600 dark:text-yellow-400">{zapDisplayWords}</span>
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
          <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-widest">
            1-2 = estilo viral / Hormozi · 4 = padrão · 6-8 = tutoriais longos
          </p>
        </div>

        {/* Cores da legenda — picker livre + presets rápidos */}
        <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-800/60 rounded-2xl">
          <label className="text-xs font-black text-gray-900 dark:text-gray-50 uppercase tracking-widest">
            Cores da Legenda
          </label>

          {/* Cor da fonte + borda — sempre visíveis */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-white dark:bg-gray-900/80 p-3 rounded-xl border-2 border-gray-200 dark:border-gray-800">
              <div className="text-[10px] font-black text-gray-700 dark:text-gray-300 uppercase tracking-widest mb-2">
                Cor das letras
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={zapFontColor}
                  onChange={(e) => setZapFontColor(e.target.value)}
                  className="h-10 w-14 rounded-lg border-2 border-gray-200 dark:border-gray-700 cursor-pointer"
                />
                <input
                  type="text"
                  value={zapFontColor}
                  onChange={(e) => setZapFontColor(e.target.value)}
                  placeholder="#FFFFFF"
                  className="flex-1 p-2 border-2 border-gray-200 dark:border-gray-700 rounded-lg text-xs font-mono focus:border-yellow-500 focus:outline-none"
                />
              </div>
            </div>
            <div className="bg-white dark:bg-gray-900/80 p-3 rounded-xl border-2 border-gray-200 dark:border-gray-800">
              <div className="text-[10px] font-black text-gray-700 dark:text-gray-300 uppercase tracking-widest mb-2">
                Cor da borda (contorno)
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={zapStrokeColor}
                  onChange={(e) => setZapStrokeColor(e.target.value)}
                  className="h-10 w-14 rounded-lg border-2 border-gray-200 dark:border-gray-700 cursor-pointer"
                />
                <input
                  type="text"
                  value={zapStrokeColor}
                  onChange={(e) => setZapStrokeColor(e.target.value)}
                  placeholder="#000000"
                  className="flex-1 p-2 border-2 border-gray-200 dark:border-gray-700 rounded-lg text-xs font-mono focus:border-yellow-500 focus:outline-none"
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
          <div className="bg-white dark:bg-gray-900/80 p-3 rounded-xl border-2 border-gray-200 dark:border-gray-800 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={zapUseCustomHighlight}
                onChange={(e) => setZapUseCustomHighlight(e.target.checked)}
                className="w-4 h-4 accent-yellow-500"
              />
              <span className="text-[11px] font-black text-gray-700 dark:text-gray-300 uppercase tracking-widest">
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
                  <div className="bg-red-50 dark:bg-red-950/40 border-2 border-red-300 rounded-lg p-3 space-y-1">
                    <p className="text-[11px] text-red-900 dark:text-red-200 font-black uppercase tracking-widest">
                      ⚠ Pré-requisito desligado
                    </p>
                    <p className="text-[10px] text-red-800 dark:text-red-300 leading-tight">
                      As cores customizadas só aparecem quando{' '}
                      <strong>"Destacar Palavras-Chave" está LIGADO</strong> (lá embaixo em
                      "Ajustes"). Sem isso, o ZapCap não destaca nenhuma palavra e as cores são
                      ignoradas.
                    </p>
                    <button
                      onClick={() => setZapEmphasizeKeywords(true)}
                      className="text-[10px] font-black text-red-700 underline hover:text-red-900 dark:text-red-200 mt-1"
                    >
                      Ligar agora →
                    </button>
                  </div>
                )}
                <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 rounded-lg p-2 space-y-1">
                  <p className="text-[10px] text-amber-900 dark:text-amber-200 leading-tight">
                    <strong>O ZapCap expõe só 3 cores</strong> ({'randomColour 1/2/3'}) e cada
                    template usa elas de um jeito.
                  </p>
                  <p className="text-[10px] text-amber-800 dark:text-amber-300 leading-tight">
                    Em templates como o <strong>Viktor</strong>, a cor 1 costuma virar o fundo da
                    palavra falada e a cor 2 a letra por dentro. Em outros templates as 3 cores são
                    rotacionadas aleatoriamente. Teste mudando uma de cada vez pra mapear o seu
                    template.
                  </p>
                  <p className="text-[10px] text-amber-800 dark:text-amber-300 leading-tight">
                    Alguns templates simples (sem destaque embutido) podem ignorar essas cores — se
                    nada mudar, tente outro template.
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
                        className="text-[9px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest mb-1"
                        title={hl.hint}
                      >
                        {hl.label}
                      </div>
                      <div className="flex items-center gap-1">
                        <input
                          type="color"
                          value={hl.v}
                          onChange={(e) => hl.set(e.target.value)}
                          className="h-9 w-12 rounded-lg border-2 border-gray-200 dark:border-gray-700 cursor-pointer"
                        />
                        <input
                          type="text"
                          value={hl.v}
                          onChange={(e) => hl.set(e.target.value)}
                          className="flex-1 p-1.5 border-2 border-gray-200 dark:border-gray-700 rounded-lg text-[10px] font-mono focus:border-yellow-500 focus:outline-none min-w-0"
                        />
                      </div>
                      <p className="text-[8px] text-gray-400 dark:text-gray-500 mt-1 leading-tight">
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
            <div className="text-[10px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest mb-2">
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
                    setZapHl1(p.hl[0] || '');
                    setZapHl2(p.hl[1] || '');
                    setZapHl3(p.hl[2] || '');
                    setZapUseCustomHighlight(true);
                  }}
                  className="p-2 rounded-xl border-2 border-gray-200 dark:border-gray-700 hover:border-yellow-300 bg-white dark:bg-gray-900/80 text-left transition-all"
                >
                  <div className="flex gap-1 mb-1">
                    {p.hl.map((c, j) => (
                      <div
                        key={j}
                        className="w-4 h-4 rounded-full border border-gray-200 dark:border-gray-700"
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                  <p className="text-[10px] font-black text-gray-900 dark:text-gray-50">
                    {p.label}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Intensidade de remoção de silêncios (slider, substitui o toggle) */}
        <div className="space-y-2">
          <label className="text-xs font-black text-gray-900 dark:text-gray-50 uppercase tracking-widest flex items-center justify-between">
            <span>Remoção de Silêncios</span>
            <span className="text-yellow-600 dark:text-yellow-400">
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
          <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-widest">
            0 = desligado · 0.2-0.4 = corte suave · 0.5-0.7 = corte médio · 0.8-1 = corte agressivo
          </p>
        </div>
      </div>

      {/* BOTÃO GERAR */}
      <button
        onClick={() =>
          !isHookEdit && zapBrollStartSec > 0
            ? handleRenderZapSplit()
            : handleRenderZapSimple()
        }
        // Intentional ref read during render — same double-click guard
        // rationale as Edit2Tab. See note on isRenderingRef there.
        // eslint-disable-next-line react-hooks/refs
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
        <p className="text-center text-xs text-gray-400 dark:text-gray-500 font-bold uppercase tracking-widest">
          Selecione um vídeo na Etapa 1
        </p>
      )}
      {zapVideoUrl && !zapTemplateId && (
        <p className="text-center text-xs text-gray-400 dark:text-gray-500 font-bold uppercase tracking-widest">
          Selecione um template na Etapa 3
        </p>
      )}

      {/* Progresso quando renderizando */}
      {isRendering && (
        <div className="bg-yellow-50 dark:bg-yellow-950/40 p-6 rounded-2xl border-2 border-yellow-200">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-black text-yellow-900 dark:text-yellow-200">
              {zapState.step}
            </p>
            <p className="text-sm font-black text-yellow-900 dark:text-yellow-200">
              {zapState.progress}%
            </p>
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
          <h4 className="text-xl font-black text-gray-900 dark:text-gray-50 uppercase italic">
            Galeria de Versões {isVslEdit ? '(VSL)' : isHookEdit ? '(Gancho)' : '(Corpo)'}
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Original (only meaningful for the body side right now) */}
            {!isHookEdit && zapState.originalVideoUrl && (
              <div className="space-y-3">
                <div className="relative bg-black rounded-[28px] overflow-hidden border-4 border-gray-200 dark:border-gray-800 aspect-[9/16]">
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
            {activeZapVersions.map((vUrl, idx) => {
              // F6.13 — extraído pra reusar no VersionVideo onRemove.
              const removeVersion = () => {
                if (!isHookEdit) {
                  setZapState((prev) => ({
                    ...prev,
                    versions: (prev.versions || []).filter((u) => u !== vUrl),
                    finalVideoUrl: prev.finalVideoUrl === vUrl ? undefined : prev.finalVideoUrl,
                  }));
                }
                setConfig((prev: any) => {
                  const key = isVslEdit ? 'zapVslVersions' : isHookEdit ? 'zapHookVersions' : 'zapVersions';
                  const current = ((prev.edit as any)[key] as string[] | undefined) || [];
                  return {
                    ...prev,
                    edit: { ...prev.edit, [key]: current.filter((u) => u !== vUrl) },
                  };
                });
                toast.success(`Versão ${idx + 1} removida.`);
              };
              return (
                <div key={`zap-v-${idx}-${vUrl}`} className="space-y-3">
                  <div
                    className={`relative bg-black rounded-[28px] overflow-hidden border-4 ring-4 aspect-[9/16] ${
                      isHookEdit
                        ? 'border-amber-200 ring-amber-50'
                        : 'border-yellow-200 ring-yellow-50'
                    }`}
                  >
                    <VersionVideo
                      src={getAuthorizedUrl(vUrl, platformApiKey || undefined) || undefined}
                      crossOrigin={
                        vUrl?.includes('generativelanguage.googleapis.com')
                          ? ('anonymous' as const)
                          : undefined
                      }
                      onRemove={removeVersion}
                      label={`${isHookEdit ? 'Gancho' : 'Versão'} ${idx + 1}`}
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
                      className="px-3 py-2 bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-purple-100 flex items-center justify-center gap-1"
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
                        removeVersion();
                      }}
                      className="px-3 py-2 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-100 flex items-center justify-center gap-1"
                      title="Excluir esta versão"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* F7.2 — Música de Fundo (opcional). Aparece quando há pelo menos 1
          versão na galeria. Cliente escolhe upload ou IA, mixa via ffmpeg
          amix, novo vídeo vira nova versão na galeria. */}
      {(activeZapVersions.length > 0 ||
        (!isHookEdit && (((config.edit as any)?.mergeVersions as string[]) || []).length > 0)) && (
        <MusicSection
          videoOptions={[
            ...activeZapVersions.map((url, i) => ({
              url,
              label: `${isHookEdit ? 'Gancho' : 'Versão'} ${i + 1}`,
            })),
            // Vídeos mesclados (da aba Mesclar) entram como alvo de música.
            ...(!isHookEdit
              ? (((config.edit as any)?.mergeVersions as string[]) || []).map((url, i) => ({
                  url,
                  label: `Mesclado ${i + 1}`,
                }))
              : []),
          ]}
          tracks={(config.edit?.musicTracks as any[] | undefined) || []}
          onTracksChange={(next) =>
            setConfig((prev: any) => ({
              ...prev,
              edit: { ...prev.edit, musicTracks: next },
            }))
          }
          userId={user?.uid}
          copyText={
            config.copy?.finalScript ||
            config.copy?.optimizedScript ||
            config.copy?.generatedScript ||
            ''
          }
          projectContext={{
            productInfo: config.copy?.productInfo,
            personas: config.copy?.personasWithWeights,
            marketingPlan: config.copy?.marketingPlan,
            creativeBriefs: config.copy?.creativeBriefs,
            // Emoção dominante definida na copy/brief deste subprojeto — guia
            // o "humor" da trilha (ex: esperança ≠ tristeza). Tenta várias
            // fontes: brief ativo → qualquer brief executado deste subprojeto →
            // resposta da persona → 1º brief do plano.
            dominantEmotion: (() => {
              // SÓ deste subprojeto. NUNCA cair no 1º brief do plano — cada
              // subprojeto tem a sua emoção (esperança aqui, outra ali); um
              // fallback genérico daria a emoção errada com cara de certa.
              const c: any = config.copy || {};
              const briefs: any[] = Array.isArray(c.creativeBriefs) ? c.creativeBriefs : [];
              const byActive = c.activeBriefId
                ? briefs.find((x) => x?.id === c.activeBriefId)
                : null;
              return byActive?.emotion || c.answers?.dominantEmotion || c.answers?.emotion || '';
            })(),
          }}
          disabled={isRendering || intercutRendering || headlineRendering}
          onMusicVersionReady={(newUrl) => {
            // Append to BOTH transient zapState (gallery cards) and persisted
            // config.edit.zapVersions / zapHookVersions so it survives reload.
            if (!isHookEdit && !isVslEdit) {
              setZapState((prev) => ({
                ...prev,
                versions: [...(prev.versions || []), newUrl],
              }));
            }
            setConfig((prev: any) => {
              const key = isVslEdit ? 'zapVslVersions' : isHookEdit ? 'zapHookVersions' : 'zapVersions';
              const current = ((prev.edit as any)[key] as string[] | undefined) || [];
              return { ...prev, edit: { ...prev.edit, [key]: [...current, newUrl] } };
            });
          }}
        />
      )}

      {/* Velocidade — seção independente: qualquer vídeo (galeria + mesclados +
          upload) pode ser re-renderizado numa velocidade diferente. */}
      <SpeedSection
        videoOptions={[
          ...activeZapVersions.map((url, i) => ({
            url,
            label: `${isHookEdit ? 'Gancho' : 'Versão'} ${i + 1}`,
          })),
          ...(!isHookEdit
            ? (((config.edit as any)?.mergeVersions as string[]) || []).map((url, i) => ({
                url,
                label: `Mesclado ${i + 1}`,
              }))
            : []),
        ]}
        userId={user?.uid}
        onSpeedVersionReady={(newUrl) => {
          if (!isHookEdit && !isVslEdit) {
            setZapState((prev) => ({ ...prev, versions: [...(prev.versions || []), newUrl] }));
          }
          setConfig((prev: any) => {
            const key = isVslEdit ? 'zapVslVersions' : isHookEdit ? 'zapHookVersions' : 'zapVersions';
            const current = ((prev.edit as any)[key] as string[] | undefined) || [];
            return { ...prev, edit: { ...prev.edit, [key]: [...current, newUrl] } };
          });
        }}
      />

      {/* Juntar 2+ vídeos quaisquer (upload/versões) — ex.: somar clipes pra
          fechar os 30 min de áudio do clone profissional do ElevenLabs. */}
      <VideoJoinPanel
        userId={user?.uid}
        existingOptions={activeZapVersions.map((url, i) => ({
          url,
          label: `${isVslEdit ? 'VSL' : isHookEdit ? 'Gancho' : 'Versão'} ${i + 1}`,
        }))}
      />

      {/* Juntar ÁUDIOS (ex.: voz do gancho + voz do corpo) → mp3 pra Montagem.
          Os áudios já gerados no subprojeto vêm prontos pra escolher. */}
      <AudioJoinPanel
        userId={user?.uid}
        existingAudios={[
          ...(((config.copy as any)?.hookAudios as any[]) || []).map((a, i) => ({
            url: a?.url,
            label: `🎣 Gancho #${i + 1}`,
          })),
          ...(((config as any).audios as any[]) || []).map((a, i) => ({
            url: a?.url,
            label: `🎙 Corpo #${i + 1}`,
          })),
        ].filter((a) => a.url)}
        onJoined={(url) => {
          // Entra nos áudios do CORPO (config.audios) — aparece na Montagem e no
          // seletor de voz do Vídeo IA.
          setConfig((prev: any) => ({
            ...prev,
            audios: [
              ...((prev.audios as any[]) || []),
              { url, storagePath: null, voiceId: 'joined', createdAt: new Date().toISOString() },
            ],
          }));
          toast.success('Áudio adicionado ao projeto — já aparece na Montagem.');
        }}
      />

      {/* JUNTAR Gancho + Corpo — picker livre (escondido se o projeto
          não usa gancho). Defaults para a última versão de cada lado,
          mas qualquer combinação é permitida. */}
      {useHookFlow &&
        hookZapVersions.length > 0 &&
        bodyJoinOptions.length > 0 &&
        (() => {
          const effectiveHookUrl =
            selectedJoinHookUrl && hookZapVersions.includes(selectedJoinHookUrl)
              ? selectedJoinHookUrl
              : hookZapVersions[hookZapVersions.length - 1];
          const effectiveBodyUrl =
            selectedJoinBodyUrl && bodyJoinOptions.some((o) => o.url === selectedJoinBodyUrl)
              ? selectedJoinBodyUrl
              : bodyJoinOptions[bodyJoinOptions.length - 1]?.url;

          return (
            <div className="bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-950/40 dark:to-yellow-950/40 p-8 rounded-[40px] border-4 border-amber-200 dark:border-amber-800/60 shadow-xl space-y-5 mt-8">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-amber-500 rounded-2xl flex items-center justify-center text-white">
                  <Layers size={22} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-gray-900 dark:text-gray-50 uppercase italic">
                    Juntar Gancho + Corpo
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Escolha qualquer versão do gancho e qualquer versão do corpo. O resultado vai
                    pra galeria "Vídeos Completos" abaixo.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Hook picker */}
                <div className="bg-white dark:bg-gray-900/80 p-4 rounded-2xl border-2 border-amber-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-widest">
                      Gancho (1º)
                    </span>
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 font-bold">
                      {hookZapVersions.length} {hookZapVersions.length === 1 ? 'versão' : 'versões'}
                    </span>
                  </div>
                  <select
                    value={effectiveHookUrl}
                    onChange={(e) => setSelectedJoinHookUrl(e.target.value)}
                    className="w-full p-2 border-2 border-gray-200 dark:border-gray-700 rounded-xl text-xs focus:border-amber-500 focus:outline-none"
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
                        getAuthorizedUrl(effectiveHookUrl, platformApiKey || undefined) || undefined
                      }
                      className="w-full h-full object-contain"
                      controls
                      muted
                    />
                    <VideoDurationBadge src={effectiveHookUrl || ''} />
                  </div>
                </div>

                {/* Body picker */}
                <div className="bg-white dark:bg-gray-900/80 p-4 rounded-2xl border-2 border-yellow-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black text-yellow-600 dark:text-yellow-400 uppercase tracking-widest">
                      Corpo (2º)
                    </span>
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 font-bold">
                      {bodyJoinOptions.length} {bodyJoinOptions.length === 1 ? 'opção' : 'opções'}
                    </span>
                  </div>
                  <select
                    value={effectiveBodyUrl}
                    onChange={(e) => setSelectedJoinBodyUrl(e.target.value)}
                    className="w-full p-2 border-2 border-gray-200 dark:border-gray-700 rounded-xl text-xs focus:border-yellow-500 focus:outline-none"
                  >
                    {bodyJoinOptions.map((o, i) => (
                      <option key={o.url} value={o.url}>
                        {o.label}
                        {i === bodyJoinOptions.length - 1 ? ' (mais recente)' : ''}
                      </option>
                    ))}
                  </select>
                  <div className="relative bg-black rounded-xl overflow-hidden aspect-[9/16] max-h-48 mx-auto">
                    <video
                      src={
                        getAuthorizedUrl(effectiveBodyUrl, platformApiKey || undefined) || undefined
                      }
                      className="w-full h-full object-contain"
                      controls
                      muted
                    />
                    <VideoDurationBadge src={effectiveBodyUrl || ''} />
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
                    setConfig((prev: any) => {
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
      {useHookFlow &&
        (() => {
          const joined = (config.edit?.zapJoinedVersions as string[] | undefined) || [];
          if (joined.length === 0) return null;
          return (
            <div className="space-y-4 pt-8">
              <h4 className="text-xl font-black text-gray-900 dark:text-gray-50 uppercase italic flex items-center gap-2">
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
                          setConfig((prev: any) => {
                            const current =
                              ((prev.edit as any).zapJoinedVersions as string[] | undefined) || [];
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
                        className="px-3 py-2 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-100 flex items-center justify-center gap-1"
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

      <IntercutModal
        open={!!intercutSourceUrl}
        rendering={intercutRendering}
        sourceVideoUrl={intercutSourceUrl}
        fontSize={intercutFontSize}
        // F6.8 — mapeia display string ("Português (Brasileiro)") pra
        // ISO 639-1 ('pt') que o AssemblyAI espera. Quando o cliente já
        // setou idioma na PersonaTab, pulamos a language_detection
        // (transcrição ~30-40% mais rápida).
        languageCode={(() => {
          const lang = String(config.copy?.answers?.language || '').toLowerCase();
          if (lang.includes('ingl') || lang === 'english' || lang === 'en') return 'en';
          if (lang.includes('espan') || lang === 'spanish' || lang === 'es') return 'es';
          return 'pt';
        })()}
        onFontSizeChange={setIntercutFontSize}
        onClose={() => setIntercutSourceUrl(null)}
        onRender={handleRenderIntercut}
      />

      <HeadlineModal
        open={!!headlineSourceUrl}
        rendering={headlineRendering}
        sourceDims={headlineSourceDims}
        text={headlineText}
        bgColor={headlineBgColor}
        textColor={headlineTextColor}
        strokeColor={headlineStrokeColor}
        strokeWidth={headlineStrokeWidth}
        hl1={headlineHl1}
        hl2={headlineHl2}
        hl3={headlineHl3}
        bgHl1={headlineBgHl1}
        bgHl2={headlineBgHl2}
        bgHl3={headlineBgHl3}
        wordStyles={headlineWordStyles}
        fontSize={headlineFontSize}
        barHeightPct={headlineBarHeightPct}
        headline2Enabled={headline2Enabled}
        headline2Text={headline2Text}
        headline2BgColor={headline2BgColor}
        headline2WordStyles={headline2WordStyles}
        switchPct={headlineSwitchPct}
        autoTime={headlineAutoTime}
        onTextChange={setHeadlineText}
        onBgColorChange={setHeadlineBgColor}
        onTextColorChange={setHeadlineTextColor}
        onStrokeColorChange={setHeadlineStrokeColor}
        onStrokeWidthChange={setHeadlineStrokeWidth}
        onHl1Change={setHeadlineHl1}
        onHl2Change={setHeadlineHl2}
        onHl3Change={setHeadlineHl3}
        onBgHl1Change={setHeadlineBgHl1}
        onBgHl2Change={setHeadlineBgHl2}
        onBgHl3Change={setHeadlineBgHl3}
        onWordStylesChange={setHeadlineWordStyles}
        onFontSizeChange={setHeadlineFontSize}
        onBarHeightPctChange={setHeadlineBarHeightPct}
        onHeadline2EnabledChange={setHeadline2Enabled}
        onHeadline2TextChange={setHeadline2Text}
        onHeadline2BgColorChange={setHeadline2BgColor}
        onHeadline2WordStylesChange={setHeadline2WordStyles}
        onSwitchPctChange={setHeadlineSwitchPct}
        onAutoTimeChange={setHeadlineAutoTime}
        onClose={() => setHeadlineSourceUrl(null)}
        onRender={handleRenderHeadline}
      />

      {/* Toggle gancho/corpo TAMBÉM no rodapé — pra trocar de lado sem rolar
          até o topo. Mesmo comportamento do de cima. */}
      {useHookFlow && (
        <div className="bg-white dark:bg-gray-900/80 p-2 rounded-2xl border-2 border-gray-200 dark:border-gray-800 shadow-sm flex gap-1">
          <button
            onClick={() => {
              setEditZapMode('body');
              setZapVideoUrl(null);
            }}
            className={`flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
              !isHookEdit
                ? 'bg-yellow-500 text-white shadow-md'
                : 'text-gray-500 dark:text-gray-400 hover:bg-yellow-50 dark:hover:bg-yellow-950/40'
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
                : 'text-gray-500 dark:text-gray-400 hover:bg-amber-50 dark:hover:bg-amber-950/40'
            }`}
          >
            Editar Gancho
            {hookZapVersions.length > 0 && (
              <span className="ml-2 text-[9px] opacity-70">({hookZapVersions.length})</span>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

// F6.13 — Versão de vídeo com detector de URL quebrada. Quando o `<video>`
// dá error de load (URL expirou no CDN, arquivo deletado, etc), substitui
// pelo overlay claro com mensagem + dica de remover. Antes mostrava só
// cinza sem dar pista do que tava errado.
function VersionVideo({
  src,
  crossOrigin,
  onRemove,
  label,
}: {
  src: string | undefined;
  crossOrigin?: 'anonymous';
  onRemove?: () => void;
  label: string;
}) {
  const [broken, setBroken] = useState(false);

  if (broken) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 p-4 text-center gap-3">
        <AlertTriangle size={32} className="text-red-500" />
        <p className="text-xs font-black uppercase tracking-widest">{label}</p>
        <p className="text-[11px] leading-tight opacity-80">
          O link do vídeo expirou ou o arquivo não está mais disponível.
        </p>
        {onRemove && (
          <button
            onClick={onRemove}
            className="px-3 py-2 bg-red-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-red-700 transition-colors"
          >
            Remover desta lista
          </button>
        )}
      </div>
    );
  }

  return (
    <video
      src={src}
      className="w-full h-full object-contain"
      controls
      crossOrigin={crossOrigin}
      onError={() => setBroken(true)}
    />
  );
}
