import { useState } from 'react';
import { Info } from 'lucide-react';
import { CreativeInfoModal } from './CreativeInfoModal';
import type { ProjectVariant } from '@/types/project';

interface Props {
  variant: ProjectVariant;
  heygenAvatars?: any[];
  /** 'overlay' = botão flutuante no canto do vídeo (precisa de pai `relative`);
   *  'inline' = botãozinho normal pra barras de ação. */
  placement?: 'overlay' | 'inline';
  className?: string;
}

// Botão "i" que abre o raio-x do criativo (voz, avatar, estilo, etc).
// Carrega o próprio estado do modal, então pode ser solto em qualquer lugar —
// no canto de um vídeo (overlay) ou numa barra de ações (inline).
export function CreativeInfoButton({
  variant,
  heygenAvatars = [],
  placement = 'inline',
  className = '',
}: Props) {
  const [open, setOpen] = useState(false);

  const base =
    placement === 'overlay'
      ? 'absolute top-3 right-3 z-10 p-2 rounded-full bg-black/55 text-white backdrop-blur-sm hover:bg-black/80 shadow-lg transition-all'
      : 'p-2.5 rounded-xl text-gray-300 dark:text-gray-600 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-all';

  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={`${base} ${className}`}
        title="Ver dados do criativo (voz, avatar, estilo…)"
      >
        <Info size={placement === 'overlay' ? 18 : 20} />
      </button>
      <CreativeInfoModal
        open={open}
        onClose={() => setOpen(false)}
        variant={variant}
        heygenAvatars={heygenAvatars}
      />
    </>
  );
}
