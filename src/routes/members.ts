import {isOwner} from '../lib/admin-access';
import {json,sameOrigin,tooLarge} from '../lib/sheet-connection';
import {database} from '../lib/database';
import {rosterNames,rosterMatch,readSession} from '../lib/sign-in';
import {readRoster} from '../lib/reservation-store';
import {syncHealth,acceptRefusedRoster} from '../lib/sheet-sync';
const DENIED='Only club officers and the site owner can manage members.',OFFICER_ONLY='Only the site owner can unlink or block an officer.';
// The owner cookie, or a session whose player is on the Roster tab's officer list.
async function viewer(request:Request,officers:string[]):Promise<'owner'|'officer'|null>{
 if(await isOwner(request))return 'owner';
 const player=(await readSession(request))?.player;return player&&officers.includes(player)?'officer':null;
}
// A member link's roster name is rosterMatch, falling back to the stored player; guests are never officers.
const officerLink=(l:{kind:string;player:string},roster:string[]|null,officers:string[])=>{const m=roster&&l.kind==='member'?rosterMatch(l.player,roster):null;return l.kind==='member'&&officers.includes(m&&m!=='duplicate'?m:l.player);};
export async function GET(request:Request){
 const officers=(await readRoster())?.officers??[],who=await viewer(request,officers);
 if(!who)return json({error:DENIED},403);
 const d=database(),roster=await rosterNames();
 const links=((await d.prepare('SELECT sub,kind,player,email,linked_at FROM links ORDER BY linked_at DESC, sub').all()).results as any[]).map(l=>({sub:l.sub,kind:l.kind,player:l.player,email:l.email,linkedAt:l.linked_at,...(()=>{const m=roster&&l.kind==='member'?rosterMatch(l.player,roster):undefined,rosterName=m==null||m==='duplicate'?null:m;return {rosterName,onRoster:roster&&l.kind==='member'?rosterName!==null:null,officer:officerLink(l,roster,officers)};})()}));
 const blocked=((await d.prepare('SELECT sub,email,blocked_at FROM blocked ORDER BY blocked_at DESC, sub').all()).results as any[]).map(b=>({sub:b.sub,email:b.email,blockedAt:b.blocked_at}));
 return json({viewer:who,roster,links,blocked,sync:await syncHealth()});
}
export async function POST(request:Request){
 const officers=(await readRoster())?.officers??[],who=await viewer(request,officers);
 if(!who)return json({error:DENIED},403);
 if(!sameOrigin(request))return json({error:'This request is not allowed.'},403);
 if(tooLarge(request,2000))return json({error:'Request is too large.'},413);
 let p:any;try{const raw=await request.text();if(raw.length>2000)return json({error:'Request is too large.'},413);p=JSON.parse(raw);}catch{return json({error:'Invalid request.'},400);}
 const action=p?.action,sub=p?.sub;
 if(action==='accept-roster'){const r=await acceptRefusedRoster();return r==='none'?json({error:'No new roster is waiting.'},409):r==='empty'?json({error:'The new roster is empty. Fix the Roster tab first.'},409):json({ok:true});}
 if(!['unlink','block','unblock'].includes(action)||typeof sub!=='string'||!sub||sub.length>200)return json({error:'Invalid request.'},400);
 const d=database();
 if(action==='unblock')await d.prepare('DELETE FROM blocked WHERE sub=?').bind(sub).run();
 else{
  const link=await d.prepare('SELECT kind,player,email FROM links WHERE sub=?').bind(sub).first<{kind:string;player:string;email:string}>();
  if(who==='officer'&&link&&officerLink(link,await rosterNames(),officers))return json({error:OFFICER_ONLY},403);
  const email=(link??(await d.prepare('SELECT email FROM sessions WHERE sub=? LIMIT 1').bind(sub).first<{email:string}>()))?.email??'';
  await d.batch([d.prepare('DELETE FROM links WHERE sub=?').bind(sub),d.prepare('DELETE FROM sessions WHERE sub=?').bind(sub),...action==='block'?[d.prepare('INSERT OR REPLACE INTO blocked (sub,email,blocked_at) VALUES (?,?,?)').bind(sub,email,Math.floor(Date.now()/1000))]:[]]);
 }
 return json({ok:true});
}
