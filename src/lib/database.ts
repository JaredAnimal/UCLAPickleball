import {env} from 'cloudflare:workers';

export function database(): D1Database {
  if (!env.DB) throw new Error('Connection storage is unavailable.');
  return env.DB;
}
// Worker clocks move only during I/O, so Date.now() around an await measures the D1 wait.
export type Timing={d1:number;trips:number;start:number};
export const timing=():Timing=>({d1:0,trips:0,start:Date.now()});
export async function timed<T>(t:Timing|undefined,p:Promise<T>):Promise<T>{const s=Date.now();try{return await p;}finally{if(t){t.d1+=Date.now()-s;t.trips++;}}}
export const serverTiming=(t:Timing)=>`d1;dur=${t.d1};desc="${t.trips}", total;dur=${Date.now()-t.start}`;
