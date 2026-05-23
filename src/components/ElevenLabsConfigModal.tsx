import { motion } from 'motion/react';
import { Settings, X, Loader2, Zap, Save } from 'lucide-react';

// "Update ElevenLabs API key" modal — opened from the Voz tab when
// the saved key is missing/invalid. Holds no state of its own; the
// parent owns the input value, isTesting/isUpdating flags, and the
// network handlers.
interface Props {
  open: boolean;
  apiKey: string;
  isTesting: boolean;
  isUpdating: boolean;
  onApiKeyChange: (next: string) => void;
  onTest: () => void;
  onSave: () => void;
  onClose: () => void;
}

export function ElevenLabsConfigModal({
  open,
  apiKey,
  isTesting,
  isUpdating,
  onApiKeyChange,
  onTest,
  onSave,
  onClose,
}: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white dark:bg-gray-900/80 rounded-[40px] p-8 max-w-md w-full space-y-6 shadow-2xl border-2 border-gray-200 dark:border-gray-800"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-xl flex items-center justify-center">
              <Settings size={20} />
            </div>
            <h3 className="text-xl font-black text-gray-900 dark:text-gray-50 tracking-tight">
              ElevenLabs API Key
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 dark:text-gray-500 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500 font-medium">
            Insira sua API Key do ElevenLabs para habilitar a geração de vozes. Você pode encontrar
            sua chave no perfil da sua conta ElevenLabs.
          </p>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">
              Sua API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => onApiKeyChange(e.target.value)}
              placeholder="Cole sua API Key aqui..."
              className="w-full px-5 py-4 bg-gray-50 dark:bg-gray-800/60 border-2 border-gray-200 dark:border-gray-800 rounded-2xl focus:border-blue-500 focus:bg-white dark:bg-gray-900/80 transition-all outline-none font-mono text-sm"
            />
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            onClick={onTest}
            disabled={isTesting || !apiKey}
            className="px-4 py-4 rounded-2xl font-black uppercase tracking-widest text-[10px] bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-950/30 transition-all border border-amber-200 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isTesting ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
            Testar
          </button>
          <button
            onClick={onClose}
            className="flex-1 px-6 py-4 rounded-2xl font-black uppercase tracking-widest text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 dark:text-gray-500 hover:bg-gray-200 transition-all"
          >
            Cancelar
          </button>
          <button
            onClick={onSave}
            disabled={isUpdating || !apiKey}
            className="flex-1 px-6 py-4 rounded-2xl font-black uppercase tracking-widest text-xs bg-blue-600 text-white hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isUpdating ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Salvar Chave
          </button>
        </div>
      </motion.div>
    </div>
  );
}
