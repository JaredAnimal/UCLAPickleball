import {env} from 'cloudflare:workers';

export function database(): D1Database {
  if (!env.DB) throw new Error('Connection storage is unavailable.');
  return env.DB;
}
