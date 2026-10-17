# Manual testing

Automated tests cover the rule engine and the service worker with a mocked
Chrome API. Before each release, check the real thing in Chrome. It takes
about ten minutes.

Use a separate Chrome profile so your own rules aren't affected. Build with
`npm run pack:chrome`, open `chrome://extensions`, enable Developer mode and
**Load unpacked** → `dist/chrome/`.

## Install and first run

- [ ] Installing opens the settings page with the welcome banner and starter rules.
- [ ] No errors on the extension's card in `chrome://extensions` (also open
      **Inspect views: service worker** and check the console).
- [ ] The toolbar icon is crisp; the popup opens and shows "Sorting on".

## Routing real downloads

- [ ] Download a PDF from any site → it lands in `Downloads/Documents/`.
- [ ] Download an image (right-click → Save image as… is fine) → `Downloads/Images/`.
- [ ] Add `*.github.com → Test/GitHub`, download a release asset from GitHub
      (served from `objects.githubusercontent.com`) → `Downloads/Test/GitHub/`,
      matched via the page you downloaded from.
- [ ] Add `labs.google → AI/Flow` and download something from Google Flow →
      `Downloads/AI/Flow/`.
- [ ] Download the same file twice with "Keep both" → the second copy is
      numbered. Switch to "Replace" → it overwrites. Switch to "Ask me" → the
      Save dialog opens in the right folder.
- [ ] Pause sorting from the popup → the badge shows "off" and downloads go
      to the top of Downloads. Resume → sorting works again.
- [ ] The popup's **Recently sorted** list and the rule's "N files" counter update.

## Rules UI

- [ ] Quick add with `->` creates a rule and the toast explains where it was placed.
- [ ] The editor auto-detects the condition type, shows errors on bad input,
      and blocks absolute paths like `/Users/me/x` with an explanation.
- [ ] Drag-and-drop and ↑/↓ on the handle reorder rules; the order survives a reload.
- [ ] A broad rule above a specific one shows "Never used … Move above it",
      and the button fixes it.
- [ ] Test a download explains the match, including "via the page you
      downloaded from" when you fill in the referrer.
- [ ] Delete → Undo restores the rule.
- [ ] Export, Reset to starter rules, then Import the export → rules are back.
- [ ] The popup's "New rule for <site>" opens the editor pre-filled.
- [ ] Light and dark mode both look right (switch the OS appearance).

## Upgrade path

- [ ] Load the previous release's ZIP (unzipped) as an unpacked extension
      and save a few rules. Replace that folder's contents with the new
      `dist/chrome/` files and click the reload icon on the extension card.
      Rules, settings and history are kept. (Removing an extension deletes its
      data, so reload instead of reinstalling.)
