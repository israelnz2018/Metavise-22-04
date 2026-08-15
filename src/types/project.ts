// Shared types for App.tsx + src/pages + src/components.
//
// The strict AdConfig definition still lives in App.tsx because it
// references a lot of UI-only state shape. Page/component code uses
// `config: any` so it doesn't need to know AdConfig's full surface —
// structurally compatible via TypeScript's duck typing.

export type Step =
  | 'integrations'
  | 'projects'
  | 'source'
  | 'persona'
  | 'plan'
  | 'copy'
  | 'copy-vsl'
  | 'hook-visual'
  | 'voz-premium'
  | 'remotion'
  | 'avatar'
  | 'video-ia'
  | 'imagem-ia'
  | 'subtitles'
  | 'edit'
  | 'edit-zap'
  | 'edit2'
  | 'merge'
  | 'montagem'
  | 'final'
  | 'scene-builder'
  | 'criativos'
  | 'performance'
  | 'hub'
  | 'recortar';

export type ProjectType = 'complete' | 'copy' | 'video' | 'editing';

// ─── Modelo-alvo (Fase 0 — fundação; ainda não totalmente ligado) ───────────
// Ver docs/plano-implementacao.md + docs/remotion-jornada-unificada.md.
// Entrada do projeto: "plano" (Andromeda, nasce com os 15 briefs) vs "avulso"
// (começa vazio; pode ter vários criativos também). Opcional p/ compat.
export type ProjectMode = 'plano' | 'avulso';

// Um criativo tem 3 partes; cada parte é preenchida por uma fonte.
export type CreativePartKind = 'hook' | 'corpo' | 'cta';
export type AssetKind = 'texto' | 'audio' | 'video' | 'imagem';
export type AssetSource = 'escrito' | 'gerado' | 'upload' | 'puxado' | 'remotion';

// Asset único por parte — substitui (no modelo-alvo) os arrays espalhados
// audios[]/videos[]/zapVersions. Regra: 1 de cada por subprojeto.
export interface CreativeAsset {
  id: string;
  part: CreativePartKind;
  kind: AssetKind;
  source: AssetSource;
  url?: string;
  storagePath?: string | null;
  text?: string;
  createdAt: any;
}

// Generic over the config shape so App.tsx can use
// `Project<AdConfig>` for full type-safety while page/component code
// that only needs the loose shape can keep using `Project` (defaults
// to `any` to preserve the previous duck-typed contract).
export interface ProjectVariant<TConfig = any> {
  id: string;
  name: string;
  config: TConfig;
  createdAt: any;
}

