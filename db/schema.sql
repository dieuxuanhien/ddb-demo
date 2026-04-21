-- ---------------------------------------------------------------------------
-- schema.sql  –  discord_clone database schema + seed data
-- ---------------------------------------------------------------------------

CREATE DATABASE IF NOT EXISTS discord_clone;

USE discord_clone;

-- servers ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS servers (
  id   INT  DEFAULT unique_rowid() PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS servers_name_idx ON servers (name);

-- messages ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id        INT       DEFAULT unique_rowid() NOT NULL,
  server_id INT       NOT NULL REFERENCES servers (id) ON DELETE CASCADE,
  username  TEXT      NOT NULL DEFAULT 'User',
  content   TEXT      NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (server_id, id)
);

CREATE INDEX IF NOT EXISTS messages_server_id_idx ON messages (server_id, timestamp DESC);

-- seed data ────────────────────────────────────────────────────────────────
