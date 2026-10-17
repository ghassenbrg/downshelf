#!/usr/bin/env node
/**
 * Release gate: the tag must be exactly `v<version>`, package.json and the
 * manifest must agree, and CHANGELOG.md must have notes for the version.
 *
 *   npm run release:verify -- v1.2.3
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fail, packageVersion, readJson, root, sourceDir } from './lib/project.mjs';
import { changelogSection } from './release-notes.mjs';

const tag = process.argv[2];
if (!tag) fail('Usage: npm run release:verify -- vX.Y.Z');

const version = packageVersion();
const manifestVersion = readJson(resolve(sourceDir, 'manifest.json')).version;

if (tag !== `v${version}`) {
  fail(`Release tag ${tag} does not match package version ${version}; expected v${version}.`);
}
if (manifestVersion !== version) {
  fail(`extension/manifest.json is ${manifestVersion} but package.json is ${version}.`);
}
const changelog = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8');
if (!changelogSection(changelog, version)) {
  fail(`CHANGELOG.md has no "## ${version}" section. Add release notes before tagging.`);
}

console.log(`Release tag ${tag} matches package.json, manifest.json and CHANGELOG.md`);
