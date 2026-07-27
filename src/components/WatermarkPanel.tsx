import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '@/lib/firebase';
import { Upload, Loader2, Stamp } from 'lucide-react';

// MARCA D'ÁGUA: o usuário sobe a logo/marca e escolhe onde encaixar no vídeo
// (canto/centro), tamanho e opacidade — com preview WYSIWYG. Aplica via
// /api/video/watermark (ffmpeg overlay).

type Pos = 'tl' | 'tr' | 'center' | 'bl' | 'br';

interface Props {
  videoUrl: string;
  uid?: string;
  aspect?: string;
  onApplied: (url: string) => void;
}

const POS_STYLE: Record<Pos, string> = {
  tl: 'top-[3%] left-[3%]',
  tr: 'top-[3%] right-[3%]',
  center: 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
  bl: 'bottom-[3%] left-[3%]',
  br: 'bottom-[3%] right-[3%]',
};

// Marca d'água PADRÃO salva (opcional): logo + posição/tamanho/opacidade pra
// reusar nos próximos criativos sem reconfigurar.
const DEFAULT_KEY = 'metavise-watermark-default';
function loadDefault(): { logoUrl: string; pos: Pos; size: number; opacity: number } | null {
  try {
    return JSON.parse(localStorage.getItem(DEFAULT_KEY) || 'null');
  } catch {
    return null;
  }
}

export function WatermarkPanel({ videoUrl, uid, aspect = '9:16', onApplied }: Props) {
  const aspectClass =
    aspect === '1:1' ? 'aspect-square' : aspect === '16:9' ? 'aspect-video' : 'aspect-[9/16]';
  const saved = loadDefault();
  const [logoUrl, setLogoUrl] = useState(saved?.logoUrl || '');
  const [uploading, setUploading] = useState(false);
  const [pos, setPos] = useState<Pos>(saved?.pos || 'br');
  const [size, setSize] = useState(saved?.size ?? 0.18);
  const [opacity, setOpacity] = useState(saved?.opacity ?? 1);
  const [saveDefault, setSaveDefault] = useState(!!saved);
  const [applying, setApplying] = useState(false);

  const uploadLogo = async (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast.error('Envie uma imagem (PNG com fundo transparente é ideal).');
    if (!uid) return toast.error('Faça login.');
    setUploading(true);
    try {
      const safe = file.name.replace(/[^a-z0-9.-]/gi, '_');
      const r = ref(storage, `logos/${uid}/${Date.now()}-${safe}`);
      await uploadBytes(r, file, { contentType: file.type || 'image/png' });
      setLogoUrl(await getDownloadURL(r));
      toast.success('Logo carregada.');
    } catch (e: any) {
      toast.error(e?.message || 'Falha no upload da logo.');
    } finally {
      setUploading(false);
    }
  };

  const apply = async () => {
    if (!logoUrl) return toast.error('Envie a logo primeiro.');
    if (!uid) return toast.error('Faça login.');
    setApplying(true);
    const tid = 'watermark';
    toast.loading('Aplicando a marca d’água…', { id: tid });
    try {
      const r = await fetch('/api/video/watermark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl, logoUrl, position: pos, sizePct: size, opacity, userId: uid }),
      });
      const d = await r.json();
      if (!r.ok || !d.url) throw new Error(d.error || 'Falha ao aplicar.');
      // Salva/limpa a marca padrão conforme a opção.
      try {
        if (saveDefault) localStorage.setItem(DEFAULT_KEY, JSON.stringify({ logoUrl, pos, size, opacity }));
        else localStorage.removeItem(DEFAULT_KEY);
      } catch {
        /* ignora */
      }
      onApplied(d.url);
      toast.success('Marca d’água aplicada!', { id: tid });
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao aplicar.', { id: tid });
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="space-y-3 p-3 rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 bg-white dark:bg-gray-900/50">
      <div className="flex items-center gap-2">
        <Stamp size={15} className="text-gray-500" />
        <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">
          Marca d’água (sua logo)
        </span>
      </div>

      {/* PRÉVIA WYSIWYG — vídeo real tocando com a logo sobreposta (posição e
          tamanho iguais ao que o ffmpeg vai aplicar). Sem gastar render. */}
      <div className="flex flex-col items-center">
        <div className={`relative w-full max-w-[240px] rounded-xl overflow-hidden bg-black ${aspectClass}`}>
          <video src={videoUrl} controls loop muted playsInline className="w-full h-full object-contain" />
          {logoUrl && (
            <img
              src={logoUrl}
              alt="logo"
              style={{ width: `${size * 100}%`, opacity }}
              className={`absolute ${POS_STYLE[pos]} object-contain pointer-events-none`}
            />
          )}
        </div>
        <span className="mt-1 text-[10px] text-gray-400">
          Prévia — é assim que a marca vai ficar no vídeo.
        </span>
      </div>

      <div className="flex gap-3">
        <div className="flex-1 space-y-2">
          <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs font-bold px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-blue-400">
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {logoUrl ? 'Trocar logo' : 'Enviar logo (PNG)'}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => uploadLogo(e.target.files?.[0])} />
          </label>

          {/* Posição */}
          <div className="grid grid-cols-3 gap-1 w-24">
            {(['tl', 'tr', 'center', 'bl', 'br'] as Pos[]).map((p) => {
              // Mapeia pro grid 3x3 (tl, ., tr / ., center, . / bl, ., br).
              const cell: Record<Pos, string> = { tl: 'col-start-1 row-start-1', tr: 'col-start-3 row-start-1', center: 'col-start-2 row-start-2', bl: 'col-start-1 row-start-3', br: 'col-start-3 row-start-3' };
              return (
                <button
                  key={p}
                  onClick={() => setPos(p)}
                  className={`h-6 rounded ${cell[p]} ${pos === p ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300'}`}
                  title={p}
                />
              );
            })}
          </div>

          <label className="block text-[10px] font-bold text-gray-500">
            Tamanho: {Math.round(size * 100)}%
            <input type="range" min={5} max={50} value={size * 100} onChange={(e) => setSize(Number(e.target.value) / 100)} className="w-full accent-blue-600" />
          </label>
          <label className="block text-[10px] font-bold text-gray-500">
            Opacidade: {Math.round(opacity * 100)}%
            <input type="range" min={20} max={100} value={opacity * 100} onChange={(e) => setOpacity(Number(e.target.value) / 100)} className="w-full accent-blue-600" />
          </label>
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
        <input type="checkbox" checked={saveDefault} onChange={(e) => setSaveDefault(e.target.checked)} className="accent-blue-600" />
        Salvar essa marca como padrão pros próximos criativos
      </label>

      <button
        onClick={apply}
        disabled={applying || !logoUrl}
        className="w-full py-2.5 rounded-xl bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-black uppercase tracking-widest disabled:opacity-40 flex items-center justify-center gap-2"
      >
        {applying ? <><Loader2 size={14} className="animate-spin" /> Aplicando…</> : <><Stamp size={14} /> Aplicar marca d’água</>}
      </button>
    </div>
  );
}
