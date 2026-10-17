#!/usr/bin/env node
/**
 * Serves the extension UI at http://localhost:5179 with a mocked chrome.*
 * API (dev/chrome-shim.js), for fast UI work without reloading the
 * extension. The real extension never loads the shim.
 *
 * Also used by `npm run store:assets` to render store screenshots.
 */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const extensionDir = join(root, 'extension');
const devDir = join(root, 'dev');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const SHIM = '<script type="module" src="/__dev/chrome-shim.js"></script>';

async function handle(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/') {
    res.writeHead(302, { location: '/options/options.html' });
    res.end();
    return;
  }
  // /__dev/* is served from dev/; it sits beside the extension's own folders so
  // that the shim's `../lib/…` imports resolve to the real extension code.
  const isDev = pathname.startsWith('/__dev/');
  const base = isDev ? devDir : extensionDir;
  const file = normalize(join(base, decodeURIComponent(isDev ? pathname.slice(6) : pathname)));
  if (!file.startsWith(base)) {
    res.writeHead(403).end();
    return;
  }
  try {
    let body = await readFile(file);
    if (extname(file) === '.html' && !isDev) {
      body = body.toString().replace('<head>', `<head>\n    ${SHIM}`);
    }
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

export function startPreview(port = Number(process.env.PORT) || 5179) {
  return new Promise((resolvePromise) => {
    const server = createServer(handle).listen(port, () => resolvePromise(server));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startPreview();
  const { port } = server.address();
  console.log(`Downshelf preview: http://localhost:${port}/options/options.html`);
  console.log(`Popup preview:     http://localhost:${port}/popup/popup.html`);
}
