// Meta-ad-style headline overlay configurator. Opens from the version
// gallery in Edição Zap (hook mode). Configures the FFmpeg /headline
// endpoint: text, colors, stroke, per-word palette, optional 2nd
// headline with auto-sync to the avatar's speech timestamps.
//
// Stateless — parent owns every value + handler. Lots of props because
// the configuration is rich; grouping them would just shuffle complexity.

interface WordStyle {
  tc: number; // text-color palette index (0-3)
  bg: number; // bg-color palette index (0-3)
}

interface Props {
  open: boolean;
  rendering: boolean;
  // Source video dimensions, used by the live preview to scale font + bar
  // proportionally to a fixed preview width so what the user sees here
  // matches what FFmpeg renders.
  sourceDims: { width: number; height: number } | null;

  // Headline 1
  text: string;
  bgColor: string;
  textColor: string;
  strokeColor: string;
  strokeWidth: number;
  hl1: string;
  hl2: string;
  hl3: string;
  bgHl1: string;
  bgHl2: string;
  bgHl3: string;
  wordStyles: WordStyle[];
  fontSize: number;
  barHeightPct: number;

  // Optional headline 2
  headline2Enabled: boolean;
  headline2Text: string;
  headline2BgColor: string;
  headline2WordStyles: WordStyle[];
  switchPct: number;
  autoTime: boolean;

  // Setters
  onTextChange: (v: string) => void;
  onBgColorChange: (v: string) => void;
  onTextColorChange: (v: string) => void;
  onStrokeColorChange: (v: string) => void;
  onStrokeWidthChange: (v: number) => void;
  onHl1Change: (v: string) => void;
  onHl2Change: (v: string) => void;
  onHl3Change: (v: string) => void;
  onBgHl1Change: (v: string) => void;
  onBgHl2Change: (v: string) => void;
  onBgHl3Change: (v: string) => void;
  onWordStylesChange: (next: WordStyle[] | ((prev: WordStyle[]) => WordStyle[])) => void;
  onFontSizeChange: (v: number) => void;
  onBarHeightPctChange: (v: number) => void;
  onHeadline2EnabledChange: (v: boolean) => void;
  onHeadline2TextChange: (v: string) => void;
  onHeadline2BgColorChange: (v: string) => void;
  onHeadline2WordStylesChange: (next: WordStyle[] | ((prev: WordStyle[]) => WordStyle[])) => void;
  onSwitchPctChange: (v: number) => void;
  onAutoTimeChange: (v: boolean) => void;

  onClose: () => void;
  onRender: () => void;
}

