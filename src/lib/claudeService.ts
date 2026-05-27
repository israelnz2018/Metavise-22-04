/**
 * METAVISE — CLAUDE SERVICE
 *
 * Chama nosso backend Express em /api/claude/complete, que por sua vez
 * proxia a Claude API da Anthropic. A chave é configurada via a aba
 * Integrações → Anthropic Claude.
 *
 * Funções:
 * 1. generateAdCopyWithClaude        → Gerar copy com beats Schwartz
 * 2. chooseHooksFromCopy             → Selecionar hooks a partir da copy gerada
 * 3. optimizeCopyForElevenLabsWithClaude → Otimizar para voz
 * 4. discoverPersonaWithClaude       → Descobrir avatar/persona
 */

// UX14: few-shot examples + vertical inference pra melhorar qualidade
// da copy gerada (em vez de só dar regras, mostramos exemplos).
import {
  selectCopyExamples,
  inferVertical,
  type CopyExample,
  type AwarenessLevel,
  type CopyVertical,
} from '@/data/copyLibrary';

const CLAUDE_URL = '/api/claude/complete';
const CLAUDE_STREAM_URL = '/api/claude/complete-stream';

/** Detecta se a língua-alvo é PT (BR ou PT) ou EN. */
function isPortuguese(language?: string): boolean {
  if (!language) return true; // default PT no app
  return /port|brasil|brazil/i.test(language);
}

/**
 * Stream Claude completions token-by-token via SSE.
 *
 * Server proxies Anthropic's native event stream as-is (see
 * server/routes/claude.routes.ts `/complete-stream`). We parse
 * `content_block_delta` events client-side and forward text chunks
 * to `onToken`. Resolves with the accumulated full text once the
 * stream finishes.
 *
 * If the stream fails mid-flight the function rejects with whatever
 * partial text was already emitted attached to the error — useful for
 * UI that wants to keep the partial output even on a network blip.
 */
export async function streamClaude(
  systemPrompt: string,
  userPrompt: string,
  onToken: (delta: string) => void,
  opts: { maxTokens?: number } = {}
): Promise<string> {
  const response = await fetch(CLAUDE_STREAM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system: systemPrompt,
      user: userPrompt,
      max_tokens: opts.maxTokens ?? 2000,
    }),
  });

  if (!response.ok || !response.body) {
    const text = response.body ? await response.text() : '';
    throw new Error(`Claude stream error: ${response.status} ${text.substring(0, 300)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line. Split greedily and
      // keep any trailing partial event in the buffer.
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';

      for (const raw of parts) {
        // Each event block has `event: <name>\ndata: <json>` lines.
        // We only care about content deltas — skip the rest.
        const lines = raw.split('\n');
        const dataLine = lines.find((l) => l.startsWith('data: '));
        if (!dataLine) continue;
        const json = dataLine.slice('data: '.length).trim();
        if (!json || json === '[DONE]') continue;
        try {
          const evt = JSON.parse(json);
          if (
            evt.type === 'content_block_delta' &&
            evt.delta?.type === 'text_delta' &&
            typeof evt.delta.text === 'string'
          ) {
            const chunk = evt.delta.text as string;
            full += chunk;
            onToken(chunk);
          }
        } catch {
          // Anthropic sometimes emits non-JSON keepalive comments —
          // safe to ignore.
        }
      }
    }
  } catch (err: any) {
    const e: any = new Error(err?.message || 'Claude stream interrupted');
    e.partial = full;
    throw e;
  }

  return full;
}

// Helper genérico que chama Claude via nosso proxy local.
async function callClaude(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 2000
): Promise<string> {
  const response = await fetch(CLAUDE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system: systemPrompt,
      user: userPrompt,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude proxy error: ${err}`);
  }

  const data = await response.json();
  if (!data.success) throw new Error(data.error || 'Erro Claude.');
  return data.text;
}

// ─────────────────────────────────────────────
// UX23-D — STYLE FINGERPRINT
// ─────────────────────────────────────────────
/**
 * Extrai um "fingerprint" de estilo de 1+ copies de referência. Em vez
 * de simplesmente JOGAR as copies como few-shot e torcer pro modelo
 * imitar, a gente pede pro Claude PRIMEIRO analisar a voz delas e
 * gerar diretivas IMPERATIVAS (ex: "frases de 6-12 palavras", "use
 * 'do nada', 'saca só'") — esses comandos imperativos influenciam
 * mais do que exemplos passivos.
 *
 * Usado quando similarity >= 51 ("strong" ou "clone"). Abaixo disso
 * o sistema usa apenas few-shot leve (mais barato + mais variação).
 *
 * Falha silenciosa → retorna null e o caller cai pro modo few-shot.
 */
export async function extractStyleFingerprint(examples: CopyExample[]): Promise<string | null> {
  if (!examples || examples.length === 0) return null;

  // Limita pra evitar prompt enorme. 3 copies já dão sinal forte.
  const sample = examples.slice(0, 3);
  const corpus = sample
    .map((e, i) => `--- COPY ${i + 1} ---\n${e.script.slice(0, 1800)}`)
    .join('\n\n');

  const systemPrompt = `You are a forensic copywriter. Given 1-3 reference copies, you reverse-engineer the writer's stylistic fingerprint into IMPERATIVE directives that another AI can follow. Output ONLY JSON, no markdown.`;

  const userPrompt = `Analyze the writing style of the reference copies below. Output a JSON object describing the voice as IMPERATIVE rules the next writer must follow.

REFERENCE COPIES:
${corpus}

Extract these properties (be SPECIFIC — vague answers are useless):

1. avgSentenceLength: rough word count ("6-10", "12-18", etc)
2. pacing: "fast" | "medium" | "slow" + 1 sentence why
3. opening_pattern: how do they typically OPEN? (sensory image / question / counterintuitive claim / direct statement / etc)
4. vocabulary_register: "formal" | "casual" | "street" | "mixed" + key vocabulary anchors (3-6 specific words/phrases they use)
5. signature_phrases: 3-6 ACTUAL phrases pulled verbatim from the copies that define the voice (e.g. "do nada", "saca só", "olha aí")
6. avoid_list: 3-5 things this writer would NEVER say or do (e.g. "no usar 'incrível'", "no usar palavras de 4+ sílabas em sequência")
7. emotional_temperature: cold/neutral/warm/hot + the EMOTION the writer trades in primarily
8. closing_style: how they wrap up / CTA approach
9. cadence_tricks: 2-4 SPECIFIC rhythm devices (ex: "frase curta, frase curta, frase longa", "repete palavra-chave em 3 lugares", "abertura com pergunta + resposta no mesmo parágrafo")

OUTPUT (JSON only):
{
  "avgSentenceLength": "...",
  "pacing": "...",
  "opening_pattern": "...",
  "vocabulary_register": "...",
  "signature_phrases": ["...", "..."],
  "avoid_list": ["...", "..."],
  "emotional_temperature": "...",
  "closing_style": "...",
  "cadence_tricks": ["...", "..."]
}`;

  try {
    const raw = await callClaude(systemPrompt, userPrompt, 800);
    const cleaned = raw
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    const parsed = JSON.parse(cleaned);

    // Reconstrói como diretivas imperativas. Esse é o texto que vai
    // pro prompt principal — não JSON, texto-comando.
    const sig = Array.isArray(parsed.signature_phrases)
      ? parsed.signature_phrases.slice(0, 6).join(', ')
      : '';
    const avoid = Array.isArray(parsed.avoid_list) ? parsed.avoid_list.slice(0, 5).join('; ') : '';
    const cadence = Array.isArray(parsed.cadence_tricks)
      ? parsed.cadence_tricks
          .slice(0, 4)
          .map((t: string) => `   - ${t}`)
          .join('\n')
      : '';

    return `STYLE FINGERPRINT — MATCH THESE RULES EXACTLY:
- Avg sentence length: ${parsed.avgSentenceLength || 'medium'} words
- Pacing: ${parsed.pacing || 'medium'}
- Open with: ${parsed.opening_pattern || 'direct statement'}
- Vocabulary register: ${parsed.vocabulary_register || 'casual'}
- Signature phrases TO USE (sprinkle 1-2 naturally): ${sig || '(none)'}
- NEVER do: ${avoid || '(no restrictions)'}
- Emotional temperature: ${parsed.emotional_temperature || 'warm'}
- Closing style: ${parsed.closing_style || 'direct CTA'}
- Cadence tricks:
${cadence || '   - (no specific tricks)'}`;
  } catch (err: any) {
    console.warn('[extractStyleFingerprint] falhou:', err?.message);
    return null;
  }
}

