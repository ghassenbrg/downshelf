#!/usr/bin/env node
/**
 * Prints the CHANGELOG.md section for a version, used as the GitHub Release
 * body.
 *
 *   node scripts/release-notes.mjs 1.2.3 > notes.md
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The body under `## <version>` (heading suffixes like dates are allowed). */
export function changelogSection(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const escaped = version.replace(/\./g, '\\.');
  const start = lines.findIndex((line) =>
    new RegExp(`^##\\s+\\[?v?${escaped}\\]?(\\s|$)`).test(line),
  );
  if (start === -1) return null;
  const end = lines.findIndex((line, i) => i > start && /^##\s/.test(line));
  const body = lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim();
  return body || null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(import.meta.dirname, '..');
  const version =
    process.argv[2]?.replace(/^v/, '') ??
    JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
  const notes = changelogSection(readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8'), version);
  if (!notes) {
    console.error(`No CHANGELOG.md section for ${version}`);
    process.exit(1);
  }
  console.log(notes);
}
