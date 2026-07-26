import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import admin from 'firebase-admin';
import { GENERATED_DIR } from '../config/paths.js';
import { getAssemblyAIKey } from '../config/apiKeys.js';
import { downloadFile } from '../utils/download.js';
import { processDataError } from '../utils/errorExtractor.js';
import { createLogger } from '../utils/logger.js';
import { withFfmpegQueue } from '../services/jobQueue.js';
import { ENCODE_BALANCED, ENCODE_FAST } from '../config/ffmpeg.js';
import { persistVideo } from '../utils/persistVideo.js';

const log = createLogger('Video');

export const videoRouter = Router();

// POST /api/video/split — corta um vídeo em 2 partes no segundo `atSec`.
// Usado pelo fluxo "b-roll começa em Xs": a Parte 1 (0→X) vai pro ZapCap SEM
// b-roll e a Parte 2 (X→fim) COM b-roll; depois as duas são juntadas. Re-encoda
// pra garantir corte exato e A/V sincronizado. Devolve URLs absolutas
// /generated/ (o servidor as baixa de si mesmo na etapa do edit-simple).
videoRouter.post(
  '/split',
  withFfmpegQueue(async (req, res) => {
    const { videoUrl, atSec } = req.body || {};
    if (!videoUrl || typeof videoUrl !== 'string') {
      return res.status(400).json({ error: 'videoUrl é obrigatório.' });
    }
    const cut = Number(atSec);
    if (!Number.isFinite(cut) || cut <= 0) {
      return res.status(400).json({ error: 'atSec deve ser um número > 0.' });
    }
    try {
      const stamp = Date.now();
      const srcPath = path.join(GENERATED_DIR, `split_src_${stamp}.mp4`);
      await downloadFile(videoUrl, srcPath);

      const meta: any = await new Promise((resolve, reject) =>
        ffmpeg.ffprobe(srcPath, (err, m) => (err ? reject(err) : resolve(m)))
      );
      const dur = Number(meta?.format?.duration) || 0;
      if (cut >= dur) {
        try {
          fs.unlinkSync(srcPath);
        } catch {
          /* ignore */
        }
        return res.status(400).json({
          error: `O corte (${cut}s) precisa ser menor que a duração do vídeo (${dur.toFixed(1)}s).`,
        });
      }

      const part1Name = `split_p1_${stamp}.mp4`;
      const part2Name = `split_p2_${stamp}.mp4`;
      const part1Path = path.join(GENERATED_DIR, part1Name);
      const part2Path = path.join(GENERATED_DIR, part2Name);
      const enc = [
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '20',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
      ];

      await new Promise((resolve, reject) => {
        ffmpeg(srcPath)
          .setStartTime(0)
          .duration(cut)
          .outputOptions(enc)
          .output(part1Path)
          .on('end', () => resolve(null))
          .on('error', reject)
          .run();
      });
      await new Promise((resolve, reject) => {
        ffmpeg(srcPath)
          .setStartTime(cut)
          .outputOptions(enc)
          .output(part2Path)
          .on('end', () => resolve(null))
          .on('error', reject)
          .run();
      });

      try {
        fs.unlinkSync(srcPath);
      } catch {
        /* ignore */
      }

      const forwardedHost = req.headers['x-forwarded-host'];
      const host =
        (typeof forwardedHost === 'string' ? forwardedHost.split(',')[0]?.trim() : null) ||
        req.get('host') ||
        '';
      const protocol =
        req.headers['x-forwarded-proto'] || (host.includes('localhost') ? 'http' : 'https');
      const base = `${protocol}://${host}`;

      res.json({
        part1Url: `${base}/generated/${part1Name}`,
        part2Url: `${base}/generated/${part2Name}`,
        durationSec: dur,
      });
    } catch (err: any) {
      log.error('[Video Split] erro:', err.message);
      res.status(500).json({ error: `Falha ao cortar vídeo: ${err.message}` });
    }
  })
);

// POST /api/video/compress
// Downloads, compresses to Full HD via ffmpeg, uploads to Firebase, returns
// a signed URL. Files >= 500MB are compressed; smaller ones return the
// original URL unchanged. Rejects 422 when ffmpeg can't keep 1080p+.
//
// Queued through `ffmpegQueue` (concurrency 2) so a burst of uploads
// can't starve the event loop or pile encoders on a small box.
videoRouter.post(
  '/compress',
  withFfmpegQueue(async (req, res) => {
    const { filePath, originalUrl, userId } = req.body;
    if (!filePath || !originalUrl || !userId) {
      return res.status(400).json({ error: 'Faltam parâmetros (filePath, originalUrl, userId)' });
    }

    const localInputPath = path.join(GENERATED_DIR, `input_${Date.now()}.mp4`);
    const localOutputPath = path.join(GENERATED_DIR, `output_${Date.now()}.mp4`);

    try {
      await downloadFile(originalUrl, localInputPath);

      const stats = fs.statSync(localInputPath);
      const sizeInMB = stats.size / (1024 * 1024);

      if (sizeInMB < 500) {
        log.info(
          `[Video Compress] Arquivo pequeno (${sizeInMB.toFixed(2)}MB), ignorando compressão.`
        );
        return res.json({ compressed: false, url: originalUrl });
      }

      log.info(`[Video Compress] Comprimindo arquivo de ${sizeInMB.toFixed(2)}MB...`);

      await new Promise((resolve, reject) => {
        ffmpeg(localInputPath)
          // Shared balanced profile + a scale filter to clamp to 1920w.
          // The profile gives us multi-threading + decode-friendly output
          // out of the box.
          .outputOptions([...ENCODE_BALANCED, '-vf', 'scale=1920:-2'])
          .save(localOutputPath)
          .on('end', resolve)
          .on('error', reject);
      });

      const getResolution = () =>
        new Promise<{ width: number; height: number }>((resolve, reject) => {
          ffmpeg.ffprobe(localOutputPath, (err, metadata) => {
            if (err) return reject(err);
            const stream = metadata.streams.find((s) => s.codec_type === 'video');
            resolve({ width: stream?.width || 0, height: stream?.height || 0 });
          });
        });

      const { width, height } = await getResolution();
      const isFullHD = width >= 1920 || height >= 1080;

      if (!isFullHD) {
        return res.status(422).json({
          error:
            'Não foi possível processar seu vídeo. O arquivo é muito grande e não conseguimos reduzi-lo mantendo a qualidade Full HD. Por favor, exporte seu vídeo em 1080p e tente novamente.',
        });
      }

      const bucket = admin.storage().bucket();
      const destination = `video/${userId}/${Date.now()}_compressed.mp4`;
      await bucket.upload(localOutputPath, {
        destination,
        metadata: { contentType: 'video/mp4' },
      });

      const file = bucket.file(destination);
      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: '03-09-2491',
      });

      res.json({ compressed: true, url });
    } catch (err: any) {
      log.error('[Video Compress] Erro:', err.message);
      res.status(500).json({ error: processDataError(err) });
    } finally {
      if (fs.existsSync(localInputPath)) fs.unlinkSync(localInputPath);
      if (fs.existsSync(localOutputPath)) fs.unlinkSync(localOutputPath);
    }
  })
);

