import { useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage, auth } from '@/lib/firebase';
import { Crop, Upload, Loader2, Download, Scissors } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

// RECORTAR / REDIMENSIONAR — sobe um vídeo, arrasta a caixa de recorte pra ONDE
// quiser (recorte livre), define o tamanho de saída em QUALQUER W×H (não só
// presets) e corta no tempo (opcional). Aplica via /api/video/crop-resize.

interface Props {
  user?: { uid?: string } | null;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function RecortarTab({ user }: Props) {
  const { t } = useLanguage();
  const rt = t.recortarTab;
  const uid = user?.uid || auth.currentUser?.uid;
  const [videoUrl, setVideoUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [srcW, setSrcW] = useState(0);
  const [srcH, setSrcH] = useState(0);
  const [dur, setDur] = useState(0);
  const [crop, setCrop] = useState({ x: 0, y: 0, w: 1, h: 1 });
  const [lockToCrop, setLockToCrop] = useState(true);
  const [outW, setOutW] = useState(0);
  const [outH, setOutH] = useState(0);
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [resultUrl, setResultUrl] = useState('');
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const upload = async (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('video/')) return toast.error(rt.toasts.invalidFile);
    if (!uid) return toast.error(rt.toasts.login);
    setUploading(true);
    try {
      const safe = file.name.replace(/[^a-z0-9.-]/gi, '_');
      const r = ref(storage, `video/${uid}/recortar/${Date.now()}-${safe}`);
      await uploadBytes(r, file, { contentType: file.type || 'video/mp4' });
      setVideoUrl(await getDownloadURL(r));
      setResultUrl('');
      setCrop({ x: 0, y: 0, w: 1, h: 1 });
      toast.success(rt.toasts.videoLoaded);
    } catch (e: any) {
      toast.error(e?.message || rt.toasts.uploadFailed);
    } finally {
      setUploading(false);
    }
  };

  const startDrag = (mode: 'move' | 'resize', e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const start = { ...crop };
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / rect.width;
      const dy = (ev.clientY - startY) / rect.height;
      if (mode === 'move') {
        setCrop((c) => ({
          ...c,
          x: clamp(start.x + dx, 0, 1 - c.w),
          y: clamp(start.y + dy, 0, 1 - c.h),
        }));
      } else {
        setCrop((c) => ({
          ...c,
          w: clamp(start.w + dx, 0.05, 1 - c.x),
          h: clamp(start.h + dy, 0.05, 1 - c.y),
        }));
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const cropPxW = Math.round(crop.w * srcW);
  const cropPxH = Math.round(crop.h * srcH);
  const effOutW = lockToCrop ? cropPxW : outW;
  const effOutH = lockToCrop ? cropPxH : outH;

  const apply = async () => {
    if (!videoUrl) return toast.error(rt.toasts.uploadFirst);
    if (!uid) return toast.error(rt.toasts.login);
    setProcessing(true);
    const tid = 'crop-resize';
    toast.loading(rt.toasts.processing, { id: tid });
    try {
      const r = await fetch('/api/video/crop-resize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl,
          crop,
          outW: effOutW,
          outH: effOutH,
          startSec,
          endSec: endSec > startSec ? endSec : 0,
          userId: uid,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d.url) throw new Error(d.error || rt.toasts.processFailed);
      setResultUrl(d.url);
      toast.success(rt.toasts.done, { id: tid });
    } catch (e: any) {
      toast.error(e?.message || rt.toasts.processError, { id: tid });
    } finally {
      setProcessing(false);
    }
  };

  const box =
    'bg-white dark:bg-gray-900/70 rounded-2xl border border-gray-200 dark:border-gray-800 p-4';
  const numCls =
    'w-24 px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100 text-sm';

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Crop size={20} className="text-blue-700 dark:text-blue-400" />
        <h2 className="text-lg font-black text-gray-900 dark:text-gray-100">{rt.title}</h2>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 -mt-2">{rt.subtitle}</p>

      {!videoUrl ? (
        <label
          className={
            box +
            ' flex flex-col items-center justify-center gap-2 py-12 border-2 border-dashed cursor-pointer text-blue-700 dark:text-blue-300'
          }
        >
          {uploading ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
          <span className="text-sm font-black uppercase tracking-widest">{rt.uploadLabel}</span>
          <input
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => upload(e.target.files?.[0])}
          />
        </label>
      ) : (
        <>
          {/* Preview com caixa de recorte */}
          <div className={box}>
            <div
              ref={wrapRef}
              className="relative w-full bg-black rounded-lg overflow-hidden select-none"
              style={{ touchAction: 'none' }}
            >
              <video
                src={videoUrl}
                controls
                className="w-full max-h-[420px] mx-auto block"
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  setSrcW(v.videoWidth);
                  setSrcH(v.videoHeight);
                  setDur(v.duration || 0);
                  setEndSec(v.duration || 0);
                  setOutW(v.videoWidth);
                  setOutH(v.videoHeight);
                }}
              />
              {/* Overlay do recorte */}
              <div
                onPointerDown={(e) => startDrag('move', e)}
                className="absolute border-2 border-blue-400 bg-blue-400/10 cursor-move"
                style={{
                  left: `${crop.x * 100}%`,
                  top: `${crop.y * 100}%`,
                  width: `${crop.w * 100}%`,
                  height: `${crop.h * 100}%`,
                }}
              >
                <div
                  onPointerDown={(e) => startDrag('resize', e)}
                  className="absolute -right-1.5 -bottom-1.5 w-4 h-4 rounded-full bg-blue-500 border-2 border-white cursor-nwse-resize"
                />
              </div>
            </div>
            <p className="mt-2 text-[11px] text-gray-400">
              {rt.sourceInfo(srcW, srcH, cropPxW, cropPxH)}
            </p>
          </div>

          {/* Tamanho de saída */}
          <div className={box + ' space-y-2'}>
            <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">
              {rt.outputSizeLabel}
            </span>
            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
              <input
                type="checkbox"
                checked={lockToCrop}
                onChange={(e) => setLockToCrop(e.target.checked)}
                className="accent-blue-600"
              />
              {rt.useCropSizeLabel(cropPxW, cropPxH)}
            </label>
            {!lockToCrop && (
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                {rt.widthLabel}
                <input
                  type="number"
                  value={outW}
                  min={2}
                  onChange={(e) => setOutW(Number(e.target.value))}
                  className={numCls}
                />
                × {rt.heightLabel}
                <input
                  type="number"
                  value={outH}
                  min={2}
                  onChange={(e) => setOutH(Number(e.target.value))}
                  className={numCls}
                />
                {rt.px}
              </div>
            )}
          </div>

          {/* Corte no tempo (opcional) */}
          <div className={box + ' space-y-2'}>
            <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">
              {rt.trimTimeLabel(dur.toFixed(1))}
            </span>
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              {rt.fromLabel}
              <input
                type="number"
                value={startSec}
                min={0}
                step={0.1}
                onChange={(e) => setStartSec(Math.max(0, Number(e.target.value)))}
                className={numCls}
              />
              {rt.toLabel}
              <input
                type="number"
                value={endSec}
                min={0}
                step={0.1}
                onChange={(e) => setEndSec(Number(e.target.value))}
                className={numCls}
              />
              {rt.secondsLabel}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={apply}
              disabled={processing}
              className="flex-1 py-3 bg-blue-700 text-white rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-blue-800 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {processing ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> {rt.processingButton}
                </>
              ) : (
                <>
                  <Scissors size={16} /> {rt.applyButton}
                </>
              )}
            </button>
            <button
              onClick={() => {
                setVideoUrl('');
                setResultUrl('');
              }}
              className="px-4 py-3 rounded-2xl border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-xs font-black uppercase tracking-widest"
            >
              {rt.changeVideoButton}
            </button>
          </div>

          {resultUrl && (
            <div className={box + ' space-y-2'}>
              <span className="text-[11px] font-black uppercase tracking-widest text-green-600">
                {rt.resultLabel}
              </span>
              <video
                src={resultUrl}
                controls
                className="w-full max-h-[420px] rounded-lg bg-black"
              />
              <a
                href={resultUrl}
                target="_blank"
                rel="noreferrer"
                download
                className="inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-widest text-gray-600 dark:text-gray-300 hover:underline"
              >
                <Download size={12} /> {rt.downloadButton}
              </a>
            </div>
          )}
        </>
      )}
    </div>
  );
}
