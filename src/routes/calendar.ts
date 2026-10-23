import html from '../pages/calendar.html';
import {env} from 'cloudflare:workers';
import { ROSTER } from '../lib/pickleball-config';
import {readSession,renewSession,linkedName} from '../lib/sign-in';
import {readCopy} from '../lib/reservation-copy';
import {database} from '../lib/database';
export const assetVersion=()=>(env.CF_VERSION_METADATA?.id??'').replace(/[^A-Za-z0-9-]/g,'')||'dev';
export async function GET(request: Request) {
 const session=await readSession(request),toLogin=()=>new Response(null,{status:302,headers:{Location:'/login','Cache-Control':'private, no-store'}});
 if(!session?.player)return toLogin();
 // Members follow the roster: a re-spelled name is adopted, a removed one goes back to the name step. Only the D1 copy is read (never Google), and a missing or empty roster changes nothing.
 if(!session.player.endsWith(' [guest]')){
  const roster=(await readCopy())?.data.roster,r=roster?.length?linkedName(session.player,roster):session.player,d=database();
  if(r===null||r==='duplicate'){await d.prepare('UPDATE sessions SET player=NULL WHERE sub=?').bind(session.sub).run();return toLogin();}
  if(r!==session.player){await d.batch([d.prepare('UPDATE links SET player=? WHERE sub=?').bind(r,session.sub),d.prepare('UPDATE sessions SET player=? WHERE sub=?').bind(r,session.sub)]);session.player=r;}
 }
 const body = html.replace('__CALENDAR_CONFIG__',()=>JSON.stringify({roster:ROSTER,player:session.player}).replace(/</g,'\\u003c')).replaceAll('__ASSET_VERSION__',assetVersion());
 const headers=new Headers({'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store'}),renewed=await renewSession(session,request);
 if(renewed)headers.append('Set-Cookie',renewed);
 return new Response(body,{headers});
}
