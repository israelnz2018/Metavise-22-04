import { useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage, auth } from '@/lib/firebase';
import { SoundLibraryModal } from '@/components/SoundLibraryModal';
import { useSoundLibrary } from '@/hooks/useSoundLibrary';
import { AvatarFramingModal, AvatarFraming, DEFAULT_AVATAR_FRAMING } from '@/components/AvatarFramingModal';
import { Film, Upload, Loader2, Trash2, ArrowUp, ArrowDown, Check, Music, X, Plus, Maximize, Play, Pause } from 'lucide-react';

interface Clip {
  url: string;
  label: string;
  duration?: number; // duração detectada no upload
  // Modo SEQUÊNCIA (sem áudio base): trim do clipe.
  startSec?: number;
  endSec?: number;
}

// Lê a duração de um vídeo no navegador. Lida com duration=Infinity/NaN
// (comum em vídeos gravados): força o cálculo pulando pro fim.
const readDurationFromUrl = (src: string): Promise<number> =>
  new Promise((resolve) => {
    let settled = false;
    const v = document.createElement('video');
    v.preload = 'metadata';
    const finish = (d: number) => {
      if (settled) return;
      settled = true;
      try {
        v.removeAttribute('src');
        v.load();
      } catch {
        /* ignore */
      }
      resolve(Number.isFinite(d) && d > 0 ? d : 0);
    };
    v.onloadedmetadata = () => {
      if (v.duration === Infinity || Number.isNaN(v.duration)) {
        v.ontimeupdate = () => {
          v.ontimeupdate = null;
          finish(v.duration);
        };
        try {
          v.currentTime = 1e7;
        } catch {
          finish(0);
        }
      } else {
        finish(v.duration);
      }
    };
    v.onerror = () => finish(0);
    setTimeout(() => finish(0), 8000); // não trava se algo der errado
    v.src = src;
  });

const readDurationFromFile = async (file: File): Promise<number> => {
  const url = URL.createObjectURL(file);
  const d = await readDurationFromUrl(url);
  URL.revokeObjectURL(url);
  return d;
};

// Modo TIMELINE: cada item é um trecho POSICIONADO no tempo do áudio.
interface TLItem {
  clipIdx: number;
  /** SPLIT-SCREEN: 2º b-roll (lado direito). Renderiza clipIdx | clipIdx2. */
  clipIdx2?: number;
  /** Layout com AVATAR: 'avatar' (tela cheia) | 'pip' (círculo canto) |
   *  'split-left' | 'split-right'. Vazio/'full' = só o b-roll. Usa o "Avatar
   *  base" (sincronizado à narração). */
  layout?: 'full' | 'avatar' | 'pip' | 'split-left' | 'split-right' | 'split-top' | 'split-bottom';
  atSec: number; // começa em (seg do áudio)
  endSec: number; // termina em (seg do áudio)
  showSec?: number; // legado (drafts antigos)
  // Transição de ENTRADA (início do trecho) e de SAÍDA (fim do trecho).
  transIn?: string;
  transInDur?: number;
  soundIn?: string;
  transOut?: string;
  transOutDur?: number;
  soundOut?: string;
  /** Efeito sonoro CONTEXTUAL (ex.: Cash Register em "dinheiro"), tocado logo
   *  após a entrada do trecho. Escolhido pela IA no Auto-editar. */
  soundMid?: string;
  /** 'end' → o FIM do efeito alinha com o fim do trecho (ex.: SFX Reversed/riser). */
  soundMidAlign?: 'end' | '';
  /** Clipe em preto-e-branco (trechos de "antes"/passado). */
  bw?: boolean;
  /** Termo de b-roll usado pelo Auto-editar — reusado ao "trocar" o trecho. */
  keyword?: string;
}

// Texto cinético na tela (palavra grande animada, estilo VSL).
interface TextItem {
  text: string;
  atSec: number;
  endSec: number;
  color: string; // hex
  pos: 'middle' | 'top' | 'bottom';
  /** Efeito sonoro que toca junto com a entrada do texto (ex.: Swoosh Fight). */
  sound?: string;
}
const TEXT_COLORS = ['#39FF14', '#FFFFFF', '#FFE500', '#FF3B3B', '#00E0FF'];

// Slot planejado pelo Auto-editar: um trecho [start,end] com candidatos de
// b-roll do Pexels; o usuário escolhe o `chosen` (URL) de cada um.
interface AutoSlot {
  start: number;
  end: number;
  keyword: string;
  searchTerm: string;
  candidates: { url: string; thumb: string; duration?: number }[];
  chosen: string;
  /** Palavra FALADA mais forte do trecho + timing exato (pro texto na tela). */
  spokenWord?: string;
  wordStart?: number;
  wordEnd?: number;
  /** Frase impactante (PT) escolhida pela IA pra destacar na tela (ou vazio). */
  highlight?: string;
  /** Momento EXATO (s) em que a frase de destaque começa a ser dita. */
  highlightStart?: number;
  /** "animation" → busca b-roll em estilo animação/diagrama. */
  style?: string;
  /** "past" → trecho de "antes"/passado → clipe em P&B. */
  tone?: string;
  /** true → split-screen (2 b-rolls lado a lado neste trecho). */
  split?: boolean;
  /** Efeito sonoro contextual sugerido pela IA (nome + URL da biblioteca). */
  effectName?: string;
  effectUrl?: string;
}

// Fim do item (compat com drafts antigos que usavam showSec).
const itemEnd = (it: TLItem) => it.endSec ?? it.atSec + (it.showSec || 5);


// Campo numérico que guarda o TEXTO digitado localmente — evita o bug do
// type="number" controlado, onde limpar mostra "0" e digitar vira "098.5".
// Tira zeros à esquerda, deixa vazio enquanto edita, e faz o clamp só no blur.
function NumInput({
  value,
  onCommit,
  min = 0,
  className,
}: {
  value: number;
  onCommit: (n: number) => void;
  min?: number;
  className?: string;
}) {
  const [raw, setRaw] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setRaw(String(value));
  }, [value, focused]);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={raw}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        // só dígitos + 1 ponto; remove zeros à esquerda ("098.5" → "98.5").
        let s = e.target.value.replace(/[^0-9.]/g, '');
        const dot = s.indexOf('.');
        if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
        s = s.replace(/^0+(\d)/, '$1');
        setRaw(s);
        if (s !== '' && s !== '.') {
          const n = Number(s);
          if (Number.isFinite(n)) onCommit(n);
        }
      }}
      onBlur={() => {
        setFocused(false);
        const n = Number(raw);
        const clamped = Math.max(min, Number.isFinite(n) && raw !== '' ? n : min);
        onCommit(clamped);
        setRaw(String(clamped));
      }}
      className={className}
    />
  );
}

// Transições disponíveis. `css` = classe da animação no preview (definida no
// <style> da própria aba); o `id` é o que o backend (ffmpeg) entende.
const TRANSITIONS: { id: string; label: string; css: string }[] = [
  { id: 'none', label: 'Nenhuma', css: '' },
  { id: 'fade', label: 'Fade (preto)', css: 'mv-fade' },
  { id: 'dissolve', label: 'Crossfade', css: 'mv-fade' },
  { id: 'slideleft', label: 'Slide ←', css: 'mv-slideleft' },
  { id: 'slideright', label: 'Slide →', css: 'mv-slideright' },
  { id: 'slideup', label: 'Slide ↑', css: 'mv-slideup' },
  { id: 'slidedown', label: 'Slide ↓', css: 'mv-slidedown' },
  { id: 'zoomin', label: 'Zoom in', css: 'mv-zoomin' },
  { id: 'zoomout', label: 'Zoom out', css: 'mv-zoomout' },
  { id: 'whiteflash', label: 'Flash branco', css: 'mv-white' },
  { id: 'whip', label: 'Whip / Blur', css: 'mv-whip' },
  { id: 'glitch', label: 'Glitch', css: 'mv-glitch' },
  { id: 'bw', label: 'Preto & branco', css: 'mv-bw' },
];

// Som certo por TIPO de transição, mapeado pelos nomes exatos da biblioteca.
// NUNCA usa Impactos (ex.: Vine Boom) — esses o usuário põe à mão. Tipos sem
// mapeamento (fade/whiteflash/glitch/bw) ficam SEM som automático.
const TRANSITION_SOUND: Record<string, string> = {
  slideleft: 'Swoosh 7',
  slideright: 'Swoosh 7',
  slideup: 'Swoosh 7',
  slidedown: 'Swoosh 7',
  whip: 'Swoosh 7',
  dissolve: 'Swoosh 7',
  zoomin: 'Swoosh 7',
  zoomout: 'Swoosh 7',
};
function soundForTransition(type?: string): string {
  try {
    const lib = JSON.parse(localStorage.getItem('metavise-sound-library') || '[]') as any[];
    const findName = (name: string) =>
      lib.find((x) => (x?.name || '').trim().toLowerCase() === name.toLowerCase())?.url || '';
    // Fallback só dentro de "Transições" (nunca Efeitos/Impactos).
    const fallback = () =>
      lib.find((x) => x?.category === 'Transições' && /swoosh|whoosh/i.test(x?.name || ''))?.url ||
      lib.find((x) => x?.category === 'Transições')?.url ||
      '';
    if (type) {
      const wanted = TRANSITION_SOUND[type];
      if (!wanted) return ''; // tipo sem som mapeado → sem áudio automático
      return findName(wanted) || fallback();
    }
    return fallback();
  } catch {
    return '';
  }
}

interface Props {
  config: any;
  setConfig: (updater: any) => void;
  user?: { uid?: string } | null;
  onAddUploadedVideo?: (video: any, isHook: boolean) => void;
  onGoToEdit?: () => void;
}

/**
 * MONTAGEM — usar os PRÓPRIOS vídeos (sem avatar IA).
 *  • COM áudio base → TIMELINE estilo "Mesclar": dá play no áudio, clica
 *    "Adicionar aqui" no segundo certo, escolhe o trecho e ajusta início/fim.
 *    Buracos = tela preta; a voz toca por cima.
 *  • SEM áudio → SEQUÊNCIA: cola os trechos em ordem.
 */
