// "Ding" curto de conclusão (Web Audio — sem arquivo). Toca quando uma geração
// longa termina, pra quem saiu da aba perceber. Respeita uma preferência de mute.
let ctx: AudioContext | null = null;

export function isDingMuted(): boolean {
  try {
    return localStorage.getItem('metavise-ding-muted') === '1';
  } catch {
    return false;
  }
}

export function setDingMuted(muted: boolean) {
  try {
    localStorage.setItem('metavise-ding-muted', muted ? '1' : '0');
  } catch {
    /* ignora */
  }
}

export function playDing() {
  if (isDingMuted()) return;
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    ctx = ctx || new AC();
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.type = 'sine';
    // Duas notas ascendentes — soa "pronto!".
    o.frequency.setValueAtTime(880, now);
    o.frequency.setValueAtTime(1318, now + 0.12);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    o.start(now);
    o.stop(now + 0.45);
  } catch {
    /* sem áudio — ignora */
  }
}
