import {waitUntil} from 'cloudflare:workers';
import {database} from './database';
import {normalize} from './player-session';
import {readRoster} from './reservation-store';

export type Session={hash:string;sub:string;email:string;player:string|null;expiresAt:number;renewedAt:number};
export const SESSION_COOKIE='__Host-pb_s';
const LIFE=7776000,RENEW_AFTER=86400,now=()=>Math.floor(Date.now()/1000);
const cookie=(token:string,age:number)=>`${SESSION_COOKIE}=${token}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`;
export const sha256=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
export const tokenOf=(request:Request)=>{const v=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(SESSION_COOKIE+'='))?.slice(SESSION_COOKIE.length+1);return v&&/^[A-Za-z0-9_-]{43}$/.test(v)?v:null;};
export async function createSession(sub:string,email:string,player:string|null):Promise<string>{
 const token=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''),t=now();
 await database().prepare('INSERT INTO sessions (token_hash,sub,email,player,expires_at,renewed_at) VALUES (?,?,?,?,?,?)').bind(await sha256(token),sub,email,player,t+LIFE,t).run();
 return cookie(token,LIFE);
}
// A session counts only while its account is not blocked and, once it has a player, still has a links row (Unlink/Block beats a sign-in in progress); keep both subqueries.
// Split so a poll can batch the session lookup with its other reads; null when the cookie is missing or malformed (no D1 call).
export async function sessionQuery(request:Request):Promise<{hash:string;statement:D1PreparedStatement}|null>{
 const token=tokenOf(request);if(!token)return null;const hash=await sha256(token);
 return {hash,statement:database().prepare('SELECT sub,email,player,expires_at,renewed_at FROM sessions WHERE token_hash=? AND expires_at>? AND NOT EXISTS (SELECT 1 FROM blocked b WHERE b.sub=sessions.sub) AND (player IS NULL OR EXISTS (SELECT 1 FROM links l WHERE l.sub=sessions.sub))').bind(hash,now())};
}
export const sessionOf=(hash:string,r:any):Session|null=>r?{hash,sub:r.sub,email:r.email,player:r.player,expiresAt:r.expires_at,renewedAt:r.renewed_at}:null;
export async function readSession(request:Request):Promise<Session|null>{const q=await sessionQuery(request);return q?sessionOf(q.hash,await q.statement.first()):null;}
// The cookie holds the token, but only its hash is stored, so a renewal re-sends the cookie only when the caller hands back the request's token.
// The D1 update runs after the reply (waitUntil); a failed one only logs, and the next page load tries again.
export function renewSession(session:Session,request:Request):string|null{
 const t=now();if(t-session.renewedAt<=RENEW_AFTER)return null;
 waitUntil(database().prepare('UPDATE sessions SET expires_at=?,renewed_at=? WHERE token_hash=?').bind(t+LIFE,t,session.hash).run().catch(()=>console.error('Session renewal failed')));
 const token=tokenOf(request);return token?cookie(token,LIFE):null;
}
export async function endSession(request:Request):Promise<string>{
 const token=tokenOf(request);if(token)await database().prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(token)).run();
 return cookie('',0);
}
export async function deleteExpiredSessions():Promise<void>{await database().prepare('DELETE FROM sessions WHERE expires_at<=?').bind(now()).run();}
// The roster stored in D1; null when there is none or it is empty. Never calls Google.
export async function rosterNames():Promise<string[]|null>{try{const names=(await readRoster())?.names;return names?.length?names:null;}catch{return null;}}
// The one roster spelling whose key matches; 'duplicate' when two different spellings share the key (an identical repeated row is one name), null when none.
export function rosterMatch(name:string,roster:string[]):string|'duplicate'|null{const k=normalize(name),m=[...new Set(roster.filter(n=>normalize(n)===k))];return m.length>1?'duplicate':m[0]??null;}
// An already-linked member whose exact spelling is still on the roster keeps it, even if another spelling now shares its key.
export const linkedName=(player:string,roster:string[])=>roster.includes(player)?player:rosterMatch(player,roster);
