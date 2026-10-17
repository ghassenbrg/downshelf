# Publishing Downshelf: first-time setup

This is the complete operator guide for getting Downshelf onto the Chrome Web
Store and turning on automated releases. Do it once. After that, every
release is just "bump the version, push a tag" ([docs/PUBLISHING.md](docs/PUBLISHING.md)).

The first store submission is deliberately manual: the Chrome Web Store API
can only update an item that already exists.

```text
 one-time setup (this guide)                     every release (docs/PUBLISHING.md)
 ──────────────────────────────                   ─────────────────────────────────
 1 accounts           3 API credentials           npm version patch
 2 first manual       4 GitHub secrets/vars   →   git push --follow-tags
   store submission   5 GitHub Pages website      └─ CI: verify → test → package →
                                                      GitHub Release → Web Store review
```

## 1. Create the required accounts

1. A GitHub repository at `github.com/ghassenbrg/downshelf` (public, so the
   website, support link and source links in the listing work).
2. A Google account for the Chrome Web Store publisher with **2-Step
   Verification** turned on. Chrome requires it for publishing.
3. Register that account in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/)
   and pay the one-time registration fee if asked. Fill in the publisher
   display name and verify the contact email.
4. A Google Cloud project you will keep long-term (for API access in step 3).

## 2. Publish the first version manually

1. Deploy the website first (step 5), because the listing needs the privacy
   policy URL to be live.
2. Build the exact package from a clean, committed `main`:

   ```sh
   npm ci
   npm run validate
   npm run pack:chrome
   ```

   Or download `downshelf-chrome-v1.0.0.zip` from the GitHub Release once the
   release workflow has run.
3. In the Developer Dashboard choose **New item** and upload the ZIP. Never
   re-zip files by hand. `manifest.json` must be at the ZIP root.
4. Fill in the **Store listing**, **Privacy** and **Distribution** tabs using
   [docs/CHROME_WEB_STORE_LISTING.md](docs/CHROME_WEB_STORE_LISTING.md). It
   has the descriptions, single purpose, permission justifications, data-use
   answers and the exact image files to upload.
5. Submit for review. Reviews typically take from a few days to a couple of
   weeks; the dashboard shows the status and any policy feedback.
6. Copy the **Item ID** (32 letters, from the dashboard URL or the listing
   URL) and the **Publisher ID** (dashboard → **Account** → publisher settings).

## 3. Create Chrome Web Store API credentials

These let GitHub Actions upload new versions for you. Google's
[API guide](https://developer.chrome.com/docs/webstore/using-api) is the
authority if any labels below change.

1. In [Google Cloud Console](https://console.cloud.google.com/), select your
   project and enable **Chrome Web Store API**.
2. **APIs & Services → OAuth consent screen**: create an **External** app,
   fill in the name and emails, and add your publisher account as a **test
   user**. Then **publish the app to production**. Refresh tokens for apps in
   "Testing" expire after 7 days, which would silently break releases.
3. **Credentials → Create credentials → OAuth client ID**, type **Web
   application**, with this authorized redirect URI:

   ```text
   https://developers.google.com/oauthplayground
   ```

   Save the **client ID** and **client secret**.
4. Open the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/),
   click the gear icon, tick **Use your own OAuth credentials**, and paste the
   client ID and secret.
5. In **Input your own scopes**, enter exactly
   `https://www.googleapis.com/auth/chromewebstore`, click **Authorize
   APIs**, sign in with the publisher account, then **Exchange authorization
   code for tokens**. Save the **refresh token**.
6. Check the credentials locally without changing anything:

   ```sh
   export CHROME_WEB_STORE_CLIENT_ID=…
   export CHROME_WEB_STORE_CLIENT_SECRET=…
   export CHROME_WEB_STORE_REFRESH_TOKEN=…
   export CHROME_WEB_STORE_PUBLISHER_ID=…
   export CHROME_WEB_STORE_EXTENSION_ID=…
   npm run publish:chrome -- --dry-run
   ```

   It prints the item's published and submitted versions. Treat the refresh
   token like a password: never commit it or paste it into issues or logs.

## 4. Configure GitHub Actions

1. **Settings → Environments → New environment** named `chrome-web-store`.
   Optionally add yourself as a required reviewer, so every store upload waits
   for your click.
2. Add these **environment secrets** to `chrome-web-store`:

   | Secret | Value |
   | --- | --- |
   | `CHROME_WEB_STORE_CLIENT_ID` | OAuth client ID |
   | `CHROME_WEB_STORE_CLIENT_SECRET` | OAuth client secret |
   | `CHROME_WEB_STORE_REFRESH_TOKEN` | Refresh token with the Chrome Web Store scope |

3. **Settings → Secrets and variables → Actions → Variables** (repository
   variables; these are identifiers, not secrets):

   | Variable | Value |
   | --- | --- |
   | `CHROME_WEB_STORE_PUBLISHER_ID` | Publisher ID from step 2 |
   | `CHROME_WEB_STORE_EXTENSION_ID` | Item ID from step 2 |
   | `CHROME_WEB_STORE_PUBLISH` | `true` to enable the store job. Leave unset until steps 1–3 are done |
   | `CHROME_WEB_STORE_PUBLISH_TYPE` | Optional. `staged` = after approval, wait for you to press **Publish** in the dashboard. Unset = go live automatically once approved |

With `CHROME_WEB_STORE_PUBLISH` unset, releases still build, test and create a
GitHub Release; only the store upload is skipped.

The same setup can be done from a terminal with the GitHub CLI:

```sh
gh api -X PUT repos/ghassenbrg/downshelf/environments/chrome-web-store
gh secret set CHROME_WEB_STORE_CLIENT_ID --env chrome-web-store
gh secret set CHROME_WEB_STORE_CLIENT_SECRET --env chrome-web-store
gh secret set CHROME_WEB_STORE_REFRESH_TOKEN --env chrome-web-store
gh variable set CHROME_WEB_STORE_PUBLISHER_ID --body "<publisher id>"
gh variable set CHROME_WEB_STORE_EXTENSION_ID --body "<item id>"
gh variable set CHROME_WEB_STORE_PUBLISH --body true
```

## 5. GitHub Pages website

The `website/` folder (landing page, guide and the privacy policy the listing
links to) deploys with the **Deploy website** workflow.

1. **Settings → Pages → Source: GitHub Actions**, or run
   `gh api -X POST repos/ghassenbrg/downshelf/pages -f build_type=workflow`.
2. Push to `main` (or run the workflow manually). The site appears at
   `https://ghassenbrg.github.io/downshelf/`.
3. *Optional custom domain* (for example `downshelf.ghassen.io`): add a DNS
   `CNAME` record pointing to `ghassenbrg.github.io`, add the domain under
   **Settings → Pages**, and once GitHub verifies it, commit a
   `website/CNAME` file containing the domain and enable **Enforce HTTPS**.
   Then update the URLs in the listing, `homepage_url` in the manifest,
   `package.json` and the README. The site uses relative links, so it works on
   both addresses.

## 6. You're done

Releases from now on follow [docs/PUBLISHING.md](docs/PUBLISHING.md). After
the store approves the first version:

- replace "Chrome Web Store listing is on its way" in `website/guide.html`
  and the install section of the README with the listing URL
  (`https://chromewebstore.google.com/detail/<item-id>`);
- install the store build in a fresh Chrome profile and run the smoke test in
  [docs/MANUAL_TESTING.md](docs/MANUAL_TESTING.md).