// ─────────────────────────────────────────────
// 1. GERAR COPY com beats Schwartz
// ─────────────────────────────────────────────
export const generateAdCopyWithClaude = async (
  answers: Record<string, any>,
  mode: 'improve' | 'as-is' | 'questions',
  angle: string,
  _scriptLength?: 'short' | 'medium' | 'long',
  targetWordCount?: number,
  _hookSelecionado?: string,
  /** Optional streaming callback. When provided, the function uses the
   *  SSE endpoint and pushes each text delta to onToken as it arrives.
   *  When omitted, falls back to the blocking /complete endpoint. */
  onToken?: (textDelta: string) => void
): Promise<{ hooks: any[]; script: string }> => {
  if (mode === 'as-is') {
    return {
      hooks: [],
      script: answers.existingCopy || '',
    };
  }

  const currentLevel = (answers.awarenessLevel || '3').toString().charAt(0) || '3';
  const wordCount = targetWordCount || 150;

  // Exact word budget per beat (replaces vague percentages)
  const beatBudgets: Record<string, Array<[string, number]>> = {
    '1': [
      ['REVELAÇÃO', 0.25],
      ['EVIDÊNCIA', 0.3],
      ['CONEXÃO COM PRODUTO', 0.35],
      ['CTA SUAVE', 0.1],
    ],
    '2': [
      ['AGITAÇÃO DA DOR', 0.3],
      ['DIAGNÓSTICO ÚNICO', 0.2],
      ['SOLUÇÃO + MECANISMO', 0.3],
      ['PROVA', 0.1],
      ['CTA', 0.1],
    ],
    '3': [
      ['QUEBRA DE PARADIGMA', 0.25],
      ['MECANISMO ÚNICO', 0.35],
      ['PROVA', 0.25],
      ['CTA DIRETO', 0.15],
    ],
    '4': [
      ['DIFERENCIAÇÃO', 0.35],
      ['PROVA SOCIAL', 0.3],
      ['GARANTIA', 0.2],
      ['CTA + BENEFÍCIO', 0.15],
    ],
    '5': [
      ['OFERTA INICIAL', 0.35],
      ['URGÊNCIA REAL', 0.3],
      ['CTA DIRETO', 0.35],
    ],
  };

  const beatInstructions: Record<string, string> = {
    REVELAÇÃO: "Present a reality the avatar hasn't noticed. Start directly — no intro hook.",
    EVIDÊNCIA: 'Fact, observation, or logical principle that proves the revelation.',
    'CONEXÃO COM PRODUTO': `Introduce the product and how its mechanism solves the problem. Mechanism: ${answers.uniqueMechanism || ''}`,
    'CTA SUAVE': 'Soft call-to-action, low pressure.',
    'AGITAÇÃO DA DOR':
      '2-3 visceral details of the pain. Use sensory language — what it feels like in daily life.',
    'DIAGNÓSTICO ÚNICO':
      "Reframe: 'It's not X, it's Y.' Name the real root cause the avatar hasn't identified.",
    'SOLUÇÃO + MECANISMO': `Present the product and its mechanism: ${answers.uniqueMechanism || ''}`,
    PROVA: 'Logical proof of the mechanism. No invented statistics or testimonials.',
    CTA: 'Direct CTA with one clear benefit.',
    'QUEBRA DE PARADIGMA':
      'Contradict a widely held belief. Make it feel counterintuitive but undeniably true.',
    'MECANISMO ÚNICO': `Explain how this differs from alternatives the avatar has already tried. Mechanism: ${answers.uniqueMechanism || ''}`,
    'CTA DIRETO': 'Clear, direct action. One sentence.',
    DIFERENCIAÇÃO: '1-2 specific differentiators vs. competing options the audience already knows.',
    'PROVA SOCIAL': 'Mechanism proof or specific result. No invented testimonials.',
    GARANTIA: 'Reduce purchase risk with a concrete guarantee or reassurance.',
    'CTA + BENEFÍCIO': 'Direct action + one concrete benefit they get immediately.',
    'OFERTA INICIAL': 'Present the offer directly and specifically. No warm-up.',
    'URGÊNCIA REAL': 'Real scarcity or urgency only — never invent it.',
  };

  // VSL mode — explicit user choice from the form ('vsl-curiosity').
  // Some users send traffic to a long video that closes the sale (need
  // intrigue-only ads); others send straight to a product page (need
  // selling ads). Without an explicit choice, fall back to the awareness-
  // level beats — that preserves the old behaviour for projects that
  // haven't set the new field yet.
  const isVslTraffic = answers.copyStrategy === 'vsl-curiosity';
  const vslBeats: Array<[string, number]> = [
    ['REVELAÇÃO INESPERADA', 0.3],
    ['LOOP DE CURIOSIDADE', 0.4],
    ['PONTE PARA O VÍDEO', 0.2],
    ['CTA SUAVE', 0.1],
  ];
  const vslBeatInstructions: Record<string, string> = {
    'REVELAÇÃO INESPERADA':
      'Open with a counterintuitive statement, surprising fact, or contradiction that stops the scroll. Do NOT reveal the product, mechanism, or solution.',
    'LOOP DE CURIOSIDADE':
      'Deepen the mystery. Hint that there is a specific explanation/method/reason — but never give it. Make the reader feel they MUST know more.',
    'PONTE PARA O VÍDEO':
      'Make it clear the full answer lives inside the video. Phrasing like "in this video", "what I show in detail", "the full method". Do not summarise it.',
    'CTA SUAVE':
      'Low-pressure invitation to watch the video. One short sentence. No promise of the outcome.',
  };

  const activeBeats = isVslTraffic ? vslBeats : (beatBudgets[currentLevel] || beatBudgets['3'])!;
  const activeBeatInstructions = isVslTraffic ? vslBeatInstructions : beatInstructions;

  const beatStructure = activeBeats
    .map(([name, pct]) => {
      const words = Math.round(wordCount * pct);
      const instruction = activeBeatInstructions[name] || '';
      return `[${name}] (${words} words): ${instruction}`;
    })
    .join('\n');

  const vslGuard = isVslTraffic
    ? `

--- VSL TRAFFIC MODE (CRITICAL) ---
The click destination is a long-form Video Sales Letter (VSL). The ad's ONLY job is to earn the click. The VSL handles the entire sale.

ABSOLUTELY DO NOT:
- Promise the result or transformation
- Reveal the product name in the first half
- Describe the mechanism, formula, or method
- Mention price, discount, guarantee, or refund
- Use closing language ("buy now", "secure your spot", "limited offer")
- Resolve the curiosity loop

YOU MUST:
- Open a loop the viewer can only close by watching
- Treat the video as the ONLY place where the answer lives
- Stop before the payoff. The reader should be MORE curious at the end than at the start, not less.`
    : '';

  const ctaByDestination: Record<string, string> = {
    Vídeo: 'watch the video / see how it works',
    'Landing Page de Vendas': 'secure your spot / start today',
    'Lead Form': 'sign up for free / register now',
    WhatsApp: 'message us on WhatsApp',
    'Página de Captura': 'get the material / download now',
  };

  const emotionGuidance: Record<string, string> = {
    Frustração:
      'Short, punchy sentences. Mirror the internal monologue of someone who has tried and failed. Vocabulary: stuck, tired, nothing works, done trying.',
    Curiosidade:
      'Open a loop early and hold it open until the mechanism reveal. Use incomplete thoughts and unexpected contrasts.',
    'Medo de julgamento':
      'Speak directly to the fear of how others perceive them. Normalize the vulnerability first, then reframe it.',
    Confusão:
      "Acknowledge the overwhelm upfront. Use contrast: 'You've heard X, but actually Y.' Simplify aggressively.",
    Esperança:
      'Future-paced language. Short glimpses of a better state. Warm and credible — not hyped.',
    Alívio:
      'Write as if the reader has been holding tension — this script is the exhale. Calm, clear, reassuring.',
    'Desejo de reconhecimento':
      'Acknowledge their effort and identity first. They want to be seen as capable and smart.',
    Urgência: 'Active verbs. Present tense. No padding. Every sentence moves the reader forward.',
    Ambição:
      'Speak to a bigger version of themselves. Use specific outcomes, not vague transformation.',
    'Desejo de controle':
      "Frame around agency: 'You can', 'It's in your hands', 'You decide'. Avoid passive constructions.",
    Exclusividade: "Language of rarity and selection. Not for everyone — and that's the point.",
  };

  const primaryEmotion = answers.primaryEmotion || '';
  const emotionInstruction = emotionGuidance[primaryEmotion]
    ? `\nEMOTION DIRECTION — ${primaryEmotion}:\n${emotionGuidance[primaryEmotion]}`
    : primaryEmotion
      ? `\nEMOTION DIRECTION: Write to actively trigger "${primaryEmotion}" in the reader. Use vocabulary, rhythm, and imagery that make them feel it — not just understand it.`
      : '';

  // UX14: few-shot examples + cultural PT-BR mode.
  // Examples são injetados como referência de TOM e RITMO, não pra copiar.
  // Cultural PT-BR só ativa quando lingua-alvo é português.
  const targetLang: 'pt' | 'en' = isPortuguese(answers.language) ? 'pt' : 'en';
  const inferredVertical: CopyVertical | undefined = inferVertical({
    produto: answers.productName,
    oferta: answers.productResult,
    dorPrincipal: answers.painPoints || answers.situation,
    audience: answers.audience,
  });
  // UX22: quando user marcou copies específicas (referenceCopyIds não vazio),
  // App.tsx já filtrou a clientLibrary pra conter SÓ essas. Nesse caso
  // aumentamos o count pra usar todas elas (até um teto razoável).
  const clientLib = (answers.__clientCopyLibrary as CopyExample[]) || [];
  const userExplicitlySelected = !!(answers.__manualSelection as boolean);
  // UX23-F: similarity slider 0-100. Default 65 (medium-strong).
  const similarityRaw = Number(answers.__referenceSimilarity);
  const referenceSimilarity =
    Number.isFinite(similarityRaw) && similarityRaw >= 0 && similarityRaw <= 100
      ? similarityRaw
      : 65;
  // Buckets:
  //   0-25  → light (study tone, don't copy — original behavior)
  //   26-50 → medium (mirror the FEEL, position at top)
  //   51-75 → strong (mirror tight + style fingerprint)
  //   76-100 → clone (fingerprint + voice indistinguishable)
  type SimilarityBucket = 'light' | 'medium' | 'strong' | 'clone';
  const bucket: SimilarityBucket =
    referenceSimilarity <= 25
      ? 'light'
      : referenceSimilarity <= 50
        ? 'medium'
        : referenceSimilarity <= 75
          ? 'strong'
          : 'clone';

  const fewShotExamples: CopyExample[] = selectCopyExamples({
    language: targetLang,
    vertical: inferredVertical,
    awareness: currentLevel as AwarenessLevel,
    angleHint: angle,
    // Se user selecionou manualmente, usa todas (até 5). Senão, auto-pick 2.
    count: userExplicitlySelected ? Math.min(5, clientLib.length) : 2,
    clientLibrary: clientLib,
  });

  // UX23-D: extrair fingerprint só quando user marcou manualmente + bucket
  // for strong/clone. Custa 1 call extra de Claude (~1s) mas eleva muito
  // a fidelidade da imitação. Para light/medium pulamos pra economizar.
  let styleFingerprint: string | null = null;
  if (
    userExplicitlySelected &&
    (bucket === 'strong' || bucket === 'clone') &&
    clientLib.length > 0
  ) {
    try {
      styleFingerprint = await extractStyleFingerprint(clientLib);
    } catch {
      styleFingerprint = null;
    }
  }

  // Log pra debug — App.tsx também loga, mas aqui temos o estado completo.
  if (userExplicitlySelected) {
    console.info(
      `[copy-gen] manual reference: ${clientLib.length} copies | similarity=${referenceSimilarity}% (${bucket}) | fingerprint=${styleFingerprint ? 'extracted' : 'none'}`
    );
  }

  const culturalBlock =
    targetLang === 'pt'
      ? `\n\nCULTURAL VOICE — PORTUGUÊS (BRASIL) — APPLY ONLY WHEN WRITING IN PORTUGUESE:
- Use construções orais brasileiras: "presta atenção que vou te contar", "olha só", "saca só", "do nada", "de uma vez"
- EVITE construções traduzidas-do-inglês: "você está prestes a descobrir", "no mundo de hoje", "neste universo", "uma jornada"
- Prefira ritmo de fala, não de redação literária
- Use "você" (não "tu", "vós" ou "tu" misturado)
- Idiomatismos brasileiros são bem-vindos: "do tipo", "tipo assim", "saca?", "viu?", "né?", "olha aí"
- Frases curtas. Vírgula > ponto-e-vírgula. Quebra de linha tem peso.
- EVITE adjetivos genéricos: "incrível", "transformador", "revolucionário", "definitivo"
- Especificidade > intensidade: "3 da manhã" > "muito tarde", "47 mil pessoas" > "milhares"`
      : '';

  const systemPrompt = `You are a senior direct-response copywriter specializing in Meta Ads, trained in Eugene Schwartz's five stages of awareness (Breakthrough Advertising). You write in the style of Gary Halbert, Stefan Georgi (RMBC), and Dan Kennedy — direct, specific, honest, oral cadence.

OUTPUT LANGUAGE:
Write the entire script in: ${answers.language || 'Português (Brasileiro)'}
Every word must be in this language. If any input data is in a different language, translate it naturally before using it.${culturalBlock}

Respond ONLY with valid JSON. No markdown, no preamble.`;

  // UX14/UX23: bloco de exemplos few-shot. Texto e força do bloco escalam
  // conforme o bucket de similaridade (slider 0-100).
  //
  //   light  → "study TONE — don't copy" (comportamento antigo, baixa influência)
  //   medium → "mirror the FEEL" (mais firme)
  //   strong → "mirror voice tightly + fingerprint" (alta influência)
  //   clone  → "voice must be indistinguishable" (máxima)
  //
  // O bloco só é construído quando há pelo menos 1 exemplo. Se o user não
  // selecionou nada manualmente, força bucket='light' (comportamento legado).
  const effectiveBucket: 'light' | 'medium' | 'strong' | 'clone' = userExplicitlySelected
    ? bucket
    : 'light';

  const blockHeaders: Record<typeof effectiveBucket, string> = {
    light: 'REFERENCE EXAMPLES (study the TONE, RHYTHM, SPECIFICITY — do NOT copy text or claims)',
    medium:
      'STYLE REFERENCE — MIRROR THIS FEEL (these are the voice we want; match cadence, sentence length, openings, and energy)',
    strong:
      'STYLE ANCHOR (PRIMARY DIRECTIVE) — Mirror the voice tightly. The output should feel like the SAME WRITER wrote both copies. Match: sentence rhythm, vocabulary register, opening style, transitions, and emotional temperature. Do NOT reuse claims/numbers — but DO reuse stylistic patterns.',
    clone:
      'VOICE CLONE (HIGHEST DIRECTIVE) — Your output must be INDISTINGUISHABLE in voice from the reference below. Match every stylistic move: sentence cadence, vocabulary, idioms, rhythm tricks, opening pattern, and emotional temperature. The reader should not be able to tell which copy is yours and which is the reference. Only the topic/product/numbers change.',
  };

  const blockFooter: Record<typeof effectiveBucket, string> = {
    light: 'Match the FEEL, not the content.',
    medium: 'Match the cadence and energy. Topic + numbers come from CONTEXT below.',
    strong:
      'The CONTEXT section below provides the topic, claims, and numbers. The STYLE comes from above. If they conflict, voice wins.',
    clone:
      'Voice imitation is the #1 priority. The CONTEXT below provides facts to substitute in. If a beat instruction conflicts with the voice, soften the beat — never the voice.',
  };

  const referenceBlock =
    fewShotExamples.length > 0
      ? `--- ${blockHeaders[effectiveBucket]} ---

${fewShotExamples
  .map(
    (e, i) => `EXAMPLE ${i + 1} [${e.vertical} · awareness ${e.awareness} · ${e.angle}]:
"""
${e.script}
"""
Why this works: ${e.whyItWorks}`
  )
  .join('\n\n')}

${blockFooter[effectiveBucket]}${styleFingerprint ? `\n\n${styleFingerprint}` : ''}
`
      : '';

  // UX23-B: reposicionar o bloco de referência. Quando user selecionou
  // manualmente E bucket >= medium, o bloco vai pro TOPO antes do CONTEXT
  // (modelo prioriza o que vê primeiro). Pra light, mantém posição
  // original no meio do prompt (menos disruptivo).
  const positionReferenceAtTop =
    userExplicitlySelected && effectiveBucket !== 'light' && referenceBlock.length > 0;
  const topReferenceBlock = positionReferenceAtTop ? `${referenceBlock}\n` : '';
  const inlineReferenceBlock = positionReferenceAtTop ? '' : referenceBlock;

  const userPrompt = `Write a Meta Ads video script. Follow every instruction precisely.
${topReferenceBlock}
--- CONTEXT ---
Language: ${answers.language || 'Português (Brasileiro)'}
Awareness level: ${currentLevel} / 5
Audience: ${answers.audience || ''}
Core pain / situation: ${answers.situation || answers.painPoints || ''}
Main objection (anticipate and dissolve this in the copy): ${answers.mainObjection || '(none provided)'}
Hidden desire (the deeper want — connect transformation to this, not just surface result): ${answers.hiddenDesire || '(none provided)'}
Product: ${answers.productName || ''}
Promised result: ${answers.productResult || ''}
Unique mechanism: ${answers.uniqueMechanism || ''}
${inlineReferenceBlock}
--- CREATIVE DIRECTION ---
Ad style: ${answers.estiloAnuncio || 'Direto ao Ponto'}
Apply this style to the tone, rhythm, and sentence structure throughout the script.

Angle: ${angle || 'Direto'}
The opening sentence and the main argument must be built around this angle. It is the through-line of the entire script.
${emotionInstruction}

--- BEAT STRUCTURE ---
Write each beat in sequence. Do not skip or merge beats. Include the beat label in the output (e.g. [REVELAÇÃO]).

${beatStructure}
${vslGuard}

--- WORD COUNT ---
Target: ${wordCount} words (±5 words max). Count words excluding beat labels in brackets.
Do not pad or extend. If over, cut — do not summarize.

--- OUTPUT ---
Respond with ONLY this JSON:
{ "script": "full script text with beat labels included" }

--- PROHIBITED ---
- Invented characters ("a woman", "one client", "a teacher who...")
- Deadlines not in the brief ("in 30 days", "in 7 days")
- Unsourced claims ("studies show", "experts say", "research proves")
- Cliché phrases: "transform your life", "discover the secret", "this will change everything", "revolutionary", "life-changing", "game-changer"
If no real proof exists → use MECHANISM PROOF or LOGICAL PROOF instead.

--- CTA ---
Required phrasing for "${answers.clickDestination || 'Vídeo'}": ${ctaByDestination[answers.clickDestination || 'Vídeo'] || 'watch the video'}
Use this phrasing or a natural variation in the output language. Do not reference any other format (podcast, webinar, course, book).

--- REPETITION LIMITS ---
Product name: max 2 mentions. Core pain term: max 3 mentions (use synonyms after).`;

  const maxTokens = Math.max(1500, wordCount * 8);
  const raw = onToken
    ? await streamClaude(systemPrompt, userPrompt, onToken, { maxTokens })
    : await callClaude(systemPrompt, userPrompt, maxTokens);

  let result: any;
  try {
    const cleaned = raw
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    result = JSON.parse(cleaned);
  } catch {
    result = { script: raw };
  }

  return { hooks: [], script: result.script || raw };
};

