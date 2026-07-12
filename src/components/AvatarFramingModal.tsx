import { useEffect, useMemo, useRef, useState } from 'react';

// Enquadramento do avatar reaproveitado em todos os trechos do mesmo avatar.
// CORTAR: cropL/R/T/B removem faixas do vídeo base (ex.: legenda no rodapé),
//   frações 0..0.45 de cada lado — aplicado ANTES de tudo.
// SPLIT: caixa de proporção da metade, posicionada por splitCX/splitCY (centro
//   0..1) e dimensionada por splitSize (escala da MAIOR caixa que cabe, 0.4..1;
//   1 = mais aberto, menor = mais zoom).
// PIP: círculo por pipCX/pipCY (centro 0..1) e pipSize (diâmetro como fração do
//   menor lado, 0.2..1).
export interface AvatarFraming {
  splitCX: number;
  splitCY: number;
  splitSize: number;
  pipCX: number;
  pipCY: number;
  pipSize: number;
  cropL: number;
  cropR: number;
  cropT: number;
  cropB: number;
}

export const DEFAULT_AVATAR_FRAMING: AvatarFraming = {
  splitCX: 0.5,
  splitCY: 0.4,
  splitSize: 1,
  pipCX: 0.5,
  pipCY: 0.28,
  pipSize: 0.72,
  cropL: 0,
  cropR: 0,
  cropT: 0,
  cropB: 0,
};

const OUT_DIMS: Record<string, { w: number; h: number }> = {
  '16:9': { w: 1920, h: 1080 },
  '9:16': { w: 1080, h: 1920 },
  '1:1': { w: 1080, h: 1080 },
};

interface Props {
  avatarUrl: string;
  aspect: '1:1' | '9:16' | '16:9';
  value: AvatarFraming;
  onSave: (f: AvatarFraming) => void;
  onClose: () => void;
}

