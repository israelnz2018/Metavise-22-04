import React, { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Player, type PlayerRef } from '@remotion/player';
import {
  Film,
  Upload,
  Type,
  Image as ImageIcon,
  Mic,
  Video as VideoIcon,
  Building2,
  Check,
  Link2,
} from 'lucide-react';
import {
  TEMPLATES,
  DEFAULT_CREATIVE,
  FPS,
  WIDTH,
  HEIGHT,
  DURATION,
  type CreativeInput,
} from '../remotion/templates';
import { type BrandProfile, loadBrand, saveBrand } from '../lib/brand';
import { BrandModal } from '../components/BrandModal';
import { useLanguage } from '../lib/i18n/LanguageContext';

// ───────────────────────────────────────────────────────────────────────────
//  Braço 2 — aba Remotion. Fluxo: Marca (obrigatória) → Template → preencher
//  Hook/Corpo/CTA → Gerar. A PRÉVIA é ao vivo via @remotion/player (roda no
//  navegador, leve, sem renderizar MP4). O render em massa vai pra nuvem depois.
// ───────────────────────────────────────────────────────────────────────────

interface RemotionTabProps {
  config: any;
  setConfig: React.Dispatch<React.SetStateAction<any>>;
  setCurrentStep: (step: any) => void;
}

type Source = 'project' | 'upload' | 'write' | '';
interface BlockData {
  source: Source;
  text: string;
  mediaUrl: string;
  mediaType: 'video' | 'image' | '';
  label: string;
}
const emptyBlock = (): BlockData => ({
  source: '',
  text: '',
  mediaUrl: '',
  mediaType: '',
  label: '',
});

