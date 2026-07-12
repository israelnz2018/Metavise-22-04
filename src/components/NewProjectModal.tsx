import { motion } from 'motion/react';
import { Loader2 } from 'lucide-react';
import type { ProjectType } from '@/types/project';
import { useFocusTrap } from '@/hooks/useFocusTrap';

// New-project picker dialog. Opens from the Projects tab "+ Novo" button
// and from the empty-state CTA. Owns no state of its own — App.tsx
// passes everything in and handles persistence in handleCreateProject.
//
// Blueprint Fase 5 — modal simplificado: todo projeto agora é 'complete'.
// Os 3 atalhos (Roteiro/Vídeo/Edição) foram removidos junto com o card
// destaque "Projeto Completo" (vira único, então redundante). Cliente
// vê: nome → escolha VSL/Produto → criar. Props legacy (type, copySubMode,
// onTypeChange, onCopySubModeChange) ficam na interface por compat com
// App.tsx que ainda popula essas variáveis com defaults ('complete', 'zero').
interface Props {
  isOpen: boolean;
  name: string;
  /** Mantido por compat. Sempre 'complete' agora (Blueprint Fase 5). */
  type: ProjectType;
  /** Mantido por compat. Sempre 'zero' agora (sem fluxo copy avulso). */
  copySubMode: 'zero' | 'improve' | 'ready';
  /** Blueprint Fase 4 — escolha "tenho VSL" vs "só tenho produto".
   *  Null = ainda não decidiu (o botão "Criar Projeto" fica disabled
   *  até escolher uma opção). */
  sourceMode: 'vsl' | 'product' | null;
  isSaving: boolean;
  onNameChange: (next: string) => void;
  /** Mantido por compat. Não é mais chamado da UI (sempre 'complete'). */
  onTypeChange: (next: ProjectType) => void;
  /** Mantido por compat. Não é mais chamado da UI. */
  onCopySubModeChange: (next: 'zero' | 'improve' | 'ready') => void;
  onSourceModeChange: (next: 'vsl' | 'product' | null) => void;
  onClose: () => void;
  onCreate: () => void;
}

export function NewProjectModal({
  isOpen,
  name,
  isSaving,
  onNameChange,
  onClose,
  onCreate,
}: Props) {
  const trapRef = useFocusTrap<HTMLDivElement>(isOpen);
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <motion.div
        ref={trapRef}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.15 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-gray-900 w-full max-w-lg rounded-3xl shadow-2xl shadow-black/20 ring-1 ring-gray-200/60 dark:ring-gray-800 p-8 space-y-6"
      >
        <div className="text-center space-y-1">
          <h3 className="text-2xl font-black text-gray-900 dark:text-gray-50 tracking-tight">
            Novo Projeto
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            🚀 Roteiro · Voz · Avatar · Vídeo · Edição — tudo em um só lugar
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest ml-1">
              Nome do Projeto
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="Ex: Campanha de Verão"
              data-autofocus
              className="w-full p-3.5 bg-gray-50 dark:bg-gray-800/60 border border-gray-200/60 dark:border-gray-700/60 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white dark:focus:bg-gray-800 transition-all outline-none text-sm font-bold dark:text-gray-100 dark:placeholder:text-gray-500"
            />
          </div>

        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 text-gray-500 dark:text-gray-400 font-black uppercase text-[10px] tracking-widest hover:bg-gray-50 dark:hover:bg-gray-800/60 rounded-xl transition-all"
          >
            Cancelar
          </button>
          <button
            onClick={onCreate}
            disabled={isSaving || !name.trim()}
            className="flex-1 py-3 bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-xl font-black uppercase text-[10px] tracking-widest hover:from-blue-600 hover:to-blue-700 active:scale-[0.98] transition-all shadow-xl shadow-blue-200/60 dark:shadow-blue-900/30 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:from-blue-500 flex items-center justify-center gap-2 ring-1 ring-inset ring-white/20"
          >
            {isSaving ? <Loader2 className="animate-spin" size={16} /> : 'Criar Projeto'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
