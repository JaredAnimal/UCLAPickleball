import {waitUntil} from 'cloudflare:workers';
import {database} from './database';
import {loadConnection,syncCall,type SheetConnection} from './sheet-connection';
import {WINDOW_SQL,toReservation,buildSnapshot,type Roster} from './reservation-store';
import {laYesterday,rosterVerdict} from './reservation-rules';
// The Sheet mirrors D1: a run pushes the window (yesterday on) when the data version moved past the last confirmed push, and pulls the Roster tab's names and officer flags through the roster guard.
export type SyncState={pushed:number;okAt:number|null;error:string|null;failingSince:number|null};
const VERSION_SQL='SELECT version FROM data_version WHERE id=1',STATE_SQL="SELECT value FROM app_settings WHERE key='sheet_sync'",ROSTER_SQL="SELECT value FROM app_settings WHERE key='roster'";
const parse=(row:any)=>row?JSON.parse(row.value):null,message=(error:unknown)=>error instanceof Error?error.message:'Unknown',fresh:SyncState={pushed:0,okAt:null,error:null,failingSince:null};
const save=(s:SyncState)=>database().prepare("INSERT INTO app_settings (key,value) VALUES ('sheet_sync',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(s));
// ponytail: per-isolate dedupe and failure memory: one background run at a time (plus one more pass for saves made during it) and a 60 s pause after a failed call. Other isolates keep their own; a save missed here waits for the minute job.
let lastFail=0,running:Promise<void>|null=null,again=false;
export async function syncSheet(connection:SheetConnection):Promise<void>{
 const d=database(),from=laYesterday(),now=Date.now();
 // ponytail: one read per run; split it if reads ever matter.
 const [v,s,w,f,r]=(await d.batch<any>([d.prepare(VERSION_SQL),d.prepare(STATE_SQL),d.prepare(WINDOW_SQL).bind(from),d.prepare("SELECT 1 FROM app_settings WHERE key='reservations_imported'"),d.prepare(ROSTER_SQL)])).map(x=>x.results);
 // Until the import has run, an empty D1 could clear the Sheet's window, so the run only asks for the roster.
 const version:number=v[0].version,state:SyncState=parse(s[0])??fresh,last:Roster|null=parse(r[0]),push=f.length>0&&version>state.pushed;
 const reply=await syncCall(connection,push?{action:'sync',version,from,rows:w.map(row=>({...toReservation(row),updatedAt:new Date(row.updated_at).toISOString()}))}:{action:'sync'})
  .catch(async error=>{await save({...state,error:message(error),failingSince:state.failingSince??now}).run();lastFail=now;throw error;});
 const pushed=push&&reply.mirrored>=version?version:state.pushed,next={names:reply.roster,officers:reply.officers},verdict=rosterVerdict(next,last);
 // A D1 below the script's mirror_version (a fresh database, a Time Travel restore, a local reset against TEST) would have every push skipped: jump past it, and the next run's push applies.
 const below=reply.mirrored>version,refusedNew=!!last&&JSON.stringify([last.refused?.names,last.refused?.officers])!==JSON.stringify([next.names,next.officers]);
 const roster=verdict==='accept'?[d.prepare("INSERT INTO app_settings (key,value) VALUES ('roster',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify({...next,at:reply.at})),d.prepare('UPDATE data_version SET version=version+1 WHERE id=1')]
  :verdict==='refuse'?refusedNew?[d.prepare("UPDATE app_settings SET value=json_set(value,'$.refused',json(?)) WHERE key='roster'").bind(JSON.stringify({...next,at:reply.at}))]:[]
  :last?.refused?[d.prepare("UPDATE app_settings SET value=json_remove(value,'$.refused') WHERE key='roster'")]:[];
 await d.batch([...below?[d.prepare('UPDATE data_version SET version=? WHERE id=1 AND version<?').bind(reply.mirrored+1,reply.mirrored)]:[],...roster,save({pushed,okAt:now,error:null,failingSince:null})]);
 lastFail=0;
 if(below||verdict==='accept')await buildSnapshot();
}
// After a save: push now instead of at the next minute. A failure only logs; the minute job tries again.
export function syncSoon():void{
 if(Date.now()-lastFail<60000)return;
 if(running){again=true;return;}
 running=(async()=>{try{const c=await loadConnection();if(!c)return;await syncSheet(c);if(again){again=false;await syncSheet(c);}}catch(error){console.error('Background sync failed',message(error));}finally{running=null;again=false;}})();
 waitUntil(running);
}
export async function syncHealth():Promise<{behind:boolean;since:number|null;error:string|null;refused:{names:number;current:number;at:number}|null}>{
 const d=database(),[v,s,r]=(await d.batch<any>([d.prepare(VERSION_SQL),d.prepare(STATE_SQL),d.prepare(ROSTER_SQL)])).map(x=>x.results[0]),state:SyncState=parse(s)??fresh,roster:Roster|null=parse(r),behind=v.version>state.pushed;
 return {behind,since:behind?(state.failingSince??(state.okAt&&Date.now()-state.okAt>300000?state.okAt:null)):null,error:state.error,refused:roster?.refused?{names:roster.refused.names.length,current:roster.names.length,at:roster.refused.at}:null};
}
// Use the new roster: the officer confirmed the Roster tab that the guard refused. Written only while a refusal is still waiting.
export async function acceptRefusedRoster():Promise<'ok'|'none'|'empty'>{
 const d=database(),roster:Roster|null=parse(await d.prepare(ROSTER_SQL).first()),r=roster?.refused;
 if(!r)return 'none';if(!r.names.length)return 'empty';
 const [w]=await d.batch([d.prepare("UPDATE app_settings SET value=? WHERE key='roster' AND json_extract(value,'$.refused') IS NOT NULL").bind(JSON.stringify({names:r.names,officers:r.officers,at:Date.now()})),d.prepare('UPDATE data_version SET version=version+1 WHERE id=1')]);
 if(!w.meta.changes)return 'none';
 await buildSnapshot();return 'ok';
}
