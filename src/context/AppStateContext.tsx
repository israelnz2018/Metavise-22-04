// AppStateContext — foundation for breaking up App.tsx into per-tab
// components without prop-drilling 50+ state vars.
//
// Usage pattern (when an extracted tab needs project state):
//
//   // In App.tsx (provider side):
//   <AppStateProvider value={{ config, setConfig, currentProjectId, ... }}>
//     <YourTabComponent />
//   </AppStateProvider>
//
//   // In YourTabComponent.tsx (consumer):
//   const { config, setConfig } = useAppState();
//
// Migrating one render*Step at a time:
// 1. Identify all `config.X`, `setConfig`, `handle*Project` references
//    in the render function — those become Context consumers.
// 2. Identify pure UI state local to the tab (modals, form inputs) —
//    those stay as local useState in the new component.
// 3. Move the JSX into a new file, swap state refs to `useAppState()`,
//    re-render via the existing `{currentStep === 'X' && <NewTab />}`.
// 4. Repeat per tab. App.tsx shrinks ~1-2k lines each iteration.

import { createContext, useContext } from 'react';

// Intentionally typed `any` for the project config: AdConfig is defined
// inline in App.tsx and not exportable today. Once App.tsx finishes
// decomposing, AdConfig moves into src/types/project.ts and this
// becomes properly typed.
export interface AppState {
  // Core project data
  config: any;
  setConfig: React.Dispatch<React.SetStateAction<any>>;
  currentProjectId: string | null;
  user: any;

  // Project-level operations
  handleSaveProject: (override?: any) => Promise<void> | void;

  // Step navigation
  currentStep: string;
  setCurrentStep: (step: any) => void;

  // Common loading / UI states
  loading: boolean;
  setLoading: (v: boolean) => void;
}

export const AppStateContext = createContext<AppState | null>(null);

export function useAppState(): AppState {
  const ctx = useContext(AppStateContext);
  if (!ctx) {
    throw new Error('useAppState must be used inside <AppStateProvider>');
  }
  return ctx;
}

export const AppStateProvider = AppStateContext.Provider;
