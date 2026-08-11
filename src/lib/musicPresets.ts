// Presets de estilo/energia/ritmo/instrumento pra geração de música
// (ElevenLabs Music). Compartilhado entre MusicSection (mixa num vídeo) e
// StandaloneMusicSection (gera música avulsa, sem vídeo).
export const STYLE_OPTIONS = [
  { id: 'cinematic', label: 'Cinematográfico', en: 'cinematic' },
  { id: 'corporate', label: 'Corporativo', en: 'corporate, clean' },
  { id: 'lofi', label: 'Lo-fi', en: 'lo-fi, chill' },
  { id: 'epic', label: 'Épico', en: 'epic, orchestral' },
  { id: 'acoustic', label: 'Acústico', en: 'acoustic, organic' },
  { id: 'electronic', label: 'Eletrônico', en: 'electronic' },
  { id: 'pop', label: 'Pop', en: 'modern pop' },
];
export const ENERGY_OPTIONS = [
  { id: 'baixa', label: 'Baixa', en: 'low energy' },
  { id: 'media', label: 'Média', en: 'medium energy' },
  { id: 'alta', label: 'Alta', en: 'high energy' },
];
export const TEMPO_OPTIONS = [
  { id: 'calmo', label: 'Calmo', en: 'slow tempo' },
  { id: 'medio', label: 'Médio', en: 'mid tempo' },
  { id: 'acelerado', label: 'Acelerado', en: 'fast tempo' },
];
export const INSTRUMENT_OPTIONS = [
  { id: 'piano', label: 'Piano', en: 'piano' },
  { id: 'violin', label: 'Violino', en: 'solo violin' },
  { id: 'strings', label: 'Cordas', en: 'strings' },
  { id: 'guitar', label: 'Violão', en: 'acoustic guitar' },
  { id: 'drums', label: 'Bateria', en: 'drums' },
  { id: 'synth', label: 'Sintetizadores', en: 'synths' },
  { id: 'perc', label: 'Percussão', en: 'percussion' },
];

export function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `${diffMin}min atrás`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h atrás`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d atrás`;
  return d.toLocaleDateString('pt-BR');
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}
