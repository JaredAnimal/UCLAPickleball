import {env} from 'cloudflare:workers';
import {database} from './database';
import {expectedSheetId} from './pickleball-config';
import {clearCopy} from './reservation-copy';
export type SheetConnection={endpoint:string;secret:string};
export const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}});
export function sameOrigin(request:Request){const o=request.headers.get('origin');return request.headers.get('sec-fetch-site')!=='cross-site'&&(!o||o===new URL(request.url).origin);}
export function endpointValid(value:unknown):value is string{return typeof value==='string'&&/^https:\/\/script\.google\.com\/(a\/macros\/[a-zA-Z0-9.-]+\/|macros\/)s\/[a-zA-Z0-9_-]+\/exec$/.test(value);}
const base64=(v:Uint8Array)=>btoa(Array.from(v,b=>String.fromCharCode(b)).join(''));
const unbase64=(v:string)=>Uint8Array.from(atob(v),c=>c.charCodeAt(0));
async function key(){const raw=env.SHEETS_ENCRYPTION_KEY;if(!raw)throw new Error('Connection encryption is not configured.');return crypto.subtle.importKey('raw',unbase64(raw),'AES-GCM',false,['encrypt','decrypt']);}
async function seal(value:string){const iv=crypto.getRandomValues(new Uint8Array(12));const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(),new TextEncoder().encode(value));return base64(iv)+'.'+base64(new Uint8Array(cipher));}
async function unseal(value:string){const [iv,cipher]=value.split('.');return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64(iv)},await key(),unbase64(cipher)));}
export async function loadConnection():Promise<SheetConnection|null>{const row=await database().prepare('SELECT value FROM app_settings WHERE key = ?').bind('google_sheets').first<{value:string}>();if(!row)return null;const config=JSON.parse(row.value);if(!endpointValid(config.endpoint))throw new Error('Invalid saved connection.');return {endpoint:config.endpoint,secret:await unseal(config.secret)};}
export async function saveConnection(connection:SheetConnection){const data=JSON.stringify({endpoint:connection.endpoint,secret:await seal(connection.secret)});await database().prepare('INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('google_sheets',data).run();await clearCopy();}
export type Reservation={id:string;date:string;start:string;end:string;court:string;capacity:number|null;kind?:'practice';host:string;players:string[];notes:string;version:number};
export type SheetResult={ok:true;apiVersion:2;matches:Reservation[];roster:string[]};
const SLOW='Google Sheets took too long to respond. Refresh to check whether your change saved.';
const READ_SLOW='Google Sheets is slow right now. Try again in a moment.';
async function attempt(connection:SheetConnection,action:string,body:string,n:number){
 const t0=Date.now(),signal=AbortSignal.timeout(Number(env.SHEET_TIMEOUT_MS)||10000);
 try{
  let res=await fetch(connection.endpoint,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body,redirect:'manual',signal}),echo='';const t1=Date.now(),loc=res.headers.get('Location');
  if(res.status>=300&&res.status<400&&loc){res=await fetch(new URL(loc,connection.endpoint),{redirect:'follow',signal});echo=` echo=${Date.now()-t1}ms`;}
  if(!res.ok)throw new Error('HTTP '+res.status);
  const text=await res.text();console.log(`sheet ${action} post=${t1-t0}ms${echo} attempt=${n}`);return text;
 }catch(error:any){console.log(`sheet ${action} ${error?.name==='TimeoutError'?'timeout':'failed'} attempt=${n} after=${Date.now()-t0}ms`);throw error;}
}
export async function invokeSheet(connection:SheetConnection,payload:Record<string,unknown>):Promise<SheetResult>{
 const action=String(payload.action),body=JSON.stringify({...payload,secret:connection.secret});let text='';
 for(let n=1;;n++){try{text=await attempt(connection,action,body,n);break;}catch(error:any){if(n===2)throw Object.assign(new Error(error?.name==='TimeoutError'?(action==='list'?READ_SLOW:SLOW):'Google Sheets is unavailable. Try refreshing.'),{uncertain:true});}}
 let data:Record<string,unknown>;try{data=JSON.parse(text) as Record<string,unknown>;}catch(error){throw new Error('Google returned a sign-in page. Check the web app deployment settings.');}
 if(data.ok!==true)throw new Error(typeof data.error==='string'?data.error.replaceAll(expectedSheetId(),'[sheet]').slice(0,300):'Google Sheets did not confirm the update.');
 if(data.apiVersion!==2)throw new Error('Update the Google connection script from Connect Google Sheet, then deploy a new version of the existing web app.');
 if(data.sheetId!==expectedSheetId())throw new Error('This connection points to a different spreadsheet.');
 if(!Array.isArray(data.matches)||!Array.isArray(data.roster)||data.matches.length>10000||data.roster.length>500)throw new Error('Unexpected reservation data from Google Sheets.');
 const invalid=(row:any)=>!row||typeof row.id!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||!/^\d{2}:\d{2}$/.test(row.start)||!/^\d{2}:\d{2}$/.test(row.end)||typeof row.host!=='string'||typeof row.court!=='string'||!Array.isArray(row.players)||!row.players.every((p:unknown)=>typeof p==='string')||!(row.kind==='practice'&&row.capacity===null||Number.isInteger(row.capacity)&&row.capacity>=0&&row.capacity<=500);
 const rows=data.matches.filter(row=>!invalid(row));if(rows.length<data.matches.length)console.error('Skipped reservation rows with invalid values',data.matches.length-rows.length);data.matches=rows;
 data.roster=data.roster.filter((name:unknown)=>typeof name==='string'&&name.length<=120);
 delete data.sheetId;return data as unknown as SheetResult;
}
