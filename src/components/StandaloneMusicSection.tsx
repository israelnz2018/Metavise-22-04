import { useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Download, Loader2, Music, Save, Sparkles, Trash2, Upload, Wand2, X } from 'lucide-react';
import type { MusicTrack } from '@/types/project';
import { addToMusicLibrary } from '@/lib/musicLibrary';
import {
  STYLE_OPTIONS,
  ENERGY_OPTIONS,
  TEMPO_OPTIONS,
  INSTRUMENT_OPTIONS,
  formatRelativeDate,
  formatBytes,
} from '@/lib/musicPresets';

// Gera (ou envia) uma música SEM precisar de um vídeo editado — ao contrário
// da MusicSection (que mixa direto num vídeo-alvo), esta seção só cuida de
// criar a faixa e deixá-la pronta pra baixar/salvar. Escreve na MESMA lista
// de músicas do subprojeto (tracks/onTracksChange) que a MusicSection lê, então
// a faixa fica disponível pra mixar depois assim que houver um vídeo.

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

interface Props {
  /** Músicas DESTE subprojeto (persistidas em config.edit.musicTracks) —
   *  compartilhada com a MusicSection, que mixa essas mesmas faixas num vídeo. */
  tracks: MusicTrack[];
  onTracksChange: (tracks: MusicTrack[]) => void;
  userId: string | undefined;
  /** Copy/roteiro aprovado — alimenta o "arco emocional" da trilha. */
  copyText?: string;
  projectContext?: {
    productInfo?: any;
    personas?: any[] | null;
    marketingPlan?: any;
    creativeBriefs?: any[] | null;
  };
  disabled?: boolean;
  /** Quando a MusicSection (com vídeo) já está visível acima mostrando esta
   *  MESMA lista de tracks, esconde a lista aqui pra não duplicar em tela. */
  hideOwnTrackList?: boolean;
}

