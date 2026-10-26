# Project guidance

This is UCLA Club Pickleball's standalone Cloudflare Worker. GitHub is the source of truth; Cloudflare hosts it; D1 stores reservations; the Google Sheet keeps a copy and the roster.

## Development

- Node.js >=22.13.0; pnpm 11.25.0.
- Install with `pnpm install --frozen-lockfile`.
- Run `pnpm check` after changes affecting server or calendar behavior.
- `pnpm dev` starts local Wrangler. `pnpm setup:local` generates ignored local secrets. `pnpm db:local` applies local migrations.
- Tests mock Google and use a disposable D1 database. Never test by writing to the real Sheet without the user's explicit approval.
- Push changes directly to `main` for this project unless the user explicitly requests a branch or pull request. Start from the latest `main` and preserve other changes. Keep code changes separate from live data changes.

## Preserve these club rules

- Calendar shows today plus five days in advance, using Pacific civil dates and correct daylight-saving transitions.
- Reservations default to Sunset Rec; the court remains editable. They allow up to 7 other players (8 on a court with the host); the Worker enforces it (`src/lib/reservation-rules.ts`).
- At most 4 games run at once per court (start inclusive, end exclusive); the Worker enforces it.
- No games at Sunset Rec during club practice (Thu 5–7 PM, Sun 3–5 PM).
- Thursday practice is 5–7 PM; Sunday practice is 3–5 PM; member attendance is unlimited; guests cannot join practices.
- Players sign in with any Google account (verified email). Members link one roster name once; guests type first + last, shown with a red `[guest]` marker, and the name is reserved for that account.
- Only a reservation's host or a club officer may edit, cancel, or remove attendees; officers may also remove attendees from practice. The Worker enforces this; the UI only shows the buttons. Cards show only Join/Leave; the host and officers get one pencil on the card that opens the edit sheet (details, players, Cancel match), and its removals save only on Save.
- Officers (the Officer column on the Roster tab) unlink or block accounts from Members in the profile menu, except other officers; /admin → Members is the owner's safety net.
- The automation button contains a blue `[BETA]` marker. Its page is password gated; the download redirects to the Windows EXE installer on GitHub Releases.
- Sync notices are hidden during successful operation and shown on errors. Do not add a reservations-sheet link to the public header.
- Preserve the UCLA Pickleball circle logo (`public/ucla-pickleball-logo.webp`), the team-photo header band, and the mobile layout. Avoid large top slogans and a practice-schedule banner above the calendar.

## Data and secrets

- `public/privacy.html` is the public privacy page Google's consent screen links to. Update it whenever what sign-in stores, or who can see it, changes.
- Sign-in limits: 60 sign-ins and 5 guest-name attempts per network per hour, 20 new guests per Pacific day; /api/* is limited per session by the API_LIMIT rate-limit binding.
- Keep runtime passwords, `.dev.vars`, `.env`, database files, browser sessions, and Google connection secrets out of Git.
- Do not embed real roster names, spreadsheet IDs, owner email addresses, or deployment URLs in public repository files. Use synthetic fixtures in tests and private runtime configuration for the Sheet.
- Public players must never receive the connection secret, encryption key, bot password, or owner password.
- Owner settings use `/admin`, an independent password, signed HttpOnly cookies, and login throttling. Do not trust caller-supplied Sites identity headers on this standalone host. `/admin` stays password-only and never needs Google.
- Preserve the current Google Sheet and Apps Script deployment: when the `.gs` changes, deploy a new version of the same deployment (the URL stays). Do not run Google `setup` or rotate the shared secret for routine website changes.
- D1 is the source of truth for reservations, receipts, the data version, the snapshot (the one row page loads read) and the sync state, and keeps the last accepted copy of the Roster tab; the roster and officers are edited only in the Sheet. It also stores settings, login throttling, sessions, links (account to roster name) and blocked accounts.
- The Sheet copy finds its rows by an ID in column A and a `yyyy-mm-dd` date in column B; don't change those formats or the Reservations headers.
- A change that adds a migration needs `pnpm db:remote` on the live database before it reaches `main` (merging deploys). Write migrations that only add tables, columns or indexes, so the live code keeps working in between.
- Bump `CACHE_KEY` in `public/pickleball-calendar.js` when the `/api/reservations` reply shape changes.
- The Sheet's Reservations tab is a one-way copy, rewritten every minute (`src/lib/sheet-sync.ts`) for rows dated yesterday (Pacific) or later. Hand edits there are overwritten; older rows are left untouched.
- The roster is read from the Roster tab every minute. A roster that is empty, or under half the size of the last one, is refused until an officer chooses "Use the new roster".
- The Officer column is the row-1 header `Officer`; marks are yes, y, x or true.
- Page loads read one snapshot row, reconnecting never clears D1 data, and the old script actions stay for rollback. Calendar replies carry `rosterSize`, never roster names (only Members lists them). Do not import the old internship tracker or its personal data.
- Branch previews must use separate test data, not the production Sheet connection.
- Read README.md for deployment, reconnecting the Sheet, and the source map.
