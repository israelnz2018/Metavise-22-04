import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { toast } from 'react-hot-toast';

// Painel de JOBS global: rastreia as gerações longas (Kling, lip-sync, montagem,
// música) num só lugar, pra o usuário trabalhar em paralelo e ser AVISADO quando
// terminar (toast + notificação do navegador), mesmo em outra aba.

export interface Job {
  id: string;
  label: string;
  status: 'running' | 'done' | 'error';
  at: number;
}

interface JobsCtx {
  jobs: Job[];
  addJob: (label: string) => string;
  updateJob: (id: string, patch: Partial<Job>) => void;
  clearDone: () => void;
}

const Ctx = createContext<JobsCtx | null>(null);

let seq = 0;

export function JobsProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const jobsRef = useRef<Job[]>([]);
  jobsRef.current = jobs;

  const addJob = useCallback((label: string) => {
    const id = `job_${Date.now()}_${seq++}`;
    setJobs((prev) => [{ id, label, status: 'running' as const, at: Date.now() }, ...prev].slice(0, 25));
    // Pede permissão de notificação na 1ª geração (pra avisar em background).
    try {
      if ('Notification' in window && Notification.permission === 'default') {
        void Notification.requestPermission();
      }
    } catch {
      /* ignora */
    }
    return id;
  }, []);

  const updateJob = useCallback((id: string, patch: Partial<Job>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
    if (patch.status === 'done' || patch.status === 'error') {
      const j = jobsRef.current.find((x) => x.id === id);
      const label = j?.label || 'Geração';
      const ok = patch.status === 'done';
      toast[ok ? 'success' : 'error'](`${ok ? '✅' : '⚠️'} ${label} — ${ok ? 'pronto' : 'falhou'}`, {
        id: `jobdone-${id}`,
      });
      if (ok) {
        try {
          if ('Notification' in window && Notification.permission === 'granted') {
            // eslint-disable-next-line no-new
            new Notification('Metavise ✅', { body: `${label} — pronto` });
          }
        } catch {
          /* ignora */
        }
      }
    }
  }, []);

  const clearDone = useCallback(() => {
    setJobs((prev) => prev.filter((j) => j.status === 'running'));
  }, []);

  return <Ctx.Provider value={{ jobs, addJob, updateJob, clearDone }}>{children}</Ctx.Provider>;
}

// Hook seguro: se não houver provider, vira no-op (não quebra componentes soltos).
export function useJobs(): JobsCtx {
  const ctx = useContext(Ctx);
  if (ctx) return ctx;
  return {
    jobs: [],
    addJob: () => '',
    updateJob: () => {},
    clearDone: () => {},
  };
}
