export const normalize=(s:string)=>s.trim().replace(/\s+/g,' ').toLowerCase();
export function canonicalPlayer(value:unknown,roster:string[]):string|null{
 if(typeof value!=='string'||!value||value.length>120)return null;
 const member=roster.find(name=>normalize(name)===normalize(value));if(member)return member;
 if(!value.endsWith(' [guest]')||value.length>109)return null;
 const name=value.slice(0,-8).trim().replace(/\s+/g,' ');
 if(name.split(' ').length<2||/[\[\]\p{C}]/u.test(value.slice(0,-8)))return null;
 return name+' [guest]';
}
