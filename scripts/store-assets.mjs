#!/usr/bin/env node
/**
 * Renders the Chrome Web Store images with headless Chrome:
 *
 *   docs/chrome-web-store/screenshot-*.png   1280×800 screenshots
 *   docs/chrome-web-store/small-promo-440x280.png
 *   docs/chrome-web-store/marquee-1400x560.png
 *
 * Screenshots show the real extension UI (served by the preview server with
 * deterministic demo data from dev/shots.js). They are also copied to
 * website/assets/screenshots/.
 *
 *   npm run store:assets          (set CHROME_PATH if Chrome isn't found)
 */
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fail, root } from './lib/project.mjs';
import { startPreview } from './preview.mjs';

const OUT = resolve(root, 'docs', 'chrome-web-store');
const SITE = resolve(root, 'website', 'assets', 'screenshots');

const ASSETS = [
  {
    file: 'screenshot-1-rules.png',
    path: '/options/options.html?shot=rules',
    size: [1280, 800],
    site: true,
  },
  {
    file: 'screenshot-2-editor.png',
    path: '/options/options.html?shot=editor',
    size: [1280, 800],
    site: true,
  },
  {
    file: 'screenshot-3-popup.png',
    path: '/__dev/store/popup.html',
    size: [1280, 800],
    site: true,
  },
  {
    file: 'screenshot-4-order-dark.png',
    path: '/options/options.html?shot=order',
    size: [1280, 800],
    dark: true,
    site: true,
  },
  { file: 'small-promo-440x280.png', path: '/__dev/store/promo-small.html', size: [440, 280] },
  { file: 'marquee-1400x560.png', path: '/__dev/store/marquee.html', size: [1400, 560] },
];

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  return candidates.find((path) => existsSync(path)) ?? fail('Chrome not found. Set CHROME_PATH.');
}

function pngSize(path) {
  const png = readFileSync(path);
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

const run = promisify(execFile);
const chrome = findChrome();
const server = await startPreview(0);
const { port } = server.address();
const profile = mkdtempSync(join(tmpdir(), 'downshelf-shots-'));
mkdirSync(OUT, { recursive: true });
mkdirSync(SITE, { recursive: true });

try {
  for (const asset of ASSETS) {
    const out = resolve(OUT, asset.file);
    const [width, height] = asset.size;
    // Async on purpose: the preview server runs in this process and must keep
    // answering Chrome's requests while the screenshot is taken.
    await run(
      chrome,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${profile}`,
        '--force-device-scale-factor=1',
        `--window-size=${width},${height}`,
        '--virtual-time-budget=6000',
        // Pin the colour scheme so the OS appearance doesn't leak into the images.
        asset.dark ? '--force-dark-mode' : '--blink-settings=preferredColorScheme=1',
        `--screenshot=${out}`,
        `http://localhost:${port}${asset.path}`,
      ],
      { timeout: 60_000 },
    );
    const [w, h] = pngSize(out);
    if (w !== width || h !== height)
      fail(`${asset.file} is ${w}×${h}, expected ${width}×${height}.`);
    if (asset.site) copyFileSync(out, resolve(SITE, asset.file));
    console.log(`✔ ${asset.file} (${w}×${h})`);
  }
} finally {
  server.closeAllConnections();
  server.close();
  rmSync(profile, { recursive: true, force: true });
}