type Drag = 'move' | 'resize' | 'crop-l' | 'crop-r' | 'crop-t' | 'crop-b';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function AvatarFramingModal({ avatarUrl, aspect, value, onSave, onClose }: Props) {
  const [tab, setTab] = useState<'crop' | 'split' | 'pip'>('split');
  const [f, setF] = useState<AvatarFraming>({ ...DEFAULT_AVATAR_FRAMING, ...value });
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [dur, setDur] = useState(0);
  const [cur, setCur] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);

  const out = OUT_DIMS[aspect] || OUT_DIMS['1:1']!;
  // Proporção da metade do split conforme o formato de saída: vertical → metade
  // em cima/baixo (larga); demais → metade lateral (retrato). É só o PREVIEW —
  // o render usa a orientação real de cada trecho, mas o centro/zoom valem igual.
  const ar = aspect === '9:16' ? out.w / (out.h / 2) : out.w / 2 / out.h;

  // Caixa do split: escala da maior caixa (proporção ar) que cabe na fonte.
  const sbox = useMemo(() => {
    if (!nat) return { wf: 0.5, hf: 1 };
    const maxBoxW = Math.min(nat.w, nat.h * ar);
    const boxW = maxBoxW * f.splitSize;
    const boxH = (maxBoxW / ar) * f.splitSize;
    return { wf: boxW / nat.w, hf: boxH / nat.h };
  }, [nat, ar, f.splitSize]);

  const circle = useMemo(() => {
    if (!nat) return { dWf: 0.5, dHf: 0.5 };
    const side = Math.min(nat.w, nat.h) * f.pipSize;
    return { dWf: side / nat.w, dHf: side / nat.h };
  }, [nat, f.pipSize]);

  const halfWf = (tab === 'split' ? sbox.wf : circle.dWf) / 2;
  const halfHf = (tab === 'split' ? sbox.hf : circle.dHf) / 2;
  const cxKey = tab === 'split' ? 'splitCX' : 'pipCX';
  const cyKey = tab === 'split' ? 'splitCY' : 'pipCY';
  const curCX = tab === 'split' ? f.splitCX : f.pipCX;
  const curCY = tab === 'split' ? f.splitCY : f.pipCY;

  const rect = () => boxRef.current?.getBoundingClientRect();

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const mode = dragRef.current;
      const r = rect();
      if (!mode || !r || !nat) return;
      const px = clamp((e.clientX - r.left) / r.width, 0, 1);
      const py = clamp((e.clientY - r.top) / r.height, 0, 1);
      if (mode === 'crop-l') setF((s) => ({ ...s, cropL: clamp(px, 0, 1 - s.cropR - 0.1) }));
      else if (mode === 'crop-r') setF((s) => ({ ...s, cropR: clamp(1 - px, 0, 1 - s.cropL - 0.1) }));
      else if (mode === 'crop-t') setF((s) => ({ ...s, cropT: clamp(py, 0, 1 - s.cropB - 0.1) }));
      else if (mode === 'crop-b') setF((s) => ({ ...s, cropB: clamp(1 - py, 0, 1 - s.cropT - 0.1) }));
      else if (mode === 'move') {
        setF((s) => ({ ...s, [cxKey]: clamp(px, halfWf, 1 - halfWf), [cyKey]: clamp(py, halfHf, 1 - halfHf) }));
      } else if (mode === 'resize') {
        const cxPx = curCX * r.width;
        const cyPx = curCY * r.height;
        if (tab === 'pip') {
          const distPx = Math.hypot(e.clientX - r.left - cxPx, e.clientY - r.top - cyPx);
          const diamNat = distPx * 2 * (nat.w / r.width);
          const minSide = Math.min(nat.w, nat.h);
          const newSize = clamp(diamNat / minSide, 0.2, 1);
          setF((s) => {
            const rWf = (newSize * (minSide / nat.w)) / 2;
            const rHf = (newSize * (minSide / nat.h)) / 2;
            return { ...s, pipSize: newSize, pipCX: clamp(s.pipCX, rWf, 1 - rWf), pipCY: clamp(s.pipCY, rHf, 1 - rHf) };
          });
        } else {
          const halfWpx = Math.abs(e.clientX - r.left - cxPx);
          const boxWnat = halfWpx * 2 * (nat.w / r.width);
          const maxBoxW = Math.min(nat.w, nat.h * ar);
          const newSize = clamp(boxWnat / maxBoxW, 0.4, 1);
          setF((s) => {
            const bW = maxBoxW * newSize;
            const bH = (maxBoxW / ar) * newSize;
            const rWf = bW / nat.w / 2;
            const rHf = bH / nat.h / 2;
            return { ...s, splitSize: newSize, splitCX: clamp(s.splitCX, rWf, 1 - rWf), splitCY: clamp(s.splitCY, rHf, 1 - rHf) };
          });
        }
      }
    };
    const onUp = () => (dragRef.current = null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [nat, tab, halfWf, halfHf, cxKey, cyKey, curCX, curCY, ar]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  };

  const shade = '0 0 0 9999px rgba(0,0,0,0.55)';
  const edge = 'absolute bg-violet-400/90';

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[94vh] overflow-y-auto bg-white dark:bg-gray-900 rounded-3xl border-2 border-violet-200 dark:border-violet-900/60 shadow-2xl p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black uppercase tracking-widest text-violet-600 dark:text-violet-400">
            Enquadrar avatar
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-red-500 text-lg leading-none">
            ✕
          </button>
        </div>

        <div className="flex gap-1 p-1 rounded-xl bg-gray-100 dark:bg-gray-800">
          {(['crop', 'split', 'pip'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition ${
                tab === t ? 'bg-violet-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:text-violet-600'
              }`}
            >
              {t === 'crop' ? '✂ Cortar' : t === 'split' ? '▮ Split' : '◎ PiP'}
            </button>
          ))}
        </div>

        <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug">
          {tab === 'crop'
            ? 'Arraste as bordas pra cortar faixas do vídeo (ex.: legenda embaixo). Some pra todos os trechos deste avatar.'
            : tab === 'split'
              ? 'Arraste a caixa pra posicionar e a alça pra mudar o tamanho do avatar no split. Vale pra todos os trechos.'
              : 'Arraste o círculo pra centralizar no rosto; a alça muda o tamanho. Vale pra todos os trechos.'}
        </p>

        {/* Frame do avatar (altura limitada pra caber) + overlay */}
        <div className="flex justify-center">
          <div
            ref={boxRef}
            className="relative inline-block overflow-hidden rounded-xl bg-black select-none touch-none"
            style={{ maxHeight: '52vh' }}
          >
            <video
              ref={videoRef}
              src={avatarUrl}
              muted
              playsInline
              className="block w-auto max-w-full pointer-events-none"
              style={{ maxHeight: '52vh' }}
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                setNat({ w: v.videoWidth || 1920, h: v.videoHeight || 1080 });
                setDur(v.duration || 0);
              }}
              onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
              onEnded={() => setPlaying(false)}
            />

            {/* SPLIT / PIP: caixa arrastável + alça de resize */}
            {nat && tab !== 'crop' && (
              <div
                onPointerDown={() => (dragRef.current = 'move')}
                className={`absolute border-2 border-white/90 ${tab === 'pip' ? 'rounded-full' : 'rounded-md'}`}
                style={{
                  left: `${(curCX - halfWf) * 100}%`,
                  top: `${(curCY - halfHf) * 100}%`,
                  width: `${halfWf * 2 * 100}%`,
                  height: `${halfHf * 2 * 100}%`,
                  boxShadow: shade,
                  cursor: 'move',
                }}
              >
                <div
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    dragRef.current = 'resize';
                  }}
                  className="absolute -bottom-1.5 -right-1.5 w-4 h-4 rounded-full bg-violet-500 border-2 border-white cursor-nwse-resize"
                  title="Redimensionar"
                />
              </div>
            )}

            {/* CORTAR: retângulo mantido + 4 bordas arrastáveis */}
            {nat && tab === 'crop' && (
              <div
                className="absolute border-2 border-violet-400/90"
                style={{
                  left: `${f.cropL * 100}%`,
                  top: `${f.cropT * 100}%`,
                  right: `${f.cropR * 100}%`,
                  bottom: `${f.cropB * 100}%`,
                  boxShadow: shade,
                }}
              >
                <div
                  onPointerDown={(e) => { e.stopPropagation(); dragRef.current = 'crop-t'; }}
                  className={`${edge} -top-1 left-0 right-0 h-2 cursor-ns-resize`}
                />
                <div
                  onPointerDown={(e) => { e.stopPropagation(); dragRef.current = 'crop-b'; }}
                  className={`${edge} -bottom-1 left-0 right-0 h-2 cursor-ns-resize`}
                />
                <div
                  onPointerDown={(e) => { e.stopPropagation(); dragRef.current = 'crop-l'; }}
                  className={`${edge} -left-1 top-0 bottom-0 w-2 cursor-ew-resize`}
                />
                <div
                  onPointerDown={(e) => { e.stopPropagation(); dragRef.current = 'crop-r'; }}
                  className={`${edge} -right-1 top-0 bottom-0 w-2 cursor-ew-resize`}
                />
              </div>
            )}
          </div>
        </div>

        {/* Scrubber pra achar um frame representativo */}
        <div className="flex items-center gap-2">
          <button
            onClick={togglePlay}
            className="w-8 h-8 shrink-0 rounded-full bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-xs font-black"
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <input
            type="range"
            min={0}
            max={dur || 0}
            step={0.05}
            value={cur}
            onChange={(e) => {
              const t = Number(e.target.value);
              if (videoRef.current) videoRef.current.currentTime = t;
              setCur(t);
            }}
            className="flex-1 accent-violet-600"
          />
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            onClick={() =>
              setF((s) =>
                tab === 'crop'
                  ? { ...s, cropL: 0, cropR: 0, cropT: 0, cropB: 0 }
                  : { ...DEFAULT_AVATAR_FRAMING, cropL: s.cropL, cropR: s.cropR, cropT: s.cropT, cropB: s.cropB }
              )
            }
            className="text-[11px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-600"
          >
            Resetar {tab === 'crop' ? 'corte' : 'aba'}
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Cancelar
            </button>
            <button
              onClick={() => onSave(f)}
              className="px-4 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-widest bg-violet-600 text-white hover:bg-violet-700"
            >
              Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
