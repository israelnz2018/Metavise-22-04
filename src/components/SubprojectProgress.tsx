import { Check } from 'lucide-react';
import type { Step } from '@/types/project';

// BARRA DE PROGRESSO do subprojeto: mostra o que já tem (copy ✓, voz ✓, …) e o
// que falta, pra nunca ficar perdido. Cada etapa é clicável e leva pra aba.

interface Props {
  config: any;
  onGo: (step: Step) => void;
}

export function SubprojectProgress({ config, onGo }: Props) {
  const c = config || {};
  const stages: { label: string; done: boolean; step: Step }[] = [
    {
      label: 'Copy',
      done: !!(c.copy?.finalScript || c.copy?.generatedScript),
      step: 'copy',
    },
    {
      label: 'Voz',
      done: !!(c.audioUrl || (c.audios?.length ?? 0) > 0 || (c.copy?.hookAudios?.length ?? 0) > 0),
      step: 'voz-premium',
    },
    {
      label: 'Vídeo',
      done: !!(c.videoUrl || (c.videos?.length ?? 0) > 0),
      step: 'avatar',
    },
    {
      label: 'Montagem',
      done: !!c.montagem?.resultUrl,
      step: 'montagem',
    },
    {
      label: 'Edição',
      done: !!(
        c.edit?.zapVersions?.length ||
        c.edit?.zapVslVersions?.length ||
        c.edit?.zapHookVersions?.length
      ),
      step: 'edit-zap',
    },
  ];
  const doneCount = stages.filter((s) => s.done).length;

  return (
    <div className="hidden md:flex items-center gap-1.5">
      <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 mr-1">
        {doneCount}/{stages.length}
      </span>
      {stages.map((s) => (
        <button
          key={s.label}
          onClick={() => onGo(s.step)}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold transition-colors ${
            s.done
              ? 'bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300'
              : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
          }`}
          title={s.done ? `${s.label} pronto — clique pra rever` : `${s.label} pendente — clique pra fazer`}
        >
          {s.done ? (
            <Check size={11} />
          ) : (
            <span className="w-2.5 h-2.5 rounded-full border-2 border-current inline-block" />
          )}
          {s.label}
        </button>
      ))}
    </div>
  );
}
