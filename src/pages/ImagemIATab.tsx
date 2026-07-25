import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage, auth } from '@/lib/firebase';
import { ImageIcon, Loader2, X, Check, Download, Sparkles, Film } from 'lucide-react';
import { useJobs } from '@/lib/jobsStore';

interface Props {
  user?: { uid?: string } | null;
  /** Manda a imagem gerada pro Vídeo IA (vira opção de "imagem inicial"). */
  onUseInVideo?: (url: string) => void;
}

interface Img {
  url: string;
  prompt: string;
  at: number;
  used?: boolean;
}

const ASPECTS = ['1:1', '16:9', '9:16'] as const;

export function ImagemIATab({ user, onUseInVideo }: Props) {
  const uid = user?.uid || auth.currentUser?.uid;
  const { addJob, updateJob } = useJobs();

  const [prompt, setPrompt] = useState('');
  const [refs, setRefs] = useState<string[]>([]);
  const [refUploading, setRefUploading] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<string>('1:1');
  const [generating, setGenerating] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [results, setResults] = useState<Img[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('metavise-imagemia-results') || '[]');
    } catch {
      return [];
    }
  });

  const fetchBalance = async () => {
    try {
      const r = await fetch('/api/fal/balance');
      const d = await r.json();
      if (r.ok && typeof d.balance === 'number') setBalance(d.balance);
    } catch {
      /* silencioso */
    }
  };

  useEffect(() => {
    fetchBalance();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('metavise-imagemia-results', JSON.stringify(results));
    } catch {
      /* ignora */
    }
  }, [results]);

  // Carrega imagens já geradas (Storage) ao abrir — não somem.
  useEffect(() => {
    if (!uid) return;
    (async () => {
      try {
        const r = await fetch(`/api/fal/images?userId=${uid}`);
        const d = await r.json();
        if (!r.ok || !Array.isArray(d.images)) return;
        const base = (u: string) => u.split('?')[0] || u;
        setResults((prev) => {
          const seen = new Set<string>();
          const merged: Img[] = [];
          for (const v of d.images as any[]) {
            const bp = base(v.url);
            if (seen.has(bp)) continue;
            seen.add(bp);
            merged.push({ url: v.url, prompt: '', at: v.createdAt ? Date.parse(v.createdAt) : Date.now() });
          }
          for (const x of prev) {
            if (!seen.has(base(x.url))) {
              merged.push(x);
              seen.add(base(x.url));
            }
          }
          return merged.sort((a, b) => b.at - a.at);
        });
      } catch {
        /* mantém */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  const uploadRef = async (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast.error('Envie um arquivo de imagem.');
    if (!uid) return toast.error('Faça login pra enviar imagem.');
    setRefUploading(true);
    try {
      const safe = file.name.replace(/[^a-z0-9.-]/gi, '_');
      const r = ref(storage, `video/${uid}/video-ia-img/${Date.now()}-${safe}`);
      await uploadBytes(r, file, { contentType: file.type || 'image/png' });
      const url = await getDownloadURL(r);
      setRefs((prev) => [...prev, url]);
      toast.success('Referência adicionada.');
    } catch (e: any) {
      toast.error(e?.message || 'Falha no upload.');
    } finally {
      setRefUploading(false);
    }
  };

  const generate = async () => {
    if (!uid) return toast.error('Faça login pra gerar.');
    if (!prompt.trim() && refs.length === 0) {
      return toast.error('Descreva a imagem (ou envie uma referência).');
    }
    setGenerating(true);
    const tid = 'fal-image';
    const jid = addJob('Imagem IA (Nano Banana)');
    toast.loading('Gerando a imagem…', { id: tid });
    try {
      const r = await fetch('/api/fal/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), imageUrls: refs, aspectRatio, userId: uid }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Falha ao gerar a imagem.');
      setResults((prev) => [{ url: d.url, prompt: prompt.trim(), at: Date.now() }, ...prev]);
      toast.success('Imagem pronta!', { id: tid });
      updateJob(jid, { status: 'done' });
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao gerar.', { id: tid });
      updateJob(jid, { status: 'error' });
    } finally {
      setGenerating(false);
      fetchBalance();
    }
  };

  const box = 'bg-white dark:bg-gray-900/70 rounded-2xl border border-gray-200 dark:border-gray-800 p-4';
  const stepLabel = 'text-[11px] font-black uppercase tracking-widest text-pink-600 dark:text-pink-400';

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      {/* Cabeçalho + saldo */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <ImageIcon size={20} className="text-pink-600 dark:text-pink-400" />
          <h2 className="text-lg font-black text-gray-900 dark:text-gray-100">Imagem IA</h2>
        </div>
        <button
          onClick={fetchBalance}
          title="Saldo de créditos do fal"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 text-xs font-black text-gray-700 dark:text-gray-200 hover:border-pink-300"
        >
          <span className="text-pink-600 dark:text-pink-400">◈</span>
          Créditos fal: {balance == null ? '—' : `$${balance.toFixed(2)}`}
        </button>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 -mt-2">
        Gera imagens com <b>Nano Banana</b> (~$0.04). Envie uma <b>referência</b> (ex.: a boneca) pra
        compor ("a mulher segurando essa boneca"). Depois use no <b>Vídeo IA</b> pra animar.
      </p>

      {/* 1 · prompt */}
      <div className={box + ' space-y-2'}>
        <span className={stepLabel}>1 · Descreva a imagem</span>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="ex.: foto realista de uma mulher de 40 anos segurando essa boneca reborn, sala aconchegante, luz natural de janela, estilo foto de celular"
          className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100 text-sm resize-none"
        />
      </div>

      {/* 2 · referências */}
      <div className={box + ' space-y-2'}>
        <span className={stepLabel}>2 · Referências (opcional)</span>
        <div className="flex items-center gap-2 flex-wrap">
          {refs.map((u, i) => (
            <div key={u} className="relative">
              <img src={u} alt="ref" className="h-14 w-14 rounded-lg object-cover" />
              <button
                onClick={() => setRefs((prev) => prev.filter((_, idx) => idx !== i))}
                className="absolute -top-1 -right-1 p-0.5 rounded-full bg-black/70 text-white hover:bg-red-600"
              >
                <X size={11} />
              </button>
            </div>
          ))}
          <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs font-bold px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-pink-400">
            {refUploading ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />}
            Enviar referência
            <input type="file" accept="image/*" className="hidden" onChange={(e) => uploadRef(e.target.files?.[0])} />
          </label>
        </div>
      </div>

      {/* 3 · formato */}
      <div className={box}>
        <span className={stepLabel}>3 · Formato</span>
        <div className="mt-1 flex gap-1">
          {ASPECTS.map((a) => (
            <button
              key={a}
              onClick={() => setAspectRatio(a)}
              className={`px-3 py-1.5 rounded-lg text-xs font-black ${
                aspectRatio === a ? 'bg-pink-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'
              }`}
            >
              {a}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={generate}
        disabled={generating || (!prompt.trim() && refs.length === 0)}
        className="w-full py-3.5 bg-pink-600 text-white rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-pink-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {generating ? (
          <><Loader2 size={16} className="animate-spin" /> Gerando…</>
        ) : (
          <><Sparkles size={16} /> Gerar imagem · ≈ $0.04</>
        )}
      </button>

      {/* galeria */}
      {results.length > 0 && (
        <div className="space-y-3">
          <span className="text-[11px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
            Imagens geradas
          </span>
          <div className="grid grid-cols-2 gap-3">
            {results.map((img, idx) => (
              <div key={img.at} className={box + ' space-y-2'}>
                <img src={img.url} alt="gerada" className="w-full rounded-xl bg-black object-contain max-h-[300px]" />
                <div className="flex items-center gap-2 flex-wrap">
                  <a
                    href={img.url}
                    target="_blank"
                    rel="noreferrer"
                    download
                    className="inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-widest text-gray-600 dark:text-gray-300 hover:underline"
                  >
                    <Download size={12} /> Baixar
                  </a>
                  {onUseInVideo &&
                    (img.used ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-black text-green-600 dark:text-green-400">
                        <Check size={12} /> no Vídeo IA
                      </span>
                    ) : (
                      <button
                        onClick={() => {
                          onUseInVideo(img.url);
                          setResults((prev) => prev.map((x, i) => (i === idx ? { ...x, used: true } : x)));
                          toast.success('Disponível no Vídeo IA como imagem inicial.');
                        }}
                        className="inline-flex items-center gap-1 text-[11px] font-black px-2.5 py-1 rounded-lg bg-purple-600 text-white hover:bg-purple-700"
                      >
                        <Film size={12} /> Usar no Vídeo IA
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
