import {env} from 'cloudflare:workers';
import {database} from './database';
import type {SheetResult} from './sheet-connection';

export const readOnlyPreview=()=>env.PREVIEW_READ_ONLY==='true';
export async function previewCalendar(request:Request):Promise<SheetResult & {readOnly:true;liveUrl:string;copyAge:number}>{
 const name=env.PREVIEW_WORKER_NAME;
 const host=new URL(request.url).hostname;
 if(!name||!/^[a-z0-9-]+$/.test(name)||!host.endsWith('.workers.dev')||host.split('.').length!==4)throw new Error('Preview calendar source is not configured.');
 // The source is the public, read-only calendar API. No Sheet credentials are copied.
 const origin='https://'+name+'.'+host.split('.').slice(1).join('.');
 if(new URL(origin).hostname===host)throw new Error('Preview source must be the live calendar.');
 const db=database();
 await db.prepare('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL)').run();
 const row=await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind('preview_reservations').first<{value:string}>();
 let copy:{savedAt:number;data:SheetResult}|null=null;
 try{if(row)copy=JSON.parse(row.value);}catch{}
 if(!copy||Date.now()-copy.savedAt>30000){
  const response=await fetch(origin+'/api/reservations',{signal:AbortSignal.timeout(30000),redirect:'manual'});
  const data=await response.json() as SheetResult & {configured?:boolean;error?:string};
  if(!response.ok||!data.configured||!Array.isArray(data.roster)||!Array.isArray(data.matches))throw new Error('The live calendar could not be loaded. Please retry.');
  copy={savedAt:Date.now(),data:{ok:true,apiVersion:2,roster:data.roster,matches:data.matches}};
  await db.prepare('INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('preview_reservations',JSON.stringify(copy)).run();
 }
 return {...copy.data,readOnly:true,liveUrl:origin+'/',copyAge:0};
}
