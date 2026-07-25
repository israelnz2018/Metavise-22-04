import { useEffect, useState } from 'react';
import { Check, Loader2, CircleDot } from 'lucide-react';

// Indicador discreto de save. Agora que o save é POR EVENTO (gera algo → salva),
// isto confirma pro usuário que rolou: "Salvando…" → "Salvo agora" → "há Xmin".

interface Props {
  isSaving: boolean;
  lastSavedAt: number | null;
  hasUnsaved?: boolean;
}

export function SaveIndicator({ isSaving, lastSavedAt, hasUnsaved }: Props) {
  // Re-render a cada 30s pra o "há Xmin" não ficar velho.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  if (isSaving) {
    return (
      <span className="hidden lg:inline-flex items-center gap-1 text-[11px] font-bold text-gray-400">
        <Loader2 size={12} className="animate-spin" /> Salvando…
      </span>
    );
  }
  if (hasUnsaved) {
    return (
      <span className="hidden lg:inline-flex items-center gap-1 text-[11px] font-bold text-amber-500">
        <CircleDot size={12} /> Não salvo
      </span>
    );
  }
  if (!lastSavedAt) return null;
  const mins = Math.floor((Date.now() - lastSavedAt) / 60000);
  const label = mins < 1 ? 'Salvo agora' : mins === 1 ? 'Salvo há 1 min' : `Salvo há ${mins} min`;
  return (
    <span className="hidden lg:inline-flex items-center gap-1 text-[11px] font-bold text-green-600 dark:text-green-400">
      <Check size={12} /> {label}
    </span>
  );
}
