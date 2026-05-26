import { useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
  ChevronDown,
  ChevronUp,
  Library,
  Loader2,
  Music,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

// F7.3 — Música salva na biblioteca (vem do GET /music/library).
interface MusicItem {
  url: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
  source: 'ai' | 'upload';
  prompt?: string;
  originalFileName?: string;
  lengthMs?: number;
}

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
  /** Disable everything while another render is in flight. */
  disabled?: boolean;
  /** User id for Firebase Storage scoping. */
  userId: string | undefined;
}

export function MusicSection({ videoOptions, onMusicVersionReady, disabled, userId }: Props) {
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

  // Mix controls
  const [volume, setVolume] = useState<number>(0.2);
  const [fadeInSec, setFadeInSec] = useState<number>(1);
  const [fadeOutSec, setFadeOutSec] = useState<number>(2);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const isBusy = uploading || generating || mixing || !!disabled;

  // F7.5 — Biblioteca: lista todas as músicas salvas no servidor.
  // Carrega no mount + recarrega após cada upload/geração bem-sucedida
  // pro cliente ver a track nova aparecer na biblioteca.
  const [library, setLibrary] = useState<MusicItem[]>([]);
  const [loadingLib, setLoadingLib] = useState(false);
  const [showLibrary, setShowLibrary] = useState(true);

  async function loadLibrary() {
    setLoadingLib(true);
    try {
      const r = await fetch('/api/elevenlabs/music/library');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setLibrary(d.tracks || []);
    } catch (err: any) {
      // Falha silenciosa — biblioteca é conveniência, não bloqueia o fluxo.
      console.warn('[MusicSection] failed to load library:', err.message);
    } finally {
      setLoadingLib(false);
    }
  }

  useEffect(() => {
    loadLibrary();
  }, []);

  function selectFromLibrary(track: MusicItem) {
    setMusicUrl(track.url);
    const label = track.prompt
      ? `IA: "${track.prompt.substring(0, 40)}${track.prompt.length > 40 ? '…' : ''}"`
      : track.originalFileName || track.fileName;
    setMusicLabel(label);
    toast.success('Música selecionada da biblioteca.');
  }

  async function deleteFromLibrary(track: MusicItem) {
    if (!confirm(`Apagar "${track.prompt || track.originalFileName || track.fileName}"?`)) return;
    try {
      const r = await fetch(`/api/elevenlabs/music/${encodeURIComponent(track.fileName)}`, {
        method: 'DELETE',
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      setLibrary((cur) => cur.filter((t) => t.fileName !== track.fileName));
      // Se a música apagada era a selecionada, limpa a seleção.
      if (musicUrl === track.url) {
        setMusicUrl(null);
        setMusicLabel('');
      }
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
      setMusicUrl(data.audioUrl);
      setMusicLabel(file.name);
      toast.success('Música carregada.');
      // F7.5 — refresh library so the new upload shows up.
      loadLibrary();
    } catch (err: any) {
      toast.error(`Falha no upload: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  // ─── AI generation via ElevenLabs Music ────────────────────────────
  const handleGenerateAI = async () => {
    if (!prompt.trim()) {
      toast.error('Descreva a música que quer gerar.');
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch('/api/elevenlabs/music/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          lengthMs: lengthSec * 1000,
          forceInstrumental: true,
        }),
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
      setMusicUrl(data.audioUrl);
      setMusicLabel(`IA: "${prompt.substring(0, 40)}${prompt.length > 40 ? '…' : ''}"`);
      toast.success('Música gerada pela IA!');
      // F7.5 — refresh library so the new track shows up.
      loadLibrary();
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
          volume,
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
            Adiciona trilha por trás do voiceover. Voz fica clara em volume ~20%.
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

      {/* F7.5 — Biblioteca de músicas salvas */}
      <div className="rounded-2xl border-2 border-purple-100 dark:border-purple-900/50 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowLibrary((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 bg-purple-50/60 dark:bg-purple-950/30 hover:bg-purple-50 dark:hover:bg-purple-950/50 transition-colors"
        >
          <span className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-purple-700 dark:text-purple-300">
            <Library size={14} />
            Biblioteca de Músicas
            <span className="ml-1 px-2 py-0.5 rounded-full bg-purple-200 dark:bg-purple-800 text-purple-900 dark:text-purple-100 text-[10px]">
              {loadingLib ? '…' : library.length}
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
            {loadingLib && library.length === 0 ? (
              <div className="flex items-center justify-center py-6 text-purple-600 dark:text-purple-400 text-xs gap-2">
                <Loader2 className="animate-spin" size={14} />
                Carregando...
              </div>
            ) : library.length === 0 ? (
              <p className="text-center text-xs text-gray-500 dark:text-gray-400 py-4">
                Nenhuma música salva ainda. Gere ou faça upload abaixo.
              </p>
            ) : (
              <ul className="space-y-2">
                {library.map((track) => {
                  const isSelected = musicUrl === track.url;
                  const label = track.prompt || track.originalFileName || track.fileName;
                  return (
                    <li
                      key={track.fileName}
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
                          <p
                            className="text-xs font-bold text-gray-900 dark:text-gray-100 truncate"
                            title={label}
                          >
                            {label}
                          </p>
                          <p className="text-[10px] text-gray-500 dark:text-gray-400">
                            {formatRelativeDate(track.createdAt)} · {formatBytes(track.sizeBytes)}
                          </p>
                          <audio src={track.url} controls className="w-full mt-1.5 h-7" />
                        </div>
                      </div>
                      <div className="flex gap-2 mt-2">
                        <button
                          type="button"
                          onClick={() => selectFromLibrary(track)}
                          disabled={isBusy}
                          className={`flex-1 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                            isSelected
                              ? 'bg-purple-200 dark:bg-purple-800 text-purple-900 dark:text-purple-100 cursor-default'
                              : 'bg-purple-600 text-white hover:bg-purple-700'
                          }`}
                        >
                          {isSelected ? '✓ Selecionada' : 'Usar esta'}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteFromLibrary(track)}
                          disabled={isBusy}
                          title="Apagar da biblioteca"
                          className="px-3 py-1.5 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
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
        <div className="space-y-3 p-4 bg-purple-50/60 dark:bg-purple-950/30 rounded-2xl ring-1 ring-purple-200/60 dark:ring-purple-800/40">
          <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase tracking-widest text-purple-700 dark:text-purple-300">
              Descreva a música
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="ex: cinematic uplifting instrumental, soft piano + strings, hopeful mood"
              rows={2}
              disabled={isBusy}
              className="w-full p-3 bg-white dark:bg-gray-900 ring-1 ring-purple-200/60 dark:ring-purple-800/40 rounded-xl text-sm focus:ring-2 focus:ring-purple-500 outline-none resize-none dark:text-gray-100"
            />
            <p className="text-[10px] text-purple-600/80 dark:text-purple-300/70">
              Dica: descreva gênero, instrumentos e humor. Instrumental forçado (sem voz).
            </p>
          </div>
          <div>
            <label className="text-[11px] font-black uppercase tracking-widest text-purple-700 dark:text-purple-300">
              Duração: <span>{lengthSec}s</span>
            </label>
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
          </div>
          <button
            type="button"
            onClick={handleGenerateAI}
            disabled={isBusy || !prompt.trim()}
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
                Gerar com IA
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
              Volume: <span className="text-purple-700">{Math.round(volume * 100)}%</span>
            </label>
            <input
              type="range"
              min={5}
              max={100}
              step={5}
              value={Math.round(volume * 100)}
              onChange={(e) => setVolume(parseInt(e.target.value) / 100)}
              disabled={isBusy}
              className="w-full accent-purple-600"
            />
            <p className="text-[9px] text-gray-500 dark:text-gray-400">Voz clara em ~20-30%</p>
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
              max={5}
              step={0.5}
              value={fadeOutSec}
              onChange={(e) => setFadeOutSec(parseFloat(e.target.value))}
              disabled={isBusy}
              className="w-full accent-purple-600"
            />
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
