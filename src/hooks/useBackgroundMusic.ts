// Música de fundo ambiente ENQUANTO TRABALHA no app — nada a ver com a
// trilha sonora dos vídeos que o usuário está montando (isso é outro
// sistema, biblioteca de música por projeto). Composta e sintetizada via
// Web Audio (osciladores + reverb algorítmico), não um arquivo — evita
// licenciar uma faixa de verdade e permite tocar pra sempre sem repetir.
//
// Estilo-alvo: trilha ambiente do Minecraft (C418). 3 vozes rodando juntas:
//   1. Pad — acorde sustentado bem quieto, dá o "chão" harmônico.
//   2. Melodia — notas soltas de piano, mas seguindo um passeio aleatório
//      "grudado" na nota anterior (não pulos aleatórios grandes toda vez —
//      isso é o que faz soar musical em vez de tecla batida ao acaso).
//   3. Brilho — 1 em 4 notas da melodia ganha um eco 1 oitava acima, bem
//      baixinho, tipo sino — textura, não outra melodia.
import { useEffect, useRef } from 'react';

// Acordes em Dó maior, registro médio (C3-G4) — NÃO o registro grave
// (A2-E3) da primeira versão, que soava "eerie"/trilha de terror.
const CHORDS_HZ: number[][] = [
  [130.81, 164.81, 196.0], // C3 E3 G3 — I
  [110.0, 130.81, 164.81], // A2... trocado abaixo por A3 pra ficar no médio
  [174.61, 220.0, 261.63], // F3 A3 C4 — IV
  [196.0, 246.94, 293.66], // G3 B3 D4 — V
];
// Corrige a 2ª entrada pra registro médio (A3 C4 E4 — vi), mantendo o array
// literal legível acima como referência de "qual acorde é esse".
CHORDS_HZ[1] = [220.0, 261.63, 329.63];

// Dó maior pentatônica, 2 oitavas — sem semitom dissonante nunca.
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
const BASS_HZ = [130.81, 196.0]; // C3, G3

function buildReverbImpulse(ctx: BaseAudioContext, seconds = 2.8, decay = 3): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
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

    // Reverb algorítmico compartilhado pelas 3 vozes — dá o "salão" comum
    // que faz elas soarem como uma peça só, não 3 sons desconectados.
    const convolver = ctx.createConvolver();
    convolver.buffer = buildReverbImpulse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    convolver.connect(wet);
    wet.connect(master);
    const dry = ctx.createGain();
    dry.gain.value = 0.55;
    dry.connect(master);

    let cancelled = false;
    const timeouts: number[] = [];
    const activeOsc: OscillatorNode[] = [];

    const voice = (
      freq: number,
      gainPeak: number,
      durationS: number,
      startAt: number,
      opts: { type?: OscillatorType; pan?: number } = {}
    ) => {
      const osc = ctx.createOscillator();
      osc.type = opts.type || 'sine';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, startAt);
      g.gain.linearRampToValueAtTime(gainPeak, startAt + Math.min(0.4, durationS * 0.05));
      g.gain.exponentialRampToValueAtTime(0.0001, startAt + durationS);
      const panner = ctx.createStereoPanner();
      panner.pan.value = opts.pan ?? 0;
      osc.connect(g);
      g.connect(panner);
      panner.connect(dry);
      panner.connect(convolver);
      osc.start(startAt);
      osc.stop(startAt + durationS + 0.15);
      activeOsc.push(osc);
    };

    // "Piano": seno principal + triângulo baixinho por cima pro corpo.
    const pluck = (freq: number, gainPeak: number, durationS: number, pan = 0) => {
      const now = ctx.currentTime;
      voice(freq, gainPeak, durationS, now, { type: 'sine', pan });
      voice(freq, gainPeak * 0.18, durationS, now, { type: 'triangle', pan });
    };

    // ── Voz 1: pad harmônico sustentado, bem quieto ──────────────────────
    let chordIdx = 0;
    const playChord = () => {
      if (cancelled) return;
      const chord = CHORDS_HZ[chordIdx % CHORDS_HZ.length]!;
      chordIdx++;
      const now = ctx.currentTime;
      chord.forEach((freq, i) => {
        voice(freq, i === 0 ? 0.045 : 0.03, 7.5, now, { type: 'sine', pan: (i - 1) * 0.15 });
      });
      timeouts.push(window.setTimeout(playChord, 7000));
    };
    playChord();

    // ── Voz 2: melodia — passeio aleatório grudado na nota anterior ─────
    let scaleIdx = Math.floor(SCALE_HZ.length / 2);
    const scheduleMelody = () => {
      if (cancelled) return;
      // 80% das vezes anda 1-2 graus da escala perto da nota anterior (soa
      // "conectado"); 20% pula pra qualquer nota (evita ficar preso/repetitivo).
      if (Math.random() < 0.8) {
        const step = (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 2));
        scaleIdx = Math.max(0, Math.min(SCALE_HZ.length - 1, scaleIdx + step));
      } else {
        scaleIdx = Math.floor(Math.random() * SCALE_HZ.length);
      }
      const freq = SCALE_HZ[scaleIdx]!;
      const pan = (Math.random() - 0.5) * 0.6;
      pluck(freq, 0.1 + Math.random() * 0.05, 2.4 + Math.random() * 1.4, pan);

      // Brilho: 1 em 4 notas ecoa 1 oitava acima, bem baixinho, tipo sino.
      if (Math.random() < 0.25) {
        voice(freq * 2, 0.035, 1.8, ctx.currentTime + 0.02, { type: 'triangle', pan });
      }
      // 1 em 8 toca uma nota grave junto, dá ancoragem.
      if (Math.random() < 1 / 8) {
        const bass = BASS_HZ[Math.floor(Math.random() * BASS_HZ.length)]!;
        pluck(bass, 0.04, 3.5, 0);
      }
      // Mais denso que a v1 (era 1.5-4.5s): 0.9-2.3s entre notas.
      const gapMs = 900 + Math.random() * 1400;
      timeouts.push(window.setTimeout(scheduleMelody, gapMs));
    };
    scheduleMelody();

    stopFnRef.current = () => {
      cancelled = true;
      timeouts.forEach((id) => window.clearTimeout(id));
      const now = ctx.currentTime;
      master.gain.linearRampToValueAtTime(0, now + 0.8);
      setTimeout(() => {
        activeOsc.forEach((o) => {
          try {
            o.stop();
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

  // Volume ajustável em tempo real sem reiniciar a composição inteira.
  useEffect(() => {
    if (masterGainRef.current && ctxRef.current) {
      masterGainRef.current.gain.linearRampToValueAtTime(volume, ctxRef.current.currentTime + 0.2);
    }
  }, [volume]);
}
