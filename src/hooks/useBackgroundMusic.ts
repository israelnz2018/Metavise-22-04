// Música de fundo ambiente ENQUANTO TRABALHA no app — nada a ver com a
// trilha sonora dos vídeos que o usuário está montando (isso é outro
// sistema, biblioteca de música por projeto). Gerada via Web Audio
// (síntese + reverb algorítmico), não um arquivo — evita licenciar faixa.
//
// Estilo: notas soltas de "piano" (ataque rápido, decay longo com reverb),
// escala maior pentatônica, espaçadas aleatoriamente — igual à trilha
// ambiente do Minecraft (C418), não um pad sustentado (isso soava "eerie").
import { useEffect, useRef } from 'react';

// Dó maior pentatônica, 2 oitavas (C4–G5) — sem semitom dissonante, sempre
// soa "resolvido" não importa a ordem das notas.
const SCALE_HZ = [
  261.63, // C4
  293.66, // D4
  329.63, // E4
  392.0, // G4
  440.0, // A4
  523.25, // C5
  587.33, // D5
  659.25, // E5
  783.99, // G5
];
// Nota grave ocasional, bem baixa no volume — só um lastro quente por baixo.
const BASS_HZ = [130.81, 196.0]; // C3, G3

function buildReverbImpulse(ctx: AudioContext, seconds = 2.5, decay = 3): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = rate * seconds;
  const impulse = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

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
    master.gain.linearRampToValueAtTime(volume, ctx.currentTime + 1.5);

    // Reverb algorítmico (convolver com ruído decaindo) — dá o "salão vazio"
    // característico de trilha ambiente, sem precisar de sample de sala real.
    const convolver = ctx.createConvolver();
    convolver.buffer = buildReverbImpulse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    convolver.connect(wet);
    wet.connect(master);
    const dry = ctx.createGain();
    dry.gain.value = 0.5;
    dry.connect(master);

    let cancelled = false;
    let timeoutId: number | null = null;
    const activeNodes: AudioNode[] = [];

    // Nota "de piano": duas ondas (seno + triângulo baixinho por cima pra dar
    // corpo) com ataque de milissegundos e decay exponencial longo — pluck,
    // não sustentado. Vai pro dry E pro reverb em paralelo.
    const pluck = (freq: number, gainPeak: number, durationS: number) => {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const osc2 = ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.value = freq;
      const g2 = ctx.createGain();
      g2.gain.value = 0.15;
      osc2.connect(g2);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(gainPeak, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + durationS);

      osc.connect(g);
      g2.connect(g);
      g.connect(dry);
      g.connect(convolver);

      osc.start(now);
      osc2.start(now);
      osc.stop(now + durationS + 0.1);
      osc2.stop(now + durationS + 0.1);
      activeNodes.push(osc, osc2);
    };

    const scheduleNext = () => {
      if (cancelled) return;
      // Nota melódica esparsa — volume/duração variam um pouco pra não soar
      // robótico. De vez em quando (1 em 6) toca uma grave por baixo também.
      const freq = SCALE_HZ[Math.floor(Math.random() * SCALE_HZ.length)]!;
      pluck(freq, 0.09 + Math.random() * 0.05, 2.2 + Math.random() * 1.2);
      if (Math.random() < 1 / 6) {
        const bass = BASS_HZ[Math.floor(Math.random() * BASS_HZ.length)]!;
        pluck(bass, 0.04, 3.5);
      }
      // Minecraft-style: silêncio entre notas é a metade da personalidade —
      // gap de 1.5s a 4.5s, aleatório.
      const gapMs = 1500 + Math.random() * 3000;
      timeoutId = window.setTimeout(scheduleNext, gapMs);
    };
    scheduleNext();

    stopFnRef.current = () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
      const now = ctx.currentTime;
      master.gain.linearRampToValueAtTime(0, now + 0.8);
      setTimeout(() => {
        activeNodes.forEach((n) => {
          try {
            (n as OscillatorNode).stop();
          } catch {
            /* já parado */
          }
        });
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
