// Shared types for App.tsx + src/pages + src/components.
//
// The strict AdConfig definition still lives in App.tsx because it
// references a lot of UI-only state shape. Page/component code uses
// `config: any` so it doesn't need to know AdConfig's full surface —
// structurally compatible via TypeScript's duck typing.

export type Step =
  | 'integrations'
  | 'projects'
  | 'persona'
  | 'copy'
  | 'hook-visual'
  | 'voz-premium'
  | 'avatar'
  | 'subtitles'
  | 'edit'
  | 'edit-zap'
  | 'edit2'
  | 'final'
  | 'scene-builder';

export type ProjectType = 'complete' | 'copy' | 'video' | 'editing';

export interface ProjectVariant {
  id: string;
  name: string;
  config: any;
  createdAt: any;
}

export interface Project {
  id: string;
  userId: string;
  name: string;
  type: ProjectType;
  config: any;
  variants?: ProjectVariant[];
  createdAt: any;
}

// ─── Scene builder + editing timeline ───────────────────────────────

export interface Scene {
  id: string;
  type: 'avatar' | 'text' | 'image' | 'runway';
  duration: number;
  settings: {
    // Avatar
    trimStart?: number;
    trimEnd?: number;

    // Text
    text?: string;
    fontSize?: number;
    fontWeight?: string;
    textPosition?: 'top' | 'center' | 'bottom';
    backgroundColor?: string;
    musicEnabled?: boolean;
    musicVolume?: number;

    // Image
    imageUrl?: string;
    zoomEffect?: 'in' | 'out' | 'none';
    panEffect?: 'left' | 'right' | 'none';
    overlayText?: string;

    // Runway
    videoUrl?: string;
    prompt?: string;
    refImage?: string;

    // Global
    transition?: 'fade' | 'cut' | 'slide';
  };
}

export interface TimelineEdit {
  id: string;
  timestamp: number;
  type: 'transition' | 'image' | 'text' | 'sound';
  value: string;
  aiPrompt?: string;
  phrase?: string;
  videoUrl?: string;
  processedVideoUrl?: string;
  aspectRatio?: '16:9' | '9:16' | '1:1';
  previewMetadata?: {
    zoom?: number;
    textOverlay?: string;
    textPosition?: 'top' | 'center' | 'bottom';
    effect?: string;
  };
  videoOp?: any;
  isGenerating?: boolean;
  isApproved?: boolean;
  isProcessing?: boolean;
  duration?: number;
}

export interface VideoSegment {
  id: string;
  number: number;
  type: 'REPLACE' | 'KEEP';
  startTime: number;
  endTime: number;
  transcript: string;
  reason?: string;
  isApproved: boolean;
  isProcessing?: boolean;
  isImageProcessing?: boolean;
  visualConcept: {
    sceneDescription: string;
    imagePrompt: string;
    videoPrompt: string;
    imageUrl?: string;
    videoUrl?: string;
    useGeneratedVideo: boolean;
  };
}

export interface HookVisualData {
  promptImagem: string;
  imagensGeradas: string[];
  imagemEscolhida: string;
  promptVideo: string;
  videoGerado: string;
  duracaoVideo: number;
  modeloImagem: string;
  modeloVideo: string;
}

// ─── AssemblyAI / ZapCap ────────────────────────────────────────────

export interface AssemblyAnalysis {
  transcriptId: string;
  text: string;
  words: { text: string; start: number; end: number; confidence: number }[];
  duration: number;
  sentimentResults: {
    text: string;
    sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
    confidence: number;
    start: number;
    end: number;
  }[];
  highlights: {
    text: string;
    rank: number;
    timestamps: { start: number; end: number }[];
  }[];
  sentences?: {
    text: string;
    start: number;
    end: number;
    confidence: number;
  }[];
  zoomMoments: { start: number; end: number; reason: string }[];
  brollMoments: { start: number; end: number; topic: string }[];
  silences: { start: number; end: number }[];
  language: string;
}

export interface ZapCapTemplate {
  id: string;
  name: string;
  previewUrl?: string;
  thumbnailUrl?: string;
  thumbnail?: string;
  image?: string;
  imageUrl?: string;
  // ZapCap v2 also returns a `previews` object with multiple format URLs.
  previews?: {
    previewMp4?: string;
    previewWebp?: string;
    previewJpg?: string;
  };
}

export interface BrollCandidate {
  id: string;
  text: string;
  rank: number;
  start: number; // ms
  end: number; // ms
  duration: number; // s
}

export interface AutoEditState {
  status:
    | 'idle'
    | 'uploading'
    | 'analyzing'
    | 'analyzed'
    | 'rendering'
    | 'editing'
    | 'polling'
    | 'completed'
    | 'error';
  step: string;
  progress: number;
  error?: string;
  analysis?: AssemblyAnalysis;
  videoId?: string;
  taskId?: string;
  finalVideoUrl?: string;
  brollCandidates: BrollCandidate[];
  selectedBrollIds: string[];
  editMode?: 'auto' | 'manual';
  versions?: string[];
  originalVideoUrl?: string;
  videoFormat?: '9:16' | '1:1' | '16:9';
  compressing?: boolean;
}

export interface ZapCapRenderConfig {
  templateId: string;
  emoji: boolean;
  emphasizeKeywords: boolean;
  animation: boolean;
  fontUppercase: boolean;
  fontSize: number;
  fontColor: string;
  highlightColor1: string;
  highlightColor2: string;
  highlightColor3: string;
  top: number; // 0-100
  brollPercent: number; // 0-50
}
