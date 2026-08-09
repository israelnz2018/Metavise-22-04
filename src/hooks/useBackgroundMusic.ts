// Música de fundo ambiente ENQUANTO TRABALHA no app — nada a ver com a
// trilha sonora dos vídeos que o usuário está montando (isso é outro
// sistema, biblioteca de música por projeto). É gerada via Web Audio
// (poucos osciladores destacados numa progressão lenta + filtro passa-baixa
// respirando), não um arquivo — evita licenciar uma faixa lo-fi de verdade.
import { useEffect, useRef } from 'react';

// Progressão simples e consonante (Am7-ish → C-ish), grave, pra não competir
// com o resto da atenção do usuário.
const CHORDS: number[][] = [
  [110, 130.81, 164.81], // A2, C3, E3
  [98, 123.47, 146.83], // G2, B2, D3
];
const CHORD_DURATION_S = 8;

export function useBackgroundMusic(enabled: boolean, volume: number) {
  const ctxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const stopFnRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled) {
      stopFnRef.current?.();
      stopFnRef.current = null;
      return;
    }
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    ctxRef.current = ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    masterGainRef.current = master;
    // Fade-in suave — ligar música do nada em volume cheio assusta.
    master.gain.linearRampToValueAtTime(volume, ctx.currentTime + 1.5);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800;
    filter.connect(master);

    const oscillators: OscillatorNode[] = [];
    let chordIdx = 0;
    let cancelled = false;

    const playChord = () => {
      if (cancelled) return;
      oscillators.forEach((o) => {
        try {
          o.stop();
        } catch {
          /* já parado */
        }
      });
      oscillators.length = 0;
      const chord = CHORDS[chordIdx % CHORDS.length]!;
      chordIdx++;
      chord.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.value = i === 0 ? 0.35 : 0.18; // fundamental mais forte
        osc.connect(g);
        g.connect(filter);
        osc.start();
        oscillators.push(osc);
      });
    };

    playChord();
    const interval = window.setInterval(playChord, CHORD_DURATION_S * 1000);

    // LFO bem lento no filtro — dá a sensação de "respirar" em vez de tom parado.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 300;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    stopFnRef.current = () => {
      cancelled = true;
      window.clearInterval(interval);
      const now = ctx.currentTime;
      master.gain.linearRampToValueAtTime(0, now + 0.8);
      setTimeout(() => {
        oscillators.forEach((o) => {
          try {
            o.stop();
          } catch {
            /* já parado */
          }
        });
        try {
          lfo.stop();
        } catch {
          /* já parado */
        }
        ctx.close().catch(() => {});
      }, 900);
    };

    return () => {
      stopFnRef.current?.();
      stopFnRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Volume ajustável em tempo real sem reiniciar a progressão inteira.
  useEffect(() => {
    if (masterGainRef.current && ctxRef.current) {
      masterGainRef.current.gain.linearRampToValueAtTime(volume, ctxRef.current.currentTime + 0.2);
    }
  }, [volume]);
}
