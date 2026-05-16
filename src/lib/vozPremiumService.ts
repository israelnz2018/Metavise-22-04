export type VozPremiumMode = 'catalog' | 'clone' | 'ready';

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
  };
  category?: string;
}

export interface CatalogFilters {
  gender?: 'male' | 'female' | '';
  age?: 'young' | 'middle_aged' | 'old' | '';
  language?: string;
  use_case?: string;
  search?: string;
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
  try { return JSON.parse(text); } catch { throw new Error(`Resposta inválida: ${text.substring(0, 200)}`); }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`Erro ${res.status}: ${text.substring(0, 200)}`);
  try { return JSON.parse(text); } catch { throw new Error(`Resposta inválida: ${text.substring(0, 200)}`); }
}

export async function listVoices(filters: CatalogFilters = {}): Promise<ElevenLabsVoice[]> {
  const params = new URLSearchParams();
  if (filters.gender)   params.set('gender', filters.gender);
  if (filters.age)      params.set('age', filters.age);
  if (filters.language) params.set('language', filters.language);
  if (filters.use_case) params.set('use_case', filters.use_case);
  if (filters.search)   params.set('search', filters.search);
  const data = await getJson<{ voices: ElevenLabsVoice[] }>(
    `/api/elevenlabs-premium/voices?${params.toString()}`
  );
  return data?.voices ?? [];
}

export async function generateAudio(params: GenerateAudioParams & { userId?: string }): Promise<{ audioUrl: string; storagePath: string | null }> {
  return postJson('/api/elevenlabs-premium/generate', params);
}

export async function cloneVoice(params: CloneVoiceParams): Promise<{ voiceId: string; name: string }> {
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

export async function uploadReadyAudio(file: File): Promise<{ audioUrl: string; storagePath: string }> {
  const buffer = await file.arrayBuffer();
  const fileBase64 = btoa(new Uint8Array(buffer).reduce((d, b) => d + String.fromCharCode(b), ''));
  return postJson('/api/elevenlabs-premium/upload-ready-audio', {
    fileBase64,
    fileName: file.name,
    contentType: file.type,
  });
}
