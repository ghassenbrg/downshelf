# Releasing Downshelf

The release runbook. Do the one-time setup in [HOWTO.md](../HOWTO.md) first.

## Release model

Downshelf uses [Semantic Versioning](https://semver.org/):

- **Patch** (`1.0.1`): bug fixes.
- **Minor** (`1.1.0`): new features that keep existing rules working.
- **Major** (`2.0.0`): changes that break saved rules, backups or behavior.

`package.json` and `extension/manifest.json` always carry the same version.
A release tag is exactly `v` plus that version. The release workflow refuses
anything else, and the Chrome Web Store refuses a version it has already seen.

## Pipelines

| Workflow | Trigger | What it does |
| --- | --- | --- |
| **Validate extension** (`ci.yml`) | push / PR to `main` | lint, tests, build, build validation, website validation, test package as a 7-day artifact |
| **Release extension** (`release.yml`) | tag `v*` or manual run with a tag | verify tag ↔ versions ↔ changelog → validate → package → verify ZIP → GitHub Release (notes from `CHANGELOG.md`) → Chrome Web Store upload + submit for review (when enabled) |
| **Deploy website** (`pages.yml`) | push to `main` touching `website/` | validate and deploy the GitHub Pages site |

The build validator (`npm run validate:chrome`) blocks a release that changes
the version in only one place, adds a permission the listing doesn't justify,
loads remote code, uses `eval`, references a missing file, or ships
development files.

## Cut a release

1. Start from an up-to-date `main` with a clean working tree.
2. Add notes under a new heading in `CHANGELOG.md`. The heading must start
   with the version:

   ```md
   ## 1.1.0 — 2026-11-02
   ```

   Commit the changelog.
3. Bump the version. This updates `package.json`, `package-lock.json` and
   `extension/manifest.json`, commits, and creates the tag:

   ```sh
   npm version minor   # or patch / major / an exact version like 1.1.0
   ```

4. Run the release gate locally and smoke-test the build:

   ```sh
   npm run validate
   npm run pack:chrome
   ```

   Load `dist/chrome/` with **Load unpacked** and run the checklist in
   [MANUAL_TESTING.md](MANUAL_TESTING.md).
5. Push the commit and the tag:

   ```sh
   git push --follow-tags
   ```

6. Watch **Actions → Release extension**. When it is green:
   - the GitHub Release has `downshelf-chrome-vX.Y.Z.zip` and the changelog notes;
   - if the store job is enabled, the package is uploaded and submitted. The
     job log shows the item's published and submitted versions.
7. Follow the review in the Developer Dashboard. Submission is not approval:
   Chrome's review decides when the update goes live. With
   `CHROME_WEB_STORE_PUBLISH_TYPE=staged`, press **Publish** in the dashboard
   after approval.

Prefer pull requests? Do steps 2–3 on a branch with
`npm version minor --no-git-tag-version`, merge the PR, then tag the merge
commit: `git tag -a vX.Y.Z -m "Downshelf vX.Y.Z" && git push origin vX.Y.Z`.

## Re-run or recover

- **Re-run a release:** Actions → Release extension → **Run workflow**, and
  enter the existing tag. It checks out that tag, not the branch tip, and
  replaces the ZIP on the existing GitHub Release.
- **Upload by hand:** download the ZIP from the GitHub Release and upload it
  in the dashboard (**Package → Upload new package**), or run
  `npm run publish:chrome -- path/to.zip` locally with the five
  `CHROME_WEB_STORE_*` variables set (see HOWTO step 3).
- **Upload only, submit later:** `npm run publish:chrome -- --upload-only`.

## Build outputs

```text
dist/
├── chrome/                              unpacked production extension (load this to test)
└── packages/
    └── downshelf-chrome-vX.Y.Z.zip      what gets uploaded
```

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `Release tag … does not match package version` | Tag and version differ. Delete the wrong tag (`git push --delete origin vX`), fix the version, and tag again. |
| `CHANGELOG.md has no "## X.Y.Z" section` | Add release notes for that version and re-tag. |
| `New permission "…"` from the validator | Update the justification in `CHROME_WEB_STORE_LISTING.md`, `PRIVACY.md` and `website/privacy.html`, then add it to `ALLOWED_PERMISSIONS`. New permissions can trigger a longer review and a re-consent prompt for users. |
| Store job skipped | `CHROME_WEB_STORE_PUBLISH` must be exactly `true`, and the workflow must be able to use the `chrome-web-store` environment. |
| `OAuth token exchange failed` | The refresh token expired or was revoked. An OAuth app left in "Testing" expires tokens after 7 days. Publish the consent screen and create a new token (HOWTO step 3). |
| `Upload finished in state FAILED` | Usually the version wasn't increased, or the previous submission is still pending review. Check the dashboard. |
| `The store received version …` | The ZIP doesn't match the tag. Re-run the workflow for the right tag. |
| Publish rejected because of visibility | If visibility was changed in the dashboard, publish manually once; after that the API works again. |