// The ffmpeg-static binary we ship doesn't include the drawtext filter, but
// it does ship libass — so we render text as an ASS subtitle file and
// composite it via the `subtitles` filter. ASS handles wrapping, centering,
// fonts, and multi-line on its own.
function writeAssFile(
  workDir: string,
  idx: number,
  raw: string,
  width: number,
  height: number,
  fontSize: number
): string {
  const p = path.join(workDir, `text_${idx}.ass`);
  // ASS uses \N for line breaks; remove \r and convert real newlines.
  // {, } and \ are control chars in ASS — escape them.
  const escaped = raw
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N');

  // Style fields: alignment=5 means middle-center. Outline=3 for legibility
  // on the off-chance text overlaps anything (here it's pure black anyway).
  // PrimaryColour is &H00FFFFFF (white, alpha 0).
  const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,${fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,3,0,5,80,80,80,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,9:59:59.99,Default,,0,0,0,,${escaped}
`;

  fs.writeFileSync(p, ass, 'utf8');
  return p;
}

// Escape a filesystem path for use as an argument inside an ffmpeg
// filtergraph. Filtergraph parses `:` as option separator and `\` as escape,
// so both need backslash-escaping. Single quotes wrap the result for safety.
function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

// Cache PERSISTENTE do avatar base (o vídeo do HeyGen, tipicamente enorme —
// ex.: 480 MB / 10 min). Antes era baixado a cada render pra dentro do workDir
// e apagado no fim → cada re-montagem re-baixava tudo. Agora fica salvo por
// hash da URL em generated/.avatar-cache e é reusado entre renders (o usuário
// remonta o mesmo bloco várias vezes ajustando enquadramento). Download atômico
// (.tmp + rename) e dedupe em memória pra chamadas concorrentes.
const AVATAR_CACHE_DIR = path.join(GENERATED_DIR, '.avatar-cache');
const avatarDownloadInflight = new Map<string, Promise<string>>();
async function getPersistentAvatar(url: string): Promise<string> {
  const key = crypto.createHash('sha1').update(url).digest('hex');
  const dest = path.join(AVATAR_CACHE_DIR, `${key}.mp4`);
  try {
    if (fs.statSync(dest).size > 0) return dest; // já em cache
  } catch {
    /* não existe ainda */
  }
  const existing = avatarDownloadInflight.get(dest);
  if (existing) return existing;
  const p = (async () => {
    fs.mkdirSync(AVATAR_CACHE_DIR, { recursive: true });
    const tmp = `${dest}.${Date.now()}.tmp`;
    await downloadFile(url, tmp);
    fs.renameSync(tmp, dest);
    return dest;
  })();
  avatarDownloadInflight.set(dest, p);
  try {
    return await p;
  } finally {
    avatarDownloadInflight.delete(dest);
  }
}

// Pre-crop do avatar (remover legenda/rodapé etc.): lê cropL/R/T/B (frações
// 0..0.45) do clip e devolve o prefixo de filtro `crop=...,` + as dimensões
// EFETIVAS já recortadas (usadas pra calcular PiP/split sobre o quadro limpo).
// Sem crop → prefixo vazio e dims originais.
function buildPreCrop(
  clip: any,
  SW: number,
  SH: number
): { pre: string; ESW: number; ESH: number } {
  const cl = Math.min(0.45, Math.max(0, Number(clip?.cropL) || 0));
  const cr = Math.min(0.45, Math.max(0, Number(clip?.cropR) || 0));
  const ct = Math.min(0.45, Math.max(0, Number(clip?.cropT) || 0));
  const cb = Math.min(0.45, Math.max(0, Number(clip?.cropB) || 0));
  if (!(cl || cr || ct || cb)) return { pre: '', ESW: SW, ESH: SH };
  const ESW = Math.max(2, Math.round(SW * (1 - cl - cr)));
  const ESH = Math.max(2, Math.round(SH * (1 - ct - cb)));
  const ox = Math.round(SW * cl);
  const oy = Math.round(SH * ct);
  return { pre: `crop=${ESW}:${ESH}:${ox}:${oy},`, ESW, ESH };
}

// F6.18 — pasta de fontes bundled (Anton, Bebas Neue, Inter Black, etc.).
// libass usa fontconfig pra resolver nomes da fonte. Quando passamos
// `fontsdir=...` no filter subtitles, libass adiciona essa pasta às fontes
// disponíveis, permitindo usar fontes que o sistema não tem instaladas.
// Caminho absoluto resolvido a partir do CWD do server.
const FONTS_DIR = path.resolve(process.cwd(), 'server', 'assets', 'fonts');

// F6.19 — cache de imagens de background pra evitar regenerar noise per
// frame (era a causa da lentidão extrema). Geramos UMA PNG de starfield
// por resolução, salvamos em disco, e usamos `-loop 1 -i` no ffmpeg
// principal. Compressão temporal funciona a 100% porque cada frame é
// idêntico (zoom adicionado via scale, super barato).
const BG_CACHE_DIR = path.resolve(process.cwd(), 'server', 'assets', 'bg-cache');
if (!fs.existsSync(BG_CACHE_DIR)) fs.mkdirSync(BG_CACHE_DIR, { recursive: true });

async function ensureStarfieldVideo(width: number, height: number): Promise<string> {
  // F6.19/F6.20 — starfield REAL: estrelas brilhantes esparsas em fundo
  // azul-escuro (não cinza-grainy uniforme como antes).
  //
  // Técnica:
  // - geq=lum=...random(0)<0.0015 → ~0.15% dos pixels viram brancos (255),
  //   o resto fica numa cor muito escura (12). Pra 1080x1080 = ~1700 estrelas.
  // - gblur sigma=0.6 → leve blur dá efeito de "bloom" nas estrelas
  //   (parecem pontos mais suaves que pixels brutos).
  // - cb=128,cr=128 → sem cromaticidade (estrelas brancas, não coloridas).
  const fileName = `starfield_${width}x${height}.mp4`;
  const filePath = path.join(BG_CACHE_DIR, fileName);
  if (fs.existsSync(filePath)) return filePath;
  await new Promise((resolve, reject) => {
    ffmpeg(`color=c=0x06091a:s=${width}x${height}:d=1:r=30`)
      .inputFormat('lavfi')
      .outputOptions([
        '-vf',
        "geq=lum='if(lt(random(0),0.0015),255,12)':cb=128:cr=128,gblur=sigma=0.6",
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '20',
        '-pix_fmt',
        'yuv420p',
        '-y',
      ])
      .output(filePath)
      .on('end', () => resolve(null))
      .on('error', reject)
      .run();
  });
  return filePath;
}

// F6.3 — convert ms → ASS timestamp "H:MM:SS.cc".
function msToAssTime(ms: number): string {
  const totalCs = Math.round(ms / 10);
  const cs = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

// F6.3 — convert hex color "#RRGGBB" → ASS "&H00BBGGRR".
// ASS uses BGR order (not RGB), alpha first (00=fully visible).
function hexToAssColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return '&H0099FFFF'; // fallback: yellow-ish
  const rgb = m[1];
  const r = rgb.slice(0, 2);
  const g = rgb.slice(2, 4);
  const b = rgb.slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}

// F6.3 — alignment digit per ASS spec (numpad layout, 1=BL, 5=MC, 8=TC).
function positionToAssAlignment(position: string): number {
  switch (position) {
    case 'top':
      return 8;
    case 'middle':
      return 5;
    case 'bottom':
      return 2;
    default:
      return 5; // default middle
  }
}

// Texto CINÉTICO (estilo VSL): palavras grandes em negrito, coloridas, com
// contorno preto e um POP de escala (50→112→100) na entrada. Via libass — cada
// texto vira um Dialogue com timing próprio [atSec, endSec] e animação \t.
function writeKineticTextAss(
  workDir: string,
  texts: { text?: string; atSec?: number; endSec?: number; color?: string; pos?: string }[],
  width: number,
  height: number
): string {
  const p = path.join(workDir, 'kinetic.ass');
  const fontSize = Math.round(height * 0.11);
  const lines = texts
    .filter((t) => (t.text || '').trim())
    .map((t, i) => {
      const a = Math.max(0, Number(t.atSec) || 0) * 1000;
      const e = Math.max(a + 150, (Number(t.endSec) || 0) * 1000);
      const an = positionToAssAlignment(t.pos || 'middle');
      const col = hexToAssColor(t.color || '#39FF14');
      const esc = (t.text || '')
        .toUpperCase()
        .replace(/\\/g, '\\\\')
        .replace(/\{/g, '\\{')
        .replace(/\}/g, '\\}')
        .replace(/\r?\n/g, '\\N');
      // Fonte GRANDE (estilo VSL), adaptativa ao nº de palavras. Frases quebram
      // em 2-3 linhas via WrapStyle 0 sem estourar a tela.
      const nWords = (t.text || '').trim().split(/\s+/).length;
      const fs = Math.round(height * (nWords <= 2 ? 0.16 : nWords <= 4 ? 0.14 : 0.115));
      const bord = Math.max(9, Math.round(fs * 0.09));
      // Animações de ENTRADA variadas (rotaciona por índice): pop, zoom-in,
      // bounce, tilt. Sempre com fade-in suave.
      const ENTRANCES = [
        `\\fscx45\\fscy45\\t(0,130,\\fscx117\\fscy117)\\t(130,240,\\fscx100\\fscy100)`,
        `\\fscx175\\fscy175\\t(0,200,\\fscx100\\fscy100)`,
        `\\fscx55\\fscy55\\t(0,120,\\fscx122\\fscy122)\\t(120,210,\\fscx92\\fscy92)\\t(210,280,\\fscx100\\fscy100)`,
        `\\frz8\\fscx55\\fscy55\\t(0,150,\\frz0\\fscx112\\fscy112)\\t(150,240,\\fscx100\\fscy100)`,
      ];
      const entrance = ENTRANCES[i % ENTRANCES.length];
      const anim = `{\\an${an}\\fs${fs}\\c${col}\\3c&H000000&\\bord${bord}\\shad4\\fad(90,0)${entrance}}`;
      return `Dialogue: 0,${msToAssTime(a)},${msToAssTime(e)},Default,,0,0,0,,${anim}${esc}`;
    });
  const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Impact,${fontSize},&H0014FF39,&H0014FF39,&H00000000,&H00000000,1,0,0,0,100,100,2,0,1,10,3,5,60,60,120,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines.join('\n')}
`;
  fs.writeFileSync(p, ass, 'utf8');
  return p;
}

// F6.3/F6.11 — generate ASS file with KARAOKE-style word highlight.
//
// F6.11 changes: instead of one giant line with all words, we slice the
// sentence into GROUPS of `wordsPerLine` words. While the spoken word is
// in group N, only group N is visible (in 1-2 lines max). The active word
// inside the group is painted in `highlightColor`. This mimics ZapCap's
// pop-up style where only 1-8 words are on screen at a time (configurable).
//
// words[].offsetMs is RELATIVE to segment start (not absolute video time).
function writeAssFileKaraoke(
  workDir: string,
  idx: number,
  text: string,
  words: Array<{ text: string; offsetMs: number; durationMs: number }>,
  width: number,
  height: number,
  fontSize: number,
  position: string,
  highlightColorHex: string,
  totalDurationMs: number,
  wordsPerLine: number = 4,
  uppercase: boolean = true,
  fontFamily: string = 'Impact',
  // F6.15 — controles novos:
  //   textColorHex      — cor base do texto (palavras não-destacadas). Default branco.
  //   highlightMode     — como destacar a palavra ativa:
  //     'text'        → muda a cor das letras (comportamento original)
  //     'background'  → retângulo real desenhado atrás da palavra (F6.16,
  //                     antes era um halo via \bord)
  //     'both'        → letra muda de cor E retângulo aparece atrás
  //     'none'        → sem destaque por palavra; frase estática
  textColorHex: string = '#FFFFFF',
  highlightMode: 'text' | 'background' | 'rectangle' | 'both' | 'none' = 'text',
  // F6.16 — quando true, o retângulo (modo background/both) entra com
  // animação "pop": escala de 90% → 108% → 100% em ~250ms, dando aquela
  // batida visual estilo TikTok/CapCut. Sem efeito nos modos text/none.
  popAnimation: boolean = false,
  // F6.17 — cor da borda (outline) ao redor de cada letra. Default preto.
  // Espessura controlada via outlineThickness (params da Style — Outline=3 padrão).
  outlineColorHex: string = '#000000'
): string {
  const p = path.join(workDir, `text_kara_${idx}.ass`);
  const escapeAss = (s: string) =>
    s.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\r?\n/g, '\\N');
  // F6.12 — apply UPPERCASE here so static text fallback + per-word renders
  // all share the same transform.
  const transform = (s: string) => (uppercase ? s.toUpperCase() : s);

  const alignment = positionToAssAlignment(position);
  const highlightAss = hexToAssColor(highlightColorHex);
  const textAss = hexToAssColor(textColorHex);
  const outlineAss = hexToAssColor(outlineColorHex);

  // F6.20 — Constrói o token destacado de acordo com o modo escolhido.
  // Modos 'background'/'both' agora usam `\bord<grosso>\3c<cor>` aplicado
  // direto na palavra → libass renderiza halo em volta da letra na posição
  // exata. Zero estimativa de coordenada.
  //
  // popAnimation: usa `\t()` pra animar a espessura do bord (cresce e volta).
  // Mesmo efeito visual de "pop" mas atrelado ao texto, não a um shape solto.
  const popAnim = (baseBord: number): string => {
    if (!popAnimation) return `\\bord${baseBord}`;
    // Anima espessura: começa 80% → 115% (120ms) → 100% (130ms).
    const start = Math.round(baseBord * 0.8);
    const peak = Math.round(baseBord * 1.15);
    return `\\bord${start}\\t(0,120,\\bord${peak})\\t(120,250,\\bord${baseBord})`;
  };
  const buildHighlightedToken = (tok: string): string => {
    const escaped = escapeAss(tok);
    switch (highlightMode) {
      case 'text':
        // Muda cor primária (preenchimento da letra) + bold.
        return `{\\1c${highlightAss}\\b1}${escaped}{\\r}`;
      case 'background':
        // Texto na cor base + halo grosso colorido em volta da letra.
        // O halo segue contorno da letra → fica visualmente como "fundo"
        // colorido em volta da palavra. 100% alinhado à palavra falada
        // porque libass renderiza junto com a letra.
        return `{${popAnim(haloBorder)}\\3c${highlightAss}\\b1}${escaped}{\\r}`;
      case 'rectangle': {
        // Caixa RETANGULAR atrás da palavra: troca pro estilo DefaultBox
        // (BorderStyle=3 = caixa opaca contínua na cor do destaque). O \r
        // volta ao estilo Default. libass desenha a caixa no lugar exato da
        // palavra, sem estimar coordenada (mesma técnica robusta da headline).
        //
        // Animação pop (CapCut/TikTok): a caixa dá um esticão pra fora e
        // assenta MENOR que o tamanho base. Anima o \bord (margem da caixa):
        // base → pico (esticão, ~90ms) → assenta menor (~220ms). Sem animação,
        // fica no boxPad fixo. O \t() é relativo ao início do evento, que é
        // exatamente quando a palavra fica ativa.
        if (popAnimation) {
          const peak = Math.round(boxPad * 1.8);
          const settle = Math.max(2, Math.round(boxPad * 0.55));
          return `{\\rDefaultBox\\b1\\bord${boxPad}\\t(0,90,\\bord${peak})\\t(90,220,\\bord${settle})}${escaped}{\\rDefault}`;
        }
        return `{\\rDefaultBox\\b1}${escaped}{\\rDefault}`;
      }
      case 'both':
        // Letra colorida + halo colorido (mesma cor) = palavra "embrulhada"
        // toda em destaque.
        return `{\\1c${highlightAss}${popAnim(haloBorder)}\\3c${highlightAss}\\b1}${escaped}{\\r}`;
      case 'none':
        return escaped;
    }
  };
  // F6.21 — padding da caixa retangular (modo 'rectangle'). É o Outline do
  // estilo DefaultBox: com BorderStyle=3 vira a margem da caixa em volta do
  // texto. Reduzido de 0.18 → 0.10 pra caixa ficar mais JUSTA (antes sobrava
  // muito espaço em cima/embaixo da palavra).
  const boxPad = Math.max(4, Math.round(fontSize * 0.1));

  // F6.20 — REVERTIDO da abordagem "retângulo via \p1 + \pos calculada":
  // estimar largura/posição de palavra dentro de uma linha que pode quebrar
  // em N linhas tem variáveis demais e falhava em casos comuns (foto do
  // user mostrou retângulo entre 2 linhas de texto).
  //
  // Solução robusta: `\bord<grosso>\3c<cor>` aplicado na palavra ativa
  // dentro do MESMO evento de texto. libass desenha o outline AUTOMA-
  // TICAMENTE em volta da letra, no lugar correto, em qualquer linha,
  // em qualquer alinhamento. Zero estimativa, 100% alinhado.
  //
  // Resultado visual: halo colorido grosso em volta da palavra (segue
  // contorno das letras com cantos suaves), não retângulo perfeito. É
  // o que ZapCap/TikTok fazem na prática.
  // Espessura proporcional ao fontSize. Maior = mais "chunky"/parecido
  // com retângulo. Pode ajustar futuramente se cliente quiser.
  const haloBorder = Math.max(8, Math.round(fontSize * 0.25));

  const dialogueLines: string[] = [];

  if (words.length === 0 || highlightMode === 'none') {
    // Sem timing por palavra OU modo "nenhum" → texto estático na duração toda.
    const finalText =
      words.length > 0 ? words.map((w) => transform(w.text)).join(' ') : transform(text);
    dialogueLines.push(
      `Dialogue: 0,${msToAssTime(0)},${msToAssTime(totalDurationMs)},Default,,0,0,0,,${escapeAss(finalText)}`
    );
  } else {
    // F6.11/F6.12 — Split words into groups respecting BOTH wordsPerLine
    // AND sentence boundaries. A new group starts whenever:
    //   - Current group reached wordsPerLine words, OR
    //   - Previous word ended with sentence punctuation (. ! ?)
    // This avoids ugly mid-sentence reads like "as well. The vitamin".
    const groupSize = Math.max(1, Math.min(8, Math.floor(wordsPerLine)));
    const endsSentence = (t: string): boolean => /[.!?]['")\]]?$/.test(t.trim());
    const groups: Array<typeof words> = [];
    let current: typeof words = [];
    for (const w of words) {
      current.push(w);
      const reachedSize = current.length >= groupSize;
      const sentenceEnd = endsSentence(w.text);
      if (reachedSize || sentenceEnd) {
        groups.push(current);
        current = [];
      }
    }
    if (current.length > 0) groups.push(current);

    groups.forEach((group, groupIdx) => {
      const groupTokens = group.map((w) => transform(w.text));
      const groupStartMs = group[0]!.offsetMs;
      const isLastGroup = groupIdx === groups.length - 1;
      // Group ends when NEXT group starts (or end of segment if last).
      const groupEndMs = isLastGroup
        ? totalDurationMs
        : Math.min(groups[groupIdx + 1]![0]!.offsetMs, totalDurationMs);

      // F6.20 — Pra cada palavra do grupo, emite UM evento de Dialogue com
      // o grupo inteiro renderizado, e SÓ a palavra ativa recebendo os
      // overrides de destaque (cor/halo via buildHighlightedToken). libass
      // posiciona tudo automaticamente — zero estimativa de coordenada.
      group.forEach((w, i) => {
        const startMs = w.offsetMs;
        const isLastInGroup = i === group.length - 1;
        const endMs = isLastInGroup ? groupEndMs : Math.min(group[i + 1]!.offsetMs, groupEndMs);
        if (endMs <= startMs) return;

        const parts = groupTokens.map((tok, j) => {
          if (j === i) return buildHighlightedToken(tok);
          return escapeAss(tok);
        });
        dialogueLines.push(
          `Dialogue: 0,${msToAssTime(startMs)},${msToAssTime(endMs)},Default,,0,0,0,,${parts.join(' ')}`
        );
      });

      // If there's a tiny gap before group starts (first group only),
      // show the group statically.
      if (groupIdx === 0 && groupStartMs > 50) {
        dialogueLines.unshift(
          `Dialogue: 0,${msToAssTime(0)},${msToAssTime(groupStartMs)},Default,,0,0,0,,${escapeAss(groupTokens.join(' '))}`
        );
      }
    });
  }

  // MarginV: distance from edge in pixels. For middle (Alignment=5) it
  // is ignored. For top (8) it's distance from top; for bottom (2) from bottom.
  const marginV = position === 'middle' ? 0 : Math.round(height * 0.15);

  // F6.15 — PrimaryColour agora vem do textColor escolhido (não hardcoded
  // branco). Outline preto continua. Shadow=0.
  const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontFamily},${fontSize},${textAss},${textAss},${outlineAss},&H00000000,1,0,0,0,100,100,0,0,1,3,0,${alignment},80,80,${marginV},1
Style: DefaultBox,${fontFamily},${fontSize},${textAss},${textAss},${highlightAss},&H00000000,1,0,0,0,100,100,0,0,3,${boxPad},0,${alignment},80,80,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${dialogueLines.join('\n')}
`;

  fs.writeFileSync(p, ass, 'utf8');
  return p;
}

// POST /api/video/intercut
// Takes a finished video and splices in black-screen text segments. Audio
// plays continuously through both avatar and black chunks (the avatar audio
// just keeps going behind the black frames).
//
// Two modes:
//
//   1) Legacy "cadence" mode (backwards compat) — alternates avatar/black
//      at a regular interval until the video ends.
//      Body: { videoUrl, userId, avatarChunkSec, blackChunkSec, blackTexts[], fontSize? }
//
//   2) F6.3 "manual insertions" mode — user picks WHERE and WHAT each black
//      screen shows. Each insertion can carry per-word timestamps so we
//      render the caption with the word-being-spoken highlighted in sync.
//      Body: {
//        videoUrl, userId, fontSize?,
//        insertions: [{
//          atSec: number,                  // when in the source video to insert
//          durationSec: number,            // how long the black screen lasts
//          text: string,                   // full sentence to display
//          position: 'top'|'middle'|'bottom',
//          words?: [{ text, offsetMs, durationMs }],   // karaoke timing
//          highlightColor?: string,        // e.g. "#9333EA" — default purple
//        }]
//      }
videoRouter.post(
  '/intercut',
  withFfmpegQueue(async (req, res) => {
    const {
      videoUrl,
      avatarChunkSec,
      blackChunkSec,
      blackTexts,
      userId,
      fontSize = 64,
      insertions,
    } = req.body || {};

    if (!videoUrl || !userId) {
      return res.status(400).json({ error: 'videoUrl and userId are required.' });
    }

    // Mode detection: insertions[] present and non-empty → manual mode.
    const isManualMode = Array.isArray(insertions) && insertions.length > 0;

    // Legacy mode validation (only runs if NOT manual).
    let A = 0;
    let B = 0;
    let texts: string[] = [];
    if (!isManualMode) {
      A = Number(avatarChunkSec);
      B = Number(blackChunkSec);
      if (!Number.isFinite(A) || A < 3 || A > 120) {
        return res.status(400).json({ error: 'avatarChunkSec must be between 3 and 120.' });
      }
      if (!Number.isFinite(B) || B < 1 || B > 120) {
        return res.status(400).json({ error: 'blackChunkSec must be between 1 and 120.' });
      }
      texts = Array.isArray(blackTexts) ? blackTexts.map((t) => String(t)) : [];
    } else {
      // Validate each insertion shape.
      for (const ins of insertions) {
        if (
          !Number.isFinite(Number(ins?.atSec)) ||
          !Number.isFinite(Number(ins?.durationSec)) ||
          Number(ins.durationSec) <= 0
        ) {
          return res.status(400).json({ error: 'Each insertion needs atSec and durationSec > 0.' });
        }
      }
    }

    const intercutId = `intercut_${Date.now()}`;
    const workDir = path.join(GENERATED_DIR, intercutId);
    if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

    const sourcePath = path.join(workDir, 'source.mp4');
    const audioPath = path.join(workDir, 'audio.aac');

    try {
      log.info('intercut request', {
        videoUrl: videoUrl.substring(0, 80),
        mode: isManualMode ? 'manual' : 'cadence',
        A,
        B,
        texts: texts.length,
        insertions: isManualMode ? insertions.length : 0,
        // F6.17/F6.18/F6.19 — log dos params novos pra debug:
        // se algum chegar undefined/default sem o cliente ter setado,
        // sabemos que o frontend não tá enviando.
        fontFamily: req.body?.fontFamily,
        textColor: req.body?.textColor,
        outlineColor: req.body?.outlineColor,
        highlightMode: req.body?.highlightMode,
        popAnimation: req.body?.popAnimation,
        background: req.body?.background,
      });

      await downloadFile(videoUrl, sourcePath);

      const metadata: any = await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(sourcePath, (err, m) => (err ? reject(err) : resolve(m)));
      });
      const totalDuration: number = Number(metadata.format.duration) || 0;
      const vStream = metadata.streams.find((s: any) => s.codec_type === 'video');
      const W = vStream?.width || 1080;
      const H = vStream?.height || 1080;
      if (!isManualMode && totalDuration < A + 1) {
        return res.status(400).json({
          error: `Vídeo muito curto (${totalDuration.toFixed(1)}s) para inserir cortes a cada ${A}s.`,
        });
      }
      // Manual mode validation: each insertion must fit inside the source.
      if (isManualMode) {
        for (const ins of insertions) {
          if (
            Number(ins.atSec) < 0 ||
            Number(ins.atSec) + Number(ins.durationSec) > totalDuration + 0.5
          ) {
            return res.status(400).json({
              error: `Inserção em ${ins.atSec}s (+${ins.durationSec}s) cai fora do vídeo (${totalDuration.toFixed(1)}s).`,
            });
          }
        }
      }

      // Extract the original audio track so we can re-mux it onto the new
      // visual timeline. Audio is continuous — only the picture alternates.
      // Use dedicated methods (not outputOptions varargs) so each FFmpeg flag
      // arrives as its own argv token.
      await new Promise((resolve, reject) => {
        ffmpeg(sourcePath)
          .noVideo()
          .audioCodec('aac')
          .audioBitrate('128k')
          .output(audioPath)
          .on('end', () => resolve(null))
          .on('error', reject)
          .run();
      });

      // Build the visual timeline. Two strategies:
      //
      // Cadence mode: avatar(0..A), black(A..A+B), avatar, black, ... until
      // the source audio runs out. Texts cycle if fewer than black segments.
      //
      // F6.3 manual mode: a list of explicit "insert black at X for Y seconds
      // showing TEXT" events. We sort them by atSec and stitch avatar chunks
      // around them. Each black chunk uses ASS karaoke (per-word highlight)
      // when the insertion includes words[].
      const segments: string[] = [];
      let segIdx = 0;
      let blackIdx = 0;

      // Helper: render the original video from `start` for `dur` seconds.
      // Reused by both modes — only difference is when we call it.
      const renderAvatarSegment = async (start: number, dur: number): Promise<void> => {
        if (dur <= 0.1) return;
        const segPath = path.join(workDir, `seg_${segIdx++}_avatar.mp4`);
        await new Promise((resolve, reject) => {
          ffmpeg(sourcePath)
            .inputOptions('-accurate_seek')
            .setStartTime(start)
            .setDuration(dur)
            .outputOptions([
              '-c:v libx264',
              '-preset superfast',
              '-crf 23',
              '-an',
              '-pix_fmt yuv420p',
              '-r 30',
              '-vf',
              `scale=${W}:${H},setsar=1`,
            ])
            .output(segPath)
            .on('end', () => resolve(null))
            .on('error', reject)
            .run();
        });
        segments.push(segPath);
      };

      // Helper: render a black segment with optional caption/karaoke.
      const renderBlackSegment = async (
        durSec: number,
        text: string,
        words: Array<{ text: string; offsetMs: number; durationMs: number }> | undefined,
        position: string,
        highlightColor: string,
        wordsPerLine: number = 4,
        uppercase: boolean = true,
        fontFamily: string = 'Impact',
        // F6.15 — novos params propagados pro writeAssFileKaraoke
        textColor: string = '#FFFFFF',
        highlightMode: 'text' | 'background' | 'rectangle' | 'both' | 'none' = 'text',
        // F6.16 — toggle da animação pop do retângulo
        popAnimation: boolean = false,
        // F6.17 — cor da borda (outline) ao redor das letras
        outlineColor: string = '#000000',
        // F6.19 — tipo de background. 'black' = preto sólido (default).
        // 'space' = starfield via lavfi geq (estrelas piscando).
        // 'gradient' = gradient animado via lavfi color + hue shift.
        backgroundKind: 'black' | 'space' | 'gradient' = 'black'
      ): Promise<void> => {
        if (durSec < 0.3) return;
        let subtitleFilter = '';
        if (text) {
          // F6.15 — mesmo no modo 'none' usamos writeAssFileKaraoke pra honrar
          // textColor/uppercase/fontFamily corretamente. O modo 'none' por
          // dentro renderiza texto estático sem destaque por palavra.
          const assPath =
            words && words.length > 0
              ? writeAssFileKaraoke(
                  workDir,
                  segIdx,
                  text,
                  words,
                  W,
                  H,
                  fontSize,
                  position,
                  highlightColor,
                  durSec * 1000,
                  wordsPerLine,
                  uppercase,
                  fontFamily,
                  textColor,
                  highlightMode,
                  popAnimation,
                  outlineColor
                )
              : writeAssFile(workDir, segIdx, text, W, H, fontSize);
          // F6.18 — fontsdir aponta pras fontes bundled (Anton, Bebas Neue,
          // Inter Black, etc.). Sem isso, libass usa só fontes do sistema.
          subtitleFilter = `,subtitles=${escapeFilterPath(assPath)}:fontsdir=${escapeFilterPath(FONTS_DIR)}`;
        }
        const segPath = path.join(workDir, `seg_${segIdx++}_black.mp4`);
        // F6.19 — input do ffmpeg varia por backgroundKind:
        //
        // black:    lavfi color=c=black — sólido, rápido.
        //
        // space:    PNG de starfield em cache (gerada 1x via noise filter),
        //           lida com `-loop 1 -i path.png`. Por frame só precisa
        //           re-encodar a mesma imagem → libx264 comprime massivamente
        //           + processamento por frame mínimo. Adicionei zoom lento
        //           via scale (cheap) pra dar vibe de "viagem".
        //
        // gradient: lavfi color + hue rotation. Cor muda no tempo mas posição
        //           não → libx264 ainda comprime bem.
        log.info(
          `intercut segment: bg=${backgroundKind} font=${fontFamily} outline=${outlineColor}`
        );
        if (backgroundKind === 'space') {
          // Gera/cacheia starfield MP4 (1x por resolução). Próximas
          // chamadas com mesma resolução pulam a geração.
          const starfieldPath = await ensureStarfieldVideo(W, H);
          // -stream_loop -1 → repete o MP4 infinitamente (cheap, só demuxing).
          // -t durSec corta no tempo desejado. Quase grátis em CPU.
          await new Promise((resolve, reject) => {
            ffmpeg(starfieldPath)
              .inputOptions(['-stream_loop -1'])
              .outputOptions([
                '-c:v libx264',
                '-preset superfast',
                '-crf 23',
                '-an',
                '-pix_fmt yuv420p',
                '-t',
                String(durSec),
                '-vf',
                `setsar=1${subtitleFilter}`,
              ])
              .output(segPath)
              .on('end', () => resolve(null))
              .on('error', reject)
              .run();
          });
        } else if (backgroundKind === 'gradient') {
          await new Promise((resolve, reject) => {
            ffmpeg(`color=c=0x1a0b3a:s=${W}x${H}:d=${durSec}:r=30`)
              .inputFormat('lavfi')
              .outputOptions([
                '-c:v libx264',
                '-preset superfast',
                '-crf 23',
                '-an',
                '-pix_fmt yuv420p',
                '-vf',
                `setsar=1,hue=h=t*30:s=1.2${subtitleFilter}`,
              ])
              .output(segPath)
              .on('end', () => resolve(null))
              .on('error', reject)
              .run();
          });
        } else {
          // 'black' (default)
          await new Promise((resolve, reject) => {
            ffmpeg(`color=c=black:s=${W}x${H}:d=${durSec}:r=30`)
              .inputFormat('lavfi')
              .outputOptions([
                '-c:v libx264',
                '-preset superfast',
                '-crf 23',
                '-an',
                '-pix_fmt yuv420p',
                '-vf',
                `setsar=1${subtitleFilter}`,
              ])
              .output(segPath)
              .on('end', () => resolve(null))
              .on('error', reject)
              .run();
          });
        }
        segments.push(segPath);
        blackIdx++;
      };

      if (isManualMode) {
        // F6.11 — Merge consecutive insertions that have a tiny gap between
        // them into ONE continuous black segment. Avoids the visual hiccup
        // of going back to avatar for half a second between two sentences.
        // The merged segment plays both captions back-to-back, each timed
        // by the absolute audio offset.
        const mergeThresholdSec = Math.max(
          0,
          Math.min(2, Number(req.body?.mergeThresholdSec ?? 0.5))
        );
        const wordsPerLine = Math.max(
          1,
          Math.min(8, Math.floor(Number(req.body?.wordsPerLine ?? 4)))
        );
        // F6.12 — uppercase + fontFamily controls. Default uppercase=true
        // (ZapCap pop-up looks usually uppercase). Default font Impact —
        // heavy sans-serif most similar to the Viktor template.
        const uppercase = req.body?.uppercase !== false;
        const fontFamily = String(req.body?.fontFamily || 'Impact');
        // F6.15 — cor base do texto + modo de destaque por palavra.
        // Defaults preservam comportamento antigo (texto branco, destaque
        // em cor purple muda só a letra).
        const textColor = String(req.body?.textColor || '#FFFFFF');
        const allowedModes = ['text', 'background', 'rectangle', 'both', 'none'] as const;
        const reqMode = String(req.body?.highlightMode || 'text');
        const highlightMode = (
          allowedModes.includes(reqMode as any) ? reqMode : 'text'
        ) as (typeof allowedModes)[number];
        // F6.16 — animação pop do retângulo (default off pra preservar
        // comportamento das gerações anteriores).
        const popAnimation = req.body?.popAnimation === true;
        // F6.17 — cor da borda das letras
        const outlineColor = String(req.body?.outlineColor || '#000000');
        // F6.19 — tipo de background do segmento. 'black' = comportamento
        // atual. 'space' / 'gradient' geram via lavfi (sem download).
        const allowedBackgrounds = ['black', 'space', 'gradient'] as const;
        const reqBg = String(req.body?.background || 'black');
        const background = (
          allowedBackgrounds.includes(reqBg as any) ? reqBg : 'black'
        ) as (typeof allowedBackgrounds)[number];

        const sorted = [...insertions].sort((a: any, b: any) => Number(a.atSec) - Number(b.atSec));

        // Group consecutive insertions whose gap < threshold.
        // Each group becomes one black segment with concatenated captions.
        type MergedGroup = {
          atSec: number; // start of first insertion
          totalDurationSec: number; // end of last insertion - start of first
          text: string; // concatenated text
          words: Array<{ text: string; offsetMs: number; durationMs: number }>;
          position: string;
          highlightColor: string;
        };
        const groups: MergedGroup[] = [];
        for (const ins of sorted) {
          const at = Number(ins.atSec);
          const dur = Number(ins.durationSec);
          const endAt = at + dur;
          const last = groups[groups.length - 1];
          const lastEnd = last ? last.atSec + last.totalDurationSec : -Infinity;
          if (last && at - lastEnd <= mergeThresholdSec) {
            // Merge into the previous group: extend duration, append caption.
            const insWords = Array.isArray(ins.words) ? ins.words : [];
            // Offset each word from the merged group's atSec.
            const wordOffset = (at - last.atSec) * 1000;
            const shiftedWords = insWords.map((w: any) => ({
              text: String(w.text),
              offsetMs: Number(w.offsetMs) + wordOffset,
              durationMs: Number(w.durationMs),
            }));
            last.text = (last.text + ' ' + String(ins.text || '')).trim();
            last.words = last.words.concat(shiftedWords);
            last.totalDurationSec = endAt - last.atSec;
          } else {
            groups.push({
              atSec: at,
              totalDurationSec: dur,
              text: String(ins.text || ''),
              words: Array.isArray(ins.words)
                ? ins.words.map((w: any) => ({
                    text: String(w.text),
                    offsetMs: Number(w.offsetMs),
                    durationMs: Number(w.durationMs),
                  }))
                : [],
              position: String(ins.position || 'middle'),
              highlightColor: String(ins.highlightColor || '#9333EA'),
            });
          }
        }

        let cursor = 0;
        for (const g of groups) {
          if (g.atSec > cursor + 0.05) {
            await renderAvatarSegment(cursor, g.atSec - cursor);
          }
          await renderBlackSegment(
            g.totalDurationSec,
            g.text,
            g.words,
            g.position,
            g.highlightColor,
            wordsPerLine,
            uppercase,
            fontFamily,
            textColor,
            highlightMode,
            popAnimation,
            outlineColor,
            background
          );
          cursor = g.atSec + g.totalDurationSec;
        }
        // Tail: render the remaining avatar after the last group.
        if (cursor < totalDuration - 0.05) {
          await renderAvatarSegment(cursor, totalDuration - cursor);
        }
      } else {
        // Legacy cadence mode (preserved as-is for backwards compat).
        let cursor = 0;
        while (cursor < totalDuration - 0.05) {
          const aDur = Math.min(A, totalDuration - cursor);
          if (aDur > 0.1) {
            await renderAvatarSegment(cursor, aDur);
            cursor += aDur;
          }
          if (cursor >= totalDuration - 0.05) break;
          const bDur = Math.min(B, totalDuration - cursor);
          if (bDur < 0.5) break;
          const rawText = texts.length > 0 ? texts[blackIdx % texts.length] || '' : '';
          await renderBlackSegment(bDur, rawText, undefined, 'middle', '#9333EA');
          cursor += bDur;
        }
      }

      if (segments.length === 0) {
        return res.status(500).json({ error: 'No segments produced.' });
      }

      // Concat visual segments.
      const concatListPath = path.join(workDir, 'concat.txt');
      fs.writeFileSync(concatListPath, segments.map((p) => `file '${p}'`).join('\n'));

      const visualPath = path.join(workDir, 'visual.mp4');
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(concatListPath)
          .inputOptions(['-f concat', '-safe 0'])
          .outputOptions(['-c:v libx264', '-preset superfast', '-crf 23', '-pix_fmt yuv420p'])
          .output(visualPath)
          .on('end', () => resolve(null))
          .on('error', reject)
          .run();
      });

      // Re-mux original audio onto the stitched visual.
      const finalFilename = `${intercutId}.mp4`;
      const finalPath = path.join(GENERATED_DIR, finalFilename);
      await new Promise((resolve, reject) => {
        ffmpeg(visualPath)
          .input(audioPath)
          .outputOptions([
            '-c:v copy',
            '-c:a aac',
            '-b:a 128k',
            '-map 0:v:0',
            '-map 1:a:0',
            '-shortest',
            '-movflags +faststart',
          ])
          .output(finalPath)
          .on('end', () => resolve(null))
          .on('error', reject)
          .run();
      });

      // F6.14 — persistVideo handles retry + local fallback. URL returned
      // is either a Firebase signed URL (durable forever) or a local
      // /generated/ URL (still served by Express). Both work in the browser.
      const persistedBuf = fs.readFileSync(finalPath);
      const persistResult = await persistVideo({
        buffer: persistedBuf,
        filename: finalFilename,
        storageFolder: 'intercut',
        userId,
      });
      const publicUrl = persistResult.url;
      log.info('intercut persisted', {
        publicUrl: publicUrl.split('?')[0],
        firebase: persistResult.persisted,
      });

      res.json({ url: publicUrl, segments: segments.length, blackCount: blackIdx });
    } catch (err: any) {
      log.error('intercut failed:', err.message);
      res.status(500).json({ error: `Intercut failed: ${err.message}` });
    } finally {
      // Clean the work dir (keep the final file in GENERATED_DIR — it's
      // referenced by the local URL fallback).
      try {
        if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  })
);

// POST /api/video/concat
// Joins 2+ videos into one. Normalises every input to the first input's
// WxH/fps (scale + pad to fit, keeping aspect), then concats video+audio.
//
// Body:
//   videos: string[]   — URLs of the videos to concat, in order
//   userId: string
videoRouter.post(
  '/concat',
  withFfmpegQueue(async (req, res) => {
    const { videos, userId } = req.body || {};
    if (!Array.isArray(videos) || videos.length < 2) {
      return res.status(400).json({ error: 'videos must be an array of at least 2 URLs.' });
    }
    if (!userId) return res.status(400).json({ error: 'userId is required.' });

    const jobId = `concat_${Date.now()}`;
    const workDir = path.join(GENERATED_DIR, jobId);
    fs.mkdirSync(workDir, { recursive: true });

    try {
      log.info('concat request', { count: videos.length });

      // Download / copy each input. Videos that live on this server (e.g.
      // intercut/ZapCap output kept locally when Firebase upload failed) come
      // through as "/generated/foo.mp4" — those need a filesystem copy, not
      // an HTTP fetch, since downloadFile() can't resolve relative URLs.
      const localPaths: string[] = [];
      for (let i = 0; i < videos.length; i++) {
        const src = String(videos[i]);
        const p = path.join(workDir, `in_${i}.mp4`);
        if (src.startsWith('/generated/')) {
          const sourcePath = path.join(GENERATED_DIR, src.replace('/generated/', ''));
          if (!fs.existsSync(sourcePath)) {
            throw new Error(`Local video not found: ${src}`);
          }
          fs.copyFileSync(sourcePath, p);
        } else {
          await downloadFile(src, p);
        }
        localPaths.push(p);
      }

      // Probe the first input for target dimensions/fps.
      const firstMeta: any = await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(localPaths[0]!, (err, m) => (err ? reject(err) : resolve(m)));
      });
      const v0 = firstMeta.streams.find((s: any) => s.codec_type === 'video');
      const W = v0?.width || 1080;
      const H = v0?.height || 1920;

      // Re-encode each input to identical WxH (scale + pad), 30 fps, AAC
      // stereo audio. Generate silent audio for inputs without sound so the
      // concat filter always sees v+a per input.
      const normalised: string[] = [];
      for (let i = 0; i < localPaths.length; i++) {
        const inPath = localPaths[i]!;
        const outPath = path.join(workDir, `norm_${i}.mp4`);
        const meta: any = await new Promise((resolve, reject) => {
          ffmpeg.ffprobe(inPath, (err, m) => (err ? reject(err) : resolve(m)));
        });
        const hasAudio = !!meta.streams.find((s: any) => s.codec_type === 'audio');

        await new Promise((resolve, reject) => {
          const cmd = ffmpeg(inPath);
          if (!hasAudio) {
            cmd.input('anullsrc=channel_layout=stereo:sample_rate=48000').inputFormat('lavfi');
          }
          cmd
            .videoFilters(
              `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`
            )
            .outputOptions([
              '-c:v',
              'libx264',
              '-preset',
              'superfast',
              '-crf',
              '20',
              '-c:a',
              'aac',
              '-b:a',
              '160k',
              '-ar',
              '48000',
              '-ac',
              '2',
              '-pix_fmt',
              'yuv420p',
              '-shortest',
            ])
            .output(outPath)
            .on('end', () => resolve(null))
            .on('error', reject)
            .run();
        });
        normalised.push(outPath);
      }

      // Use the concat demuxer now that all inputs share codec params.
      const listPath = path.join(workDir, 'concat.txt');
      fs.writeFileSync(listPath, normalised.map((p) => `file '${p}'`).join('\n'));

      const finalFilename = `${jobId}.mp4`;
      const finalPath = path.join(GENERATED_DIR, finalFilename);

      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(listPath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions(['-c', 'copy', '-movflags', '+faststart'])
          .output(finalPath)
          .on('end', () => resolve(null))
          .on('error', reject)
          .run();
      });

      // F6.14 — durable URL via persistVideo (retry + local fallback).
      const persistedBuf = fs.readFileSync(finalPath);
      const persistResult = await persistVideo({
        buffer: persistedBuf,
        filename: finalFilename,
        storageFolder: 'concat',
        userId,
      });
      const publicUrl = persistResult.url;
      log.info('concat persisted', {
        publicUrl: publicUrl.split('?')[0],
        firebase: persistResult.persisted,
      });

      res.json({ url: publicUrl, count: videos.length });
    } catch (err: any) {
      log.error('concat failed:', err.message);
      res.status(500).json({ error: `Concat failed: ${err.message}` });
    } finally {
      try {
        if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  })
);

// Convert "#RRGGBB" → ASS-friendly "&H00BBGGRR&" (ASS uses BGR, reversed).
function hexToAssBgr(hex: string): string {
  const clean = hex.replace('#', '').padStart(6, '0').slice(0, 6);
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  return `&H00${b}${g}${r}&`.toUpperCase();
}

// Normalise a string for word-by-word matching against an AssemblyAI
// transcript: lowercase, strip punctuation, collapse whitespace, return tokens.
function normaliseForMatch(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

// Find a contiguous run of transcript words that matches the headline
// tokens. Returns the [startMs, endMs] of the matched run, or null if
// no match. Match is exact-token; we don't do fuzzy yet because the
// avatar usually reads the script verbatim.
function findHeadlineTimingInTranscript(
  headlineText: string,
  words: Array<{ text: string; start: number; end: number }>
): { startMs: number; endMs: number } | null {
  const headlineTokens = normaliseForMatch(headlineText);
  if (headlineTokens.length === 0 || words.length === 0) return null;
  const transcriptTokens = words.map((w) => normaliseForMatch(w.text)[0] || '');
  for (let i = 0; i <= transcriptTokens.length - headlineTokens.length; i++) {
    let ok = true;
    for (let j = 0; j < headlineTokens.length; j++) {
      if (transcriptTokens[i + j] !== headlineTokens[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      const first = words[i]!;
      const last = words[i + headlineTokens.length - 1]!;
      return { startMs: first.start, endMs: last.end };
    }
  }
  return null;
}

// Uploads a local file to AssemblyAI's /upload endpoint and returns the
// resulting transient URL, which can then be passed as audio_url in a
// transcript request. Needed when our source video lives at /generated/...
// (not reachable from AssemblyAI's servers).
async function uploadToAssemblyAI(localPath: string, apiKey: string): Promise<string | null> {
  try {
    const buf = fs.readFileSync(localPath);
    const resp = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: { authorization: apiKey, 'content-type': 'application/octet-stream' },
      body: buf,
    });
    if (!resp.ok) {
      log.error('assemblyai upload failed', { status: resp.status });
      return null;
    }
    const data = await resp.json();
    return data.upload_url || null;
  } catch (err: any) {
    log.error('assemblyai upload exception', { err: err.message });
    return null;
  }
}

// Submits a video URL (must be publicly fetchable) to AssemblyAI, polls
// until completion, returns word-level timestamps. Returns null on any
// failure so the caller can fall back to manual timing.
async function fetchAssemblyAIWords(
  audioUrl: string,
  apiKey: string
): Promise<Array<{ text: string; start: number; end: number }> | null> {
  try {
    const submit = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: { authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio_url: audioUrl,
        speech_models: ['universal-2'],
        language_detection: true,
      }),
    });
    if (!submit.ok) {
      log.error('assemblyai submit failed', { status: submit.status });
      return null;
    }
    const submitData = await submit.json();
    const id = submitData.id;
    if (!id) return null;

    // Poll up to ~3 minutes (24 * 7.5s) — short hooks usually complete
    // under 30s, but headroom for AssemblyAI queue spikes.
    for (let attempt = 0; attempt < 24; attempt++) {
      await new Promise((r) => setTimeout(r, 7500));
      const status = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
        headers: { authorization: apiKey },
      });
      if (!status.ok) continue;
      const data = await status.json();
      if (data.status === 'completed') return data.words || [];
      if (data.status === 'error') {
        log.error('assemblyai transcript errored', { error: data.error });
        return null;
      }
    }
    log.error('assemblyai polling timed out');
    return null;
  } catch (err: any) {
    log.error('assemblyai exception', { err: err.message });
    return null;
  }
}

// POST /api/video/add-headline
// Burns a Meta-style colored bar with a headline across the top of the
// video. The bar is rendered via FFmpeg's drawbox filter; the text via the
// ASS subtitles filter (libass) which our ffmpeg-static build supports.
//
// Body:
//   videoUrl: string            — source video (HTTP or /generated/...)
//   userId: string
//   text: string                — the headline text
//   bgColor?: string            — hex like "#000000" (default black)
//   textColor?: string          — hex like "#FFFFFF" (default white)
//   fontSize?: number           — px, default ~10% of video height
//   barHeightPct?: number       — 5..30 (% of video height), default 14
videoRouter.post(
  '/add-headline',
  withFfmpegQueue(async (req, res) => {
    const {
      videoUrl,
      userId,
      text,
      bgColor = '#000000',
      textColor = '#FFFFFF',
      strokeColor = '',
      strokeWidth = 0,
      highlightColor1 = '',
      highlightColor2 = '',
      highlightColor3 = '',
      bgHighlight1 = '',
      bgHighlight2 = '',
      bgHighlight3 = '',
      wordStyles,
      // New multi-headline shape: array of { text, wordStyles, bgColor? }.
      // Each headline gets its own bar color (inherits global bgColor if absent)
      // and ASS dialogue. switchPct (10-90) controls when the second one starts
      // in manual mode. When autoTime=true, we ignore switchPct and instead
      // transcribe the audio + find each headline's spoken timestamps.
      headlines: headlinesArr,
      switchPct = 50,
      autoTime = false,
      fontSize,
      barHeightPct = 14,
    } = req.body || {};

    if (!videoUrl || !userId) {
      return res.status(400).json({ error: 'videoUrl and userId are required.' });
    }
    // Build the headlines list. Backwards-compat: if no `headlines` array, treat
    // the top-level text/wordStyles as a single headline.
    const incomingHeadlines: Array<{ text?: string; wordStyles?: any; bgColor?: string }> =
      Array.isArray(headlinesArr) && headlinesArr.length > 0
        ? headlinesArr
        : [{ text, wordStyles, bgColor }];
    const headlinesList = incomingHeadlines
      .map((h) => ({
        text: String(h?.text || '').trim(),
        wordStyles: Array.isArray(h?.wordStyles) ? h.wordStyles : [],
        bgColor: typeof h?.bgColor === 'string' && h.bgColor ? h.bgColor : bgColor,
      }))
      .filter((h) => h.text.length > 0);
    if (headlinesList.length === 0) {
      return res.status(400).json({ error: 'At least one headline text is required.' });
    }
    if (headlinesList.length > 2) {
      return res.status(400).json({ error: 'Maximum 2 headlines supported.' });
    }
    const switchAtPct = Math.max(10, Math.min(90, Number(switchPct) || 50));
    const barPct = Math.max(5, Math.min(30, Number(barHeightPct) || 14));
    const isHex = (s: any) => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
    const strokeW = Math.max(0, Math.min(8, Number(strokeWidth) || 0));

    const jobId = `headline_${Date.now()}`;
    const workDir = path.join(GENERATED_DIR, jobId);
    fs.mkdirSync(workDir, { recursive: true });

    try {
      log.info('add-headline request', {
        videoUrl: String(videoUrl).substring(0, 60),
        headlinesCount: headlinesList.length,
        switchPct: switchAtPct,
        bgColor,
        textColor,
      });

      const sourcePath = path.join(workDir, 'source.mp4');
      const src = String(videoUrl);
      if (src.startsWith('/generated/')) {
        const localPath = path.join(GENERATED_DIR, src.replace('/generated/', ''));
        if (!fs.existsSync(localPath)) throw new Error(`Local video not found: ${src}`);
        fs.copyFileSync(localPath, sourcePath);
      } else {
        await downloadFile(src, sourcePath);
      }

      const metadata: any = await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(sourcePath, (err, m) => (err ? reject(err) : resolve(m)));
      });
      const vStream = metadata.streams.find((s: any) => s.codec_type === 'video');
      const W = vStream?.width || 1080;
      const H = vStream?.height || 1920;
      const barHeight = Math.round((H * barPct) / 100);
      const fSize = Math.max(20, Math.min(160, Number(fontSize) || Math.round(barHeight * 0.55)));

      // Per-word styling: each headline carries its own `wordStyles` array
      // (Array<{tc: 0|1|2|3, bg: 0|1|2|3}>) indexed by non-whitespace token.
      //   tc = which letter color from the 3-color palette (0 = default)
      //   bg = which background highlight from the 3-color palette (0 = none)
      // We tokenize the text keeping whitespace, walk word by word, and emit
      // ASS chunks that switch between the HL (normal+stroke) and HLBG
      // (BorderStyle=3 = opaque colored box per character) styles inline.
      const assPath = path.join(workDir, 'headline.ass');
      const textColors: (string | null)[] = [
        isHex(highlightColor1) ? highlightColor1 : null,
        isHex(highlightColor2) ? highlightColor2 : null,
        isHex(highlightColor3) ? highlightColor3 : null,
      ];
      const bgColors: (string | null)[] = [
        isHex(bgHighlight1) ? bgHighlight1 : null,
        isHex(bgHighlight2) ? bgHighlight2 : null,
        isHex(bgHighlight3) ? bgHighlight3 : null,
      ];

      const escAss = (s: string): string =>
        s
          .replace(/\\/g, '\\\\')
          .replace(/\{/g, '\\{')
          .replace(/\}/g, '\\}')
          .replace(/\r?\n/g, '\\N');

      // Padding for the per-char bg box. Big enough to look like a tight
      // highlight bar at this font size, small enough not to swallow letters.
      const bgPadding = Math.max(4, Math.round(fSize * 0.12));

      // Build the inline ASS text for one headline. Suffix lets the caller
      // target style HL_<suffix> / HLBG_<suffix> so we can have per-headline
      // styles when there are two.
      function renderHeadlineText(
        txt: string,
        ws: Array<{ tc?: number; bg?: number }>,
        suffix: string
      ): string {
        const tokens = txt.split(/(\s+)/);
        let wordIdx = 0;
        let prevTc = 0;
        let prevBg = 0;
        let out = '';
        for (const tok of tokens) {
          if (tok === '') continue;
          const isWhitespace = /^\s+$/.test(tok);
          const style = isWhitespace ? null : ws[wordIdx] || {};
          if (!isWhitespace) wordIdx++;
          const tc = isWhitespace ? 0 : Number(style?.tc) || 0;
          const bg = isWhitespace ? prevBg : Number(style?.bg) || 0;

          const overrides: string[] = [];
          if (bg > 0 && prevBg === 0) {
            overrides.push(`\\rHLBG_${suffix}`);
          } else if (bg === 0 && prevBg > 0) {
            overrides.push(`\\rHL_${suffix}`);
          }
          if (bg > 0 && (bg !== prevBg || prevBg === 0)) {
            const bgHex = bgColors[bg - 1];
            if (bgHex) {
              overrides.push(`\\3c${hexToAssBgr(bgHex)}\\bord${bgPadding}`);
            }
          }
          if (tc !== prevTc) {
            if (tc === 0) {
              overrides.push(`\\c${hexToAssBgr(textColor)}`);
            } else {
              const tcHex = textColors[tc - 1];
              if (tcHex) overrides.push(`\\c${hexToAssBgr(tcHex)}`);
            }
          }

          if (overrides.length > 0) {
            out += `{${overrides.join('')}}`;
          }
          out += escAss(tok);
          prevTc = tc;
          prevBg = bg;
        }
        return out;
      }

      // Probe duration so we can split timing across 2 headlines.
      const durationSec: number = Number(metadata.format?.duration) || 0;
      if (durationSec <= 0) {
        throw new Error('Could not detect video duration.');
      }
      const switchAtSec =
        headlinesList.length === 2 ? (durationSec * switchAtPct) / 100 : durationSec;

      // Auto-sync: if the user asked for it, transcribe the source audio via
      // AssemblyAI, find each headline's spoken timestamps, and use those for
      // ASS dialogue + drawbox timing. perHeadlineTimings stays null if any
      // step fails — the loop below then falls back to manual percent timing.
      let perHeadlineTimings: Array<{ startSec: number; endSec: number } | null> | null = null;
      let autoTimeStatus: 'off' | 'applied' | 'failed' | 'partial' = autoTime ? 'failed' : 'off';
      if (autoTime) {
        const aaKey = getAssemblyAIKey();
        if (!aaKey) {
          log.warn('add-headline: autoTime requested but ASSEMBLYAI_API_KEY missing');
        } else {
          // Use the source URL directly if HTTP, else upload the local file.
          const srcStr = String(videoUrl);
          let assemblyAudioUrl: string | null = null;
          if (srcStr.startsWith('http')) {
            assemblyAudioUrl = srcStr;
          } else {
            log.info('add-headline autoTime: uploading local source to AssemblyAI');
            assemblyAudioUrl = await uploadToAssemblyAI(sourcePath, aaKey);
          }
          if (assemblyAudioUrl) {
            log.info('add-headline autoTime: requesting transcript');
            const words = await fetchAssemblyAIWords(assemblyAudioUrl, aaKey);
            if (words && words.length > 0) {
              const detected = headlinesList.map((h) => {
                const m = findHeadlineTimingInTranscript(h.text, words);
                return m ? { startSec: m.startMs / 1000, endSec: m.endMs / 1000 } : null;
              });
              const matched = detected.filter((t) => t !== null).length;
              if (matched === headlinesList.length) {
                perHeadlineTimings = detected;
                autoTimeStatus = 'applied';
              } else if (matched > 0) {
                // Partial match: use detected for matched headlines, fall back
                // for unmatched ones (start=0/switchAtSec, end=switchAtSec/duration).
                perHeadlineTimings = detected.map((t, idx) => {
                  if (t) return t;
                  const fallbackStart = idx === 0 ? 0 : switchAtSec;
                  const fallbackEnd =
                    idx === 0 && headlinesList.length === 2 ? switchAtSec : durationSec;
                  return { startSec: fallbackStart, endSec: fallbackEnd };
                });
                autoTimeStatus = 'partial';
                log.warn('add-headline autoTime: partial match', {
                  matchedCount: matched,
                  total: headlinesList.length,
                });
              } else {
                log.warn('add-headline autoTime: no headline found in transcript');
              }

              // Normalise the auto-detected timings so the displayed headlines
              // match what the user expects:
              //   1. Headline #1 ALWAYS starts at 0 — the first headline should
              //      be visible from the very first frame of the hook, not when
              //      its first matching word happens to be spoken.
              //   2. Each headline's end is clamped to the next one's start
              //      (no overlap, no gap). libass treats Dialogue End as
              //      exclusive, so an exact boundary produces a clean handoff.
              //   3. The last headline stays on until the end of the video.
              if (perHeadlineTimings) {
                const first = perHeadlineTimings[0];
                if (first) first.startSec = 0;

                for (let i = 0; i < perHeadlineTimings.length - 1; i++) {
                  const cur = perHeadlineTimings[i];
                  const next = perHeadlineTimings[i + 1];
                  if (cur && next) {
                    // Bridge gap AND clamp overlap — either way, cur.end ==
                    // next.start exactly so the user never sees both at once.
                    cur.endSec = next.startSec;
                  }
                }
                const last = perHeadlineTimings[perHeadlineTimings.length - 1];
                if (last && last.endSec < durationSec) {
                  last.endSec = durationSec;
                }
                log.info('add-headline autoTime: timings after normalization', {
                  status: autoTimeStatus,
                  timings: perHeadlineTimings,
                });
              }
            }
          }
        }
      }
      const toAssTime = (sec: number): string => {
        const totalCs = Math.max(0, Math.round(sec * 100));
        const cs = totalCs % 100;
        const totalS = Math.floor(totalCs / 100);
        const s = totalS % 60;
        const totalM = Math.floor(totalS / 60);
        const mm = totalM % 60;
        const h = Math.floor(totalM / 60);
        return `${h}:${String(mm).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(
          cs
        ).padStart(2, '0')}`;
      };

      const centerX = Math.round(W / 2);
      const centerY = Math.round(barHeight / 2);
      // Stroke (outline): if user supplied a stroke color + non-zero width,
      // bake it into the HL Style. HLBG always uses BorderStyle=3 with
      // dynamic outline width set inline via \bord.
      const outlineColourAss = isHex(strokeColor) ? hexToAssBgr(strokeColor) : '&H00000000';
      const outlineWidthForStyle = isHex(strokeColor) && strokeW > 0 ? strokeW : 0;
      const textColourAss = hexToAssBgr(textColor);

      // Build styles + dialogues per headline. With 2 headlines we suffix
      // styles _1 / _2 so per-headline style switches don't collide.
      const styleLines: string[] = [];
      const dialogueLines: string[] = [];
      headlinesList.forEach((h, idx) => {
        const suffix = String(idx + 1);
        styleLines.push(
          `Style: HL_${suffix},Arial,${fSize},${textColourAss},${textColourAss},${outlineColourAss},&H00000000,1,0,0,0,100,100,0,0,1,${outlineWidthForStyle},0,5,40,40,0,1`
        );
        styleLines.push(
          `Style: HLBG_${suffix},Arial,${fSize},${textColourAss},${textColourAss},&H00000000,&H00000000,1,0,0,0,100,100,0,0,3,0,0,5,40,40,0,1`
        );
        const auto = perHeadlineTimings?.[idx] ?? null;
        const start = auto ? auto.startSec : idx === 0 ? 0 : switchAtSec;
        const end = auto
          ? auto.endSec
          : idx === 0 && headlinesList.length === 2
            ? switchAtSec
            : durationSec;
        const rendered = renderHeadlineText(h.text, h.wordStyles, suffix);
        dialogueLines.push(
          `Dialogue: 0,${toAssTime(start)},${toAssTime(end)},HL_${suffix},,0,0,0,,{\\an5\\pos(${centerX},${centerY})}${rendered}`
        );
      });

      const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styleLines.join('\n')}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${dialogueLines.join('\n')}
`;
      fs.writeFileSync(assPath, ass, 'utf8');

      // FFmpeg pipeline: chain ONE drawbox per headline, each timed via the
      // drawbox `enable` expression. Bar timings match the ASS dialogue
      // timings exactly — no overlap, no gap. Per user request: when H2
      // appears, H1 should disappear in the same frame.
      const drawboxFilters = headlinesList.map((h, idx) => {
        const color = (h.bgColor || bgColor).replace('#', '').toLowerCase();
        const auto = perHeadlineTimings?.[idx] ?? null;
        const start = auto ? auto.startSec : idx === 0 ? 0 : switchAtSec;
        const end = auto
          ? auto.endSec
          : idx === 0 && headlinesList.length === 2
            ? switchAtSec
            : durationSec;
        const needsGate = !!auto || headlinesList.length > 1;
        const enable = needsGate
          ? `:enable='between(t,${start.toFixed(2)},${end.toFixed(2)})'`
          : '';
        return `drawbox=x=0:y=0:w=${W}:h=${barHeight}:color=0x${color}:t=fill${enable}`;
      });
      const videoFilter = `${drawboxFilters.join(',')},subtitles=${escapeFilterPath(assPath)}`;

      const finalFilename = `${jobId}.mp4`;
      const finalPath = path.join(GENERATED_DIR, finalFilename);

      await new Promise((resolve, reject) => {
        ffmpeg(sourcePath)
          .videoFilters(videoFilter)
          .outputOptions([
            '-c:v',
            'libx264',
            '-preset',
            'superfast',
            '-crf',
            '20',
            '-c:a',
            'copy',
            '-pix_fmt',
            'yuv420p',
            '-movflags',
            '+faststart',
          ])
          .output(finalPath)
          .on('end', () => resolve(null))
          .on('error', reject)
          .run();
      });

      // F6.14 — durable URL via persistVideo (retry + local fallback).
      const persistedBuf = fs.readFileSync(finalPath);
      const persistResult = await persistVideo({
        buffer: persistedBuf,
        filename: finalFilename,
        storageFolder: 'headline',
        userId,
      });
      const publicUrl = persistResult.url;
      log.info('headline persisted', {
        publicUrl: publicUrl.split('?')[0],
        firebase: persistResult.persisted,
      });

      res.json({ url: publicUrl, autoTimeStatus });
    } catch (err: any) {
      log.error('add-headline failed:', err.message);
      res.status(500).json({ error: `Add headline failed: ${err.message}` });
    } finally {
      try {
        if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  })
);

