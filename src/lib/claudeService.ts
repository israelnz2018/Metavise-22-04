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

import {
  selectCopyExamples,
  inferVertical,
  type CopyExample,
  type AwarenessLevel,
} from '@/data/copyLibrary';
import type { CreativeBrief } from '@/types/project';

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
  /** UX25-A4: opts.model permite forçar Sonnet ("claude-sonnet-4-6")
   *  pra modo rascunho (mais rápido, mais barato). Server default é Opus. */
  opts: { maxTokens?: number; model?: string; thinking?: boolean } = {}
): Promise<string> {
  const response = await fetch(CLAUDE_STREAM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system: systemPrompt,
      user: userPrompt,
      max_tokens: opts.maxTokens ?? 2000,
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.thinking === false ? { thinking: false } : {}),
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
  maxTokens = 2000,
  opts: { model?: string; thinking?: boolean } = {}
): Promise<string> {
  const response = await fetch(CLAUDE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system: systemPrompt,
      user: userPrompt,
      max_tokens: maxTokens,
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.thinking === false ? { thinking: false } : {}),
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
/**
 * UX25-C1: callback opcional pra capturar o prompt EXATO enviado pro
 * Claude + a resposta crua, pra alimentar o "Ver prompt" debug modal.
 * Disparado uma vez por geração, ANTES da chamada (pra ter o prompt
 * mesmo quando a chamada falha).
 */
export interface CopyDebugInfo {
  systemPrompt: string;
  userPrompt: string;
  model: 'opus' | 'sonnet';
  estimatedInputTokens: number;
  timestamp: number;
}

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
  onToken?: (textDelta: string) => void,
  /** UX25-C1: chamado uma vez com o prompt construído ANTES da request. */
  onDebug?: (debug: CopyDebugInfo) => void
): Promise<{ hooks: any[]; script: string }> => {
  if (mode === 'as-is') {
    return {
      hooks: [],
      script: answers.existingCopy || '',
    };
  }

  const currentLevel = (answers.awarenessLevel || '3').toString().charAt(0) || '3';
  const wordCount = targetWordCount || 150;
  const targetLang: 'pt' | 'en' = isPortuguese(answers.language) ? 'pt' : 'en';
  // Tipo de criativo: anúncio curto (Meta) ou VSL longa em blocos.
  const creativeType: 'ad' | 'vsl' = answers.__creativeType === 'vsl' ? 'vsl' : 'ad';

  // FEW-SHOT: 1 exemplo vencedor como ÂNCORA DE CRAFT (mostrar > mandar — é o
  // que mais levanta a qualidade). Estuda COMO é escrito, nunca o conteúdo.
  const clientLib = (answers.__clientCopyLibrary as CopyExample[]) || [];
  const targetVertical = inferVertical({
    produto: answers.productName,
    oferta: answers.productResult,
    dorPrincipal: answers.painPoints || answers.situation,
    audience: answers.audience,
  });
  const examplePool = selectCopyExamples({
    language: targetLang,
    awareness: currentLevel as AwarenessLevel,
    angleHint: angle,
    count: 5,
    clientLibrary: clientLib,
  });
  // PRIORIDADE: as copies DO USUÁRIO (clientLib) sempre vêm antes das do Metavise
  // — ele confia mais nas dele. Dentro de cada grupo, prefere OUTRO nicho (craft
  // sem overlap de conteúdo). Só usa as do Metavise se ele não tiver nenhuma.
  const pickCraft = (arr: CopyExample[]) =>
    arr.find((e) => !targetVertical || e.vertical !== targetVertical) || arr[0];
  const myCopies = clientLib.filter((e) => e.language === targetLang);
  const example = myCopies.length ? pickCraft(myCopies) : pickCraft(examplePool);

  // POV adapta ao narrador: com narrador = história em 1ª pessoa; SEM narrador =
  // falar direto com "você", sem inventar um protagonista ("eu vivi isso").
  const hasNarrator = !!(answers.narrator || '').toString().trim();
  const povRule = hasNarrator
    ? 'Use the GIVEN narrator as the voice, and match the STANCE their description implies — it may be first person ("I/my", someone who lived it), OR someone recounting OTHER people\'s stories / an observer who saw many cases. Do NOT force first person if the narrator is not a personal sufferer. Turn to "you/your" for the warning and the CTA, and hold that ONE voice throughout.'
    : 'No narrator was given, so do NOT invent a personal first-person protagonist or backstory ("I lived this", "one afternoon I..."). Write DIRECTLY to the reader in second person ("you/your"), as a confident, knowledgeable voice — make the claims and the reveal stand on their own, not on a fabricated personal story.';
  const exampleBlock = example
    ? `
--- EXAMPLE — MIRROR THIS VOICE ---
Match this ad's VOICE closely: its cadence, sentence rhythm, opening style, word choice, tone and energy — write as if the SAME person wrote both. Match its craft too (lived scenes, exact sensory detail, the flow, the hinge from despair to hope). Do NOT reuse its claims, numbers, names, product or specifics — mirror the VOICE, swap the CONTENT.
"""
${example.script}
"""
`
    : '';

  // ── FRAMEWORK DE BLOCOS POR NÍVEL DE CONSCIÊNCIA (guia-da-copy / Higor Neves) ──
  // A consciência É a espinha: ela seleciona QUAIS blocos entram e em que ordem.
  // NÃO há mais override de estrutura por tipo de tráfego — o estilo advertorial
  // denso é VOZ (junto dos blocos, na seção STORY BEATS + VOICE), não uma
  // estrutura paralela. Direção de
  // emoção e modelagem de copy de referência foram CORTADAS de propósito (§6 do
  // guia): geração = framework + questionário + firewall, e só. O humanizador
  // saiu da geração (era 2ª passada).
  // (2) Instruções CURTAS por bloco — o contexto (dor, desejo, mecanismo,
  // estatística…) já está na seção CONTEXT; aqui é só o JOB do bloco.
  const BLOCKS: Record<number, { tag: string; instr: string }> = {
    1: { tag: 'QUEBRA DE PADRÃO', instr: 'Scroll-stopping opener built on the REAL DRIVER of this offer (see below). First sentence. "This is me."' },
    2: { tag: 'PROMESSA', instr: 'Promise the big result — a new, better way.' },
    3: { tag: 'HISTÓRIA', instr: 'Quick story of where the mechanism came from.' },
    4: { tag: 'MECANISMO ÚNICO', instr: 'The unique mechanism (high level) and why it beats the usual. Never reveal its identity.' },
    5: { tag: 'PROVA', instr: 'Proof it makes sense. Never invent numbers or testimonials.' },
    6: { tag: 'QUALIFICAÇÃO', instr: 'Who it is / is not for.' },
    7: { tag: 'QUEM SOU EU', instr: 'Who the narrator is (authority or "just like you").' },
    8: { tag: 'POR QUE CONTO ISSO', instr: 'Why the narrator is sharing this.' },
    9: { tag: 'SOLUÇÕES QUE FALHAM', instr: 'The usual methods they tried and why they failed. Not their fault.' },
    10: { tag: 'O DIA DO CHEGA', instr: 'The breaking-point moment, one concrete scene.' },
    11: { tag: 'A BUSCA', instr: 'The journey to finding the mechanism.' },
    12: { tag: 'POR QUE FUNCIONA', instr: 'Why it finally works — conceptual, never the identity.' },
    13: { tag: 'PONTE PRO CLIQUE', instr: "On their own it won't resolve — only the destination shows how." },
  };

  const CTA: Record<'soft' | 'mid' | 'hard', string> = {
    soft: 'Soft invitation: watch / learn more. Low pressure. No price, no offer.',
    mid: 'Clear invitation to take the next step (watch it / see how it works). No price/offer.',
    hard: 'Strong, direct call to act NOW. You may qualify the right reader ("if you are over 55 and..."). No price/payment — the checkout lives at the destination.',
  };

  // Mapa nível → blocos (em ordem) + força do CTA + urgência (§4 do guia).
  const LEVEL_PLAN: Record<
    string,
    { blocks: number[]; cta: 'soft' | 'mid' | 'hard'; urgency: boolean; note: string }
  > = {
    '1': {
      blocks: [1, 2, 3, 4, 5, 7, 9, 10, 11, 12, 13],
      cta: 'soft',
      urgency: false,
      note: 'Cold / unaware: build everything from scratch — story + origin + mechanism. Soft CTA, no urgency.',
    },
    '2': {
      blocks: [1, 2, 8, 9, 10, 4, 12, 5, 13],
      cta: 'soft',
      urgency: false,
      note: 'Problem-aware: skip the long origin; go pain → real cause. Soft CTA.',
    },
    '3': {
      blocks: [1, 9, 4, 12, 5, 2, 13],
      cta: 'mid',
      urgency: false,
      note: 'Solution-aware: center on the mechanism + why the common ways fail + proof; little pain. Medium CTA.',
    },
    '4': {
      blocks: [2, 5, 4, 6],
      cta: 'hard',
      urgency: true,
      note: 'Product-aware: SHORT — promise + strong proof + why THIS one. Hard CTA + urgency.',
    },
    '5': {
      blocks: [2, 6],
      cta: 'hard',
      urgency: true,
      note: 'Most aware: VERY short — just the nudge. Keep PROMESSA to a single line. Hard direct CTA + scarcity.',
    },
  };

  const plan = LEVEL_PLAN[currentLevel] || LEVEL_PLAN['3']!;
  // (1) Blocos adaptam à DURAÇÃO: ~40 palavras por bloco no mínimo. Se a copy é
  // curta, corta os blocos menos essenciais (por prioridade) e mantém a ordem
  // narrativa — copy curta = poucos blocos DESENVOLVIDOS, não 11 fragmentos.
  const BLOCK_PRIORITY = [1, 4, 9, 5, 2, 12, 13, 10, 6, 7, 11, 3, 8];
  const maxBlocks = Math.max(3, Math.min(plan.blocks.length, Math.round(wordCount / 40)));
  const keep = new Set(
    BLOCK_PRIORITY.filter((id) => plan.blocks.includes(id)).slice(0, maxBlocks)
  );
  const chosenBlocks = plan.blocks.filter((id) => keep.has(id));
  // Arco LEVE (1 linha) — o EXEMPLO carrega a textura; o arco só dá a forma
  // certa pro nível de consciência. Não é checklist rígido.
  const arcTags = [
    ...chosenBlocks.map((id) => BLOCKS[id]!.tag),
    ...(plan.urgency ? ['URGÊNCIA'] : []),
    'CTA',
  ].join(' → ');

  const ctaByDestination: Record<string, string> = {
    Vídeo: 'watch the video / see how it works',
    'Landing Page de Vendas': 'secure your spot / start today',
    'Lead Form': 'sign up for free / register now',
    WhatsApp: 'message us on WhatsApp',
    'Página de Captura': 'get the material / download now',
  };

  const culturalBlock =
    targetLang === 'pt'
      ? `\nEscreva em português do Brasil NATURAL e falado, nunca traduzido-do-inglês ("você está prestes a descobrir", "no mundo de hoje", "uma jornada"). Frases curtas, ritmo de fala, "você".`
      : '';

  let systemPrompt = `You are a senior direct-response copywriter specializing in Meta Ads, trained in Eugene Schwartz's five stages of awareness (Breakthrough Advertising). You write in the style of Gary Halbert, Stefan Georgi (RMBC), and Dan Kennedy — direct, specific, honest, oral cadence.

OUTPUT LANGUAGE:
Write the entire script in: ${answers.language || 'Português (Brasileiro)'}
Every word must be in this language. If any input data is in a different language, translate it naturally before using it.${culturalBlock}

Respond ONLY with valid JSON. No markdown, no preamble.`;

  // CONTEXT enxuto: só os campos PREENCHIDOS, rótulo + valor, sem coaching.
  const ctxLines = [
    `Language: ${answers.language || 'Português (Brasileiro)'}`,
    `Awareness level: ${currentLevel}/5 — ${plan.note}`,
    answers.audience && `Audience: ${answers.audience}`,
    (answers.situation || answers.painPoints) &&
      `Pain/situation: ${answers.situation || answers.painPoints}`,
    answers.mainObjection && `Main objection: ${answers.mainObjection}`,
    answers.hiddenDesire && `Hidden desire: ${answers.hiddenDesire}`,
    (answers.emotionalDriver || '').toString().trim() &&
      `Real emotional driver (read from the VSL — what truly moves this buyer): ${answers.emotionalDriver}`,
    answers.productName && `Product: ${answers.productName}`,
    answers.productResult && `Promised result: ${answers.productResult}`,
    answers.uniqueMechanism && `Unique mechanism: ${answers.uniqueMechanism}`,
    (answers.narrator || '').toString().trim() &&
      `Narrator (the voice): ${(answers.narrator || '').toString().trim()}`,
  ]
    .filter(Boolean)
    .join('\n');

  // O PAPEL DO ANÚNCIO depende da estratégia (campo 9). Curiosidade (padrão) =
  // isca de clique, NÃO vendedor; quem vende e desenvolve o medo é a VSL.
  const isDirectSale = (answers.copyStrategy || '') === 'direct-sale';
  const adJob = isDirectSale
    ? `--- THE AD'S JOB ---
This ad goes straight to a sales page — it MAY present the product, the mechanism, the proof and the offer, and make the sale here.`
    : `--- THE AD'S JOB (read this FIRST — it overrides everything else) ---
This ad's ONLY job is to earn the CLICK into the video. The VIDEO sells and develops the deeper argument and fear (e.g. dependence on the system, what's coming) — the AD does NOT. So:
- Do NOT explain how it works, the science/proof, or how to build/get it. Do NOT "make the case" or sell. Doing any of that here removes the reason to click.
- Open a CURIOSITY GAP + a tension the reader needs resolved, then send them to the video for the answer. HINT the deeper fear; don't argue it.
- You may name the curiosity hook as the thing to DISCOVER, but build a little intrigue first — do NOT dump it in the very first sentence.
- Keep it TIGHT and intriguing — a teaser, not a mini-VSL. End on the click.`;

  let userPrompt = `Write a short, intriguing Meta Ads video script. Follow every instruction precisely.
${adJob}
${exampleBlock}
--- CONTEXT ---
${ctxLines}
${
  (answers.innovativeProductName || '').toString().trim().length > 0
    ? `Named curiosity hook — the "innovative discovery" the video is about. Refer to it by THIS exact name to spark intrigue (the way "the yellow vitamin" or "the banana trick" does), but NEVER explain what it actually is or how it works — that payoff lives only in the video. The NAME is a teaser, not a spoiler: naming it is encouraged, explaining it is forbidden.\nName: "${(answers.innovativeProductName || '').toString().trim()}"`
    : ''
}${
  (answers.statistics || '').toString().trim().length > 0
    ? `\nGROUNDED STATISTICS — facts the user supplied. These (together with any numbers already in the product source above) are the ONLY statistical or numeric claims you may state as fact. Weave them in where they strengthen the cause, the escalation, or the proof. Keep each number EXACT as given (do NOT round "48,217" to "nearly 50,000"). If an attribution/source is included with a number, attribute it that way; if none is given, state it plainly — never invent an institution to make it sound credible. Do NOT invent, extrapolate, or "improve" any statistic beyond what is here or in the source:\n"""\n${(answers.statistics || '').toString().trim()}\n"""`
    : ''
}

--- DRIVER (the real emotional engine of THIS offer) ---
Agitate the "Real emotional driver" from the context above (read from the VSL) — that is what TRULY moves this buyer. If it wasn't given, infer it from the context. Different offers run on different drivers (a present pain, a deep desire, a fear of what could happen, the wish for autonomy/control/status/belonging, etc.); use the one THIS offer really leans on, don't assume a past personal hardship unless the source shows that.

--- ANGLE ---
Angle: ${angle || 'Direto'} — the through-line of the whole ad.

--- ARC (loose guide — the EXAMPLE above shows the texture to hit) ---
Write ONE continuous, flowing advertorial — not an outline, no labels/brackets/beat-names. Rough flow for this level (a guide, not a checklist): ${arcTags}.
VOICE: vivid and concrete; the first line IS the claim (no secondhand "podcast/overheard" device); never invent statistics. POV: ${povRule} CTA for this level: ${CTA[plan.cta]}

--- LENGTH ---
Aim for about ${wordCount} words. Prioritize a strong, complete, vivid ad over hitting the number exactly; do not pad.

--- OUTPUT ---
Respond with ONLY this JSON:
{ "script": "the full ad copy as ONE flowing text — NO labels, NO brackets, NO beat names" }

--- FIREWALL (inviolable) ---
- No price, installments, payment, guarantee, refund, or checkout — those live at the destination (levels 4-5 may use a strong CTA + real urgency only, never price).
- Never reveal the EXACT identity of the solution, the brand/product name, or the protocol/dose — that payoff is the destination's.
- The CONTEXT/inputs may CONTAIN the payoff — the price, the exact mechanism, or specs (e.g. "60 gallons a day", "$200 in parts", how to build/get it). Do NOT repeat these in the ad: only TEASE that they exist ("for the price of a nice dinner", "with parts most people already have") and send the reader to the destination for the reveal. Stating the price/specs/how-to outright kills the curiosity and the click. (Only an explicit direct-sale ad may state price.)
- Invent NOTHING: no fake statistics, testimonials, named people, characters, or deadlines. Any number must come from the input / GROUNDED STATISTICS (no "studies show"). Prefer a generic authority anchor ("researchers in Sweden") over naming a specific institution, unless it came from the source.
- Never name a competitor medication or drug (brand OR generic — gabapentin, Lyrica, Ozempic, etc.); Meta auto-rejects these. Use a generic category ("the usual painkillers") UNLESS the user listed it in REQUIRED TERMS below.
- Villain only as a generic category ("big pharma", "the painkiller industry") — never a specific company or drug brand.
- Disease only as an association ("linked to", "higher risk of"), and only if factual — never tell the reader they have or will get a disease.
- Organic framing: never admit it is an ad/VSL; to the reader it is just "a video" someone shared. Skip clichés ("transform your life", "revolutionary", "game-changer").
${
  (answers.mandatoryTerms || '').toString().trim().length > 0
    ? `\nREQUIRED TERMS (each of these MUST appear in the output, verbatim, woven in naturally — do not dump them all into one sentence):\n${(
        answers.mandatoryTerms || ''
      )
        .toString()
        .split(/[,\n;]/)
        .map((s: string) => s.trim())
        .filter(Boolean)
        .map((s: string) => `- "${s}"`)
        .join('\n')}\n`
    : ''
}${
  (answers.avoidList || '').toString().trim().length > 0
    ? `\nUSER-SPECIFIED AVOID LIST (these MUST NEVER appear in the output):\n${(
        answers.avoidList || ''
      )
        .toString()
        .split(/[,\n;]/)
        .map((s: string) => s.trim())
        .filter(Boolean)
        .map((s: string) => `- "${s}"`)
        .join('\n')}\n`
    : ''
}If no real proof exists → use MECHANISM PROOF or LOGICAL PROOF instead.

--- CTA / DESTINATION ---
${
  (answers.destinationDescription || '').toString().trim().length > 0
    ? `When the viewer clicks the ad, they land HERE (use this description faithfully — do NOT invent format details, length, or who appears):
"""
${(answers.destinationDescription || '').toString().trim()}
"""
Refer to the destination using ONLY the language above (or a natural translation/paraphrase). Do not call it a "podcast", "short video", "quick presentation", "audio", "course", "book", or any other format the user did not name. If the user called it an "encontro", "conversa", "live", "webinar" etc — use exactly that vocabulary.`
    : `Required phrasing for "${answers.clickDestination || 'Vídeo'}": ${ctaByDestination[answers.clickDestination || 'Vídeo'] || 'watch the video'}
Use this phrasing or a natural variation in the output language.`
}`;

  // ─── MODO VSL ──────────────────────────────────────────────────────────────
  // Roteiro LONGO cinematográfico (até ~1h) em BLOCOS de ~2 min. Ao contrário do
  // anúncio, a VSL É o destino: ela desenvolve o argumento, revela o mecanismo e
  // o produto, e VENDE. Cada bloco ~290 palavras (~2 min a ~150 ppm) para o
  // pipeline gravar/renderizar em trechos.
  if (creativeType === 'vsl') {
    const vslBlocks = Math.max(4, Math.round(wordCount / 290));
    systemPrompt = `You are a senior long-form VSL (Video Sales Letter) scriptwriter, trained in Stefan Georgi's RMBC method and Eugene Schwartz's five stages of awareness. You write cinematic sales narration meant to be read aloud as a voiceover over b-roll footage (there is NO on-screen presenter) — direct, specific, emotionally alive, oral cadence.

OUTPUT LANGUAGE:
Write the entire script in: ${answers.language || 'Português (Brasileiro)'}
Every word must be in this language. If any input data is in a different language, translate it naturally before using it.${culturalBlock}

Respond ONLY with valid JSON. No markdown, no preamble.`;

    userPrompt = `Write a COMPLETE long-form VSL script (voiceover narration for a cinematic sales video). Follow every instruction precisely.

--- WHAT THIS IS ---
This is the VSL ITSELF — the full sales video, not a teaser ad. Unlike a short ad, it MAY and SHOULD develop the full argument: reveal the unique mechanism, explain how it works, present the product and the offer, handle objections, and drive the sale. It is narrated as a continuous voiceover over b-roll (no presenter on camera), so write for the EAR: spoken rhythm, short sentences, vivid concrete images.
${exampleBlock}
--- CONTEXT ---
${ctxLines}
${
  (answers.innovativeProductName || '').toString().trim().length > 0
    ? `Named curiosity hook — the "innovative discovery" the video is about: "${(answers.innovativeProductName || '').toString().trim()}". Use this name to build intrigue early, then PAY IT OFF later in the script (unlike an ad, the VSL delivers the answer).`
    : ''
}${
  (answers.statistics || '').toString().trim().length > 0
    ? `\nGROUNDED STATISTICS — the ONLY numeric/statistical claims you may state as fact (together with numbers already in the source). Keep each number EXACT; never invent an institution:\n"""\n${(answers.statistics || '').toString().trim()}\n"""`
    : ''
}

--- DRIVER (the real emotional engine of THIS offer) ---
Agitate the "Real emotional driver" from the context (read from the VSL) — what TRULY moves this buyer. If not given, infer from context. Different offers run on different drivers; use the one THIS offer really leans on.

--- ANGLE ---
Angle: ${angle || 'Direto'} — the through-line of the whole VSL.

--- CTA / OFFER (how the VSL closes) ---
This VSL SELLS the product inside the video and closes on the OFFER. The final block must drive the viewer to ACT on the offer NOW — a confident, direct call to click the offer button and get access (e.g. "clique no botão abaixo e garanta seu acesso agora"). ${
  (answers.destinationDescription || '').toString().trim().length > 0
    ? `The offer/destination the CTA points to (use it faithfully — do NOT invent format details):\n"""\n${(answers.destinationDescription || '').toString().trim()}\n"""`
    : 'No destination described — close on a clear "click the button below and secure your access / your spot" toward the product offer.'
} Do NOT end on "watch a video" (this IS the video) — end on the purchase/enrollment action. You MAY reference the offer, what they get, and honest urgency/scarcity in the close (price/guarantee only if given in the context).

--- STRUCTURE (the full VSL arc — narrate it continuously, no bracketed labels inside the prose) ---
Move through this arc across the blocks: (1) HOOK/LEAD — a pattern-interrupt opening that stops the scroll and names the big promise or the intrigue; (2) STORY/EMPATHY — meet the person and the stakes, build identification; (3) THE PROBLEM & THE ENEMY — agitate the driver, name the real villain (a generic category); (4) THE EPIPHANY / UNIQUE MECHANISM — the turning point and WHY this works when other things failed; (5) HOW IT WORKS — make the mechanism clear and believable; (6) PROOF & CREDIBILITY — evidence, only real/grounded; (7) THE PRODUCT & THE OFFER — introduce it plainly, what they get; (8) OBJECTIONS — dissolve the top hesitations; (9) CLOSE — clear CTA with honest urgency.
VOICE: vivid and concrete; the first line IS the hook; never invent statistics. POV: ${povRule}

--- LENGTH & BLOCKS ---
Write approximately ${wordCount} words total, split into ${vslBlocks} blocks of roughly ${Math.round(wordCount / vslBlocks)} words each (~2 minutes of narration per block). Separate each block with a line containing ONLY:
=== BLOCO N ===
(where N is 1, 2, 3 …). Each block should end at a natural breath/beat, not mid-sentence. Do NOT put any other labels, brackets or beat-names inside the prose.

--- OUTPUT ---
Respond with ONLY this JSON:
{ "script": "the full VSL narration, with the === BLOCO N === separators between blocks and NO other labels" }

--- FIREWALL (inviolable) ---
- Invent NOTHING: no fake statistics, testimonials, named people, or deadlines. Any number must come from the input / GROUNDED STATISTICS (no "studies show"). Prefer a generic authority anchor ("researchers in Sweden") over naming a specific institution, unless it came from the source.
- Never name a competitor medication or drug (brand OR generic — gabapentin, Lyrica, Ozempic, etc.); use a generic category ("the usual painkillers") UNLESS listed in REQUIRED TERMS below.
- Villain only as a generic category ("big pharma", "the painkiller industry") — never a specific company or drug brand.
- Disease only as an association ("linked to", "higher risk of"), and only if factual — never tell the viewer they have or will get a disease.
- Skip clichés ("transform your life", "revolutionary", "game-changer").${
  (answers.mandatoryTerms || '').toString().trim().length > 0
    ? `\n\nREQUIRED TERMS (each MUST appear verbatim, woven in naturally):\n${(answers.mandatoryTerms || '')
        .toString()
        .split(/[,\n;]/)
        .map((s: string) => s.trim())
        .filter(Boolean)
        .map((s: string) => `- "${s}"`)
        .join('\n')}`
    : ''
}${
  (answers.avoidList || '').toString().trim().length > 0
    ? `\n\nUSER-SPECIFIED AVOID LIST (these MUST NEVER appear):\n${(answers.avoidList || '')
        .toString()
        .split(/[,\n;]/)
        .map((s: string) => s.trim())
        .filter(Boolean)
        .map((s: string) => `- "${s}"`)
        .join('\n')}`
    : ''
}`;
  }

  // UX25-A4: modo rascunho usa Sonnet 4.6 (mais rápido, ~5x mais barato).
  // Triggered por flag __draftMode no answers (não persiste).
  const draftMode = !!answers.__draftMode;
  const modelName = draftMode ? 'claude-sonnet-4-6' : undefined; // undefined → server default (Opus)
  const useThinking = !draftMode; // rascunho sem extended thinking pra economia

  // UX25-C1: emite o prompt construído pro caller (debug modal "Ver prompt").
  if (onDebug) {
    try {
      onDebug({
        systemPrompt,
        userPrompt,
        model: draftMode ? 'sonnet' : 'opus',
        // Estimativa grosseira: ~4 chars por token em PT/EN.
        estimatedInputTokens: Math.ceil((systemPrompt.length + userPrompt.length) / 4),
        timestamp: Date.now(),
      });
    } catch {
      // não bloqueia a geração se o callback der erro
    }
  }

  // max_tokens precisa cobrir o TEXTO (~wordCount*8 tokens + overhead do JSON)
  // MAIS o adaptive thinking do Opus, que conta no MESMO budget e roda em
  // effort 'high' (servidor) — pensa muito. Sem folga pro thinking, copies
  // longas (3-5min) cortavam no meio. max_tokens é TETO, não alvo: subir não
  // aumenta latência se a saída não cresce, então damos folga generosa.
  // A geração principal usa streaming (sem risco de timeout em budget alto).
  const textBudget = wordCount * 10 + 2000;
  const thinkingHeadroom = useThinking ? 14000 : 2000;
  const maxTokens = Math.max(20000, textBudget + thinkingHeadroom);
  const raw = onToken
    ? await streamClaude(systemPrompt, userPrompt, onToken, {
        maxTokens,
        model: modelName,
        thinking: useThinking,
      })
    : await callClaude(systemPrompt, userPrompt, maxTokens, {
        model: modelName,
        thinking: useThinking,
      });

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
  context?: HookSelectionContext,
  language?: string
): Promise<{ grupos: any[] } | null> => {
  if (!candidateHooks || candidateHooks.length === 0) return null;
  if (!approvedCopy) return null;

  // O idioma do campo "filled" (o hook pronto que aparece na tela) precisa
  // seguir a copy. Sem isso, o prompt inteiro em PT fazia a IA devolver hooks
  // em português mesmo quando a copy estava em inglês.
  const targetLang: 'pt' | 'en' = isPortuguese(language) ? 'pt' : 'en';
  const langNote =
    targetLang === 'pt'
      ? '\nIDIOMA: Os hooks preenchidos (campo "filled") devem sair em português brasileiro.'
      : '\nLANGUAGE: The filled hook texts (field "filled") MUST be in English, matching the approved copy — never output Portuguese in the "filled" field.';

  const systemPrompt = `Você é um especialista em copywriting para Meta Ads. Você tem 2 tarefas:
1. Selecionar hooks que combinem com a copy aprovada, o nível de consciência da audiência, e — quando fornecidos — o ângulo do criativo e a dor da persona-alvo.
2. PREENCHER os placeholders (___, [topic], [pain], etc) de cada hook selecionado usando o contexto fornecido (produto, persona, ângulo, copy). O resultado deve ser um hook FALÁVEL e PRONTO, não um template.

Hooks devem soar como abertura natural da copy, não introdução genérica. Responda APENAS em JSON válido sem markdown.${langNote}`;

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
   - ${targetLang === 'en' ? 'Write the filled text in ENGLISH (same language as the approved copy) — do NOT translate to Portuguese' : 'Escreva o texto preenchido em português (mesma língua da copy) — não traduza'}
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

  const strategyMethod = String(answers.strategyMethod || 'ia');
  const strategyCustom = String(answers.strategyCustom || '');
  const methodBlock = (() => {
    switch (strategyMethod) {
      case 'baiano':
        return `MÉTODO DE TESTE: "Baiano" — poucos criativos ÓTIMOS (3-7), cada um testado isolado em ~50 conjuntos a baixo orçamento. Por isso as personas devem ter ÂNGULOS BEM DISTINTOS entre si (nada de personas redundantes) e dor aguda/clara — cada persona vira um teste limpo. Concentre o peso: prefira distribuições como 0.65/0.30/0.05; marque terciária como isStretch se for especulação.`;
      case 'metodo15':
        return `MÉTODO DE TESTE: "Método 15" — ~15 criativos diversos rodando juntos. Gere 3 personas equilibradas e complementares que sustentem volume e diversidade de ângulos.`;
      case 'custom':
        return `MÉTODO DE TESTE descrito pelo cliente (respeite ao definir personas e pesos): "${strategyCustom.slice(0, 800)}"`;
      case 'ia':
      default:
        return `MÉTODO DE TESTE: a definir pela IA — escolha a distribuição de personas e pesos que melhor converte para ESTE produto.`;
    }
  })();

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

${methodBlock}

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
  /** Preço como aparece no material (ex: "R$97/mês"). '' se não houver. */
  priceInfo?: string;
  /** 'recorrente' | 'unico' | '' — modelo de cobrança detectado. */
  billingType?: string;
  promise: string;
  mainPain: string;
  secondaryPains: string[];
  /** Motor emocional real desta oferta, lido da VSL (medo/autonomia/desejo/etc.). */
  emotionalDriver?: string;
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
    payingRecurring?: string[];
    billingModels?: string[];
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
// 7. PLANO DE CRIATIVOS (guia-da-copy)
// ─────────────────────────────────────────────
/** Leitura de consciência por persona devolvida pelo backend (deduzida das
 *  respostas — ninguém escolhe nível num dropdown). */
export interface AwarenessReadout {
  personaId: string;
  personaName: string;
  principal: CreativeBrief['awareness'];
  secundarios: CreativeBrief['awareness'][];
  motivo: string;
}

export interface CreativePlanResult {
  briefs: CreativeBrief[];
  awareness: AwarenessReadout[];
  numCreatives: number;
  structure: 'cbo' | 'abo';
  cpaWarning: string | null;
}

// Duração-alvo padrão por nível de consciência (segundos). Menos consciente =
// mais tempo pra educar; quase-comprando = curto e direto. (Default editável
// depois, na engine de copy — aqui só preenche o brief.)
const DURATION_BY_AWARENESS: Record<string, CreativeBrief['durationTarget']> = {
  unaware: 180,
  problem_aware: 120,
  solution_aware: 90,
  product_aware: 60,
  most_aware: 30,
};

/**
 * Gera o PLANO DE CRIATIVOS (guia-da-copy): número = orçamento/dia ÷ custo por
 * criativo, distribuído entre as personas (pelos pesos) e os níveis de
 * consciência (deduzidos no backend). Cada brief sai enxuto — persona · nível ·
 * ângulo — e aqui preenchemos os defaults que o resto do app (pós-plano) lê.
 * SEM hook nesta fase: a abertura é escrita depois, na engine de copy.
 */
export async function generateCreativePlan(input: {
  productInfo?: any;
  personas: any[];
  selectedPersonaIds?: string[];
  copyAnswers?: any;
  dailyBudget: number;
  targetCpa: number;
  productPrice: number;
  structure: 'cbo' | 'abo';
  costPerCreative: number;
  /** Quantos criativos o usuário quer (manda sobre o recomendado). */
  desiredCount?: number;
}): Promise<CreativePlanResult> {
  const response = await fetch('/api/claude/marketing-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Plano de criativos error: ${err}`);
  }
  const data = await response.json();
  if (!data.success) throw new Error(data.error || 'Erro ao gerar plano de criativos.');

  const rawBriefs: any[] = Array.isArray(data.briefs) ? data.briefs : [];
  // O backend só devolve persona · nível · ângulo. Preenchemos os campos que
  // ele não gera mais (hook/emotion/style/...) pra satisfazer CreativeBrief
  // sem tocar no código pós-plano que lê esses campos.
  const briefs: CreativeBrief[] = rawBriefs.map((b, i) => {
    const awareness = (b.awareness || 'problem_aware') as CreativeBrief['awareness'];
    const ctaStyle: CreativeBrief['ctaStyle'] =
      awareness === 'most_aware' || awareness === 'product_aware' ? 'hard' : 'soft';
    return {
      id: b.id || `brief_${i + 1}`,
      index: b.index || i + 1,
      targetPersonaId: b.targetPersonaId || '',
      targetPersonaName: b.targetPersonaName || '',
      awareness,
      angle: b.angle || '',
      hook: '',
      durationTarget: DURATION_BY_AWARENESS[awareness] || 90,
      emotion: '',
      style: '',
      ctaStyle,
      promiseFocus: '',
      rationale: '',
    };
  });

  return {
    briefs,
    awareness: Array.isArray(data.awareness) ? data.awareness : [],
    numCreatives: Number(data.numCreatives) || briefs.length,
    structure: data.structure === 'abo' ? 'abo' : 'cbo',
    cpaWarning: data.cpaWarning || null,
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
// BUSCAR ESTATÍSTICAS COM FONTE (web search no servidor)
// ─────────────────────────────────────────────
/**
 * Busca estatísticas FACTUAIS com fonte na web pra o cliente que não tem
 * números próprios. O backend usa web_search e só devolve dados com URL de
 * fonte real (nunca inventa). O cliente revisa e escolhe quais usar — o
 * front nunca auto-injeta no campo de estatísticas.
 */
export interface StatisticFinding {
  stat: string;
  source: string;
  url: string;
  year: string;
}

export async function findStatistics(input: {
  productInfo?: any;
  niche?: string;
  language?: string;
  count?: number;
}): Promise<StatisticFinding[]> {
  const response = await fetch('/api/claude/find-statistics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Busca de estatísticas falhou: ${err}`);
  }
  const data = await response.json();
  if (!data.success) throw new Error(data.error || 'Erro ao buscar estatísticas.');
  return Array.isArray(data.statistics) ? data.statistics : [];
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
// 7a. AGENTE COPYWRITER — Polir (writer↔critic) + Chat
// ─────────────────────────────────────────────

/** Persona do copywriter mestre, compartilhada pelo Polir e pelo Chat. Reúne
 *  o nível de craft + o firewall de conteúdo num só lugar. */
function copywriterPersona(targetLang: 'pt' | 'en'): string {
  return `You are a master direct-response copywriter — the calibre of Gary Halbert, Eugene Schwartz and Stefan Georgi (RMBC) — specialized in Meta Ads advertorials for an older (50+) audience. You write copy that does NOT read as AI: concrete, spoken, specific, human.
You always protect a hard CONTENT FIREWALL: never invent statistics, named people, testimonials or results that weren't given; keep any disease link as "linked to / higher risk" only; keep any villain GENERIC (never a specific company or drug); hold ONE first-person narrator; never name the destination video's format unless the user did; never admit the piece is an ad or VSL.
${targetLang === 'pt' ? 'Converse e escreva em português brasileiro idiomático e oral.' : 'Converse and write in natural, idiomatic English.'}`;
}

export interface CopywriterMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Chat com o copywriter mestre sobre a copy atual. Devolve a resposta e,
 *  quando ele reescreveu, a versão nova pra UI oferecer "Aplicar". O histórico
 *  vai serializado no prompt (callClaude é system+user). */
export async function copywriterChat(input: {
  messages: CopywriterMessage[];
  script: string;
  answers: Record<string, any>;
  angle: string;
}): Promise<{ reply: string; revisedScript: string | null }> {
  const { messages, script, answers, angle } = input;
  const targetLang: 'pt' | 'en' = isPortuguese(answers.language) ? 'pt' : 'en';
  const humanness = buildHumannessDirective(Math.min(20, Number(answers.aiLevel ?? 100)));

  const systemPrompt = `${copywriterPersona(targetLang)}

You are in a CHAT with the user about the ad copy below. Discuss it, give sharp, specific opinions, and when the user asks for a change, rewrite the copy accordingly (keep beats/[LABELS], facts, narrator, language). If you rewrite, put the FULL updated script in "revisedScript"; if the turn is only discussion, set "revisedScript" to null. Keep replies short and practical.
Respond ONLY in JSON. No markdown.`;

  const transcript = messages
    .map((m) => `${m.role === 'user' ? 'USER' : 'COPYWRITER'}: ${m.content}`)
    .join('\n\n');

  const userPrompt = `CURRENT AD COPY:
"""
${script || '(ainda não há copy gerada)'}
"""

CONTEXT: language ${answers.language || 'Português (Brasileiro)'}; angle ${angle}; audience ${answers.audience || ''}.

When you rewrite, apply these style rules:${humanness || ' (keep the current style)'}

CONVERSATION SO FAR:
${transcript}

Reply to the LAST user message. Return: {"reply": "your message to the user${targetLang === 'pt' ? ' em português' : ''}", "revisedScript": "full updated script OR null"}`;

  // Folga pro thinking 'high' + possível reescrita do script inteiro.
  const chatMaxTokens = Math.max(20000, Math.ceil((script?.length || 0) / 3) + 14000);
  const raw = await callClaude(systemPrompt, userPrompt, chatMaxTokens);
  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      reply: (parsed.reply || '').toString().trim() || 'OK.',
      revisedScript:
        typeof parsed.revisedScript === 'string' && parsed.revisedScript.trim()
          ? parsed.revisedScript.trim()
          : null,
    };
  } catch {
    return { reply: raw.trim() || 'Não consegui responder agora.', revisedScript: null };
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
// 7b. ESTÁGIO 2 — MELHORAR A COPY APLICANDO UMA SKILL
// ─────────────────────────────────────────────
/** Aplica uma SKILL (texto livre que o usuário adicionou: guia, framework,
 *  estilo) por cima da copy já gerada pra melhorá-la DE VERDADE — sem quebrar a
 *  estrutura de blocos/[LABELS], os fatos, o narrador, o idioma nem o firewall.
 *  É o Estágio 2 do guia-da-copy, mas dirigido por uma skill escolhida na hora. */
export async function improveCopyWithSkill(input: {
  script: string;
  skillName: string;
  skillContent: string;
  answers?: Record<string, any>;
}): Promise<string> {
  const { script, skillName, skillContent } = input;
  const answers = input.answers || {};
  if (!script || !script.trim() || !skillContent.trim()) return script;
  const targetLang: 'pt' | 'en' = isPortuguese(answers.language) ? 'pt' : 'en';

  const systemPrompt = `You are a world-class direct-response copywriter. Your job: take an existing ad script and make it GENUINELY BETTER by applying the SKILL the user provides below. Improve the hook, specificity, belief, emotion and flow — actually raise the quality, do not just paraphrase.

NON-NEGOTIABLE — preserve all of this:
- Keep the same structure and order of ideas. The copy is ONE flowing ad — do NOT add labels, brackets or section headings.
- Keep the language (${answers.language || 'Português (Brasileiro)'}), the narrator, and every fact/number (never invent statistics, testimonials, people or institutions).
- Keep the content firewall: no price/payment/guarantee/checkout; do not reveal the exact identity/brand/protocol; villain only as a generic category; organic framing (never admit it is an ad).
Only the wording/craft changes — stronger, not different in substance.

Respond ONLY in JSON. No markdown.`;

  const userPrompt = `SKILL TO APPLY — "${skillName}":
"""
${skillContent}
"""

CURRENT AD SCRIPT (improve it by applying the skill above):
"""
${script}
"""

Rewrite the script applying the skill. Keep the structure, the order, the facts, the narrator, the language and the firewall. It stays ONE flowing ad — no labels/brackets. Make it genuinely stronger.
Return: {"improved": "the full improved ad copy${targetLang === 'pt' ? ', em português' : ''}"}`;

  const maxTokens = Math.max(
    20000,
    Math.ceil(script.length / 3 + skillContent.length / 3) + 14000
  );
  const raw = await callClaude(systemPrompt, userPrompt, maxTokens);
  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    if (cleaned.startsWith('{')) {
      const parsed = JSON.parse(cleaned);
      return (parsed.improved || script).trim();
    }
    return cleaned || script;
  } catch {
    return script;
  }
}

// ─────────────────────────────────────────────
// 7c. GERAR NARRADOR — sugere quem conta a história (qualquer postura)
// ─────────────────────────────────────────────
/** Sugere UM narrador (a VOZ que conta o anúncio) que combina com o público, o
 *  problema e o DRIVER real da oferta. Não força 1ª pessoa e NÃO spoila a
 *  solução. Curto e editável; o user pode re-gerar. */
export async function generateNarrator(
  answers: Record<string, any>,
  avoid: string[] = []
): Promise<string> {
  const targetLang: 'pt' | 'en' = isPortuguese(answers.language) ? 'pt' : 'en';
  const systemPrompt = `You pick ONE narrator (the VOICE that tells the ad) that FITS this audience, problem and emotional driver. It can be first person OR third person — whatever fits. Output in ${answers.language || 'Português (Brasileiro)'}. Respond ONLY in JSON.`;
  const avoidBlock =
    avoid.length > 0
      ? `\n\nALREADY SUGGESTED — make this one CLEARLY DIFFERENT: change the TYPE of voice and/or the age/relationship, not just reword these:\n${avoid.map((s) => `- "${s}"`).join('\n')}`
      : '';
  const driverLine = (answers.emotionalDriver || '').toString().trim()
    ? `\nReal emotional driver of this offer: ${answers.emotionalDriver}`
    : '';
  const userPrompt = `Audience: ${answers.audience || ''}
Pain/situation: ${answers.situation || answers.painPoints || ''}
Product: ${answers.productName || ''}
Promised result: ${answers.productResult || ''}${driverLine}

Suggest ONE narrator in a single short sentence: who they are, their age, and their relation to the topic. The narrator must EMBODY the real driver above. It does NOT have to be first person — choose a DISTINCT TYPE of voice (rotate among: someone PREPARING against a future risk who wants to be ready rather than sorry · someone living the problem now · a caregiver · an adult son/daughter · a spouse · a professional who saw many cases · a friend who helped someone · a voice who RECOUNTS OTHER people's stories / an observer of the times), and vary age/gender/backstory — but stay believable for THIS audience.
IMPORTANT on framing: make the narrator embody whatever the real driver above actually is — do not impose a frame the offer doesn't have. If that driver is ANTICIPATORY (about what could happen / wanting to be ready), make the narrator forward-looking and proactive rather than someone defined by a past disaster. A past or present hardship may appear as ONE supporting thread, never the sole frame.
IMPORTANT: describe only WHO the narrator is. Do NOT reveal the solution, the product, or how it works (no "built our own X", no mechanism) — that is the ad's payoff, not the narrator's bio.${avoidBlock}
Return: {"narrator": "one short sentence${targetLang === 'pt' ? ' em português' : ''}"}`;
  const raw = await callClaude(systemPrompt, userPrompt, 20000);
  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    if (cleaned.startsWith('{')) return (JSON.parse(cleaned).narrator || '').toString().trim();
    return cleaned.trim();
  } catch {
    return '';
  }
}

// ─────────────────────────────────────────────
// 7d. GERAR NOME DO "PRODUTO INOVADOR" (gancho de curiosidade)
// ─────────────────────────────────────────────
/** Sugere UM apelido-teaser pra descoberta (estilo "yellow vitamin", "truque da
 *  banana", "ritual de 5 segundos") com base no mecanismo — intrigante, SEM
 *  revelar o que é de verdade. Curto e editável; o user pode re-gerar. */
export async function generateInnovativeName(
  answers: Record<string, any>,
  avoid: string[] = [],
  sourceText = ''
): Promise<string> {
  const targetLang: 'pt' | 'en' = isPortuguese(answers.language) ? 'pt' : 'en';
  const src = (sourceText || '').toString().trim().slice(0, 14000);
  const systemPrompt = `You find or create ONE short "curiosity-hook nickname" for the discovery in a direct-response ad — the way "the yellow vitamin", "the banana trick" or "the 5-second ritual" work. It must INTRIGUE without revealing what the thing actually is. PRIORITY: if the SOURCE material (the VSL/landing this ad drives to) already gives the discovery such a nickname, REUSE that exact nickname so the ad matches the video. Output in ${answers.language || 'Português (Brasileiro)'}. Respond ONLY in JSON.`;
  const avoidBlock =
    avoid.length > 0
      ? `\nIf (and only if) you are INVENTING one, make it clearly DIFFERENT in words AND angle from these:\n${avoid.map((s) => `- "${s}"`).join('\n')}`
      : '';
  const sourceBlock = src
    ? `\n\nSOURCE (the VSL/landing this ad links to) — scan it FIRST for the nickname it already uses for the discovery:\n"""\n${src}\n"""`
    : '';
  const userPrompt = `Product: ${answers.productName || ''}
Promised result: ${answers.productResult || ''}
Unique mechanism: ${answers.uniqueMechanism || ''}
Pain/situation: ${answers.situation || answers.painPoints || ''}${sourceBlock}

Give ONE short curiosity-hook nickname (2-4 words) for the discovery, vivid and intriguing, NEVER revealing the actual identity/ingredient/method.
- FIRST: if the SOURCE above already names the discovery with such a teaser nickname, return THAT EXACT nickname (this links the ad to the video). Set "fromSource": true.
- ONLY if the source has no such nickname (or no source was given): invent one, picking a FRESH angle (a place, a time of day, a number, a color, an everyday object, a ritual, a body sensation). Set "fromSource": false.${avoidBlock}
Return: {"name": "the nickname${targetLang === 'pt' ? ' em português' : ''}", "fromSource": true|false}`;
  const raw = await callClaude(systemPrompt, userPrompt, 20000);
  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    if (cleaned.startsWith('{')) return (JSON.parse(cleaned).name || '').toString().trim();
    return cleaned.trim();
  } catch {
    return '';
  }
}

// ─────────────────────────────────────────────
// 8. REGERAR 1 BEAT (UX16) — não a copy inteira
// ─────────────────────────────────────────────

/** Bloco anti-IA pra humanizar a prosa. Tem DUAS partes:
 *  (1) BASELINE sempre-ligado — destilado do skill "humanizer" (guia "Signs of
 *  AI writing" da Wikipedia), em `.claude/skills/humanizer/SKILL.md`, ADAPTADO
 *  pra copy de VENDAS (mantém persuasão/emoção/CTA; nunca neutraliza como o
 *  skill faria com texto enciclopédico). Restrição, não banimento (ver
 *  principio-nunca-bloquear) — só o travessão é regra dura.
 *  (2) ESCALA pelo slider `answers.aiLevel` (0-100, degraus de 20): quanto
 *  MENOR, mais regras de ritmo ACUMULAM por cima do baseline.
 *  NUNCA relaxa o firewall de conteúdo (estatística ancorada, narrador único,
 *  vilão genérico, não-nomear-canal, não inventar prova). Hoisted. */
function buildHumannessDirective(aiLevelRaw: any): string {
  const lvl = Math.max(0, Math.min(100, Math.round(Number(aiLevelRaw ?? 100))));

  // BASELINE — sempre aplicado (mesmo em 100). É o skill "humanizer" destilado.
  const baseline = `\n\n--- ANTI-AI WRITING (always on — distilled from the "humanizer" skill, Wikipedia "Signs of AI writing", adapted for SALES copy) ---
Write so it does NOT read as AI. This governs STYLE only; it NEVER weakens persuasion, emotion, the CTA, or the content firewall (grounded stats, single narrator, generic villain, no channel-naming). This is a sales ad in a real person's voice, NOT an encyclopedia — stay vivid, emotional and opinionated; "promotional" language is the JOB here, not a flaw.
Default AWAY from these AI tells (keep one only if it genuinely earns its place; this is restraint, not a ban — except the em dash, which is a hard rule):
- Em dashes: HARD RULE — at most ONE "—" in the whole piece; replace with a period, comma, or parentheses.
- AI vocabulary words: delve, tapestry, testament, underscore, showcase, vibrant, intricate, pivotal, crucial, realm, foster, garner, elevate, unlock, navigate, embark, landscape (figurative), "in today's world", "ever-evolving".
- Empty atmosphere adverbs, above all "quietly" (also "silently/softly/gently"): default cut; keep only with literal meaning. The ADJECTIVE "silent"/"quiet" ("silent deficiency") is fine, just sparingly. Don't personify abstractions with soft actions ("independence quietly leaves the room") — say what literally happens to the person.
- "-ing" tails that fake depth ("…, highlighting/ensuring/reflecting/underscoring…"): cut or make a real clause.
- Copula avoidance: prefer plain "is/are/has" over "serves as / stands as / boasts / represents".
- Persuasive-authority tropes: "the real question is", "at its core", "what really matters", "make no mistake", "the truth is".
- Aphorism formulas: "X is the Y of Z", "not a tool but a mirror".
- Fake-candid rhetorical openers as standalone hooks: "Honestly?", "Look,", "Here's the thing".
- Signposting / announcements: "let's dive in", "here's what you need to know".
- Filler ("in order to"→"to", "at this point in time"→"now") and over-hedging ("could potentially possibly").
- Synonym cycling for the same noun; false ranges ("from X to Y" when X and Y aren't on a real scale).
- Chatbot artifacts ("I hope this helps", "Want me to…", "Certainly!"), emojis, curly quotes "" '' (use straight " '), mechanical boldface/headers.
- Generic upbeat conclusions ("the future looks bright", "exciting times ahead") — end on the concrete CTA/payoff instead.
PRESERVE what reads as human (do NOT strip): concrete, hard-to-fabricate specifics (a time of day, a place, a mundane object, an exact number/sensation); varied sentence length; a genuine aside or self-correction; ONE held first-person voice. Polish is not AI — do not flatten the legitimate vivid, emotional, persuasive language a sales ad needs.`;

  // Em 100 (e ~90): só o baseline humanizer, sem quebrar ritmo agressivamente.
  if (lvl >= 90) return baseline;

  const rules: string[] = [];
  // <= 80 — a antítese repetida (o em-dash e os advérbios já estão no baseline)
  rules.push(
    'The "it isn\'t X, it\'s Y" flip: use it ONCE at most in the whole copy, and NEVER as the opening line of the copy or of a beat. The model overuses it — watch for and remove repeats like "it isn\'t aging, it\'s…", "that isn\'t damage, that\'s…", "the cause was never X, it was Y".',
  );
  if (lvl <= 60)
    rules.push(
      'RESTRAIN repeated parallelism — this is the #1 remaining AI tell and the copy keeps OVERDOING it. A "parallel series" = 3 or more consecutive clauses/sentences sharing the same opener or grammatical frame, e.g.: "the same numb hands, the same shuffling walk, the same shrug" · "You show up. You take the dose. You pay the co-pay." · "First it\'s the pills. Then the stronger pills. Then an injection." · "Not a painkiller. Not an injection." · "That is the burning. That is the tingling." Allow AT MOST TWO such series in the WHOLE piece — never two in the same paragraph, never back-to-back across beats, never longer than 3 items. Break all the rest: merge into one flowing sentence, cut to two items, or change the structure so consecutive sentences do NOT start the same way. Plain functional lists of symptoms/benefits (commas in one sentence) do not count and are fine.',
    );
  if (lvl <= 40)
    rules.push(
      'Break the symmetry: paragraphs/beats of clearly UNEVEN length (one can be two short sentences, another a long winding one). Add spoken texture — a contraction, a quick aside, a repeated word for emphasis.',
    );
  if (lvl <= 20)
    // Nível 20 = mirar o perfil da COPY RICA de referência: humano, oral,
    // específico — mas LIMPO (a imperfeição/run-on só entra no 0).
    rules.push(
      'TARGET THE PROVEN "RICH ADVERTORIAL" VOICE (the reference winning copy). That means: plain, spoken words and ZERO literary/poetic flourishes written for emotional effect — kill lines like "a slow erasure of who you were", "independence quietly leaves the room", "your next good morning is waiting on the other side of that video"; say it plainly and concretely instead ("you stop trusting the stairs", "tap below and watch it now"). Talk DIRECTLY to the reader (you/your) in a calm, oral cadence ("Listen,", "Here\'s the problem,", "I hate to say it, but…"). Build belief from CONCRETE specifics — exact numbers wherever they are grounded in the inputs, plus vivid sensory/scene detail you MAY invent for realism (a time of day, a mundane object, an exact physical sensation) — NOT from rhythm or wordplay. Paragraphs of clearly uneven length. Keep the grammar CLEAN and tight — human but POLISHED, not messy. Never fabricate named people, testimonials, results, or statistics that are not in the inputs (that would be a fake testimonial).',
    );
  if (lvl <= 0)
    rules.push(
      'ONLY at this extreme: let it sound truly spoken — a slightly imperfect sentence, a mid-thought correction, or a short run-on is welcome where a real person would actually talk that way (every level above this keeps the grammar clean).',
    );
  const audit =
    lvl <= 80
      ? `\n\nBEFORE FINISHING — audit your OWN draft and FIX violations: count the "isn't X, it's Y" flips (max 1, and never as an opener)${
          lvl <= 60
            ? ', and the parallel series (3+ consecutive clauses/sentences sharing the same opener or frame) — keep AT MOST TWO in the whole piece, never back-to-back; merge or vary the rest'
            : ''
        }. If you are over the limit, rewrite those exact lines. Also trim the filler ADVERBS "quietly"/"silently"/"softly"/"gently" that add nothing (the adjective "silent"/"quiet" is fine in moderation — leave it). This audit OVERRIDES any punchy rhythm the beat instructions earlier seemed to invite.`
      : '';
  return `${baseline}

--- EXTRA HUMANIZATION — CRITICAL STYLE OVERRIDE (slider ${100 - lvl}/100 toward human) ---
These take PRIORITY over any rhythmic instinct or stylistic example earlier in this prompt. Apply to STYLE / RHYTHM ONLY. Do NOT relax any content rule above (grounded statistics, the single held narrator, generic villain, never naming the destination format, no invented claims or people):
${rules.map((r) => `- ${r}`).join('\n')}${audit}`;
}


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
  /** 0-100: quão PARECIDO o novo beat deve ser do atual. 0 = totalmente
   *  diferente; 100 = quase igual (só pequenos ajustes). Default 50. */
  similarity?: number;
}): Promise<string> {
  const { beatLabel, beatCurrentText, fullScript, answers, angle } = input;
  if (!beatLabel || !fullScript) return beatCurrentText;

  // Direciona o grau de mudança pelo slider de similaridade (0-100).
  const sim = Math.max(0, Math.min(100, Math.round(input.similarity ?? 50)));
  const simDirective =
    sim <= 25
      ? `SIMILARITY ${sim}/100 — Rewrite from SCRATCH: a completely DIFFERENT approach, angle, imagery and rhythm from the current text. Keep ONLY this beat's function in the script and the real product facts. It must read as a brand-new beat, not a variation of the current one.`
      : sim <= 50
        ? `SIMILARITY ${sim}/100 — Same core idea, but FRESH execution: noticeably different sentences, sensory details and rhythm. Do not reuse the current phrasing or sentence structure.`
        : sim <= 75
          ? `SIMILARITY ${sim}/100 — Keep the current structure and ideas; vary wording, examples and rhythm so it reads as a recognizable rewrite — clearly the same beat, just refreshed.`
          : `SIMILARITY ${sim}/100 — Change VERY LITTLE: preserve almost all of the current text and its structure; only adjust word choice, polish, and flow. The reader should barely notice a difference.`;

  const targetLang: 'pt' | 'en' = isPortuguese(answers.language) ? 'pt' : 'en';
  const culturalNote =
    targetLang === 'pt'
      ? '\n\nIDIOMA: Português brasileiro idiomático. Frases curtas e orais. Evite "está prestes a", "no mundo de hoje", "uma jornada". Use "olha só", "presta atenção", "do nada".'
      : '';

  const systemPrompt = `You rewrite ONE beat of a direct-response ad script while keeping seamless flow with the surrounding beats. You don't rewrite the whole script — only the requested beat. You preserve all real product facts and the script's overall angle.${culturalNote}

Respond ONLY in JSON. No markdown.`;

  const userPrompt = `Rewrite ONLY the [${beatLabel}] beat below. Keep the same role this beat plays in the script structure and make sure it flows into the next beat naturally. How MUCH it should differ from the current text is governed by the SIMILARITY directive:

${simDirective}

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
${buildHumannessDirective(answers.aiLevel)}

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
      ? '\n\nIDIOMA: Escreva TODOS os hooks em português brasileiro idiomático. Frases curtas e orais. Evite traduções literais do inglês. Use construções como "presta atenção", "olha só", "do nada".'
      : '\n\nLANGUAGE: Write EVERY hook in English. Match the language of the approved copy below — do NOT output Portuguese. Natural, spoken, direct-response English.';

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
4. ${targetLang === 'en' ? 'Write every hook in ENGLISH (same language as the approved copy) — do NOT translate to Portuguese' : 'Escreva todos os hooks em português (mesma língua da copy) — NÃO traduza'}
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

// ─────────────────────────────────────────────
// UX24-D — DESCRIBE DESTINATION FROM PRODUCT
// ─────────────────────────────────────────────
/**
 * Recebe productInfo (transcrição/descrição da Fonte do Produto) +
 * categoria de clickDestination + idioma, e usa Claude pra escrever
 * uma descrição CONCRETA de pra onde o user manda o lead.
 *
 * O resultado vai pra o campo destinationDescription da CopyTab, que
 * é injetado no prompt principal — isso impede o modelo de inventar
 * frases tipo "ele gravou uma apresentação curta" quando o destino
 * real é um encontro/webinar/live longo.
 *
 * Output: string em PT-BR (ou EN se language='en'). User revisa antes
 * de gerar a copy.
 */
export async function describeDestinationFromProduct(input: {
  productInfo?: any;
  clickDestination?: string;
  language?: string;
}): Promise<string> {
  const productInfo = input.productInfo || {};
  const dest = (input.clickDestination || 'video').toLowerCase();
  const isPT = isPortuguese(input.language);

  // Monta o corpus mais rico que conseguimos a partir do productInfo.
  // Diferentes tipos de projeto guardam dados em campos diferentes
  // (VSL transcrita, descrição livre, ofertas, dor principal, etc).
  // Misturamos tudo pra dar ao modelo a melhor chance.
  const bits: string[] = [];
  const push = (label: string, val: unknown) => {
    if (val == null) return;
    const s = String(val).trim();
    if (!s) return;
    bits.push(`${label}: ${s}`);
  };
  push('Produto', productInfo.produto || productInfo.productName);
  push('Oferta', productInfo.oferta);
  push('Dor principal', productInfo.dorPrincipal);
  push('Promessa', productInfo.promessa || productInfo.productResult);
  push('Mecanismo único', productInfo.mecanismoUnico || productInfo.uniqueMechanism);
  push('Descrição livre', productInfo.descricao || productInfo.description);
  push('VSL / Transcrição', productInfo.transcript || productInfo.transcription);
  push('História', productInfo.historia);
  push('Provas / Resultados', productInfo.provas || productInfo.socialProof);

  const corpus = bits.length > 0 ? bits.join('\n') : '(sem informações disponíveis)';

  // Mapeia a categoria pra label legível (apenas pra contexto)
  const destLabel: Record<string, string> = {
    video: isPT ? 'um vídeo (VSL, webinar, live, encontro online)' : 'a video (VSL, webinar, live)',
    article: isPT ? 'um artigo/conteúdo escrito' : 'an article / written content',
    salespage: isPT ? 'uma página de vendas direta' : 'a sales page',
    whatsapp: isPT ? 'WhatsApp ou formulário' : 'WhatsApp or contact form',
    checkout: isPT ? 'checkout direto (compra imediata)' : 'direct checkout',
    Vídeo: isPT ? 'um vídeo' : 'a video',
    'Landing Page de Vendas': isPT ? 'uma página de vendas' : 'a sales landing page',
    'Lead Form': isPT ? 'um formulário de lead' : 'a lead form',
    WhatsApp: isPT ? 'WhatsApp' : 'WhatsApp',
    'Página de Captura': isPT ? 'uma página de captura' : 'an opt-in page',
  };

  const systemPrompt = isPT
    ? `Você é um copywriter sênior ajudando a documentar o destino do clique de um anúncio. Recebe informações sobre o produto e a categoria do destino, e escreve uma descrição CONCRETA do que o lead encontra ao clicar — pra o gerador de copy não inventar formato. Responda em texto corrido, 3-6 frases curtas, sem markdown. NÃO inicie com "Ao clicar..." nem use prefixos repetitivos — vá direto ao conteúdo.`
    : `You are a senior copywriter helping document an ad's click destination. Given product info and the destination category, write a CONCRETE description of what the lead finds — to keep the copy generator from inventing format. Plain prose, 3-6 short sentences, no markdown. Do NOT start with "When clicking..." — just describe the content.`;

  const userPrompt = isPT
    ? `Categoria do destino: ${destLabel[dest] || dest}

Informações do produto:
${corpus}

ESCREVA uma descrição honesta e específica do que tem no destino — formato (live de 1h, encontro de 3 pessoas, página com vídeo curto, etc), quem aparece, sobre o que falam, qual o tom. Se o produto tem uma história forte (família, criador, descoberta), incorpore. Se faltar info, descreva no nível que conseguir mas SEM inventar — prefira ser vago a confabular.

Inclua no final 1 linha começando com "EVITAR:" listando 2-4 termos que a copy NÃO deveria usar pra descrever esse destino (ex: se é uma live de 1h, evitar "vídeo curto", "apresentação rápida"). Use vírgula entre termos.`
    : `Destination category: ${destLabel[dest] || dest}

Product info:
${corpus}

WRITE an honest, specific description of what's at the destination — format (1-hour live, 3-person conversation, short video page, etc), who appears, what they discuss, the tone. If the product has a strong story (family, founder, discovery), weave it in. Where info is missing, describe at the level you can — do NOT confabulate.

Include 1 final line starting with "AVOID:" listing 2-4 terms the copy should NEVER use to describe this destination (e.g. if it's a 1h live, avoid "short video", "quick presentation"). Comma-separated.`;

  try {
    const raw = await callClaude(systemPrompt, userPrompt, 600);
    return (raw || '').trim();
  } catch (err: any) {
    console.warn('[describeDestinationFromProduct] falhou:', err?.message);
    throw err;
  }
}

