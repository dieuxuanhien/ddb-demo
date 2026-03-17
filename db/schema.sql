-- ---------------------------------------------------------------------------
-- schema.sql  –  discord_clone database schema + seed data
-- ---------------------------------------------------------------------------

CREATE DATABASE IF NOT EXISTS discord_clone;

USE discord_clone;

-- servers ──────────────────────────────────────────────────────────────────
-- node_id represents the "shard owner" for the visualisation demo.
CREATE TABLE IF NOT EXISTS servers (
  id      INT  DEFAULT unique_rowid() PRIMARY KEY,
  name    TEXT NOT NULL,
  node_id INT  NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS servers_name_idx ON servers (name);

-- messages ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id        INT       DEFAULT unique_rowid() PRIMARY KEY,
  server_id INT       NOT NULL REFERENCES servers (id) ON DELETE CASCADE,
  username  TEXT      NOT NULL DEFAULT 'User',
  content   TEXT      NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messages_server_id_idx ON messages (server_id, timestamp DESC);

-- seed data ────────────────────────────────────────────────────────────────
-- 'General' lives on Node 1, 'Random' lives on Node 2.
INSERT INTO servers (name, node_id)
VALUES ('General', 1), ('Random', 2)
ON CONFLICT (name) DO NOTHING;
