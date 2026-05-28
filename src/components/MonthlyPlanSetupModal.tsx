/**
 * UX28-C / UX29 — Monthly Plan Setup Modal
 *
 * 5 inputs (preço / CPA ideal / budget / perfil / volume strategy)
 * + opcional seleção de copies pra modelar.
 *
 * UX29 mudanças:
 *  - Removeu commission% + AOV
 *  - Adicionou productPrice + idealCPA (mais simples e direto)
 *  - Adicionou volumeStrategy toggle (Conservador/Moderno/Agressivo)
 *  - Volume agora reflete ideal real do Meta 2025 (não capa solo)
 */

import { useState, useMemo } from 'react';
import { X, Sparkles, DollarSign, Users, Library, Target, Zap, Gauge } from 'lucide-react';
import {
  calculateBudgetHints,
  calibrateMonthlyPlan,
  inferProjectSignals,
  type ProfileLevel,
  type VolumeStrategy,
  type CalibratedMonthlyPlan,
} from '@/lib/planCalibration';
import type { MonthlyPlanConfig } from '@/types/project';
import type { PersonalCopyDoc } from '@/lib/personalCopyLibrary';

interface Props {
  open: boolean;
  onClose: () => void;
  productInfo: any;
  initialConfig?: MonthlyPlanConfig | null;
  personalLibrary: PersonalCopyDoc[];
  onSubmit: (config: MonthlyPlanConfig, calibrated: CalibratedMonthlyPlan) => void;
}

const PROFILE_LABELS: Record<ProfileLevel, { label: string; desc: string }> = {
  newcomer: {
    label: 'Iniciante',
    desc: 'Ramp gradual — semana 1 leve, vai subindo',
  },
  scaling: {
    label: 'Escalando',
    desc: 'Moderado — lançamento +- forte, depois pico em S3',
  },
  serious: {
    label: 'Sério estabelecido',
    desc: 'Heavy launch — S1 pesado, refina rápido',
  },
  agency: {
    label: 'Agência / Time',
    desc: 'Massive launch — S1 quase metade do mês, iteração rápida',
  },
};

const VOLUME_STRATEGY_LABELS: Record<
  VolumeStrategy,
  { label: string; desc: string; perCreative: string; era: string }
> = {
  conservative: {
    label: 'Conservador',
    desc: 'Valida criativo por criativo · pouco volume · era 2022',
    perCreative: '$30/criativo',
    era: 'antigo',
  },
  modern: {
    label: 'Moderno (Advantage+)',
    desc: 'Advantage+ Creative Optimization · volume médio-alto · default 2025',
    perCreative: '$13/criativo',
    era: '⭐ default',
  },
  aggressive: {
    label: 'Agressivo (250+/mês)',
    desc: 'Top operações · batch creative · volume era · times grandes',
    perCreative: '$7/criativo',
    era: '🚀 top tier',
  },
};

