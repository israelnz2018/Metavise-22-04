import { useEffect, useMemo, useState } from 'react';
import {
  Sparkles,
  Loader2,
  RefreshCw,
  ArrowRight,
  Users,
  AlertTriangle,
  Check,
  Edit3,
  Layers,
  Target,
  Clapperboard,
} from 'lucide-react';
import {
  generateCreativePlan,
  type AwarenessReadout,
} from '@/lib/claudeService';
import type { WeightedPersona, CreativeBrief } from '@/types/project';
import { currencySymbol } from '@/lib/constants';

/** Meta do plano persistida em config.copy.marketingPlan — só o que precisa
 *  pra reabrir a aba com os inputs e a leitura de consciência. */
export interface PlanMeta {
  inputs: {
    dailyBudget: number;
    targetCpa: number;
    productPrice: number;
    structure: 'cbo' | 'abo';
    costPerCreative: number;
    desiredCount: number;
  };
  awareness: AwarenessReadout[];
  numCreatives: number;
  structure: 'cbo' | 'abo';
}

interface Props {
  /** Nome do projeto, exibido no topo da aba. */
  projectName?: string;
  productInfo?: any;
  persona?: any;
  copyAnswers?: any;
  sourceMode?: 'vsl' | 'product' | null;
  onSourceModeChange?: (next: 'vsl' | 'product') => void;
  cached?: PlanMeta | null;
  /** Personas com peso, vindas da PersonaTab. O plano distribui os criativos
   *  entre elas pelos pesos. */
  personasWithWeights?: WeightedPersona[] | null;
  /** Briefs de uma geração anterior (sobrevive a reloads). */
  cachedBriefs?: CreativeBrief[] | null;
  onChange: (meta: PlanMeta) => void;
  /** App.tsx persiste os briefs em config. */
  onBriefsChange?: (briefs: CreativeBrief[]) => void;
  /** Clique num brief — abre o popup "Criar Subprojeto". */
  onBriefClick?: (brief: CreativeBrief) => void;
  /** Abre o modal de edição do brief. */
  onBriefEdit?: (brief: CreativeBrief) => void;
  /** Mapa brief id → variant id, pra mostrar status "✓ criado". */
  briefToVariantMap?: Record<string, string>;
  /** Abrir a aba "Copy da VSL" pra criar a VSL do plano. Recebe a duração
   *  recomendada (em palavras ≈ min×150) pra pré-preencher. */
  onCreateVsl?: (recommendedWords: number) => void;
  onContinue: () => void;
}

// Níveis de consciência — rótulo + número (1-5) pro selo compacto.
const AWARENESS_PT: Record<string, string> = {
  unaware: 'Não consciente',
  problem_aware: 'Consciente do problema',
  solution_aware: 'Consciente da solução',
  product_aware: 'Consciente do produto',
  most_aware: 'Mais consciente',
};
const AWARENESS_NUM: Record<string, string> = {
  unaware: '1',
  problem_aware: '2',
  solution_aware: '3',
  product_aware: '4',
  most_aware: '5',
};

// Menu fixo de ângulos (guia-da-copy) → rótulo PT.
const ANGLE_PT: Record<string, string> = {
  choque: 'Choque / contra-intuitivo',
  curiosidade: 'Curiosidade',
  historia: 'História',
  dor: 'Dor',
  medo_de_perda: 'Medo de perder',
  prova: 'Prova',
  autoridade: 'Autoridade',
  mecanismo: 'Mecanismo',
  comparacao: 'Comparação',
  transformacao: 'Transformação',
  urgencia: 'Urgência',
};

