import { toast } from 'react-hot-toast';
import { playSuccessSound, playErrorSound } from './sfx';

// Toca som em TODO toast.success/toast.error do app sem precisar tocar nos
// milhares de call sites espalhados pelo código. `toast` é o mesmo objeto
// singleton em todo import (ESM dedupe o módulo) — sobrescrever os métodos
// UMA vez aqui afeta every `toast.success(...)`/`toast.error(...)` chamado
// em qualquer arquivo, mesmo os que importam `toast` direto do pacote.
// sfx.ts já checa a preferência do usuário internamente (setSfxEnabled).
let installed = false;

export function installToastSound() {
  if (installed) return;
  installed = true;
  const t = toast as any;
  const originalSuccess = t.success.bind(toast);
  const originalError = t.error.bind(toast);
  t.success = (...args: Parameters<typeof toast.success>) => {
    playSuccessSound();
    return originalSuccess(...args);
  };
  t.error = (...args: Parameters<typeof toast.error>) => {
    playErrorSound();
    return originalError(...args);
  };
}
