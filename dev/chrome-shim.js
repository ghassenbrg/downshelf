/**
 * Development-only stand-in for the chrome.* APIs the UI uses, so the
 * options page and popup can be previewed in a normal browser tab
 * (`npm run preview`). Data lives in localStorage. Never shipped.
 *
 * Seeding is synchronous on purpose: the page's own module runs as soon as
 * this one finishes, so the demo data must already be in place.
 */
import { demoState, runShot } from './shots.js';

if (!globalThis.chrome?.storage) {
  const KEY = 'downshelf-dev-storage';
  const params = new URLSearchParams(location.search);
  // Screenshot scenarios (?shot=…) use a throwaway in-memory store.
  const shot = params.get('shot');
  let memory = shot ? demoState(shot) : {};
  const read = () => (shot ? memory : JSON.parse(localStorage.getItem(KEY) || '{}'));
  const write = (all) => {
    if (shot) memory = all;
    else localStorage.setItem(KEY, JSON.stringify(all));
  };
  const listeners = new Set();
  const emit = (changes) => {
    for (const listener of listeners) listener(changes, 'local');
  };

  const local = {
    async get(keys) {
      const all = read();
      if (keys == null) return all;
      const list = Array.isArray(keys)
        ? keys
        : typeof keys === 'string'
          ? [keys]
          : Object.keys(keys);
      return Object.fromEntries(
        list.filter((k) => k in all).map((k) => [k, structuredClone(all[k])]),
      );
    },
    async set(items) {
      const all = read();
      const changes = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { oldValue: all[key], newValue: structuredClone(value) };
        all[key] = value;
      }
      write(all);
      queueMicrotask(() => emit(changes));
    },
  };

  // Keep two preview tabs (e.g. popup + options) in sync.
  window.addEventListener('storage', (event) => {
    if (event.key !== KEY) return;
    const before = JSON.parse(event.oldValue || '{}');
    const after = JSON.parse(event.newValue || '{}');
    const changes = {};
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        changes[key] = { oldValue: before[key], newValue: after[key] };
      }
    }
    emit(changes);
  });

  globalThis.chrome = {
    storage: {
      local,
      onChanged: {
        addListener: (fn) => listeners.add(fn),
        removeListener: (fn) => listeners.delete(fn),
      },
    },
    runtime: {
      getURL: (path) => `/${path}`,
      openOptionsPage: () => window.open('/options/options.html', '_blank'),
    },
    tabs: {
      query: async () => [{ id: 1, url: 'https://github.com/anthropics/claude-code/releases' }],
      create: async ({ url }) => window.open(url, '_blank'),
    },
  };

  if (shot) runShot(shot);
  else if (!read().rules) write(demoState('default'));
}
