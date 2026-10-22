import {json,sameOrigin,loadConnection,invokeSheet} from '../lib/sheet-connection';
import {ROSTER} from '../lib/pickleball-config';
import {readCopy,writeCopy} from '../lib/reservation-copy';
import {canonicalPlayer,issuePlayerSession} from '../lib/player-session';
export async function POST(request:Request){
 if(!sameOrigin(request))return json({error:'This request is not allowed.'},403);
 try{
  const raw=await request.text();if(raw.length>1000)return json({error:'Invalid player name.'},400);
  const p=JSON.parse(raw)??{},connection=await loadConnection();
  let roster=ROSTER;if(connection){const copy=await readCopy();if(copy&&Date.now()-copy.savedAt<=300000)roster=copy.data.roster;else{const startedAt=Date.now(),data=await invokeSheet(connection,{action:'list'});await writeCopy(data,startedAt);roster=data.roster;}}
  const player=canonicalPlayer(p.player,roster);
  if(!player)return json({error:'Choose a name from the club roster or continue as guest.'},403);
  // Names intentionally use the club's honor system; the signed session binds writes to that choice.
  return json(await issuePlayerSession(player));
 }catch(error){if(error instanceof SyntaxError)return json({error:'Invalid player name.'},400);return json({error:'Could not confirm your player name. Please retry.'},503);}
}