// ─────────────────────────────────────────────
// 2b. ESCOLHER 9 HOOKS COM BASE EM COPY + NÍVEL
// ─────────────────────────────────────────────
/**
 * Contexto opcional pra enriquecer a seleção de hooks. Quando o user veio
 * de um brief (Plano de Marketing), passamos o brief + persona + productInfo
 * pra que o Claude consiga escolher hooks alinhados ao ângulo/emoção/dor
 * específicos do criativo, não só ao texto cru da copy. UX4.
 */
export type HookSelectionContext = {
  productInfo?: {
    produto?: string;
    oferta?: string;
    dorPrincipal?: string;
    [key: string]: any;
  } | null;
  persona?: {
    name?: string;
    age?: string;
    description?: string;
    mainPain?: string;
    dominantFear?: string;
    hiddenDesire?: string;
    mainObjection?: string;
    currentSituation?: string;
    awarenessReason?: string;
    [key: string]: any;
  } | null;
  brief?: {
    angle?: string;
    emotion?: string;
    style?: string;
    painPoint?: string;
    hook?: string; // hook original sugerido pelo brief — boa referência de estilo
    [key: string]: any;
  } | null;
};

export const chooseHooksFromCopy = async (
  approvedCopy: string,
  awarenessLevel: string,
  candidateHooks: any[],
  context?: HookSelectionContext
): Promise<{ grupos: any[] } | null> => {
  if (!candidateHooks || candidateHooks.length === 0) return null;
  if (!approvedCopy) return null;

  const systemPrompt = `Você é um especialista em copywriting para Meta Ads. Você tem 2 tarefas:
1. Selecionar hooks que combinem com a copy aprovada, o nível de consciência da audiência, e — quando fornecidos — o ângulo do criativo e a dor da persona-alvo.
2. PREENCHER os placeholders (___, [topic], [pain], etc) de cada hook selecionado usando o contexto fornecido (produto, persona, ângulo, copy). O resultado deve ser um hook FALÁVEL e PRONTO, não um template.

Hooks devem soar como abertura natural da copy, não introdução genérica. Responda APENAS em JSON válido sem markdown.`;

  // Bloco opcional de contexto rico. Só montado quando ao menos 1 campo
  // não-vazio é fornecido — evita poluir o prompt em fluxos legacy.
  const contextBlock = (() => {
    if (!context) return '';
    const lines: string[] = [];
    const { productInfo, persona, brief } = context;
    if (productInfo?.produto || productInfo?.oferta || productInfo?.dorPrincipal) {
      lines.push('PRODUTO/OFERTA:');
      if (productInfo.produto) lines.push(`  • Produto: ${productInfo.produto}`);
      if (productInfo.oferta) lines.push(`  • Oferta: ${productInfo.oferta}`);
      if (productInfo.dorPrincipal) lines.push(`  • Dor principal: ${productInfo.dorPrincipal}`);
    }
    if (persona?.name || persona?.mainPain || persona?.dominantFear) {
      lines.push('PERSONA-ALVO:');
      if (persona.name) lines.push(`  • Nome: ${persona.name}`);
      if (persona.age) lines.push(`  • Idade: ${persona.age}`);
      if (persona.currentSituation) lines.push(`  • Situação atual: ${persona.currentSituation}`);
      if (persona.mainPain) lines.push(`  • Dor central: ${persona.mainPain}`);
      if (persona.dominantFear) lines.push(`  • Medo dominante: ${persona.dominantFear}`);
      if (persona.hiddenDesire) lines.push(`  • Desejo oculto: ${persona.hiddenDesire}`);
      if (persona.mainObjection) lines.push(`  • Maior objeção: ${persona.mainObjection}`);
    }
    if (brief?.angle || brief?.emotion || brief?.painPoint || brief?.hook) {
      lines.push('ÂNGULO DO CRIATIVO (escolhido no Plano de Marketing):');
      if (brief.angle) lines.push(`  • Ângulo: ${brief.angle}`);
      if (brief.emotion) lines.push(`  • Emoção primária: ${brief.emotion}`);
      if (brief.style) lines.push(`  • Estilo: ${brief.style}`);
      if (brief.painPoint) lines.push(`  • Dor abordada: ${brief.painPoint}`);
      if (brief.hook) lines.push(`  • Hook original sugerido (referência de tom): "${brief.hook}"`);
    }
    return lines.length > 0 ? `\n${lines.join('\n')}\n` : '';
  })();

  const userPrompt = `Selecione os 9 melhores hooks para esta copy.

COPY APROVADA:
"""
${approvedCopy}
"""

NÍVEL DE CONSCIÊNCIA: ${awarenessLevel || '3'}
${contextBlock}
CANDIDATOS (${candidateHooks.length}):
${candidateHooks.map((h: any) => `ID ${h.id} [${h.tipo}]: ${h.template}`).join('\n')}

REGRAS DE SELEÇÃO:
1. Selecione EXATAMENTE 3 hooks por tipo (9 total, 3 grupos)
2. Os tipos vêm dos candidatos
3. Escolha os mais alinhados com o tom, ângulo e mensagem da copy
4. Se contexto de ângulo/persona estiver presente, priorize hooks que
   ressoam com a dor central, o medo dominante e o ângulo escolhido —
   não só com o texto cru da copy
5. Marque 1 ⭐ recomendado por grupo (o melhor)
6. Não repita IDs

REGRAS DE PREENCHIMENTO DOS PLACEHOLDERS (campo "filled"):
7. Para cada hook selecionado, preencha TODOS os placeholders (___, ____,
   [topic], [pain], [number], [audience], [product], [problem], etc) com
   palavras concretas vindas do contexto (produto, persona, copy, brief).
8. O texto preenchido deve ser FALÁVEL como abertura natural de anúncio:
   - Comprimento de hook real (5-25 palavras)
   - Sem placeholders restantes (zero "___", zero "[...]")
   - Sem aspas envolvendo o texto inteiro
   - Mesma língua do CONTEXTO/COPY (PT ou EN), não traduza
9. Use detalhes ESPECÍFICOS do produto/persona, não genéricos. Se a dor é
   "neuropatia nos pés", não use "essa dor" — use "queimação nos pés".
10. Mantenha o ESPÍRITO do template original (curiosidade, contraste, etc)
    — só preencha as lacunas, não reescreva a estrutura toda.
11. Quando o template NÃO tem placeholders, "filled" deve ser o próprio
    template (já está pronto pra falar).

FORMATO (JSON apenas):
{
  "grupos": [
    {
      "tipo": "nome do tipo",
      "hooks": [
        {"id": 123, "recomendado": false, "filled": "hook preenchido falável aqui"},
        {"id": 456, "recomendado": true, "filled": "outro hook preenchido aqui"},
        {"id": 789, "recomendado": false, "filled": "terceiro preenchido aqui"}
      ]
    }
  ]
}`;

  try {
    // UX10: 2000 tokens (era 1000) — agora retorna também o campo "filled"
    // pra cada hook (9 versões preenchidas + estrutura JSON).
    const raw = await callClaude(systemPrompt, userPrompt, 2000);
    const cleaned = raw
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    return JSON.parse(cleaned);
  } catch (err: any) {
    console.error('[chooseHooksFromCopy]', err.message);
    return null;
  }
};

