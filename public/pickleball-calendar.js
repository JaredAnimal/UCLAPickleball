const CONFIG=JSON.parse(document.getElementById('calendarConfig').textContent);
let ROSTER=CONFIG.roster;
const $=id=>document.getElementById(id),USER_KEY='ucla-pickleball-user-v1',PENDING_KEY='ucla-pickleball-pending-v1',TOKEN_KEY='ucla-pickleball-session-v1';
const norm=s=>s.trim().replace(/\s+/g,' ').toLowerCase();
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const guestSuffix=' [guest]';
const isGuest=name=>typeof name==='string'&&name.endsWith(guestSuffix)&&name.length<=109&&name.slice(0,-guestSuffix.length).trim().split(/\s+/).length>=2&&!/[\[\]\p{C}]/u.test(name.slice(0,-guestSuffix.length));
const playerName=name=>isGuest(name)?name.slice(0,-guestSuffix.length):name;
const playerHtml=name=>esc(playerName(name))+(isGuest(name)?' <span class="guest-tag">[guest]</span>':'');
let loginMode='member',loginPending=false,playerToken='',tokenPlayer='',tokenExpires=0;
const localToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const dateObj=s=>new Date(s+'T12:00:00Z');
const dateKey=d=>`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
const addDays=(s,n)=>{const d=dateObj(s);d.setUTCDate(d.getUTCDate()+n);return dateKey(d)};
const dayLabel=(s,options)=>dateObj(s).toLocaleDateString('en-US',{...options,timeZone:'UTC'});
const timeLabel=t=>{const [h,m]=t.split(':').map(Number);return `${h%12||12}:${String(m).padStart(2,'0')} ${h<12?'AM':'PM'}`};
function clubNow(){const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;}
const isPractice=m=>m.kind==='practice';
const started=m=>`${m.date}T${isPractice(m)?m.end:m.start}`<=clubNow();
function practiceForDate(date){const weekday=dateObj(date).getUTCDay(),start=weekday===4?'17:00':weekday===0?'15:00':null;if(!start)return null;return {id:'practice-'+date,kind:'practice',date,start,end:weekday===4?'19:00':'17:00',court:'Club practice',capacity:null,host:'Club practice',players:[],notes:'Weekly club practice. NOT open to guests.',version:1};}
function matchesForDate(date,rows){const practice=practiceForDate(date),regular=rows.filter(m=>m.date===date&&!m.id.startsWith('practice-'));if(practice){const saved=rows.find(m=>m.id===practice.id);regular.push({...practice,players:saved?.players||[],version:saved?.version||1});}return regular.sort((a,b)=>a.start.localeCompare(b.start));}
const newId=()=>typeof crypto.randomUUID==='function'?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
let user='',selected=localToday(),windowStart=localToday(),editing=null,editingVersion=null,toastTimer,loaded=false,configured=false,loading=false,busy=false,loadError='',matches=[],lastToday=localToday();
try{user=localStorage.getItem(USER_KEY)||''}catch{}
try{({token:playerToken='',player:tokenPlayer='',expires:tokenExpires=0}=JSON.parse(localStorage.getItem(TOKEN_KEY)||'{}'))}catch{}
if(ROSTER.length&&!ROSTER.includes(user)&&!isGuest(user))user='';
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5000);}
function setBusy(value){busy=value;$('post').disabled=value||!loaded||!!loadError;$('refresh').disabled=value||loading;const submit=$('matchForm').querySelector('button.primary');submit.disabled=value;submit.textContent=value?'Saving…':'Save reservation';}
function showNotice(){
 const notice=$('syncNotice');notice.hidden=true;notice.className='notice error';notice.replaceChildren();
 if(loadError){notice.hidden=false;notice.textContent=loadError+(loaded?' Displaying the last loaded reservations. Saving is paused.':' Reservations could not be loaded.');const retry=document.createElement('button');retry.textContent='Retry';retry.onclick=()=>loadReservations();notice.append(retry);}
}
async function loadReservations(silent=false){
 if(loading||busy)return;loading=true;$('refresh').disabled=true;
 try{const response=await fetch('/api/reservations',{cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error||'Could not load reservations.');configured=data.configured===true;ROSTER=data.roster||ROSTER;if(!busy)matches=configured?data.matches:[];loaded=true;loadError=configured?'':'Shared reservations are not connected. The owner needs to finish setup at /admin.';if(user&&!isGuest(user)&&!ROSTER.includes(user)){user='';openLogin();}$('capacity').max=Math.max(0,ROSTER.length-1);render();if(configured&&user)ensurePlayerSession(user).catch(()=>{});}
 catch(error){loadError=error.message||'Could not load reservations.';showNotice();render();if(!silent)toast(loadError);}
 finally{loading=false;setBusy(busy);}
}
function requireUser(){if(user)return true;openLogin();return false;}
async function ensurePlayerSession(name){
 if(playerToken&&tokenPlayer===name&&tokenExpires>Date.now()+60000)return playerToken;
 const response=await fetch('/api/player-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({player:name})});
 const data=await response.json();if(!response.ok||data.player!==name||typeof data.token!=='string')throw Error(data.error||'Could not confirm your player name. Please retry.');
 playerToken=data.token;tokenPlayer=data.player;tokenExpires=data.expires*1000;try{localStorage.setItem(TOKEN_KEY,JSON.stringify({token:playerToken,player:tokenPlayer,expires:tokenExpires}))}catch{}return playerToken;
}
function setLoginMode(mode){loginMode=mode;$('loginTitle').textContent=mode==='guest'?'Welcome, guest.':'Hey, Bruin.';$('loginIntro').textContent=mode==='guest'?'Enter any first and last name. Your name will show a red [guest] tag on signups.':'Enter your name as it appears on the club roster to join the calendar.';$('loginSubmit').textContent=mode==='guest'?'Enter as guest':'Enter calendar';$('guestMode').textContent=mode==='guest'?'Use club roster':'Continue as guest';$('loginError').textContent='';}
function openLogin(){if(loginPending)return;setLoginMode('member');$('loginCancel').hidden=!user;$('loginForm').reset();if(!$('login').open)$('login').showModal();}
$('login').addEventListener('cancel',event=>{if(!user||loginPending)event.preventDefault()});
$('loginCancel').onclick=()=>{if(user)$('login').close()};
$('switchUser').onclick=openLogin;
$('guestMode').onclick=()=>{setLoginMode(loginMode==='guest'?'member':'guest');$('first').focus();};
$('loginForm').onsubmit=async event=>{event.preventDefault();if(loginPending)return;if(!loaded||!configured||loadError){$('loginError').textContent=loadError||'Loading the club roster. Please wait and try again.';return;}const first=$('first').value.trim().replace(/\s+/g,' '),last=$('last').value.trim().replace(/\s+/g,' ');let name;
 if(loginMode==='guest'){name=first+' '+last+guestSuffix;if(!first||!last||first.length>50||last.length>50||!isGuest(name)){$('loginError').textContent='Enter a first and last name without brackets or control characters.';return;}}
 else{name=ROSTER.find(n=>norm(n)===norm(first+' '+last));if(!name){$('loginError').textContent='Name not found. Check the club roster or continue as guest.';return;}}
 loginPending=true;$('loginSubmit').disabled=true;$('guestMode').disabled=true;$('loginCancel').disabled=true;$('loginSubmit').textContent='Checking name…';
 try{await ensurePlayerSession(name);user=name;try{localStorage.setItem(USER_KEY,user)}catch{toast('Your browser cannot remember your player name.')}$('login').close();render();}
 catch(error){$('loginError').textContent=error.message||'Could not confirm your player name. Please retry.';}
 finally{loginPending=false;$('loginSubmit').disabled=false;$('guestMode').disabled=false;$('loginCancel').disabled=false;$('loginSubmit').textContent=loginMode==='guest'?'Enter as guest':'Enter calendar';}
};
function displayRange(){const last=addDays(windowStart,5);const sameMonth=windowStart.slice(0,7)===last.slice(0,7);const first=dayLabel(windowStart,{month:'short',day:'numeric',...(windowStart.slice(0,4)!==last.slice(0,4)?{year:'numeric'}:{})});return first+' – '+(sameMonth?dateObj(last).getUTCDate()+', '+last.slice(0,4):dayLabel(last,{month:'short',day:'numeric',year:'numeric'}));}
function render(){
 $('identity').innerHTML=user?playerHtml(user):'Choose your player';$('monthTitle').textContent=displayRange();$('dayTitle').textContent=dayLabel(selected,{weekday:'long',month:'short',day:'numeric'});$('post').disabled=busy||!loaded||!!loadError;showNotice();
 $('calendar').innerHTML='';
 for(let i=0;i<6;i++){
  const key=addDays(windowStart,i),today=key===localToday(),dayMatches=matchesForDate(key,matches);
  const button=document.createElement('button');button.className='day'+(key===selected?' selected':'')+(today?' today':'');button.setAttribute('aria-label',`${dayLabel(key,{weekday:'long',month:'short',day:'numeric',year:'numeric'})}, ${dayMatches.length} reservations`);button.setAttribute('aria-pressed',String(key===selected));
  button.innerHTML=`<span class="dayheading"><span class="dayname">${today?'Today':dayLabel(key,{weekday:'short'})}</span><span class="daynum">${dateObj(key).getUTCDate()}</span><span class="daycount">${dayMatches.length} reservation${dayMatches.length===1?'':'s'}</span></span>`+dayMatches.slice(0,4).map(m=>{const mine=m.host===user||m.players.includes(user),practice=isPractice(m),full=!practice&&m.players.length>=m.capacity;return `<span class="chip ${mine?'mine':full?'full':''}"><span class="chiptime">${esc(timeLabel(m.start))}</span>${practice?'Club practice':esc(playerName(m.host).split(' ')[0])+(isGuest(m.host)?' <span class="guest-tag">[guest]</span>':'')} · ${practice?'Unlimited':full?'Full':m.capacity-m.players.length+' open'}</span>`}).join('')+(dayMatches.length>4?`<span class="small">+${dayMatches.length-4} more</span>`:dayMatches.length?'':`<span class="dayempty">${loaded?'No matches yet':'Loading…'}</span>`);
  button.onclick=()=>{selected=key;render()};$('calendar').append(button);
 }
 const daily=matchesForDate(selected,matches);$('matches').innerHTML='';
 if(!daily.length){const empty=document.createElement('div');empty.className='empty';empty.textContent=!loaded?'Loading reservations…':loadError?'Reservations are temporarily unavailable.':'No matches posted yet. Have a reservation? Start the group.';$('matches').append(empty);if(loaded&&!loadError){const button=document.createElement('button');button.textContent='+ Post for this day';button.onclick=()=>openEditor();button.disabled=busy;$('matches').append(button);}}
 daily.forEach(m=>{
  const practice=isPractice(m),own=!practice&&m.host===user,joined=m.players.includes(user),available=practice?Infinity:m.capacity-m.players.length,past=started(m);const card=document.createElement('article');card.className='card';
  card.innerHTML=`<h4>${esc(timeLabel(m.start))} – ${esc(timeLabel(m.end))}</h4><div class="muted small">${esc(m.court)}</div><span class="badge ${available<=0||past?'full':''}">${past?(practice?'Ended':'Started / past'):practice?'Unlimited signups':available>0?`${available} spot${available===1?'':'s'} open`:'Full'}</span><div class="small"><strong>${practice?`${m.players.length} going`:`${m.players.length+1} / ${m.capacity+1} players`}</strong></div><ul class="players">${practice?'':`<li>${playerHtml(m.host)} <strong>· Host</strong></li>`}${m.players.map(player=>`<li>${playerHtml(player)}</li>`).join('')}</ul>${m.notes?`<p class="muted small" style="white-space:pre-wrap">${esc(m.notes)}</p>`:''}`;
  if(own){card.querySelectorAll('.players li').forEach((item,index)=>{if(index===0)return;const player=m.players[index-1],button=document.createElement('button');button.className='remove-player danger';button.textContent='Remove';button.setAttribute('aria-label','Remove '+playerName(player));button.disabled=busy||!!loadError||!loaded;button.onclick=async()=>{if(confirm('Remove '+playerName(player)+' from this match?'))if(await mutate('remove',{id:m.id,target:player}))toast(playerName(player)+' removed from the match.');};item.append(button);});}
  const actions=document.createElement('div');actions.className='actions';const add=(label,fn,style='',disabled=false)=>{const button=document.createElement('button');button.textContent=label;button.className=style;button.disabled=disabled||busy||!!loadError||!loaded;button.onclick=fn;actions.append(button)};
  if(own){add('Edit',()=>openEditor(m),'',past);add('Cancel match',async()=>{if(confirm('Cancel this reservation for everyone?'))await mutate('cancel',{id:m.id})},'danger');}
  else if(joined)add(practice?'Leave practice':'Leave match',()=>signup(m,false),'',past);
  else if(practice&&isGuest(user))add('Members only',()=>{},'',true);
  else add(past?'Closed':available>0?(practice?'Join practice':'Join match'):'Full',()=>signup(m,true),'primary',available<=0||past);
  card.append(actions);$('matches').append(card);
 });
}
function checkData(data){if(!data.court.trim())throw Error('Enter a court or location.');if(data.end<=data.start)throw Error('End time must be after start time on the same day.');if(started(data))throw Error('Choose a start time in the future.');if(!Number.isInteger(data.capacity)||data.capacity<0||data.capacity>ROSTER.length-1)throw Error('Choose a valid number of additional players.');}
function applyLocal(rows,action,payload,id){
 if(action==='join'&&String(payload.id||'').startsWith('practice-')&&isGuest(user))throw Error('Club practice is NOT open to guests.');
 let index=rows.findIndex(m=>m.id===payload.id),match=rows[index];
 if(action==='join'&&!match&&/^practice-\d{4}-\d{2}-\d{2}$/.test(payload.id||'')){const practice=practiceForDate(payload.id.slice(9));if(practice&&practice.id===payload.id){if(started(practice))throw Error('This practice has ended.');match=practice;rows.push(match);index=rows.length-1;}}
 if(match&&isPractice(match)&&['edit','cancel','remove'].includes(action))throw Error('Weekly club practices cannot be edited or canceled.');
 if(action==='create'){checkData(payload.reservation);rows.push({...payload.reservation,id,host:user,players:[],version:1});return;}
 if(!match)throw Error('This reservation no longer exists.');if(['edit','cancel','remove'].includes(action)&&match.host!==user)throw Error('Only the host can change this match or remove players.');if(!['cancel','remove'].includes(action)&&started(match))throw Error('This match has already started.');
 if(action==='cancel'){rows.splice(index,1);return;}
 if(action==='edit'){if((match.version||1)!==payload.expectedVersion)throw Error('This match changed. Reopen the editor before saving.');checkData(payload.reservation);if(payload.reservation.capacity<match.players.length)throw Error('Capacity cannot be lower than the current signup count.');Object.assign(match,payload.reservation);}
 if(action==='join'){if(!isPractice(match)&&match.host===user)throw Error('You are already the host.');if(!match.players.includes(user)){if(!isPractice(match)&&match.players.length>=match.capacity)throw Error('The last spot has been filled.');match.players.push(user);}}
 if(action==='remove'){if(typeof payload.target!=='string'||payload.target===match.host)throw Error('Choose an attendee to remove.');match.players=match.players.filter(name=>name!==payload.target);}
 if(action==='leave')match.players=match.players.filter(name=>name!==user);match.version=(match.version||1)+1;
}
async function mutate(action,payload,applied){
 if(busy||!loaded||loadError||!requireUser())return false;setBusy(true);let before=null;
 try{
  const signature=JSON.stringify({action,player:user,...payload});let pending;try{pending=JSON.parse(sessionStorage.getItem(PENDING_KEY)||'null')}catch{}
  const requestId=pending?.signature===signature?pending.requestId:newId();try{sessionStorage.setItem(PENDING_KEY,JSON.stringify({signature,requestId}))}catch{}
  if(configured){const draft=JSON.parse(JSON.stringify(matches));applyLocal(draft,action,payload,requestId);before=matches;matches=draft;applied?.();render();const token=await ensurePlayerSession(user);const response=await fetch('/api/reservations',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action,player:user,requestId,...payload})});const data=await response.json();if(response.status===401){playerToken='';tokenExpires=0;try{localStorage.removeItem(TOKEN_KEY)}catch{}}if(!response.ok||data.ok!==true)throw Error(data.error||'Google Sheets did not confirm the update. Refresh before retrying.');matches=data.matches;ROSTER=data.roster;}
  try{sessionStorage.removeItem(PENDING_KEY)}catch{}render();return true;
 }catch(error){if(before)matches=before;toast(error.message||'Could not confirm the update. Refresh before retrying.');return false;}
 finally{setBusy(false);render();}
}
async function signup(match,joining){if(await mutate(joining?'join':'leave',{id:match.id}))toast(joining?'You’re in!':isPractice(match)?'You left the practice.':'You left the match.');}
function openEditor(match=null){
 if(!loaded||loadError||!requireUser())return;editing=match?.id??null;editingVersion=match?.version||1;$('matchForm').reset();$('matchError').textContent='';$('editorTitle').textContent=match?'Edit reservation':'Post a reservation';$('date').min=localToday();$('date').value=match?match.date:selected<localToday()?localToday():selected;$('start').value=match?.start??'18:00';$('end').value=match?.end??'20:00';$('court').value=match?.court??'Sunset Rec';$('capacity').value=match?.capacity??Math.min(3,ROSTER.length-1);$('capacity').max=Math.max(0,ROSTER.length-1);$('notes').value=match?.notes??'';$('editor').showModal();
}
$('post').onclick=()=>openEditor();$('closeEditor').onclick=()=>{if(!busy)$('editor').close()};$('editor').addEventListener('cancel',event=>{if(busy)event.preventDefault()});
$('matchForm').onsubmit=async event=>{event.preventDefault();const reservation={date:$('date').value,start:$('start').value,end:$('end').value,court:$('court').value.trim(),capacity:Number($('capacity').value),notes:$('notes').value.trim()};try{checkData(reservation)}catch(error){$('matchError').textContent=error.message;return;}const show=()=>{selected=reservation.date;if(selected<windowStart||selected>addDays(windowStart,5))windowStart=selected;$('editor').close();};if(!await mutate(editing?'edit':'create',{...(editing?{id:editing,expectedVersion:editingVersion}:{}),reservation},show)){if(!$('editor').open&&!busy)$('editor').showModal();return;}{show();render();toast('Reservation saved to Google Sheets.');}};
function moveWindow(days){windowStart=addDays(windowStart,days);selected=windowStart;render();}
$('prev').onclick=()=>moveWindow(-6);$('next').onclick=()=>moveWindow(6);$('today').onclick=()=>{windowStart=localToday();selected=windowStart;render()};$('refresh').onclick=()=>loadReservations();
window.addEventListener('focus',()=>{if(configured)loadReservations(true)});
setInterval(()=>{const today=localToday();if(today!==lastToday){if(windowStart===lastToday)windowStart=today;if(selected===lastToday)selected=today;lastToday=today;render();}if(configured&&document.visibilityState==='visible')loadReservations(true);},30000);
render();void loadReservations();if(!user)openLogin();
