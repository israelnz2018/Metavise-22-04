/**
 * UX28-C — Monthly Plan Setup Modal
 *
 * Modal que aparece quando user clica "Configurar plano mensal" no
 * PlanTab. 4 inputs (comissão / AOV / budget / perfil) + opcional
 * seleção de copies pra modelar. Mostra dicas dinâmicas de budget
 * (mínimo / recomendado / ideal) calculadas a partir de AOV + comm.
 *
 * Onde os signals do projeto vêm:
 *   - PlanTab passa productInfo (já analisado da VSL)
 *   - inferProjectSignals(productInfo) extrai vertical/awareness/demo/etc
 *   - Usado pra calibrar length distribution etc
 */

import { useState, useMemo } from 'react';
import { X, Sparkles, DollarSign, Users, Library } from 'lucide-react';
import {
  calculateBudgetHints,
  calibrateMonthlyPlan,
  inferProjectSignals,
  type ProfileLevel,
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

const PROFILE_LABELS: Record<ProfileLevel, { label: string; desc: string; budgetHint: string }> = {
  newcomer: {
    label: 'Iniciante',
    desc: 'Testando ainda, sem capital ou experiência forte',
    budgetHint: '$30-60/dia',
  },
  scaling: {
    label: 'Escalando',
    desc: 'Já roda, descobrindo o que funciona, capital limitado',
    budgetHint: '$60-150/dia',
  },
  serious: {
    label: 'Sério estabelecido',
    desc: 'Operação consolidada, otimizando ROAS',
    budgetHint: '$150-500/dia',
  },
  agency: {
    label: 'Agência / Grande operação',
    desc: 'Múltiplas ofertas / clientes, volume alto',
    budgetHint: '$500+/dia',
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
  // Inputs persistentes
  const [commissionPct, setCommissionPct] = useState(initialConfig?.commissionPct ?? 65);
  const [avgOrderValue, setAvgOrderValue] = useState(initialConfig?.avgOrderValue ?? 100);
  const [dailyBudgetUsd, setDailyBudgetUsd] = useState(initialConfig?.dailyBudgetUsd ?? 60);
  const [profile, setProfile] = useState<ProfileLevel>(initialConfig?.profile ?? 'scaling');
  const [modelReferenceCopyIds, setModelReferenceCopyIds] = useState<string[]>(
    initialConfig?.modelReferenceCopyIds ?? []
  );

  // Sinais do projeto (read-only)
  const signals = useMemo(() => inferProjectSignals(productInfo), [productInfo]);

  // Budget hints dinâmicos
  const hints = useMemo(
    () => calculateBudgetHints(commissionPct, avgOrderValue, signals.saturation),
    [commissionPct, avgOrderValue, signals.saturation]
  );

  // Plano calibrado preview (atualiza em tempo real)
  const preview = useMemo(
    () =>
      calibrateMonthlyPlan(signals, {
        commissionPct,
        avgOrderValue,
        dailyBudgetUsd,
        profile,
        modelReferenceCopyIds,
      }),
    [signals, commissionPct, avgOrderValue, dailyBudgetUsd, profile, modelReferenceCopyIds]
  );

  if (!open) return null;

  const handleSubmit = () => {
    const config: MonthlyPlanConfig = {
      commissionPct,
      avgOrderValue,
      dailyBudgetUsd,
      profile,
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
      <div className="bg-white dark:bg-gray-950 rounded-3xl w-full max-w-5xl max-h-[92vh] overflow-hidden shadow-2xl flex flex-col">
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
                4 perguntas → Metavise calibra tudo o resto pro seu caso
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
                Sinais do projeto (auto)
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

            {/* Comissão */}
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
                1. Sua comissão por venda (%)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={commissionPct}
                  onChange={(e) =>
                    setCommissionPct(Math.max(1, Math.min(100, Number(e.target.value) || 0)))
                  }
                  className="w-24 px-3 py-2 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-800 text-sm font-bold focus:border-blue-400 outline-none"
                />
                <span className="text-sm text-gray-500">%</span>
              </div>
            </div>

            {/* AOV */}
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
                2. AOV médio (US$ por venda)
              </label>
              <div className="flex items-center gap-2">
                <DollarSign size={14} className="text-gray-400" />
                <input
                  type="number"
                  min={1}
                  value={avgOrderValue}
                  onChange={(e) => setAvgOrderValue(Math.max(1, Number(e.target.value) || 0))}
                  className="w-24 px-3 py-2 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-800 text-sm font-bold focus:border-blue-400 outline-none"
                />
                <span className="text-xs text-gray-500">
                  → ${((avgOrderValue * commissionPct) / 100).toFixed(0)} comissão/venda
                </span>
              </div>
              <p className="text-[10px] text-gray-400 italic">
                Se tem múltiplas ofertas (1/3/6 potes etc), use a média ponderada por % de conversão
                típica.
              </p>
            </div>

            {/* Budget */}
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
                3. Quanto vai rodar por dia (US$)
              </label>
              <div className="rounded-2xl bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950/30 dark:to-purple-950/30 p-4 space-y-3">
                <div className="space-y-1 text-xs">
                  <p>
                    💡 <strong>Pro seu caso:</strong>
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

            {/* Profile */}
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
                4. Seu perfil
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
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Users size={12} className="text-gray-500" />
                        <span className="text-sm font-bold">{PROFILE_LABELS[p].label}</span>
                      </div>
                      <span className="text-[10px] text-gray-500">
                        {PROFILE_LABELS[p].budgetHint}
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 ml-5">
                      {PROFILE_LABELS[p].desc}
                    </p>
                  </button>
                ))}
              </div>
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

          {/* COLUNA DIREITA: Preview ao vivo do plano calibrado */}
          <div className="space-y-4">
            <div className="rounded-2xl bg-gradient-to-br from-blue-50 via-purple-50 to-amber-50 dark:from-blue-950/30 dark:via-purple-950/30 dark:to-amber-950/30 p-5 space-y-4">
              <h3 className="text-sm font-black uppercase tracking-widest text-gray-700 dark:text-gray-200">
                📊 Plano que vou gerar
              </h3>

              {/* Total */}
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-gray-500">Criativos no mês</span>
                <span className="text-3xl font-black text-gray-900 dark:text-gray-50">
                  {preview.monthlyTotal}
                </span>
              </div>

              {/* Length distribution */}
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

              {/* Weekly cadence */}
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
                      <p className="text-xl font-black">{wk.val}</p>
                      <p className="text-[9px] text-gray-500">{wk.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Breakthrough */}
              <div className="rounded-xl bg-white dark:bg-gray-900/60 p-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1">
                  Tempo até breakthrough esperado
                </p>
                <p className="text-sm font-bold">{preview.breakthroughEstimate}</p>
              </div>
            </div>

            {/* Scaling rules */}
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
            Tudo abaixo será gerado / atualizado quando você confirmar.
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
