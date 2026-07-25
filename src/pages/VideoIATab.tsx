import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage, auth } from '@/lib/firebase';
import { Sparkles, Loader2, X, Check, ImageIcon, ArrowRight, Film, Music } from 'lucide-react';

interface Props {
  user?: { uid?: string } | null;
  /** Adiciona o clipe à biblioteca da Montagem (config.montagem.clips). */
  onAddClip?: (clip: { url: string; label: string; duration: number }) => void;
  /** Coloca o clipe DIRETO na timeline da Montagem no segundo `atSec` (auto-posiciona). */
  onPlaceOnTimeline?: (clip: { url: string; label: string; duration: number }, atSec: number) => void;
  onGoToMontagem?: () => void;
  /** Áudios já gerados no ElevenLabs (gancho + corpo) pro lip-sync. */
  audios?: { url: string; label: string }[];
  /** Imagens geradas na aba Imagem IA (Nano Banana) pra usar como imagem inicial. */
  initialImages?: string[];
}

interface Result {
  url: string;
  prompt: string;
  durationSec: number;
  at: number;
  sent?: boolean;
  synced?: boolean; // veio de um lip-sync (já tem voz)
  placeAt?: number; // segundo do áudio de onde o trecho foi recortado (auto-posiciona)
}

const ASPECTS = ['1:1', '16:9', '9:16'] as const;

