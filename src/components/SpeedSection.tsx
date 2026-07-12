import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage, auth } from '@/lib/firebase';
import { Gauge, Loader2, Upload, Check, X } from 'lucide-react';

interface VideoOption {
  url: string;
  label: string;
}
interface Props {
  /** Vídeos candidatos (galeria + mesclados). A seção também aceita upload. */
  videoOptions: VideoOption[];
  userId?: string;
  /** Chamado com o novo vídeo (já na velocidade escolhida). O pai adiciona à galeria. */
  onSpeedVersionReady: (url: string) => void;
  disabled?: boolean;
}

const SPEEDS = [
  0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.4, 1.5, 1.75, 2.0,
  2.5,
];

export function SpeedSection({ videoOptions, userId, onSpeedVersionReady, disabled }: Props) {
  const [uploads, setUploads] = useState<VideoOption[]>([]);
  const options = useMemo(() => {
    const seen = new Set<string>();
    return [...videoOptions, ...uploads].filter(
      (o) => o.url && !seen.has(o.url) && seen.add(o.url)
    );
  }, [videoOptions, uploads]);

  const [targetUrl, setTargetUrl] = useState('');
  const [speed, setSpeed] = useState(1);
  const [manual, setManual] = useState(false);
  const [manualVal, setManualVal] = useState('1.0');
  const [uploading, setUploading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Sem auto-seleção: o vídeo só aparece DEPOIS que o usuário escolhe.
  const effSpeed = manual ? Math.max(0.25, Math.min(Number(manualVal) || 1, 4)) : speed;

  // Remove o vídeo escolhido da seção (limpa a seleção; se era um upload local,
  // tira da lista também).
  const clearTarget = () => {
    setUploads((prev) => prev.filter((u) => u.url !== targetUrl));
    setTargetUrl('');
  };

  // Preview: aplica a velocidade no player (não salva — é só pra conferir).
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = effSpeed;
  }, [effSpeed, targetUrl]);

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
      const r = ref(storage, `video/${uid}/speed-upload/${Date.now()}-${safe}`);
      await uploadBytes(r, file, { contentType: file.type || 'video/mp4' });
      const url = await getDownloadURL(r);
      setUploads((prev) => [...prev, { url, label: `Upload ${prev.length + 1}` }]);
      setTargetUrl(url);
      toast.success('Vídeo enviado e selecionado.');
    } catch (e: any) {
      toast.error(e?.message || 'Falha no upload.');
    } finally {
      setUploading(false);
    }
  };

  const apply = async () => {
    const uid = userId || auth.currentUser?.uid;
    if (!targetUrl || !uid) return;
    setRendering(true);
    setError(null);
    try {
      const r = await fetch('/api/video/speed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: targetUrl, userId: uid, speed: effSpeed }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Falha ao mudar a velocidade.');
      onSpeedVersionReady(data.url);
      toast.success(`Vídeo gerado em ${effSpeed}× e adicionado à galeria.`);
    } catch (e: any) {
      setError(e?.message || 'Erro ao gerar.');
    } finally {
      setRendering(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-900/80 p-6 md:p-8 rounded-[32px] border-2 border-gray-200 dark:border-gray-800 shadow-sm space-y-4">
      <div className="flex items-center gap-2">
        <Gauge size={18} className="text-blue-600 dark:text-blue-400" />
        <h4 className="text-lg font-black text-gray-900 dark:text-gray-50">Velocidade</h4>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Escolha um vídeo (ou envie um) e a velocidade — salva um <strong>novo vídeo de verdade</strong>{' '}
        naquela velocidade (não é só o preview).
      </p>

      {/* alvo + upload */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={targetUrl}
          onChange={(e) => setTargetUrl(e.target.value)}
          className="flex-1 min-w-[180px] px-3 py-2.5 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100"
        >
          <option value="">
            {options.length === 0 ? 'Nenhum vídeo — envie um' : 'Selecione um vídeo…'}
          </option>
          {options.map((o) => (
            <option key={o.url} value={o.url}>
              {o.label}
            </option>
          ))}
        </select>
        {targetUrl && (
          <button
            onClick={clearTarget}
            className="text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-red-500 flex items-center gap-1 shrink-0"
            title="Remover este vídeo da seção Velocidade"
          >
            <X size={12} /> Remover
          </button>
        )}
        <label className="text-[10px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300 hover:underline cursor-pointer flex items-center gap-1 shrink-0">
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

      {/* preview */}
      {targetUrl && (
        <video
          ref={videoRef}
          src={targetUrl}
          controls
          onLoadedMetadata={() => {
            if (videoRef.current) videoRef.current.playbackRate = effSpeed;
          }}
          className="w-full max-h-[360px] rounded-2xl bg-black"
        />
      )}

      {/* velocidade */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300">
            Velocidade {!manual && <>· {effSpeed}×</>}
          </span>
          <button
            onClick={() => setManual((m) => !m)}
            className={`text-[10px] font-black uppercase tracking-widest hover:underline ${
              manual ? 'text-blue-700 dark:text-blue-300' : 'text-gray-500'
            }`}
          >
            {manual ? 'Usar presets' : 'Manual'}
          </button>
        </div>

        {manual ? (
          <div className="flex items-center gap-2">
            <input
              type="number"
              step={0.05}
              min={0.25}
              max={4}
              value={manualVal}
              onChange={(e) => setManualVal(e.target.value)}
              className="w-24 px-3 py-2 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-center font-black dark:text-gray-100"
            />
            <span className="text-sm text-gray-500">× (0.25 a 4)</span>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {SPEEDS.map((sp) => (
              <button
                key={sp}
                onClick={() => setSpeed(sp)}
                className={`text-xs font-bold px-2.5 py-1 rounded-lg ${
                  speed === sp
                    ? 'bg-blue-600 text-white'
                    : 'ring-1 ring-gray-200 dark:ring-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                {sp === 1 ? '1× normal' : `${sp}×`}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-xs text-amber-700 dark:text-amber-300 font-bold">{error}</p>}

      <button
        onClick={apply}
        disabled={disabled || rendering || !targetUrl || Math.abs(effSpeed - 1) < 0.001}
        className="w-full py-3.5 bg-gray-900 dark:bg-gray-50 text-white dark:text-gray-900 rounded-2xl font-black uppercase tracking-widest text-sm hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {rendering ? (
          <>
            <Loader2 size={16} className="animate-spin" /> Gerando em {effSpeed}×…
          </>
        ) : (
          <>
            <Check size={16} /> Salvar nessa velocidade ({effSpeed}×)
          </>
        )}
      </button>
      <p className="text-[10px] text-gray-400 dark:text-gray-500 text-center">
        O novo vídeo vai pra galeria de versões (e pode receber música, export, etc.).
      </p>
    </div>
  );
}
