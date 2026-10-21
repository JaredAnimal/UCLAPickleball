import {env} from 'cloudflare:workers';

const TTL=8*60*60;
const context='pickleball-player:';
const bytes=(s:string)=>new TextEncoder().encode(s);
const hex=(v:ArrayBuffer)=>Array.from(new Uint8Array(v),b=>b.toString(16).padStart(2,'0')).join('');
const encode=(s:string)=>btoa(String.fromCharCode(...bytes(s))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const decode=(s:string)=>new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)));
const normalize=(s:string)=>s.trim().replace(/\s+/g,' ').toLowerCase();
export function canonicalPlayer(value:unknown,roster:string[]):string|null{
 if(typeof value!=='string'||!value||value.length>120)return null;
 const member=roster.find(name=>normalize(name)===normalize(value));if(member)return member;
 if(!value.endsWith(' [guest]')||value.length>109)return null;
 const name=value.slice(0,-8).trim().replace(/\s+/g,' ');
 if(name.split(' ').length<2||/[\[\]\p{C}]/u.test(value.slice(0,-8)))return null;
 return name+' [guest]';
}
async function signingKey(){
 if(!env.BOT_SESSION_SECRET)throw new Error('Player sessions are unavailable.');
 return crypto.subtle.importKey('raw',bytes(env.BOT_SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
export async function issuePlayerSession(player:string){
 const expires=Math.floor(Date.now()/1000)+TTL,payload=encode(JSON.stringify({player,expires}));
 const signature=hex(await crypto.subtle.sign('HMAC',await signingKey(),bytes(context+payload)));
 return {player,token:payload+'.'+signature,expires};
}
export async function sessionPlayer(request:Request):Promise<string|null>{
 try{
  const token=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{1,512}\.[a-f0-9]{64})$/)?.[1];if(!token)return null;
  const [payload,signature]=token.split('.');
  const valid=await crypto.subtle.verify('HMAC',await signingKey(),Uint8Array.from(signature.match(/../g)!,v=>parseInt(v,16)),bytes(context+payload));
  if(!valid)return null;
  const claims=JSON.parse(decode(payload)),now=Math.floor(Date.now()/1000);
  if(typeof claims.player!=='string'||!claims.player||claims.player.length>120||!Number.isInteger(claims.expires)||claims.expires<=now||claims.expires>now+TTL)return null;
  return claims.player;
 }catch{return null;}
}
