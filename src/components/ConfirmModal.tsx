import { Trash2 } from 'lucide-react';

// Generic "are you sure?" overlay. Used by all the destructive actions
// (delete audio, delete saved audio, delete video, delete project, etc.).
// Click outside or Cancel dismisses; Confirm fires onConfirm.
interface Props {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmModal({
  open,
  title,
  message = 'Esta ação não pode ser desfeita.',
  confirmLabel = 'Sim, deletar',
  cancelLabel = 'Cancelar',
  onCancel,
  onConfirm,
}: Props) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      style={{ zIndex: 99999 }}
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
            <Trash2 size={18} className="text-red-600" />
          </div>
          <div>
            <h3 className="text-lg font-black text-gray-900">{title}</h3>
            <p className="text-sm text-gray-500 mt-0.5">{message}</p>
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 rounded-xl font-bold text-sm bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-2 rounded-xl font-bold text-sm bg-red-600 text-white hover:bg-red-700 transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
