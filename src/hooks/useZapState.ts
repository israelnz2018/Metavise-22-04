// All state owned by the Edição Zap tab — captions, headline overlay,
// intercut modal, join (hook+body) picker, plus the long-running render
// status object (`zapState`). Lifted out of App.tsx so that:
//
//   1. Extracting EditZapTab becomes feasible — it now takes a single
//      `zap: ZapBundle` prop instead of ~50 individual ones.
//   2. The internal "measure video dimensions for headline preview"
//      effect lives next to the state it serves.
//
// Anything that needs to survive page reloads (zapVersions, hookVersions,
// finalScript) still lives in App.tsx's `config` and gets persisted via
// handleSaveProject — that's intentional. This hook only holds the
// transient editor state.
//
// Usage in App.tsx: `const zap = useZapState();` then destructure as
// needed; the bundle type is exported via `ZapBundle` so child
// components can accept it as one prop.

import { useEffect, useRef, useState } from 'react';

export interface ZapStatusBundle {
  status: 'idle' | 'uploading' | 'rendering' | 'completed' | 'error';
  step: string;
  progress: number;
  videoId?: string;
  taskId?: string;
  finalVideoUrl?: string;
  originalVideoUrl?: string;
  versions: string[];
  videoFormat: '16:9' | '1:1' | '9:16';
}

