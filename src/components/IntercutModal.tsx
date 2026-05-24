import { useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Loader2, Plus, Trash2, X } from 'lucide-react';

// F6.7 — module-level cache of videoUrl → transcriptId. Persists for the
// lifetime of the SPA page (cleared on reload). Avoids paying AssemblyAI
// again if the user closes and re-opens Cortes on the same video.
const transcriptCache = new Map<string, string>();

// "Cortes pretos com texto" modal — F6 redesign.
//
// Lets the user insert black screens at SPECIFIC moments of an already-edited
// ZapCap video. Audio continues playing under the black screen; the caption
// shown on the black is pulled from the original spoken sentence (auto-loaded
// from AssemblyAI) and highlights each word in sync as it's spoken.
//
// Flow:
//   1. Modal opens with `sourceVideoUrl` from the parent.
//   2. If no transcriptId is known, modal calls /api/assemblyai/analyze
//      on the source URL to get one.
//   3. With transcriptId, modal fetches /api/assemblyai/transcript/.../sentences-with-words
//      and shows the sentences as clickable cards.
//   4. User clicks "+ Adicionar" on each sentence to push it into the
//      insertions list. Per-insertion controls: position (top/middle/bottom),
//      durationSec (can extend beyond the spoken sentence), atSec (defaults
//      to original time but editable).
//   5. "Gerar" passes insertions[] + fontSize to the parent's onRender.
//
// Stateless about the *render itself* — that's parent business; modal just
// hands back the user's choices.

interface Insertion {
  id: string; // stable for React key + delete
  atSec: number;
  durationSec: number;
  text: string;
  position: 'top' | 'middle' | 'bottom';
  /** Word-level timestamps relative to the sentence start (offsetMs).
   *  Used by backend to render karaoke highlight. */
  words: Array<{ text: string; offsetMs: number; durationMs: number }>;
}

interface Sentence {
  text: string;
  startMs: number;
  endMs: number;
  words: Array<{ text: string; startMs: number; endMs: number }>;
}

interface Props {
  open: boolean;
  rendering: boolean;
  /** URL of the ZapCap-edited video the user clicked "Cortes" on. */
  sourceVideoUrl: string | null;
  /** Optional initial fontSize (kept in parent for persistence). */
  fontSize: number;
  onFontSizeChange: (next: number) => void;
  onClose: () => void;
  /** Fires "Gerar" — parent makes the /api/video/intercut call. */
  onRender: (insertions: Insertion[]) => void;
}

