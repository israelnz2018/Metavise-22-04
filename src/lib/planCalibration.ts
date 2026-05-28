/**
 * UX28/29 — Smart Monthly Plan Calibration
 *
 * Pure (no I/O) module que recebe sinais do projeto + inputs do user
 * e devolve um plano mensal calibrado: quantos criativos por semana,
 * distribuição de tamanho, intensidade de modeling, dicas de budget,
 * REGRAS DE SCALING.
 *
 * UX29 mudanças importantes:
 *
 * 1) Volume é IDEAL — não capado por "user é solo". Todo cliente
 *    recebe o número que o algoritmo Meta 2025 quer pra performar.
 *    Se você não der conta de produzir, é problema seu pra resolver
 *    (template, time, ajustar pra baixo manualmente).
 *
 * 2) Inputs trocados: commission/AOV → productPrice/idealCPA.
 *    User não quer pensar em comissão; quer pensar em "preço do
 *    produto" e "quanto eu aceito pagar por uma venda".
 *
 * 3) Volume Strategy toggle: Conservador (era 2022) / Moderno
 *    (Advantage+ era) / Agressivo (top operations 250+/mês).
 *
 * 4) Profile NÃO reduz volume — só ajusta a CURVA de cadência (W1
 *    mais pesado pra serious/agency, mais distribuído pra newcomer).
 *
 * Sinais auto-extraídos do productInfo:
 *   - vertical, awareness, demographic, vslLengthMinutes, saturation
 *
 * Inputs do user (5 perguntas agora):
 *   - productPrice (oferta principal ou média)
 *   - idealCPA (custo aceitável por venda)
 *   - dailyBudgetUsd
 *   - profile (newcomer/scaling/serious/agency)
 *   - volumeStrategy (conservative/modern/aggressive)
 */

export type AwarenessLevel = '1' | '2' | '3' | '4' | '5';
export type ProfileLevel = 'newcomer' | 'scaling' | 'serious' | 'agency';
export type SaturationLevel = 'low' | 'medium' | 'high';
export type VolumeStrategy = 'conservative' | 'modern' | 'aggressive';

/** Sinais que tentamos extrair automaticamente do projeto. */
export interface ProjectSignals {
  vertical?: string;
  awareness?: AwarenessLevel;
  demographic?: string;
  vslLengthMinutes?: number;
  saturation?: SaturationLevel;
}

/** Inputs do user no formulário do plano mensal. */
export interface MonthlyPlanInputs {
  /** Preço do produto principal (ou média ponderada de múltiplas ofertas) */
  productPrice: number;
  /** Custo máximo aceitável por venda (target CPA) */
  idealCPA: number;
  dailyBudgetUsd: number;
  profile: ProfileLevel;
  volumeStrategy: VolumeStrategy;
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
  lengthDistribution: {
    short: number;
    medium: number;
    long: number;
  };
  weeklyTargets: {
    week1: number;
    week2: number;
    week3: number;
    week4: number;
  };
  monthlyTotal: number;
  modelingIntensity: number;
  scalingRules: string[];
  budgetVerdict:
    | 'below-minimum'
    | 'below-recommended'
    | 'recommended'
    | 'above-recommended'
    | 'ideal+';
  breakthroughEstimate: string;
  /** UX29: explica de onde veio o número de criativos pra user entender */
  volumeRationale: string;
}

// ────────────────────────────────────────────────────────────────────
// Heurística de saturação por vertical
// ────────────────────────────────────────────────────────────────────
function inferSaturation(vertical?: string): SaturationLevel {
  if (!vertical) return 'medium';
  const v = vertical.toLowerCase();
  if (/(saude|health|supplement|neuropathy|diabetes|prostate|joint|memory)/.test(v)) return 'high';
  if (/(emagre|weight.?loss|keto|diet|belly|fat)/.test(v)) return 'high';
  if (/(make.?money|wealth|trading|crypto|side.?hustle|renda.?extra)/.test(v)) return 'high';
  if (/(beauty|beleza|skincare|hair|cabelo)/.test(v)) return 'medium';
  if (/(info.?produto|course|mentoria|workshop)/.test(v)) return 'medium';
  if (/(spiritual|esp[ií]ritu|tarot|astrolog)/.test(v)) return 'low';
  if (/(fisico|gadget|tool|saas|b2b)/.test(v)) return 'low';
  return 'medium';
}

export function inferProjectSignals(productInfo: any): ProjectSignals {
  const out: ProjectSignals = {};
  if (!productInfo) return out;

  out.vertical = productInfo.vertical || productInfo.categoria || productInfo.category || undefined;

  const aw = productInfo.awarenessLevel || productInfo.awareness;
  if (typeof aw === 'string' && /^[1-5]/.test(aw)) {
    out.awareness = aw.charAt(0) as AwarenessLevel;
  }

  out.demographic =
    productInfo.demographic ||
    productInfo.audience ||
    productInfo.publico ||
    productInfo.targetAudience ||
    undefined;

  const vlen = productInfo.vslLengthMinutes || productInfo.vslDurationMinutes;
  if (typeof vlen === 'number' && vlen > 0) out.vslLengthMinutes = vlen;

  out.saturation = inferSaturation(out.vertical);

  return out;
}