export function useZapState() {
  // ── ZapCap render state machine + refs ─────────────────────────────
  const [zapState, setZapState] = useState<ZapStatusBundle>({
    status: 'idle',
    step: '',
    progress: 0,
    versions: [],
    videoFormat: '9:16',
  });
  const zapPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isZapRenderingRef = useRef(false);
  // True while we're auto-retrying after a ZapCap failure with b-rolls
  // disabled. Stops us from looping if the retry ALSO fails.
  const zapAutoRetryRef = useRef(false);

  // ── ZapCap render config (mirrors the form) ────────────────────────
  const [zapVideoUrl, setZapVideoUrl] = useState<string | null>(null);
  const [zapTemplateId, setZapTemplateId] = useState<string>('');
  const [zapBrollPercent, setZapBrollPercent] = useState<number>(10);
  // Segundo em que o b-roll começa a atuar no CORPO. 0 = b-roll desde o início
  // (comportamento atual). > 0 = a intro (0→X) sai sem b-roll (só legenda) e o
  // b-roll entra só na parte 2 — o app corta, gera as duas no ZapCap e junta.
  const [zapBrollStartSec, setZapBrollStartSec] = useState<number>(0);
  const [zapEmoji, setZapEmoji] = useState<boolean>(false);
  const [zapAnimation, setZapAnimation] = useState<boolean>(true);
  const [zapEmphasizeKeywords, setZapEmphasizeKeywords] = useState<boolean>(true);
  const [zapSilenceRemoval, setZapSilenceRemoval] = useState<number>(0);
  const [zapLanguage, setZapLanguage] = useState<string>('pt');
  // Estados de personalização da legenda (Edição Zap)
  const [zapVideoFormat, setZapVideoFormat] = useState<
    'auto' | '9:16' | '1:1' | '16:9'
  >('auto');
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

  // ── Tab mode: body vs hook ─────────────────────────────────────────
  // Body versions live in config.edit.zapVersions; hook versions live in
  // config.edit.zapHookVersions. Render callbacks read `editZapModeRef`
  // so they write to the correct slot even if the user toggled away
  // mid-render.
  const [editZapMode, setEditZapMode] = useState<'body' | 'hook' | 'vsl'>('body');
  const editZapModeRef = useRef<'body' | 'hook' | 'vsl'>('body');
  useEffect(() => {
    editZapModeRef.current = editZapMode;
  }, [editZapMode]);

  // ── Join (hook+body) picker ────────────────────────────────────────
  const [joinRendering, setJoinRendering] = useState(false);
  // Empty string = "use the latest of each" (default).
  const [selectedJoinHookUrl, setSelectedJoinHookUrl] = useState<string>('');
  const [selectedJoinBodyUrl, setSelectedJoinBodyUrl] = useState<string>('');

  // ── Headline modal state ───────────────────────────────────────────
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
  // Per-word styling. tc = text color index (0|1|2|3, 0=default),
  // bg = bg highlight index (same). Indexed by word position when text
  // is split on whitespace.
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

  // ── Intercut modal state ───────────────────────────────────────────
  // Alternating avatar / black-screen-with-text cuts.
  // intercutSourceUrl = null means the modal is closed.
  const [intercutSourceUrl, setIntercutSourceUrl] = useState<string | null>(null);
  const [intercutAvatarSec, setIntercutAvatarSec] = useState<number>(15);
  const [intercutBlackSec, setIntercutBlackSec] = useState<number>(20);
  const [intercutFontSize, setIntercutFontSize] = useState<number>(64);
  const [intercutTexts, setIntercutTexts] = useState<string[]>(['', '', '', '']);
  const [intercutRendering, setIntercutRendering] = useState(false);

  return {
    // Render machine
    zapState, setZapState,
    zapPollRef, isZapRenderingRef, zapAutoRetryRef,

    // ZapCap config
    zapVideoUrl, setZapVideoUrl,
    zapTemplateId, setZapTemplateId,
    zapBrollPercent, setZapBrollPercent,
    zapBrollStartSec, setZapBrollStartSec,
    zapEmoji, setZapEmoji,
    zapAnimation, setZapAnimation,
    zapEmphasizeKeywords, setZapEmphasizeKeywords,
    zapSilenceRemoval, setZapSilenceRemoval,
    zapLanguage, setZapLanguage,
    zapVideoFormat, setZapVideoFormat,
    zapSubtitleTop, setZapSubtitleTop,
    zapFontUppercase, setZapFontUppercase,
    zapFontSize, setZapFontSize,
    zapDisplayWords, setZapDisplayWords,
    zapFontColor, setZapFontColor,
    zapStrokeColor, setZapStrokeColor,
    zapUseCustomHighlight, setZapUseCustomHighlight,
    zapHl1, setZapHl1,
    zapHl2, setZapHl2,
    zapHl3, setZapHl3,

    // Tab mode
    editZapMode, setEditZapMode,
    editZapModeRef,

    // Join
    joinRendering, setJoinRendering,
    selectedJoinHookUrl, setSelectedJoinHookUrl,
    selectedJoinBodyUrl, setSelectedJoinBodyUrl,

    // Headline
    headlineSourceUrl, setHeadlineSourceUrl,
    headlineText, setHeadlineText,
    headlineBgColor, setHeadlineBgColor,
    headlineTextColor, setHeadlineTextColor,
    headlineStrokeColor, setHeadlineStrokeColor,
    headlineStrokeWidth, setHeadlineStrokeWidth,
    headlineHl1, setHeadlineHl1,
    headlineHl2, setHeadlineHl2,
    headlineHl3, setHeadlineHl3,
    headlineBgHl1, setHeadlineBgHl1,
    headlineBgHl2, setHeadlineBgHl2,
    headlineBgHl3, setHeadlineBgHl3,
    headlineWordStyles, setHeadlineWordStyles,
    headline2Enabled, setHeadline2Enabled,
    headlineSwitchPct, setHeadlineSwitchPct,
    headlineAutoTime, setHeadlineAutoTime,
    headlineSourceDims, setHeadlineSourceDims,
    headline2Text, setHeadline2Text,
    headline2BgColor, setHeadline2BgColor,
    headline2WordStyles, setHeadline2WordStyles,
    headlineFontSize, setHeadlineFontSize,
    headlineBarHeightPct, setHeadlineBarHeightPct,
    headlineRendering, setHeadlineRendering,

    // Intercut
    intercutSourceUrl, setIntercutSourceUrl,
    intercutAvatarSec, setIntercutAvatarSec,
    intercutBlackSec, setIntercutBlackSec,
    intercutFontSize, setIntercutFontSize,
    intercutTexts, setIntercutTexts,
    intercutRendering, setIntercutRendering,
  };
}

export type ZapBundle = ReturnType<typeof useZapState>;
