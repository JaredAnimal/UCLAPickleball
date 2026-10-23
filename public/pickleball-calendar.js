const CONFIG=JSON.parse(document.getElementById('calendarConfig').textContent);
let ROSTER=CONFIG.roster;
const $=id=>document.getElementById(id),PENDING_KEY='ucla-pickleball-pending-v1',CACHE_KEY='pickleball-reservations-v1';
const norm=s=>s.trim().replace(/\s+/g,' ').toLowerCase();
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const guestSuffix=' [guest]';
const isGuest=name=>typeof name==='string'&&name.endsWith(guestSuffix)&&name.length<=109&&name.slice(0,-guestSuffix.length).trim().split(/\s+/).length>=2&&!/[\[\]\p{C}]/u.test(name.slice(0,-guestSuffix.length));
const playerName=name=>isGuest(name)?name.slice(0,-guestSuffix.length):name;
const playerHtml=name=>esc(playerName(name))+(isGuest(name)?' <span class="guest-tag">[guest]</span>':'');
let saveCount=0;
const localToday=()=>laDay.format(new Date());
const laDay=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}),laNow=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}),dayFormats={};
const dateObj=s=>new Date(s+'T12:00:00Z');
const dateKey=d=>`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
const addDays=(s,n)=>{const d=dateObj(s);d.setUTCDate(d.getUTCDate()+n);return dateKey(d)};
const dayLabel=(s,options)=>(dayFormats[JSON.stringify(options)]??=new Intl.DateTimeFormat('en-US',{...options,timeZone:'UTC'})).format(dateObj(s));
const timeLabel=t=>{const [h,m]=t.split(':').map(Number);return `${h%12||12}:${String(m).padStart(2,'0')} ${h<12?'AM':'PM'}`};
function clubNow(){const t=Math.floor(Date.now()/6e4);if(clubNow.t!==t){const p=Object.fromEntries(laNow.formatToParts(new Date(t*6e4)).map(x=>[x.type,x.value]));clubNow.t=t;clubNow.v=`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`}return clubNow.v}
const spotsLine=n=>n?`${n} player${n===1?'':'s'} will lose their spot.`:'No one else has signed up yet.',matchWhen=m=>`${dayLabel(m.date,{weekday:'long',month:'short',day:'numeric'})} · ${timeLabel(m.start)} – ${timeLabel(m.end)}`;
const isPractice=m=>m.kind==='practice';
const live=m=>`${m.date}T${m.end}`>clubNow(),chipTime=t=>timeLabel(t).replace(':00','');
const started=m=>`${m.date}T${isPractice(m)?m.end:m.start}`<=clubNow();
function practiceForDate(date){const weekday=dateObj(date).getUTCDay(),start=weekday===4?'17:00':weekday===0?'15:00':null;if(!start)return null;return {id:'practice-'+date,kind:'practice',date,start,end:weekday===4?'19:00':'17:00',court:'Club practice',capacity:null,host:'Club practice',players:[],notes:'Weekly club practice. NOT open to guests.',version:1};}
function matchesForDate(date,rows){const practice=practiceForDate(date),regular=rows.filter(m=>m.date===date&&!m.id.startsWith('practice-'));if(practice){const saved=rows.find(m=>m.id===practice.id);regular.push({...practice,players:saved?.players||[],version:saved?.version||1});}return regular.sort((a,b)=>a.start.localeCompare(b.start));}
let user='',selected=localToday(),windowStart=localToday(),editing=null,editingVersion=null,toastTimer,loaded=false,configured=false,loading=false,fromDevice=false,loadError='',matches=[],confirmed=[],pending=[],queue=Promise.resolve(),resync=false,lastOp=0,lastWrite=0,lastToday=localToday();let gone=false;const signedOut=()=>{if(!gone){gone=true;location.assign('/login')}};
user=CONFIG.player;for(const k of ['ucla-pickleball-user-v1','ucla-pickleball-session-v1'])try{localStorage.removeItem(k)}catch{}
const problem=(error,fallback)=>error instanceof TypeError||/^(Timeout|Abort)Error$/.test(error?.name)?'Network problem. Check your connection and try again.':error?.message||fallback;
function toast(message,ms=5000){const t=$('toast');if($('editor').open&&$('matchError').textContent===message)return;if(document.querySelector('dialog[open]')){t.hidePopover?.();t.showPopover?.()}t.textContent=message;clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.textContent='',ms);}
const posts=document.querySelectorAll('.post');
const saveCopy=(m,r)=>{try{localStorage.setItem(CACHE_KEY,JSON.stringify({savedAt:Date.now(),matches:m,roster:r}))}catch{}};
function showNotice(){
 const notice=$('syncNotice'),text=loadError&&loadError+(loaded?' Displaying the last loaded reservations. Saving is paused.':' Reservations could not be loaded.');if(notice.dataset.text===text)return;notice.dataset.text=text;notice.hidden=!text;notice.textContent=text;
 if(text){const retry=document.createElement('button');retry.textContent='Retry';retry.onclick=()=>loadReservations(false,true);notice.append(retry);}
}
async function loadReservations(silent=false,fresh=false){
 if(pending.length){if(!silent){resync=true;toast('Refreshing after your save…');}return;}if(loading){if(!silent)resync=true;return;}loading=true;let stale=false;const saves=saveCount,early=window.reservationsRequest;window.reservationsRequest=null;if(!silent)$('refresh').setAttribute('aria-disabled','true');
 try{const response=(early&&await early)||await fetch('/api/reservations'+(fresh?'?fresh=1':''),{cache:'no-store',signal:AbortSignal.timeout?.(3e4)});if(response.status===401)return signedOut();const data=await response.json().catch(()=>({}));if(!response.ok||typeof data.configured!=='boolean')throw Error(data.error||'Could not load reservations.');configured=data.configured===true;ROSTER=data.roster||ROSTER;if(!pending.length&&saves===saveCount){confirmed=configured?data.matches:[];if(configured)saveCopy(data.matches,ROSTER);}loaded=true;fromDevice=false;stale=!fresh&&data.copyAge>180;loadError=configured?'':'Shared reservations are not connected. The owner needs to finish setup at /admin.';setView();}
 catch(error){const message=problem(error,'Could not load reservations.');if(!loaded||fromDevice||loadError)loadError=message;fromDevice=false;render();if(!silent)toast(message);}
 finally{loading=false;$('refresh').setAttribute('aria-disabled',String(fromDevice));}
 if(stale&&Date.now()-lastWrite>=3e4)loadReservations(true,true);settle();
}
function ask({title,day,note,keep,ok}){const d=$('confirm');if(d.open)return Promise.resolve(false);$('confirmTitle').textContent=title;$('confirmDay').textContent=day;$('confirmNote').textContent=note;$('confirmKeep').textContent=keep;$('confirmOk').textContent=ok;d.returnValue='';return new Promise(resolve=>{const done=()=>resolve(d.returnValue==='ok');d.addEventListener('close',done,{once:true});try{d.showModal();}catch{d.removeEventListener('close',done);return resolve(false);}$('confirmKeep').focus();});}
$('confirm').addEventListener('click',event=>{if(event.target!==event.currentTarget)return;const r=event.currentTarget.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.currentTarget.close();});
function displayRange(){const last=addDays(windowStart,5);const sameMonth=windowStart.slice(0,7)===last.slice(0,7);const first=dayLabel(windowStart,{month:'short',day:'numeric',...(windowStart.slice(0,4)!==last.slice(0,4)?{year:'numeric'}:{})});return first+' – '+(sameMonth?dateObj(last).getUTCDate()+', '+last.slice(0,4):dayLabel(last,{month:'short',day:'numeric',year:'numeric'}));}
// Spots drawn as dots: host plus joined players filled, the viewer's own spot gold. Text only past `max`.
const spots=(m,max)=>{const total=m.capacity+1,taken=m.players.length+1,me=m.host===user||m.players.includes(user);return isPractice(m)||total>max?'':`<span class="spots" aria-hidden="true">${Array.from({length:total},(_,i)=>`<i class="${i<taken?(me&&!i?'me':'on'):''}"></i>`).join('')}</span>`};
let listFilter='all';
const initials=name=>playerName(name).trim().split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
const av=name=>`<span class="av${name===user?' me':''}" aria-hidden="true">${esc(initials(name))}</span>`;
function render(){
 const sig=JSON.stringify([matches,pending.map(o=>o.requestId),loadError,fromDevice,loaded,user,listFilter,windowStart,selected,clubNow()]);if(sig===render.sig)return;render.sig=sig;const focused=document.activeElement?.dataset?.k;
 $('identity').innerHTML=user?playerHtml(user):'Choose your player';$('initials').textContent=user?initials(user):'';$('profile').setAttribute('aria-label',user?'Profile: '+playerName(user):'Profile');$('monthTitle').textContent=displayRange();document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===listFilter)));posts.forEach(b=>b.disabled=!loaded||!!loadError||fromDevice);showNotice();
 $('calendar').innerHTML='';
 for(let i=0;i<6;i++){
  const key=addDays(windowStart,i),today=key===localToday(),dayMatches=matchesForDate(key,matches).filter(live);
  const button=document.createElement('button');button.className='day'+(key===selected?' selected':'')+(today?' today':'');button.dataset.k='d'+key;button.setAttribute('aria-label',`${today?'Today, ':''}${dayLabel(key,{weekday:'long',month:'short',day:'numeric',year:'numeric'})}, ${dayMatches.length} reservation${dayMatches.length===1?'':'s'}`);button.setAttribute('aria-pressed',String(key===selected));
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
  if(!daily.length){const none=document.createElement('p'),post=document.createElement('button');none.className='none';none.textContent='No matches yet. ';post.className='link';post.dataset.k='p'+key;post.textContent='Post one';post.disabled=fromDevice||!!loadError;post.onclick=()=>{selected=key;openEditor()};none.append(post);block.append(none);continue;}
  daily.forEach(m=>{
   const i=shown++,practice=isPractice(m),own=!practice&&m.host===user,joined=m.players.includes(user),available=practice?Infinity:m.capacity-m.players.length,past=started(m),status=own?'Hosting':joined?'You’re in':practice?'':past?'Started':available>0?available+' open':'Full',saving=pending.some(op=>(op.payload.id||op.requestId)===m.id);const card=document.createElement('article');card.className=fresh?'card enter':'card';card.style.setProperty('--i',i);if(saving)card.setAttribute('aria-busy','true');
   card.innerHTML=`<div class="cardtop"><h5>${esc(timeLabel(m.start))} – ${esc(timeLabel(m.end))}</h5>${status&&`<span class="badge${own||joined?' mine':available<=0||past?' full':''}">${status}</span>`}</div><div class="muted small">${esc(m.court)}</div><div class="count${available<=0?' full':''}">${spots(m,12)}<strong>${practice?`${m.players.length} going`:`${m.players.length+1} of ${m.capacity+1} players`}</strong></div><ul class="players">${practice?'':`<li>${av(m.host)}${playerHtml(m.host)} <strong>· Host</strong></li>`}${m.players.map(player=>`<li>${av(player)}${playerHtml(player)}</li>`).join('')}</ul>${m.notes?`<p class="muted small" style="white-space:pre-wrap">${esc(m.notes)}</p>`:''}`;
   if(own){card.querySelectorAll('.players li').forEach((item,index)=>{if(index===0)return;const player=m.players[index-1],button=document.createElement('button');button.className='remove-player danger';button.dataset.k='r'+m.id+player;button.textContent='Remove';button.setAttribute('aria-label','Remove '+playerName(player));button.disabled=fromDevice||!!loadError||!loaded;button.onclick=()=>ask({title:'Remove '+playerName(player)+'?',day:matchWhen(m),note:"They'll lose their spot.",keep:'Keep',ok:'Remove'}).then(yes=>{if(yes&&mutate('remove',{id:m.id,target:player}))toast(playerName(player)+' removed from the match.');});item.append(button);});}
   const actions=document.createElement('div');actions.className='actions';const add=(label,fn,style='',disabled=false)=>{const button=document.createElement('button');button.textContent=label;button.className=style;button.dataset.k=m.id+':'+actions.childElementCount;button.disabled=disabled||fromDevice||!!loadError||!loaded;button.onclick=fn;actions.append(button)};
   if(own){add('Edit',()=>openEditor(m),'',past||saving);add('Cancel match',()=>ask({title:'Cancel this match?',day:matchWhen(m),note:spotsLine((matches.find(x=>x.id===m.id)||m).players.length),keep:'Keep it',ok:'Cancel match'}).then(yes=>{if(yes&&mutate('cancel',{id:m.id}))toast('Reservation canceled.')}),'danger');}
   else if(joined)add(practice?'Leave practice':'Leave match',()=>signup(m,false),'',past);
   else if(practice&&isGuest(user))add('Members only',()=>{},'',true);
   else if(!past&&available>0)add(practice?'Join practice':'Join match',()=>signup(m,true),'primary');
   if(actions.firstChild)card.append(actions);block.append(card);
  });
 }
 if(!$('matches').children.length){const empty=document.createElement('div');empty.className='empty';empty.textContent=!loaded?'Loading reservations…':loadError?'Reservations are temporarily unavailable.':listFilter==='mine'?'You’re not in any matches this week.':'No open spots right now. Try next week or post a match.';$('matches').append(empty);}
 if(focused)document.querySelector('[data-k="'+CSS.escape(focused)+'"]')?.focus({preventScroll:true});
}
function checkData(data){if(!data.court.trim())throw Error('Enter a court or location.');if(data.end<=data.start)throw Error('End time must be after start time on the same day.');if(started(data))throw Error('Choose a start time in the future.');if(!Number.isInteger(data.capacity)||data.capacity<0||data.capacity>Math.min(7,ROSTER.length-1))throw Error('Choose up to 7 other players (8 on the court).');}
function applyLocal(rows,action,payload,id,who=user){
 if(action==='join'&&String(payload.id||'').startsWith('practice-')&&isGuest(who))throw Error('Club practice is NOT open to guests.');
 let index=rows.findIndex(m=>m.id===payload.id),match=rows[index];
 if(action==='join'&&!match&&/^practice-\d{4}-\d{2}-\d{2}$/.test(payload.id||'')){const practice=practiceForDate(payload.id.slice(9));if(practice&&practice.id===payload.id){if(started(practice))throw Error('This practice has ended.');match=practice;rows.push(match);index=rows.length-1;}}
 if(match&&isPractice(match)&&['edit','cancel','remove'].includes(action))throw Error('Weekly club practices cannot be edited or canceled.');
 if(action==='create'){checkData(payload.reservation);if(!rows.some(m=>m.id===id))rows.push({...payload.reservation,id,host:who,players:[],version:1});return;}
 if(!match)throw Error('This reservation no longer exists.');if(['edit','cancel','remove'].includes(action)&&match.host!==who)throw Error('Only the host can change this match or remove players.');if(!['cancel','remove'].includes(action)&&started(match))throw Error('This match has already started.');
 if(action==='cancel'){rows.splice(index,1);return;}
 if(action==='edit'){if((match.version||1)!==payload.expectedVersion)throw Error('This match changed. Reopen the editor before saving.');checkData(payload.reservation);if(payload.reservation.capacity<match.players.length)throw Error('Capacity cannot be lower than the current signup count.');Object.assign(match,payload.reservation);}
 if(action==='join'){if(!isPractice(match)&&match.host===who)throw Error('You are already the host.');if(!match.players.includes(who)){if(!isPractice(match)&&match.players.length>=match.capacity)throw Error('The last spot has been filled.');match.players.push(who);}}
 if(action==='remove'){if(typeof payload.target!=='string'||payload.target===match.host)throw Error('Choose an attendee to remove.');match.players=match.players.filter(name=>name!==payload.target);}
 if(action==='leave')match.players=match.players.filter(name=>name!==who);match.version=(match.version||1)+1;
}
const viewOf=(confirmed,ops)=>{const rows=JSON.parse(JSON.stringify(confirmed));for(const op of ops)try{applyLocal(rows,op.action,op.payload,op.requestId,op.who)}catch{}return rows};
function setView(){matches=viewOf(confirmed,pending);const current=editing&&$('editor').open&&matches.find(m=>m.id===editing.id);if(current&&['date','start','end','court','capacity','notes'].every(k=>current[k]===editing[k]))editingVersion=current.version;render();}
function landed(rows,action,payload,id,user){
 const m=rows.find(x=>x.id===(action==='create'?id:payload.id));
 if(action==='create')return !!m;if(action==='cancel')return !m;if(action==='join')return !!m?.players.includes(user);if(action==='leave')return !m||!m.players.includes(user);if(action==='remove')return !m||!m.players.includes(payload.target);
 const t=x=>String(x??'').trim(),r=payload.reservation;return !!m&&m.date===r.date&&m.start===r.start&&m.end===r.end&&t(m.court)===t(r.court)&&Number(m.capacity)===Number(r.capacity)&&t(m.notes)===t(r.notes);
}
async function verifySave(action,payload,id,who){
 const t0=Date.now(),end=t0+30e3;let seen=null;for(const at of [3e3,8e3,15e3]){await new Promise(r=>setTimeout(r,Math.max(0,t0+at-Date.now())));if(Date.now()>=end)break;try{const r=await fetch('/api/reservations?fresh=1',{cache:'no-store',signal:AbortSignal.timeout?.(Math.max(1e3,end-Date.now()))});if(r.status===401){signedOut();break}const d=await r.json();if(r.ok&&Array.isArray(d.matches)){if(landed(d.matches,action,payload,id,who))return {data:d,state:'present'};seen=d}}catch{}}
 return seen?{data:seen,state:'absent'}:{state:'unknown'};
}
const settle=()=>{if(!pending.length&&resync&&!loading){resync=false;loadReservations(true,true);}};
// ponytail: one save in flight at a time; queued-but-unsent ops are lost if the page closes while an earlier op is in flight (~2 s normally, up to ~80 s when Google stalls: two 25 s POSTs plus the 30 s verify). Persist the queue in sessionStorage if that bites.
async function run(op){
 const {action,payload,requestId,who}=op;let data=null,text='',failed=false,sent=false;
 const send=async()=>{sent=true;return fetch('/api/reservations',{method:'POST',keepalive:true,signal:AbortSignal.timeout?.(25e3),headers:{'Content-Type':'application/json'},body:JSON.stringify({action,player:who,requestId,...payload})})};
 const save=async()=>{const response=await send();if(response.status===401){signedOut();throw Object.assign(Error('Your session ended. Signing you in again…'),{server:true,status:401});}const d=await response.json().catch(()=>null);if(!response.ok||d?.ok!==true)throw Object.assign(Error(d?.error||'Google Sheets did not confirm the update. Refresh before retrying.'),{server:true,status:response.status,uncertain:!d||d.uncertain===true,busy:d?.busy===true,data:response.status===409&&Array.isArray(d?.matches)&&Array.isArray(d?.roster)?d:null});return d;};
 try{data=await save();}
 catch(error){
  const doubt=x=>sent&&(x.uncertain||!x.server&&navigator.onLine!==false);let e=error,unsure=doubt(e);
  // The script keeps a receipt per requestId, so the identical re-send returns the first result. Only a rule rejection (409) proves nothing landed; a busy lock says nothing about a first send that may have landed, but a busy first send proves nothing applied, so it gets the same single re-send.
  if(unsure||e.busy&&e.status===409){const was=unsure;await new Promise(r=>setTimeout(r,1500));try{data=await save();unsure=false;}catch(again){e=again;unsure=again.status===409&&!again.busy?false:was||doubt(again);}}
  if(unsure){const check=await verifySave(action,payload,requestId,who);data=check.data||null;if(check.state==='absent'){text='That didn’t save. Try again.';failed=true;}if(check.state==='unknown'){text='Couldn’t confirm the save yet. The list will update when Google responds.';confirmed=viewOf(confirmed,[op]);}}
  else if(!data){text=problem(e,'Could not confirm the update. Refresh before retrying.');failed=true;data=e.data||null;if(!data)resync=true;}
 }
 pending.splice(pending.indexOf(op),1);saveCount++;if(data){lastWrite=Date.now();loadError='';confirmed=data.matches;ROSTER=data.roster||ROSTER;saveCopy(confirmed,ROSTER);if(!text)try{if(JSON.parse(sessionStorage.getItem(PENDING_KEY)).requestId===requestId)sessionStorage.removeItem(PENDING_KEY)}catch{}}
 setView();if(text)(failed&&!/changed/.test(text)&&op.reopen||toast)(text);settle();
}
function mutate(action,payload,applied,reopen){
 if(loadError){$('matchError').textContent=loadError;toast(loadError);loadReservations(true);}if(fromDevice||!loaded||loadError)return false;if(Date.now()-lastOp<400)return false;
 const who=user,retry=['create','edit'].includes(action),signature=JSON.stringify({action,player:who,...payload});let saved;try{saved=JSON.parse(sessionStorage.getItem(PENDING_KEY)||'null')}catch{}
 const requestId=retry&&saved?.signature===signature?saved.requestId:crypto.randomUUID(),op={action,payload,requestId,who,reopen},draft=JSON.parse(JSON.stringify(matches));
 try{applyLocal(draft,action,payload,requestId)}catch(error){const message=problem(error,'Could not confirm the update. Refresh before retrying.');$('matchError').textContent=message;toast(message);resync=true;settle();return false;}
 if(retry)try{sessionStorage.setItem(PENDING_KEY,JSON.stringify({signature,requestId}))}catch{}
 pending.push(op);queue=queue.then(()=>run(op)).catch(console.error);lastOp=Date.now();matches=draft;applied?.();render();return true;
}
function signup(match,joining){if(mutate(joining?'join':'leave',{id:match.id}))toast(joining?'You’re in!':isPractice(match)?'You left the practice.':'You left the match.');}
const capacityHint=()=>{$('capacity').setCustomValidity(+$('capacity').value>7?'Choose up to 7 other players (8 on the court).':+$('capacity').value<(+$('capacity').min||0)?'Keep room for the '+$('capacity').min+' already signed up.':'');$('capacityHint').textContent=`Group of ${(+$('capacity').value||0)+1} with you`+(+$('capacity').value===7?' (up to 7 others, 8 on the court)':'')};
function openEditor(match=null){
 if(!loaded||loadError)return;editing=match;editingVersion=match?.version||1;$('matchForm').reset();$('matchError').textContent='';$('editorTitle').textContent=match?'Edit reservation':'Post a reservation';$('date').min=localToday();$('date').value=match?match.date:selected<localToday()?localToday():selected;$('start').value=match?.start??'19:00';$('end').value=match?.end??'20:00';$('court').value=match?.court??'Sunset Rec';$('capacity').value=match?.capacity??Math.min(3,ROSTER.length-1);$('capacity').max=Math.min(7,Math.max(0,ROSTER.length-1));$('capacity').min=match?.players.length||0;$('notes').value=match?.notes??'';capacityHint();$('editor').showModal();
}
$('capacity').oninput=capacityHint;document.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>{const c=$('capacity');c.value=Math.min(+c.max||42,Math.max(+c.min||0,(+c.value||0)+ +b.dataset.step));capacityHint()});
posts.forEach(b=>b.onclick=()=>openEditor());document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{listFilter=b.dataset.filter;render()});$('closeEditor').onclick=()=>$('editor').close();
$('matchForm').onsubmit=event=>{event.preventDefault();const reservation={date:$('date').value,start:$('start').value,end:$('end').value,court:$('court').value.trim(),capacity:Number($('capacity').value),notes:$('notes').value.trim()};try{checkData(reservation)}catch(error){$('matchError').textContent=error.message;return;}const show=()=>{selected=reservation.date;if(selected<windowStart||selected>addDays(windowStart,5))windowStart=selected;$('editor').close();},was=editing,version=editingVersion;
 const reopen=message=>{if(document.querySelector('dialog[open]'))return toast(message);openEditor(was);if(!$('editor').open)return toast(message);editingVersion=version;for(const k in reservation)$(k).value=reservation[k];capacityHint();$('matchError').textContent=message;};
 if(!mutate(editing?'edit':'create',{...(editing?{id:editing.id,expectedVersion:editingVersion}:{}),reservation},show,reopen)){if(!$('editor').open)$('editor').showModal();return;}toast(was?'Reservation updated.':'Reservation posted.');};
function moveWindow(days){windowStart=addDays(windowStart,days);selected=windowStart;render();}
$('prev').onclick=()=>moveWindow(-6);$('next').onclick=()=>moveWindow(6);$('today').onclick=()=>{windowStart=localToday();selected=windowStart;render()};$('refresh').onclick=()=>{if($('refresh').getAttribute('aria-disabled')==='true')return;loadReservations(false,true)};
const autoRefresh=()=>{const today=localToday();if(today!==lastToday){if(windowStart===lastToday)windowStart=today;if(selected===lastToday)selected=today;lastToday=today;render();}if((configured||!loaded)&&document.visibilityState==='visible')loadReservations(true)};
window.addEventListener('focus',autoRefresh);window.addEventListener('online',autoRefresh);document.addEventListener('visibilitychange',autoRefresh);setInterval(autoRefresh,30000);
try{const c=JSON.parse(localStorage.getItem(CACHE_KEY)||'null');if(Array.isArray(c?.matches)&&Array.isArray(c.roster)&&Date.now()-c.savedAt<7*864e5){confirmed=matches=c.matches;ROSTER=c.roster;configured=loaded=fromDevice=true}}catch{}
const bar=document.querySelector('.sidehead');if(bar&&'ResizeObserver' in window)new ResizeObserver(()=>document.documentElement.style.setProperty('--stick',bar.offsetHeight+'px')).observe(bar);
$('toast').showPopover?.();render();void loadReservations();