export function HeadlineModal(props: Props) {
  if (!props.open) return null;
  const {
    rendering,
    sourceDims,
    text,
    bgColor,
    textColor,
    strokeColor,
    strokeWidth,
    hl1,
    hl2,
    hl3,
    bgHl1,
    bgHl2,
    bgHl3,
    wordStyles,
    fontSize,
    barHeightPct,
    headline2Enabled,
    headline2Text,
    headline2BgColor,
    headline2WordStyles,
    switchPct,
    autoTime,
    onTextChange,
    onBgColorChange,
    onTextColorChange,
    onStrokeColorChange,
    onStrokeWidthChange,
    onHl1Change,
    onHl2Change,
    onHl3Change,
    onBgHl1Change,
    onBgHl2Change,
    onBgHl3Change,
    onWordStylesChange,
    onFontSizeChange,
    onBarHeightPctChange,
    onHeadline2EnabledChange,
    onHeadline2TextChange,
    onHeadline2BgColorChange,
    onHeadline2WordStylesChange,
    onSwitchPctChange,
    onAutoTimeChange,
    onClose,
    onRender,
  } = props;

  const previewWidth = 480;
  const videoW = sourceDims?.width || 1080;
  const videoH = sourceDims?.height || 1920;
  const scale = previewWidth / videoW;
  const previewBarH = Math.round(videoH * (barHeightPct / 100) * scale);
  const previewFontPx = Math.round(fontSize * scale);
  const previewStroke =
    strokeWidth > 0 ? `${Math.max(1, strokeWidth * scale)}px ${strokeColor}` : undefined;

  const renderPreview = (t: string, ws: WordStyle[], barBg: string) => {
    const words = t.split(/\s+/).filter(Boolean);
    const tcMap = [textColor, hl1, hl2, hl3];
    const bgMap = ['', bgHl1, bgHl2, bgHl3];
    return (
      <div
        className="mt-1 flex items-center justify-center rounded-xl border-2 border-gray-200 dark:border-gray-700 overflow-hidden mx-auto"
        style={{
          backgroundColor: barBg,
          color: textColor,
          width: `${previewWidth}px`,
          height: `${Math.max(20, previewBarH)}px`,
          maxWidth: '100%',
        }}
      >
        <span
          className="font-black text-center leading-tight"
          style={{
            fontFamily: 'Arial, sans-serif',
            fontSize: `${previewFontPx}px`,
            WebkitTextStroke: previewStroke,
            paintOrder: 'stroke fill',
            padding: `0 ${Math.round(40 * scale)}px`,
            wordBreak: 'normal',
          }}
        >
          {words.map((w, i) => {
            const wst = ws[i] || { tc: 0, bg: 0 };
            const color = tcMap[wst.tc] || textColor;
            const bg = bgMap[wst.bg] || 'transparent';
            return (
              <span key={`prev-${i}`}>
                <span
                  style={{
                    color,
                    backgroundColor: bg,
                    padding: wst.bg > 0 ? '0 0.12em' : 0,
                  }}
                >
                  {w}
                </span>
                {i < words.length - 1 ? ' ' : ''}
              </span>
            );
          })}
        </span>
      </div>
    );
  };

  const renderWordPicker = (
    currentText: string,
    currentWordStyles: WordStyle[],
    setter: (next: WordStyle[] | ((prev: WordStyle[]) => WordStyle[])) => void,
    barBg: string,
    label: string,
    emptyMsg: string,
    clearLabel: string
  ) => {
    const words = currentText.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      return (
        <div className="bg-gray-50 dark:bg-gray-800/60 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-4 text-center">
          <p className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500">{emptyMsg}</p>
        </div>
      );
    }
    const textColorMap = [textColor, hl1, hl2, hl3];
    const bgColorMap = ['', bgHl1, bgHl2, bgHl3];
    return (
      <div className="bg-gray-50 dark:bg-gray-800/60 p-3 rounded-xl border-2 border-gray-200 dark:border-gray-800 space-y-2">
        <label className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300 dark:text-gray-600">
          {label}
        </label>
        <div className="flex flex-wrap gap-2">
          {words.map((w, i) => {
            const ws = currentWordStyles[i] || { tc: 0, bg: 0 };
            const tcColor = textColorMap[ws.tc] || textColor;
            const bgC = bgColorMap[ws.bg] || '';
            const cycle = (field: 'tc' | 'bg') => {
              setter((prev) => {
                const next = words.map((_, j) => prev[j] || { tc: 0, bg: 0 });
                const cur = next[i] || { tc: 0, bg: 0 };
                next[i] = {
                  ...cur,
                  [field]: ((cur[field] || 0) + 1) % 4,
                };
                return next;
              });
            };
            return (
              <div
                key={`word-${i}-${w}`}
                className="flex flex-col items-center gap-1 p-2 rounded-lg border-2 border-gray-200 dark:border-gray-800"
                style={{ backgroundColor: barBg }}
              >
                <span
                  className="text-xs font-black px-2 py-1 rounded"
                  style={{
                    color: tcColor,
                    backgroundColor: bgC || 'transparent',
                  }}
                >
                  {w}
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => cycle('tc')}
                    title={`Letra: ${ws.tc === 0 ? 'padrão' : `cor ${ws.tc}`}`}
                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/90 hover:bg-white dark:hover:bg-gray-900/80 text-[9px] font-black text-gray-700 dark:text-gray-300 dark:text-gray-600"
                  >
                    L
                    <span
                      className="w-2 h-2 rounded-full border border-gray-300"
                      style={{ backgroundColor: tcColor }}
                    />
                    <span className="text-gray-400 dark:text-gray-500">{ws.tc}</span>
                  </button>
                  <button
                    onClick={() => cycle('bg')}
                    title={`Fundo: ${ws.bg === 0 ? 'nenhum' : `cor ${ws.bg}`}`}
                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/90 hover:bg-white dark:hover:bg-gray-900/80 text-[9px] font-black text-gray-700 dark:text-gray-300 dark:text-gray-600"
                  >
                    F
                    <span
                      className="w-2 h-2 rounded-full border border-gray-300"
                      style={{ backgroundColor: bgC || 'transparent' }}
                    />
                    <span className="text-gray-400 dark:text-gray-500">{ws.bg}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <button
          onClick={() => setter([])}
          disabled={rendering}
          className="text-[10px] font-black text-gray-500 dark:text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 dark:text-gray-600 underline"
        >
          {clearLabel}
        </button>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={() => !rendering && onClose()}
    >
      <div
        className="bg-white dark:bg-gray-900/80 rounded-[28px] max-w-2xl w-full max-h-[90vh] overflow-y-auto p-8 space-y-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-2">
          <h3 className="text-2xl font-black text-gray-900 dark:text-gray-50 uppercase italic">
            📰 Headline no topo do vídeo
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 dark:text-gray-500">
            Adiciona uma barra colorida com texto no topo do gancho — estilo anúncio do Meta. Cria
            uma nova versão; o original fica intacto.
          </p>
        </div>

        <div>
          <label className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300 dark:text-gray-600">
            Texto da headline
          </label>
          <input
            type="text"
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            placeholder='Ex.: "ÚLTIMAS VAGAS — 50% OFF HOJE"'
            className="w-full p-3 border-2 border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:border-pink-500 focus:outline-none"
            disabled={rendering}
            maxLength={140}
          />
          <p className="text-[10px] text-gray-500 dark:text-gray-400 dark:text-gray-500 mt-1">
            {text.length}/140 caracteres. Use os chips abaixo pra colorir palavras individuais.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ColorField
            label="Cor do fundo"
            value={bgColor}
            onChange={onBgColorChange}
            disabled={rendering}
          />
          <ColorField
            label="Cor das letras (padrão)"
            value={textColor}
            onChange={onTextColorChange}
            disabled={rendering}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ColorField
            label="Cor da borda"
            value={strokeColor}
            onChange={onStrokeColorChange}
            disabled={rendering}
          />
          <div>
            <label className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300 dark:text-gray-600">
              Espessura da borda:{' '}
              <span className="text-pink-700">
                {strokeWidth === 0 ? 'sem borda' : `${strokeWidth}px`}
              </span>
            </label>
            <input
              type="range"
              min={0}
              max={6}
              step={1}
              value={strokeWidth}
              onChange={(e) => onStrokeWidthChange(parseInt(e.target.value))}
              disabled={rendering}
              className="w-full accent-pink-600 mt-3"
            />
          </div>
        </div>

        <div className="bg-gray-50 dark:bg-gray-800/60 p-3 rounded-xl border-2 border-gray-200 dark:border-gray-800 space-y-3">
          <PaletteRow
            heading="Paleta — cor das letras (palavras destacadas)"
            entries={[
              { v: hl1, set: onHl1Change, label: 'Letra 1' },
              { v: hl2, set: onHl2Change, label: 'Letra 2' },
              { v: hl3, set: onHl3Change, label: 'Letra 3' },
            ]}
            disabled={rendering}
          />
          <PaletteRow
            heading="Paleta — cor de fundo (palavras destacadas)"
            entries={[
              { v: bgHl1, set: onBgHl1Change, label: 'Fundo 1' },
              { v: bgHl2, set: onBgHl2Change, label: 'Fundo 2' },
              { v: bgHl3, set: onBgHl3Change, label: 'Fundo 3' },
            ]}
            disabled={rendering}
          />
        </div>

        <div>
          <label className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300 dark:text-gray-600">
            Pré-visualização da barra
            {sourceDims && (
              <span className="ml-2 text-[9px] text-gray-400 dark:text-gray-500 normal-case font-normal">
                (escala real do vídeo: {videoW}×{videoH})
              </span>
            )}
          </label>
          {renderPreview(text || 'SUA HEADLINE AQUI', wordStyles, bgColor)}
          {headline2Enabled && headline2Text.trim() && (
            <>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 dark:text-gray-500 mt-3 mb-1">
                ↓ 2ª headline (substitui a 1ª na hora certa)
              </p>
              {renderPreview(headline2Text, headline2WordStyles, headline2BgColor)}
            </>
          )}
        </div>

        {renderWordPicker(
          text,
          wordStyles,
          onWordStylesChange,
          bgColor,
          'Personalizar palavras (clique nos botões L=Letra / F=Fundo)',
          'Digite o texto acima pra escolher as cores de cada palavra.',
          'Limpar todas as cores'
        )}

        <div className="border-t-2 border-gray-200 dark:border-gray-800 pt-4 space-y-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={headline2Enabled}
              onChange={(e) => onHeadline2EnabledChange(e.target.checked)}
              disabled={rendering}
              className="w-4 h-4 accent-pink-500"
            />
            <span className="text-[11px] font-black text-gray-700 dark:text-gray-300 dark:text-gray-600 uppercase tracking-widest">
              ➕ Adicionar segunda headline
            </span>
          </label>
          <p className="text-[10px] text-gray-500 dark:text-gray-400 dark:text-gray-500 -mt-1 ml-6">
            A 1ª aparece no início, a 2ª substitui no ponto que você escolher. Ambas usam a mesma
            paleta e borda.
          </p>

          {headline2Enabled && (
            <div className="space-y-3 ml-6 pl-4 border-l-4 border-pink-100">
              <label className="flex items-start gap-2 cursor-pointer p-2 bg-blue-50 dark:bg-blue-950/40 border-2 border-blue-200 rounded-lg">
                <input
                  type="checkbox"
                  checked={autoTime}
                  onChange={(e) => onAutoTimeChange(e.target.checked)}
                  disabled={rendering}
                  className="w-4 h-4 accent-blue-500 mt-0.5"
                />
                <div className="flex-1">
                  <span className="text-[11px] font-black text-blue-900 uppercase tracking-widest block">
                    🎙 Sincronizar com a fala (auto)
                  </span>
                  <span className="text-[10px] text-blue-800 leading-tight">
                    Transcreve o áudio e detecta o momento exato que o avatar fala cada headline. As
                    headlines aparecem só durante a fala (some quando ele para de falar). Demora
                    +30-90s (transcrição via AssemblyAI).
                  </span>
                </div>
              </label>

              {!autoTime && (
                <div>
                  <label className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300 dark:text-gray-600">
                    Trocar headline em: <span className="text-pink-700">{switchPct}%</span> do vídeo
                  </label>
                  <input
                    type="range"
                    min={10}
                    max={90}
                    step={5}
                    value={switchPct}
                    onChange={(e) => onSwitchPctChange(parseInt(e.target.value))}
                    disabled={rendering}
                    className="w-full accent-pink-600"
                  />
                </div>
              )}

              <div>
                <label className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300 dark:text-gray-600">
                  Texto da 2ª headline
                </label>
                <input
                  type="text"
                  value={headline2Text}
                  onChange={(e) => onHeadline2TextChange(e.target.value)}
                  placeholder='Ex.: "AGORA POR APENAS R$ 97"'
                  className="w-full p-3 border-2 border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:border-pink-500 focus:outline-none"
                  disabled={rendering}
                  maxLength={140}
                />
              </div>

              <div>
                <label className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300 dark:text-gray-600">
                  Cor do fundo da 2ª barra
                </label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="color"
                    value={headline2BgColor}
                    onChange={(e) => onHeadline2BgColorChange(e.target.value)}
                    disabled={rendering}
                    className="h-10 w-14 rounded-lg border-2 border-gray-200 dark:border-gray-700 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={headline2BgColor}
                    onChange={(e) => onHeadline2BgColorChange(e.target.value)}
                    disabled={rendering}
                    className="flex-1 p-2 border-2 border-gray-200 dark:border-gray-700 rounded-lg text-xs font-mono focus:border-pink-500 focus:outline-none"
                  />
                </div>
              </div>

              {renderWordPicker(
                headline2Text,
                headline2WordStyles,
                onHeadline2WordStylesChange,
                headline2BgColor,
                'Personalizar palavras da 2ª headline',
                'Digite o texto da 2ª headline pra customizar palavras.',
                'Limpar cores da 2ª headline'
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300 dark:text-gray-600">
              Tamanho da fonte: <span className="text-pink-700">{fontSize}px</span>
            </label>
            <input
              type="range"
              min={24}
              max={140}
              step={2}
              value={fontSize}
              onChange={(e) => onFontSizeChange(parseInt(e.target.value))}
              className="w-full accent-pink-600"
              disabled={rendering}
            />
          </div>
          <div>
            <label className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300 dark:text-gray-600">
              Altura da barra: <span className="text-pink-700">{barHeightPct}%</span>
            </label>
            <input
              type="range"
              min={5}
              max={30}
              step={1}
              value={barHeightPct}
              onChange={(e) => onBarHeightPctChange(parseInt(e.target.value))}
              className="w-full accent-pink-600"
              disabled={rendering}
            />
            <p className="text-[10px] text-gray-500 dark:text-gray-400 dark:text-gray-500 mt-1">
              % da altura total do vídeo
            </p>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            disabled={rendering}
            className="flex-1 py-3 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 dark:text-gray-600 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-gray-200 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={onRender}
            disabled={rendering || !text.trim()}
            className="flex-1 py-3 bg-pink-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-pink-700 disabled:opacity-50"
          >
            {rendering ? 'Aplicando...' : 'Aplicar headline'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300 dark:text-gray-600">
        {label}
      </label>
      <div className="flex items-center gap-2 mt-1">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="h-12 w-16 rounded-xl border-2 border-gray-200 dark:border-gray-700 cursor-pointer"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="flex-1 p-3 border-2 border-gray-200 dark:border-gray-700 rounded-xl text-xs font-mono focus:border-pink-500 focus:outline-none"
        />
      </div>
    </div>
  );
}

function PaletteRow({
  heading,
  entries,
  disabled,
}: {
  heading: string;
  entries: { v: string; set: (v: string) => void; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300 dark:text-gray-600">
        {heading}
      </label>
      <div className="grid grid-cols-3 gap-2 mt-2">
        {entries.map((hl, i) => (
          <div key={i}>
            <div className="text-[9px] font-black text-gray-600 dark:text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1">
              {hl.label}
            </div>
            <div className="flex items-center gap-1">
              <input
                type="color"
                value={hl.v}
                onChange={(e) => hl.set(e.target.value)}
                disabled={disabled}
                className="h-9 w-12 rounded-lg border-2 border-gray-200 dark:border-gray-700 cursor-pointer"
              />
              <input
                type="text"
                value={hl.v}
                onChange={(e) => hl.set(e.target.value)}
                disabled={disabled}
                className="flex-1 p-1.5 border-2 border-gray-200 dark:border-gray-700 rounded-lg text-[10px] font-mono focus:border-pink-500 focus:outline-none min-w-0"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
