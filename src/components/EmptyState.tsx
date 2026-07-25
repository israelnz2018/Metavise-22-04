import type { LucideIcon } from 'lucide-react';

// Estado vazio ÚTIL: em vez de tela em branco, explica o que fazer agora e (se
// der) um botão pra a ação. Reusável em qualquer aba.

interface Props {
  icon: LucideIcon;
  title: string;
  hint: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon: Icon, title, hint, actionLabel, onAction }: Props) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      <div className="w-14 h-14 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
        <Icon size={26} className="text-gray-400" />
      </div>
      <h3 className="text-sm font-black text-gray-800 dark:text-gray-100">{title}</h3>
      <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm mt-1">{hint}</p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="mt-4 px-4 py-2 rounded-xl bg-blue-700 text-white text-xs font-black uppercase tracking-widest hover:bg-blue-800"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
