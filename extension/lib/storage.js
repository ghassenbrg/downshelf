/**
 * Thin wrapper around chrome.storage.local. Everything Downshelf stores
 * lives on this device; nothing is sent anywhere.
 *
 *   settings  { enabled, conflictAction, welcomeDismissed }
 *   rules     Rule[] in priority order
 *   stats     { [ruleId]: { count, last } }
 *   activity  most recent routed downloads, newest first
 */
import { DEFAULT_SETTINGS } from './defaults.js';

const ACTIVITY_LIMIT = 30;
const area = () => chrome.storage.local;

export async function loadState() {
  const data = await area().get(['settings', 'rules', 'stats']);
  return {
    settings: { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) },
    rules: Array.isArray(data.rules) ? data.rules : [],
    stats: data.stats ?? {},
  };
}

export async function saveRules(rules) {
  await area().set({ rules });
}

export async function saveSettings(patch) {
  const { settings } = await loadState();
  const next = { ...settings, ...patch };
  await area().set({ settings: next });
  return next;
}

export async function loadActivity() {
  const { activity } = await area().get('activity');
  return Array.isArray(activity) ? activity : [];
}

export async function clearActivity() {
  await area().set({ activity: [], stats: {} });
}

let queue = Promise.resolve();

/** Records a routed download. Writes are serialised so concurrent downloads don't race. */
export function recordRouting(entry) {
  queue = queue
    .then(async () => {
      const { stats = {}, activity = [] } = await area().get(['stats', 'activity']);
      if (entry.ruleId) {
        const prev = stats[entry.ruleId] ?? { count: 0 };
        stats[entry.ruleId] = { count: prev.count + 1, last: entry.at };
      }
      await area().set({ stats, activity: [entry, ...activity].slice(0, ACTIVITY_LIMIT) });
    })
    .catch((error) => console.error('Downshelf: could not record activity', error));
  return queue;
}

/** Calls `callback(changes)` when any Downshelf key changes. Returns an unsubscribe function. */
export function onStateChange(callback) {
  const listener = (changes, areaName) => {
    if (areaName === 'local') callback(changes);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
