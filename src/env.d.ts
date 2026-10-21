declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ASSETS: Fetcher;
    ADMIN_PASSWORD: string;
    BOT_DOWNLOAD_PASSWORD: string;
    BOT_SESSION_SECRET: string;
    SHEETS_ENCRYPTION_KEY: string;
    SHEETS_SPREADSHEET_ID: string;
  }
}
declare module '*.html' { const text: string; export default text; }
declare module '*.gs' { const text: string; export default text; }
