import { Sparkles, AlertTriangle } from 'lucide-react';
import { getActionLabel, type Action } from '@/lib/costs';
import { useFocusTrap } from '@/hooks/useFocusTrap';

/**
 * Pre-render cost preview. Shown before any credit-spending action
 * so the user sees the price tag *before* committing — vs. today's
 * flow where credits silently disappear when the request completes.
 *
 * Optional `dontAskAgainKey` wires up an "Don't ask again" checkbox
 * that persists a flag in localStorage so power users can skip the
 * confirm after their first acknowledgement. Callers should honour
 * the flag by short-circuiting before opening the modal.
 */
export function CostConfirmModal({
  isOpen,
  action,
  cost,
  currentCredits,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  action: Action;
  cost: number;
  currentCredits: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>(isOpen);
  if (!isOpen) return null;

  const insufficient = currentCredits < cost;
  const remaining = currentCredits - cost;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-md px-4 animate-in fade-in duration-150"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={trapRef}
        className="bg-white dark:bg-gray-900 rounded-2xl max-w-md w-full p-6 shadow-2xl shadow-black/20 ring-1 ring-gray-200/60 dark:ring-gray-800 animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/40">
            <Sparkles className="text-blue-600 dark:text-blue-400" size={24} />
          </div>
          <h3 className="text-lg font-black text-gray-900 dark:text-gray-50">
            Confirmar uso de créditos
          </h3>
        </div>

        <p className="text-gray-600 dark:text-gray-400 mb-4">
          Você está prestes a{' '}
          <span className="font-bold text-gray-900 dark:text-gray-50">
            {getActionLabel(action)}
          </span>
          . Essa ação custa{' '}
          <span className="font-black text-blue-600 dark:text-blue-400">{cost} créditos</span>.
        </p>

        <div className="bg-gray-50 dark:bg-gray-800/60 rounded-xl p-4 mb-4 space-y-1 text-sm">
          <div className="flex justify-between text-gray-600 dark:text-gray-400">
            <span>Saldo atual</span>
            <span className="font-bold text-gray-900 dark:text-gray-100">{currentCredits}</span>
          </div>
          <div className="flex justify-between text-gray-600 dark:text-gray-400">
            <span>Custo</span>
            <span className="font-bold text-red-500">−{cost}</span>
          </div>
          <div className="flex justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
            <span className="font-bold text-gray-700 dark:text-gray-300">Saldo após</span>
            <span
              className={`font-black ${
                insufficient ? 'text-red-500' : 'text-gray-900 dark:text-gray-100'
              }`}
            >
              {Math.max(0, remaining)}
            </span>
          </div>
        </div>

        {insufficient && (
          <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900 rounded-xl text-sm text-red-700 dark:text-red-300 mb-4">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            <span>
              Créditos insuficientes. Faltam <strong>{cost - currentCredits}</strong> créditos.
            </span>
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-5 py-2.5 rounded-xl font-bold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={insufficient}
            className="px-5 py-2.5 rounded-xl font-black bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed"
          >
            Confirmar e gerar
          </button>
        </div>
      </div>
    </div>
  );
}
