import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { TransitionSeries, linearTiming, type TransitionPresentation } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';

export type TransitionKind = 'slide' | 'fade' | 'wipe';

// ───────────────────────────────────────────────────────────────────────────
//  TEMPLATES do Braço 2. Cada template é UMA "roupa" que veste as 3 fases
//  (hook → corpo → cta) com seu visual próprio. Todos recebem o MESMO
//  CreativeInput (marca + conteúdo das 3 fases) e são props-driven.
// ───────────────────────────────────────────────────────────────────────────

export interface CreativeInput {
  // marca
  companyName: string;
  accentColor: string;
  bgColor: string;
  logoUrl?: string;
  // hook
  hookText: string;
  // corpo
  bodyText: string;
  bodyMediaUrl?: string;
  bodyMediaType?: 'video' | 'image' | '';
  // cta
  ctaText: string;
  // ajustes (manoplas)
  transition?: TransitionKind;
  musicUrl?: string;
}

export const DEFAULT_CREATIVE: CreativeInput = {
  companyName: 'VisualSpeak',
  accentColor: '#22c55e',
  bgColor: '#0f172a',
  logoUrl: '',
  hookText: "Você fala 'determine' errado?",
  bodyText: 'Veja sua pronúncia virar verde em segundos.',
  bodyMediaUrl: '',
  bodyMediaType: '',
  ctaText: 'Baixe grátis →',
  transition: 'slide',
  musicUrl: '',
};

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
const HOOK = 75;
const BODY = 285;
const CTA = 90;
const TRANS = 15;
export const DURATION = HOOK + BODY + CTA - 2 * TRANS; // 420 frames (~14s)

const FONT = "'Inter', system-ui, -apple-system, sans-serif";
const TEXT_ON_ACCENT = '#0b1220';

// ── Peças compartilhadas ────────────────────────────────────────────────────
const Logo: React.FC<{ logoUrl?: string; companyName: string; accentColor: string; size: number }> = ({
  logoUrl,
  companyName,
  accentColor,
  size,
}) => {
  if (logoUrl) {
    return <Img src={logoUrl} style={{ width: size, height: size, borderRadius: size * 0.25, objectFit: 'cover' }} />;
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.25,
        background: accentColor,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: TEXT_ON_ACCENT,
        fontWeight: 800,
        fontSize: size * 0.5,
      }}
    >
      {(companyName || '?').slice(0, 1).toUpperCase()}
    </div>
  );
};

