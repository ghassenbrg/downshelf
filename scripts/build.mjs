#!/usr/bin/env node
/**
 * Produces the unpacked production extension in dist/chrome/.
 *
 * Downshelf has no compile step, so the build is a clean copy of
 * extension/ without dotfiles. Keeping a separate output folder means the
 * package is always made from a known, validated tree.
 */
import { cpSync, rmSync } from 'node:fs';
import { basename, relative } from 'node:path';
import { buildDir, sourceDir } from './lib/project.mjs';

rmSync(buildDir, { recursive: true, force: true });
cpSync(sourceDir, buildDir, {
  recursive: true,
  filter: (source) => source === sourceDir || !basename(source).startsWith('.'),
});

console.log(`Built Chrome extension: ${relative(process.cwd(), buildDir) || buildDir}`);
