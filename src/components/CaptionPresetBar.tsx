import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { Save, Trash2, BookmarkPlus, RefreshCw, Pencil } from 'lucide-react';
import { useCaptionPresets } from '@/hooks/useCaptionPresets';

interface Props {
  /** Valores atuais da etapa 4 (o que será salvo no preset). */
  current: Record<string, any>;
  /** Aplica um preset salvo (chama os setters). */
  onApply: (settings: Record<string, any>) => void;
}

// Barra de presets de legenda: salvar os ajustes atuais com um nome + escolher
// um salvo pra reaplicar os valores.
export function CaptionPresetBar({ current, onApply }: Props) {
  const { presets, save, remove, update, rename } = useCaptionPresets();
  const [selected, setSelected] = useState('');
  const selectedPreset = presets.find((p) => p.id === selected);

  const onSave = () => {
    const name = window.prompt('Nome do preset de legenda (ex.: "VSL verde", "Anúncio branco"):');
    if (!name || !name.trim()) return;
    save(name, current);
    toast.success(`Preset "${name.trim()}" salvo.`);
  };

  const onSelect = (id: string) => {
    setSelected(id);
    const p = presets.find((x) => x.id === id);
    if (p) {
      onApply(p.settings);
      toast.success(`Preset "${p.name}" aplicado.`);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 p-3 rounded-2xl bg-blue-50/60 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900">
      <BookmarkPlus size={15} className="text-blue-600 dark:text-blue-400" />
      <span className="text-[11px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300">
        Presets de legenda
      </span>
      <select
        value={selected}
        onChange={(e) => onSelect(e.target.value)}
        className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100"
      >
        <option value="">
          {presets.length ? 'Escolher preset…' : 'Nenhum salvo ainda'}
        </option>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {selectedPreset && (
        <>
          <button
            onClick={() => {
              update(selected, current);
              toast.success(`Preset "${selectedPreset.name}" atualizado com os valores atuais.`);
            }}
            className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-blue-400"
            title="Sobrescreve este preset com os ajustes atuais"
          >
            <RefreshCw size={11} /> Atualizar
          </button>
          <button
            onClick={() => {
              const name = window.prompt('Novo nome do preset:', selectedPreset.name);
              if (name && name.trim()) {
                rename(selected, name);
                toast.success('Preset renomeado.');
              }
            }}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            title="Renomear preset"
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={() => {
              remove(selected);
              setSelected('');
              toast.success('Preset removido.');
            }}
            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500"
            title="Remover preset selecionado"
          >
            <Trash2 size={14} />
          </button>
        </>
      )}
      <button
        onClick={onSave}
        className="ml-auto inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
      >
        <Save size={12} /> Salvar novo
      </button>
    </div>
  );
}
