import { useMemo, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage, auth } from '@/lib/firebase';
import { Loader2, Upload, Play, Trash2, X, Music, Scissors } from 'lucide-react';
import { useSoundLibrary, type LibSound } from '@/hooks/useSoundLibrary';

interface Props {
  open: boolean;
  userId?: string;
  onClose: () => void;
  /** Chamado quando o usuário escolhe um efeito (URL do áudio). */
  onPick: (url: string) => void;
}

const CATEGORIES = ['Transições', 'Efeitos', 'Impactos', 'Outros'];

// Biblioteca de efeitos sonoros: sobe 1x, reusa sempre. Escolhe um pra aplicar
// na transição/trecho, ou envia novos (vão pro Firebase + entram na biblioteca).
export function SoundLibraryModal({ open, userId, onClose, onPick }: Props) {
  const { sounds, add, remove, update } = useSoundLibrary();
  const [uploading, setUploading] = useState(false);
  const [uploadCat, setUploadCat] = useState('Transições');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Trim de um efeito: qual som + início/fim (s) + estado.
  const [trim, setTrim] = useState<{ id: string; start: number; end: number } | null>(null);
  const [trimSaving, setTrimSaving] = useState(false);

  const playRange = (url: string, start: number, end: number) => {
    if (!audioRef.current) audioRef.current = new Audio();
    const a = audioRef.current as any;
    clearTimeout(a._rt);
    const startPlay = () => {
      try {
        a.currentTime = Math.max(0, start);
      } catch {
        /* seek antes de carregar — ignora */
      }
      a.play().catch(() => {});
      a._rt = setTimeout(() => a.pause(), Math.max(200, (end - start) * 1000));
    };
    // Precisa dos metadados carregados pra conseguir dar seek pro `start`.
    if (a.src !== url) {
      a.src = url;
      a.onerror = () => toast.error('Não consegui tocar esse efeito (link quebrado). Reenvie o arquivo.');
      if (a.readyState >= 1) startPlay();
      else a.addEventListener('loadedmetadata', startPlay, { once: true });
    } else if (a.readyState >= 1) {
      startPlay();
    } else {
      a.addEventListener('loadedmetadata', startPlay, { once: true });
    }
  };

  const saveTrim = async (s: LibSound) => {
    if (!trim || trim.end <= trim.start) {
      toast.error('Defina início e fim (fim > início).');
      return;
    }
    setTrimSaving(true);
    try {
      // Apara SEMPRE a partir do ORIGINAL, pra poder reajustar depois sem perder
      // o som inteiro. O url aparado vira o padrão usado em todo o app.
      const src = s.origUrl || s.url;
      const r = await fetch('/api/elevenlabs/trim-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: src,
          start: trim.start,
          end: trim.end,
          userId: userId || auth.currentUser?.uid || '',
        }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'Falha ao aparar.');
      update(s.id, { url: d.url, origUrl: src, trimStart: trim.start, trimEnd: trim.end });
      setTrim(null);
      toast.success('Duração padrão salva! Vai usar esse trecho em todo lugar.');
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao aparar.');
    } finally {
      setTrimSaving(false);
    }
  };

  const grouped = useMemo(() => {
    const g: Record<string, LibSound[]> = {};
    for (const s of sounds) (g[s.category || 'Outros'] ||= []).push(s);
    return g;
  }, [sounds]);

  if (!open) return null;

  const play = (url: string) => {
    if (!audioRef.current) audioRef.current = new Audio();
    audioRef.current.src = url;
    audioRef.current.currentTime = 0;
    audioRef.current.play().catch(() => {});
  };

  const onUpload = async (files?: FileList | null) => {
    if (!files || files.length === 0) return;
    const uid = userId || auth.currentUser?.uid;
    if (!uid) {
      toast.error('Faça login pra enviar efeitos.');
      return;
    }
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('audio/')) continue;
        const safe = file.name.replace(/[^a-z0-9.-]/gi, '_');
        const r = ref(storage, `audio/${uid}/sound-library/${Date.now()}-${safe}`);
        await uploadBytes(r, file, { contentType: file.type || 'audio/mpeg' });
        const url = await getDownloadURL(r);
        add({ name: file.name.replace(/\.[^.]+$/, '').slice(0, 32), url, category: uploadCat });
      }
      toast.success('Efeito(s) adicionado(s) à biblioteca.');
    } catch (e: any) {
      toast.error(e?.message || 'Falha no upload.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-white dark:bg-gray-900 rounded-3xl border-2 border-gray-200 dark:border-gray-800 shadow-2xl p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Music size={18} className="text-blue-600 dark:text-blue-400" />
            <h3 className="text-lg font-black text-gray-900 dark:text-gray-50">
              Biblioteca de efeitos
            </h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700">
            <X size={18} />
          </button>
        </div>

        {/* upload */}
        <div className="flex flex-wrap items-center gap-2 p-3 rounded-2xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-800">
          <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">
            Adicionar
          </span>
          <select
            value={uploadCat}
            onChange={(e) => setUploadCat(e.target.value)}
            className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs dark:text-gray-100"
          >
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <label className="text-[11px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300 hover:underline cursor-pointer flex items-center gap-1">
            {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            Enviar áudio(s)
            <input
              type="file"
              accept="audio/*"
              multiple
              className="hidden"
              onChange={(e) => onUpload(e.target.files)}
            />
          </label>
          <span className="text-[10px] text-gray-400">mp3/wav — sobe 1x, reusa sempre</span>
        </div>

        {/* lista */}
        {sounds.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
            Biblioteca vazia. Envie seus efeitos (whoosh, pop, impacto…) — eles ficam salvos pra
            reusar em qualquer transição.
          </p>
        ) : (
          <div className="space-y-4">
            {CATEGORIES.filter((c) => grouped[c]?.length).map((cat) => (
              <div key={cat} className="space-y-1.5">
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                  {cat}
                </span>
                {grouped[cat]!.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden"
                  >
                    <div className="flex items-center gap-2 p-2">
                      <button
                        onClick={() => play(s.url)}
                        className="p-1.5 rounded-lg text-gray-500 hover:text-blue-600"
                        title="Ouvir"
                      >
                        <Play size={14} />
                      </button>
                      <span className="flex-1 min-w-0 truncate text-sm text-gray-800 dark:text-gray-200">
                        {s.name}
                      </span>
                      <button
                        onClick={() =>
                          setTrim((t) =>
                            t?.id === s.id
                              ? null
                              : { id: s.id, start: s.trimStart ?? 0, end: s.trimEnd ?? 1 }
                          )
                        }
                        className="p-1.5 rounded-lg text-gray-400 hover:text-purple-600"
                        title="Aparar (trim) este efeito"
                      >
                        <Scissors size={13} />
                      </button>
                      <button
                        onClick={() => {
                          onPick(s.url);
                          onClose();
                        }}
                        className="text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                      >
                        Usar
                      </button>
                      <button
                        onClick={() => remove(s.id)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-500"
                        title="Remover da biblioteca"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    {trim?.id === s.id && (
                      <div className="flex flex-wrap items-center gap-2 p-2.5 bg-purple-50/60 dark:bg-purple-950/30 border-t border-purple-100 dark:border-purple-900 text-[11px]">
                        <span className="font-black uppercase tracking-widest text-purple-700 dark:text-purple-300">
                          Aparar
                        </span>
                        início
                        <input
                          type="number"
                          step={0.1}
                          min={0}
                          value={trim.start}
                          onChange={(e) =>
                            setTrim((t) => (t ? { ...t, start: Math.max(0, Number(e.target.value) || 0) } : t))
                          }
                          className="w-16 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100"
                        />
                        fim
                        <input
                          type="number"
                          step={0.1}
                          min={0}
                          value={trim.end}
                          onChange={(e) =>
                            setTrim((t) => (t ? { ...t, end: Math.max(0, Number(e.target.value) || 0) } : t))
                          }
                          className="w-16 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100"
                        />
                        s
                        <button
                          onClick={() => playRange(s.url, trim.start, trim.end)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300 font-black uppercase tracking-widest"
                        >
                          <Play size={11} /> Ouvir trecho
                        </button>
                        <button
                          onClick={() => saveTrim(s)}
                          disabled={trimSaving}
                          className="ml-auto px-3 py-1.5 rounded-lg bg-purple-600 text-white font-black uppercase tracking-widest disabled:opacity-50"
                        >
                          {trimSaving ? 'Salvando…' : 'Salvar trecho'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
