import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage, auth } from '@/lib/firebase';
import { Loader2, Upload, Music, ArrowUp, ArrowDown, X, Download, Check } from 'lucide-react';

interface Props {
  userId?: string;
  /** Áudios já gerados no subprojeto (gancho + corpo) pra escolher sem re-enviar. */
  existingAudios?: { url: string; label: string }[];
  /** Chamado com o áudio juntado — o pai adiciona aos áudios do projeto (Montagem). */
  onJoined?: (url: string) => void;
}

// Junta 2+ áudios numa ordem escolhida (ex.: voz do gancho + voz do corpo) num
// único mp3 pra usar na Montagem. Reusa /api/elevenlabs/concat-audio.
export function AudioJoinPanel({ userId, existingAudios = [], onJoined }: Props) {
  const [list, setList] = useState<{ url: string; label: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [joining, setJoining] = useState(false);
  const [resultUrl, setResultUrl] = useState('');
  const [pick, setPick] = useState('');
  const [added, setAdded] = useState(false);

  const add = (url: string, label: string) => {
    if (!url || list.some((v) => v.url === url)) return;
    setList((prev) => [...prev, { url, label }]);
  };
  const removeAt = (i: number) => setList((prev) => prev.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) =>
    setList((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  const onUpload = async (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('audio/')) {
      toast.error('Selecione um arquivo de áudio.');
      return;
    }
    const uid = userId || auth.currentUser?.uid;
    if (!uid) {
      toast.error('Faça login pra enviar áudio.');
      return;
    }
    setUploading(true);
    try {
      const safe = file.name.replace(/[^a-z0-9.-]/gi, '_');
      const r = ref(storage, `audio/${uid}/join-upload/${Date.now()}-${safe}`);
      await uploadBytes(r, file, { contentType: file.type || 'audio/mpeg' });
      add(await getDownloadURL(r), file.name.slice(0, 24));
      toast.success('Áudio adicionado.');
    } catch (e: any) {
      toast.error(e?.message || 'Falha no upload.');
    } finally {
      setUploading(false);
    }
  };

  const join = async () => {
    if (list.length < 2) {
      toast.error('Adicione pelo menos 2 áudios pra juntar.');
      return;
    }
    setJoining(true);
    setAdded(false);
    setResultUrl('');
    const toastId = 'audio-join';
    toast.loading('Juntando os áudios...', { id: toastId });
    try {
      const uid = userId || auth.currentUser?.uid;
      const r = await fetch('/api/elevenlabs/concat-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: list.map((v) => v.url), userId: uid }),
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error || 'Falha ao juntar.');
      setResultUrl(d.audioUrl);
      toast.success('Áudios juntados!', { id: toastId });
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao juntar.', { id: toastId });
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-900/80 p-6 md:p-8 rounded-[32px] border-2 border-gray-200 dark:border-gray-800 shadow-sm space-y-4">
      <div className="flex items-center gap-2">
        <Music size={18} className="text-purple-600 dark:text-purple-400" />
        <h4 className="text-lg font-black text-gray-900 dark:text-gray-50">Juntar áudios</h4>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Some as vozes (ex.: <strong>gancho + corpo</strong>) numa ordem só → um mp3. Use "na
        Montagem" pra ele virar a voz-base da timeline.
      </p>

      {/* adicionar: escolher dos áudios do projeto + upload */}
      <div className="flex flex-wrap items-center gap-2">
        {existingAudios.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              className="px-3 py-2 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100"
            >
              <option value="">Áudios do projeto…</option>
              {existingAudios.map((o) => (
                <option key={o.url} value={o.url}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                const o = existingAudios.find((x) => x.url === pick);
                if (o) add(o.url, o.label);
                setPick('');
              }}
              disabled={!pick}
              className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 disabled:opacity-40"
            >
              Adicionar
            </button>
          </div>
        )}
        <label className="text-[11px] font-black uppercase tracking-widest text-purple-700 dark:text-purple-300 hover:underline cursor-pointer flex items-center gap-1">
          {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          Enviar áudio
          <input
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => onUpload(e.target.files?.[0])}
          />
        </label>
      </div>

      {/* lista ordenada */}
      {list.length > 0 && (
        <div className="space-y-2">
          {list.map((v, i) => (
            <div
              key={v.url}
              className="flex items-center gap-2 p-2.5 rounded-xl border border-gray-200 dark:border-gray-800"
            >
              <span className="text-xs font-black text-gray-500 w-6 shrink-0">{i + 1}.</span>
              <span className="flex-1 min-w-0 truncate text-xs text-gray-700 dark:text-gray-300">
                {v.label}
              </span>
              <button
                onClick={() => move(i, -1)}
                disabled={i === 0}
                className="p-1 rounded text-gray-400 hover:text-gray-700 disabled:opacity-30"
                title="Subir"
              >
                <ArrowUp size={13} />
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === list.length - 1}
                className="p-1 rounded text-gray-400 hover:text-gray-700 disabled:opacity-30"
                title="Descer"
              >
                <ArrowDown size={13} />
              </button>
              <button
                onClick={() => removeAt(i)}
                className="p-1 rounded text-gray-400 hover:text-red-500"
                title="Remover"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={join}
          disabled={joining || list.length < 2}
          className={`flex items-center gap-2 text-sm font-bold px-5 py-2.5 rounded-xl transition ${
            joining || list.length < 2
              ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed'
              : 'bg-purple-600 text-white hover:bg-purple-700'
          }`}
        >
          {joining ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Juntando…
            </>
          ) : (
            `Juntar ${list.length || ''} áudios`
          )}
        </button>
      </div>

      {resultUrl && (
        <div className="space-y-2">
          <audio src={resultUrl} controls className="w-full" />
          <div className="flex items-center gap-4 flex-wrap">
            <a
              href={resultUrl}
              download="audio_juntado.mp3"
              className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-gray-600 dark:text-gray-300 hover:underline"
            >
              <Download size={13} /> Baixar (.mp3)
            </a>
            <button
              onClick={() => {
                onJoined?.(resultUrl);
                setAdded(true);
              }}
              disabled={added}
              className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-60"
            >
              {added ? (
                <>
                  <Check size={13} /> nos áudios do projeto
                </>
              ) : (
                'Usar na Montagem'
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
