declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ASSETS: Fetcher;
    CF_VERSION_METADATA?: WorkerVersionMetadata;
    ADMIN_PASSWORD: string;
    BOT_DOWNLOAD_PASSWORD: string;
    BOT_SESSION_SECRET: string;
    SHEETS_ENCRYPTION_KEY: string;
    SHEETS_SPREADSHEET_ID: string;
    SHEET_TIMEOUT_MS?: string;
  }
}
declare module '*.html' { const text: string; export default text; }
declare module '*.gs' { const text: string; export default text; }
declare module '*.zip' { const data: ArrayBuffer; export default data; }
