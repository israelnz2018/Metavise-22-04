// Custo ESTIMADO por criativo. Cada geração loga seu custo estimado via
// logCreativeCost(); o App acumula em config.costs e um painel mostra o total.
// São ESTIMATIVAS (tarifas abaixo) — o valor real sai do saldo de cada provedor.
// Centralizado aqui pra ser fácil de calibrar.

export const COST_RATES = {
  klingPerSec: 0.28, // fal Kling (vídeo IA) — × duração (conhecida)
  image: 0.04, // fal Nano Banana (imagem)
  covers: (n: number) => n * 0.04, // fal Nano Banana (N capas)
  // Estimativas grosseiras (tarifa média) pros que não medimos exato:
  lipsync: 0.3, // fal Sync Lipsync (~6s)
  voice: 0.05, // ElevenLabs por narração gerada
  music: 0.1, // ElevenLabs por trilha
  heygenVideo: 0.3, // HeyGen por vídeo de avatar
  zapcapEdit: 0.2, // ZapCap por edição
};

export interface CostEntry {
  label: string;
  amount: number;
  at: number;
}

// Dispara um lançamento de custo. O App escuta 'metavise-cost' e soma no projeto.
export function logCreativeCost(label: string, amount: number) {
  if (!amount || amount <= 0) return;
  try {
    window.dispatchEvent(
      new CustomEvent('metavise-cost', { detail: { label, amount, at: Date.now() } })
    );
  } catch {
    /* sem window — ignora */
  }
}

export function totalCost(entries?: CostEntry[] | null): number {
  if (!Array.isArray(entries)) return 0;
  return entries.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
}
