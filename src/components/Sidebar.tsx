import { STEPS } from '@/lib/constants';
import type { Step } from '@/types/project';

// BARRA LATERAL (desktop): substitui a nav horizontal lotada por uma lista
// vertical agrupada por fase — escala melhor pros ~15 passos e deixa claro
// onde você está no fluxo. No mobile continua a nav horizontal do header.

interface Props {
  currentStep: Step;
  onNavigate: (s: Step) => void;
  canNavigateTo: (s: Step) => boolean;
  useHookFlow: boolean;
}

const PHASES: { title: string; ids: Step[] }[] = [
  { title: 'Início', ids: ['integrations', 'projects'] },
  { title: 'Planejamento & Copy', ids: ['persona', 'copy', 'copy-vsl', 'hook-visual'] },
  { title: 'Produção', ids: ['voz-premium', 'avatar', 'imagem-ia', 'video-ia', 'remotion'] },
  { title: 'Montagem & Edição', ids: ['montagem', 'edit-zap', 'merge'] },
  { title: 'Publicação', ids: ['final'] },
];

const byId = new Map(STEPS.map((s) => [s.id, s]));

export function Sidebar({ currentStep, onNavigate, canNavigateTo, useHookFlow }: Props) {
  return (
    <aside className="hidden md:flex flex-col w-56 shrink-0 sticky top-20 self-start max-h-[calc(100vh-5rem)] overflow-y-auto scrollbar-hide border-r border-gray-200/60 dark:border-gray-800/60 py-4 pr-2">
      {PHASES.map((phase) => (
        <div key={phase.title} className="mb-4">
          <div className="px-3 mb-1 text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">
            {phase.title}
          </div>
          <div className="space-y-0.5">
            {phase.ids.map((id) => {
              const step = byId.get(id);
              if (!step) return null;
              const Icon = step.icon;
              const isActive = currentStep === id;
              const isSkipped = !useHookFlow && id === 'hook-visual';
              const disabled = !canNavigateTo(id);
              return (
                <button
                  key={id}
                  onClick={() => !disabled && onNavigate(id)}
                  disabled={disabled}
                  onMouseEnter={() => {
                    if (id === 'source') void import('@/pages/SourceTab');
                    else if (id === 'plan') void import('@/pages/PlanTab');
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-bold transition-colors text-left ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-sm'
                      : isSkipped
                        ? 'text-gray-400/70 dark:text-gray-600 line-through hover:text-gray-500'
                        : disabled
                          ? 'text-gray-300 dark:text-gray-700 cursor-not-allowed'
                          : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800/60'
                  }`}
                  title={isSkipped ? 'Gancho pulado — clique pra reativar' : step.label}
                >
                  <Icon size={16} className="shrink-0" />
                  <span className="truncate">
                    {step.label}
                    {isSkipped && (
                      <span className="ml-1 text-[9px] font-black uppercase tracking-widest opacity-70 no-underline">
                        · pulado
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </aside>
  );
}
