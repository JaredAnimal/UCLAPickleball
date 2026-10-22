import archive from '../../downloads/Picklebot-Windows.zip';
import {hasBotAccess} from '../lib/bot-access';

export async function GET(request:Request){
 try{
  if(!await hasBotAccess(request,'public-bot'))return new Response(null,{status:303,headers:{Location:'/bot','Cache-Control':'private, no-store'}});
  return new Response(archive,{headers:{
   'Content-Type':'application/zip',
   'Content-Disposition':'attachment; filename="Picklebot-Windows.zip"',
   'Content-Length':String(archive.byteLength),
   'Cache-Control':'private, no-store',
  }});
 }catch{
  return new Response('The bot download is temporarily unavailable. Please retry.',{status:503,headers:{'Cache-Control':'private, no-store'}});
 }
}
