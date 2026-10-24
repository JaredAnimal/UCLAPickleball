// Sign-in page: the Google step, then the Club/Guest name step. The Worker injects the config (src/routes/login.ts).
const CONFIG=JSON.parse(document.getElementById('loginConfig').textContent),$=id=>document.getElementById(id),card=$('card');
// A new account must never see the last one's reservations.
try{localStorage.removeItem('pickleball-reservations-v1');localStorage.removeItem('pickleball-reservations-v2')}catch{}
// "Messenger" also catches WeChat (MicroMessenger); "; wv)" marks an Android WebView (Chrome Custom Tabs lack it).
const IN_APP=/Instagram|FBAN|FBAV|FB_IAB|FBIOS|Messenger|Threads|musical_ly|BytedanceWebview|TikTok|Snapchat|LinkedInApp|Twitter|Line\/|; wv\)/i;
if(CONFIG.stage==='name'){
 let tab;
 const say=(text,fix=false)=>{$('nameError').textContent=text;$('fix').hidden=!fix};
 const pick=t=>{if($('submit').disabled)return;tab=t;card.dataset.tab=t;$('clubTab').setAttribute('aria-pressed',t==='club');$('guestTab').setAttribute('aria-pressed',t==='guest');$('clubNote').hidden=t!=='club';$('guestNote').hidden=t==='club';say('')};
 $('email').textContent=CONFIG.email;$('first').value=CONFIG.first;$('last').value=CONFIG.last;$('submit').disabled=false;pick(CONFIG.tab);if(CONFIG.error)say(CONFIG.error);
 $('clubTab').onclick=()=>pick('club');$('guestTab').onclick=()=>pick('guest');
 $('toGuest').onclick=()=>{pick('guest');$('guestTab').focus()};
 $('fix').onclick=()=>{pick('club');$('clubTab').focus()};
 $('nameForm').onsubmit=async e=>{
  e.preventDefault();const button=$('submit');if(button.disabled)return;
  button.disabled=true;button.textContent='Signing in…';say('');
  try{
   const r=await fetch('/auth/name',{method:'POST',signal:AbortSignal.timeout?.(3e4),headers:{'Content-Type':'application/json'},body:JSON.stringify({tab,first:$('first').value,last:$('last').value})}),d=await r.json().catch(()=>null);
   if(r.ok&&d?.ok)return location.assign('/');
   if(d?.code==='signin')return location.reload();say(d?.error||"Couldn't sign in right now. Try again.",d?.code==='roster-name');
  }catch{say('Network problem. Check your connection and try again.')}
  button.disabled=false;button.textContent='Sign in';button.focus();
 };
}else{
 const inApp=IN_APP.test(navigator.userAgent);
 $('googleError').textContent=CONFIG.ready?CONFIG.error||'':"Sign-in isn't set up yet.";
 $('googleBox').hidden=!CONFIG.ready||inApp;$('inApp').hidden=!CONFIG.ready||!inApp;
 $('link').value=location.origin+'/';
 $('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('link').value);$('copy').textContent='Link copied'}catch{$('link').focus();$('link').select();$('link').setSelectionRange?.(0,1e4)}};
}
$(CONFIG.stage==='name'?'nameStage':'googleStage').hidden=false;card.hidden=false;
// Back after signing in can restore this page from memory with Sign in still busy; reload so the server sends the right step (or the calendar).
window.onpageshow=e=>{if(e.persisted)location.reload()};
