import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage, auth } from '@/lib/firebase';
import { Loader2, Upload, Link2, ArrowUp, ArrowDown, X, Download } from 'lucide-react';

interface Props {
  userId?: string;
  /** Vídeos já disponíveis no projeto (versões) pra escolher sem re-enviar. */
  existingOptions?: { url: string; label: string }[];
}

// Junta 2+ vídeos numa ordem escolhida (ex.: somar clipes pra chegar aos 30 min
// de áudio que o clone profissional do ElevenLabs exige). Reusa /api/video/concat,
// que normaliza tudo pro formato do 1º vídeo e concatena vídeo+áudio.
export function VideoJoinPanel({ userId, existingOptions = [] }: Props) {
  const [list, setList] = useState<{ url: string; label: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [joining, setJoining] = useState(false);
  const [resultUrl, setResultUrl] = useState('');
  const [pick, setPick] = useState('');
  // Padrão: só áudio (rápido, gera .mp3 pro clone). Desligue pra juntar o vídeo
  // inteiro (re-encoda a imagem — bem mais lento em vídeos longos).
  const [audioOnly, setAudioOnly] = useState(true);

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
    if (!file.type.startsWith('video/')) {
      toast.error('Selecione um arquivo de vídeo.');
      return;
    }
    const uid = userId || auth.currentUser?.uid;
    if (!uid) {
      toast.error('Faça login pra enviar vídeo.');
      return;
    }
    setUploading(true);
    try {
      const safe = file.name.replace(/[^a-z0-9.-]/gi, '_');
      const r = ref(storage, `video/${uid}/join-upload/${Date.now()}-${safe}`);
      await uploadBytes(r, file, { contentType: file.type || 'video/mp4' });
      const url = await getDownloadURL(r);
      add(url, file.name.slice(0, 24));
      toast.success('Vídeo adicionado.');
    } catch (e: any) {
      toast.error(e?.message || 'Falha no upload.');
    } finally {
      setUploading(false);
    }
  };

  const join = async () => {
    const uid = userId || auth.currentUser?.uid;
    if (!uid) {
      toast.error('Faça login.');
      return;
    }
    // Só áudio: 1 vídeo já basta (extrai o áudio dele). Juntar VÍDEO precisa 2+.
    const minVideos = audioOnly ? 1 : 2;
    if (list.length < minVideos) {
      toast.error(audioOnly ? 'Adicione pelo menos 1 vídeo.' : 'Adicione pelo menos 2 vídeos.');
      return;
    }
    setJoining(true);
    const toastId = 'video-join';
    toast.loading(
      audioOnly
        ? list.length > 1
          ? 'Juntando o áudio...'
          : 'Extraindo o áudio...'
        : 'Juntando os vídeos...',
      { id: toastId }
    );
    try {
      const endpoint = audioOnly ? '/api/video/join-audio' : '/api/video/concat';
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videos: list.map((v) => v.url), userId: uid }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Falha ao juntar.');
      setResultUrl(d.url);
      toast.success(audioOnly ? 'Áudio juntado!' : 'Vídeos juntados!', { id: toastId });
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao juntar.', { id: toastId });
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-900/80 p-6 md:p-8 rounded-[32px] border-2 border-gray-200 dark:border-gray-800 shadow-sm space-y-4">
      <div className="flex items-center gap-2">
        <Link2 size={18} className="text-blue-600 dark:text-blue-400" />
        <h4 className="text-lg font-black text-gray-900 dark:text-gray-50">Juntar vídeos</h4>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Some vídeos numa ordem só, ou <strong>extraia o áudio de um vídeo só</strong> (ex.: pra
        clonar a voz no ElevenLabs). Baixe o resultado e suba lá.
      </p>

      {/* adicionar: upload + escolher de versões existentes */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300 hover:underline cursor-pointer flex items-center gap-1">
          {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          Enviar vídeo
          <input
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => onUpload(e.target.files?.[0])}
          />
        </label>
        {existingOptions.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              className="px-3 py-2 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100"
            >
              <option value="">Escolher de versões…</option>
              {existingOptions.map((o) => (
                <option key={o.url} value={o.url}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                const o = existingOptions.find((x) => x.url === pick);
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

      <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
        <input
          type="checkbox"
          checked={audioOnly}
          onChange={(e) => setAudioOnly(e.target.checked)}
          className="accent-blue-600"
        />
        Juntar <strong>só o áudio</strong> (rápido, gera .mp3 — ideal pro clone de voz; com{' '}
        <strong>1 vídeo só</strong> ele extrai o áudio). Desmarque pra juntar o vídeo inteiro
        (lento, precisa de 2+).
      </label>

      <div className="flex justify-end">
        {(() => {
          const minVideos = audioOnly ? 1 : 2;
          const disabled = joining || list.length < minVideos;
          const label = audioOnly
            ? list.length > 1
              ? `Juntar áudio de ${list.length} vídeos`
              : 'Extrair áudio'
            : `Juntar ${list.length || ''} vídeos`;
          return (
            <button
              onClick={join}
              disabled={disabled}
              className={`flex items-center gap-2 text-sm font-bold px-5 py-2.5 rounded-xl transition ${
                disabled
                  ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {joining ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Processando…
                </>
              ) : (
                label
              )}
            </button>
          );
        })()}
      </div>

      {resultUrl && (
        <div className="space-y-2">
          {audioOnly ? (
            <audio src={resultUrl} controls className="w-full" />
          ) : (
            <video src={resultUrl} controls className="w-full max-h-[360px] rounded-2xl bg-black" />
          )}
          <a
            href={resultUrl}
            download={audioOnly ? 'audio_juntado.mp3' : 'video_juntado.mp4'}
            className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300 hover:underline"
          >
            <Download size={13} /> Baixar {audioOnly ? 'áudio (.mp3)' : 'vídeo juntado'}
          </a>
        </div>
      )}
    </div>
  );
}
