#!/usr/bin/env node
/**
 * Copies the package.json version into extension/manifest.json.
 * Runs automatically as npm's `version` lifecycle hook, so
 * `npm version patch|minor|major` keeps both files in step.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { packageVersion, sourceDir } from './lib/project.mjs';

const path = resolve(sourceDir, 'manifest.json');
const text = readFileSync(path, 'utf8');
const version = packageVersion();
const updated = text.replace(/("version":\s*")[^"]*(")/, `$1${version}$2`);
if (updated !== text) writeFileSync(path, updated);
console.log(`manifest.json version → ${version}`);
