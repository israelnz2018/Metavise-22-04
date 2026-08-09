import { unlockAchievement } from './achievements';

export type VozPremiumMode = 'catalog' | 'library' | 'clone' | 'ready';

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  preview_url?: string;
  labels?: {
    gender?: string;
    age?: string;
    language?: string;
    accent?: string;
    use_case?: string;
    descriptive?: string;
  };
  category?: string;
  cloned_by_count?: number;
  // Vozes de biblioteca (adicionadas como asset) trazem `sharing` preenchido;
  // uma PVC/clone próprio da conta vem sem sharing.
  sharing?: unknown;
}

export interface CatalogFilters {
  gender?: 'male' | 'female' | '';
  age?: 'young' | 'middle_aged' | 'old' | '';
  language?: string;
  accent?: string;
  use_case?: string;
  descriptive?: string;
  search?: string;
  page?: number;
  // When true, includes voices with very few clones (typically lower
  // recording quality). Default: false.
  include_low_quality?: boolean;
}

export interface VoicesPage {
  voices: ElevenLabsVoice[];
  has_more: boolean;
  total_count: number;
  // Filters the backend had to drop because the combination yielded 0
  // voices. Populated only on the first page.
  relaxed: string[];
}

export interface GenerateAudioParams {
  voiceId: string;
  script: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  speed?: number;
}

export interface CloneVoiceParams {
  audioFile: File;
  name: string;
  removeNoise?: boolean;
}

export interface CleanAudioParams {
  audioFile: File;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Erro ${res.status}: ${text.substring(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Resposta inválida: ${text.substring(0, 200)}`);
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`Erro ${res.status}: ${text.substring(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Resposta inválida: ${text.substring(0, 200)}`);
  }
}

export async function listVoices(filters: CatalogFilters = {}): Promise<VoicesPage> {
  const params = new URLSearchParams();
  if (filters.gender) params.set('gender', filters.gender);
  if (filters.age) params.set('age', filters.age);
  if (filters.language) params.set('language', filters.language);
  if (filters.accent) params.set('accent', filters.accent);
  if (filters.use_case) params.set('use_case', filters.use_case);
  if (filters.descriptive) params.set('descriptive', filters.descriptive);
  if (filters.search) params.set('search', filters.search);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.include_low_quality) params.set('include_low_quality', '1');
  const data = await getJson<VoicesPage>(`/api/elevenlabs-premium/voices?${params.toString()}`);
  return {
    voices: data?.voices ?? [],
    has_more: !!data?.has_more,
    total_count: data?.total_count ?? 0,
    relaxed: data?.relaxed ?? [],
  };
}

export async function generateAudio(
  params: GenerateAudioParams & { userId?: string }
): Promise<{ audioUrl: string; storagePath: string | null }> {
  const result = await postJson<{ audioUrl: string; storagePath: string | null }>(
    '/api/elevenlabs-premium/generate',
    params
  );
  // Narrowest waist pra "áudio gerado" — todo call site (VozPremium, tradução
  // de criativo em CriativosTab, etc.) passa por aqui, então a conquista
  // dispara sem precisar instrumentar cada chamador.
  void unlockAchievement(params.userId, 'primeiro_audio');
  return result;
}

/** Resolve UM voice_id pro nome legível (painel de info de criativos antigos
 *  que só salvaram o id). Retorna null se a voz não está na biblioteca. */
export async function getVoiceName(voiceId: string): Promise<string | null> {
  if (!voiceId) return null;
  try {
    const data = await getJson<{ name: string | null }>(
      `/api/elevenlabs-premium/voice/${encodeURIComponent(voiceId)}`
    );
    return data?.name || null;
  } catch {
    return null;
  }
}

export async function cloneVoice(
  params: CloneVoiceParams
): Promise<{ voiceId: string; name: string }> {
  const buffer = await params.audioFile.arrayBuffer();
  const fileBase64 = btoa(new Uint8Array(buffer).reduce((d, b) => d + String.fromCharCode(b), ''));
  return postJson('/api/elevenlabs-premium/clone-voice', {
    fileBase64,
    fileName: params.audioFile.name,
    contentType: params.audioFile.type,
    name: params.name,
    removeNoise: params.removeNoise ?? true,
  });
}

export async function cleanAudio(params: CleanAudioParams): Promise<{ audioUrl: string }> {
  const buffer = await params.audioFile.arrayBuffer();
  const fileBase64 = btoa(new Uint8Array(buffer).reduce((d, b) => d + String.fromCharCode(b), ''));
  return postJson('/api/elevenlabs-premium/clean-audio', {
    fileBase64,
    fileName: params.audioFile.name,
    contentType: params.audioFile.type,
  });
}

export async function uploadReadyAudio(
  file: File
): Promise<{ audioUrl: string; storagePath: string }> {
  const buffer = await file.arrayBuffer();
  const fileBase64 = btoa(new Uint8Array(buffer).reduce((d, b) => d + String.fromCharCode(b), ''));
  return postJson('/api/elevenlabs-premium/upload-ready-audio', {
    fileBase64,
    fileName: file.name,
    contentType: file.type,
  });
}
