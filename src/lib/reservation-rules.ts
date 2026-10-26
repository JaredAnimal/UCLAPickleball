// Reservation rules ported from pickleball-apps-script.gs (doPost, validate_, practice_, guest_). No imports and erasable TypeScript only, so Node can strip the types for scripts/validate-rules.mjs.
export type Reservation={id:string;date:string;start:string;end:string;court:string;capacity:number|null;kind?:'practice';host:string;hostPlays:boolean;players:string[];notes:string;version:number};
export type Draft={date:string;start:string;end:string;court:string;capacity:number;hostPlays:boolean;notes:string};
export type ReservationRequest={action:'create'|'edit'|'join'|'leave'|'cancel'|'remove';player:string;requestId:string;id?:string;expectedVersion?:unknown;reservation?:unknown;target?:unknown;before?:unknown;remove?:unknown};
export type Outcome={kind:'none'}|{kind:'insert'|'update'|'cancel';match:Reservation};
// A rejection: nothing was applied.
export class RuleError extends Error{}
export const MSG={notMember:'Choose a club player or enter a guest name.',guestPractice:'Club practice is NOT open to guests.',practiceId:'Practice IDs are reserved.',practiceEnded:'This practice has ended.',practiceFixed:'Weekly club practices cannot be edited or canceled.',idTaken:'Reservation ID already exists.',gone:'This reservation no longer exists. Refresh the calendar.',hostOnly:'Only the host can change this match or remove players.',started:'This match has already started.',changed:'This match changed while you were editing. Refresh before saving.',capacityBelow:'Capacity cannot be lower than the current signup count.',alreadyHost:'You are already the host.',full:'The last spot has been filled. Refresh the calendar.',badTarget:'Choose an attendee to remove.',badDate:'Choose a valid date.',badTimes:'End time must be after start time.',pastStart:'Choose a future start time.',badText:'Check the location and notes.',badCapacity:'Choose up to 7 other players (8 on the court).',badCapacitySitOut:'Choose 1 to 8 spots (8 on the court).',busy:'Another player is updating the calendar. Try again.',retryDifferent:'The retry contains different data. Refresh and try again.',courtFull:'That court already has 4 games then. Pick another time.'} as const;
const fail=(m:string):never=>{throw new RuleError(m)};
const DETAILS=['date','start','end','court','capacity','hostPlays','notes'] as const;
// Names leaving a game: up to 60 strings of up to 120 characters, never the host; names not in it are ignored.
const leaving=(list:unknown,host:string):Set<string>=>Array.isArray(list)&&list.length<=60&&list.every(n=>typeof n==='string'&&n.length<=120&&n!==host)?new Set(list):fail(MSG.badTarget);
const LA=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const parts=(ms:number)=>Object.fromEntries(LA.formatToParts(ms).map(p=>[p.type,p.value]));
export const laNow=(ms=Date.now()):string=>{const p=parts(ms);return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`};
export const laYesterday=(ms=Date.now()):string=>{const p=parts(ms);return new Date(Date.parse(`${p.year}-${p.month}-${p.day}`)-864e5).toISOString().slice(0,10)};
// Unix seconds of today's 00:00 in Los Angeles; midnight is 07:00Z (PDT) or 08:00Z (PST) on the local date.
export const pacificMidnight=(ms=Date.now()):number=>{const p=parts(ms),day=Date.parse(`${p.year}-${p.month}-${p.day}`);return ([7,8].map(h=>day+h*36e5).find(t=>parts(t).hour==='00'&&parts(t).minute==='00'&&parts(t).day===p.day)!)/1000};
export const isGuest=(name:unknown):boolean=>typeof name==='string'&&name.endsWith(' [guest]')&&name.length<=109&&name.slice(0,-8).trim().split(/\s+/).length>=2&&!/[\[\]\p{C}]/u.test(name.slice(0,-8));
export function practiceFor(id:unknown):Reservation|null{
 if(typeof id!=='string'||!/^practice-\d{4}-\d{2}-\d{2}$/.test(id))return null;
 const date=id.slice(9),d=new Date(date+'T12:00:00Z');if(isNaN(+d)||d.toISOString().slice(0,10)!==date)return null;
 const day=d.getUTCDay();if(day!==0&&day!==4)return null;
 return {id,kind:'practice',date,start:day===4?'17:00':'15:00',end:day===4?'19:00':'17:00',court:'Club practice',capacity:null,host:'Club practice',hostPlays:true,players:[],notes:'Weekly club practice. NOT open to guests.',version:1};
}
type Slot=Pick<Reservation,'id'|'start'|'end'|'court'>;
// A court's location key: any court named "Sunset Rec…" ("Sunset Rec · Court 2") is Sunset Rec, else the trimmed lowercase text. LOC is the same in SQL (JS trims more whitespace, so it is never less strict).
const courtOf=(c:string)=>(c=c.trim().toLowerCase()).startsWith('sunset rec')?'sunset rec':c;
const LOC=(x:string)=>`CASE WHEN lower(trim(${x})) LIKE 'sunset rec%' THEN 'sunset rec' ELSE lower(trim(${x})) END`;
// Court rules (SLOT_FREE repeats the 4-limit in SQL for the write): no game at Sunset Rec during that day's practice, checked first; at most 4 other games running at once at the court (start inclusive, end exclusive). `games` are the day's games; practice rows never count.
export function slotProblem(r:Omit<Slot,'id'>&{date:string},games:Slot[],selfId:string|null):'courtFull'|'practice'|null{
 const c=courtOf(r.court),p=practiceFor('practice-'+r.date);if(c==='sunset rec'&&p&&r.start<p.end&&p.start<r.end)return 'practice';
 const others=games.filter(o=>o.id!==selfId&&!o.id.startsWith('practice-')&&courtOf(o.court)===c);
 return [r.start,...others.map(o=>o.start).filter(t=>r.start<t&&t<r.end)].some(t=>others.filter(o=>o.start<=t&&t<o.end).length>=4)?'courtFull':null;
}
// slotProblem's 4-limit in SQL over ?1 id, ?2 date, ?3 start, ?4 end, ?5 court, for the write's WHERE (race-safe): no instant (the start, or another game's start inside this one) where 4 other games already run.
export const SLOT_FREE=`NOT EXISTS (SELECT 1 FROM (SELECT ?3 AS t UNION SELECT start_time FROM reservations WHERE date=?2 AND cancelled_at IS NULL AND id<>?1 AND id NOT GLOB 'practice-*' AND ${LOC('court')}=${LOC('?5')} AND start_time>?3 AND start_time<?4) p WHERE (SELECT count(*) FROM reservations r WHERE r.date=?2 AND r.cancelled_at IS NULL AND r.id<>?1 AND r.id NOT GLOB 'practice-*' AND ${LOC('r.court')}=${LOC('?5')} AND r.start_time<=p.t AND r.end_time>p.t)>=4)`;
// The writes reservation-store.ts runs; guard (a create or a moved edit) adds SLOT_FREE. Insert binds id,date,start,end,court,capacity,host,players,notes,version,updated_at,updated_by,host_plays; update binds id,date,start,end,court,capacity,players,notes,version,updated_at,updated_by, then the old version, then host_plays.
export const insertSql=(guard:boolean)=>`INSERT INTO reservations (id,date,start_time,end_time,court,capacity,host,players,notes,version,updated_at,updated_by,host_plays) SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13 WHERE ${guard?SLOT_FREE:'1'} ON CONFLICT(id) DO NOTHING`;
export const updateSql=(guard:boolean)=>`UPDATE reservations SET date=?2,start_time=?3,end_time=?4,court=?5,capacity=?6,players=?7,notes=?8,version=?9,updated_at=?10,updated_by=?11,host_plays=?13 WHERE id=?1 AND version=?12 AND cancelled_at IS NULL${guard?' AND '+SLOT_FREE:''}`;
export function practiceMsg(date:string):string{const p=practiceFor('practice-'+date)!,h=(t:string)=>+t.slice(0,2)%12||12;return `That’s club practice time (${new Date(date+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'short',timeZone:'UTC'})} ${h(p.start)}–${h(p.end)} ${+p.end.slice(0,2)<12?'AM':'PM'}). Pick another time.`;}
// The court rules run on creates and on edits that move a game: a new date, start, end or court (as sent). Notes/capacity-only edits and joins skip them.
export const moves=(req:ReservationRequest,cur:Reservation|null):boolean=>req.action==='create'||req.action==='edit'&&req.reservation!==undefined&&!!cur&&(['date','start','end','court'] as const).some(k=>(req.reservation as any)?.[k]!==cur[k]);
export function validate(p:unknown,now:string,rosterSize:number,stored=true):Draft{
 const q=p as Record<string,any>|null;
 if(!q||typeof q.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(q.date)||isNaN(Date.parse(q.date))||new Date(q.date).toISOString().slice(0,10)!==q.date)return fail(MSG.badDate);
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(q.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(q.end)||q.end<=q.start)return fail(MSG.badTimes);
 if(q.date+'T'+q.start<=now)return fail(MSG.pastStart);
 if(typeof q.court!=='string'||!q.court.trim()||q.court.length>100||typeof q.notes!=='string'||q.notes.length>500)return fail(MSG.badText);
 if(q.hostPlays!==undefined&&typeof q.hostPlays!=='boolean')return fail(MSG.badCapacity);
 const hostPlays:boolean=q.hostPlays??stored;
 if(!Number.isInteger(q.capacity)||(hostPlays?q.capacity<0||q.capacity>Math.min(7,Math.max(0,rosterSize-1)):q.capacity<1||q.capacity>Math.min(8,rosterSize)))return fail(hostPlays?MSG.badCapacity:MSG.badCapacitySitOut);
 return {date:q.date,start:q.start,end:q.end,court:q.court.trim(),capacity:q.capacity,hostPlays,notes:q.notes.trim()};
}
// Mirrors doPost's checks in order; officers (new) get host powers and may remove players from practices. Never mutates `current`; for create, `current` is the row whose id equals requestId.
export function decide(req:ReservationRequest,current:Reservation|null,ctx:{now:string;roster:string[];officer:boolean;games?:Slot[]}):Outcome{
 const {action,player}=req,{now,roster,officer}=ctx,courtRules=(r:Reservation)=>{const x=moves(req,current)&&slotProblem(r,ctx.games??[],r.id);return x?fail(x==='practice'?practiceMsg(r.date):MSG.courtFull):r};
 if(!roster.includes(player)&&!isGuest(player))fail(MSG.notMember);
 if(action==='join'&&practiceFor(req.id)&&isGuest(player))fail(MSG.guestPractice);
 if(action==='create'&&req.requestId.startsWith('practice-'))fail(MSG.practiceId);
 let match=current,fresh=false;
 if(action==='join'&&!match){const pr=practiceFor(req.id);if(pr){if(pr.date+'T'+pr.end<=now)fail(MSG.practiceEnded);match=pr;fresh=true}}
 const practice=!!match&&(match.kind==='practice'||!!practiceFor(match.id));
 const details=action==='edit'&&req.reservation!==undefined;
 if(practice&&(action==='cancel'||details||(action==='edit'||action==='remove')&&!officer))fail(MSG.practiceFixed);
 if(action==='create'){
  if(match)return match.host===player?{kind:'none'}:fail(MSG.idTaken);
  return {kind:'insert',match:courtRules({id:req.requestId,...validate(req.reservation,now,roster.length),host:player,players:[],version:1})};
 }
 if(!match)return action==='cancel'?{kind:'none'}:fail(MSG.gone);
 if((action==='edit'||action==='cancel'||action==='remove')&&match.host!==player&&!officer)fail(MSG.hostOnly);
 if(action!=='cancel'&&action!=='remove'&&!(action==='edit'&&!details)&&match.date+'T'+(practice?match.end:match.start)<=now)fail(MSG.started);
 const next:Reservation={...match,players:[...match.players]};
 if(action==='edit'){
  if(details&&(req.before!==undefined?DETAILS.some(k=>(k!=='hostPlays'||(req.before as any)?.hostPlays!==undefined)&&(req.before as any)?.[k]!==match[k]):Number(req.expectedVersion)!==match.version))fail(MSG.changed);
  const out=leaving(req.remove??[],match.host);next.players=next.players.filter(n=>!out.has(n));
  if(details||req.remove===undefined){const d=validate(req.reservation,now,roster.length,match.hostPlays!==false);if(d.capacity<next.players.length)fail(MSG.capacityBelow);courtRules(Object.assign(next,d));}
 }else if(action==='join'){
  if(!practice&&match.host===player)fail(MSG.alreadyHost);
  if(!next.players.includes(player)){if(!practice&&next.players.length>=(match.capacity as number))fail(MSG.full);next.players.push(player)}
 }else if(action==='remove'){
  const out=leaving([req.target],match.host);next.players=next.players.filter(n=>!out.has(n));
 }else if(action==='leave')next.players=next.players.filter(n=>n!==player);
 if(action!=='cancel'&&JSON.stringify(next)===JSON.stringify(match))return {kind:'none'};
 next.version++;
 return {kind:action==='cancel'?'cancel':fresh?'insert':'update',match:next};
}
// The roster guard: a blank or mostly emptied Sheet roster never replaces the last good one.
export function rosterVerdict(next:{names:string[];officers:string[]},last:{names:string[];officers:string[]}|null):'same'|'accept'|'refuse'{
 if(!next.names.length)return 'refuse';
 if(last&&JSON.stringify([next.names,next.officers])===JSON.stringify([last.names,last.officers]))return 'same';
 return last&&next.names.length*2<last.names.length?'refuse':'accept';
}
// Same digest as the script for the old request shapes (the script never digests `before` or `remove`), so a retry is recognised across both paths.
export async function fingerprint(req:ReservationRequest):Promise<string>{
 const {action,player,id,expectedVersion,reservation,target,before,remove}=req;
 return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({action,player,id,expectedVersion,reservation,target,before,remove}))))));
}
