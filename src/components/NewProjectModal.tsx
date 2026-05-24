import { motion } from 'motion/react';
import { Loader2 } from 'lucide-react';
import type { ProjectType } from '@/types/project';
import { useFocusTrap } from '@/hooks/useFocusTrap';

// New-project picker dialog. Opens from the Projects tab "+ Novo" button
// and from the empty-state CTA. Owns no state of its own — App.tsx
// passes everything in and handles persistence in handleCreateProject.
interface Props {
  isOpen: boolean;
  name: string;
  type: ProjectType;
  copySubMode: 'zero' | 'improve' | 'ready';
  /** Blueprint Fase 4 — escolha "tenho VSL" vs "só tenho produto".
   *  Só renderizada quando type === 'complete'. Null = ainda não decidiu
   *  (o botão "Criar Projeto" fica disabled até escolher uma opção). */
  sourceMode: 'vsl' | 'product' | null;
  isSaving: boolean;
  onNameChange: (next: string) => void;
  onTypeChange: (next: ProjectType) => void;
  onCopySubModeChange: (next: 'zero' | 'improve' | 'ready') => void;
  onSourceModeChange: (next: 'vsl' | 'product' | null) => void;
  onClose: () => void;
  onCreate: () => void;
}

export function NewProjectModal({
  isOpen,
  name,
  type,
  copySubMode,
  sourceMode,
  isSaving,
  onNameChange,
  onTypeChange,
  onCopySubModeChange,
  onSourceModeChange,
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
            Escolha o tipo de projeto que deseja iniciar.
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

          {/* Projeto Completo — destaque */}
          <button
            onClick={() => onTypeChange('complete')}
            className={`w-full p-4 rounded-xl ring-1 text-left transition-all ${
              type === 'complete'
                ? 'ring-blue-500 bg-gradient-to-br from-blue-50 to-blue-100/40 dark:from-blue-950/40 dark:to-blue-900/20 dark:ring-blue-400'
                : 'ring-gray-200/60 dark:ring-gray-700/60 hover:ring-blue-300 dark:hover:ring-blue-700 hover:bg-gray-50/50 dark:hover:bg-gray-800/40'
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">🚀</span>
              <div>
                <p className="font-black text-gray-900 dark:text-gray-50 uppercase tracking-tight">
                  Projeto Completo
                </p>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 font-medium">
                  Do roteiro ao vídeo editado — tudo em um só lugar
                </p>
              </div>
            </div>
          </button>

          {/* 3 atalhos menores */}
          <div className="grid grid-cols-3 gap-2.5">
            {SHORTCUT_TYPES.map((t) => (
              <button
                key={t.id}
                onClick={() => onTypeChange(t.id)}
                className={`p-3 rounded-xl ring-1 text-center transition-all ${
                  type === t.id
                    ? 'ring-blue-500 bg-gradient-to-br from-blue-50 to-blue-100/40 dark:from-blue-950/40 dark:to-blue-900/20 dark:ring-blue-400'
                    : 'ring-gray-200/60 dark:ring-gray-700/60 hover:ring-blue-300 dark:hover:ring-blue-700 hover:bg-gray-50/50 dark:hover:bg-gray-800/40'
                }`}
              >
                <div className="text-xl mb-1">{t.icon}</div>
                <p className="text-[10px] font-black text-gray-900 dark:text-gray-100 uppercase leading-tight">
                  {t.label}
                </p>
                <p className="text-[8px] text-gray-400 dark:text-gray-500 mt-1 uppercase font-bold tracking-tighter leading-tight">
                  {t.desc}
                </p>
              </button>
            ))}
          </div>

          {/* Blueprint Fase 4 — Como o cliente está começando.
              Só aparece quando tipo é 'complete' (Blueprint). Para outros
              tipos (copy/video/edit) não faz sentido — eles têm fluxo
              próprio. */}
          {type === 'complete' && (
            <div className="bg-purple-50/60 dark:bg-purple-950/30 rounded-xl p-4 space-y-3 ring-1 ring-purple-100/80 dark:ring-purple-900/40 animate-in fade-in slide-in-from-top-2 duration-300">
              <p className="text-[10px] font-black text-purple-700 dark:text-purple-300 uppercase tracking-widest">
                Como você está começando?
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  onClick={() => onSourceModeChange('vsl')}
                  className={`p-3 rounded-lg text-left transition-all ring-1 ${
                    sourceMode === 'vsl'
                      ? 'bg-white dark:bg-gray-900 ring-purple-500 shadow-sm'
                      : 'ring-purple-200/60 dark:ring-purple-800/40 hover:bg-white/50 dark:hover:bg-gray-800/40'
                  }`}
                >
                  <div className="text-lg mb-0.5">📺</div>
                  <p className="text-xs font-bold text-gray-900 dark:text-gray-100 leading-tight">
                    Tenho VSL ou landing pronta
                  </p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 font-medium mt-0.5 leading-tight">
                    A IA extrai persona e oferta direto do material
                  </p>
                </button>
                <button
                  onClick={() => onSourceModeChange('product')}
                  className={`p-3 rounded-lg text-left transition-all ring-1 ${
                    sourceMode === 'product'
                      ? 'bg-white dark:bg-gray-900 ring-purple-500 shadow-sm'
                      : 'ring-purple-200/60 dark:ring-purple-800/40 hover:bg-white/50 dark:hover:bg-gray-800/40'
                  }`}
                >
                  <div className="text-lg mb-0.5">🎁</div>
                  <p className="text-xs font-bold text-gray-900 dark:text-gray-100 leading-tight">
                    Só tenho o produto pra anunciar
                  </p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 font-medium mt-0.5 leading-tight">
                    Te perguntamos sobre o cliente antes de gerar
                  </p>
                </button>
              </div>
            </div>
          )}

          {/* Sub-opções de copy — aparecem apenas quando 'copy' está selecionado */}
          {type === 'copy' && (
            <div className="bg-blue-50/60 dark:bg-blue-950/30 rounded-xl p-4 space-y-2 ring-1 ring-blue-100/80 dark:ring-blue-900/40 animate-in fade-in slide-in-from-top-2 duration-300">
              <p className="text-[10px] font-black text-blue-700 dark:text-blue-300 uppercase tracking-widest mb-2">
                Como deseja começar?
              </p>
              {COPY_SUBMODES.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => onCopySubModeChange(opt.id)}
                  className={`w-full p-3 rounded-lg text-left transition-all ${
                    copySubMode === opt.id
                      ? 'bg-white dark:bg-gray-900 ring-1 ring-blue-500 shadow-sm'
                      : 'hover:bg-white/50 dark:hover:bg-gray-800/40'
                  }`}
                >
                  <p className="text-xs font-bold text-gray-900 dark:text-gray-100">{opt.label}</p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 font-medium">
                    {opt.desc}
                  </p>
                </button>
              ))}
            </div>
          )}
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
            disabled={
              isSaving ||
              !name.trim() ||
              // Blueprint Fase 4 — sem escolher sourceMode no tipo
              // 'complete' o roteamento pós-criação não sabe pra onde
              // mandar o cliente. Bloqueia até decidir.
              (type === 'complete' && !sourceMode)
            }
            className="flex-1 py-3 bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-xl font-black uppercase text-[10px] tracking-widest hover:from-blue-600 hover:to-blue-700 active:scale-[0.98] transition-all shadow-xl shadow-blue-200/60 dark:shadow-blue-900/30 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:from-blue-500 flex items-center justify-center gap-2 ring-1 ring-inset ring-white/20"
          >
            {isSaving ? <Loader2 className="animate-spin" size={16} /> : 'Criar Projeto'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

const SHORTCUT_TYPES: { id: ProjectType; icon: string; label: string; desc: string }[] = [
  { id: 'copy', icon: '✏️', label: 'Roteiro', desc: 'Criar ou melhorar' },
  { id: 'video', icon: '📹', label: 'Vídeo', desc: 'Avatar + Voz' },
  { id: 'editing', icon: '✂️', label: 'Edição', desc: 'Editar vídeo' },
];

const COPY_SUBMODES: { id: 'zero' | 'improve' | 'ready'; label: string; desc: string }[] = [
  { id: 'zero', label: 'Criar do zero', desc: 'A IA cria o roteiro respondendo perguntas' },
  {
    id: 'improve',
    label: 'Já tenho, quero melhorar',
    desc: 'Tenho um rascunho e quero aperfeiçoar',
  },
  { id: 'ready', label: 'Já está pronta', desc: 'Só quero otimizar para o ElevenLabs' },
];
