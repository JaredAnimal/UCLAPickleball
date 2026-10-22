import {json,sameOrigin,loadConnection,invokeSheet} from '../lib/sheet-connection';
import {ROSTER} from '../lib/pickleball-config';
import {sessionPlayer} from '../lib/player-session';
import {readCopy,writeCopy} from '../lib/reservation-copy';
import {readOnlyPreview,previewCalendar} from '../lib/preview-calendar';
export async function GET(request:Request){
 try{if(readOnlyPreview())return json({...await previewCalendar(request),configured:true});const [connection,copy]=await Promise.all([loadConnection(),readCopy()]);if(!connection)return json({configured:false,roster:ROSTER,matches:[]});if(copy&&new URL(request.url).searchParams.get('fresh')!=='1')return json({...copy.data,configured:true,copyAge:Math.floor((Date.now()-copy.savedAt)/1000)});const startedAt=Date.now(),data=await invokeSheet(connection,{action:'list'});await writeCopy(data,startedAt);return json({...data,configured:true,copyAge:0});}
 catch(error){console.error('Reservation read failed',error instanceof Error?error.message:'Unknown');return json({configured:true,error:error instanceof Error?error.message:'Could not load shared reservations.'},503);}
}
export async function POST(request:Request){
 if(!sameOrigin(request))return json({error:'This request is not allowed.'},403);
 if(readOnlyPreview())return json({error:'This preview is read-only. Use the live calendar to change reservations.'},403);
 const player=await sessionPlayer(request);if(!player)return json({error:'Choose your player name before changing reservations.'},401);
 try{
 const raw=await request.text();if(raw.length>12000)return json({error:'Request is too large.'},400);const p=JSON.parse(raw)??{};
 if(!['create','edit','join','leave','cancel','remove'].includes(p.action)||typeof p.player!=='string'||p.player.length>120||typeof p.requestId!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(p.requestId))return json({error:'Invalid reservation request.'},400);
 if(p.player!==player)return json({error:'Your selected player changed. Choose your name again.'},403);
 if(p.action!=='create'&&(typeof p.id!=='string'||p.id.length>100))return json({error:'Invalid reservation.'},400);
 if(p.action==='join'&&p.id.startsWith('practice-')&&p.player.endsWith(' [guest]'))return json({error:'Club practice is NOT open to guests.'},403);
 if(p.action==='remove'&&(typeof p.target!=='string'||!p.target||p.target.length>120))return json({error:'Choose an attendee to remove.'},400);
 if(['create','edit'].includes(p.action)){const m=p.reservation;if(!m||typeof m.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(m.date)||isNaN(Date.parse(m.date))||new Date(m.date).toISOString().slice(0,10)!==m.date||typeof m.start!=='string'||typeof m.end!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(m.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(m.end)||m.end<=m.start||typeof m.court!=='string'||!m.court.trim()||m.court.length>100||typeof m.notes!=='string'||m.notes.length>500||!Number.isInteger(m.capacity)||m.capacity<0||m.capacity>499)return json({error:'Check the reservation date, times, location and player limit.'},400);}
 const connection=await loadConnection();if(!connection)return json({error:'Connect the Google Sheet before saving shared reservations.'},409);
 const data=await invokeSheet(connection,{action:p.action,player,requestId:p.requestId,id:p.id,expectedVersion:p.expectedVersion,reservation:p.reservation,target:p.target});await writeCopy(data);return json({...data,configured:true});
 }catch(error){if(error instanceof SyntaxError)return json({error:'Invalid request.'},400);console.error('Reservation write not confirmed',error instanceof Error?error.message:'Unknown');return json({error:error instanceof Error?error.message:'Could not confirm the update. Refresh before retrying.'},503);}
}
