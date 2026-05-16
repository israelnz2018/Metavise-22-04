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
import type { Project, ProjectVariant, Step } from '../types/project';
import { cn, getVideoAspectRatioClass } from '../lib/utils';
import { getAuthorizedUrl } from '../lib/gemini';

interface VariantItemProps {
  variant: ProjectVariant;
  project: Project;
  onLoad: (v: ProjectVariant, step?: Step) => void;
  onDelete: (pid: string, vid: string) => void | Promise<void>;
  onRename: (pid: string, vid: string, newName: string) => void | Promise<void>;
  isViewing: boolean;
  onView: (v: ProjectVariant) => void;
  platformApiKey?: string | null;
  onDeleteAudio?: (audio: any) => void | Promise<void>;
  onDeleteVideo?: (video: any) => void | Promise<void>;
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
  platformApiKey,
  onDeleteAudio,
  onDeleteVideo,
}) => {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(variant.name);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  const hasCopy = !!variant.config.copy.generatedScript;
  const hasOptimizedCopy = !!variant.config.copy.optimizedScript;
  const audios = variant.config.audios || [];
  const videos = variant.config.videos || [];

  // Fallback for older data with single audio/video properties instead of arrays.
  const displayAudios =
    audios.length > 0
      ? audios
      : variant.config.audioUrl
        ? [
            {
              url: variant.config.audioUrl,
              storagePath: variant.config.audioStoragePath,
              voiceId: variant.config.avatar.voiceId,
              createdAt: '',
            },
          ]
        : [];
  const displayVideos =
    videos.length > 0
      ? videos
      : variant.config.videoUrl
        ? [
            {
              url: variant.config.videoUrl,
              storagePath: variant.config.videoStoragePath,
              createdAt: '',
              aspectRatio: variant.config.format.aspectRatio,
            },
          ]
        : [];

  return (
    <div
      className={`rounded-[32px] border-2 transition-all overflow-hidden ${
        isViewing
          ? 'border-blue-600 bg-blue-50/30 shadow-lg shadow-blue-100/50'
          : 'border-gray-100 bg-white hover:border-blue-100'
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
                : 'bg-blue-50 text-blue-600'
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
                    className="font-black text-base text-gray-900 tracking-tight border-2 border-blue-400 rounded-lg px-2 py-1 outline-none"
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
                    className="px-2 py-1 bg-gray-100 text-gray-600 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-gray-200 transition-all"
                  >
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <p className="font-black text-base text-gray-900 tracking-tight">
                    {variant.name}
                  </p>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenameValue(variant.name);
                      setIsRenaming(true);
                    }}
                    className="p-1 rounded-lg text-gray-300 hover:text-blue-600 hover:bg-blue-50 transition-all"
                    title="Renomear subprojeto"
                  >
                    <Edit3 size={14} />
                  </button>
                </>
              )}
            </div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
              {variant.createdAt?.toDate
                ? variant.createdAt.toDate().toLocaleString()
                : 'Data não disponível'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onLoad(variant);
            }}
            className="px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white transition-all shadow-sm"
          >
            Carregar Versão
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(project.id, variant.id);
            }}
            className="p-2.5 rounded-xl text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all"
            title="Excluir Subprojeto"
          >
            <Trash2 size={20} />
          </button>
        </div>
      </div>

      <div className="px-5 pb-5 space-y-4">
        <div className="pt-2 pb-1 border-b border-gray-100">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
            Recursos do Subprojeto
          </p>
        </div>

        <div className="space-y-3">
          {hasCopy && (
            <div className="space-y-2">
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedItem(expandedItem === 'copy' ? null : 'copy');
                }}
                className={`flex items-center justify-between p-3.5 rounded-2xl border transition-all cursor-pointer ${
                  expandedItem === 'copy'
                    ? 'bg-amber-50 border-amber-200 shadow-sm'
                    : 'bg-gray-50/50 border-gray-100 hover:border-amber-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center ${expandedItem === 'copy' ? 'bg-amber-200 text-amber-700' : 'bg-amber-100 text-amber-600'}`}
                  >
                    <Type size={14} />
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-600">
                    Copywriting Gerada
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onLoad(variant, 'copy');
                    }}
                    className="px-3 py-1.5 bg-amber-100 text-amber-700 rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-amber-200 transition-all"
                  >
                    Editar Copy
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onLoad(variant, 'voz-premium');
                    }}
                    className="px-3 py-1.5 bg-gray-900 text-white rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-black transition-all"
                  >
                    Ir para Voz
                  </button>
                  <ChevronDown
                    size={16}
                    className={`text-gray-400 transition-transform duration-300 ${expandedItem === 'copy' ? 'rotate-180' : ''}`}
                  />
                </div>
              </div>
              <AnimatePresence>
                {expandedItem === 'copy' && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-4 p-5 bg-white rounded-2xl border border-amber-100 shadow-inner">
                      <div className="space-y-2">
                        <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
                          Script Original
                        </p>
                        <div className="text-xs text-gray-700 whitespace-pre-wrap font-medium leading-relaxed">
                          {variant.config.copy.generatedScript}
                        </div>
                      </div>
                      {hasOptimizedCopy && (
                        <div className="space-y-2 pt-4 border-t border-gray-50">
                          <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest">
                            Script Otimizado (ElevenLabs)
                          </p>
                          <div className="text-xs text-gray-700 whitespace-pre-wrap font-bold leading-relaxed">
                            {variant.config.copy.optimizedScript}
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {displayAudios.map((audio: any, idx: number) => (
            <div key={`creative-audio-${idx}-${audio.url || 'no-url'}`} className="space-y-2">
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedItem(expandedItem === `audio-${idx}` ? null : `audio-${idx}`);
                }}
                className={`flex items-center justify-between p-3.5 rounded-2xl border transition-all cursor-pointer ${
                  expandedItem === `audio-${idx}`
                    ? 'bg-green-50 border-green-200 shadow-sm'
                    : 'bg-gray-50/50 border-gray-100 hover:border-green-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center ${expandedItem === `audio-${idx}` ? 'bg-green-200 text-green-700' : 'bg-green-100 text-green-600'}`}
                  >
                    <Volume2 size={14} />
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-600">
                    Narração {idx + 1}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onLoad(variant, 'avatar');
                    }}
                    className="px-3 py-1.5 bg-gray-900 text-white rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-black transition-all"
                  >
                    Ir para Avatar
                  </button>
                  <ChevronDown
                    size={16}
                    className={`text-gray-400 transition-transform duration-300 ${expandedItem === `audio-${idx}` ? 'rotate-180' : ''}`}
                  />
                </div>
              </div>
              <AnimatePresence>
                {expandedItem === `audio-${idx}` && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="p-4 bg-white rounded-2xl border border-green-100 flex items-center justify-between gap-4 shadow-inner">
                      <audio src={audio.url || undefined} controls className="h-8 flex-1" />
                      <div className="flex items-center gap-2">
                        <a
                          href={audio.url}
                          download={`audio-${idx + 1}.mp3`}
                          className="p-2 text-gray-400 hover:text-blue-500 transition-colors"
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Download size={16} />
                        </a>
                        {onDeleteAudio && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (
                                window.confirm(
                                  'Tem certeza que deseja deletar este áudio? Esta ação não pode ser desfeita.'
                                )
                              ) {
                                onDeleteAudio(audio);
                              }
                            }}
                            className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                            title="Deletar áudio"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}

          {displayVideos.map((video: any, idx: number) => (
            <div key={`creative-video-${idx}-${video.url || 'no-url'}`} className="space-y-2">
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedItem(expandedItem === `video-${idx}` ? null : `video-${idx}`);
                }}
                className={`flex items-center justify-between p-3.5 rounded-2xl border transition-all cursor-pointer ${
                  expandedItem === `video-${idx}`
                    ? 'bg-blue-50 border-blue-200 shadow-sm'
                    : 'bg-gray-50/50 border-gray-100 hover:border-blue-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center ${expandedItem === `video-${idx}` ? 'bg-blue-200 text-blue-700' : 'bg-blue-100 text-blue-600'}`}
                  >
                    <Video size={14} />
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-600">
                    Vídeo Avatar {idx + 1}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onLoad(variant, 'edit');
                    }}
                    className="px-3 py-1.5 bg-gray-900 text-white rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-black transition-all"
                  >
                    Ir para Edição
                  </button>
                  <ChevronDown
                    size={16}
                    className={`text-gray-400 transition-transform duration-300 ${expandedItem === `video-${idx}` ? 'rotate-180' : ''}`}
                  />
                </div>
              </div>
              <AnimatePresence>
                {expandedItem === `video-${idx}` && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-4 p-4 bg-white rounded-2xl border border-blue-100 shadow-inner">
                      <div
                        className={cn(
                          'bg-black rounded-xl overflow-hidden border-2 border-gray-100 shadow-sm',
                          getVideoAspectRatioClass(video)
                        )}
                      >
                        <video
                          src={
                            getAuthorizedUrl(video.url || '', platformApiKey || undefined) ||
                            undefined
                          }
                          controls
                          className="w-full h-full object-contain"
                          referrerPolicy={
                            video.url?.includes('generativelanguage.googleapis.com')
                              ? ('no-referrer' as const)
                              : undefined
                          }
                          crossOrigin={
                            video.url?.includes('generativelanguage.googleapis.com')
                              ? ('anonymous' as const)
                              : undefined
                          }
                          onError={(e) => {
                            if (video.url?.startsWith('/generated/')) {
                              console.warn('[Video Expired] Variant Item:', video.url);
                              e.currentTarget.style.display = 'none';
                            } else {
                              console.error(
                                '[Video Error] Variant Item:',
                                e.currentTarget.error?.message,
                                video.url
                              );
                            }
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onLoad(variant, 'edit');
                            }}
                            className="px-4 py-2 bg-purple-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-purple-700 transition-all shadow-lg shadow-purple-100 flex items-center gap-2"
                          >
                            <Scissors size={12} />
                            Editar Edição
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onLoad(variant, 'final');
                            }}
                            className="px-4 py-2 bg-gray-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-black transition-all shadow-lg shadow-gray-200 flex items-center gap-2"
                          >
                            <Download size={12} />
                            Exportar Completo
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <a
                            href={video.url}
                            download={`video-${idx + 1}.mp4`}
                            className="p-2 text-gray-400 hover:text-blue-500 transition-colors"
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Download size={16} />
                          </a>
                          {onDeleteVideo && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteVideo(video);
                              }}
                              className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
