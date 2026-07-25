import { useState } from 'react';
import { Wallet, ChevronDown, Plus, Sparkles } from 'lucide-react';
import type { CostEntry } from '@/lib/creativeCost';

// WALLET do header: junta Saldo API + Créditos + Custo do criativo + Custo do mês
// num único dropdown, pra não lotar a barra e roubar espaço das abas.

interface Props {
  credits: number | null;
  onAddCredits: () => void;
  apiSpend: { balanceBase?: number | null; availableUSD?: number | null; costUSD: number } | null;
  onSetApiBalance: () => void;
  creativeCosts: CostEntry[];
  monthlyTotal: number;
  monthlyBreakdown: [string, number][];
}

export function HeaderWallet({
  credits,
  onAddCredits,
  apiSpend,
  onSetApiBalance,
  creativeCosts,
  monthlyTotal,
  monthlyBreakdown,
}: Props) {
  const [open, setOpen] = useState(false);

  const hasBalance = !!apiSpend && apiSpend.balanceBase != null && apiSpend.availableUSD != null;
  const avail = apiSpend?.availableUSD ?? 0;
  const tone = !hasBalance ? 'gray' : avail <= 1 ? 'red' : avail <= 5 ? 'amber' : 'emerald';
  const toneText: Record<string, string> = {
    emerald: 'text-emerald-600 dark:text-emerald-400',
    amber: 'text-amber-600 dark:text-amber-400',
    red: 'text-red-600 dark:text-red-400',
    gray: 'text-gray-500 dark:text-gray-400',
  };

  // Custo do criativo atual: total + quebra por rótulo.
  const creativeTotal = creativeCosts.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const byLabel = new Map<string, number>();
  for (const c of creativeCosts) byLabel.set(c.label, (byLabel.get(c.label) || 0) + (Number(c.amount) || 0));
  const creativeBreakdown = Array.from(byLabel.entries());

  const row = 'flex items-center justify-between gap-4 py-2';
  const label = 'text-[11px] font-black uppercase tracking-widest text-gray-500';
  const val = 'text-sm font-black tabular-nums text-gray-900 dark:text-gray-100';
  const act =
    'text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-blue-400';

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 dark:bg-gray-800/60 rounded-xl ring-1 ring-gray-200/70 dark:ring-gray-700/60 hover:ring-blue-300 transition-all"
        title="Custos e saldos"
      >
        <Wallet size={15} className={toneText[tone]} />
        <span className={`text-sm font-black tabular-nums ${toneText[tone]}`}>
          {hasBalance ? `US$ ${avail.toFixed(2)}` : 'Custos'}
        </span>
        <ChevronDown size={13} className="text-gray-400" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[55]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 z-[60] bg-white dark:bg-gray-900 rounded-2xl border-2 border-gray-200 dark:border-gray-800 shadow-2xl p-4 divide-y divide-gray-100 dark:divide-gray-800">
            {/* Saldo API (Anthropic) */}
            <div className={row}>
              <div>
                <div className={label}>Saldo API (Anthropic)</div>
                <div className={val}>{hasBalance ? `US$ ${avail.toFixed(2)}` : '—'}</div>
              </div>
              <button className={act} onClick={onSetApiBalance}>
                {hasBalance ? 'Atualizar' : 'Definir'}
              </button>
            </div>

            {/* Créditos do app */}
            <div className={row}>
              <div>
                <div className={label}>Créditos do app</div>
                <div className={`${val} inline-flex items-center gap-1`}>
                  <Sparkles size={13} className="text-blue-500" /> {credits ?? '—'}
                </div>
              </div>
              <button className={act} onClick={onAddCredits}>
                <Plus size={11} className="inline -mt-0.5" /> Adicionar
              </button>
            </div>

            {/* Custo do criativo atual */}
            <div className="py-2">
              <div className="flex items-center justify-between">
                <span className={label}>Custo deste criativo</span>
                <span className={`${val} text-fuchsia-600 dark:text-fuchsia-400`}>
                  US$ {creativeTotal.toFixed(2)}
                </span>
              </div>
              {creativeBreakdown.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {creativeBreakdown.map(([l, sum]) => (
                    <li key={l} className="flex items-center justify-between text-[11px] text-gray-500">
                      <span className="truncate pr-2">{l}</span>
                      <span className="tabular-nums">US$ {sum.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Custo do mês — todos os projetos */}
            <div className="py-2">
              <div className="flex items-center justify-between">
                <span className={label}>Custo do mês (todos os projetos)</span>
                <span className={`${val} text-indigo-600 dark:text-indigo-400`}>
                  US$ {monthlyTotal.toFixed(2)}
                </span>
              </div>
              {monthlyBreakdown.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {monthlyBreakdown.map(([l, sum]) => (
                    <li key={l} className="flex items-center justify-between text-[11px] text-gray-500">
                      <span className="truncate pr-2">{l}</span>
                      <span className="tabular-nums">US$ {sum.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <p className="pt-2 text-[10px] text-gray-400">
              Custos de criação são ESTIMATIVAS (fal + ElevenLabs + HeyGen + ZapCap). O gasto real de
              rodar os anúncios é à parte e costuma ser bem maior.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
