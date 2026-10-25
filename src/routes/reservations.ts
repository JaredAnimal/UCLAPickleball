import {json,sameOrigin,tooLarge,loadConnection} from '../lib/sheet-connection';
import {database,timing,timed,serverTiming,type Timing} from '../lib/database';
import {readSession,sessionQuery,sessionOf} from '../lib/sign-in';
import {buildSnapshot,applyRequest,ensureImported,parseSnapshot,viewFor,SNAPSHOT_SQL,VERSION_SQL} from '../lib/reservation-store';
import {RuleError} from '../lib/reservation-rules';
import {syncSoon} from '../lib/sheet-sync';
const MAX_OTHER_PLAYERS=7;
const DOWN='The calendar is temporarily unavailable. Please retry.';
// One D1 batch reads the session, the snapshot and the data version; a snapshot behind the version is rebuilt before the reply.
async function read(request:Request,t:Timing){
 try{const q=await sessionQuery(request);if(!q)return json({error:'Sign in to see reservations.'},401);
  const d=database(),[sess,snap,ver]=await timed(t,d.batch<any>([q.statement,d.prepare(SNAPSHOT_SQL),d.prepare(VERSION_SQL)])),player=sessionOf(q.hash,sess.results[0])?.player;if(!player)return json({error:'Sign in to see reservations.'},401);
  const s=new URL(request.url).searchParams.get('fresh')==='1'?null:parseSnapshot(snap.results[0]);if(s)return json(viewFor(s.version>=(ver.results[0]?.version??0)?s:await buildSnapshot(t),player));
  const c=await loadConnection();if(!c)return json({configured:false,rosterSize:0,matches:[]});await ensureImported(c);return json(viewFor(await buildSnapshot(t),player));}
 catch(error){console.error('Reservation read failed',error instanceof Error?error.message:'Unknown');return json({configured:true,error:DOWN},503);}
}
export async function GET(request:Request){const t=timing(),r=await read(request,t);r.headers.set('Server-Timing',serverTiming(t));return r;}
export async function POST(request:Request){
 if(!sameOrigin(request))return json({error:'This request is not allowed.'},403);
 if(tooLarge(request,12000))return json({error:'Request is too large.'},413);
 try{
 const player=(await readSession(request))?.player;if(!player)return json({error:'Sign in before changing reservations.'},401);
 const raw=await request.text();if(raw.length>12000)return json({error:'Request is too large.'},400);let p:any;try{p=JSON.parse(raw)??{};}catch{return json({error:'Invalid request.'},400);}
 if(!['create','edit','join','leave','cancel','remove'].includes(p.action)||typeof p.player!=='string'||p.player.length>120||typeof p.requestId!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(p.requestId))return json({error:'Invalid reservation request.'},400);
 if(p.player!==player)return json({error:"You're signed in as a different player now. Reload the page."},403);
 if(p.action!=='create'&&(typeof p.id!=='string'||p.id.length>100))return json({error:'Invalid reservation.'},400);
 if(p.action==='join'&&p.id.startsWith('practice-')&&p.player.endsWith(' [guest]'))return json({error:'Club practice is NOT open to guests.'},403);
 if(p.action==='remove'&&(typeof p.target!=='string'||!p.target||p.target.length>120))return json({error:'Choose an attendee to remove.'},400);
 if(p.action==='edit'&&p.remove!==undefined&&!(Array.isArray(p.remove)&&p.remove.length<=60&&p.remove.every((n:unknown)=>typeof n==='string'&&n&&n.length<=120)))return json({error:'Choose an attendee to remove.'},400);
 if(p.action==='edit'&&p.reservation===undefined&&p.remove===undefined)return json({error:'Invalid reservation request.'},400);
 if(p.action==='create'||p.action==='edit'&&p.reservation!==undefined){const m=p.reservation;if(!m||typeof m.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(m.date)||isNaN(Date.parse(m.date))||new Date(m.date).toISOString().slice(0,10)!==m.date||typeof m.start!=='string'||typeof m.end!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(m.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(m.end)||m.end<=m.start||typeof m.court!=='string'||!m.court.trim()||m.court.length>100||typeof m.notes!=='string'||m.notes.length>500||!Number.isInteger(m.capacity)||m.capacity<0)return json({error:'Check the reservation date, times, location and player limit.'},400);if(m.capacity>MAX_OTHER_PLAYERS)return json({error:'Choose up to 7 other players (8 on the court).'},400);}
 const connection=await loadConnection();if(!connection)return json({error:'Connect the Google Sheet before saving shared reservations.'},409);
 // Nothing is written if the import fails, so no uncertain flag: the client rolls the change back.
 try{await ensureImported(connection);}catch(error){console.error('Reservation import failed',error instanceof Error?error.message:'Unknown');return json({error:DOWN},503);}
 // A rule rejection applied nothing; any other failure may have landed, and the receipt makes the client's one re-send safe.
 try{const {snapshot,wrote}=await applyRequest(p,player);if(wrote)syncSoon();return json(viewFor(snapshot,player));}catch(error){if(!(error instanceof RuleError))throw error;return json({error:error.message,...((error as {busy?:boolean}).busy?{busy:true}:{}),...viewFor(await buildSnapshot(),player)},409);}
 }catch(error){console.error('Reservation write failed',error instanceof Error?error.name:'Unknown');return json({error:DOWN,uncertain:true},503);}
}
