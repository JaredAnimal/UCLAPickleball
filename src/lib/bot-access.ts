import {env} from 'cloudflare:workers';

export const BOT_COOKIE='pickleball_bot_access';
const SESSION_SECONDS=8*60*60;
const bytes=(value:string)=>new TextEncoder().encode(value);
const hex=(value:ArrayBuffer)=>Array.from(new Uint8Array(value),b=>b.toString(16).padStart(2,'0')).join('');
async function signature(value:string){
 if(!env.BOT_SESSION_SECRET)throw new Error('Bot access is not configured.');
 const key=await crypto.subtle.importKey('raw',bytes(env.BOT_SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return hex(await crypto.subtle.sign('HMAC',key,bytes(value)));
}
function equal(a:string,b:string){let mismatch=a.length^b.length;for(let i=0;i<b.length;i++)mismatch|=(a.charCodeAt(i)||0)^b.charCodeAt(i);return mismatch===0;}
export async function passwordMatches(password:string){
 if(!env.BOT_DOWNLOAD_PASSWORD||!env.BOT_SESSION_SECRET)throw new Error('Bot access is not configured.');
 const a=hex(await crypto.subtle.digest('SHA-256',bytes(password))),b=hex(await crypto.subtle.digest('SHA-256',bytes(env.BOT_DOWNLOAD_PASSWORD)));
 return equal(a,b);
}
export async function issueBotSession(viewerId:string){const expires=Math.floor(Date.now()/1000)+SESSION_SECONDS;return `${expires}.${await signature(viewerId+':'+expires)}`;}
export async function hasBotAccess(request:Request,viewerId:string){
 const token=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(BOT_COOKIE+'='))?.slice(BOT_COOKIE.length+1);
 if(!token||!/^\d{10}\.[a-f0-9]{64}$/.test(token))return false;
 const [expires,sig]=token.split('.'),now=Math.floor(Date.now()/1000);
 if(Number(expires)<=now||Number(expires)>now+SESSION_SECONDS)return false;
 return equal(sig,await signature(viewerId+':'+expires));
}
export const botCookie=(value:string,maxAge=SESSION_SECONDS)=>`${BOT_COOKIE}=${value}; Path=/bot; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
