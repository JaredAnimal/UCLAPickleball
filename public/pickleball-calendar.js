const CONFIG=JSON.parse(document.getElementById('calendarConfig').textContent);
let ROSTER=CONFIG.roster;
const $=id=>document.getElementById(id),USER_KEY='ucla-pickleball-user-v1',PENDING_KEY='ucla-pickleball-pending-v1',TOKEN_KEY='ucla-pickleball-session-v1',CACHE_KEY='pickleball-reservations-v1';
const norm=s=>s.trim().replace(/\s+/g,' ').toLowerCase();
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const guestSuffix=' [guest]';
const isGuest=name=>typeof name==='string'&&name.endsWith(guestSuffix)&&name.length<=109&&name.slice(0,-guestSuffix.length).trim().split(/\s+/).length>=2&&!/[\[\]\p{C}]/u.test(name.slice(0,-guestSuffix.length));
const playerName=name=>isGuest(name)?name.slice(0,-guestSuffix.length):name;
const playerHtml=name=>esc(playerName(name))+(isGuest(name)?' <span class="guest-tag">[guest]</span>':'');
let loginMode='member',loginPending=false,playerToken='',tokenPlayer='',tokenExpires=0,sessionRequest=null,saveCount=0;
const localToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const dateObj=s=>new Date(s+'T12:00:00Z');
const dateKey=d=>`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
const addDays=(s,n)=>{const d=dateObj(s);d.setUTCDate(d.getUTCDate()+n);return dateKey(d)};
const dayLabel=(s,options)=>dateObj(s).toLocaleDateString('en-US',{...options,timeZone:'UTC'});
const timeLabel=t=>{const [h,m]=t.split(':').map(Number);return `${h%12||12}:${String(m).padStart(2,'0')} ${h<12?'AM':'PM'}`};
function clubNow(){const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;}
const isPractice=m=>m.kind==='practice';
const live=m=>`${m.date}T${m.end}`>clubNow(),chipTime=t=>timeLabel(t).replace(':00','');
const started=m=>`${m.date}T${isPractice(m)?m.end:m.start}`<=clubNow();
function practiceForDate(date){const weekday=dateObj(date).getUTCDay(),start=weekday===4?'17:00':weekday===0?'15:00':null;if(!start)return null;return {id:'practice-'+date,kind:'practice',date,start,end:weekday===4?'19:00':'17:00',court:'Club practice',capacity:null,host:'Club practice',players:[],notes:'Weekly club practice. NOT open to guests.',version:1};}
function matchesForDate(date,rows){const practice=practiceForDate(date),regular=rows.filter(m=>m.date===date&&!m.id.startsWith('practice-'));if(practice){const saved=rows.find(m=>m.id===practice.id);regular.push({...practice,players:saved?.players||[],version:saved?.version||1});}return regular.sort((a,b)=>a.start.localeCompare(b.start));}
let user='',selected=localToday(),windowStart=localToday(),editing=null,editingVersion=null,toastTimer,loaded=false,configured=false,loading=false,busy=false,fromDevice=false,loadError='',matches=[],lastToday=localToday();
try{user=localStorage.getItem(USER_KEY)||''}catch{}
try{({token:playerToken='',player:tokenPlayer='',expires:tokenExpires=0}=JSON.parse(localStorage.getItem(TOKEN_KEY)||'{}'))}catch{}
const problem=(error,fallback)=>error instanceof TypeError?'Network problem. Check your connection and try again.':error?.message||fallback;
function toast(message,ms=5000){$('toast').textContent=message;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').textContent='',ms);}
const posts=document.querySelectorAll('.post');
function setBusy(value){busy=value;posts.forEach(b=>b.disabled=value||!loaded||!!loadError||fromDevice);$('refresh').disabled=value||loading||fromDevice;const submit=$('matchForm').querySelector('button.primary');submit.disabled=value;submit.textContent=value?'Saving…':'Save reservation';}
const saveCopy=(m,r)=>{try{localStorage.setItem(CACHE_KEY,JSON.stringify({savedAt:Date.now(),matches:m,roster:r}))}catch{}};
function showNotice(){
 const notice=$('syncNotice'),text=loadError&&loadError+(loaded?' Displaying the last loaded reservations. Saving is paused.':' Reservations could not be loaded.');if(notice.dataset.text===text)return;notice.dataset.text=text;notice.hidden=!text;notice.textContent=text;
 if(text){const retry=document.createElement('button');retry.textContent='Retry';retry.onclick=()=>loadReservations(false,true);notice.append(retry);}
}
async function loadReservations(silent=false,fresh=false){
 if(loading||busy)return;loading=true;let stale=false;const saves=saveCount,early=window.reservationsRequest;window.reservationsRequest=null;$('refresh').disabled=true;
 try{const response=(early&&await early)||await fetch('/api/reservations'+(fresh?'?fresh=1':''),{cache:'no-store'});const data=await response.json().catch(()=>({}));if(!response.ok||typeof data.configured!=='boolean')throw Error(data.error||'Could not load reservations.');configured=data.configured===true;ROSTER=data.roster||ROSTER;if(!busy&&saves===saveCount){matches=configured?data.matches:[];if(configured)saveCopy(data.matches,ROSTER);}const current=editing&&$('editor').open&&matches.find(m=>m.id===editing.id);if(current&&['date','start','end','court','capacity','notes'].every(k=>current[k]===editing[k]))editingVersion=current.version;loaded=true;fromDevice=false;stale=!fresh&&data.copyAge>30;loadError=configured?(stale?loadError:''):'Shared reservations are not connected. The owner needs to finish setup at /admin.';if(user&&!isGuest(user)&&!ROSTER.includes(user)){user='';openLogin();}render();if(configured&&user)ensurePlayerSession(user).catch(()=>{});}
 catch(error){fromDevice=false;loadError=problem(error,'Could not load reservations.');render();if(!silent)toast(loadError);}
 finally{loading=false;setBusy(busy);}
 if(stale)loadReservations(true,true);
}
function requireUser(){if(user)return true;openLogin();return false;}
async function ensurePlayerSession(name){
 if(playerToken&&tokenPlayer===name&&tokenExpires>Date.now()+60000)return playerToken;
 if(sessionRequest?.name===name)return sessionRequest.promise;const promise=(async()=>{
 const response=await fetch('/api/player-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({player:name})});
 const data=await response.json().catch(()=>({}));if(!response.ok||data.player!==name||typeof data.token!=='string')throw Error(data.error||'Could not confirm your player name. Please retry.');
 playerToken=data.token;tokenPlayer=data.player;tokenExpires=data.expires*1000;try{localStorage.setItem(TOKEN_KEY,JSON.stringify({token:playerToken,player:tokenPlayer,expires:tokenExpires}))}catch{}return playerToken;})();
 sessionRequest={name,promise};try{return await promise}finally{if(sessionRequest?.promise===promise)sessionRequest=null}
}
function setLoginMode(mode){loginMode=mode;$('loginTitle').textContent=mode==='guest'?'Welcome, guest.':'Hey, Bruin.';$('loginIntro').textContent=mode==='guest'?'Enter any first and last name. Your name will show a red [guest] tag on signups.':'Enter your name as it appears on the club roster to join the calendar.';$('loginSubmit').textContent=mode==='guest'?'Enter as guest':'Enter calendar';$('guestMode').textContent=mode==='guest'?'Use club roster':'Continue as guest';$('loginError').textContent='';}
function openLogin(){if(loginPending)return;setLoginMode('member');$('loginCancel').hidden=!user;$('loginForm').reset();if(!$('login').open)$('login').showModal();}
$('login').addEventListener('cancel',event=>{if(!user||loginPending)event.preventDefault()});
$('loginCancel').onclick=()=>{if(user)$('login').close()};
$('switchUser').onclick=()=>{$('profileMenu').hidePopover?.();openLogin()};
$('guestMode').onclick=()=>{setLoginMode(loginMode==='guest'?'member':'guest');$('first').focus();};
$('loginForm').onsubmit=async event=>{event.preventDefault();if(loginPending)return;if(!loaded||!configured||loadError){$('loginError').textContent=loadError||'Loading the club roster. Please wait and try again.';loadReservations(true);return;}const first=$('first').value.trim().replace(/\s+/g,' '),last=$('last').value.trim().replace(/\s+/g,' ');let name;
 if(loginMode==='guest'){name=first+' '+last+guestSuffix;if(!first||!last||first.length>50||last.length>50||!isGuest(name)){$('loginError').textContent='Enter a first and last name without brackets or control characters.';return;}}
 else{name=ROSTER.find(n=>norm(n)===norm(first+' '+last));if(!name){$('loginError').textContent='Name not found. Check the club roster or continue as guest.';return;}}
 loginPending=true;$('loginSubmit').disabled=true;$('guestMode').disabled=true;$('loginCancel').disabled=true;$('loginSubmit').textContent='Checking name…';
 try{await ensurePlayerSession(name);user=name;try{localStorage.setItem(USER_KEY,user)}catch{toast('Your browser cannot remember your player name.')}$('login').close();render();}
 catch(error){$('loginError').textContent=problem(error,'Could not confirm your player name. Please retry.');}
 finally{loginPending=false;$('loginSubmit').disabled=false;$('guestMode').disabled=false;$('loginCancel').disabled=false;$('loginSubmit').textContent=loginMode==='guest'?'Enter as guest':'Enter calendar';}
};
function displayRange(){const last=addDays(windowStart,5);const sameMonth=windowStart.slice(0,7)===last.slice(0,7);const first=dayLabel(windowStart,{month:'short',day:'numeric',...(windowStart.slice(0,4)!==last.slice(0,4)?{year:'numeric'}:{})});return first+' – '+(sameMonth?dateObj(last).getUTCDate()+', '+last.slice(0,4):dayLabel(last,{month:'short',day:'numeric',year:'numeric'}));}
// Spots drawn as dots: host plus joined players filled, the viewer's own spot gold. Text only past `max`.
const spots=(m,max)=>{const total=m.capacity+1,taken=m.players.length+1,me=m.host===user||m.players.includes(user);return isPractice(m)||total>max?'':`<span class="spots" aria-hidden="true">${Array.from({length:total},(_,i)=>`<i class="${i<taken?(me&&!i?'me':'on'):''}"></i>`).join('')}</span>`};
let listFilter='all';
const initials=name=>playerName(name).trim().split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
const av=name=>`<span class="av${name===user?' me':''}" aria-hidden="true">${esc(initials(name))}</span>`;
function render(){
 $('identity').innerHTML=user?playerHtml(user):'Choose your player';$('initials').textContent=user?initials(user):'';$('profile').setAttribute('aria-label',user?'Profile: '+playerName(user):'Profile');$('monthTitle').textContent=displayRange();document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===listFilter)));posts.forEach(b=>b.disabled=busy||!loaded||!!loadError);showNotice();
 $('calendar').innerHTML='';
 for(let i=0;i<6;i++){
  const key=addDays(windowStart,i),today=key===localToday(),dayMatches=matchesForDate(key,matches).filter(live);
  const button=document.createElement('button');button.className='day'+(key===selected?' selected':'')+(today?' today':'');button.setAttribute('aria-label',`${today?'Today, ':''}${dayLabel(key,{weekday:'long',month:'short',day:'numeric',year:'numeric'})}, ${dayMatches.length} reservation${dayMatches.length===1?'':'s'}`);button.setAttribute('aria-pressed',String(key===selected));
  button.innerHTML=`<span class="dayheading"><span class="dayname">${today?'Today':dayLabel(key,{weekday:'short'})}</span><span class="daynum">${dateObj(key).getUTCDate()}</span></span>`+dayMatches.slice(0,4).map(m=>{const mine=m.host===user||m.players.includes(user),practice=isPractice(m),full=!practice&&m.players.length>=m.capacity;return `<span class="chip ${mine?'mine':full?'full':''}"><span class="chiprow"><span class="chiptime">${esc(chipTime(m.start))}</span>${spots(m,6)}</span><span>${practice?'Club practice':`<b class="chiphost">${esc(playerName(m.host).split(' ')[0])}</b>`+(isGuest(m.host)?' <span class="guest-tag">[guest]</span>':'')+` · ${started(m)?'Started':full?'Full':m.capacity-m.players.length+' open'}`}</span></span>`}).join('')+(dayMatches.length>4?`<span class="small">+${dayMatches.length-4} more</span>`:dayMatches.length?'':`<span class="dayempty">${loaded?'No matches yet':'Loading…'}</span>`);
  button.onclick=()=>{selected=key;if(!$('g-'+key))listFilter='all';render();$('g-'+key)?.parentNode.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'})};$('calendar').append(button);
 }
 // Matches list: every match in the six days, grouped by day and filtered; finished matches drop off.
 const view=listFilter+windowStart,fresh=$('matches').dataset.view!==view;$('matches').dataset.view=view;$('matches').innerHTML='';
 const keep=m=>{if(!live(m))return false;const mine=m.host===user||m.players.includes(user);return listFilter==='mine'?mine:listFilter==='open'?!mine&&!started(m)&&(isPractice(m)?!isGuest(user):m.players.length<m.capacity):true};
 let shown=0;
 for(let d=0;d<6;d++){
  const key=addDays(windowStart,d),daily=loaded?matchesForDate(key,matches).filter(keep):[];
  if(!daily.length&&(listFilter!=='all'||!loaded))continue;
  const block=document.createElement('section'),head=document.createElement('h4');block.className='dayblock';block.setAttribute('aria-labelledby','g-'+key);head.className='grouphead';head.id='g-'+key;const td=key===localToday(),w=document.createElement('span'),dt=document.createElement('span');w.className='gh-day';dt.className='gh-date';w.textContent=td?'Today':dayLabel(key,{weekday:'long'});dt.textContent=dayLabel(key,td?{weekday:'short',month:'short',day:'numeric'}:{month:'short',day:'numeric'});head.append(w,' ',dt);block.append(head);$('matches').append(block);
  if(!daily.length){const none=document.createElement('p'),post=document.createElement('button');none.className='none';none.textContent='No matches yet. ';post.className='link';post.textContent='Post one';post.disabled=busy||fromDevice||!!loadError;post.onclick=()=>{selected=key;openEditor()};none.append(post);block.append(none);continue;}
  daily.forEach(m=>{
   const i=shown++,practice=isPractice(m),own=!practice&&m.host===user,joined=m.players.includes(user),available=practice?Infinity:m.capacity-m.players.length,past=started(m),status=own?'Hosting':joined?'You’re in':practice?'':past?'Started':available>0?available+' open':'Full';const card=document.createElement('article');card.className=fresh?'card enter':'card';card.style.setProperty('--i',i);
   card.innerHTML=`<div class="cardtop"><h5>${esc(timeLabel(m.start))} – ${esc(timeLabel(m.end))}</h5>${status&&`<span class="badge${own||joined?' mine':available<=0||past?' full':''}">${status}</span>`}</div><div class="muted small">${esc(m.court)}</div><div class="count${available<=0?' full':''}">${spots(m,12)}<strong>${practice?`${m.players.length} going`:`${m.players.length+1} of ${m.capacity+1} players`}</strong></div><ul class="players">${practice?'':`<li>${av(m.host)}${playerHtml(m.host)} <strong>· Host</strong></li>`}${m.players.map(player=>`<li>${av(player)}${playerHtml(player)}</li>`).join('')}</ul>${m.notes?`<p class="muted small" style="white-space:pre-wrap">${esc(m.notes)}</p>`:''}`;
   if(own){card.querySelectorAll('.players li').forEach((item,index)=>{if(index===0)return;const player=m.players[index-1],button=document.createElement('button');button.className='remove-player danger';button.textContent='Remove';button.setAttribute('aria-label','Remove '+playerName(player));button.disabled=busy||fromDevice||!!loadError||!loaded;button.onclick=async()=>{if(confirm('Remove '+playerName(player)+' from this match?'))if(await mutate('remove',{id:m.id,target:player}))toast(playerName(player)+' removed from the match.');};item.append(button);});}
   const actions=document.createElement('div');actions.className='actions';const add=(label,fn,style='',disabled=false)=>{const button=document.createElement('button');button.textContent=label;button.className=style;button.disabled=disabled||busy||fromDevice||!!loadError||!loaded;button.onclick=fn;actions.append(button)};
   if(own){add('Edit',()=>openEditor(m),'',past);add('Cancel match',async()=>{if(confirm('Cancel this reservation for everyone?')&&await mutate('cancel',{id:m.id}))toast('Reservation canceled.')},'danger');}
   else if(joined)add(practice?'Leave practice':'Leave match',()=>signup(m,false),'',past);
   else if(practice&&isGuest(user))add('Members only',()=>{},'',true);
   else if(!past&&available>0)add(practice?'Join practice':'Join match',()=>signup(m,true),'primary');
   if(actions.firstChild)card.append(actions);block.append(card);
  });
 }
 if(!$('matches').children.length){const empty=document.createElement('div');empty.className='empty';empty.textContent=!loaded?'Loading reservations…':loadError?'Reservations are temporarily unavailable.':listFilter==='mine'?'You’re not in any matches this week.':'No open spots right now. Try next week or post a match.';$('matches').append(empty);}
}
function checkData(data){if(!data.court.trim())throw Error('Enter a court or location.');if(data.end<=data.start)throw Error('End time must be after start time on the same day.');if(started(data))throw Error('Choose a start time in the future.');if(!Number.isInteger(data.capacity)||data.capacity<0||data.capacity>Math.min(7,ROSTER.length-1))throw Error('Choose up to 7 other players (8 on the court).');}
function applyLocal(rows,action,payload,id){
 if(action==='join'&&String(payload.id||'').startsWith('practice-')&&isGuest(user))throw Error('Club practice is NOT open to guests.');
 let index=rows.findIndex(m=>m.id===payload.id),match=rows[index];
 if(action==='join'&&!match&&/^practice-\d{4}-\d{2}-\d{2}$/.test(payload.id||'')){const practice=practiceForDate(payload.id.slice(9));if(practice&&practice.id===payload.id){if(started(practice))throw Error('This practice has ended.');match=practice;rows.push(match);index=rows.length-1;}}
 if(match&&isPractice(match)&&['edit','cancel','remove'].includes(action))throw Error('Weekly club practices cannot be edited or canceled.');
 if(action==='create'){checkData(payload.reservation);if(!rows.some(m=>m.id===id))rows.push({...payload.reservation,id,host:user,players:[],version:1});return;}
 if(!match)throw Error('This reservation no longer exists.');if(['edit','cancel','remove'].includes(action)&&match.host!==user)throw Error('Only the host can change this match or remove players.');if(!['cancel','remove'].includes(action)&&started(match))throw Error('This match has already started.');
 if(action==='cancel'){rows.splice(index,1);return;}
 if(action==='edit'){if((match.version||1)!==payload.expectedVersion)throw Error('This match changed. Reopen the editor before saving.');checkData(payload.reservation);if(payload.reservation.capacity<match.players.length)throw Error('Capacity cannot be lower than the current signup count.');Object.assign(match,payload.reservation);}
 if(action==='join'){if(!isPractice(match)&&match.host===user)throw Error('You are already the host.');if(!match.players.includes(user)){if(!isPractice(match)&&match.players.length>=match.capacity)throw Error('The last spot has been filled.');match.players.push(user);}}
 if(action==='remove'){if(typeof payload.target!=='string'||payload.target===match.host)throw Error('Choose an attendee to remove.');match.players=match.players.filter(name=>name!==payload.target);}
 if(action==='leave')match.players=match.players.filter(name=>name!==user);match.version=(match.version||1)+1;
}
function landed(rows,action,payload,id){
 const m=rows.find(x=>x.id===(action==='create'?id:payload.id));
 if(action==='create')return !!m;if(action==='cancel')return !m;if(action==='join')return !!m?.players.includes(user);if(action==='leave')return !m||!m.players.includes(user);if(action==='remove')return !m||!m.players.includes(payload.target);
 const t=x=>String(x??'').trim(),r=payload.reservation;return !!m&&m.date===r.date&&m.start===r.start&&m.end===r.end&&t(m.court)===t(r.court)&&Number(m.capacity)===Number(r.capacity)&&t(m.notes)===t(r.notes);
}
async function verifySave(action,payload,id){
 let last=0,seen=null;for(const at of [3e3,8e3,15e3]){await new Promise(r=>setTimeout(r,at-last));last=at;try{const r=await fetch('/api/reservations?fresh=1',{cache:'no-store',signal:AbortSignal.timeout(12000)});const d=await r.json();if(r.ok&&Array.isArray(d.matches)){if(landed(d.matches,action,payload,id))return {data:d,state:'present'};seen=d}}catch{}}
 return seen?{data:seen,state:'absent'}:{state:'unknown'};
}
async function mutate(action,payload,applied){
 if(loadError&&!busy){toast(loadError);$('matchError').textContent=loadError;loadReservations(true);}if(busy||fromDevice||!loaded||loadError||!requireUser())return false;setBusy(true);let before=null,failed=false,sent=false,requestId;
 try{
  const signature=JSON.stringify({action,player:user,...payload});let pending;try{pending=JSON.parse(sessionStorage.getItem(PENDING_KEY)||'null')}catch{}
  requestId=pending?.signature===signature&&['create','edit'].includes(action)?pending.requestId:crypto.randomUUID();try{sessionStorage.setItem(PENDING_KEY,JSON.stringify({signature,requestId}))}catch{}
  const draft=JSON.parse(JSON.stringify(matches));applyLocal(draft,action,payload,requestId);before=matches;matches=draft;applied?.();render();toast('Saving…',6e4);const send=async()=>{const token=await ensurePlayerSession(user);sent=true;return fetch('/api/reservations',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action,player:user,requestId,...payload})})};let response=await send();if(response.status===401){playerToken='';tokenExpires=0;try{localStorage.removeItem(TOKEN_KEY)}catch{}response=await send();}const data=await response.json().catch(()=>({}));if(!response.ok||data.ok!==true)throw Object.assign(Error(data.error||'Google Sheets did not confirm the update. Refresh before retrying.'),{server:true,uncertain:data.uncertain===true});matches=data.matches;ROSTER=data.roster;saveCount++;saveCopy(matches,ROSTER);
  try{sessionStorage.removeItem(PENDING_KEY)}catch{}return true;
 }catch(error){
  if(before&&sent&&(error.uncertain||!error.server)){toast('Still saving…',6e4);$('matchError').textContent='';const check=await verifySave(action,payload,requestId);if(check.state==='present'){matches=check.data.matches;ROSTER=check.data.roster;saveCount++;saveCopy(matches,ROSTER);try{sessionStorage.removeItem(PENDING_KEY)}catch{}return true;}const text=check.state==='absent'?'That didn’t save. Try again.':'Couldn’t confirm the save yet. The list will update when Google responds.';if(check.state==='absent'){matches=check.data.matches;ROSTER=check.data.roster;saveCopy(matches,ROSTER);}toast(text);$('matchError').textContent=text;return false;}
  if(before)matches=before;failed=true;const message=problem(error,'Could not confirm the update. Refresh before retrying.');toast(message);$('matchError').textContent=message;return false;}
 finally{setBusy(false);render();if(failed)loadReservations(true,true);}
}
async function signup(match,joining){if(await mutate(joining?'join':'leave',{id:match.id}))toast(joining?'You’re in!':isPractice(match)?'You left the practice.':'You left the match.');}
const capacityHint=()=>{$('capacity').setCustomValidity(+$('capacity').value>7?'Choose up to 7 other players (8 on the court).':'');$('capacityHint').textContent=`Group of ${(+$('capacity').value||0)+1} with you`+(+$('capacity').value>=7?' (up to 7 others, 8 on the court)':'')};
function openEditor(match=null){
 if(!loaded||loadError||!requireUser())return;editing=match;editingVersion=match?.version||1;$('matchForm').reset();$('matchError').textContent='';$('editorTitle').textContent=match?'Edit reservation':'Post a reservation';$('date').min=localToday();$('date').value=match?match.date:selected<localToday()?localToday():selected;$('start').value=match?.start??'19:00';$('end').value=match?.end??'20:00';$('court').value=match?.court??'Sunset Rec';$('capacity').value=match?.capacity??Math.min(3,ROSTER.length-1);$('capacity').max=Math.min(7,Math.max(0,ROSTER.length-1));$('notes').value=match?.notes??'';capacityHint();$('editor').showModal();
}
$('capacity').oninput=capacityHint;document.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>{const c=$('capacity');c.value=Math.min(+c.max||42,Math.max(0,(+c.value||0)+ +b.dataset.step));capacityHint()});
posts.forEach(b=>b.onclick=()=>openEditor());document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{listFilter=b.dataset.filter;render()});$('closeEditor').onclick=()=>{if(!busy)$('editor').close()};$('editor').addEventListener('cancel',event=>{if(busy)event.preventDefault()});
$('matchForm').onsubmit=async event=>{event.preventDefault();const reservation={date:$('date').value,start:$('start').value,end:$('end').value,court:$('court').value.trim(),capacity:Number($('capacity').value),notes:$('notes').value.trim()};try{checkData(reservation)}catch(error){$('matchError').textContent=error.message;return;}const show=()=>{selected=reservation.date;if(selected<windowStart||selected>addDays(windowStart,5))windowStart=selected;$('editor').close();};if(!await mutate(editing?'edit':'create',{...(editing?{id:editing.id,expectedVersion:editingVersion}:{}),reservation},show)){if(!$('editor').open)$('editor').showModal();return;}toast('Reservation saved to Google Sheets.');};
function moveWindow(days){windowStart=addDays(windowStart,days);selected=windowStart;render();}
$('prev').onclick=()=>moveWindow(-6);$('next').onclick=()=>moveWindow(6);$('today').onclick=()=>{windowStart=localToday();selected=windowStart;render()};$('refresh').onclick=()=>loadReservations(false,true);
const autoRefresh=()=>{if((configured||!loaded)&&document.visibilityState==='visible')loadReservations(true)};window.addEventListener('focus',autoRefresh);document.addEventListener('visibilitychange',autoRefresh);
setInterval(()=>{const today=localToday();if(today!==lastToday){if(windowStart===lastToday)windowStart=today;if(selected===lastToday)selected=today;lastToday=today;render();}autoRefresh();},30000);
try{const c=JSON.parse(localStorage.getItem(CACHE_KEY)||'null');if(Array.isArray(c?.matches)&&Array.isArray(c.roster)&&Date.now()-c.savedAt<7*864e5){matches=c.matches;ROSTER=c.roster;configured=loaded=fromDevice=true}}catch{}
const bar=document.querySelector('.sidehead');if(bar&&'ResizeObserver' in window)new ResizeObserver(()=>document.documentElement.style.setProperty('--stick',bar.offsetHeight+'px')).observe(bar);
render();setBusy(false);void loadReservations();if(!user)openLogin();
