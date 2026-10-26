import html from '../pages/login.html';
import {database} from '../lib/database';
import {readSession} from '../lib/sign-in';
import {configured} from './auth';
import {assetVersion} from './calendar';
const ERRORS:Record<string,string>={account:"Your Google account’s email isn’t verified yet. Verify it with Google, then try again.",busy:'Too many sign-ins from this network. Try again in an hour.',blocked:"This account can't sign in here. Ask a club officer.",expired:'Sign-in timed out. Try again.',google:"Google didn't finish signing you in. Try again.",setup:"Sign-in isn't set up yet."};
// Stage 'google' without a session, 'name' with one that has no player yet; a saved guest name comes back on the Guest tab, split at the first space.
export async function GET(request:Request){
 const session=await readSession(request);
 if(session?.player)return new Response(null,{status:302,headers:{Location:'/','Cache-Control':'private, no-store'}});
 const saved=session&&(await database().prepare("SELECT player FROM links WHERE sub=? AND kind='guest'").bind(session.sub).first<{player:string}>())?.player.replace(/ \[guest\]$/,'')||'',i=saved.indexOf(' '),e=new URL(request.url).searchParams.get('e')||'';
 const config={stage:session?'name':'google',...session&&{email:session.email},tab:saved?'guest':'club',first:i<0?saved:saved.slice(0,i),last:i<0?'':saved.slice(i+1),...Object.hasOwn(ERRORS,e)&&{error:ERRORS[e]},ready:configured()};
 const body=html.replace('__LOGIN_CONFIG__',()=>JSON.stringify(config).replace(/</g,'\\u003c')).replaceAll('__ASSET_VERSION__',assetVersion());
 return new Response(body,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store'}});
}
