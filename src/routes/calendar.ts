import html from '../pages/calendar.html';
import {env} from 'cloudflare:workers';
import {sessionQuery,sessionOf,renewSession,linkedName} from '../lib/sign-in';
import {database,timing,timed,serverTiming,type Timing} from '../lib/database';
import {ROSTER_SQL,SNAPSHOT_SQL,VERSION_SQL,parseValue,currentSnapshot,viewFor} from '../lib/reservation-store';
export const assetVersion=()=>(env.CF_VERSION_METADATA?.id??'').replace(/[^A-Za-z0-9-]/g,'')||'dev';
// The page arrives with the games: one D1 batch reads the session, roster, snapshot and data version, and the config carries the same reply /api/reservations gives this player (omitted when no snapshot row exists; the client then fetches). A snapshot behind the version is rebuilt first and stored after the reply.
export async function GET(request: Request) {
 const t=timing(),r=await page(request,t);r.headers.set('Server-Timing',serverTiming(t));return r;
}
async function page(request:Request,t:Timing){
 const toLogin=()=>new Response(null,{status:302,headers:{Location:'/login','Cache-Control':'private, no-store'}}),q=await sessionQuery(request);
 if(!q)return toLogin();
 const d=database(),[sess,rost,snap,ver]=await timed(t,d.batch<any>([q.statement,d.prepare(ROSTER_SQL),d.prepare(SNAPSHOT_SQL),d.prepare(VERSION_SQL)])),session=sessionOf(q.hash,sess.results[0]);
 if(!session?.player)return toLogin();
 // Members follow the roster: a re-spelled name is adopted, a removed one goes back to the name step. Only the D1 roster is read (never Google), and a missing, empty or unreadable roster changes nothing.
 if(!session.player.endsWith(' [guest]')){
  let roster:string[]|null=null;try{const n=parseValue(rost.results[0])?.names;roster=n?.length?n:null;}catch{}
  const r=roster?linkedName(session.player,roster):session.player;
  if(r===null||r==='duplicate'){await d.prepare('UPDATE sessions SET player=NULL WHERE sub=?').bind(session.sub).run();return toLogin();}
  if(r!==session.player){await d.batch([d.prepare('UPDATE links SET player=? WHERE sub=?').bind(r,session.sub),d.prepare('UPDATE sessions SET player=? WHERE sub=?').bind(r,session.sub)]);session.player=r;}
 }
 const s=await currentSnapshot(snap.results[0],ver.results[0],t).catch(()=>null),body = html.replace('__CALENDAR_CONFIG__',()=>JSON.stringify({player:session.player,...s?{reservations:viewFor(s,session.player!)}:{}}).replace(/</g,'\\u003c')).replaceAll('__ASSET_VERSION__',assetVersion());
 const headers=new Headers({'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store'}),renewed=renewSession(session,request);
 if(renewed)headers.append('Set-Cookie',renewed);
 return new Response(body,{headers});
}
