-- Round 10: D1 is the source of truth for reservations; the Sheet's Reservations tab is a copy. Times are Unix milliseconds. capacity NULL = Unlimited (practice); players is a JSON array.
CREATE TABLE reservations (id TEXT PRIMARY KEY NOT NULL, date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, court TEXT NOT NULL, capacity INTEGER, host TEXT NOT NULL, players TEXT NOT NULL, notes TEXT NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL, cancelled_at INTEGER);
CREATE INDEX reservations_date ON reservations (date);
-- One receipt per applied save, so a re-sent request id replays instead of applying twice. Pruned after 7 days.
CREATE TABLE requests (request_id TEXT PRIMARY KEY NOT NULL, fingerprint TEXT NOT NULL, at INTEGER NOT NULL);
-- Bumped by every applied change (a save, the import, an accepted roster); the snapshot and the Sheet copy carry it.
CREATE TABLE data_version (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL);
INSERT INTO data_version (id, version) VALUES (1, 0);
