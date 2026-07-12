import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage, auth } from '@/lib/firebase';
import { Loader2, Upload, Film, Check } from 'lucide-react';

interface Props {
  userId?: string;
}

// Estilo de referência da VSL: você sobe uma VSL campeã, o app detecta o RITMO
// de corte (scene detection) e salva como "estilo" pra o Auto-editar imitar a
// cadência. Guardado em localStorage (cross-projeto).
interface VslStyle {
  referenceUrl?: string;
  avgCutSec?: number;
  cutsPerMin?: number;
  durationSec?: number;
  analyzedAt?: string;
}
const KEY = 'metavise-vsl-style';

export function VslStyleReference({ userId }: Props) {
  const [style, setStyle] = useState<VslStyle | null>(null);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [pendingUrl, setPendingUrl] = useState('');

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setStyle(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  const persist = (s: VslStyle) => {
    setStyle(s);
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  };

  const onUpload = async (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      toast.error('Selecione um vídeo.');
      return;
    }
    const uid = userId || auth.currentUser?.uid;
    if (!uid) {
      toast.error('Faça login.');
      return;
    }
    setUploading(true);
    const tid = 'vsl-ref-up';
    toast.loading('Enviando VSL de referência… (arquivo grande pode demorar)', { id: tid });
    try {
      const safe = file.name.replace(/[^a-z0-9.-]/gi, '_');
      const r = ref(storage, `video/${uid}/vsl-reference/${Date.now()}-${safe}`);
      await uploadBytes(r, file, { contentType: file.type || 'video/mp4' });
      const url = await getDownloadURL(r);
      setPendingUrl(url);
      toast.success('Enviado. Agora clique em "Analisar estilo".', { id: tid });
    } catch (e: any) {
      toast.error(e?.message || 'Falha no upload.', { id: tid });
    } finally {
      setUploading(false);
    }
  };

  const analyze = async () => {
    const url = pendingUrl || style?.referenceUrl;
    if (!url) {
      toast.error('Envie uma VSL primeiro.');
      return;
    }
    setAnalyzing(true);
    const tid = 'vsl-ref-an';
    toast.loading('Analisando o ritmo de corte da VSL…', { id: tid });
    try {
      const r = await fetch('/api/video/analyze-style', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: url }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Falha na análise.');
      persist({
        referenceUrl: url,
        avgCutSec: d.avgCutSec,
        cutsPerMin: d.cutsPerMin,
        durationSec: d.durationSec,
        analyzedAt: new Date().toISOString(),
      });
      toast.success('Estilo analisado e salvo!', { id: tid });
    } catch (e: any) {
      toast.error(e?.message || 'Erro na análise.', { id: tid });
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-900/80 rounded-2xl border-2 border-purple-200/60 dark:border-purple-800/50 p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Film size={16} className="text-purple-600 dark:text-purple-400" />
        <span className="text-sm font-black text-gray-800 dark:text-gray-200">
          Estilo de referência (VSL campeã)
        </span>
      </div>
      <p className="text-[11px] text-gray-500 dark:text-gray-400">
        Suba uma VSL que já vendeu bem — o app detecta o <strong>ritmo de corte</strong> dela pra o
        Auto-editar imitar a cadência (ex.: corte a cada ~3s).
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11px] font-black uppercase tracking-widest text-purple-700 dark:text-purple-300 hover:underline cursor-pointer flex items-center gap-1">
          {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          Enviar VSL de referência
          <input
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => onUpload(e.target.files?.[0])}
          />
        </label>
        {(pendingUrl || style?.referenceUrl) && (
          <button
            onClick={analyze}
            disabled={analyzing}
            className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
          >
            {analyzing ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Analisar estilo
          </button>
        )}
      </div>

      {style?.avgCutSec ? (
        <div className="text-xs text-gray-700 dark:text-gray-300 bg-purple-50/60 dark:bg-purple-950/30 rounded-xl p-3">
          <span className="font-black">Estilo detectado:</span> corta a cada{' '}
          <span className="font-black text-purple-700 dark:text-purple-300">
            ~{style.avgCutSec}s
          </span>{' '}
          ({style.cutsPerMin}/min).{' '}
          <span className="text-gray-500 dark:text-gray-400">
            O Auto-editar vai usar esse ritmo.
          </span>
        </div>
      ) : null}
    </div>
  );
}
