import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { parseShorthand } from '../extension/lib/rules.js';

// A minimal fake of the chrome.* APIs the service worker touches.
const store = {};
let failReads = false;
const listeners = {};
const on = (name) => ({ addListener: (fn) => (listeners[name] = fn) });

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        if (failReads) throw new Error('storage unavailable');
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, store[k]]));
      },
      async set(items) {
        Object.assign(store, structuredClone(items));
      },
    },
    onChanged: on('storageChanged'),
  },
  downloads: { onDeterminingFilename: on('determine') },
  runtime: {
    onInstalled: on('installed'),
    onStartup: on('startup'),
    OnInstalledReason: { INSTALL: 'install' },
    openOptionsPage: () => {},
  },
  action: {
    setBadgeText: async () => {},
    setBadgeBackgroundColor: async () => {},
    setTitle: async () => {},
  },
};

await import('../extension/background.js');

/** Fires onDeterminingFilename and resolves with every suggest() call. */
function determine(item) {
  return new Promise((resolve) => {
    const calls = [];
    const returned = listeners.determine(item, (...args) => calls.push(args));
    assert.equal(returned, true, 'listener must return true to answer asynchronously');
    setTimeout(() => resolve(calls), 20);
  });
}

const rules = (...lines) => lines.map((line) => parseShorthand(line).rule);

describe('service worker', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    failReads = false;
  });

  test('suggests the routed path once', async () => {
    store.rules = rules('*.github.com → Development/GitHub');
    const calls = await determine({
      id: 1,
      url: 'https://github.com/org/app/archive.zip',
      filename: 'archive.zip',
    });
    assert.deepEqual(calls, [
      [{ filename: 'Development/GitHub/archive.zip', conflictAction: 'uniquify' }],
    ]);
  });

  test('records activity and per-rule stats', async () => {
    store.rules = rules('*.pdf → PDF');
    await determine({ id: 2, url: 'https://example.com/a.pdf', filename: 'a.pdf' });
    assert.equal(store.activity[0].folder, 'PDF');
    assert.equal(store.stats[store.rules[0].id].count, 1);
  });

  test('leaves unmatched downloads alone', async () => {
    store.rules = rules('*.pdf → PDF');
    assert.deepEqual(await determine({ id: 3, url: 'https://x.com/a.zip', filename: 'a.zip' }), [
      [],
    ]);
  });

  test('does nothing while paused', async () => {
    store.rules = rules('*.pdf → PDF');
    store.settings = { enabled: false };
    assert.deepEqual(await determine({ id: 4, url: 'https://x.com/a.pdf', filename: 'a.pdf' }), [
      [],
    ]);
  });

  test('uses the chosen conflict action', async () => {
    store.rules = rules('*.pdf → PDF');
    store.settings = { conflictAction: 'overwrite' };
    const [[suggestion]] = await determine({
      id: 5,
      url: 'https://x.com/a.pdf',
      filename: 'a.pdf',
    });
    assert.equal(suggestion.conflictAction, 'overwrite');
  });

  test('still answers when something goes wrong', async () => {
    failReads = true;
    const original = console.error;
    console.error = () => {};
    try {
      assert.deepEqual(await determine({ id: 6, url: 'https://x.com/a.pdf', filename: 'a.pdf' }), [
        [],
      ]);
    } finally {
      console.error = original;
    }
  });

  test('seeds starter rules on first install', async () => {
    await listeners.installed({ reason: 'install' });
    assert.ok(store.rules.length > 0);
  });
});
