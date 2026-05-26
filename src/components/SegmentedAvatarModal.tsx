// F9.7/F9.8 — Modal pra gerar avatar segmentado.
//
// Cliente escolhe as FRASES do áudio onde quer que o avatar apareça
// (mesmo padrão do IntercutModal/Cortes). Backend gera HeyGen só pra
// esses trechos = economia de ~75% do custo HeyGen.
//
// Pipeline interno:
//   1. AssemblyAI transcreve o áudio (cache por audioUrl).
//   2. UI mostra lista de frases + botão "+" pra adicionar.
//   3. Frases consecutivas selecionadas são FUNDIDAS em 1 segment
//      (gap < 0.5s) → menos chamadas HeyGen, lip-sync mais natural.
//   4. POST /api/heygen/generate-segmented + polling.

import { useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Loader2, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { authedFetch } from '@/lib/authedFetch';

// Cache de transcriptId por (audioUrl + lang) no nível do módulo. Lang faz
// parte da key porque um áudio em inglês transcrito como `pt` vira lixo —
// não queremos servir esse lixo do cache se cliente depois trocar pra `en`.
const transcriptCache = new Map<string, string>();
const cacheKey = (audioUrl: string, lang: string) => `${audioUrl}|${lang}`;

interface Sentence {
  text: string;
  startMs: number;
  endMs: number;
}

interface Props {
  open: boolean;
  /** Avatar selecionado (HeyGen avatar_id ou talking_photo_*). */
  avatarId: string;
  /** URL do áudio gerado (ex: '/generated/premium-audio-xxxx.mp3'). */
  audioUrl: string;
  aspectRatio?: '9:16' | '1:1' | '16:9' | '4:5';
  scale?: number;
  /** Língua do áudio. 'auto' = AssemblyAI detecta sozinha (default). */
  languageCode?: 'auto' | 'pt' | 'en' | 'es';
  /** Avisar quando vídeo final estiver pronto. */
  onVideoReady: (videoUrl: string, totalAvatarSec: number) => void;
  onClose: () => void;
}

type JobStatus =
  | 'queued'
  | 'cutting-audio'
  | 'submitting-heygen'
  | 'rendering-heygen'
  | 'downloading-segments'
  | 'stitching'
  | 'completed'
  | 'failed';

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return m > 0 ? `${m}:${s.padStart(4, '0')}` : `${s}s`;
}

