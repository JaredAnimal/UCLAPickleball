import {env} from 'cloudflare:workers';
import {database} from './database';

const COOKIE = 'pickleball_owner_access';
const TTL = 60 * 60;
const bytes = (s: string) => new TextEncoder().encode(s);
const hex = (v: ArrayBuffer) => Array.from(new Uint8Array(v), b => b.toString(16).padStart(2, '0')).join('');

function configured() {
  if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 16 || !env.BOT_SESSION_SECRET) {
    throw new Error('Set a separate owner password of at least 16 characters in the server settings.');
  }
}
async function digest(s: string) { return hex(await crypto.subtle.digest('SHA-256', bytes(s))); }
async function signature(expires: number) {
  configured();
  const key = await crypto.subtle.importKey('raw', bytes(env.BOT_SESSION_SECRET), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  // Password rotation invalidates existing owner sessions. Bot sessions use a different context.
  const payload = `pickleball-owner:${await digest(env.ADMIN_PASSWORD)}:${expires}`;
  return hex(await crypto.subtle.sign('HMAC', key, bytes(payload)));
}
function equal(a: string, b: string) {
  let different = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) different |= (a.charCodeAt(i) || 0) ^ b.charCodeAt(i);
  return different === 0;
}
export async function isOwner(request: Request): Promise<boolean> {
  const token = (request.headers.get('cookie') || '').split(';').map(v => v.trim()).find(v => v.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  if (!token || !/^\d{10}\.[a-f0-9]{64}$/.test(token)) return false;
  const [rawExpires, sig] = token.split('.'), expires = Number(rawExpires), now = Math.floor(Date.now() / 1000);
  if (expires <= now || expires > now + TTL) return false;
  try { return equal(sig, await signature(expires)); } catch { return false; }
}
export async function ownerPasswordMatches(password: string) {
  configured();
  return equal(await digest(password), await digest(env.ADMIN_PASSWORD));
}
export function ownerCookie(token: string, seconds = TTL) {
  return `${COOKIE}=${token}; Path=/; Max-Age=${seconds}; HttpOnly; Secure; SameSite=Strict`;
}
export async function newOwnerCookie() {
  const expires = Math.floor(Date.now() / 1000) + TTL;
  return ownerCookie(`${expires}.${await signature(expires)}`);
}
export async function attemptKey(request: Request) {
  // Cloudflare supplies this header in production. Store only a digest, with a short expiry.
  // IPv6 clients usually control a whole /64, so throttle by that prefix rather than the full address.
  const ip = (request.headers.get('cf-connecting-ip') || 'local-development').toLowerCase();
  if (!ip.includes(':') || ip.includes('.')) return digest(ip);
  const [head, tail = ''] = ip.split('::'), left = head ? head.split(':') : [], right = tail ? tail.split(':') : [];
  return digest([...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right].slice(0, 4).map(h => parseInt(h, 16).toString(16)).join(':'));
}
// Counts the attempt before the password is checked, so parallel guesses can't all slip under the limit.
export async function attemptsAllowed(key: string, limit = 5, seconds = 900) {
  const now = Math.floor(Date.now() / 1000);
  await database().prepare('DELETE FROM admin_attempts WHERE expires <= ?').bind(now).run();
  const row = await database().prepare(`INSERT INTO admin_attempts (key, attempts, expires) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET attempts = attempts + 1 RETURNING attempts`).bind(key, now + seconds).first<{attempts:number}>();
  return !!row && row.attempts <= limit;
}
export async function clearAttempts(key: string) {
  await database().prepare('DELETE FROM admin_attempts WHERE key = ?').bind(key).run();
}
