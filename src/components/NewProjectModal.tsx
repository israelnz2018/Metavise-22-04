import { motion } from 'motion/react';
import { Loader2 } from 'lucide-react';
import type { ProjectType } from '@/types/project';

// New-project picker dialog. Opens from the Projects tab "+ Novo" button
// and from the empty-state CTA. Owns no state of its own — App.tsx
// passes everything in and handles persistence in handleCreateProject.
interface Props {
  isOpen: boolean;
  name: string;
  type: ProjectType;
  copySubMode: 'zero' | 'improve' | 'ready';
  isSaving: boolean;
  onNameChange: (next: string) => void;
  onTypeChange: (next: ProjectType) => void;
  onCopySubModeChange: (next: 'zero' | 'improve' | 'ready') => void;
  onClose: () => void;
  onCreate: () => void;
}

export function NewProjectModal({
  isOpen,
  name,
  type,
  copySubMode,
  isSaving,
  onNameChange,
  onTypeChange,
  onCopySubModeChange,
  onClose,
  onCreate,
}: Props) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white w-full max-w-lg rounded-[40px] shadow-2xl border-4 border-blue-50 p-10 space-y-6"
      >
        <div className="text-center space-y-2">
          <h3 className="text-2xl font-black text-gray-900 tracking-tight uppercase">
            Novo Projeto
          </h3>
          <p className="text-xs text-gray-500 font-medium">
            Escolha o tipo de projeto que deseja iniciar.
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">
              Nome do Projeto
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="Ex: Campanha de Verão"
              className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all outline-none text-sm font-bold"
            />
          </div>

          {/* Projeto Completo — destaque */}
          <button
            onClick={() => onTypeChange('complete')}
            className={`w-full p-5 rounded-2xl border-2 text-left transition-all ${
              type === 'complete'
                ? 'border-blue-600 bg-blue-50'
                : 'border-gray-100 hover:border-blue-200'
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">🚀</span>
              <div>
                <p className="font-black text-gray-900 uppercase tracking-tight">
                  Projeto Completo
                </p>
                <p className="text-[10px] text-gray-500 font-medium">
                  Do roteiro ao vídeo editado — tudo em um só lugar
                </p>
              </div>
            </div>
          </button>

          {/* 3 atalhos menores */}
          <div className="grid grid-cols-3 gap-3">
            {SHORTCUT_TYPES.map((t) => (
              <button
                key={t.id}
                onClick={() => onTypeChange(t.id)}
                className={`p-3 rounded-2xl border-2 text-center transition-all ${
                  type === t.id
                    ? 'border-blue-600 bg-blue-50'
                    : 'border-gray-100 hover:border-blue-200'
                }`}
              >
                <div className="text-xl mb-1">{t.icon}</div>
                <p className="text-[10px] font-black text-gray-900 uppercase leading-tight">
                  {t.label}
                </p>
                <p className="text-[8px] text-gray-400 mt-1 uppercase font-bold tracking-tighter leading-tight">
                  {t.desc}
                </p>
              </button>
            ))}
          </div>

          {/* Sub-opções de copy — aparecem apenas quando 'copy' está selecionado */}
          {type === 'copy' && (
            <div className="bg-blue-50 rounded-2xl p-4 space-y-2 border border-blue-100 animate-in fade-in slide-in-from-top-2 duration-300">
              <p className="text-[10px] font-black text-blue-700 uppercase tracking-widest mb-2">
                Como deseja começar?
              </p>
              {COPY_SUBMODES.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => onCopySubModeChange(opt.id)}
                  className={`w-full p-3 rounded-xl border text-left transition-all ${
                    copySubMode === opt.id
                      ? 'border-blue-500 bg-white shadow-sm'
                      : 'border-transparent hover:bg-white/50'
                  }`}
                >
                  <p className="text-xs font-bold text-gray-900">{opt.label}</p>
                  <p className="text-[10px] text-gray-500 font-medium">{opt.desc}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-4 text-gray-400 font-black uppercase text-[10px] tracking-widest hover:bg-gray-50 rounded-2xl transition-all"
          >
            Cancelar
          </button>
          <button
            onClick={onCreate}
            disabled={isSaving || !name.trim()}
            className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-blue-700 transition-all shadow-xl shadow-blue-100 disabled:opacity-50 flex items-center justify-center gap-2"
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
