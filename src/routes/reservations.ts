import {json,sameOrigin,tooLarge,loadConnection} from '../lib/sheet-connection';
import {ROSTER} from '../lib/pickleball-config';
import {readSession} from '../lib/sign-in';
import {readSnapshot,buildSnapshot,applyRequest,ensureImported,type Snapshot} from '../lib/reservation-store';
import {RuleError,laYesterday} from '../lib/reservation-rules';
const MAX_OTHER_PLAYERS=7;
const DOWN='The calendar is temporarily unavailable. Please retry.';
// Rows dated before yesterday (Pacific) stay in D1 but never reach players, even from a snapshot stored before midnight.
const reply=(s:Snapshot)=>{const from=laYesterday();return {...s.data,matches:s.data.matches.filter(m=>m.date>=from),configured:true};};
export async function GET(request:Request){
 try{if(!(await readSession(request))?.player)return json({error:'Sign in to see reservations.'},401);const s=new URL(request.url).searchParams.get('fresh')==='1'?null:await readSnapshot();if(s)return json(reply(s));const c=await loadConnection();if(!c)return json({configured:false,roster:ROSTER,matches:[]});await ensureImported(c);return json(reply(await buildSnapshot()));}
 catch(error){console.error('Reservation read failed',error instanceof Error?error.message:'Unknown');return json({configured:true,error:DOWN},503);}
}
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
 if(['create','edit'].includes(p.action)){const m=p.reservation;if(!m||typeof m.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(m.date)||isNaN(Date.parse(m.date))||new Date(m.date).toISOString().slice(0,10)!==m.date||typeof m.start!=='string'||typeof m.end!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(m.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(m.end)||m.end<=m.start||typeof m.court!=='string'||!m.court.trim()||m.court.length>100||typeof m.notes!=='string'||m.notes.length>500||!Number.isInteger(m.capacity)||m.capacity<0)return json({error:'Check the reservation date, times, location and player limit.'},400);if(m.capacity>MAX_OTHER_PLAYERS)return json({error:'Choose up to 7 other players (8 on the court).'},400);}
 const connection=await loadConnection();if(!connection)return json({error:'Connect the Google Sheet before saving shared reservations.'},409);
 // Nothing is written if the import fails, so no uncertain flag: the client rolls the change back.
 try{await ensureImported(connection);}catch(error){console.error('Reservation import failed',error instanceof Error?error.message:'Unknown');return json({error:DOWN},503);}
 // A rule rejection applied nothing; any other failure may have landed, and the receipt makes the client's one re-send safe.
 try{return json(reply((await applyRequest(p,player)).snapshot));}catch(error){if(!(error instanceof RuleError))throw error;return json({error:error.message,...((error as {busy?:boolean}).busy?{busy:true}:{}),...reply(await buildSnapshot())},409);}
 }catch(error){console.error('Reservation write failed',error instanceof Error?error.name:'Unknown');return json({error:DOWN,uncertain:true},503);}
}