export function MontagemTab({ config, setConfig, user, onAddUploadedVideo, onGoToEdit }: Props) {
  const draft = (config?.montagem as any) || {};
  const [clips, setClips] = useState<Clip[]>(() => (Array.isArray(draft.clips) ? draft.clips : []));
  const [items, setItems] = useState<TLItem[]>(() => (Array.isArray(draft.items) ? draft.items : []));
  const [texts, setTexts] = useState<TextItem[]>(() =>
    Array.isArray(draft.texts) ? draft.texts : []
  );
  const [uploading, setUploading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [resultUrl, setResultUrl] = useState<string>(draft.resultUrl || '');
  const [muted, setMuted] = useState<boolean>(!!draft.muted);
  const [audioUrl, setAudioUrl] = useState<string>(draft.audioUrl || '');
  const [audioDuration, setAudioDuration] = useState<number>(Number(draft.audioDuration) || 0);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [picking, setPicking] = useState<number | null>(null); // atSec aguardando escolha do clipe
  const [pexQuery, setPexQuery] = useState('');
  const [pexResults, setPexResults] = useState<any[]>([]);
  const [pexSearching, setPexSearching] = useState(false);
  // Qual som (de qual trecho) está sendo escolhido na biblioteca de efeitos.
  const [soundPicker, setSoundPicker] = useState<{
    idx: number;
    field: 'soundIn' | 'soundOut' | 'soundMid';
  } | null>(null);
  // Abre a biblioteca só pra GERENCIAR (enviar/aparar/deletar), sem trecho-alvo.
  const [soundLibManage, setSoundLibManage] = useState(false);
  const { sounds: libSounds } = useSoundLibrary();
  const sfxAudioRef = useRef<HTMLAudioElement | null>(null);
  const playSfx = (url: string) => {
    if (!sfxAudioRef.current) sfxAudioRef.current = new Audio();
    const a = sfxAudioRef.current;
    a.src = url;
    a.currentTime = 0;
    a.play().catch(() => {});
  };
  // Nome do efeito (biblioteca) a partir da URL — pra mostrar nos badges.
  const soundName = (url?: string) =>
    url ? libSounds.find((s) => s.url === url)?.name || 'efeito' : '';
  const [autoEditing, setAutoEditing] = useState(false);
  // Ritmo do Auto-editar: base de duração dos cortes (s). Menor = MAIS trechos.
  const [cutPace, setCutPace] = useState<number>(10);
  // Moldes de criativo: salvam formato + enquadramento + ritmo pra reaplicar.
  const [templates, setTemplates] = useState<
    { name: string; aspect: string; fit: string; cutPace: number }[]
  >(() => {
    try {
      return JSON.parse(localStorage.getItem('metavise-montagem-templates') || '[]');
    } catch {
      return [];
    }
  });
  // Candidate picker: slots planejados pela IA, cada um com candidatos do Pexels.
  const [autoSlots, setAutoSlots] = useState<AutoSlot[]>([]);
  const [researchingSlot, setResearchingSlot] = useState<number | null>(null);
  // Duração (s) dos "Meus vídeos do projeto", lida do metadata → mostra no canto.
  const [myVidDur, setMyVidDur] = useState<Record<string, number>>({});
  // Qual trecho está com o painel "Meus vídeos" aberto (só mostra ao clicar).
  const [myVidOpen, setMyVidOpen] = useState<Record<number, boolean>>({});
  // "Meus vídeos" aberto no modal de TROCAR.
  const [swapMyVid, setSwapMyVid] = useState(false);
  // Gerar música (arco emocional) e colar embaixo do vídeo montado.
  const [musicGen, setMusicGen] = useState(false);
  // Trocar b-roll de um trecho JÁ aplicado na timeline (busca Pexels por item).
  const [brollSwap, setBrollSwap] = useState<{
    itemIdx: number;
    term: string;
    candidates: { url: string; thumb: string }[];
    loading: boolean;
    // 'swap' = troca o b-roll do trecho; 'split' = adiciona 2º b-roll (split).
    mode?: 'swap' | 'split';
  } | null>(null);
  // Player pra ouvir o trecho enquanto escolhe o b-roll.
  const segAudioRef = useRef<HTMLAudioElement | null>(null);
  const playSegment = (start: number, end: number) => {
    if (!audioUrl) return;
    if (!segAudioRef.current) segAudioRef.current = new Audio();
    const a = segAudioRef.current as any;
    if (a.src !== audioUrl) a.src = audioUrl;
    a.currentTime = Math.max(0, start);
    a.play().catch(() => {});
    clearTimeout(a._segTimer);
    a._segTimer = setTimeout(() => a.pause(), Math.max(300, (end - start) * 1000));
  };
  // Formato do vídeo + enquadramento. Padrão: preencher (sem barras pretas).
  const [aspect, setAspect] = useState<'1:1' | '9:16' | '16:9'>(
    (draft.aspect as any) || ((config as any)?.format?.aspectRatio as any) || '1:1'
  );
  const [fit, setFit] = useState<'cover' | 'contain'>((draft.fit as any) || 'cover');
  // Orientação do Pexels segue o FORMATO da montagem. 1:1 busca LANDSCAPE (o
  // Pexels quase não tem quadrado — "woman" tem 8; landscape tem milhares) e o
  // "Preencher" corta as laterais pro quadrado, mantendo a altura/cabeça. Só
  // 9:16 busca retrato.
  const pexOrient = aspect === '9:16' ? 'portrait' : 'landscape';
  // Vídeos do PRÓPRIO subprojeto (Vídeo IA, avatar HeyGen, uploads) — pra
  // escolher como b-roll no picker, além do Pexels. Exclui os "Auto N" (Pexels).
  const myProjectVideos = (() => {
    const out: { url: string; label: string; duration?: number }[] = [];
    const seen = new Set<string>();
    const push = (url: any, label: string, duration?: number) => {
      const u = String(url || '');
      if (u && !seen.has(u)) {
        seen.add(u);
        out.push({ url: u, label, duration: duration && isFinite(duration) ? duration : undefined });
      }
    };
    // SÓ os teus mesmo: clipes do Vídeo IA (label "IA …") — NÃO os Pexels
    // (Auto/Split/trocados). Avatar (HeyGen) e ganchos vêm do config.
    clips.forEach((c) => {
      if (/^IA /.test(c.label || '')) push(c.url, c.label || 'IA', c.duration);
    });
    (((config as any).videos as any[]) || []).forEach((v, i) => push(v?.url, `Avatar #${i + 1}`));
    (((config.copy as any)?.hookVideos as any[]) || []).forEach((v, i) => push(v?.url, `Gancho #${i + 1}`));
    return out;
  })();
  // Preenche a duração dos "Meus vídeos" que não vêm com ela (ex.: avatar) via
  // um probe dedicado (createElement) — mais confiável que o metadata da
  // miniatura, que às vezes não dispara com muitos vídeos na tela.
  const needDurKey = myProjectVideos
    .filter((mv) => !mv.duration && !myVidDur[mv.url])
    .map((mv) => mv.url)
    .join('|');
  useEffect(() => {
    if (!needDurKey) return;
    needDurKey.split('|').forEach((url) => {
      if (!url) return;
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      v.onloadedmetadata = () => {
        const d = v.duration;
        if (d && isFinite(d)) setMyVidDur((prev) => (prev[url] ? prev : { ...prev, [url]: d }));
      };
      v.src = url;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needDurKey]);
  // Vídeo do AVATAR (HeyGen), sincronizado à narração — usado no PiP/split.
  const [avatarBase, setAvatarBase] = useState<string>((draft.avatarUrl as any) || '');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  // Início do bloco DENTRO do avatar base (quando a base é a VSL inteira e você
  // monta um bloco do meio): o seek do avatar em cada trecho vira
  // avatarStartSec + atSec → usa só a janela do bloco e mantém o lip-sync.
  const avatarPreviewRef = useRef<HTMLVideoElement | null>(null);
  const [avatarStartSec, setAvatarStartSec] = useState<number>(Number(draft.avatarStartSec) || 0);
  // BLOCOS: fatia a VSL longa em pedaços de ~2 min cujos cortes caem em SILÊNCIOS
  // (respiros entre frases). Cada bloco é montado separado (áudio cortado + avatar
  // no offset certo); no fim junta tudo. fullAudioUrl = a voz inteira original.
  const [fullAudioUrl, setFullAudioUrl] = useState<string>((draft.fullAudioUrl as any) || '');
  const [blockSizeSec, setBlockSizeSec] = useState<number>(Number(draft.blockSizeSec) || 120);
  const [blockEnds, setBlockEnds] = useState<number[]>(
    Array.isArray(draft.blockEnds) ? draft.blockEnds : []
  );
  const [fatiando, setFatiando] = useState(false);
  const [activeBlock, setActiveBlock] = useState<number>(-1);
  const fmtT = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  // Fatia a VSL em blocos ~blockSizeSec, encaixando cada fim no SILÊNCIO mais
  // próximo (via /api/video/silences).
  const fatiarEmBlocos = async () => {
    if (!audioUrl) {
      toast.error('Carregue a voz da VSL como base primeiro.');
      return;
    }
    setFatiando(true);
    const tid = 'fatiar';
    toast.loading('Achando os silêncios pra cortar os blocos…', { id: tid });
    try {
      const r = await fetch('/api/video/silences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioUrl }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Falha ao detectar silêncios.');
      const dur = Number(d.duration) || audioDuration || 0;
      if (dur <= 0) throw new Error('Não consegui ler a duração do áudio.');
      const mids: number[] = (d.silences || []).map((s: any) => (s.start + s.end) / 2);
      const ends: number[] = [];
      let start = 0;
      let guard = 0;
      while (start < dur - 1 && guard++ < 200) {
        const target = start + blockSizeSec;
        if (target >= dur - Math.min(20, blockSizeSec * 0.3)) {
          ends.push(dur);
          break;
        }
        const near = mids
          .filter((m) => m > start + blockSizeSec * 0.4 && m < dur - 1)
          .sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];
        const end =
          near != null && Math.abs(near - target) < blockSizeSec * 0.5 ? near : target;
        ends.push(Math.min(Math.round(end * 10) / 10, dur));
        start = end;
      }
      setFullAudioUrl(audioUrl);
      setBlockEnds(ends);
      setActiveBlock(-1);
      toast.success(`${ends.length} blocos criados (cortes nos silêncios). Ajuste os fins se quiser.`, {
        id: tid,
      });
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao fatiar.', { id: tid });
    } finally {
      setFatiando(false);
    }
  };
  // Prepara um bloco pra montar: corta o áudio [start,end], seta o offset do
  // avatar e começa limpo. Depois é só Auto-editar + montar normal.
  const trabalharNoBloco = async (idx: number) => {
    const start = idx === 0 ? 0 : blockEnds[idx - 1]!;
    const end = blockEnds[idx]!;
    const src = fullAudioUrl || audioUrl;
    if (!src || end <= start) return;
    const tid = 'bloco';
    toast.loading(`Preparando Bloco ${idx + 1}…`, { id: tid });
    try {
      const r = await fetch('/api/elevenlabs/trim-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: src, start, end, userId: uid }),
      });
      const d = await r.json();
      if (!r.ok || !d.url) throw new Error(d.error || 'Falha ao cortar o áudio do bloco.');
      setAudioUrl(d.url);
      setAudioDuration(end - start);
      setAvatarStartSec(start); // avatar alinhado ao início do bloco no vídeo de 19 min
      setItems([]);
      setClips([]);
      setResultUrl('');
      setActiveBlock(idx);
      toast.success(
        `Bloco ${idx + 1} pronto (${fmtT(start)}–${fmtT(end)}). Agora clique em Auto-editar.`,
        { id: tid }
      );
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao preparar o bloco.', { id: tid });
    }
  };
  // Enquadramento do avatar por URL (calibrado 1× e reaproveitado em TODOS os
  // trechos daquele avatar): faixa do split (splitFocusX) e círculo do PiP
  // (pipCX, pipCY, pipSize). Sem calibração → defaults (centro / topo-centro).
  const [avatarFraming, setAvatarFraming] = useState<Record<string, AvatarFraming>>(() =>
    draft.avatarFraming && typeof draft.avatarFraming === 'object' ? draft.avatarFraming : {}
  );
  const [framingModalOpen, setFramingModalOpen] = useState(false);
  const framing: AvatarFraming = (avatarBase && avatarFraming[avatarBase]) || DEFAULT_AVATAR_FRAMING;
  // Avatares JÁ GERADOS neste subprojeto (VSL + corpo) — pra usar de base sem
  // precisar reupload. Cada um: {url, aspectRatio, createdAt}.
  const avatarVideoOptions = [
    ...(((config as any)?.copyVsl?.avatarVideos as any[]) || []).map((v) => ({ ...v, from: 'VSL' })),
    ...(((config as any)?.videos as any[]) || []).map((v) => ({ ...v, from: 'Corpo' })),
  ].filter((v) => v?.url);

  const uid = user?.uid || auth.currentUser?.uid;
  // Vozes já geradas no subprojeto (etapa Voz): corpo, gancho e VSL. Cada uma
  // vira uma opção de trilha base pra montar por cima.
  // Blocos da VSL já gerados (config.copyVsl.blockAudios) — cada um vira uma
  // voz-base própria, pra você montar UM bloco de cada vez (fluxo por bloco).
  const vslBlockAudios = (((config as any)?.copyVsl?.blockAudios as any[]) || [])
    .map((b, i) => (b?.url && b?.status === 'done' ? { key: `vslbloco${i}`, label: `VSL — Bloco ${i + 1}`, url: b.url as string } : null))
    .filter(Boolean) as { key: string; label: string; url: string }[];
  const vozOptions = [
    { key: 'corpo', label: 'Voz do Corpo', url: (config?.audioUrl as string) || '' },
    {
      key: 'gancho',
      label: 'Voz do Gancho',
      url: ((config?.copy as any)?.hookAudioUrl as string) || '',
    },
    {
      key: 'vsl',
      label: 'Voz da VSL (juntada)',
      url: ((config as any)?.copyVsl?.audioUrl as string) || '',
    },
    ...vslBlockAudios,
    // Áudios JUNTADOS na Edição (gancho + corpo etc.) — voiceId 'joined'.
    ...(((config as any)?.audios as any[]) || [])
      .filter((a) => a?.voiceId === 'joined' && a?.url)
      .map((a, i) => ({ key: `joined-${i}`, label: `Áudio juntado #${i + 1}`, url: a.url as string })),
  ].filter((o) => !!o.url);
  const isTimeline = !!audioUrl;
  // Double-buffer: dois <video> (A/B). Mantém o atual visível até o próximo
  // carregar → sem tela preta entre trechos colados.
  const vARef = useRef<HTMLVideoElement | null>(null);
  const vBRef = useRef<HTMLVideoElement | null>(null);
  const aFrontRef = useRef<boolean>(true);
  const rafRef = useRef<number>(0);
  const previewWrapRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeIdxRef = useRef<number>(-1);
  const exitDoneRef = useRef<number>(-1);
  const playingRef = useRef<boolean>(false);

  const frontEl = () => (aFrontRef.current ? vARef.current : vBRef.current);
  const backEl = () => (aFrontRef.current ? vBRef.current : vARef.current);

  const goFullscreen = () => {
    const d = document as any;
    if (d.fullscreenElement || d.webkitFullscreenElement) {
      (d.exitFullscreen || d.webkitExitFullscreen)?.call(d);
      return;
    }
    const el = previewWrapRef.current as any;
    if (!el) return;
    (el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen)?.call(el);
  };

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  };

  const seekAudio = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !audioDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    a.currentTime = ratio * audioDuration;
    syncPreview(a.currentTime, true);
  };

  useEffect(() => {
    if (clips.length === 0 && !resultUrl && !audioUrl) return;
    setConfig((prev: any) => ({
      ...prev,
      montagem: { clips, items, texts, resultUrl, muted, audioUrl, audioDuration, aspect, fit, avatarUrl: avatarBase, avatarFraming, avatarStartSec, fullAudioUrl, blockSizeSec, blockEnds },
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips, items, texts, resultUrl, muted, audioUrl, audioDuration, aspect, fit]);

  // Preenche a duração de trechos que ainda não têm (1 por vez, sem travar).
  useEffect(() => {
    const i = clips.findIndex((c) => !c.duration && c.url);
    if (i === -1) return;
    let cancelled = false;
    (async () => {
      const d = await readDurationFromUrl(clips[i]!.url);
      if (cancelled || !d) return;
      setClips((prev) => prev.map((c, k) => (k === i && !c.duration ? { ...c, duration: d } : c)));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips]);

  // ── Preview: o áudio dirige o tempo; a tela mostra o item ativo (buraco=preto).
  // O clipe TOCA naturalmente (suave); só troco/seek quando o item muda OU quando
  // o usuário arrasta o áudio (force). Sem seek por timeupdate (era o que travava).
  const syncPreview = (t: number, force = false) => {
    setPlayhead(t);
    let active = -1;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]!;
      if (t >= it.atSec && t < itemEnd(it)) {
        active = i;
        break;
      }
    }
    if (active === -1) {
      if (activeIdxRef.current !== -1) {
        activeIdxRef.current = -1;
        [vARef.current, vBRef.current].forEach((v) => {
          if (v) {
            v.pause();
            v.style.opacity = '0';
          }
        });
      }
      return;
    }
    const it = items[active]!;
    const src = clips[it.clipIdx]?.url;
    if (!src) return;
    const desired = t - it.atSec;

    // SAÍDA: anima o trecho atual saindo perto do fim (uma vez).
    const tOut = it.transOut || 'none';
    const dOut = Math.max(0.05, it.transOutDur || 0.1);
    if (tOut !== 'none' && t > itemEnd(it) - dOut && exitDoneRef.current !== active) {
      exitDoneRef.current = active;
      const fe = frontEl();
      if (fe) {
        fe.style.zIndex = '3';
        fe.style.transition = `opacity ${dOut}s ease, transform ${dOut}s ease`;
        if (tOut === 'fade' || tOut === 'dissolve') fe.style.opacity = '0';
        else if (tOut === 'slideleft') fe.style.transform = 'translateX(-100%)';
        else if (tOut === 'slideright') fe.style.transform = 'translateX(100%)';
        else if (tOut === 'slideup') fe.style.transform = 'translateY(-100%)';
        else if (tOut === 'slidedown') fe.style.transform = 'translateY(100%)';
      }
    }

    // Pré-carrega o PRÓXIMO trecho no buffer de trás (mata o gap de load).
    {
      let nextSrc: string | undefined;
      let nextStart = Infinity;
      for (const it2 of items) {
        const s2 = clips[it2.clipIdx]?.url;
        if (s2 && it2.atSec > t && it2.atSec < nextStart) {
          nextStart = it2.atSec;
          nextSrc = s2;
        }
      }
      if (nextSrc && nextStart - t < 1.5) {
        const bb = backEl();
        if (bb && bb.getAttribute('src') !== nextSrc) {
          bb.style.opacity = '0';
          bb.src = nextSrc;
        }
      }
    }

    if (activeIdxRef.current !== active) {
      activeIdxRef.current = active;
      const b = backEl();
      const f = frontEl();
      if (!b) return;
      const trans = it.transIn || 'none';
      const d = Math.max(0.05, it.transInDur || 0.1);
      const applySwap = () => {
        try {
          b.currentTime = desired;
        } catch {
          /* ignore */
        }
        if (playingRef.current) b.play().catch(() => {});
        b.style.zIndex = '2';
        if (f) f.style.zIndex = '1';
        b.style.transition = 'none';
        if (trans === 'slideleft') {
          b.style.transform = 'translateX(100%)';
          b.style.opacity = '1';
        } else if (trans === 'slideright') {
          b.style.transform = 'translateX(-100%)';
          b.style.opacity = '1';
        } else if (trans === 'slideup') {
          b.style.transform = 'translateY(100%)';
          b.style.opacity = '1';
        } else if (trans === 'slidedown') {
          b.style.transform = 'translateY(-100%)';
          b.style.opacity = '1';
        } else if (trans === 'none') {
          b.style.transform = 'none';
          b.style.opacity = '1';
        } else {
          b.style.transform = 'none';
          b.style.opacity = '0';
        }
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            b.style.transition = `opacity ${d}s ease, transform ${d}s ease`;
            b.style.opacity = '1';
            b.style.transform = 'none';
          })
        );
        const fEl = f;
        window.setTimeout(
          () => {
            if (fEl) {
              fEl.style.opacity = '0';
              fEl.pause();
            }
          },
          trans === 'none' ? 0 : d * 1000
        );
        aFrontRef.current = !aFrontRef.current;
      };
      // Se o próximo já foi pré-carregado nesse <video>, troca na hora; senão espera carregar.
      if (b.getAttribute('src') === src && b.readyState >= 2) {
        applySwap();
      } else {
        b.src = src;
        b.onloadeddata = applySwap;
      }
    } else if (force) {
      const f = frontEl();
      if (f) {
        try {
          f.currentTime = desired;
        } catch {
          /* ignore */
        }
      }
    }
  };

  // Loop suave no play (troca no ms certo, não só a cada timeupdate ~4Hz).
  const startRaf = () => {
    cancelAnimationFrame(rafRef.current);
    const tick = () => {
      const a = audioRef.current;
      if (a && !a.paused) {
        syncPreview(a.currentTime);
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };
  const stopRaf = () => cancelAnimationFrame(rafRef.current);
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const onUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!uid) return toast.error('Faça login pra enviar vídeos.');
    setUploading(true);
    const toastId = 'montagem-upload';
    toast.loading(`Enviando ${files.length} trecho(s)...`, { id: toastId });
    try {
      const added: Clip[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('video/')) continue;
        const duration = await readDurationFromFile(file);
        const safe = file.name.replace(/[^a-z0-9.-]/gi, '_');
        const r = ref(storage, `video/${uid}/montagem/${Date.now()}-${safe}`);
        await uploadBytes(r, file, { contentType: file.type || 'video/mp4' });
        const url = await getDownloadURL(r);
        added.push({ url, label: file.name.replace(/\.[^.]+$/, ''), duration });
      }
      if (added.length) {
        setClips((prev) => [...prev, ...added]);
        toast.success(`${added.length} trecho(s) na biblioteca.`, { id: toastId });
      } else toast.error('Nenhum vídeo válido.', { id: toastId });
    } catch (e: any) {
      toast.error(e?.message || 'Falha no upload.', { id: toastId });
    } finally {
      setUploading(false);
    }
  };

  const onUploadAudio = async (file?: File | null) => {
    if (!file) return;
    if (!uid) return toast.error('Faça login.');
    setUploadingAudio(true);
    try {
      const safe = file.name.replace(/[^a-z0-9.-]/gi, '_');
      const r = ref(storage, `audio/${uid}/montagem/${Date.now()}-${safe}`);
      await uploadBytes(r, file, { contentType: file.type || 'audio/mpeg' });
      const url = await getDownloadURL(r);
      setAudioUrl(url);
      toast.success('Áudio carregado — dê play e adicione os trechos no tempo certo.');
    } catch (e: any) {
      toast.error(e?.message || 'Falha no upload do áudio.');
    } finally {
      setUploadingAudio(false);
    }
  };

  // Sobe o vídeo do AVATAR (HeyGen) que serve de base pro PiP/split. Deve estar
  // sincronizado à MESMA narração (o render busca o avatar no tempo do trecho).
  const onUploadAvatar = async (file?: File | null) => {
    if (!file) return;
    if (!uid) return toast.error('Faça login.');
    setUploadingAvatar(true);
    try {
      const safe = file.name.replace(/[^a-z0-9.-]/gi, '_');
      const r = ref(storage, `video/${uid}/montagem-avatar/${Date.now()}-${safe}`);
      await uploadBytes(r, file, { contentType: file.type || 'video/mp4' });
      const url = await getDownloadURL(r);
      setAvatarBase(url);
      toast.success('Avatar base carregado — escolha o layout (PiP/split) em cada trecho.');
    } catch (e: any) {
      toast.error(e?.message || 'Falha no upload do avatar.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  // Busca no Pexels e adiciona o clipe escolhido à BIBLIOTECA (pool), pra você
  // posicionar na timeline igual aos seus trechos.
  const doPexSearch = async () => {
    const q = pexQuery.trim();
    if (!q) return;
    setPexSearching(true);
    try {
      const params = new URLSearchParams({ query: q, orientation: pexOrient, perPage: '12' });
      const r = await fetch(`/api/pexels/search?${params.toString()}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Falha na busca.');
      setPexResults(Array.isArray(data.clips) ? data.clips : []);
    } catch (e: any) {
      toast.error(e?.message || 'Erro no Pexels.');
    } finally {
      setPexSearching(false);
    }
  };
  const addPexClip = (clip: any) => {
    setClips((prev) => [
      ...prev,
      { url: clip.url, label: `Pexels ${prev.length + 1}`, duration: Number(clip.duration) || undefined },
    ]);
    toast.success('B-roll adicionado à biblioteca — agora posicione na timeline.');
  };

  // "Adicionar aqui": marca o segundo do playhead e pede pra escolher o clipe.
  const addHere = () => {
    if (clips.length === 0) return toast.error('Suba seus trechos primeiro (botão abaixo).');
    setPicking(Number(playhead.toFixed(2)));
  };
  const pickClip = async (clipIdx: number) => {
    if (picking == null) return;
    const at = picking;
    setPicking(null);
    let dur = clips[clipIdx]?.duration || 0;
    if (!dur) {
      const url = clips[clipIdx]?.url;
      dur = (url ? await readDurationFromUrl(url) : 0) || 5;
      // guarda no clipe pra próxima vez
      if (clips[clipIdx]) setClips((prev) => prev.map((c, k) => (k === clipIdx ? { ...c, duration: dur } : c)));
    }
    setItems((prev) => [...prev, { clipIdx, atSec: at, endSec: Number((at + dur).toFixed(2)) }]);
  };
  const updateItem = (idx: number, key: 'atSec' | 'endSec', val: string) =>
    setItems((prev) =>
      prev.map((it, k) => {
        if (k !== idx) return it;
        const n = Math.max(0, Number(val) || 0);
        if (key === 'atSec') {
          // mover o início mantém a duração: o fim acompanha.
          const dur = itemEnd(it) - it.atSec;
          return { ...it, atSec: n, endSec: Number((n + dur).toFixed(2)) };
        }
        return { ...it, endSec: n };
      })
    );
  const removeItem = (idx: number) =>
    setItems((prev) => {
      const target = prev[idx];
      const remaining = prev.filter((_, k) => k !== idx);
      if (!target) return remaining;
      // Vizinhos NO TEMPO (o trecho apagado leva junto efeitos/som/transições).
      const before = remaining
        .filter((it) => it.atSec <= target.atSec)
        .sort((a, b) => b.atSec - a.atSec)[0];
      const after = remaining
        .filter((it) => it.atSec >= target.atSec)
        .sort((a, b) => a.atSec - b.atSec)[0];
      if (!before || !after || before === after) return remaining;
      // Re-linka: a SAÍDA do anterior casa com a ENTRADA do próximo (transição
      // linkável + whoosh), pra conectar smooth sem sobra da transição apagada.
      const LINKABLE = new Set(['slideleft', 'slideright', 'slideup', 'slidedown', 'dissolve', 'whip']);
      const whoosh = soundForTransition('slideleft');
      const link = LINKABLE.has(after.transIn || '') ? after.transIn! : 'dissolve';
      return remaining.map((it) => {
        if (it === before)
          return { ...it, transOut: link, transOutDur: it.transOutDur || 0.15, soundOut: whoosh };
        if (it === after) return { ...it, transIn: link, transInDur: it.transInDur || 0.15 };
        return it;
      });
    });
  const setItemField = (idx: number, patch: Partial<TLItem>) =>
    setItems((prev) => prev.map((it, k) => (k === idx ? { ...it, ...patch } : it)));

  // Texto cinético na tela.
  const addText = () =>
    setTexts((prev) => [
      ...prev,
      {
        text: 'PALAVRA',
        atSec: Number(playhead.toFixed(2)),
        endSec: Number((playhead + 1.5).toFixed(2)),
        color: '#39FF14',
        pos: 'middle',
      },
    ]);
  const updateText = (i: number, patch: Partial<TextItem>) =>
    setTexts((prev) => prev.map((t, k) => (k === i ? { ...t, ...patch } : t)));
  const removeText = (i: number) => setTexts((prev) => prev.filter((_, k) => k !== i));

  // ── AUTO-EDITAR ───────────────────────────────────────────────────────────
  // Transcreve a voz base → fatia em slots pelo RITMO da VSL de referência →
  // busca 1 b-roll no Pexels por trecho (palavra-chave) → aplica transições +
  // SFX + alguns textos. Preenche a timeline pra você revisar e trocar o que
  // quiser (o b-roll exato de cada trecho fica fácil de trocar depois).
  const STOPWORDS = new Set(
    'the a an and or but of to in on for with is are was were it that this you your i we they he she a o os as e ou que com para um uma do da no na se em por como mais mas se sua seu meu minha isso este esta'.split(
      ' '
    )
  );
  // Acha o TEMPO (s) em que uma frase começa a ser dita, casando as palavras da
  // frase com as palavras transcritas do trecho. Retorna null se não achar.
  const phraseStartSec = (
    words: { text: string; start: number; end: number }[],
    phrase: string
  ): number | null => {
    const norm = (s: string) =>
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]/g, '');
    const pw = phrase.split(/\s+/).map(norm).filter(Boolean);
    if (!pw.length) return null;
    const ww = words.map((w) => norm(w.text));
    // 1) match EXATO da frase inteira (ideal).
    for (let i = 0; i + pw.length <= ww.length; i++) {
      let ok = true;
      for (let j = 0; j < pw.length; j++)
        if (ww[i + j] !== pw[j]) {
          ok = false;
          break;
        }
      if (ok) return words[i]!.start / 1000;
    }
    // 2) melhor casamento PARCIAL: a posição onde MAIS palavras da frase batem
    //    em sequência — pega o início dessa sequência (robusto a 1-2 palavras
    //    diferentes por paráfrase/pontuação).
    let bestStart = -1;
    let bestRun = 0;
    for (let i = 0; i < ww.length; i++) {
      let run = 0;
      for (let j = 0; j < pw.length && i + j < ww.length; j++) {
        if (ww[i + j] === pw[j]) run++;
      }
      if (run > bestRun) {
        bestRun = run;
        bestStart = i;
      }
    }
    if (bestRun >= 1 && bestStart >= 0) return words[bestStart]!.start / 1000;
    // 3) fallback: 1ª palavra "forte" da frase em qualquer lugar.
    for (const p of pw) {
      const idx = ww.findIndex((w) => w === p);
      if (idx >= 0) return words[idx]!.start / 1000;
    }
    return null;
  };
  const autoEdit = async () => {
    if (!audioUrl) {
      toast.error('Escolha a Voz da VSL como base primeiro (botão "Usar Voz da VSL").');
      return;
    }
    setAutoEditing(true);
    const tid = 'auto-edit';
    toast.loading('Transcrevendo a VSL… (pode levar alguns minutos)', { id: tid });
    try {
      const tr = await fetch('/api/video/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioUrl }),
      });
      const td = await tr.json();
      if (!tr.ok) throw new Error(td.error || 'Falha na transcrição.');
      const words: { text: string; start: number; end: number }[] = td.words || [];
      if (words.length === 0) throw new Error('A transcrição não retornou palavras.');

      // Ritmo escolhido pelo usuário (base dos cortes, em s). Menor = mais trechos.
      // Menos ~12-15s · Médio ~9-11s · Mais ~6-8s · Muito ~4-5s.
      const avgCutSec = Math.max(3, Math.min(cutPace, 20));
      // Variação leve (±15%) DENTRO da banda escolhida — natural, sem robótico e
      // sem estourar a faixa (nada de rajadas de 2s que furavam o "Menos").
      const rand = (a: number, b: number) => a + Math.random() * (b - a);
      const nextTargetMs = (): number => rand(avgCutSec * 0.85, avgCutSec * 1.15) * 1000;
      let curTargetMs = nextTargetMs();

      // Fatia em slots (snap no fim da palavra), guardando o TEXTO do trecho E
      // a palavra FALADA mais forte com o TIMING EXATO dela (pro texto na tela
      // aparecer no momento em que é dita — não o termo de busca em inglês).
      const slots: {
        start: number;
        end: number;
        text: string;
        keyword: string;
        spokenWord: string;
        wordStart: number;
        wordEnd: number;
        words: { text: string; start: number; end: number }[];
      }[] = [];
      let s0 = words[0]!.start;
      let cur: { text: string; start: number; end: number }[] = [];
      for (let i = 0; i < words.length; i++) {
        cur.push(words[i]!);
        const last = i === words.length - 1;
        if (words[i]!.end - s0 >= curTargetMs || last) {
          const text = cur.map((w) => w.text).join(' ');
          const clean = (w: string) => w.replace(/[^a-zA-ZÀ-ÿ]/g, '');
          const best =
            cur
              .filter((w) => {
                const c = clean(w.text);
                return c.length > 3 && !STOPWORDS.has(c.toLowerCase());
              })
              .sort((a, b) => clean(b.text).length - clean(a.text).length)[0] || cur[0]!;
          slots.push({
            start: s0 / 1000,
            end: words[i]!.end / 1000,
            text,
            keyword: clean(best.text) || cur[0]!.text || 'business',
            spokenWord: clean(best.text),
            wordStart: best.start / 1000,
            wordEnd: best.end / 1000,
            words: [...cur],
          });
          s0 = words[i]!.end;
          cur = [];
          curTargetMs = nextTargetMs(); // próximo corte com duração variada
        }
      }

      // Efeitos sonoros CONTEXTUAIS disponíveis (categoria "Efeitos" da
      // biblioteca) — NUNCA Impactos (Vine Boom fica só no manual).
      let libEffects: { name: string; url: string }[] = [];
      try {
        const lib = JSON.parse(localStorage.getItem('metavise-sound-library') || '[]') as any[];
        libEffects = lib
          .filter((x) => x?.category === 'Efeitos' && x?.name && x?.url)
          .map((x) => ({ name: String(x.name), url: String(x.url) }));
      } catch {
        /* sem efeitos */
      }

      // IA: gera um termo de busca VISUAL por trecho (entende a frase inteira,
      // não uma palavra solta) e, se encaixar, um efeito sonoro contextual.
      // Fallback pra keyword se a IA falhar.
      toast.loading('IA planejando cada trecho (b-roll, som, estilo, destaque)…', { id: tid });
      const queries: string[] = slots.map((s) => s.keyword);
      const effectNames: (string | null)[] = slots.map(() => null);
      const styles: string[] = slots.map(() => 'real');
      const tones: string[] = slots.map(() => 'now');
      const highlights: (string | null)[] = slots.map(() => null);
      const splits: boolean[] = slots.map(() => false);
      try {
        const qr = await fetch('/api/claude/broll-queries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            segments: slots.map((s) => s.text),
            effects: libEffects.map((e) => e.name),
          }),
        });
        const qd = await qr.json();
        if (qd?.success && Array.isArray(qd.queries)) {
          qd.queries.forEach((q: string, i: number) => {
            if (q && q.trim()) queries[i] = q.trim();
          });
          if (Array.isArray(qd.effects)) {
            qd.effects.forEach((name: string, i: number) => {
              if (name && libEffects.some((e) => e.name.trim().toLowerCase() === String(name).trim().toLowerCase()))
                effectNames[i] = name;
            });
          }
          if (Array.isArray(qd.styles)) qd.styles.forEach((v: string, i: number) => (styles[i] = v));
          if (Array.isArray(qd.tones)) qd.tones.forEach((v: string, i: number) => (tones[i] = v));
          if (Array.isArray(qd.highlights))
            qd.highlights.forEach((v: string, i: number) => (highlights[i] = v || null));
          if (Array.isArray(qd.splits)) qd.splits.forEach((v: boolean, i: number) => (splits[i] = !!v));
          window.dispatchEvent(new Event('claude-usage-changed'));
        }
      } catch {
        /* mantém keywords */
      }

      // Estilo "animação" → busca b-roll de animação/diagrama (bom pra conceitos
      // científicos: intestino, bactérias, corpo por dentro…).
      const searchQueries = queries.map((q, i) =>
        styles[i] === 'animation' ? `${q} animation` : q
      );

      // Busca CANDIDATOS por query única (cache) — 6 opções por termo.
      const cache: Record<string, { url: string; thumb: string; duration?: number }[]> = {};
      const uniq = Array.from(new Set(searchQueries.map((q) => q.toLowerCase())));
      for (let k = 0; k < uniq.length; k++) {
        toast.loading(`Buscando b-rolls ${k + 1}/${uniq.length}…`, { id: tid });
        try {
          const pr = await fetch(
            `/api/pexels/search?query=${encodeURIComponent(uniq[k]!)}&orientation=${pexOrient}`
          );
          const pd = await pr.json();
          const list = (pd?.clips || pd?.data?.clips || []) as any[];
          cache[uniq[k]!] = list
            .slice(0, 6)
            .map((c) => ({ url: c.url, thumb: c.thumb || c.image || '', duration: c.duration }));
        } catch {
          cache[uniq[k]!] = [];
        }
      }

      const built: AutoSlot[] = slots.map((s, i) => {
        const q = searchQueries[i] || s.keyword;
        const cands = cache[q.toLowerCase()] || [];
        const effName = effectNames[i];
        const eff = effName
          ? libEffects.find((e) => e.name.trim().toLowerCase() === effName.trim().toLowerCase())
          : undefined;
        const hlPhrase = highlights[i] || undefined;
        const hlStart = hlPhrase ? phraseStartSec(s.words, hlPhrase) ?? s.start : undefined;
        return {
          start: Number(s.start.toFixed(2)),
          end: Number(s.end.toFixed(2)),
          keyword: q,
          searchTerm: q,
          candidates: cands,
          chosen: cands[0]?.url || '',
          spokenWord: s.spokenWord,
          wordStart: s.wordStart,
          wordEnd: s.wordEnd,
          highlight: hlPhrase,
          highlightStart: hlStart,
          style: styles[i],
          tone: tones[i],
          split: splits[i],
          effectName: eff?.name,
          effectUrl: eff?.url,
        };
      });
      setAutoSlots(built);
      // Diagnóstico: mostra quantos efeitos/destaques/P&B/animação a IA marcou —
      // ajuda a ver se o problema é escolha (nenhum marcado) ou render (link ruim).
      const nFx = built.filter((b) => b.effectUrl).length;
      const nHl = built.filter((b) => b.highlight).length;
      const nBw = built.filter((b) => b.tone === 'past').length;
      const nAnim = built.filter((b) => b.style === 'animation').length;
      const nSplit = built.filter((b) => b.split).length;
      toast.success(
        `${built.length} trechos · ${nFx} efeitos · ${nHl} destaques · ${nBw} P&B · ${nAnim} animação · ${nSplit} split. Escolha os b-rolls e "Aplicar".`,
        { id: tid, duration: 7000 }
      );
      if (libEffects.length === 0)
        toast('Dica: sua biblioteca não tem efeitos na categoria "Efeitos" — por isso 0 efeitos contextuais.', {
          duration: 7000,
          icon: '🔊',
        });
    } catch (e: any) {
      toast.error(e?.message || 'Erro no auto-edit.', { id: tid });
    } finally {
      setAutoEditing(false);
    }
  };

  const chooseCandidate = (i: number, url: string) =>
    setAutoSlots((prev) => prev.map((s, k) => (k === i ? { ...s, chosen: url } : s)));

  const researchSlot = async (i: number, term: string) => {
    if (!term.trim()) return;
    setResearchingSlot(i);
    try {
      const pr = await fetch(
        `/api/pexels/search?query=${encodeURIComponent(term)}&orientation=${pexOrient}`
      );
      const pd = await pr.json();
      const list = (pd?.clips || pd?.data?.clips || []) as any[];
      const cands = list
        .slice(0, 6)
        .map((c) => ({ url: c.url, thumb: c.thumb || c.image || '', duration: c.duration }));
      setAutoSlots((prev) =>
        prev.map((s, k) =>
          k === i ? { ...s, searchTerm: term, candidates: cands, chosen: cands[0]?.url || '' } : s
        )
      );
    } catch {
      toast.error('Falha na busca.');
    } finally {
      setResearchingSlot(null);
    }
  };

  // Aplica os slots escolhidos na timeline (clipes + transições + SFX + textos).
  const applyAutoSlots = () => {
    const chosenSlots = autoSlots.filter((s) => s.chosen);
    if (chosenSlots.length === 0) {
      toast.error('Escolha o b-roll de pelo menos um trecho.');
      return;
    }
    // VARIEDADE de transições — SÓ tipos "linkáveis" (slides / crossfade / whip),
    // que rodam nos DOIS lados do corte (saída do trecho + entrada do próximo).
    // Assim TODO corte tem transição de verdade (sem "vazio") e sem tela preta.
    // (Zoom/glitch/flash ficam no manual, por trecho.) Swoosh 7 em todo corte.
    const VARIETY = [
      'slideleft', 'dissolve', 'whip', 'slideright', 'dissolve', 'slideup', 'whip', 'slideleft', 'dissolve', 'slideright',
    ];
    const LINKABLE = new Set(['slideleft', 'slideright', 'slideup', 'slidedown', 'dissolve', 'whip']);
    const whoosh = soundForTransition('slideleft'); // Swoosh 7
    const base = clips.length;
    // Agrupa trechos SEGUIDOS com o MESMO clipe → vira 1 item CONTÍNUO (ex.: teu
    // vídeo cobrindo vários trechos), sem transição/som no meio. Pexels normal
    // (URLs diferentes em cada trecho) não agrupa — segue trecho a trecho.
    const groups: (typeof chosenSlots)[] = [];
    chosenSlots.forEach((s) => {
      const last = groups[groups.length - 1];
      if (last && last[last.length - 1]!.chosen === s.chosen) last.push(s);
      else groups.push([s]);
    });
    // Monta os clipes; trechos SPLIT (só quando é um trecho único) ganham um 2º
    // b-roll usando outro candidato do mesmo termo.
    const newClips: { url: string; label: string }[] = [];
    const newItems = groups.map((grp, k) => {
      const first = grp[0]!;
      const lastSlot = grp[grp.length - 1]!;
      const clipIdx = base + newClips.length;
      newClips.push({ url: first.chosen, label: `Auto ${k + 1}` });
      let clipIdx2: number | undefined;
      if (grp.length === 1 && first.split) {
        const right =
          first.candidates.find((c) => c.url && c.url !== first.chosen)?.url || first.chosen;
        clipIdx2 = base + newClips.length;
        newClips.push({ url: right, label: `Auto ${k + 1}B` });
      }
      return {
        clipIdx,
        clipIdx2,
        atSec: first.start,
        endSec: lastSlot.end, // grupo mesclado cobre do 1º ao último trecho
        transIn: k > 0 ? VARIETY[(k - 1) % VARIETY.length]! : 'none',
        transInDur: 0.15,
        soundIn: '',
        transOut: 'none' as string, // preenchido no 2º passo (link com o próximo)
        transOutDur: 0.15,
        soundOut: '',
        // Efeito sonoro contextual DESMARCADO por padrão (só sons de transição).
        soundMid: '',
        soundMidAlign: '' as const,
        // P&B DESMARCADO por padrão.
        bw: false,
        keyword: first.searchTerm || first.keyword,
      };
    });
    // 2º passo: transição + Swoosh 7 ENTRE grupos (dentro do grupo é contínuo).
    for (let k = 0; k < newItems.length - 1; k++) {
      const nextIn = newItems[k + 1]!.transIn;
      newItems[k]!.transOut = LINKABLE.has(nextIn) ? nextIn : 'none';
      newItems[k]!.soundOut = whoosh;
    }
    // Textos na tela vêm DESATIVADOS por padrão — o Auto-editar NÃO adiciona
    // texto sozinho. O usuário adiciona manualmente (botão "+ no playhead") se
    // quiser. (A IA ainda detecta os destaques, só não vira texto automático.)
    setClips((prev) => [...prev, ...newClips]);
    setItems((prev) => [...prev, ...newItems]);
    setAutoSlots([]);
    toast.success(`${newItems.length} trechos aplicados na timeline. Revise e monte os grupos.`);
  };

  // Trocar o b-roll de um TRECHO já na timeline (busca Pexels e substitui o clipe).
  const searchSwap = async (term: string) => {
    setBrollSwap((prev) => (prev ? { ...prev, term, loading: true } : prev));
    try {
      const pr = await fetch(
        `/api/pexels/search?query=${encodeURIComponent(term || 'nature')}&orientation=${pexOrient}`
      );
      const pd = await pr.json();
      const list = (pd?.clips || pd?.data?.clips || []) as any[];
      setBrollSwap((prev) =>
        prev
          ? {
              ...prev,
              loading: false,
              candidates: list.slice(0, 12).map((c) => ({ url: c.url, thumb: c.thumb || c.image || '' })),
            }
          : prev
      );
    } catch {
      setBrollSwap((prev) => (prev ? { ...prev, loading: false } : prev));
    }
  };
  const openSwap = (idx: number) => {
    const term = (items[idx]?.keyword as string) || '';
    setBrollSwap({ itemIdx: idx, term, candidates: [], loading: !!term, mode: 'swap' });
    if (term) searchSwap(term);
  };
  // "+ split": ESCOLHE sozinho um 2º b-roll (busca pelo termo do trecho e pega
  // um diferente do atual). Sem modal — o usuário só troca no ⇄ se quiser.
  const autoAddSplit = async (idx: number) => {
    const it = items[idx];
    if (!it) return;
    const term = ((it.keyword as string) || '').trim() || 'lifestyle';
    const currentUrl = clips[it.clipIdx]?.url;
    toast.loading('Escolhendo b-roll pro split…', { id: 'auto-split' });
    try {
      const pr = await fetch(
        `/api/pexels/search?query=${encodeURIComponent(term)}&orientation=${pexOrient}`
      );
      const pd = await pr.json();
      const list = (pd?.clips || pd?.data?.clips || []) as any[];
      const pick = list.find((c) => c.url && c.url !== currentUrl) || list[0];
      if (!pick?.url) throw new Error('sem b-roll');
      setClips((prev) => {
        const newIdx = prev.length;
        setItemField(idx, { clipIdx2: newIdx });
        return [...prev, { url: pick.url, label: `Split ${idx + 1}` }];
      });
      toast.success('Split criado — troque o 2º b-roll no ⇄ se quiser.', { id: 'auto-split' });
    } catch {
      toast.error('Não achei b-roll pro split — troque no ⇄.', { id: 'auto-split' });
    }
  };
  // Abre o picker pra TROCAR o 2º b-roll (split) do trecho.
  const openAddSplit = (idx: number) => {
    const term = (items[idx]?.keyword as string) || '';
    setBrollSwap({ itemIdx: idx, term, candidates: [], loading: !!term, mode: 'split' });
    if (term) searchSwap(term);
  };
  const pickSwap = (url: string) => {
    if (!brollSwap) return;
    const it = items[brollSwap.itemIdx];
    if (!it) {
      setBrollSwap(null);
      return;
    }
    if (brollSwap.mode === 'split') {
      if (it.clipIdx2 != null) {
        // Troca o 2º b-roll que já existe.
        const idx2 = it.clipIdx2;
        setClips((prev) => prev.map((c, k) => (k === idx2 ? { ...c, url, duration: undefined } : c)));
        toast.success('2º b-roll do split trocado.');
      } else {
        // (fallback) cria o split apontando pro novo clipe.
        setClips((prev) => {
          const newIdx = prev.length;
          setItemField(brollSwap.itemIdx, { clipIdx2: newIdx });
          return [...prev, { url, label: `Split ${brollSwap.itemIdx + 1}` }];
        });
        toast.success('Split criado.');
      }
      setBrollSwap(null);
      return;
    }
    setClips((prev) => prev.map((c, k) => (k === it.clipIdx ? { ...c, url, duration: undefined } : c)));
    setBrollSwap(null);
    toast.success('B-roll trocado.');
  };

  // Excluir um trecho da biblioteca + reindexar os itens da timeline.
  const deletePoolClip = (ci: number) => {
    setItems((prev) =>
      prev
        .filter((it) => it.clipIdx !== ci)
        .map((it) => (it.clipIdx > ci ? { ...it, clipIdx: it.clipIdx - 1 } : it))
    );
    setClips((prev) => prev.filter((_, k) => k !== ci));
  };

  // Sequência (sem áudio)
  const move = (i: number, dir: -1 | 1) =>
    setClips((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const out = [...prev];
      [out[i], out[j]] = [out[j]!, out[i]!];
      return out;
    });
  const removeClip = (i: number) => setClips((prev) => prev.filter((_, k) => k !== i));
  const setTrim = (i: number, key: 'startSec' | 'endSec', val: string) => {
    const n = val === '' ? undefined : Math.max(0, Number(val) || 0);
    setClips((prev) => prev.map((c, k) => (k === i ? { ...c, [key]: n } : c)));
  };

  // Trechos com AVATAR CONTÍNUO (mesmo layout e lado: avatar tela cheia, PiP no
  // mesmo canto, ou split no mesmo lado) NÃO levam transição no meio — ela
  // sacudiria o avatar à toa. 'full' (só b-roll) não conta. Se o lado/layout
  // muda (split-left→split-right, avatar→full, etc.), a transição fica.
  const avatarContinuousBoundary = (a?: TLItem, b?: TLItem) =>
    !!avatarBase && !!a?.layout && a.layout !== 'full' && a.layout === b?.layout;

  const compose = async () => {
    if (!uid) return;
    setRendering(true);
    const toastId = 'montagem-render';
    toast.loading(isTimeline ? 'Montando no tempo do áudio...' : 'Montando a sequência...', {
      id: toastId,
    });
    try {
      let data: any;
      if (isTimeline) {
        if (items.length === 0) throw new Error('Adicione pelo menos um trecho na timeline.');
        const sorted = [...items].sort((a, b) => a.atSec - b.atSec);
        const r = await fetch('/api/video/timeline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: uid,
            audioUrl,
            durationSec: audioDuration,
            aspectRatio: aspect,
            fit,
            texts,
            clips: sorted.map((it, i, arr) => {
              // Avatar contínuo → sem transição (nem som) no corte do meio.
              const inCut = i > 0 && avatarContinuousBoundary(arr[i - 1], it);
              const outCut = i < arr.length - 1 && avatarContinuousBoundary(it, arr[i + 1]);
              return {
              url: clips[it.clipIdx]?.url,
              url2: it.clipIdx2 != null ? clips[it.clipIdx2]?.url : undefined,
              layout: it.layout && it.layout !== 'full' && avatarBase ? it.layout : undefined,
              avatarUrl: it.layout && it.layout !== 'full' && avatarBase ? avatarBase : undefined,
              avatarSeek: it.layout && it.layout !== 'full' && avatarBase ? avatarStartSec + it.atSec : undefined,
              splitCX: it.layout && it.layout !== 'full' && avatarBase ? framing.splitCX : undefined,
              splitCY: it.layout && it.layout !== 'full' && avatarBase ? framing.splitCY : undefined,
              splitSize: it.layout && it.layout !== 'full' && avatarBase ? framing.splitSize : undefined,
              pipCX: it.layout && it.layout !== 'full' && avatarBase ? framing.pipCX : undefined,
              pipCY: it.layout && it.layout !== 'full' && avatarBase ? framing.pipCY : undefined,
              pipSize: it.layout && it.layout !== 'full' && avatarBase ? framing.pipSize : undefined,
              cropL: it.layout && it.layout !== 'full' && avatarBase ? framing.cropL : undefined,
              cropR: it.layout && it.layout !== 'full' && avatarBase ? framing.cropR : undefined,
              cropT: it.layout && it.layout !== 'full' && avatarBase ? framing.cropT : undefined,
              cropB: it.layout && it.layout !== 'full' && avatarBase ? framing.cropB : undefined,
              atSec: it.atSec,
              endSec: itemEnd(it),
              trimStart: 0,
              transIn: inCut ? 'none' : it.transIn || 'none',
              transInDur: it.transInDur || 0.1,
              soundIn: inCut ? '' : it.soundIn || '',
              soundMid: it.soundMid || '',
              soundMidAlign: it.soundMidAlign || '',
              bw: it.bw || false,
              transOut: outCut ? 'none' : it.transOut || 'none',
              transOutDur: it.transOutDur || 0.1,
              soundOut: outCut ? '' : it.soundOut || '',
              };
            }),
          }),
        });
        data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Falha ao montar.');
      } else {
        if (clips.length === 0) throw new Error('Suba seus trechos.');
        const r = await fetch('/api/video/sequence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: uid,
            muted,
            clips: clips.map((c) => ({ url: c.url, startSec: c.startSec, endSec: c.endSec })),
          }),
        });
        data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Falha ao montar.');
      }
      setResultUrl(data.url);
      onAddUploadedVideo?.(
        { url: data.url, uploaded: true, aspectRatio: aspect, createdAt: new Date().toISOString() },
        false
      );
      toast.success('Pronto — já está na Edição.', { id: toastId });
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao montar.', { id: toastId });
    } finally {
      setRendering(false);
    }
  };

  // Gera a música (arco emocional a partir da copy) e COLA embaixo do vídeo
  // montado, num clique — plan → generate → add-music. Casa com a montagem.
  const gerarMusicaEColar = async () => {
    if (!uid) return toast.error('Faça login.');
    if (!resultUrl) return toast.error('Monte o vídeo primeiro.');
    const copyText =
      ((config.copy as any)?.finalScript as string) ||
      ((config.copy as any)?.optimizedScript as string) ||
      ((config.copy as any)?.generatedScript as string) ||
      ((config as any)?.copyVsl?.finalScript as string) ||
      '';
    setMusicGen(true);
    const tid = 'montagem-music';
    toast.loading('Planejando a música (arco emocional)…', { id: tid });
    try {
      const pr = await fetch('/api/elevenlabs/music/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          copy: copyText,
          totalDurationSec: Math.max(5, Math.round(audioDuration)),
        }),
      });
      const plan = await pr.json();
      if (!pr.ok) throw new Error(plan.error || 'Falha ao planejar a música.');
      toast.loading('Compondo a trilha…', { id: tid });
      const gr = await fetch('/api/elevenlabs/music/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ compositionPlan: plan, forceInstrumental: true }),
      });
      const gd = await gr.json();
      if (!gr.ok || !gd.audioUrl) throw new Error(gd.error || 'Falha ao gerar a música.');
      toast.loading('Colando a música no vídeo…', { id: tid });
      const ar = await fetch('/api/video/add-music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: resultUrl, musicUrl: gd.audioUrl, volume: 0.12, userId: uid }),
      });
      const ad = await ar.json();
      if (!ar.ok || !ad.url) throw new Error(ad.error || 'Falha ao colar a música.');
      setResultUrl(ad.url);
      onAddUploadedVideo?.(
        { url: ad.url, uploaded: true, aspectRatio: aspect, createdAt: new Date().toISOString() },
        false
      );
      toast.success('Música adicionada — vídeo com trilha pronto!', { id: tid });
    } catch (e: any) {
      toast.error(e?.message || 'Erro na música.', { id: tid });
    } finally {
      setMusicGen(false);
    }
  };

  useEffect(() => {
    try {
      localStorage.setItem('metavise-montagem-templates', JSON.stringify(templates));
    } catch {
      /* ignora */
    }
  }, [templates]);

  const saveTemplate = () => {
    const name = (window.prompt('Nome do molde (ex.: "VSL reborn 1:1"):') || '').trim();
    if (!name) return;
    setTemplates((prev) => [...prev.filter((t) => t.name !== name), { name, aspect, fit, cutPace }]);
    toast.success(`Molde "${name}" salvo.`);
  };
  const applyTemplate = (name: string) => {
    const t = templates.find((x) => x.name === name);
    if (!t) return;
    setAspect(t.aspect as any);
    setFit(t.fit as any);
    setCutPace(t.cutPace);
    toast.success(`Molde "${name}" aplicado — agora é só Auto-editar.`);
  };

  const displayItems = items.map((it, idx) => ({ it, idx })).sort((a, b) => a.it.atSec - b.it.atSec);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <SoundLibraryModal
        open={!!soundPicker || soundLibManage}
        userId={uid}
        onClose={() => {
          setSoundPicker(null);
          setSoundLibManage(false);
        }}
        onPick={(url) => {
          if (!soundPicker) return;
          const patch: any = { [soundPicker.field]: url };
          if (soundPicker.field === 'soundMid') {
            const nm = libSounds.find((s) => s.url === url)?.name || '';
            patch.soundMidAlign = /reversed|riser|reverse/i.test(nm) ? 'end' : '';
          }
          setItemField(soundPicker.idx, patch);
        }}
      />

      {/* Enquadrar avatar (split + PiP) — calibrado 1× por avatar */}
      {framingModalOpen && avatarBase && (
        <AvatarFramingModal
          avatarUrl={avatarBase}
          aspect={aspect}
          value={framing}
          onClose={() => setFramingModalOpen(false)}
          onSave={(f) => {
            setAvatarFraming((prev) => ({ ...prev, [avatarBase]: f }));
            setFramingModalOpen(false);
            toast.success('Enquadramento salvo — vale pra todos os trechos deste avatar.');
          }}
        />
      )}

      {/* Trocar b-roll de um trecho da timeline */}
      {brollSwap && (
        <div
          className="fixed inset-0 z-[121] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setBrollSwap(null)}
        >
          <div
            className="w-full max-w-3xl max-h-[85vh] overflow-hidden bg-white dark:bg-gray-900 rounded-3xl border-2 border-gray-200 dark:border-gray-800 shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 p-4 border-b border-gray-200 dark:border-gray-800">
              <input
                autoFocus
                value={brollSwap.term}
                onChange={(e) => setBrollSwap((p) => (p ? { ...p, term: e.target.value } : p))}
                onKeyDown={(e) => e.key === 'Enter' && searchSwap(brollSwap.term)}
                placeholder="Buscar b-roll no Pexels…"
                className="flex-1 px-3 py-2 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100 text-sm"
              />
              <button
                onClick={() => searchSwap(brollSwap.term)}
                disabled={brollSwap.loading}
                className="text-xs font-black uppercase tracking-widest px-4 py-2 rounded-xl bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 disabled:opacity-50"
              >
                {brollSwap.loading ? '…' : 'Buscar'}
              </button>
              {myProjectVideos.length > 0 && (
                <button
                  onClick={() => setSwapMyVid((v) => !v)}
                  className={`text-xs font-black uppercase tracking-widest px-3 py-2 rounded-xl border-2 ${
                    swapMyVid
                      ? 'border-blue-500 bg-blue-600 text-white'
                      : 'border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                  }`}
                >
                  🎬 Meus vídeos
                </button>
              )}
              <button onClick={() => setBrollSwap(null)} className="p-1.5 text-gray-400 hover:text-gray-700">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {swapMyVid && myProjectVideos.length > 0 && (
                <div className="mb-4 space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-blue-500 dark:text-blue-400">
                    🎬 Meus vídeos do projeto
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {myProjectVideos.map((mv) => (
                      <button
                        key={mv.url}
                        onClick={() => pickSwap(mv.url)}
                        onMouseEnter={(e) => e.currentTarget.querySelector('video')?.play().catch(() => {})}
                        onMouseLeave={(e) => e.currentTarget.querySelector('video')?.pause()}
                        title={mv.label}
                        className="relative aspect-video rounded-lg overflow-hidden border-2 border-blue-300/50 hover:border-blue-400"
                      >
                        <video
                          src={mv.url}
                          muted
                          loop
                          playsInline
                          preload="metadata"
                          onLoadedMetadata={(e) => {
                            const d = (e.target as HTMLVideoElement).duration;
                            if (d && isFinite(d))
                              setMyVidDur((prev) => (prev[mv.url] ? prev : { ...prev, [mv.url]: d }));
                          }}
                          className="w-full h-full object-cover"
                        />
                        <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[9px] px-1 flex items-center justify-between gap-1">
                          <span className="truncate">{mv.label}</span>
                          {(mv.duration ?? myVidDur[mv.url]) ? (
                            <span className="tabular-nums shrink-0 font-black">
                              {(mv.duration ?? myVidDur[mv.url])!.toFixed(1)}s
                            </span>
                          ) : null}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {brollSwap.candidates.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">
                  Busque um termo pra ver os b-rolls.
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {brollSwap.candidates.map((c) => (
                    <button
                      key={c.url}
                      onClick={() => pickSwap(c.url)}
                      onMouseEnter={(e) => e.currentTarget.querySelector('video')?.play().catch(() => {})}
                      onMouseLeave={(e) => e.currentTarget.querySelector('video')?.pause()}
                      className="relative aspect-video rounded-lg overflow-hidden border-2 border-transparent hover:border-blue-400"
                    >
                      <video
                        src={c.url}
                        poster={c.thumb || undefined}
                        muted
                        loop
                        playsInline
                        preload="none"
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* AUTO-EDITAR — picker de b-roll por trecho */}
      {autoSlots.length > 0 && (
        <div className="fixed inset-0 z-[120] flex flex-col bg-black/70 backdrop-blur-sm p-3 sm:p-6">
          <div className="flex-1 min-h-0 w-full max-w-4xl mx-auto bg-white dark:bg-gray-900 rounded-3xl border-2 border-gray-200 dark:border-gray-800 shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-3 p-4 border-b border-gray-200 dark:border-gray-800">
              <div>
                <h3 className="text-lg font-black text-gray-900 dark:text-gray-50">
                  Escolha o b-roll de cada trecho
                </h3>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  {autoSlots.length} trechos planejados no ritmo da referência. Clique no b-roll de
                  cada um (ou busque outro termo).
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setAutoSlots([])}
                  className="text-[10px] font-black uppercase tracking-widest px-3 py-2 rounded-lg text-gray-500 hover:text-red-500"
                >
                  Cancelar
                </button>
                <button
                  onClick={applyAutoSlots}
                  className="text-xs font-black uppercase tracking-widest px-4 py-2.5 rounded-xl bg-purple-600 text-white hover:bg-purple-700"
                >
                  Aplicar à timeline
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {autoSlots.map((s, i) => (
                <div
                  key={i}
                  className="rounded-2xl border border-gray-200 dark:border-gray-800 p-3 space-y-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-black text-gray-700 dark:text-gray-300">
                      Trecho {i + 1}
                    </span>
                    <span className="text-[10px] text-gray-400">
                      {Math.round(s.start)}–{Math.round(s.end)}s
                    </span>
                    <button
                      onClick={() => playSegment(s.start, s.end)}
                      className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/40"
                      title="Ouvir este trecho da narração"
                    >
                      <Play size={11} /> Ouvir
                    </button>
                    <input
                      value={s.searchTerm}
                      onChange={(e) =>
                        setAutoSlots((prev) =>
                          prev.map((x, k) => (k === i ? { ...x, searchTerm: e.target.value } : x))
                        )
                      }
                      onKeyDown={(e) => e.key === 'Enter' && researchSlot(i, s.searchTerm)}
                      className="flex-1 min-w-[120px] px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100 text-xs"
                    />
                    <button
                      onClick={() => researchSlot(i, s.searchTerm)}
                      disabled={researchingSlot === i}
                      className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 disabled:opacity-50"
                    >
                      {researchingSlot === i ? '…' : 'Buscar'}
                    </button>
                  </div>
                  {myProjectVideos.length > 0 && (
                    <div className="space-y-1">
                      <button
                        onClick={() => setMyVidOpen((prev) => ({ ...prev, [i]: !prev[i] }))}
                        className="text-[10px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-800 rounded-lg px-2.5 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 flex items-center gap-1"
                      >
                        🎬 Meus vídeos ({myProjectVideos.length}) {myVidOpen[i] ? '▲' : '▼'}
                      </button>
                      {myVidOpen[i] && (
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                        {myProjectVideos.map((mv) => (
                          <button
                            key={mv.url}
                            onClick={() => chooseCandidate(i, mv.url)}
                            onMouseEnter={(e) => {
                              const v = e.currentTarget.querySelector('video');
                              if (v) (v as HTMLVideoElement).play().catch(() => {});
                            }}
                            onMouseLeave={(e) => {
                              const v = e.currentTarget.querySelector('video');
                              if (v) (v as HTMLVideoElement).pause();
                            }}
                            title={mv.label}
                            className={`relative aspect-video rounded-lg overflow-hidden border-2 ${
                              s.chosen === mv.url
                                ? 'border-purple-500 ring-2 ring-purple-300'
                                : 'border-blue-300/50 hover:border-blue-400'
                            }`}
                          >
                            <video
                              src={mv.url}
                              muted
                              loop
                              playsInline
                              preload="metadata"
                              onLoadedMetadata={(e) => {
                                const d = (e.target as HTMLVideoElement).duration;
                                if (d && isFinite(d))
                                  setMyVidDur((prev) => (prev[mv.url] ? prev : { ...prev, [mv.url]: d }));
                              }}
                              className="w-full h-full object-cover"
                            />
                            <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[8px] px-1 flex items-center justify-between gap-1">
                              <span className="truncate">{mv.label}</span>
                              {(mv.duration ?? myVidDur[mv.url]) ? (
                                <span className="tabular-nums shrink-0 font-black">
                                  {(mv.duration ?? myVidDur[mv.url])!.toFixed(1)}s
                                </span>
                              ) : null}
                            </span>
                            {s.chosen === mv.url && (
                              <span className="absolute top-1 right-1 bg-purple-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[9px]">
                                ✓
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                      )}
                    </div>
                  )}
                  {s.candidates.length === 0 ? (
                    <p className="text-[11px] text-gray-400">
                      Nenhum b-roll — busque outro termo acima.
                    </p>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      {s.candidates.map((c) => (
                        <button
                          key={c.url}
                          onClick={() => chooseCandidate(i, c.url)}
                          onMouseEnter={(e) => {
                            const v = e.currentTarget.querySelector('video');
                            if (v) (v as HTMLVideoElement).play().catch(() => {});
                          }}
                          onMouseLeave={(e) => {
                            const v = e.currentTarget.querySelector('video');
                            if (v) (v as HTMLVideoElement).pause();
                          }}
                          className={`relative aspect-video rounded-lg overflow-hidden border-2 ${
                            s.chosen === c.url
                              ? 'border-purple-500 ring-2 ring-purple-300'
                              : 'border-transparent hover:border-gray-300'
                          }`}
                        >
                          <video
                            src={c.url}
                            poster={c.thumb || undefined}
                            muted
                            loop
                            playsInline
                            preload="none"
                            className="w-full h-full object-cover"
                          />
                          {s.chosen === c.url && (
                            <span className="absolute top-1 right-1 bg-purple-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[9px]">
                              ✓
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {(s.highlight || s.tone === 'past' || s.style === 'animation' || s.split) && (
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                      {s.highlight && (
                        <span className="px-2 py-1 rounded-lg bg-green-100 dark:bg-green-950/40 text-green-800 dark:text-green-300 font-black uppercase tracking-widest">
                          ✍ {s.highlight}
                        </span>
                      )}
                      {s.tone === 'past' && (
                        <span className="px-2 py-1 rounded-lg bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-black uppercase tracking-widest">
                          ◐ P&B
                        </span>
                      )}
                      {s.style === 'animation' && (
                        <span className="px-2 py-1 rounded-lg bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-black uppercase tracking-widest">
                          ✦ animação
                        </span>
                      )}
                      {s.split && (
                        <button
                          onClick={() =>
                            setAutoSlots((prev) =>
                              prev.map((x, k) => (k === i ? { ...x, split: !x.split } : x))
                            )
                          }
                          className="px-2 py-1 rounded-lg bg-cyan-100 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300 font-black uppercase tracking-widest"
                          title="Split-screen (2 b-rolls). Clique pra desligar."
                        >
                          ⊞ split ✕
                        </button>
                      )}
                    </div>
                  )}
                  {s.effectName && (
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 font-black uppercase tracking-widest">
                        🔊 {s.effectName}
                      </span>
                      <button
                        onClick={() =>
                          setAutoSlots((prev) =>
                            prev.map((x, k) =>
                              k === i ? { ...x, effectName: undefined, effectUrl: undefined } : x
                            )
                          )
                        }
                        className="text-gray-400 hover:text-red-500 font-bold"
                        title="Não usar esse efeito neste trecho"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <style>{`
        @keyframes mvFade { 0%{opacity:0} 60%,100%{opacity:1} }
        @keyframes mvSL { 0%{transform:translateX(100%)} 60%,100%{transform:translateX(0)} }
        @keyframes mvSR { 0%{transform:translateX(-100%)} 60%,100%{transform:translateX(0)} }
        @keyframes mvSU { 0%{transform:translateY(100%)} 60%,100%{transform:translateY(0)} }
        @keyframes mvSD { 0%{transform:translateY(-100%)} 60%,100%{transform:translateY(0)} }
        @keyframes mvZI { 0%{transform:scale(1)} 70%,100%{transform:scale(1.18)} }
        @keyframes mvZO { 0%{transform:scale(1.18)} 70%,100%{transform:scale(1)} }
        @keyframes mvWF { 0%{filter:brightness(6)} 35%,100%{filter:brightness(1)} }
        @keyframes mvWH { 0%{transform:translateX(75%);filter:blur(9px)} 45%,100%{transform:translateX(0);filter:blur(0)} }
        @keyframes mvGL {
          0%,100%{transform:translateX(0);box-shadow:none;filter:none}
          18%{transform:translateX(-5px);box-shadow:-4px 0 0 rgba(255,0,255,.6),4px 0 0 rgba(0,255,255,.6)}
          36%{transform:translateX(5px);box-shadow:4px 0 0 rgba(255,0,255,.6),-4px 0 0 rgba(0,255,255,.6)}
          54%{transform:translateX(-2px);filter:contrast(1.6) brightness(1.2)}
          72%{transform:translateX(0);box-shadow:none;filter:none}
        }
        /* Preview anima SÓ no hover do card (mv-card). Parado, mostra estático. */
        .mv-card:hover .mv-fade{animation:mvFade 1.6s ease-in-out infinite}
        .mv-card:hover .mv-slideleft{animation:mvSL 1.6s ease-in-out infinite}
        .mv-card:hover .mv-slideright{animation:mvSR 1.6s ease-in-out infinite}
        .mv-card:hover .mv-slideup{animation:mvSU 1.6s ease-in-out infinite}
        .mv-card:hover .mv-slidedown{animation:mvSD 1.6s ease-in-out infinite}
        .mv-card:hover .mv-zoomin{animation:mvZI 1.6s ease-in-out infinite}
        .mv-card:hover .mv-zoomout{animation:mvZO 1.6s ease-in-out infinite}
        .mv-card:hover .mv-white{animation:mvWF 1.6s ease-in-out infinite}
        .mv-card:hover .mv-whip{animation:mvWH 1.6s ease-in-out infinite}
        .mv-card:hover .mv-glitch{animation:mvGL 1.2s linear infinite}
        .mv-bw{filter:grayscale(1)}
      `}</style>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Film size={22} className="text-blue-600 dark:text-blue-400" />
          <h2 className="text-2xl font-black text-gray-900 dark:text-gray-50">Montagem dos seus vídeos</h2>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Sem avatar IA. Com um <strong>áudio base</strong> (a voz), dê play e clique{' '}
          <strong>"Adicionar aqui"</strong> no segundo certo pra encaixar cada trecho. O resultado vai
          pra Edição.
        </p>
      </div>

      {/* ÁUDIO BASE */}
      <div className="bg-white dark:bg-gray-900/70 p-4 rounded-2xl border-2 border-gray-200 dark:border-gray-800 space-y-3">
        <div className="flex items-center gap-2">
          <Music size={16} className="text-blue-600 dark:text-blue-400" />
          <span className="text-xs font-black uppercase tracking-widest text-gray-700 dark:text-gray-300">
            Áudio base (linha do tempo)
          </span>
        </div>
        {audioUrl ? (
          <div className="space-y-3">
            {/* PREVIEW 1:1 */}
            <div
              ref={previewWrapRef}
              className={`relative bg-black rounded-xl overflow-hidden mx-auto max-h-[440px] w-full ${
                aspect === '9:16'
                  ? 'aspect-[9/16] max-w-[260px]'
                  : aspect === '16:9'
                    ? 'aspect-video max-w-[640px]'
                    : 'aspect-square max-w-[420px]'
              } [&:fullscreen]:max-h-none [&:fullscreen]:max-w-none [&:fullscreen]:aspect-auto [&:fullscreen]:rounded-none`}
            >
              <video ref={vARef} className={`absolute inset-0 w-full h-full ${fit === 'cover' ? 'object-cover' : 'object-contain'}`} style={{ opacity: 0 }} muted playsInline />
              <video ref={vBRef} className={`absolute inset-0 w-full h-full ${fit === 'cover' ? 'object-cover' : 'object-contain'}`} style={{ opacity: 0 }} muted playsInline />
              {/* Barra de controle (fica dentro do container → funciona em tela cheia) */}
              <div
                style={{ zIndex: 10 }}
                className="absolute left-0 right-0 bottom-0 px-3 py-2 flex items-center gap-3 bg-gradient-to-t from-black/70 to-transparent"
              >
                <button onClick={togglePlay} className="text-white shrink-0" title={isPlaying ? 'Pausar' : 'Tocar'}>
                  {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                </button>
                <div onClick={seekAudio} className="flex-1 h-2 bg-white/30 rounded cursor-pointer">
                  <div
                    className="h-full bg-white rounded"
                    style={{ width: `${audioDuration ? (playhead / audioDuration) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-[10px] text-white tabular-nums shrink-0">
                  {playhead.toFixed(0)}/{audioDuration.toFixed(0)}s
                </span>
                <button onClick={goFullscreen} className="text-white shrink-0" title="Tela cheia (entra/sai)">
                  <Maximize size={16} />
                </button>
              </div>
            </div>
            <button
              onClick={addHere}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-black uppercase tracking-widest flex items-center justify-center gap-2"
            >
              <Plus size={16} /> Adicionar aqui ({playhead.toFixed(1)}s)
            </button>

            {/* Seletor de clipe ao "adicionar aqui" */}
            {picking != null && (
              <div className="p-3 rounded-xl ring-2 ring-blue-400 bg-blue-50/60 dark:bg-blue-950/30 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300">
                    Escolha o trecho pra {picking.toFixed(1)}s
                  </span>
                  <button onClick={() => setPicking(null)} className="text-gray-400 hover:text-gray-600">
                    <X size={14} />
                  </button>
                </div>
                {clips.length === 0 ? (
                  <p className="text-[11px] text-gray-500">Suba trechos primeiro (abaixo).</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {clips.map((c, ci) => (
                      <div
                        key={c.url + ci}
                        className="relative rounded-lg overflow-hidden ring-1 ring-gray-200 dark:ring-gray-700 hover:ring-blue-500"
                      >
                        <button onClick={() => pickClip(ci)} className="block w-full text-left">
                          <div className="relative">
                            <video src={c.url} preload="metadata" className="w-full h-20 object-cover bg-black" />
                            {c.duration ? (
                              <span className="absolute bottom-1 right-1 text-[9px] font-black bg-black/70 text-white px-1 rounded">
                                {c.duration.toFixed(1)}s
                              </span>
                            ) : null}
                          </div>
                          <span className="block text-[9px] truncate px-1 py-0.5 text-gray-600 dark:text-gray-300">
                            {c.label}
                          </span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deletePoolClip(ci);
                          }}
                          title="Excluir trecho da biblioteca"
                          className="absolute top-1 right-1 p-1 rounded bg-black/60 text-white hover:bg-red-600"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <audio
              ref={audioRef}
              src={audioUrl}
              controls
              onLoadedMetadata={(e) => setAudioDuration((e.target as HTMLAudioElement).duration || 0)}
              onTimeUpdate={(e) => syncPreview((e.target as HTMLAudioElement).currentTime, false)}
              onSeeked={(e) => syncPreview((e.target as HTMLAudioElement).currentTime, true)}
              onPlay={() => {
                playingRef.current = true;
                setIsPlaying(true);
                frontEl()?.play().catch(() => {});
                startRaf();
              }}
              onPause={() => {
                playingRef.current = false;
                setIsPlaying(false);
                frontEl()?.pause();
                stopRaf();
              }}
              className="w-full"
            />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-gray-500">
                Duração: {audioDuration ? `${audioDuration.toFixed(1)}s` : '...'}
              </span>
              <button
                onClick={() => {
                  setAudioUrl('');
                  setItems([]);
                }}
                className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-red-500"
              >
                <X size={12} /> Remover áudio
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {vozOptions.map((o) => (
              <button
                key={o.key}
                onClick={() => setAudioUrl(o.url)}
                className={`px-3 py-2 rounded-xl text-white text-[10px] font-black uppercase tracking-widest ${
                  o.key.startsWith('vsl')
                    ? 'bg-purple-600 hover:bg-purple-700'
                    : o.key === 'gancho'
                      ? 'bg-amber-500 hover:bg-amber-600'
                      : o.key.startsWith('joined')
                        ? 'bg-emerald-600 hover:bg-emerald-700'
                        : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                Usar {o.label}
              </button>
            ))}
            <label className="px-3 py-2 rounded-xl border-2 border-gray-200 dark:border-gray-700 text-[10px] font-black uppercase tracking-widest text-gray-600 dark:text-gray-300 hover:border-blue-400 cursor-pointer flex items-center gap-1">
              {uploadingAudio ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
              Enviar áudio
              <input type="file" accept="audio/*" className="hidden" onChange={(e) => onUploadAudio(e.target.files?.[0])} />
            </label>
            <span className="text-[11px] text-gray-400 self-center">(sem áudio = só cola em ordem)</span>
          </div>
        )}
      </div>

      {/* TIMELINE: itens posicionados */}
      {isTimeline && displayItems.length > 0 && (
        <div className="bg-white dark:bg-gray-900/70 p-3 rounded-2xl border-2 border-gray-200 dark:border-gray-800 space-y-2">
          <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">
            Transições (preview) — escolha em cada trecho abaixo
          </span>
          <div className="grid grid-cols-3 sm:grid-cols-7 gap-2">
            {TRANSITIONS.map((t) => (
              <div key={t.id} className="space-y-1">
                <div className="mv-card relative w-full h-14 rounded-lg overflow-hidden ring-1 ring-gray-200 dark:ring-gray-700 cursor-pointer">
                  <div className="absolute inset-0 bg-gradient-to-br from-fuchsia-500 to-rose-500" />
                  <div className={`absolute inset-0 bg-gradient-to-br from-blue-500 to-cyan-400 ${t.css}`} />
                </div>
                <span className="block text-[9px] text-center text-gray-500">{t.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* BIBLIOTECA DE EFEITOS SONOROS — preview (ouça e aplique nos trechos abaixo) */}
      {isTimeline && displayItems.length > 0 && (
        <div className="bg-white dark:bg-gray-900/70 p-3 rounded-2xl border-2 border-gray-200 dark:border-gray-800 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">
              Efeitos sonoros (biblioteca) — ouça e aplique nos trechos abaixo
            </span>
            <button
              onClick={() => setSoundLibManage(true)}
              className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-blue-400 flex items-center gap-1 shrink-0"
              title="Enviar, aparar (trim) ou remover efeitos"
            >
              <Music size={12} /> Gerenciar
            </button>
          </div>
          {libSounds.length === 0 ? (
            <p className="text-[11px] text-gray-400">
              Biblioteca vazia. Clique em <b>Gerenciar</b> pra enviar seus efeitos (whoosh, cash
              register, clock ticking…).
            </p>
          ) : (
            ['Transições', 'Efeitos', 'Impactos', 'Outros']
              .filter((cat) => libSounds.some((s) => (s.category || 'Outros') === cat))
              .map((cat) => (
                <div key={cat} className="space-y-1">
                  <span className="block text-[9px] font-black uppercase tracking-widest text-gray-400">
                    {cat}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {libSounds
                      .filter((s) => (s.category || 'Outros') === cat)
                      .map((s) => (
                        <button
                          key={s.id}
                          onClick={() => playSfx(s.url)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-[11px] text-gray-700 dark:text-gray-200 hover:border-purple-400"
                          title="Ouvir"
                        >
                          <Play size={10} /> {s.name}
                        </button>
                      ))}
                  </div>
                </div>
              ))
          )}
        </div>
      )}

      {/* AVATAR BASE — vídeo do HeyGen (mesma narração) pro PiP/split */}
      {isTimeline && (
        <div className="bg-white dark:bg-gray-900/70 p-3 rounded-2xl border-2 border-violet-200 dark:border-violet-900/60 space-y-2">
          <span className="text-[11px] font-black uppercase tracking-widest text-violet-600 dark:text-violet-400">
            Avatar base (opcional) — pro PiP / split
          </span>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            <b>Obrigatório</b> pro avatar aparecer: escolha o vídeo do avatar (o que você gerou na
            aba Avatar) da <b>mesma narração</b>. Só depois os layouts <b>tela cheia / PiP / split</b>
            de cada trecho funcionam (o render encaixa o avatar no tempo certo, lip-sync na voz).
          </p>
          {avatarBase ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <video
                  ref={avatarPreviewRef}
                  src={avatarBase}
                  controls
                  className="w-40 h-24 object-cover rounded-lg bg-black"
                />
                <span className="text-[10px] font-black uppercase tracking-widest text-green-600 dark:text-green-400">
                  ✓ avatar base ativo
                </span>
                <button
                  onClick={() => setFramingModalOpen(true)}
                  className="text-[10px] font-black uppercase tracking-widest text-violet-600 dark:text-violet-400 hover:underline"
                  title="Escolha 1× onde o split corta e onde o círculo do PiP recorta — vale pra todos os trechos deste avatar"
                >
                  ◎ Enquadrar avatar
                </button>
                <button
                  onClick={() => setAvatarBase('')}
                  className="text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-red-500"
                >
                  Trocar
                </button>
              </div>
              {/* Início do bloco no avatar: se a base é a VSL inteira (10 min) e
                  você monta um bloco no meio, marque onde ele começa — a montagem
                  usa só daqui pra frente (pelo tempo do bloco) e o lip-sync bate. */}
              <div className="flex items-center gap-2 flex-wrap text-[10px]">
                <span className="font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
                  Início do bloco no avatar:
                </span>
                <span className="font-mono font-black text-violet-600 dark:text-violet-400">
                  {`${Math.floor(avatarStartSec / 60)}:${String(Math.floor(avatarStartSec % 60)).padStart(2, '0')}`}
                </span>
                <button
                  onClick={() => {
                    const t = avatarPreviewRef.current?.currentTime;
                    if (t == null) return;
                    setAvatarStartSec(Math.max(0, Math.round(t * 10) / 10));
                    toast.success('Início marcado — a montagem corta o avatar a partir daqui.');
                  }}
                  className="px-2 py-1 rounded-lg border border-violet-300 dark:border-violet-800 font-black uppercase tracking-widest text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/30"
                  title="Pause o preview no ponto onde este bloco começa a falar e clique aqui"
                >
                  ✂ Cortar a partir daqui
                </button>
                {avatarStartSec > 0 && (
                  <button
                    onClick={() => setAvatarStartSec(0)}
                    className="font-black uppercase tracking-widest text-gray-400 hover:text-red-500"
                  >
                    Resetar (0:00)
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {avatarVideoOptions.length > 0 && (
                <div className="space-y-1">
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">
                    Escolha um avatar que você já gerou:
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {avatarVideoOptions.map((v) => (
                      <button
                        key={v.url}
                        onClick={() => setAvatarBase(v.url)}
                        className="relative w-28 h-16 rounded-lg overflow-hidden ring-1 ring-violet-300 dark:ring-violet-700 hover:ring-2 hover:ring-violet-500 bg-black"
                        title={`${v.from} · ${v.aspectRatio || ''}`}
                      >
                        <video src={v.url} muted className="w-full h-full object-cover" preload="metadata" />
                        <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[8px] font-black uppercase tracking-widest px-1 py-0.5">
                          {v.from} {v.aspectRatio || ''}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <label className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border-2 border-violet-200 dark:border-violet-800 text-[10px] font-black uppercase tracking-widest text-violet-700 dark:text-violet-300 hover:border-violet-400 cursor-pointer">
                {uploadingAvatar ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                {avatarVideoOptions.length > 0 ? 'ou enviar outro vídeo' : 'Enviar vídeo do avatar'}
                <input
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => onUploadAvatar(e.target.files?.[0])}
                />
              </label>
            </div>
          )}
        </div>
      )}

      {isTimeline && displayItems.length > 0 && (
        <div className="space-y-2">
          <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">
            Trechos na timeline (começa / termina, em segundos do áudio)
          </span>
          {displayItems.map(({ it, idx }, pos) => (
            <div
              key={idx}
              className="p-2 rounded-xl ring-1 ring-gray-200 dark:ring-gray-700 bg-white dark:bg-gray-900/60 space-y-2"
            >
              <div className="flex items-center gap-3">
                <video
                  src={clips[it.clipIdx]?.url}
                  preload="metadata"
                  muted
                  loop
                  playsInline
                  onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
                  onMouseLeave={(e) => {
                    const v = e.currentTarget as HTMLVideoElement;
                    v.pause();
                    v.currentTime = 0;
                  }}
                  title="Passe o mouse pra ver o trecho"
                  className="w-24 h-16 object-cover rounded bg-black shrink-0 cursor-pointer"
                />
                <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2 text-[10px] text-gray-500">
                  <span className="truncate font-bold text-gray-800 dark:text-gray-100 max-w-[100px]">
                    {clips[it.clipIdx]?.label || 'trecho'}
                  </span>
                  <button
                    onClick={() => openSwap(idx)}
                    className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-md border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                    title="Trocar o b-roll deste trecho"
                  >
                    ⇄ trocar
                  </button>
                  <button
                    onClick={() => playSegment(it.atSec, itemEnd(it))}
                    disabled={!audioUrl}
                    className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-md border border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/40 disabled:opacity-40 inline-flex items-center gap-1"
                    title="Ouvir o áudio deste trecho"
                  >
                    <Play size={10} /> ouvir
                  </button>
                  começa em
                  <NumInput value={it.atSec} min={0} onCommit={(n) => updateItem(idx, 'atSec', String(n))} className="w-16 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100" />
                  s · termina em
                  <NumInput value={itemEnd(it)} min={0.5} onCommit={(n) => updateItem(idx, 'endSec', String(n))} className="w-16 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100" />
                  s
                </div>
                <button onClick={() => removeItem(idx)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 shrink-0" title="Remover">
                  <Trash2 size={14} />
                </button>
              </div>
              {/* Controles editáveis do trecho: destaque, P&B, split, efeito */}
              {(() => {
                const hlI = texts.findIndex((t) => t.atSec < itemEnd(it) && t.endSec > it.atSec);
                const hl = hlI >= 0 ? texts[hlI] : null;
                return (
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px] pl-1">
                    {/* Destaque (texto na tela) — editável */}
                    {hl ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg bg-green-100 dark:bg-green-950/40">
                        <span className="text-green-700 dark:text-green-300">✍</span>
                        <input
                          value={hl.text}
                          onChange={(e) => updateText(hlI, { text: e.target.value })}
                          className="bg-transparent text-green-800 dark:text-green-200 font-black uppercase tracking-widest w-40 outline-none"
                        />
                        <button onClick={() => removeText(hlI)} className="text-green-600 hover:text-red-500" title="Remover destaque">✕</button>
                      </span>
                    ) : (
                      <button
                        onClick={() =>
                          setTexts((prev) => [
                            ...prev,
                            { text: 'DESTAQUE', atSec: Number(it.atSec.toFixed(2)), endSec: Number(Math.min(itemEnd(it), it.atSec + 2.5).toFixed(2)), color: '#39FF14', pos: 'middle' },
                          ])
                        }
                        className="px-2 py-0.5 rounded-lg border border-green-300 dark:border-green-800 text-green-700 dark:text-green-300 font-black uppercase tracking-widest hover:bg-green-50 dark:hover:bg-green-950/40"
                      >
                        + destaque
                      </button>
                    )}
                    {/* P&B — toggle */}
                    <button
                      onClick={() => setItemField(idx, { bw: !it.bw })}
                      className={`px-2 py-0.5 rounded-lg font-black uppercase tracking-widest ${
                        it.bw
                          ? 'bg-gray-700 text-white'
                          : 'border border-gray-300 dark:border-gray-700 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
                      }`}
                      title="Preto e branco neste trecho"
                    >
                      ◐ P&B
                    </button>
                    {/* Split de B-ROLL (2 b-rolls lado a lado) — add/trocar/remover */}
                    {it.clipIdx2 != null ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-cyan-100 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300 font-black uppercase tracking-widest">
                        ⊞ split
                        <button onClick={() => openAddSplit(idx)} className="hover:text-blue-600" title="Trocar o 2º b-roll">⇄</button>
                        <button onClick={() => setItemField(idx, { clipIdx2: undefined })} className="hover:text-red-500" title="Remover split">✕</button>
                      </span>
                    ) : (
                      <button
                        onClick={() => autoAddSplit(idx)}
                        className="px-2 py-0.5 rounded-lg border border-cyan-300 dark:border-cyan-800 text-cyan-700 dark:text-cyan-300 font-black uppercase tracking-widest hover:bg-cyan-50 dark:hover:bg-cyan-950/40"
                        title="Split-screen: escolhe um 2º b-roll automaticamente (troque no ⇄ depois)"
                      >
                        + split
                      </button>
                    )}
                    {/* Efeito contextual — trocar/remover/ouvir */}
                    {it.soundMid ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 font-black uppercase tracking-widest">
                        🔊 {soundName(it.soundMid)}
                        <button onClick={() => playSfx(it.soundMid!)} className="hover:text-amber-600" title="Ouvir">▶</button>
                        <button onClick={() => setSoundPicker({ idx, field: 'soundMid' })} className="hover:text-blue-600" title="Trocar efeito">⇄</button>
                        <button onClick={() => setItemField(idx, { soundMid: '' })} className="hover:text-red-500" title="Remover efeito">✕</button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setSoundPicker({ idx, field: 'soundMid' })}
                        className="px-2 py-0.5 rounded-lg border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300 font-black uppercase tracking-widest hover:bg-amber-50 dark:hover:bg-amber-950/40"
                      >
                        + efeito
                      </button>
                    )}
                    {/* Layout com AVATAR — PiP (canto) ou split. Precisa do Avatar base. */}
                    <select
                      value={it.layout || 'full'}
                      onChange={(e) =>
                        setItemField(idx, { layout: e.target.value as TLItem['layout'] })
                      }
                      title={
                        avatarBase
                          ? 'Como o avatar aparece neste trecho'
                          : 'Defina o "Avatar base" acima pra usar PiP/split'
                      }
                      className={`px-2 py-1 rounded-lg border font-black uppercase tracking-widest ${
                        it.layout && it.layout !== 'full'
                          ? 'bg-violet-600 text-white border-violet-600'
                          : 'border-violet-300 dark:border-violet-800 text-violet-700 dark:text-violet-300 bg-transparent'
                      }`}
                    >
                      <option value="full">🧑 sem avatar (só b-roll)</option>
                      <option value="avatar">🎙 avatar tela cheia</option>
                      <option value="pip">◍ avatar PiP (canto)</option>
                      <option value="split-left">◧ split avatar ←</option>
                      <option value="split-right">◨ split avatar →</option>
                      <option value="split-top">⬒ split avatar ↑ (cima)</option>
                      <option value="split-bottom">⬓ split avatar ↓ (baixo)</option>
                    </select>
                  </div>
                );
              })()}
              {(['In', 'Out'] as const).map((side) => {
                const typeKey = side === 'In' ? 'transIn' : 'transOut';
                const durKey = side === 'In' ? 'transInDur' : 'transOutDur';
                const sndKey = side === 'In' ? 'soundIn' : 'soundOut';
                const type = (it as any)[typeKey] || 'none';
                const dur = (it as any)[durKey] ?? 0.1;
                const snd = (it as any)[sndKey];
                // Avatar contínuo (mesmo layout no vizinho) → transição cancelada
                // nesse corte; mostra aviso em vez de um select que não é aplicado.
                const cancelled =
                  side === 'In'
                    ? pos > 0 && avatarContinuousBoundary(displayItems[pos - 1]!.it, it)
                    : pos < displayItems.length - 1 &&
                      avatarContinuousBoundary(it, displayItems[pos + 1]!.it);
                if (cancelled) {
                  return (
                    <div key={side} className="flex flex-wrap items-center gap-2 text-[10px] text-gray-400 pl-1">
                      <span className="w-12 font-bold">{side === 'In' ? 'entrada' : 'saída'}</span>
                      <span className="italic">— sem transição (avatar contínuo)</span>
                    </div>
                  );
                }
                return (
                  <div key={side} className="flex flex-wrap items-center gap-2 text-[10px] text-gray-500 pl-1">
                    <span className="w-12 font-bold">{side === 'In' ? 'entrada' : 'saída'}</span>
                    <select
                      value={type}
                      onChange={(e) => {
                        const v = e.target.value;
                        const patch: any = { [typeKey]: v };
                        // Qualquer transição (≠ none) → aplica o som certo pelo
                        // tipo, se aquele lado ainda não tiver som.
                        if (v !== 'none' && !(it as any)[sndKey]) {
                          const snd = soundForTransition(v);
                          if (snd) patch[sndKey] = snd;
                        }
                        setItemField(idx, patch);
                      }}
                      className="px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100"
                    >
                      {TRANSITIONS.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    {type !== 'none' && (
                      <>
                        · dur
                        <NumInput value={dur} min={0.1} onCommit={(n) => setItemField(idx, { [durKey]: Math.max(0.1, n) })} className="w-14 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100" />
                        s ·
                        <button
                          type="button"
                          onClick={() => setSoundPicker({ idx, field: sndKey })}
                          className="cursor-pointer text-blue-700 dark:text-blue-300 font-bold hover:underline"
                        >
                          {snd ? '🔊 som ✓' : '+ som'}
                        </button>
                        {snd && (
                          <button
                            onClick={() => {
                              const a = new Audio(snd as string);
                              a.play().catch(() => {});
                            }}
                            className="text-purple-600 dark:text-purple-400 hover:text-purple-800"
                            title="Ouvir o som aplicado"
                          >
                            <Play size={11} />
                          </button>
                        )}
                        {snd && (
                          <button onClick={() => setItemField(idx, { [sndKey]: '' })} className="text-gray-400 hover:text-red-500" title="Tirar som">
                            <X size={11} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* BLOCOS — fatia VSL longa em pedaços de ~2 min cortados nos silêncios */}
      {isTimeline && (audioDuration > 150 || blockEnds.length > 0) && (
        <div className="bg-white dark:bg-gray-900/70 p-3 rounded-2xl border-2 border-amber-300 dark:border-amber-900/60 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400">
              🧩 Montar por blocos
            </span>
            <span className="text-[11px] text-gray-500 dark:text-gray-400">
              Fatia a VSL longa em pedaços de ~{Math.round(blockSizeSec / 60)} min, cortados em
              silêncios. Monte um de cada vez; no fim, junte tudo.
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap text-[11px]">
            <span className="text-gray-500 dark:text-gray-400">Tamanho do bloco:</span>
            <input
              type="number"
              min={30}
              max={600}
              value={blockSizeSec}
              onChange={(e) => setBlockSizeSec(Math.max(30, Math.min(600, Number(e.target.value) || 120)))}
              className="w-16 px-2 py-1 rounded-lg border border-amber-300 dark:border-amber-800 bg-transparent"
            />
            <span className="text-gray-500 dark:text-gray-400">seg (~{Math.round(blockSizeSec / 60)} min)</span>
            <button
              onClick={fatiarEmBlocos}
              disabled={fatiando}
              className="px-3 py-1 rounded-lg bg-amber-500 text-white font-black uppercase tracking-widest hover:bg-amber-600 disabled:opacity-60"
            >
              {fatiando ? 'Achando silêncios…' : blockEnds.length > 0 ? 'Refatiar' : 'Fatiar em blocos'}
            </button>
          </div>
          {blockEnds.length > 0 && (
            <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
              {blockEnds.map((end, i) => {
                const start = i === 0 ? 0 : blockEnds[i - 1]!;
                return (
                  <div
                    key={i}
                    className={`flex items-center gap-2 p-1.5 rounded-lg text-[11px] ${
                      activeBlock === i
                        ? 'bg-amber-100 dark:bg-amber-900/40 ring-1 ring-amber-400'
                        : 'bg-gray-50 dark:bg-gray-800'
                    }`}
                  >
                    <span className="font-black text-amber-700 dark:text-amber-300 w-16 shrink-0">
                      Bloco {i + 1}
                    </span>
                    <span className="font-mono text-gray-600 dark:text-gray-300">
                      {fmtT(start)} –
                    </span>
                    {/* Fim EDITÁVEL: mexer aqui empurra o início do próximo bloco */}
                    <input
                      type="text"
                      defaultValue={fmtT(end)}
                      onBlur={(e) => {
                        const parts = e.target.value.split(':').map((x) => Number(x) || 0);
                        const secs = parts.length === 2 ? parts[0]! * 60 + parts[1]! : parts[0]!;
                        if (secs > start + 5) {
                          setBlockEnds((prev) => {
                            const next = [...prev];
                            next[i] = Math.round(secs * 10) / 10;
                            // mantém encadeado: fins seguintes >= este
                            for (let k = i + 1; k < next.length; k++) {
                              if (next[k]! <= next[k - 1]!) next[k] = next[k - 1]! + blockSizeSec;
                            }
                            return next;
                          });
                        }
                      }}
                      className="w-16 px-1.5 py-0.5 rounded border border-amber-300 dark:border-amber-800 bg-transparent font-mono"
                      title="Fim do bloco (mm:ss). Mudar aqui empurra o início do próximo."
                    />
                    <span className="text-gray-400">({fmtT(end - start)})</span>
                    <button
                      onClick={() => trabalharNoBloco(i)}
                      className="ml-auto px-2 py-0.5 rounded-lg bg-amber-500 text-white font-black uppercase tracking-widest hover:bg-amber-600"
                    >
                      {activeBlock === i ? '↻ neste bloco' : 'Trabalhar'}
                    </button>
                  </div>
                );
              })}
              <p className="text-[10px] text-gray-400 pt-1">
                Dica: ajuste o fim de um bloco pra cair num respiro entre frases. Depois de montar
                todos, use "juntar grupos" pra ter a VSL inteira.
              </p>
            </div>
          )}
        </div>
      )}

      {/* AUTO-EDITAR — monta a timeline sozinho a partir da voz da VSL */}
      {isTimeline && (
        <div className="bg-gradient-to-br from-purple-600 to-fuchsia-600 rounded-2xl p-4 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[180px]">
            <p className="text-sm font-black text-white">✨ Auto-editar</p>
            <p className="text-[11px] text-white/80">
              Transcreve a voz, corta b-roll no ritmo escolhido, aplica transições + som + texto.
              Depois você revisa e troca o que quiser.
            </p>
            {/* Ritmo — quantos trechos (menor base = mais trechos) */}
            <div className="mt-2 flex items-center gap-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-white/80 mr-1">
                Trechos:
              </span>
              {[
                { label: 'Menos', sec: 13.5 },
                { label: 'Médio', sec: 10 },
                { label: 'Mais', sec: 7 },
                { label: 'Muito', sec: 4.5 },
              ].map((o) => (
                <button
                  key={o.label}
                  onClick={() => setCutPace(o.sec)}
                  className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${
                    cutPace === o.sec
                      ? 'bg-white text-purple-700'
                      : 'bg-white/20 text-white hover:bg-white/30'
                  }`}
                  title={`~${o.sec}s por corte (base; o ritmo ainda varia)`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={autoEdit}
            disabled={autoEditing}
            className="shrink-0 px-4 py-2.5 rounded-xl bg-white text-purple-700 font-black uppercase tracking-widest text-xs hover:bg-purple-50 disabled:opacity-60 flex items-center gap-2"
          >
            {autoEditing ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Montando…
              </>
            ) : (
              'Auto-editar'
            )}
          </button>
        </div>
      )}

      {/* TEXTO CINÉTICO NA TELA (estilo VSL) */}
      {isTimeline && (
        <div className="bg-white dark:bg-gray-900/70 p-3 rounded-2xl border-2 border-gray-200 dark:border-gray-800 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">
              Texto na tela (palavras grandes animadas)
            </span>
            <button
              onClick={addText}
              className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900"
            >
              + no playhead ({playhead.toFixed(1)}s)
            </button>
          </div>
          {texts.length === 0 ? (
            <p className="text-[10px] text-gray-400">
              Adicione palavras-chave que aparecem grandes na tela sincronizadas com a fala (ex.:
              "DIETAS", "CHÁS", "PROBIÓTICOS").
            </p>
          ) : (
            <div className="space-y-2">
              {texts.map((t, i) => (
                <div
                  key={i}
                  className="flex flex-wrap items-center gap-2 p-2 rounded-xl border border-gray-200 dark:border-gray-800"
                >
                  <input
                    value={t.text}
                    onChange={(e) => updateText(i, { text: e.target.value })}
                    className="flex-1 min-w-[120px] px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100 text-sm font-black uppercase"
                  />
                  <span className="text-[10px] text-gray-400">de</span>
                  <NumInput
                    value={t.atSec}
                    min={0}
                    onCommit={(n) => updateText(i, { atSec: n })}
                    className="w-14 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100"
                  />
                  <span className="text-[10px] text-gray-400">a</span>
                  <NumInput
                    value={t.endSec}
                    min={0.1}
                    onCommit={(n) => updateText(i, { endSec: n })}
                    className="w-14 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100"
                  />
                  <div className="flex items-center gap-1">
                    {TEXT_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => updateText(i, { color: c })}
                        className={`w-5 h-5 rounded-full border-2 ${t.color === c ? 'border-gray-900 dark:border-white' : 'border-transparent'}`}
                        style={{ background: c }}
                        title={c}
                      />
                    ))}
                  </div>
                  <select
                    value={t.pos}
                    onChange={(e) => updateText(i, { pos: e.target.value as any })}
                    className="px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100 text-[11px]"
                  >
                    <option value="top">Topo</option>
                    <option value="middle">Meio</option>
                    <option value="bottom">Base</option>
                  </select>
                  <button
                    onClick={() => removeText(i)}
                    className="p-1 rounded text-gray-400 hover:text-red-500"
                    title="Remover"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* BUSCAR B-ROLL NO PEXELS → adiciona à biblioteca */}
      <div className="bg-white dark:bg-gray-900/70 p-3 rounded-2xl border-2 border-gray-200 dark:border-gray-800 space-y-2">
        <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">
          Buscar b-roll (Pexels) → entra na biblioteca
        </span>
        <div className="flex gap-2">
          <input
            value={pexQuery}
            onChange={(e) => setPexQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doPexSearch()}
            placeholder="Ex: dry cracked earth, water tap, empty shelves…"
            className="flex-1 px-3 py-2 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100"
          />
          <button onClick={doPexSearch} disabled={pexSearching} className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-black uppercase tracking-widest disabled:opacity-50">
            {pexSearching ? <Loader2 size={14} className="animate-spin" /> : 'Buscar'}
          </button>
        </div>
        {pexResults.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {pexResults.map((c) => (
              <button
                key={c.id}
                onClick={() => addPexClip(c)}
                title="Adicionar à biblioteca"
                className="relative rounded-lg overflow-hidden ring-1 ring-gray-200 dark:ring-gray-700 hover:ring-blue-500"
              >
                <video
                  src={c.url}
                  poster={c.thumb}
                  muted
                  loop
                  playsInline
                  preload="none"
                  onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
                  onMouseLeave={(e) => {
                    const v = e.currentTarget as HTMLVideoElement;
                    v.pause();
                    v.currentTime = 0;
                  }}
                  className="w-full h-24 object-cover bg-black"
                />
                <span className="absolute bottom-1 right-1 text-[9px] font-black bg-black/70 text-white px-1 rounded pointer-events-none">
                  {Number(c.duration).toFixed(0)}s
                </span>
                <span className="absolute top-1 left-1 bg-blue-600 text-white rounded-full p-0.5">
                  <Plus size={11} />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* BIBLIOTECA de trechos (upload) */}
      <label className="flex items-center justify-center gap-2 py-4 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-700 text-sm font-black uppercase tracking-widest text-blue-700 dark:text-blue-300 hover:border-blue-400 cursor-pointer">
        {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
        {isTimeline ? 'Subir trechos (biblioteca)' : 'Enviar trechos (pode vários)'}
        <input type="file" accept="video/*" multiple className="hidden" onChange={(e) => onUpload(e.target.files)} />
      </label>

      {/* Em modo SEQUÊNCIA, a biblioteca É a ordem dos clipes */}
      {!isTimeline && clips.length > 0 && (
        <div className="space-y-3">
          {clips.map((c, i) => (
            <div key={c.url + i} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-2xl ring-1 ring-gray-200 dark:ring-gray-700 bg-white dark:bg-gray-900/60">
              <span className="text-xs font-black text-gray-400 w-6 shrink-0">{i + 1}</span>
              <video src={c.url} controls preload="metadata" className="w-36 h-24 object-cover rounded-lg bg-black shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-gray-800 dark:text-gray-100 truncate">{c.label}</p>
                <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-500">
                  usa de
                  <input type="number" min={0} step={0.5} placeholder="início" value={c.startSec ?? ''} onChange={(e) => setTrim(i, 'startSec', e.target.value)} className="w-16 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100" />
                  a
                  <input type="number" min={0} step={0.5} placeholder="fim" value={c.endSec ?? ''} onChange={(e) => setTrim(i, 'endSec', e.target.value)} className="w-16 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100" />
                  s (vazio = inteiro)
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => move(i, -1)} disabled={i === 0} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30"><ArrowUp size={14} /></button>
                <button onClick={() => move(i, 1)} disabled={i === clips.length - 1} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30"><ArrowDown size={14} /></button>
                <button onClick={() => removeClip(i)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!isTimeline && clips.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-2">
          <button onClick={() => setMuted(false)} className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-black uppercase tracking-widest border-2 transition-all ${!muted ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'}`}>🔊 Manter áudio dos trechos</button>
          <button onClick={() => setMuted(true)} className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-black uppercase tracking-widest border-2 transition-all ${muted ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'}`}>🔇 Mudo (voz + música depois)</button>
        </div>
      )}

      {/* Formato + enquadramento do vídeo montado */}
      <div className="bg-white dark:bg-gray-900/70 p-3 rounded-2xl border-2 border-gray-200 dark:border-gray-800 flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* Moldes: salva formato+enquadramento+ritmo pra reaplicar num clique */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">Molde</span>
          {templates.length > 0 && (
            <select
              value=""
              onChange={(e) => e.target.value && applyTemplate(e.target.value)}
              className="px-2 py-1 rounded-lg border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-[11px] dark:text-gray-100"
            >
              <option value="">Aplicar…</option>
              {templates.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={saveTemplate}
            className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-lg border-2 border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/40"
          >
            💾 Salvar molde
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">
            Formato
          </span>
          {(['9:16', '1:1', '16:9'] as const).map((ar) => (
            <button
              key={ar}
              onClick={() => setAspect(ar)}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-black border-2 transition-all ${
                aspect === ar
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
              }`}
            >
              {ar === '9:16' ? 'Vertical 9:16' : ar === '1:1' ? 'Quadrado 1:1' : 'Horizontal 16:9'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">
            Enquadrar
          </span>
          {(
            [
              { id: 'cover', label: 'Preencher (corta)' },
              { id: 'contain', label: 'Encaixar (barras)' },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              onClick={() => setFit(f.id)}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-black border-2 transition-all ${
                fit === f.id
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={compose}
        disabled={rendering || (isTimeline ? items.length === 0 || !audioDuration : clips.length === 0)}
        className="w-full py-3.5 bg-blue-700 text-white rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-blue-800 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {rendering ? (
          <><Loader2 size={16} className="animate-spin" /> Montando…</>
        ) : (
          <><Check size={16} /> {isTimeline ? `Montar no tempo do áudio (${items.length})` : `Montar sequência (${clips.length})`}</>
        )}
      </button>

      {resultUrl && (
        <div className="space-y-3 p-4 rounded-2xl ring-1 ring-green-200 dark:ring-green-900 bg-green-50/60 dark:bg-green-950/30">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-black uppercase tracking-widest text-green-700 dark:text-green-300">
              Pronto (já está na Edição)
            </p>
            <button
              onClick={() => setResultUrl('')}
              className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-red-500"
              title="Apagar este vídeo montado"
            >
              <Trash2 size={12} /> Apagar vídeo
            </button>
          </div>
          <video src={resultUrl} controls className="w-full max-h-[420px] rounded-xl bg-black" />
          <button
            onClick={gerarMusicaEColar}
            disabled={musicGen}
            className="w-full py-3 bg-purple-600 text-white rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-purple-700 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {musicGen ? (
              <><Loader2 size={16} className="animate-spin" /> Gerando música…</>
            ) : (
              <><Music size={16} /> Gerar música (arco emocional) e colar</>
            )}
          </button>
          {onGoToEdit && (
            <button onClick={onGoToEdit} className="w-full py-3 bg-gray-900 dark:bg-gray-50 text-white dark:text-gray-900 rounded-2xl font-black uppercase tracking-widest text-sm hover:opacity-90">
              Ir pra Edição →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
