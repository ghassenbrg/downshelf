#!/usr/bin/env node
/**
 * Checks the GitHub Pages site in website/: every page has the meta tags a
 * public page needs, and every local link or image exists. The privacy page
 * is required for the Chrome Web Store listing.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fail, root } from './lib/project.mjs';

const siteDir = resolve(root, 'website');
const pages = readdirSync(siteDir).filter((file) => file.endsWith('.html'));
const errors = [];

for (const required of ['index.html', 'privacy.html']) {
  if (!pages.includes(required)) errors.push(`website/${required} is missing.`);
}

for (const page of pages) {
  const path = resolve(siteDir, page);
  const html = readFileSync(path, 'utf8');
  if (!/<meta name="viewport"/.test(html)) errors.push(`${page}: missing viewport meta tag`);
  if (!/<meta name="description" content="[^"]{20,}"/.test(html))
    errors.push(`${page}: missing description`);
  if (!/<title>[^<]+<\/title>/.test(html)) errors.push(`${page}: missing <title>`);

  for (const [, ref] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (/^(?:https?:|mailto:|#)/.test(ref)) continue;
    const local = resolve(dirname(path), ref.split('#')[0]);
    if (!local.startsWith(`${siteDir}/`)) errors.push(`${page}: ${ref} points outside website/`);
    else if (!existsSync(local)) errors.push(`${page}: ${ref} does not exist`);
  }
  // In-site anchors (guide.html#install, #features) must point at a real id.
  for (const [, target, id] of html.matchAll(/href="([a-z-]+\.html)?#([\w-]+)"/g)) {
    const targetPath = target ? resolve(siteDir, target) : path;
    if (existsSync(targetPath) && !readFileSync(targetPath, 'utf8').includes(`id="${id}"`)) {
      errors.push(`${page}: anchor ${target ?? ''}#${id} has no matching id`);
    }
  }
}

if (errors.length) fail(`Website validation failed:\n  • ${errors.join('\n  • ')}`);
console.log(`Validated ${pages.length} website pages and their local assets`);
