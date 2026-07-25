import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { loadVariants } from '@/lib/variantStore';
import { getMetaConnection, type CreativeMetrics } from '@/lib/metaAds';
import { BarChart3, Loader2, Link2Off, ShieldAlert, TrendingUp } from 'lucide-react';
import type { MonthlyPlanConfig } from '@/types/project';

// PERFORMANCE (Meta Ads) — fecha o loop "gerou → rodou → o que vendeu".
// A estrutura está PRONTA, mas a conexão está DESLIGADA de propósito (contas do
// Meta caindo quando linkadas ao Claude). A tabela mostra os criativos com as
// colunas de métrica em "—" até liberarmos a conexão. Enquanto isso, uma
// ESTIMATIVA de ROI (projeção) cruza o CPA-alvo do plano com o gasto de mídia.

interface Props {
  projectId?: string | null;
  projectName?: string;
  plan?: MonthlyPlanConfig | null;
}

interface Row {
  creativeId: string;
  name: string;
  source: string;
  metrics?: CreativeMetrics;
}

export function PerformanceTab({ projectId, projectName, plan }: Props) {
  const conn = getMetaConnection();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [creationCostMonth, setCreationCostMonth] = useState(0);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    (async () => {
      try {
        const variants = await loadVariants(projectId);
        const out: Row[] = [];
        const seen = new Set<string>();
        const push = (url: string, name: string, source: string) => {
          if (!url || seen.has(url)) return;
          seen.add(url);
          out.push({ creativeId: url, name, source });
        };
        const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
        let cost = 0;
        for (const v of variants) {
          const cfg = (v.config || {}) as any;
          const name = v.name || 'Sem nome';
          const edit = cfg?.edit || {};
          (edit.zapVersions || []).forEach((u: string) => push(u, name, 'Edição'));
          (edit.zapVslVersions || []).forEach((u: string) => push(u, name, 'Edição VSL'));
          (edit.zapHookVersions || []).forEach((u: string) => push(u, name, 'Gancho'));
          if (cfg?.montagem?.resultUrl) push(cfg.montagem.resultUrl, name, 'Montagem');
          if (cfg?.videoUrl) push(cfg.videoUrl, name, 'Avatar');
          for (const c of (cfg?.costs as any[]) || []) {
            if ((Number(c.at) || 0) >= monthStart) cost += Number(c.amount) || 0;
          }
        }
        // Quando a conexão for liberada: fetchMetaMetrics(out.map(r=>r.creativeId))
        // e casar por creativeId. Por ora fica sem métrica (desconectado).
        setRows(out);
        setCreationCostMonth(cost);
      } catch (e: any) {
        toast.error(e?.message || 'Falha ao carregar os criativos.');
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId]);

  // ESTIMATIVA de ROI (projeção) — cruza o CPA-alvo e o preço do plano com o
  // GASTO DE MÍDIA (o custo real dominante: rodar o anúncio custa MUITO mais que
  // criá-lo). Assume que você bate o CPA-alvo; não é dado real (Meta desligado).
  const roi = (() => {
    if (!plan || !plan.idealCPA || !plan.productPrice) return null;
    const mediaSpend = (Number(plan.dailyBudgetUsd) || 0) * 30; // ~mês
    const creation = creationCostMonth;
    const totalCost = mediaSpend + creation;
    const purchases = plan.idealCPA > 0 ? mediaSpend / plan.idealCPA : 0; // se bater o CPA
    const revenue = purchases * plan.productPrice;
    const roas = totalCost > 0 ? revenue / totalCost : 0;
    const profit = revenue - totalCost;
    return { mediaSpend, creation, totalCost, purchases, revenue, roas, profit };
  })();

  if (!projectId) {
    return (
      <div className="max-w-3xl mx-auto p-8 text-center text-gray-500">
        Abra um projeto pra ver a performance dos criativos.
      </div>
    );
  }

  const col = 'px-3 py-2 text-right tabular-nums text-gray-400';
  const head = 'px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-gray-500';

  return (
    <div className="max-w-6xl mx-auto space-y-4 p-2">
      <div className="flex items-center gap-2">
        <BarChart3 size={20} className="text-blue-700 dark:text-blue-400" />
        <h2 className="text-lg font-black text-gray-900 dark:text-gray-100">
          Performance {projectName ? `· ${projectName}` : ''}
        </h2>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 -mt-2">
        Fecha o ciclo <b>gerou → rodou → o que vendeu</b>: quando conectado ao Meta Ads, cada
        criativo mostra gasto, CTR, CPA, ROAS e compras — pra você escalar o que performa.
      </p>

      {/* Banner de conexão — DESLIGADO de propósito */}
      <div className="p-4 rounded-2xl ring-1 ring-amber-200 dark:ring-amber-900 bg-amber-50/60 dark:bg-amber-950/20 space-y-2">
        <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
          <ShieldAlert size={18} />
          <span className="font-black text-sm">Meta Ads não conectado (de propósito)</span>
        </div>
        <p className="text-xs text-amber-800/80 dark:text-amber-300/80">
          {conn.reason} A estrutura está pronta — quando for seguro, a conexão liga aqui e as
          colunas abaixo se preenchem sozinhas.
        </p>
        <button
          disabled
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-200 dark:bg-gray-800 text-gray-400 text-xs font-black cursor-not-allowed"
          title="Desativado por ora — contas do Meta caindo ao linkar com o Claude"
        >
          <Link2Off size={14} /> Conectar Meta Ads (desativado)
        </button>
      </div>

      {/* ESTIMATIVA de ROI (projeção pelo plano) */}
      <div className="p-4 rounded-2xl ring-1 ring-indigo-200 dark:ring-indigo-900 bg-indigo-50/50 dark:bg-indigo-950/20 space-y-3">
        <div className="flex items-center gap-2 text-indigo-800 dark:text-indigo-300">
          <TrendingUp size={18} />
          <span className="font-black text-sm">Estimativa de ROI (projeção)</span>
        </div>
        {!roi ? (
          <p className="text-xs text-indigo-800/80 dark:text-indigo-300/80">
            Configure o <b>plano mensal</b> (preço do produto, CPA-alvo e orçamento diário) na aba
            Plano pra ver a projeção de ROI aqui.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                ['Gasto de mídia (mês)', `US$ ${roi.mediaSpend.toFixed(0)}`, 'orçamento × 30 dias'],
                ['Custo de criação (mês)', `US$ ${roi.creation.toFixed(2)}`, 'gerar os criativos'],
                ['Receita projetada', `US$ ${roi.revenue.toFixed(0)}`, `${roi.purchases.toFixed(0)} vendas × preço`],
                ['ROAS projetado', `${roi.roas.toFixed(2)}x`, roi.profit >= 0 ? `lucro US$ ${roi.profit.toFixed(0)}` : `perda US$ ${Math.abs(roi.profit).toFixed(0)}`],
              ].map(([label, val, sub]) => (
                <div key={label} className="rounded-xl bg-white/70 dark:bg-gray-900/40 p-2.5">
                  <div className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</div>
                  <div className="text-lg font-black tabular-nums text-gray-900 dark:text-gray-100">{val}</div>
                  <div className="text-[10px] text-gray-400">{sub}</div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-indigo-700/70 dark:text-indigo-400/70">
              Projeção assumindo que você bate o CPA-alvo (US$ {plan!.idealCPA}) — <b>não é dado real</b>.
              O <b>gasto de mídia domina</b> o custo (rodar o anúncio custa muito mais que criá-lo); a
              criação é uma fração. Os números reais aparecem quando o Meta Ads for conectado.
            </p>
          </>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 p-8 justify-center">
          <Loader2 size={18} className="animate-spin" /> Carregando criativos…
        </div>
      ) : rows.length === 0 ? (
        <div className="p-10 text-center text-gray-400 text-sm">
          Nenhum criativo pronto ainda. Gere montagens/edições e eles aparecem aqui pra medição.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-900/60">
              <tr>
                <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-gray-500">
                  Criativo
                </th>
                <th className={head}>Gasto</th>
                <th className={head}>Impr.</th>
                <th className={head}>CTR</th>
                <th className={head}>CPA</th>
                <th className={head}>ROAS</th>
                <th className={head}>Compras</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.creativeId} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-3 py-2">
                    <span className="font-bold text-gray-800 dark:text-gray-100">{r.name}</span>{' '}
                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                      {r.source}
                    </span>
                  </td>
                  <td className={col}>{r.metrics ? `US$ ${r.metrics.spend.toFixed(2)}` : '—'}</td>
                  <td className={col}>{r.metrics?.impressions ?? '—'}</td>
                  <td className={col}>{r.metrics ? `${r.metrics.ctr.toFixed(1)}%` : '—'}</td>
                  <td className={col}>{r.metrics ? `US$ ${r.metrics.cpa.toFixed(2)}` : '—'}</td>
                  <td className={col}>{r.metrics ? `${r.metrics.roas.toFixed(1)}x` : '—'}</td>
                  <td className={col}>{r.metrics?.purchases ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
