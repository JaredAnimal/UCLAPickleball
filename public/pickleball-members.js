// Members: officers (in the app) and the owner (/admin) see who linked which name, and can unlink or block. Rows are built with textContent only. One IIFE: classic scripts share top-level names with the page scripts.
(()=>{
const $=id=>document.getElementById(id),when=s=>new Date(s*1000).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}),time=ms=>new Date(ms).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;};
async function act(action,sub){$('members-error').textContent='';try{const r=await fetch('/api/members',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,sub})});if(!r.ok)throw Error((await r.json()).error);}catch(e){$('members-error').textContent=e.message;}loadMembers();}
// Two-tap confirm: the first tap turns the button into its confirm label for 4 s; a second tap within 400 ms (a double-click) is ignored.
function arm(label,confirm,run){const b=el('button',label);b.type='button';let t,at;b.onclick=()=>{if(t){if(Date.now()-at<400)return;clearTimeout(t);t=0;b.disabled=true;run();return;}at=Date.now();b.textContent=confirm;t=setTimeout(()=>{t=0;b.textContent=label;},4000);};return b;}
function row(list,main,sub,...buttons){const li=el('li'),box=el('span',main);if(sub)box.append(el('br'),el('small',sub));li.append(box,...buttons);list.append(li);}
// Shown only when something is wrong: a roster the guard refused, or a Sheet copy that has been behind.
function health(s){
 const h=$('syncHealth'),lines=[];h.replaceChildren();
 if(s?.refused)lines.push(el('p',s.refused.names?`The Roster tab has ${s.refused.names} names, fewer than half of the ${s.refused.current} in use, so the site kept the old roster.`:`The Roster tab is empty, so the site kept the ${s.refused.current} names in use.`),...s.refused.names?[arm('Use the new roster','Confirm new roster',()=>act('accept-roster'))]:[]);
 if(s?.behind&&s.since)lines.push(el('p',`The Google Sheet copy is behind since ${time(s.since)}.`+(s.error?` Last error: ${s.error}`:'')));
 h.append(...lines);h.hidden=!lines.length;
}
async function loadMembers(){
 const roster=$('roster'),guests=$('guests'),blocked=$('blocked'),count=$('count');
 try{const r=await fetch('/api/members',{cache:'no-store'}),d=await r.json();if(!r.ok)throw Error(d.error);
  for(const u of [roster,guests,blocked])u.replaceChildren();
  health(d.sync);
  const actions=l=>d.viewer==='officer'&&l.officer?[]:[arm('Unlink','Confirm unlink',()=>act('unlink',l.sub)),arm('Unlink & block','Confirm block',()=>act('block',l.sub))],tag=l=>l.officer?' · Officer':'';
  const members=d.links.filter(l=>l.kind==='member'),linked=members.filter(l=>l.rosterName!=null),used=new Set(linked.map(l=>l.rosterName));
  if(d.roster){for(const l of linked)row(roster,l.rosterName,l.email+' · '+when(l.linkedAt)+tag(l),...actions(l));for(const name of d.roster)if(!used.has(name))row(roster,name,'Not linked');count.textContent=linked.length+' of '+d.roster.length+' linked';}
  else count.textContent="The roster couldn't be loaded, so link status can't be shown.";
  for(const l of d.roster?members.filter(l=>l.rosterName==null):members)row(roster,l.player,l.email+' · '+when(l.linkedAt)+(d.roster?' · Not on roster':'')+tag(l),...actions(l));
  for(const l of d.links.filter(l=>l.kind==='guest'))row(guests,l.player,l.email+' · '+when(l.linkedAt),...actions(l));
  if(!guests.children.length)guests.append(el('li','None'));
  for(const b of d.blocked)row(blocked,b.email||b.sub,when(b.blockedAt),(()=>{const u=el('button','Unblock');u.type='button';u.onclick=()=>{u.disabled=true;act('unblock',b.sub);};return u;})());
  if(!blocked.children.length)blocked.append(el('li','None'));
 }catch(e){for(const u of [roster,guests,blocked])u.replaceChildren();count.textContent='';$('syncHealth').hidden=true;$('members-error').textContent=e.message;}
}
window.loadMembers=loadMembers;
})();
