import { useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
  ChevronDown,
  ChevronUp,
  Library,
  Loader2,
  Music,
  Save,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import type { MusicTrack } from '@/types/project';
import {
  loadMusicLibrary,
  addToMusicLibrary,
  deleteFromMusicLibrary,
} from '@/lib/musicLibrary';

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `${diffMin}min atrás`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h atrás`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d atrás`;
  return d.toLocaleDateString('pt-BR');
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

// F7.2 — Background music section for EditZapTab.
//
// Sits between "Galeria de Versões" and "Juntar Gancho + Corpo".
// User flow:
//   1. Picks a target video from the gallery (dropdown).
//   2. Picks music source:
//      a. Upload MP3 (file picker → POST /api/elevenlabs/upload-music)
//      b. Generate with AI (prompt → POST /api/elevenlabs/music/generate)
//   3. Adjusts volume + fade sliders.
//   4. Hits "Gerar versão com música" → POST /api/video/add-music.
//   5. Returned URL gets appended as a new gallery version by the parent.

interface VideoOption {
  url: string;
  label: string;
}

interface Props {
  /** Whole gallery (body or hook, depending on the active tab). */
  videoOptions: VideoOption[];
  /** Called when a new music-mixed version is ready. Parent appends it. */
  onMusicVersionReady: (url: string) => void;
  /** Músicas DESTE subprojeto (persistidas em config.edit.musicTracks). */
  tracks: MusicTrack[];
  /** Persiste a lista de músicas do subprojeto (gerar/enviar/apagar). */
  onTracksChange: (tracks: MusicTrack[]) => void;
  /** Disable everything while another render is in flight. */
  disabled?: boolean;
  /** User id for Firebase Storage scoping. */
  userId: string | undefined;
  /** Copy/roteiro aprovado — alimenta o "arco emocional" da trilha. */
  copyText?: string;
  /** Contexto do projeto (oferta, personas, plano) pra recomendação da IA. */
  projectContext?: {
    productInfo?: any;
    personas?: any[] | null;
    marketingPlan?: any;
    creativeBriefs?: any[] | null;
    dominantEmotion?: string;
  };
}

// Uma seção do arco emocional (espelha o composition_plan do ElevenLabs).
interface MusicArcSection {
  sectionName: string;
  positiveLocalStyles: string[];
  negativeLocalStyles: string[];
  durationMs: number;
}
interface MusicArcPlan {
  positiveGlobalStyles: string[];
  negativeGlobalStyles: string[];
  sections: MusicArcSection[];
}

// Presets de estilo/gênero (label PT + token EN pro gerador).
const STYLE_OPTIONS = [
  { id: 'cinematic', label: 'Cinematográfico', en: 'cinematic' },
  { id: 'corporate', label: 'Corporativo', en: 'corporate, clean' },
  { id: 'lofi', label: 'Lo-fi', en: 'lo-fi, chill' },
  { id: 'epic', label: 'Épico', en: 'epic, orchestral' },
  { id: 'acoustic', label: 'Acústico', en: 'acoustic, organic' },
  { id: 'electronic', label: 'Eletrônico', en: 'electronic' },
  { id: 'pop', label: 'Pop', en: 'modern pop' },
];
const ENERGY_OPTIONS = [
  { id: 'baixa', label: 'Baixa', en: 'low energy' },
  { id: 'media', label: 'Média', en: 'medium energy' },
  { id: 'alta', label: 'Alta', en: 'high energy' },
];
const TEMPO_OPTIONS = [
  { id: 'calmo', label: 'Calmo', en: 'slow tempo' },
  { id: 'medio', label: 'Médio', en: 'mid tempo' },
  { id: 'acelerado', label: 'Acelerado', en: 'fast tempo' },
];
const INSTRUMENT_OPTIONS = [
  { id: 'piano', label: 'Piano', en: 'piano' },
  { id: 'violin', label: 'Violino', en: 'solo violin' },
  { id: 'strings', label: 'Cordas', en: 'strings' },
  { id: 'guitar', label: 'Violão', en: 'acoustic guitar' },
  { id: 'drums', label: 'Bateria', en: 'drums' },
  { id: 'synth', label: 'Sintetizadores', en: 'synths' },
  { id: 'perc', label: 'Percussão', en: 'percussion' },
];

export function MusicSection({
  videoOptions,
  onMusicVersionReady,
  tracks,
  onTracksChange,
  disabled,
  userId,
  copyText,
  projectContext,
}: Props) {
  // Target video — defaults to the most recent.
  const defaultTarget = videoOptions[videoOptions.length - 1]?.url || '';
  const [targetUrl, setTargetUrl] = useState<string>(defaultTarget);
  const [source, setSource] = useState<'upload' | 'ai'>('upload');
  const [musicUrl, setMusicUrl] = useState<string | null>(null);
  const [musicLabel, setMusicLabel] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [mixing, setMixing] = useState(false);

  // AI generation controls
  const [prompt, setPrompt] = useState<string>('');
  const [lengthSec, setLengthSec] = useState<number>(30);

  // Novos controles de geração com IA
  const [styleId, setStyleId] = useState<string>('cinematic');
  const [energyId, setEnergyId] = useState<string>('media');
  const [tempoId, setTempoId] = useState<string>('medio');
  const [instrumentIds, setInstrumentIds] = useState<string[]>([]);
  // Recomendação personalizada da IA (estilo/energia/ritmo/instrumentos)
  const [recommending, setRecommending] = useState(false);
  const [recReason, setRecReason] = useState<string>('');
  // Arco emocional (a música acompanha a copy)
  const [useArc, setUseArc] = useState<boolean>(true);
  const [arcPlan, setArcPlan] = useState<MusicArcPlan | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  // Duração: sincronizar com o vídeo (default) ou manual.
  const [syncDuration, setSyncDuration] = useState<boolean>(true);
  const [videoDurationSec, setVideoDurationSec] = useState<number | null>(null);

  // Mix controls
  // Volume como PERCEPÇÃO (0–100). O valor real enviado ao ffmpeg segue uma
  // curva quadrática — volume é percebido de forma logarítmica, então uma
  // escala linear faz tudo acima de ~20% estourar. Com a curva, 50% ≈ o
  // volume ideal de trilha de fundo e abaixo disso fica realmente sutil.
  const [volumePct, setVolumePct] = useState<number>(50);
  const realVolume = Number(((volumePct / 100) ** 2 * 0.4).toFixed(3));
  const [fadeInSec, setFadeInSec] = useState<number>(1);
  const [fadeOutSec, setFadeOutSec] = useState<number>(8);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const isBusy = uploading || generating || mixing || !!disabled;

  // Biblioteca GLOBAL (cross-projeto) — só as músicas que o user salvou.
  // Vem do Firestore users/{uid}/musicLibrary. As músicas do subprojeto
  // (independentes) vêm via prop `tracks`.
  const [libraryTracks, setLibraryTracks] = useState<MusicTrack[]>([]);
  const [loadingLib, setLoadingLib] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function loadLibrary() {
    if (!userId) return;
    setLoadingLib(true);
    try {
      setLibraryTracks(await loadMusicLibrary(userId));
    } catch (err: any) {
      // Falha silenciosa — biblioteca é conveniência, não bloqueia o fluxo.
      console.warn('[MusicSection] failed to load library:', err.message);
    } finally {
      setLoadingLib(false);
    }
  }

  // URLs já presentes na biblioteca global — pra mostrar "✓ na biblioteca".
  const libraryUrls = new Set(libraryTracks.map((t) => t.url));

  // Cria um MusicTrack e o adiciona às músicas DESTE subprojeto (no topo),
  // já selecionando-o para a mixagem.
  function addTrack(input: Omit<MusicTrack, 'id' | 'createdAt'>): MusicTrack {
    const track: MusicTrack = {
      ...input,
      id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
    };
    onTracksChange([track, ...tracks]);
    setMusicUrl(track.url);
    setMusicLabel(track.label);
    return track;
  }

  useEffect(() => {
    loadLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Descobre a duração do vídeo-alvo (pra sincronizar a música). Carrega só
  // os metadados via um <video> oculto — sem baixar o arquivo inteiro.
  useEffect(() => {
    if (!targetUrl) {
      setVideoDurationSec(null);
      return;
    }
    let cancelled = false;
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      if (!cancelled && isFinite(v.duration) && v.duration > 0) {
        setVideoDurationSec(Math.round(v.duration));
      }
    };
    v.onerror = () => {
      if (!cancelled) setVideoDurationSec(null);
    };
    v.src = targetUrl;
    return () => {
      cancelled = true;
      v.src = '';
    };
  }, [targetUrl]);

  // Duração efetiva: sincronizada com o vídeo OU manual (slider).
  const effectiveLengthSec =
    syncDuration && videoDurationSec ? videoDurationSec : lengthSec;

  // Monta o prompt simples (modo sem arco) a partir dos controles + texto livre.
  const buildSimplePrompt = (): string => {
    const style = STYLE_OPTIONS.find((s) => s.id === styleId)?.en;
    const energy = ENERGY_OPTIONS.find((e) => e.id === energyId)?.en;
    const tempo = TEMPO_OPTIONS.find((t) => t.id === tempoId)?.en;
    const instr = instrumentIds
      .map((id) => INSTRUMENT_OPTIONS.find((o) => o.id === id)?.en)
      .filter(Boolean);
    const parts = [
      'instrumental, no vocals',
      style,
      energy,
      tempo,
      instr.length ? `featuring ${instr.join(', ')}` : '',
      prompt.trim(),
    ].filter(Boolean);
    return parts.join(', ');
  };

  const toggleInstrument = (id: string) => {
    setInstrumentIds((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    );
  };

  // ─── Recomendação personalizada: IA escolhe os controles pelo projeto ─
  const canRecommend =
    !!copyText ||
    !!projectContext?.productInfo ||
    (projectContext?.personas?.length || 0) > 0;

  const handleRecommend = async () => {
    setRecommending(true);
    try {
      const res = await fetch('/api/elevenlabs/music/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          copy: copyText,
          productInfo: projectContext?.productInfo,
          personas: projectContext?.personas,
          marketingPlan: projectContext?.marketingPlan,
          creativeBriefs: projectContext?.creativeBriefs,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.styleId) setStyleId(data.styleId);
      if (data.energyId) setEnergyId(data.energyId);
      if (data.tempoId) setTempoId(data.tempoId);
      if (Array.isArray(data.instrumentIds)) setInstrumentIds(data.instrumentIds);
      setRecReason(data.reasoning || '');
      toast.success('Recomendação aplicada! Ajuste se quiser.');
    } catch (err: any) {
      toast.error(`Falha ao recomendar: ${err.message}`, { duration: 8000 });
    } finally {
      setRecommending(false);
    }
  };

  // ─── Arco emocional: lê a copy e propõe seções (editáveis) ─────────
  const handleAnalyzeCopy = async () => {
    if (!copyText || copyText.trim().length < 20) {
      toast.error('Sem copy aprovada pra analisar. Gere a copy do anúncio antes.');
      return;
    }
    setAnalyzing(true);
    try {
      const res = await fetch('/api/elevenlabs/music/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          copy: copyText,
          totalDurationSec: effectiveLengthSec,
          dominantEmotion: projectContext?.dominantEmotion || '',
          productInfo: projectContext?.productInfo,
          style: STYLE_OPTIONS.find((s) => s.id === styleId)?.label,
          energy: ENERGY_OPTIONS.find((e) => e.id === energyId)?.label,
          tempo: TEMPO_OPTIONS.find((t) => t.id === tempoId)?.label,
          instruments: instrumentIds.map(
            (id) => INSTRUMENT_OPTIONS.find((o) => o.id === id)?.label
          ),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setArcPlan({
        positiveGlobalStyles: data.positiveGlobalStyles || [],
        negativeGlobalStyles: data.negativeGlobalStyles || [],
        sections: data.sections || [],
      });
      toast.success('Arco proposto! Revise as seções antes de gerar.');
    } catch (err: any) {
      toast.error(`Falha ao analisar: ${err.message}`, { duration: 8000 });
    } finally {
      setAnalyzing(false);
    }
  };

  // Edita uma seção do arco (nome, estilos ou duração).
  const updateArcSection = (idx: number, patch: Partial<MusicArcSection>) => {
    setArcPlan((cur) => {
      if (!cur) return cur;
      const sections = cur.sections.map((s, i) => (i === idx ? { ...s, ...patch } : s));
      return { ...cur, sections };
    });
  };
  const removeArcSection = (idx: number) => {
    setArcPlan((cur) => {
      if (!cur || cur.sections.length <= 2) return cur;
      return { ...cur, sections: cur.sections.filter((_, i) => i !== idx) };
    });
  };

  // Seleciona uma track (do subprojeto ou da biblioteca) pra mixagem.
  function useTrack(track: MusicTrack) {
    setMusicUrl(track.url);
    setMusicLabel(track.label);
    toast.success('Música selecionada pra mixagem.');
  }

  // Salva uma música do subprojeto na biblioteca GLOBAL (opt-in).
  async function saveTrackToLibrary(track: MusicTrack) {
    if (!userId) {
      toast.error('Login expirado. Recarregue a página.');
      return;
    }
    if (libraryUrls.has(track.url)) {
      toast('Essa música já está na biblioteca.');
      return;
    }
    setSavingId(track.id);
    try {
      await addToMusicLibrary(userId, track);
      await loadLibrary();
      toast.success('Música salva na biblioteca — disponível em todos os projetos.');
    } catch (err: any) {
      toast.error(`Erro ao salvar: ${err.message}`);
    } finally {
      setSavingId(null);
    }
  }

  // Remove uma música DESTE subprojeto (só a referência; o arquivo e a
  // cópia na biblioteca global, se houver, permanecem).
  function deleteSubprojectTrack(track: MusicTrack) {
    if (!confirm(`Remover "${track.label}" deste subprojeto?`)) return;
    onTracksChange(tracks.filter((t) => t.id !== track.id));
    if (musicUrl === track.url) {
      setMusicUrl(null);
      setMusicLabel('');
    }
    toast.success('Música removida do subprojeto.');
  }

  // Remove uma música da biblioteca global (não afeta os subprojetos).
  async function deleteLibraryTrack(track: MusicTrack) {
    if (!userId) return;
    if (!confirm(`Remover "${track.label}" da biblioteca? (não afeta os subprojetos)`)) return;
    try {
      await deleteFromMusicLibrary(userId, track.id);
      setLibraryTracks((cur) => cur.filter((t) => t.id !== track.id));
      toast.success('Música removida da biblioteca.');
    } catch (err: any) {
      toast.error(`Erro ao apagar: ${err.message}`);
    }
  }

  // If videoOptions shrinks (deleted version) and our target is gone,
  // fall back to whatever is left.
  if (targetUrl && !videoOptions.some((v) => v.url === targetUrl)) {
    setTargetUrl(defaultTarget);
  }

  // ─── Upload local MP3 ──────────────────────────────────────────────
  const handleFileSelected = async (file: File) => {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      toast.error('Música muito grande (>25MB). Comprime ela primeiro.');
      return;
    }
    setUploading(true);
    try {
      // Base64 path — matches the existing /upload-ready-audio pattern.
      const arrayBuffer = await file.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((s, b) => s + String.fromCharCode(b), '')
      );
      const res = await fetch('/api/elevenlabs/upload-music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileBase64: base64, fileName: file.name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      // Entra na lista de músicas DESTE subprojeto (e já fica selecionada).
      addTrack({
        url: data.audioUrl,
        label: file.name,
        source: 'upload',
        originalFileName: file.name,
        sizeBytes: typeof data.sizeBytes === 'number' ? data.sizeBytes : undefined,
      });
      toast.success('Música carregada.');
    } catch (err: any) {
      toast.error(`Falha no upload: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  // ─── AI generation via ElevenLabs Music ────────────────────────────
  const handleGenerateAI = async () => {
    const usingArc = useArc && !!arcPlan && arcPlan.sections.length > 0;
    if (!usingArc && !buildSimplePrompt().replace(/instrumental, no vocals,?/, '').trim()) {
      toast.error('Escolha estilo/instrumentos ou descreva a música.');
      return;
    }
    // No modo arco, a duração é a soma das seções; no simples, a efetiva.
    const body: Record<string, any> = usingArc
      ? { compositionPlan: arcPlan, forceInstrumental: true }
      : {
          prompt: buildSimplePrompt(),
          lengthMs: effectiveLengthSec * 1000,
          forceInstrumental: true,
        };
    setGenerating(true);
    try {
      const res = await fetch('/api/elevenlabs/music/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        // F7.3 — friendly message for the most common ElevenLabs error:
        // API key without `music_generation` scope (default for free tier).
        const raw = String(data.error || `HTTP ${res.status}`);
        if (raw.includes('missing_permissions') || raw.includes('music_generation')) {
          throw new Error(
            'Sua API key do ElevenLabs não tem permissão pra gerar música. ' +
              'Habilite em elevenlabs.io/app/settings/api-keys (pode exigir plano Starter+). ' +
              'Por enquanto, use a opção Upload com um MP3 royalty-free.'
          );
        }
        throw new Error(raw);
      }
      const label = usingArc
        ? `IA (arco): ${arcPlan!.sections.map((s) => s.sectionName).join(' → ')}`
        : `IA: "${buildSimplePrompt().substring(0, 40)}${buildSimplePrompt().length > 40 ? '…' : ''}"`;
      // Entra na lista de músicas DESTE subprojeto (e já fica selecionada).
      addTrack({
        url: data.audioUrl,
        label,
        source: 'ai',
        prompt: usingArc ? undefined : buildSimplePrompt(),
        lengthMs: usingArc
          ? arcPlan!.sections.reduce((s, x) => s + (x.durationMs || 0), 0)
          : effectiveLengthSec * 1000,
        sizeBytes: typeof data.sizeBytes === 'number' ? data.sizeBytes : undefined,
      });
      toast.success('Música gerada pela IA!');
    } catch (err: any) {
      toast.error(`Falha ao gerar: ${err.message}`, { duration: 10_000 });
    } finally {
      setGenerating(false);
    }
  };

  // ─── Mix music into the target video ───────────────────────────────
  const handleMix = async () => {
    if (!targetUrl) {
      toast.error('Selecione um vídeo da galeria.');
      return;
    }
    if (!musicUrl) {
      toast.error('Carregue ou gere uma música primeiro.');
      return;
    }
    if (!userId) {
      toast.error('Login expirado. Recarregue a página.');
      return;
    }
    setMixing(true);
    const toastId = 'mix-music';
    toast.loading('Mixando música no vídeo...', { id: toastId, duration: 60_000 });
    try {
      const res = await fetch('/api/video/add-music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: targetUrl,
          musicUrl,
          userId,
          volume: realVolume,
          fadeInSec,
          fadeOutSec,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      onMusicVersionReady(data.url);
      toast.success('Vídeo com música pronto na galeria!', { id: toastId, duration: 5000 });
      // Reset music selection so user can do another mix without confusion.
      setMusicUrl(null);
      setMusicLabel('');
    } catch (err: any) {
      toast.error(`Erro ao mixar: ${err.message}`, { id: toastId });
    } finally {
      setMixing(false);
    }
  };

  // Card de uma música. `scope` muda os botões: no subprojeto dá pra salvar
  // na biblioteca e remover do subprojeto; na biblioteca só usar e remover.
  function renderTrack(track: MusicTrack, scope: 'subproject' | 'library') {
    const isSelected = musicUrl === track.url;
    const inLibrary = libraryUrls.has(track.url);
    return (
      <li
        key={track.id}
        className={`p-3 rounded-xl border transition-all ${
          isSelected
            ? 'bg-purple-50 dark:bg-purple-950/40 border-purple-400 dark:border-purple-600'
            : 'bg-gray-50 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700 hover:border-purple-300 dark:hover:border-purple-700'
        }`}
      >
        <div className="flex items-start gap-2">
          <div
            className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center ${
              track.source === 'ai'
                ? 'bg-gradient-to-br from-purple-500 to-pink-500 text-white'
                : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
            }`}
            title={track.source === 'ai' ? 'Gerada por IA' : 'Upload'}
          >
            {track.source === 'ai' ? <Sparkles size={14} /> : <Upload size={14} />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-gray-900 dark:text-gray-100 truncate" title={track.label}>
              {track.label}
            </p>
            <p className="text-[10px] text-gray-500 dark:text-gray-400">
              {track.createdAt ? formatRelativeDate(track.createdAt) : ''}
              {track.sizeBytes ? ` · ${formatBytes(track.sizeBytes)}` : ''}
              {scope === 'subproject' && inLibrary ? ' · ✓ na biblioteca' : ''}
            </p>
            <audio src={track.url} controls className="w-full mt-1.5 h-7" />
          </div>
        </div>
        <div className="flex gap-2 mt-2">
          <button
            type="button"
            onClick={() => useTrack(track)}
            disabled={isBusy}
            className={`flex-1 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
              isSelected
                ? 'bg-purple-200 dark:bg-purple-800 text-purple-900 dark:text-purple-100 cursor-default'
                : 'bg-purple-600 text-white hover:bg-purple-700'
            }`}
          >
            {isSelected ? '✓ Selecionada' : 'Usar esta'}
          </button>
          {scope === 'subproject' && (
            <button
              type="button"
              onClick={() => saveTrackToLibrary(track)}
              disabled={isBusy || inLibrary || savingId === track.id}
              title={inLibrary ? 'Já está na biblioteca' : 'Salvar na biblioteca (todos os projetos)'}
              className={`px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                inLibrary
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/40'
              }`}
            >
              {savingId === track.id ? (
                <Loader2 className="animate-spin" size={13} />
              ) : (
                <Save size={13} />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              scope === 'subproject' ? deleteSubprojectTrack(track) : deleteLibraryTrack(track)
            }
            disabled={isBusy}
            title={scope === 'subproject' ? 'Remover do subprojeto' : 'Remover da biblioteca'}
            className="px-3 py-1.5 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </li>
    );
  }

  if (videoOptions.length === 0) return null;

  return (
    <div className="bg-white dark:bg-gray-900/80 p-6 md:p-8 rounded-[32px] border-2 border-gray-200 dark:border-gray-800 shadow-sm space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white">
          <Music size={20} />
        </div>
        <div>
          <h4 className="text-lg font-black text-gray-900 dark:text-gray-50">
            Música de Fundo (opcional)
          </h4>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Adiciona trilha por trás do voiceover. Volume ~50% deixa a voz clara.
          </p>
        </div>
      </div>

      {/* Step 1 — pick target video */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300">
          Vídeo alvo
        </label>
        <select
          value={targetUrl}
          onChange={(e) => setTargetUrl(e.target.value)}
          disabled={isBusy}
          className="w-full p-3 bg-gray-50 dark:bg-gray-800/60 ring-1 ring-gray-200/60 dark:ring-gray-700/60 rounded-xl text-sm focus:ring-2 focus:ring-purple-500 outline-none dark:text-gray-100"
        >
          {videoOptions.map((v) => (
            <option key={v.url} value={v.url}>
              {v.label}
            </option>
          ))}
        </select>
      </div>

      {/* Músicas DESTE subprojeto — geradas/enviadas aqui, independentes de
          outros subprojetos/projetos. Ficam salvas mesmo se você usar outra. */}
      {tracks.length > 0 && (
        <div className="rounded-2xl border-2 border-purple-100 dark:border-purple-900/50 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-purple-50/60 dark:bg-purple-950/30 text-[11px] font-black uppercase tracking-widest text-purple-700 dark:text-purple-300">
            <Music size={14} />
            Músicas deste subprojeto
            <span className="ml-1 px-2 py-0.5 rounded-full bg-purple-200 dark:bg-purple-800 text-purple-900 dark:text-purple-100 text-[10px]">
              {tracks.length}
            </span>
          </div>
          <div className="p-3 bg-white dark:bg-gray-900/40 max-h-72 overflow-y-auto">
            <ul className="space-y-2">{tracks.map((t) => renderTrack(t, 'subproject'))}</ul>
          </div>
        </div>
      )}

      {/* Biblioteca GLOBAL — só as músicas que você salvou. Acessível em
          qualquer projeto/subprojeto. É a ferramenta de escolha. */}
      <div className="rounded-2xl border-2 border-purple-100 dark:border-purple-900/50 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowLibrary((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 bg-purple-50/60 dark:bg-purple-950/30 hover:bg-purple-50 dark:hover:bg-purple-950/50 transition-colors"
        >
          <span className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-purple-700 dark:text-purple-300">
            <Library size={14} />
            Biblioteca de Músicas (todos os projetos)
            <span className="ml-1 px-2 py-0.5 rounded-full bg-purple-200 dark:bg-purple-800 text-purple-900 dark:text-purple-100 text-[10px]">
              {loadingLib ? '…' : libraryTracks.length}
            </span>
          </span>
          {showLibrary ? (
            <ChevronUp size={16} className="text-purple-700 dark:text-purple-300" />
          ) : (
            <ChevronDown size={16} className="text-purple-700 dark:text-purple-300" />
          )}
        </button>
        {showLibrary && (
          <div className="p-3 bg-white dark:bg-gray-900/40 max-h-72 overflow-y-auto">
            {loadingLib && libraryTracks.length === 0 ? (
              <div className="flex items-center justify-center py-6 text-purple-600 dark:text-purple-400 text-xs gap-2">
                <Loader2 className="animate-spin" size={14} />
                Carregando...
              </div>
            ) : libraryTracks.length === 0 ? (
              <p className="text-center text-xs text-gray-500 dark:text-gray-400 py-4">
                Sua biblioteca está vazia. Salve uma música (ícone <Save size={11} className="inline" />)
                pra reusá-la em qualquer projeto.
              </p>
            ) : (
              <ul className="space-y-2">{libraryTracks.map((t) => renderTrack(t, 'library'))}</ul>
            )}
          </div>
        )}
      </div>

      {/* Step 2 — pick source */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setSource('upload')}
          disabled={isBusy}
          className={`flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
            source === 'upload'
              ? 'bg-purple-600 text-white shadow-md'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200'
          }`}
        >
          <Upload size={14} />
          Upload MP3
        </button>
        <button
          type="button"
          onClick={() => setSource('ai')}
          disabled={isBusy}
          className={`flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
            source === 'ai'
              ? 'bg-purple-600 text-white shadow-md'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200'
          }`}
        >
          <Sparkles size={14} />
          Gerar com IA
        </button>
      </div>

      {/* Source-specific UI */}
      {source === 'upload' && (
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/mpeg,audio/mp3,audio/wav,audio/aac,audio/m4a"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFileSelected(e.target.files[0])}
            disabled={isBusy}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isBusy}
            className="w-full p-6 border-2 border-dashed border-purple-300 dark:border-purple-800/60 rounded-2xl text-purple-700 dark:text-purple-300 hover:border-purple-500 hover:bg-purple-50 dark:hover:bg-purple-950/30 transition-all flex flex-col items-center gap-2 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="animate-spin" size={24} /> : <Upload size={24} />}
            <span className="text-xs font-black uppercase tracking-widest">
              {uploading ? 'Enviando...' : 'Clique pra escolher MP3'}
            </span>
            <span className="text-[10px] opacity-70">max 25MB · mp3/wav/aac/m4a</span>
          </button>
        </div>
      )}

      {source === 'ai' && (
        <div className="space-y-4 p-4 bg-purple-50/60 dark:bg-purple-950/30 rounded-2xl ring-1 ring-purple-200/60 dark:ring-purple-800/40">
          {/* Recomendação personalizada — IA escolhe tudo pelo projeto */}
          <div className="rounded-2xl bg-gradient-to-br from-purple-100 to-pink-100 dark:from-purple-900/40 dark:to-pink-900/30 p-3 ring-1 ring-purple-200/60 dark:ring-purple-800/40 space-y-2">
            <button
              type="button"
              onClick={handleRecommend}
              disabled={isBusy || recommending || !canRecommend}
              className="w-full py-2.5 bg-gradient-to-br from-purple-600 to-pink-600 text-white rounded-xl text-[11px] font-black uppercase tracking-widest hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {recommending ? (
                <>
                  <Loader2 className="animate-spin" size={14} />
                  Analisando o projeto...
                </>
              ) : (
                <>
                  <Sparkles size={14} />
                  Recomendar trilha pra este projeto
                </>
              )}
            </button>
            <p className="text-[10px] text-purple-700/80 dark:text-purple-300/70 leading-snug">
              A IA escolhe estilo, energia, ritmo e instrumentos com base na sua oferta, persona,
              copy e plano. Você ajusta depois se quiser.
            </p>
            {recReason && (
              <p className="text-[11px] text-purple-900 dark:text-purple-200 bg-white/60 dark:bg-gray-900/40 rounded-lg p-2 leading-snug">
                💡 {recReason}
              </p>
            )}
            {!canRecommend && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400">
                Gere a copy/personas do projeto pra liberar a recomendação.
              </p>
            )}
          </div>

          {/* Estilo / gênero */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase tracking-widest text-purple-700 dark:text-purple-300">
              Estilo
            </label>
            <div className="flex flex-wrap gap-1.5">
              {STYLE_OPTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStyleId(s.id)}
                  disabled={isBusy}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                    styleId === s.id
                      ? 'bg-purple-600 text-white shadow-sm'
                      : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-purple-100 dark:hover:bg-purple-900/40'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Energia + Ritmo */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-black uppercase tracking-widest text-purple-700 dark:text-purple-300">
                Energia
              </label>
              <div className="flex gap-1.5">
                {ENERGY_OPTIONS.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setEnergyId(e.id)}
                    disabled={isBusy}
                    className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                      energyId === e.id
                        ? 'bg-purple-600 text-white'
                        : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-purple-100 dark:hover:bg-purple-900/40'
                    }`}
                  >
                    {e.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-black uppercase tracking-widest text-purple-700 dark:text-purple-300">
                Ritmo
              </label>
              <div className="flex gap-1.5">
                {TEMPO_OPTIONS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTempoId(t.id)}
                    disabled={isBusy}
                    className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                      tempoId === t.id
                        ? 'bg-purple-600 text-white'
                        : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-purple-100 dark:hover:bg-purple-900/40'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Instrumentos em destaque */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase tracking-widest text-purple-700 dark:text-purple-300">
              Instrumentos em destaque
            </label>
            <div className="flex flex-wrap gap-1.5">
              {INSTRUMENT_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => toggleInstrument(o.id)}
                  disabled={isBusy}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                    instrumentIds.includes(o.id)
                      ? 'bg-purple-600 text-white shadow-sm'
                      : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-purple-100 dark:hover:bg-purple-900/40'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* Texto livre (opcional, refina) */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase tracking-widest text-purple-700 dark:text-purple-300">
              Detalhes extras (opcional)
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="ex: clima esperançoso, build crescente no final"
              rows={2}
              disabled={isBusy}
              className="w-full p-3 bg-white dark:bg-gray-900 ring-1 ring-purple-200/60 dark:ring-purple-800/40 rounded-xl text-sm focus:ring-2 focus:ring-purple-500 outline-none resize-none dark:text-gray-100"
            />
          </div>

          {/* Duração — sincronizada com o vídeo OU manual */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-black uppercase tracking-widest text-purple-700 dark:text-purple-300">
                Duração
              </label>
              <label className="flex items-center gap-1.5 text-[11px] font-bold text-purple-700 dark:text-purple-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={syncDuration}
                  onChange={(e) => setSyncDuration(e.target.checked)}
                  disabled={isBusy || !videoDurationSec}
                  className="accent-purple-600"
                />
                Sincronizar com o vídeo
                {videoDurationSec ? ` (${videoDurationSec}s)` : ' (indisponível)'}
              </label>
            </div>
            {!syncDuration || !videoDurationSec ? (
              <>
                <div className="text-[11px] text-gray-600 dark:text-gray-400">
                  {effectiveLengthSec}s
                </div>
                <input
                  type="range"
                  min={3}
                  max={120}
                  value={lengthSec}
                  onChange={(e) => setLengthSec(parseInt(e.target.value))}
                  disabled={isBusy}
                  className="w-full accent-purple-600"
                />
                <p className="text-[10px] text-purple-600/80 dark:text-purple-300/70">
                  Mais longo = mais créditos ElevenLabs.
                </p>
              </>
            ) : (
              <p className="text-[11px] text-gray-600 dark:text-gray-400">
                A música nasce com {videoDurationSec}s, exatamente o tamanho do vídeo selecionado.
              </p>
            )}
          </div>

          {/* Arco emocional (a música acompanha a copy) */}
          <div className="rounded-2xl border-2 border-purple-200 dark:border-purple-800/50 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 bg-purple-100/70 dark:bg-purple-900/30">
              <label className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-purple-800 dark:text-purple-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useArc}
                  onChange={(e) => setUseArc(e.target.checked)}
                  disabled={isBusy}
                  className="accent-purple-600"
                />
                <Wand2 size={14} />
                Arco emocional (segue a copy)
              </label>
            </div>
            {useArc && (
              <div className="p-3 bg-white dark:bg-gray-900/40 space-y-3">
                <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
                  A IA lê a copy do anúncio e propõe uma trilha que segue o arco
                  emocional. Você revisa antes de gerar.
                </p>
                {/* A trilha é baseada 100% na copy/texto falado — sem emoção-base. */}
                <p className="text-[11px] font-bold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/40 rounded-lg px-3 py-2">
                  🎵 A trilha é montada lendo a <strong>copy/texto falado</strong> — cada parte da
                  música reflete a parte da copy (dor → virada → esperança → CTA), sem tom-base fixo.
                </p>
                <button
                  type="button"
                  onClick={handleAnalyzeCopy}
                  disabled={isBusy || analyzing || !copyText}
                  className="w-full py-2.5 bg-white dark:bg-gray-800 border-2 border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300 rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-purple-50 dark:hover:bg-purple-950/40 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {analyzing ? (
                    <>
                      <Loader2 className="animate-spin" size={14} />
                      Analisando copy...
                    </>
                  ) : (
                    <>
                      <Wand2 size={14} />
                      {arcPlan ? 'Refazer análise da copy' : 'Analisar copy e propor trilha'}
                    </>
                  )}
                </button>
                {!copyText && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400">
                    Gere a copy do anúncio primeiro pra usar o arco emocional.
                  </p>
                )}

                {/* Seções editáveis */}
                {arcPlan && arcPlan.sections.length > 0 && (
                  <div className="space-y-2">
                    {arcPlan.sections.map((sec, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-xl bg-purple-50/70 dark:bg-purple-950/30 ring-1 ring-purple-200/60 dark:ring-purple-800/40 space-y-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="shrink-0 w-5 h-5 rounded-full bg-purple-600 text-white text-[10px] font-black flex items-center justify-center">
                            {idx + 1}
                          </span>
                          <input
                            value={sec.sectionName}
                            onChange={(e) => updateArcSection(idx, { sectionName: e.target.value })}
                            disabled={isBusy}
                            className="flex-1 px-2 py-1 bg-white dark:bg-gray-900 rounded-lg text-xs font-bold dark:text-gray-100 ring-1 ring-purple-200/60 dark:ring-purple-800/40 focus:ring-2 focus:ring-purple-500 outline-none"
                          />
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min={3}
                              max={120}
                              value={Math.round(sec.durationMs / 1000)}
                              onChange={(e) =>
                                updateArcSection(idx, {
                                  durationMs:
                                    Math.max(3, Math.min(120, parseInt(e.target.value) || 3)) * 1000,
                                })
                              }
                              disabled={isBusy}
                              className="w-14 px-2 py-1 bg-white dark:bg-gray-900 rounded-lg text-xs text-center dark:text-gray-100 ring-1 ring-purple-200/60 dark:ring-purple-800/40 focus:ring-2 focus:ring-purple-500 outline-none"
                            />
                            <span className="text-[10px] text-gray-500">s</span>
                            {arcPlan.sections.length > 2 && (
                              <button
                                type="button"
                                onClick={() => removeArcSection(idx)}
                                disabled={isBusy}
                                title="Remover seção"
                                className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 rounded"
                              >
                                <X size={13} />
                              </button>
                            )}
                          </div>
                        </div>
                        <input
                          value={sec.positiveLocalStyles.join(', ')}
                          onChange={(e) =>
                            updateArcSection(idx, {
                              positiveLocalStyles: e.target.value
                                .split(',')
                                .map((x) => x.trim())
                                .filter(Boolean),
                            })
                          }
                          disabled={isBusy}
                          placeholder="estilo desta parte (ex: soft piano, tense)"
                          className="w-full px-2 py-1 bg-white dark:bg-gray-900 rounded-lg text-[11px] dark:text-gray-100 ring-1 ring-purple-200/60 dark:ring-purple-800/40 focus:ring-2 focus:ring-purple-500 outline-none"
                        />
                      </div>
                    ))}
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 text-right">
                      Total: {Math.round(
                        arcPlan.sections.reduce((a, s) => a + s.durationMs, 0) / 1000
                      )}
                      s
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleGenerateAI}
            disabled={isBusy}
            className="w-full py-3 bg-gradient-to-br from-purple-500 to-pink-500 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:from-purple-600 hover:to-pink-600 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {generating ? (
              <>
                <Loader2 className="animate-spin" size={14} />
                Gerando música (30-60s)...
              </>
            ) : (
              <>
                <Sparkles size={14} />
                {useArc && arcPlan ? 'Gerar trilha com arco emocional' : 'Gerar com IA'}
              </>
            )}
          </button>
        </div>
      )}

      {/* Music ready preview */}
      {musicUrl && (
        <div className="flex items-center justify-between gap-3 p-3 bg-green-50 dark:bg-green-950/30 ring-1 ring-green-200/60 dark:ring-green-800/40 rounded-xl">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-green-700 dark:text-green-300">
              Música selecionada
            </p>
            <p className="text-xs text-green-900 dark:text-green-200 truncate">{musicLabel}</p>
            <audio src={musicUrl} controls className="w-full mt-2 h-8" />
          </div>
          <button
            type="button"
            onClick={() => {
              setMusicUrl(null);
              setMusicLabel('');
            }}
            disabled={isBusy}
            className="p-2 hover:bg-green-100 dark:hover:bg-green-900/40 rounded-lg text-green-700 dark:text-green-300"
            title="Remover música"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Mix controls — only meaningful once music is loaded */}
      {musicUrl && (
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300 block">
              Volume: <span className="text-purple-700">{volumePct}%</span>
            </label>
            <input
              type="range"
              min={5}
              max={100}
              step={5}
              value={volumePct}
              onChange={(e) => setVolumePct(parseInt(e.target.value))}
              disabled={isBusy}
              className="w-full accent-purple-600"
            />
            <p className="text-[9px] text-gray-500 dark:text-gray-400">
              ~50% = ideal · abaixo fica bem sutil
            </p>
          </div>
          <div>
            <label className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300 block">
              Fade-in: <span className="text-purple-700">{fadeInSec}s</span>
            </label>
            <input
              type="range"
              min={0}
              max={5}
              step={0.5}
              value={fadeInSec}
              onChange={(e) => setFadeInSec(parseFloat(e.target.value))}
              disabled={isBusy}
              className="w-full accent-purple-600"
            />
          </div>
          <div>
            <label className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300 block">
              Fade-out: <span className="text-purple-700">{fadeOutSec}s</span>
            </label>
            <input
              type="range"
              min={0}
              max={20}
              step={0.5}
              value={fadeOutSec}
              onChange={(e) => setFadeOutSec(parseFloat(e.target.value))}
              disabled={isBusy}
              className="w-full accent-purple-600"
            />
            <p className="text-[9px] text-gray-500 dark:text-gray-400">
              Quanto a música leva pra sumir no fim
            </p>
          </div>
        </div>
      )}

      {/* Mix button */}
      <button
        type="button"
        onClick={handleMix}
        disabled={isBusy || !musicUrl || !targetUrl}
        className="w-full py-4 bg-purple-600 text-white rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-xl shadow-purple-200/60 dark:shadow-purple-900/30"
      >
        {mixing ? (
          <>
            <Loader2 className="animate-spin" size={18} />
            Mixando...
          </>
        ) : (
          <>
            <Music size={18} />
            Gerar Versão com Música
          </>
        )}
      </button>
    </div>
  );
}