export function VideoIATab({
  user,
  onAddClip,
  onPlaceOnTimeline,
  onGoToMontagem,
  audios = [],
  initialImages = [],
}: Props) {
  const uid = user?.uid || auth.currentUser?.uid;

  const [prompt, setPrompt] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imageUploading, setImageUploading] = useState(false);
  const [durationSec, setDurationSec] = useState<number>(5);
  const [aspectRatio, setAspectRatio] = useState<string>('1:1');
  const [generating, setGenerating] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  // Lip-sync: qual clipe está escolhendo voz, e se está processando.
  const [syncIdx, setSyncIdx] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [audioUploading, setAudioUploading] = useState(false);
  // Recortar trecho do áudio (ex.: só o segundo 35→43 pro clipe do meio).
  const [trimSource, setTrimSource] = useState('');
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(8);

  const [results, setResults] = useState<Result[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('metavise-videoia-results') || '[]');
    } catch {
      return [];
    }
  });

  const fetchBalance = async () => {
    setBalanceLoading(true);
    try {
      const r = await fetch('/api/fal/balance');
      const d = await r.json();
      if (r.ok && typeof d.balance === 'number') setBalance(d.balance);
    } catch {
      /* silencioso */
    } finally {
      setBalanceLoading(false);
    }
  };

  useEffect(() => {
    fetchBalance();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('metavise-videoia-results', JSON.stringify(results));
    } catch {
      /* ignora */
    }
  }, [results]);

  // Carrega os clipes já gerados (do Storage) ao abrir — nunca somem.
  useEffect(() => {
    if (!uid) return;
    (async () => {
      try {
        const r = await fetch(`/api/fal/videos?userId=${uid}`);
        const d = await r.json();
        if (!r.ok || !Array.isArray(d.videos)) return;
        const basePath = (u: string) => u.split('?')[0] || u;
        setResults((prev) => {
          const promptByPath = new Map(prev.map((x) => [basePath(x.url), x.prompt]));
          const seen = new Set<string>();
          const merged: Result[] = [];
          for (const v of d.videos as any[]) {
            const bp = basePath(v.url);
            if (seen.has(bp)) continue;
            seen.add(bp);
            merged.push({
              url: v.url,
              prompt: promptByPath.get(bp) || '',
              durationSec: 0,
              at: v.createdAt ? Date.parse(v.createdAt) : Date.now(),
              synced: !!v.talking,
            });
          }
          for (const x of prev) {
            const bp = basePath(x.url);
            if (!seen.has(bp)) {
              merged.push(x);
              seen.add(bp);
            }
          }
          return merged.sort((a, b) => b.at - a.at);
        });
      } catch {
        /* mantém o que tem */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  const uploadImage = async (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast.error('Envie um arquivo de imagem.');
    if (!uid) return toast.error('Faça login pra enviar imagem.');
    setImageUploading(true);
    try {
      const safe = file.name.replace(/[^a-z0-9.-]/gi, '_');
      const r = ref(storage, `video/${uid}/video-ia-img/${Date.now()}-${safe}`);
      await uploadBytes(r, file, { contentType: file.type || 'image/png' });
      setImageUrl(await getDownloadURL(r));
      toast.success('Imagem carregada — o clipe anima a partir dela.');
    } catch (e: any) {
      toast.error(e?.message || 'Falha no upload da imagem.');
    } finally {
      setImageUploading(false);
    }
  };

  const generate = async () => {
    if (!uid) return toast.error('Faça login pra gerar.');
    if (!prompt.trim() && !imageUrl) {
      return toast.error('Descreva a cena (ou envie uma imagem).');
    }
    setGenerating(true);
    const tid = 'fal-video';
    toast.loading('Gerando o clipe… (~1-3 min, pode ir em outra aba)', { id: tid });
    try {
      const r = await fetch('/api/fal/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'kling',
          prompt: prompt.trim(),
          imageUrl,
          durationSec,
          aspectRatio,
          userId: uid,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Falha ao gerar o clipe.');
      setResults((prev) => [
        { url: d.url, prompt: prompt.trim(), durationSec, at: Date.now() },
        ...prev,
      ]);
      toast.success('Clipe pronto!', { id: tid });
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao gerar.', { id: tid });
    } finally {
      setGenerating(false);
      fetchBalance();
    }
  };

  const runLipsync = async (clipUrl: string, audioUrl: string, placeAt?: number) => {
    if (!uid) return toast.error('Faça login.');
    setSyncing(true);
    const tid = 'fal-lipsync';
    toast.loading('Sincronizando a voz no clipe… (~1-3 min)', { id: tid });
    try {
      const r = await fetch('/api/fal/lipsync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: clipUrl, audioUrl, userId: uid }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Falha ao sincronizar.');
      setResults((prev) => [
        { url: d.url, prompt: '', durationSec: 0, at: Date.now(), synced: true, placeAt },
        ...prev,
      ]);
      setSyncIdx(null);
      toast.success('Vídeo com a voz sincronizada pronto!', { id: tid });
    } catch (e: any) {
      toast.error(e?.message || 'Erro no lip-sync.', { id: tid });
    } finally {
      setSyncing(false);
      fetchBalance();
    }
  };

  const uploadAudioAndSync = async (file: File | undefined | null, clipUrl: string) => {
    if (!file) return;
    if (!file.type.startsWith('audio/')) return toast.error('Envie um arquivo de áudio.');
    if (!uid) return toast.error('Faça login.');
    setAudioUploading(true);
    try {
      const safe = file.name.replace(/[^a-z0-9.-]/gi, '_');
      const r = ref(storage, `audio/${uid}/video-ia/${Date.now()}-${safe}`);
      await uploadBytes(r, file, { contentType: file.type || 'audio/mpeg' });
      const url = await getDownloadURL(r);
      await runLipsync(clipUrl, url);
    } catch (e: any) {
      toast.error(e?.message || 'Falha no upload do áudio.');
    } finally {
      setAudioUploading(false);
    }
  };

  // Recorta o trecho [start,end] do áudio escolhido e sincroniza no clipe.
  const trimAndSync = async (clipUrl: string) => {
    if (!uid) return toast.error('Faça login.');
    const src = trimSource || audios[0]?.url || '';
    if (!src) return toast.error('Escolha o áudio de origem.');
    if (!(trimEnd > trimStart)) return toast.error('O fim tem que ser maior que o início.');
    setSyncing(true);
    const tid = 'fal-lipsync';
    toast.loading('Recortando o trecho…', { id: tid });
    try {
      const tr = await fetch('/api/elevenlabs/trim-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: src, start: trimStart, end: trimEnd, userId: uid }),
      });
      const td = await tr.json();
      if (!tr.ok || !td.url) throw new Error(td.error || 'Falha ao recortar o áudio.');
      await runLipsync(clipUrl, td.url, trimStart); // placeAt = início do trecho recortado
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao recortar.', { id: tid });
      setSyncing(false);
    }
  };

  // Lê a duração REAL do vídeo (o durationSec guardado se perde ao recarregar do
  // servidor → viraria 5s de fallback). Assim o trecho na Montagem tem o tamanho
  // certo do clipe.
  const getVideoDuration = (url: string) =>
    new Promise<number>((resolve) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => resolve(v.duration || 0);
      v.onerror = () => resolve(0);
      v.src = url;
    });

  const sendToMontagem = async (res: Result, idx: number) => {
    const realDur = await getVideoDuration(res.url);
    const clip = {
      url: res.url,
      label: res.synced ? 'IA falando' : 'IA Kling',
      duration: realDur || res.durationSec || 5,
    };
    if (res.placeAt != null && onPlaceOnTimeline) {
      // Veio de um trecho recortado → posiciona DIRETO no segundo certo da timeline.
      onPlaceOnTimeline(clip, res.placeAt);
      setResults((prev) => prev.map((x, i) => (i === idx ? { ...x, sent: true } : x)));
      toast.success(`Colocado na timeline no segundo ${res.placeAt.toFixed(0)}s.`);
    } else {
      onAddClip?.(clip);
      setResults((prev) => prev.map((x, i) => (i === idx ? { ...x, sent: true } : x)));
      toast.success('Enviado — abra a Montagem que está na biblioteca de clipes.');
    }
  };

  const box = 'bg-white dark:bg-gray-900/70 rounded-2xl border border-gray-200 dark:border-gray-800 p-4';
  const stepLabel = 'text-[11px] font-black uppercase tracking-widest text-purple-600 dark:text-purple-400';
  const canGenerate = !generating && (prompt.trim() !== '' || !!imageUrl);

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      {/* Cabeçalho + saldo */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Sparkles size={20} className="text-purple-600 dark:text-purple-400" />
          <h2 className="text-lg font-black text-gray-900 dark:text-gray-100">Vídeo IA</h2>
        </div>
        <button
          onClick={fetchBalance}
          disabled={balanceLoading}
          title="Saldo de créditos do fal — clique pra atualizar"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 text-xs font-black text-gray-700 dark:text-gray-200 hover:border-purple-300"
        >
          {balanceLoading ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <span className="text-purple-600 dark:text-purple-400">◈</span>
          )}
          Créditos fal: {balance == null ? '—' : `$${balance.toFixed(2)}`}
        </button>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 -mt-2">
        Gera um clipe com <b>Kling 3.0</b> (de um texto e/ou uma imagem). Depois, se quiser, você
        <b> sincroniza a voz</b> do ElevenLabs em cima do clipe.
      </p>

      {/* Passo 1 — cena */}
      <div className={box + ' space-y-2'}>
        <span className={stepLabel}>1 · Descreva a cena</span>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="ex.: mulher de 40 anos segurando uma boneca reborn, olhando pra câmera e falando, sala aconchegante, luz natural de janela — a boneca permanece imóvel"
          className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100 text-sm resize-none"
        />
        <p className="text-[11px] text-gray-400">
          Dica: se tiver 2 rostos (ex.: pessoa + boneca), escreva que a boneca fica <b>imóvel</b> pra
          ela não “ganhar vida”.
        </p>
      </div>

      {/* Passo 2 — imagem opcional */}
      <div className={box + ' space-y-2'}>
        <span className={stepLabel}>2 · Imagem inicial (opcional)</span>
        <div className="flex items-center gap-2 flex-wrap">
          {imageUrl ? (
            <>
              <img src={imageUrl} alt="início" className="h-12 w-12 rounded-lg object-cover" />
              <span className="text-[11px] text-green-600 dark:text-green-400 font-bold">
                imagem ✓ (anima a partir dela)
              </span>
              <button
                onClick={() => setImageUrl('')}
                className="p-1 rounded-lg text-gray-400 hover:text-red-500"
                title="Remover imagem"
              >
                <X size={14} />
              </button>
            </>
          ) : (
            <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs font-bold px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-purple-400">
              {imageUploading ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />}
              Enviar imagem
              <input type="file" accept="image/*" className="hidden" onChange={(e) => uploadImage(e.target.files?.[0])} />
            </label>
          )}
        </div>
        {/* Imagens geradas na aba Imagem IA (Nano Banana) */}
        {!imageUrl && initialImages.length > 0 && (
          <div className="space-y-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
              Ou use uma imagem gerada (Imagem IA):
            </span>
            <div className="flex flex-wrap gap-2">
              {initialImages.map((u) => (
                <button
                  key={u}
                  onClick={() => setImageUrl(u)}
                  className="rounded-lg overflow-hidden ring-1 ring-gray-200 dark:ring-gray-700 hover:ring-purple-500"
                  title="Usar como imagem inicial"
                >
                  <img src={u} alt="gerada" className="h-14 w-14 object-cover" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Passo 3 — duração + formato */}
      <div className={box + ' flex flex-wrap items-center gap-6'}>
        <div>
          <span className={stepLabel}>3 · Duração exata</span>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="number"
              min={3}
              max={15}
              value={durationSec}
              onChange={(e) => {
                const n = Math.round(Number(e.target.value) || 0);
                setDurationSec(Math.max(3, Math.min(15, n)));
              }}
              className="w-20 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100 text-sm font-black"
            />
            <span className="text-xs text-gray-500 dark:text-gray-400">segundos (3–15)</span>
          </div>
        </div>
        <div>
          <span className={stepLabel}>Formato</span>
          <div className="mt-1 flex gap-1">
            {ASPECTS.map((a) => (
              <button
                key={a}
                onClick={() => setAspectRatio(a)}
                className={`px-3 py-1.5 rounded-lg text-xs font-black ${
                  aspectRatio === a ? 'bg-purple-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'
                }`}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Gerar */}
      <button
        onClick={generate}
        disabled={!canGenerate}
        className="w-full py-3.5 bg-purple-600 text-white rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-purple-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {generating ? (
          <><Loader2 size={16} className="animate-spin" /> Gerando… (~1-3 min)</>
        ) : (
          <><Sparkles size={16} /> Gerar clipe</>
        )}
      </button>

      {/* Resultados */}
      {results.length > 0 && (
        <div className="space-y-3">
          <span className="text-[11px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
            Clipes gerados
          </span>
          {results.map((res, idx) => (
            <div key={res.at} className={box + ' space-y-2'}>
              <video src={res.url} controls className="w-full max-h-[360px] rounded-xl bg-black" />
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[11px] text-gray-500 dark:text-gray-400">
                  {res.synced ? '🗣 Com voz sincronizada' : 'Kling 3.0 · mudo'}
                  {res.prompt ? ` · "${res.prompt.slice(0, 40)}${res.prompt.length > 40 ? '…' : ''}"` : ''}
                </span>
                <div className="flex items-center gap-2">
                  {!res.synced && (
                    <button
                      onClick={() => setSyncIdx(syncIdx === idx ? null : idx)}
                      className="inline-flex items-center gap-1.5 text-xs font-black px-3 py-2 rounded-xl border border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/40"
                    >
                      <Music size={13} /> Sincronizar voz
                    </button>
                  )}
                  {res.sent ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-black text-green-600 dark:text-green-400">
                      <Check size={13} /> na Montagem
                    </span>
                  ) : (
                    <button
                      onClick={() => sendToMontagem(res, idx)}
                      className="inline-flex items-center gap-1.5 text-xs font-black px-3 py-2 rounded-xl bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:opacity-90"
                    >
                      <Film size={13} />{' '}
                      {res.placeAt != null ? `Colocar em ${res.placeAt.toFixed(0)}s` : 'Pra Montagem'}
                    </button>
                  )}
                </div>
              </div>

              {/* Picker de voz pro lip-sync deste clipe */}
              {syncIdx === idx && (
                <div className="pt-2 border-t border-gray-200 dark:border-gray-800 space-y-2">
                  <span className="text-[11px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
                    Escolha a voz pra sincronizar
                  </span>
                  {audios.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {audios.map((a, i) => (
                        <button
                          key={i}
                          disabled={syncing}
                          onClick={() => runLipsync(res.url, a.url)}
                          className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/40 disabled:opacity-50"
                        >
                          <Music size={11} /> {a.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-purple-400">
                      {audioUploading || syncing ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Music size={12} />
                      )}
                      ou enviar áudio
                      <input
                        type="file"
                        accept="audio/*"
                        className="hidden"
                        disabled={syncing}
                        onChange={(e) => uploadAudioAndSync(e.target.files?.[0], res.url)}
                      />
                    </label>
                    {syncing && <span className="text-[11px] text-gray-400">sincronizando…</span>}
                  </div>
                  {audios.length > 0 && (
                    <div className="pt-2 border-t border-dashed border-gray-200 dark:border-gray-800 space-y-1.5">
                      <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
                        ✂️ Ou recorte um trecho (pro meio / fim do vídeo)
                      </span>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-600 dark:text-gray-300">
                        <select
                          value={trimSource || audios[0]!.url}
                          onChange={(e) => setTrimSource(e.target.value)}
                          className="px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100"
                        >
                          {audios.map((a, i) => (
                            <option key={i} value={a.url}>
                              {a.label}
                            </option>
                          ))}
                        </select>
                        de
                        <input
                          type="number"
                          min={0}
                          value={trimStart}
                          onChange={(e) => setTrimStart(Math.max(0, Number(e.target.value) || 0))}
                          className="w-16 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100"
                        />
                        a
                        <input
                          type="number"
                          min={0}
                          value={trimEnd}
                          onChange={(e) => setTrimEnd(Math.max(0, Number(e.target.value) || 0))}
                          className="w-16 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100"
                        />
                        s
                        <button
                          onClick={() => trimAndSync(res.url)}
                          disabled={syncing || !(trimEnd > trimStart)}
                          className="text-[11px] font-black px-2.5 py-1 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
                        >
                          Recortar e sincronizar
                        </button>
                      </div>
                      <p className="text-[10px] text-gray-400">
                        Pega o segundo na Montagem (o playhead mostra o tempo). Ex.: clipe do meio →
                        de 35 a 43.
                      </p>
                    </div>
                  )}
                  {audios.length === 0 && (
                    <p className="text-[11px] text-gray-400">
                      Gere a voz do gancho/corpo na aba <b>Voz</b> primeiro pra ela aparecer aqui.
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
          {results.some((r) => r.sent) && onGoToMontagem && (
            <button
              onClick={onGoToMontagem}
              className="w-full py-3 bg-gray-900 dark:bg-gray-50 text-white dark:text-gray-900 rounded-2xl font-black uppercase tracking-widest text-sm hover:opacity-90 flex items-center justify-center gap-2"
            >
              Ir pra Montagem <ArrowRight size={16} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