// Reenquadra os campos de AUDIÊNCIA pro NÍVEL DE CONSCIÊNCIA alvo (Eugene
// Schwartz): mantém QUEM é a audiência (mesmo público/oferta) e muda só o
// enquadramento de consciência (o quanto percebe o problema/solução, o que já
// tentou, a objeção típica). Retorna as mesmas chaves reescritas.
export async function reframeAudienceForLevel(input: {
  level: string;
  language?: string;
  fields: Record<string, string>;
}): Promise<Record<string, string>> {
  const isPT = isPortuguese(input.language);
  const lvl = (input.level || '3').charAt(0);
  const levelDesc: Record<string, string> = {
    '1': isPT ? 'Inconsciente (nem sabe que tem o problema)' : 'Unaware (doesn’t know they have the problem)',
    '2': isPT ? 'Consciente do Problema (sente o problema, não conhece solução)' : 'Problem-aware',
    '3': isPT ? 'Consciente da Solução (sabe que há soluções, não conhece a sua)' : 'Solution-aware',
    '4': isPT ? 'Consciente do Produto (conhece seu produto, ainda em dúvida)' : 'Product-aware',
    '5': isPT ? 'Totalmente Consciente (pronto pra comprar)' : 'Most aware (ready to buy)',
  };
  const cur = JSON.stringify(input.fields, null, 2);
  const system = isPT
    ? `Você é estrategista de copy. Recebe os campos de uma AUDIÊNCIA e um NÍVEL DE CONSCIÊNCIA alvo. Reescreva os campos pra refletir esse nível, MANTENDO quem é a audiência (mesmo público, mesma oferta, mesma dor de fundo) — muda SÓ o enquadramento de consciência: o quanto ela percebe o problema/solução, o que já tentou e a objeção típica desse nível. NÃO invente fatos novos; só reenquadre o tom. Responda SOMENTE com JSON válido, exatamente as mesmas chaves recebidas, valores curtos (1-2 frases), em português. Sem markdown, sem texto fora do JSON.`
    : `You are a copy strategist. Given AUDIENCE fields and a target AWARENESS LEVEL, rewrite the fields to reflect that level, KEEPING who the audience is (same public, same offer, same underlying pain) — change ONLY the awareness framing. Do NOT invent new facts. Respond ONLY with valid JSON, exact same keys, short values (1-2 sentences). No markdown.`;
  const user = `${isPT ? 'Nível alvo' : 'Target level'}: ${lvl} — ${levelDesc[lvl] || ''}\n\n${isPT ? 'Campos atuais' : 'Current fields'}:\n${cur}`;
  const raw = await callClaude(system, user, 900);
  const clean = (raw || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  const jsonStr = start >= 0 && end > start ? clean.slice(start, end + 1) : clean;
  const parsed = JSON.parse(jsonStr) as Record<string, string>;
  return parsed;
}

// ─────────────────────────────────────────────
// UX25-A2 — PRE-FLIGHT CHECK
// ─────────────────────────────────────────────
/**
 * Valida campos do brief ANTES de chamar Claude. Sinaliza quando o input
 * é fraco o suficiente pra produzir copy ruim. Não bloqueia — só avisa.
 *
 * Heurística local (não chama IA) — barato e instantâneo. Pega 80%
 * dos casos comuns:
 *   - campos críticos vazios
 *   - audience genérico ("pessoas", "todos")
 *   - painPoint vago ("estresse", "cansaço")
 *   - productResult sem número/concretude
 */
export interface PreflightIssue {
  field: string;
  label: string;
  severity: 'warn' | 'error';
  reason: string;
  suggestion: string;
}

export function preflightCheckCopy(answers: Record<string, any>): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const get = (k: string): string => (answers[k] || '').toString().trim();

  // Audience
  const audience = get('audience');
  if (!audience) {
    issues.push({
      field: 'audience',
      label: 'Público',
      severity: 'error',
      reason: 'Sem público definido, IA inventa um genérico.',
      suggestion: 'Descreva quem vai ver (idade, vida, situação).',
    });
  } else if (audience.split(/\s+/).length < 3) {
    issues.push({
      field: 'audience',
      label: 'Público',
      severity: 'warn',
      reason: 'Público muito curto — fica genérico.',
      suggestion: 'Adicione contexto (ex: "Mulheres 40+ com filhos pequenos").',
    });
  } else if (/\b(todos|todas|pessoas|qualquer um)\b/i.test(audience)) {
    issues.push({
      field: 'audience',
      label: 'Público',
      severity: 'warn',
      reason: 'Público abstrato — IA não tem ângulo concreto.',
      suggestion: 'Especifique segmento real.',
    });
  }

  // PainPoints / situation
  const pain = get('painPoints') || get('situation');
  if (!pain) {
    issues.push({
      field: 'painPoints',
      label: 'Problema principal',
      severity: 'error',
      reason: 'Sem dor, copy fica sem âncora emocional.',
      suggestion: 'Descreva o problema visceral que o produto resolve.',
    });
  } else if (pain.length < 20) {
    issues.push({
      field: 'painPoints',
      label: 'Problema principal',
      severity: 'warn',
      reason: 'Dor descrita muito curta.',
      suggestion: 'Dê 1-2 frases concretas sobre como a dor aparece no dia.',
    });
  }

  // Product result
  const result = get('productResult');
  if (!result) {
    issues.push({
      field: 'productResult',
      label: 'Resultado concreto',
      severity: 'warn',
      reason: 'Sem promessa concreta, copy fica vaga.',
      suggestion: 'Diga o que o produto entrega (com número se possível).',
    });
  } else if (!/\d/.test(result) && result.length < 30) {
    issues.push({
      field: 'productResult',
      label: 'Resultado concreto',
      severity: 'warn',
      reason: 'Resultado sem números ou specifics.',
      suggestion: 'Adicione "em X dias", "Y kg", "Z%" — quanto + quando.',
    });
  }

  // Mechanism
  if (!get('uniqueMechanism')) {
    issues.push({
      field: 'uniqueMechanism',
      label: 'Mecanismo único',
      severity: 'warn',
      reason: 'Sem mecanismo, IA não tem como justificar a promessa.',
      suggestion: 'Explique POR QUE seu produto funciona (vs. alternativas).',
    });
  }

  // Hidden desire
  if (!get('hiddenDesire')) {
    issues.push({
      field: 'hiddenDesire',
      label: 'Desejo profundo',
      severity: 'warn',
      reason: 'Sem desejo profundo, copy fica no resultado superficial.',
      suggestion: 'Descreva o que a pessoa REALMENTE quer (status, alívio, identidade).',
    });
  }

  // Main objection
  if (!get('mainObjection')) {
    issues.push({
      field: 'mainObjection',
      label: 'Objeção principal',
      severity: 'warn',
      reason: 'Sem objeção, copy não antecipa resistência.',
      suggestion: 'O que faz o lead hesitar? "Já tentei tudo", "Caro", "Não confio"?',
    });
  }

  return issues;
}