export interface Project<TConfig = any> {
  id: string;
  userId: string;
  name: string;
  type: ProjectType;
  /** "plano" (Andromeda) ou "avulso". Opcional p/ compat: projetos antigos
   *  seguem como hoje (tratados como avulso quando ausente). */
  mode?: ProjectMode;
  config: TConfig;
  variants?: ProjectVariant<TConfig>[];
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
  aspectRatio?: '16:9' | '9:16' | '1:1' | '4:5';
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

/** Uma trilha de música (gerada por IA ou enviada). Mora em dois lugares:
 *  - `config.edit.musicTracks` → músicas DESTE subprojeto (independentes).
 *  - `users/{uid}/musicLibrary` → biblioteca global, só as que o user salvou.
 *  Em ambos guardamos só a URL (não o áudio); deletar remove a referência,
 *  nunca o arquivo físico (a mesma URL pode estar em uso em outro lugar). */
export interface MusicTrack {
  id: string;
  url: string;
  label: string;
  source: 'ai' | 'upload';
  prompt?: string;
  originalFileName?: string;
  lengthMs?: number;
  sizeBytes?: number;
  createdAt: string; // ISO
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
  videoFormat?: '9:16' | '1:1' | '16:9' | '4:5';
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

// ─── AdCreative Blueprint — Persona + Brief types ──────────────────
//
// New shape introduced for the multi-creative blueprint feature.
// Replaces the implicit "1 persona = 1 copy" pattern with a weighted
// model where the source material (VSL/product) yields 1-3 personas
// with confidence scores, and the plan generates N briefs distributed
// proportionally to those weights.
//
// Backwards compatibility:
// - The existing `config.copy.answers.discoveredPersona` and
//   `config.copy.answers.savedPersonas` are still respected.
// - These new types live alongside them; the Plan tab v2 reads the
//   new shape, the existing PersonaTab flow keeps populating the old
//   shape until migrated.

export type AwarenessLevel =
  | 'unaware'
  | 'problem_aware'
  | 'solution_aware'
  | 'product_aware'
  | 'most_aware';

export type CreativeAngle =
  | 'curiosidade'
  | 'urgencia'
  | 'prova_social'
  | 'transformacao'
  | 'mecanismo_revelado'
  | 'autoridade'
  | 'contra_intuitivo'
  | 'medo_perda'
  | 'desejo_aspiracional';

export type CreativeStyle =
  | 'depoimento'
  | 'mecanismo_revelado'
  | 'antes_e_depois'
  | 'demo'
  | 'historia_pessoal'
  | 'comparacao'
  | 'lista_beneficios'
  | 'autoridade_explica';

export type CtaStyle = 'soft' | 'hard' | 'curiosity_gap';

export type PrimaryEmotion =
  | 'curiosidade'
  | 'medo'
  | 'desejo'
  | 'validacao'
  | 'raiva'
  | 'esperanca'
  | 'urgencia'
  | 'pertencimento';

/** Estratégia de plano escolhida pelo cliente ANTES de gerar as personas.
 *  Persistida em config.copy.answers.strategyMethod e enviada ao backend
 *  (dentro de copyAnswers) pra calibrar plano + checklist:
 *   - 'baiano'   → 3-7 criativos ótimos, rodados 1 por vez (2 dias cada),
 *                  clonados em ~50 conjuntos de orçamento baixo, alvo amplo.
 *   - 'metodo15' → plano estruturado de ~15 criativos (comportamento padrão).
 *   - 'ia'       → a IA decide o método com base no produto/orçamento.
 *   - 'custom'   → o cliente descreve o plano em texto livre
 *                  (config.copy.answers.strategyCustom). */
export type StrategyMethod = 'baiano' | 'metodo15' | 'ia' | 'custom';

/** Result of the persona-discovery step. Multiple personas with weights,
 *  rather than one "winner". User can select which ones to include in
 *  the creative plan via checkboxes. */
export interface WeightedPersona {
  /** Stable ID — used as foreign key in CreativeBrief.targetPersonaId. */
  id: string;
  /** Short descriptor like "Sofredor Crônico 60-75" or "Cuidador". */
  name: string;
  /** 1-2 sentence summary of who this persona is. */
  description: string;
  /** Primary awareness level this persona sits in. */
  awareness: AwarenessLevel;
  /** Pain points / desires that drive this persona. Free-form bullets. */
  painPoints: string[];
  /** 0-1, how strongly the source material sustains this persona.
   *  ≥ 0.7 = extracted directly. 0.4-0.7 = solid inference.
   *  < 0.4 = stretch, low confidence. */
  confidence: number;
  /** 0-1, suggested fraction of creatives that should target this
   *  persona. Sum of all suggestedWeight = 1. The user can override
   *  via the PersonaTab checkboxes. */
  suggestedWeight: number;
  /** Quotes or short paraphrases from the source material that justify
   *  this persona. Surfaces in UI as "why we suggested this". */
  evidence: string[];
  /** True when this persona is an inferred extension rather than
   *  directly addressed by the source. UI shows a warning chip. */
  isStretch: boolean;
}

/** One creative brief — the template that, when "executed", spawns a
 *  ProjectVariant (subprojeto). The brief is editable in the Plan tab
 *  until the variant is created; after creation, the variant gets a
 *  snapshot copy and the brief and variant evolve independently. */
export interface CreativeBrief {
  /** Stable ID — also used as the variant ID when this brief is
   *  executed (so we can map brief ↔ variant deterministically). */
  id: string;
  /** 1-based position in the plan. Used for display ("Criativo 7"). */
  index: number;
  /** FK into WeightedPersona.id — which persona this brief targets. */
  targetPersonaId: string;
  /** Snapshot of the persona name at brief-creation time (so the brief
   *  stays human-readable even if the persona is renamed/deleted). */
  targetPersonaName: string;
  awareness: AwarenessLevel;
  angle: CreativeAngle | string; // string fallback when Claude proposes something off-list
  /** The actual first sentence the ad opens with — written, not just a concept. */
  hook: string;
  /** Target duration in seconds. */
  durationTarget: 15 | 30 | 45 | 60 | 90 | 120 | 180 | 240 | 300;
  emotion: PrimaryEmotion | string;
  style: CreativeStyle | string;
  ctaStyle: CtaStyle;
  /** Which benefit/promise this creative emphasises (drawn from
   *  ProductInfo.benefits or ProductInfo.promise). */
  promiseFocus: string;
  /** 1-line "why this combination makes sense" for the user to read
   *  before deciding to execute the brief. */
  rationale: string;
  /** Quem CONTA a história em 1ª pessoa (decidido no planejamento, auto-
   *  preenchido na aba Copy). Perfil curto e concreto do narrador — quem é,
   *  idade, relação com o problema — pra a copy segurar UMA voz e não oscilar
   *  entre "eu tenho" e "cuidei de alguém". Ex.: "Sofredor de 58 anos que
   *  conviveu 6 anos com a dor antes de achar a resposta". */
  narrator?: string;
  // --- lifecycle bookkeeping ---
  /** When set, points to the variant that was spawned from this brief. */
  executedVariantId?: string;
  /** When this brief was derived from another (e.g. "big variation" of
   *  Criativo 5 became Criativo 16), keep the parent's brief id for
   *  traceability. */
  derivedFromBriefId?: string;
  // --- UX28 monthly plan tags ---
  /** Week bucket (1-4). Quando ausente, brief é "legacy" sem semana. */
  weekIndex?: 1 | 2 | 3 | 4;
  /** Quando esse brief é variação/modelagem de uma copy da biblioteca
   *  pessoal, o ID da copy referenciada. CopyTab vai pré-marcar essa
   *  copy como referência + similaridade alta automaticamente. */
  modeledFromRefCopyId?: string;
  /** Tamanho-alvo do script (curto/médio/longo) — usado pra distribuir
   *  conforme lengthDistribution calibrada. Mapeia pra targetWordCount
   *  quando o brief é executado. */
  scriptLength?: 'short' | 'medium' | 'long';
  /** Marcado como winner pelo user — usado pra puxar variações na
   *  semana seguinte automaticamente. */
  isWinner?: boolean;
  /** Marcado como dead/killed — não conta em "ativos". */
  isKilled?: boolean;
}

/** UX28/29 — Monthly Plan persisted on config.copy. */
export interface MonthlyPlanConfig {
  /** Inputs do user (UX29: trocou commission/AOV por price/CPA) */
  productPrice: number;
  idealCPA: number;
  dailyBudgetUsd: number;
  profile: 'newcomer' | 'scaling' | 'serious' | 'agency';
  /** UX29: estratégia de volume — define $/criativo de feeding rate */
  volumeStrategy: 'conservative' | 'modern' | 'aggressive';
  /** IDs de copies pra modelar (subset da biblioteca pessoal) */
  modelReferenceCopyIds: string[];
  /** Output calibrado — armazenado pra mostrar no UI sem recalcular */
  calibrated?: {
    budgetHints: { minimum: number; recommended: number; ideal: number; rationale: string };
    lengthDistribution: { short: number; medium: number; long: number };
    weeklyTargets: { week1: number; week2: number; week3: number; week4: number };
    monthlyTotal: number;
    modelingIntensity: number;
    scalingRules: string[];
    budgetVerdict: string;
    breakthroughEstimate: string;
    volumeRationale?: string;
  };
  generatedAt?: number;
}

/** Bundle returned by /api/claude/marketing-plan — the macro strategy
 *  and the N briefs together. Stored on config.copy as
 *  `marketingPlan` (existing) + `creativeBriefs` (new). */
export interface MarketingBlueprint {
  /** The existing MarketingPlan shape (kept loose here — the real
   *  definition lives in src/lib/claudeService.ts to avoid a circular
   *  dep with App.tsx). */
  plan: unknown;
  briefs: CreativeBrief[];
}
