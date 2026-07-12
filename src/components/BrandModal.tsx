import React, { useState } from 'react';
import { Building2 } from 'lucide-react';
import type { BrandProfile } from '../lib/brand';

// Modal reutilizável de cadastro/edição da marca (Dados da Empresa).
// Usado no onboarding, no topo de "Meus Projetos" e na produção (Remotion).
// `mandatory` esconde o botão Cancelar (gate). Hoje a marca é opcional, então
// normalmente vai com mandatory={false}.
export const BrandModal: React.FC<{
  initial: BrandProfile | null;
  mandatory?: boolean;
  onClose: () => void;
  onSave: (b: BrandProfile) => void;
}> = ({ initial, mandatory = false, onClose, onSave }) => {
  const [companyName, setCompanyName] = useState(initial?.companyName || '');
  const [accentColor, setAccentColor] = useState(initial?.accentColor || '#4f46e5');
  const [bgColor, setBgColor] = useState(initial?.bgColor || '#0f172a');
  const [logoUrl, setLogoUrl] = useState(initial?.logoUrl || '');
  const [storeUrl, setStoreUrl] = useState(initial?.storeUrl || '');
  const canSave = companyName.trim().length > 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-3xl p-6 shadow-2xl">
        <div className="flex items-center gap-2 mb-1">
          <Building2 className="w-5 h-5 text-indigo-600" />
          <h2 className="text-lg font-black text-gray-900 dark:text-gray-100">Dados da empresa</h2>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          {mandatory
            ? 'Precisamos da sua marca antes de gerar criativos. É rápido e fica salvo.'
            : 'Opcional — deixa seus criativos com a sua cara. Pode editar a qualquer momento.'}
        </p>

        <label className="block text-xs font-semibold text-gray-500 mb-1">Nome da empresa/app *</label>
        <input
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          className="w-full mb-3 rounded-xl border-2 border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 p-2.5 text-sm focus:outline-none focus:border-indigo-400"
          placeholder="VisualSpeak"
        />

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Cor de destaque</label>
            <input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="w-full h-10 rounded-lg cursor-pointer" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Cor de fundo</label>
            <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="w-full h-10 rounded-lg cursor-pointer" />
          </div>
        </div>

        <label className="block text-xs font-semibold text-gray-500 mb-1">Logo (URL — opcional)</label>
        <input
          value={logoUrl}
          onChange={(e) => setLogoUrl(e.target.value)}
          className="w-full mb-3 rounded-xl border-2 border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 p-2.5 text-sm focus:outline-none focus:border-indigo-400"
          placeholder="https://…/logo.png"
        />

        <label className="block text-xs font-semibold text-gray-500 mb-1">Link da loja (opcional)</label>
        <input
          value={storeUrl}
          onChange={(e) => setStoreUrl(e.target.value)}
          className="w-full mb-5 rounded-xl border-2 border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 p-2.5 text-sm focus:outline-none focus:border-indigo-400"
          placeholder="App Store / Play Store"
        />

        <div className="flex gap-2">
          {!mandatory && (
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl font-semibold border-2 border-gray-200 dark:border-gray-700">
              Cancelar
            </button>
          )}
          <button
            disabled={!canSave}
            onClick={() => onSave({ companyName: companyName.trim(), accentColor, bgColor, logoUrl, storeUrl })}
            className="flex-1 py-2.5 rounded-xl font-black text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40"
          >
            Salvar marca
          </button>
        </div>
      </div>
    </div>
  );
};
