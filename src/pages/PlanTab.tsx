import { useEffect, useState } from 'react';
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
} from 'lucide-react';
import jsPDF from 'jspdf';
import { generateMarketingPlan, type MarketingPlan } from '@/lib/claudeService';

interface Props {
  productInfo?: any;
  persona?: any;
  copyAnswers?: any;
  cached?: MarketingPlan | null;
  onChange: (plan: MarketingPlan) => void;
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
  onChange,
  onContinue,
}: Props) {
  const [plan, setPlan] = useState<MarketingPlan | null>(cached ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // Auto-fetch on first mount when nothing cached.
  useEffect(() => {
    if (!cached && !plan && !loading && !error) {
      void fetchPlan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h2 className="text-3xl font-black text-gray-900 dark:text-gray-50 tracking-tight">
            Plano de Marketing
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 dark:text-gray-500 max-w-2xl">
            Estratégia completa pra Meta Ads considerando Andromeda: volume e diversidade vencem
            perfeição individual. Quantos criativos, quais ângulos, durações, estrutura de campanha
            — tudo calculado pra esse produto + persona.
          </p>
        </div>
        <div className="flex items-center gap-4">
          {plan && (
            <button
              onClick={handleDownloadPDF}
              className="text-xs font-bold uppercase tracking-widest text-gray-700 dark:text-gray-300 dark:text-gray-600 hover:text-gray-900 dark:text-gray-50 flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-gray-400"
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

      {/* Skip-to-copy shortcut: user can bypass the plan and jump straight
          to copywriting if they don't need the strategy guide right now. */}
      <div className="bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-2xl px-5 py-3 flex items-center justify-between gap-4">
        <p className="text-xs text-gray-600 dark:text-gray-400 dark:text-gray-500">
          Não quer ver o plano agora? Pode pular pra Copy.
        </p>
        <button
          onClick={onContinue}
          className="text-xs font-black uppercase tracking-widest text-gray-700 dark:text-gray-300 dark:text-gray-600 hover:text-gray-900 dark:text-gray-50 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white dark:bg-gray-900/80 border border-gray-200 dark:border-gray-700 hover:border-gray-400"
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
          <p className="text-sm text-purple-800 font-bold">Construindo plano de marketing...</p>
          <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
            Pode levar 20-40s (Claude analisando produto + persona)
          </p>
        </div>
      )}

      {error && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 rounded-xl p-4 text-sm text-amber-900 flex items-start justify-between gap-3">
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
          <div className="bg-gradient-to-br from-purple-50 to-blue-50 border-2 border-purple-200 rounded-3xl p-6">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles size={18} className="text-purple-600 dark:text-purple-400" />
              <h3 className="font-black uppercase text-xs tracking-widest text-purple-900">
                Estratégia macro
              </h3>
            </div>
            <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-line">
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
              <p className="text-xs text-gray-600 dark:text-gray-400 dark:text-gray-500">
                {plan.creativeVolume.perAudience} por audiência
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 mt-3 leading-relaxed">
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
              <p className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 mt-3 leading-relaxed">
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
                    <span className="text-[10px] font-black uppercase tracking-widest text-amber-800">
                      {h.angle}
                    </span>
                    <span className="text-xs font-black bg-amber-200 text-amber-900 px-2 py-0.5 rounded-full">
                      {h.count}×
                    </span>
                  </div>
                  <p className="text-sm text-gray-900 dark:text-gray-50 font-medium italic">
                    "{h.example}"
                  </p>
                  <div className="flex flex-wrap gap-2 text-[10px]">
                    <span className="bg-white dark:bg-gray-900/80 border border-amber-200 text-amber-800 px-2 py-0.5 rounded-full">
                      {AWARENESS_PT[h.awarenessLevel] || h.awarenessLevel}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-600 dark:text-gray-400 dark:text-gray-500">
                    {h.rationale}
                  </p>
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
                      <div className="text-xs font-black text-purple-900">
                        {AWARENESS_PT[a.level] || a.level}
                      </div>
                      <div className="text-[11px] text-gray-600 dark:text-gray-400 dark:text-gray-500 mt-0.5">
                        {a.approach}
                      </div>
                    </div>
                    <span className="text-xs font-black bg-purple-200 text-purple-900 px-2 py-0.5 rounded-full whitespace-nowrap">
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
                      <div className="text-xs font-black text-blue-900">{d.length}</div>
                      <div className="text-[11px] text-gray-600 dark:text-gray-400 dark:text-gray-500 mt-0.5">
                        {d.purpose}
                      </div>
                    </div>
                    <span className="text-xs font-black bg-blue-200 text-blue-900 px-2 py-0.5 rounded-full whitespace-nowrap">
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
                  <div className="text-[10px] uppercase tracking-widest text-gray-500 dark:text-gray-400 dark:text-gray-500 font-bold">
                    Mínimo
                  </div>
                  <div className="text-2xl font-black text-gray-900 dark:text-gray-50">
                    R${plan.budget.dailyMin}
                    <span className="text-xs font-normal text-gray-500 dark:text-gray-400 dark:text-gray-500">
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
              <p className="text-[11px] text-gray-600 dark:text-gray-400 dark:text-gray-500 leading-relaxed">
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
                  <span className="font-black text-gray-700 dark:text-gray-300 dark:text-gray-600">
                    Revisar:
                  </span>{' '}
                  <span className="text-gray-900 dark:text-gray-50">
                    {plan.iterationPlan.iterationFrequency}
                  </span>
                </div>
              </div>
            </PlanCard>
          </div>

          {/* Andromeda Tips */}
          {plan.andromedaTips?.length > 0 && (
            <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border-2 border-indigo-200 rounded-3xl p-6">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles size={18} className="text-indigo-600" />
                <h3 className="font-black uppercase text-xs tracking-widest text-indigo-900">
                  Dicas específicas pra Andromeda
                </h3>
              </div>
              <ul className="space-y-2">
                {plan.andromedaTips.map((tip, i) => (
                  <li key={i} className="flex gap-2 text-sm text-gray-800">
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
                  <li key={i} className="text-sm text-gray-800">
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
      <div className="text-[9px] uppercase tracking-widest text-gray-500 dark:text-gray-400 dark:text-gray-500 font-bold">
        {label}
      </div>
    </div>
  );
}
