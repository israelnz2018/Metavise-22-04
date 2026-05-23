import type { ComponentType } from 'react';
import { Trash2, AlertCircle } from 'lucide-react';

// Generic "are you sure?" overlay. Two visual tones:
//   - 'danger' (default, red + Trash2): destructive actions
//   - 'warning' (amber + AlertCircle): non-destructive but consequential
//     warnings (e.g. switching awareness level resets recommendations)
// Click outside or Cancel dismisses; Confirm fires onConfirm.
type Tone = 'danger' | 'warning';

interface Props {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: Tone;
  icon?: ComponentType<{ size?: number; className?: string }>;
  onCancel: () => void;
  onConfirm: () => void;
}

const TONE_STYLES: Record<Tone, { iconBg: string; iconColor: string; confirmBg: string }> = {
  danger: {
    iconBg: 'bg-red-100 dark:bg-red-950/40',
    iconColor: 'text-red-600 dark:text-red-400',
    confirmBg: 'bg-red-600 hover:bg-red-700 shadow-lg shadow-red-500/20',
  },
  warning: {
    iconBg: 'bg-amber-100 dark:bg-amber-950/40',
    iconColor: 'text-amber-600 dark:text-amber-400',
    confirmBg: 'bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-500/20',
  },
};

export function ConfirmModal({
  open,
  title,
  message = 'Esta ação não pode ser desfeita.',
  confirmLabel = 'Sim, deletar',
  cancelLabel = 'Cancelar',
  tone = 'danger',
  icon,
  onCancel,
  onConfirm,
}: Props) {
  if (!open) return null;
  const styles = TONE_STYLES[tone];
  const Icon = icon || (tone === 'warning' ? AlertCircle : Trash2);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-md animate-in fade-in duration-150"
      style={{ zIndex: 99999 }}
      onClick={onCancel}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl shadow-black/20 ring-1 ring-gray-200/60 dark:ring-gray-800 space-y-4 animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-full ${styles.iconBg} flex items-center justify-center flex-shrink-0`}
          >
            <Icon size={18} className={styles.iconColor} />
          </div>
          <div>
            <h3 className="text-lg font-black text-gray-900 dark:text-gray-50">{title}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{message}</p>
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 rounded-xl font-bold text-sm bg-gray-100 text-gray-600 hover:bg-gray-200 dark:hover:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 px-4 py-2 rounded-xl font-bold text-sm text-white ${styles.confirmBg} transition-all`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
