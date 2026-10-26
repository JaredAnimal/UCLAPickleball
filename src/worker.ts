import * as calendar from './routes/calendar';
import * as reservations from './routes/reservations';
import * as sheetsConnection from './routes/sheets-connection';
import * as connectSheet from './routes/connect-sheet';
import * as bot from './routes/bot';
import * as botDownload from './routes/bot-download';
import * as admin from './routes/admin';
import * as auth from './routes/auth';
import * as login from './routes/login';
import * as members from './routes/members';
import {pruneRequests} from './lib/reservation-store';
import {runSync} from './lib/sheet-sync';
import {deleteExpiredSessions, sha256, tokenOf} from './lib/sign-in';
import {attemptKey} from './lib/admin-access';

type Handler = (request: Request) => Response | Promise<Response>;
// A limiter that errors fails open: the API stays up rather than every /api call turning into a 503.
const over = async (limit: RateLimit | undefined, key: string) => { try { return !!limit && !(await limit.limit({key})).success; } catch { return false; } };
const routes: Record<string, Partial<Record<'GET' | 'POST', Handler>>> = {
  '/': calendar,
  '/api/reservations': reservations,
  '/api/sheets-connection': sheetsConnection,
  '/connect-sheet': connectSheet,
  '/bot': bot,
  '/bot/download': botDownload,
  '/admin': admin,
  '/login': login,
  '/api/members': members,
  '/auth/google': {GET: auth.start},
  '/auth/callback': {GET: auth.callback},
  '/auth/logout': {POST: auth.logout},
  '/auth/name': {POST: auth.name},
};

export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    let response: Response, asset = false;
    try {
      const path = new URL(request.url).pathname.replace(/\/$/, '') || '/';
      const route = routes[path], api = path.startsWith('/api/');
      // Before any route or D1 call; the cookie is only hashed, never looked up. Per session, plus a per-network ceiling that random cookies can't dodge. No binding (a misconfigured preview) lets requests through.
      const token = api ? tokenOf(request) : null, net = api ? 'ip:' + await attemptKey(request) : '';
      if (api && (await over(env.API_LIMIT, token ? 's:' + await sha256(token) : net) || await over(env.API_NET_LIMIT, net))) {
        response = Response.json({error: 'Too many requests. Wait a minute and try again.'}, {status: 429, headers: {'Cache-Control': 'no-store'}});
      } else if (route) {
        const method = request.method === 'HEAD' ? 'GET' : request.method;
        const handler = route[method as 'GET' | 'POST'];
        response = handler ? await handler(request) : new Response('Method not allowed', {status:405, headers:{Allow:Object.keys(route).join(', ')}});
      } else {
        response = await env.ASSETS.fetch(request);
        asset = true;
      }
    } catch (error) {
      console.error('Request failed', error instanceof Error ? error.name : 'Unknown');
      response = new Response('The calendar is temporarily unavailable. Please retry.', {status:503, headers:{'Cache-Control':'no-store'}});
    }
    const headers = new Headers(response.headers);
    if (asset && response.status===200 && new URL(request.url).searchParams.get('v')===calendar.assetVersion()) headers.set('Cache-Control','public, max-age=31536000, immutable');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('X-Frame-Options', 'SAMEORIGIN');
    return new Response(request.method === 'HEAD' ? null : response.body, {status:response.status, statusText:response.statusText, headers});
  },
  scheduled(_controller: ScheduledController, _env: Cloudflare.Env, ctx: ExecutionContext) {
    ctx.waitUntil(deleteExpiredSessions().catch(error => console.error('Session cleanup failed', error instanceof Error ? error.message : 'Unknown')));
    ctx.waitUntil(pruneRequests().catch(error => console.error('Receipt cleanup failed', error instanceof Error ? error.message : 'Unknown')));
    ctx.waitUntil(runSync(true).catch(error => console.error('Scheduled sync failed', error instanceof Error ? error.message : 'Unknown')));
  },
} satisfies ExportedHandler<Cloudflare.Env>;