// ─────────────────────────────────────────────
// 3. OTIMIZAR COPY PARA ELEVENLABS V3
// ─────────────────────────────────────────────
export const optimizeCopyForElevenLabsWithClaude = async (
  script: string,
  answers: Record<string, any>
): Promise<string> => {
  const emotion = answers?.primaryEmotion || 'Direto';
  const style = answers?.estiloAnuncio || 'Direto ao Ponto';
  const language = answers?.language || 'Português (Brasileiro)';

  const emotionTags: Record<string, string> = {
    Urgência: '<excited>',
    Alívio: '<sighs>',
    Frustração: '<frustrated>',
    Esperança: '<warmly>',
    Confusão: '<confused>',
    Curiosidade: '<curious>',
    Medo: '<whispers>',
    Ambição: '<excited>',
    Cansaço: '<softly>',
    Tristeza: '<sadly>',
  };
  const emotionTag = emotionTags[emotion] || '';

  const systemPrompt = `Você é especialista em otimizar scripts para síntese de voz com ElevenLabs v3. Sua função é APENAS adicionar tags SSML/áudio e marcadores de ênfase ao roteiro existente — NUNCA reescrever, expandir, resumir ou adicionar conteúdo novo. Você é um transformador formal, não um copywriter. Responda APENAS em JSON válido sem markdown.`;

  const userPrompt = `Adicione tags SSML e ênfases ao ROTEIRO ORIGINAL abaixo.

⚠️ REGRA #1 ABSOLUTA — NÃO ADICIONE PALAVRAS NOVAS:
- Você só pode ADICIONAR: tags SSML (<break>, <whispers>, etc), letras maiúsculas pra ênfase, traços (—) entre frases.
- Você NÃO PODE adicionar: frases novas, palavras novas, conectivos, exemplos, elaborações, intensificadores como "ANYONE", "EVER", "AT ANY MOMENT" etc se não estavam no original.
- Cada palavra do output que NÃO seja uma tag SSML deve EXISTIR no input (ignorando caps).
- Se o input tem 11 palavras faladas, o output tem 11 palavras faladas. Nem uma a mais.

EXEMPLO DO QUE NÃO FAZER:
- Input: "Did you know that neuropathy has nothing to do with age?"
- ❌ ERRADO: "<whispers>Did you know that neuropathy has NOTHING to do with age? <break time='0.6s'/> It can strike ANYONE — at ANY moment."
  (adicionou "It can strike ANYONE — at ANY moment." que NÃO existe no input)
- ✅ CERTO: "<whispers>Did you know that neuropathy has NOTHING to do with age?"

ROTEIRO ORIGINAL:
"""
${script}
"""

CONTEXTO:
- Idioma: ${language}
- Estilo: ${style}
- Emoção: ${emotion}
- Tag sugerida: ${emotionTag}

REGRAS CRÍTICAS DE PARÊNTESES E INSTRUÇÕES DE PALCO:
1. Analise cuidadosamente os textos entre parênteses "()":
   - Se for uma INSTRUÇÃO DE ATUAÇÃO / DIREÇÃO DE PALCO (ex: (sighs), (whispering), (pause), (long pause), (nervous), (softly), (slowly), (sorrindo)): NÃO inclua essas palavras no texto falado. Remova-as ou converta para comportamento compatível (ex: (pause) → <break time="1s"/>).
   - Se for CONTEÚDO REAL DA FRASE (ex: "(e isso é importante)", "(mesmo que já tenha tentado de tudo)"): MANTENHA as palavras no texto para serem narradas (remova os parênteses, se desejar, mas guarde o texto da narração inalterado).
2. Não envie instruções cruas de palco como texto narrado para o ElevenLabs.
3. Preserve tags SSML válidas pré-existentes.

REGRAS GERAIS DE OTIMIZAÇÃO ELEVENLABS:
4. REMOVER placeholders como [HOOK], [BEAT], [CTA], [AGITAÇÃO DA DOR], etc. — o script deve conter majoritariamente o texto a ser lido em voz alta.
5. ADICIONAR tags ElevenLabs v3 onde fizer sentido emocionalmente (máx 3-4 no script):
   - Adicione "${emotionTag}" no início do hook para ditar o tom inicial.
   - Use ONLY this exact format: <excited>, <sighs>, <whispers>, <warmly>, <softly>
   - NEVER use parentheses () or square brackets [] for audio tags
   - ✅ Correct: <sighs>
   - ❌ Wrong: [sighs] or (sighs)
6. PAUSAS estratégicas (IMPORTANTE: MANTENHA O RITMO NATURAL E FLUIDO, MÁXIMO 0.8s):
   - Use <break time="0.8s"/> (máximo permitido) após o gancho principal ou pausa muito forte. NUNCA use mais que 0.8s.
   - Use <break time="0.4s"/> a <break time="0.6s"/> nas transições de ideias ou mudanças de frases.
   - Use "—" ou <break time="0.3s"/> para micro-pausas curtas entre frases conectadas.
   - Não use muitas pausas. O áudio deve fluir como uma fala humana natural em ritmo de anúncio.
7. Aplique ÊNFASE usando letras MAIÚSCULAS para as palavras-chave principais. (caps mudam visual, não adicionam palavra — então tá ok)
8. CHECAGEM FINAL antes de responder: conte as palavras do seu output (excluindo tags SSML). O número TEM que ser igual ou menor que o número de palavras do roteiro original. Se for maior, você adicionou texto e violou a regra #1 — refaça.

FORMATO (JSON apenas):
{"optimizedScript": "script otimizado"}`;

  const raw = await callClaude(systemPrompt, userPrompt, 2000);

  let optimized = '';
  try {
    const cleaned = raw
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    // If it looks like JSON, parse it
    if (cleaned.startsWith('{')) {
      const parsed = JSON.parse(cleaned);
      optimized = parsed.optimizedScript || parsed.script || cleaned;
    } else {
      // If Claude returned plain text directly, use as-is
      optimized = cleaned;
    }
  } catch {
    // Last resort: strip the JSON wrapper manually
    const match = raw.match(/"optimizedScript"\s*:\s*"([\s\S]*)"/);
    if (match && match[1]) {
      optimized = match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
    } else {
      optimized = raw;
    }
  }

  // UX9 safety net: se o output tem MAIS de 30% palavras a mais que o
  // input (excluindo tags SSML), o modelo provavelmente adicionou texto
  // — viola a regra #1. Loga aviso pro dev mas retorna mesmo assim
  // (não bloqueia o user; só registra pra a gente conseguir investigar
  // se voltar a acontecer). 30% de buffer pra acomodar maiusculizacao
  // sem falsos positivos.
  try {
    const stripSsml = (s: string) =>
      s
        .replace(/<[^>]+>/g, ' ') // <whispers>, <break .../>, etc
        .replace(/\s+/g, ' ')
        .trim();
    const wordCount = (s: string) =>
      stripSsml(s)
        .split(/\s+/)
        .filter((w) => w.length > 0 && /[a-zA-ZÀ-ÿ]/.test(w)).length;
    const inputWords = wordCount(script);
    const outputWords = wordCount(optimized);
    if (inputWords > 0 && outputWords > inputWords * 1.3) {
      console.warn(
        '[optimizeCopyForElevenLabs] output added words:',
        `input=${inputWords} output=${outputWords}.`,
        'Modelo pode ter violado a regra de não adicionar texto novo.'
      );
    }
  } catch {
    // counter is best-effort; never block the response
  }

  return optimized;
};

