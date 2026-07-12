import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { X, Star, Copy, Check, User, Mic2, Film, Music, Clapperboard } from 'lucide-react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import type { ProjectVariant } from '@/types/project';
import { getVoiceName } from '@/lib/vozPremiumService';
import { useAvatarFavorites } from '@/hooks/useAvatarFavorites';
import { useVoiceFavorites } from '@/hooks/useVoiceFavorites';

interface Props {
  open: boolean;
  onClose: () => void;
  variant: ProjectVariant;
  /** Catálogo HeyGen já carregado no App — resolve nome/preview do avatar
   *  pra criativos antigos que só salvaram o faceId. */
  heygenAvatars: any[];
}

// "Raio-x" do criativo: mostra voz, avatar, estilo de edição, idioma, duração,
// emoção, ângulo, hook e música usados. Resolve id→nome (avatar pelo catálogo
// em memória; voz por /v1/voices/:id) pra criativos antigos. Permite favoritar
// voz e/ou avatar — reusa os MESMOS favoritos (localStorage) das telas de
// Avatar e Voz, então o que você favorita aqui aparece lá em qualquer
// projeto/subprojeto.
export function CreativeInfoModal({ open, onClose, variant, heygenAvatars }: Props) {
  const trapRef = useFocusTrap<HTMLDivElement>(open);
  const avatarFavs = useAvatarFavorites();
  const voiceFavs = useVoiceFavorites();

  const cfg: any = variant?.config || {};
  const avatarCfg: any = cfg.avatar || {};
  const copyCfg: any = cfg.copy || {};
  const answers: any = copyCfg.answers || {};
  const editCfg: any = cfg.edit || {};
  const formatCfg: any = cfg.format || {};

  // ─── Avatar ───
  const faceId: string = avatarCfg.faceId || '';
  const matchAvatar = faceId ? heygenAvatars.find((a) => a.avatar_id === faceId) : null;
  const avatarName: string = avatarCfg.faceName || matchAvatar?.avatar_name || '';
  const avatarPreview: string = avatarCfg.facePreviewUrl || matchAvatar?.preview_image_url || '';
  const isCustomAvatar = !!avatarCfg.customFaceUrl;

  // ─── Voz ───
  const voiceId: string =
    avatarCfg.voiceId ||
    (Array.isArray(cfg.audios) && cfg.audios.length
      ? cfg.audios[cfg.audios.length - 1]?.voiceId
      : '') ||
    '';
  const [resolvedVoiceName, setResolvedVoiceName] = useState<string>(avatarCfg.voiceName || '');

  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Resolve o nome da voz (quando só temos o id), ao abrir.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    if (!resolvedVoiceName && voiceId) {
      getVoiceName(voiceId).then((name) => {
        if (alive && name) setResolvedVoiceName(name);
      });
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, voiceId]);

  if (!open) return null;

  const avatarFavd = !!faceId && avatarFavs.isFavorite(faceId);
  const voiceFavd = !!voiceId && voiceFavs.isFavorite(voiceId);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(key);
    setTimeout(() => setCopiedId((k) => (k === key ? null : k)), 1500);
  };

  const toggleVoiceFav = () => {
    if (!voiceId) return;
    const wasFav = voiceFavd;
    voiceFavs.toggle({ voice_id: voiceId, name: resolvedVoiceName || voiceId });
    toast.success(
      wasFav ? 'Voz removida dos favoritos' : 'Voz favoritada — aparece na aba de Voz',
    );
  };

  const toggleAvatarFav = () => {
    if (!faceId) return;
    const wasFav = avatarFavd;
    avatarFavs.toggle(faceId);
    toast.success(
      wasFav ? 'Avatar removido dos favoritos' : 'Avatar favoritado — aparece na aba de Avatar',
    );
  };

  // Linha simples label → valor.
  const Row = ({ label, value }: { label: string; value?: string }) =>
    value ? (
      <div className="flex items-start justify-between gap-4 py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 shrink-0 pt-0.5">
          {label}
        </span>
        <span className="text-sm text-gray-800 dark:text-gray-100 text-right whitespace-pre-wrap">
          {value}
        </span>
      </div>
    ) : null;

  const durationStr =
    typeof formatCfg.duration === 'number' && formatCfg.duration > 0
      ? `${formatCfg.duration}s`
      : '';
  const musicLabels: string[] = Array.isArray(editCfg.musicTracks)
    ? editCfg.musicTracks.map((t: any) => t?.label).filter(Boolean)
    : [];
  const awarenessMap: Record<string, string> = {
    '1': 'Inconsciente',
    '2': 'Consciente do problema',
    '3': 'Consciente da solução',
    '4': 'Consciente do produto',
    '5': 'Mais consciente',
  };
  const awareness = answers.awarenessLevel
    ? awarenessMap[String(answers.awarenessLevel)] || String(answers.awarenessLevel)
    : '';

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-md animate-in fade-in duration-150 p-4"
      style={{ zIndex: 99999 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={trapRef}
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-gray-900 rounded-3xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-gray-800 sticky top-0 bg-white dark:bg-gray-900 z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center">
              <Clapperboard size={18} />
            </div>
            <div>
              <h3 className="font-black text-gray-900 dark:text-gray-50 tracking-tight leading-tight">
                Dados do criativo
              </h3>
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
                {variant?.name || 'Subprojeto'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* AVATAR */}
          <div className="rounded-2xl border-2 border-gray-200 dark:border-gray-800 p-4">
            <div className="flex items-center gap-3">
              {avatarPreview ? (
                <img
                  src={avatarPreview}
                  alt={avatarName}
                  className="w-14 h-14 rounded-xl object-cover bg-gray-100 dark:bg-gray-800 shrink-0"
                />
              ) : (
                <div className="w-14 h-14 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                  <User size={24} />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">
                  Avatar
                </p>
                <p className="text-sm font-bold text-gray-900 dark:text-gray-50 truncate">
                  {isCustomAvatar
                    ? 'Avatar personalizado (upload)'
                    : avatarName || (faceId ? 'Avatar (sem nome)' : 'Nenhum avatar')}
                </p>
                {faceId && (
                  <button
                    onClick={() => copyToClipboard(faceId, 'avatar')}
                    className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400"
                    title="Copiar ID do avatar"
                  >
                    {copiedId === 'avatar' ? <Check size={11} /> : <Copy size={11} />}
                    {faceId}
                  </button>
                )}
              </div>
              {faceId && !isCustomAvatar && (
                <button
                  onClick={toggleAvatarFav}
                  className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                    avatarFavd
                      ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 hover:text-amber-600'
                  }`}
                  title={avatarFavd ? 'Remover dos favoritos' : 'Favoritar avatar'}
                >
                  <Star size={13} className={avatarFavd ? 'fill-current' : ''} />
                  {avatarFavd ? 'Salvo' : 'Favoritar'}
                </button>
              )}
            </div>
          </div>

          {/* VOZ */}
          <div className="rounded-2xl border-2 border-gray-200 dark:border-gray-800 p-4">
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-xl bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
                <Mic2 size={24} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">
                  Voz
                </p>
                <p className="text-sm font-bold text-gray-900 dark:text-gray-50 truncate">
                  {resolvedVoiceName || (voiceId ? 'Voz (nome não encontrado)' : 'Nenhuma voz')}
                </p>
                {voiceId && (
                  <button
                    onClick={() => copyToClipboard(voiceId, 'voice')}
                    className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500 hover:text-purple-600 dark:hover:text-purple-400"
                    title="Copiar ID da voz"
                  >
                    {copiedId === 'voice' ? <Check size={11} /> : <Copy size={11} />}
                    {voiceId}
                  </button>
                )}
              </div>
              {voiceId && (
                <button
                  onClick={toggleVoiceFav}
                  className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                    voiceFavd
                      ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 hover:text-amber-600'
                  }`}
                  title={voiceFavd ? 'Remover dos favoritos' : 'Favoritar voz'}
                >
                  <Star size={13} className={voiceFavd ? 'fill-current' : ''} />
                  {voiceFavd ? 'Salvo' : 'Favoritar'}
                </button>
              )}
            </div>
          </div>

          {/* ESTILO / METADADOS */}
          <div className="rounded-2xl border-2 border-gray-200 dark:border-gray-800 p-4">
            <div className="flex items-center gap-2 mb-1">
              <Film size={14} className="text-gray-400 dark:text-gray-500" />
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
                Estilo & estrutura
              </p>
            </div>
            <Row label="Estilo de edição" value={answers.estiloAnuncio} />
            <Row label="Idioma" value={answers.language} />
            <Row label="Duração" value={durationStr} />
            <Row label="Formato" value={formatCfg.aspectRatio} />
            <Row label="Emoção" value={answers.primaryEmotion || answers.emotion} />
            <Row label="Ângulo" value={answers.angleIdea} />
            <Row label="Consciência" value={awareness} />
            <Row label="Narrador" value={answers.narrator} />
          </div>

          {/* MÚSICA */}
          {musicLabels.length > 0 && (
            <div className="rounded-2xl border-2 border-gray-200 dark:border-gray-800 p-4">
              <div className="flex items-center gap-2 mb-1">
                <Music size={14} className="text-gray-400 dark:text-gray-500" />
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
                  Música
                </p>
              </div>
              {musicLabels.map((m, i) => (
                <Row key={i} label={`Faixa ${i + 1}`} value={m} />
              ))}
            </div>
          )}

          {/* HOOK */}
          {copyCfg.hookSelecionado && (
            <div className="rounded-2xl border-2 border-gray-200 dark:border-gray-800 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-1">
                Hook (gancho)
              </p>
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                {copyCfg.hookSelecionado}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
