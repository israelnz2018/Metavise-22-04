import React from "react";
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Img,
  OffthreadVideo,
} from "remotion";
import { z } from "zod";
import { zColor } from "@remotion/zod-types";

// ─────────────────────────────────────────────────────────────────────────
//  A "FICHINHA" DE ENTRADA DO MOLDE
//  Cada campo abaixo é uma coisa que o usuário troca por vídeo.
//  No Remotion Studio isso vira um formulário; numa planilha, cada LINHA
//  preenche esses campos e gera 1 vídeo. MESMO molde, conteúdos diferentes.
// ─────────────────────────────────────────────────────────────────────────
export const demoMoldSchema = z.object({
  hook: z.string(),               // gancho dos primeiros segundos
  appName: z.string(),            // nome do app
  caption: z.string(),            // legenda sobre a gravação
  ctaText: z.string(),            // chamada final (call to action)
  accentColor: zColor(),          // cor de destaque (marca)
  bgColor: zColor(),              // cor de fundo (marca)
  logoUrl: z.string().optional(), // logo (opcional - se vazio, usa a inicial do nome)
  screenRecordingUrl: z.string().optional(), // gravação da tela do app (opcional)
});

export type DemoMoldProps = z.infer<typeof demoMoldSchema>;

// Valores que aparecem quando você abre o Studio (pode editar todos ao vivo).
export const defaultDemoProps: DemoMoldProps = {
  hook: "Você fala 'determine' errado?",
  appName: "VisualSpeak",
  caption: "Veja sua pronúncia virar verde em segundos",
  ctaText: "Baixe grátis →",
  accentColor: "#22c55e",
  bgColor: "#0f172a",
  logoUrl: "",
  screenRecordingUrl: "",
};

const FONT = "'Inter', system-ui, -apple-system, sans-serif";
const TEXT_ON_ACCENT = "#0b1220"; // texto escuro legível sobre a cor de destaque

// ─────────────────────────────────────────────────────────────────────────
//  O MOLDE = 3 cenas encadeadas. Estrutura fixa, conteúdo trocável.
//   0–2.6s  → gancho   |  2.3–13s → gravação do app  |  12.8–15s → chamada
// ─────────────────────────────────────────────────────────────────────────
export const DemoMold: React.FC<DemoMoldProps> = (props) => {
  return (
    <AbsoluteFill style={{ backgroundColor: props.bgColor, fontFamily: FONT }}>
      <Sequence from={0} durationInFrames={78}>
        <HookScene hook={props.hook} accentColor={props.accentColor} />
      </Sequence>

      <Sequence from={70} durationInFrames={320}>
        <DemoScene {...props} />
      </Sequence>

      <Sequence from={385} durationInFrames={65}>
        <CtaScene
          appName={props.appName}
          ctaText={props.ctaText}
          accentColor={props.accentColor}
          logoUrl={props.logoUrl}
        />
      </Sequence>
    </AbsoluteFill>
  );
};

// ── Cena 1: o gancho ──────────────────────────────────────────────────────
const HookScene: React.FC<{ hook: string; accentColor: string }> = ({ hook, accentColor }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 } });
  const scale = interpolate(enter, [0, 1], [0.8, 1]);
  const exit = interpolate(frame, [durationInFrames - 12, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: 90, opacity: exit }}>
      <div style={{ transform: `scale(${scale})`, textAlign: "center" }}>
        <div style={{ width: 90, height: 10, background: accentColor, borderRadius: 99, margin: "0 auto 44px" }} />
        <h1 style={{ color: "white", fontSize: 100, fontWeight: 800, lineHeight: 1.05, margin: 0 }}>{hook}</h1>
      </div>
    </AbsoluteFill>
  );
};