// ────────────────────────────────────────────────────────────────────
// UX29: Budget hints — baseado em idealCPA (não em commission)
// ────────────────────────────────────────────────────────────────────
/**
 * Sem commission, o que importa é: quanto budget dá pra absorver
 * a learning phase e gerar volume estatístico?
 *
 * - Minimum: 2x idealCPA/dia (você consegue 1 venda a cada 2 dias
 *   no breakeven — learning phase vai doer mas é possível)
 * - Recommended: 4x idealCPA/dia (2 vendas/dia esperadas em winner,
 *   permite testar várias ad sets simultâneas)
 * - Ideal: 10x idealCPA/dia (volume real, múltiplas campanhas,
 *   scale agressivo)
 *
 * Floors absolutos: $30, $60, $150.
 */
export function calculateBudgetHints(
  idealCPA: number,
  saturation: SaturationLevel = 'medium'
): CalibratedMonthlyPlan['budgetHints'] {
  // Multiplier por saturação
  const satMult: Record<SaturationLevel, number> = {
    low: 0.85,
    medium: 1.0,
    high: 1.2,
  };
  const k = satMult[saturation];

  const minimum = Math.max(30, Math.round(idealCPA * 2 * k));
  const recommended = Math.max(60, Math.round(idealCPA * 4 * k));
  const ideal = Math.max(150, Math.round(idealCPA * 10 * k));

  const rationale = `CPA alvo: $${idealCPA}. Saturação ${saturation}.
- Mínimo (${minimum}/d): 1 venda a cada 2 dias em winner, learning phase dolorosa.
- Recomendado (${recommended}/d): 2-3 vendas/dia, testa múltiplos ad sets simultâneos.
- Ideal (${ideal}/d): volume real, múltiplas campanhas, scale agressivo.`;

  return { minimum, recommended, ideal, rationale };
}