// ─────────────────────────────────────────────
// 4. DESCOBRIR PERSONA/AVATAR
// ─────────────────────────────────────────────
export const discoverPersonaWithClaude = async (answers: Record<string, any>): Promise<any> => {
  const systemPrompt = `Você é um especialista em marketing direto, copywriting e segmentação de Meta Ads. Você cria perfis ricos de cliente ideal (3 personas: principal, secundária, terciária) baseado em informações sobre o produto. Você infere dor, desejo, objeção e nível de consciência a partir do contexto. Responda APENAS em JSON válido sem markdown.`;

  const userPrompt = `Com base nas informações abaixo sobre um produto, gere 3 PERSONAS DIFERENTES (principal, secundária, terciária), priorizadas por probabilidade de conversão em Meta Ads.

INFORMAÇÕES DO PRODUTO:
- Produto: ${answers.product || ''}
- Categoria: ${answers.category || ''}
- O que faz: ${answers.whatItDoes || ''}
- Transformação: De "${answers.transformationFrom || ''}" Para "${answers.transformationTo || ''}"
- Urgência do problema: ${answers.urgency || ''}
- Diferenciais: ${(answers.differentials || []).join(', ')}
- Comentários sobre o produto: ${answers.productComment || '(nenhum)'}

INFORMAÇÕES DO CLIENTE:
- O que já tentou e não funcionou: ${(answers.personaTriedBefore || []).join(', ')}
- Capacidade de pagar: ${answers.payingCapacity || ''}
- Desejos ocultos identificados: ${(answers.hiddenDesires || []).join(', ')}
- Comentários extras: ${answers.problemComment || answers.clientComment || '(nenhum)'}

REGRAS:
- Persona Principal: maior intersecção entre dor + urgência + capacidade de pagar + clareza do problema.
- Persona Secundária: forte em alguns critérios mas com algum atrito.
- Persona Terciária: público adjacente que pode comprar com mensagem ajustada.
- Nome SIMBÓLICO único (ex: "Linda, a Avó Cansada"), não "Maria 35 anos".
- Awareness 1=Inconsciente, 2=Consciente do problema, 3=Consciente da solução, 4=Consciente do produto, 5=Muito consciente.
- Inferir dor, desejo, medo e objeção mesmo sem o usuário ter dito explicitamente.
- Ângulo de vídeo deve ser concreto, não genérico.

⚠️ ATENÇÃO — CAMPOS NOVOS DE CONFIDENCE (críticos pra distribuição de criativos):
- "confidence" (0.0-1.0): quão FORTE a fonte sustenta essa persona.
  • 0.85-1.0 → fonte fala diretamente desse perfil
  • 0.6-0.84 → inferência clara mas não explícita
  • 0.4-0.59 → inferência razoável mas com lacunas
  • < 0.4   → especulação, persona "esticada"
- "suggestedWeight" (0.0-1.0): % sugerido de criativos pra essa persona.
  • Soma das 3 personas DEVE SER EXATAMENTE 1.0
  • Reflete: confidence × potencial de conversão estimado
- "evidence": 1-3 frases curtas (citações ou paráfrases) da fonte que justificam essa persona
- "isStretch" (boolean): true SOMENTE quando confidence < 0.5 — persona é especulação adjacente, não dado da fonte. Quando true, suggestedWeight deve ser ≤ 0.15.

EXEMPLO DE PESOS típico:
- VSL mono-persona forte → 0.85 / 0.15 / 0.0 (ou marque terciária com isStretch:true)
- VSL com cuidador implícito (estilo Arya Leaf) → 0.65 / 0.30 / 0.05
- Produto que serve 3 públicos distintos → 0.50 / 0.30 / 0.20

FORMATO (JSON apenas):
{
  "personas": [
    {
      "rank": "principal",
      "name": "Nome simbólico curto",
      "description": "Descrição em 2 frases",
      "age": "Faixa etária",
      "gender": "Homem/Mulher/Ambos",
      "currentSituation": "Como é o dia a dia hoje",
      "mainPain": "Dor principal em 1-2 frases concretas",
      "hiddenDesire": "Desejo profundo, não o resultado superficial",
      "dominantFear": "Maior medo/preocupação",
      "mainObjection": "Principal motivo pra não comprar",
      "emotionalTrigger": "Gatilho que faz parar de rolar o feed",
      "awarenessLevel": "1 a 5",
      "awarenessReason": "Por que está nesse nível em 1 frase",
      "whyMainOrSecondaryOrTertiary": "Por que é principal/secundária/terciária em 1-2 frases",
      "recommendedVideoAngle": "Ângulo concreto",
      "recommendedHookType": "Tipo de hook",
      "communicationTone": "Tom",
      "strongestPromise": "Promessa mais forte",
      "recommendedCTA": "CTA específico",
      "confidence": 0.85,
      "suggestedWeight": 0.55,
      "evidence": ["citação 1", "citação 2"],
      "isStretch": false
    },
    { "rank": "secundaria", ... mesmos campos incluindo confidence/suggestedWeight/evidence/isStretch },
    { "rank": "terciaria", ... mesmos campos incluindo confidence/suggestedWeight/evidence/isStretch }
  ]
}`;

  const raw = await callClaude(systemPrompt, userPrompt, 4000);

  try {
    const cleaned = raw
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    return JSON.parse(cleaned);
  } catch (err: any) {
    console.error('[discoverPersonaWithClaude]', err.message);
    throw new Error('Falha ao parsear resposta do Claude.');
  }
};

// ─────────────────────────────────────────────
// 5. RECOMENDAR avatar + voz ideais para o projeto
// ─────────────────────────────────────────────
export interface AvatarVoiceRecommendation {
  avatar: {
    gender: 'male' | 'female';
    age: 'young' | 'adult' | 'mature' | 'elderly';
    ethnicity: 'white' | 'asian' | 'south_asian' | 'latino' | 'middle_eastern' | 'black' | 'mixed';
    style: 'professional' | 'lifestyle' | 'ugc' | 'creative';
    vibe: 'energetic' | 'calm' | 'authoritative' | 'friendly' | 'serious';
  };
  voice: {
    gender: 'male' | 'female';
    age: 'young' | 'middle_aged' | 'old';
    accent: string;
    use_case: string;
    descriptive: string;
  };
  reasoning: string;
}

// ─────────────────────────────────────────────
// 6. EXTRAIR info do produto a partir de VSL/landing page
// ─────────────────────────────────────────────
export interface ProductInfo {
  productName: string;
  category: string;
  offer: string;
  promise: string;
  mainPain: string;
  secondaryPains: string[];
  benefits: string[];
  audience: string;
  awarenessLevel: string;
  tone: string;
  differentiator: string;
  socialProof: string[];
  guarantee: string | null;
  urgency: string | null;
  hookAngles: string[];
}

