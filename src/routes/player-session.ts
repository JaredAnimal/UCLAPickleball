import {json,sameOrigin,tooLarge,loadConnection,playerError} from '../lib/sheet-connection';
import {ROSTER} from '../lib/pickleball-config';
import {readCopy,refreshCopy} from '../lib/reservation-copy';
import {canonicalPlayer,issuePlayerSession} from '../lib/player-session';
export async function POST(request:Request){
 if(!sameOrigin(request))return json({error:'This request is not allowed.'},403);
 if(tooLarge(request,1000))return json({error:'Request is too large.'},413);
 try{
  const raw=await request.text();if(raw.length>1000)return json({error:'Invalid player name.'},400);
  const p=JSON.parse(raw)??{},connection=await loadConnection();
  let player:string|null;if(connection){const copy=await readCopy();player=copy?canonicalPlayer(p.player,copy.data.roster):null;if(!player&&!(copy&&Date.now()-copy.savedAt<=300000))player=canonicalPlayer(p.player,(await refreshCopy(connection)).data.roster);}else player=canonicalPlayer(p.player,ROSTER);
  if(!player)return json({error:'Choose a name from the club roster or continue as guest.'},403);
  // Names intentionally use the club's honor system; the signed session binds writes to that choice.
  return json(await issuePlayerSession(player));
 }catch(error){if(error instanceof SyntaxError)return json({error:'Invalid player name.'},400);return json({error:playerError(error)},503);}
}