// Distribui `total` criativos entre as personas pelo peso (floor + resto pros
// maiores fracionários). Espelha a conta do backend pra prévia bater.
function distributeByWeight(
  personas: WeightedPersona[],
  total: number
): Array<{ id: string; name: string; count: number }> {
  const sum = personas.reduce((acc, p) => acc + (Number(p.suggestedWeight) || 0), 0) || 1;
  const raw = personas.map((p) => ({
    id: p.id,
    name: p.name,
    raw: ((Number(p.suggestedWeight) || 0) / sum) * total,
  }));
  const out = raw.map((r) => ({ id: r.id, name: r.name, count: Math.floor(r.raw) }));
  let allocated = out.reduce((acc, r) => acc + r.count, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r.raw - Math.floor(r.raw) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (allocated >= total) break;
    out[i]!.count += 1;
    allocated += 1;
  }
  return out;
}

export function PlanTab({
  projectName,
  productInfo,
  copyAnswers,
  cached,
  personasWithWeights,
  cachedBriefs,
  onChange,
  onBriefsChange,
  onBriefClick,
  onBriefEdit,
  briefToVariantMap,
  onCreateVsl,
  onContinue,
}: Props) {
  const personas = useMemo(
    () => (Array.isArray(personasWithWeights) ? personasWithWeights : []),
    [personasWithWeights]
  );
  const sym = currencySymbol((copyAnswers as any)?.saleCurrency || 'BRL');

  // Inputs do plano — números como string pra permitir campo vazio.
  const [dailyBudget, setDailyBudget] = useState(
    cached?.inputs?.dailyBudget ? String(cached.inputs.dailyBudget) : ''
  );
  const [targetCpa, setTargetCpa] = useState(
    cached?.inputs?.targetCpa ? String(cached.inputs.targetCpa) : ''
  );
  const [productPrice, setProductPrice] = useState(
    cached?.inputs?.productPrice ? String(cached.inputs.productPrice) : ''
  );
  const [structure, setStructure] = useState<'cbo' | 'abo'>(cached?.inputs?.structure || 'cbo');
  const [costPerCreative, setCostPerCreative] = useState(
    cached?.inputs?.costPerCreative ? String(cached.inputs.costPerCreative) : ''
  );
  // Enquanto não editar à mão, o custo/criativo acompanha o recomendado da
  // estrutura (CBO ~0,5× CPA · ABO ~1× CPA) — assim trocar CBO↔ABO recalcula
  // o número de criativos sozinho.
  const [costTouched, setCostTouched] = useState(!!cached?.inputs?.costPerCreative);
  // Quantos criativos o usuário QUER fazer (editável). Pré-preenchido com o
  // recomendado, mas ele manda. desiredTouched = true quando ele edita à mão,
  // pra parar de sobrescrever com o recomendado.
  const [desired, setDesired] = useState(
    cached?.inputs?.desiredCount ? String(cached.inputs.desiredCount) : ''
  );
  const [desiredTouched, setDesiredTouched] = useState(!!cached?.inputs?.desiredCount);

  const [briefs, setBriefs] = useState<CreativeBrief[]>(cachedBriefs ?? []);
  const [awareness, setAwareness] = useState<AwarenessReadout[]>(cached?.awareness ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nBudget = Number(dailyBudget) || 0;
  const nCpa = Number(targetCpa) || 0;
  const nPrice = Number(productPrice) || 0;
  const nCost = Number(costPerCreative) || 0;

  // ABO: cada conjunto = 1 criativo, com verba fixa ≈ 1× CPA por conjunto.
  const recommendedCost = nCpa > 0 ? nCpa : 0;

  // Enquanto não editar à mão, o custo por conjunto acompanha o recomendado.
  useEffect(() => {
    if (!costTouched && recommendedCost > 0) setCostPerCreative(String(Math.round(recommendedCost)));
  }, [recommendedCost, costTouched]);

  const clampCount = (n: number) => Math.max(1, Math.min(Math.floor(n), 40));
  // Recomendação por estrutura (mostradas lado a lado pra comparar). A verba
  // fica em níveis diferentes:
  //  - CBO: a verba é da CAMPANHA; o Meta divide entre os criativos. Cada um
  //    precisa de ~0,5× CPA pra ser avaliado → cabem ~orçamento ÷ (0,5× CPA).
  //  - ABO: a verba é por CONJUNTO (= 1 criativo), ~1× CPA cada → o orçamento
  //    total comporta ~orçamento ÷ CPA conjuntos.
  const recCBO = nBudget > 0 && nCpa > 0 ? clampCount(nBudget / (nCpa * 0.5)) : 0;
  const recABO = nBudget > 0 && nCpa > 0 ? clampCount(nBudget / nCpa) : 0;
  // Custo por conjunto/criativo (ABO) recomendado, p/ exibir nos cards.
  const recCostPerSet = nCpa > 0 ? Math.round(nCpa) : 0;

  // Número que pré-preenche o campo, conforme a estrutura. Em ABO usa o custo
  // por conjunto (editável); em CBO, a recomendação broad.
  const recommended =
    structure === 'cbo' ? recCBO : nBudget > 0 && nCost > 0 ? clampCount(nBudget / nCost) : recABO;

  // Enquanto o usuário não editar à mão, o número acompanha o recomendado.
  useEffect(() => {
    if (!desiredTouched && recommended > 0) setDesired(String(recommended));
  }, [recommended, desiredTouched]);

  const nDesired = Math.max(0, Math.min(Number(desired) || 0, 40));
  // ABO: custo por conjunto efetivo e total/dia que será gasto de fato.
  const aboCostPerSet = nCost > 0 ? nCost : recCostPerSet;
  const aboTotal = aboCostPerSet > 0 && nDesired > 0 ? aboCostPerSet * nDesired : 0;

  // Aviso (não bloqueia — Metavise nunca proíbe).
  const cpaWarning =
    nCpa > 0 && nPrice > 0 && nCpa >= nPrice
      ? `CPA máximo (${sym}${nCpa}) é maior ou igual ao preço (${sym}${nPrice}) — isso dá prejuízo por venda.`
      : null;

  // Guia do número desejado, conforme a estrutura.
  //  - ABO: o recomendado é TETO (cada anúncio precisa da verba dele). Avisa se passar.
  //  - CBO: pode carregar mais (o algoritmo escolhe os vencedores). Enquadra positivo.
  const countGuidance =
    structure === 'abo'
      ? nDesired > 0 && recommended > 0 && nDesired > recommended
        ? {
            tone: 'warn' as const,
            text: `Acima do recomendado: em ABO cada anúncio recebe verba fixa, e com esse orçamento dá pra ~${recommended} com sinal de verdade. Acima disso, divide demais. Faixa típica: 3–6.`,
          }
        : { tone: 'info' as const, text: 'Em ABO, o ideal é ficar no recomendado ou abaixo. Faixa típica: 3–6.' }
      : {
          tone: 'info' as const,
          text: 'Em CBO pode carregar mais — o Meta concentra a verba nos que vendem. Mais criativos = mais chances de achar um vencedor. Faixa típica: 10–20.',
        };

  const distribution = useMemo(
    () => (nDesired > 0 ? distributeByWeight(personas, nDesired) : []),
    [personas, nDesired]
  );

  const canGenerate = personas.length > 0 && nDesired > 0 && !loading;

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setLoading(true);
    setError(null);
    try {
      const result = await generateCreativePlan({
        productInfo,
        personas,
        copyAnswers,
        dailyBudget: nBudget,
        targetCpa: nCpa,
        productPrice: nPrice,
        structure,
        costPerCreative: nCost,
        desiredCount: nDesired,
      });
      setBriefs(result.briefs);
      setAwareness(result.awareness);
      onBriefsChange?.(result.briefs);
      onChange({
        inputs: {
          dailyBudget: nBudget,
          targetCpa: nCpa,
          productPrice: nPrice,
          structure,
          costPerCreative: nCost,
          desiredCount: nDesired,
        },
        awareness: result.awareness,
        numCreatives: result.numCreatives,
        structure: result.structure,
      });
    } catch (e: any) {
      setError(e?.message || 'Erro ao gerar o plano de criativos.');
    } finally {
      setLoading(false);
    }
  };

  const executedCount = briefs.filter((b) => briefToVariantMap?.[b.id]).length;

  const numField = (
    label: string,
    hint: string,
    value: string,
    onValue: (v: string) => void,
    placeholder = '0'
  ) => (
    <div>
      <label className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300 block mb-1">
        {label}
      </label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-gray-400">
          {sym}
        </span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          value={value}
          onChange={(e) => onValue(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-10 pr-3 py-2.5 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-50 font-bold focus:border-blue-500 focus:outline-none"
        />
      </div>
      <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">{hint}</p>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="space-y-1">
        {projectName && (
          <p className="text-[11px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-400">
            {projectName}
          </p>
        )}
        <h2 className="text-3xl font-black text-gray-900 dark:text-gray-50 tracking-tight flex items-center gap-2">
          <Layers size={26} className="text-blue-600 dark:text-blue-400" />
          Plano de criativos
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 max-w-2xl">
          Define <strong>quantos</strong> anúncios fazer, pra <strong>qual persona</strong>, em que{' '}
          <strong>nível de consciência</strong> e com qual <strong>ângulo</strong>. O gancho e a copy
          vêm depois.
        </p>
      </header>

      {/* Inputs do plano */}
      <div className="bg-white/80 dark:bg-gray-900/60 ring-1 ring-gray-200/60 dark:ring-gray-800/60 rounded-3xl p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Target size={18} className="text-blue-600 dark:text-blue-400" />
          <h3 className="font-black uppercase text-xs tracking-widest text-gray-700 dark:text-gray-300">
            Mídia
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {numField('Orçamento por dia', 'Quanto você vai gastar por dia.', dailyBudget, setDailyBudget)}
          {numField(
            'CPA máximo',
            'CPA = custo por aquisição (quanto você paga, em média, por cada venda). Informe o máximo que aceita pagar.',
            targetCpa,
            setTargetCpa
          )}
          {numField('Preço do produto', 'Valor de uma compra.', productPrice, setProductPrice)}
        </div>

        {/* Estrutura CBO/ABO */}
        <div>
          <label className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300 block mb-0.5">
            Estrutura da campanha
          </label>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-1.5 leading-snug">
            É quem decide quanto cada anúncio recebe de verba: o Meta (CBO) ou você (ABO).
          </p>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                {
                  key: 'cbo' as const,
                  title: 'CBO',
                  desc: 'Você põe a verba na campanha e o Meta divide sozinho entre os anúncios, dando mais pros que vendem. Aguenta muitos criativos. Recomendado.',
                },
                {
                  key: 'abo' as const,
                  title: 'ABO',
                  desc: 'Você define a verba fixa de cada anúncio. Mais controle, mas testa poucos por vez. Bom pra forçar um teste justo.',
                },
              ]
            ).map((opt) => (
              <button
                key={opt.key}
                onClick={() => setStructure(opt.key)}
                className={`text-left p-3 rounded-2xl border-2 transition-all ${
                  structure === opt.key
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                }`}
              >
                <span className="font-black text-sm text-gray-900 dark:text-gray-50">{opt.title}</span>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 leading-snug">
                  {opt.desc}
                </p>
                {opt.key === 'cbo' && recCBO > 0 && (
                  <p className="text-[10px] font-black text-blue-700 dark:text-blue-300 mt-1.5 leading-snug">
                    {sym}
                    {nBudget}/dia na campanha → ~{recCBO} criativos
                  </p>
                )}
                {opt.key === 'abo' && recABO > 0 && (
                  <p className="text-[10px] font-black text-blue-700 dark:text-blue-300 mt-1.5 leading-snug">
                    {sym}
                    {recCostPerSet}/conjunto × {recABO} = {sym}
                    {recCostPerSet * recABO}/dia → {recABO} criativos
                  </p>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Aviso */}
        {cpaWarning && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 text-amber-800 dark:text-amber-200 text-xs">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>{cpaWarning}</span>
          </div>
        )}

        {/* ABO: verba por conjunto/criativo (1:1) + valor total */}
        {structure === 'abo' && (
          <div className="rounded-2xl bg-gray-50 dark:bg-gray-800/40 ring-1 ring-gray-200/60 dark:ring-gray-700/60 p-4 space-y-2">
            <label className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300 block">
              Orçamento por conjunto / criativo
            </label>
            <div className="flex items-center gap-2">
              <div className="relative w-32">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-gray-400">
                  {sym}
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={costPerCreative}
                  onChange={(e) => {
                    setCostPerCreative(e.target.value);
                    setCostTouched(true);
                  }}
                  placeholder={recCostPerSet ? String(recCostPerSet) : '0'}
                  className="w-full pl-9 pr-3 py-2 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-50 font-bold focus:border-blue-500 focus:outline-none"
                />
              </div>
              {recCostPerSet > 0 && nCost !== recCostPerSet && (
                <button
                  onClick={() => {
                    setCostPerCreative(String(recCostPerSet));
                    setCostTouched(false);
                  }}
                  className="text-[10px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300 hover:underline"
                >
                  Usar {sym}
                  {recCostPerSet} (1× CPA)
                </button>
              )}
            </div>
            <p className="text-[10px] text-gray-500 dark:text-gray-400">
              Cada conjunto tem 1 criativo e recebe essa verba fixa. Recomendado ≈ 1× CPA.
            </p>
            {aboTotal > 0 && (
              <p className="text-[11px] font-bold text-gray-700 dark:text-gray-300">
                Valor total/dia: {sym}
                {aboCostPerSet} × {nDesired} ={' '}
                <span className="text-blue-700 dark:text-blue-300">
                  {sym}
                  {aboTotal}
                </span>
              </p>
            )}
          </div>
        )}

        {/* Número de criativos — recomendado já preenchido, editável */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3 p-4 rounded-2xl bg-gray-50 dark:bg-gray-800/40 ring-1 ring-gray-200/60 dark:ring-gray-700/60">
            <div className="min-w-0">
              <span className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300 block">
                Número de criativos{structure === 'abo' ? ' (= conjuntos)' : ''}
              </span>
              {recommended > 0 ? (
                <span className="text-[10px] text-gray-500 dark:text-gray-400">
                  Recomendado p/ {structure.toUpperCase()}: {recommended}. Pode editar.
                </span>
              ) : (
                <span className="text-[10px] text-gray-500 dark:text-gray-400">
                  Preencha orçamento e CPA, ou digite quantos quer.
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {recommended > 0 && nDesired !== recommended && (
                <button
                  onClick={() => {
                    setDesired(String(recommended));
                    setDesiredTouched(false);
                  }}
                  className="text-[10px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300 hover:underline"
                >
                  Usar {recommended}
                </button>
              )}
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={40}
                value={desired}
                onChange={(e) => {
                  setDesired(e.target.value);
                  setDesiredTouched(true);
                }}
                placeholder={recommended ? String(recommended) : '0'}
                className="w-20 px-2 py-1.5 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-50 font-black text-center text-2xl tabular-nums focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
          {structure === 'cbo' && nBudget > 0 && nDesired > 0 && (
            <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug">
              Você coloca {sym}
              {nBudget}/dia na campanha; o Meta divide entre os {nDesired} criativos, dando mais
              verba pros que vendem.
            </p>
          )}
          <p
            className={`text-[11px] leading-snug ${
              countGuidance.tone === 'warn'
                ? 'text-amber-700 dark:text-amber-300 font-bold'
                : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            {countGuidance.text}
          </p>
        </div>
      </div>

      {/* Personas + distribuição prévia */}
      {personas.length > 0 && (
        <div className="bg-white/80 dark:bg-gray-900/60 ring-1 ring-gray-200/60 dark:ring-gray-800/60 rounded-3xl p-6 space-y-3">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-blue-600 dark:text-blue-400" />
            <h3 className="font-black uppercase text-xs tracking-widest text-gray-700 dark:text-gray-300">
              Personas ({personas.length})
            </h3>
          </div>
          <ul className="space-y-1.5">
            {personas.map((p) => {
              const d = distribution.find((x) => x.id === p.id);
              return (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 text-sm py-1.5 px-3 rounded-xl bg-gray-50 dark:bg-gray-800/40"
                >
                  <span className="font-bold text-gray-900 dark:text-gray-50 truncate">{p.name}</span>
                  <span className="text-[11px] font-black tabular-nums text-gray-500 dark:text-gray-400 shrink-0">
                    {Math.round((Number(p.suggestedWeight) || 0) * 100)}%
                    {nDesired > 0 && d ? ` · ${d.count} criativos` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Gerar */}
      <button
        onClick={handleGenerate}
        disabled={!canGenerate}
        className="w-full py-5 bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 active:scale-[0.99] text-white rounded-2xl font-black uppercase tracking-widest text-sm transition-all shadow-xl shadow-blue-200/60 dark:shadow-blue-900/30 ring-1 ring-inset ring-white/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
      >
        {loading ? (
          <>
            <Loader2 size={18} className="animate-spin" /> Gerando plano…
          </>
        ) : briefs.length > 0 ? (
          <>
            <RefreshCw size={18} /> Refazer plano
          </>
        ) : (
          <>
            <Sparkles size={18} /> Gerar plano de criativos
          </>
        )}
      </button>
      {!canGenerate && !loading && personas.length === 0 && (
        <p className="text-center text-[11px] text-gray-500 dark:text-gray-400">
          Defina as personas na etapa anterior pra gerar o plano.
        </p>
      )}

      {error && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 rounded-xl p-4 text-sm text-amber-900 dark:text-amber-200 flex items-start gap-2">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span className="text-xs">{error}</span>
        </div>
      )}

      {/* Leitura de consciência por persona */}
      {awareness.length > 0 && (
        <div className="bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-950/40 dark:to-blue-950/40 border-2 border-purple-200 dark:border-purple-800/60 rounded-3xl p-6 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-purple-600 dark:text-purple-400" />
            <h3 className="font-black uppercase text-xs tracking-widest text-purple-900 dark:text-purple-200">
              Nível de consciência (deduzido)
            </h3>
          </div>
          <ul className="space-y-2">
            {awareness.map((a) => (
              <li
                key={a.personaId}
                className="bg-white/70 dark:bg-gray-900/50 rounded-2xl p-3 ring-1 ring-purple-200/50 dark:ring-purple-800/30"
              >
                <p className="font-bold text-sm text-gray-900 dark:text-gray-50">{a.personaName}</p>
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md bg-purple-100 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300">
                    Principal: {AWARENESS_PT[a.principal] || a.principal}
                  </span>
                  {(a.secundarios || []).map((s) => (
                    <span
                      key={s}
                      className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400"
                    >
                      {AWARENESS_PT[s] || s}
                    </span>
                  ))}
                </div>
                {a.motivo && (
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5 leading-snug">
                    {a.motivo}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Lista de briefs */}
      {briefs.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-black uppercase text-xs tracking-widest text-gray-700 dark:text-gray-300">
              Criativos ({briefs.length})
            </h3>
            {executedCount > 0 && (
              <span className="text-[11px] font-bold text-green-600 dark:text-green-400">
                {executedCount} de {briefs.length} criados
              </span>
            )}
          </div>

          {/* VSL do plano — a peça longa que VENDE (os criativos acima levam
              tráfego pra ela). Duração recomendada pelo ticket da oferta. */}
          {(() => {
            const vslMin = nPrice >= 1000 ? 40 : nPrice >= 300 ? 30 : nPrice >= 100 ? 20 : 15;
            const ticket = nPrice >= 300 ? 'alto' : nPrice >= 100 ? 'médio' : 'baixo';
            return (
              <div className="flex items-stretch bg-gradient-to-br from-purple-50 to-purple-100/40 dark:from-purple-950/30 dark:to-purple-900/20 ring-1 ring-purple-200/60 dark:ring-purple-800/50 rounded-2xl overflow-hidden">
                <div className="w-1.5 flex-shrink-0 bg-purple-500" />
                <div className="flex-1 flex items-center gap-3 p-3.5 min-w-0">
                  <Clapperboard
                    size={20}
                    className="text-purple-600 dark:text-purple-400 flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-black text-gray-900 dark:text-gray-50">
                        VSL do plano
                      </p>
                      <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md bg-purple-100 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300">
                        ~{vslMin} min
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug mt-0.5">
                      Ticket {ticket}: VSL de ~{vslMin} min pra construir desejo, prova e quebrar
                      objeções. Os criativos abaixo levam tráfego pra ela.
                    </p>
                  </div>
                  {onCreateVsl && (
                    <button
                      onClick={() => onCreateVsl(vslMin * 150)}
                      className="flex-shrink-0 px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-[10px] font-black uppercase tracking-widest"
                    >
                      Criar VSL →
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

          <ol className="space-y-2">
            {briefs.map((brief) => {
              const isExecuted = !!briefToVariantMap?.[brief.id];
              const angleLabel = ANGLE_PT[String(brief.angle)] || String(brief.angle);
              return (
                <li
                  key={brief.id}
                  className={`group relative flex items-stretch bg-white dark:bg-gray-900/80 ring-1 ring-gray-200/60 dark:ring-gray-800 rounded-2xl overflow-hidden transition-all hover:shadow-md hover:ring-gray-300 dark:hover:ring-gray-700 ${
                    isExecuted ? 'bg-green-50/30 dark:bg-green-950/10' : ''
                  }`}
                >
                  <div className="w-1.5 flex-shrink-0 bg-blue-500" />
                  <div className="flex-1 flex items-center gap-3 p-3 min-w-0">
                    <span className="text-xs font-black text-gray-400 tabular-nums w-8">
                      #{brief.index}
                    </span>
                    <div className="flex-shrink-0 w-[150px] min-w-0">
                      <p className="text-sm font-bold text-gray-900 dark:text-gray-50 truncate">
                        {brief.targetPersonaName}
                      </p>
                      <p className="text-[9px] uppercase tracking-widest text-gray-400 dark:text-gray-500 font-bold">
                        Persona
                      </p>
                    </div>
                    <div className="flex-1 flex items-center justify-end gap-1.5 text-[9px] flex-wrap">
                      <span
                        className="font-black uppercase tracking-widest px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-200/60 dark:ring-indigo-800/40"
                        title={AWARENESS_PT[brief.awareness] || brief.awareness}
                      >
                        Consc. {AWARENESS_NUM[brief.awareness] || '?'}
                      </span>
                      <span
                        className="font-black uppercase tracking-widest px-2 py-0.5 rounded-md bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 truncate max-w-[160px]"
                        title={angleLabel}
                      >
                        {angleLabel}
                      </span>
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
                      {onBriefClick && isExecuted && (
                        <button
                          onClick={() => onBriefClick(brief)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-[10px] font-black uppercase tracking-widest"
                          title="Abrir o subprojeto já criado"
                        >
                          <Check size={12} /> Abrir →
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>

          <button
            onClick={onContinue}
            className="w-full py-4 bg-gray-900 dark:bg-gray-50 text-white dark:text-gray-900 rounded-2xl font-black uppercase tracking-widest text-sm hover:opacity-90 transition-all flex items-center justify-center gap-2"
          >
            Continuar pra copy <ArrowRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
