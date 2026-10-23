import {env} from 'cloudflare:workers';
import {database} from '../lib/database';
import {json,sameOrigin} from '../lib/sheet-connection';
import {normalize} from '../lib/player-session';
import {createSession,readSession,endSession,rosterNames} from '../lib/sign-in';
const OAUTH='__Host-pb_oauth',NO_STORE='private, no-store',HD=['g.ucla.edu','ucla.edu'],ISS=['accounts.google.com','https://accounts.google.com'];
const b64=(n:number)=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(n)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const oauthCookie=(value:string,age:number)=>`${OAUTH}=${value}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`;
const go=(status:number,to:string,...cookies:string[])=>{const h=new Headers({Location:to,'Cache-Control':NO_STORE});for(const c of cookies)h.append('Set-Cookie',c);return new Response(null,{status,headers:h});};
const refuse=(e:string,reason:string,hd?:string)=>{console.warn('Sign-in refused: '+reason+(hd===undefined?'':' hd='+String(hd).slice(0,60)));return go(303,'/login?e='+e,oauthCookie('',0));};
const configured=()=>!!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET);
export async function start(request:Request){
 if(!configured())return go(302,'/login?e=setup');
 const state=b64(16),nonce=b64(16),u=new URL('https://accounts.google.com/o/oauth2/v2/auth');
 for(const [k,v] of Object.entries({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:new URL('/auth/callback',request.url).href,response_type:'code',scope:'openid email profile',prompt:'select_account',state,nonce}))u.searchParams.set(k,v);
 return go(302,u.href,oauthCookie(state+'.'+nonce,600));
}
export async function callback(request:Request){
 if(!configured())return go(303,'/login?e=setup');
 if((await readSession(request))?.player)return go(303,'/');
 const q=new URL(request.url).searchParams,mine=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(OAUTH+'='))?.slice(OAUTH.length+1)||'',[state,nonce]=mine.split('.');
 if(!state||!nonce||q.get('state')!==state)return refuse('expired','state');
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
 const player=link?.kind==='member'?(await rosterNames())?.find(n=>normalize(n)===normalize(link.player))??null:null;
 return go(303,player?'/':'/login',await createSession(sub,email,player),oauthCookie('',0));
}
export async function logout(request:Request){
 if(!sameOrigin(request))return json({error:'This request is not allowed.'},403);
 return go(303,'/login',await endSession(request));
}
