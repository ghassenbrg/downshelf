# Contributing to Downshelf

Thanks for helping improve Downshelf. By contributing, you agree that your
contributions are distributed under the [MIT License](LICENSE).

## Before you start

- Search existing issues and pull requests first.
- For security problems, follow [SECURITY.md](SECURITY.md) instead of opening
  a public issue.
- Downshelf stays small and dependency-free at runtime: plain ES modules, no
  framework, no bundler, no network access. Please keep it that way.

## Local workflow

1. Fork the repository and create a focused branch.
2. `npm ci`
3. Make the change. Behavior changes in `extension/lib/` need tests in `test/`.
4. `npm run validate` (lint, tests, build, build validation).
5. For UI work, `npm run preview` serves the pages with a mocked Chrome API
   at http://localhost:5179. For download behavior, load `dist/chrome/` in
   Chrome and run the relevant cases in [docs/MANUAL_TESTING.md](docs/MANUAL_TESTING.md).
6. Update `README.md`, `CHANGELOG.md` and the website when users are affected.
   If you change the UI, refresh the store images with `npm run store:assets`.

## Pull requests

Explain the problem, the approach and how you tested it. Keep pull requests
focused, with no unrelated formatting changes. Never commit `dist/`,
credentials or `.env` files.

## Permissions

Adding a Chrome permission affects the store review and users' trust. Discuss
it in an issue first. If it's agreed, update the justification in
[docs/CHROME_WEB_STORE_LISTING.md](docs/CHROME_WEB_STORE_LISTING.md),
[PRIVACY.md](PRIVACY.md), `website/privacy.html` and `ALLOWED_PERMISSIONS` in
`scripts/validate-chrome-build.mjs`.
