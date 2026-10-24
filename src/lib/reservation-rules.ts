// Reservation rules ported from pickleball-apps-script.gs (doPost, validate_, practice_, guest_). No imports and erasable TypeScript only, so Node can strip the types for scripts/validate-rules.mjs.
export type Reservation={id:string;date:string;start:string;end:string;court:string;capacity:number|null;kind?:'practice';host:string;players:string[];notes:string;version:number};
export type Draft={date:string;start:string;end:string;court:string;capacity:number;notes:string};
export type ReservationRequest={action:'create'|'edit'|'join'|'leave'|'cancel'|'remove';player:string;requestId:string;id?:string;expectedVersion?:unknown;reservation?:unknown;target?:unknown};
export type Outcome={kind:'none'}|{kind:'insert'|'update'|'cancel';match:Reservation};
// A rejection: nothing was applied.
export class RuleError extends Error{}
export const MSG={notMember:'Choose a club player or enter a guest name.',guestPractice:'Club practice is NOT open to guests.',practiceId:'Practice IDs are reserved.',practiceEnded:'This practice has ended.',practiceFixed:'Weekly club practices cannot be edited or canceled.',idTaken:'Reservation ID already exists.',gone:'This reservation no longer exists. Refresh the calendar.',hostOnly:'Only the host can change this match or remove players.',started:'This match has already started.',changed:'This match changed while you were editing. Refresh before saving.',capacityBelow:'Capacity cannot be lower than the current signup count.',alreadyHost:'You are already the host.',full:'The last spot has been filled. Refresh the calendar.',badTarget:'Choose an attendee to remove.',badDate:'Choose a valid date.',badTimes:'End time must be after start time.',pastStart:'Choose a future start time.',badText:'Check the location and notes.',badCapacity:'Choose up to 7 other players (8 on the court).',busy:'Another player is updating the calendar. Try again.',retryDifferent:'The retry contains different data. Refresh and try again.'} as const;
const fail=(m:string):never=>{throw new RuleError(m)};
const LA=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const parts=(ms:number)=>Object.fromEntries(LA.formatToParts(ms).map(p=>[p.type,p.value]));
export const laNow=(ms=Date.now()):string=>{const p=parts(ms);return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`};
export const laYesterday=(ms=Date.now()):string=>{const p=parts(ms);return new Date(Date.parse(`${p.year}-${p.month}-${p.day}`)-864e5).toISOString().slice(0,10)};
export const isGuest=(name:unknown):boolean=>typeof name==='string'&&name.endsWith(' [guest]')&&name.length<=109&&name.slice(0,-8).trim().split(/\s+/).length>=2&&!/[\[\]\p{C}]/u.test(name.slice(0,-8));
export function practiceFor(id:unknown):Reservation|null{
 if(typeof id!=='string'||!/^practice-\d{4}-\d{2}-\d{2}$/.test(id))return null;
 const date=id.slice(9),d=new Date(date+'T12:00:00Z');if(isNaN(+d)||d.toISOString().slice(0,10)!==date)return null;
 const day=d.getUTCDay();if(day!==0&&day!==4)return null;
 return {id,kind:'practice',date,start:day===4?'17:00':'15:00',end:day===4?'19:00':'17:00',court:'Club practice',capacity:null,host:'Club practice',players:[],notes:'Weekly club practice. NOT open to guests.',version:1};
}
export function validate(p:unknown,now:string,rosterSize:number):Draft{
 const q=p as Record<string,any>|null;
 if(!q||typeof q.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(q.date)||isNaN(Date.parse(q.date))||new Date(q.date).toISOString().slice(0,10)!==q.date)return fail(MSG.badDate);
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(q.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(q.end)||q.end<=q.start)return fail(MSG.badTimes);
 if(q.date+'T'+q.start<=now)return fail(MSG.pastStart);
 if(typeof q.court!=='string'||!q.court.trim()||q.court.length>100||typeof q.notes!=='string'||q.notes.length>500)return fail(MSG.badText);
 if(!Number.isInteger(q.capacity)||q.capacity<0||q.capacity>Math.min(7,Math.max(0,rosterSize-1)))return fail(MSG.badCapacity);
 return {date:q.date,start:q.start,end:q.end,court:q.court.trim(),capacity:q.capacity,notes:q.notes.trim()};
}
// Mirrors doPost's checks in order; officers (new) get host powers and may remove players from practices. Never mutates `current`; for create, `current` is the row whose id equals requestId.
export function decide(req:ReservationRequest,current:Reservation|null,ctx:{now:string;roster:string[];officer:boolean}):Outcome{
 const {action,player}=req,{now,roster,officer}=ctx;
 if(!roster.includes(player)&&!isGuest(player))fail(MSG.notMember);
 if(action==='join'&&practiceFor(req.id)&&isGuest(player))fail(MSG.guestPractice);
 if(action==='create'&&req.requestId.startsWith('practice-'))fail(MSG.practiceId);
 let match=current,fresh=false;
 if(action==='join'&&!match){const pr=practiceFor(req.id);if(pr){if(pr.date+'T'+pr.end<=now)fail(MSG.practiceEnded);match=pr;fresh=true}}
 const practice=!!match&&(match.kind==='practice'||!!practiceFor(match.id));
 if(practice&&(action==='edit'||action==='cancel'||action==='remove'&&!officer))fail(MSG.practiceFixed);
 if(action==='create'){
  if(match)return match.host===player?{kind:'none'}:fail(MSG.idTaken);
  return {kind:'insert',match:{id:req.requestId,...validate(req.reservation,now,roster.length),host:player,players:[],version:1}};
 }
 if(!match)return action==='cancel'?{kind:'none'}:fail(MSG.gone);
 if((action==='edit'||action==='cancel'||action==='remove')&&match.host!==player&&!officer)fail(MSG.hostOnly);
 if(action!=='cancel'&&action!=='remove'&&match.date+'T'+(practice?match.end:match.start)<=now)fail(MSG.started);
 const next:Reservation={...match,players:[...match.players]};
 if(action==='edit'){
  if(Number(req.expectedVersion)!==match.version)fail(MSG.changed);
  const d=validate(req.reservation,now,roster.length);if(d.capacity<match.players.length)fail(MSG.capacityBelow);Object.assign(next,d);
 }else if(action==='join'){
  if(!practice&&match.host===player)fail(MSG.alreadyHost);
  if(!next.players.includes(player)){if(!practice&&next.players.length>=(match.capacity as number))fail(MSG.full);next.players.push(player)}
 }else if(action==='remove'){
  const t=req.target;if(typeof t!=='string'||t===match.host||t.length>120)fail(MSG.badTarget);next.players=next.players.filter(n=>n!==t);
 }else if(action==='leave')next.players=next.players.filter(n=>n!==player);
 next.version++;
 return {kind:action==='cancel'?'cancel':fresh?'insert':'update',match:next};
}
// The roster guard: a blank or mostly emptied Sheet roster never replaces the last good one.
export function rosterVerdict(next:{names:string[];officers:string[]},last:{names:string[];officers:string[]}|null):'same'|'accept'|'refuse'{
 if(!next.names.length)return 'refuse';
 if(last&&JSON.stringify([next.names,next.officers])===JSON.stringify([last.names,last.officers]))return 'same';
 return last&&next.names.length*2<last.names.length?'refuse':'accept';
}
// Same digest as the script, so a retry is recognised across both paths.
export async function fingerprint(req:ReservationRequest):Promise<string>{
 const {action,player,id,expectedVersion,reservation,target}=req;
 return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({action,player,id,expectedVersion,reservation,target}))))));
}
