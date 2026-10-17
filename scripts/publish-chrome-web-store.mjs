#!/usr/bin/env node
/**
 * Uploads a packaged ZIP to an existing Chrome Web Store item and submits
 * it for review, using the Chrome Web Store API v2.
 *
 *   npm run publish:chrome -- [zip] [--dry-run] [--upload-only] [--staged]
 *
 *   --dry-run      check credentials and print the item's current status
 *   --upload-only  upload the package but don't submit it for review
 *   --staged       submit for review, then wait for you to press Publish in
 *                  the dashboard after approval (STAGED_PUBLISH)
 *
 * Credentials come from the environment (GitHub Actions secrets/variables):
 *   CHROME_WEB_STORE_CLIENT_ID, CHROME_WEB_STORE_CLIENT_SECRET,
 *   CHROME_WEB_STORE_REFRESH_TOKEN, CHROME_WEB_STORE_PUBLISHER_ID,
 *   CHROME_WEB_STORE_EXTENSION_ID
 *
 * See HOWTO.md for creating them. Nothing secret is ever printed.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fail, packagePath, packageVersion } from './lib/project.mjs';

const API = 'https://chromewebstore.googleapis.com';
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const zip = resolve(args.find((a) => !a.startsWith('--')) ?? packagePath());
const publishType =
  flags.has('--staged') || process.env.CHROME_WEB_STORE_PUBLISH_TYPE === 'staged'
    ? 'STAGED_PUBLISH'
    : 'DEFAULT_PUBLISH';

const env = (name) => {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} is not set. See HOWTO.md → "Configure GitHub Actions".`);
  return value;
};

const config = {
  clientId: env('CHROME_WEB_STORE_CLIENT_ID'),
  clientSecret: env('CHROME_WEB_STORE_CLIENT_SECRET'),
  refreshToken: env('CHROME_WEB_STORE_REFRESH_TOKEN'),
  publisherId: env('CHROME_WEB_STORE_PUBLISHER_ID'),
  itemId: env('CHROME_WEB_STORE_EXTENSION_ID'),
};
const itemName = `publishers/${config.publisherId}/items/${config.itemId}`;

async function request(label, url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    const detail = body.error?.message ?? body.error_description ?? body.error ?? text;
    fail(
      `${label} failed (HTTP ${response.status}): ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`,
    );
  }
  return body;
}

async function accessToken() {
  const body = await request('OAuth token exchange', 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!body.access_token) fail('OAuth token exchange returned no access token.');
  return body.access_token;
}

function describeStatus(status) {
  const revision = (r) =>
    r
      ? `${r.state ?? 'unknown'}${r.distributionChannels?.length ? ` (${r.distributionChannels.map((c) => `v${c.crxVersion} @ ${c.deployPercentage ?? 100}%`).join(', ')})` : ''}`
      : 'none';
  return [
    `  item:       ${status.itemId ?? config.itemId}`,
    `  published:  ${revision(status.publishedItemRevisionStatus)}`,
    `  submitted:  ${revision(status.submittedItemRevisionStatus)}`,
    `  last upload: ${status.lastAsyncUploadState ?? 'n/a'}`,
    status.takenDown ? '  ⚠ item is taken down' : null,
    status.warned ? '  ⚠ item has a policy warning' : null,
  ]
    .filter(Boolean)
    .join('\n');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const token = await accessToken();
  const auth = { authorization: `Bearer ${token}` };
  const fetchStatus = () =>
    request('Fetch item status', `${API}/v2/${itemName}:fetchStatus`, { headers: auth });

  if (flags.has('--dry-run')) {
    console.log('Credentials OK. Current Chrome Web Store status:');
    console.log(describeStatus(await fetchStatus()));
    return;
  }

  const expectedVersion = packageVersion();
  let packageBytes;
  try {
    packageBytes = readFileSync(zip);
  } catch {
    fail(`Package not found: ${zip}. Run \`npm run pack:chrome\` first.`);
  }

  console.log(`Uploading ${zip} (${(packageBytes.length / 1024).toFixed(1)} KB)…`);
  const upload = await request('Upload', `${API}/upload/v2/${itemName}:upload`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/zip' },
    body: packageBytes,
  });

  let state = upload.uploadState;
  let crxVersion = upload.crxVersion;
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (state === 'IN_PROGRESS' || state === 'UPLOAD_IN_PROGRESS') {
    if (Date.now() > deadline)
      fail('Upload is still processing after 5 minutes. Check the dashboard.');
    console.log('  upload processing…');
    await sleep(POLL_INTERVAL_MS);
    const status = await fetchStatus();
    state = status.lastAsyncUploadState;
    crxVersion =
      status.submittedItemRevisionStatus?.distributionChannels?.[0]?.crxVersion ?? crxVersion;
  }
  if (state !== 'SUCCEEDED') {
    fail(
      `Upload finished in state ${state}. The dashboard shows the reason (often: version not increased).`,
    );
  }
  if (crxVersion && crxVersion !== expectedVersion) {
    fail(`The store received version ${crxVersion}, but this release is ${expectedVersion}.`);
  }
  console.log(`✔ Uploaded version ${crxVersion ?? expectedVersion}`);

  if (flags.has('--upload-only')) {
    console.log('Skipping submission (--upload-only). Submit it from the Developer Dashboard.');
    return;
  }

  const published = await request('Submit for review', `${API}/v2/${itemName}:publish`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ publishType }),
  });
  console.log(`✔ Submitted for review (${publishType}); state: ${published.state ?? 'unknown'}`);
  if (published.warningInfo) console.log(`  warnings: ${JSON.stringify(published.warningInfo)}`);
  if (publishType === 'STAGED_PUBLISH') {
    console.log('  After approval, press "Publish" in the Developer Dashboard to go live.');
  }
  console.log(describeStatus(await fetchStatus()));
}

main().catch((error) => fail(error.message));
