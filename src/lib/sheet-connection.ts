import {env} from 'cloudflare:workers';
import {database} from './database';
import {expectedSheetId} from './pickleball-config';
import {clearCopy} from './reservation-copy';
import {laYesterday,type Reservation} from './reservation-rules';
export type SheetConnection={endpoint:string;secret:string};
export const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}});
export const tooLarge=(request:Request,limit:number)=>Number(request.headers.get('content-length'))>limit;
export function sameOrigin(request:Request){const o=request.headers.get('origin');return request.headers.get('sec-fetch-site')!=='cross-site'&&(!o||o===new URL(request.url).origin);}
export function endpointValid(value:unknown):value is string{return typeof value==='string'&&/^https:\/\/script\.google\.com\/(a\/macros\/[a-zA-Z0-9.-]+\/|macros\/)s\/[a-zA-Z0-9_-]+\/exec$/.test(value);}
const base64=(v:Uint8Array)=>btoa(Array.from(v,b=>String.fromCharCode(b)).join(''));
const unbase64=(v:string)=>Uint8Array.from(atob(v),c=>c.charCodeAt(0));
async function key(){const raw=env.SHEETS_ENCRYPTION_KEY;if(!raw)throw new Error('Connection encryption is not configured.');return crypto.subtle.importKey('raw',unbase64(raw),'AES-GCM',false,['encrypt','decrypt']);}
async function seal(value:string){const iv=crypto.getRandomValues(new Uint8Array(12));const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(),new TextEncoder().encode(value));return base64(iv)+'.'+base64(new Uint8Array(cipher));}
async function unseal(value:string){const [iv,cipher]=value.split('.');return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64(iv)},await key(),unbase64(cipher)));}
async function readConnection():Promise<SheetConnection|null>{const row=await database().prepare('SELECT value FROM app_settings WHERE key = ?').bind('google_sheets').first<{value:string}>();if(!row)return null;const config=JSON.parse(row.value);if(!endpointValid(config.endpoint))throw new Error('Invalid saved connection.');return {endpoint:config.endpoint,secret:await unseal(config.secret)};}
// ponytail: per-isolate 60 s cache; other isolates (or a load racing a reconnect) can keep the old connection for up to 60 s.
let cached:{at:number;connection:SheetConnection}|undefined;
export async function loadConnection(){if(cached&&Date.now()-cached.at<60000)return cached.connection;const connection=await readConnection();if(connection)cached={at:Date.now(),connection};return connection;}
export async function saveConnection(connection:SheetConnection){const data=JSON.stringify({endpoint:connection.endpoint,secret:await seal(connection.secret)});await database().prepare('INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('google_sheets',data).run();cached=undefined;await clearCopy();}
export type SheetResult={ok:true;apiVersion:2;matches:Reservation[];roster:string[];at:number};
export const UNAVAILABLE='Google Sheets is unavailable. Try refreshing.';
const SLOW='Google Sheets took too long to respond. Refresh to check whether your change saved.';
const READ_SLOW='Google Sheets is slow right now. Try again in a moment.';
const BUSY='Another player is updating the calendar. Try again.';
// The script's own ok:false messages (pickleball-apps-script.gs): rejections are thrown before any change and are safe to show players; config errors are the owner's setup problems. "The retry contains different data" is left out: its receipt proves an earlier send applied.
// ponytail: exact match on Version 5's wording, which sends no code; Version 6 replies carry a code that wins. Drop the lists once Version 5 is gone.
const REJECTIONS=[BUSY,'Choose a club player or enter a guest name.','Club practice is NOT open to guests.','Practice IDs are reserved.','This practice has ended.','Weekly club practices cannot be edited or canceled.','Reservation ID already exists.','This reservation no longer exists. Refresh the calendar.','Only the host can change this match or remove players.','This match has already started.','This match changed while you were editing. Refresh before saving.','Capacity cannot be lower than the current signup count.','You are already the host.','The last spot has been filled. Refresh the calendar.','Choose an attendee to remove.','Choose a valid date.','End time must be after start time.','Choose a future start time.','Check the location and notes.','Choose up to 7 other players (8 on the court).'];
const CONFIG=/^(Set SPREADSHEET_ID |Connection secret is incorrect\.|Reservations or Roster tab is missing\.|Check these Reservations column headers|Reservation history is too large\.)/;
const classify=(message:string)=>message===BUSY?'busy':REJECTIONS.includes(message)?'rejected':CONFIG.test(message)?'config':'internal';
const invalid=(row:any)=>!row||typeof row.id!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||!/^\d{2}:\d{2}$/.test(row.start)||!/^\d{2}:\d{2}$/.test(row.end)||typeof row.host!=='string'||typeof row.court!=='string'||!Array.isArray(row.players)||!row.players.every((p:unknown)=>typeof p==='string')||!(row.kind==='practice'&&row.capacity===null||Number.isInteger(row.capacity)&&row.capacity>=0&&row.capacity<=500);
const shaped=(d:Record<string,unknown>):d is Record<string,unknown>&{matches:unknown[];roster:unknown[]}=>Array.isArray(d.matches)&&Array.isArray(d.roster)&&d.matches.length<=10000&&d.roster.length<=500;
function tidy(d:{matches:unknown[];roster:unknown[]}){const rows=d.matches.filter(row=>!invalid(row)) as Reservation[];if(rows.length<d.matches.length)console.error('Skipped reservation rows with invalid values',d.matches.length-rows.length);const from=laYesterday();return {matches:rows.filter(row=>row.date>=from),roster:d.roster.filter((name):name is string=>typeof name==='string'&&name.length<=120)};}
export const playerError=(error:unknown)=>{const e=error as {message?:string;rejected?:boolean;safe?:boolean}|null;return e?.rejected||e?.safe?String(e.message):UNAVAILABLE;};
async function attempt(connection:SheetConnection,action:string,body:string,n:number,ms:number):Promise<Record<string,unknown>>{
 const t0=Date.now(),signal=AbortSignal.timeout(ms);let leg='direct';
 try{
  let res=await fetch(connection.endpoint,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body,redirect:'manual',signal}),echo='';const t1=Date.now(),loc=res.headers.get('Location');
  if(res.status>=300&&res.status<400&&loc){const url=new URL(loc,connection.endpoint);if(url.hostname!=='script.googleusercontent.com')throw Object.assign(new Error('Google returned a sign-in page. Check the web app deployment settings.'),{status:res.status,signin:true});leg='echo';res=await fetch(url,{redirect:'manual',signal});echo=` echo=${Date.now()-t1}ms`;}
  if(!res.ok)throw Object.assign(new Error(`Google returned HTTP ${res.status} (${leg}).`),{status:res.status});
  const text=await res.text();console.log(`sheet ${action} post=${t1-t0}ms${echo} attempt=${n}`);
  try{const data=JSON.parse(text);if(data&&typeof data==='object')return data;}catch{}
  console.log(`sheet ${action} non-json status=${res.status} leg=${leg} type=${res.headers.get('content-type')} title=${/<title>([^<]{0,80})/i.exec(text)?.[1]??''} attempt=${n}`);
  throw Object.assign(new Error(`Google returned a page instead of data (HTTP ${res.status}, ${leg}).`),{status:res.status});
 }catch(error:any){const timeout=error?.name==='TimeoutError';console.log(`sheet ${action} ${timeout?'timeout':'failed'}${error?.status?` status=${error.status}`:''} attempt=${n} after=${Date.now()-t0}ms`);throw timeout||error?.status?error:new Error(`Could not reach Google (${leg}).`);}
}
export async function invokeSheet(connection:SheetConnection,payload:Record<string,unknown>):Promise<SheetResult>{
 const action=String(payload.action),body=JSON.stringify({...payload,secret:connection.secret}),sheetId=expectedSheetId(),start=Date.now(),deadline=start+(Number(env.SHEET_DEADLINE_MS)||20000);let data:Record<string,unknown>,last:any,unknown=false;
 const fail=(message:string,safe:boolean,busy=false)=>Object.assign(new Error(message),busy?{busy:true}:{},unknown?{uncertain:true,safe}:safe?{rejected:true}:{});
 for(let n=1;;n++){
  if(n===2&&last?.name!=='TimeoutError')await new Promise(r=>setTimeout(r,300+Math.random()*500));
  let reply:Record<string,unknown>|undefined;try{reply=await attempt(connection,action,body,n,Math.max(0,Math.min(Number(env.SHEET_TIMEOUT_MS)||10000,deadline-Date.now())));}catch(error:any){if(error.signin)throw fail(error.message,false);unknown=true;last=error;}
  if(reply?.ok===true){data=reply;break;}
  if(reply){const message=typeof reply.error==='string'?reply.error.replaceAll(sheetId,'[sheet]').slice(0,300):'Google Sheets did not confirm the update.',kind=typeof reply.code==='string'&&['rejected','busy','config','internal'].includes(reply.code)?reply.code:classify(message);if(kind==='internal'){unknown=true;last=new Error(message);}else if(kind!=='busy'||n===2)throw Object.assign(fail(kind==='busy'?BUSY:message,kind!=='config',kind==='busy'),kind==='rejected'&&!unknown&&reply.sheetId===sheetId&&shaped(reply)?{data:tidy(reply)}:{});else last=new Error(BUSY);}
  if(n===2)throw Object.assign(new Error(last.name==='TimeoutError'?(action==='list'?READ_SLOW:SLOW):last.message),{uncertain:true,safe:last.name==='TimeoutError'});
 }
 const landed=(message:string)=>Object.assign(new Error(message),action==='list'?{}:{uncertain:true});
 if(data.apiVersion!==2)throw landed('Update the Google connection script from Connect Google Sheet, then deploy a new version of the existing web app.');
 if(data.sheetId!==sheetId)throw landed('This connection points to a different spreadsheet.');
 if(!shaped(data))throw landed('Unexpected reservation data from Google Sheets.');
 // The copy is ordered by the script's clock (taken under the lock for writes, at the read for lists), capped at now; Version 5 sends none, so reads keep their start time and writes their finish time.
 return {ok:true,apiVersion:2,...tidy(data),at:Number.isFinite(data.at)?Math.min(Number(data.at),Date.now()):action==='list'?start:Date.now()};
}
