import {waitUntil} from 'cloudflare:workers';
import {database,timed,type Timing} from './database';
import {invokeSheet,type SheetConnection} from './sheet-connection';
import {decide,fingerprint,moves,insertSql,updateSql,RuleError,MSG,laNow,laYesterday,practiceFor,type Outcome,type Reservation,type ReservationRequest} from './reservation-rules';
// D1 is the source of truth (migrations/0003). Every applied change bumps data_version; the reservations_copy row is the snapshot page loads read.
export type Roster={names:string[];officers:string[];at:number;refused?:{names:string[];officers:string[];at:number}};
export type Snapshot={version:number;data:{ok:true;apiVersion:2;matches:Reservation[];rosterSize:number;at:number};officers:string[]};
// ponytail: no LIMIT; the window (yesterday on) is a few dozen games, and the snapshot must stay under D1's 2 MB value cap.
export const WINDOW_SQL='SELECT * FROM reservations WHERE date >= ? AND cancelled_at IS NULL ORDER BY date, start_time, id';
export const ROSTER_DOWN="Can't check the club roster right now. Try again in a minute.";
export const ROSTER_SQL="SELECT value FROM app_settings WHERE key='roster'",SNAPSHOT_SQL="SELECT value FROM app_settings WHERE key='reservations_copy'",VERSION_SQL='SELECT version FROM data_version WHERE id=1',parse=(row:any)=>row?JSON.parse(row.value):null;
export const toReservation=(row:Record<string,any>):Reservation=>({id:row.id,date:row.date,start:row.start_time,end:row.end_time,court:row.court,capacity:row.capacity,...(practiceFor(row.id)?{kind:'practice' as const}:{}),host:row.host,players:JSON.parse(row.players),notes:row.notes,version:row.version});
export async function readRoster():Promise<Roster|null>{return parse(await database().prepare(ROSTER_SQL).first());}
// An old-format copy row ({savedAt,data}) reads as null, so the next page load builds a snapshot from D1.
export {parse as parseValue};
export function parseSnapshot(row:any):Snapshot|null{const s=parse(row);return Number.isInteger(s?.version)&&Array.isArray(s.data?.matches)&&Number.isInteger(s.data?.rosterSize)&&Array.isArray(s.officers)?s:null;}
// The three reads a snapshot is built from (version, window, roster), in that order.
export const snapshotReads=(d:D1Database)=>[d.prepare(VERSION_SQL),d.prepare(WINDOW_SQL).bind(laYesterday()),d.prepare(ROSTER_SQL)];
// Rows dated before yesterday (Pacific) stay in D1 but never reach players, even from a snapshot stored before midnight.
// The stored snapshot when it is current; one behind the data version is rebuilt for the caller and stored after the reply. null when there is no usable row.
export async function currentSnapshot(snap:any,ver:any,t:Timing):Promise<Snapshot|null>{const s=parseSnapshot(snap);return s&&(s.version>=(ver?.version??0)?s:await buildSnapshot(t,true));}
export const viewFor=(s:Snapshot,player:string)=>{const from=laYesterday();return {...s.data,matches:s.data.matches.filter(m=>m.date>=from),configured:true,officer:s.officers.includes(player)};};
const snapshotOf=(version:number,rows:any[],rosterRow:any):Snapshot=>{const roster:Roster|null=parse(rosterRow);return {version,data:{ok:true,apiVersion:2,matches:rows.map(toReservation),rosterSize:roster?.names.length??0,at:Date.now()},officers:roster?.officers??[]};};
// A build that read an older version never replaces a newer snapshot.
const storeSnapshot=(s:Snapshot)=>database().prepare("INSERT INTO app_settings (key,value) VALUES ('reservations_copy',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE json_extract(excluded.value,'$.version')>COALESCE(json_extract(app_settings.value,'$.version'),-1)").bind(JSON.stringify(s));
// Stored after the reply (waitUntil runs it even if the player disconnects); a failed store only logs, and the next read that finds the snapshot behind rebuilds it.
const storeLater=(s:Snapshot)=>{waitUntil(storeSnapshot(s).run().catch(e=>console.error('Snapshot write failed',e instanceof Error?e.message:'Unknown')));return s;};
// later: the reply doesn't wait for the store (a read healing a stale snapshot).
export async function buildSnapshot(t?:Timing,later=false):Promise<Snapshot>{
 const d=database(),[v,w,r]=await timed(t,d.batch<any>(snapshotReads(d))),s=snapshotOf(v.results[0].version,w.results,r.results[0]);
 if(later)return storeLater(s);await timed(t,storeSnapshot(s).run());return s;
}
// One try's reads, in this order: receipt, the game row (a create looks itself up by its request id), roster, snapshot, data version, and the games on the date sent (an edit's new date) for the court rules. The POST route batches them with its own reads, before checking the body.
export function saveReads(req:ReservationRequest):D1PreparedStatement[]{
 const d=database(),id=req.action==='create'?req.requestId:req.id;
 return [d.prepare('SELECT fingerprint FROM requests WHERE request_id=?').bind(req.requestId),d.prepare('SELECT * FROM reservations WHERE id=?').bind(typeof id==='string'?id:''),d.prepare(ROSTER_SQL),d.prepare(SNAPSHOT_SQL),d.prepare(VERSION_SQL),d.prepare("SELECT json_group_array(json_object('id',id,'start',start_time,'end',end_time,'court',court)) AS g FROM reservations WHERE date=? AND cancelled_at IS NULL AND id NOT GLOB 'practice-*'").bind(typeof (req.reservation as any)?.date==='string'?(req.reservation as any).date:'')];
}
// A create or a moved edit that a parallel save beat to the slot (SLOT_FREE) writes nothing, so it re-reads as a lost race and decide refuses it.
const write=(out:Exclude<Outcome,{kind:'none'}>,old:number|undefined,player:string,guard:boolean)=>{
 const d=database(),m=out.match,t=Date.now();
 if(out.kind==='insert')return d.prepare(insertSql(guard)).bind(m.id,m.date,m.start,m.end,m.court,m.capacity,m.host,JSON.stringify(m.players),m.notes,m.version,t,player);
 if(out.kind==='update')return d.prepare(updateSql(guard)).bind(m.id,m.date,m.start,m.end,m.court,m.capacity,JSON.stringify(m.players),m.notes,m.version,t,player,old);
 return d.prepare('UPDATE reservations SET cancelled_at=?,version=?,updated_at=?,updated_by=? WHERE id=? AND version=? AND cancelled_at IS NULL').bind(t,m.version,t,player,m.id,old);
};
// The write is guarded by the row version; changes() is the batch's previous statement, so a lost race writes no receipt and no version bump.
// A try is one read batch (the first may come from the caller's batch, `first`) and one write batch that reads the new snapshot back, so the reply needs no rebuild.
// ponytail: four optimistic tries (at most 8 D1 calls with the busy reply, 12 on the first-run import; a batch counts as one of the 50 allowed), then busy; the client re-sends with the same request id. A per-game queue needs Durable Objects, which the free plan lacks.
export async function applyRequest(req:ReservationRequest,player:string,first:any[]|null,t:Timing):Promise<{snapshot:Snapshot;wrote:boolean}>{
 const d=database(),fp=await fingerprint(req),create=req.action==='create';let latest=()=>buildSnapshot(t,true);
 // Every RuleError leaves with the current snapshot for its 409: the stored one when it isn't behind, else a rebuild; a busy one gets the last write batch's.
 try{
  for(let n=0;n<4;n++){
   const [receipt,row,roster,snap,ver,day]=n===0&&first?first:(await timed(t,d.batch<any>(saveReads(req)))).map(x=>x.results[0]),stored=parseSnapshot(snap);
   latest=async()=>stored&&stored.version>=ver.version?stored:buildSnapshot(t,true);
   if(receipt){if(receipt.fingerprint!==fp)throw new RuleError(MSG.retryDifferent);return {snapshot:await latest(),wrote:false};}
   const rost=parse(roster) as Roster|null,names=rost?.names;if(!names?.length)throw new RuleError(ROSTER_DOWN);
   const current=row&&(create||row.cancelled_at===null)?toReservation(row):null,out=decide(req,current,{now:laNow(),roster:names,officer:!!rost?.officers?.includes(player),games:JSON.parse(day?.g??'[]')});
   if(out.kind==='none')return {snapshot:await latest(),wrote:false};
   const res=await timed(t,d.batch<any>([write(out,current?.version,player,moves(req,current)),d.prepare('INSERT INTO requests (request_id,fingerprint,at) SELECT ?,?,? WHERE changes()=1').bind(req.requestId,fp,Date.now()),d.prepare('UPDATE data_version SET version=version+1 WHERE id=1 AND changes()=1'),...snapshotReads(d)])),s=snapshotOf(res[3].results[0].version,res[4].results,res[5].results[0]);
   // reservations must never get a trigger that writes: its changes would count here and a lost race would look applied.
   if(res[0].meta.changes===1)return {snapshot:storeLater(s),wrote:true};
   latest=async()=>s;
  }
  throw Object.assign(new RuleError(MSG.busy),{busy:true});
 }catch(e){throw e instanceof RuleError?Object.assign(e,{snapshot:await latest()}):e;}
}
// First run only: copy the Sheet's current rows (yesterday on, already tidied by invokeSheet) into D1. OR IGNORE and DO NOTHING make two concurrent first runs harmless.
// ponytail: no memo; a save reads the flag in its first batch (IMPORTED_SQL) and calls this only when it's missing. A table that already has rows only gets the flag.
export const IMPORTED_SQL="SELECT (SELECT 1 FROM app_settings WHERE key='reservations_imported') AS done,(SELECT 1 FROM reservations LIMIT 1) AS rows";
export async function ensureImported(connection:SheetConnection):Promise<void>{
 const d=database(),s:any=await d.prepare(IMPORTED_SQL).first(),flag=(rows:number)=>d.prepare("INSERT INTO app_settings (key,value) VALUES ('reservations_imported',?) ON CONFLICT(key) DO NOTHING").bind(JSON.stringify({at:Date.now(),rows}));
 if(s.done)return;if(s.rows){await flag(0).run();return;}
 const {matches,roster}=await invokeSheet(connection,{action:'list'}),t=Date.now();
 await d.batch([d.prepare("INSERT OR IGNORE INTO reservations (id,date,start_time,end_time,court,capacity,host,players,notes,version,updated_at,updated_by) SELECT json_extract(value,'$.id'),json_extract(value,'$.date'),json_extract(value,'$.start'),json_extract(value,'$.end'),json_extract(value,'$.court'),json_extract(value,'$.capacity'),json_extract(value,'$.host'),json_extract(value,'$.players'),COALESCE(json_extract(value,'$.notes'),''),json_extract(value,'$.version'),?,'import' FROM json_each(?)").bind(t,JSON.stringify(matches)),
  ...roster.length?[d.prepare("INSERT INTO app_settings (key,value) VALUES ('roster',?) ON CONFLICT(key) DO NOTHING").bind(JSON.stringify({names:roster,officers:[],at:t}))]:[],
  d.prepare('UPDATE data_version SET version=version+1 WHERE id=1'),flag(matches.length)]);
}
// ponytail: receipts live 7 days; a re-send after that would apply again (the client re-sends within seconds).
export async function pruneRequests():Promise<void>{await database().prepare('DELETE FROM requests WHERE at < ?').bind(Date.now()-7*864e5).run();}
