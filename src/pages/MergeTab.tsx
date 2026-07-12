import { useEffect, useMemo, useRef, useState } from 'react';
import type { AdConfig } from '@/App';
import { toast } from 'react-hot-toast';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage, auth } from '@/lib/firebase';
import { Scissors, Plus, X, Loader2, Upload, Film, Download, Check, Trash2 } from 'lucide-react';

interface Props {
  config: AdConfig;
  setConfig: React.Dispatch<React.SetStateAction<AdConfig>>;
  user: any;
}

interface Source {
  url: string;
  label: string;
}
interface Segment {
  id: string;
  startSec: number;
  endSec: number;
  sourceIdx: number;
}

let _seg = 0;
const newId = () => `seg_${++_seg}_${Math.round(Math.random() * 1e6)}`;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${Math.floor((s % 1) * 10)}`;

export function MergeTab({ config, setConfig, user }: Props) {
  // Vídeos já renderizados que podem virar fonte (galeria) + vídeos do projeto.
  const galleryUrls = useMemo(() => {
    const e: any = config.edit || {};
    const urls = [
      ...(((e.zapVersions as string[]) || [])),
      ...(((e.zapJoinedVersions as string[]) || [])),
      ...(((e.mergeVersions as string[]) || [])),
      ...(((config.videos as any[]) || []).map((v) => v?.url).filter(Boolean)),
    ];
    return [...new Set(urls.filter(Boolean))] as string[];
  }, [config]);

  // Restaura o rascunho salvo (fontes + cortes), se houver.
  const draft: any = (config.edit as any)?.mergeDraft || {};
  const [sources, setSources] = useState<Source[]>(() =>
    Array.isArray(draft.sources) ? draft.sources : []
  );
  const [duration, setDuration] = useState(0);
  const [segments, setSegments] = useState<Segment[]>(() =>
    Array.isArray(draft.segments)
      ? draft.segments.map((s: any) => ({
          id: newId(),
          startSec: Number(s.startSec) || 0,
          endSec: Number(s.endSec) || 0,
          sourceIdx: Number(s.sourceIdx) || 0,
        }))
      : []
  );
  const [previewIdx, setPreviewIdx] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Salva o rascunho no config sempre que mudar (pra "Salvar" do projeto guardar
  // e reabrir igual). Só grava os campos serializáveis dos trechos.
  useEffect(() => {
    if (sources.length === 0 && segments.length === 0) return;
    setConfig(
      (prev) =>
        ({
          ...prev,
          edit: {
            ...((prev.edit as any) || {}),
            mergeDraft: {
              sources,
              segments: segments.map(({ startSec, endSec, sourceIdx }) => ({
                startSec,
                endSec,
                sourceIdx,
              })),
            },
          },
        }) as any
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, segments]);

  const addSource = (url: string) =>
    setSources((prev) =>
      prev.find((s) => s.url === url) ? prev : [...prev, { url, label: `Vídeo ${prev.length + 1}` }]
    );
  const removeSource = (url: string) => {
    setSources((prev) => prev.filter((s) => s.url !== url));
    setSegments([]);
    setDuration(0);
    setPreviewIdx(0);
  };

  const onMeta = () => {
    const v = videoRef.current;
    if (!v || !isFinite(v.duration) || v.duration <= 0) return;
    if (duration === 0) {
      setDuration(v.duration);
      // só cria o trecho inicial se ainda não há cortes (não sobrescreve o restaurado).
      if (segments.length === 0) {
        setSegments([{ id: newId(), startSec: 0, endSec: v.duration, sourceIdx: 0 }]);
      }
    }
  };

  const switchPreview = (i: number) => {
    const t = videoRef.current?.currentTime || 0;
    setPreviewIdx(i);
    // após trocar o src, volta pro mesmo instante pra comparar a mesma cena.
    setTimeout(() => {
      if (videoRef.current) videoRef.current.currentTime = t;
    }, 150);
  };

  const cutHere = () => {
    const t = videoRef.current?.currentTime ?? currentTime;
    if (t <= 0.05 || t >= duration - 0.05) return;
    setSegments((prev) => {
      const out: Segment[] = [];
      for (const s of prev) {
        if (t > s.startSec + 0.05 && t < s.endSec - 0.05) {
          out.push({ ...s, endSec: t });
          out.push({ id: newId(), startSec: t, endSec: s.endSec, sourceIdx: s.sourceIdx });
        } else out.push(s);
      }
      return out;
    });
  };

  const setSegSource = (id: string, idx: number) =>
    setSegments((prev) => prev.map((s) => (s.id === id ? { ...s, sourceIdx: idx } : s)));

  // Edita o limite (fim de um trecho = início do próximo). Mantém contíguo e
  // dentro dos vizinhos. O último trecho termina sempre na duração.
  const setBoundary = (segIndex: number, newEnd: number) => {
    setSegments((prev) => {
      if (segIndex < 0 || segIndex >= prev.length - 1) return prev;
      const cur = prev[segIndex]!;
      const next = prev[segIndex + 1]!;
      const v = Math.max(cur.startSec + 0.1, Math.min(newEnd, next.endSec - 0.1));
      const out = [...prev];
      out[segIndex] = { ...cur, endSec: v };
      out[segIndex + 1] = { ...next, startSec: v };
      return out;
    });
  };

  const removeCut = (id: string) =>
    setSegments((prev) => {
      if (prev.length <= 1) return prev; // tem que sobrar pelo menos 1 trecho
      const i = prev.findIndex((s) => s.id === id);
      if (i < 0) return prev;
      const out = [...prev];
      if (i < out.length - 1) {
        // o trecho de DEPOIS (mais tarde) tapa o buraco — preserva os anteriores
        // que você já escolheu/trabalhou.
        out[i + 1] = { ...out[i + 1]!, startSec: out[i]!.startSec };
      } else {
        // é o último: só o anterior pode cobrir o tempo.
        out[i - 1] = { ...out[i - 1]!, endSec: out[i]!.endSec };
      }
      out.splice(i, 1);
      return out;
    });

  const onUpload = async (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      toast.error('Selecione um arquivo de vídeo.');
      return;
    }
    const uid = user?.uid || auth.currentUser?.uid;
    if (!uid) {
      toast.error('Faça login pra enviar vídeo.');
      return;
    }
    setUploading(true);
    try {
      const safe = file.name.replace(/[^a-z0-9.-]/gi, '_');
      const r = ref(storage, `video/${uid}/merge-upload/${Date.now()}-${safe}`);
      await uploadBytes(r, file, { contentType: file.type || 'video/mp4' });
      addSource(await getDownloadURL(r));
      toast.success('Vídeo enviado e adicionado.');
    } catch (e: any) {
      toast.error(e?.message || 'Falha no upload.');
    } finally {
      setUploading(false);
    }
  };

  const generate = async () => {
    const uid = user?.uid || auth.currentUser?.uid;
    if (!uid || sources.length === 0 || segments.length === 0) return;
    setRendering(true);
    setError(null);
    try {
      const r = await fetch('/api/video/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videos: sources.map((s) => s.url),
          userId: uid,
          segments: segments.map((s) => ({
            sourceIndex: s.sourceIdx,
            startSec: s.startSec,
            endSec: s.endSec,
          })),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Falha ao gerar o vídeo.');
      setConfig(
        (prev) =>
          ({
            ...prev,
            edit: {
              ...((prev.edit as any) || {}),
              mergeVersions: [...(((prev.edit as any)?.mergeVersions as string[]) || []), data.url],
            },
          }) as any
      );
      toast.success('Vídeo mesclado gerado!');
    } catch (e: any) {
      setError(e?.message || 'Erro ao gerar.');
    } finally {
      setRendering(false);
    }
  };

  // Remove um vídeo mesclado da lista (config). O arquivo continua no Storage;
  // some do projeto ao salvar.
  const removeResult = (url: string) => {
    if (!window.confirm('Remover este vídeo mesclado da lista?')) return;
    setConfig(
      (prev) =>
        ({
          ...prev,
          edit: {
            ...((prev.edit as any) || {}),
            mergeVersions: (((prev.edit as any)?.mergeVersions as string[]) || []).filter(
              (u) => u !== url
            ),
          },
        }) as any
    );
    toast.success('Removido da lista. Salve o projeto pra confirmar.');
  };

  const canGenerate = sources.length > 0 && segments.length > 0 && duration > 0 && !rendering;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <header className="space-y-1">
        <h2 className="text-3xl font-black text-gray-900 dark:text-gray-50 tracking-tight flex items-center gap-2">
          <Scissors size={26} className="text-blue-600 dark:text-blue-400" />
          Mesclar vídeos
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 max-w-2xl">
          Junte os melhores pedaços de vídeos <strong>alinhados</strong> (mesma duração e áudio).
          Escolha, em cada trecho, de qual vídeo a imagem vem — o áudio sai inteiro do 1º. Resultado:
          um vídeo novo com o melhor de cada.
        </p>
      </header>

      {/* Fontes: galeria + upload */}
      <div className="bg-white/80 dark:bg-gray-900/60 ring-1 ring-gray-200/60 dark:ring-gray-800/60 rounded-3xl p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-black uppercase text-xs tracking-widest text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <Film size={16} /> Vídeos fonte ({sources.length})
          </h3>
          <label className="text-[10px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300 hover:underline cursor-pointer flex items-center gap-1">
            {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            Enviar vídeo
            <input
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => onUpload(e.target.files?.[0])}
            />
          </label>
        </div>

        {/* selecionados */}
        {sources.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {sources.map((s, i) => (
              <span
                key={s.url}
                className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300"
              >
                {s.label}
                {i === 0 && <span className="text-[9px] opacity-70">(áudio)</span>}
                <button onClick={() => removeSource(s.url)} className="hover:text-red-500">
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* galeria pra adicionar */}
        {galleryUrls.filter((u) => !sources.find((s) => s.url === u)).length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-gray-400 font-bold mb-1.5">
              Da galeria (renderizados)
            </p>
            <div className="flex flex-wrap gap-2">
              {galleryUrls
                .filter((u) => !sources.find((s) => s.url === u))
                .map((u, i) => (
                  <button
                    key={u}
                    onClick={() => addSource(u)}
                    className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-lg ring-1 ring-gray-200 dark:ring-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
                  >
                    <Plus size={12} /> Versão {i + 1}
                  </button>
                ))}
            </div>
          </div>
        )}
        {sources.length === 0 && galleryUrls.length === 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Nenhum vídeo renderizado ainda. Envie vídeos pelo botão acima.
          </p>
        )}
      </div>

      {/* Editor: preview + cortes */}
      {sources.length > 0 && (
        <div className="bg-white/80 dark:bg-gray-900/60 ring-1 ring-gray-200/60 dark:ring-gray-800/60 rounded-3xl p-5 space-y-4">
          <video
            ref={videoRef}
            src={sources[previewIdx]?.url}
            controls
            onLoadedMetadata={onMeta}
            onTimeUpdate={(e) => setCurrentTime((e.target as HTMLVideoElement).currentTime)}
            className="w-full max-h-[420px] rounded-2xl bg-black"
          />

          {/* comparar fonte na mesma cena */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">
              Comparar fonte:
            </span>
            {sources.map((s, i) => (
              <button
                key={s.url}
                onClick={() => switchPreview(i)}
                className={`text-xs font-bold px-2.5 py-1 rounded-lg ${
                  previewIdx === i
                    ? 'bg-blue-600 text-white'
                    : 'ring-1 ring-gray-200 dark:ring-gray-700 text-gray-700 dark:text-gray-300'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* cortar */}
          <div className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-gray-50 dark:bg-gray-800/40">
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Tempo atual: <strong>{fmt(currentTime)}</strong>
            </span>
            <button
              onClick={cutHere}
              className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-black uppercase tracking-widest flex items-center gap-1.5"
            >
              <Scissors size={14} /> Cortar aqui
            </button>
          </div>

          {/* trechos */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300">
              Trechos ({segments.length})
            </p>
            {segments.map((seg, i) => (
              <div
                key={seg.id}
                className="flex items-center gap-2 p-2 rounded-xl bg-gray-50 dark:bg-gray-800/40 ring-1 ring-gray-200/60 dark:ring-gray-700/60 text-sm"
              >
                <span className="text-xs font-black text-gray-400 tabular-nums w-6">#{i + 1}</span>
                <span className="text-xs tabular-nums text-gray-500 w-12 text-right">
                  {seg.startSec.toFixed(1)}s
                </span>
                <span className="text-gray-400 text-xs">–</span>
                {i < segments.length - 1 ? (
                  <input
                    type="number"
                    step={0.1}
                    min={0}
                    value={Number(seg.endSec.toFixed(2))}
                    onChange={(e) => setBoundary(i, Number(e.target.value))}
                    className="w-16 px-1.5 py-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-center text-xs dark:text-gray-100"
                    title="Fim deste trecho (= início do próximo). Edite à mão."
                  />
                ) : (
                  <span className="text-xs tabular-nums text-gray-500 w-16 text-center">
                    {seg.endSec.toFixed(1)}s
                  </span>
                )}
                <label className="text-[11px] text-gray-500 dark:text-gray-400">vem do</label>
                <select
                  value={seg.sourceIdx}
                  onChange={(e) => setSegSource(seg.id, Number(e.target.value))}
                  className="text-xs font-bold px-2 py-1 rounded-lg border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100"
                >
                  {sources.map((s, idx) => (
                    <option key={s.url} value={idx}>
                      {s.label}
                    </option>
                  ))}
                </select>
                {segments.length > 1 && (
                  <button
                    onClick={() => removeCut(seg.id)}
                    className="ml-auto p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                    title="Remover este trecho (o trecho seguinte tapa o buraco)"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {error && (
            <p className="text-xs text-amber-700 dark:text-amber-300 font-bold">{error}</p>
          )}

          <button
            onClick={generate}
            disabled={!canGenerate}
            className="w-full py-4 bg-gray-900 dark:bg-gray-50 text-white dark:text-gray-900 rounded-2xl font-black uppercase tracking-widest text-sm hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {rendering ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Gerando vídeo mesclado…
              </>
            ) : (
              <>
                <Check size={16} /> Gerar vídeo mesclado
              </>
            )}
          </button>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 text-center">
            O preview mostra cada fonte separada; o resultado costurado sai depois de gerar.
          </p>
        </div>
      )}

      {/* resultados gerados — lidos do config (persistem no Salvar/recarregar) */}
      {(((config.edit as any)?.mergeVersions as string[]) || []).length > 0 && (
        <div className="bg-green-50 dark:bg-green-950/20 ring-1 ring-green-200 dark:ring-green-800/40 rounded-3xl p-5 space-y-4">
          <h3 className="font-black uppercase text-xs tracking-widest text-green-700 dark:text-green-300 flex items-center gap-2">
            <Check size={16} /> Vídeos mesclados gerados (salvos)
          </h3>
          {[...(((config.edit as any)?.mergeVersions as string[]) || [])]
            .reverse()
            .map((u, i, arr) => (
              <div key={u} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-bold text-gray-600 dark:text-gray-400">
                    Mesclado #{arr.length - i}
                  </p>
                  <button
                    onClick={() => removeResult(u)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                    title="Remover este vídeo da lista"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <video src={u} controls className="w-full max-h-[420px] rounded-2xl bg-black" />
                <a
                  href={u}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-blue-700 dark:text-blue-300 hover:underline"
                >
                  <Download size={14} /> Baixar / abrir
                </a>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
