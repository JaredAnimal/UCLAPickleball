import {sameOrigin} from '../lib/sheet-connection';
import {isOwner, ownerPasswordMatches, newOwnerCookie, ownerCookie, attemptKey, attemptsAllowed, clearAttempts} from '../lib/admin-access';

function page(error = '', status = 200) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Owner settings · UCLA Club Pickleball</title><link rel="stylesheet" href="/pickleball-calendar.css"></head><body><header><div class="brand"><img class="logo" src="/ucla-pickleball-logo.webp" alt="UCLA Pickleball" style="border-radius:50%" width="46" height="46"><div><h1>UCLA Club Pickleball</h1><p>Owner settings</p></div></div></header><main class="bot-page"><section class="panel bot-panel"><h2>Owner sign in</h2><p class="muted">Enter your owner password to manage the Google Sheet connection.</p><form class="bot-form" method="post" action="/admin"><label for="password">Owner password</label><input id="password" name="password" type="password" required maxlength="200" autocomplete="current-password"><p class="error" role="alert">${error}</p><button class="primary">Continue</button></form><div class="bot-footer"><a href="/">← Back to calendar</a></div></section></main></body></html>`, {status, headers:{'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'private, no-store'}});
}
const redirect = (cookie?: string) => new Response(null, {status:303, headers:{Location:'/connect-sheet', 'Cache-Control':'private, no-store', ...(cookie ? {'Set-Cookie':cookie} : {})}});
export async function GET(request: Request) {
  return await isOwner(request) ? redirect() : page();
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return page('This request is not allowed.', 403);
  try {
    const raw = await request.text();
    if (raw.length > 1000) return page('Request is too large.', 400);
    const form = new URLSearchParams(raw);
    if (form.get('action') === 'logout') return new Response(null, {status:303, headers:{Location:'/admin', 'Set-Cookie':ownerCookie('', 0), 'Cache-Control':'private, no-store'}});
    const key = await attemptKey(request);
    if (!await attemptsAllowed(key)) return page('Too many attempts. Try again in 15 minutes.', 429);
    if (!await ownerPasswordMatches(form.get('password') || '')) return page('Incorrect owner password.', 401);
    await clearAttempts(key);
    return redirect(await newOwnerCookie());
  } catch {
    return page('Owner access is unavailable. Check the server secrets and database setup.', 503);
  }
}
