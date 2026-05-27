/**
 * UX28 — Smart Monthly Plan Calibration
 *
 * Pure (no I/O) module que recebe sinais do projeto + inputs do user
 * e devolve um plano mensal calibrado: quantos criativos por semana,
 * distribuição de tamanho, intensidade de modeling, dicas de budget.
 *
 * Filosofia: o plano de marketing tem que ADAPTAR ao caso (high vs
 * low ticket, VSL longa vs curta, audiência velha vs nova, afiliado
 * vs dono, etc). Antes era one-size-fits-all.
 *
 * Sinais que tentamos puxar do productInfo (já analisado da VSL):
 *   - vertical (saude/emagrecimento/financas/etc)
 *   - awareness target (1-5)
 *   - demografia hints (idade, perfil)
 *   - vslLengthMinutes (do upload, se houver)
 *   - saturation (heurística pelo vertical)
 *
 * Inputs do user (4 perguntas):
 *   - commissionPct
 *   - avgOrderValue (ou range)
 *   - dailyBudgetUsd
 *   - profile (newcomer/scaling/serious/agency)
 */

export type AwarenessLevel = '1' | '2' | '3' | '4' | '5';
export type ProfileLevel = 'newcomer' | 'scaling' | 'serious' | 'agency';
export type SaturationLevel = 'low' | 'medium' | 'high';

/** Sinais que tentamos extrair automaticamente do projeto. */
export interface ProjectSignals {
  vertical?: string;
  /** Schwartz awareness — quanto mais frio (1-2), mais long-form */
  awareness?: AwarenessLevel;
  /** Hint demográfico ("55+", "mães 30-40", etc) — string livre */
  demographic?: string;
  /** Duração da VSL em minutos, se aplicável */
  vslLengthMinutes?: number;
  /** Saturação do vertical — heurística baseada em vertical comum */
  saturation?: SaturationLevel;
}

/** Inputs do user no formulário do plano mensal. */
export interface MonthlyPlanInputs {
  commissionPct: number;
  /** AOV médio — pode ser média ponderada de múltiplas ofertas */
  avgOrderValue: number;
  dailyBudgetUsd: number;
  profile: ProfileLevel;
  /** IDs de copies da biblioteca pessoal pra usar como modelo */
  modelReferenceCopyIds?: string[];
}

/** Output: plano mensal calibrado, pronto pra gerar briefs. */
export interface CalibratedMonthlyPlan {
  budgetHints: {
    minimum: number;
    recommended: number;
    ideal: number;
    rationale: string;
  };
  /** Distribuição percentual — soma 100 */
  lengthDistribution: {
    short: number;
    medium: number;
    long: number;
  };
  /** Targets por semana */
  weeklyTargets: {
    week1: number;
    week2: number;
    week3: number;
    week4: number;
  };
  /** Total ao longo do mês */
  monthlyTotal: number;
  /** % de briefs que devem ser modelagem de referência (0 se não há refs) */
  modelingIntensity: number;
  /** Regras de scaling sugeridas — strings pra mostrar no UI */
  scalingRules: string[];
  /** Diagnóstico vs sugestão (under-budget, over-budget, etc) */
  budgetVerdict:
    | 'below-minimum'
    | 'below-recommended'
    | 'recommended'
    | 'above-recommended'
    | 'ideal+';
  /** Estimativa de tempo até breakthrough */
  breakthroughEstimate: string;
}

// ────────────────────────────────────────────────────────────────────
// Heurística de saturação por vertical
// ────────────────────────────────────────────────────────────────────
/**
 * Verticais de afiliado tradicionalmente saturados (muitos rodando o
 * mesmo creative) precisam de mais variação/volume pra furar a bolha.
 */
