/**
 * UX14 — System Copy Library
 *
 * Biblioteca curada de exemplos de copy de alta qualidade. Usada como
 * few-shot examples no prompt de geração de copy. Idéia: modelos ficam
 * muito melhores quando têm 2-3 EXEMPLOS reais do estilo desejado em
 * vez de só REGRAS.
 *
 * Cada exemplo é sintético (escrito do zero) mas modelado em padrões de
 * copywriters reconhecidos: Eugene Schwartz, Gary Halbert, Stefan Georgi
 * (RMBC method), Dan Kennedy. Tom direto, especificidade alta, sem
 * "smell de IA" (vícios tipo "no mundo de hoje", "está prestes a", etc).
 *
 * Estrutura: cada copy tem vertical, ângulo, awareness, lingua. O
 * algoritmo de seleção em claudeService escolhe 2-3 mais alinhados ao
 * brief atual e injeta no prompt.
 *
 * Cliente pode adicionar a própria biblioteca via Firestore (UX18) —
 * algoritmo prefere as do cliente, cai pro sistema como fallback.
 */

export type CopyVertical =
  | 'saude' // suplementos, dor, sono, ansiedade, nutrição
  | 'emagrecimento' // perda de peso, diet, fitness, low-carb
  | 'financas' // renda extra, investimento, dropshipping
  | 'info_produto' // curso, mentoria, comunidade
  | 'beleza' // skincare, anti-aging, cabelo
  | 'fisico' // gadget, ferramenta, casa, lifestyle
  | 'espiritual'; // tarot, oração, mapa astral, autoconhecimento

export type AwarenessLevel = '1' | '2' | '3' | '4' | '5';

export interface CopyExample {
  id: string;
  vertical: CopyVertical;
  /** Schwartz awareness: 1=unaware, 5=most aware */
  awareness: AwarenessLevel;
  /** Ângulo principal — frases curtas pra match com brief.angle */
  angle: string;
  /** Idioma. 'pt' inclui PT-BR. 'en' incluí EN-US. */
  language: 'pt' | 'en';
  /** O texto da copy (script completo, ~150-250 palavras) */
  script: string;
  /** Por que essa copy é boa — usado em comentário no prompt pra ancorar
   *  o que o modelo deve imitar. Não é mostrado pro user. */
  whyItWorks: string;
}

// ════════════════════════════════════════════════════════════════════
// SYSTEM LIBRARY (vazia por padrão — adicione abaixo conforme curar
// exemplos reais que converteram). Formato:
//   { id, vertical, awareness, angle, language, script, whyItWorks }
// Cliente também pode subir copies próprias via "Minhas" no modal
// (UX18) — essas têm prioridade sobre as do sistema.
// ════════════════════════════════════════════════════════════════════
export const COPY_LIBRARY: CopyExample[] = [
  // Vazio até a equipe Metavise adicionar exemplos reais aqui.
  // Estrutura mantida pra fácil expansão futura.
];

// ────────────────────────────────────────────────────────────────────
// SELEÇÃO INTELIGENTE — qual exemplo entra no prompt
// ────────────────────────────────────────────────────────────────────

interface SelectionInput {
  /** Idioma do anúncio em geração ('pt' inclui PT-BR, 'en' inclui EN-US). */
  language: 'pt' | 'en';
  /** Inferida do brief/persona/productInfo. Optional — se ausente, pega
   *  qualquer vertical (pegando preferencialmente os mesmos awareness). */
  vertical?: CopyVertical;
  /** Nível de consciência alvo. Used como tiebreaker. */
  awareness?: AwarenessLevel;
  /** Ângulo do brief — used pra match fuzzy. */
  angleHint?: string;
  /** Quantos exemplos retornar (default 2). 2-3 é o sweet spot. */
  count?: number;
  /** Exemplos do cliente (UX18 — biblioteca pessoal). Quando presente,
   *  esses entram com prioridade ANTES do sistema. */
  clientLibrary?: CopyExample[];
}

/** Heurística leve pra mapear vertical baseado em productInfo. */
export function inferVertical(productInfo: any): CopyVertical | undefined {
  if (!productInfo) return undefined;
  const text = [
    productInfo.produto,
    productInfo.oferta,
    productInfo.dorPrincipal,
    productInfo.productName,
    productInfo.audience,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (
    /(suplement|cápsula|capsule|dor|sono|ansiedade|saúde|vitamin|colágeno|magnésio)/.test(text)
  )
    return 'saude';
  if (/(emagre|peso|gordur|low.?carb|diet|kg|quilos|barriga|cintura|abdom)/.test(text))
    return 'emagrecimento';
  if (
    /(invest|trading|renda extra|dropshipping|ação|cripto|finança|dinheiro|salário|side hustle)/.test(
      text,
    )
  )
    return 'financas';
  if (/(curso|mentoria|workshop|treinamento|aula|método|fórmula|community|membership)/.test(text))
    return 'info_produto';
  if (/(skincare|creme|sérum|antiaging|anti.?aging|cabelo|botox|ruga|colágeno)/.test(text))
    return 'beleza';
  if (/(tarot|mapa astral|astrolog|oração|reza|espírito|chacra|cristal|terapia)/.test(text))
    return 'espiritual';
  // Fallback genérico
  return 'fisico';
}

/** Retorna até `count` exemplos relevantes pro prompt. Prioridade:
 *  1) Cliente library da mesma vertical (até count)
 *  2) Cliente library de OUTRAS verticais (preenche resto)
 *  3) Sistema library da mesma vertical
 *  4) Sistema library de outras verticais (preenche resto)
 *
 *  UX22: quando clientLibrary representa SELEÇÃO MANUAL do user (passada
 *  já filtrada pra conter só as marcadas), também filtra por idioma mas
 *  preserva a ordem original e ignora vertical/awareness — user já curou.
 */
export function selectCopyExamples(input: SelectionInput): CopyExample[] {
  const { language, vertical, awareness, count = 2, clientLibrary = [] } = input;

  const langMatches = (e: CopyExample) => e.language === language;
  const sortByRelevance = (a: CopyExample, b: CopyExample) => {
    // Same vertical wins
    const aV = vertical && a.vertical === vertical ? 1 : 0;
    const bV = vertical && b.vertical === vertical ? 1 : 0;
    if (aV !== bV) return bV - aV;
    // Same awareness wins
    if (awareness) {
      const aA = a.awareness === awareness ? 1 : 0;
      const bA = b.awareness === awareness ? 1 : 0;
      if (aA !== bA) return bA - aA;
    }
    return 0;
  };

  const clientFiltered = clientLibrary.filter(langMatches).sort(sortByRelevance);
  const systemFiltered = COPY_LIBRARY.filter(langMatches).sort(sortByRelevance);

  // Concatena cliente primeiro, sistema depois. Dedupa por id.
  const seen = new Set<string>();
  const result: CopyExample[] = [];
  for (const e of [...clientFiltered, ...systemFiltered]) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    result.push(e);
    if (result.length >= count) break;
  }
  return result;
}