export const RemotionTab: React.FC<RemotionTabProps> = ({ config }) => {
  const { t } = useLanguage();
  const rt = t.remotionTab;
  const CTA_PRESETS = rt.ctaPresets;
  const [brand, setBrand] = useState<BrandProfile | null>(() => loadBrand());
  const [showBrandModal, setShowBrandModal] = useState(false);

  const [templateId, setTemplateId] = useState<string>(TEMPLATES[0]!.id);
  const [hook, setHook] = useState<BlockData>(emptyBlock);
  const [body, setBody] = useState<BlockData>(emptyBlock);
  const [cta, setCta] = useState<BlockData>({ ...emptyBlock(), source: 'write' });

  // Ajustes (manoplas) — o usuário liga/testa e inclui ou não.
  const [transition, setTransition] = useState<'slide' | 'fade' | 'wipe'>('slide');
  const [music, setMusic] = useState<{ url: string; name: string }>({ url: '', name: '' });
  const [format, setFormat] = useState<'9:16' | '1:1' | '16:9'>('9:16');
  const [captions, setCaptions] = useState(false);

  useEffect(() => {
    if (!brand) setShowBrandModal(true);
  }, [brand]);

  const selected = useMemo(
    () => TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0]!,
    [templateId]
  );

  // Player: ao clicar num template, reinicia e toca na hora (sem precisar da setinha).
  const playerRef = useRef<PlayerRef>(null);
  const pickTemplate = (id: string) => {
    setTemplateId(id);
    const pr = playerRef.current;
    if (pr) {
      pr.seekTo(0);
      pr.play();
    }
  };

  const onMusic = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setMusic({ url: URL.createObjectURL(f), name: f.name });
  };

  const dims =
    format === '1:1'
      ? { w: 1080, h: 1080 }
      : format === '16:9'
        ? { w: 1920, h: 1080 }
        : { w: WIDTH, h: HEIGHT };

  // Conteúdo que alimenta a prévia (campos vazios caem no exemplo padrão).
  const creative: CreativeInput = useMemo(
    () => ({
      companyName: brand?.companyName || DEFAULT_CREATIVE.companyName,
      accentColor: brand?.accentColor || DEFAULT_CREATIVE.accentColor,
      bgColor: brand?.bgColor || DEFAULT_CREATIVE.bgColor,
      logoUrl: brand?.logoUrl || '',
      hookText: hook.text || DEFAULT_CREATIVE.hookText,
      bodyText: body.text || DEFAULT_CREATIVE.bodyText,
      bodyMediaUrl: body.mediaUrl || '',
      bodyMediaType: body.mediaType || '',
      ctaText: cta.text || DEFAULT_CREATIVE.ctaText,
      transition,
      musicUrl: music.url || undefined,
    }),
    [brand, hook.text, body.text, body.mediaUrl, body.mediaType, cta.text, transition, music.url]
  );

  // ── "Puxar do projeto": tudo que já foi feito, EXCETO o que veio da edição ──
  const fromProject = useMemo(() => {
    const c = config || {};
    const copy = c.copy || {};
    return {
      hookCopy: copy.hookSelecionado || copy.generatedHook || copy.hooksGerados?.[0] || '',
      creativeCopy: copy.finalScript || copy.generatedScript || '',
      hookImage: c.hookVisual?.imagemEscolhida || c.hookVisual?.imagensGeradas?.[0] || '',
      hookAudioUrl: copy.hookAudioUrl || copy.hookAudios?.slice(-1)?.[0]?.url || '',
      bodyAudioUrl: c.audioUrl || c.audios?.slice(-1)?.[0]?.url || '',
      avatarVideoUrl: copy.hookVideoUrl || c.videoUrl || '',
    };
  }, [config]);

  const handleSaveBrand = (b: BrandProfile) => {
    saveBrand(b);
    setBrand(b);
    setShowBrandModal(false);
    toast.success(rt.toasts.brandSaved);
  };

  const locked = !brand;

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      {/* Cabeçalho */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-11 h-11 rounded-2xl bg-indigo-600 flex items-center justify-center">
          <Film className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-gray-100">Remotion</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{rt.subtitle}</p>
        </div>
        <button
          onClick={() => setShowBrandModal(true)}
          className="ml-auto flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border-2 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          <Building2 className="w-4 h-4" />
          {brand ? brand.companyName : rt.registerBrandButton}
        </button>
      </div>

      <div className={locked ? 'opacity-40 pointer-events-none select-none' : ''}>
        <div className="grid md:grid-cols-[1fr_320px] gap-8">
          {/* Coluna esquerda: escolher template + montar */}
          <div>
            <Section title={rt.sections.template.title} subtitle={rt.sections.template.subtitle}>
              <div className="grid grid-cols-3 gap-3">
                {TEMPLATES.map((t) => {
                  const active = templateId === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => pickTemplate(t.id)}
                      className={`text-left p-4 rounded-2xl border-2 transition-all ${
                        active
                          ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40'
                          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                      }`}
                    >
                      <div className="font-bold text-sm text-gray-900 dark:text-gray-100">
                        {t.name}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {t.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </Section>

            <Section title={rt.sections.assemble.title} subtitle={rt.sections.assemble.subtitle}>
              <BlockEditor
                title={rt.blocks.hook.title}
                hint={rt.blocks.hook.hint}
                block={hook}
                setBlock={setHook}
                projectItems={
                  [
                    fromProject.hookCopy && {
                      kind: 'text',
                      label: rt.projectItemLabels.hookCopy,
                      value: fromProject.hookCopy,
                    },
                    fromProject.hookImage && {
                      kind: 'image',
                      label: rt.projectItemLabels.hookImage,
                      value: fromProject.hookImage,
                    },
                    fromProject.hookAudioUrl && {
                      kind: 'audio',
                      label: rt.projectItemLabels.hookAudio,
                      value: fromProject.hookAudioUrl,
                    },
                    fromProject.avatarVideoUrl && {
                      kind: 'video',
                      label: rt.projectItemLabels.avatarVideo,
                      value: fromProject.avatarVideoUrl,
                    },
                  ].filter(Boolean) as ProjectItem[]
                }
              />
              <BlockEditor
                title={rt.blocks.body.title}
                hint={rt.blocks.body.hint}
                block={body}
                setBlock={setBody}
                projectItems={
                  [
                    fromProject.creativeCopy && {
                      kind: 'text',
                      label: rt.projectItemLabels.creativeCopy,
                      value: fromProject.creativeCopy,
                    },
                    fromProject.avatarVideoUrl && {
                      kind: 'video',
                      label: rt.projectItemLabels.avatarVideo,
                      value: fromProject.avatarVideoUrl,
                    },
                    fromProject.bodyAudioUrl && {
                      kind: 'audio',
                      label: rt.projectItemLabels.bodyAudio,
                      value: fromProject.bodyAudioUrl,
                    },
                  ].filter(Boolean) as ProjectItem[]
                }
              />
              <BlockEditor
                title={rt.blocks.cta.title}
                hint={rt.blocks.cta.hint}
                block={cta}
                setBlock={setCta}
                presets={CTA_PRESETS}
                projectItems={[]}
              />
            </Section>

            <div className="flex items-start gap-2 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3 mb-6">
              <Link2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>
                <b>{rt.autoDurationHint.bold}</b> {rt.autoDurationHint.text}
              </span>
            </div>

            <Section
              title={rt.sections.adjustments.title}
              subtitle={rt.sections.adjustments.subtitle}
            >
              <Knob label={rt.knobs.transition}>
                {(
                  [
                    ['slide', rt.transitions.slide],
                    ['fade', rt.transitions.fade],
                    ['wipe', rt.transitions.wipe],
                  ] as const
                ).map(([v, l]) => (
                  <Pill key={v} active={transition === v} onClick={() => setTransition(v)}>
                    {l}
                  </Pill>
                ))}
              </Knob>
              <Knob label={rt.knobs.format}>
                {(['9:16', '1:1', '16:9'] as const).map((v) => (
                  <Pill key={v} active={format === v} onClick={() => setFormat(v)}>
                    {v}
                  </Pill>
                ))}
              </Knob>
              <Knob label={rt.knobs.music}>
                <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-dashed border-gray-300 dark:border-gray-600 hover:border-indigo-400 cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  {rt.uploadMusicLabel}
                  <input type="file" accept="audio/*" className="hidden" onChange={onMusic} />
                </label>
                {music.url ? (
                  <Pill active onClick={() => setMusic({ url: '', name: '' })}>
                    ✕ {music.name}
                  </Pill>
                ) : (
                  <span className="text-xs text-gray-400">{rt.noMusic}</span>
                )}
              </Knob>
              <Knob label={rt.knobs.captions}>
                <Pill active={captions} onClick={() => setCaptions((c) => !c)}>
                  {captions ? rt.captionsOn : rt.captionsOff}
                </Pill>
                <span className="text-xs text-gray-400">{rt.captionsHint}</span>
              </Knob>
            </Section>

            <button
              onClick={() =>
                brand ? toast(rt.toasts.nextStepRender, { icon: '🛠️' }) : setShowBrandModal(true)
              }
              className="w-full py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-lg shadow-lg transition-all"
            >
              {rt.generateVideoButton}
            </button>
          </div>

          {/* Coluna direita: PRÉVIA AO VIVO (clica num template e vê com os olhos) */}
          <div className="md:sticky md:top-6 self-start">
            <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
              {rt.livePreviewLabel}
            </div>
            <div className="rounded-2xl overflow-hidden border-2 border-gray-200 dark:border-gray-700 bg-black">
              <Player
                ref={playerRef}
                component={selected.component as unknown as React.FC<Record<string, unknown>>}
                inputProps={creative as unknown as Record<string, unknown>}
                durationInFrames={DURATION}
                fps={FPS}
                compositionWidth={dims.w}
                compositionHeight={dims.h}
                style={{ width: '100%', aspectRatio: `${dims.w} / ${dims.h}` }}
                controls
                loop
                autoPlay
              />
            </div>
            <p className="text-[11px] text-gray-400 mt-2 text-center">{rt.previewFootnote}</p>
          </div>
        </div>
      </div>

      {showBrandModal && (
        <BrandModal
          initial={brand}
          mandatory={!brand}
          onClose={() => brand && setShowBrandModal(false)}
          onSave={handleSaveBrand}
        />
      )}
    </div>
  );
};

// ── Subcomponentes ──────────────────────────────────────────────────────────
const Section: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({
  title,
  subtitle,
  children,
}) => (
  <div className="mb-6">
    <div className="flex items-baseline gap-2 mb-3">
      <h2 className="text-sm font-black uppercase tracking-widest text-gray-900 dark:text-gray-100">
        {title}
      </h2>
      {subtitle && <span className="text-xs text-gray-400">— {subtitle}</span>}
    </div>
    {children}
  </div>
);

const Knob: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center gap-3 mb-3 flex-wrap">
    <span className="text-xs font-bold uppercase tracking-wider text-gray-500 w-20">{label}</span>
    <div className="flex flex-wrap gap-2 items-center">{children}</div>
  </div>
);

const Pill: React.FC<{ active?: boolean; onClick: () => void; children: React.ReactNode }> = ({
  active,
  onClick,
  children,
}) => (
  <button
    onClick={onClick}
    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border-2 transition-all ${
      active
        ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300'
        : 'border-gray-200 dark:border-gray-700'
    }`}
  >
    {children}
  </button>
);

type ProjectItem = { kind: 'text' | 'image' | 'audio' | 'video'; label: string; value: string };
const KIND_ICON = { text: Type, image: ImageIcon, audio: Mic, video: VideoIcon } as const;

const BlockEditor: React.FC<{
  title: string;
  hint: string;
  block: BlockData;
  setBlock: React.Dispatch<React.SetStateAction<BlockData>>;
  projectItems: ProjectItem[];
  presets?: string[];
}> = ({ title, hint, block, setBlock, projectItems, presets }) => {
  const { t } = useLanguage();
  const be = t.remotionTab.blockEditor;
  const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const mediaType = file.type.startsWith('video') ? 'video' : 'image';
    setBlock((b) => ({ ...b, source: 'upload', mediaUrl: url, mediaType, label: file.name }));
  };

  return (
    <div className="border-2 border-gray-100 dark:border-gray-800 rounded-2xl p-4 mb-3 bg-white dark:bg-gray-900/40">
      <div className="flex items-baseline gap-2 mb-3">
        <span className="font-bold text-gray-900 dark:text-gray-100">{title}</span>
        <span className="text-xs text-gray-400">— {hint}</span>
        {block.label && (
          <span className="ml-auto text-xs text-indigo-600 flex items-center gap-1">
            <Check className="w-3 h-3" /> {block.label}
          </span>
        )}
      </div>

      {projectItems.length > 0 && (
        <div className="mb-3">
          <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
            {be.pullFromProjectLabel}
          </div>
          <div className="flex flex-wrap gap-2">
            {projectItems.map((it, i) => {
              const Icon = KIND_ICON[it.kind];
              return (
                <button
                  key={i}
                  onClick={() =>
                    setBlock((b) => ({
                      ...b,
                      source: 'project',
                      label: it.label,
                      text: it.kind === 'text' ? it.value : b.text,
                      mediaUrl: it.kind === 'text' ? b.mediaUrl : it.value,
                      mediaType:
                        it.kind === 'image' ? 'image' : it.kind === 'video' ? 'video' : b.mediaType,
                    }))
                  }
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-gray-700 hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30"
                >
                  <Icon className="w-3.5 h-3.5 text-indigo-600" />
                  {it.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-dashed border-gray-300 dark:border-gray-600 hover:border-indigo-400 cursor-pointer">
          <Upload className="w-3.5 h-3.5" />
          {be.uploadMediaLabel}
          <input type="file" accept="video/*,image/*" className="hidden" onChange={onUpload} />
        </label>
        {presets?.map((p) => (
          <button
            key={p}
            onClick={() => setBlock((b) => ({ ...b, source: 'write', text: p, label: p }))}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-gray-700 hover:border-indigo-400"
          >
            {p}
          </button>
        ))}
      </div>

      <textarea
        value={block.text}
        onChange={(e) =>
          setBlock((b) => ({ ...b, text: e.target.value, source: b.source || 'write' }))
        }
        placeholder={be.textPlaceholder}
        rows={2}
        className="mt-3 w-full text-sm rounded-xl border-2 border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 p-3 resize-none focus:outline-none focus:border-indigo-400"
      />
    </div>
  );
};
