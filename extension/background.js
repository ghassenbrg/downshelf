/**
 * Service worker: decides the folder for every download.
 *
 * Chrome lets an extension suggest a path *relative to the user's download
 * folder* from onDeterminingFilename. That's the only supported way to pick a
 * destination, so Downshelf never tries to write anywhere else.
 */
import { starterRules } from './lib/defaults.js';
import { createContext, route, ruleTitle } from './lib/rules.js';
import { loadState, onStateChange, recordRouting, saveRules } from './lib/storage.js';

async function decide(item) {
  const { settings, rules } = await loadState();
  if (!settings.enabled || rules.length === 0) return null;

  const ctx = createContext(item);
  const result = route(rules, ctx);
  if (!result.rule) return null;

  recordRouting({
    id: item.id,
    at: Date.now(),
    filename: ctx.filename,
    folder: result.folder,
    ruleId: result.rule.id,
    ruleTitle: ruleTitle(result.rule),
    host: result.source?.host ?? ctx.sources[0]?.host ?? '',
  });

  // A rule with no folder means "leave it at the top of Downloads".
  if (!result.folder) return null;
  return { filename: result.path, conflictAction: settings.conflictAction };
}

// Registered synchronously at the top level so Chrome wakes the worker for it.
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  let answered = false;
  const answer = (suggestion) => {
    if (answered) return;
    answered = true;
    if (suggestion) suggest(suggestion);
    else suggest();
  };
  decide(item)
    .then(answer, (error) => {
      console.error('Downshelf: could not route download', error);
      answer(null);
    })
    // Never leave a download waiting on us.
    .finally(() => answer(null));
  return true; // we answer asynchronously
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== chrome.runtime.OnInstalledReason.INSTALL) return;
  const { rules } = await loadState();
  if (rules.length === 0) await saveRules(starterRules());
  chrome.runtime.openOptionsPage();
});

async function updateBadge() {
  const { settings } = await loadState();
  await chrome.action.setBadgeBackgroundColor({ color: '#6b7280' });
  await chrome.action.setBadgeText({ text: settings.enabled ? '' : 'off' });
  await chrome.action.setTitle({
    title: settings.enabled ? 'Downshelf' : 'Downshelf (paused)',
  });
}

onStateChange((changes) => {
  if (changes.settings) updateBadge();
});
chrome.runtime.onStartup.addListener(updateBadge);
updateBadge();
