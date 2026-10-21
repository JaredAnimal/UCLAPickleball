import html from '../pages/calendar.html';
import { ROSTER } from '../lib/pickleball-config';
export function GET() {
 const body = html.replace('__CALENDAR_CONFIG__',JSON.stringify({roster:ROSTER}).replace(/</g,'\\u003c'));
 return new Response(body,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store'}});
}
