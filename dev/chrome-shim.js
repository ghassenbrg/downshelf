/**
 * Development-only stand-in for the chrome.* APIs the UI uses, so the
 * options page and popup can be previewed in a normal browser tab
 * (`npm run preview`). Data lives in localStorage. Never shipped.
 */
import { starterRules } from '../lib/defaults.js';

if (!globalThis.chrome?.storage) {
  const KEY = 'downshelf-dev-storage';
  const read = () => JSON.parse(localStorage.getItem(KEY) || '{}');
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
      localStorage.setItem(KEY, JSON.stringify(all));
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

  const all = read();
  if (!all.rules) {
    const rules = starterRules();
    const now = Date.now();
    const docs = rules.find((r) => r.name === 'Documents');
    const images = rules.find((r) => r.name === 'Images');
    await local.set({
      rules,
      stats: {
        [docs.id]: { count: 14, last: now - 1000 * 60 * 7 },
        [images.id]: { count: 3, last: now - 1000 * 60 * 60 * 26 },
      },
      activity: [
        {
          at: now - 1000 * 60 * 7,
          filename: 'Q3-report.pdf',
          folder: 'Documents',
          ruleId: docs.id,
          ruleTitle: 'Documents',
          host: 'example.com',
        },
        {
          at: now - 1000 * 60 * 60 * 26,
          filename: 'IMG_2041.heic',
          folder: 'Images',
          ruleId: images.id,
          ruleTitle: 'Images',
          host: 'photos.example.com',
        },
      ],
    });
  }
}
