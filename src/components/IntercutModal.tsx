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
  /** F6.8 — ISO 639-1 language code ('pt', 'en', 'es'). Passed to AssemblyAI
   *  so we skip language detection (saves ~30-40% time). Defaults to 'pt'. */
  languageCode?: 'pt' | 'en' | 'es';
  onFontSizeChange: (next: number) => void;
  onClose: () => void;
  /** F6.11 — Fires "Gerar". Modal now passes settings alongside insertions
   *  so the parent can forward them in the /api/video/intercut payload.
   *  F6.12 — adds `uppercase` flag.
   *  F6.15 — adds `textColor`, `highlightColor`, `highlightMode`.
   *  F6.16 — adds `popAnimation` toggle.
   *  F6.17/F6.18/F6.19 — adds `outlineColor`, `fontFamily`, `background`. */
  onRender: (
    insertions: Insertion[],
    settings: {
      wordsPerLine: number;
      mergeThresholdSec: number;
      uppercase: boolean;
      textColor: string;
      highlightColor: string;
      highlightMode: 'text' | 'background' | 'both' | 'none';
      popAnimation: boolean;
      outlineColor: string;
      fontFamily: string;
      background: 'black' | 'space' | 'gradient';
    }
  ) => void;
}

export function IntercutModal({
  open,
  rendering,
  sourceVideoUrl,
  fontSize,
  languageCode = 'pt',
  onFontSizeChange,
  onClose,
  onRender,
}: Props) {
  // F6.11 — config sliders global (não por inserção pra ficar simples).
  const [wordsPerLine, setWordsPerLine] = useState<number>(4);
  const [mergeThresholdSec, setMergeThresholdSec] = useState<number>(0.5);
  // F6.12 — caps + font. Default uppercase=true (estilo ZapCap pop-up).
  const [uppercase, setUppercase] = useState<boolean>(true);
  // F6.15 — cor base do texto + cor de destaque + modo de destaque.
  // Defaults: branco, roxo, e modo "texto" (compatível com versão anterior).
  const [textColor, setTextColor] = useState<string>('#FFFFFF');
  const [highlightColor, setHighlightColor] = useState<string>('#9333EA');
  const [highlightMode, setHighlightMode] = useState<'text' | 'background' | 'both' | 'none'>(
    'text'
  );
  // F6.16 — animação "pop" do retângulo (scale-in tipo TikTok).
  // Default off pra não surpreender quem já tinha gerações sem animação.
  const [popAnimation, setPopAnimation] = useState<boolean>(false);
  // F6.17 — cor da borda (outline) das letras. Default preto.
  const [outlineColor, setOutlineColor] = useState<string>('#000000');
  // F6.18 — escolha de fonte. Bundled fonts: Anton, Bebas Neue, Inter Black,
  // Montserrat Black, Oswald. Impact é fallback do sistema.
  const [fontFamily, setFontFamily] = useState<string>('Impact');
  // F6.19 — fundo do segmento. 'black' = preto (default, comportamento atual).
  // 'space' = starfield gerado via ffmpeg lavfi. 'gradient' = cor com hue shift.
  const [background, setBackground] = useState<'black' | 'space' | 'gradient'>('black');
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
  //
  // F6.10 — race condition fix: deps array só tem [open, sourceVideoUrl]. Antes
  // tinha [open, sourceVideoUrl, transcriptId, analyzing] — quando setAnalyzing(true)
  // rodava DENTRO do effect, a deps `analyzing` mudava, o cleanup rodava
  // stopAnalyze() que setava cancelledRef.current=true, e o polling nunca
  // chegava a iniciar (submit retornava OK mas o `if (cancelledRef.current) return`
  // matava o fluxo). Resetar cancelledRef AQUI dentro garante state limpo.
  useEffect(() => {
    if (!open || !sourceVideoUrl || transcriptId) return;
    cancelledRef.current = false;

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
        // Step 1 — submit (fast). F6.8 — lightweight mode usa universal-2 +
        // language_code explícito + sem auto_highlights. Cuts ~40-50% off the
        // total transcription time vs. the default heavy mode.
        console.log('[Intercut] POST /analyze/submit ←', {
          videoUrl: sourceVideoUrl?.substring(0, 80),
          languageCode,
        });
        const submitRes = await fetch('/api/assemblyai/analyze/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoUrl: sourceVideoUrl,
            lightweight: true,
            languageCode,
          }),
        });
        const responseText = await submitRes.text();
        console.log('[Intercut] /analyze/submit response:', submitRes.status, responseText);
        let submitData: any = {};
        try {
          submitData = JSON.parse(responseText);
        } catch {
          // Non-JSON response — likely 404 or HTML error page from the server.
          // Surface that distinctly so the user knows it's NOT an AssemblyAI issue.
          throw new Error(
            `Servidor respondeu HTTP ${submitRes.status} — endpoint não encontrado ou retornou HTML em vez de JSON. ` +
              `Pode ser que o backend não foi reiniciado depois de adicionar /analyze/submit. ` +
              `Body: ${responseText.substring(0, 200)}`
          );
        }
        if (!submitRes.ok) {
          throw new Error(
            submitData.error || submitData.message || `HTTP ${submitRes.status} no submit.`
          );
        }
        if (cancelledRef.current) return;
        const tid = submitData.transcriptId;
        if (!tid) {
          throw new Error(
            'Submit retornou sem transcriptId. Resposta: ' + responseText.substring(0, 200)
          );
        }
        console.log('[Intercut] transcriptId:', tid);
        setAnalyzeStatus(`Na fila do AssemblyAI... (id: ${tid.substring(0, 8)})`);

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
            const txt = await r.text();
            let d: any = {};
            try {
              d = JSON.parse(txt);
            } catch {
              throw new Error(
                `Status retornou non-JSON HTTP ${r.status}. Body: ${txt.substring(0, 150)}`
              );
            }
            if (cancelledRef.current) return;
            if (!r.ok) {
              throw new Error(d.error || `HTTP ${r.status}: ${txt.substring(0, 150)}`);
            }
            const status = d.status as string;
            console.log('[Intercut Poll]', status, d.error || '');
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
              setError(
                `AssemblyAI retornou erro: ${d.error || 'sem mensagem'}. Pode ser URL ` +
                  `inacessível, áudio corrompido, ou problema na API.`
              );
            } else {
              // queued / processing — update friendly status text
              setAnalyzeStatus(
                status === 'queued'
                  ? 'Na fila do AssemblyAI...'
                  : `Processando áudio (${status})...`
              );
            }
          } catch (err: any) {
            // Network blips are non-fatal; next tick retries. Log fully.
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
    // F6.10 — apenas open + sourceVideoUrl. NÃO incluir `analyzing` (mata o
    // próprio polling) nem `transcriptId` (cleanup fica fazendo stopAnalyze
    // por nada quando o polling completa).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sourceVideoUrl]);

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
    onRender(sorted, {
      wordsPerLine,
      mergeThresholdSec,
      uppercase,
      textColor,
      highlightColor,
      highlightMode,
      popAnimation,
      outlineColor,
      fontFamily,
      background,
    });
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

        {/* F6.11 — Palavras por linha (estilo ZapCap pop-up). 1-8 palavras
            agrupadas; a palavra falada fica em destaque enquanto o resto
            do grupo cinza. */}
        <div>
          <label className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300">
            Palavras por linha:{' '}
            <span className="text-purple-700 dark:text-purple-300">{wordsPerLine}</span>
            <span className="ml-2 normal-case font-medium text-gray-500 dark:text-gray-400 text-[10px]">
              (estilo ZapCap pop-up: poucas palavras visíveis por vez)
            </span>
          </label>
          <input
            type="range"
            min={1}
            max={8}
            step={1}
            value={wordsPerLine}
            onChange={(e) => setWordsPerLine(parseInt(e.target.value))}
            className="w-full accent-purple-600"
            disabled={rendering}
          />
        </div>

        {/* F6.11 — Threshold de fusão de cortes consecutivos. Quando 2
            inserções têm gap menor que isso, o backend funde elas num
            segmento preto contínuo (não volta pro avatar entre elas). */}
        <div>
          <label className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300">
            Fundir cortes próximos:{' '}
            <span className="text-purple-700 dark:text-purple-300">
              {mergeThresholdSec.toFixed(1)}s
            </span>
            <span className="ml-2 normal-case font-medium text-gray-500 dark:text-gray-400 text-[10px]">
              (se gap entre 2 telas pretas for menor que isso, não volta pro avatar)
            </span>
          </label>
          <input
            type="range"
            min={0}
            max={2}
            step={0.1}
            value={mergeThresholdSec}
            onChange={(e) => setMergeThresholdSec(parseFloat(e.target.value))}
            className="w-full accent-purple-600"
            disabled={rendering}
          />
        </div>

        {/* F6.12 — UPPERCASE toggle. Default ON pra match estilo ZapCap pop-up. */}
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={uppercase}
            onChange={(e) => setUppercase(e.target.checked)}
            disabled={rendering}
            className="w-5 h-5 accent-purple-600"
          />
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300">
              Texto em CAIXA ALTA
            </p>
            <p className="text-[10px] text-gray-500 dark:text-gray-400">
              Liga/desliga uppercase. Default ligado (visual ZapCap pop-up).
            </p>
          </div>
        </label>

        {/* F6.18/F6.19 — Fonte + Fundo do segmento. Bloco separado pra
            decisões "visuais gerais" (vs destaque que é por palavra). */}
        <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-800/40 ring-1 ring-gray-200/60 dark:ring-gray-700/60 space-y-4">
          <p className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300">
            🅰️ Tipografia & Fundo
          </p>

          <div className="grid grid-cols-2 gap-3">
            {/* Fonte */}
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-600 dark:text-gray-400 block mb-1.5">
                Fonte
              </label>
              <select
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                disabled={rendering}
                className="w-full p-2.5 bg-white dark:bg-gray-900 ring-1 ring-gray-200 dark:ring-gray-700 rounded-lg text-xs font-bold text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-purple-500 outline-none"
              >
                <option value="Impact">Impact (sistema)</option>
                <option value="Anton">Anton (TikTok-style)</option>
                <option value="Bebas Neue">Bebas Neue (condensada)</option>
                <option value="Inter Black">Inter Black (moderna)</option>
                <option value="Montserrat Black">Montserrat Black (geométrica)</option>
                <option value="Oswald">Oswald (slim bold)</option>
              </select>
            </div>

            {/* Fundo */}
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-600 dark:text-gray-400 block mb-1.5">
                Fundo do corte
              </label>
              <select
                value={background}
                onChange={(e) => setBackground(e.target.value as 'black' | 'space' | 'gradient')}
                disabled={rendering}
                className="w-full p-2.5 bg-white dark:bg-gray-900 ring-1 ring-gray-200 dark:ring-gray-700 rounded-lg text-xs font-bold text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-purple-500 outline-none"
              >
                <option value="black">Preto sólido</option>
                <option value="space">Espaço (estrelas piscando)</option>
                <option value="gradient">Gradient animado</option>
              </select>
            </div>
          </div>

          <p className="text-[10px] text-gray-500 dark:text-gray-400">
            💡 Backgrounds são gerados em tempo real (sem download). Pra vídeo de fundo customizado
            (ex: viagem espacial real), me peça depois — adiciono upload de MP4.
          </p>
        </div>

        {/* F6.15 — controles de cor + modo de destaque da palavra falada.
            Bloco visual separado do resto pra ficar claro que são opções
            ligadas (cores + comportamento do destaque andam juntos). */}
        <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-800/40 ring-1 ring-gray-200/60 dark:ring-gray-700/60 space-y-4">
          <p className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300">
            🎨 Destaque da palavra falada
          </p>

          {/* Modo de destaque */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-600 dark:text-gray-400">
              Onde aparece o destaque
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {(
                [
                  { id: 'text', label: 'Texto', desc: 'Letra muda de cor' },
                  { id: 'background', label: 'Fundo', desc: 'Halo atrás da palavra' },
                  { id: 'both', label: 'Ambos', desc: 'Letra + halo' },
                  { id: 'none', label: 'Nenhum', desc: 'Sem destaque' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setHighlightMode(m.id)}
                  disabled={rendering}
                  title={m.desc}
                  className={`py-2 px-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                    highlightMode === m.id
                      ? 'bg-purple-600 text-white shadow-sm'
                      : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-purple-50 dark:hover:bg-purple-950/40 ring-1 ring-gray-200 dark:ring-gray-700'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Color pickers — escondidos quando modo='none' (não fazem efeito).
              F6.17 — adicionado picker da BORDA (outline) das letras junto. */}
          {highlightMode !== 'none' && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-600 dark:text-gray-400 block mb-1.5">
                  Cor do texto
                </label>
                <div className="flex items-center gap-2 p-2 bg-white dark:bg-gray-900 rounded-lg ring-1 ring-gray-200 dark:ring-gray-700">
                  <input
                    type="color"
                    value={textColor}
                    onChange={(e) => setTextColor(e.target.value)}
                    disabled={rendering}
                    className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent"
                  />
                  <span className="font-mono text-[10px] text-gray-700 dark:text-gray-300 uppercase">
                    {textColor}
                  </span>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-600 dark:text-gray-400 block mb-1.5">
                  Cor da borda
                </label>
                <div className="flex items-center gap-2 p-2 bg-white dark:bg-gray-900 rounded-lg ring-1 ring-gray-200 dark:ring-gray-700">
                  <input
                    type="color"
                    value={outlineColor}
                    onChange={(e) => setOutlineColor(e.target.value)}
                    disabled={rendering}
                    className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent"
                  />
                  <span className="font-mono text-[10px] text-gray-700 dark:text-gray-300 uppercase">
                    {outlineColor}
                  </span>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-600 dark:text-gray-400 block mb-1.5">
                  Cor do destaque
                </label>
                <div className="flex items-center gap-2 p-2 bg-white dark:bg-gray-900 rounded-lg ring-1 ring-gray-200 dark:ring-gray-700">
                  <input
                    type="color"
                    value={highlightColor}
                    onChange={(e) => setHighlightColor(e.target.value)}
                    disabled={rendering}
                    className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent"
                  />
                  <span className="font-mono text-[10px] text-gray-700 dark:text-gray-300 uppercase">
                    {highlightColor}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* F6.16 — Animação "pop" do retângulo (TikTok/CapCut style).
              Só faz sentido nos modos que desenham retângulo: background e both. */}
          {(highlightMode === 'background' || highlightMode === 'both') && (
            <label className="flex items-center gap-3 cursor-pointer select-none p-3 bg-white dark:bg-gray-900 rounded-lg ring-1 ring-gray-200 dark:ring-gray-700">
              <input
                type="checkbox"
                checked={popAnimation}
                onChange={(e) => setPopAnimation(e.target.checked)}
                disabled={rendering}
                className="w-5 h-5 accent-purple-600"
              />
              <div>
                <p className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300">
                  ✨ Animar destaque (pop)
                </p>
                <p className="text-[10px] text-gray-500 dark:text-gray-400">
                  Retângulo entra escalando 90% → 108% → 100% (~250ms). Estilo TikTok/CapCut.
                </p>
              </div>
            </label>
          )}
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
