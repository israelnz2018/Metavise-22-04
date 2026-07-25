import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { loadVariants } from '@/lib/variantStore';
import { getMetaConnection, type CreativeMetrics } from '@/lib/metaAds';
import { BarChart3, Loader2, Link2Off, ShieldAlert } from 'lucide-react';

// PERFORMANCE (Meta Ads) — fecha o loop "gerou → rodou → o que vendeu".
// A estrutura está PRONTA, mas a conexão está DESLIGADA de propósito (contas do
// Meta caindo quando linkadas ao Claude). A tabela mostra os criativos com as
// colunas de métrica em "—" até liberarmos a conexão.

interface Props {
  projectId?: string | null;
  projectName?: string;
}

interface Row {
  creativeId: string;
  name: string;
  source: string;
  metrics?: CreativeMetrics;
}

export function PerformanceTab({ projectId, projectName }: Props) {
  const conn = getMetaConnection();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);

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
        for (const v of variants) {
          const cfg = (v.config || {}) as any;
          const name = v.name || 'Sem nome';
          const edit = cfg?.edit || {};
          (edit.zapVersions || []).forEach((u: string) => push(u, name, 'Edição'));
          (edit.zapVslVersions || []).forEach((u: string) => push(u, name, 'Edição VSL'));
          (edit.zapHookVersions || []).forEach((u: string) => push(u, name, 'Gancho'));
          if (cfg?.montagem?.resultUrl) push(cfg.montagem.resultUrl, name, 'Montagem');
          if (cfg?.videoUrl) push(cfg.videoUrl, name, 'Avatar');
        }
        // Quando a conexão for liberada: fetchMetaMetrics(out.map(r=>r.creativeId))
        // e casar por creativeId. Por ora fica sem métrica (desconectado).
        setRows(out);
      } catch (e: any) {
        toast.error(e?.message || 'Falha ao carregar os criativos.');
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId]);

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
