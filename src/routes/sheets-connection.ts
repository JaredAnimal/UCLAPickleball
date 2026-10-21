import script from '../lib/pickleball-apps-script.gs';
import {isOwner} from '../lib/admin-access';
import {json,sameOrigin,endpointValid,invokeSheet,saveConnection,loadConnection} from '../lib/sheet-connection';
export async function GET(request:Request){if(!await isOwner(request))return json({error:'Only the site owner can configure the Google Sheet.'},403);try{return json({configured:!!await loadConnection(),script});}catch{return json({error:'Connection settings are unavailable.'},503);}}
export async function POST(request:Request){
 if(!await isOwner(request))return json({error:'Only the site owner can configure the Google Sheet.'},403);
 if(!sameOrigin(request))return json({error:'This request is not allowed.'},403);
 try{const raw=await request.text();if(raw.length>2000)return json({error:'Invalid connection settings.'},400);const p=JSON.parse(raw)??{};if(!endpointValid(p.endpoint)||typeof p.secret!=='string'||p.secret.length<32||p.secret.length>200)return json({error:'Enter the /exec web app URL and connection secret from Google.'},400);const connection={endpoint:p.endpoint,secret:p.secret};await invokeSheet(connection,{action:'list'});await saveConnection(connection);return json({configured:true});}
 catch(error){if(error instanceof SyntaxError)return json({error:'Invalid connection settings.'},400);return json({error:error instanceof Error?error.message:'The Google Sheet connection could not be verified.'},503);}
}