export default function MonthlyPlanSetupModal({
  open,
  onClose,
  productInfo,
  initialConfig,
  personalLibrary,
  onSubmit,
}: Props) {
  // UX29: novos inputs
  const [productPrice, setProductPrice] = useState(initialConfig?.productPrice ?? 100);
  const [idealCPA, setIdealCPA] = useState(initialConfig?.idealCPA ?? 50);
  const [dailyBudgetUsd, setDailyBudgetUsd] = useState(initialConfig?.dailyBudgetUsd ?? 60);
  const [profile, setProfile] = useState<ProfileLevel>(initialConfig?.profile ?? 'scaling');
  const [volumeStrategy, setVolumeStrategy] = useState<VolumeStrategy>(
    initialConfig?.volumeStrategy ?? 'modern'
  );
  const [modelReferenceCopyIds, setModelReferenceCopyIds] = useState<string[]>(
    initialConfig?.modelReferenceCopyIds ?? []
  );

  const signals = useMemo(() => inferProjectSignals(productInfo), [productInfo]);

  const hints = useMemo(
    () => calculateBudgetHints(idealCPA, signals.saturation),
    [idealCPA, signals.saturation]
  );

  const preview = useMemo(
    () =>
      calibrateMonthlyPlan(signals, {
        productPrice,
        idealCPA,
        dailyBudgetUsd,
        profile,
        volumeStrategy,
        modelReferenceCopyIds,
      }),
    [
      signals,
      productPrice,
      idealCPA,
      dailyBudgetUsd,
      profile,
      volumeStrategy,
      modelReferenceCopyIds,
    ]
  );

  if (!open) return null;

  const handleSubmit = () => {
    const config: MonthlyPlanConfig = {
      productPrice,
      idealCPA,
      dailyBudgetUsd,
      profile,
      volumeStrategy,
      modelReferenceCopyIds,
      calibrated: {
        budgetHints: preview.budgetHints,
        lengthDistribution: preview.lengthDistribution,
        weeklyTargets: preview.weeklyTargets,
        monthlyTotal: preview.monthlyTotal,
        modelingIntensity: preview.modelingIntensity,
        scalingRules: preview.scalingRules,
        budgetVerdict: preview.budgetVerdict,
        breakthroughEstimate: preview.breakthroughEstimate,
        volumeRationale: preview.volumeRationale,
      },
      generatedAt: Date.now(),
    };
    onSubmit(config, preview);
  };

  const verdictColor: Record<string, string> = {
    'below-minimum': 'text-red-600 dark:text-red-400',
    'below-recommended': 'text-amber-600 dark:text-amber-400',
    recommended: 'text-green-600 dark:text-green-400',
    'above-recommended': 'text-blue-600 dark:text-blue-400',
    'ideal+': 'text-purple-600 dark:text-purple-400',
  };
  const verdictLabel: Record<string, string> = {
    'below-minimum': '⚠️ Abaixo do mínimo viável — learning phase vai doer',
    'below-recommended': 'Abaixo do recomendado — vai funcionar mais devagar',
    recommended: '✓ Recomendado — sweet spot pro seu caso',
    'above-recommended': '✓ Acima do recomendado — escala mais rápido',
    'ideal+': '🚀 Ideal — volume real, breakthrough rápido',
  };

  return (
    <div className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-gray-950 rounded-3xl w-full max-w-6xl max-h-[92vh] overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 via-purple-500 to-amber-500 text-white flex items-center justify-center">
              <Sparkles size={16} />
            </div>
            <div>
              <h2 className="text-base font-black text-gray-900 dark:text-gray-50">
                Configurar plano mensal
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Volume calculado pelo Meta 2025 best practices · sem cap por suposição de solo
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center text-gray-500"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* COLUNA ESQUERDA: Inputs */}
          <div className="space-y-5">
            {/* Project signals (read-only) */}
            <div className="rounded-2xl bg-blue-50 dark:bg-blue-950/30 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300 mb-2">
                Sinais do projeto (auto-detectados)
              </p>
              <div className="space-y-1 text-xs">
                <p>
                  <strong>Vertical:</strong> {signals.vertical || '(não inferido)'}{' '}
                  <span className="text-gray-500">
                    · saturação {signals.saturation || 'medium'}
                  </span>
                </p>
                <p>
                  <strong>Awareness:</strong> {signals.awareness || '(não inferido)'} / 5
                </p>
                <p>
                  <strong>Demografia:</strong> {signals.demographic || '(não inferido)'}
                </p>
                {signals.vslLengthMinutes && (
                  <p>
                    <strong>VSL:</strong> {signals.vslLengthMinutes} min
                  </p>
                )}
              </div>
            </div>

            {/* Preço do produto */}
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400 flex items-center gap-2">
                <DollarSign size={11} />
                1. Preço do produto (oferta média)
              </label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">$</span>
                <input
                  type="number"
                  min={1}
                  value={productPrice}
                  onChange={(e) => setProductPrice(Math.max(1, Number(e.target.value) || 0))}
                  className="w-28 px-3 py-2 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-800 text-sm font-bold focus:border-blue-400 outline-none"
                />
                <span className="text-[10px] text-gray-400 italic">
                  Se tem múltiplas ofertas (1/3/6), use a média ponderada
                </span>
              </div>
            </div>

            {/* CPA ideal */}
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400 flex items-center gap-2">
                <Target size={11} />
                2. CPA aceitável (quanto pode pagar por venda)
              </label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">$</span>
                <input
                  type="number"
                  min={1}
                  value={idealCPA}
                  onChange={(e) => setIdealCPA(Math.max(1, Number(e.target.value) || 0))}
                  className="w-28 px-3 py-2 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-800 text-sm font-bold focus:border-blue-400 outline-none"
                />
                <span className="text-[10px] text-gray-400 italic">
                  Vira regra de kill (CPA acima disso → mata o ad set)
                </span>
              </div>
            </div>

            {/* Budget */}
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
                3. Orçamento diário
              </label>
              <div className="rounded-2xl bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950/30 dark:to-purple-950/30 p-4 space-y-3">
                <div className="space-y-1 text-xs">
                  <p>
                    💡 <strong>Pro seu CPA $${idealCPA}:</strong>
                  </p>
                  <p>
                    • Mínimo viável: <strong>${hints.minimum}/dia</strong>
                  </p>
                  <p>
                    • Recomendado: <strong>${hints.recommended}/dia</strong> ⭐
                  </p>
                  <p>
                    • Ideal: <strong>${hints.ideal}+/dia</strong>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <DollarSign size={14} className="text-gray-400" />
                  <input
                    type="number"
                    min={1}
                    value={dailyBudgetUsd}
                    onChange={(e) => setDailyBudgetUsd(Math.max(1, Number(e.target.value) || 0))}
                    className="w-28 px-3 py-2 bg-white dark:bg-gray-900/60 rounded-xl border border-gray-200 dark:border-gray-800 text-sm font-black focus:border-blue-400 outline-none"
                  />
                  <span className="text-sm text-gray-500">/dia</span>
                </div>
                <p className={`text-xs font-bold ${verdictColor[preview.budgetVerdict]}`}>
                  {verdictLabel[preview.budgetVerdict]}
                </p>
              </div>
            </div>

            {/* Volume Strategy — UX29 */}
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400 flex items-center gap-2">
                <Zap size={11} />
                4. Estratégia de volume
              </label>
              <div className="space-y-2">
                {(Object.keys(VOLUME_STRATEGY_LABELS) as VolumeStrategy[]).map((vs) => {
                  const data = VOLUME_STRATEGY_LABELS[vs];
                  const selected = volumeStrategy === vs;
                  return (
                    <button
                      key={vs}
                      onClick={() => setVolumeStrategy(vs)}
                      className={`w-full text-left p-3 rounded-xl border-2 transition-all ${
                        selected
                          ? 'border-purple-500 bg-purple-50 dark:bg-purple-950/30'
                          : 'border-gray-200 dark:border-gray-800 hover:border-purple-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Gauge size={12} className="text-gray-500" />
                          <span className="text-sm font-bold">{data.label}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] text-gray-500 font-bold">
                            {data.perCreative}
                          </span>
                          <span className="text-[10px] text-purple-600 dark:text-purple-400">
                            {data.era}
                          </span>
                        </div>
                      </div>
                      <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 ml-5">
                        {data.desc}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Profile (agora só ajusta cadência, não cap) */}
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400 flex items-center gap-2">
                <Users size={11} />
                5. Curva de cadência (W1 → W4)
              </label>
              <div className="space-y-2">
                {(Object.keys(PROFILE_LABELS) as ProfileLevel[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setProfile(p)}
                    className={`w-full text-left p-3 rounded-xl border-2 transition-all ${
                      profile === p
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                        : 'border-gray-200 dark:border-gray-800 hover:border-blue-300'
                    }`}
                  >
                    <p className="text-sm font-bold">{PROFILE_LABELS[p].label}</p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
                      {PROFILE_LABELS[p].desc}
                    </p>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 italic">
                Esta escolha NÃO reduz volume — só ajusta a forma da distribuição entre as 4
                semanas.
              </p>
            </div>

            {/* Reference copies */}
            {personalLibrary.length > 0 && (
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400 flex items-center gap-2">
                  <Library size={11} />
                  Modelar copies vencedoras (opcional)
                </label>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {personalLibrary.map((c) => (
                    <label
                      key={c.id}
                      className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/60 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={modelReferenceCopyIds.includes(c.id)}
                        onChange={(e) => {
                          setModelReferenceCopyIds((prev) =>
                            e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id)
                          );
                        }}
                      />
                      <div className="flex items-center gap-1 min-w-0 flex-1">
                        {c.starred && <span className="text-amber-500">⭐</span>}
                        <span className="text-xs font-bold truncate">
                          {c.name || `Copy ${c.id.slice(0, 8)}`}
                        </span>
                        <span className="text-[10px] text-gray-500 shrink-0">
                          {c.vertical} · {c.language.toUpperCase()}
                        </span>
                      </div>
                    </label>
                  ))}
                </div>
                {modelReferenceCopyIds.length > 0 && (
                  <p className="text-[10px] text-blue-600 dark:text-blue-400 italic">
                    ~{preview.modelingIntensity}% dos briefs serão variações dessas copies
                  </p>
                )}
              </div>
            )}
          </div>

          {/* COLUNA DIREITA: Preview ao vivo */}
          <div className="space-y-4">
            <div className="rounded-2xl bg-gradient-to-br from-blue-50 via-purple-50 to-amber-50 dark:from-blue-950/30 dark:via-purple-950/30 dark:to-amber-950/30 p-5 space-y-4">
              <h3 className="text-sm font-black uppercase tracking-widest text-gray-700 dark:text-gray-200">
                📊 Plano calibrado
              </h3>

              <div className="flex items-baseline justify-between">
                <span className="text-xs text-gray-500">Criativos no mês</span>
                <span className="text-4xl font-black text-gray-900 dark:text-gray-50">
                  {preview.monthlyTotal}
                </span>
              </div>

              {preview.volumeRationale && (
                <div className="rounded-xl bg-white/60 dark:bg-gray-900/40 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1">
                    Por que esse número
                  </p>
                  <p className="text-[11px] text-gray-700 dark:text-gray-300 leading-relaxed">
                    {preview.volumeRationale}
                  </p>
                </div>
              )}

              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-2">
                  Distribuição de tamanho
                </p>
                <div className="flex h-8 rounded-lg overflow-hidden">
                  <div
                    style={{ width: `${preview.lengthDistribution.short}%` }}
                    className="bg-amber-400 flex items-center justify-center text-[10px] font-black text-white"
                  >
                    {preview.lengthDistribution.short}% curto
                  </div>
                  <div
                    style={{ width: `${preview.lengthDistribution.medium}%` }}
                    className="bg-blue-500 flex items-center justify-center text-[10px] font-black text-white"
                  >
                    {preview.lengthDistribution.medium}% médio
                  </div>
                  <div
                    style={{ width: `${preview.lengthDistribution.long}%` }}
                    className="bg-purple-600 flex items-center justify-center text-[10px] font-black text-white"
                  >
                    {preview.lengthDistribution.long}% long
                  </div>
                </div>
              </div>

              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-2">
                  Cadência semanal
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { w: 'S1', label: 'Lançar', val: preview.weeklyTargets.week1 },
                    { w: 'S2', label: 'Aprender', val: preview.weeklyTargets.week2 },
                    { w: 'S3', label: 'Escalar', val: preview.weeklyTargets.week3 },
                    { w: 'S4', label: 'Produzir', val: preview.weeklyTargets.week4 },
                  ].map((wk) => (
                    <div
                      key={wk.w}
                      className="bg-white dark:bg-gray-900/60 rounded-xl p-2 text-center"
                    >
                      <p className="text-[10px] font-black uppercase text-gray-400">{wk.w}</p>
                      <p className="text-2xl font-black">{wk.val}</p>
                      <p className="text-[9px] text-gray-500">{wk.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl bg-white dark:bg-gray-900/60 p-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1">
                  Tempo até breakthrough esperado
                </p>
                <p className="text-sm font-bold">{preview.breakthroughEstimate}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 dark:border-gray-800 p-4 space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Regras de scaling (siga no Meta)
              </p>
              <ul className="space-y-1.5">
                {preview.scalingRules.map((rule, i) => (
                  <li
                    key={i}
                    className="text-[11px] text-gray-700 dark:text-gray-300 flex items-start gap-2"
                  >
                    <span className="text-blue-500 mt-0.5">•</span>
                    <span>{rule}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-800 shrink-0 flex justify-between items-center">
          <p className="text-[10px] text-gray-400 italic">
            Plano usa Meta 2025 best practices · não capa por team size.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-black uppercase tracking-widest text-gray-500 hover:text-gray-800"
            >
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              className="px-5 py-2 bg-blue-700 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-blue-800 transition-all"
            >
              Gerar plano mensal →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
