import html from '../pages/setup.html';
import {isOwner} from '../lib/sheet-connection';
import {sheetUrl} from '../lib/pickleball-config';
export async function GET(request:Request){if(!await isOwner(request))return new Response(null,{status:303,headers:{Location:'/admin','Cache-Control':'private, no-store'}});return new Response(html.replace('__SHEET_URL__',sheetUrl()),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store'}});}
