// Small chip shown in the App header that tells the user whether
// their changes are persisted. Three visual states:
//
//   isSaving=true         → blue spinner "Salvando…"
//   hasUnsavedChanges=true → amber dot "Alterações não salvas"
//   else (last save known) → green check "Salvo agora" / "Salvo há Xmin"
//   else (no save yet)    → nothing — first edit hasn't happened
//
// The "há Xmin" text is recomputed on a 30s tick so it doesn't go
// stale while the user is just reading.

import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, AlertCircle } from 'lucide-react';

interface Props {
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  /** Unix millis. null = haven't saved yet this session. */
  lastSavedAt: number | null;
}

function formatRelative(lastSavedAt: number): string {
  const diffMs = Date.now() - lastSavedAt;
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 10) return 'Salvo agora';
  if (diffSec < 60) return `Salvo há ${diffSec}s`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `Salvo há ${diffMin}min`;
  const diffH = Math.round(diffMin / 60);
  return `Salvo há ${diffH}h`;
}

export function AutoSaveIndicator({
  isSaving,
  hasUnsavedChanges,
  lastSavedAt,
}: Props) {
  // Force re-render every 30s so the "há Xmin" text updates without
  // requiring an external trigger. Cheap — one setState every 30s.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (lastSavedAt === null) return;
    const id = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [lastSavedAt]);

  if (isSaving) {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-full text-[10px] font-black uppercase tracking-widest"
        title="Salvando alterações…"
      >
        <Loader2 size={12} className="animate-spin" />
        Salvando…
      </span>
    );
  }

  if (hasUnsavedChanges) {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-700 rounded-full text-[10px] font-black uppercase tracking-widest"
        title="Você tem alterações não salvas neste projeto"
      >
        <AlertCircle size={12} />
        Não salvo
      </span>
    );
  }

  if (lastSavedAt === null) return null;

  return (
    <span
      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-700 rounded-full text-[10px] font-black uppercase tracking-widest"
      title={`Última gravação: ${new Date(lastSavedAt).toLocaleTimeString()}`}
    >
      <CheckCircle2 size={12} />
      {formatRelative(lastSavedAt)}
    </span>
  );
}