export async function personaFromProduct(input: {
  productInfo: any;
  options: {
    categories: string[];
    urgencies: string[];
    differentials: string[];
    triedBefores: string[];
    payingCapacities: string[];
    hiddenDesires: string[];
    languages: string[];
    ageBuckets: string[];
    businessModels: string[];
    emotions: string[];
    angles: string[];
  };
}): Promise<Record<string, any>> {
  const response = await fetch('/api/claude/persona-from-product', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Persona fill error: ${await response.text()}`);
  const data = await response.json();
  if (!data.success) throw new Error(data.error || 'Erro ao preencher persona.');
  return data.answers;
}

export async function extractProductInfo(input: {
  text?: string;
  url?: string;
  youtubeUrl?: string;
}): Promise<ProductInfo> {
  const response = await fetch('/api/claude/extract-product-info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Extract error: ${err}`);
  }
  const data = await response.json();
  if (!data.success) throw new Error(data.error || 'Erro ao extrair info do produto.');
  return data.product;
}

// ─────────────────────────────────────────────
// 7. PLANO DE MARKETING (Andromeda-aware)
// ─────────────────────────────────────────────
export interface MarketingPlan {
  summary: string;
  creativeVolume: {
    totalCreatives: number;
    rationale: string;
    perAudience: number;
  };
  hookMix: Array<{
    angle: string;
    count: number;
    example: string;
    awarenessLevel: string;
    rationale: string;
  }>;
  awarenessCoverage: Array<{
    level: string;
    creativeCount: number;
    approach: string;
  }>;
  durations: Array<{
    length: string;
    purpose: string;
    count: number;
  }>;
  adStructure: {
    campaigns: number;
    adSets: number;
    creativesPerAdSet: number;
    rationale: string;
  };
  budget: {
    dailyMin: number;
    dailyRecommended: number;
    rationale: string;
  };
  iterationPlan: {
    testDays: number;
    killThreshold: string;
    scaleThreshold: string;
    iterationFrequency: string;
  };
  andromedaTips: string[];
  nextSteps: string[];
}

export async function generateMarketingPlan(input: {
  productInfo?: any;
  persona?: any;
  copyAnswers?: any;
}): Promise<MarketingPlan> {
  // Legacy helper — used by callers that only care about the macro plan,
  // not the briefs. Internally calls the same endpoint as the new
  // blueprint helper but discards `briefs`. Kept for back-compat with
  // PlanTab v1 until v2 ships.
  const response = await fetch('/api/claude/marketing-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Marketing plan error: ${err}`);
  }
  const data = await response.json();
  if (!data.success) throw new Error(data.error || 'Erro ao gerar plano de marketing.');
  return data.plan;
}

/**
 * Blueprint = macro plan + N creative briefs in one call. The endpoint
 * runs the expanded prompt that distributes briefs proportionally to
 * the weights of the SELECTED personas.
 *
 * Typical use from the v2 PlanTab:
 *   const { plan, briefs } = await generateMarketingBlueprint({
 *     productInfo,
 *     personas: weightedPersonas,
 *     selectedPersonaIds: ['p1', 'p2'],   // optional — defaults to all
 *     copyAnswers,
 *     targetCount: 15,                      // default 15 per Andromeda
 *   });
 */
export async function generateMarketingBlueprint(input: {
  productInfo?: any;
  personas: any[]; // WeightedPersona[]
  selectedPersonaIds?: string[];
  copyAnswers?: any;
  targetCount?: number; // defaults server-side to 15
}): Promise<{ plan: any; briefs: any[] }> {
  const response = await fetch('/api/claude/marketing-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Blueprint error: ${err}`);
  }
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error || 'Erro ao gerar blueprint de marketing.');
  }
  return {
    plan: data.plan,
    briefs: Array.isArray(data.briefs) ? data.briefs : [],
  };
}

export async function recommendAvatarAndVoice(input: {
  persona?: any;
  copyAnswers?: any;
  copy?: string;
  productInfo?: any;
  /** UX7: quando o subprojeto foi criado a partir de um brief do Plano de
   *  Marketing, passar o brief enriquece o prompt com ângulo + emoção +
   *  estilo + painPoint específicos. Claude consegue recomendar voz/avatar
   *  alinhados ao tom do criativo, não só ao texto cru da copy. */
  brief?: {
    index?: number;
    angle?: string;
    emotion?: string;
    style?: string;
    promiseFocus?: string;
    hook?: string;
    rationale?: string;
    durationTarget?: number;
  } | null;
}): Promise<AvatarVoiceRecommendation> {
  const response = await fetch('/api/claude/recommend-avatar-voice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Recommendation error: ${err}`);
  }
  const data = await response.json();
  if (!data.success) throw new Error(data.error || 'Erro na recomendação.');
  return data.recommendation;
}

// ─────────────────────────────────────────────
// 5. REESCREVER COPY DE FORMA SEGURA (UX13)
// ─────────────────────────────────────────────
/**
 * Reescreve a copy substituindo termos detectados pelo content risk
 * scanner (medicamentos, celebridades, slurs, alegações médicas, etc)
 * por equivalentes seguros — preservando ângulo, emoção e estrutura.
 *
 * Recebe a copy original + lista de termos detectados (já com categoria
 * e razão de cada um) pra que o Claude saiba EXATAMENTE o que evitar e
 * por quê. Sem isso o modelo pode "suavizar demais" e perder o impacto.
 */
export interface SafeRewriteHit {
  matched: string;
  category: string;
  reason: string;
}

export async function rewriteSafeCopy(input: {
  text: string;
  hits: SafeRewriteHit[];
  /** Tipo do texto pro modelo entender — "hook" tem regras diferentes
   *  de "script" (hook é abertura curta, script é texto inteiro). */
  textType?: 'hook' | 'script';
}): Promise<string> {
  const { text, hits, textType = 'script' } = input;
  if (!text || hits.length === 0) return text;

  // Agrupa termos detectados num bloco legível pro prompt
  const detectedBlock = hits
    .map((h, i) => `${i + 1}. "${h.matched}" — ${h.category}: ${h.reason}`)
    .join('\n');

  const systemPrompt = `Você reescreve copy de anúncio pra remover termos que podem causar bloqueio no Meta Ads ou ação legal, MANTENDO ângulo, emoção, estrutura e impacto. Você não é um censor — você é um co-piloto que faz a copy "voar abaixo do radar" sem ficar genérica.

REGRAS DE OURO:
1. PRESERVE o tom, a dor, a promessa e a estrutura narrativa do original.
2. SUBSTITUA termos perigosos por equivalentes que mantenham o impacto:
   - Nome de medicamento → categoria genérica ("aquele remédio que o médico passa", "o tratamento tradicional", "os calmantes comuns")
   - Nome de celebridade → papel/função ("um especialista", "uma autoridade no assunto", "alguém que passou por isso")
   - Slur/discriminação → REMOVA completamente, não tem substituto seguro
   - "Cura definitiva" → "alívio duradouro", "resolve pela raiz"
   - "100% garantido" → "com garantia de satisfação"
   - "Antes e depois" → "transformação", "mudança"
   - Comparação nominal direta → indireta ("ao contrário dos métodos comuns")
3. NÃO ADICIONE conteúdo novo. Não invente frases novas. Não expanda.
4. MESMA língua do original (PT ou EN — não traduza).
5. NÃO mencione no output que algo foi removido — entrega só a copy limpa.

Responda APENAS em JSON válido sem markdown.`;

  const userPrompt = `Reescreva ${textType === 'hook' ? 'este hook' : 'esta copy'} removendo os termos perigosos detectados.

${textType === 'hook' ? 'HOOK' : 'COPY'} ORIGINAL:
"""
${text}
"""

TERMOS DETECTADOS (devem ser removidos ou substituídos):
${detectedBlock}

Sua tarefa: produza uma versão que NÃO contenha nenhum dos termos acima e seus equivalentes próximos, mas que mantenha o mesmo ângulo, dor central, e estrutura. Mantenha a mesma língua.

FORMATO (JSON apenas):
{"safeText": "${textType === 'hook' ? 'hook' : 'copy'} reescrita aqui"}`;

  const raw = await callClaude(systemPrompt, userPrompt, 2500);

  try {
    const cleaned = raw
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    if (cleaned.startsWith('{')) {
      const parsed = JSON.parse(cleaned);
      return parsed.safeText || parsed.text || text;
    }
    return cleaned || text;
  } catch {
    const match = raw.match(/"safeText"\s*:\s*"([\s\S]*?)"\s*\}/);
    if (match && match[1]) {
      return match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
    }
    return text;
  }
}

// ─────────────────────────────────────────────
// 6. SELF-CRITIQUE PASS (UX15) — Premium quality boost
// ─────────────────────────────────────────────
/**
 * Pontua a copy gerada em 6 dimensões e reescreve se algum score < 8.
 * Custo: ~1 chamada extra. Vale a pena pra cliente premium ou momentos
 * onde a copy realmente importa.
 *
 * Filosofia: NÃO reescrever só por reescrever. Só mexer no que tá fraco.
 * Mantém estrutura, beats, persona, ângulo. Output JSON com scores + se
 * precisou reescrever + texto reescrito.
 */
export interface CritiqueScores {
  specificity: number; // numeros, lugares, sensações reais?
  hookStrength: number; // abertura para o scroll?
  oralCadence: number; // soa falado, não escrito?
  emotionalPull: number; // leitor SENTE algo?
  modestCredibility: number; // sem "100% garantido", sem milagre?
  mechanismClarity: number; // mecanismo único bate?
}

export interface CritiqueResult {
  scores: CritiqueScores;
  needsRewrite: boolean;
  rewritten?: string;
  /** Comentário curto do crítico — útil pra debug, não exibido pro user */
  notes?: string;
}

