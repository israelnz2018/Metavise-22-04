import type { AdConfig } from '@/App';
import type { Step } from '@/types/project';

// Utilitários puros de normalização/leitura de config — extraídos do
// App.tsx (eram closures dentro do componente sem depender de nenhum state
// dele). Usados tanto pelos handlers de variant quanto pelos de project.

export function mapNumericAwarenessToString(value: any): string {
  const s = String(value).toLowerCase().trim();
  if (s.startsWith('1')) return 'unaware';
  if (s.startsWith('2')) return 'problem_aware';
  if (s.startsWith('3')) return 'solution_aware';
  if (s.startsWith('4')) return 'product_aware';
  if (s.startsWith('5')) return 'most_aware';
  if (s.includes('unaware')) return 'unaware';
  if (s.includes('problem')) return 'problem_aware';
  if (s.includes('solution')) return 'solution_aware';
  if (s.includes('product')) return 'product_aware';
  if (s.includes('most')) return 'most_aware';
  return 'solution_aware';
}

export function buildWeightedPersonas(personas: any[]) {
  const mapped = personas.map((p: any, idx: number) => {
    const rank = (p.rank || '').toString().toLowerCase();
    const id = rank
      ? `persona_${rank}`
      : `persona_${idx}_${p.name?.toLowerCase().replace(/\s+/g, '_').slice(0, 12) || 'unknown'}`;
    const conf = typeof p.confidence === 'number' ? p.confidence : 0.6;
    const weight =
      typeof p.suggestedWeight === 'number'
        ? p.suggestedWeight
        : // Sensible default when LLM didn't return the field:
          // ranked weights 0.55/0.30/0.15
          idx === 0
          ? 0.55
          : idx === 1
            ? 0.3
            : 0.15;
    return {
      id,
      name: p.name || `Persona ${idx + 1}`,
      description: p.description || '',
      awareness:
        typeof p.awarenessLevel === 'string' || typeof p.awarenessLevel === 'number'
          ? mapNumericAwarenessToString(p.awarenessLevel)
          : 'solution_aware',
      painPoints: [p.mainPain, p.dominantFear, p.hiddenDesire].filter(Boolean) as string[],
      confidence: conf,
      suggestedWeight: weight,
      evidence: Array.isArray(p.evidence) ? p.evidence : [],
      isStretch: p.isStretch === true,
      // Stash the original LLM object so PlanTab/CopyTab can still
      // access fields like recommendedVideoAngle, recommendedHookType,
      // etc. when building briefs.
      raw: p,
    };
  });

  const total = mapped.reduce((acc, p) => acc + (p.suggestedWeight || 0), 0);
  return total > 0
    ? mapped.map((p) => ({ ...p, suggestedWeight: p.suggestedWeight / total }))
    : mapped;
}

export function hydrateProjectConfig(loadedConfig: AdConfig) {
  // 0. Garantir hookVisual
  if (!loadedConfig.hookVisual) {
    loadedConfig.hookVisual = {
      promptImagem: '',
      imagensGeradas: [],
      imagemEscolhida: '',
      promptVideo: '',
      videoGerado: '',
      duracaoVideo: 4,
      modeloImagem: 'imagen-4.0-generate-001',
      modeloVideo: 'veo-3.1-fast-generate-preview',
    };
  }

  // 0.1. Retrocompat: garantir format e avatar. Projetos antigos podem não
  // ter esses campos — a AvatarTab lê config.format.aspectRatio / config.avatar
  // sem guarda e quebrava a tela inteira.
  if (!loadedConfig.format) {
    (loadedConfig as any).format = { aspectRatio: '9:16', duration: 10 };
  }
  if (!loadedConfig.avatar) {
    (loadedConfig as any).avatar = {
      faceId: 'f1',
      customFaceUrl: null,
      voiceId: '',
      scale: 1.0,
    };
  }

  // 1. Retrocompatibilidade: Garantir campos básicos de edit
  if (!loadedConfig.edit) {
    loadedConfig.edit = {
      transition: 'none',
      backgroundMusic: 'none',
      timelineEdits: [],
    };
  } else if (!loadedConfig.edit.timelineEdits) {
    loadedConfig.edit.timelineEdits = [];
  }

  // 2. Retrocompatibilidade: Garantir campos de copy
  if (!loadedConfig.copy) {
    (loadedConfig as any).copy = {
      mode: 'questions',
      answers: {},
      generatedScript: '',
      generatedHooks: [],
      discoveryMode: 'unknown',
    };
  }

  // 3. Inferir discoveryMode se estiver faltando
  if (!loadedConfig.copy.discoveryMode) {
    if (loadedConfig.copy.finalScript) {
      loadedConfig.copy.discoveryMode = 'done';
    } else if (
      loadedConfig.copy.answers?.audience ||
      loadedConfig.copy.answers?.productName ||
      Object.keys(loadedConfig.copy.answers || {}).length > 0
    ) {
      loadedConfig.copy.discoveryMode = 'known';
    } else {
      loadedConfig.copy.discoveryMode = 'unknown';
    }
  }

  // 4. Garantir campos de answers (Bug 2)
  const answers = loadedConfig.copy.answers || {};
  const defaultAnswers: Record<string, any> = {
    language: answers.language || 'Português (Brasileiro)',
    awarenessLevel: answers.awarenessLevel || '',
    estiloAnuncio: answers.estiloAnuncio || '',
    clickDestination: answers.clickDestination || '',
    primaryEmotion: answers.primaryEmotion || '',
    angleIdea: answers.angleIdea || '',
    businessModel: answers.businessModel || '',
  };
  loadedConfig.copy.answers = { ...defaultAnswers, ...answers };

  return loadedConfig;
}

export function ensurePersonaWeights(cfg: any) {
  const existing = cfg?.copy?.personasWithWeights;
  if (Array.isArray(existing) && existing.length > 0) return cfg;
  const savedRaw = cfg?.copy?.answers?.savedPersonas;
  if (!savedRaw) return cfg;
  try {
    const parsed = JSON.parse(savedRaw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      cfg.copy.personasWithWeights = buildWeightedPersonas(parsed) as any;
    }
  } catch {
    /* savedPersonas malformado — ignora, segue sem plano */
  }
  return cfg;
}

export function resolveDeepestStep(cfg: any): Step {
  const edit = cfg?.edit || {};
  const hasZap = Array.isArray(edit.zapVersions) && edit.zapVersions.length > 0;
  const hasVideo = !!cfg?.videoUrl || (Array.isArray(cfg?.videos) && cfg.videos.length > 0);
  const hasAudio = !!cfg?.audioUrl || (Array.isArray(cfg?.audios) && cfg.audios.length > 0);
  const hasHooks = Array.isArray(cfg?.copy?.generatedHooks) && cfg.copy.generatedHooks.length > 0;
  const hasScript = !!cfg?.copy?.generatedScript;

  if (hasZap) return 'edit-zap';
  if (hasVideo) return 'avatar';
  if (hasAudio) return 'voz-premium';
  if (hasHooks) return 'hook-visual';
  if (hasScript) return 'copy';
  return 'persona';
}
