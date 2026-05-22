// Sun/Moon icon button for the header. Stateless — caller owns the
// theme state via useDarkMode().

import { Sun, Moon } from 'lucide-react';

interface Props {
  isDark: boolean;
  onToggle: () => void;
}

export function DarkModeToggle({ isDark, onToggle }: Props) {
  return (
    <button
      onClick={onToggle}
      className="w-10 h-10 flex items-center justify-center rounded-xl border border-gray-100 bg-gray-50 text-gray-500 hover:text-gray-900 hover:border-gray-200 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300 dark:hover:text-white dark:hover:border-gray-600 transition-all"
      title={isDark ? 'Modo claro' : 'Modo escuro'}
      aria-label={isDark ? 'Mudar para modo claro' : 'Mudar para modo escuro'}
    >
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