function inferSaturation(vertical?: string): SaturationLevel {
  if (!vertical) return 'medium';
  const v = vertical.toLowerCase();
  // Verticais ULTRA saturados em afiliado
  if (/(saude|health|supplement|neuropathy|diabetes|prostate|joint|memory)/.test(v)) return 'high';
  if (/(emagre|weight.?loss|keto|diet|belly|fat)/.test(v)) return 'high';
  if (/(make.?money|wealth|trading|crypto|side.?hustle|renda.?extra)/.test(v)) return 'high';
  // Verticais médios
  if (/(beauty|beleza|skincare|hair|cabelo)/.test(v)) return 'medium';
  if (/(info.?produto|course|mentoria|workshop)/.test(v)) return 'medium';
  // Mais low-comp
  if (/(spiritual|esp[ií]ritu|tarot|astrolog)/.test(v)) return 'low';
  if (/(fisico|gadget|tool|saas|b2b)/.test(v)) return 'low';
  return 'medium';
}

/**
 * Extrai sinais do productInfo (objeto livre vindo da análise da VSL).
 * Best-effort — campos podem estar undefined. Não falha.
 */
export function inferProjectSignals(productInfo: any): ProjectSignals {
  const out: ProjectSignals = {};
  if (!productInfo) return out;

  // Vertical pode vir explicit ou ser inferida do texto
  out.vertical = productInfo.vertical || productInfo.categoria || productInfo.category || undefined;

  // Awareness pode vir explicit
  const aw = productInfo.awarenessLevel || productInfo.awareness;
  if (typeof aw === 'string' && /^[1-5]/.test(aw)) {
    out.awareness = aw.charAt(0) as AwarenessLevel;
  }

  // Demographic hints — vem do persona ou audience
  out.demographic =
    productInfo.demographic ||
    productInfo.audience ||
    productInfo.publico ||
    productInfo.targetAudience ||
    undefined;

  // VSL length — pode vir do upload metadata
  const vlen = productInfo.vslLengthMinutes || productInfo.vslDurationMinutes;
  if (typeof vlen === 'number' && vlen > 0) out.vslLengthMinutes = vlen;

  // Saturação derivada
  out.saturation = inferSaturation(out.vertical);

  return out;
}

// ────────────────────────────────────────────────────────────────────
// Budget hints — dado AOV + comissão, sugere min/recommended/ideal
// ────────────────────────────────────────────────────────────────────
/**
 * Calcula faixas de orçamento diário recomendadas baseado em AOV
 * comm. A lógica é: cada anúncio precisa de spend suficiente pra
 * ser estatisticamente significante (~$30-50 por creative pra
 * descobrir se é winner ou não).
 *
 * - Minimum: ~30% do commission/sale (testando lento, learning phase
 *   dolorosa, breakthrough em 35-50d)
 * - Recommended: ~60-70% do commission/sale (sweet spot — breakthrough
 *   em 14-21d)
 * - Ideal: ~150%+ do commission/sale (volume real, breakthrough em
 *   7-14d, scale rápido)
 *
 * Mínimos absolutos pra qualquer caso: $30, $60, $150.
 */
export function calculateBudgetHints(
  commissionPct: number,
  avgOrderValue: number,
  saturation: SaturationLevel = 'medium'
): CalibratedMonthlyPlan['budgetHints'] {
  const commPerSale = (avgOrderValue * commissionPct) / 100;

  // Multiplier por saturação — verticais saturados precisam mais budget
  const satMult: Record<SaturationLevel, number> = {
    low: 0.85,
    medium: 1.0,
    high: 1.2,
  };
  const k = satMult[saturation];

  const minimum = Math.max(30, Math.round(commPerSale * 0.3 * k));
  const recommended = Math.max(60, Math.round(commPerSale * 0.65 * k));
  const ideal = Math.max(150, Math.round(commPerSale * 1.5 * k));

  const rationale = `Comissão média ~$${commPerSale.toFixed(0)}/venda. Saturação ${saturation}.
- Mínimo: roda devagar, descoberta de winner ~35-50 dias.
- Recomendado: sweet spot pro seu caso, breakthrough ~14-21d.
- Ideal: volume real, breakthrough rápido + scale agressivo.`;

  return { minimum, recommended, ideal, rationale };
}

