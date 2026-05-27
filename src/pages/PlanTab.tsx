import { useEffect, useMemo, useState } from 'react';
import {
  Sparkles,
  Loader2,
  RefreshCw,
  ArrowRight,
  Target,
  Zap,
  Clock,
  Layers,
  DollarSign,
  TrendingUp,
  Rocket,
  CheckSquare,
  Download,
  Users,
  AlertTriangle,
  Check,
  Circle,
  Edit3,
} from 'lucide-react';
import jsPDF from 'jspdf';
import {
  generateMarketingPlan,
  generateMarketingBlueprint,
  generateMonthlyPlan,
  type MarketingPlan,
} from '@/lib/claudeService';
import type { WeightedPersona, CreativeBrief, MonthlyPlanConfig } from '@/types/project';
// UX28: setup modal + auth pra carregar biblioteca pessoal
import MonthlyPlanSetupModal from '@/components/MonthlyPlanSetupModal';
import type { CalibratedMonthlyPlan } from '@/lib/planCalibration';
import { loadPersonalLibrary, type PersonalCopyDoc } from '@/lib/personalCopyLibrary';
import { auth } from '@/lib/firebase';
import { Calendar } from 'lucide-react';
import { toast } from 'react-hot-toast';

interface Props {
  productInfo?: any;
  persona?: any;
  copyAnswers?: any;
  cached?: MarketingPlan | null;
  /** Blueprint v2 — weighted personas selected on PersonaTab Path 2.
   *  When present, the tab renders the new "Personas + briefs" UI and
   *  generation is manual (button click) instead of auto-fetch. */
  personasWithWeights?: WeightedPersona[] | null;
  /** Cached briefs from a previous "Gerar Plano" run. Survives reloads. */
  cachedBriefs?: CreativeBrief[] | null;
  onChange: (plan: MarketingPlan) => void;
  /** Callback when briefs are (re)generated. App.tsx persists to config. */
  onBriefsChange?: (briefs: CreativeBrief[]) => void;
  /** Click on an individual brief — opens the "Criar Subprojeto" popup.
   *  Wired in Phase 3.4. */
  onBriefClick?: (brief: CreativeBrief) => void;
  /** Open the brief edit modal. Wired in Phase 3.3. */
  onBriefEdit?: (brief: CreativeBrief) => void;
  /** Map of brief id → variant id, for showing "✓ executed" status. */
  briefToVariantMap?: Record<string, string>;
  /** UX28: cached monthly plan config (persisted on config.copy.monthlyPlan) */
  cachedMonthlyPlan?: MonthlyPlanConfig | null;
  /** UX28: callback when monthly plan setup changes */
  onMonthlyPlanChange?: (config: MonthlyPlanConfig | null) => void;
  onContinue: () => void;
}

const AWARENESS_PT: Record<string, string> = {
  unaware: 'Frio (não consciente)',
  'problem-aware': 'Consciente do problema',
  'solution-aware': 'Consciente da solução',
  'product-aware': 'Consciente do produto',
  'most-aware': 'Mais consciente (hot)',
};

