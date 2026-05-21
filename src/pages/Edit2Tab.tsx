import { toast } from 'react-hot-toast';
import { motion } from 'motion/react';
import {
  Zap,
  Upload,
  Loader2,
  Play,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Check,
  Smile,
  Scan,
  Film,
  RefreshCw,
  Download,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { detectVideoFormatFromUrl } from '../lib/helpers';
import { getAuthorizedUrl } from '../lib/gemini';
import type { AutoEditState, ZapCapTemplate, ZapCapRenderConfig } from '../types/project';

// Edição Inteligente V2 tab — AssemblyAI analysis + ZapCap captioned
// render. Extracted from App.tsx as a pure prop-driven component; all
// state, handlers, and refs live in App.tsx.

interface Props {
  // Source video being edited.
  videoUrl: string | null;
  setVideoUrl: (url: string | null) => void;
  uploadProgress: number;
  userVideos: { url: string; name: string }[];
  platformApiKey: string | null;

  // Auto-edit state machine.
  autoEditState: AutoEditState;
  setAutoEditState: React.Dispatch<React.SetStateAction<AutoEditState>>;
  brollPercent: number;
  setBrollPercent: (v: number) => void;
  recommendedBrollPercent: number;

  // ZapCap render config.
  zapCapTemplates: ZapCapTemplate[];
  zapCapRenderConfig: ZapCapRenderConfig;
  setZapCapRenderConfig: React.Dispatch<React.SetStateAction<ZapCapRenderConfig>>;

  // Upload / render lifecycle.
  loading: boolean;
  isDragging: boolean;
  setIsDragging: (v: boolean) => void;
  isRenderingRef: React.MutableRefObject<boolean>;

  // Handlers (parent-owned).
  handleUploadVideo: (file: File) => void;
  handleStartAutoEdit: () => void;
  handleRenderZapCap: () => void;
  handleApproveAndDownload: (url: string) => void;
  toggleBrollSelection: (id: string) => void;
}

export function Edit2Tab({
  videoUrl,
  setVideoUrl,
  uploadProgress,
  userVideos,
  platformApiKey,
  autoEditState,
  setAutoEditState,
  brollPercent,
  setBrollPercent,
  recommendedBrollPercent,
  zapCapTemplates,
  zapCapRenderConfig,
  setZapCapRenderConfig,
  loading,
  isDragging,
  setIsDragging,
  isRenderingRef,
  handleUploadVideo,
  handleStartAutoEdit,
  handleRenderZapCap,
  handleApproveAndDownload,
  toggleBrollSelection,
}: Props) {
  const isAnalyzed =
    autoEditState.status === 'analyzed' ||
    autoEditState.status === 'rendering' ||
    autoEditState.status === 'completed';
  const isCompleted = autoEditState.status === 'completed';

  return (
    <div className="max-w-[1200px] mx-auto p-6 space-y-10">
      {/* Header Section */}
      <div className="bg-white p-10 rounded-[48px] border-4 border-gray-50 shadow-2xl space-y-4">
        <div className="flex items-center gap-6">
          <div className="w-20 h-20 bg-blue-600 rounded-[28px] flex items-center justify-center text-white shadow-xl shadow-blue-100">
            <Zap size={40} className="fill-current" />
          </div>
          <div>
            <h2 className="text-4xl font-black text-gray-900 tracking-tighter uppercase italic">
              Edição Inteligente <span className="text-blue-600">V2</span>
            </h2>
            <p className="text-gray-400 font-bold uppercase text-[10px] tracking-[0.3em]">
              Análise Neural + Legendas Animadas + B-Roll + Zooms
            </p>
          </div>
        </div>
      </div>

      {/* PARTE 1 — Interface de Upload */}
      <div className="bg-white p-10 rounded-[48px] border-4 border-gray-50 shadow-2xl space-y-8 animate-in fade-in zoom-in duration-500">
        <div className="flex flex-col items-center text-center gap-4">
          <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center">
            <Upload size={32} />
          </div>
          <div>
            <h3 className="text-2xl font-black text-gray-900 uppercase italic tracking-tighter">
              Primeiro, vamos carregar seu vídeo
            </h3>
            <p className="text-gray-400 font-bold uppercase text-[10px] tracking-widest">
              Siga as instruções abaixo para iniciar a edição inteligente.
            </p>
          </div>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleUploadVideo(file);
          }}
          onClick={() => {
            if (autoEditState.status === 'uploading') return;
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'video/mp4,video/quicktime,video/x-msvideo,video/webm';
            input.onchange = (e) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (file) handleUploadVideo(file);
            };
            input.click();
          }}
          className={cn(
            'relative border-4 border-dashed rounded-[32px] p-12 transition-all cursor-pointer flex flex-col items-center gap-6',
            isDragging
              ? 'border-blue-600 bg-blue-50 scale-[0.98]'
              : 'border-gray-100 hover:border-blue-200 hover:bg-gray-50',
            autoEditState.status === 'uploading' && 'pointer-events-none opacity-50'
          )}
        >
          <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-lg text-blue-600">
            {autoEditState.status === 'uploading' ? (
              <Loader2 className="animate-spin" size={40} />
            ) : (
              <Upload size={40} />
            )}
          </div>

          <div className="text-center space-y-2">
            <p className="text-lg font-black text-gray-900 uppercase italic">
              {autoEditState.status === 'uploading'
                ? `Carregando... ${Math.round(uploadProgress)}%`
                : 'Arraste seu vídeo aqui ou clique para selecionar'}
            </p>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
              MP4, MOV, AVI, WEBM • Máximo 3 minutos
            </p>
          </div>

          {autoEditState.status === 'uploading' && (
            <div className="w-full max-w-md h-3 bg-gray-100 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${uploadProgress}%` }}
                className="h-full bg-blue-600 shadow-lg shadow-blue-200"
              />
            </div>
          )}
          {autoEditState.compressing && (
            <div className="flex flex-col items-center gap-2">
              <span className="text-[10px] font-black text-blue-600 uppercase animate-pulse">
                Otimizando vídeo... ⚡
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-4 text-gray-300">
          <div className="flex-1 h-px bg-gray-100" />
          <span className="text-[10px] font-black uppercase tracking-[0.5em]">OU</span>
          <div className="flex-1 h-px bg-gray-100" />
        </div>

        <div className="space-y-4">
          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block text-center">
            Escolha um vídeo já carregado
          </label>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {userVideos.length > 0 ? (
              userVideos.map((video, idx) => {
                const isSelected = autoEditState.originalVideoUrl === video.url;
                return (
                  <button
                    key={`user-bib-video-${idx}-${video.url || 'no-url'}`}
                    onClick={async () => {
                      setVideoUrl(video.url);
                      const format = await detectVideoFormatFromUrl(video.url);
                      setAutoEditState((prev) => ({
                        ...prev,
                        originalVideoUrl: video.url,
                        videoFormat: format,
                      }));
                      toast.success(`Vídeo selecionado! Formato: ${format}`);
                    }}
                    className={cn(
                      'relative rounded-2xl overflow-hidden border-2 transition-all text-left group flex flex-col',
                      isSelected
                        ? 'border-blue-600 shadow-lg shadow-blue-100 ring-2 ring-blue-400 ring-offset-2'
                        : 'border-gray-100 hover:border-blue-300 hover:shadow-md'
                    )}
                  >
                    {/* Thumbnail */}
                    <div className="relative w-full aspect-video bg-black">
                      <video
                        src={video.url}
                        className="w-full h-full object-cover"
                        muted
                        playsInline
                        preload="metadata"
                      />
                      {/* Play overlay on hover */}
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
                        <Play size={24} className="text-white fill-white" />
                      </div>
                      {/* Selected badge */}
                      {isSelected && (
                        <div className="absolute top-2 right-2 bg-blue-600 text-white rounded-full p-1 shadow-lg">
                          <CheckCircle2 size={14} />
                        </div>
                      )}
                      {/* "Em uso" label */}
                      {isSelected && (
                        <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-blue-600 text-white text-[8px] font-black rounded uppercase tracking-widest">
                          Em uso
                        </div>
                      )}
                    </div>
                    {/* Info */}
                    <div className="p-2 bg-white">
                      <p className="font-black text-gray-900 truncate text-[10px] uppercase italic">
                        {video.name}
                      </p>
                    </div>
                  </button>
                );
              })
            ) : (
              <p className="col-span-full text-center py-8 text-gray-400 text-xs font-bold uppercase tracking-widest italic border-2 border-dashed border-gray-100 rounded-2xl">
                Nenhum vídeo encontrado na biblioteca
              </p>
            )}
          </div>
        </div>
      </div>

      {autoEditState.originalVideoUrl && (
        <div className="bg-green-50 p-6 rounded-[32px] border-2 border-green-100 flex items-center justify-between gap-6 animate-in fade-in slide-in-from-top-4 duration-500">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-green-600 text-white rounded-2xl">
              <CheckCircle2 size={24} />
            </div>
            <div>
              <h4 className="font-black text-green-900 text-sm">
                ✅ Vídeo carregado com sucesso
              </h4>
              <p className="text-[10px] font-bold text-green-600 uppercase tracking-widest">
                Formato detectado:{' '}
                {autoEditState.videoFormat === '9:16'
                  ? 'Vertical 9:16'
                  : autoEditState.videoFormat === '16:9'
                    ? 'Horizontal 16:9'
                    : 'Quadrado 1:1'}
              </p>
            </div>
          </div>
          <button
            onClick={() =>
              setAutoEditState((prev) => ({
                ...prev,
                originalVideoUrl: undefined,
              }))
            }
            className="px-4 py-2 bg-white text-gray-400 hover:text-red-600 border border-gray-200 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
          >
            Trocar Vídeo
          </button>
        </div>
      )}

      {isCompleted ? (
        <div className="space-y-10">
          {/* Gallery of Versions */}
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-black text-gray-900 uppercase italic">
                Galeria de Versões
              </h3>
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                Role para o lado
              </span>
            </div>
            <div className="flex gap-6 overflow-x-auto pb-6 no-scrollbar snap-x">
              {/* Original */}
              <div
                className={cn(
                  'space-y-4 snap-start',
                  autoEditState.videoFormat === '16:9'
                    ? 'min-w-[320px] max-w-[320px]'
                    : 'min-w-[240px] max-w-[240px]'
                )}
              >
                <div
                  className={cn(
                    'relative bg-black rounded-[32px] overflow-hidden shadow-2xl border-4 border-gray-100',
                    autoEditState.videoFormat === '16:9'
                      ? 'aspect-video'
                      : autoEditState.videoFormat === '1:1'
                        ? 'aspect-square'
                        : 'aspect-[9/16]'
                  )}
                >
                  <video
                    src={
                      getAuthorizedUrl(
                        autoEditState.originalVideoUrl || '',
                        platformApiKey || undefined
                      ) || undefined
                    }
                    className="w-full h-full object-contain"
                    style={{ objectFit: 'contain', backgroundColor: '#000' }}
                    crossOrigin="anonymous"
                  />
                  <div className="absolute top-4 left-4 bg-gray-900 text-white text-[8px] font-black px-2 py-0.5 rounded uppercase tracking-widest">
                    Original
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => handleApproveAndDownload(autoEditState.originalVideoUrl || '')}
                    className="w-full py-3 bg-gray-100 text-gray-900 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-gray-200 flex items-center justify-center gap-2"
                  >
                    <Download size={12} />
                    Baixar
                  </button>
                </div>
              </div>

              {/* Versions */}
              {(autoEditState.versions || []).map((vUrl, idx) => (
                <div
                  key={`edit-version-${idx}-${vUrl || 'no-url'}`}
                  className={cn(
                    'space-y-4 snap-start',
                    autoEditState.videoFormat === '16:9'
                      ? 'min-w-[320px] max-w-[320px]'
                      : 'min-w-[240px] max-w-[240px]'
                  )}
                >
                  <div
                    className={cn(
                      'relative bg-black rounded-[32px] overflow-hidden shadow-2xl border-4 border-blue-100 ring-8 ring-blue-50/50',
                      autoEditState.videoFormat === '16:9'
                        ? 'aspect-video'
                        : autoEditState.videoFormat === '1:1'
                          ? 'aspect-square'
                          : 'aspect-[9/16]'
                    )}
                  >
                    <video
                      src={getAuthorizedUrl(vUrl || '', platformApiKey || undefined) || undefined}
                      className="w-full h-full object-contain"
                      style={{
                        objectFit: 'contain',
                        backgroundColor: '#000',
                      }}
                      crossOrigin="anonymous"
                      controls
                    />
                    <div className="absolute top-4 left-4 bg-blue-600 text-white text-[8px] font-black px-2 py-0.5 rounded uppercase tracking-widest">
                      v{idx + 1}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => handleApproveAndDownload(vUrl)}
                      className="w-full py-3 bg-blue-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 flex items-center justify-center gap-2 shadow-lg shadow-blue-100"
                    >
                      <Download size={12} />
                      Baixar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Re-render Option */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white p-10 rounded-[48px] border-4 border-gray-50 shadow-2xl flex flex-col items-center text-center gap-6"
          >
            <div className="space-y-2">
              <h3 className="text-2xl font-black text-gray-900 uppercase italic tracking-tighter">
                Deseja criar outra versão?
              </h3>
              <p className="text-gray-400 font-bold uppercase text-[10px] tracking-widest">
                Altere o template ou densidade de b-roll e gere uma nova variação.
              </p>
            </div>

            <button
              onClick={() => setAutoEditState((prev) => ({ ...prev, status: 'analyzed' }))}
              className="px-12 py-5 bg-gray-900 text-white rounded-[24px] font-black uppercase text-xs tracking-[0.2em] hover:bg-black transition-all flex items-center justify-center gap-3 active:scale-95 shadow-xl"
            >
              <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
              Configurar Nova Versão
            </button>
          </motion.div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Column: Preview and Controls */}
          <div className="lg:col-span-4 space-y-8">
            <div className="bg-gray-900 p-4 rounded-[40px] shadow-2xl relative group overflow-hidden border-8 border-gray-800">
              <div
                className={cn(
                  'relative rounded-[32px] overflow-hidden bg-black w-full',
                  autoEditState.videoFormat === '16:9'
                    ? 'aspect-video'
                    : autoEditState.videoFormat === '1:1'
                      ? 'aspect-square'
                      : 'aspect-[9/16]'
                )}
              >
                <video
                  src={getAuthorizedUrl(videoUrl || '', platformApiKey || undefined) || undefined}
                  controls
                  className="w-full h-full object-contain"
                  crossOrigin="anonymous"
                />
              </div>
              <div className="mt-4 flex items-center justify-between px-4">
                <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                  Preview
                </p>
                <div className="flex gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-[10px] font-black text-green-500 uppercase">Live</span>
                </div>
              </div>
            </div>

            {/* Actions */}
            {!isAnalyzed ? (
              <button
                onClick={handleStartAutoEdit}
                disabled={loading || !videoUrl}
                className="w-full py-8 bg-blue-600 text-white rounded-[32px] font-black uppercase text-lg tracking-widest hover:bg-blue-700 transition-all shadow-2xl shadow-blue-200 active:scale-95 disabled:opacity-50 flex flex-col items-center gap-3"
              >
                {loading ? <Loader2 className="animate-spin" size={32} /> : <Scan size={32} />}
                <span>Analisar com AssemblyAI</span>
                <span className="text-[10px] font-bold opacity-60 normal-case">
                  Sentimentos • Capítulos • Momentos
                </span>
              </button>
            ) : (
              <div className="space-y-4">
                <div className="p-6 bg-green-50 border-2 border-green-100 rounded-[32px] flex items-center gap-4">
                  <div className="p-3 bg-green-600 text-white rounded-2xl">
                    <CheckCircle2 size={24} />
                  </div>
                  <div>
                    <h4 className="font-black text-green-900 border-none p-0 text-sm">
                      Análise Pronta
                    </h4>
                    <p className="text-[10px] font-bold text-green-600 uppercase">
                      100% Processado
                    </p>
                  </div>
                </div>

                <button
                  onClick={() =>
                    setAutoEditState({
                      status: 'idle',
                      step: '',
                      progress: 0,
                      brollCandidates: [],
                      selectedBrollIds: [],
                      versions: [],
                    })
                  }
                  className="w-full py-4 text-gray-400 font-black uppercase text-[10px] tracking-widest hover:text-gray-600"
                >
                  Reiniciar Edição
                </button>
              </div>
            )}
          </div>

          {/* Right Column: Configuration and Results */}
          <div className="lg:col-span-8 space-y-8">
            {autoEditState.status === 'analyzing' || autoEditState.status === 'rendering' ? (
              <div className="bg-white p-16 rounded-[48px] border-4 border-gray-50 shadow-2xl flex flex-col items-center justify-center text-center gap-8">
                <div className="relative">
                  <div className="w-32 h-32 rounded-full border-8 border-blue-50 border-t-blue-600 animate-spin" />
                  <div className="absolute inset-0 flex items-center justify-center text-blue-600">
                    <Zap size={40} className="animate-pulse" />
                  </div>
                </div>
                <div className="space-y-4">
                  <h3 className="text-3xl font-black text-gray-900 uppercase italic tracking-tighter">
                    {autoEditState.status === 'analyzing'
                      ? 'IA Analisando...'
                      : 'IA Renderizando...'}
                  </h3>
                  <div className="flex flex-col items-center gap-2">
                    <p className="text-gray-400 font-bold uppercase tracking-widest text-xs max-w-md">
                      {autoEditState.step}
                    </p>
                    <span className="text-blue-600 font-black text-2xl">
                      {Math.round(autoEditState.progress)}%
                    </span>
                  </div>
                </div>
                <div className="w-full max-w-sm h-4 bg-gray-100 rounded-full overflow-hidden border-2 border-gray-50">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${autoEditState.progress}%` }}
                    className="h-full bg-blue-600 shadow-[0_0_20px_rgba(37,99,235,0.5)] transition-all duration-500"
                  />
                </div>
              </div>
            ) : autoEditState.status === 'error' ? (
              <div className="bg-white p-16 rounded-[48px] border-4 border-red-50 shadow-2xl flex flex-col items-center justify-center text-center gap-8">
                <div className="w-24 h-24 bg-red-100 rounded-full flex items-center justify-center text-red-600">
                  <AlertCircle size={48} />
                </div>
                <div className="space-y-4">
                  <h3 className="text-3xl font-black text-gray-900 uppercase italic tracking-tighter">
                    Ops! Algo deu errado
                  </h3>
                  <p className="text-red-500 font-bold uppercase tracking-widest text-xs px-10">
                    {autoEditState.step}
                  </p>
                </div>
                <button
                  onClick={() =>
                    setAutoEditState((prev) => ({
                      ...prev,
                      status: 'analyzed',
                      step: '',
                      progress: 0,
                    }))
                  }
                  className="px-10 py-4 bg-gray-900 text-white rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-black transition-all"
                >
                  Tentar Novamente
                </button>
              </div>
            ) : autoEditState.status === 'analyzed' ? (
              <div className="bg-white p-8 rounded-[48px] border-4 border-gray-50 shadow-2xl space-y-12">
                {/* ETAPA 1: B-Roll Mode */}
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-[10px] font-black">
                          1
                        </span>
                        <h3 className="text-xl font-black text-gray-900 uppercase italic">
                          Ilustrações B-Roll
                        </h3>
                      </div>
                    </div>
                    <div className="flex bg-gray-100 p-1.5 rounded-2xl">
                      <button
                        onClick={() =>
                          setAutoEditState((prev) => ({
                            ...prev,
                            editMode: 'auto',
                          }))
                        }
                        className={cn(
                          'px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all',
                          autoEditState.editMode === 'auto'
                            ? 'bg-white text-blue-600 shadow-lg'
                            : 'text-gray-400 hover:text-gray-600'
                        )}
                      >
                        Modo Automático
                      </button>
                      <button
                        onClick={() =>
                          setAutoEditState((prev) => ({
                            ...prev,
                            editMode: 'manual',
                          }))
                        }
                        className={cn(
                          'px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all',
                          autoEditState.editMode === 'manual'
                            ? 'bg-white text-blue-600 shadow-lg'
                            : 'text-gray-400 hover:text-gray-600'
                        )}
                      >
                        Modo Manual
                      </button>
                    </div>
                  </div>

                  {autoEditState.editMode === 'auto' ? (
                    <div className="p-8 bg-blue-50/50 border-2 border-dashed border-blue-100 rounded-[32px] flex flex-col items-center justify-center gap-3 text-center">
                      <Sparkles className="text-blue-600" size={32} />
                      <div>
                        <p className="text-sm font-black text-blue-900 uppercase">
                          ⭐ IA selecionou os melhores momentos
                        </p>
                        <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest">
                          Encontramos {(autoEditState.selectedBrollIds || []).length} cenas ideais
                          para ilustrar seu áudio
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 animate-in fade-in slide-in-from-top-2">
                      {autoEditState.brollCandidates.map((candidate) => {
                        const isSelected = autoEditState.selectedBrollIds.includes(candidate.id);
                        return (
                          <button
                            key={candidate.id}
                            onClick={() => toggleBrollSelection(candidate.id)}
                            className={cn(
                              'flex flex-col p-4 rounded-2xl border-2 transition-all text-left relative group',
                              isSelected
                                ? 'bg-blue-50 border-blue-600 shadow-sm'
                                : 'bg-white border-gray-100 hover:border-gray-200'
                            )}
                          >
                            <div className="flex justify-between items-start mb-2">
                              <span className="text-[10px] font-black text-gray-400">
                                Tempo: {(candidate.start / 1000).toFixed(1)}s
                              </span>
                              <span
                                className={cn(
                                  'text-[8px] font-black px-1.5 py-0.5 rounded uppercase',
                                  candidate.rank >= 0.7
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-gray-100 text-gray-500'
                                )}
                              >
                                {Math.round(candidate.rank * 100)}%
                              </span>
                            </div>
                            <p className="text-[11px] font-bold text-gray-800 line-clamp-2 italic leading-tight">
                              "{candidate.text}"
                            </p>
                            {isSelected && (
                              <div className="absolute top-2 right-2 p-1 bg-blue-600 text-white rounded-full">
                                <Check size={10} />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* ETAPA 2: Template Selection */}
                <div className="space-y-6 pt-6 border-t border-gray-100">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-[10px] font-black">
                      2
                    </span>
                    <h3 className="text-xl font-black text-gray-900 uppercase italic">
                      Estilo da Legenda
                    </h3>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {zapCapTemplates.map((template) => (
                      <button
                        key={template.id}
                        onClick={() =>
                          setZapCapRenderConfig((prev) => ({
                            ...prev,
                            templateId: template.id,
                          }))
                        }
                        className={cn(
                          'relative aspect-video rounded-2xl border-4 transition-all overflow-hidden group',
                          zapCapRenderConfig.templateId === template.id
                            ? 'border-blue-600 scale-95 shadow-inner'
                            : 'border-gray-50 hover:border-blue-100'
                        )}
                      >
                        <video
                          src={template.previewUrl || template.previews?.previewMp4 || undefined}
                          autoPlay
                          loop
                          muted
                          playsInline
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity p-4 text-center">
                          <p className="text-white font-black text-[10px] uppercase tracking-widest">
                            {template.name}
                          </p>
                        </div>
                        {zapCapRenderConfig.templateId === template.id && (
                          <div className="absolute inset-0 bg-blue-600/20 flex items-center justify-center">
                            <div className="bg-white text-blue-600 p-2 rounded-full shadow-2xl">
                              <Check size={24} />
                            </div>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* ETAPA 3: Visual Adjustments */}
                <div className="space-y-6 pt-6 border-t border-gray-100">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-[10px] font-black">
                      3
                    </span>
                    <h3 className="text-xl font-black text-gray-900 uppercase italic">
                      Ajustes Visuais
                    </h3>
                  </div>
                  <div className="flex gap-4">
                    <button
                      onClick={() =>
                        setZapCapRenderConfig((prev) => ({
                          ...prev,
                          animation: !prev.animation,
                        }))
                      }
                      className={cn(
                        'flex-1 py-5 rounded-[24px] border-2 transition-all flex flex-col items-center gap-2 group',
                        zapCapRenderConfig.animation
                          ? 'bg-gray-900 border-gray-900 text-white'
                          : 'bg-white border-gray-100 text-gray-400'
                      )}
                    >
                      <Zap
                        size={24}
                        className={
                          zapCapRenderConfig.animation
                            ? 'text-yellow-400 fill-yellow-400'
                            : 'text-gray-300'
                        }
                      />
                      <span className="text-[10px] font-black uppercase tracking-widest">
                        Animação
                      </span>
                    </button>
                    <button
                      onClick={() =>
                        setZapCapRenderConfig((prev) => ({
                          ...prev,
                          emoji: !prev.emoji,
                        }))
                      }
                      className={cn(
                        'flex-1 py-5 rounded-[24px] border-2 transition-all flex flex-col items-center gap-2 group',
                        zapCapRenderConfig.emoji
                          ? 'bg-gray-900 border-gray-900 text-white'
                          : 'bg-white border-gray-100 text-gray-400'
                      )}
                    >
                      <Smile
                        size={24}
                        className={zapCapRenderConfig.emoji ? 'text-blue-400' : 'text-gray-300'}
                      />
                      <span className="text-[10px] font-black uppercase tracking-widest">
                        Emojis
                      </span>
                    </button>
                  </div>
                </div>

                {/* ETAPA 4: Density Slider */}
                <div className="space-y-6 pt-6 border-t border-gray-100">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-[10px] font-black">
                      4
                    </span>
                    <h3 className="text-xl font-black text-gray-900 uppercase italic">
                      Frequência de B-Roll
                    </h3>
                  </div>

                  <div className="p-8 bg-gray-50 rounded-[32px] border border-gray-100 space-y-6">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                        Densidade
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-2xl font-black text-blue-600">{brollPercent}%</span>
                        {brollPercent === recommendedBrollPercent && (
                          <span className="text-[8px] bg-blue-600 text-white px-2 py-0.5 rounded-full font-black uppercase">
                            Fiel ao áudio
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="relative pt-4">
                      <input
                        type="range"
                        min={20}
                        max={70}
                        value={brollPercent}
                        onChange={(e) => setBrollPercent(Number(e.target.value))}
                        className="w-full h-3 bg-gray-200 rounded-full appearance-none cursor-pointer accent-blue-600"
                      />
                      <div className="flex justify-between mt-3 px-1">
                        <span className="text-[10px] font-black text-gray-400 uppercase">
                          20%
                        </span>
                        <div className="flex flex-col items-center">
                          <div className="w-1 h-1 bg-blue-600 rounded-full mb-1" />
                          <span className="text-[10px] font-black text-blue-600 uppercase">
                            ⭐ {recommendedBrollPercent}% recomendado
                          </span>
                        </div>
                        <span className="text-[10px] font-black text-gray-400 uppercase">
                          70%
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ETAPA 5: Render Button */}
                <div className="pt-6 border-t border-gray-100">
                  <button
                    onClick={handleRenderZapCap}
                    disabled={loading || isRenderingRef.current || !zapCapRenderConfig.templateId}
                    className="w-full py-8 bg-blue-600 text-white rounded-[32px] font-black uppercase text-xl tracking-[0.2em] hover:bg-blue-700 transition-all shadow-2xl flex items-center justify-center gap-4 active:scale-95 disabled:opacity-50"
                  >
                    {loading ? (
                      <Loader2 className="animate-spin" size={24} />
                    ) : (
                      <Film size={24} />
                    )}
                    Renderizar Nova Versão
                  </button>
                  <p className="text-center mt-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                    O processo leva de 1 a 3 minutos
                  </p>
                </div>
              </div>
            ) : (
              <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-center opacity-30 gap-6">
                <Scan size={80} className="text-gray-200" />
                <div>
                  <h3 className="text-2xl font-black text-gray-300 uppercase">
                    Aguardando Análise
                  </h3>
                  <p className="text-sm font-bold text-gray-300 uppercase">
                    Inicie o processamento com AssemblyAI no painel lateral
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
