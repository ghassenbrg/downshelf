#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
/**
 * Serves the extension UI at http://localhost:5179 with a mocked chrome.*
 * API (dev/chrome-shim.js), for fast UI work without reloading the
 * extension. The real extension never loads the shim.
 */
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const extensionDir = join(root, 'extension');
const devDir = join(root, 'dev');
const port = Number(process.env.PORT) || 5179;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const SHIM = '<script type="module" src="/__dev/chrome-shim.js"></script>';

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/') {
    res.writeHead(302, { location: '/options/options.html' });
    res.end();
    return;
  }
  // The shim imports ../lib/…, so serve it from a path inside the extension tree.
  const isShim = pathname.endsWith('/__dev/chrome-shim.js');
  const base = isShim ? devDir : extensionDir;
  const file = isShim
    ? join(devDir, 'chrome-shim.js')
    : normalize(join(base, decodeURIComponent(pathname)));
  if (!file.startsWith(base)) {
    res.writeHead(403).end();
    return;
  }
  try {
    let body = await readFile(file);
    if (extname(file) === '.html') {
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
}).listen(port, () => {
  console.log(`Downshelf preview: http://localhost:${port}/options/options.html`);
  console.log(`Popup preview:     http://localhost:${port}/popup/popup.html`);
});