// POST /api/video/add-music
//
// F7.1 — Mix a background music track into an existing video, preserving
// the original voiceover audio. Returns a durable URL via persistVideo.
//
// Body:
//   videoUrl: string       — source video (http(s) or /generated/...)
//   musicUrl: string       — music track (same)
//   userId: string         — for Firebase Storage path
//   volume?: number        — music volume 0.05-1.0 (default 0.2 = 20%)
//   fadeInSec?: number     — music fade-in seconds (default 1)
//   fadeOutSec?: number    — music fade-out seconds (default 2)
videoRouter.post(
  '/add-music',
  withFfmpegQueue(async (req, res) => {
    const {
      videoUrl,
      musicUrl,
      userId,
      volume = 0.2,
      fadeInSec = 1,
      fadeOutSec = 2,
    } = req.body || {};
    if (!videoUrl || !musicUrl || !userId) {
      return res.status(400).json({ error: 'videoUrl, musicUrl, userId são obrigatórios.' });
    }
    const vol = Math.max(0.02, Math.min(1.0, Number(volume)));
    const fIn = Math.max(0, Math.min(20, Number(fadeInSec)));
    const fOut = Math.max(0, Math.min(20, Number(fadeOutSec)));

    const jobId = `addmusic_${Date.now()}`;
    const workDir = path.join(GENERATED_DIR, jobId);
    fs.mkdirSync(workDir, { recursive: true });

    try {
      log.info('add-music request', {
        videoUrl: String(videoUrl).substring(0, 80),
        musicUrl: String(musicUrl).substring(0, 80),
        volume: vol,
      });

      // downloadFile handles /generated/ local copy + http (F6.12 patch).
      const videoPath = path.join(workDir, 'video.mp4');
      const musicPath = path.join(workDir, 'music.mp3');
      await downloadFile(videoUrl, videoPath);
      await downloadFile(musicUrl, musicPath);

      // Probe video duration so we can trim/pad music to fit.
      const meta: any = await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(videoPath, (err, m) => (err ? reject(err) : resolve(m)));
      });
      const videoDurationSec: number = Number(meta.format.duration) || 0;
      if (videoDurationSec < 0.5) {
        throw new Error(`Vídeo muito curto (${videoDurationSec}s).`);
      }

      // Probe a duração da MÚSICA. Se for mais curta que o vídeo, em vez de
      // preencher com SILÊNCIO (o que fazia a trilha "parar" antes do fim),
      // damos LOOP na faixa até cobrir o vídeo inteiro. Aí cortamos no tamanho
      // exato e aplicamos os fades.
      const musicMeta: any = await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(musicPath, (err, m) => (err ? reject(err) : resolve(m)));
      });
      const musicDurationSec: number = Number(musicMeta.format.duration) || 0;
      const needsLoop = musicDurationSec > 0 && musicDurationSec < videoDurationSec - 0.3;

      // Fade-out: começa `fOut` segundos antes do fim do vídeo.
      const fadeOutStart = Math.max(0, videoDurationSec - fOut);
      // O loop é feito no INPUT (-stream_loop), não no filtro: aloop com size
      // gigante é instável e às vezes não repetia (deixava silêncio no fim).
      // -stream_loop -1 repete o arquivo de música quantas vezes precisar; o
      // atrim corta na duração exata do vídeo. apad fica como rede pra micro-
      // diferenças quando NÃO precisa loop.
      const musicFilter = [
        needsLoop ? null : `apad`,
        `atrim=duration=${videoDurationSec}`,
        `asetpts=N/SR/TB`,
        fIn > 0 ? `afade=t=in:st=0:d=${fIn}` : '',
        fOut > 0 ? `afade=t=out:st=${fadeOutStart}:d=${fOut}` : '',
        `volume=${vol}`,
      ]
        .filter(Boolean)
        .join(',');

      const filterComplex = `[1:a]${musicFilter}[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=0[aout]`;

      const finalFilename = `${jobId}.mp4`;
      const finalPath = path.join(GENERATED_DIR, finalFilename);

      await new Promise((resolve, reject) => {
        const cmd = ffmpeg().input(videoPath).input(musicPath);
        // Loop da música no nível de INPUT quando ela é mais curta que o vídeo.
        // inputOptions aplica ao ÚLTIMO input adicionado (a música) — por isso
        // vem DEPOIS do .input(musicPath).
        if (needsLoop) cmd.inputOptions(['-stream_loop', '-1']);
        cmd
          .complexFilter(filterComplex)
          .outputOptions([
            '-map',
            '0:v:0',
            '-map',
            '[aout]',
            '-c:v',
            'copy',
            '-c:a',
            'aac',
            '-b:a',
            '192k',
            '-shortest',
            '-movflags',
            '+faststart',
          ])
          .output(finalPath)
          .on('end', () => resolve(null))
          .on('error', reject)
          .run();
      });

      // F6.14 — durable URL with retry + local fallback.
      const persistedBuf = fs.readFileSync(finalPath);
      const persistResult = await persistVideo({
        buffer: persistedBuf,
        filename: finalFilename,
        storageFolder: 'addmusic',
        userId,
      });
      log.info('add-music persisted', {
        url: persistResult.url.split('?')[0],
        firebase: persistResult.persisted,
      });

      res.json({ url: persistResult.url, durationSec: videoDurationSec });
    } catch (err: any) {
      log.error('add-music failed:', err.message);
      res.status(500).json({ error: `Add music failed: ${err.message}` });
    } finally {
      try {
        if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  })
);