export function StandaloneMusicSection({
  tracks,
  onTracksChange,
  userId,
  copyText,
  projectContext,
  disabled,
  hideOwnTrackList,
}: Props) {
  const [source, setSource] = useState<'upload' | 'ai'>('ai');
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);

  // AI generation controls — iguais à MusicSection, mas duração é sempre
  // manual (não há vídeo pra sincronizar).
  const [prompt, setPrompt] = useState('');
  const [lengthSec, setLengthSec] = useState(30);
  const [styleId, setStyleId] = useState('cinematic');
  const [energyId, setEnergyId] = useState('media');
  const [tempoId, setTempoId] = useState('medio');
  const [instrumentIds, setInstrumentIds] = useState<string[]>([]);
  const [recommending, setRecommending] = useState(false);
  const [recReason, setRecReason] = useState('');

  // Arco emocional (a música acompanha a copy) — não depende de vídeo.
  const [useArc, setUseArc] = useState(false);
  const [arcPlan, setArcPlan] = useState<MusicArcPlan | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const [savingId, setSavingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isBusy = uploading || generating || !!disabled;

  const canRecommend =
    !!copyText || !!projectContext?.productInfo || (projectContext?.personas?.length || 0) > 0;

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
    setInstrumentIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  function addTrack(input: Omit<MusicTrack, 'id' | 'createdAt'>): MusicTrack {
    const track: MusicTrack = {
      ...input,
      id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
    };
    onTracksChange([track, ...tracks]);
    return track;
  }

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
          totalDurationSec: lengthSec,
          dominantEmotion: '',
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

  const updateArcSection = (idx: number, patch: Partial<MusicArcSection>) => {
    setArcPlan((cur) => {
      if (!cur) return cur;
      return { ...cur, sections: cur.sections.map((s, i) => (i === idx ? { ...s, ...patch } : s)) };
    });
  };
  const removeArcSection = (idx: number) => {
    setArcPlan((cur) => {
      if (!cur || cur.sections.length <= 2) return cur;
      return { ...cur, sections: cur.sections.filter((_, i) => i !== idx) };
    });
  };

  const handleFileSelected = async (file: File) => {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      toast.error('Música muito grande (>25MB). Comprime ela primeiro.');
      return;
    }
    setUploading(true);
    try {
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

  const handleGenerateAI = async () => {
    const usingArc = useArc && !!arcPlan && arcPlan.sections.length > 0;
    if (
      !usingArc &&
      !buildSimplePrompt()
        .replace(/instrumental, no vocals,?/, '')
        .trim()
    ) {
      toast.error('Escolha estilo/instrumentos ou descreva a música.');
      return;
    }
    const body: Record<string, any> = usingArc
      ? { compositionPlan: arcPlan, forceInstrumental: true }
      : { prompt: buildSimplePrompt(), lengthMs: lengthSec * 1000, forceInstrumental: true };
    setGenerating(true);
    try {
      const res = await fetch('/api/elevenlabs/music/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
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
      addTrack({
        url: data.audioUrl,
        label,
        source: 'ai',
        prompt: usingArc ? undefined : buildSimplePrompt(),
        lengthMs: usingArc
          ? arcPlan!.sections.reduce((s, x) => s + (x.durationMs || 0), 0)
          : lengthSec * 1000,
        sizeBytes: typeof data.sizeBytes === 'number' ? data.sizeBytes : undefined,
      });
      toast.success('Música gerada — já dá pra baixar aqui embaixo.');
    } catch (err: any) {
      toast.error(`Falha ao gerar: ${err.message}`, { duration: 10_000 });
    } finally {
      setGenerating(false);
    }
  };

  async function saveTrackToLibrary(track: MusicTrack) {
    if (!userId) {
      toast.error('Login expirado. Recarregue a página.');
      return;
    }
    setSavingId(track.id);
    try {
      await addToMusicLibrary(userId, track);
      toast.success('Música salva na biblioteca — disponível em todos os projetos.');
    } catch (err: any) {
      toast.error(`Erro ao salvar: ${err.message}`);
    } finally {
      setSavingId(null);
    }
  }

  function removeTrack(track: MusicTrack) {
    if (!confirm(`Remover "${track.label}" deste subprojeto?`)) return;
    onTracksChange(tracks.filter((t) => t.id !== track.id));
    toast.success('Música removida do subprojeto.');
  }

  return (
    <div className="bg-white dark:bg-gray-900/80 p-6 md:p-8 rounded-[32px] border-2 border-gray-200 dark:border-gray-800 shadow-sm space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center text-white">
          <Music size={20} />
        </div>
        <div>
          <h4 className="text-lg font-black text-gray-900 dark:text-gray-50">
            Música avulsa (sem vídeo)
          </h4>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Gera ou envia uma trilha independente de qualquer vídeo — baixa direto ou deixa salva
            pra mixar depois.
          </p>
        </div>
      </div>

      {/* Fonte */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setSource('upload')}
          disabled={isBusy}
          className={`flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
            source === 'upload'
              ? 'bg-teal-600 text-white shadow-md'
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
              ? 'bg-teal-600 text-white shadow-md'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200'
          }`}
        >
          <Sparkles size={14} />
          Gerar com IA
        </button>
      </div>

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
            className="w-full p-6 border-2 border-dashed border-teal-300 dark:border-teal-800/60 rounded-2xl text-teal-700 dark:text-teal-300 hover:border-teal-500 hover:bg-teal-50 dark:hover:bg-teal-950/30 transition-all flex flex-col items-center gap-2 disabled:opacity-50"
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
        <div className="space-y-4 p-4 bg-teal-50/60 dark:bg-teal-950/30 rounded-2xl ring-1 ring-teal-200/60 dark:ring-teal-800/40">
          <div className="rounded-2xl bg-gradient-to-br from-teal-100 to-cyan-100 dark:from-teal-900/40 dark:to-cyan-900/30 p-3 ring-1 ring-teal-200/60 dark:ring-teal-800/40 space-y-2">
            <button
              type="button"
              onClick={handleRecommend}
              disabled={isBusy || recommending || !canRecommend}
              className="w-full py-2.5 bg-gradient-to-br from-teal-600 to-cyan-600 text-white rounded-xl text-[11px] font-black uppercase tracking-widest hover:from-teal-700 hover:to-cyan-700 disabled:opacity-50 flex items-center justify-center gap-2"
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
            {recReason && (
              <p className="text-[11px] text-teal-900 dark:text-teal-200 bg-white/60 dark:bg-gray-900/40 rounded-lg p-2 leading-snug">
                💡 {recReason}
              </p>
            )}
            {!canRecommend && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400">
                Gere a copy/personas do projeto pra liberar a recomendação.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase tracking-widest text-teal-700 dark:text-teal-300">
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
                      ? 'bg-teal-600 text-white shadow-sm'
                      : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-teal-100 dark:hover:bg-teal-900/40'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-black uppercase tracking-widest text-teal-700 dark:text-teal-300">
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
                        ? 'bg-teal-600 text-white'
                        : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-teal-100 dark:hover:bg-teal-900/40'
                    }`}
                  >
                    {e.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-black uppercase tracking-widest text-teal-700 dark:text-teal-300">
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
                        ? 'bg-teal-600 text-white'
                        : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-teal-100 dark:hover:bg-teal-900/40'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase tracking-widest text-teal-700 dark:text-teal-300">
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
                      ? 'bg-teal-600 text-white shadow-sm'
                      : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-teal-100 dark:hover:bg-teal-900/40'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase tracking-widest text-teal-700 dark:text-teal-300">
              Detalhes extras (opcional)
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="ex: clima esperançoso, build crescente no final"
              rows={2}
              disabled={isBusy}
              className="w-full p-3 bg-white dark:bg-gray-900 ring-1 ring-teal-200/60 dark:ring-teal-800/40 rounded-xl text-sm focus:ring-2 focus:ring-teal-500 outline-none resize-none dark:text-gray-100"
            />
          </div>

          {/* Duração — sempre manual (sem vídeo pra sincronizar) */}
          <div className="space-y-2">
            <label className="text-[11px] font-black uppercase tracking-widest text-teal-700 dark:text-teal-300">
              Duração
            </label>
            <div className="text-[11px] text-gray-600 dark:text-gray-400">{lengthSec}s</div>
            <input
              type="range"
              min={3}
              max={120}
              value={lengthSec}
              onChange={(e) => setLengthSec(parseInt(e.target.value))}
              disabled={isBusy}
              className="w-full accent-teal-600"
            />
            <p className="text-[10px] text-teal-600/80 dark:text-teal-300/70">
              Mais longo = mais créditos ElevenLabs.
            </p>
          </div>

          {/* Arco emocional */}
          <div className="rounded-2xl border-2 border-teal-200 dark:border-teal-800/50 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 bg-teal-100/70 dark:bg-teal-900/30">
              <label className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-teal-800 dark:text-teal-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useArc}
                  onChange={(e) => setUseArc(e.target.checked)}
                  disabled={isBusy}
                  className="accent-teal-600"
                />
                <Wand2 size={14} />
                Arco emocional (segue a copy)
              </label>
            </div>
            {useArc && (
              <div className="p-3 bg-white dark:bg-gray-900/40 space-y-3">
                <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
                  A IA lê a copy do anúncio e propõe uma trilha que segue o arco emocional. Você
                  revisa antes de gerar.
                </p>
                <button
                  type="button"
                  onClick={handleAnalyzeCopy}
                  disabled={isBusy || analyzing || !copyText}
                  className="w-full py-2.5 bg-white dark:bg-gray-800 border-2 border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-300 rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-teal-50 dark:hover:bg-teal-950/40 disabled:opacity-50 flex items-center justify-center gap-2"
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
                {arcPlan && arcPlan.sections.length > 0 && (
                  <div className="space-y-2">
                    {arcPlan.sections.map((sec, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-xl bg-teal-50/70 dark:bg-teal-950/30 ring-1 ring-teal-200/60 dark:ring-teal-800/40 space-y-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="shrink-0 w-5 h-5 rounded-full bg-teal-600 text-white text-[10px] font-black flex items-center justify-center">
                            {idx + 1}
                          </span>
                          <input
                            value={sec.sectionName}
                            onChange={(e) => updateArcSection(idx, { sectionName: e.target.value })}
                            disabled={isBusy}
                            className="flex-1 px-2 py-1 bg-white dark:bg-gray-900 rounded-lg text-xs font-bold dark:text-gray-100 ring-1 ring-teal-200/60 dark:ring-teal-800/40 focus:ring-2 focus:ring-teal-500 outline-none"
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
                                    Math.max(3, Math.min(120, parseInt(e.target.value) || 3)) *
                                    1000,
                                })
                              }
                              disabled={isBusy}
                              className="w-14 px-2 py-1 bg-white dark:bg-gray-900 rounded-lg text-xs text-center dark:text-gray-100 ring-1 ring-teal-200/60 dark:ring-teal-800/40 focus:ring-2 focus:ring-teal-500 outline-none"
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
                          className="w-full px-2 py-1 bg-white dark:bg-gray-900 rounded-lg text-[11px] dark:text-gray-100 ring-1 ring-teal-200/60 dark:ring-teal-800/40 focus:ring-2 focus:ring-teal-500 outline-none"
                        />
                      </div>
                    ))}
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 text-right">
                      Total:{' '}
                      {Math.round(arcPlan.sections.reduce((a, s) => a + s.durationMs, 0) / 1000)}s
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
            className="w-full py-3 bg-gradient-to-br from-teal-500 to-cyan-500 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:from-teal-600 hover:to-cyan-600 disabled:opacity-50 flex items-center justify-center gap-2"
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

      {/* Lista de músicas deste subprojeto — só aqui quando não há vídeo
          editado ainda (senão a MusicSection acima já mostra a mesma lista). */}
      {!hideOwnTrackList && tracks.length > 0 && (
        <div className="rounded-2xl border-2 border-teal-100 dark:border-teal-900/50 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-teal-50/60 dark:bg-teal-950/30 text-[11px] font-black uppercase tracking-widest text-teal-700 dark:text-teal-300">
            <Music size={14} />
            Músicas deste subprojeto
            <span className="ml-1 px-2 py-0.5 rounded-full bg-teal-200 dark:bg-teal-800 text-teal-900 dark:text-teal-100 text-[10px]">
              {tracks.length}
            </span>
          </div>
          <div className="p-3 bg-white dark:bg-gray-900/40 max-h-72 overflow-y-auto">
            <ul className="space-y-2">
              {tracks.map((track) => (
                <li
                  key={track.id}
                  className="p-3 rounded-xl border bg-gray-50 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700"
                >
                  <div className="flex items-start gap-2">
                    <div
                      className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center ${
                        track.source === 'ai'
                          ? 'bg-gradient-to-br from-teal-500 to-cyan-500 text-white'
                          : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                      }`}
                      title={track.source === 'ai' ? 'Gerada por IA' : 'Upload'}
                    >
                      {track.source === 'ai' ? <Sparkles size={14} /> : <Upload size={14} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-xs font-bold text-gray-900 dark:text-gray-100 truncate"
                        title={track.label}
                      >
                        {track.label}
                      </p>
                      <p className="text-[10px] text-gray-500 dark:text-gray-400">
                        {track.createdAt ? formatRelativeDate(track.createdAt) : ''}
                        {track.sizeBytes ? ` · ${formatBytes(track.sizeBytes)}` : ''}
                      </p>
                      <audio src={track.url} controls className="w-full mt-1.5 h-7" />
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <a
                      href={track.url}
                      download={track.originalFileName || `${track.label}.mp3`}
                      className="flex-1 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-teal-600 text-white hover:bg-teal-700 flex items-center justify-center gap-1.5"
                    >
                      <Download size={12} />
                      Baixar
                    </a>
                    <button
                      type="button"
                      onClick={() => saveTrackToLibrary(track)}
                      disabled={isBusy || savingId === track.id}
                      title="Salvar na biblioteca (todos os projetos)"
                      className="px-3 py-1.5 rounded-lg text-teal-600 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/40 transition-colors disabled:opacity-50"
                    >
                      {savingId === track.id ? (
                        <Loader2 className="animate-spin" size={13} />
                      ) : (
                        <Save size={13} />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeTrack(track)}
                      disabled={isBusy}
                      title="Remover do subprojeto"
                      className="px-3 py-1.5 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {hideOwnTrackList && tracks.length > 0 && (
        <p className="text-[11px] text-gray-400 dark:text-gray-500 text-center">
          Suas músicas geradas aparecem na lista "Músicas deste subprojeto" acima.
        </p>
      )}
    </div>
  );
}