// ────────────────────────────────────────────────────────────────────
// UX29: Length distribution — mantém lógica anterior (já estava OK)
// ────────────────────────────────────────────────────────────────────
export function calibrateLengthDistribution(
  signals: ProjectSignals
): CalibratedMonthlyPlan['lengthDistribution'] {
  let short = 25;
  let medium = 55;
  let long = 20;

  if (signals.awareness === '1') {
    long += 10;
    medium -= 10;
  } else if (signals.awareness === '5') {
    long -= 10;
    short += 10;
  }

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

  if (signals.saturation === 'high') {
    short += 5;
    long -= 5;
  } else if (signals.saturation === 'low') {
    short -= 5;
    medium += 5;
  }

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
// UX29: Weekly targets — volume puxado de BUDGET + STRATEGY
// ────────────────────────────────────────────────────────────────────
/**
 * Volume é função primária de:
 *   1) Daily budget (fonte real do volume)
 *   2) Volume strategy (Conservador/Moderno/Agressivo) — define
 *      $/criativo "feeding rate"
 *
 * Profile NÃO reduz volume — só ajusta a CURVA semanal:
 *   - Newcomer ramp-up gradual (W1=20%, W4=25%)
 *   - Agency front-load pesado (W1=40%, W4=15%)
 *
 * Volume Strategy define $/creative (feeding rate do Advantage+):
 *   - Conservative: $30/criativo (era 2022, valida 1 por 1)
 *   - Modern: $13/criativo (Advantage+ era, default) ⭐
 *   - Aggressive: $7/criativo (top operations 250+/mês, batch creative)
 *
 * Floor: 16 criativos/mês mínimo (qualquer estratégia). Sem isso o
 * Meta não tem material pra learning phase decente.
 */
export function calibrateWeeklyTargets(
  profile: ProfileLevel,
  dailyBudgetUsd: number,
  hints: CalibratedMonthlyPlan['budgetHints'],
  volumeStrategy: VolumeStrategy = 'modern'
): {
  weeklyTargets: CalibratedMonthlyPlan['weeklyTargets'];
  monthlyTotal: number;
  budgetVerdict: CalibratedMonthlyPlan['budgetVerdict'];
  volumeRationale: string;
} {
  // $/creative por estratégia
  const spendPerCreative: Record<VolumeStrategy, number> = {
    conservative: 30,
    modern: 13,
    aggressive: 7,
  };
  const strategyLabel: Record<VolumeStrategy, string> = {
    conservative: 'Conservador (valida 1 por 1)',
    modern: 'Moderno (Advantage+)',
    aggressive: 'Agressivo (volume era)',
  };

  // Volume base do mês: budget mensal / $/criativo
  const monthlyBudget = dailyBudgetUsd * 30;
  let monthlyTotal = Math.round(monthlyBudget / spendPerCreative[volumeStrategy]);

  // Floor de 16 — qualquer estratégia precisa de material mínimo
  monthlyTotal = Math.max(16, monthlyTotal);

  // Cap superior — 500/mês é além do realista mesmo pra agências top
  monthlyTotal = Math.min(500, monthlyTotal);

  // Distribuição semanal — depende do PROFILE (não reduz volume, só
  // ajusta a forma da curva)
  const curve: Record<ProfileLevel, [number, number, number, number]> = {
    newcomer: [0.2, 0.25, 0.3, 0.25], // ramp-up gradual
    scaling: [0.3, 0.25, 0.25, 0.2], // moderado front-load
    serious: [0.35, 0.25, 0.25, 0.15], // heavy launch
    agency: [0.4, 0.25, 0.2, 0.15], // massive launch, fast iteration
  };
  const [c1, c2, c3, c4] = curve[profile];

  const week1 = Math.max(3, Math.round(monthlyTotal * c1));
  const week2 = Math.max(2, Math.round(monthlyTotal * c2));
  const week3 = Math.max(2, Math.round(monthlyTotal * c3));
  const week4 = Math.max(2, Math.round(monthlyTotal * c4));

  // Ajusta monthlyTotal pra match a soma real
  const actualTotal = week1 + week2 + week3 + week4;

  // Budget verdict
  let verdict: CalibratedMonthlyPlan['budgetVerdict'] = 'recommended';
  if (dailyBudgetUsd < hints.minimum) verdict = 'below-minimum';
  else if (dailyBudgetUsd < hints.recommended) verdict = 'below-recommended';
  else if (dailyBudgetUsd < hints.ideal) verdict = 'above-recommended';
  else verdict = 'ideal+';

  const volumeRationale = `Volume: $${dailyBudgetUsd}/dia × 30 = $${monthlyBudget}/mês ÷ $${spendPerCreative[volumeStrategy]}/criativo (${strategyLabel[volumeStrategy]}) = ${actualTotal} criativos/mês. Cadência ${profile} distribui em S1:${Math.round(c1 * 100)}% S2:${Math.round(c2 * 100)}% S3:${Math.round(c3 * 100)}% S4:${Math.round(c4 * 100)}%.`;

  return {
    weeklyTargets: { week1, week2, week3, week4 },
    monthlyTotal: actualTotal,
    budgetVerdict: verdict,
    volumeRationale,
  };
}

// ────────────────────────────────────────────────────────────────────
// Modeling intensity — mantém lógica
// ────────────────────────────────────────────────────────────────────
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
// Scaling rules — agora puxam idealCPA do user (não 50% commission)
// ────────────────────────────────────────────────────────────────────
function buildScalingRules(idealCPA: number): string[] {
  const cpaTarget50 = Math.round(idealCPA * 0.5);
  return [
    `CPA < $${cpaTarget50} E ROAS > 2x após 72h → dobra budget desse ad set`,
    `CPA $${cpaTarget50}-$${idealCPA} → mantém, observa mais 48h`,
    `CPA > $${idealCPA} sem tendência → KILL (acima do alvo)`,
    `CTR < 0.8% → KILL (hook fraco, não a oferta)`,
    `Frequency > 2.5x sem vendas → KILL (audiência fadigada)`,
    `Quando winner consolidado: 5-10 variações em 24-48h pra escalar barato`,
    `Refresh criativos novos a cada 3-5 dias mesmo nos winners (fadiga inevitável)`,
  ];
}

// ────────────────────────────────────────────────────────────────────
// Breakthrough estimate
// ────────────────────────────────────────────────────────────────────
function estimateBreakthrough(
  verdict: CalibratedMonthlyPlan['budgetVerdict'],
  saturation: SaturationLevel,
  volumeStrategy: VolumeStrategy
): string {
  const lookup: Record<CalibratedMonthlyPlan['budgetVerdict'], string> = {
    'below-minimum': 'incerto (45-60+ dias) — learning phase vai doer',
    'below-recommended': '21-35 dias',
    recommended: '14-21 dias',
    'above-recommended': '10-18 dias',
    'ideal+': '7-14 dias',
  };
  let base = lookup[verdict];
  if (saturation === 'high') base += ' (vertical saturado — pode levar mais)';
  if (volumeStrategy === 'aggressive') base += ' · volume agressivo acelera';
  return base;
}

// ────────────────────────────────────────────────────────────────────
// ENTRY POINT — calibra plano mensal
// ────────────────────────────────────────────────────────────────────
export function calibrateMonthlyPlan(
  signals: ProjectSignals,
  inputs: MonthlyPlanInputs
): CalibratedMonthlyPlan {
  const sat = signals.saturation || 'medium';
  const hints = calculateBudgetHints(inputs.idealCPA, sat);
  const lengthDistribution = calibrateLengthDistribution(signals);
  const weekly = calibrateWeeklyTargets(
    inputs.profile,
    inputs.dailyBudgetUsd,
    hints,
    inputs.volumeStrategy
  );
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
    scalingRules: buildScalingRules(inputs.idealCPA),
    breakthroughEstimate: estimateBreakthrough(weekly.budgetVerdict, sat, inputs.volumeStrategy),
    volumeRationale: weekly.volumeRationale,
  };
}
