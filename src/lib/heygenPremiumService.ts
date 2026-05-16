export type AvatarEngine = 'avatar3' | 'avatar4' | 'avatar5';
export type AspectRatio = '9:16' | '1:1' | '16:9' | '4:5';
export type Resolution = '1080p' | '4k';

export interface HeyGenAvatarV3 {
  avatar_id: string;
  avatar_name: string;
  preview_image_url?: string;
  gender?: string;
}

export interface VideoStatus {
  videoId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  videoUrl?: string;
  errorMessage?: string;
}

export interface BackgroundConfig {
  type: 'color' | 'image' | 'video';
  value?: string;
  assetId?: string;
  playStyle?: 'fit_to_scene' | 'freeze' | 'loop' | 'full_video';
}

export interface GenerateParams {
  engine: AvatarEngine;
  aspectRatio: AspectRatio;
  resolution?: Resolution;
  voiceId?: string;
  audioUrl?: string;
  script?: string;
  background?: BackgroundConfig;
  title?: string;
  avatarId?: string;
  imageAssetId?: string;
  referenceVideoAssetId?: string;
}

const PRICING: Record<AvatarEngine, Record<Resolution, number>> = {
  avatar3: { '1080p': 4, '4k': 5 },
  avatar4: { '1080p': 4, '4k': 5 },
  avatar5: { '1080p': 5, '4k': 6 },
};

export const ENGINE_LABELS: Record<AvatarEngine, { label: string; tagline: string; input: string }> = {
  avatar3: { label: 'Avatar IV — Catálogo', tagline: 'Avatares prontos com motor IV', input: 'Escolha um avatar do catálogo' },
  avatar4: { label: 'Avatar IV — Foto',     tagline: 'Foto do cliente vira vídeo',    input: 'Envie uma foto do cliente'     },
  avatar5: { label: 'Avatar V — Vídeo',     tagline: 'Aprende cadência e gestos',     input: 'Envie um vídeo de 15 segundos' },
};

export function estimatePrice(engine: AvatarEngine, durationSeconds: number, resolution: Resolution = '1080p') {
  const minutes = Math.max(durationSeconds / 60, 0.25);
  const costPerMinute = PRICING[engine][resolution];
  return {
    engine,
    costPerMinuteUsd: costPerMinute,
    estimatedMinutes: Number(minutes.toFixed(2)),
    estimatedCostUsd: Number((minutes * costPerMinute).toFixed(2)),
  };
}

export function estimateScriptSeconds(script: string): number {
  if (!script) return 30;
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  return Math.max((words / 150) * 60, 5);
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await res.text() || `Erro ${res.status}`);
  return res.json();
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(await res.text() || `Erro ${res.status}`);
  return res.json();
}

export async function listAvatarsV3(): Promise<HeyGenAvatarV3[]> {
  const data = await getJson<{ data: { avatars: HeyGenAvatarV3[] } }>('/api/heygen-premium/avatars');
  return data?.data?.avatars ?? [];
}

export async function uploadAsset(file: File, kind: 'image' | 'video'): Promise<{ assetId: string; url: string }> {
  const buffer = await file.arrayBuffer();
  const fileBase64 = btoa(new Uint8Array(buffer).reduce((d, b) => d + String.fromCharCode(b), ''));
  const res = await fetch('/api/heygen-premium/upload-asset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileBase64, fileName: file.name, contentType: file.type, kind }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Upload falhou (${res.status}): ${text.substring(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Resposta inválida do servidor: ${text.substring(0, 200)}`);
  }
}

export async function generateVideo(params: GenerateParams): Promise<{ videoId: string; engine: AvatarEngine; estimatedCostUsd: number }> {
  return postJson('/api/heygen-premium/generate', params);
}

export async function getVideoStatus(videoId: string): Promise<VideoStatus> {
  return getJson(`/api/heygen-premium/status/${videoId}`);
}

export function subscribeStatus(videoId: string, onUpdate: (s: VideoStatus) => void, onError?: (e: Error) => void): () => void {
  const source = new EventSource(`/api/heygen-premium/status-stream/${videoId}`);
  source.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data) as VideoStatus;
      onUpdate(data);
      if (data.status === 'completed' || data.status === 'failed') source.close();
    } catch (e) { onError?.(e as Error); }
  };
  source.onerror = () => { source.close(); onError?.(new Error('Stream interrompido.')); };
  return () => source.close();
}
