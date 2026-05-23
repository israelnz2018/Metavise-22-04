import { motion, AnimatePresence } from 'motion/react';
import { X, Monitor, Smartphone, Square, Scan, Info, CheckCircle2, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// Full-screen avatar inspect dialog. Hosts:
//   - large preview image (16:9 / 9:16 / cropped 1:1)
//   - Output Format picker (original vs 1:1 square)
//   - cropOffset slider when in 1:1 mode
//   - select / deselect button
//
// All state is owned by App.tsx — this component is purely controlled.
type AvatarFormat = 'original' | 'square';

interface PreviewAvatar {
  avatar_id: string;
  avatar_name: string;
  avatar_type?: string;
  aspect_ratio?: string;
  preview_image_url?: string;
}

interface Props {
  avatar: PreviewAvatar | null;
  selectedFaceId: string;
  avatarFormat: AvatarFormat | undefined;
  cropOffset: number;
  aspectRatio: '9:16' | '1:1' | '16:9';
  onClose: () => void;
  onFormatChange: (format: AvatarFormat, nextAspectRatio: '9:16' | '1:1' | '16:9') => void;
  onCropOffsetChange: (offset: number) => void;
  onToggleSelected: () => void;
}

export function AvatarPreviewModal({
  avatar,
  selectedFaceId,
  avatarFormat,
  cropOffset,
  aspectRatio,
  onClose,
  onFormatChange,
  onCropOffsetChange,
  onToggleSelected,
}: Props) {
  return (
    <AnimatePresence>
      {avatar && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-xl"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 40 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 40 }}
            className="bg-white rounded-[40px] max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col md:flex-row shadow-2xl relative z-20"
          >
            <button
              onClick={onClose}
              className="absolute top-6 right-6 z-10 p-3 bg-white/10 hover:bg-white/20 text-white rounded-2xl backdrop-blur-md transition-all md:text-gray-900 md:bg-gray-100 md:hover:bg-gray-200"
            >
              <X size={24} />
            </button>

            <PreviewArea
              avatar={avatar}
              avatarFormat={avatarFormat}
              cropOffset={cropOffset}
              aspectRatio={aspectRatio}
            />
            <Controls
              avatar={avatar}
              selectedFaceId={selectedFaceId}
              avatarFormat={avatarFormat}
              cropOffset={cropOffset}
              onClose={onClose}
              onFormatChange={onFormatChange}
              onCropOffsetChange={onCropOffsetChange}
              onToggleSelected={onToggleSelected}
            />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function PreviewArea({
  avatar,
  avatarFormat,
  cropOffset,
  aspectRatio,
}: {
  avatar: PreviewAvatar;
  avatarFormat: AvatarFormat | undefined;
  cropOffset: number;
  aspectRatio: '9:16' | '1:1' | '16:9';
}) {
  // Default to horizontal (16:9) as HeyGen metadata is unreliable.
  const isHorizontal = avatar.aspect_ratio !== '9:16';
  const isSquare = avatarFormat === 'square';

  return (
    <div className="flex-1 bg-gray-950 flex items-center justify-center p-8 relative overflow-hidden group">
      <div className="absolute inset-0 opacity-20 pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:20px_20px]" />
      </div>

      <div
        className={cn(
          'relative transition-all duration-700 shadow-2xl rounded-2xl overflow-hidden ring-1 ring-white/10',
          isSquare
            ? 'aspect-square h-[80%] max-w-full'
            : isHorizontal
              ? 'aspect-video w-[90%] max-h-[80%]'
              : 'aspect-[9/16] h-[90%] max-w-full'
        )}
      >
        <p className="w-full h-full transition-all duration-1000 ease-in-out">
          <img
            src={avatar.preview_image_url || undefined}
            className={cn(
              'w-full h-full transition-all duration-500 ease-in-out',
              isSquare ? 'object-cover' : 'object-contain'
            )}
            style={
              isSquare
                ? {
                    objectPosition:
                      aspectRatio === '9:16' || aspectRatio === '1:1'
                        ? `${50 + cropOffset}% 50%`
                        : `50% ${50 + cropOffset}%`,
                  }
                : undefined
            }
            referrerPolicy="no-referrer"
            alt={avatar.avatar_name}
          />
        </p>

        <div className="absolute inset-0 pointer-events-none border-2 border-blue-500/0 group-hover:border-blue-500/20 transition-all duration-500" />

        <div className="absolute top-4 left-4 flex flex-col gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-black/60 backdrop-blur-md text-white rounded-xl text-[10px] font-black uppercase tracking-widest border border-white/10">
            {isHorizontal ? (
              <>
                <Monitor size={12} className="text-blue-400" />
                Horizontal (16:9)
              </>
            ) : (
              <>
                <Smartphone size={12} className="text-purple-400" />
                Vertical (9:16)
              </>
            )}
          </div>
          {isSquare && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-600/60 backdrop-blur-md text-white rounded-xl text-[10px] font-black uppercase tracking-widest border border-blue-400/20 animate-pulse">
              <Square size={12} />
              Adaptado para Quadrado
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Controls({
  avatar,
  selectedFaceId,
  avatarFormat,
  cropOffset,
  onClose,
  onFormatChange,
  onCropOffsetChange,
  onToggleSelected,
}: {
  avatar: PreviewAvatar;
  selectedFaceId: string;
  avatarFormat: AvatarFormat | undefined;
  cropOffset: number;
  onClose: () => void;
  onFormatChange: (format: AvatarFormat, nextAspectRatio: '9:16' | '1:1' | '16:9') => void;
  onCropOffsetChange: (offset: number) => void;
  onToggleSelected: () => void;
}) {
  const isHorizontal = avatar.aspect_ratio !== '9:16';
  const isSelected = selectedFaceId === avatar.avatar_id;
  const isSquare = avatarFormat === 'square';

  return (
    <div className="w-full md:w-[400px] p-10 flex flex-col justify-between bg-white border-l border-gray-100 overflow-y-auto">
      <div className="space-y-10">
        <div className="space-y-4">
          <div className="flex items-center gap-2 px-3 py-1 bg-gray-100 rounded-lg w-fit">
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              Avatar ID: {avatar.avatar_id}
            </span>
          </div>
          <h3 className="text-4xl font-black text-gray-900 tracking-tight leading-tight">
            {avatar.avatar_name}
          </h3>
          <p className="text-gray-500 font-medium leading-relaxed">
            Ideal para{' '}
            {avatar.avatar_type === 'realistic'
              ? 'anúncios de alta conversão'
              : 'conteúdos naturais e autênticos'}
            .
          </p>
        </div>

        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
              Output Format
            </h4>
            <span className="text-[10px] font-bold text-blue-600 uppercase">
              Ajuste de Composição
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {FORMAT_OPTIONS.map((opt) => {
              const active = avatarFormat === opt.id || (!avatarFormat && opt.id === 'original');
              return (
                <button
                  key={opt.id}
                  onClick={() => {
                    const nextRatio: '9:16' | '1:1' | '16:9' =
                      opt.id === 'original' ? (isHorizontal ? '16:9' : '9:16') : '1:1';
                    onFormatChange(opt.id, nextRatio);
                  }}
                  className={cn(
                    'p-3 rounded-[20px] border-2 text-left transition-all group/opt relative overflow-hidden',
                    active
                      ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-sm'
                      : 'border-gray-100 text-gray-500 hover:border-gray-200 hover:bg-gray-50'
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <opt.icon
                      size={14}
                      className="opacity-60 group-hover/opt:opacity-100 transition-opacity"
                    />
                    <p className="font-black text-xs leading-none">{opt.label}</p>
                  </div>
                  <p className="text-[8px] font-bold opacity-60 uppercase tracking-widest">
                    {opt.desc}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="p-6 bg-amber-50 rounded-3xl border border-amber-100 space-y-4">
          <div className="flex items-center gap-2 text-amber-900">
            <Info size={16} />
            <h5 className="font-black text-xs uppercase tracking-tight">
              Enquadramento Inteligente
            </h5>
          </div>

          {isSquare && (
            <div className="space-y-4 pt-2">
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-black text-amber-900 uppercase tracking-widest">
                    {isHorizontal ? 'Posição Horizontal' : 'Posição Vertical'}
                  </label>
                  <button
                    onClick={() => onCropOffsetChange(0)}
                    className="text-[9px] font-black text-amber-600 bg-amber-100/50 px-2 py-1 rounded hover:bg-amber-100 transition-colors uppercase"
                  >
                    Resetar para o Centro
                  </button>
                </div>
                <input
                  type="range"
                  min="-50"
                  max="50"
                  step="1"
                  value={cropOffset}
                  onChange={(e) => onCropOffsetChange(parseInt(e.target.value))}
                  className="w-full h-2 bg-amber-200 rounded-lg appearance-none cursor-pointer accent-amber-600"
                />
                <div className="flex justify-between text-[8px] text-amber-600/60 font-black uppercase tracking-tighter">
                  <span>{isHorizontal ? 'Esquerda' : 'Topo'}</span>
                  <span>Centro (IA)</span>
                  <span>{isHorizontal ? 'Direita' : 'Base'}</span>
                </div>
              </div>
            </div>
          )}

          <p className="text-[11px] text-amber-700 font-medium leading-relaxed">
            {isSquare
              ? 'Use o controle acima para ajustar o foco manualmente. O IA centraliza no sujeito por padrão.'
              : 'Ao selecionar **Square**, o enquadramento é ajustado para formato quadrado preservando a altura ou largura original do sujeito conforme a orientação nativa.'}
          </p>
        </div>
      </div>

      <div className="pt-10 space-y-4">
        <button
          onClick={onToggleSelected}
          className={cn(
            'w-full py-6 rounded-[24px] font-black uppercase tracking-[0.2em] text-xs transition-all flex items-center justify-center gap-3 active:scale-95',
            isSelected
              ? 'bg-red-50 text-red-600 border-2 border-red-100 hover:bg-red-100'
              : 'bg-blue-600 text-white shadow-2xl shadow-blue-100 hover:bg-blue-700'
          )}
        >
          {isSelected ? (
            <>
              <Trash2 size={18} />
              Desmarcar Avatar
            </>
          ) : (
            <>
              <CheckCircle2 size={18} />
              Escolher este Avatar
            </>
          )}
        </button>
        <button
          onClick={onClose}
          className="w-full py-4 text-gray-400 font-black uppercase tracking-widest text-[10px] hover:text-gray-900 transition-all"
        >
          Voltar para Galeria
        </button>
      </div>
    </div>
  );
}

const FORMAT_OPTIONS: {
  id: AvatarFormat;
  label: string;
  desc: string;
  icon: typeof Scan;
}[] = [
  { id: 'original', label: 'Original', desc: 'Nativo', icon: Scan },
  { id: 'square', label: '1:1', desc: 'Square', icon: Square },
];
