import {isOwner} from '../lib/admin-access';
import {json,sameOrigin,tooLarge} from '../lib/sheet-connection';
import {database} from '../lib/database';
import {rosterNames,rosterMatch} from '../lib/sign-in';
const DENIED='Only the site owner can manage members.';
export async function GET(request:Request){
 if(!await isOwner(request))return json({error:DENIED},403);
 const d=database(),roster=await rosterNames();
 const links=((await d.prepare('SELECT sub,kind,player,email,linked_at FROM links ORDER BY linked_at DESC, sub').all()).results as any[]).map(l=>({sub:l.sub,kind:l.kind,player:l.player,email:l.email,linkedAt:l.linked_at,...(()=>{const m=roster&&l.kind==='member'?rosterMatch(l.player,roster):undefined,rosterName=m==null||m==='duplicate'?null:m;return {rosterName,onRoster:roster&&l.kind==='member'?rosterName!==null:null};})()}));
 const blocked=((await d.prepare('SELECT sub,email,blocked_at FROM blocked ORDER BY blocked_at DESC, sub').all()).results as any[]).map(b=>({sub:b.sub,email:b.email,blockedAt:b.blocked_at}));
 return json({roster,links,blocked});
}
export async function POST(request:Request){
 if(!await isOwner(request))return json({error:DENIED},403);
 if(!sameOrigin(request))return json({error:'This request is not allowed.'},403);
 if(tooLarge(request,2000))return json({error:'Request is too large.'},413);
 let p:any;try{const raw=await request.text();if(raw.length>2000)return json({error:'Request is too large.'},413);p=JSON.parse(raw);}catch{return json({error:'Invalid request.'},400);}
 const action=p?.action,sub=p?.sub;if(!['unlink','block','unblock'].includes(action)||typeof sub!=='string'||!sub||sub.length>200)return json({error:'Invalid request.'},400);
 const d=database();
 if(action==='unblock')await d.prepare('DELETE FROM blocked WHERE sub=?').bind(sub).run();
 else{
  const email=((await d.prepare('SELECT email FROM links WHERE sub=?').bind(sub).first<{email:string}>())??(await d.prepare('SELECT email FROM sessions WHERE sub=? LIMIT 1').bind(sub).first<{email:string}>()))?.email??'';
  await d.batch([d.prepare('DELETE FROM links WHERE sub=?').bind(sub),d.prepare('DELETE FROM sessions WHERE sub=?').bind(sub),...action==='block'?[d.prepare('INSERT OR REPLACE INTO blocked (sub,email,blocked_at) VALUES (?,?,?)').bind(sub,email,Math.floor(Date.now()/1000))]:[]]);
 }
 return json({ok:true});
}
