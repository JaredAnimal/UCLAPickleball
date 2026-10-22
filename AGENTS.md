# Project guidance

This is UCLA Club Pickleball's standalone Cloudflare Worker. GitHub is the source of truth; Cloudflare hosts it; Google Sheets stores shared reservations.

## Development

- Node.js >=22.13.0; pnpm 11.25.0.
- Install with `pnpm install --frozen-lockfile`.
- Run `pnpm check` after changes affecting server or calendar behavior.
- `pnpm dev` starts local Wrangler. `pnpm setup:local` generates ignored local secrets. `pnpm db:local` applies local migrations.
- Tests mock Google and use a disposable D1 database. Never test by writing to the real Sheet without the user's explicit approval.
- Push changes directly to `main` for this project unless the user explicitly requests a branch or pull request. Start from the latest `main` and preserve other changes. Keep code changes separate from live data changes.

## Preserve these club rules

- Calendar shows today plus five days in advance, using Pacific civil dates and correct daylight-saving transitions.
- Reservations default to Sunset Rec; the court remains editable. They allow up to 7 other players (8 on a court with the host); the Worker and the Google bridge enforce it.
- Thursday practice is 5–7 PM; Sunday practice is 3–5 PM; member attendance is unlimited; guests cannot join practices.
- Player selection is intentionally an honor system. First and last names are required for guests, displayed with a red `[guest]` marker.
- Only a reservation's selected host may edit, cancel, or remove attendees. Enforce this in the Google bridge as well as the UI.
- The automation button contains a blue `[BETA]` marker. Its page is password gated, with a placeholder until the user supplies a real download.
- Sync notices are hidden during successful operation and shown on errors. Do not add a reservations-sheet link to the public header.
- Preserve the UCLA Pickleball circle logo (`public/ucla-pickleball-logo.webp`), the team-photo header band, and the mobile layout. Avoid large top slogans and a practice-schedule banner above the calendar.

## Data and secrets

- Keep runtime passwords, `.dev.vars`, `.env`, database files, browser sessions, and Google connection secrets out of Git.
- Do not embed real roster names, spreadsheet IDs, owner email addresses, or deployment URLs in public repository files. Use synthetic fixtures in tests and private runtime configuration for the Sheet.
- Public players must never receive the connection secret, encryption key, bot password, or owner password.
- Owner settings use `/admin`, an independent password, signed HttpOnly cookies, and login throttling. Do not trust caller-supplied Sites identity headers on this standalone host.
- Preserve the current Google Sheet and Apps Script deployment. Do not run Google `setup` or rotate the shared secret for routine website changes.
- D1 stores settings, login throttling, and a copy of the latest Sheet reservations and roster (refreshed from the Sheet every minute by a cron trigger and after every confirmed Sheet read or write, cleared on reconnect; the page re-reads live only on manual Refresh, when checking an unsure save, or when the copy is older than 3 minutes). Rows dated before yesterday (Pacific) are left out of replies and the copy; the Sheet keeps them. The Sheet stays the source of truth; the copy is only written from confirmed Sheet responses. Do not import the old internship tracker or its personal data.
- Branch previews must use separate test data, not the production Sheet connection.
- Read README.md for deployment, reconnecting the Sheet, and the source map.