export async function critiqueAndRewriteCopy(input: {
  script: string;
  answers: Record<string, any>;
  angle: string;
  /** Threshold abaixo do qual reescreve. Default 8 (de 10). */
  rewriteThreshold?: number;
}): Promise<CritiqueResult> {
  const { script, answers, angle, rewriteThreshold = 8 } = input;
  if (!script || !script.trim()) {
    return {
      scores: {
        specificity: 0,
        hookStrength: 0,
        oralCadence: 0,
        emotionalPull: 0,
        modestCredibility: 0,
        mechanismClarity: 0,
      },
      needsRewrite: false,
    };
  }

  const targetLang: 'pt' | 'en' = isPortuguese(answers.language) ? 'pt' : 'en';

  const systemPrompt = `You are a brutally honest senior copywriting editor. You score ad scripts on 6 dimensions and rewrite only the weak parts. You don't rewrite for the sake of rewriting — if a script is already 8+ on everything, you say so and leave it alone.

Rewrite rules:
- KEEP the beat structure intact (same beats, same order)
- KEEP all real product facts, persona references, and angle
- DO NOT invent new claims, characters, or deadlines not in the original
- DO NOT translate — keep the same language
- IMPROVE what's weak based on your scores

Respond ONLY in valid JSON. No markdown.`;

  const userPrompt = `Score this ad script and rewrite if any dimension scores below ${rewriteThreshold}/10.

LANGUAGE: ${answers.language || 'Português (Brasileiro)'}
ANGLE: ${angle}
AUDIENCE: ${answers.audience || ''}
CORE PAIN: ${answers.situation || answers.painPoints || ''}
MECHANISM: ${answers.uniqueMechanism || ''}

SCRIPT TO REVIEW:
"""
${script}
"""

Score 1-10:
1. SPECIFICITY — Real numbers, places, sensations? Or vague (avoid "many", "soon", "lots")?
2. HOOK STRENGTH — Does the opening sentence make the reader stop scrolling?
3. ORAL CADENCE — Does it sound spoken${targetLang === 'pt' ? ' em português brasileiro idiomático (oral, não traduzido do inglês)' : ' naturally'}?
4. EMOTIONAL PULL — Does the reader FEEL something specific (fear, hope, identification)?
5. MODEST CREDIBILITY — Avoids "100% guaranteed", "miracle", "definitive cure"?
6. MECHANISM CLARITY — Does the unique mechanism land clearly?

If ALL ≥ ${rewriteThreshold}: needsRewrite=false, no rewritten field.
If ANY < ${rewriteThreshold}: needsRewrite=true, provide rewritten preserving structure.

FORMAT:
{
  "scores": { "specificity": 8, "hookStrength": 9, "oralCadence": 7, "emotionalPull": 8, "modestCredibility": 9, "mechanismClarity": 8 },
  "needsRewrite": true,
  "rewritten": "full script rewritten, with beat labels",
  "notes": "1-line summary of what changed"
}`;

  const raw = await callClaude(systemPrompt, userPrompt, 3000);
  try {
    const cleaned = raw
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    return {
      scores: parsed.scores || {
        specificity: 0,
        hookStrength: 0,
        oralCadence: 0,
        emotionalPull: 0,
        modestCredibility: 0,
        mechanismClarity: 0,
      },
      needsRewrite: !!parsed.needsRewrite,
      rewritten: parsed.rewritten,
      notes: parsed.notes,
    };
  } catch {
    // Falha no parse — devolve neutro pra caller decidir (provavelmente
    // mantém o script original sem warning).
    return {
      scores: {
        specificity: 0,
        hookStrength: 0,
        oralCadence: 0,
        emotionalPull: 0,
        modestCredibility: 0,
        mechanismClarity: 0,
      },
      needsRewrite: false,
    };
  }
}

// ─────────────────────────────────────────────
// 7. VARIANTS A/B (UX15) — gerar N copies em paralelo
// ─────────────────────────────────────────────
/**
 * Gera N copies em paralelo (mesma input, modelo varia naturalmente).
 * Útil pra cliente comparar e escolher. Custo = N × custo de gerar 1.
 *
 * Não usa streaming porque a UI vai mostrar todos no fim (não dá pra
 * stream múltiplos no mesmo lugar). Tempo total ≈ tempo de 1 (paralelo).
 */
export async function generateAdCopyVariants(
  answers: Record<string, any>,
  mode: 'improve' | 'as-is' | 'questions',
  angle: string,
  count: number = 2,
  targetWordCount?: number
): Promise<{ script: string }[]> {
  const safeCount = Math.max(1, Math.min(4, count)); // max 4 pra não estourar custo
  const runs = Array.from({ length: safeCount }, () =>
    generateAdCopyWithClaude(answers, mode, angle, undefined, targetWordCount)
  );
  const results = await Promise.all(runs);
  return results.map((r) => ({ script: r.script }));
}

// ─────────────────────────────────────────────
// 8. REGERAR 1 BEAT (UX16) — não a copy inteira
// ─────────────────────────────────────────────
/**
 * Regenera APENAS um beat específico, mantendo encaixe com os adjacentes.
 * Útil quando user gosta da copy em geral mas quer melhorar uma seção
 * específica — em vez de re-rodar o script inteiro e perder o resto.
 */
export async function regenerateBeat(input: {
  beatLabel: string;
  beatCurrentText: string;
  fullScript: string;
  answers: Record<string, any>;
  angle: string;
}): Promise<string> {
  const { beatLabel, beatCurrentText, fullScript, answers, angle } = input;
  if (!beatLabel || !fullScript) return beatCurrentText;

  const targetLang: 'pt' | 'en' = isPortuguese(answers.language) ? 'pt' : 'en';
  const culturalNote =
    targetLang === 'pt'
      ? '\n\nIDIOMA: Português brasileiro idiomático. Frases curtas e orais. Evite "está prestes a", "no mundo de hoje", "uma jornada". Use "olha só", "presta atenção", "do nada".'
      : '';

  const systemPrompt = `You rewrite ONE beat of a direct-response ad script while keeping seamless flow with the surrounding beats. You don't rewrite the whole script — only the requested beat. You preserve all real product facts and the script's overall angle.${culturalNote}

Respond ONLY in JSON. No markdown.`;

  const userPrompt = `Rewrite ONLY the [${beatLabel}] beat below. Keep the same role this beat plays in the script structure, but produce a different angle, sensory detail, or rhythm. Make sure it flows into the next beat naturally.

FULL SCRIPT (for context — do NOT rewrite the whole thing):
"""
${fullScript}
"""

BEAT TO REWRITE — current text:
"""
${beatCurrentText}
"""

CONTEXT:
- Language: ${answers.language || 'Português (Brasileiro)'}
- Angle: ${angle}
- Audience: ${answers.audience || ''}
- Core pain: ${answers.situation || answers.painPoints || ''}
- Product: ${answers.productName || ''}
- Mechanism: ${answers.uniqueMechanism || ''}

REQUIREMENTS:
- Same approximate length (±20% of current beat word count)
- Same role/function this beat plays
- Must connect naturally with the beat that comes before and after
- Do NOT include the [${beatLabel}] label in your output — just the body text
- Do NOT invent new product claims or persona details not in the source

FORMAT:
{"newText": "rewritten beat text without the [LABEL]"}`;

  const raw = await callClaude(systemPrompt, userPrompt, 1200);
  try {
    const cleaned = raw
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    if (cleaned.startsWith('{')) {
      const parsed = JSON.parse(cleaned);
      return (parsed.newText || parsed.text || beatCurrentText).trim();
    }
    return cleaned || beatCurrentText;
  } catch {
    return beatCurrentText;
  }
}

// ─────────────────────────────────────────────
// 8b. UTILITÁRIOS PRA PARSE DE BEATS (UX16)
// ─────────────────────────────────────────────
export interface ScriptBeat {
  label: string;
  text: string;
  index: number;
}

/** Parsea script com markers `[LABEL]` em beats. Retorna [] se não tiver. */
export function parseScriptBeats(script: string): ScriptBeat[] {
  if (!script || !script.trim()) return [];
  const regex = /\[([^\]]+)\]\s*([\s\S]*?)(?=\n*\[|\s*$)/g;
  const beats: ScriptBeat[] = [];
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = regex.exec(script)) !== null) {
    const rawLabel = (m[1] || '').trim();
    const text = (m[2] || '').trim();
    if (!text || !rawLabel) continue;
    const cleanLabel = rawLabel.replace(/^BEAT\s*\d+\s*:?\s*/i, '').trim();
    beats.push({ label: cleanLabel, text, index: idx++ });
  }
  return beats;
}

/** Re-monta o script. Mantém formato `[LABEL]\n<text>\n\n`. */
export function assembleScriptFromBeats(beats: ScriptBeat[]): string {
  return beats.map((b) => `[${b.label}]\n${b.text}`).join('\n\n');
}

// ─────────────────────────────────────────────
// 9. HOOK LAB (UX17) — 9 hooks 100% originais
// ─────────────────────────────────────────────
/**
 * Gera 9 hooks DO ZERO sem usar a hooks bible. Em vez de templates com
 * placeholders preenchidos (UX10), aqui Claude inventa hooks completos
 * usando 5 fórmulas comprovadas + contexto do projeto.
 *
 * Útil quando user quer hooks mais originais/personalizados. Bible
 * continua disponível como alternativa.
 */
export interface OriginalHookGroup {
  formula: string; // ex: "Curiosity Gap", "Paradigm Shift"
  hooks: string[]; // 1-2 hooks por fórmula, total ≈ 9
}

