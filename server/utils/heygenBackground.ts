// Converte o background vindo do cliente ({ type:'color'|'image'|'video', value })
// no formato que a API v2 do HeyGen espera. Sem background válido → preto sólido
// (comportamento legado). `value` é hex (#RRGGBB) p/ cor, ou URL pública
// (Firebase Storage) p/ imagem/vídeo — o HeyGen baixa o arquivo dessa URL.
//
// Compartilhado entre a rota /generate e o job segmentado pra manterem o mesmo
// comportamento.
export function buildHeyGenBackground(bg: any): Record<string, any> {
  const BLACK = { type: 'color', value: '#000000' };
  if (!bg || typeof bg !== 'object') return BLACK;
  const value = typeof bg.value === 'string' ? bg.value.trim() : '';
  if (bg.type === 'color') {
    return /^#[0-9a-fA-F]{6}$/.test(value) ? { type: 'color', value } : BLACK;
  }
  if (bg.type === 'image' && /^https?:\/\//.test(value)) {
    return { type: 'image', url: value, fit: 'cover' };
  }
  if (bg.type === 'video' && /^https?:\/\//.test(value)) {
    return { type: 'video', url: value, play_style: 'loop' };
  }
  return BLACK;
}