// POST /api/video/watermark
// Sobrepõe a LOGO/marca do usuário no vídeo, na posição/tamanho/opacidade
// escolhidos. Body: { videoUrl, logoUrl, position, sizePct, opacity, marginPct, userId }
//   position: 'tl'|'tr'|'bl'|'br'|'center'; sizePct: largura da logo em % do vídeo.
videoRouter.post(
  '/watermark',
  withFfmpegQueue(async (req, res) => {
    const { videoUrl, logoUrl, position = 'br', sizePct = 0.18, opacity = 1, marginPct = 0.03, userId } =
      req.body || {};
    if (!videoUrl || !logoUrl || !userId) {
      return res.status(400).json({ error: 'videoUrl, logoUrl e userId são obrigatórios.' });
    }
    const size = Math.max(0.03, Math.min(0.6, Number(sizePct) || 0.18));
    const op = Math.max(0.1, Math.min(1, Number(opacity) || 1));
    const marginF = Math.max(0, Math.min(0.2, Number(marginPct) || 0.03));

    const jobId = `wm_${Date.now()}`;
    const workDir = path.join(GENERATED_DIR, jobId);
    fs.mkdirSync(workDir, { recursive: true });
    try {
      const videoPath = path.join(workDir, 'video.mp4');
      const logoPath = path.join(workDir, 'logo.png');
      await downloadFile(videoUrl, videoPath);
      await downloadFile(logoUrl, logoPath);

      // Descobre a largura do vídeo pra dimensionar a logo (e a margem) em px.
      const meta: any = await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(videoPath, (err, m) => (err ? reject(err) : resolve(m)));
      });
      const vStream = meta.streams.find((s: any) => s.codec_type === 'video');
      const W = vStream?.width || 1080;
      const logoW = Math.max(20, Math.round(W * size));
      const m = Math.round(W * marginF);

      // Posição do overlay via expressões (usa main_/overlay_ do ffmpeg).
      const posMap: Record<string, string> = {
        tl: `${m}:${m}`,
        tr: `main_w-overlay_w-${m}:${m}`,
        bl: `${m}:main_h-overlay_h-${m}`,
        br: `main_w-overlay_w-${m}:main_h-overlay_h-${m}`,
        center: `(main_w-overlay_w)/2:(main_h-overlay_h)/2`,
      };
      const xy = posMap[String(position)] || posMap.br;
      const filterComplex =
        `[1:v]scale=${logoW}:-1,format=rgba,colorchannelmixer=aa=${op}[wm];` +
        `[0:v][wm]overlay=${xy}[v]`;

      const finalFilename = `${jobId}.mp4`;
      const finalPath = path.join(GENERATED_DIR, finalFilename);
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(videoPath)
          .input(logoPath)
          .complexFilter(filterComplex)
          .outputOptions(['-map', '[v]', '-map', '0:a?', ...ENCODE_FAST, '-movflags', '+faststart'])
          .output(finalPath)
          .on('end', () => resolve(null))
          .on('error', reject)
          .run();
      });

      const persistResult = await persistVideo({
        buffer: fs.readFileSync(finalPath),
        filename: finalFilename,
        storageFolder: 'watermark',
        userId,
      });
      log.info('watermark persisted', { url: persistResult.url.split('?')[0] });
      res.json({ url: persistResult.url });
    } catch (err: any) {
      log.error('watermark failed:', err.message);
      res.status(500).json({ error: `Watermark failed: ${err.message}` });
    } finally {
      try {
        if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  })
);

