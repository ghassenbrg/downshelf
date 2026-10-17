/** Paths and helpers shared by the build and release scripts. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const root = resolve(import.meta.dirname, '..', '..');
export const sourceDir = resolve(root, 'extension');
export const distDir = resolve(root, 'dist');
export const buildDir = resolve(distDir, 'chrome');
export const packagesDir = resolve(distDir, 'packages');

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function packageVersion() {
  return readJson(resolve(root, 'package.json')).version;
}

export function packagePath(version = packageVersion()) {
  return resolve(packagesDir, `downshelf-chrome-v${version}.zip`);
}

/** Prints a message and exits with a failure code. */
export function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}
