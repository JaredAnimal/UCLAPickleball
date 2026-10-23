const state=document.getElementById('state'),error=document.getElementById('error'),script=document.getElementById('script'),button=document.getElementById('save');
async function load(){try{const response=await fetch('/api/sheets-connection',{cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error);script.value=data.script;state.textContent=data.configured?'Google Sheet is connected. Reservations are shared.':'Connect the existing Google deployment below to enable shared reservations.';}catch(e){error.textContent=e.message;}}
document.getElementById('copy').onclick=async()=>{try{await navigator.clipboard.writeText(script.value);state.textContent='Connection code copied.';}catch{script.focus();script.select();state.textContent='Code selected. Copy it, then paste into Apps Script.';}};
document.getElementById('connect').onsubmit=async event=>{event.preventDefault();button.disabled=true;button.textContent='Verifying…';error.textContent='';try{const form=new FormData(event.target),response=await fetch('/api/sheets-connection',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint:String(form.get('endpoint')).trim(),secret:String(form.get('secret')).trim()})});const data=await response.json();if(!response.ok)throw Error(data.error);event.target.reset();state.textContent='Google Sheet connected. Shared reservations are ready.';button.textContent='Connected';const link=document.createElement('a');link.href='/';link.textContent='Open the shared calendar';state.append(document.createElement('br'),link);}catch(e){error.textContent=e.message;button.textContent='Verify & connect';}finally{button.disabled=false;}};void load();
// Members: officers see who linked which name, and can unlink or block. Rows are built with textContent only.
const mErr=document.getElementById('members-error'),when=s=>new Date(s*1000).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;};
async function act(action,sub){mErr.textContent='';try{const r=await fetch('/api/members',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,sub})});if(!r.ok)throw Error((await r.json()).error);}catch(e){mErr.textContent=e.message;}loadMembers();}
// Two-tap confirm: the first tap turns the button into its confirm label for 4 s; a second tap within 400 ms (a double-click) is ignored.
function arm(label,confirm,run){const b=el('button',label);b.type='button';let t,at;b.onclick=()=>{if(t){if(Date.now()-at<400)return;clearTimeout(t);t=0;b.disabled=true;run();return;}at=Date.now();b.textContent=confirm;t=setTimeout(()=>{t=0;b.textContent=label;},4000);};return b;}
function row(list,main,sub,...buttons){const li=el('li'),box=el('span',main);if(sub)box.append(el('br'),el('small',sub));li.append(box,...buttons);list.append(li);}
async function loadMembers(){
 const roster=document.getElementById('roster'),guests=document.getElementById('guests'),blocked=document.getElementById('blocked'),count=document.getElementById('count');
 try{const r=await fetch('/api/members',{cache:'no-store'}),d=await r.json();if(!r.ok)throw Error(d.error);
  for(const u of [roster,guests,blocked])u.replaceChildren();
  const actions=l=>[arm('Unlink','Confirm unlink',()=>act('unlink',l.sub)),arm('Unlink & block','Confirm block',()=>act('block',l.sub))];
  const members=d.links.filter(l=>l.kind==='member'),linked=members.filter(l=>l.rosterName!=null),used=new Set(linked.map(l=>l.rosterName));
  if(d.roster){for(const l of linked)row(roster,l.rosterName,l.email+' · '+when(l.linkedAt),...actions(l));for(const name of d.roster)if(!used.has(name))row(roster,name,'Not linked');count.textContent=linked.length+' of '+d.roster.length+' linked';}
  else count.textContent="The roster couldn't be loaded, so link status can't be shown.";
  for(const l of d.roster?members.filter(l=>l.rosterName==null):members)row(roster,l.player,l.email+' · '+when(l.linkedAt)+(d.roster?' · Not on roster':''),...actions(l));
  for(const l of d.links.filter(l=>l.kind==='guest'))row(guests,l.player,l.email+' · '+when(l.linkedAt),...actions(l));
  if(!guests.children.length)guests.append(el('li','None'));
  for(const b of d.blocked)row(blocked,b.email||b.sub,when(b.blockedAt),(()=>{const u=el('button','Unblock');u.type='button';u.onclick=()=>{u.disabled=true;act('unblock',b.sub);};return u;})());
  if(!blocked.children.length)blocked.append(el('li','None'));
 }catch(e){for(const u of [roster,guests,blocked])u.replaceChildren();count.textContent='';mErr.textContent=e.message;}
}
loadMembers();
