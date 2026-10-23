import html from '../pages/calendar.html';
import {env} from 'cloudflare:workers';
import { ROSTER } from '../lib/pickleball-config';
import {readSession,renewSession} from '../lib/sign-in';
export const assetVersion=()=>(env.CF_VERSION_METADATA?.id??'').replace(/[^A-Za-z0-9-]/g,'')||'dev';
export async function GET(request: Request) {
 const session=await readSession(request);
 if(!session?.player)return new Response(null,{status:302,headers:{Location:'/login','Cache-Control':'private, no-store'}});
 const body = html.replace('__CALENDAR_CONFIG__',()=>JSON.stringify({roster:ROSTER,player:session.player}).replace(/</g,'\\u003c')).replaceAll('__ASSET_VERSION__',assetVersion());
 const headers=new Headers({'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store'}),renewed=await renewSession(session,request);
 if(renewed)headers.append('Set-Cookie',renewed);
 return new Response(body,{headers});
}
