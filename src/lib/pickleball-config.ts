import {env} from 'cloudflare:workers';
// Member names stay in Google Sheets, outside the public source repository.
export const ROSTER: string[] = [];
export function expectedSheetId() {
 const id=env.SHEETS_SPREADSHEET_ID;
 if(!id||!/^[a-zA-Z0-9_-]{10,200}$/.test(id))throw new Error('Configure the spreadsheet ID in the server settings.');
 return id;
}
export function sheetUrl(){return 'https://docs.google.com/spreadsheets/d/'+expectedSheetId()+'/edit';}