export function SegmentedAvatarModal({
  open,
  avatarId,
  audioUrl,
  aspectRatio = '9:16',
  scale,
  languageCode = 'auto',
  onVideoReady,
  onClose,
}: Props) {
  // ─── AssemblyAI analysis state ───────────────────────────────────────
  const [transcriptId, setTranscriptId] = useState<string | null>(null);
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeStatus, setAnalyzeStatus] = useState('');
  const [analyzeElapsedSec, setAnalyzeElapsedSec] = useState(0);
  const [loadingSentences, setLoadingSentences] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Set de índices de frases selecionadas (mesmo identificador que IntercutModal).
  const [selectedIdxs, setSelectedIdxs] = useState<Set<number>>(new Set());

  // Idioma escolhido pra transcrição. Default 'auto' = AssemblyAI detecta
  // sozinha (~30% mais lento mas zero config). Cliente pode forçar um
  // idioma específico se a detecção errar ou pra ganhar velocidade.
  const [chosenLang, setChosenLang] = useState<'auto' | 'pt' | 'en' | 'es'>(languageCode);

  // ─── Job state (depois do submit) ────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [jobProgress, setJobProgress] = useState(0);
  const [jobMessage, setJobMessage] = useState('');
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [estimatedCost, setEstimatedCost] = useState<number | null>(null);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const jobPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);

  const stopAnalyze = () => {
    cancelledRef.current = true;
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current);
    pollIntervalRef.current = null;
    elapsedIntervalRef.current = null;
  };

  // Reset on close.
  useEffect(() => {
    if (!open) {
      stopAnalyze();
      if (jobPollRef.current) clearInterval(jobPollRef.current);
      jobPollRef.current = null;
      setTranscriptId(null);
      setSentences([]);
      setSelectedIdxs(new Set());
      setError(null);
      setAnalyzing(false);
      setAnalyzeStatus('');
      setAnalyzeElapsedSec(0);
      setSubmitting(false);
      setJobId(null);
      setJobStatus(null);
      setJobProgress(0);
      setJobMessage('');
      setResultUrl(null);
      setEstimatedCost(null);
    } else {
      cancelledRef.current = false;
    }
  }, [open]);

  // Quando cliente troca idioma, invalida estado pra re-analisar.
  useEffect(() => {
    if (!open) return;
    // Reset do que depende do transcript anterior.
    setTranscriptId(null);
    setSentences([]);
    setSelectedIdxs(new Set());
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenLang]);

  // ─── Auto-analyze on open (submit + poll AssemblyAI) ─────────────────
  useEffect(() => {
    if (!open || !audioUrl || transcriptId) return;
    cancelledRef.current = false;

    const cached = transcriptCache.get(cacheKey(audioUrl, chosenLang));
    if (cached) {
      setTranscriptId(cached);
      return;
    }

    const startTime = Date.now();
    setAnalyzing(true);
    setAnalyzeStatus('Enviando áudio pra análise...');
    setAnalyzeElapsedSec(0);
    setError(null);

    elapsedIntervalRef.current = setInterval(() => {
      setAnalyzeElapsedSec(Math.round((Date.now() - startTime) / 1000));
    }, 1000);

    const submitAndPoll = async () => {
      try {
        // Backend aceita videoUrl OU audioUrl — passa como videoUrl.
        const submitRes = await fetch('/api/assemblyai/analyze/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoUrl: audioUrl, lightweight: true, languageCode: chosenLang }),
        });
        const txt = await submitRes.text();
        let data: any = {};
        try {
          data = JSON.parse(txt);
        } catch {
          throw new Error(
            `Servidor respondeu HTTP ${submitRes.status} non-JSON. Body: ${txt.substring(0, 150)}`
          );
        }
        if (!submitRes.ok) throw new Error(data.error || `HTTP ${submitRes.status}`);
        if (cancelledRef.current) return;
        const tid = data.transcriptId;
        if (!tid) throw new Error('Submit sem transcriptId.');
        setAnalyzeStatus(`Na fila do AssemblyAI... (id: ${tid.substring(0, 8)})`);

        let inFlight = false;
        let done = false;
        const TIMEOUT_MS = 12 * 60_000;
        pollIntervalRef.current = setInterval(async () => {
          if (cancelledRef.current || done || inFlight) return;
          if (Date.now() - startTime > TIMEOUT_MS) {
            done = true;
            stopAnalyze();
            setAnalyzing(false);
            setError('Tempo limite excedido (12min).');
            return;
          }
          inFlight = true;
          try {
            const r = await fetch(`/api/assemblyai/analyze/status/${tid}`);
            const t = await r.text();
            let d: any = {};
            try {
              d = JSON.parse(t);
            } catch {
              throw new Error(`Status non-JSON HTTP ${r.status}`);
            }
            if (cancelledRef.current) return;
            if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
            const status = d.status as string;
            if (status === 'completed') {
              done = true;
              stopAnalyze();
              transcriptCache.set(cacheKey(audioUrl, chosenLang), tid);
              setTranscriptId(tid);
              setAnalyzing(false);
            } else if (status === 'error') {
              done = true;
              stopAnalyze();
              setAnalyzing(false);
              setError(`AssemblyAI: ${d.error || 'sem mensagem'}.`);
            } else {
              setAnalyzeStatus(
                status === 'queued'
                  ? 'Na fila do AssemblyAI...'
                  : `Processando áudio (${status})...`
              );
            }
          } catch (err: any) {
            console.warn('[SegAvatar Poll] tick err:', err.message);
          } finally {
            inFlight = false;
          }
        }, 3000);
      } catch (err: any) {
        if (cancelledRef.current) return;
        stopAnalyze();
        setAnalyzing(false);
        setError(err.message || 'Falha na análise.');
      }
    };

    void submitAndPoll();
    return () => stopAnalyze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, audioUrl, chosenLang]);

  // ─── Quando transcriptId pronto, busca sentences ─────────────────────
  useEffect(() => {
    if (!transcriptId) return;
    let cancelled = false;
    (async () => {
      setLoadingSentences(true);
      try {
        const res = await fetch(`/api/assemblyai/transcript/${transcriptId}/sentences-with-words`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const list: Sentence[] = (data.sentences || []).map((s: any) => ({
          text: String(s.text || ''),
          // Backend retorna `startMs`/`endMs` (não `start`/`end` — esses
          // são os nomes da API raw da AssemblyAI antes do enrichment).
          startMs: Number(s.startMs) || 0,
          endMs: Number(s.endMs) || 0,
        }));
        setSentences(list);
      } catch (err: any) {
        if (!cancelled) setError(`Falha ao buscar frases: ${err.message}`);
      } finally {
        if (!cancelled) setLoadingSentences(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [transcriptId]);

  // ─── Helpers de seleção ──────────────────────────────────────────────
  const toggleSentence = (idx: number) => {
    setSelectedIdxs((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  // Build segments[] a partir das frases selecionadas. Frases consecutivas
  // com gap < 0.5s viram 1 segment só (evita HeyGen call extra + lip-sync
  // mais natural sem corte no meio de uma fala contínua).
  const buildSegments = (): Array<{ startSec: number; endSec: number }> => {
    const picks = Array.from(selectedIdxs)
      .map((i) => sentences[i])
      .filter((s): s is Sentence => !!s)
      .sort((a, b) => a.startMs - b.startMs);
    if (picks.length === 0) return [];

    const merged: Array<{ startSec: number; endSec: number }> = [];
    let cur = { startSec: picks[0]!.startMs / 1000, endSec: picks[0]!.endMs / 1000 };
    for (let i = 1; i < picks.length; i++) {
      const next = picks[i]!;
      const nextStart = next.startMs / 1000;
      const nextEnd = next.endMs / 1000;
      if (nextStart - cur.endSec < 0.5) {
        // Consecutive (or near-consecutive) → extend current segment.
        cur.endSec = nextEnd;
      } else {
        merged.push(cur);
        cur = { startSec: nextStart, endSec: nextEnd };
      }
    }
    merged.push(cur);
    return merged;
  };

  // ─── Polling job HeyGen ──────────────────────────────────────────────
  useEffect(() => {
    if (!jobId || jobStatus === 'completed' || jobStatus === 'failed') return;
    jobPollRef.current = setInterval(async () => {
      try {
        const res = await authedFetch(`/api/heygen/generate-segmented/status/${jobId}`);
        if (!res.ok) return;
        const data = await res.json();
        setJobStatus(data.status);
        setJobProgress(data.progress || 0);
        setJobMessage(data.message || '');
        if (data.status === 'completed' && data.resultUrl) {
          setResultUrl(data.resultUrl);
          onVideoReady(data.resultUrl, data.totalAvatarSec);
          toast.success('Avatar segmentado pronto!');
        } else if (data.status === 'failed') {
          toast.error(`Falhou: ${data.error || 'erro desconhecido'}`, { duration: 12_000 });
        }
      } catch {
        // tick silently
      }
    }, 3000);
    return () => {
      if (jobPollRef.current) clearInterval(jobPollRef.current);
    };
  }, [jobId, jobStatus, onVideoReady]);

  // ─── Submit ──────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    const segments = buildSegments();
    if (segments.length === 0) {
      toast.error('Selecione pelo menos 1 frase pra mostrar o avatar.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await authedFetch('/api/heygen/generate-segmented', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          avatarId,
          audioUrl,
          aspectRatio,
          scale,
          segments,
          title: `Segmented Avatar - ${new Date().toISOString().slice(0, 16)}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setJobId(data.jobId);
      setEstimatedCost(data.estimatedCreditCost);
      setJobStatus('queued');
      setJobProgress(0);
      setJobMessage('Job criado, processando...');
      toast.success(
        `Job criado! ${data.totalAvatarSec.toFixed(1)}s = ${data.estimatedCreditCost} cr`
      );
    } catch (err: any) {
      toast.error(`Falha: ${err.message}`, { duration: 10_000 });
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  // ─── Derived state ───────────────────────────────────────────────────
  const totalAvatarSec = Array.from(selectedIdxs).reduce((acc, idx) => {
    const s = sentences[idx];
    return acc + (s ? (s.endMs - s.startMs) / 1000 : 0);
  }, 0);
  const totalAudioSec = sentences.length > 0 ? sentences[sentences.length - 1]!.endMs / 1000 : 0;
  const avatarPercent = totalAudioSec > 0 ? (totalAvatarSec / totalAudioSec) * 100 : 0;
  const previewCreditCost = Math.max(20, Math.round((totalAvatarSec / 60) * 100));
  const fullCost = 100;
  const savings = fullCost - previewCreditCost;
  const savingsPercent = (savings / fullCost) * 100;
  const mergedSegments = buildSegments();

  const isRendering = jobStatus && jobStatus !== 'completed' && jobStatus !== 'failed';
  const isDone = jobStatus === 'completed' && !!resultUrl;
  const showPicker = !analyzing && !isRendering && !isDone && transcriptId;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={() => !isRendering && onClose()}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-[28px] max-w-3xl w-full max-h-[92vh] overflow-y-auto p-7 space-y-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-2xl font-black text-gray-900 dark:text-gray-50 uppercase italic">
              💰 Avatar Segmentado
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Marca as frases onde o avatar deve aparecer. HeyGen gera SÓ esses trechos (economia
              ~75% pra vídeos com cortes/b-rolls). Resto fica preto, pronto pra Cortes/b-rolls.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={!!isRendering}
            className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 rounded-lg disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        {/* Status do áudio + seletor de idioma */}
        <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
              Áudio
            </div>
            <div className="text-xs text-gray-700 dark:text-gray-300 truncate">
              {audioUrl.split('/').pop()}
            </div>
          </div>
          <div className="shrink-0">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400 block">
              Idioma do áudio
            </label>
            <select
              value={chosenLang}
              onChange={(e) => setChosenLang(e.target.value as 'auto' | 'pt' | 'en' | 'es')}
              disabled={analyzing || !!isRendering}
              className="mt-0.5 px-2 py-1 text-xs font-bold bg-white dark:bg-gray-900 ring-1 ring-gray-200 dark:ring-gray-700 rounded-lg text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-green-500 outline-none disabled:opacity-50"
            >
              <option value="auto">Auto (detectar)</option>
              <option value="pt">Português</option>
              <option value="en">English</option>
              <option value="es">Español</option>
            </select>
          </div>
        </div>

        {/* Analyzing */}
        {analyzing && (
          <div className="p-5 rounded-2xl bg-blue-50 dark:bg-blue-950/30 ring-1 ring-blue-200/60 dark:ring-blue-800/40 flex items-center gap-3">
            <Loader2 className="animate-spin text-blue-600 dark:text-blue-300" size={20} />
            <div className="flex-1">
              <p className="text-xs font-black uppercase tracking-widest text-blue-700 dark:text-blue-300">
                Analisando áudio
              </p>
              <p className="text-sm text-blue-900 dark:text-blue-100">{analyzeStatus}</p>
            </div>
            <span className="text-lg font-black text-blue-700 dark:text-blue-200 tabular-nums">
              {analyzeElapsedSec}s
            </span>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 ring-1 ring-red-200/60 dark:ring-red-800/40 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Lista de frases (depois do transcript) */}
        {showPicker && (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300">
                  Frases do áudio ({sentences.length})
                </h4>
                <span className="text-[10px] text-gray-500 dark:text-gray-400">
                  Selecionadas: {selectedIdxs.size}
                </span>
              </div>
              {loadingSentences ? (
                <div className="flex items-center justify-center py-6 text-purple-600 dark:text-purple-400 text-xs gap-2">
                  <Loader2 className="animate-spin" size={14} />
                  Carregando frases...
                </div>
              ) : sentences.length === 0 ? (
                <p className="text-center text-xs text-gray-500 dark:text-gray-400 py-4">
                  Nenhuma frase detectada no áudio.
                </p>
              ) : (
                <ul className="space-y-1 max-h-72 overflow-y-auto pr-1">
                  {sentences.map((s, idx) => {
                    const selected = selectedIdxs.has(idx);
                    const durSec = (s.endMs - s.startMs) / 1000;
                    return (
                      <li
                        key={idx}
                        className={`flex items-start gap-2 p-2.5 rounded-lg transition-colors ${
                          selected
                            ? 'bg-green-50 dark:bg-green-950/30 ring-1 ring-green-300 dark:ring-green-700/60'
                            : 'bg-gray-50 dark:bg-gray-800/40 hover:bg-gray-100 dark:hover:bg-gray-800/70'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => toggleSentence(idx)}
                          className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                            selected
                              ? 'bg-green-600 text-white'
                              : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 ring-1 ring-gray-200 dark:ring-gray-700 hover:bg-green-50 dark:hover:bg-green-950/40'
                          }`}
                          title={selected ? 'Remover seleção' : 'Adicionar como avatar'}
                        >
                          {selected ? <Trash2 size={12} /> : <Plus size={14} />}
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-900 dark:text-gray-100 leading-snug">
                            {s.text}
                          </p>
                          <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 tabular-nums">
                            {formatTime(s.startMs / 1000)} → {formatTime(s.endMs / 1000)} ·{' '}
                            {durSec.toFixed(1)}s
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Estimativa */}
            {selectedIdxs.size > 0 && (
              <div className="p-4 rounded-2xl bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 ring-1 ring-green-200/60 dark:ring-green-800/40 space-y-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-[11px] font-black uppercase tracking-widest text-green-700 dark:text-green-300">
                    Avatar visível
                  </span>
                  <span className="text-lg font-black text-green-700 dark:text-green-200 tabular-nums">
                    {totalAvatarSec.toFixed(1)}s ({avatarPercent.toFixed(0)}%)
                  </span>
                </div>
                <div className="flex items-baseline justify-between text-xs text-gray-600 dark:text-gray-400">
                  <span>Frases consecutivas serão fundidas em 1 segmento HeyGen</span>
                  <span className="font-bold text-gray-900 dark:text-gray-100">
                    {mergedSegments.length} chamada(s)
                  </span>
                </div>
                <div className="flex items-baseline justify-between text-sm pt-1">
                  <span className="text-gray-600 dark:text-gray-400">Custo (créditos)</span>
                  <span className="font-bold text-gray-900 dark:text-gray-100">
                    {previewCreditCost}{' '}
                    <span className="text-[10px] text-gray-500 dark:text-gray-400 font-normal">
                      vs {fullCost} (full)
                    </span>
                  </span>
                </div>
                {savings > 0 && (
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-emerald-700 dark:text-emerald-300 font-bold">
                      Economia
                    </span>
                    <span className="font-black text-emerald-700 dark:text-emerald-300">
                      -{savings} cr ({savingsPercent.toFixed(0)}%)
                    </span>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Rendering */}
        {isRendering && (
          <div className="p-5 rounded-2xl bg-blue-50 dark:bg-blue-950/30 ring-1 ring-blue-200/60 dark:ring-blue-800/40 space-y-3">
            <div className="flex items-center gap-3">
              <Loader2 className="animate-spin text-blue-600 dark:text-blue-300" size={20} />
              <div className="flex-1">
                <p className="text-xs font-black uppercase tracking-widest text-blue-700 dark:text-blue-300">
                  {jobStatus}
                </p>
                <p className="text-sm text-blue-900 dark:text-blue-100">{jobMessage}</p>
              </div>
              <span className="text-2xl font-black text-blue-700 dark:text-blue-200 tabular-nums">
                {Math.round(jobProgress * 100)}%
              </span>
            </div>
            <div className="w-full bg-blue-100 dark:bg-blue-900/40 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all"
                style={{ width: `${jobProgress * 100}%` }}
              />
            </div>
            <p className="text-[10px] text-blue-600/80 dark:text-blue-300/70">
              HeyGen renderiza cada pedaço em paralelo. Não feche.
            </p>
          </div>
        )}

        {/* Done */}
        {isDone && resultUrl && (
          <div className="p-4 rounded-2xl bg-green-50 dark:bg-green-950/30 ring-1 ring-green-200/60 dark:ring-green-800/40 space-y-3">
            <p className="text-[11px] font-black uppercase tracking-widest text-green-700 dark:text-green-300">
              ✅ Pronto
            </p>
            <video src={resultUrl} controls className="w-full rounded-lg" />
            <p className="text-[10px] text-green-700 dark:text-green-300">
              Custo final: {estimatedCost} créditos.
            </p>
          </div>
        )}

        {/* Ações */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            disabled={!!isRendering}
            className="flex-1 py-3 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            {isDone ? 'Fechar' : 'Cancelar'}
          </button>
          {showPicker && (
            <button
              onClick={handleGenerate}
              disabled={submitting || selectedIdxs.size === 0 || totalAvatarSec < 1.5}
              className="flex-1 py-3 bg-gradient-to-br from-green-500 to-emerald-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:from-green-600 hover:to-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />}
              Gerar Avatar
              {selectedIdxs.size > 0 && ` (${previewCreditCost} cr)`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