export async function generateOriginalHooks(input: {
  productInfo?: {
    produto?: string;
    oferta?: string;
    dorPrincipal?: string;
    [k: string]: any;
  } | null;
  persona?: {
    name?: string;
    age?: string;
    mainPain?: string;
    dominantFear?: string;
    hiddenDesire?: string;
    mainObjection?: string;
    currentSituation?: string;
    [k: string]: any;
  } | null;
  brief?: {
    angle?: string;
    emotion?: string;
    style?: string;
    promiseFocus?: string;
    [k: string]: any;
  } | null;
  approvedCopy?: string;
  language?: string;
  awarenessLevel?: string;
}): Promise<OriginalHookGroup[]> {
  const { productInfo, persona, brief, approvedCopy, language, awarenessLevel } = input;
  const targetLang: 'pt' | 'en' = isPortuguese(language) ? 'pt' : 'en';

  const culturalNote =
    targetLang === 'pt'
      ? '\n\nIDIOMA: Português brasileiro idiomático. Frases curtas e orais. Evite traduções literais do inglês. Use construções como "presta atenção", "olha só", "do nada".'
      : '';

  const systemPrompt = `Você é um copywriter sênior especialista em hooks de Meta Ads. Você cria hooks 100% ORIGINAIS — não usa templates, não preenche lacunas. Cada hook é uma abertura única projetada pra parar o scroll.

Você domina 5 fórmulas:
1. CURIOSITY GAP — abrir um loop que o leitor PRECISA fechar. "X em cada Y pessoas têm Z mas só algumas percebem"
2. PARADIGM SHIFT — contradizer uma crença popular. "Não é X. É Y." / "X não causa Z"
3. TRANSFORMATION STORY — depoimento em 1ª pessoa, super específico. "Eu fazia X. Agora faço Y."
4. PROBLEM-SPECIFIC — nomear sensação exata que só QUEM tem o problema conhece. "Aquela [sensação específica em momento específico] não é X"
5. MASS DESIRE NAME — chamar o leitor pelo desejo escondido. "Se você quer X, presta atenção"${culturalNote}

Responda APENAS em JSON válido sem markdown.`;

  const contextBlock = [
    productInfo?.produto ? `Produto: ${productInfo.produto}` : null,
    productInfo?.oferta ? `Oferta: ${productInfo.oferta}` : null,
    productInfo?.dorPrincipal ? `Dor central: ${productInfo.dorPrincipal}` : null,
    persona?.name ? `Persona: ${persona.name}` : null,
    persona?.age ? `Idade persona: ${persona.age}` : null,
    persona?.currentSituation ? `Situação atual: ${persona.currentSituation}` : null,
    persona?.mainPain ? `Dor da persona: ${persona.mainPain}` : null,
    persona?.dominantFear ? `Medo dominante: ${persona.dominantFear}` : null,
    persona?.hiddenDesire ? `Desejo oculto: ${persona.hiddenDesire}` : null,
    persona?.mainObjection ? `Objeção principal: ${persona.mainObjection}` : null,
    brief?.angle ? `Ângulo do criativo: ${brief.angle}` : null,
    brief?.emotion ? `Emoção primária: ${brief.emotion}` : null,
    brief?.style ? `Estilo: ${brief.style}` : null,
    brief?.promiseFocus ? `Promessa central: ${brief.promiseFocus}` : null,
    awarenessLevel ? `Nível de consciência: ${awarenessLevel}/5` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const copyBlock = approvedCopy
    ? `\nCOPY APROVADA (use como ancoragem do tom, mas hooks NÃO devem repetir frases dela):\n"""\n${approvedCopy}\n"""\n`
    : '';

  const userPrompt = `Crie 9 hooks 100% originais pra abrir este criativo. NÃO use templates. NÃO use lacunas (___, [X]). Cada hook deve ser uma frase pronta pra falar em voz alta.

CONTEXTO:
${contextBlock}
${copyBlock}
REGRAS:
1. Distribua os 9 hooks em GRUPOS de fórmula: 2 hooks por fórmula. Total: 9-10 hooks em 5 grupos.
2. Cada hook é específico — use detalhes concretos do produto/persona, não genéricos
3. Tamanho: 5-25 palavras por hook
4. Mesma língua do contexto (NÃO traduza)
5. SEM aspas envolvendo o hook inteiro
6. SEM placeholders restantes — cada hook é falável imediatamente
7. Estilo direto-resposta — sem "no mundo de hoje", sem "uma jornada", sem "está prestes a"
8. Preferir abertura sensorial/momento específico ("3 da manhã", "no espelho de manhã") quando fizer sentido

FORMATO (JSON apenas):
{
  "grupos": [
    {
      "formula": "Curiosity Gap",
      "hooks": ["hook 1 do tipo", "hook 2 do tipo"]
    },
    {
      "formula": "Paradigm Shift",
      "hooks": ["hook 1", "hook 2"]
    },
    {
      "formula": "Transformation Story",
      "hooks": ["hook 1", "hook 2"]
    },
    {
      "formula": "Problem-Specific",
      "hooks": ["hook 1", "hook 2"]
    },
    {
      "formula": "Mass Desire",
      "hooks": ["hook 1", "hook 2"]
    }
  ]
}`;

  const raw = await callClaude(systemPrompt, userPrompt, 2000);
  try {
    const cleaned = raw
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    const grupos = Array.isArray(parsed.grupos) ? parsed.grupos : [];
    return grupos
      .filter((g: any) => g && typeof g.formula === 'string' && Array.isArray(g.hooks))
      .map((g: any) => ({
        formula: g.formula,
        hooks: g.hooks
          .filter((h: any) => typeof h === 'string' && h.trim().length > 0)
          .map((h: string) =>
            // Remove aspas externas e placeholders restantes (defesa)
            h
              .trim()
              .replace(/^["']|["']$/g, '')
              .trim()
          )
          .filter((h: string) => !/(_{2,}|\[[a-zA-Zçãâáéíóôúû_ ]{2,}\])/.test(h)),
      }))
      .filter((g: any) => g.hooks.length > 0);
  } catch (err: any) {
    console.error('[generateOriginalHooks]', err?.message);
    return [];
  }
}

// ─────────────────────────────────────────────
// 10. ANALYZE COPY FOR LIBRARY (UX20)
// ─────────────────────────────────────────────
/**
 * Analisa uma copy de referência colada pelo user e infere os metadados:
 * vertical, awareness, language, angle, whyItWorks. Usado pra que o
 * upload manual da biblioteca não exija preencher esses campos
 * manualmente — só cola o texto, IA descobre o resto.
 *
 * Cliente pode editar manualmente depois se quiser, mas o auto-fill
 * cobre 90% dos casos.
 */
export interface CopyAnalysisResult {
  vertical:
    | 'saude'
    | 'emagrecimento'
    | 'financas'
    | 'info_produto'
    | 'beleza'
    | 'fisico'
    | 'espiritual';
  awareness: '1' | '2' | '3' | '4' | '5';
  language: 'pt' | 'en';
  angle: string;
  whyItWorks: string;
}

export async function analyzeCopyForLibrary(script: string): Promise<CopyAnalysisResult> {
  if (!script || !script.trim()) {
    return {
      vertical: 'fisico',
      awareness: '3',
      language: 'pt',
      angle: '',
      whyItWorks: '',
    };
  }

  const systemPrompt = `Você é um copywriter sênior. Recebe uma copy de anúncio e classifica em 5 dimensões. Responda APENAS em JSON válido sem markdown.`;

  const userPrompt = `Analise esta copy e classifique-a:

COPY:
"""
${script.trim().substring(0, 3000)}
"""

CLASSIFIQUE:

1. vertical (em qual mercado vende):
   - "saude" — suplementos, dor, sono, ansiedade, nutrição
   - "emagrecimento" — perda de peso, dieta, fitness
   - "financas" — renda extra, investimento, side hustle
   - "info_produto" — curso, mentoria, comunidade, treinamento
   - "beleza" — skincare, anti-aging, cabelo, cosmético
   - "fisico" — gadget, ferramenta, casa, lifestyle
   - "espiritual" — tarot, mapa astral, oração, autoconhecimento

2. awareness (Schwartz, qual nível de consciência do leitor):
   - "1" = inconsciente (não sabe do problema)
   - "2" = consciente do problema
   - "3" = consciente da solução (sabe que existe solução mas não conhece o produto)
   - "4" = consciente do produto (conhece o produto mas hesita)
   - "5" = muito consciente (só falta a oferta)

3. language: "pt" (português) ou "en" (inglês). Pra português brasileiro use "pt".

4. angle: 2-5 palavras descrevendo o ângulo principal. Ex: "Quebra de paradigma", "Mecanismo único", "Depoimento transformação", "Diagnóstico único", "Identificação com a dor", "Comparação com alternativa", "Curiosidade", "Autoridade médica".

5. whyItWorks: 1 frase explicando por que essa copy funciona. Pode mencionar técnicas tipo: abertura sensorial, prova social específica, comparação financeira, reframe, etc.

FORMATO (JSON apenas):
{
  "vertical": "saude",
  "awareness": "2",
  "language": "pt",
  "angle": "Diagnóstico único",
  "whyItWorks": "Abertura sensorial em momento específico, reframe diagnóstico, mecanismo crível, prova social com número, CTA suave."
}`;

  try {
    const raw = await callClaude(systemPrompt, userPrompt, 800);
    const cleaned = raw
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    // Sanity-check + defaults
    const validVerticals = [
      'saude',
      'emagrecimento',
      'financas',
      'info_produto',
      'beleza',
      'fisico',
      'espiritual',
    ];
    const validAwareness = ['1', '2', '3', '4', '5'];
    return {
      vertical: validVerticals.includes(parsed.vertical)
        ? parsed.vertical
        : ('fisico' as CopyAnalysisResult['vertical']),
      awareness: validAwareness.includes(String(parsed.awareness))
        ? (String(parsed.awareness) as CopyAnalysisResult['awareness'])
        : '3',
      language: parsed.language === 'en' ? 'en' : 'pt',
      angle: typeof parsed.angle === 'string' ? parsed.angle.trim().slice(0, 60) : '',
      whyItWorks:
        typeof parsed.whyItWorks === 'string' ? parsed.whyItWorks.trim().slice(0, 300) : '',
    };
  } catch (err: any) {
    console.warn('[analyzeCopyForLibrary] falhou, usando defaults:', err?.message);
    return {
      vertical: 'fisico',
      awareness: '3',
      language: /\bthe\b|\band\b|\byou\b|\bis\b/i.test(script) ? 'en' : 'pt',
      angle: '',
      whyItWorks: '',
    };
  }
}
