// Efeitos sonoros da interface — sintetizados via Web Audio API (osciladores),
// não são arquivos de áudio. Zero asset pra baixar/licenciar, resposta
// instantânea, e some sozinho (sem loop escondido tocando).
//
// Fica ligado/desligado por um flag em módulo (não React state) porque é
// consultado de dois lugares que não são componentes: o listener global de
// clique (delegação de evento) e o monkey-patch do toast (abaixo). O
// useAppPreferences hook sincroniza esse flag com a preferência persistida.

let enabled = true;

export function setSfxEnabled(v: boolean) {
  enabled = v;
}

// Multiplicador de volume (0-2, default 1 = já bem mais alto que o volume
// fixo original — pedido do usuário). O slider em Preferências manda 0-2;
// cada tone() abaixo já usa "gain" como o volume-base NOVO (mais alto), e
// esse multiplicador ajusta a partir dali.
let volumeMultiplier = 1;

export function setSfxVolume(v: number) {
  volumeMultiplier = Math.min(2, Math.max(0, v));
}

let ctx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  // Navegadores suspendem o contexto até o 1º gesto do usuário — como isso
  // só toca em resposta a clique/ação, resume é seguro chamar toda vez.
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// Um "blip" curto: oscilador + envelope de volume (ataque rápido, decay
// exponencial) — é o jeito padrão de fazer clique/beep sem estourar o
// alto-falante com um degrau abrupto de volume.
function tone(
  freq: number,
  durationMs: number,
  opts: { type?: OscillatorType; gain?: number } = {}
) {
  const c = getCtx();
  if (!c) return;
  const { type = 'sine', gain = 0.08 } = opts;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(g);
  g.connect(c.destination);
  const now = c.currentTime;
  const peak = gain * volumeMultiplier;
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(peak, now + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
  osc.start(now);
  osc.stop(now + durationMs / 1000 + 0.02);
}

export function playClickSound() {
  if (!enabled) return;
  tone(1000, 35, { type: 'sine', gain: 0.22 });
}

export function playSuccessSound() {
  if (!enabled) return;
  // Duas notas subindo (dó→sol-ish) — soa como confirmação, não alarme.
  tone(660, 90, { gain: 0.2 });
  setTimeout(() => tone(880, 140, { gain: 0.2 }), 80);
}

export function playErrorSound() {
  if (!enabled) return;
  // Uma nota baixa, tipo quadrada — soa "errado" sem ser agressivo.
  tone(220, 160, { type: 'triangle', gain: 0.2 });
}

// Delegação de clique: UM listener no document em vez de instrumentar cada
// <button> do app (são milhares, espalhados por 170+ arquivos). Ignora
// botões desabilitados (não faz sentido dar feedback de clique que não
// aconteceu) e cliques fora de um <button>/[role=button].
export function installGlobalClickSound() {
  if (typeof document === 'undefined') return () => {};
  const handler = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    const btn = target?.closest('button, [role="button"]') as HTMLButtonElement | null;
    if (!btn || btn.disabled) return;
    playClickSound();
  };
  document.addEventListener('click', handler, { capture: true });
  return () => document.removeEventListener('click', handler, { capture: true });
}
