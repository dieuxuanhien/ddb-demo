// ---------------------------------------------------------------------------
// server.js  –  Express REST API for the CockroachDB sharding demo
// ---------------------------------------------------------------------------
"use strict";

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const PORT = Number(process.env.PORT) || 3001;
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://root@localhost:26257/discord_clone?sslmode=disable";

// ── Database pool ──────────────────────────────────────────────────────────

// CockroachDB uses INT8 (OID 20) for primary keys. Node's pg driver converts
// those to JS Number, silently losing precision above 2^53. Return them as
// strings so the full 64-bit value is preserved across the API boundary.
const { types } = require("pg");
types.setTypeParser(20, (val) => String(val)); // INT8 → string

const pool = new Pool({ connectionString: DATABASE_URL });

/** Retry the initial connection until the DB is ready (up to ~90 s). */
async function waitForDB(maxAttempts = 30, delayMs = 3000) {
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const client = await pool.connect();
      await client.query("SELECT 1");
      client.release();
      console.log("✓ Connected to CockroachDB");
      return;
    } catch (err) {
      console.log(
        `  DB not ready (attempt ${i}/${maxAttempts}): ${err.message}`
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error("Could not connect to the database after multiple attempts.");
}

// ── Express app ────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// ── /api/servers ───────────────────────────────────────────────────────────

/** GET /api/servers – list all servers with their owning node. */
app.get("/api/servers", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, name, node_id FROM servers ORDER BY id"
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/servers – create a new server.
 * Body: { name: string, node_id?: number }
 * If node_id is omitted the backend picks the least-loaded node.
 */
app.post("/api/servers", async (req, res) => {
  const { name, node_id } = req.body;
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }

  try {
    let targetNode = node_id;

    if (!targetNode) {
      // Find which node currently holds the fewest servers
      const { rows } = await pool.query(
        `SELECT node_id, COUNT(*) AS cnt
         FROM servers
         GROUP BY node_id
         ORDER BY cnt ASC
         LIMIT 1`
      );

      if (rows.length === 0) {
        targetNode = 1;
      } else {
        // All nodes: 1, 2, 3.  Pick the one with fewest (or missing entirely).
        const counts = { 1: 0, 2: 0, 3: 0 };
        const allRows = await pool.query(
          "SELECT node_id, COUNT(*) AS cnt FROM servers GROUP BY node_id"
        );
        allRows.rows.forEach((r) => {
          counts[r.node_id] = Number(r.cnt);
        });
        targetNode = Number(
          Object.entries(counts).sort(([, a], [, b]) => a - b)[0][0]
        );
      }
    }

    const { rows } = await pool.query(
      "INSERT INTO servers (name, node_id) VALUES ($1, $2) RETURNING id, name, node_id",
      [name.trim(), targetNode]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      // unique_violation
      return res.status(409).json({ error: "Server name already exists" });
    }
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── /api/servers/:id/messages ──────────────────────────────────────────────

/** GET /api/servers/:id/messages – list messages for a server. */
app.get("/api/servers/:id/messages", async (req, res) => {
  const serverId = req.params.id;
  if (!/^\d+$/.test(serverId)) {
    return res.status(400).json({ error: "invalid server id" });
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, server_id, username, content, timestamp
       FROM messages
       WHERE server_id = $1
       ORDER BY timestamp ASC`,
      [serverId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── /api/messages ──────────────────────────────────────────────────────────

/**
 * POST /api/messages – create a new message.
 * Body: { server_id: number, username: string, content: string }
 */
app.post("/api/messages", async (req, res) => {
  const { server_id, username, content } = req.body;
  if (!server_id || !content) {
    return res.status(400).json({ error: "server_id and content are required" });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO messages (server_id, username, content)
       VALUES ($1, $2, $3)
       RETURNING id, server_id, username, content, timestamp`,
      [server_id, username || "User", content]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── Boot ────────────────────────────────────────────────────────────────────

waitForDB()
  .then(() => {
    app.listen(PORT, () =>
      console.log(`✓ API server listening on http://0.0.0.0:${PORT}`)
    );
  })
  .catch((err) => {
    console.error("Fatal:", err.message);
    process.exit(1);
  });
