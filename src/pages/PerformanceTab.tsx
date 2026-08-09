import { useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { loadVariants } from '@/lib/variantStore';
import { getMetaConnection, type CreativeMetrics } from '@/lib/metaAds';
import { parseMetaCsvReport, matchMetricsToName } from '@/lib/metaCsvImport';
import { addToPersonalLibrary } from '@/lib/personalCopyLibrary';
import { unlockAchievement } from '@/lib/achievements';
import { inferVertical, type CopyVertical, type AwarenessLevel } from '@/data/copyLibrary';
import {
  BarChart3,
  Link2Off,
  ShieldAlert,
  TrendingUp,
  Upload,
  Flame,
  Clock,
  Trophy,
  Check,
  Loader2,
} from 'lucide-react';
import { Skeleton } from '@/components/Skeleton';
import type { MonthlyPlanConfig } from '@/types/project';

// Vencedor = ROAS real >= esse limiar (padrão de mercado pra "lucrativo").
const WINNER_ROAS_THRESHOLD = 2;

// PERFORMANCE (Meta Ads) — fecha o loop "gerou → rodou → o que vendeu".
// A estrutura está PRONTA, mas a conexão está DESLIGADA de propósito (contas do
// Meta caindo quando linkadas ao Claude). A tabela mostra os criativos com as
// colunas de métrica em "—" até liberarmos a conexão. Enquanto isso, uma
// ESTIMATIVA de ROI (projeção) cruza o CPA-alvo do plano com o gasto de mídia.

interface Props {
  projectId?: string | null;
  projectName?: string;
  plan?: MonthlyPlanConfig | null;
  uid?: string;
}

interface Row {
  creativeId: string;
  name: string;
  source: string;
  metrics?: CreativeMetrics;
  /** Necessário pra salvar na Biblioteca de vencedores quando o criativo performa bem. */
  libraryInput: {
    vertical?: CopyVertical;
    awareness?: AwarenessLevel;
    angle: string;
    language: 'pt' | 'en';
    script: string;
  };
}

interface ImportSnapshot {
  importedAt: string;
  metrics: CreativeMetrics[];
}

const IMPORT_KEY = (projectId: string) => `metavise-perf-import-${projectId}`;
const MAX_SNAPSHOTS = 10;

function loadImportHistory(projectId: string): ImportSnapshot[] {
  try {
    return JSON.parse(localStorage.getItem(IMPORT_KEY(projectId)) || '[]');
  } catch {
    return [];
  }
}
function saveImportHistory(projectId: string, history: ImportSnapshot[]) {
  try {
    localStorage.setItem(IMPORT_KEY(projectId), JSON.stringify(history.slice(-MAX_SNAPSHOTS)));
  } catch {
    /* ignora */
  }
}

export function PerformanceTab({ projectId, projectName, plan, uid }: Props) {
  const conn = getMetaConnection();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [creationCostMonth, setCreationCostMonth] = useState(0);
  // Biblioteca de vencedores — criativos salvos nesta sessão (evita duplicar
  // ao clicar 2x; a lib em si vive no Firestore, users/{uid}/copyLibrary).
  const [savedToLibrary, setSavedToLibrary] = useState<Set<string>>(new Set());
  const [savingToLibrary, setSavingToLibrary] = useState<string | null>(null);
  // Métricas REAIS via importação de relatório CSV do Meta Ads Manager — não
  // conecta a conta (isso está desligado de propósito), só lê o arquivo que o
  // usuário já exportou. Guarda um histórico (localStorage) pra comparar
  // importações e detectar fadiga (frequência subindo, CTR caindo).
  const [importHistory, setImportHistory] = useState<ImportSnapshot[]>([]);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!projectId) return;
    setImportHistory(loadImportHistory(projectId));
  }, [projectId]);

  const handleCsvFile = async (file: File) => {
    if (!projectId) return;
    setImporting(true);
    try {
      const text = await file.text();
      const { metrics, unmatchedFields } = parseMetaCsvReport(text);
      if (metrics.length === 0) {
        toast.error(
          'Nenhuma linha reconhecida no CSV. Confira se é o relatório exportado do Ads Manager.'
        );
        return;
      }
      const snapshot: ImportSnapshot = { importedAt: new Date().toISOString(), metrics };
      const nextHistory = [...importHistory, snapshot].slice(-MAX_SNAPSHOTS);
      setImportHistory(nextHistory);
      saveImportHistory(projectId, nextHistory);
      if (metrics.some((m) => m.purchases > 0)) {
        void unlockAchievement(uid, 'primeira_venda');
      }
      const matchedCount = rows.filter((r) => matchMetricsToName(r.name, metrics)).length;
      toast.success(
        `Relatório importado — ${matchedCount}/${rows.length} criativo(s) casados por nome.` +
          (unmatchedFields.length > 0
            ? ` Colunas não encontradas: ${unmatchedFields.join(', ')}.`
            : '')
      );
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao ler o CSV.');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Snapshot mais recente e o anterior (pra comparar e detectar fadiga).
  const latestSnapshot = importHistory[importHistory.length - 1];
  const previousSnapshot = importHistory[importHistory.length - 2];

  // Junta cada Row com a métrica REAL importada (por nome) + sinal de fadiga
  // comparando com a importação anterior. Não bloqueia nada — só avisa.
  const rowsWithMetrics = rows.map((r) => {
    const metrics = latestSnapshot ? matchMetricsToName(r.name, latestSnapshot.metrics) : undefined;
    let fatigue: { highFrequency: boolean; decliningCtr: boolean; ctrDropPct: number } | null =
      null;
    if (metrics) {
      const highFrequency = (metrics.frequency ?? 0) > 3;
      let decliningCtr = false;
      let ctrDropPct = 0;
      if (previousSnapshot) {
        const prev = matchMetricsToName(r.name, previousSnapshot.metrics);
        if (prev && prev.ctr > 0 && metrics.ctr < prev.ctr) {
          ctrDropPct = ((prev.ctr - metrics.ctr) / prev.ctr) * 100;
          decliningCtr = ctrDropPct >= 25;
        }
      }
      if (highFrequency || decliningCtr) fatigue = { highFrequency, decliningCtr, ctrDropPct };
    }
    const isWinner = !!metrics && metrics.roas >= WINNER_ROAS_THRESHOLD;
    return { ...r, metrics: metrics || undefined, fatigue, isWinner };
  });
  const fatigueCount = rowsWithMetrics.filter((r) => r.fatigue).length;

  // Biblioteca de vencedores — salva o script/ângulo do criativo na biblioteca
  // pessoal (users/{uid}/copyLibrary), a MESMA que já alimenta a geração de
  // copy como referência (poucos-shot). Assim, o que converteu bem entra
  // automaticamente como exemplo pra próximas copies do mesmo nicho.
  const handleSaveWinner = async (row: (typeof rowsWithMetrics)[number]) => {
    if (!uid) {
      toast.error('Faça login pra salvar na biblioteca.');
      return;
    }
    if (!row.libraryInput.script) {
      toast.error('Este subprojeto não tem copy aprovada pra salvar.');
      return;
    }
    setSavingToLibrary(row.creativeId);
    try {
      await addToPersonalLibrary(uid, {
        vertical: row.libraryInput.vertical || 'fisico',
        awareness: row.libraryInput.awareness || '3',
        angle: row.libraryInput.angle || row.name,
        language: row.libraryInput.language,
        script: row.libraryInput.script,
        whyItWorks: `Vencedor real: ROAS ${row.metrics!.roas.toFixed(1)}x · CTR ${row.metrics!.ctr.toFixed(1)}% · CPA US$ ${row.metrics!.cpa.toFixed(2)} — importado ${new Date().toLocaleDateString('pt-BR')}`,
        starred: true,
        source: 'auto-from-generated',
      });
      setSavedToLibrary((prev) => new Set(prev).add(row.creativeId));
      toast.success('Salvo na biblioteca — vira referência nas próximas copies desse nicho.');
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao salvar na biblioteca.');
    } finally {
      setSavingToLibrary(null);
    }
  };

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    (async () => {
      try {
        const variants = await loadVariants(projectId);
        const out: Row[] = [];
        const seen = new Set<string>();
        const push = (
          url: string,
          name: string,
          source: string,
          libraryInput: Row['libraryInput']
        ) => {
          if (!url || seen.has(url)) return;
          seen.add(url);
          out.push({ creativeId: url, name, source, libraryInput });
        };
        const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
        let cost = 0;
        for (const v of variants) {
          const cfg = (v.config || {}) as any;
          const name = v.name || 'Sem nome';
          const copyAny = cfg?.copy || {};
          const activeBrief = Array.isArray(copyAny?.creativeBriefs)
            ? copyAny.creativeBriefs.find((b: any) => b.id === copyAny.activeBriefId)
            : undefined;
          const libraryInput: Row['libraryInput'] = {
            vertical: copyAny?.vertical || inferVertical(copyAny?.productInfo) || undefined,
            awareness: copyAny?.answers?.awarenessLevel
              ? (String(copyAny.answers.awarenessLevel) as AwarenessLevel)
              : undefined,
            angle: String(activeBrief?.angle || copyAny?.hookSelecionado || '').slice(0, 120),
            language: /en(g|lish)?\b/i.test(String(copyAny?.answers?.language || '')) ? 'en' : 'pt',
            script:
              copyAny?.finalScript || copyAny?.optimizedScript || copyAny?.generatedScript || '',
          };
          const edit = cfg?.edit || {};
          (edit.zapVersions || []).forEach((u: string) => push(u, name, 'Edição', libraryInput));
          (edit.zapVslVersions || []).forEach((u: string) =>
            push(u, name, 'Edição VSL', libraryInput)
          );
          (edit.zapHookVersions || []).forEach((u: string) =>
            push(u, name, 'Gancho', libraryInput)
          );
          if (cfg?.montagem?.resultUrl)
            push(cfg.montagem.resultUrl, name, 'Montagem', libraryInput);
          if (cfg?.videoUrl) push(cfg.videoUrl, name, 'Avatar', libraryInput);
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
  const head =
    'px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-gray-500';

  return (
    <div className="max-w-6xl mx-auto space-y-4 p-2">
      <div className="flex items-center gap-2">
        <BarChart3 size={20} className="text-blue-700 dark:text-blue-400" />
        <h2 className="text-lg font-black text-gray-900 dark:text-gray-100">
          Performance {projectName ? `· ${projectName}` : ''}
        </h2>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 -mt-2">
        Fecha o ciclo <b>gerou → rodou → o que vendeu</b>: importe o relatório CSV do Ads Manager e
        cada criativo mostra gasto, CTR, CPA, ROAS e compras reais — pra você escalar o que
        performa.
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
        <div className="flex items-center gap-2 flex-wrap">
          <button
            disabled
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-200 dark:bg-gray-800 text-gray-400 text-xs font-black cursor-not-allowed"
            title="Desativado por ora — contas do Meta caindo ao linkar com o Claude"
          >
            <Link2Off size={14} /> Conectar Meta Ads (desativado)
          </button>
          <span className="text-[10px] font-black uppercase tracking-widest text-amber-700/60 dark:text-amber-400/60">
            ou
          </span>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-600 text-white text-xs font-black hover:bg-amber-700 disabled:opacity-60"
            title="Exporte o relatório CSV no Ads Manager (Relatórios → Exportar) e importe aqui — sem conectar a conta"
          >
            <Upload size={14} /> {importing ? 'Importando…' : 'Importar relatório CSV do Meta Ads'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleCsvFile(f);
            }}
          />
          {latestSnapshot && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 dark:text-amber-400">
              <Clock size={11} /> Última importação:{' '}
              {new Date(latestSnapshot.importedAt).toLocaleString('pt-BR')}
            </span>
          )}
        </div>
      </div>

      {/* Fadiga de criativo — só aparece com dado real importado. Compara a
          importação mais recente com a anterior (frequência alta ou CTR
          caindo ≥25%). Não bloqueia nada, só avisa. */}
      {fatigueCount > 0 && (
        <div className="p-4 rounded-2xl ring-1 ring-red-200 dark:ring-red-900 bg-red-50/60 dark:bg-red-950/20 space-y-1">
          <div className="flex items-center gap-2 text-red-800 dark:text-red-300">
            <Flame size={18} />
            <span className="font-black text-sm">
              {fatigueCount} criativo{fatigueCount === 1 ? '' : 's'} com sinal de fadiga
            </span>
          </div>
          <p className="text-xs text-red-800/80 dark:text-red-300/80">
            Frequência alta (público já viu demais) ou CTR caindo ≥25% desde a última importação —
            considere gerar uma variação nova (aba Criativos → variações A/B).
          </p>
        </div>
      )}

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
                [
                  'Receita projetada',
                  `US$ ${roi.revenue.toFixed(0)}`,
                  `${roi.purchases.toFixed(0)} vendas × preço`,
                ],
                [
                  'ROAS projetado',
                  `${roi.roas.toFixed(2)}x`,
                  roi.profit >= 0
                    ? `lucro US$ ${roi.profit.toFixed(0)}`
                    : `perda US$ ${Math.abs(roi.profit).toFixed(0)}`,
                ],
              ].map(([label, val, sub]) => (
                <div key={label} className="rounded-xl bg-white/70 dark:bg-gray-900/40 p-2.5">
                  <div className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                    {label}
                  </div>
                  <div className="text-lg font-black tabular-nums text-gray-900 dark:text-gray-100">
                    {val}
                  </div>
                  <div className="text-[10px] text-gray-400">{sub}</div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-indigo-700/70 dark:text-indigo-400/70">
              Projeção assumindo que você bate o CPA-alvo (US$ {plan!.idealCPA}) —{' '}
              <b>não é dado real</b>. O <b>gasto de mídia domina</b> o custo (rodar o anúncio custa
              muito mais que criá-lo); a criação é uma fração. Os números reais aparecem quando o
              Meta Ads for conectado.
            </p>
          </>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-xl" />
          ))}
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
                <th className={head}>Freq.</th>
                <th className={head}>CTR</th>
                <th className={head}>CPA</th>
                <th className={head}>ROAS</th>
                <th className={head}>Compras</th>
                <th className={head}>Vencedor</th>
              </tr>
            </thead>
            <tbody>
              {rowsWithMetrics.map((r) => (
                <tr key={r.creativeId} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-3 py-2">
                    <span className="font-bold text-gray-800 dark:text-gray-100">{r.name}</span>{' '}
                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                      {r.source}
                    </span>
                    {r.fatigue && (
                      <span
                        className="inline-flex items-center gap-0.5 ml-1.5 px-1.5 py-0.5 rounded-md bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-[9px] font-black uppercase"
                        title={[
                          r.fatigue.highFrequency ? 'Frequência > 3' : null,
                          r.fatigue.decliningCtr
                            ? `CTR caiu ${r.fatigue.ctrDropPct.toFixed(0)}%`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      >
                        <Flame size={9} /> fadiga
                      </span>
                    )}
                    {r.isWinner && (
                      <span
                        className="inline-flex items-center gap-0.5 ml-1.5 px-1.5 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-[9px] font-black uppercase"
                        title={`ROAS ≥ ${WINNER_ROAS_THRESHOLD}x`}
                      >
                        <Trophy size={9} /> vencedor
                      </span>
                    )}
                  </td>
                  <td className={col}>{r.metrics ? `US$ ${r.metrics.spend.toFixed(2)}` : '—'}</td>
                  <td className={col}>{r.metrics?.impressions ?? '—'}</td>
                  <td className={col}>
                    {r.metrics?.frequency ? r.metrics.frequency.toFixed(1) : '—'}
                  </td>
                  <td className={col}>{r.metrics ? `${r.metrics.ctr.toFixed(1)}%` : '—'}</td>
                  <td className={col}>{r.metrics ? `US$ ${r.metrics.cpa.toFixed(2)}` : '—'}</td>
                  <td className={col}>{r.metrics ? `${r.metrics.roas.toFixed(1)}x` : '—'}</td>
                  <td className={col}>{r.metrics?.purchases ?? '—'}</td>
                  <td className={col}>
                    {savedToLibrary.has(r.creativeId) ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-black">
                        <Check size={12} /> salvo
                      </span>
                    ) : (
                      <button
                        onClick={() => handleSaveWinner(r)}
                        disabled={savingToLibrary === r.creativeId}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-black disabled:opacity-60 ${
                          r.isWinner
                            ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                        title={
                          r.isWinner
                            ? 'Recomendado — ROAS alto. Salva o script/ângulo na biblioteca.'
                            : 'Salva o script/ângulo na biblioteca — vira referência em copies futuras'
                        }
                      >
                        {savingToLibrary === r.creativeId ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : (
                          <Trophy size={11} />
                        )}
                        salvar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
