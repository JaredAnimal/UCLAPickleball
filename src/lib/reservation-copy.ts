import {waitUntil} from 'cloudflare:workers';
import {database} from './database';
import {invokeSheet,type SheetConnection,type SheetResult} from './sheet-connection';
const KEY='reservations_copy';
type Copy={savedAt:number;data:SheetResult};
export async function readCopy():Promise<Copy|null>{try{const row=await database().prepare('SELECT value FROM app_settings WHERE key = ?').bind(KEY).first<{value:string}>();if(!row)return null;const copy=JSON.parse(row.value);return typeof copy?.savedAt==='number'&&Array.isArray(copy.data?.matches)&&Array.isArray(copy.data?.roster)?copy:null;}catch(error){console.error('Reservation copy read failed',error instanceof Error?error.message:'Unknown');return null;}}
export async function writeCopy(data:SheetResult,savedAt=Date.now()){try{await database().prepare("INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE json_extract(excluded.value,'$.savedAt')>json_extract(app_settings.value,'$.savedAt')").bind(KEY,JSON.stringify({savedAt,data})).run();}catch(error){console.error('Reservation copy write failed',error instanceof Error?error.message:'Unknown');}}
export async function clearCopy(){failed=undefined;try{await database().prepare('DELETE FROM app_settings WHERE key = ?').bind(KEY).run();}catch(error){console.error('Reservation copy clear failed',error instanceof Error?error.message:'Unknown');}}
// ponytail: the shared call and the 5 s failure memory live per isolate; a burst spread over several isolates makes one Google call per isolate.
let inflight:Promise<Copy>|undefined,failed:{at:number;error:unknown}|undefined;
export async function refreshCopy(connection:SheetConnection):Promise<Copy>{
 const copy=await readCopy();if(copy&&Date.now()-copy.savedAt<5000)return copy;
 if(failed&&Date.now()-failed.at<5000)throw failed.error;
 return inflight??=(async()=>{const savedAt=Date.now();try{const data=await invokeSheet(connection,{action:'list'}),saved=writeCopy(data,savedAt);waitUntil(saved);saved.finally(()=>inflight=undefined);return {savedAt,data};}catch(error){failed={at:Date.now(),error};inflight=undefined;throw error;}})();
}
