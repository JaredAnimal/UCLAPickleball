import {readFileSync} from 'node:fs';
const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8').replace(/^\/\/.*$/gm, ''));
if (!config.d1_databases?.[0]?.database_id || config.d1_databases[0].database_id === '00000000-0000-4000-8000-000000000000') {
  console.error('Create your Cloudflare D1 database and replace database_id in wrangler.jsonc first. See README.md.');
  process.exit(1);
}
