// Idioma da CASCA do app (botões, menus, mensagens do sistema) — NÃO a
// língua da copy gerada pela IA, que segue a VSL e tem seletor próprio.
// Context (não hook isolado tipo useDarkMode) de propósito: toda tela que
// renderiza texto precisa saber a língua atual e re-renderizar quando ela
// muda — diferente de dark mode, que é resolvido via classe CSS no <html>
// sem nenhum componente precisar de estado JS.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { pt } from './pt';
import { en } from './en';

export type Language = 'pt' | 'en';

const DICTS = { pt, en };
const STORAGE_KEY = 'metavise.language';

interface LanguageContextValue {
  language: Language;
  setLanguage: (l: Language) => void;
  t: typeof pt;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function getInitialLanguage(): Language {
  if (typeof window === 'undefined') return 'pt';
  return window.localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'pt';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getInitialLanguage);

  const setLanguage = useCallback((l: Language) => {
    setLanguageState(l);
    window.localStorage.setItem(STORAGE_KEY, l);
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({ language, setLanguage, t: DICTS[language] }),
    [language, setLanguage]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/** t = dicionário da língua atual (acesso tipado: t.auth.loginTitle, não
 *  string solta "auth.loginTitle" — autocomplete + erro de compilação se a
 *  chave não existir, em vez de bug silencioso em runtime). */
export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage() usado fora de <LanguageProvider>.');
  return ctx;
}
