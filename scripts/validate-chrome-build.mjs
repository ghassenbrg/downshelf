#!/usr/bin/env node
/**
 * Validates dist/chrome/ before it is packaged or uploaded. Catches the
 * mistakes that make Chrome refuse to load an extension or that tend to fail
 * Chrome Web Store review: version drift, missing files, broken imports,
 * new permissions, remote code and leftover development files.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { buildDir, fail, packageVersion, readJson } from './lib/project.mjs';

/**
 * Permissions the store listing justifies (docs/CHROME_WEB_STORE_LISTING.md).
 * Adding one is a deliberate decision: update the listing's justifications,
 * the privacy policy and this list together.
 */
const ALLOWED_PERMISSIONS = ['activeTab', 'downloads', 'storage'];
const REQUIRED_FILES = [
  'manifest.json',
  'background.js',
  'options/options.html',
  'options/options.js',
  'popup/popup.html',
  'popup/popup.js',
  'icons/icon-16.png',
  'icons/icon-32.png',
  'icons/icon-48.png',
  'icons/icon-128.png',
];
const MAX_PACKAGE_BYTES = 2 * 1024 * 1024;

const errors = [];
const check = (condition, message) => {
  if (!condition) errors.push(message);
};

if (!existsSync(buildDir)) fail('dist/chrome/ is missing. Run `npm run build` first.');

const files = readdirSync(buildDir, { recursive: true })
  .map((file) => file.split('\\').join('/'))
  .filter((file) => statSync(resolve(buildDir, file)).isFile());
const has = (file) => files.includes(file);

// -- Manifest ---------------------------------------------------------------

const manifest = readJson(resolve(buildDir, 'manifest.json'));
const version = packageVersion();

check(manifest.manifest_version === 3, `Expected Manifest V3, got ${manifest.manifest_version}.`);
check(
  manifest.version === version,
  `manifest.json is ${manifest.version}, package.json is ${version}.`,
);
check(
  /^\d+(\.\d+){0,3}$/.test(manifest.version),
  `"${manifest.version}" is not a valid Chrome version.`,
);
check(manifest.name?.length <= 75, 'Extension name must be 75 characters or fewer.');
check(
  manifest.description?.length > 0 && manifest.description.length <= 132,
  `Description must be 1–132 characters for the Chrome Web Store (is ${manifest.description?.length ?? 0}).`,
);
check(
  Boolean(manifest.background?.service_worker),
  'Manifest must declare a background service worker.',
);
check(Boolean(manifest.action?.default_popup), 'Manifest must declare an action popup.');

for (const permission of manifest.permissions ?? []) {
  check(
    ALLOWED_PERMISSIONS.includes(permission),
    `New permission "${permission}". Justify it in docs/CHROME_WEB_STORE_LISTING.md and PRIVACY.md, then add it to ALLOWED_PERMISSIONS.`,
  );
}
check(
  !manifest.host_permissions?.length,
  'Host permissions are not expected; review the store justification first.',
);
check(
  !manifest.content_scripts?.length,
  'Content scripts are not expected; review the store justification first.',
);

const manifestFiles = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.options_ui?.page,
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
].filter(Boolean);
for (const file of [...new Set([...REQUIRED_FILES, ...manifestFiles])]) {
  check(has(file), `Missing file: ${file}`);
}

// -- Icons are real PNGs of the declared size --------------------------------

for (const [size, file] of Object.entries(manifest.icons ?? {})) {
  if (!has(file)) continue;
  const png = readFileSync(resolve(buildDir, file));
  const isPng = png.subarray(1, 4).toString('ascii') === 'PNG';
  check(isPng, `${file} is not a PNG.`);
  if (isPng) {
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    check(
      width === Number(size) && height === Number(size),
      `${file} is ${width}×${height}, expected ${size}×${size}.`,
    );
  }
}

// -- HTML and JS references resolve; no remote code --------------------------

for (const file of files.filter((f) => extname(f) === '.html')) {
  const html = readFileSync(resolve(buildDir, file), 'utf8');
  for (const [, ref] of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    if (/^https?:/.test(ref)) continue;
    check(existsSync(resolve(buildDir, dirname(file), ref)), `${file} references missing ${ref}`);
  }
  check(
    !/<script[^>]+src="https?:/i.test(html),
    `${file} loads a remote script; MV3 forbids remote code.`,
  );
  check(
    !/<script(?![^>]*\bsrc=)[^>]*>\s*\S/.test(html),
    `${file} has an inline <script>; MV3's CSP blocks it.`,
  );
}

for (const file of files.filter((f) => extname(f) === '.js')) {
  const source = readFileSync(resolve(buildDir, file), 'utf8');
  for (const [, ref] of source.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+'([^']+)'/g)) {
    if (!ref.startsWith('.')) {
      errors.push(
        `${file} imports "${ref}"; only relative imports work in an unbundled extension.`,
      );
      continue;
    }
    check(existsSync(resolve(buildDir, dirname(file), ref)), `${file} imports missing ${ref}`);
  }
  for (const [, ref] of source.matchAll(/import\(\s*'([^']+)'\s*\)/g)) {
    check(
      existsSync(resolve(buildDir, dirname(file), ref)),
      `${file} dynamically imports missing ${ref}`,
    );
  }
  check(
    !/\beval\(|\bnew Function\(/.test(source),
    `${file} uses eval/new Function, which MV3 forbids.`,
  );
  check(
    !/https?:\/\/[^'"`\s]+\.js\b/.test(source),
    `${file} appears to reference remote JavaScript.`,
  );
}

// -- Nothing that shouldn't ship -----------------------------------------------

for (const file of files) {
  check(!file.split('/').some((part) => part.startsWith('.')), `Hidden file in build: ${file}`);
  check(!/\.(map|test\.js|md|log)$/.test(file), `Development file in build: ${file}`);
  check(!/(^|\/)(dev|test|node_modules)\//.test(file), `Development folder in build: ${file}`);
}

const totalBytes = files.reduce((sum, file) => sum + statSync(resolve(buildDir, file)).size, 0);
check(
  totalBytes < MAX_PACKAGE_BYTES,
  `Build is ${(totalBytes / 1024).toFixed(0)} KB; expected under 2 MB.`,
);

if (errors.length) {
  console.error(`\n✖ Chrome build validation failed (${errors.length}):\n`);
  for (const error of errors) console.error(`  • ${error}`);
  console.error('');
  process.exit(1);
}

console.log(
  `Validated Chrome MV3 build ${manifest.version}: ${files.length} files, ${(totalBytes / 1024).toFixed(1)} KB (${relative(process.cwd(), buildDir)})`,
);
