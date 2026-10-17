import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { changelogSection } from '../scripts/release-notes.mjs';

const changelog = `# Changelog

## 1.1.0 — 2026-11-02

- New thing.

## [1.0.1]

- Fix.

## v1.0.0

- First.
`;

test('changelogSection finds a version heading in common formats', () => {
  assert.equal(changelogSection(changelog, '1.1.0'), '- New thing.');
  assert.equal(changelogSection(changelog, '1.0.1'), '- Fix.');
  assert.equal(changelogSection(changelog, '1.0.0'), '- First.');
});

test('changelogSection does not match a different version', () => {
  assert.equal(changelogSection(changelog, '1.1'), null);
  assert.equal(changelogSection(changelog, '2.0.0'), null);
});

test('the current version has release notes', () => {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const notes = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.ok(changelogSection(notes, version), `CHANGELOG.md needs a "## ${version}" section`);
});
