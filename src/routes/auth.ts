import {env} from 'cloudflare:workers';
import {database} from '../lib/database';
import {json,sameOrigin,tooLarge} from '../lib/sheet-connection';
import {canonicalPlayer,normalize} from '../lib/player-session';
import {attemptsAllowed} from '../lib/admin-access';
import {createSession,readSession,endSession,rosterNames,rosterMatch} from '../lib/sign-in';
const OAUTH='__Host-pb_oauth',NO_STORE='private, no-store',HD=['g.ucla.edu','ucla.edu'],ISS=['accounts.google.com','https://accounts.google.com'];
const b64=(n:number)=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(n)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const oauthCookie=(value:string,age:number)=>`${OAUTH}=${value}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`;
const go=(status:number,to:string,...cookies:string[])=>{const h=new Headers({Location:to,'Cache-Control':NO_STORE});for(const c of cookies)h.append('Set-Cookie',c);return new Response(null,{status,headers:h});};
const refuse=(e:string,reason:string,hd?:string)=>{console.warn('Sign-in refused: '+reason+(hd===undefined?'':' hd='+String(hd).slice(0,60)));return go(303,'/login?e='+e,oauthCookie('',0));};
export const configured=()=>!!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET);
export async function start(request:Request){
 if(!configured())return go(302,'/login?e=setup');
 const state=b64(16),nonce=b64(16),u=new URL('https://accounts.google.com/o/oauth2/v2/auth');
 for(const [k,v] of Object.entries({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:new URL('/auth/callback',request.url).href,response_type:'code',scope:'openid email profile',prompt:'select_account',state,nonce}))u.searchParams.set(k,v);
 return go(302,u.href,oauthCookie(state+'.'+nonce,600));
}
export async function callback(request:Request){
 if(!configured())return go(303,'/login?e=setup');
 const q=new URL(request.url).searchParams,mine=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(OAUTH+'='))?.slice(OAUTH.length+1)||'',[state,nonce]=mine.split('.');
 if(!state||!nonce||q.get('state')!==state){if((await readSession(request))?.player)return go(303,'/');return refuse('expired','state');}
 const code=q.get('code');if(q.get('error')||!code)return refuse('google','google error');
 let claims:any;
 try{
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:new URL('/auth/callback',request.url).href,grant_type:'authorization_code'}),signal:AbortSignal.timeout(10000)});
  if(!r.ok)return refuse('google','token endpoint '+r.status);
  const part=String(((await r.json()) as any)?.id_token||'').split('.')[1]||'',bin=atob(part.replace(/-/g,'+').replace(/_/g,'/'));
  claims=JSON.parse(new TextDecoder().decode(Uint8Array.from(bin,c=>c.charCodeAt(0))));
 }catch{return refuse('google','token exchange failed');}
 if(!claims||typeof claims!=='object'||claims.aud!==env.GOOGLE_CLIENT_ID||!ISS.includes(claims.iss)||!(claims.exp>Date.now()/1000)||typeof claims.sub!=='string'||!claims.sub||typeof claims.email!=='string'||!claims.email)return refuse('google','claims');
 if(claims.nonce!==nonce)return refuse('expired','nonce');
 if(claims.email_verified!==true)return refuse('account','email not verified');
 if(!HD.includes(claims.hd))return refuse('account','hd',claims.hd??'none');
 const sub=claims.sub as string,email=(claims.email as string).toLowerCase();
 if(await database().prepare('SELECT 1 FROM blocked WHERE sub=?').bind(sub).first())return refuse('blocked','blocked');
 // Linked member: the name must still be on the roster (stored with the roster's spelling); guests and unlinked accounts go to the name step.
 const link=await database().prepare('SELECT kind,player FROM links WHERE sub=?').bind(sub).first<{kind:string;player:string}>();
 const player=link?.kind==='member'?(m=>m==='duplicate'?null:m)(rosterMatch(link.player,(await rosterNames())||[])):null;
 return go(303,player?'/':'/login',await createSession(sub,email,player),oauthCookie('',0));
}
export async function logout(request:Request){
 if(!sameOrigin(request))return json({error:'This request is not allowed.'},403);
 // "Use a different account" posts next=google to go straight back to Google's account chooser; no other value is honored.
 const next=!tooLarge(request,1000)&&new URLSearchParams((await request.text()).slice(0,1000)).get('next')==='google';
 return go(303,next?'/auth/google':'/login',await endSession(request));
}
const fail=(status:number,code:string,error:string)=>json({error,code},status);
const MSG:Record<string,[number,string]>={signin:[401,'Sign in with Google first.'],invalid:[400,'Enter a first and a last name (up to 50 characters each, no brackets).'],'not-found':[404,"We couldn't find that name on the club roster. Check the spelling, or sign in as a guest."],taken:[409,"That name is linked to a different UCLA account. If it's yours, ask a club officer to reset it."],duplicate:[409,'Two roster names match. Ask a club officer.'],limit:[429,'Too many tries today. Sign in as a guest for now, or ask a club officer.'],'roster-name':[409,'That name is on the club roster. Use the Club tab.'],'guest-taken':[409,'Another UCLA account uses that guest name. Add a middle initial.'],roster:[503,"Can't check the club roster right now. Try again in a minute."]};
const refused=(code:string)=>fail(MSG[code][0],code,MSG[code][1]);
export async function name(request:Request){
 if(!sameOrigin(request))return json({error:'This request is not allowed.'},403);
 if(tooLarge(request,1000))return json({error:'Request is too large.'},413);
 const session=await readSession(request);if(!session)return refused('signin');
 const text=await request.text();if(text.length>1000)return json({error:'Request is too large.'},400);
 let body:any;try{body=JSON.parse(text);}catch{return refused('invalid');}
 const tab=body?.tab,first=typeof body?.first==='string'?body.first.trim().replace(/\s+/g,' '):'',last=typeof body?.last==='string'?body.last.trim().replace(/\s+/g,' '):'';
 if((tab!=='club'&&tab!=='guest')||!first||!last||first.length>50||last.length>50)return refused('invalid');
 const guest=tab==='guest',typed=first+' '+last,canon=guest?canonicalPlayer(typed+' [guest]',[]):typed;
 if(!canon)return refused('invalid');
 const roster=await rosterNames();if(!roster)return refused('roster');
 let player:string,key:string;
 if(guest){if(rosterMatch(typed,roster)!==null)return refused('roster-name');player=canon;key='guest:'+normalize(typed);}
 else{
  if(!await attemptsAllowed('name:'+session.sub,10,86400))return refused('limit');
  const m=rosterMatch(typed,roster);if(m===null)return refused('not-found');if(m==='duplicate')return refused('duplicate');
  player=m;key='member:'+normalize(m);
 }
 try{const d=database();await d.batch([d.prepare('INSERT INTO links (sub,kind,player,name_key,email,linked_at) VALUES (?,?,?,?,?,?) ON CONFLICT(sub) DO UPDATE SET kind=excluded.kind,player=excluded.player,name_key=excluded.name_key,email=excluded.email,linked_at=excluded.linked_at').bind(session.sub,guest?'guest':'member',player,key,session.email,Math.floor(Date.now()/1000)),d.prepare('UPDATE sessions SET player=? WHERE sub=?').bind(player,session.sub)]);}
 catch(error){if(/UNIQUE constraint failed: links\.name_key/.test(String((error as Error)?.message)+String((error as any)?.cause?.message)))return refused(guest?'guest-taken':'taken');throw error;}
 return json({ok:true});
}
