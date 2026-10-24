import {database} from './database';
import {decide,fingerprint,RuleError,MSG,laNow,laYesterday,practiceFor,type Outcome,type Reservation,type ReservationRequest} from './reservation-rules';
// D1 is the source of truth (migrations/0003). Every applied change bumps data_version; the reservations_copy row is the snapshot page loads read.
export type Roster={names:string[];officers:string[];at:number;refused?:{names:string[];officers:string[];at:number}};
export type Snapshot={version:number;data:{ok:true;apiVersion:2;matches:Reservation[];roster:string[];at:number};officers:string[]};
// ponytail: no LIMIT; the window (yesterday on) is a few dozen games, and the snapshot must stay under D1's 2 MB value cap.
export const WINDOW_SQL='SELECT * FROM reservations WHERE date >= ? AND cancelled_at IS NULL ORDER BY date, start_time, id';
export const ROSTER_DOWN="Can't check the club roster right now. Try again in a minute.";
const ROSTER_SQL="SELECT value FROM app_settings WHERE key='roster'",parse=(row:any)=>row?JSON.parse(row.value):null;
export const toReservation=(row:Record<string,any>):Reservation=>({id:row.id,date:row.date,start:row.start_time,end:row.end_time,court:row.court,capacity:row.capacity,...(practiceFor(row.id)?{kind:'practice' as const}:{}),host:row.host,players:JSON.parse(row.players),notes:row.notes,version:row.version});
export async function readRoster():Promise<Roster|null>{return parse(await database().prepare(ROSTER_SQL).first());}
// An old-format copy row ({savedAt,data}) reads as null, so the next page load builds a snapshot from D1.
export async function readSnapshot():Promise<Snapshot|null>{const s=parse(await database().prepare("SELECT value FROM app_settings WHERE key='reservations_copy'").first());return Number.isInteger(s?.version)&&Array.isArray(s.data?.matches)&&Array.isArray(s.data?.roster)&&Array.isArray(s.officers)?s:null;}
export async function buildSnapshot():Promise<Snapshot>{
 const d=database(),[v,w,r]=await d.batch<any>([d.prepare('SELECT version FROM data_version WHERE id=1'),d.prepare(WINDOW_SQL).bind(laYesterday()),d.prepare(ROSTER_SQL)]),roster:Roster|null=parse(r.results[0]);
 const s:Snapshot={version:v.results[0].version,data:{ok:true,apiVersion:2,matches:w.results.map(toReservation),roster:roster?.names??[],at:Date.now()},officers:roster?.officers??[]};
 // A build that read an older version never replaces a newer snapshot.
 await d.prepare("INSERT INTO app_settings (key,value) VALUES ('reservations_copy',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE json_extract(excluded.value,'$.version')>COALESCE(json_extract(app_settings.value,'$.version'),-1)").bind(JSON.stringify(s)).run();
 return s;
}
const write=(out:Exclude<Outcome,{kind:'none'}>,old:number|undefined,player:string)=>{
 const d=database(),m=out.match,t=Date.now();
 if(out.kind==='insert')return d.prepare('INSERT INTO reservations (id,date,start_time,end_time,court,capacity,host,players,notes,version,updated_at,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(m.id,m.date,m.start,m.end,m.court,m.capacity,m.host,JSON.stringify(m.players),m.notes,m.version,t,player);
 if(out.kind==='update')return d.prepare('UPDATE reservations SET date=?,start_time=?,end_time=?,court=?,capacity=?,players=?,notes=?,version=?,updated_at=?,updated_by=? WHERE id=? AND version=? AND cancelled_at IS NULL').bind(m.date,m.start,m.end,m.court,m.capacity,JSON.stringify(m.players),m.notes,m.version,t,player,m.id,old);
 return d.prepare('UPDATE reservations SET cancelled_at=?,version=?,updated_at=?,updated_by=? WHERE id=? AND version=? AND cancelled_at IS NULL').bind(t,m.version,t,player,m.id,old);
};
// The write is guarded by the row version; changes() is the batch's previous statement, so a lost race writes no receipt and no version bump.
// ponytail: two optimistic tries, then busy (the client re-sends with the same request id); a per-game queue needs Durable Objects, which the free plan lacks.
export async function applyRequest(req:ReservationRequest,player:string):Promise<{snapshot:Snapshot;wrote:boolean}>{
 const d=database(),fp=await fingerprint(req),create=req.action==='create',id=create?req.requestId:req.id;
 for(let n=0;n<2;n++){
  const [receipt,row,roster]=(await d.batch<any>([d.prepare('SELECT fingerprint FROM requests WHERE request_id=?').bind(req.requestId),d.prepare('SELECT * FROM reservations WHERE id=?').bind(id),d.prepare(ROSTER_SQL)])).map(x=>x.results[0]);
  if(receipt){if(receipt.fingerprint!==fp)throw new RuleError(MSG.retryDifferent);return {snapshot:await buildSnapshot(),wrote:false};}
  const names=(parse(roster) as Roster|null)?.names;if(!names?.length)throw new RuleError(ROSTER_DOWN);
  const current=row&&(create||row.cancelled_at===null)?toReservation(row):null,out=decide(req,current,{now:laNow(),roster:names,officer:false});
  if(out.kind==='none')return {snapshot:await buildSnapshot(),wrote:false};
  const [w]=await d.batch([write(out,current?.version,player),d.prepare('INSERT INTO requests (request_id,fingerprint,at) SELECT ?,?,? WHERE changes()=1').bind(req.requestId,fp,Date.now()),d.prepare('UPDATE data_version SET version=version+1 WHERE id=1 AND changes()=1')]);
  if(w.meta.changes===1)return {snapshot:await buildSnapshot(),wrote:true};
 }
 throw Object.assign(new RuleError(MSG.busy),{busy:true});
}
// ponytail: receipts live 7 days; a re-send after that would apply again (the client re-sends within seconds).
export async function pruneRequests():Promise<void>{await database().prepare('DELETE FROM requests WHERE at < ?').bind(Date.now()-7*864e5).run();}
