import {sameOrigin} from '../lib/sheet-connection';
import {botCookie,hasBotAccess,issueBotSession,passwordMatches} from '../lib/bot-access';
import {attemptKey,attemptsAllowed,clearAttempts} from '../lib/admin-access';
function page(unlocked=false,error='',status=200){
 const content=unlocked?`<h2>Pickleball automation bot <span class="beta-label">[BETA]</span></h2>
 <p class="muted">Your download hub for the club’s court reservation bot.</p>
 <section class="bot-status"><h3>Download coming soon</h3><p>The bot download and setup instructions will be added here later.</p><button disabled>Download unavailable</button></section>
 <div class="bot-footer"><a href="/">← Back to calendar</a><form method="post" action="/bot"><input type="hidden" name="action" value="lock"><button>Lock page</button></form></div>`:
 `<h2>Automation bot <span class="beta-label">[BETA]</span></h2><p class="muted">Enter the password to open the download page.</p>
 <form class="bot-form" method="post" action="/bot"><label for="password">Password</label><input id="password" name="password" type="password" required maxlength="200" autocomplete="off"><p class="error" role="alert">${error}</p><button class="primary">Unlock page</button></form><div class="bot-footer"><a href="/">← Back to calendar</a></div>`;
 return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Automation Bot · UCLA Club Pickleball</title><link rel="stylesheet" href="/pickleball-calendar.css"></head><body><header><div class="brand"><img class="logo" src="/pickleball.svg" alt="Pickleball" width="46" height="46"><div><h1>UCLA Club Pickleball</h1><p>Find a court.</p></div></div></header><main class="bot-page"><section class="panel bot-panel">${content}</section></main></body></html>`,{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store'}});
}
const scope='public-bot';
export async function GET(request:Request){
 try{return page(await hasBotAccess(request,scope));}catch{return page(false,'Bot access is temporarily unavailable.',503);}
}
export async function POST(request:Request){
 if(!sameOrigin(request))return page(false,'This request is not allowed.',403);
 try{
  const body=await request.text();if(body.length>1000)return page(false,'Request is too large.',400);
  const form=new URLSearchParams(body);
  if(form.get('action')==='lock')return new Response(null,{status:303,headers:{Location:'/bot','Set-Cookie':botCookie('',0),'Cache-Control':'private, no-store'}});
  // Same throttle as owner sign-in, keyed separately so bot guesses never lock out the owner.
  const key='bot:'+await attemptKey(request);
  if(!await attemptsAllowed(key))return page(false,'Too many attempts. Try again in 15 minutes.',429);
  if(!await passwordMatches(form.get('password')||''))return page(false,'Incorrect password. Try again.',401);
  await clearAttempts(key);
  return new Response(null,{status:303,headers:{Location:'/bot','Set-Cookie':botCookie(await issueBotSession(scope)),'Cache-Control':'private, no-store'}});
 }catch{return page(false,'Bot access is temporarily unavailable.',503);}
}
