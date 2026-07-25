import { Check, ArrowRight, Edit3, Sparkles, User, Film, Zap } from 'lucide-react';
import type { Step } from '@/types/project';
import type { LucideIcon } from 'lucide-react';

// HUB do subprojeto: porta de entrada com o que já tem (✓), previews dos vídeos
// prontos e um botão grande "próximo passo →" pra guiar o fluxo.

interface Props {
  config: any;
  projectName?: string;
  onGo: (s: Step) => void;
}

interface Stage {
  label: string;
  done: boolean;
  step: Step;
  icon: LucideIcon;
  hint: string;
}

export function HubTab({ config, projectName, onGo }: Props) {
  const c = config || {};
  const stages: Stage[] = [
    { label: 'Copy', done: !!(c.copy?.finalScript || c.copy?.generatedScript), step: 'copy', icon: Edit3, hint: 'O roteiro do anúncio.' },
    { label: 'Voz', done: !!(c.audioUrl || c.audios?.length || c.copy?.hookAudios?.length), step: 'voz-premium', icon: Sparkles, hint: 'Narração com voz IA.' },
    { label: 'Vídeo', done: !!(c.videoUrl || c.videos?.length), step: 'avatar', icon: User, hint: 'Avatar ou clipes IA.' },
    { label: 'Montagem', done: !!c.montagem?.resultUrl, step: 'montagem', icon: Film, hint: 'Monta no tempo do áudio.' },
    { label: 'Edição', done: !!(c.edit?.zapVersions?.length || c.edit?.zapVslVersions?.length || c.edit?.zapHookVersions?.length), step: 'edit-zap', icon: Zap, hint: 'Legendas e b-roll.' },
  ];
  const doneCount = stages.filter((s) => s.done).length;
  const next = stages.find((s) => !s.done);
  const finalVideo = c.montagem?.resultUrl || c.edit?.zapVersions?.[c.edit.zapVersions.length - 1] || c.videoUrl;
  const cover = c.montagem?.coverUrl || c.montagem?.coverOptions?.[0];

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div>
        <h2 className="text-xl font-black text-gray-900 dark:text-gray-100">
          {projectName || 'Subprojeto'}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {doneCount}/{stages.length} etapas prontas.{' '}
          {next ? `Falta: ${stages.filter((s) => !s.done).map((s) => s.label).join(', ')}.` : 'Tudo pronto! 🎉'}
        </p>
      </div>

      {/* Próximo passo */}
      {next && (
        <button
          onClick={() => onGo(next.step)}
          className="w-full flex items-center justify-between gap-3 p-4 rounded-2xl bg-blue-700 text-white hover:bg-blue-800 transition-colors"
        >
          <span className="flex items-center gap-3">
            <next.icon size={22} />
            <span className="text-left">
              <span className="block text-[10px] font-black uppercase tracking-widest opacity-80">
                Próximo passo
              </span>
              <span className="block text-base font-black">{next.label} — {next.hint}</span>
            </span>
          </span>
          <ArrowRight size={22} />
        </button>
      )}

      {/* Etapas */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {stages.map((s) => (
          <button
            key={s.label}
            onClick={() => onGo(s.step)}
            className={`p-3 rounded-2xl ring-1 text-left transition-colors ${
              s.done
                ? 'ring-green-200 dark:ring-green-900 bg-green-50/60 dark:bg-green-950/20'
                : 'ring-gray-200 dark:ring-gray-800 bg-white dark:bg-gray-900/50 hover:ring-blue-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <s.icon size={16} className={s.done ? 'text-green-600' : 'text-gray-400'} />
              {s.done ? (
                <Check size={15} className="text-green-600" />
              ) : (
                <span className="w-3 h-3 rounded-full border-2 border-gray-300 dark:border-gray-600 inline-block" />
              )}
            </div>
            <div className="mt-2 text-sm font-black text-gray-800 dark:text-gray-100">{s.label}</div>
            <div className="text-[10px] text-gray-400">{s.done ? 'pronto' : 'pendente'}</div>
          </button>
        ))}
      </div>

      {/* Previews do que já saiu */}
      {(finalVideo || cover) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {finalVideo && (
            <div className="space-y-1">
              <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">
                Vídeo mais recente
              </span>
              <video src={finalVideo} controls poster={cover} className="w-full rounded-xl bg-black max-h-[360px]" />
            </div>
          )}
          {cover && (
            <div className="space-y-1">
              <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">Capa</span>
              <img src={cover} alt="capa" className="w-full rounded-xl bg-black object-contain max-h-[360px]" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