export function IntercutModal({
  open,
  rendering,
  sourceVideoUrl,
  fontSize,
  onFontSizeChange,
  onClose,
  onRender,
}: Props) {
  const [transcriptId, setTranscriptId] = useState<string | null>(null);
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeStatus, setAnalyzeStatus] = useState<string>('');
  const [analyzeElapsedSec, setAnalyzeElapsedSec] = useState(0);
  const [loadingSentences, setLoadingSentences] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insertions, setInsertions] = useState<Insertion[]>([]);

  // F6.7 — refs pra cancelar polling + timer ao fechar modal ou cancelar.
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);

  const stopAnalyze = () => {
    cancelledRef.current = true;
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (elapsedIntervalRef.current) {
      clearInterval(elapsedIntervalRef.current);
      elapsedIntervalRef.current = null;
    }
  };

  // Reset state when the modal closes or the source changes — avoids leaking
  // transcripts/insertions across different videos.
  useEffect(() => {
    if (!open) {
      stopAnalyze();
      setTranscriptId(null);
      setSentences([]);
      setInsertions([]);
      setError(null);
      setAnalyzing(false);
      setAnalyzeStatus('');
      setAnalyzeElapsedSec(0);
    } else {
      cancelledRef.current = false;
    }
  }, [open]);

  // F6.7 — auto-analyze on open, but now using submit + poll pattern.
  // - Check cache first (instant if same video was analyzed earlier).
  // - POST /analyze/submit → get transcriptId fast (~1-2s).
  // - Poll GET /analyze/status/:id every 3s until 'completed' or 'error'.
  // - Show elapsed seconds + AssemblyAI status to give the user feedback.
  // - inFlight + cancelledRef guard against race conditions and lifecycle leaks.
  useEffect(() => {
    if (!open || !sourceVideoUrl || transcriptId || analyzing) return;

    // Cache hit → skip the whole AssemblyAI roundtrip.
    const cached = transcriptCache.get(sourceVideoUrl);
    if (cached) {
      setTranscriptId(cached);
      return;
    }

    const startTime = Date.now();
    setAnalyzing(true);
    setAnalyzeStatus('Enviando vídeo pra análise...');
    setAnalyzeElapsedSec(0);
    setError(null);

    // Tick a 1s elapsed counter (visual only).
    elapsedIntervalRef.current = setInterval(() => {
      setAnalyzeElapsedSec(Math.round((Date.now() - startTime) / 1000));
    }, 1000);

    const submitAndPoll = async () => {
      try {
        // Step 1 — submit (fast).
        const submitRes = await fetch('/api/assemblyai/analyze/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoUrl: sourceVideoUrl }),
        });
        const submitData = await submitRes.json();
        if (!submitRes.ok) throw new Error(submitData.error || `HTTP ${submitRes.status}`);
        if (cancelledRef.current) return;
        const tid = submitData.transcriptId;
        setAnalyzeStatus('Na fila do AssemblyAI...');

        // Step 2 — poll status until completed/error or 12min timeout.
        // Race condition fix (same pattern as zap polling F6.1): inFlight
        // guard prevents concurrent fetches when response is slow.
        let inFlight = false;
        let done = false;
        const TIMEOUT_MS = 12 * 60 * 1000;
        pollIntervalRef.current = setInterval(async () => {
          if (cancelledRef.current || done) return;
          if (inFlight) return;
          if (Date.now() - startTime > TIMEOUT_MS) {
            done = true;
            stopAnalyze();
            if (!cancelledRef.current) {
              setAnalyzing(false);
              setError('Tempo limite excedido (12min). Tente de novo com um vídeo mais curto.');
            }
            return;
          }
          inFlight = true;
          try {
            const r = await fetch(`/api/assemblyai/analyze/status/${tid}`);
            const d = await r.json();
            if (cancelledRef.current) return;
            if (!r.ok) {
              throw new Error(d.error || `HTTP ${r.status}`);
            }
            const status = d.status as string;
            if (status === 'completed') {
              done = true;
              stopAnalyze();
              transcriptCache.set(sourceVideoUrl, tid);
              setTranscriptId(tid);
              setAnalyzing(false);
            } else if (status === 'error') {
              done = true;
              stopAnalyze();
              setAnalyzing(false);
              setError(d.error || 'AssemblyAI retornou erro no processamento.');
            } else {
              // queued / processing — update friendly status text
              setAnalyzeStatus(
                status === 'queued' ? 'Na fila do AssemblyAI...' : 'Processando áudio...'
              );
            }
          } catch (err: any) {
            // Network blips are non-fatal; next tick retries. Only surface
            // the error if the polling is genuinely stuck.
            console.warn('[Intercut Poll] tick error:', err.message);
          } finally {
            inFlight = false;
          }
        }, 3000);
      } catch (err: any) {
        if (cancelledRef.current) return;
        stopAnalyze();
        setAnalyzing(false);
        setError(err.message || 'Falha ao iniciar análise.');
      }
    };

    void submitAndPoll();

    return () => {
      stopAnalyze();
    };
  }, [open, sourceVideoUrl, transcriptId, analyzing]);

  // When we have a transcriptId, fetch sentences-with-words for the picker.
  useEffect(() => {
    if (!transcriptId) return;
    let cancelled = false;
    const run = async () => {
      setLoadingSentences(true);
      try {
        const res = await fetch(`/api/assemblyai/transcript/${transcriptId}/sentences-with-words`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (!cancelled) setSentences(data.sentences || []);
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Falha ao carregar frases.');
      } finally {
        if (!cancelled) setLoadingSentences(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [transcriptId]);

  const addInsertionFromSentence = (s: Sentence) => {
    const atSec = Math.round((s.startMs / 1000) * 10) / 10;
    const durationSec = Math.round(((s.endMs - s.startMs) / 1000) * 10) / 10;
    // Convert word timestamps to be relative to sentence start (offsetMs).
    const words = s.words.map((w) => ({
      text: w.text,
      offsetMs: w.startMs - s.startMs,
      durationMs: w.endMs - w.startMs,
    }));
    setInsertions((prev) => [
      ...prev,
      {
        id: `ins-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        atSec,
        durationSec,
        text: s.text,
        position: 'middle',
        words,
      },
    ]);
  };

  const updateInsertion = <K extends keyof Insertion>(id: string, key: K, value: Insertion[K]) => {
    setInsertions((prev) => prev.map((i) => (i.id === id ? { ...i, [key]: value } : i)));
  };

  const removeInsertion = (id: string) => setInsertions((prev) => prev.filter((i) => i.id !== id));

  const handleRender = () => {
    if (insertions.length === 0) {
      toast.error('Adicione pelo menos uma frase pra inserir como tela preta.');
      return;
    }
    // Sort by atSec so the backend processes them in order.
    const sorted = [...insertions].sort((a, b) => a.atSec - b.atSec);
    onRender(sorted);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={() => !rendering && onClose()}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-[28px] max-w-3xl w-full max-h-[92vh] overflow-y-auto p-8 space-y-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <h3 className="text-2xl font-black text-gray-900 dark:text-gray-50 uppercase italic">
              ✂ Cortes pretos com texto
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Insere tela preta com legenda em momentos escolhidos. Áudio continua tocando — só a
              imagem vira preta. A palavra falada é destacada em roxo.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={rendering}
            className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 rounded-lg disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-950/30 ring-1 ring-red-200 dark:ring-red-900/60 rounded-xl text-xs font-bold text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Estado 1: analisando o áudio com feedback de progresso. */}
        {analyzing && (
          <div className="p-6 bg-purple-50 dark:bg-purple-950/30 ring-1 ring-purple-200 dark:ring-purple-900/60 rounded-2xl space-y-4">
            <div className="flex items-center gap-3">
              <Loader2 size={20} className="animate-spin text-purple-600 dark:text-purple-400" />
              <div className="space-y-1 flex-1">
                <p className="text-sm font-black text-purple-900 dark:text-purple-200">
                  Analisando áudio do vídeo
                </p>
                <p className="text-xs text-purple-700 dark:text-purple-300">
                  {analyzeStatus || 'Iniciando...'} ·{' '}
                  <span className="font-mono">
                    {Math.floor(analyzeElapsedSec / 60)}:
                    {String(analyzeElapsedSec % 60).padStart(2, '0')}
                  </span>{' '}
                  decorrido
                </p>
              </div>
            </div>
            <p className="text-[11px] text-purple-600/80 dark:text-purple-300/70 leading-relaxed">
              Tempo total depende do tamanho do vídeo: ~30s pra vídeos curtos, até 3-5min pra vídeos
              longos. Pode fechar este modal se preferir — o áudio fica em cache e a próxima
              abertura é instantânea.
            </p>
            <button
              onClick={() => {
                stopAnalyze();
                setAnalyzing(false);
                setError('Análise cancelada.');
              }}
              className="text-[10px] font-black uppercase tracking-widest text-purple-700 dark:text-purple-300 hover:text-purple-900 dark:hover:text-purple-100 underline"
            >
              Cancelar análise
            </button>
          </div>
        )}

        {/* Estado 2: tem transcript, carregando frases */}
        {loadingSentences && !analyzing && (
          <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-800/60 rounded-xl">
            <Loader2 size={16} className="animate-spin text-gray-500" />
            <span className="text-xs font-bold text-gray-600 dark:text-gray-400">
              Carregando frases...
            </span>
          </div>
        )}

        {/* Estado 3: frases disponíveis pra escolher */}
        {!analyzing && !loadingSentences && sentences.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300">
                Frases do vídeo ({sentences.length})
              </h4>
              <p className="text-[10px] text-gray-500 dark:text-gray-400">
                Clique + pra inserir como tela preta
              </p>
            </div>
            <div className="space-y-1.5 max-h-[200px] overflow-y-auto pr-2">
              {sentences.map((s, idx) => {
                const tStart = (s.startMs / 1000).toFixed(1);
                const dur = ((s.endMs - s.startMs) / 1000).toFixed(1);
                return (
                  <button
                    key={`sent-${idx}-${s.startMs}`}
                    onClick={() => addInsertionFromSentence(s)}
                    disabled={rendering}
                    className="w-full text-left flex items-start gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/60 hover:bg-purple-50 dark:hover:bg-purple-950/40 ring-1 ring-gray-200 dark:ring-gray-700 hover:ring-purple-400 transition-all disabled:opacity-50"
                  >
                    <span className="shrink-0 w-6 h-6 rounded-full bg-white dark:bg-gray-900 flex items-center justify-center ring-1 ring-gray-300 dark:ring-gray-600">
                      <Plus size={12} className="text-purple-600 dark:text-purple-400" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-gray-900 dark:text-gray-100 leading-snug">
                        {s.text}
                      </p>
                      <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                        {tStart}s · dura {dur}s · {s.words.length} palavras
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Estado 4: inserções adicionadas */}
        {insertions.length > 0 && (
          <div className="space-y-3 pt-2 border-t border-gray-200 dark:border-gray-800">
            <h4 className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300">
              Telas pretas a inserir ({insertions.length})
            </h4>
            <div className="space-y-3">
              {insertions.map((ins, i) => (
                <div
                  key={ins.id}
                  className="p-4 rounded-2xl bg-purple-50/60 dark:bg-purple-950/30 ring-1 ring-purple-200 dark:ring-purple-900/60 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-bold text-purple-900 dark:text-purple-200 leading-snug flex-1">
                      #{i + 1}: {ins.text}
                    </p>
                    <button
                      onClick={() => removeInsertion(ins.id)}
                      disabled={rendering}
                      className="shrink-0 p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg disabled:opacity-50"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* atSec */}
                    <div>
                      <label className="text-[9px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300 block">
                        Quando (seg)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        value={ins.atSec}
                        onChange={(e) =>
                          updateInsertion(ins.id, 'atSec', Number(e.target.value) || 0)
                        }
                        disabled={rendering}
                        className="w-full p-2 mt-1 bg-white dark:bg-gray-900 ring-1 ring-gray-300 dark:ring-gray-700 rounded-lg text-xs font-bold text-gray-900 dark:text-gray-100"
                      />
                    </div>
                    {/* durationSec */}
                    <div>
                      <label className="text-[9px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300 block">
                        Duração (seg)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0.5"
                        max="20"
                        value={ins.durationSec}
                        onChange={(e) =>
                          updateInsertion(ins.id, 'durationSec', Number(e.target.value) || 0.5)
                        }
                        disabled={rendering}
                        className="w-full p-2 mt-1 bg-white dark:bg-gray-900 ring-1 ring-gray-300 dark:ring-gray-700 rounded-lg text-xs font-bold text-gray-900 dark:text-gray-100"
                      />
                    </div>
                    {/* position */}
                    <div>
                      <label className="text-[9px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300 block">
                        Posição
                      </label>
                      <select
                        value={ins.position}
                        onChange={(e) =>
                          updateInsertion(
                            ins.id,
                            'position',
                            e.target.value as Insertion['position']
                          )
                        }
                        disabled={rendering}
                        className="w-full p-2 mt-1 bg-white dark:bg-gray-900 ring-1 ring-gray-300 dark:ring-gray-700 rounded-lg text-xs font-bold text-gray-900 dark:text-gray-100"
                      >
                        <option value="top">Topo</option>
                        <option value="middle">Meio</option>
                        <option value="bottom">Baixo</option>
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tamanho da fonte (global) */}
        <div>
          <label className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300">
            Tamanho da fonte:{' '}
            <span className="text-purple-700 dark:text-purple-300">{fontSize}px</span>
          </label>
          <input
            type="range"
            min={28}
            max={120}
            step={2}
            value={fontSize}
            onChange={(e) => onFontSizeChange(parseInt(e.target.value))}
            className="w-full accent-purple-600"
            disabled={rendering}
          />
        </div>

        {/* Ações */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            disabled={rendering}
            className="flex-1 py-3 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleRender}
            disabled={rendering || insertions.length === 0}
            className="flex-1 py-3 bg-purple-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {rendering && <Loader2 size={14} className="animate-spin" />}
            {rendering
              ? 'Gerando...'
              : `Gerar com ${insertions.length} tela${insertions.length === 1 ? '' : 's'} preta${insertions.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