// POST /api/video/broll
// Insere clipes de B-roll (vindos do Pexels) DENTRO do vídeo do avatar, ANTES
// das legendas. Cada clipe vira um "cutaway" full-frame na janela escolhida,
// com o áudio original do avatar seguindo por baixo. O ZapCap roda depois e
// queima a legenda por cima (inclusive sobre o b-roll).
//
// Body: { videoUrl, userId, inserts: [{ clipUrl, atSec, durationSec }] }
// Resposta: { url }  (novo vídeo persistido no Storage)
videoRouter.post(
  '/broll',
  withFfmpegQueue(async (req, res) => {
    const { videoUrl, userId, inserts } = req.body || {};
    if (!videoUrl || !userId) {
      return res.status(400).json({ error: 'videoUrl e userId são obrigatórios.' });
    }
    if (!Array.isArray(inserts) || inserts.length === 0) {
      return res.json({ url: videoUrl });
    }
    const clips = inserts.slice(0, 12);

    const stamp = Date.now();
    const workDir = path.join(GENERATED_DIR, `broll_${stamp}`);
    fs.mkdirSync(workDir, { recursive: true });
    const basePath = path.join(workDir, 'base.mp4');
    const outPath = path.join(workDir, 'out.mp4');

    try {
      await downloadFile(videoUrl, basePath);

      const clipPaths: string[] = [];
      for (let i = 0; i < clips.length; i++) {
        const cp = path.join(workDir, `clip_${i}.mp4`);
        await downloadFile(clips[i].clipUrl, cp);
        clipPaths.push(cp);
      }

      const { width, height } = await new Promise<{ width: number; height: number }>(
        (resolve, reject) => {
          ffmpeg.ffprobe(basePath, (err, meta) => {
            if (err) return reject(err);
            const s = meta.streams.find((x) => x.codec_type === 'video');
            resolve({ width: s?.width || 1080, height: s?.height || 1920 });
          });
        }
      );

      const filters: string[] = [];
      clips.forEach((ins: any, idx: number) => {
        const dur = Math.max(0.5, Number(ins.durationSec) || 3);
        const at = Math.max(0, Number(ins.atSec) || 0);
        filters.push(
          `[${idx + 1}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
            `crop=${width}:${height},trim=0:${dur},setpts=PTS-STARTPTS+${at}/TB[ov${idx}]`
        );
      });
      let prev = '0:v';
      clips.forEach((ins: any, idx: number) => {
        const dur = Math.max(0.5, Number(ins.durationSec) || 3);
        const at = Math.max(0, Number(ins.atSec) || 0);
        const end = at + dur;
        const out = idx === clips.length - 1 ? 'vout' : `tmp${idx}`;
        filters.push(
          `[${prev}][ov${idx}]overlay=eof_action=pass:enable='between(t\\,${at}\\,${end})'[${out}]`
        );
        prev = out;
      });

      await new Promise((resolve, reject) => {
        const cmd = ffmpeg();
        cmd.input(basePath);
        clipPaths.forEach((p) => cmd.input(p));
        cmd
          .complexFilter(filters)
          .outputOptions(['-map', '[vout]', '-map', '0:a?', ...ENCODE_BALANCED])
          .save(outPath)
          .on('end', () => resolve(null))
          .on('error', reject);
      });

      const buffer = fs.readFileSync(outPath);
      const { url } = await persistVideo({
        buffer,
        filename: `broll_${stamp}.mp4`,
        storageFolder: 'broll',
        userId,
      });
      res.json({ url });
    } catch (err: any) {
      log.error('[Video B-roll] Erro:', err.message);
      res.status(500).json({ error: processDataError(err) });
    } finally {
      try {
        if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  })
);

// POST /api/video/compose
// Monta um vídeo novo a partir de N vídeos ALINHADOS (mesma duração e mesmo
// áudio — ex.: mesmas copy/voz/avatar/legenda, só b-roll/tela-preta diferentes).
// Pra cada trecho [startSec,endSec] você escolhe de QUAL vídeo o VÍDEO vem; o
// ÁUDIO sai inteiro do 1º vídeo (idêntico nos demais) → corte sem clique.
// Body: { videos: string[], userId, segments: [{ sourceIndex, startSec, endSec }] }
videoRouter.post(
  '/compose',
  withFfmpegQueue(async (req, res) => {
    const { videos, userId, segments } = req.body || {};
    if (!Array.isArray(videos) || videos.length === 0 || !userId) {
      return res.status(400).json({ error: 'videos e userId são obrigatórios.' });
    }
    if (!Array.isArray(segments) || segments.length === 0) {
      return res.status(400).json({ error: 'segments é obrigatório.' });
    }
    const segs = segments.slice(0, 60);
    const stamp = Date.now();
    const workDir = path.join(GENERATED_DIR, `compose_${stamp}`);
    fs.mkdirSync(workDir, { recursive: true });
    const outPath = path.join(workDir, 'out.mp4');

    try {
      // Baixa os vídeos em PARALELO (antes era um por um).
      const srcPaths: string[] = videos.map((_: string, i: number) =>
        path.join(workDir, `src_${i}.mp4`)
      );
      await Promise.all(videos.map((u: string, i: number) => downloadFile(u, srcPaths[i]!)));

      await new Promise((resolve, reject) => {
        const cmd = ffmpeg();
        // 1 input por segmento (reabre o arquivo da fonte daquele trecho).
        segs.forEach((s: any) => {
          const idx = Math.max(0, Math.min(Number(s.sourceIndex) || 0, srcPaths.length - 1));
          cmd.input(srcPaths[idx]!);
        });
        // input extra = fonte 0 (áudio inteiro, idêntico em todos).
        cmd.input(srcPaths[0]!);
        const audioIdx = segs.length;

        const filters: string[] = [];
        segs.forEach((s: any, i: number) => {
          const a = Math.max(0, Number(s.startSec) || 0);
          const b = Math.max(a + 0.05, Number(s.endSec) || 0);
          filters.push(`[${i}:v]trim=${a}:${b},setpts=PTS-STARTPTS[v${i}]`);
        });
        filters.push(
          `${segs.map((_: any, i: number) => `[v${i}]`).join('')}concat=n=${segs.length}:v=1:a=0[vout]`
        );

        cmd
          .complexFilter(filters)
          .outputOptions(['-map', '[vout]', '-map', `${audioIdx}:a?`, '-shortest', ...ENCODE_FAST, '-c:a aac', '-b:a 128k'])
          .save(outPath)
          .on('end', () => resolve(null))
          .on('error', reject);
      });

      const buffer = fs.readFileSync(outPath);
      const { url } = await persistVideo({
        buffer,
        filename: `compose_${stamp}.mp4`,
        storageFolder: 'compose',
        userId,
      });
      res.json({ url });
    } catch (err: any) {
      log.error('[Video Compose] Erro:', err.message);
      res.status(500).json({ error: processDataError(err) });
    } finally {
      try {
        if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  })
);

// POST /api/video/sequence
// Monta UMA sequência a partir de vários TRECHOS (clipes do próprio usuário),
// na ordem dada, cada um com o SEU PRÓPRIO áudio. Normaliza tudo pra 1080x1920
// (pad preto) + 30fps + áudio 44100 estéreo, depois concatena. Body:
// { clips: [{ url, startSec?, endSec? }], userId } → { url }
videoRouter.post(
  '/sequence',
  withFfmpegQueue(async (req, res) => {
    const { clips, userId, muted } = req.body || {};
    if (!Array.isArray(clips) || clips.length === 0 || !userId) {
      return res.status(400).json({ error: 'clips e userId são obrigatórios.' });
    }
    const list = clips.slice(0, 60).filter((c: any) => c && c.url);
    if (list.length === 0) return res.status(400).json({ error: 'Nenhum clipe válido.' });
    const stamp = Date.now();
    const workDir = path.join(GENERATED_DIR, `sequence_${stamp}`);
    fs.mkdirSync(workDir, { recursive: true });
    const outPath = path.join(workDir, 'out.mp4');

    try {
      // Baixa os clipes em PARALELO (antes era um por um).
      const srcPaths: string[] = list.map((_: any, i: number) =>
        path.join(workDir, `clip_${i}.mp4`)
      );
      await Promise.all(list.map((c: any, i: number) => downloadFile(c.url, srcPaths[i]!)));

      await new Promise((resolve, reject) => {
        const cmd = ffmpeg();
        srcPaths.forEach((p) => cmd.input(p));

        // muted = trechos sem som (o usuário põe voz+música depois). Senão,
        // mantém o áudio de cada trecho.
        const isMuted = !!muted;
        const filters: string[] = [];
        list.forEach((c: any, i: number) => {
          const a = Math.max(0, Number(c.startSec) || 0);
          const b = Number(c.endSec) || 0;
          const vTrim = b > a ? `trim=${a}:${b},` : a > 0 ? `trim=start=${a},` : '';
          filters.push(
            `[${i}:v]${vTrim}setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}]`
          );
          if (!isMuted) {
            const aTrim = b > a ? `atrim=${a}:${b},` : a > 0 ? `atrim=start=${a},` : '';
            filters.push(
              `[${i}:a]${aTrim}asetpts=PTS-STARTPTS,aformat=sample_rates=44100:channel_layouts=stereo[a${i}]`
            );
          }
        });

        if (isMuted) {
          filters.push(
            `${list.map((_: any, i: number) => `[v${i}]`).join('')}concat=n=${list.length}:v=1:a=0[vout]`
          );
        } else {
          filters.push(
            `${list.map((_: any, i: number) => `[v${i}][a${i}]`).join('')}concat=n=${list.length}:v=1:a=1[vout][aout]`
          );
        }

        cmd
          .complexFilter(filters)
          .outputOptions(
            isMuted
              ? ['-map', '[vout]', '-an', ...ENCODE_FAST]
              : ['-map', '[vout]', '-map', '[aout]', ...ENCODE_FAST, '-c:a aac', '-b:a 128k']
          )
          .save(outPath)
          .on('end', () => resolve(null))
          .on('error', reject);
      });

      const buffer = fs.readFileSync(outPath);
      const { url } = await persistVideo({
        buffer,
        filename: `sequence_${stamp}.mp4`,
        storageFolder: 'sequence',
        userId,
      });
      res.json({ url });
    } catch (err: any) {
      log.error('[Video Sequence] Erro:', err.message);
      res.status(500).json({ error: processDataError(err) });
    } finally {
      try {
        if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  })
);

// POST /api/video/timeline
// Monta um vídeo TIMED ao áudio: base preta 1080x1920 com a duração do áudio,
// cada trecho sobreposto no seu intervalo [atSec, endSec] (buracos = preto), e o
// áudio (voz) por cima de tudo. Body:
// { audioUrl, durationSec, clips:[{url, atSec, endSec, trimStart?}], userId } → { url }
videoRouter.post(
  '/timeline',
  withFfmpegQueue(async (req, res) => {
    const { audioUrl, durationSec, clips, userId } = req.body || {};
    if (!audioUrl || !userId || !Array.isArray(clips) || clips.length === 0) {
      return res.status(400).json({ error: 'audioUrl, clips e userId são obrigatórios.' });
    }
    // Janela opcional: renderiza só um GRUPO da timeline. `audioStartSec` é o
    // offset no áudio; `durationSec` vira a duração DA JANELA. Os clipes já vêm
    // rebaseados (atSec/endSec relativos ao início da janela). Permite montar um
    // vídeo longo em pedaços de ~2 min e concatenar depois (evita 1 render pesado).
    const audioStartSec = Math.max(0, Number((req.body || {}).audioStartSec) || 0);
    // Formato do vídeo + enquadramento. `fit`: 'cover' preenche o frame cortando
    // o excesso (sem barras pretas); 'contain' encaixa o clipe inteiro (com barras).
    const AR: Record<string, [number, number]> = {
      '1:1': [1080, 1080],
      '9:16': [1080, 1920],
      '16:9': [1920, 1080],
    };
    let [W, H] = AR[String((req.body || {}).aspectRatio)] || [1080, 1080];
    // PRÉVIA RÁPIDA (rascunho): metade da resolução = ¼ dos pixels → render bem
    // mais rápido pra conferir o corte antes do render final em 1080p.
    const draft = !!(req.body || {}).draft;
    if (draft) {
      W = Math.max(2, Math.round((W * 0.5) / 2) * 2);
      H = Math.max(2, Math.round((H * 0.5) / 2) * 2);
    }
    const fit = String((req.body || {}).fit) === 'contain' ? 'contain' : 'cover';
    const scaleFit =
      fit === 'cover'
        ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`
        : `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`;
    const dur = Math.max(1, Math.min(Number(durationSec) || 0, 1800));
    if (!dur) return res.status(400).json({ error: 'durationSec inválida.' });
    const list = clips.slice(0, 40).filter((c: any) => c && c.url);
    if (list.length === 0) return res.status(400).json({ error: 'Nenhum clipe válido.' });
    const stamp = Date.now();
    const workDir = path.join(GENERATED_DIR, `timeline_${stamp}`);
    fs.mkdirSync(workDir, { recursive: true });
    const outPath = path.join(workDir, 'out.mp4');

    try {
      const clipPaths: string[] = [];
      // Caches CONCORRÊNCIA-SAFE: guardam a PROMESSA (não o path resolvido). Como
      // os trechos são compostos em PARALELO, duas tarefas com a mesma URL pegam
      // a MESMA promessa em vez de baixar duas vezes pro mesmo arquivo (o que
      // corromperia o download). A atribuição da entrada é síncrona (antes de
      // qualquer await), então não há corrida no índice do path.
      // JANELA do avatar usada por ESTE render: menor/maior seek entre os trechos
      // de avatar. Cortamos o avatar (enorme — ex.: 480 MB/10 min) pra essa janela
      // UMA vez → cada composite lê um arquivo PEQUENO. Ler o arquivo de 480 MB em
      // paralelo (vários composites seekando ao mesmo tempo) era o gargalo real
      // (disputa de IO deixava cada composite ~5× mais lento).
      const AV_LAYOUTS = new Set([
        'avatar',
        'pip',
        'split-left',
        'split-right',
        'split-top',
        'split-bottom',
      ]);
      let avWinStart = 0;
      let avWinLen = 0;
      {
        let lo = Infinity;
        let hi = -Infinity;
        for (const c of list) {
          if (c && c.avatarUrl && AV_LAYOUTS.has(String(c.layout || ''))) {
            const s = Math.max(0, Number(c.avatarSeek) || 0);
            const d = Math.max(0.1, (Number(c.endSec) || 0) - (Number(c.atSec) || 0));
            lo = Math.min(lo, s);
            hi = Math.max(hi, s + d);
          }
        }
        if (lo !== Infinity && hi > lo) {
          avWinStart = Math.max(0, lo - 0.5);
          avWinLen = hi - avWinStart + 1; // margem no fim
        }
      }
      const avatarCache: Record<string, Promise<string>> = {};
      const getAvatarBase = (url: string): Promise<string> => {
        if (!avatarCache[url]) {
          avatarCache[url] = (async () => {
            const full = await getPersistentAvatar(url); // 480 MB, baixado 1×
            if (avWinLen <= 0) return full;
            // Corta pra janela do bloco (uma vez): arquivo pequeno, sem disputa
            // de IO. Output começa em avWinStart (timestamps zerados) → o seek de
            // cada composite vira (avatarSeek − avWinStart).
            const tp = path.join(workDir, `avtrim_${Object.keys(avatarCache).length}.mp4`);
            await new Promise((resolve, reject) => {
              ffmpeg()
                .input(full)
                .inputOptions(['-ss', String(avWinStart)])
                .outputOptions([
                  '-t',
                  String(avWinLen),
                  '-an',
                  '-c:v',
                  'libx264',
                  '-preset',
                  'ultrafast',
                  '-pix_fmt',
                  'yuv420p',
                ])
                .save(tp)
                .on('end', () => resolve(null))
                .on('error', (e: any, _o: any, se: any) =>
                  reject(new Error(`avtrim: ${e?.message || e} | ${(se || '').slice(-200)}`))
                );
            });
            return tp;
          })();
        }
        return avatarCache[url]!;
      };
      // Dimensões do avatar (ffprobe UMA vez por arquivo).
      const avatarDims: Record<string, Promise<{ w: number; h: number }>> = {};
      const getAvatarDims = (avPath: string): Promise<{ w: number; h: number }> => {
        if (!avatarDims[avPath]) {
          avatarDims[avPath] = (async () => {
            const meta: any = await new Promise((resolve, reject) =>
              ffmpeg.ffprobe(avPath, (err, m) => (err ? reject(err) : resolve(m)))
            );
            const vs = (meta.streams || []).find((s: any) => s.width && s.height) || {};
            return { w: Number(vs.width) || 1920, h: Number(vs.height) || 1080 };
          })();
        }
        return avatarDims[avPath]!;
      };
      // Cache de B-ROLL por URL (o split/pip re-baixava o mesmo b-roll).
      const bgCache: Record<string, Promise<string>> = {};
      const getBg = (url: string): Promise<string> => {
        if (!bgCache[url]) {
          const bp = path.join(workDir, `bgc_${Object.keys(bgCache).length}.mp4`);
          bgCache[url] = downloadFile(url, bp).then(() => bp);
        }
        return bgCache[url]!;
      };
      // Máscara CIRCULAR gerada UMA vez (o geq por-pixel por-frame era o gargalo
      // do PiP). Depois é só alphamerge (rápido) em cada trecho.
      let circleMaskPromise: Promise<string> | null = null;
      const getCircleMask = (D: number): Promise<string> => {
        if (!circleMaskPromise) {
          circleMaskPromise = new Promise<string>((resolve, reject) => {
            const mp = path.join(workDir, 'circle_mask.png');
            const cc = D / 2;
            const rr2 = cc * cc;
            ffmpeg()
              .input(`color=c=black:s=${D}x${D}:d=0.1`)
              .inputOptions(['-f', 'lavfi'])
              .complexFilter([
                `format=gray,geq=lum='if(lte((X-${cc})*(X-${cc})+(Y-${cc})*(Y-${cc})\\,${rr2})\\,255\\,0)'`,
              ])
              .outputOptions(['-frames:v', '1'])
              .save(mp)
              .on('end', () => resolve(mp))
              .on('error', (err: any, _o: any, stderr: any) =>
                reject(new Error(`mask: ${err?.message || err} | ${(stderr || '').slice(-300)}`))
              );
          });
        }
        return circleMaskPromise;
      };
      // Paralelismo dos composites. Os FILTROS do ffmpeg (scale/blur/overlay) já
      // usam vários núcleos sozinhos, então rodar muitos composites juntos só
      // divide os núcleos entre eles (não acelera o trabalho de CPU). Usamos 2:
      // cada composite pega ~metade dos núcleos e ainda sobrepomos os downloads.
      const CPU_CORES = Math.max(2, os.cpus().length || 4);
      const CLIP_CONCURRENCY = 2;
      const CLIP_THREADS = Math.max(1, Math.floor(CPU_CORES / CLIP_CONCURRENCY));
      const buildClip = async (i: number): Promise<void> => {
        const p = path.join(workDir, `clip_${i}.mp4`);
        // Duração que o composite PRECISA ter (o trecho + margem). Sem isto, o
        // composite encodava a duração INTEIRA do input (ex.: avatar cortado de
        // 111s) em vez dos ~3s do trecho → cada composite virava um encode
        // gigante e o render TRAVAVA. Limita cada composite a essa janela.
        const compDur =
          Math.max(
            0.5,
            (Number(list[i].trimStart) || 0) +
              ((Number(list[i].endSec) || 0) - (Number(list[i].atSec) || 0))
          ) + 0.5;
        // AVATAR COMPOSTO: PiP (círculo no canto) ou SPLIT com avatar. Pré-monta
        // num único clipe WxH → o resto do filtergraph fica idêntico.
        const layout = String(list[i].layout || '');
        const avatarUrl = list[i].avatarUrl;
        if (
          (layout === 'avatar' ||
            layout === 'pip' ||
            layout === 'split-left' ||
            layout === 'split-right' ||
            layout === 'split-top' ||
            layout === 'split-bottom') &&
          avatarUrl
        ) {
          try {
            // Seek relativo ao corte (o avatar já foi cortado a partir de avWinStart).
            const avSeek = Math.max(0, (Number(list[i].avatarSeek) || 0) - avWinStart);
            // AVATAR TELA CHEIA: só o avatar, sem b-roll. Preenche WxH com FUNDO
            // BORRADO do próprio vídeo (igual VSL rica): fundo = cópia ampliada +
            // blur cobrindo WxH; frente = vídeo inteiro encaixado (contain) e
            // centralizado. Se a proporção bate (ex.: 16:9 em 16:9) a frente cobre
            // tudo e o blur nem aparece; se a base é vertical num 16:9, as laterais
            // ficam com o vídeo borrado em vez de barra preta / corte na cabeça.
            if (layout === 'avatar') {
              const av = await getAvatarBase(avatarUrl);
              const { w: FSW, h: FSH } = await getAvatarDims(av);
              const preCrop = buildPreCrop(list[i], FSW, FSH).pre;
              await new Promise((resolve, reject) => {
                const cmd = ffmpeg().input(av);
                if (avSeek > 0) cmd.inputOptions([`-ss`, String(avSeek)]);
                cmd
                  .complexFilter([
                    // Fundo borrado BARATO: reduz pra ~1/4, borra o frame pequeno
                    // e amplia de volta. Blur a 1080p (boxblur=24:3) custava ~4s/
                    // trecho — era o real gargalo; assim cai pra ~1s, visual igual.
                    `[0:v]${preCrop}split=2[abg][afg]`,
                    `[abg]scale=${Math.round(W / 4)}:${Math.round(H / 4)}:force_original_aspect_ratio=increase,crop=${Math.round(W / 4)}:${Math.round(H / 4)},boxblur=6:1,scale=${W}:${H},setsar=1[abgb]`,
                    `[afg]scale=${W}:${H}:force_original_aspect_ratio=decrease,setsar=1[afgf]`,
                    `[abgb][afgf]overlay=(W-w)/2:(H-h)/2:shortest=1,setsar=1[v]`,
                  ])
                  .outputOptions(['-map', '[v]', '-an', ...ENCODE_FAST, '-threads', String(CLIP_THREADS), '-t', String(compDur)])
                  .save(p)
                  .on('end', () => resolve(null))
                  .on('error', (err: any, _o: any, stderr: any) =>
                    reject(new Error(`avatar-full: ${err?.message || err} | ${(stderr || '').slice(-300)}`))
                  );
              });
              clipPaths[i] = p;
              return;
            }
            const bg = await getBg(list[i].url); // b-roll (fundo, cacheado)
            const av = await getAvatarBase(avatarUrl); // avatar (cacheado)
            const rawDims = await getAvatarDims(av); // dims reais do avatar
            // Pre-crop (remove legenda/rodapé): dims EFETIVAS = já recortadas.
            const { pre: preCrop, ESW: SW, ESH: SH } = buildPreCrop(list[i], rawDims.w, rawDims.h);
            const D = Math.round(H * 0.34); // diâmetro do círculo do PiP
            const maskP = layout === 'pip' ? await getCircleMask(D) : '';
            await new Promise((resolve, reject) => {
              const cmd = ffmpeg().input(bg).input(av);
              if (avSeek > 0) cmd.inputOptions([`-ss`, String(avSeek)]); // seek no avatar (último input)
              if (maskP) {
                cmd.input(maskP); // máscara do círculo (input 2)
                cmd.inputOptions(['-loop', '1']); // repete a imagem por todos os frames
              }
              let filters: string[];
              if (layout === 'pip') {
                const m = Math.round(H * 0.04); // margem do canto
                // Círculo do PiP posicionado pelo ENQUADRAMENTO calibrado: centro
                // (pipCX,pipCY) normalizado e diâmetro pipSize (fração do menor
                // lado). Default = topo-centro (rosto). Crop numérico (dims já
                // recortadas) com clamp pra nunca estourar a borda do avatar.
                const pipSize = Math.min(1, Math.max(0.2, Number(list[i].pipSize) || 0.72));
                const pipCX = Math.min(1, Math.max(0, Number(list[i].pipCX ?? 0.5)));
                const pipCY = Math.min(1, Math.max(0, Number(list[i].pipCY ?? 0.28)));
                const side = Math.round(Math.min(SW, SH) * pipSize);
                const cx = Math.round(Math.min(SW - side, Math.max(0, SW * pipCX - side / 2)));
                const cy = Math.round(Math.min(SH - side, Math.max(0, SH * pipCY - side / 2)));
                const faceCrop = `crop=${side}:${side}:${cx}:${cy}`;
                filters = [
                  `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[bg]`,
                  `[1:v]${preCrop}${faceCrop},scale=${D}:${D},setsar=1[face]`,
                  `[2:v]format=gray,scale=${D}:${D}[mask]`,
                  `[face][mask]alphamerge[circ]`,
                  `[bg][circ]overlay=W-w-${m}:${m}:shortest=1[v]`,
                ];
              } else {
                // SPLIT em 2 orientações:
                //  - horizontal (split-left/right): avatar numa METADE LATERAL → hstack
                //  - vertical  (split-top/bottom):  avatar numa METADE em cima/baixo → vstack
                const vertical = layout === 'split-top' || layout === 'split-bottom';
                const avatarFirst = layout === 'split-left' || layout === 'split-top';
                // Dimensões da metade do avatar e da metade do b-roll.
                const avHalfW = vertical ? W : Math.floor(W / 2);
                const avHalfH = vertical ? Math.floor(H / 2) : H;
                const brHalfW = vertical ? W : W - avHalfW;
                const brHalfH = vertical ? H - avHalfH : H;
                // CAIXA de recorte com a proporção da metade do avatar; TAMANHO
                // (splitSize) = escala da maior caixa que cabe na fonte (1 = maior
                // possível/mais aberto; menor = mais zoom). Posição por splitCX/CY.
                const boxAR = avHalfW / avHalfH;
                const sCX = Math.min(1, Math.max(0, Number(list[i].splitCX ?? 0.5)));
                const sCY = Math.min(1, Math.max(0, Number(list[i].splitCY ?? 0.4)));
                const sSize = Math.min(1, Math.max(0.4, Number(list[i].splitSize ?? 1)));
                const maxBoxW = Math.min(SW, SH * boxAR);
                const boxW = Math.round(maxBoxW * sSize);
                const boxH = Math.round((maxBoxW / boxAR) * sSize);
                const cx = Math.round(Math.min(SW - boxW, Math.max(0, SW * sCX - boxW / 2)));
                const cy = Math.round(Math.min(SH - boxH, Math.max(0, SH * sCY - boxH / 2)));
                const avF = `[1:v]${preCrop}crop=${boxW}:${boxH}:${cx}:${cy},scale=${avHalfW}:${avHalfH},setsar=1[avh]`;
                const brF = `[0:v]scale=${brHalfW}:${brHalfH}:force_original_aspect_ratio=increase,crop=${brHalfW}:${brHalfH},setsar=1[brh]`;
                const stack = vertical ? 'vstack' : 'hstack';
                const order = avatarFirst ? `[avh][brh]` : `[brh][avh]`;
                filters = [avF, brF, `${order}${stack}=inputs=2[v]`];
              }
              cmd
                .complexFilter(filters)
                .outputOptions(['-map', '[v]', '-an', ...ENCODE_FAST, '-threads', String(CLIP_THREADS), '-t', String(compDur)])
                .save(p)
                .on('end', () => resolve(null))
                .on('error', (err: any, _o: any, stderr: any) =>
                  reject(new Error(`${err?.message || err} | STDERR: ${(stderr || '').slice(-600)}`))
                );
            });
            clipPaths[i] = p;
            return;
          } catch (avErr: any) {
            // Falhou a composição do avatar (PiP/split/full) → cai no b-roll
            // simples abaixo. Loga pra diagnosticar quando o avatar "não aparece".
            log.error(
              `[Timeline avatar ${layout}] trecho ${i} (seek ${list[i].avatarSeek}s) falhou: ${avErr?.message || avErr}`
            );
          }
        }
        // SPLIT-SCREEN: se o item tem `url2`, pré-monta os 2 b-rolls lado a lado
        // num único clipe WxH. Assim o resto do filtergraph (transições, zoom,
        // texto, índices) fica IDÊNTICO — split não afeta mais nada.
        if (list[i].url2) {
          try {
            const lp = path.join(workDir, `split_l_${i}.mp4`);
            const rp = path.join(workDir, `split_r_${i}.mp4`);
            await downloadFile(list[i].url, lp);
            await downloadFile(list[i].url2, rp);
            const halfW = Math.floor(W / 2);
            const rightW = W - halfW;
            await new Promise((resolve, reject) => {
              ffmpeg()
                .input(lp)
                .input(rp)
                .complexFilter([
                  `[0:v]scale=${halfW}:${H}:force_original_aspect_ratio=increase,crop=${halfW}:${H},setsar=1[l]`,
                  `[1:v]scale=${rightW}:${H}:force_original_aspect_ratio=increase,crop=${rightW}:${H},setsar=1[r]`,
                  `[l][r]hstack=inputs=2[v]`,
                ])
                .outputOptions(['-map', '[v]', '-an', ...ENCODE_FAST, '-threads', String(CLIP_THREADS), '-t', String(compDur)])
                .save(p)
                .on('end', () => resolve(null))
                .on('error', reject);
            });
            clipPaths[i] = p;
            return;
          } catch {
            /* falhou o split → cai no b-roll simples abaixo */
          }
        }
        await downloadFile(list[i].url, p);
        clipPaths[i] = p;
      };
      // Compõe os trechos em PARALELO (concorrência = CLIP_CONCURRENCY, adaptada
      // aos núcleos) — antes era 1 por vez e uma VSL longa estourava o teto de
      // 15 min. Os caches acima deduplicam downloads.
      let clipNext = 0;
      await Promise.all(
        Array.from({ length: Math.min(CLIP_CONCURRENCY, list.length) }, async () => {
          for (;;) {
            const i = clipNext++;
            if (i >= list.length) break;
            await buildClip(i);
          }
        })
      );
      const audioPath = path.join(workDir, 'audio.mp3');
      await downloadFile(audioUrl, audioPath);

      // Sons de transição (opcional) — entrada toca no início, saída no começo
      // da transição de saída (end - dOut).
      const sounds: { path: string; at: number }[] = [];
      for (let i = 0; i < list.length; i++) {
        const at = Math.max(0, Number(list[i].atSec) || 0);
        const end = Math.max(at + 0.1, Number(list[i].endSec) || 0);
        const dOut = Math.min(Math.max(0.1, Number(list[i].transOutDur) || 0.4), Math.max(0.1, end - at));
        if (list[i].soundIn) {
          try {
            const sp = path.join(workDir, `sin_${i}.mp3`);
            await downloadFile(list[i].soundIn, sp);
            sounds.push({ path: sp, at });
          } catch {
            /* ignora */
          }
        }
        if (list[i].soundOut) {
          try {
            const sp = path.join(workDir, `sout_${i}.mp3`);
            await downloadFile(list[i].soundOut, sp);
            sounds.push({ path: sp, at: Math.max(0, end - dOut) });
          } catch {
            /* ignora */
          }
        }
        // Efeito contextual. Padrão: toca logo depois da entrada (não colide com
        // o whoosh). Se `soundMidAlign === 'end'` (ex.: SFX Reversed/riser), o
        // FIM do efeito bate no fim do trecho → começa em (end - duração).
        if (list[i].soundMid) {
          try {
            const sp = path.join(workDir, `smid_${i}.mp3`);
            await downloadFile(list[i].soundMid, sp);
            let atSfx = Math.min(at + 0.4, Math.max(at, end - 0.3));
            if (list[i].soundMidAlign === 'end') {
              const durSfx = await new Promise<number>((resolve) => {
                ffmpeg.ffprobe(sp, (err, m) =>
                  resolve(err ? 0 : Number(m?.format?.duration) || 0)
                );
              });
              if (durSfx > 0) atSfx = Math.max(0, end - durSfx);
            }
            sounds.push({ path: sp, at: atSfx });
          } catch {
            /* ignora */
          }
        }
      }

      // Som de ENTRADA dos textos cinéticos (ex.: "Swoosh Fight") — começa no
      // MESMO instante em que o texto aparece (t.atSec).
      const textSfxList: any[] = Array.isArray((req.body || {}).texts) ? (req.body as any).texts : [];
      for (let ti = 0; ti < textSfxList.length; ti++) {
        const t = textSfxList[ti];
        if (t && t.sound) {
          try {
            const sp = path.join(workDir, `txt_${ti}.mp3`);
            await downloadFile(t.sound, sp);
            sounds.push({ path: sp, at: Math.max(0, Number(t.atSec) || 0) });
          } catch {
            /* ignora */
          }
        }
      }

      await new Promise((resolve, reject) => {
        const cmd = ffmpeg();
        // input 0 = base preta (lavfi); 1..N = clipes; N+1 = áudio; depois = sons.
        cmd.input(`color=c=black:s=${W}x${H}:r=30:d=${dur}`).inputOptions(['-f', 'lavfi']);
        clipPaths.forEach((p) => cmd.input(p));
        cmd.input(audioPath);
        // Janela: busca o áudio no offset do grupo (fast seek antes do -i).
        if (audioStartSec > 0) cmd.inputOptions(['-ss', String(audioStartSec)]);
        const audioIdx = clipPaths.length + 1;
        sounds.forEach((s) => cmd.input(s.path));
        const soundStart = clipPaths.length + 2;

        const filters: string[] = [];
        let last = '0:v';
        list.forEach((c: any, i: number) => {
          const at = Math.max(0, Number(c.atSec) || 0);
          const end = Math.max(at + 0.1, Number(c.endSec) || 0);
          const win = end - at;
          const ts = Math.max(0, Number(c.trimStart) || 0);
          const tIn = String(c.transIn || 'none');
          const tOut = String(c.transOut || 'none');
          const dIn = Math.min(Math.max(0.1, Number(c.transInDur) || 0.4), Math.max(0.1, win));
          const dOut = Math.min(Math.max(0.1, Number(c.transOutDur) || 0.4), Math.max(0.1, win));
          const outStart = (end - dOut).toFixed(3);

          // CROSSFADE (dissolve): o clipe COMEÇA a aparecer dIn ANTES do seu
          // atSec, sobreposto ao trecho anterior (que segue por baixo), e faz
          // fade-in por cima dele — dissolve real de um trecho pro outro, sem
          // passar pelo preto. `atV` = início visual antecipado; estende o trim
          // em dIn pra o clipe ainda terminar em `end`.
          // Transições que SOBREPÕEM o clipe anterior (entram por cima dele, sem
          // passar pelo preto) → link smooth: crossfade, slides e whip. O clipe
          // começa dIn ANTES do seu atSec, e a transição de entrada roda em cima
          // do trecho que está saindo.
          const crossIn = ['dissolve', 'slideleft', 'slideright', 'slideup', 'slidedown', 'whip'].includes(
            tIn
          );
          const atV = crossIn ? Math.max(0, at - dIn) : at;
          const trimEnd = crossIn ? ts + win + dIn : ts + win;

          // ZOOM (Ken Burns) no clipe inteiro via zoompan. inc calibrado pra
          // alcançar ~1.18 no fim da janela. Aplicado ANTES do setpts pra não
          // bagunçar o posicionamento no overlay.
          const winZ = crossIn ? win + dIn : win;
          const inc = (0.18 / Math.max(1, winZ * 30)).toFixed(6);
          const zp = `d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=30`;
          let zoomF = '';
          if (tIn === 'zoomin') zoomF = `,zoompan=z='min(zoom+${inc},1.18)':${zp},setsar=1`;
          else if (tIn === 'zoomout')
            zoomF = `,zoompan=z='if(eq(on,0),1.18,max(zoom-${inc},1.0))':${zp},setsar=1`;

          // Ordem: trim → escala → tpad → [zoom] → setpts (posiciona) → [efeitos] → [fade].
          // tpad clona o ÚLTIMO frame se o b-roll for mais CURTO que a janela —
          // sem isso o overlay (eof_action=pass) mostrava a base PRETA no fim do
          // trecho (a "tela preta" de ~0,5s). Preenche a janela toda com segurança.
          let clipF = `[${i + 1}:v]trim=${ts}:${trimEnd},${scaleFit},setsar=1,tpad=stop_mode=clone:stop_duration=${(winZ + 1).toFixed(2)}${zoomF},setpts=PTS-STARTPTS+${atV}/TB`;
          // Efeitos extras (via `enable` de tempo, só na janela da transição):
          // B&W = clipe todo; Whip = blur na entrada (+ slide rápido no overlay);
          // Glitch = RGB-shift + ruído na entrada.
          const effEnd = (atV + dIn).toFixed(3);
          // P&B do clipe inteiro (independente da transição) — usado nos trechos
          // de "antes" / passado (tom "past"). Também aceita tIn === 'bw' (legado).
          if (c.bw || tIn === 'bw') clipF += `,hue=s=0`;
          if (tIn === 'whip')
            clipF += `,gblur=sigma=24:enable='between(t,${atV},${effEnd})'`;
          else if (tIn === 'glitch')
            clipF += `,rgbashift=rh=10:bh=-10:enable='between(t,${atV},${effEnd})',noise=alls=36:allf=t:enable='between(t,${atV},${effEnd})'`;
          // Whip na SAÍDA: blur no fim do trecho (o slide-out é tratado no xOut
          // abaixo). Sem isso, "saída: whip" não fazia nada visível.
          if (tOut === 'whip')
            clipF += `,gblur=sigma=24:enable='between(t,${outStart},${end})'`;
          const fadeIn = tIn === 'fade' || tIn === 'dissolve';
          const whiteIn = tIn === 'whiteflash';
          const fadeOut = tOut === 'fade';
          if (fadeIn || whiteIn || fadeOut) {
            clipF += `,format=yuva420p`;
            if (whiteIn) clipF += `,fade=t=in:st=${atV}:d=${dIn}:color=white`;
            else if (fadeIn) clipF += `,fade=t=in:st=${atV}:d=${dIn}:alpha=1`;
            if (fadeOut) clipF += `,fade=t=out:st=${outStart}:d=${dOut}:alpha=1`;
          }
          filters.push(`${clipF}[c${i}]`);

          const out = `o${i}`;
          // pIn usa atV (início visual, antecipado nos slides/whip) pra o
          // movimento de entrada rodar EM CIMA do clipe anterior.
          const pIn = `(t-${atV})/${dIn}`;
          const pOut = `(t-${outStart})/${dOut}`;
          const xIn = tIn === 'slideleft' || tIn === 'whip' ? `(1-${pIn})*W` : tIn === 'slideright' ? `-(1-${pIn})*W` : null;
          const yIn = tIn === 'slideup' ? `(1-${pIn})*H` : tIn === 'slidedown' ? `-(1-${pIn})*H` : null;
          const xOut = tOut === 'slideleft' || tOut === 'whip' ? `-(${pOut})*W` : tOut === 'slideright' ? `(${pOut})*W` : null;
          const yOut = tOut === 'slideup' ? `-(${pOut})*H` : tOut === 'slidedown' ? `(${pOut})*H` : null;
          const opts: string[] = [];
          if (xIn || xOut)
            opts.push(`x='if(lt(t,${atV}+${dIn}),${xIn || 0},if(gt(t,${outStart}),${xOut || 0},0))'`);
          if (yIn || yOut)
            opts.push(`y='if(lt(t,${atV}+${dIn}),${yIn || 0},if(gt(t,${outStart}),${yOut || 0},0))'`);
          opts.push(`enable='between(t,${atV},${end})'`);
          opts.push('eof_action=pass');
          filters.push(`[${last}][c${i}]overlay=${opts.join(':')}[${out}]`);
          last = out;
        });

        // TEXTO CINÉTICO (opcional): queima os textos grandes animados por cima
        // de tudo, via libass. Cada texto tem seu timing [atSec, endSec].
        const texts: any[] = Array.isArray((req.body || {}).texts) ? (req.body as any).texts : [];
        const validTexts = texts.filter((t) => t && (t.text || '').trim());
        if (validTexts.length > 0) {
          const assPath = writeKineticTextAss(workDir, validTexts, W, H);
          filters.push(
            `[${last}]subtitles='${escapeFilterPath(assPath)}':fontsdir='${escapeFilterPath(FONTS_DIR)}'[vtxt]`
          );
          last = 'vtxt';
        }

        // Áudio: base (VOZ) + sons. Com `normalize=1` (padrão) o amix divide o
        // volume pelo nº de entradas → a voz fica baixíssima com muitos SFX. Por
        // isso: `normalize=0` (soma sem escalar, voz fica CHEIA) e cada SFX entra
        // a ~55% pra não estourar nem cobrir a narração.
        let audioMap = `${audioIdx}:a?`;
        if (sounds.length > 0) {
          sounds.forEach((s, k) => {
            const ms = Math.round(s.at * 1000);
            filters.push(
              `[${soundStart + k}:a]adelay=${ms}|${ms},volume=0.55,aformat=sample_rates=44100:channel_layouts=stereo[snd${k}]`
            );
          });
          const ins = [`[${audioIdx}:a]`, ...sounds.map((_, k) => `[snd${k}]`)].join('');
          filters.push(
            `${ins}amix=inputs=${sounds.length + 1}:normalize=0:duration=first:dropout_transition=0[aout]`
          );
          audioMap = '[aout]';
        }

        cmd
          .complexFilter(filters)
          // Montagem = usuário esperando na UI → preset superfast (ENCODE_FAST)
          // + áudio aac. Corta MUITO o tempo vs. o preset 'fast' do BALANCED.
          .outputOptions([
            '-map',
            `[${last}]`,
            '-map',
            audioMap,
            '-shortest',
            ...ENCODE_FAST,
            '-c:a aac',
            '-b:a 128k',
          ])
          .save(outPath)
          .on('end', () => resolve(null))
          .on('error', reject);
      });

      const buffer = fs.readFileSync(outPath);
      const { url } = await persistVideo({
        buffer,
        filename: `timeline_${stamp}.mp4`,
        storageFolder: 'timeline',
        userId,
      });
      res.json({ url });
    } catch (err: any) {
      log.error('[Video Timeline] Erro:', err.message);
      res.status(500).json({ error: processDataError(err) });
    } finally {
      try {
        if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  })
);

// POST /api/video/join-audio
// Extrai o ÁUDIO de vídeos num único mp3 (concatena se forem vários). Com 1
// vídeo, só extrai o áudio dele. Muito mais rápido que juntar o vídeo inteiro
// (não re-encoda imagem) — ideal pra somar gravações / gerar áudio pro clone.
// Body: { videos: string[], userId } → { url }
videoRouter.post(
  '/join-audio',
  withFfmpegQueue(async (req, res) => {
    const { videos, userId } = req.body || {};
    if (!Array.isArray(videos) || videos.length < 1 || !userId) {
      return res.status(400).json({ error: 'pelo menos 1 vídeo e userId são obrigatórios.' });
    }
    const stamp = Date.now();
    const workDir = path.join(GENERATED_DIR, `joinaudio_${stamp}`);
    fs.mkdirSync(workDir, { recursive: true });
    const outName = `audio_juntado_${stamp}.mp3`;
    const outPath = path.join(GENERATED_DIR, outName);
    const inputs: string[] = [];
    try {
      for (let i = 0; i < videos.slice(0, 20).length; i++) {
        const p = path.join(workDir, `in_${i}.mp4`);
        const src = String(videos[i]);
        if (src.startsWith('/generated/')) {
          fs.copyFileSync(path.join(GENERATED_DIR, src.replace('/generated/', '')), p);
        } else {
          await downloadFile(src, p);
        }
        inputs.push(p);
      }
      await new Promise((resolve, reject) => {
        const cmd = ffmpeg();
        inputs.forEach((p) => cmd.input(p));
        cmd
          .complexFilter([
            ...inputs.map(
              (_, i) => `[${i}:a]aresample=44100,aformat=channel_layouts=stereo[a${i}]`
            ),
            `${inputs.map((_, i) => `[a${i}]`).join('')}concat=n=${inputs.length}:v=0:a=1[out]`,
          ])
          .outputOptions(['-map', '[out]'])
          .audioCodec('libmp3lame')
          .on('end', () => resolve(null))
          .on('error', reject)
          .save(outPath);
      });

      const forwardedHost = req.headers['x-forwarded-host'];
      const host =
        (typeof forwardedHost === 'string' ? forwardedHost.split(',')[0]?.trim() : null) ||
        req.get('host') ||
        '';
      const protocol =
        req.headers['x-forwarded-proto'] || (host.includes('localhost') ? 'http' : 'https');
      res.json({ url: `${protocol}://${host}/generated/${outName}` });
    } catch (err: any) {
      log.error('[Video join-audio]', err.message);
      res.status(500).json({ error: processDataError(err) });
    } finally {
      try {
        if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  })
);

// POST /api/video/silences
// Detecta os SILÊNCIOS (pausas) de um áudio via ffmpeg silencedetect — rápido,
// sem transcrever. Usado pra fatiar a VSL em BLOCOS de ~2 min cujos cortes caem
// em respiros entre frases (não no meio de palavra / de b-roll).
// Body: { audioUrl, noiseDb?, minSilenceSec? } → { silences:[{start,end}], duration }
videoRouter.post('/silences', async (req, res) => {
  const audioUrl = String((req.body || {}).audioUrl || '');
  const noiseDb = Number((req.body || {}).noiseDb) || -30;
  const minSil = Math.max(0.15, Number((req.body || {}).minSilenceSec) || 0.35);
  if (!audioUrl) return res.status(400).json({ error: 'audioUrl obrigatório.' });
  const stamp = Date.now();
  const inPath = path.join(GENERATED_DIR, `sil_${stamp}.mp3`);
  try {
    await downloadFile(audioUrl, inPath);
    const lines: string[] = [];
    await new Promise((resolve, reject) => {
      ffmpeg(inPath)
        .audioFilters(`silencedetect=noise=${noiseDb}dB:d=${minSil}`)
        .outputOptions(['-f', 'null'])
        .output(process.platform === 'win32' ? 'NUL' : '/dev/null')
        .on('stderr', (l: string) => lines.push(l))
        .on('end', () => resolve(null))
        .on('error', (e: any) => reject(e))
        .run();
    });
    const silences: { start: number; end: number }[] = [];
    let curStart: number | null = null;
    for (const l of lines) {
      const ms = l.match(/silence_start:\s*(-?[0-9.]+)/);
      const me = l.match(/silence_end:\s*(-?[0-9.]+)/);
      if (ms) curStart = Math.max(0, parseFloat(ms[1]!));
      if (me && curStart != null) {
        silences.push({ start: curStart, end: parseFloat(me[1]!) });
        curStart = null;
      }
    }
    const duration = await new Promise<number>((resolve) => {
      ffmpeg.ffprobe(inPath, (err, m) => resolve(err ? 0 : Number(m?.format?.duration) || 0));
    });
    res.json({ silences, duration });
  } catch (err: any) {
    log.error('[Video silences]', err?.message || err);
    res.status(500).json({ error: err?.message || 'Falha ao detectar silêncios.' });
  } finally {
    try {
      if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
    } catch {
      /* ignora */
    }
  }
});

// POST /api/video/transcribe
// Transcreve um áudio (URL pública) via AssemblyAI e devolve as PALAVRAS com
// tempo (ms). É o que o Auto-editar usa pra saber onde cortar / quais palavras
// viram texto / o que buscar no Pexels. Body: { audioUrl, language? } →
// { text, durationMs, words: [{text, start, end}] }
videoRouter.post('/transcribe', async (req, res) => {
  const apiKey = getAssemblyAIKey();
  if (!apiKey) return res.status(500).json({ error: 'AssemblyAI não configurada.' });
  const audioUrl = String((req.body || {}).audioUrl || '');
  if (!audioUrl) return res.status(400).json({ error: 'audioUrl é obrigatório.' });
  const lang = String((req.body || {}).language || '').trim();
  try {
    const submit = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: { authorization: apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        audio_url: audioUrl,
        ...(lang ? { language_code: lang } : { language_detection: true }),
      }),
    });
    const sub: any = await submit.json();
    if (!submit.ok || !sub.id) throw new Error(sub.error || `submit falhou (${submit.status})`);

    // Poll até completar (VSL longa pode levar minutos).
    let tr: any = null;
    for (let i = 0; i < 180; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const pr = await fetch(`https://api.assemblyai.com/v2/transcript/${sub.id}`, {
        headers: { authorization: apiKey },
      });
      tr = await pr.json();
      if (tr.status === 'completed') break;
      if (tr.status === 'error') throw new Error(tr.error || 'transcrição falhou');
    }
    if (!tr || tr.status !== 'completed') throw new Error('Timeout na transcrição.');

    const words = Array.isArray(tr.words)
      ? tr.words.map((w: any) => ({ text: w.text, start: w.start, end: w.end }))
      : [];
    res.json({
      text: tr.text || '',
      durationMs: tr.audio_duration ? tr.audio_duration * 1000 : undefined,
      words,
    });
  } catch (err: any) {
    log.error('[transcribe]', err.message);
    res.status(500).json({ error: processDataError(err) });
  }
});

// POST /api/video/analyze-style
// Analisa o ESTILO de edição de uma VSL de referência: detecta os cortes de
// cena (scene detection) numa amostra e devolve o RITMO (segundos por corte,
// cortes por minuto). Serve pra o Auto-editar imitar a cadência da referência.
// Body: { videoUrl, sampleSec? } → { sampleSec, cuts, avgCutSec, cutsPerMin, durationSec }
videoRouter.post(
  '/analyze-style',
  withFfmpegQueue(async (req, res) => {
    const url = String((req.body || {}).videoUrl || '');
    if (!url) return res.status(400).json({ error: 'videoUrl é obrigatório.' });
    // Amostra os primeiros N segundos (o hook/início costuma ter o ritmo mais
    // agressivo). Default 300s (5 min) — suficiente e rápido.
    const sampleSec = Math.max(30, Math.min(Number((req.body || {}).sampleSec) || 300, 600));
    const bin = ffmpegStatic as unknown as string;
    try {
      const { cuts, durationSec } = await new Promise<{ cuts: number; durationSec: number }>(
        (resolve, reject) => {
          const args = [
            '-ss',
            '0',
            '-t',
            String(sampleSec),
            '-i',
            url,
            '-filter:v',
            "select='gt(scene,0.3)',showinfo",
            '-an',
            '-f',
            'null',
            '-',
          ];
          const proc = spawn(bin, args);
          let stderr = '';
          proc.stderr.on('data', (d) => {
            stderr += d.toString();
          });
          proc.on('error', reject);
          proc.on('close', () => {
            const c = (stderr.match(/pts_time:/g) || []).length;
            const durM = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(stderr);
            const dur = durM
              ? Number(durM[1]) * 3600 + Number(durM[2]) * 60 + Number(durM[3])
              : 0;
            resolve({ cuts: c, durationSec: dur });
          });
        }
      );
      const analyzed = Math.min(sampleSec, durationSec || sampleSec);
      const avgCutSec = cuts > 0 ? Number((analyzed / cuts).toFixed(2)) : 0;
      const cutsPerMin = analyzed > 0 ? Number((cuts / (analyzed / 60)).toFixed(1) as any) : 0;
      res.json({ sampleSec: analyzed, cuts, avgCutSec, cutsPerMin, durationSec });
    } catch (err: any) {
      log.error('[analyze-style]', err.message);
      res.status(500).json({ error: processDataError(err) });
    }
  })
);

// POST /api/video/speed
// Re-renderiza o vídeo numa velocidade diferente (salva de verdade, não é só
// preview). Vídeo via setpts; áudio via atempo (encadeado quando sai de 0.5–2.0).
// Body: { videoUrl, userId, speed }  → { url }
videoRouter.post(
  '/speed',
  withFfmpegQueue(async (req, res) => {
    const { videoUrl, userId } = req.body || {};
    let speed = Number((req.body || {}).speed) || 1;
    if (!videoUrl || !userId) {
      return res.status(400).json({ error: 'videoUrl e userId são obrigatórios.' });
    }
    speed = Math.max(0.25, Math.min(speed, 4));
    if (Math.abs(speed - 1) < 0.001) return res.json({ url: videoUrl }); // 1x = nada a fazer

    const stamp = Date.now();
    const workDir = path.join(GENERATED_DIR, `speed_${stamp}`);
    fs.mkdirSync(workDir, { recursive: true });
    const srcPath = path.join(workDir, 'src.mp4');
    const outPath = path.join(workDir, 'out.mp4');

    try {
      await downloadFile(videoUrl, srcPath);

      // atempo só aceita 0.5–2.0 por filtro; encadeia pra cobrir fora disso.
      const factors: number[] = [];
      let s = speed;
      while (s > 2.0) {
        factors.push(2.0);
        s /= 2.0;
      }
      while (s < 0.5) {
        factors.push(0.5);
        s /= 0.5;
      }
      factors.push(Number(s.toFixed(6)));
      const atempo = factors.map((f) => `atempo=${f}`).join(',');
      const filter = `[0:v]setpts=PTS/${speed}[v];[0:a]${atempo}[a]`;

      await new Promise((resolve, reject) => {
        ffmpeg(srcPath)
          .complexFilter(filter)
          .outputOptions(['-map', '[v]', '-map', '[a]', ...ENCODE_BALANCED])
          .save(outPath)
          .on('end', () => resolve(null))
          .on('error', reject);
      });

      const buffer = fs.readFileSync(outPath);
      const { url } = await persistVideo({
        buffer,
        filename: `speed_${stamp}.mp4`,
        storageFolder: 'speed',
        userId,
      });
      res.json({ url });
    } catch (err: any) {
      log.error('[Video Speed] Erro:', err.message);
      res.status(500).json({ error: processDataError(err) });
    } finally {
      try {
        if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  })
);
