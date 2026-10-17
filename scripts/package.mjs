#!/usr/bin/env node
/**
 * Zips the extension folder into dist/downshelf-<version>.zip, ready to
 * upload to the Chrome Web Store. Uses the system `zip` command.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}extension/manifest.json`, 'utf8'));
const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8'));

if (manifest.version !== pkg.version) {
  console.error(`Version mismatch: manifest ${manifest.version} vs package.json ${pkg.version}`);
  process.exit(1);
}

const out = `${root}dist/downshelf-${manifest.version}.zip`;
mkdirSync(`${root}dist`, { recursive: true });
rmSync(out, { force: true });
execFileSync('zip', ['-r', '-X', '-q', out, '.', '-x', '.*', '-x', '*/.*'], {
  cwd: `${root}extension`,
  stdio: 'inherit',
});
console.log(`Packaged ${out}`);