const ScorePlaceholder: React.FC<{ accentColor: string }> = ({ accentColor }) => {
  const frame = useCurrentFrame();
  const score = Math.round(interpolate(frame, [10, 160], [12, 98], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  return (
    <AbsoluteFill
      style={{ background: 'linear-gradient(160deg,#1e293b,#0b1220)', justifyContent: 'center', alignItems: 'center', gap: 48, padding: 40 }}
    >
      <span style={{ fontSize: 28, color: '#64748b', textAlign: 'center', whiteSpace: 'pre-line', fontFamily: FONT }}>
        {'📱 sua gravação\nou foto entra aqui'}
      </span>
      <div style={{ width: 360, textAlign: 'center', fontFamily: FONT }}>
        <div style={{ color: 'white', fontSize: 130, fontWeight: 800, lineHeight: 1 }}>{score}</div>
        <div style={{ height: 22, background: 'rgba(255,255,255,0.1)', borderRadius: 99, marginTop: 20, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${score}%`, background: accentColor, borderRadius: 99 }} />
        </div>
      </div>
    </AbsoluteFill>
  );
};

const BodyMedia: React.FC<{ url?: string; type?: string; accentColor: string }> = ({ url, type, accentColor }) => {
  if (url && type === 'video') {
    return <OffthreadVideo src={url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
  }
  if (url && type === 'image') {
    return <Img src={url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
  }
  return <ScorePlaceholder accentColor={accentColor} />;
};

const useEnter = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame, fps, config: { damping: 200 } });
};

const Shell: React.FC<{ bg: string; music?: string; children: React.ReactNode }> = ({ bg, music, children }) => (
  <AbsoluteFill style={{ backgroundColor: bg, fontFamily: FONT }}>
    {music ? <Audio src={music} volume={0.55} /> : null}
    {children}
  </AbsoluteFill>
);

const presentationFor = (t: TransitionKind): TransitionPresentation<Record<string, unknown>> =>
  (t === 'fade' ? fade() : t === 'wipe' ? wipe() : slide({ direction: 'from-right' })) as TransitionPresentation<
    Record<string, unknown>
  >;

const Trio: React.FC<{ hook: React.ReactNode; body: React.ReactNode; cta: React.ReactNode; transition?: TransitionKind }> = ({
  hook,
  body,
  cta,
  transition = 'slide',
}) => (
  <TransitionSeries>
    <TransitionSeries.Sequence durationInFrames={HOOK}>{hook}</TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={presentationFor(transition)} timing={linearTiming({ durationInFrames: TRANS })} />
    <TransitionSeries.Sequence durationInFrames={BODY}>{body}</TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={presentationFor(transition)} timing={linearTiming({ durationInFrames: TRANS })} />
    <TransitionSeries.Sequence durationInFrames={CTA}>{cta}</TransitionSeries.Sequence>
  </TransitionSeries>
);

const CtaScene: React.FC<CreativeInput> = ({ companyName, ctaText, accentColor, logoUrl }) => {
  const enter = useEnter();
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ transform: `translateY(${interpolate(enter, [0, 1], [40, 0])}px)`, opacity: enter, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 40 }}>
        <Logo logoUrl={logoUrl} companyName={companyName} accentColor={accentColor} size={150} />
        <span style={{ color: 'white', fontSize: 64, fontWeight: 800 }}>{companyName}</span>
        <div style={{ background: accentColor, color: TEXT_ON_ACCENT, fontSize: 48, fontWeight: 800, padding: '28px 64px', borderRadius: 99 }}>{ctaText}</div>
      </div>
    </AbsoluteFill>
  );
};

// ── Template 1: Demo de tela ─────────────────────────────────────────────────
const ScreenDemo: React.FC<CreativeInput> = (p) => (
  <Shell bg={p.bgColor} music={p.musicUrl}>
    <Trio
      transition={p.transition}
      hook={<HookCentered {...p} />}
      body={
        <AbsoluteFill style={{ alignItems: 'center', paddingTop: 110 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <Logo logoUrl={p.logoUrl} companyName={p.companyName} accentColor={p.accentColor} size={60} />
            <span style={{ color: 'white', fontSize: 40, fontWeight: 700 }}>{p.companyName}</span>
          </div>
          <PhoneFrame>
            <BodyMedia url={p.bodyMediaUrl} type={p.bodyMediaType} accentColor={p.accentColor} />
          </PhoneFrame>
          {p.bodyText ? (
            <div style={{ position: 'absolute', bottom: 90, left: 70, right: 70, textAlign: 'center' }}>
              <span style={{ display: 'inline-block', background: p.accentColor, color: TEXT_ON_ACCENT, fontSize: 38, fontWeight: 700, padding: '18px 32px', borderRadius: 22 }}>{p.bodyText}</span>
            </div>
          ) : null}
        </AbsoluteFill>
      }
      cta={<CtaScene {...p} />}
    />
  </Shell>
);

const PhoneFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const enter = useEnter();
  const frame = useCurrentFrame();
  const zoom = interpolate(frame, [0, 285], [1.0, 1.08]);
  return (
    <div
      style={{
        marginTop: 56,
        transform: `translateY(${interpolate(enter, [0, 1], [60, 0])}px) scale(${zoom})`,
        width: 600,
        height: 1040,
        borderRadius: 56,
        overflow: 'hidden',
        border: '8px solid rgba(255,255,255,0.12)',
        boxShadow: '0 40px 120px rgba(0,0,0,0.5)',
        background: '#000',
      }}
    >
      {children}
    </div>
  );
};

const HookCentered: React.FC<CreativeInput> = ({ hookText, accentColor }) => {
  const enter = useEnter();
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: 90 }}>
      <div style={{ transform: `scale(${interpolate(enter, [0, 1], [0.8, 1])})`, textAlign: 'center' }}>
        <div style={{ width: 90, height: 10, background: accentColor, borderRadius: 99, margin: '0 auto 44px' }} />
        <h1 style={{ color: 'white', fontSize: 100, fontWeight: 800, lineHeight: 1.05, margin: 0 }}>{hookText}</h1>
      </div>
    </AbsoluteFill>
  );
};

// ── Template 2: Texto em destaque (kinetic) ──────────────────────────────────
const BoldText: React.FC<CreativeInput> = (p) => (
  <Shell bg={p.bgColor} music={p.musicUrl}>
    <Trio
      transition={p.transition}
      hook={<HookCentered {...p} />}
      body={
        <AbsoluteFill>
          {p.bodyMediaUrl ? (
            <AbsoluteFill style={{ opacity: 0.25 }}>
              <BodyMedia url={p.bodyMediaUrl} type={p.bodyMediaType} accentColor={p.accentColor} />
            </AbsoluteFill>
          ) : null}
          <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: 90 }}>
            <h2 style={{ color: 'white', fontSize: 84, fontWeight: 800, textAlign: 'center', lineHeight: 1.15, margin: 0, textShadow: '0 4px 24px rgba(0,0,0,0.6)' }}>
              {p.bodyText || p.hookText}
            </h2>
            <div style={{ width: 120, height: 12, background: p.accentColor, borderRadius: 99, marginTop: 50 }} />
          </AbsoluteFill>
        </AbsoluteFill>
      }
      cta={<CtaScene {...p} />}
    />
  </Shell>
);

// ── Template 3: Lista / Curiosidade ──────────────────────────────────────────
const Listicle: React.FC<CreativeInput> = (p) => {
  const items = (p.bodyText || '')
    .split(/\n|\. /)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 5);
  return (
    <Shell bg={p.bgColor} music={p.musicUrl}>
      <Trio
        transition={p.transition}
        hook={
          <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: 80 }}>
            <ListHook hookText={p.hookText} accentColor={p.accentColor} />
          </AbsoluteFill>
        }
        body={
          <AbsoluteFill style={{ justifyContent: 'center', padding: 90, gap: 36 }}>
            {(items.length ? items : ['Item 1', 'Item 2', 'Item 3']).map((it, i) => (
              <ListRow key={i} index={i} text={it} accentColor={p.accentColor} />
            ))}
          </AbsoluteFill>
        }
        cta={<CtaScene {...p} />}
      />
    </Shell>
  );
};

const ListHook: React.FC<{ hookText: string; accentColor: string }> = ({ hookText, accentColor }) => {
  const enter = useEnter();
  return (
    <div style={{ textAlign: 'center', transform: `scale(${interpolate(enter, [0, 1], [0.85, 1])})` }}>
      <div style={{ color: accentColor, fontSize: 120, fontWeight: 900, lineHeight: 1 }}>TOP</div>
      <h1 style={{ color: 'white', fontSize: 72, fontWeight: 800, margin: '20px 0 0' }}>{hookText}</h1>
    </div>
  );
};

const ListRow: React.FC<{ index: number; text: string; accentColor: string }> = ({ index, text, accentColor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const appear = spring({ frame: frame - index * 12, fps, config: { damping: 200 } });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 26, opacity: appear, transform: `translateX(${interpolate(appear, [0, 1], [-40, 0])}px)` }}>
      <div style={{ width: 70, height: 70, borderRadius: 18, background: accentColor, color: TEXT_ON_ACCENT, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, fontWeight: 800, flexShrink: 0 }}>
        {index + 1}
      </div>
      <span style={{ color: 'white', fontSize: 46, fontWeight: 600 }}>{text}</span>
    </div>
  );
};

// ── Template 4: Problema → Solução ──────────────────────────────────────────
const SolutionReveal: React.FC<{ accentColor: string }> = ({ accentColor }) => {
  const enter = useEnter();
  return (
    <div style={{ background: accentColor, color: TEXT_ON_ACCENT, fontSize: 44, fontWeight: 800, padding: '18px 40px', borderRadius: 99, transform: `scale(${interpolate(enter, [0, 1], [0.7, 1])})` }}>
      ✅ A solução
    </div>
  );
};

const ProblemSolution: React.FC<CreativeInput> = (p) => (
  <Shell bg={p.bgColor} music={p.musicUrl}>
    <Trio
      transition={p.transition}
      hook={<HookCentered {...p} />}
      body={
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: 80, gap: 40 }}>
          <SolutionReveal accentColor={p.accentColor} />
          {p.bodyMediaUrl ? (
            <div style={{ width: 520, height: 760, borderRadius: 40, overflow: 'hidden', border: `6px solid ${p.accentColor}` }}>
              <BodyMedia url={p.bodyMediaUrl} type={p.bodyMediaType} accentColor={p.accentColor} />
            </div>
          ) : (
            <h2 style={{ color: 'white', fontSize: 72, fontWeight: 800, textAlign: 'center', margin: 0 }}>{p.bodyText}</h2>
          )}
        </AbsoluteFill>
      }
      cta={<CtaScene {...p} />}
    />
  </Shell>
);

// ── Template 5: Antes / Depois ──────────────────────────────────────────────
const Tag: React.FC<{ text: string; color: string }> = ({ text, color }) => (
  <div style={{ position: 'absolute', top: 30, left: 30, background: color, color: TEXT_ON_ACCENT, fontWeight: 800, fontSize: 32, padding: '10px 24px', borderRadius: 14 }}>{text}</div>
);

const BeforeAfter: React.FC<CreativeInput> = (p) => (
  <Shell bg={p.bgColor} music={p.musicUrl}>
    <Trio
      transition={p.transition}
      hook={<HookCentered {...p} />}
      body={
        <AbsoluteFill style={{ flexDirection: 'column' }}>
          <div style={{ flex: 1, position: 'relative', filter: 'grayscale(1) brightness(0.6)' }}>
            <BodyMedia url={p.bodyMediaUrl} type={p.bodyMediaType} accentColor={p.accentColor} />
            <Tag text="ANTES" color="#94a3b8" />
          </div>
          <div style={{ flex: 1, position: 'relative', borderTop: `8px solid ${p.accentColor}` }}>
            <BodyMedia url={p.bodyMediaUrl} type={p.bodyMediaType} accentColor={p.accentColor} />
            <Tag text="DEPOIS" color={p.accentColor} />
          </div>
        </AbsoluteFill>
      }
      cta={<CtaScene {...p} />}
    />
  </Shell>
);

// ── Template 6: Depoimento ──────────────────────────────────────────────────
const Quote: React.FC<CreativeInput> = (p) => (
  <Shell bg={p.bgColor} music={p.musicUrl}>
    <Trio
      transition={p.transition}
      hook={<HookCentered {...p} />}
      body={
        <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: 90, gap: 40 }}>
          <div style={{ color: p.accentColor, fontSize: 60 }}>★★★★★</div>
          <h2 style={{ color: 'white', fontSize: 70, fontWeight: 700, textAlign: 'center', fontStyle: 'italic', margin: 0, lineHeight: 1.2 }}>
            “{p.bodyText}”
          </h2>
          <span style={{ color: '#94a3b8', fontSize: 36, fontWeight: 600 }}>— usuário do {p.companyName}</span>
        </AbsoluteFill>
      }
      cta={<CtaScene {...p} />}
    />
  </Shell>
);

// ── Template 7: Número / Estatística ────────────────────────────────────────
const BigNumber: React.FC<{ stat: string; accentColor: string }> = ({ stat, accentColor }) => {
  const enter = useEnter();
  return <div style={{ color: accentColor, fontSize: 240, fontWeight: 900, lineHeight: 1, transform: `scale(${interpolate(enter, [0, 1], [0.6, 1])})` }}>{stat}</div>;
};

const BigStat: React.FC<CreativeInput> = (p) => {
  const match = (p.bodyText || '').match(/\d[\d.,]*\s?%?|\d+x/i);
  const stat = match ? match[0] : '98%';
  return (
    <Shell bg={p.bgColor} music={p.musicUrl}>
      <Trio
        transition={p.transition}
        hook={<HookCentered {...p} />}
        body={
          <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: 80, gap: 30 }}>
            <BigNumber stat={stat} accentColor={p.accentColor} />
            <span style={{ color: 'white', fontSize: 56, fontWeight: 700, textAlign: 'center' }}>{p.bodyText}</span>
          </AbsoluteFill>
        }
        cta={<CtaScene {...p} />}
      />
    </Shell>
  );
};

// ── Template 8: Notificação ─────────────────────────────────────────────────
const NotifCard: React.FC<CreativeInput> = ({ companyName, bodyText, accentColor, logoUrl }) => {
  const enter = useEnter();
  return (
    <div style={{ width: 880, background: 'rgba(255,255,255,0.96)', borderRadius: 36, padding: 40, display: 'flex', gap: 28, alignItems: 'flex-start', transform: `translateY(${interpolate(enter, [0, 1], [-60, 0])}px)`, opacity: enter, boxShadow: '0 30px 80px rgba(0,0,0,0.4)' }}>
      <Logo logoUrl={logoUrl} companyName={companyName} accentColor={accentColor} size={90} />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 800, fontSize: 38, color: '#0b1220' }}>{companyName}</div>
        <div style={{ fontSize: 38, color: '#334155', marginTop: 8 }}>{bodyText}</div>
      </div>
      <div style={{ color: '#94a3b8', fontSize: 30 }}>agora</div>
    </div>
  );
};

const NotificationTpl: React.FC<CreativeInput> = (p) => (
  <Shell bg={p.bgColor} music={p.musicUrl}>
    <Trio
      transition={p.transition}
      hook={<HookCentered {...p} />}
      body={
        <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: 70 }}>
          <NotifCard {...p} />
        </AbsoluteFill>
      }
      cta={<CtaScene {...p} />}
    />
  </Shell>
);

// ── Template 9: Comparação (eles vs nós) ────────────────────────────────────
const Col: React.FC<{ title: string; accent: string; items: string[]; symbol: string }> = ({ title, accent, items, symbol }) => {
  const enter = useEnter();
  return (
    <div style={{ flex: 1, background: 'rgba(255,255,255,0.05)', borderRadius: 28, padding: 36, opacity: enter, border: `3px solid ${accent}` }}>
      <div style={{ color: accent, fontSize: 40, fontWeight: 800, marginBottom: 24 }}>{title}</div>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 18, color: 'white', fontSize: 32 }}>
          <span style={{ color: accent, fontWeight: 800 }}>{symbol}</span>
          {it}
        </div>
      ))}
    </div>
  );
};

const Comparison: React.FC<CreativeInput> = (p) => {
  const wins = (p.bodyText || '').split(/\n|\. /).map((s) => s.trim()).filter(Boolean).slice(0, 3);
  return (
    <Shell bg={p.bgColor} music={p.musicUrl}>
      <Trio
        transition={p.transition}
        hook={<HookCentered {...p} />}
        body={
          <AbsoluteFill style={{ flexDirection: 'row', padding: 60, gap: 28, alignItems: 'center' }}>
            <Col title="Outros" accent="#64748b" items={['Caro', 'Complicado', 'Lento']} symbol="✕" />
            <Col title={p.companyName} accent={p.accentColor} items={wins.length ? wins : ['Simples', 'Rápido', 'Barato']} symbol="✓" />
          </AbsoluteFill>
        }
        cta={<CtaScene {...p} />}
      />
    </Shell>
  );
};

// ── Template 10: Conversa (chat) ─────────────────────────────────────────────
const Bubble: React.FC<{ text: string; i: number; accent: string }> = ({ text, i, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = spring({ frame: frame - i * 16, fps, config: { damping: 200 } });
  const left = i % 2 === 0;
  return (
    <div style={{ alignSelf: left ? 'flex-start' : 'flex-end', maxWidth: '75%', background: left ? '#e2e8f0' : accent, color: left ? '#0b1220' : TEXT_ON_ACCENT, fontSize: 40, fontWeight: 600, padding: '24px 32px', borderRadius: 32, opacity: a, transform: `translateY(${interpolate(a, [0, 1], [30, 0])}px)` }}>
      {text}
    </div>
  );
};

const Chat: React.FC<CreativeInput> = (p) => {
  const msgs = (p.bodyText || '').split(/\n|\. /).map((s) => s.trim()).filter(Boolean).slice(0, 4);
  return (
    <Shell bg={p.bgColor} music={p.musicUrl}>
      <Trio
        transition={p.transition}
        hook={<HookCentered {...p} />}
        body={
          <AbsoluteFill style={{ justifyContent: 'center', padding: 70, gap: 24 }}>
            {(msgs.length ? msgs : ['Oi! Já testou?', 'Ainda não 🤔', 'Cara, muda tudo!']).map((m, i) => (
              <Bubble key={i} text={m} i={i} accent={p.accentColor} />
            ))}
          </AbsoluteFill>
        }
        cta={<CtaScene {...p} />}
      />
    </Shell>
  );
};

// ── Template 11: Pergunta → Resposta ─────────────────────────────────────────
const RevealBody: React.FC<{ text: string }> = ({ text }) => {
  const enter = useEnter();
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: 90 }}>
      <div style={{ transform: `scale(${interpolate(enter, [0, 1], [0.8, 1])})`, opacity: enter, textAlign: 'center' }}>
        <div style={{ fontSize: 80 }}>💡</div>
        <h2 style={{ color: 'white', fontSize: 72, fontWeight: 800, margin: '20px 0 0' }}>{text}</h2>
      </div>
    </AbsoluteFill>
  );
};

const QuestionReveal: React.FC<CreativeInput> = (p) => (
  <Shell bg={p.bgColor} music={p.musicUrl}>
    <Trio
      transition={p.transition}
      hook={
        <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: 90 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: p.accentColor, fontSize: 50, fontWeight: 800, marginBottom: 20 }}>Você sabia?</div>
            <h1 style={{ color: 'white', fontSize: 88, fontWeight: 800, margin: 0, lineHeight: 1.1 }}>{p.hookText}</h1>
          </div>
        </AbsoluteFill>
      }
      body={<RevealBody text={p.bodyText} />}
      cta={<CtaScene {...p} />}
    />
  </Shell>
);

// ── Template 12: POV ─────────────────────────────────────────────────────────
const PovText: React.FC<{ hookText: string; accent: string }> = ({ hookText, accent }) => {
  const enter = useEnter();
  return (
    <div style={{ opacity: enter }}>
      <span style={{ background: accent, color: TEXT_ON_ACCENT, fontSize: 44, fontWeight: 800, padding: '12px 24px', borderRadius: 12 }}>POV:</span>
      <h1 style={{ color: 'white', fontSize: 80, fontWeight: 800, marginTop: 24, lineHeight: 1.1, textShadow: '0 4px 16px rgba(0,0,0,0.6)' }}>{hookText}</h1>
    </div>
  );
};

const Pov: React.FC<CreativeInput> = (p) => (
  <Shell bg={p.bgColor} music={p.musicUrl}>
    <Trio
      transition={p.transition}
      hook={
        <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'flex-start', padding: 80, paddingTop: 160 }}>
          <PovText hookText={p.hookText} accent={p.accentColor} />
        </AbsoluteFill>
      }
      body={
        <AbsoluteFill>
          <BodyMedia url={p.bodyMediaUrl} type={p.bodyMediaType} accentColor={p.accentColor} />
          {p.bodyText ? (
            <div style={{ position: 'absolute', bottom: 120, left: 60, right: 60, textAlign: 'center' }}>
              <span style={{ background: 'rgba(0,0,0,0.6)', color: 'white', fontSize: 44, fontWeight: 700, padding: '18px 30px', borderRadius: 18 }}>{p.bodyText}</span>
            </div>
          ) : null}
        </AbsoluteFill>
      }
      cta={<CtaScene {...p} />}
    />
  </Shell>
);

// ── Template 13: Checklist de benefícios ─────────────────────────────────────
const CheckRow: React.FC<{ i: number; text: string; accent: string }> = ({ i, text, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = spring({ frame: frame - i * 12, fps, config: { damping: 200 } });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 24, opacity: a, transform: `translateX(${interpolate(a, [0, 1], [-30, 0])}px)` }}>
      <div style={{ width: 64, height: 64, borderRadius: '50%', background: accent, color: TEXT_ON_ACCENT, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 38, fontWeight: 800, flexShrink: 0 }}>✓</div>
      <span style={{ color: 'white', fontSize: 46, fontWeight: 600 }}>{text}</span>
    </div>
  );
};

const Checklist: React.FC<CreativeInput> = (p) => {
  const items = (p.bodyText || '').split(/\n|\. /).map((s) => s.trim()).filter(Boolean).slice(0, 5);
  return (
    <Shell bg={p.bgColor} music={p.musicUrl}>
      <Trio
        transition={p.transition}
        hook={<HookCentered {...p} />}
        body={
          <AbsoluteFill style={{ justifyContent: 'center', padding: 90, gap: 32 }}>
            {(items.length ? items : ['Benefício 1', 'Benefício 2', 'Benefício 3']).map((it, i) => (
              <CheckRow key={i} i={i} text={it} accent={p.accentColor} />
            ))}
          </AbsoluteFill>
        }
        cta={<CtaScene {...p} />}
      />
    </Shell>
  );
};

// ── Template 14: Tutorial (passo a passo) ────────────────────────────────────
const StepRow: React.FC<{ i: number; text: string; accent: string }> = ({ i, text, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = spring({ frame: frame - i * 16, fps, config: { damping: 200 } });
  return (
    <div style={{ opacity: a, transform: `translateY(${interpolate(a, [0, 1], [30, 0])}px)` }}>
      <span style={{ color: accent, fontSize: 34, fontWeight: 800, letterSpacing: 2 }}>PASSO {i + 1}</span>
      <div style={{ color: 'white', fontSize: 52, fontWeight: 700, marginTop: 8 }}>{text}</div>
    </div>
  );
};

const Tutorial: React.FC<CreativeInput> = (p) => {
  const steps = (p.bodyText || '').split(/\n|\. /).map((s) => s.trim()).filter(Boolean).slice(0, 3);
  return (
    <Shell bg={p.bgColor} music={p.musicUrl}>
      <Trio
        transition={p.transition}
        hook={<HookCentered {...p} />}
        body={
          <AbsoluteFill style={{ justifyContent: 'center', padding: 80, gap: 44 }}>
            {(steps.length ? steps : ['Abra o app', 'Escolha a palavra', 'Veja seu score']).map((s, i) => (
              <StepRow key={i} i={i} text={s} accent={p.accentColor} />
            ))}
          </AbsoluteFill>
        }
        cta={<CtaScene {...p} />}
      />
    </Shell>
  );
};

// ── Registro: a galeria de templates disponíveis ─────────────────────────────
export interface TemplateDef {
  id: string;
  name: string;
  description: string;
  component: React.FC<CreativeInput>;
}

export const TEMPLATES: TemplateDef[] = [
  { id: 'screen-demo', name: 'Demo de tela', description: 'O app numa moldura de celular, com gancho e medidor.', component: ScreenDemo },
  { id: 'bold-text', name: 'Texto em destaque', description: 'Texto grande e animado, com mídia opcional ao fundo.', component: BoldText },
  { id: 'listicle', name: 'Lista / Curiosidade', description: '“TOP 5…” com itens entrando um a um.', component: Listicle },
  { id: 'problem-solution', name: 'Problema → Solução', description: 'O problema no gancho e a virada “A solução”.', component: ProblemSolution },
  { id: 'before-after', name: 'Antes / Depois', description: 'Tela dividida: antes (apagado) e depois (na cor da marca).', component: BeforeAfter },
  { id: 'quote', name: 'Depoimento', description: '5 estrelas + frase de cliente em destaque.', component: Quote },
  { id: 'big-stat', name: 'Número / Estatística', description: 'Um número gigante (ex.: 98%) com a legenda.', component: BigStat },
  { id: 'notification', name: 'Notificação', description: 'Card estilo push entrando na tela.', component: NotificationTpl },
  { id: 'comparison', name: 'Comparação', description: '“Outros vs você” em duas colunas (✕ vs ✓).', component: Comparison },
  { id: 'chat', name: 'Conversa', description: 'Bolhas de chat entrando uma a uma.', component: Chat },
  { id: 'question', name: 'Pergunta → Resposta', description: '“Você sabia?” e a revelação.', component: QuestionReveal },
  { id: 'pov', name: 'POV', description: '“POV:” com a mídia do app ao fundo.', component: Pov },
  { id: 'checklist', name: 'Checklist', description: 'Lista de benefícios com ✓ na cor da marca.', component: Checklist },
  { id: 'tutorial', name: 'Tutorial', description: 'Passo 1, 2, 3 — como usar o app.', component: Tutorial },
];
