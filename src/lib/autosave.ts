// Save por EVENTO: dispara um save do projeto SÓ quando algo importante é
// gerado (vídeo, montagem, imagem, música, copy, edição). NÃO é o auto-save
// contínuo antigo (que salvava a cada mudança de config e sobrecarregava o app)
// — é pontual, nesses marcos. O App escuta 'metavise-autosave' e salva com
// debounce (silencioso).
export function triggerProjectSave(reason?: string) {
  try {
    window.dispatchEvent(new CustomEvent('metavise-autosave', { detail: { reason } }));
  } catch {
    /* ambiente sem window (ssr/teste) — ignora */
  }
}
