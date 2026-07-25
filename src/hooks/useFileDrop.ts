import { useCallback, useState } from 'react';

// Arrastar-e-soltar arquivo em qualquer área. Espalhe `dropHandlers` no container
// e use `dragging` pra destacar. Chama onFiles com os arquivos soltos.
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [dragging, setDragging] = useState(false);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!dragging) setDragging(true);
  }, [dragging]);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // Só desliga quando sai de verdade do container (não ao passar por um filho).
    if (e.currentTarget === e.target) setDragging(false);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length) onFiles(files);
    },
    [onFiles]
  );

  return { dragging, dropHandlers: { onDragOver, onDragLeave, onDrop } };
}
