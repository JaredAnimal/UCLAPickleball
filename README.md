# UCLA Club Pickleball

The club match calendar, prepared for GitHub and standalone Cloudflare Workers hosting.

## What is included

- Mobile-friendly calendar showing today and the next five days in the club's Pacific time zone.
- UCLA Google sign-in; members link a roster name once, guests type first and last name, shown with red `[guest]` labels.
- Reservations default to Sunset Rec; hosts choose additional slots and manage attendees.
- Thursday 5–7 PM and Sunday 3–5 PM club practices, with unlimited member attendance and no guest signups.
- Shared reservations stored in the club's D1 database, copied every minute to the existing private Google Sheet through its Apps Script bridge; the Sheet's Roster tab supplies the roster and the officers.
- Club officers (marked on the Roster tab) can edit, cancel and remove attendees on every game, and manage Members from the profile menu.
- Password-protected automation bot page with the blue `[BETA]` label inside its calendar button. After unlocking, the download button opens the Windows EXE installer hosted on GitHub Releases.
- Separate password-protected owner settings, encrypted connection storage, Google sign-in sessions, and automated checks.

Players sign in with a UCLA Google account (`g.ucla.edu` or `ucla.edu`). A member links one roster name to the account once; a guest types a first and last name, shown with a red `[guest]` marker and reserved for that account. Officers unlink or block accounts from Members in the profile menu (not other officers); the owner can also use `/admin` → Members. Owner settings use a separate server password and never need Google.

## Update the automation bot installer

The current installer is **Picklebot-Setup-0.2.2.exe**, attached to the `picklebot-v0.2.2` GitHub release. Release assets support installers larger than GitHub's repository file limit and keep the binary out of the Worker bundle.

The password-protected `/bot/download` route redirects unlocked visitors to the release asset. The release asset itself is public, like this repository. The button shows `.EXE` and the disclaimer “Windows only.” directly underneath. For a later version, upload the new release asset, update the URL in `src/routes/bot-download.ts`, and push directly to `main` to publish through the existing Cloudflare build connection.

## Moving from the current site

This is the complete standalone application, not a static HTML export. GitHub stores the source. Cloudflare Workers runs the server and serves the assets. D1 now holds the reservations; the existing Google Sheet keeps a copy of them and still holds the roster.

The migration removes Sites-specific hosting and identity dependencies. Owner settings now use `/admin` with a separate `ADMIN_PASSWORD`. No production passwords, shared secrets, club roster names, actual Sheet identifiers, private database records, or Git history are included. Old internship tracker code and data are not included.

Keep the current site available until the replacement has been configured and tested. Uploading this repository alone does not move the live website or its URL.

## How data flows

- D1 is the source of truth for reservations. Every save is checked by the Worker (`src/lib/reservation-rules.ts`) and written to D1 without calling Google.
- Each minute a cron rewrites the Sheet's Reservations tab from D1 for rows dated yesterday (Pacific) or later. Hand edits there are overwritten; older rows are left untouched.
- The same minute the Worker reads the Roster tab and its `Officer` column back into D1. A roster that is empty, or under half the size of the last one, is refused until an officer chooses "Use the new roster".
- Page loads read one snapshot row from D1. Replies carry the roster size, never roster names.

## Mark officers

Add a column to the Roster tab with the header `Officer` and type `yes` beside each officer. It takes effect within a minute. Officers see edit, cancel and remove on every game, plus Members in the profile menu. Whoever links an officer's name gets officer powers.

## Local development

Install Node.js 22.13 or later and pnpm 11.25.0. From this folder:

```sh
pnpm install --frozen-lockfile
pnpm setup:local
pnpm db:local
pnpm dev
```

Open the local URL Wrangler prints. `setup:local` creates ignored `.dev.vars` with random development values and never overwrites an existing file. Open that file locally to read your development passwords. Do not upload it.

Until the Sheet is connected, the calendar is read-only and member names are not available. Use a separate test spreadsheet for interactive development. Automated checks provide synthetic player names, mock Google, and use a disposable database, so they need no live connection.

Run all checks:

```sh
pnpm check
```

This type-checks the Worker, tests the Apps Script reservation rules and calendar dates, bundles the Worker without deploying, and exercises the compiled Worker APIs in Miniflare. The GitHub Actions workflow runs the same checks on pushes to `main` and pull requests.

## One-time Cloudflare setup

1. Sign in to your own Cloudflare account. Authorize Wrangler locally with `pnpm exec wrangler login`.
2. Create the connection-settings database:

   ```sh
   pnpm exec wrangler d1 create ucla-club-pickleball
   ```

3. `wrangler.jsonc` already holds the club database's `database_id`. On a different Cloudflare account, replace it with the returned ID, keep the binding named `DB`, and commit the change. The ID is a configuration identifier, not a secret.
4. Apply the schema:

   ```sh
   pnpm db:remote
   ```

