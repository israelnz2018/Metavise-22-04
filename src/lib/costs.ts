/**
 * Central registry of credit costs per chargeable action.
 *
 * The server is the source of truth (see server/routes/*.ts —
 * currently only heygen.routes.ts deducts) but mirroring the values
 * here lets the client show "Vai usar X créditos" preview modals
 * without an extra round-trip. Keep these in sync with the server.
 */

export type Action = 'heygen_video' | 'runway_video' | 'zapcap_edit' | 'elevenlabs_tts';

export const COSTS: Record<Action, number> = {
  // HeyGen avatar render — server: heygen.routes.ts videoCost = 100
  heygen_video: 100,
  // Runway video — not credit-gated server-side yet, kept for future use
  runway_video: 50,
  // ZapCap caption edit — not credit-gated server-side yet
  zapcap_edit: 20,
  // ElevenLabs TTS — not credit-gated server-side yet
  elevenlabs_tts: 10,
};

export const ACTION_LABELS: Record<Action, string> = {
  heygen_video: 'gerar vídeo com avatar',
  runway_video: 'gerar vídeo com Runway',
  zapcap_edit: 'editar legendas',
  elevenlabs_tts: 'gerar narração',
};

export function getCost(action: Action): number {
  return COSTS[action];
}

export function getActionLabel(action: Action): string {
  return ACTION_LABELS[action];
}
