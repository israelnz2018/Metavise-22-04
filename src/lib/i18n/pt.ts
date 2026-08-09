// Dicionário-fonte (português) — define a FORMA do dicionário. en.ts é
// tipado contra `typeof pt`, então esquecer uma chave na tradução em
// inglês vira erro de TypeScript, não bug silencioso em produção.
//
// Organizado por tela/área, não um arquivo único gigante de milhares de
// linhas — cada fase da tradução (ver plano) adiciona um namespace novo
// aqui + o equivalente em en.ts.
export const pt = {
  auth: {
    loginTitle: 'Entre na sua conta',
    signupTitle: 'Crie sua conta gratuita',
    emailLabel: 'E-mail',
    emailPlaceholder: 'seu@email.com',
    passwordLabel: 'Senha',
    enterButton: 'Entrar',
    signupButton: 'Cadastrar',
    orContinueWith: 'Ou continue com',
    noAccount: 'Não tem uma conta?',
    hasAccount: 'Já tem uma conta?',
    signupLink: 'Cadastre-se',
    loginLink: 'Faça Login',
  },
  header: {
    shortcutsTitle: 'Atalhos de teclado (?)',
    shortcutsLabel: 'Atalhos de teclado',
    achievements: 'Conquistas',
    settings: 'Configurações',
    criativos: 'Criativos (biblioteca de vídeos prontos)',
    performance: 'Performance (Meta Ads)',
    logout: 'Sair',
  },
};
