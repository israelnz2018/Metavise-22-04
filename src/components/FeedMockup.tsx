import { useState } from 'react';
import { Heart, MessageCircle, Send, Bookmark, MoreHorizontal, ThumbsUp, X } from 'lucide-react';

// MOCKUP DE FEED: mostra o criativo dentro da "cara" do Instagram ou do Facebook,
// pra ver como fica no feed antes de publicar. Só visual (nenhum dado é enviado).

interface Props {
  open: boolean;
  onClose: () => void;
  videoUrl: string;
  handle?: string;
  caption?: string;
}

export function FeedMockup({ open, onClose, videoUrl, handle = 'suamarca', caption = 'Sua legenda aqui — gancho forte nos primeiros segundos 🔥' }: Props) {
  const [platform, setPlatform] = useState<'instagram' | 'facebook'>('instagram');
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
        {/* Toggle de plataforma */}
        <div className="flex items-center gap-1 bg-white dark:bg-gray-900 rounded-full p-1 shadow-lg">
          {(['instagram', 'facebook'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className={`px-4 py-1.5 rounded-full text-xs font-black capitalize ${
                platform === p ? 'bg-blue-600 text-white' : 'text-gray-500'
              }`}
            >
              {p}
            </button>
          ))}
          <button onClick={onClose} className="ml-1 p-1.5 rounded-full text-gray-400 hover:text-red-500">
            <X size={16} />
          </button>
        </div>

        {platform === 'instagram' ? (
          // Instagram Reels — vídeo full-bleed com overlay.
          <div className="relative w-[300px] h-[533px] bg-black rounded-3xl overflow-hidden shadow-2xl ring-4 ring-gray-800">
            <video src={videoUrl} controls autoPlay loop muted className="w-full h-full object-cover" />
            <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-3 bg-gradient-to-b from-black/30 via-transparent to-black/50">
              <div className="flex items-center justify-between text-white">
                <span className="font-black text-sm drop-shadow">Reels</span>
                <MoreHorizontal size={18} />
              </div>
              <div className="flex items-end justify-between">
                <div className="text-white max-w-[210px]">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-pink-500 to-yellow-400" />
                    <span className="text-sm font-black drop-shadow">{handle}</span>
                    <span className="text-[10px] border border-white/70 rounded px-1">Seguir</span>
                  </div>
                  <p className="text-xs drop-shadow line-clamp-2">{caption}</p>
                </div>
                <div className="flex flex-col items-center gap-3 text-white">
                  <Heart size={24} className="drop-shadow" />
                  <MessageCircle size={24} className="drop-shadow" />
                  <Send size={24} className="drop-shadow" />
                  <Bookmark size={22} className="drop-shadow" />
                </div>
              </div>
            </div>
          </div>
        ) : (
          // Facebook — card de feed.
          <div className="w-[340px] bg-white dark:bg-gray-900 rounded-xl overflow-hidden shadow-2xl">
            <div className="flex items-center gap-2 p-3">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-blue-700" />
              <div className="flex-1">
                <div className="text-sm font-black text-gray-900 dark:text-gray-100">Sua Marca</div>
                <div className="text-[10px] text-gray-400">Patrocinado · 🌐</div>
              </div>
              <MoreHorizontal size={18} className="text-gray-400" />
            </div>
            <p className="px-3 pb-2 text-sm text-gray-800 dark:text-gray-200">{caption}</p>
            <video src={videoUrl} controls autoPlay loop muted className="w-full bg-black max-h-[420px] object-contain" />
            <div className="flex items-center justify-around py-2 text-gray-500 text-sm font-bold border-t border-gray-100 dark:border-gray-800 mt-1">
              <span className="flex items-center gap-1.5"><ThumbsUp size={16} /> Curtir</span>
              <span className="flex items-center gap-1.5"><MessageCircle size={16} /> Comentar</span>
              <span className="flex items-center gap-1.5"><Send size={16} /> Compartilhar</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
