import type { pt } from './pt';

// Tipado contra `typeof pt` — TypeScript acusa erro se faltar (ou sobrar)
// uma chave aqui em relação ao dicionário-fonte. Mantém as duas línguas
// sempre em sincronia conforme novas telas forem traduzidas.
export const en: typeof pt = {
  auth: {
    loginTitle: 'Sign in to your account',
    signupTitle: 'Create your free account',
    emailLabel: 'Email',
    emailPlaceholder: 'you@email.com',
    passwordLabel: 'Password',
    enterButton: 'Sign in',
    signupButton: 'Sign up',
    orContinueWith: 'Or continue with',
    noAccount: "Don't have an account?",
    hasAccount: 'Already have an account?',
    signupLink: 'Sign up',
    loginLink: 'Log in',
  },
  header: {
    shortcutsTitle: 'Keyboard shortcuts (?)',
    shortcutsLabel: 'Keyboard shortcuts',
    achievements: 'Achievements',
    settings: 'Settings',
    criativos: 'Creatives (library of ready videos)',
    performance: 'Performance (Meta Ads)',
    logout: 'Log out',
  },
};