// ────────────────────────────────────────────────────────────────────
// Length distribution — % curto/médio/longo
// ────────────────────────────────────────────────────────────────────
/**
 * Distribuição padrão 2025: 25/55/20 (curto/médio/longo).
 *
 * Modifiers:
 *   - awareness 1 (very cold)      → +10% long  (precisa DR depth)
 *   - awareness 5 (hot/aware)      → -10% long, +10% short
 *   - demographic 55+              → +5% long
 *   - demographic 18-34            → +10% short
 *   - vslLengthMinutes > 30        → +5% long
 *   - vslLengthMinutes < 10        → +10% short
 *   - saturation high              → +5% short (volume > depth)
 */
export function calibrateLengthDistribution(
  signals: ProjectSignals
): CalibratedMonthlyPlan['lengthDistribution'] {
  let short = 25;
  let medium = 55;
  let long = 20;

  // Awareness
  if (signals.awareness === '1') {
    long += 10;
    medium -= 10;
  } else if (signals.awareness === '5') {
    long -= 10;
    short += 10;
  }

  // Demographic
  if (signals.demographic) {
    const d = signals.demographic.toLowerCase();
    if (/55|60|65|aposent|elder|idos/.test(d)) {
      long += 5;
      short -= 5;
    } else if (/18|19|2[0-4]|young|jovem|gen.?z/.test(d)) {
      short += 10;
      long -= 5;
      medium -= 5;
    }
  }

  // VSL length
  if (signals.vslLengthMinutes) {
    if (signals.vslLengthMinutes > 30) {
      long += 5;
      short -= 5;
    } else if (signals.vslLengthMinutes < 10) {
      short += 10;
      long -= 5;
      medium -= 5;
    }
  }

  // Saturation
  if (signals.saturation === 'high') {
    short += 5;
    long -= 5;
  } else if (signals.saturation === 'low') {
    short -= 5;
    medium += 5;
  }

  // Sanity: clamp & re-normalize to 100
  short = Math.max(10, short);
  medium = Math.max(20, medium);
  long = Math.max(5, long);
  const sum = short + medium + long;
  short = Math.round((short / sum) * 100);
  medium = Math.round((medium / sum) * 100);
  long = 100 - short - medium;

  return { short, medium, long };
}

// ────────────────────────────────────────────────────────────────────
// Weekly targets — quantos criativos por semana
// ────────────────────────────────────────────────────────────────────
/**
 * Targets de produção. Base do perfil + ajuste pelo budget vs hints.
 *
 *   newcomer  → 8 base
 *   scaling   → 12 base
 *   serious   → 16 base
 *   agency    → 24 base
 *
 * Distribuição W1>W3>W2>W4 (launch heavy, learning, scale, production).
 */
export function calibrateWeeklyTargets(
  profile: ProfileLevel,
  dailyBudgetUsd: number,
  hints: CalibratedMonthlyPlan['budgetHints']
): {
  weeklyTargets: CalibratedMonthlyPlan['weeklyTargets'];
  monthlyTotal: number;
  budgetVerdict: CalibratedMonthlyPlan['budgetVerdict'];
} {
  const baseByProfile: Record<ProfileLevel, number> = {
    newcomer: 8,
    scaling: 12,
    serious: 16,
    agency: 24,
  };
  const base = baseByProfile[profile];

  // Budget multiplier
  let multiplier = 1.0;
  let verdict: CalibratedMonthlyPlan['budgetVerdict'] = 'recommended';

  if (dailyBudgetUsd < hints.minimum) {
    multiplier = 0.5;
    verdict = 'below-minimum';
  } else if (dailyBudgetUsd < hints.recommended) {
    const ratio = (dailyBudgetUsd - hints.minimum) / (hints.recommended - hints.minimum);
    multiplier = 0.6 + ratio * 0.35; // 0.6 to 0.95
    verdict = 'below-recommended';
  } else if (dailyBudgetUsd < hints.ideal) {
    const ratio = (dailyBudgetUsd - hints.recommended) / (hints.ideal - hints.recommended);
    multiplier = 1.0 + ratio * 0.5; // 1.0 to 1.5
    verdict = 'above-recommended';
  } else {
    multiplier = 1.6;
    verdict = 'ideal+';
  }

  const baseAdjusted = base * multiplier;

  // Distribuição entre semanas — W1 lança forte, W2 aprendizado (-30%),
  // W3 escala (+10% acima do baseline), W4 produção (-20%)
  const week1 = Math.max(4, Math.round(baseAdjusted * 1.0));
  const week2 = Math.max(3, Math.round(baseAdjusted * 0.7));
  const week3 = Math.max(3, Math.round(baseAdjusted * 0.85));
  const week4 = Math.max(3, Math.round(baseAdjusted * 0.6));

  return {
    weeklyTargets: { week1, week2, week3, week4 },
    monthlyTotal: week1 + week2 + week3 + week4,
    budgetVerdict: verdict,
  };
}

