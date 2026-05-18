// Pure helper functions extracted from App.tsx. None close over React
// state or refs — they live happily as plain module exports. App.tsx
// imports them; future page components can too.

export const getRecomendedEstilo = (nivelConsciencia: string) => {
  const level = nivelConsciencia.charAt(0);
  if (level === '1') return ['Storytelling', 'Gancho de Curiosidade', 'Educativo'];
  if (level === '2') return ['Problema → Solução', 'Storytelling', 'Inspirador'];
  if (level === '3') return ['Antes e Depois', 'Prova Social', 'Educativo'];
  if (level === '4') return ['Direto ao Ponto', 'Prova Social', 'Profissional / Autoridade'];
  if (level === '5') return ['Direto ao Ponto', 'Urgência / Escassez'];
  return [];
};

export const recomendacoesTempo: Record<
  string,
  {
    faixaSegundos: string;
    palavrasMin: number;
    palavrasMax: number;
    frase: string;
  }
> = {
  '1': {
    faixaSegundos: '90-180s',
    palavrasMin: 225,
    palavrasMax: 450,
    frase:
      'Seu público ainda não sabe que tem esse problema — precisa de tempo pra despertar interesse.',
  },
  '2': {
    faixaSegundos: '60-120s',
    palavrasMin: 150,
    palavrasMax: 300,
    frase:
      'Seu público sente a dor mas não sabe a solução — vale agitar o problema antes de apresentar o produto.',
  },
  '3': {
    faixaSegundos: '45-90s',
    palavrasMin: 110,
    palavrasMax: 225,
    frase:
      'Seu público já busca soluções — ideal um vídeo médio que mostre o seu diferencial sem cansar.',
  },
  '4': {
    faixaSegundos: '30-60s',
    palavrasMin: 75,
    palavrasMax: 150,
    frase:
      'Seu público já te conhece ou conhece concorrentes — vá direto na diferenciação e prova.',
  },
  '5': {
    faixaSegundos: '15-30s',
    palavrasMin: 35,
    palavrasMax: 75,
    frase: 'Seu público está pronto pra comprar — só precisa de um empurrão com oferta e urgência.',
  },
};

export const getRecomendacaoTempo = (nivelConsciencia: string) => {
  const level = nivelConsciencia?.charAt(0);
  return level ? recomendacoesTempo[level] : null;
};

export const countWords = (text: string): number => {
  return (text || '')
    .replace(/\[.*?\]/g, '') // remove [HOOK], [AGITAÇÃO DA DOR], etc.
    .replace(/\(.*?\)/g, '') // remove (parênteses) se houver
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
};

export const detectDuration = (file: File): Promise<number> => {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve(video.duration);
    };
    video.src = URL.createObjectURL(file);
  });
};

export const detectVideoFormat = (file: File): Promise<'9:16' | '1:1' | '16:9'> => {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      URL.revokeObjectURL(video.src);
      const ratio = w / h;
      if (ratio < 0.8) resolve('9:16');
      else if (ratio > 1.2) resolve('16:9');
      else resolve('1:1');
    };
    video.src = URL.createObjectURL(file);
  });
};

export const detectVideoFormatFromUrl = (url: string): Promise<'9:16' | '1:1' | '16:9'> => {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.crossOrigin = 'anonymous';
    video.onloadedmetadata = () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      const ratio = w / h;
      if (ratio < 0.8) resolve('9:16');
      else if (ratio > 1.2) resolve('16:9');
      else resolve('1:1');
    };
    video.onerror = () => resolve('9:16'); // fallback
    video.src = url;
  });
};

