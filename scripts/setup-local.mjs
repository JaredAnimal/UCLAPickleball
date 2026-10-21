import {randomBytes} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const values = {
  ADMIN_PASSWORD:randomBytes(24).toString('hex'),
  BOT_DOWNLOAD_PASSWORD:randomBytes(16).toString('hex'),
  BOT_SESSION_SECRET:randomBytes(32).toString('hex'),
  SHEETS_ENCRYPTION_KEY:randomBytes(32).toString('base64'),
};
try {
  writeFileSync(new URL('../.dev.vars', import.meta.url), Object.entries(values).map(([k,v]) => `${k}="${v}"`).join('\n')+'\n', {flag:'wx', mode:0o600});
  console.log('Created ignored .dev.vars with random local secrets. Open it locally to read your development passwords.');
  console.log('Add SHEETS_SPREADSHEET_ID="<your test sheet id>" to .dev.vars before using /connect-sheet.');
} catch (error) {
  if (error.code === 'EEXIST') console.log('.dev.vars already exists; no values were changed.');
  else throw error;
}