// ─────────────────────────────────────────────
// UX25-A3 — HALLUCINATION DETECTOR
// ─────────────────────────────────────────────
/**
 * Pós-geração: usa Claude pra comparar a copy com productInfo (transcrição
 * + persona + brief) e flagra trechos não suportados na fonte.
 *
 * Retorna array de claims problemáticos com excerpt + razão.
 * Falha silenciosamente (retorna []) — não bloqueia o fluxo.
 */
export interface HallucinationFlag {
  excerpt: string; // trecho problemático
  reason: string; // por que é problemático
  severity: 'low' | 'medium' | 'high';
}

export async function detectHallucinations(input: {
  generatedCopy: string;
  productInfo?: any;
  language?: string;
}): Promise<HallucinationFlag[]> {
  if (!input.generatedCopy || !input.generatedCopy.trim()) return [];

  const isPT = isPortuguese(input.language);

  // Monta corpus da fonte (mesma lógica de describeDestinationFromProduct)
  const bits: string[] = [];
  const push = (label: string, val: unknown) => {
    if (val == null) return;
    const s = String(val).trim();
    if (!s) return;
    bits.push(`${label}: ${s}`);
  };
  const p = input.productInfo || {};
  push('Produto', p.produto || p.productName);
  push('Oferta', p.oferta);
  push('Dor principal', p.dorPrincipal);
  push('Promessa', p.promessa || p.productResult);
  push('Mecanismo', p.mecanismoUnico || p.uniqueMechanism);
  push('Descrição', p.descricao || p.description);
  push('VSL / Transcrição', p.transcript || p.transcription);
  push('História', p.historia);
  push('Provas', p.provas || p.socialProof);

  if (bits.length === 0) return []; // sem fonte, não dá pra checar

  const corpus = bits.join('\n');

  const systemPrompt = isPT
    ? `Você é um fact-checker de copies de anúncio. Recebe uma fonte (informações do produto) e uma copy gerada, e identifica trechos da copy que NÃO TÊM SUPORTE na fonte. Responda APENAS em JSON. Sem markdown.`
    : `You are a fact-checker for ad copies. Given a source (product info) and a generated copy, identify excerpts in the copy that are NOT SUPPORTED by the source. Respond ONLY in JSON. No markdown.`;

  const userPrompt = isPT
    ? `FONTE (o que sabemos sobre o produto):
"""
${corpus.slice(0, 4000)}
"""

COPY GERADA:
"""
${input.generatedCopy.slice(0, 3000)}
"""

Identifique TRECHOS da copy gerada que afirmam coisas NÃO presentes na fonte. Exemplos do que flagar:
- Formatos inventados (ex: "apresentação curta" quando a fonte fala de live de 1h)
- Personagens fictícios (ex: "uma mulher me contou" quando ninguém disse isso)
- Números inventados ("47 mil pessoas", "85% melhoraram") sem suporte
- Promessas mais fortes que a fonte ("cura definitiva" quando a fonte diz "ajudou a melhorar")
- Detalhes específicos que a fonte não menciona

NÃO flagar:
- Linguagem persuasiva normal (CTAs, emoção, especificidade saudável)
- Reframes que mantêm o sentido da fonte
- Detalhes técnicos do mecanismo que estão na fonte

Output (JSON apenas, máximo 6 items):
{ "flags": [
  { "excerpt": "trecho exato da copy", "reason": "por que não tem suporte", "severity": "low" | "medium" | "high" }
]}`
    : `SOURCE (what we know about the product):
"""
${corpus.slice(0, 4000)}
"""

GENERATED COPY:
"""
${input.generatedCopy.slice(0, 3000)}
"""

Identify EXCERPTS in the generated copy that claim things NOT in the source. Examples to flag:
- Invented formats (e.g. "short presentation" when source says 1h live)
- Fictional characters
- Made-up numbers without support
- Promises stronger than the source supports
- Specific details not in source

DO NOT flag:
- Normal persuasive language (CTAs, emotion, healthy specificity)
- Reframes that keep the source's meaning
- Mechanism details that are in the source

Output (JSON only, max 6 items):
{ "flags": [
  { "excerpt": "exact excerpt", "reason": "why unsupported", "severity": "low" | "medium" | "high" }
]}`;

  try {
    const raw = await callClaude(systemPrompt, userPrompt, 1000);
    const cleaned = raw
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    const flags = Array.isArray(parsed.flags) ? parsed.flags : [];
    return flags
      .filter((f: any) => f && typeof f.excerpt === 'string' && f.excerpt.length > 0)
      .slice(0, 6)
      .map((f: any) => ({
        excerpt: f.excerpt.trim().slice(0, 200),
        reason: (f.reason || '').toString().trim().slice(0, 200),
        severity: ['low', 'medium', 'high'].includes(f.severity) ? f.severity : 'medium',
      }));
  } catch (err: any) {
    console.warn('[detectHallucinations] falhou:', err?.message);
    return [];
  }
}

