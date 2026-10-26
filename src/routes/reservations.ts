import {json,sameOrigin,tooLarge,loadConnection} from '../lib/sheet-connection';
import {database,timing,timed,serverTiming,type Timing} from '../lib/database';
import {sessionQuery,sessionOf} from '../lib/sign-in';
import {buildSnapshot,currentSnapshot,applyRequest,ensureImported,viewFor,saveReads,SNAPSHOT_SQL,VERSION_SQL,IMPORTED_SQL,type Snapshot} from '../lib/reservation-store';
import {RuleError} from '../lib/reservation-rules';
import {syncSoon} from '../lib/sheet-sync';
const MAX_OTHER_PLAYERS=8;
const DOWN='The calendar is temporarily unavailable. Please retry.',SIGN_IN='Sign in before changing reservations.',NOT_CONNECTED='Connect the Google Sheet before saving shared reservations.';
const CONNECTED_SQL="SELECT 1 AS ok FROM app_settings WHERE key='google_sheets'";
// One D1 batch reads the session, the snapshot and the data version; a snapshot behind the version is rebuilt for the reply and stored after it, so a failed store never fails the poll.
async function read(request:Request,t:Timing){
 try{const q=await sessionQuery(request);if(!q)return json({error:'Sign in to see reservations.'},401);
  const u=new URL(request.url).searchParams,ids=[...new Set((u.get('receipts')??'').split(',').filter(x=>/^[a-zA-Z0-9_-]{16,100}$/.test(x)))].slice(0,20),d=database(),[sess,snap,ver,rec]=await timed(t,d.batch<any>([q.statement,d.prepare(SNAPSHOT_SQL),d.prepare(VERSION_SQL),...ids.length?[d.prepare('SELECT request_id FROM requests WHERE request_id IN ('+ids.map(()=>'?').join(',')+')').bind(...ids)]:[]])),player=sessionOf(q.hash,sess.results[0])?.player;if(!player)return json({error:'Sign in to see reservations.'},401);
  // Receipts: which asked request ids were applied (a client checking its unsure saves).
  const R=rec?{receipts:rec.results.map((x:any)=>x.request_id)}:{},s=u.get('fresh')==='1'?null:await currentSnapshot(snap.results[0],ver.results[0],t);if(s)return json({...viewFor(s,player),...R});
  const c=await loadConnection();if(!c)return json({configured:false,rosterSize:0,matches:[],...R});await ensureImported(c);return json({...viewFor(await buildSnapshot(t),player),...R});}
 catch(error){console.error('Reservation read failed',error instanceof Error?error.message:'Unknown');return json({configured:true,error:DOWN},503);}
}
export async function GET(request:Request){const t=timing(),r=await read(request,t);r.headers.set('Server-Timing',serverTiming(t));return r;}
// A save is two D1 round trips: one batch reads the session, the connection row, the import flag and applyRequest's first try; the write batch returns the new snapshot. Only the first-run import decrypts the connection.
async function save(request:Request,t:Timing,log:{action:string;outcome:string}){
 if(!sameOrigin(request))return json({error:'This request is not allowed.'},403);
 if(tooLarge(request,12000))return json({error:'Request is too large.'},413);
 try{
 const q=await sessionQuery(request);if(!q)return json({error:SIGN_IN},401);
 const raw=await request.text();let p:any;try{if(raw.length<=12000)p=JSON.parse(raw)??{};}catch{}
 const bad=raw.length>12000?'Request is too large.':p===undefined?'Invalid request.':!['create','edit','join','leave','cancel','remove'].includes(p.action)||typeof p.player!=='string'||p.player.length>120||typeof p.requestId!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(p.requestId)?'Invalid reservation request.':'';
 // A bad body costs one session read, so a caller without a live session still gets 401.
 if(bad)return sessionOf(q.hash,await timed(t,q.statement.first()))?.player?json({error:bad},400):json({error:SIGN_IN},401);
 log.action=p.action;
 const d=database(),[sess,connected,imported,...first]=(await timed(t,d.batch<any>([q.statement,d.prepare(CONNECTED_SQL),d.prepare(IMPORTED_SQL),...saveReads(p)]))).map(x=>x.results[0]),player=sessionOf(q.hash,sess)?.player;
 if(!player)return json({error:SIGN_IN},401);
 if(p.player!==player)return json({error:"You're signed in as a different player now. Reload the page."},403);
 if(p.action!=='create'&&(typeof p.id!=='string'||p.id.length>100))return json({error:'Invalid reservation.'},400);
 if(p.action==='join'&&p.id.startsWith('practice-')&&p.player.endsWith(' [guest]'))return json({error:'Club practice is NOT open to guests.'},403);
 if(p.action==='remove'&&(typeof p.target!=='string'||!p.target||p.target.length>120))return json({error:'Choose an attendee to remove.'},400);
 if(p.action==='edit'&&p.remove!==undefined&&!(Array.isArray(p.remove)&&p.remove.length<=60&&p.remove.every((n:unknown)=>typeof n==='string'&&n&&n.length<=120)))return json({error:'Choose an attendee to remove.'},400);
 if(p.action==='edit'&&p.reservation===undefined&&p.remove===undefined)return json({error:'Invalid reservation request.'},400);
 if(p.action==='create'||p.action==='edit'&&p.reservation!==undefined){const m=p.reservation;if(!m||typeof m.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(m.date)||isNaN(Date.parse(m.date))||new Date(m.date).toISOString().slice(0,10)!==m.date||typeof m.start!=='string'||typeof m.end!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(m.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(m.end)||m.end<=m.start||typeof m.court!=='string'||!m.court.trim()||m.court.length>100||typeof m.notes!=='string'||m.notes.length>500||!Number.isInteger(m.capacity)||m.capacity<0)return json({error:'Check the reservation date, times, location and player limit.'},400);if(m.capacity>MAX_OTHER_PLAYERS)return json({error:'Choose up to 7 other players (8 on the court).'},400);}
 if(!connected)return json({error:NOT_CONNECTED},409);
 // First run only (no import flag): decrypt the connection and copy the Sheet in; applyRequest then reads for itself. Nothing is written if the import fails, so no uncertain flag: the client rolls the change back.
 if(!imported?.done){const c=await loadConnection();if(!c)return json({error:NOT_CONNECTED},409);try{await ensureImported(c);}catch(error){log.outcome='failed';console.error('Reservation import failed',error instanceof Error?error.message:'Unknown');return json({error:DOWN},503);}}
 // A rule rejection applied nothing; any other failure may have landed, and the receipt makes the client's one re-send safe.
 try{const {snapshot,wrote}=await applyRequest(p,player,imported?.done?first:null,t);log.outcome=wrote?'applied':'unchanged';if(wrote)syncSoon();return json(viewFor(snapshot,player));}
 catch(error){if(!(error instanceof RuleError))throw error;const {busy,snapshot}=error as RuleError&{busy?:boolean;snapshot?:Snapshot};log.outcome=busy?'busy':'refused';return json({error:error.message,...busy?{busy:true}:{},...viewFor(snapshot??await buildSnapshot(t),player)},409);}
 }catch(error){log.outcome='failed';console.error('Reservation write failed',error instanceof Error?error.name:'Unknown');return json({error:DOWN,uncertain:true},503);}
}
// One log line per save that reached D1 (outcome applied|unchanged|refused|busy|failed), with times and never names.
export async function POST(request:Request){
 const t=timing(),log={action:'',outcome:'refused'},r=await save(request,t,log);r.headers.set('Server-Timing',serverTiming(t));
 if(log.action)console.log(`save ${log.action} ${log.outcome} total=${Date.now()-t.start}ms d1=${t.d1}ms trips=${t.trips}`);return r;
}
