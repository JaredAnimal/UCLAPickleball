/** UCLA Club Pickleball reservations. Install in the linked spreadsheet's Apps Script editor. */
function spreadsheetId_(){const props=PropertiesService.getScriptProperties();const saved=props.getProperty('SPREADSHEET_ID');if(saved)return saved;const active=SpreadsheetApp.getActiveSpreadsheet();if(!active)throw new Error('Set SPREADSHEET_ID in Script Properties or bind this script to the reservations spreadsheet.');return active.getId();}
const TIME_ZONE = 'America/Los_Angeles';
const COLUMNS = ['Reservation ID','Date','Start time','End time','Court','Additional slots','Host','Players','Notes','Updated (UTC)','Version'];
function setup() {
 const props=PropertiesService.getScriptProperties();
 let secret=props.getProperty('API_SECRET');
 if(!secret){secret=Utilities.getUuid()+Utilities.getUuid();props.setProperty('API_SECRET',secret);}
 const ss=SpreadsheetApp.openById(spreadsheetId_());ss.setSpreadsheetTimeZone(TIME_ZONE);
 const sheet=ss.getSheetByName('Reservations');if(!sheet)throw new Error('Reservations tab is missing.');
 if(sheet.getLastRow()===0)sheet.getRange(1,1,1,COLUMNS.length).setValues([COLUMNS]);
 SpreadsheetApp.getUi().alert('Connection secret', 'Copy this into the private website’s Connect Google Sheet form:\n\n'+secret, SpreadsheetApp.getUi().ButtonSet.OK);
}
function checkHeaders_(header){
 const normalize=value=>String(value).trim().toLowerCase().replace(/\s+/g,' ');
 const aliases={2:['start time','start (la)','start'],3:['end time','end (la)','end']};
 const invalid=COLUMNS.filter((label,i)=>!(aliases[i]||[normalize(label)]).includes(normalize(header[i])));
 if(invalid.length)throw new Error('Check these Reservations column headers: '+invalid.join(', ')+'. Keep the columns in their original order.');
}
function verifyConnection(){
 const secret=PropertiesService.getScriptProperties().getProperty('API_SECRET');
 const result=JSON.parse(doPost({postData:{contents:JSON.stringify({secret:secret,action:'list'})}}).getContent());
 if(!result.ok)throw new Error(result.error);
 console.log('Connection verified. API version '+result.apiVersion+'. '+result.matches.length+' reservations; '+result.roster.length+' roster players.');
}
function doGet(){return reply_({ok:true,message:'Pickleball connection is online. Reservation data requires authenticated POST requests.'});}
function doPost(event){
 let lock;
 try{
  const raw=event&&event.postData&&event.postData.contents;if(!raw||raw.length>15000)throw new Error('Invalid request.');
  const p=JSON.parse(raw),props=PropertiesService.getScriptProperties(),secret=props.getProperty('API_SECRET');
  if(!secret||!equal_(String(p.secret||''),secret))throw new Error('Connection secret is incorrect.');
  if(p.action!=='list'){lock=LockService.getScriptLock();if(!lock.tryLock(10000))throw new Error('Another player is updating the calendar. Try again.');}
  const sheetId=spreadsheetId_(),ss=SpreadsheetApp.openById(sheetId),sheet=ss.getSheetByName('Reservations'),rosterSheet=ss.getSheetByName('Roster');
  if(!sheet||!rosterSheet)throw new Error('Reservations or Roster tab is missing.');
  checkHeaders_(sheet.getRange(1,1,1,COLUMNS.length).getDisplayValues()[0]);
  const rosterRows=rosterSheet.getLastRow()-1,roster=rosterRows>0?rosterSheet.getRange(2,1,rosterRows,1).getDisplayValues().map(r=>r[0].trim()).filter(Boolean):[];
  if(p.action==='list')return reply_({ok:true,sheetId:sheetId,matches:read_(sheet),roster:roster});
  let matches=read_(sheet);const done=()=>reply_({ok:true,sheetId:sheetId,matches:matches,roster:roster});
  if(!roster.includes(p.player)&&!guest_(p.player))throw new Error('Choose a club player or enter a guest name.');
  if(!['create','edit','join','leave','cancel','remove'].includes(p.action)||typeof p.requestId!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(p.requestId))throw new Error('Invalid action.');
  if(p.action==='join'&&practice_(p.id)&&guest_(p.player))throw new Error('Club practice is NOT open to guests.');
  if(p.action==='create'&&p.requestId.indexOf('practice-')===0)throw new Error('Practice IDs are reserved.');
  const fingerprint=Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify({action:p.action,player:p.player,id:p.id,expectedVersion:p.expectedVersion,reservation:p.reservation,target:p.target})));
  const receiptKey='request_'+p.requestId,receipt=props.getProperty(receiptKey);
  if(receipt){if(JSON.parse(receipt).fingerprint!==fingerprint)throw new Error('The retry contains different data. Refresh and try again.');return done();}
  let index=matches.findIndex(m=>m.id===(p.action==='create'?p.requestId:p.id));
  let match=index>=0?matches[index]:null;
  const now=Utilities.formatDate(new Date(),TIME_ZONE,"yyyy-MM-dd'T'HH:mm");
  if(p.action==='join'&&!match){const practice=practice_(p.id);if(practice){if(practice.date+'T'+practice.end<=now)throw new Error('This practice has ended.');match=practice;match._row=sheet.getLastRow()+1;matches.push(match);index=matches.length-1;}}
  if(match&&match.kind==='practice'&&['edit','cancel','remove'].includes(p.action))throw new Error('Weekly club practices cannot be edited or canceled.');
  if(p.action==='create'){
   if(match){if(match.host!==p.player)throw new Error('Reservation ID already exists.');return done();}
   const data=validate_(p.reservation,now,roster.length);
   match=Object.assign({id:p.requestId,host:p.player,players:[],version:1},data);write_(sheet,sheet.getLastRow()+1,match);matches.push(match);
  }else{
   if(!match){if(p.action==='cancel')return done();throw new Error('This reservation no longer exists. Refresh the calendar.');}
   if(['edit','cancel','remove'].includes(p.action)&&match.host!==p.player)throw new Error('Only the host can change this match or remove players.');
   if(!['cancel','remove'].includes(p.action)&&match.date+'T'+(match.kind==='practice'?match.end:match.start)<=now)throw new Error('This match has already started.');
   if(p.action==='edit'){
    if(Number(p.expectedVersion)!==match.version)throw new Error('This match changed while you were editing. Refresh before saving.');
    const data=validate_(p.reservation,now,roster.length);if(data.capacity<match.players.length)throw new Error('Capacity cannot be lower than the current signup count.');Object.assign(match,data);
   }else if(p.action==='join'){
    if(match.kind!=='practice'&&match.host===p.player)throw new Error('You are already the host.');
    if(!match.players.includes(p.player)){if(match.kind!=='practice'&&match.players.length>=match.capacity)throw new Error('The last spot has been filled. Refresh the calendar.');match.players.push(p.player);}
   }else if(p.action==='remove'){if(typeof p.target!=='string'||p.target===match.host||p.target.length>120)throw new Error('Choose an attendee to remove.');match.players=match.players.filter(n=>n!==p.target);}
   else if(p.action==='leave'){match.players=match.players.filter(n=>n!==p.player);}
   if(p.action==='cancel'){sheet.deleteRow(match._row);matches.splice(index,1);}else{match.version++;write_(sheet,match._row,match);}
  }
  SpreadsheetApp.flush();
  props.setProperty(receiptKey,JSON.stringify({fingerprint:fingerprint,at:Date.now()}));
  const all=props.getProperties(),receipts=Object.keys(all).filter(k=>k.indexOf('request_')===0);if(receipts.length>200){receipts.sort((a,b)=>JSON.parse(all[a]).at-JSON.parse(all[b]).at).slice(0,receipts.length-200).forEach(k=>props.deleteProperty(k));}
  return done();
 }catch(error){return reply_({ok:false,error:error&&error.message?error.message:'The request could not be completed.'});}
 finally{if(lock)lock.releaseLock();}
}
function guest_(name){return typeof name==='string'&&name.endsWith(' [guest]')&&name.length<=109&&name.slice(0,-8).trim().split(/\s+/).length>=2&&!/[\[\]\p{C}]/u.test(name.slice(0,-8));}
function practice_(id){
 if(typeof id!=='string'||!/^practice-\d{4}-\d{2}-\d{2}$/.test(id))return null;
 const date=id.slice(9),d=new Date(date+'T12:00:00Z');if(isNaN(d)||d.toISOString().slice(0,10)!==date)return null;
 const weekday=d.getUTCDay();if(weekday!==0&&weekday!==4)return null;
 return {id:id,kind:'practice',date:date,start:weekday===4?'17:00':'15:00',end:weekday===4?'19:00':'17:00',court:'Club practice',capacity:null,host:'Club practice',players:[],notes:'Weekly club practice. NOT open to guests.',version:1};
}
function read_(sheet){
 const count=sheet.getLastRow()-1;if(count<=0)return [];if(count>10000)throw new Error('Reservation history is too large. Archive older rows first.');
 return sheet.getRange(2,1,count,COLUMNS.length).getDisplayValues().map((r,i)=>({id:r[0],date:r[1],start:r[2],end:r[3],court:r[4],capacity:r[5]==='Unlimited'?null:Number(r[5]),kind:practice_(r[0])?'practice':undefined,host:r[6],players:r[7].split('\n').filter(Boolean),notes:r[8],version:Number(r[10])||1,_row:i+2})).filter(m=>m.id);
}
function validate_(p,now,rosterSize){
 if(!p||typeof p.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||isNaN(Date.parse(p.date))||new Date(p.date).toISOString().slice(0,10)!==p.date)throw new Error('Choose a valid date.');
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.end)||p.end<=p.start)throw new Error('End time must be after start time.');
 if(p.date+'T'+p.start<=now)throw new Error('Choose a future start time.');
 if(typeof p.court!=='string'||!p.court.trim()||p.court.length>100||typeof p.notes!=='string'||p.notes.length>500)throw new Error('Check the location and notes.');
 if(!Number.isInteger(p.capacity)||p.capacity<0||p.capacity>Math.min(7,Math.max(0,rosterSize-1)))throw new Error('Choose up to 7 other players (8 on the court).');
 return {date:p.date,start:p.start,end:p.end,court:p.court.trim(),capacity:p.capacity,notes:p.notes.trim()};
}
function write_(sheet,row,m){
 const day=Date.parse(m.date+'T00:00:00Z')/86400000+25569;
 const time=s=>{const p=s.split(':').map(Number);return (p[0]*60+p[1])/1440;};
 const literal=s=>s===''?s:"'"+s;
 const max=sheet.getMaxRows();if(row>max)sheet.insertRowsAfter(max,row-max+100);
 sheet.getRange(row,2).setNumberFormat('yyyy-mm-dd');sheet.getRange(row,3,1,2).setNumberFormat('hh:mm');
 sheet.getRange(row,1,1,COLUMNS.length).setValues([[literal(m.id),day,time(m.start),time(m.end),literal(m.court),m.kind==='practice'?'Unlimited':m.capacity,literal(m.host),literal(m.players.join('\n')),literal(m.notes),new Date().toISOString(),m.version]]);
 sheet.getRange(row,8,1,2).setWrap(true);
}
function equal_(a,b){let mismatch=a.length^b.length;for(let i=0;i<b.length;i++)mismatch|=(a.charCodeAt(i)||0)^b.charCodeAt(i);return mismatch===0;}
function reply_(value){if(value.ok===true)value.apiVersion=2;return ContentService.createTextOutput(JSON.stringify(value,(key,v)=>key==='_row'?undefined:v)).setMimeType(ContentService.MimeType.JSON);}
