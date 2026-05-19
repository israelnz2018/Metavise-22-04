import { Users } from 'lucide-react';
import type { Project } from '../types/project';

// Asks "do you already know your audience?" the first time a user
// creates a subproject. The answer (known vs discover) flips the
// initial copyDiscoveryMode so the Copy tab opens to the right view.
interface Props {
  project: Project | null;
  onClose: () => void;
  onProceed: (project: Project, path: 'known' | 'discover') => void;
}

export function PersonaPathModal({ project, onClose, onProceed }: Props) {
  if (!project) return null;
  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl shadow-2xl max-w-lg w-full p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-2xl bg-blue-100 flex items-center justify-center">
            <Users size={24} className="text-blue-600" />
          </div>
          <div>
            <h3 className="text-xl font-black text-gray-900">Novo Subprojeto</h3>
            <p className="text-xs text-gray-500 font-bold uppercase tracking-widest">
              Você já sabe quem é seu cliente?
            </p>
          </div>
        </div>

        <p className="text-sm text-gray-600 leading-relaxed mb-6 mt-2">
          Antes de começar, queremos entender como você quer trabalhar o público desse subprojeto.
        </p>

        <div className="space-y-3">
          <button
            onClick={() => onProceed(project, 'known')}
            className="w-full p-5 rounded-2xl border-2 border-gray-100 hover:border-blue-300 text-left transition-all bg-white group shadow-sm hover:shadow-md"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl group-hover:scale-110 transition-transform">✅</span>
              <div>
                <p className="font-black text-gray-900 uppercase italic">
                  Já sei quem é meu cliente
                </p>
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                  Vou preencher as informações diretamente na Copy
                </p>
              </div>
            </div>
          </button>

          <button
            onClick={() => onProceed(project, 'discover')}
            className="w-full p-5 rounded-2xl border-2 border-blue-200 hover:border-blue-500 text-left transition-all bg-blue-50 group shadow-sm hover:shadow-md"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl group-hover:scale-110 transition-transform">🔍</span>
              <div>
                <p className="font-black text-gray-900 uppercase italic">Me ajuda a descobrir</p>
                <p className="text-[10px] text-blue-600 font-bold uppercase tracking-widest">
                  A IA gera 3 personas com nível de consciência
                </p>
              </div>
            </div>
          </button>
        </div>

        <button
          onClick={onClose}
          className="w-full mt-4 py-2 text-xs font-bold text-gray-400 uppercase tracking-widest hover:text-gray-600 transition-colors"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
