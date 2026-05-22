import { Loader2, AlertCircle, Sparkles, Download } from 'lucide-react';
import type { AdConfig } from '../App';
import { motion } from 'motion/react';
import { SUBTITLE_STYLES, AVATARS } from '../lib/constants';
import { getAuthorizedUrl } from '../lib/gemini';

// Exporta a versão final — preview do vídeo com legenda overlay + grid
// de metadata sobre o projeto. Recebe state via props.

interface Props {
  config: AdConfig;
  videoUrl: string | null;
  audioUrl: string | null;
  videoOp: any;
  loading: boolean;
  currentTime: number;
  setCurrentTime: (t: number) => void;
  isExpanded: boolean;
  generationStage: string;
  heygenAvatars: any[];
  platformApiKey: string | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  logs: string[];
  handleGenerateVideo: (forceRegenerate?: boolean) => void;
  handleGenerateSubtitles: () => void;
}

export function FinalTab({
  config,
  videoUrl,
  audioUrl,
  videoOp,
  loading,
  currentTime,
  setCurrentTime,
  isExpanded,
  generationStage,
  heygenAvatars,
  platformApiKey,
  videoRef,
  logs,
  handleGenerateVideo,
  handleGenerateSubtitles,
}: Props) {
  const aspectRatioClass =
    config.format.aspectRatio === '9:16'
      ? 'aspect-[9/16]'
      : config.format.aspectRatio === '1:1'
        ? 'aspect-square'
        : 'aspect-[16/9]';
  const maxWidthClass = isExpanded ? 'max-w-4xl' : 'max-w-[320px]';

  const avatarScript = (config.copy.generatedScript || '').includes('[AVATAR]:')
    ? config.copy.generatedScript.split('[AVATAR]:')[1]?.split('[SCENE]:')[0]?.trim() || ''
    : config.copy.generatedScript || '';

  // Simple subtitle logic: split script into 5 parts for 10s
  const words = avatarScript.split(' ');
  const partSize = Math.ceil(words.length / 5);
  const subtitleParts = [
    words.slice(0, partSize).join(' '),
    words.slice(partSize, partSize * 2).join(' '),
    words.slice(partSize * 2, partSize * 3).join(' '),
    words.slice(partSize * 3, partSize * 4).join(' '),
    words.slice(partSize * 4).join(' '),
  ];

  const currentSubtitle =
    currentTime < 2
      ? subtitleParts[0]
      : currentTime < 4
        ? subtitleParts[1]
        : currentTime < 6
          ? subtitleParts[2]
          : currentTime < 8
            ? subtitleParts[3]
            : subtitleParts[4];
  const subtitleStyle = SUBTITLE_STYLES.find((s) => s.id === config.subtitles.style);

  const posterUrl =
    config.avatar.faceId === 'custom'
      ? config.avatar.customFaceUrl || undefined
      : heygenAvatars.find((a) => a.avatar_id === config.avatar.faceId)?.preview_image_url;

  return (
    <div className="space-y-8 max-w-[1600px] mx-auto text-center">
      <div
        className={`relative ${aspectRatioClass} ${maxWidthClass} mx-auto bg-gray-900 rounded-[32px] overflow-hidden shadow-2xl border-8 border-gray-800 transition-all duration-500`}
      >
        {videoUrl ? (
          <>
            <video
              ref={videoRef}
              key={videoUrl}
              src={getAuthorizedUrl(videoUrl || '', platformApiKey || undefined) || undefined}
              controls
              muted
              playsInline
              poster={posterUrl}
              className="w-full h-full object-contain bg-black"
              referrerPolicy={
                videoUrl?.includes('generativelanguage.googleapis.com')
                  ? 'no-referrer'
                  : undefined
              }
              onError={(e) => {
                if (videoUrl?.startsWith('/generated/')) {
                  console.warn('[Video Expired] Final Preview:', videoUrl);
                  e.currentTarget.style.display = 'none';
                } else {
                  console.error(
                    '[Video Error] Final Preview:',
                    e.currentTarget.error?.message,
                    videoUrl
                  );
                }
              }}
              onTimeUpdate={(e) => {
                const video = e.target as HTMLVideoElement;
                if (!audioUrl) setCurrentTime(video.currentTime);
              }}
            />
            {(generationStage === 'completed' ||
              generationStage === 'subtitles' ||
              generationStage === 'edit') && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="max-w-[80%] text-center">
                  <div
                    className={`inline-block px-4 py-2 rounded-lg backdrop-blur-md shadow-2xl ${subtitleStyle?.class || ''}`}
                    style={{
                      fontSize: isExpanded ? '2rem' : '1.2rem',
                    }}
                  >
                    {currentSubtitle}
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-8 text-gray-500">
            {loading ||
            (videoOp && videoOp.status !== 'completed' && videoOp.status !== 'failed') ? (
              <>
                <Loader2 className="animate-spin mb-4 text-blue-500" size={48} />
                <p className="text-sm font-black text-white uppercase tracking-widest animate-pulse">
                  {generationStage === 'audio'
                    ? 'Gerando Voz...'
                    : generationStage === 'video'
                      ? `Criando Vídeo (${videoOp?.displayStatus || 'Iniciando'} - ${videoOp?.progress || 0}%)`
                      : generationStage === 'subtitles'
                        ? 'Adicionando Legendas...'
                        : generationStage === 'edit'
                          ? 'Aplicando Edições...'
                          : 'Iniciando Geração...'}
                </p>

                {generationStage === 'video' && videoOp && (
                  <div className="mt-4 space-y-2 w-full max-w-[240px]">
                    <div className="flex justify-between text-[10px] font-black text-gray-500 uppercase tracking-widest">
                      <span>Fila: {videoOp.queuedTime || 0}s</span>
                      <span>Render: {videoOp.renderTime || 0}s</span>
                    </div>
                    <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${videoOp.progress}%` }}
                        className="h-full bg-blue-500"
                      />
                    </div>
                    <div className="flex justify-between text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                      <span>Status: {videoOp.displayStatus}</span>
                      <span>
                        {videoOp.lastPoll
                          ? `Atualizado: ${new Date(videoOp.lastPoll).toLocaleTimeString()}`
                          : ''}
                      </span>
                    </div>
                    {videoOp.error && (
                      <p className="text-[9px] text-red-500 font-black uppercase tracking-widest">
                        Erro: {videoOp.error}
                      </p>
                    )}
                    <p className="text-[9px] text-blue-400 font-bold uppercase tracking-widest truncate">
                      ID: {videoOp.id}
                    </p>
                    {videoOp.isStuck && (
                      <p className="text-[9px] text-red-500 font-black uppercase tracking-widest animate-pulse">
                        ⚠️ {videoOp.stuckReason}
                      </p>
                    )}
                  </div>
                )}

                {generationStage === 'video' && (
                  <p className="text-[10px] text-blue-400 font-bold uppercase tracking-widest mt-2">
                    Usando voz e script selecionados para gerar o vídeo
                  </p>
                )}
                {generationStage === 'audio_ready' && audioUrl && (
                  <div className="mt-6 space-y-4 w-full max-w-xs">
                    <div className="p-4 bg-white/10 rounded-2xl border border-white/20">
                      <p className="text-xs font-bold text-white mb-3 uppercase tracking-widest">
                        Ouça a voz gerada:
                      </p>
                      <audio
                        src={audioUrl || undefined}
                        autoPlay
                        controls
                        className="w-full h-8"
                      />
                    </div>
                    <div className="flex gap-2 w-full">
                      <button
                        onClick={() => handleGenerateVideo(true)}
                        className="flex-1 py-4 bg-white/10 text-white rounded-2xl font-bold hover:bg-white/20 transition-all border border-white/20 text-xs uppercase tracking-tighter"
                      >
                        Regerar Voz
                      </button>
                      <button
                        onClick={() => handleGenerateVideo(false)}
                        className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-black shadow-xl hover:bg-blue-700 transition-all text-xs uppercase tracking-tighter"
                      >
                        Gerar Avatar
                      </button>
                    </div>
                  </div>
                )}
                {generationStage === 'video_ready' && videoUrl && (
                  <div className="mt-6 space-y-4 w-full max-w-xs">
                    <div className="flex gap-2 w-full">
                      <button
                        onClick={() => handleGenerateVideo(false)}
                        className="flex-1 py-4 bg-white/10 text-white rounded-2xl font-bold hover:bg-white/20 transition-all border border-white/20 text-xs uppercase tracking-tighter"
                      >
                        Regerar Avatar
                      </button>
                      <button
                        onClick={handleGenerateSubtitles}
                        className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-black shadow-xl hover:bg-blue-700 transition-all text-xs uppercase tracking-tighter"
                      >
                        Legendas e Formato
                      </button>
                    </div>
                  </div>
                )}
                <div className="mt-8 w-full max-w-xs space-y-2 max-h-32 overflow-y-auto pr-2 custom-scrollbar">
                  {logs.map((log, i) => (
                    <p
                      key={`log-item-${i}`}
                      className="text-[10px] text-gray-500 font-mono text-left opacity-60"
                    >
                      {log}
                    </p>
                  ))}
                </div>
              </>
            ) : videoOp?.status === 'failed' ? (
              <div className="text-center space-y-4">
                <AlertCircle size={48} className="text-red-500 mx-auto" />
                <p className="text-red-400 font-bold">Falha na geração do vídeo</p>
                <button
                  onClick={() => handleGenerateVideo()}
                  className="px-6 py-2 bg-red-600 text-white rounded-xl font-bold"
                >
                  Tentar Novamente
                </button>
              </div>
            ) : (
              <div className="text-center space-y-6">
                <div className="w-20 h-20 bg-blue-600/20 text-blue-500 rounded-3xl flex items-center justify-center mx-auto">
                  <Sparkles size={40} />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-black text-white uppercase tracking-tight">
                    Pronto para Gerar?
                  </h3>
                  <p className="text-sm text-gray-400 max-w-xs mx-auto">
                    Clique no botão abaixo para iniciar a geração do vídeo com o avatar e voz
                    selecionados.
                  </p>
                </div>
                <button
                  onClick={() => handleGenerateVideo()}
                  className="px-10 py-4 bg-blue-600 text-white rounded-2xl font-black text-lg hover:bg-blue-700 transition-all shadow-xl shadow-blue-900/40"
                >
                  Gerar Vídeo Final
                </button>
                <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">
                  Custo: 100 Créditos
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 max-w-md mx-auto">
        <button
          onClick={() => handleGenerateVideo()}
          disabled={
            loading || (videoOp && videoOp.status !== 'completed' && videoOp.status !== 'failed')
          }
          className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-blue-700 disabled:opacity-50 transition-all shadow-xl shadow-blue-200"
        >
          {loading ||
          (videoOp && videoOp.status !== 'completed' && videoOp.status !== 'failed') ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Sparkles />
          )}
          {videoUrl ? 'Regerar Vídeo' : `Gerar Vídeo Final`}
        </button>

        {videoUrl && (
          <a
            href={videoUrl}
            download
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-4 bg-gray-900 text-white rounded-2xl font-black flex items-center justify-center gap-3 hover:bg-black transition-all shadow-xl"
          >
            <Download size={20} />
            Baixar Vídeo Final
          </a>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-left">
        <div className="p-4 bg-gray-50 rounded-xl">
          <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">
            Ângulo
          </span>
          <p className="text-sm font-bold text-gray-700 truncate">{config.angle}</p>
        </div>
        <div className="p-4 bg-gray-50 rounded-xl">
          <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">
            Avatar
          </span>
          <p className="text-sm font-bold text-gray-700 truncate">
            {config.avatar.faceId === 'custom'
              ? 'Personalizado'
              : AVATARS.find((a) => a.id === config.avatar.faceId)?.name}
          </p>
        </div>
        <div className="p-4 bg-gray-50 rounded-xl">
          <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">
            Edição
          </span>
          <p className="text-sm font-bold text-gray-700 truncate">
            {config.edit.transition !== 'none' ? 'Com Efeitos' : 'Básica'}
          </p>
        </div>
        <div className="p-4 bg-gray-50 rounded-xl">
          <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">
            Trilha
          </span>
          <p className="text-sm font-bold text-gray-700 truncate">
            {config.edit.backgroundMusic !== 'none' ? 'Ativa' : 'Sem Música'}
          </p>
        </div>
      </div>
    </div>
  );
}