5. Deploy the Worker code once:

   ```sh
   pnpm deploy
   ```

6. In Cloudflare, open the Worker → **Settings → Variables and Secrets**. Add each value below with type **Secret**, then deploy the settings. The app's administrative and password-protected features fail closed until these are configured.

| Secret | Value |
| --- | --- |
| `ADMIN_PASSWORD` | A new random owner-only password of at least 16 characters, different from the bot password |
| `BOT_DOWNLOAD_PASSWORD` | The bot download-page password you want to retain |
| `BOT_SESSION_SECRET` | A random 32-byte signing secret, for example 64 hexadecimal characters |
| `SHEETS_ENCRYPTION_KEY` | Exactly 32 random bytes encoded as base64 |
| `GOOGLE_CLIENT_ID` | The OAuth client ID from [Google sign-in setup](#google-sign-in-setup) |
| `GOOGLE_CLIENT_SECRET` | The OAuth client secret from the same client |
| `SHEETS_SPREADSHEET_ID` | The existing private spreadsheet ID, copied from its Google Sheets URL between `/d/` and `/edit` |

Generate the two keys locally with Node.js. These commands print new random values on your own computer; save them directly into Cloudflare's secret fields:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Keep the encryption key stable after connecting the Sheet. Replacing it requires reconnecting with the Sheet secret. Changing the owner password invalidates owner sessions. Changing the session secret invalidates bot and owner sessions. No secret change signs players out; only deleting their `sessions` rows (or an officer's Unlink) does.

## Google sign-in setup

