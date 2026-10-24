import {hasBotAccess} from '../lib/bot-access';

export async function GET(request:Request){
 try{
  if(!await hasBotAccess(request,'public-bot'))return new Response(null,{status:303,headers:{Location:'/bot','Cache-Control':'private, no-store'}});
  return new Response(null,{status:302,headers:{
   Location:'https://github.com/JaredAnimal/UCLAPickleball/releases/download/picklebot-v0.2.4/Picklebot-Setup-0.2.4.exe',
   'Cache-Control':'private, no-store',
  }});
 }catch{
  return new Response('The bot download is temporarily unavailable. Please retry.',{status:503,headers:{'Cache-Control':'private, no-store'}});
 }
}
