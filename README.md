# UCLA Club Pickleball

The club match calendar, prepared for GitHub and standalone Cloudflare Workers hosting.

## What is included

- Mobile-friendly calendar showing today and the next five days in the club's Pacific time zone.
- Roster name selection and first/last-name guests, with red `[guest]` labels.
- Reservations default to Sunset Rec; hosts choose additional slots and manage attendees.
- Thursday 5–7 PM and Sunday 3–5 PM club practices, with unlimited member attendance and no guest signups.
- Shared reservations through the existing private Google Sheet and Apps Script bridge.
- Password-protected automation bot page with the blue `[BETA]` label inside its calendar button. The actual download remains a placeholder.
- Separate password-protected owner settings, encrypted connection storage, signed player sessions, and automated checks.

The calendar deliberately uses the club's honor system for player names. Selecting a roster name is not proof of a person's identity. Owner settings use a separate server password.

## Moving from the current site

This is the complete standalone application, not a static HTML export. GitHub stores the source. Cloudflare Workers runs the server and serves the assets. The existing Google Sheet continues to hold reservations and the roster.

The migration removes Sites-specific hosting and identity dependencies. Owner settings now use `/admin` with a separate `ADMIN_PASSWORD`. No production passwords, shared secrets, club roster names, actual Sheet identifiers, private database records, or Git history are included. Old internship tracker code and data are not included.

Keep the current site available until the replacement has been configured and tested. Uploading this repository alone does not move the live website or its URL.

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

3. Replace the placeholder `database_id` in `wrangler.jsonc` with the returned database ID. Keep the binding named `DB`. Commit this configuration change to GitHub. The ID is a configuration identifier, not a secret.
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
| `SHEETS_SPREADSHEET_ID` | The existing private spreadsheet ID, copied from its Google Sheets URL between `/d/` and `/edit` |

Generate the two keys locally with Node.js. These commands print new random values on your own computer; save them directly into Cloudflare's secret fields:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Keep the encryption key stable after connecting the Sheet. Replacing it requires reconnecting with the Sheet secret. Changing the owner password invalidates owner sessions. Changing the session secret invalidates bot and player sessions.

## Reconnect the existing Google Sheet

1. Visit the new website's `/admin` page and enter the new owner password.
2. At `/connect-sheet`, paste the **existing** Apps Script web-app URL ending in `/exec` and its connection secret. The secret is in the Apps Script project's **Project Settings → Script Properties → API_SECRET**.
3. Select **Verify & connect**. The server checks the API version, expected spreadsheet ID, and roster before encrypting and saving the connection.
4. Reuse the existing Google deployment. Do not replace its code, run `setup`, or rotate its secret merely because the website moved. `src/lib/pickleball-apps-script.gs` is included as a portable source copy for future changes or new setup. Its private spreadsheet ID comes from the bound spreadsheet, or an owner-set `SPREADSHEET_ID` Script Property; it is not embedded in source.

The expected Sheet ID is configured privately with `SHEETS_SPREADSHEET_ID`. Roster names come from the connected Sheet at runtime; none are embedded in this repository. The sheet stays private. The web app executes as its Google owner and checks the shared secret on every data request. Neither the shared secret nor the runtime keys are returned to calendar visitors.

## Automatic deployment from GitHub

After the first successful deployment, connect this repository under the Cloudflare Worker's **Settings → Builds**. Use:

| Setting | Value |
| --- | --- |
| Worker name | `ucla-club-pickleball` (must match `wrangler.jsonc`) |
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

- Confirm shared reservations load from the existing Sheet.
- With approved test names, check host creation/removal and member/guest joins, then remove any test reservations.
- Confirm guests cannot join practice and practice capacity is unlimited.
- Check the bot page password, owner settings protection, and phone layout.
- Change the destination of the shared short link only after the new deployment works. Keep the old site until cutover is complete.

## Source map

| File | Purpose |
| --- | --- |
| `src/worker.ts` | HTTP routes and static asset serving |
| `src/pages/calendar.html` | Calendar page and forms |
| `public/pickleball-calendar.js` / `.css` | Calendar behavior and responsive styles |
| `src/routes/` | Reservation, session, owner setup, and bot handlers |
| `src/lib/sheet-connection.ts` | Verified Google bridge and encrypted configuration |
| `src/lib/admin-access.ts` | Owner password sessions and login throttling |
| `src/lib/pickleball-config.ts` | Private runtime spreadsheet configuration |
| `src/lib/pickleball-apps-script.gs` | Google-side source copy |
| `migrations/` | D1 schema for settings and owner login throttling |
