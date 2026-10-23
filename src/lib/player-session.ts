// One matching rule for roster names and name keys: accents, case, apostrophes, punctuation and digits (class-year tags) do not matter; non-Latin letters survive.
export const normalize=(s:string)=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/['’‘`]/g,'').replace(/[^\p{L}]+/gu,' ').trim();
