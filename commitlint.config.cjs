// Conventional commits config — enforces messages like:
//
//   feat: add dark mode toggle
//   fix(avatar): handle missing preview_image_url
//   refactor: lift useZapState out of App.tsx
//   docs: explain webhook setup in README
//   chore(deps): bump firebase-admin to 10.3.0
//
// Run via husky commit-msg hook (see .husky/commit-msg). To bypass for
// a special one-off commit, use `git commit --no-verify`.
//
// Why bother: searchable history (`git log --grep="^feat"`), drives
// changelogs cleanly, and forces the diff into a one-line summary
// before you commit — small forcing function that prevents lazy
// "WIP" / "stuff" messages.

module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Headers can be a bit longer than the default (72) because we use
    // very descriptive task IDs like "S. Cache backend dos catálogos…"
    'header-max-length': [2, 'always', 100],
    // Keep the body line length generous so existing detailed commit
    // explanations (the ones the Co-Authored-By trailer needs space for)
    // don't trip the linter.
    'body-max-line-length': [2, 'always', 200],
    'footer-max-line-length': [2, 'always', 200],
    // Allow uppercase first letter in subject — `S. Cache…` etc.
    'subject-case': [0],
  },
};
