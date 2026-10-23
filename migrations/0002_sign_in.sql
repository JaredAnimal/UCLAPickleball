-- Google sign-in: opaque sessions (token hash only), member/guest links, blocked accounts. Times are Unix seconds.
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY NOT NULL, sub TEXT NOT NULL, email TEXT NOT NULL, player TEXT, expires_at INTEGER NOT NULL, renewed_at INTEGER NOT NULL);
CREATE INDEX sessions_sub ON sessions (sub);
-- name_key is kind + ':' + normalized name, so a guest and a member with the same name never collide.
CREATE TABLE links (sub TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('member','guest')), player TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE, email TEXT NOT NULL, linked_at INTEGER NOT NULL);
CREATE TABLE blocked (sub TEXT PRIMARY KEY NOT NULL, email TEXT NOT NULL, blocked_at INTEGER NOT NULL);