// ─────────────────────────────────────────────
// Quick-fix — generalizar autoridades nomeadas
// Acha trechos que nomeiam uma instituição/expert específico + localização
// usados como prova emprestada (ex.: "Instituto Karolinska na Suécia") e
// propõe uma âncora genérica ("pesquisadores na Suécia"). Nomes que aparecem
// na FONTE do produto são considerados ancorados e NÃO são flagados.
// ─────────────────────────────────────────────
export interface AuthorityAnchor {
  excerpt: string; // trecho exato a trocar, ex.: "the Karolinska Institute in Sweden"
  suggestion: string; // âncora genérica, ex.: "researchers in Sweden"
  reason: string; // por que generalizar
}

export async function detectNamedAuthorities(input: {
  generatedCopy: string;
  productInfo?: any;
  language?: string;
}): Promise<AuthorityAnchor[]> {
  if (!input.generatedCopy || !input.generatedCopy.trim()) return [];

  const isPT = isPortuguese(input.language);

  // Corpus da fonte = nomes que SÃO permitidos (vieram do material real).
  // Diferente do detector de alucinação, NÃO retornamos cedo se vazio: sem
  // fonte, nenhum nome está ancorado → tudo vira candidato a generalizar.
  const bits: string[] = [];
  const push = (label: string, val: unknown) => {
    if (val == null) return;
    const s = String(val).trim();
    if (!s) return;
    bits.push(`${label}: ${s}`);
  };
  const p = input.productInfo || {};
  push('Produto', p.produto || p.productName);
  push('Oferta', p.oferta);
  push('Dor principal', p.dorPrincipal);
  push('Promessa', p.promessa || p.productResult);
  push('Mecanismo', p.mecanismoUnico || p.uniqueMechanism);
  push('Descrição', p.descricao || p.description);
  push('VSL / Transcrição', p.transcript || p.transcription);
  push('História', p.historia);
  push('Provas', p.provas || p.socialProof);
  const corpus = bits.join('\n') || '(nenhuma fonte fornecida)';

  const systemPrompt = isPT
    ? `Você revisa copies de anúncio. Encontra trechos que NOMEIAM uma autoridade específica (instituição/universidade — geralmente com localização ou departamento — ou um cientista/expert nomeado) usada como prova de credibilidade, e propõe uma âncora GENÉRICA que mantém a autoridade sem o nome específico. Responda APENAS em JSON. Sem markdown.`
    : `You review ad copies. You find phrases that NAME a specific authority (an institution/university — usually with a location or department — or a named scientist/expert) used as credibility proof, and propose a GENERIC anchor that keeps the authority without the specific name. Respond ONLY in JSON. No markdown.`;

  const userPrompt = isPT
    ? `FONTE (nomes que SÃO permitidos — vieram do material real do produto):
"""
${corpus.slice(0, 4000)}
"""

COPY GERADA:
"""
${input.generatedCopy.slice(0, 3000)}
"""

Encontre trechos da copy que nomeiam uma autoridade ESPECÍFICA como prova — uma instituição/universidade (frequentemente com localização ou departamento) ou um expert/cientista nomeado — usada para emprestar credibilidade.

Para cada um, proponha uma âncora GENÉRICA que mantém a credibilidade mas tira o nome+localização específicos (ex.: "o Instituto Karolinska na Suécia" → "pesquisadores na Suécia"; "o Departamento de Neurociência de Harvard" → "uma equipe de uma grande universidade"; "Dra. Jane Smith de Stanford" → "uma neurologista").

NÃO flagar:
- Um nome que aparece na FONTE acima (está ancorado — mantenha).
- Menções já genéricas ("pesquisadores", "médicos", "um estudo") — não há o que trocar.
- O expert que apresenta o vídeo de destino, quando citado como o apresentador (isso é o CTA, não prova emprestada).

Copie o "excerpt" EXATAMENTE como aparece na copy (incluindo o artigo que você quer substituir junto), pra poder trocar por correspondência exata.

Output (JSON apenas, máximo 6 items):
{ "anchors": [
  { "excerpt": "trecho exato da copy", "suggestion": "âncora genérica", "reason": "motivo curto" }
]}`
    : `SOURCE (names that ARE allowed — they came from the real product material):
"""
${corpus.slice(0, 4000)}
"""

GENERATED COPY:
"""
${input.generatedCopy.slice(0, 3000)}
"""

Find phrases in the copy that name a SPECIFIC authority as proof — a named institution/university (often with a location or department) or a named expert/scientist — used to borrow credibility.

For each, propose a GENERIC anchor that keeps the credibility but drops the specific name+location (e.g. "the Karolinska Institute in Sweden" → "researchers in Sweden"; "Harvard's Department of Neuroscience" → "a team at a leading university"; "Dr. Jane Smith of Stanford" → "a neurologist").

DO NOT flag:
- A name that appears in the SOURCE above (it's grounded — keep it).
- Already-generic mentions ("researchers", "doctors", "a study") — nothing to fix.
- The expert who fronts the destination video when named as the presenter (that's the CTA, not borrowed proof).

Copy the "excerpt" EXACTLY as it appears in the copy (including the article you want replaced along with it), so it can be swapped by exact match.

Output (JSON only, max 6 items):
{ "anchors": [
  { "excerpt": "exact phrase from the copy", "suggestion": "generic replacement", "reason": "short reason" }
]}`;

  try {
    const raw = await callClaude(systemPrompt, userPrompt, 1000);
    const cleaned = raw
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    const anchors = Array.isArray(parsed.anchors) ? parsed.anchors : [];
    return anchors
      .filter(
        (a: any) =>
          a &&
          typeof a.excerpt === 'string' &&
          a.excerpt.trim().length > 0 &&
          typeof a.suggestion === 'string' &&
          a.suggestion.trim().length > 0 &&
          // só vale se o trecho realmente existe na copy (troca por match exato)
          input.generatedCopy.includes(a.excerpt.trim())
      )
      .slice(0, 6)
      .map((a: any) => ({
        excerpt: a.excerpt.trim().slice(0, 200),
        suggestion: a.suggestion.trim().slice(0, 200),
        reason: (a.reason || '').toString().trim().slice(0, 200),
      }));
  } catch (err: any) {
    console.warn('[detectNamedAuthorities] falhou:', err?.message);
    return [];
  }
}

