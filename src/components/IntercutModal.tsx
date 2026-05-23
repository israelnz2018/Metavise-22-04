import { Trash2 } from 'lucide-react';

// "Cortes pretos com texto" modal — opens from the version gallery in
// Edição Zap. Configures the FFmpeg /intercut endpoint: how long the
// avatar segments run, how long the black-screen text cuts are, font
// size, and the cycling text list.
//
// Stateless — the parent owns every value + handler.
interface Props {
  open: boolean;
  rendering: boolean;
  avatarSec: number;
  blackSec: number;
  fontSize: number;
  texts: string[];
  onAvatarSecChange: (next: number) => void;
  onBlackSecChange: (next: number) => void;
  onFontSizeChange: (next: number) => void;
  onTextsChange: (next: string[]) => void;
  onClose: () => void;
  onRender: () => void;
}

export function IntercutModal({
  open,
  rendering,
  avatarSec,
  blackSec,
  fontSize,
  texts,
  onAvatarSecChange,
  onBlackSecChange,
  onFontSizeChange,
  onTextsChange,
  onClose,
  onRender,
}: Props) {
  if (!open) return null;
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
            ✂ Cortes pretos com texto
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 dark:text-gray-500">
            Alterna entre o avatar e tela preta com texto grande. O áudio continua tocando durante a
            tela preta — só a imagem muda.
          </p>
        </div>

        <div className="space-y-4">
          <RangeField
            label="Duração do avatar entre cortes"
            value={avatarSec}
            unit="s"
            min={5}
            max={60}
            onChange={onAvatarSecChange}
            disabled={rendering}
          />
          <RangeField
            label="Duração da tela preta"
            value={blackSec}
            unit="s"
            min={3}
            max={60}
            onChange={onBlackSecChange}
            disabled={rendering}
            hint="Pode ir até 60s por corte se quiser segurar o texto na tela."
          />
          <RangeField
            label="Tamanho da fonte"
            value={fontSize}
            unit="px"
            min={28}
            max={120}
            step={2}
            onChange={onFontSizeChange}
            disabled={rendering}
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300 dark:text-gray-600">
              Textos das telas pretas
            </label>
            <button
              type="button"
              onClick={() => onTextsChange([...texts, ''])}
              className="text-[10px] font-black uppercase tracking-widest text-purple-700 dark:text-purple-300 hover:text-purple-900"
              disabled={rendering}
            >
              + Adicionar
            </button>
          </div>
          <p className="text-[10px] text-gray-500 dark:text-gray-400 dark:text-gray-500 -mt-2">
            Se houver mais cortes que textos, eles são reutilizados em ciclo.
          </p>
          {texts.map((t, i) => (
            <div key={`intercut-text-${i}`} className="flex gap-2">
              <textarea
                value={t}
                onChange={(e) => {
                  const next = [...texts];
                  next[i] = e.target.value;
                  onTextsChange(next);
                }}
                placeholder={`Texto ${i + 1} (ex.: "ESSA IA TRANSCREVE EM 30 SEGUNDOS")`}
                rows={2}
                className="flex-1 p-3 border-2 border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:border-purple-500 focus:outline-none resize-none"
                disabled={rendering}
              />
              {texts.length > 1 && (
                <button
                  type="button"
                  onClick={() => onTextsChange(texts.filter((_, j) => j !== i))}
                  className="px-3 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 rounded-xl hover:bg-red-100"
                  disabled={rendering}
                  title="Remover este texto"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
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
            disabled={rendering}
            className="flex-1 py-3 bg-purple-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-purple-700 disabled:opacity-50"
          >
            {rendering ? 'Gerando...' : 'Gerar com cortes pretos'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface RangeFieldProps {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  hint?: string;
  onChange: (next: number) => void;
}

function RangeField({
  label,
  value,
  unit,
  min,
  max,
  step = 1,
  disabled,
  hint,
  onChange,
}: RangeFieldProps) {
  return (
    <div>
      <label className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300 dark:text-gray-600">
        {label}:{' '}
        <span className="text-purple-700 dark:text-purple-300">
          {value}
          {unit}
        </span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="w-full accent-purple-600"
        disabled={disabled}
      />
      {hint && (
        <p className="text-[10px] text-gray-500 dark:text-gray-400 dark:text-gray-500 mt-1">
          {hint}
        </p>
      )}
    </div>
  );
}
