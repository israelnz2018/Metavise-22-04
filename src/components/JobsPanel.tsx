import { useState } from 'react';
import { useJobs } from '@/lib/jobsStore';
import { Loader2, Check, X, ListChecks } from 'lucide-react';

// Pílula flutuante (canto inferior esquerdo) que mostra as gerações rodando +
// prontas. Deixa o usuário sair da aba e ser avisado quando terminar.
export function JobsPanel() {
  const { jobs, clearDone } = useJobs();
  const [open, setOpen] = useState(false);
  if (jobs.length === 0) return null;
  const running = jobs.filter((j) => j.status === 'running').length;

  return (
    <div className="fixed bottom-4 left-4 z-[130]">
      {open && (
        <div className="mb-2 w-72 max-h-80 overflow-y-auto bg-white dark:bg-gray-900 rounded-2xl border-2 border-gray-200 dark:border-gray-800 shadow-2xl p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">
              Gerações
            </span>
            <button
              onClick={clearDone}
              className="text-[10px] text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              limpar prontas
            </button>
          </div>
          {jobs.map((j) => (
            <div key={j.id} className="flex items-center gap-2 text-xs">
              {j.status === 'running' ? (
                <Loader2 size={13} className="animate-spin text-purple-500 shrink-0" />
              ) : j.status === 'done' ? (
                <Check size={13} className="text-green-500 shrink-0" />
              ) : (
                <X size={13} className="text-red-500 shrink-0" />
              )}
              <span className="truncate text-gray-700 dark:text-gray-200">{j.label}</span>
            </div>
          ))}
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-2 rounded-full bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 shadow-xl text-xs font-black"
        title="Gerações em andamento"
      >
        {running > 0 ? <Loader2 size={14} className="animate-spin" /> : <ListChecks size={14} />}
        {running > 0 ? `${running} gerando…` : `Gerações (${jobs.length})`}
      </button>
    </div>
  );
}
