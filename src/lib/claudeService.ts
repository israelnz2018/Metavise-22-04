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

const CLAUDE_URL = '/api/claude/complete';

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
// 1. GERAR COPY com beats Schwartz
// ─────────────────────────────────────────────
export const generateAdCopyWithClaude = async (
  answers: Record<string, any>,
  mode: 'improve' | 'as-is' | 'questions',
  angle: string,
  _scriptLength?: 'short' | 'medium' | 'long',
  targetWordCount?: number,
  _hookSelecionado?: string
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

  const systemPrompt = `You are a senior direct-response copywriter specializing in Meta Ads, trained in Eugene Schwartz's five stages of awareness (Breakthrough Advertising). Your job is to write punchy, specific, honest video scripts for paid ads.

OUTPUT LANGUAGE:
Write the entire script in: ${answers.language || 'Português (Brasileiro)'}
Every word must be in this language. If any input data is in a different language, translate it naturally before using it.

Respond ONLY with valid JSON. No markdown, no preamble.`;

  const userPrompt = `Write a Meta Ads video script. Follow every instruction precisely.

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

  const raw = await callClaude(systemPrompt, userPrompt, Math.max(1500, wordCount * 8));

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
export const chooseHooksFromCopy = async (
  approvedCopy: string,
  awarenessLevel: string,
  candidateHooks: any[]
): Promise<{ grupos: any[] } | null> => {
  if (!candidateHooks || candidateHooks.length === 0) return null;
  if (!approvedCopy) return null;

  const systemPrompt = `Você é um especialista em copywriting para Meta Ads. Selecione hooks que combinem com a copy aprovada e o nível de consciência. Responda APENAS em JSON válido sem markdown.`;

  const userPrompt = `Selecione os 9 melhores hooks para esta copy.

COPY APROVADA:
"""
${approvedCopy}
"""

NÍVEL DE CONSCIÊNCIA: ${awarenessLevel || '3'}

CANDIDATOS (${candidateHooks.length}):
${candidateHooks.map((h: any) => `ID ${h.id} [${h.tipo}]: ${h.template}`).join('\n')}

REGRAS:
1. Selecione EXATAMENTE 3 hooks por tipo (9 total, 3 grupos)
2. Os tipos vêm dos candidatos
3. Escolha os mais alinhados com o tom, ângulo e mensagem da copy
4. Marque 1 ⭐ recomendado por grupo (o melhor)
5. Não repita IDs

FORMATO (JSON apenas):
{
  "grupos": [
    {
      "tipo": "nome do tipo",
      "hooks": [
        {"id": 123, "recomendado": false},
        {"id": 456, "recomendado": true},
        {"id": 789, "recomendado": false}
      ]
    }
  ]
}`;

  try {
    const raw = await callClaude(systemPrompt, userPrompt, 1000);
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

  const systemPrompt = `Você é especialista em otimizar scripts para síntese de voz com ElevenLabs v3. Responda APENAS em JSON válido sem markdown.`;

  const userPrompt = `Transforme o roteiro abaixo para ElevenLabs.
 
ROTEIRO ORIGINAL:
${script}
 
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
7. Aplique ÊNFASE usando letras MAIÚSCULAS para as palavras-chave principais.
8. NÃO reescreva ou resuma o roteiro em si. A mensagem narrativa deve prevalecer fiel ao original.
 
FORMATO (JSON apenas):
{"optimizedScript": "script otimizado"}`;

  const raw = await callClaude(systemPrompt, userPrompt, 2000);

  try {
    const cleaned = raw
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    // If it looks like JSON, parse it
    if (cleaned.startsWith('{')) {
      const parsed = JSON.parse(cleaned);
      return parsed.optimizedScript || parsed.script || cleaned;
    }

    // If Claude returned plain text directly, use as-is
    return cleaned;
  } catch {
    // Last resort: strip the JSON wrapper manually
    const match = raw.match(/"optimizedScript"\s*:\s*"([\s\S]*)"/);
    if (match && match[1]) {
      return match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
    }
    return raw;
  }
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
      "recommendedCTA": "CTA específico"
    },
    { "rank": "secundaria", ... mesmos campos },
    { "rank": "terciaria", ... mesmos campos }
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

export async function recommendAvatarAndVoice(input: {
  persona?: any;
  copyAnswers?: any;
  copy?: string;
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
