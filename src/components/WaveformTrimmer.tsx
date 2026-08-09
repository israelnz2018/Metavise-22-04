import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

interface Props {
  url: string;
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
  height?: number;
}

// Corte de áudio VISUAL: desenha a forma de onda de verdade (decodada via Web
// Audio API, não um placeholder) e deixa arrastar as duas bordas da seleção
// direto em cima do desenho — em vez de digitar segundo a segundo às cegas
// (era assim antes: 2 campos numéricos + "ouvir trecho" pra tentar acertar).
export function WaveformTrimmer({ url, start, end, onChange, height = 64 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const dragRef = useRef<'start' | 'end' | null>(null);

  // Decodifica o áudio UMA vez por URL — extrai o pico (min/max) de cada
  // "coluna" de pixel, não a onda inteira (seria pesado demais pra desenhar).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPeaks(null);
    (async () => {
      try {
        const Ctor = window.AudioContext || (window as any).webkitAudioContext;
        if (!Ctor) throw new Error('Navegador sem suporte a Web Audio.');
        // O bucket do Firebase Storage não libera CORS pra leitura de bytes
        // via fetch() do navegador (só permite <audio src> normal). Passa
        // pelo proxy do servidor — já existe e é genérico (não é só imagem,
        // apesar do nome: só repassa bytes + content-type de qualquer URL).
        const res = await fetch(`/api/proxy-image?url=${encodeURIComponent(url)}`);
        if (!res.ok) throw new Error(`Falha ao baixar áudio (HTTP ${res.status}).`);
        const arrayBuffer = await res.arrayBuffer();
        const ctx = new Ctor();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        if (cancelled) return;
        const channel = audioBuffer.getChannelData(0);
        const width = containerRef.current?.clientWidth || 400;
        const bucketSize = Math.max(1, Math.floor(channel.length / width));
        const computed: number[] = [];
        for (let i = 0; i < width; i++) {
          const from = i * bucketSize;
          const to = Math.min(channel.length, from + bucketSize);
          let peak = 0;
          for (let j = from; j < to; j++) {
            const abs = Math.abs(channel[j]!);
            if (abs > peak) peak = abs;
          }
          computed.push(peak);
        }
        setPeaks(computed);
        setDuration(audioBuffer.duration);
        ctx.close().catch(() => {});
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Não consegui carregar a forma de onda.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  // Redesenha sempre que os picos, a seleção ou o tamanho mudam.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks || !duration) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const mid = height / 2;
    const startX = (start / duration) * width;
    const endX = (end / duration) * width;

    // Barra por pixel — fora da seleção fica esmaecida, dentro fica cheia.
    const barW = width / peaks.length;
    peaks.forEach((p, i) => {
      const x = i * barW;
      const barH = Math.max(1, p * (height - 6));
      const selected = x >= startX && x <= endX;
      ctx.fillStyle = selected
        ? '#9333ea'
        : document.documentElement.classList.contains('dark')
          ? '#3f3f52'
          : '#d4d4e0';
      ctx.fillRect(x, mid - barH / 2, Math.max(1, barW - 0.5), barH);
    });

    // Região selecionada — leve realce translúcido por cima.
    ctx.fillStyle = 'rgba(147, 51, 234, 0.08)';
    ctx.fillRect(startX, 0, endX - startX, height);

    // Handles das bordas.
    ctx.fillStyle = '#9333ea';
    ctx.fillRect(startX - 1.5, 0, 3, height);
    ctx.fillRect(endX - 1.5, 0, 3, height);
  }, [peaks, duration, start, end, height]);

  const xToSec = (clientX: number): number => {
    const canvas = canvasRef.current;
    if (!canvas || !duration) return 0;
    const rect = canvas.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Number((frac * duration).toFixed(2));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!duration) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const startX = (start / duration) * rect.width;
    const endX = (end / duration) * rect.width;
    const clickX = e.clientX - rect.left;
    // Pega a borda mais próxima do clique (tolerância de 12px) — clicar bem
    // no meio da seleção arrasta a borda mais perto, não trava sem fazer nada.
    dragRef.current = Math.abs(clickX - startX) <= Math.abs(clickX - endX) ? 'start' : 'end';
    canvas.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return;
    const sec = xToSec(e.clientX);
    if (dragRef.current === 'start') {
      onChange(Math.min(sec, end - 0.05), end);
    } else {
      onChange(start, Math.max(sec, start + 0.05));
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
  };

  return (
    <div ref={containerRef} className="w-full">
      {loading && (
        <div
          className="flex items-center justify-center gap-2 text-xs text-gray-400 rounded-lg bg-gray-100 dark:bg-gray-800"
          style={{ height }}
        >
          <Loader2 size={14} className="animate-spin" /> Carregando forma de onda…
        </div>
      )}
      {error && !loading && (
        <div
          className="flex items-center justify-center text-xs text-gray-400 rounded-lg bg-gray-100 dark:bg-gray-800 px-3 text-center"
          style={{ height }}
        >
          {error} — os campos numéricos abaixo continuam funcionando.
        </div>
      )}
      {!loading && !error && (
        <canvas
          ref={canvasRef}
          style={{ height, width: '100%', touchAction: 'none' }}
          className="rounded-lg cursor-ew-resize block"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
      )}
    </div>
  );
}
