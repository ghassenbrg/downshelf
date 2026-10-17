# Changelog

## 1.0.0 — 2026-10-17

First release.

- Rules that match by website, URL path, file name or file type, with `*`, `?` and `,` (or)
  patterns, combined with "and".
- First-match-wins ordering with drag and keyboard reordering, specificity-aware placement of new
  rules, a "Sort by specificity" action and warnings for rules that can never match.
- Download tester with an explanation of which rule matched and why.
- Quick add (`*.pdf → Documents/PDF`), templates, and destination variables (`{domain}`, `{year}`, …).
- Toolbar popup with a pause switch, rules for the current site and recently sorted downloads.
- Export/import of rules (JSON or plain-text rule lists), starter rules and undo for destructive
  actions.