// ────────────────────────────────────────────────────────────────────
// Modeling intensity — % de briefs que viram modelagem
// ────────────────────────────────────────────────────────────────────
/**
 * Quando tem ref copies disponíveis, sugere % de briefs que devem ser
 * variações. Saturação alta → mais modelagem (você precisa diferenciar
 * de competição, mas mantendo o que funciona).
 *
 * Retorna 0 quando não há refs.
 */
export function calibrateModelingIntensity(
  hasReferences: boolean,
  saturation: SaturationLevel = 'medium'
): number {
  if (!hasReferences) return 0;
  const baseByS: Record<SaturationLevel, number> = {
    low: 15,
    medium: 25,
    high: 35,
  };
  return baseByS[saturation];
}

// ────────────────────────────────────────────────────────────────────
// Scaling rules — strings informativas pro user seguir
// ────────────────────────────────────────────────────────────────────
function buildScalingRules(hints: CalibratedMonthlyPlan['budgetHints']): string[] {
  const cpaTarget50 = Math.round(hints.recommended * 0.5);
  const cpaTarget100 = hints.recommended;
  return [
    `CPA < $${cpaTarget50} E ROAS > 2x após 72h → dobra budget desse ad set`,
    `CPA $${cpaTarget50}-$${cpaTarget100} → mantém, observa mais 48h`,
    `CPA > $${cpaTarget100} sem tendência → KILL`,
    `CTR < 0.8% → KILL (hook fraco, não a oferta)`,
    `Frequency > 2.5x sem vendas → KILL (audiência fadigada)`,
    `Quando winner consolidado: 5 variações em ~24-48h pra escalar barato`,
  ];
}

// ────────────────────────────────────────────────────────────────────
// Breakthrough estimate
// ────────────────────────────────────────────────────────────────────
function estimateBreakthrough(
  verdict: CalibratedMonthlyPlan['budgetVerdict'],
  saturation: SaturationLevel
): string {
  const lookup: Record<typeof verdict, string> = {
    'below-minimum': 'incerto (45-60+ dias) — learning phase vai doer',
    'below-recommended': '21-35 dias',
    recommended: '14-21 dias',
    'above-recommended': '10-18 dias',
    'ideal+': '7-14 dias',
  };
  let base = lookup[verdict];
  if (saturation === 'high') base += ' (vertical saturado — pode levar mais)';
  return base;
}

// ────────────────────────────────────────────────────────────────────
// ENTRY POINT — calibra plano mensal a partir de signals + inputs
// ────────────────────────────────────────────────────────────────────
export function calibrateMonthlyPlan(
  signals: ProjectSignals,
  inputs: MonthlyPlanInputs
): CalibratedMonthlyPlan {
  const sat = signals.saturation || 'medium';
  const hints = calculateBudgetHints(inputs.commissionPct, inputs.avgOrderValue, sat);
  const lengthDistribution = calibrateLengthDistribution(signals);
  const weekly = calibrateWeeklyTargets(inputs.profile, inputs.dailyBudgetUsd, hints);
  const modelingIntensity = calibrateModelingIntensity(
    !!(inputs.modelReferenceCopyIds && inputs.modelReferenceCopyIds.length > 0),
    sat
  );

  return {
    budgetHints: hints,
    lengthDistribution,
    weeklyTargets: weekly.weeklyTargets,
    monthlyTotal: weekly.monthlyTotal,
    budgetVerdict: weekly.budgetVerdict,
    modelingIntensity,
    scalingRules: buildScalingRules(hints),
    breakthroughEstimate: estimateBreakthrough(weekly.budgetVerdict, sat),
  };
}
