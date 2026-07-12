import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Layout,
  Edit3,
  Trash2,
  Type,
  ChevronDown,
  Volume2,
  Download,
  Video,
  Scissors,
} from 'lucide-react';
import type { Project, ProjectVariant, Step } from '@/types/project';
import { CreativeInfoButton } from './CreativeInfoButton';

interface VariantItemProps {
  variant: ProjectVariant;
  project: Project;
  onLoad: (v: ProjectVariant, step?: Step, projectId?: string) => void;
  onDelete: (pid: string, vid: string) => void | Promise<void>;
  onRename: (pid: string, vid: string, newName: string) => void | Promise<void>;
  isViewing: boolean;
  onView: (v: ProjectVariant) => void;
  platformApiKey?: string | null;
  onDeleteAudio?: (audio: any) => void | Promise<void>;
  onDeleteVideo?: (video: any) => void | Promise<void>;
  /** Catálogo HeyGen carregado no App — resolve nome/preview do avatar
   *  no painel de info (criativos antigos só salvaram o id). */
  heygenAvatars?: any[];
}

// Row in the Projects tab — shows a single variant of a project with its
// copy, narrations and rendered videos. Each section expands inline.
export const VariantItem: React.FC<VariantItemProps> = ({
  variant,
  project,
  onLoad,
  onDelete,
  onRename,
  isViewing,
  onView,
  heygenAvatars = [],
}) => {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(variant.name);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  const cfg: any = variant.config || {};
  const copyCfg: any = cfg.copy || {};
  const audios = cfg.audios || [];
  const videos = cfg.videos || [];

  // Detecção de "feito" por etapa (mesma fonte que o resolveDeepestStep).
  const editCfg: any = cfg.edit || {};
  // ─── Entregáveis do subprojeto, na ordem: HOOK → CORPO → FINAL ──────────
  // Cada linha é um entregável; o usuário pode ABRIR (ir pra etapa) ou BAIXAR.
  // Os itens do corpo editado (b-rolls/tela preta/música) saem do mesmo array
  // `zapVersions`, separados pelo PREFIXO do arquivo salvo.
  const urlOf = (x: any): string => (typeof x === 'string' ? x : x?.url || '');
  const cleanArr = (a: any): string[] => (Array.isArray(a) ? a.map(urlOf).filter(Boolean) : []);
  const incl = (u: string, sub: string) => {
    try {
      return decodeURIComponent(u).includes(sub);
    } catch {
      return u.includes(sub);
    }
  };
  const pref = (a: any, p: string) => cleanArr(a).filter((u) => incl(u, p));

  const hookAudioUrls = cleanArr(copyCfg.hookAudios).length
    ? cleanArr(copyCfg.hookAudios)
    : copyCfg.hookAudioUrl
      ? [copyCfg.hookAudioUrl]
      : [];
  const hookVideoUrls = cleanArr(copyCfg.hookVideos).length
    ? cleanArr(copyCfg.hookVideos)
    : copyCfg.hookVideoUrl
      ? [copyCfg.hookVideoUrl]
      : [];
  const bodyAudioUrls = cleanArr(audios).length ? cleanArr(audios) : cfg.audioUrl ? [cfg.audioUrl] : [];
  const bodyVideoUrls = cleanArr(videos).length ? cleanArr(videos) : cfg.videoUrl ? [cfg.videoUrl] : [];

  type Deliverable = {
    key: string;
    group: string;
    step: Step;
    label: string;
    icon: React.ReactNode;
    kind: 'text' | 'audio' | 'video';
    urls: string[];
    text?: string;
    tone: string;
  };
  const deliverables: Deliverable[] = [
    { key: 'h-copy', group: 'Gancho (Hook)', step: 'copy', label: 'Copy / roteiro do hook', icon: <Type size={14} />, kind: 'text', urls: [], text: copyCfg.hookSelecionado || copyCfg.hookOptimizedScript || '', tone: 'amber' },
    { key: 'h-audio', group: 'Gancho (Hook)', step: 'voz-premium', label: 'Áudio do hook', icon: <Volume2 size={14} />, kind: 'audio', urls: hookAudioUrls, tone: 'green' },
    { key: 'h-avatar', group: 'Gancho (Hook)', step: 'avatar', label: 'Avatar do hook', icon: <Video size={14} />, kind: 'video', urls: hookVideoUrls, tone: 'blue' },
    { key: 'h-zap', group: 'Gancho (Hook)', step: 'edit-zap', label: 'Hook editado (legenda)', icon: <Scissors size={14} />, kind: 'video', urls: cleanArr(editCfg.zapHookVersions), tone: 'purple' },
    { key: 'b-audio', group: 'Corpo', step: 'voz-premium', label: 'Áudio do corpo', icon: <Volume2 size={14} />, kind: 'audio', urls: bodyAudioUrls, tone: 'green' },
    { key: 'b-avatar', group: 'Corpo', step: 'avatar', label: 'Avatar do corpo', icon: <Video size={14} />, kind: 'video', urls: bodyVideoUrls, tone: 'blue' },
    { key: 'b-broll', group: 'Corpo', step: 'edit-zap', label: 'Corpo com b-rolls', icon: <Scissors size={14} />, kind: 'video', urls: pref(editCfg.zapVersions, 'zapcap'), tone: 'gray' },
    { key: 'b-black', group: 'Corpo', step: 'edit-zap', label: 'Corpo + tela preta', icon: <Scissors size={14} />, kind: 'video', urls: pref(editCfg.zapVersions, 'intercut'), tone: 'gray' },
    { key: 'b-music', group: 'Corpo', step: 'edit-zap', label: 'Corpo + música', icon: <Scissors size={14} />, kind: 'video', urls: pref(editCfg.zapVersions, 'addmusic'), tone: 'gray' },
    { key: 'final', group: 'Final', step: 'edit-zap', label: 'Vídeo completo', icon: <Download size={14} />, kind: 'video', urls: cleanArr(editCfg.zapJoinedVersions), tone: 'purple' },
  ];
  const toneIcon: Record<string, string> = {
    amber: 'bg-amber-100 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400',
    green: 'bg-green-100 dark:bg-green-950/30 text-green-600 dark:text-green-400',
    blue: 'bg-blue-100 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400',
    purple: 'bg-purple-100 dark:bg-purple-950/30 text-purple-600 dark:text-purple-400',
    gray: 'bg-gray-100 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400',
  };

  // Fallback for older data with single audio/video properties instead of arrays.
  return (
    <div
      className={`rounded-[32px] border-2 transition-all overflow-hidden ${
        isViewing
          ? 'border-blue-600 bg-blue-50/30 dark:bg-blue-950/40 shadow-lg shadow-blue-100/50'
          : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/80 hover:border-blue-100 dark:hover:border-blue-900'
      }`}
    >
      <div
        onClick={() => onView(variant)}
        className="flex items-center justify-between p-5 cursor-pointer"
      >
        <div className="flex items-center gap-4">
          <div
            className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${
              isViewing
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/40'
                : 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
            }`}
          >
            <Layout size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              {isRenaming ? (
                <>
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (renameValue.trim() && renameValue !== variant.name) {
                          onRename(project.id, variant.id, renameValue);
                        }
                        setIsRenaming(false);
                      } else if (e.key === 'Escape') {
                        setRenameValue(variant.name);
                        setIsRenaming(false);
                      }
                    }}
                    autoFocus
                    className="font-black text-base text-gray-900 dark:text-gray-50 tracking-tight border-2 border-blue-400 rounded-lg px-2 py-1 outline-none"
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (renameValue.trim() && renameValue !== variant.name) {
                        onRename(project.id, variant.id, renameValue);
                      }
                      setIsRenaming(false);
                    }}
                    className="px-2 py-1 bg-blue-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all"
                  >
                    Salvar
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenameValue(variant.name);
                      setIsRenaming(false);
                    }}
                    className="px-2 py-1 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-gray-200 transition-all"
                  >
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <p className="font-black text-base text-gray-900 dark:text-gray-50 tracking-tight">
                    {variant.name}
                  </p>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenameValue(variant.name);
                      setIsRenaming(true);
                    }}
                    className="p-1 rounded-lg text-gray-300 dark:text-gray-600 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-all"
                    title="Renomear subprojeto"
                  >
                    <Edit3 size={14} />
                  </button>
                </>
              )}
            </div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
              {variant.createdAt?.toDate
                ? variant.createdAt.toDate().toLocaleString()
                : 'Data não disponível'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div onClick={(e) => e.stopPropagation()}>
            <CreativeInfoButton variant={variant} heygenAvatars={heygenAvatars} placement="inline" />
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onLoad(variant, undefined, project.id);
            }}
            className="px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 hover:bg-blue-600 hover:text-white transition-all shadow-sm"
          >
            Carregar Versão
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(project.id, variant.id);
            }}
            className="p-2.5 rounded-xl text-gray-300 dark:text-gray-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-all"
            title="Excluir Subprojeto"
          >
            <Trash2 size={20} />
          </button>
        </div>
      </div>

      <div className="px-5 pb-5 space-y-4">
        <div className="pt-2 pb-1 border-b border-gray-200 dark:border-gray-800">
          <p className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">
            Recursos do Subprojeto
          </p>
        </div>

        <div className="space-y-3">
          {/* Todas as etapas do fluxo. Cada uma abre a SUA aba. Etapas já
              feitas mostram ✓ e expandem o conteúdo (copy/áudio/vídeo);
              etapas pendentes ficam esmaecidas mas continuam clicáveis. */}
          {deliverables.map((d, di) => {
            const done = d.kind === 'text' ? !!d.text : d.urls.length > 0;
            const latest = d.urls[d.urls.length - 1];
            const isOpen = expandedItem === d.key;
            const showGroup = di === 0 || deliverables[di - 1]?.group !== d.group;
            return (
              <div key={d.key} className="space-y-2">
                {showGroup && (
                  <p className="pt-1 text-[9px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">
                    {d.group}
                  </p>
                )}
                <div
                  onClick={() => {
                    if (done) setExpandedItem(isOpen ? null : d.key);
                  }}
                  className={`flex items-center justify-between p-3.5 rounded-2xl border transition-all ${
                    done ? 'cursor-pointer' : ''
                  } ${
                    isOpen
                      ? 'bg-gray-50 dark:bg-gray-800/60 border-gray-300 dark:border-gray-700 shadow-sm'
                      : done
                        ? 'bg-gray-50/50 dark:bg-gray-800/60 border-gray-200 dark:border-gray-800 hover:border-gray-300'
                        : 'bg-gray-50/30 dark:bg-gray-900/30 border-gray-200/60 dark:border-gray-800/60'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        done ? toneIcon[d.tone] : 'bg-gray-100 dark:bg-gray-800/60 text-gray-400 dark:text-gray-600'
                      }`}
                    >
                      {d.icon}
                    </div>
                    <div>
                      <span
                        className={`text-[10px] font-black uppercase tracking-widest ${
                          done ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500'
                        }`}
                      >
                        {d.label}
                      </span>
                      <span
                        className={`block text-[9px] font-bold tracking-wide ${
                          done ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-gray-600'
                        }`}
                      >
                        {done
                          ? d.kind === 'text'
                            ? '✓ Pronto'
                            : `✓ ${d.urls.length} ${d.urls.length > 1 ? 'versões' : 'versão'}`
                          : 'Ainda não feito'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {done && d.kind !== 'text' && latest && (
                      <a
                        href={latest}
                        download
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap inline-flex items-center gap-1"
                      >
                        <Download size={12} /> Baixar
                      </a>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onLoad(variant, d.step, project.id);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${
                        done
                          ? 'bg-gray-900 text-white hover:bg-black'
                          : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 ring-1 ring-gray-300 dark:ring-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      Abrir
                    </button>
                    {done && (
                      <ChevronDown
                        size={16}
                        className={`text-gray-400 dark:text-gray-500 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
                      />
                    )}
                  </div>
                </div>

                {/* Conteúdo expansível: player + baixar por versão */}
                <AnimatePresence>
                  {isOpen && done && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="p-4 bg-white dark:bg-gray-900/80 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-inner space-y-3">
                        {d.kind === 'text' && (
                          <div className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
                            {d.text}
                          </div>
                        )}
                        {d.kind === 'audio' &&
                          d.urls.map((u, i) => (
                            <div key={i} className="flex items-center gap-3">
                              <audio src={u} controls className="h-8 flex-1" />
                              <a
                                href={u}
                                download
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-2 text-gray-400 dark:text-gray-500 hover:text-blue-500"
                              >
                                <Download size={16} />
                              </a>
                            </div>
                          ))}
                        {d.kind === 'video' &&
                          d.urls.map((u, i) => (
                            <div key={i} className="space-y-2">
                              <div className="relative">
                                <video
                                  src={u}
                                  controls
                                  className="w-full max-h-56 rounded-lg bg-black"
                                />
                                <CreativeInfoButton
                                  variant={variant}
                                  heygenAvatars={heygenAvatars}
                                  placement="overlay"
                                />
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-[10px] text-gray-400">versão {i + 1}</span>
                                <a
                                  href={u}
                                  download
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-600 hover:underline"
                                >
                                  <Download size={12} /> Baixar
                                </a>
                              </div>
                            </div>
                          ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
