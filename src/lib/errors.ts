// Normaliza erro de qualquer formato (string, Error, resposta de API com
// {error}/{code}/{status}, ou JSON serializado dentro da mensagem) numa
// string legível. Extraído do App.tsx — era usado em 4 handlers diferentes.
export function getErrorMessage(err: any): string {
  if (!err) return 'Erro desconhecido';
  const msg =
    typeof err === 'string'
      ? err
      : err.message && err.message !== '[object Object]'
        ? err.message
        : err.error ||
          err.code ||
          err.status ||
          JSON.stringify(err, Object.getOwnPropertyNames(err));
  if (typeof msg === 'string' && msg.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(msg);
      return (
        parsed.error?.message ||
        parsed.error?.status ||
        parsed.error?.code ||
        parsed.error ||
        parsed.message ||
        parsed.code ||
        parsed.status ||
        (typeof parsed === 'string' ? parsed : JSON.stringify(parsed))
      );
    } catch (e) {
      return msg;
    }
  }
  return msg;
}
