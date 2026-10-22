import html from '../pages/calendar.html';
import {env} from 'cloudflare:workers';
import { ROSTER } from '../lib/pickleball-config';
export const assetVersion=()=>(env.CF_VERSION_METADATA?.id??'').replace(/[^A-Za-z0-9-]/g,'')||'dev';
export function GET() {
 const body = html.replace('__CALENDAR_CONFIG__',JSON.stringify({roster:ROSTER}).replace(/</g,'\\u003c')).replaceAll('__ASSET_VERSION__',assetVersion());
 return new Response(body,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store'}});
}