1. In Google Cloud, create a project and set up **Google Auth Platform** with user type **External**. Under **Branding**, add the home page `https://<your-worker-host>/`, the privacy policy `https://<your-worker-host>/privacy` and the Worker host's parent domain as an authorized domain; Google won't publish the app without them. Under **Data Access**, add `openid` and `email`.
2. Under **Clients**, create a **Web application** client with these redirect URIs: `http://localhost:8787/auth/callback` and `https://<your-worker-host>/auth/callback`.
3. Under **Audience**, choose **Publish app** (In production). A new External app starts in Testing, where only listed test users can sign in. `openid` and `email` need no Google verification; uploading a logo would.
4. Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.dev.vars` for local work and add both as Worker secrets. Google shows a new client secret only once.
5. Run `pnpm db:remote` to apply migration `0002_sign_in.sql` **before merging to main (merging deploys)**. The site is sign-in-first, so the new code cannot serve players without those tables.

Finish all five steps **before merging**: the app published, the production redirect URI added, both Worker secrets set and the migration applied. Without the secrets every player sees "Sign-in isn't set up yet."; a missing redirect URI, an unpublished app or a missing migration also blocks players. If the site's domain changes, update the branding links, the authorized domain and the production redirect URI.

## Reconnect the existing Google Sheet

1. Visit the new website's `/admin` page and enter the new owner password.
2. At `/connect-sheet`, paste the **existing** Apps Script web-app URL ending in `/exec` and its connection secret. The secret is in the Apps Script project's **Project Settings → Script Properties → API_SECRET**.
3. Select **Verify & connect**. The server checks the API version, expected spreadsheet ID, and roster before encrypting and saving the connection.
4. Reuse the existing Google deployment. Reconnecting keeps the D1 data, and the next minute re-copies the window to the Sheet. When the `.gs` changes, deploy a new version of the same deployment (the URL stays). Do not run `setup` or rotate its secret merely because the website moved. `src/lib/pickleball-apps-script.gs` is included as a portable source copy for future changes or new setup. Its private spreadsheet ID comes from an owner-set `SPREADSHEET_ID` Script Property when present, otherwise from the spreadsheet the script is bound to; it is not embedded in source.

The expected Sheet ID is configured privately with `SHEETS_SPREADSHEET_ID`. Roster names come from the connected Sheet at runtime; none are embedded in this repository. The sheet stays private. The web app executes as its Google owner and checks the shared secret on every data request. Neither the shared secret nor the runtime keys are returned to calendar visitors.

## Update the Google script

Merging to `main` updates the website only. Changes to `src/lib/pickleball-apps-script.gs` reach Google only when the Sheet owner deploys them:

1. In the Sheet, open **Extensions → Apps Script**.
2. Replace the code in `Code.gs` with the file's contents and save.
3. Open **Deploy → Manage deployments**, select the active deployment, click the pencil, set **Version** to **New version**, and select **Deploy**.

The web-app URL and secret stay the same, so the website needs no change. Do not run `setup` for an update. The script version with the `sync` action is required: without it the minute copy and the roster read fail and Members shows the error.

## Set up a new Sheet (testing or a fresh start)

1. Create a Google Sheet with two tabs: `Reservations` (empty) and `Roster` (a header in A1, then one player name per row in column A).
2. Open **Extensions → Apps Script**, paste `src/lib/pickleball-apps-script.gs`, save, and run `setup` once. It writes the header row, sets the Pacific time zone, and shows the connection secret in the Sheet.
3. Select **Deploy → New deployment → Web app**, execute as yourself, with access for **Anyone**. Copy the URL ending in `/exec`.
4. Set `SHEETS_SPREADSHEET_ID` to the new Sheet's ID, then connect it at `/connect-sheet` as above.

## Automatic deployment from GitHub

After the first successful deployment, connect this repository under the Cloudflare Worker's **Settings → Builds**. Use:

| Setting | Value |
| --- | --- |
| Worker name | `uclapickleball` (must match `wrangler.jsonc`; PR preview builds fail if it differs) |
| Root directory | Repository root |
| Production branch | `main` |
| Build command | `pnpm check` |
| Deploy command | `pnpm deploy` |

Use Node.js 22 or later in the build environment. Configure runtime secrets on the Worker; GitHub CI needs no production credentials. Disable branch preview deployments until you have a separate preview database and a separate test Sheet connection, so previews cannot modify real reservations.

Approve and merge tested pull requests into `main` to update production. Database migrations are deliberately explicit; if a future change adds one, apply it using `pnpm db:remote` as part of that release.

References: [Workers GitHub integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/), [D1 setup](https://developers.cloudflare.com/d1/get-started/), [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

## Editing with GPT / Codex

Connect this GitHub repository to a Codex cloud environment. Let Codex install dependencies and run `pnpm check`, then publish the development environment. Request changes in plain English and have Codex open a pull request. Review its changes and check results before merging. With the Cloudflare build connection configured, merging into `main` publishes the update.

`AGENTS.md` records the club rules, commands, and where to find the relevant code for future GPT sessions. You do not need to add an OpenAI API key to this website just to use Codex as your coding assistant.

## Before switching the shared link

- Confirm shared reservations load (the first request imports them from the Sheet) and the Reservations tab matches after a minute.
- With approved test names, check host creation/removal and member/guest joins, then remove any test reservations.
- Confirm guests cannot join practice and practice capacity is unlimited.
- Check the bot page password, owner settings protection, and phone layout.
- On a phone, sign in as a member and as a guest, then sign out.
- Change the destination of the shared short link only after the new deployment works. Keep the old site until cutover is complete.

## Switch-over

1. Apply `0003` to remote D1 (`pnpm db:remote`) before the deploy.
2. Deploy the script version with `sync`.
3. Merge at a quiet hour, and make no saves for a minute around the merge: the outgoing Worker still writes the Sheet for a few seconds. The first request imports rows dated yesterday or later.
4. Rollback:
   - In Members, check the Sheet copy is not behind, then wait a minute with no saves.
   - Revert the PR; the old code reads the Sheet copy with `list`.
   - On the remote D1 run `DELETE FROM app_settings WHERE key='reservations_copy';` so the old code can write its copy again.
5. Roll forward after a rollback, before merging again: `DELETE FROM reservations; DELETE FROM requests; DELETE FROM app_settings WHERE key IN ('reservations_imported','reservations_copy','sheet_sync','roster');` so the next request re-imports from the Sheet.

## Source map

| File | Purpose |
| --- | --- |
| `src/worker.ts` | HTTP routes, static asset serving, and the scheduled handler that runs the minute sync |
| `src/pages/calendar.html` | Calendar page and forms |
| `public/pickleball-calendar.js` / `.css` | Calendar behavior and responsive styles |
| `src/routes/` | Reservation, owner setup, and bot handlers |
| `src/lib/reservation-rules.ts` | The reservation and host/officer rules the Worker enforces |
| `src/lib/reservation-store.ts` | Reservations in D1: saves, receipts, data version, snapshot, first import |
| `src/lib/sheet-sync.ts` | Minute cron: copies reservations to the Sheet, reads the roster and officers back |
| `public/pickleball-members.js` | Members dialog in the profile menu |
| `src/routes/auth.ts` | Google sign-in start, callback, name step, and sign-out |
| `src/routes/login.ts` / `src/pages/login.html` / `public/pickleball-login.js` | The `/login` page |
| `public/privacy.html` | Public privacy page, linked from the sign-in page and Google's consent screen |
| `src/routes/members.ts` | Members list API for the owner or an officer (unlink, block, unblock) |
| `src/lib/sign-in.ts` | Sessions, roster matching, and link helpers |
| `src/lib/sheet-connection.ts` | Verified Google bridge and encrypted configuration |
| `src/lib/admin-access.ts` | Owner password sessions and login throttling |
| `src/lib/pickleball-config.ts` | Private runtime spreadsheet configuration |
| `src/lib/pickleball-apps-script.gs` | Google-side source copy |
| `migrations/` | D1 schema for settings, owner login throttling, sign-in sessions, links and blocked accounts, and (`0003`) reservations, receipts, the data version and sync state |
