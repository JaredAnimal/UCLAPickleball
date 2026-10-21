-- Only connection settings and owner sign-in throttling live in this database.
-- Reservations and the club roster remain in the existing private Google Sheet.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_attempts (
  key TEXT PRIMARY KEY NOT NULL,
  attempts INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
