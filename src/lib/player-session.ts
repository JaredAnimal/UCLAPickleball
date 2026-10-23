// One matching rule for roster names and name keys: accents, case, apostrophes and punctuation do not matter; non-Latin letters and digits survive.
export const normalize=(s:string)=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/['’‘`]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
