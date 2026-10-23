import {waitUntil} from 'cloudflare:workers';
import {json,sameOrigin,tooLarge,loadConnection,invokeSheet,playerError} from '../lib/sheet-connection';
import {ROSTER} from '../lib/pickleball-config';
import {readSession} from '../lib/sign-in';
import {readCopy,writeCopy,refreshCopy} from '../lib/reservation-copy';
const MAX_OTHER_PLAYERS=7;
export async function GET(request:Request){
 try{if(!(await readSession(request))?.player)return json({error:'Sign in to see reservations.'},401);const reply=(copy:{savedAt:number;data:object})=>json({...copy.data,configured:true,copyAge:Math.floor((Date.now()-copy.savedAt)/1000)}),copy=new URL(request.url).searchParams.get('fresh')==='1'?null:await readCopy();if(copy)return reply(copy);const connection=await loadConnection();if(!connection)return json({configured:false,roster:ROSTER,matches:[]});return reply(await refreshCopy(connection));}
 catch(error){console.error('Reservation read failed'+((error as any)?.cached?' (cached)':''),error instanceof Error?error.message:'Unknown');return json({configured:true,error:playerError(error)},503);}
}
export async function POST(request:Request){
 if(!sameOrigin(request))return json({error:'This request is not allowed.'},403);
 if(tooLarge(request,12000))return json({error:'Request is too large.'},413);
 try{
 const player=(await readSession(request))?.player;if(!player)return json({error:'Sign in before changing reservations.'},401);
 const raw=await request.text();if(raw.length>12000)return json({error:'Request is too large.'},400);const p=JSON.parse(raw)??{};
 if(!['create','edit','join','leave','cancel','remove'].includes(p.action)||typeof p.player!=='string'||p.player.length>120||typeof p.requestId!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(p.requestId))return json({error:'Invalid reservation request.'},400);
 if(p.player!==player)return json({error:'Your selected player changed. Choose your name again.'},403);
 if(p.action!=='create'&&(typeof p.id!=='string'||p.id.length>100))return json({error:'Invalid reservation.'},400);
 if(p.action==='join'&&p.id.startsWith('practice-')&&p.player.endsWith(' [guest]'))return json({error:'Club practice is NOT open to guests.'},403);
 if(p.action==='remove'&&(typeof p.target!=='string'||!p.target||p.target.length>120))return json({error:'Choose an attendee to remove.'},400);
 if(['create','edit'].includes(p.action)){const m=p.reservation;if(!m||typeof m.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(m.date)||isNaN(Date.parse(m.date))||new Date(m.date).toISOString().slice(0,10)!==m.date||typeof m.start!=='string'||typeof m.end!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(m.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(m.end)||m.end<=m.start||typeof m.court!=='string'||!m.court.trim()||m.court.length>100||typeof m.notes!=='string'||m.notes.length>500||!Number.isInteger(m.capacity)||m.capacity<0)return json({error:'Check the reservation date, times, location and player limit.'},400);if(m.capacity>MAX_OTHER_PLAYERS)return json({error:'Choose up to 7 other players (8 on the court).'},400);}
 const connection=await loadConnection();if(!connection)return json({error:'Connect the Google Sheet before saving shared reservations.'},409);
 const data=await invokeSheet(connection,{action:p.action,player,requestId:p.requestId,id:p.id,expectedVersion:p.expectedVersion,reservation:p.reservation,target:p.target});waitUntil(writeCopy(data));return json({...data,configured:true});
 }catch(error){if(error instanceof SyntaxError)return json({error:'Invalid request.'},400);if((error as any)?.rejected)console.log('Reservation rejected',error instanceof Error?error.message:'Unknown');else console.error('Reservation write not confirmed',error instanceof Error?error.message:'Unknown');return json({error:playerError(error),uncertain:(error as any)?.uncertain||undefined,busy:(error as any)?.busy||undefined,...(error as any)?.rejected&&(error as any).data},(error as any)?.rejected?409:503);}
}