export function PlanTab({
  productInfo,
  persona,
  copyAnswers,
  cached,
  personasWithWeights,
  cachedBriefs,
  onChange,
  onBriefsChange,
  onBriefClick,
  onBriefEdit,
  briefToVariantMap,
  cachedMonthlyPlan,
  onMonthlyPlanChange,
  onContinue,
}: Props) {
  const [plan, setPlan] = useState<MarketingPlan | null>(cached ?? null);
  const [briefs, setBriefs] = useState<CreativeBrief[]>(cachedBriefs ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Blueprint v2 config — only meaningful when personasWithWeights is set.
  // 15 is the default per Andromeda (10-20+ conceptually distinct creatives).
  const [targetCount, setTargetCount] = useState<number>(15);
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<Set<string>>(
    () => new Set((personasWithWeights || []).map((p) => p.id))
  );
  // Update selection when personas list changes (e.g. user navigates back
  // to PersonaTab and re-selects).
  useEffect(() => {
    setSelectedPersonaIds(new Set((personasWithWeights || []).map((p) => p.id)));
  }, [personasWithWeights]);

  // v2 mode = we have weighted personas. In v2 we never auto-fetch — the
  // user clicks "Gerar Plano" explicitly. Tab-to-tab transitions only
  // carry data, never generate things implicitly.
  const isV2 = Array.isArray(personasWithWeights) && personasWithWeights.length > 0;

  // UX28: monthly plan state
  const [showMonthlyModal, setShowMonthlyModal] = useState(false);
  const [personalLibrary, setPersonalLibrary] = useState<PersonalCopyDoc[]>([]);
  const [generatingMonthly, setGeneratingMonthly] = useState(false);
  const [viewMode, setViewMode] = useState<'flat' | 'weekly'>(
    cachedMonthlyPlan ? 'weekly' : 'flat'
  );

  // Carrega biblioteca pessoal pra alimentar o modal
  useEffect(() => {
    const u = auth.currentUser;
    if (!u?.uid) return;
    loadPersonalLibrary(u.uid)
      .then(setPersonalLibrary)
      .catch(() => {});
  }, []);

  /** UX28: gera plano mensal calibrado com tags de semana + length + modelagem */
  const handleGenerateMonthlyPlan = async (
    config: MonthlyPlanConfig,
    calibrated: CalibratedMonthlyPlan
  ) => {
    setShowMonthlyModal(false);
    setGeneratingMonthly(true);
    setError(null);
    try {
      const { plan: p, briefs: b } = await generateMonthlyPlan({
        productInfo,
        personas: (personasWithWeights || []) as any,
        selectedPersonaIds: Array.from(selectedPersonaIds),
        copyAnswers,
        calibrated: {
          monthlyTotal: calibrated.monthlyTotal,
          lengthDistribution: calibrated.lengthDistribution,
          weeklyTargets: calibrated.weeklyTargets,
          modelingIntensity: calibrated.modelingIntensity,
        },
        modelReferenceCopyIds: config.modelReferenceCopyIds,
      });
      setPlan(p);
      setBriefs(b as CreativeBrief[]);
      onChange(p);
      onBriefsChange?.(b as CreativeBrief[]);
      onMonthlyPlanChange?.(config);
      setViewMode('weekly');
      toast.success(`Plano mensal gerado · ${b.length} criativos distribuídos em 4 semanas`);
    } catch (err: any) {
      const msg = err?.message || 'Erro ao gerar plano mensal.';
      setError(msg);
      toast.error(msg);
    } finally {
      setGeneratingMonthly(false);
    }
  };

  /** Legacy fetch (no briefs). Used when isV2 === false. */
  const fetchPlan = async () => {
    setLoading(true);
    setError(null);
    try {
      const p = await generateMarketingPlan({ productInfo, persona, copyAnswers });
      setPlan(p);
      onChange(p);
    } catch (err: any) {
      setError(err?.message || 'Erro ao gerar plano.');
    } finally {
      setLoading(false);
    }
  };

  /** Blueprint v2 fetch — returns { plan, briefs } in one call. */
  const fetchBlueprint = async () => {
    if (!isV2) return;
    setLoading(true);
    setError(null);
    try {
      const { plan: p, briefs: b } = await generateMarketingBlueprint({
        productInfo,
        personas: personasWithWeights as any,
        selectedPersonaIds: Array.from(selectedPersonaIds),
        copyAnswers,
        targetCount,
      });
      setPlan(p);
      setBriefs(b);
      onChange(p);
      onBriefsChange?.(b);
    } catch (err: any) {
      setError(err?.message || 'Erro ao gerar blueprint.');
    } finally {
      setLoading(false);
    }
  };

  // Auto-fetch only in v1 (legacy) mode. v2 waits for explicit "Gerar Plano".
  useEffect(() => {
    if (isV2) return;
    if (!cached && !plan && !loading && !error) {
      void fetchPlan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Color palette per persona for consistent visual identity across the
  // briefs grid. Stable mapping: 1st persona = blue, 2nd = purple, 3rd = amber.
  const personaColor = useMemo(() => {
    const map = new Map<string, string>();
    (personasWithWeights || []).forEach((p, idx) => {
      map.set(p.id, idx === 0 ? 'blue' : idx === 1 ? 'purple' : 'amber');
    });
    return map;
  }, [personasWithWeights]);

  const handleDownloadPDF = () => {
    if (!plan) return;
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const margin = 50;
    const maxWidth = 612 - 2 * margin;
    let y = margin;

    const writeLine = (
      text: string,
      size = 11,
      opts: { bold?: boolean; color?: [number, number, number] } = {}
    ) => {
      doc.setFontSize(size);
      doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
      if (opts.color) doc.setTextColor(...opts.color);
      else doc.setTextColor(20, 20, 20);
      const lines = doc.splitTextToSize(text, maxWidth);
      for (const line of lines) {
        if (y > 740) {
          doc.addPage();
          y = margin;
        }
        doc.text(line, margin, y);
        y += size + 4;
      }
    };
    const space = (n = 8) => {
      y += n;
    };
    const heading = (text: string) => {
      space(14);
      writeLine(text, 16, { bold: true, color: [88, 28, 135] });
      space(4);
    };
    const subheading = (text: string) => {
      space(6);
      writeLine(text, 12, { bold: true, color: [60, 60, 60] });
    };

    // Cover
    writeLine('Plano de Marketing', 24, { bold: true, color: [88, 28, 135] });
    writeLine('Gerado por MetaVise · Estratégia Andromeda-aware', 10, { color: [120, 120, 120] });
    space(20);

    heading('Estratégia macro');
    writeLine(plan.summary);

    heading('Volume de criativos');
    writeLine(
      `Total: ${plan.creativeVolume.totalCreatives}  ·  Por audiência: ${plan.creativeVolume.perAudience}`,
      11,
      { bold: true }
    );
    writeLine(plan.creativeVolume.rationale);

    heading('Estrutura de campanha');
    writeLine(
      `${plan.adStructure.campaigns} campanha(s) · ${plan.adStructure.adSets} ad set(s) · ${plan.adStructure.creativesPerAdSet} criativos por set`,
      11,
      { bold: true }
    );
    writeLine(plan.adStructure.rationale);

    heading('Mix de ganchos');
    plan.hookMix.forEach((h, i) => {
      subheading(`${i + 1}. ${h.angle} (${h.count}× · ${h.awarenessLevel})`);
      writeLine(`Exemplo: "${h.example}"`, 10);
      writeLine(`Razão: ${h.rationale}`, 10, { color: [90, 90, 90] });
    });

    heading('Cobertura de awareness');
    plan.awarenessCoverage.forEach((a) => {
      subheading(`${a.level} — ${a.creativeCount} criativos`);
      writeLine(a.approach, 10);
    });

    heading('Mix de durações');
    plan.durations.forEach((d) => {
      writeLine(`• ${d.length} (${d.count}×) — ${d.purpose}`);
    });

    heading('Orçamento');
    writeLine(
      `Mínimo: R$${plan.budget.dailyMin}/dia  ·  Recomendado: R$${plan.budget.dailyRecommended}/dia`,
      11,
      { bold: true }
    );
    writeLine(plan.budget.rationale);

    heading('Plano de iteração');
    writeLine(`Janela de teste: ${plan.iterationPlan.testDays} dias`);
    writeLine(`Matar quando: ${plan.iterationPlan.killThreshold}`);
    writeLine(`Escalar quando: ${plan.iterationPlan.scaleThreshold}`);
    writeLine(`Revisar: ${plan.iterationPlan.iterationFrequency}`);

    if (plan.andromedaTips?.length) {
      heading('Dicas Andromeda');
      plan.andromedaTips.forEach((t) => writeLine(`→ ${t}`));
    }

    if (plan.nextSteps?.length) {
      heading('Próximos passos');
      plan.nextSteps.forEach((s, i) => writeLine(`${i + 1}. ${s}`));
    }

    const fileName = `plano-marketing-${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(fileName);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* UX28: modal de setup do plano mensal */}
      <MonthlyPlanSetupModal
        open={showMonthlyModal}
        onClose={() => setShowMonthlyModal(false)}
        productInfo={productInfo}
        initialConfig={cachedMonthlyPlan}
        personalLibrary={personalLibrary}
        onSubmit={handleGenerateMonthlyPlan}
      />

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h2 className="text-3xl font-black text-gray-900 dark:text-gray-50 tracking-tight">
            Plano de Marketing
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 max-w-2xl">
            Estratégia completa pra Meta Ads considerando Andromeda: volume e diversidade vencem
            perfeição individual. Quantos criativos, quais ângulos, durações, estrutura de campanha
            — tudo calculado pra esse produto + persona.
          </p>
        </div>
        <div className="flex items-center gap-4">
          {plan && (
            <button
              onClick={handleDownloadPDF}
              className="text-xs font-bold uppercase tracking-widest text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-50 flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-gray-400"
            >
              <Download size={12} />
              Baixar PDF
            </button>
          )}
          <button
            onClick={fetchPlan}
            disabled={loading}
            className="text-xs font-bold uppercase tracking-widest text-purple-700 dark:text-purple-300 hover:text-purple-900 flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Recalcular
          </button>
        </div>
      </div>

      {/* ─── V2 BLUEPRINT HEADER (Path 2 from PersonaTab) ─────────────
          Renders only when the user came through the multi-persona path.
          Shows the 3 personas with weights, lets them tweak which to
          include + how many briefs to generate, and provides the "Gerar
          Plano" CTA. v1 (legacy) mode hides this block entirely. */}
      {isV2 && (
        <div className="bg-white/80 dark:bg-gray-900/60 ring-1 ring-gray-200/60 dark:ring-gray-800/60 rounded-3xl p-6 space-y-5">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-blue-600 dark:text-blue-400" />
            <h3 className="font-black uppercase text-xs tracking-widest text-gray-700 dark:text-gray-300">
              Personas selecionadas para o plano
            </h3>
          </div>

          {/* 3 persona mini-cards in a row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {(personasWithWeights || []).map((p) => {
              const color = personaColor.get(p.id) || 'gray';
              const checked = selectedPersonaIds.has(p.id);
              return (
                <label
                  key={p.id}
                  className={`relative cursor-pointer rounded-2xl ring-1 transition-all p-4 space-y-2 ${
                    checked
                      ? color === 'blue'
                        ? 'ring-blue-500 bg-gradient-to-br from-blue-50 to-blue-100/40 dark:from-blue-950/40 dark:to-blue-900/20 dark:ring-blue-400'
                        : color === 'purple'
                          ? 'ring-purple-500 bg-gradient-to-br from-purple-50 to-purple-100/40 dark:from-purple-950/40 dark:to-purple-900/20 dark:ring-purple-400'
                          : 'ring-amber-500 bg-gradient-to-br from-amber-50 to-amber-100/40 dark:from-amber-950/40 dark:to-amber-900/20 dark:ring-amber-400'
                      : 'ring-gray-200/60 dark:ring-gray-700/60 bg-white dark:bg-gray-900/40 opacity-60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        setSelectedPersonaIds((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(p.id);
                          else next.delete(p.id);
                          // Always keep at least 1 persona selected
                          if (next.size === 0) next.add(p.id);
                          return next;
                        });
                      }}
                      className="w-4 h-4 accent-blue-600 mt-0.5"
                    />
                    {p.isStretch && (
                      <span
                        className="inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300"
                        title="Persona inferida fracamente do material"
                      >
                        <AlertTriangle size={8} />
                        fraca
                      </span>
                    )}
                  </div>
                  <h4 className="text-sm font-black text-gray-900 dark:text-gray-50 leading-tight">
                    {p.name}
                  </h4>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 line-clamp-2">
                    {p.description}
                  </p>
                  <div className="flex items-center justify-between pt-2 border-t border-gray-200/60 dark:border-gray-800">
                    <span className="text-[9px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-500">
                      {Math.round((p.confidence || 0) * 100)}% conf.
                    </span>
                    <span className="text-[10px] font-black tabular-nums text-gray-900 dark:text-gray-100">
                      {Math.round((p.suggestedWeight || 0) * 100)}%
                    </span>
                  </div>
                </label>
              );
            })}
          </div>

          {/* Slider for target count */}
          <div className="flex items-center gap-4 flex-wrap">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
              Quantidade de criativos
            </label>
            <input
              type="range"
              min={10}
              max={20}
              step={1}
              value={targetCount}
              onChange={(e) => setTargetCount(Number(e.target.value))}
              className="flex-1 min-w-[180px] accent-blue-600"
            />
            <span className="text-2xl font-black text-blue-600 dark:text-blue-400 tabular-nums">
              {targetCount}
            </span>
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">
              ⭐ recomendado: 15
            </span>
          </div>

          {/* UX28: Plano Mensal Calibrado — substitui o gerador legacy */}
          <div className="rounded-2xl border-2 border-gradient bg-gradient-to-br from-blue-50 via-purple-50 to-amber-50 dark:from-blue-950/30 dark:via-purple-950/30 dark:to-amber-950/30 p-5 space-y-4 ring-1 ring-blue-200/40 dark:ring-blue-900/40">
            <div className="flex items-start gap-3">
              <div className="shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 via-purple-500 to-amber-500 text-white flex items-center justify-center shadow-md">
                <Calendar size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300">
                  Novo · Plano Mensal Calibrado
                </p>
                <p className="text-sm font-bold text-gray-900 dark:text-gray-50">
                  4 semanas · cadência adaptada ao seu orçamento e ao perfil do produto
                </p>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  Metavise calibra quantos criativos por semana, distribuição de tamanho
                  (curto/médio/longo), e quais devem modelar suas copies vencedoras — baseado em
                  comissão, AOV, budget e dados da VSL.
                </p>
              </div>
            </div>
            {cachedMonthlyPlan?.calibrated && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                {[
                  { label: 'S1 Lançar', val: cachedMonthlyPlan.calibrated.weeklyTargets.week1 },
                  { label: 'S2 Aprender', val: cachedMonthlyPlan.calibrated.weeklyTargets.week2 },
                  { label: 'S3 Escalar', val: cachedMonthlyPlan.calibrated.weeklyTargets.week3 },
                  { label: 'S4 Produzir', val: cachedMonthlyPlan.calibrated.weeklyTargets.week4 },
                ].map((w) => (
                  <div
                    key={w.label}
                    className="bg-white/70 dark:bg-gray-900/40 rounded-xl p-2 text-center"
                  >
                    <p className="text-[10px] font-black uppercase text-gray-400">{w.label}</p>
                    <p className="text-lg font-black">{w.val}</p>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={() => setShowMonthlyModal(true)}
              disabled={generatingMonthly || selectedPersonaIds.size === 0}
              className="w-full py-3 bg-gradient-to-br from-blue-600 via-purple-600 to-amber-600 hover:opacity-90 text-white rounded-xl font-black uppercase tracking-widest text-xs transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {generatingMonthly ? (
                <>
                  <Loader2 className="animate-spin" size={14} />
                  Gerando plano mensal...
                </>
              ) : cachedMonthlyPlan ? (
                <>
                  <RefreshCw size={14} />
                  Reconfigurar plano mensal
                </>
              ) : (
                <>
                  <Sparkles size={14} />
                  Configurar plano mensal
                </>
              )}
            </button>
          </div>

          {/* Generate button (legacy — gera SEM cadência mensal) */}
          <details className="rounded-xl border border-gray-200 dark:border-gray-800 p-3">
            <summary className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400 cursor-pointer hover:text-gray-800 dark:hover:text-gray-200">
              Ou: gerar plano clássico (sem cadência mensal) ↓
            </summary>
            <div className="mt-3 space-y-2">
              <button
                onClick={fetchBlueprint}
                disabled={loading || selectedPersonaIds.size === 0}
                className="w-full py-5 bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 active:scale-[0.99] text-white rounded-2xl font-black uppercase tracking-widest text-sm transition-all shadow-xl shadow-blue-200/60 dark:shadow-blue-900/30 ring-1 ring-inset ring-white/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
              >
                {loading ? (
                  <>
                    <Loader2 className="animate-spin" size={18} />
                    Gerando plano + {targetCount} criativos...
                  </>
                ) : briefs.length > 0 ? (
                  <>
                    <RefreshCw size={18} />
                    Regerar plano ({targetCount} criativos)
                  </>
                ) : (
                  <>
                    <Sparkles size={18} />
                    Gerar Plano de Marketing (clássico)
                  </>
                )}
              </button>
            </div>
          </details>
          {selectedPersonaIds.size === 0 && (
            <p className="text-center text-[10px] text-red-600 dark:text-red-400 font-bold uppercase tracking-widest">
              Selecione pelo menos 1 persona acima
            </p>
          )}
        </div>
      )}

      {/* Skip-to-copy shortcut: user can bypass the plan and jump straight
          to copywriting if they don't need the strategy guide right now. */}
      <div className="bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-2xl px-5 py-3 flex items-center justify-between gap-4">
        <p className="text-xs text-gray-600 dark:text-gray-400">
          Não quer ver o plano agora? Pode pular pra Copy.
        </p>
        <button
          onClick={onContinue}
          className="text-xs font-black uppercase tracking-widest text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-50 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white dark:bg-gray-900/80 border border-gray-200 dark:border-gray-700 hover:border-gray-400"
        >
          Pular para Copy
          <ArrowRight size={12} />
        </button>
      </div>

      {loading && !plan && (
        <div className="bg-purple-50 dark:bg-purple-950/40 border-2 border-purple-200 rounded-3xl p-12 text-center">
          <Loader2
            className="animate-spin mx-auto mb-3 text-purple-600 dark:text-purple-400"
            size={32}
          />
          <p className="text-sm text-purple-800 dark:text-purple-300 font-bold">
            Construindo plano de marketing...
          </p>
          <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
            Pode levar 20-40s (Claude analisando produto + persona)
          </p>
        </div>
      )}

      {error && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 rounded-xl p-4 text-sm text-amber-900 dark:text-amber-200 flex items-start justify-between gap-3">
          <div>
            <p className="font-bold mb-1">Não consegui gerar o plano agora.</p>
            <p className="text-xs">{error}</p>
          </div>
          <button
            onClick={fetchPlan}
            disabled={loading}
            className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-black uppercase tracking-widest px-3 py-2 rounded-lg disabled:opacity-50"
          >
            Tentar de novo
          </button>
        </div>
      )}

      {plan && (
        <div className="space-y-6">
          {/* Summary */}
          <div className="bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-950/40 dark:to-blue-950/40 border-2 border-purple-200 dark:border-purple-800/60 rounded-3xl p-6">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles size={18} className="text-purple-600 dark:text-purple-400" />
              <h3 className="font-black uppercase text-xs tracking-widest text-purple-900 dark:text-purple-200">
                Estratégia macro
              </h3>
            </div>
            <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-line">
              {plan.summary}
            </p>
          </div>

          {/* Volume + Structure side by side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <PlanCard
              icon={<Layers size={18} />}
              label="Volume de criativos"
              accent="text-blue-700 dark:text-blue-300"
            >
              <div className="text-5xl font-black text-gray-900 dark:text-gray-50 mb-2">
                {plan.creativeVolume.totalCreatives}
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                {plan.creativeVolume.perAudience} por audiência
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-3 leading-relaxed">
                {plan.creativeVolume.rationale}
              </p>
            </PlanCard>

            <PlanCard
              icon={<Target size={18} />}
              label="Estrutura de campanha"
              accent="text-green-700 dark:text-green-400"
            >
              <div className="flex gap-4 mb-2">
                <Stat label="Campanhas" value={plan.adStructure.campaigns} />
                <Stat label="Ad sets" value={plan.adStructure.adSets} />
                <Stat label="Crtvs/set" value={plan.adStructure.creativesPerAdSet} />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-3 leading-relaxed">
                {plan.adStructure.rationale}
              </p>
            </PlanCard>
          </div>

          {/* Hook Mix */}
          <div className="bg-white dark:bg-gray-900/80 border-2 border-gray-200 dark:border-gray-800 rounded-3xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Zap size={18} className="text-amber-600 dark:text-amber-400" />
              <h3 className="font-black uppercase text-sm tracking-widest text-gray-900 dark:text-gray-50">
                Mix de Ganchos ({plan.hookMix.reduce((acc, h) => acc + h.count, 0)} no total)
              </h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {plan.hookMix.map((h, i) => (
                <div
                  key={i}
                  className="bg-amber-50 dark:bg-amber-950/40 border border-amber-100 rounded-xl p-4 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-widest text-amber-800 dark:text-amber-300">
                      {h.angle}
                    </span>
                    <span className="text-xs font-black bg-amber-200 text-amber-900 dark:text-amber-200 px-2 py-0.5 rounded-full">
                      {h.count}×
                    </span>
                  </div>
                  <p className="text-sm text-gray-900 dark:text-gray-50 font-medium italic">
                    "{h.example}"
                  </p>
                  <div className="flex flex-wrap gap-2 text-[10px]">
                    <span className="bg-white dark:bg-gray-900/80 border border-amber-200 text-amber-800 dark:text-amber-300 px-2 py-0.5 rounded-full">
                      {AWARENESS_PT[h.awarenessLevel] || h.awarenessLevel}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-600 dark:text-gray-400">{h.rationale}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Awareness Coverage + Durations */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <PlanCard
              icon={<TrendingUp size={18} />}
              label="Cobertura de awareness"
              accent="text-purple-700 dark:text-purple-300"
            >
              <div className="space-y-2 mt-2">
                {plan.awarenessCoverage.map((a, i) => (
                  <div
                    key={i}
                    className="flex items-start justify-between gap-3 p-2 bg-purple-50 dark:bg-purple-950/40 rounded-lg"
                  >
                    <div className="flex-1">
                      <div className="text-xs font-black text-purple-900 dark:text-purple-200">
                        {AWARENESS_PT[a.level] || a.level}
                      </div>
                      <div className="text-[11px] text-gray-600 dark:text-gray-400 mt-0.5">
                        {a.approach}
                      </div>
                    </div>
                    <span className="text-xs font-black bg-purple-200 text-purple-900 dark:text-purple-200 px-2 py-0.5 rounded-full whitespace-nowrap">
                      {a.creativeCount}×
                    </span>
                  </div>
                ))}
              </div>
            </PlanCard>

            <PlanCard
              icon={<Clock size={18} />}
              label="Mix de durações"
              accent="text-blue-700 dark:text-blue-300"
            >
              <div className="space-y-2 mt-2">
                {plan.durations.map((d, i) => (
                  <div
                    key={i}
                    className="flex items-start justify-between gap-3 p-2 bg-blue-50 dark:bg-blue-950/40 rounded-lg"
                  >
                    <div className="flex-1">
                      <div className="text-xs font-black text-blue-900 dark:text-blue-200">
                        {d.length}
                      </div>
                      <div className="text-[11px] text-gray-600 dark:text-gray-400 mt-0.5">
                        {d.purpose}
                      </div>
                    </div>
                    <span className="text-xs font-black bg-blue-200 text-blue-900 dark:text-blue-200 px-2 py-0.5 rounded-full whitespace-nowrap">
                      {d.count}×
                    </span>
                  </div>
                ))}
              </div>
            </PlanCard>
          </div>

          {/* Budget + Iteration */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <PlanCard
              icon={<DollarSign size={18} />}
              label="Orçamento sugerido"
              accent="text-green-700 dark:text-green-400"
            >
              <div className="grid grid-cols-2 gap-3 my-2">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-gray-500 dark:text-gray-400 font-bold">
                    Mínimo
                  </div>
                  <div className="text-2xl font-black text-gray-900 dark:text-gray-50">
                    R${plan.budget.dailyMin}
                    <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                      /dia
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-green-700 dark:text-green-400 font-bold">
                    Recomendado
                  </div>
                  <div className="text-2xl font-black text-green-700 dark:text-green-400">
                    R${plan.budget.dailyRecommended}
                    <span className="text-xs font-normal text-green-600 dark:text-green-400">
                      /dia
                    </span>
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
                {plan.budget.rationale}
              </p>
            </PlanCard>

            <PlanCard
              icon={<Rocket size={18} />}
              label="Plano de iteração"
              accent="text-orange-700"
            >
              <div className="space-y-2 text-xs">
                <div>
                  <span className="font-black text-orange-700">Janela de teste:</span>{' '}
                  <span className="text-gray-900 dark:text-gray-50">
                    {plan.iterationPlan.testDays} dias
                  </span>
                </div>
                <div>
                  <span className="font-black text-red-700">Matar quando:</span>{' '}
                  <span className="text-gray-900 dark:text-gray-50">
                    {plan.iterationPlan.killThreshold}
                  </span>
                </div>
                <div>
                  <span className="font-black text-green-700 dark:text-green-400">
                    Escalar quando:
                  </span>{' '}
                  <span className="text-gray-900 dark:text-gray-50">
                    {plan.iterationPlan.scaleThreshold}
                  </span>
                </div>
                <div>
                  <span className="font-black text-gray-700 dark:text-gray-300">Revisar:</span>{' '}
                  <span className="text-gray-900 dark:text-gray-50">
                    {plan.iterationPlan.iterationFrequency}
                  </span>
                </div>
              </div>
            </PlanCard>
          </div>

          {/* Andromeda Tips */}
          {plan.andromedaTips?.length > 0 && (
            <div className="bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-950/40 dark:to-purple-950/40 border-2 border-indigo-200 dark:border-indigo-800/60 rounded-3xl p-6">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles size={18} className="text-indigo-600 dark:text-indigo-400" />
                <h3 className="font-black uppercase text-xs tracking-widest text-indigo-900 dark:text-indigo-200">
                  Dicas específicas pra Andromeda
                </h3>
              </div>
              <ul className="space-y-2">
                {plan.andromedaTips.map((tip, i) => (
                  <li key={i} className="flex gap-2 text-sm text-gray-800 dark:text-gray-200">
                    <span className="text-indigo-400 font-black">→</span>
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Next Steps */}
          {plan.nextSteps?.length > 0 && (
            <div className="bg-white dark:bg-gray-900/80 border-2 border-gray-900 rounded-3xl p-6">
              <div className="flex items-center gap-2 mb-3">
                <CheckSquare size={18} className="text-gray-900 dark:text-gray-50" />
                <h3 className="font-black uppercase text-xs tracking-widest text-gray-900 dark:text-gray-50">
                  Próximos passos aqui no MetaVise
                </h3>
              </div>
              <ol className="space-y-2 list-decimal list-inside">
                {plan.nextSteps.map((step, i) => (
                  <li key={i} className="text-sm text-gray-800 dark:text-gray-200">
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          )}

          <button
            onClick={onContinue}
            className="w-full bg-gray-900 hover:bg-black text-white font-black uppercase text-sm tracking-widest py-5 rounded-2xl shadow-lg flex items-center justify-center gap-3"
          >
            Ir para Copy
            <ArrowRight size={18} />
          </button>
        </div>
      )}

      {/* ─── V2 BRIEFS CHECKLIST ─────────────────────────────────────
          UX7: convertido de grid (3 colunas) pra checklist vertical
          (1 linha por brief). User pediu formato de checklist com tick
          pros executados e info clara por linha (consc + duração + angle).
          15 criativos cabem confortavelmente em 1 tela com scroll suave. */}
      {isV2 && briefs.length > 0 && (
        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="text-2xl font-black text-gray-900 dark:text-gray-50 tracking-tight">
                Checklist de Criativos
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {briefs.length} criativos pra produzir. Clique no botão de cada linha pra criar o
                subprojeto.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              {/* UX28-E: toggle entre flat e weekly */}
              {briefs.some((b: any) => b.weekIndex) && (
                <div className="flex items-center gap-1 mr-2 p-0.5 rounded-lg bg-gray-100 dark:bg-gray-800">
                  <button
                    onClick={() => setViewMode('flat')}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-widest transition-all ${
                      viewMode === 'flat'
                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-50 shadow'
                        : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
                    }`}
                  >
                    Lista
                  </button>
                  <button
                    onClick={() => setViewMode('weekly')}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-widest transition-all ${
                      viewMode === 'weekly'
                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-50 shadow'
                        : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
                    }`}
                  >
                    Semanas
                  </button>
                </div>
              )}
              {(() => {
                const executed = briefs.filter((b) => briefToVariantMap?.[b.id]).length;
                const pct = Math.round((executed / briefs.length) * 100);
                return (
                  <div className="flex items-center gap-3">
                    {/* Mini progress bar — visual quick-glance do quanto já foi feito */}
                    <div className="w-32 h-1.5 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-green-500 to-emerald-500 transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400 tabular-nums">
                      {executed} de {briefs.length}
                    </span>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* UX28-E: Weekly view — agrupa briefs por semana (S1-S4) */}
          {viewMode === 'weekly' && briefs.some((b: any) => b.weekIndex) && (
            <div className="space-y-6">
              {[1, 2, 3, 4].map((w) => {
                const weekBriefs = briefs.filter((b: any) => b.weekIndex === w);
                if (weekBriefs.length === 0) return null;
                const weekLabels: Record<number, { title: string; desc: string; color: string }> = {
                  1: {
                    title: 'Semana 1 — Lançamento',
                    desc: 'Diversidade máxima · testa todos os ângulos',
                    color: 'blue',
                  },
                  2: {
                    title: 'Semana 2 — Aprendizado',
                    desc: 'Mata os piores · variações dos top 2-3',
                    color: 'purple',
                  },
                  3: {
                    title: 'Semana 3 — Escala',
                    desc: 'Iterações dos winners · dobra budget se ROAS >2x',
                    color: 'amber',
                  },
                  4: {
                    title: 'Semana 4 — Produção',
                    desc: 'Linha de produção do best winner',
                    color: 'green',
                  },
                };
                const meta = weekLabels[w]!;
                const colorClasses: Record<string, string> = {
                  blue: 'from-blue-500 to-blue-600',
                  purple: 'from-purple-500 to-purple-600',
                  amber: 'from-amber-500 to-amber-600',
                  green: 'from-green-500 to-green-600',
                };
                const modeledCount = weekBriefs.filter((b: any) => b.modeledFromRefCopyId).length;
                return (
                  <section key={w} className="space-y-2">
                    <header className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-9 h-9 rounded-xl bg-gradient-to-br ${colorClasses[meta.color]} text-white flex items-center justify-center font-black text-sm`}
                        >
                          S{w}
                        </div>
                        <div>
                          <p className="text-sm font-black text-gray-900 dark:text-gray-50">
                            {meta.title} · {weekBriefs.length} criativos
                          </p>
                          <p className="text-[10px] text-gray-500 dark:text-gray-400">
                            {meta.desc}
                          </p>
                        </div>
                      </div>
                      {modeledCount > 0 && (
                        <span className="text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300">
                          🎯 {modeledCount} modelagem
                        </span>
                      )}
                    </header>
                    <ol className="space-y-2">
                      {weekBriefs.map((brief: any) => {
                        const color = personaColor.get(brief.targetPersonaId) || 'gray';
                        const isExecuted = !!briefToVariantMap?.[brief.id];
                        const colorBarClass =
                          color === 'blue'
                            ? 'bg-blue-500'
                            : color === 'purple'
                              ? 'bg-purple-500'
                              : color === 'amber'
                                ? 'bg-amber-500'
                                : 'bg-gray-400';
                        const isModeling = !!brief.modeledFromRefCopyId;
                        const lengthLabel =
                          brief.scriptLength === 'short'
                            ? 'curto'
                            : brief.scriptLength === 'long'
                              ? 'long'
                              : 'médio';
                        return (
                          <li
                            key={brief.id}
                            className={`group relative flex items-stretch bg-white dark:bg-gray-900/80 ring-1 ring-gray-200/60 dark:ring-gray-800 rounded-xl overflow-hidden transition-all hover:shadow-md ${
                              isExecuted ? 'bg-green-50/30 dark:bg-green-950/10' : ''
                            } ${isModeling ? 'ring-amber-300/60 dark:ring-amber-700/40' : ''}`}
                          >
                            <div className={`w-1.5 flex-shrink-0 ${colorBarClass}`} />
                            <div className="flex-1 flex items-center gap-3 p-3 min-w-0">
                              <span className="text-xs font-black text-gray-400 tabular-nums w-8">
                                #{brief.index}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-gray-900 dark:text-gray-50 truncate">
                                  {brief.hook || brief.angle}
                                </p>
                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                  <span className="text-[10px] text-gray-500 dark:text-gray-400">
                                    {brief.targetPersonaName} · {brief.angle}
                                  </span>
                                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                                    {lengthLabel}
                                  </span>
                                  {isModeling && (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 font-bold">
                                      🎯 modelagem
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {onBriefEdit && (
                                  <button
                                    onClick={() => onBriefEdit(brief)}
                                    className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-800"
                                    title="Editar"
                                  >
                                    <Edit3 size={12} />
                                  </button>
                                )}
                                {onBriefClick && !isExecuted && (
                                  <button
                                    onClick={() => onBriefClick(brief)}
                                    className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-black uppercase tracking-widest"
                                  >
                                    Criar →
                                  </button>
                                )}
                                {isExecuted && (
                                  <span className="text-green-600 dark:text-green-400 text-xs font-bold">
                                    <Check size={14} />
                                  </span>
                                )}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                );
              })}
            </div>
          )}

          {viewMode === 'flat' && (
            <>
              {/* Lista vertical — uma linha por brief. Layout flex pra:
              [tick] [persona color bar] [#] [main info] [chips] [actions] */}
              <ol className="space-y-2">
                {briefs.map((brief) => {
                  const color = personaColor.get(brief.targetPersonaId) || 'gray';
                  const isExecuted = !!briefToVariantMap?.[brief.id];
                  // Persona color bar (left edge) — visual grouping sem badge gigante
                  const colorBarClass =
                    color === 'blue'
                      ? 'bg-blue-500'
                      : color === 'purple'
                        ? 'bg-purple-500'
                        : color === 'amber'
                          ? 'bg-amber-500'
                          : 'bg-gray-400';
                  const awarenessNum =
                    brief.awareness === 'unaware'
                      ? '1'
                      : brief.awareness === 'problem_aware'
                        ? '2'
                        : brief.awareness === 'solution_aware'
                          ? '3'
                          : brief.awareness === 'product_aware'
                            ? '4'
                            : '5';
                  return (
                    <li
                      key={brief.id}
                      className={`group relative flex items-stretch bg-white dark:bg-gray-900/80 ring-1 ring-gray-200/60 dark:ring-gray-800 rounded-2xl overflow-hidden transition-all hover:shadow-md hover:ring-gray-300 dark:hover:ring-gray-700 ${
                        isExecuted ? 'bg-green-50/30 dark:bg-green-950/10' : ''
                      }`}
                    >
                      {/* Color bar — left edge, persona color */}
                      <div className={`w-1.5 flex-shrink-0 ${colorBarClass}`} />

                      {/* Content */}
                      <div className="flex-1 flex items-center gap-3 p-3 min-w-0">
                        {/* Tick / circle */}
                        <div
                          className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ring-1 ${
                            isExecuted
                              ? 'bg-green-100 dark:bg-green-950/40 ring-green-300 dark:ring-green-800 text-green-700 dark:text-green-400'
                              : 'bg-white dark:bg-gray-900 ring-gray-300 dark:ring-gray-700 text-gray-400 dark:text-gray-600'
                          }`}
                        >
                          {isExecuted ? <Check size={14} strokeWidth={3} /> : <Circle size={10} />}
                        </div>

                        {/* Index */}
                        <span className="flex-shrink-0 text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 tabular-nums w-12">
                          Cr.{brief.index}
                        </span>

                        {/* Main column: hook + persona + rationale */}
                        <div className="flex-1 min-w-0 space-y-0.5">
                          <p className="text-sm font-bold text-gray-900 dark:text-gray-50 leading-tight line-clamp-1">
                            "{brief.hook}"
                          </p>
                          <div className="flex items-center gap-2 text-[10px] text-gray-500 dark:text-gray-400">
                            <span className="font-bold truncate max-w-[180px]">
                              {brief.targetPersonaName}
                            </span>
                            {brief.rationale && (
                              <>
                                <span>·</span>
                                <span className="italic truncate">{brief.rationale}</span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Chips: Consc + Duração + Angle */}
                        <div className="hidden md:flex flex-shrink-0 items-center gap-1.5 text-[9px]">
                          <span className="font-black uppercase tracking-widest px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-200/60 dark:ring-indigo-800/40">
                            Consc. {awarenessNum}
                          </span>
                          <span className="font-black uppercase tracking-widest px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800/60 text-gray-600 dark:text-gray-400">
                            {brief.durationTarget}s
                          </span>
                          <span
                            className="font-black uppercase tracking-widest px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800/60 text-gray-600 dark:text-gray-400 truncate max-w-[100px]"
                            title={String(brief.angle)}
                          >
                            {brief.angle}
                          </span>
                        </div>

                        {/* Actions */}
                        <div className="flex-shrink-0 flex items-center gap-1">
                          <button
                            onClick={() => onBriefEdit?.(brief)}
                            title="Editar brief"
                            className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                          >
                            <Edit3 size={13} />
                          </button>
                          <button
                            onClick={() => onBriefClick?.(brief)}
                            className={`text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
                              isExecuted
                                ? 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/40'
                                : 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-black dark:hover:bg-white'
                            }`}
                          >
                            {isExecuted ? 'Abrir' : '+ Criar Subprojeto'}
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PlanCard({
  icon,
  label,
  accent,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-gray-900/80 border-2 border-gray-200 dark:border-gray-800 rounded-3xl p-6">
      <div className={`flex items-center gap-2 mb-2 ${accent}`}>
        {icon}
        <h3 className="font-black uppercase text-xs tracking-widest">{label}</h3>
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-3xl font-black text-gray-900 dark:text-gray-50">{value}</div>
      <div className="text-[9px] uppercase tracking-widest text-gray-500 dark:text-gray-400 font-bold">
        {label}
      </div>
    </div>
  );
}
