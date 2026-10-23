import {database} from './database';
import {loadConnection} from './sheet-connection';
import {readCopy,refreshCopy} from './reservation-copy';

export type Session={hash:string;sub:string;email:string;player:string|null;expiresAt:number;renewedAt:number};
export const SESSION_COOKIE='__Host-pb_s';
const LIFE=7776000,RENEW_AFTER=86400,now=()=>Math.floor(Date.now()/1000);
const cookie=(token:string,age:number)=>`${SESSION_COOKIE}=${token}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`;
const sha256=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
const tokenOf=(request:Request)=>{const v=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(SESSION_COOKIE+'='))?.slice(SESSION_COOKIE.length+1);return v&&/^[A-Za-z0-9_-]{43}$/.test(v)?v:null;};
export async function createSession(sub:string,email:string,player:string|null):Promise<string>{
 const token=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''),t=now();
 await database().prepare('INSERT INTO sessions (token_hash,sub,email,player,expires_at,renewed_at) VALUES (?,?,?,?,?,?)').bind(await sha256(token),sub,email,player,t+LIFE,t).run();
 return cookie(token,LIFE);
}
export async function readSession(request:Request):Promise<Session|null>{
 const token=tokenOf(request);if(!token)return null;const hash=await sha256(token);
 const r=await database().prepare('SELECT sub,email,player,expires_at,renewed_at FROM sessions WHERE token_hash=? AND expires_at>?').bind(hash,now()).first<{sub:string;email:string;player:string|null;expires_at:number;renewed_at:number}>();
 return r?{hash,sub:r.sub,email:r.email,player:r.player,expiresAt:r.expires_at,renewedAt:r.renewed_at}:null;
}
// The cookie holds the token, but only its hash is stored, so a renewal re-sends the cookie only when the caller hands back the request's token.
export async function renewSession(session:Session,request:Request):Promise<string|null>{
 const t=now();if(t-session.renewedAt<=RENEW_AFTER)return null;
 await database().prepare('UPDATE sessions SET expires_at=?,renewed_at=? WHERE token_hash=?').bind(t+LIFE,t,session.hash).run();
 const token=tokenOf(request);return token?cookie(token,LIFE):null;
}
export async function setSessionPlayer(hash:string,player:string):Promise<void>{await database().prepare('UPDATE sessions SET player=? WHERE token_hash=?').bind(player,hash).run();}
export async function endSession(request:Request):Promise<string>{
 const token=tokenOf(request);if(token)await database().prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(token)).run();
 return cookie('',0);
}
export async function endAllSessions(sub:string):Promise<void>{await database().prepare('DELETE FROM sessions WHERE sub=?').bind(sub).run();}
export async function deleteExpiredSessions():Promise<void>{await database().prepare('DELETE FROM sessions WHERE expires_at<=?').bind(now()).run();}
// Roster from the D1 copy (null with no Sheet connected), refreshed from the Sheet when missing or older than 5 minutes (as the old player-session did); null when none can be had.
export async function rosterNames():Promise<string[]|null>{
 try{
  const connection=await loadConnection();if(!connection)return null;
  const copy=await readCopy();if(copy&&Date.now()-copy.savedAt<=300000)return copy.data.roster;
  try{return (await refreshCopy(connection)).data.roster;}catch{return copy?.data.roster??null;}
 }catch{return null;}
}