// ── Cena 2: a gravação do app (ou um placeholder mostrando onde ela entra) ──
const DemoScene: React.FC<DemoMoldProps> = ({ appName, caption, accentColor, logoUrl, screenRecordingUrl }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 } });
  const y = interpolate(enter, [0, 1], [60, 0]);
  const zoom = interpolate(frame, [0, 320], [1.0, 1.08]); // zoom lento (Ken Burns)
  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: 120 }}>
      {/* topo: logo + nome do app */}
      <div style={{ display: "flex", alignItems: "center", gap: 22, opacity: enter }}>
        <Logo logoUrl={logoUrl} appName={appName} accentColor={accentColor} size={64} />
        <span style={{ color: "white", fontSize: 42, fontWeight: 700 }}>{appName}</span>
      </div>

      {/* moldura do "celular" com a gravação dentro */}
      <div
        style={{
          marginTop: 56,
          transform: `translateY(${y}px) scale(${zoom})`,
          width: 620,
          height: 1040,
          borderRadius: 56,
          overflow: "hidden",
          border: "8px solid rgba(255,255,255,0.12)",
          boxShadow: "0 40px 120px rgba(0,0,0,0.5)",
          background: "#000",
        }}
      >
        {screenRecordingUrl ? (
          <OffthreadVideo src={screenRecordingUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <Placeholder accentColor={accentColor} />
        )}
      </div>

      {/* legenda animada sobre a gravação */}
      <div style={{ position: "absolute", bottom: 96, left: 70, right: 70, textAlign: "center", opacity: enter }}>
        <span
          style={{
            display: "inline-block",
            background: accentColor,
            color: TEXT_ON_ACCENT,
            fontSize: 40,
            fontWeight: 700,
            padding: "20px 36px",
            borderRadius: 24,
            lineHeight: 1.2,
          }}
        >
          {caption}
        </span>
      </div>
    </AbsoluteFill>
  );
};

// ── Placeholder: mostra ONDE a gravação do app entra + um "score" de exemplo ─
const Placeholder: React.FC<{ accentColor: string }> = ({ accentColor }) => {
  const frame = useCurrentFrame();
  const score = Math.round(
    interpolate(frame, [20, 180], [12, 98], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
  );
  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(160deg,#1e293b,#0b1220)",
        justifyContent: "center",
        alignItems: "center",
        gap: 56,
        padding: 48,
      }}
    >
      <span style={{ fontSize: 30, color: "#64748b", textAlign: "center", whiteSpace: "pre-line" }}>
        {"📱 a gravação do\nseu app entra aqui"}
      </span>
      <div style={{ width: 380, textAlign: "center" }}>
        <div style={{ color: "white", fontSize: 140, fontWeight: 800, lineHeight: 1 }}>{score}</div>
        <div style={{ height: 26, background: "rgba(255,255,255,0.1)", borderRadius: 99, marginTop: 24, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${score}%`, background: accentColor, borderRadius: 99 }} />
        </div>
        <div style={{ color: "#94a3b8", marginTop: 18, fontSize: 26 }}>pronúncia</div>
      </div>
    </AbsoluteFill>
  );
};

// ── Cena 3: a chamada final ────────────────────────────────────────────────
const CtaScene: React.FC<{ appName: string; ctaText: string; accentColor: string; logoUrl?: string }> = ({
  appName,
  ctaText,
  accentColor,
  logoUrl,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 } });
  const y = interpolate(enter, [0, 1], [40, 0]);
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <div
        style={{
          transform: `translateY(${y}px)`,
          opacity: enter,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 44,
        }}
      >
        <Logo logoUrl={logoUrl} appName={appName} accentColor={accentColor} size={150} />
        <span style={{ color: "white", fontSize: 68, fontWeight: 800 }}>{appName}</span>
        <div
          style={{
            background: accentColor,
            color: TEXT_ON_ACCENT,
            fontSize: 50,
            fontWeight: 800,
            padding: "30px 68px",
            borderRadius: 99,
          }}
        >
          {ctaText}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── Logo: usa a imagem se houver; senão, um quadrado com a inicial do nome ──
const Logo: React.FC<{ logoUrl?: string; appName: string; accentColor: string; size: number }> = ({
  logoUrl,
  appName,
  accentColor,
  size,
}) => {
  if (logoUrl) {
    return <Img src={logoUrl} style={{ width: size, height: size, borderRadius: size * 0.25, objectFit: "cover" }} />;
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.25,
        background: accentColor,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        color: TEXT_ON_ACCENT,
        fontWeight: 800,
        fontSize: size * 0.5,
      }}
    >
      {(appName || "?").slice(0, 1).toUpperCase()}
    </div>
  );
};