// ─────────────────────────────────────────────
// UX25-C2 — APPROX COST ESTIMATION
// ─────────────────────────────────────────────
/**
 * Estima custo de uma geração com base em chars de input + output e modelo.
 * Não é exato (não temos retorno do server com tokens reais), mas dá uma
 * faixa razoável. Heurística: ~4 chars/token em PT/EN.
 *
 * Preços oficiais Anthropic (atualizados em 2025):
 *   - Opus 4.7: $15/1M input, $75/1M output
 *   - Sonnet 4.6: $3/1M input, $15/1M output
 *
 * Quando há extended thinking (Opus default), o output efetivo é ~1.5x
 * maior internamente. Aplicamos um multiplicador conservador 1.3x.
 */
export function estimateCopyCost(input: {
  inputTokens: number;
  outputChars: number;
  model: 'opus' | 'sonnet';
  withThinking?: boolean;
}): { cost: number; outputTokens: number } {
  const outputTokens = Math.ceil(input.outputChars / 4);
  const thinkingMultiplier = input.withThinking !== false && input.model === 'opus' ? 1.3 : 1;

  const prices: Record<'opus' | 'sonnet', { input: number; output: number }> = {
    opus: { input: 15, output: 75 },
    sonnet: { input: 3, output: 15 },
  };
  const p = prices[input.model];

  // Preços por 1M tokens
  const cost =
    (input.inputTokens * p.input) / 1_000_000 +
    (outputTokens * thinkingMultiplier * p.output) / 1_000_000;

  return { cost, outputTokens };
}
