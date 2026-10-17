#!/usr/bin/env node
/**
 * Zips dist/chrome/ into dist/packages/downshelf-chrome-vX.Y.Z.zip with
 * manifest.json at the ZIP root, as the Chrome Web Store requires.
 * Run `npm run pack:chrome`, which builds and validates first.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { relative } from 'node:path';
import { buildDir, fail, packagePath, packagesDir } from './lib/project.mjs';

if (!existsSync(buildDir)) fail('dist/chrome/ is missing. Run `npm run pack:chrome`.');

const output = packagePath();
mkdirSync(packagesDir, { recursive: true });
rmSync(output, { force: true });

// -X drops extra file attributes so the archive only depends on file contents.
execFileSync('zip', ['-r', '-X', '-q', '-9', output, '.'], { cwd: buildDir, stdio: 'inherit' });

const size = (statSync(output).size / 1024).toFixed(1);
console.log(`Packaged Chrome extension: ${relative(process.cwd(), output)} (${size} KB)`);
