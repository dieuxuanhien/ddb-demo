// ---------------------------------------------------------------------------
// server.js  –  Express REST API for the CockroachDB sharding demo
// ---------------------------------------------------------------------------
"use strict";

const express = require("express");
const cors    = require("cors");
const http    = require("http");
const { Pool, types } = require("pg");

const PORT = Number(process.env.PORT) || 3001;

// CockroachDB INT8 (OID 20) would be silently truncated by pg's default
// Number conversion for values > 2^53.  Return them as strings instead.
types.setTypeParser(20, (val) => String(val));

// ── Multi-node connection pool ──────────────────────────────────────────────
// Three independent pools – one per node.  queryDB() tries each in order so
// the app keeps serving even when a node is killed in the demo.
const DB_URLS = [
  process.env.DATABASE_URL || "postgresql://root@roach1:26257/discord_clone?sslmode=disable",
  "postgresql://root@roach2:26257/discord_clone?sslmode=disable",
  "postgresql://root@roach3:26257/discord_clone?sslmode=disable",
];
const pools = DB_URLS.map((u) => new Pool({ connectionString: u, connectionTimeoutMillis: 3000 }));

async function queryDB(text, params) {
  const errs = [];
  for (const pool of pools) {
    try { return await pool.query(text, params); }
    catch (e) { errs.push(e.message); }
  }
  throw new Error(`All nodes unavailable: ${errs.join(" | ")}`);
}

async function waitForDB(maxAttempts = 30, delayMs = 3000) {
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      await queryDB("SELECT 1");
      console.log("✓ Connected to CockroachDB");
      return;
    } catch (err) {
      console.log(`  DB not ready (attempt ${i}/${maxAttempts}): ${err.message}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error("Could not connect to the database after multiple attempts.");
}

// ── Docker Engine API helper ────────────────────────────────────────────────
// Talks to /var/run/docker.sock (mounted in docker-compose.yml).
function dockerRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        socketPath: "/var/run/docker.sock",
        path, method,
        headers: bodyStr
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(bodyStr) }
          : {},
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      }
    );
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// Find a container by compose service label (works for any project name).
async function findContainer(service) {
  const f = encodeURIComponent(JSON.stringify({ label: [`com.docker.compose.service=${service}`] }));
  const { body } = await dockerRequest("GET", `/containers/json?all=1&filters=${f}`);
  return Array.isArray(body) && body.length > 0 ? body[0] : null;
}

// ── Express app ────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// ── /api/servers ───────────────────────────────────────────────────────────

app.get("/api/servers", async (_req, res) => {
  try {
    const { rows } = await queryDB("SELECT id, name, node_id FROM servers ORDER BY id");
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/servers", async (req, res) => {
  const { name, node_id } = req.body;
  if (!name || typeof name !== "string" || !name.trim())
    return res.status(400).json({ error: "name is required" });

  try {
    let targetNode = node_id;
    if (!targetNode) {
      const counts = { 1: 0, 2: 0, 3: 0 };
      const { rows } = await queryDB("SELECT node_id, COUNT(*) AS cnt FROM servers GROUP BY node_id");
      rows.forEach((r) => { counts[r.node_id] = Number(r.cnt); });
      targetNode = Number(Object.entries(counts).sort(([, a], [, b]) => a - b)[0][0]);
    }
    const { rows } = await queryDB(
      "INSERT INTO servers (name, node_id) VALUES ($1, $2) RETURNING id, name, node_id",
      [name.trim(), targetNode]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Server name already exists" });
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── /api/servers/:id/messages ──────────────────────────────────────────────

app.get("/api/servers/:id/messages", async (req, res) => {
  const serverId = req.params.id;
  if (!/^\d+$/.test(serverId)) return res.status(400).json({ error: "invalid server id" });
  try {
    const { rows } = await queryDB(
      `SELECT id, server_id, username, content, timestamp
       FROM messages WHERE server_id = $1 ORDER BY timestamp ASC`,
      [serverId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── /api/messages ──────────────────────────────────────────────────────────

app.post("/api/messages", async (req, res) => {
  const { server_id, username, content } = req.body;
  if (!server_id || !content) return res.status(400).json({ error: "server_id and content are required" });
  try {
    const { rows } = await queryDB(
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

// ── /api/nodes – node management ───────────────────────────────────────────

/** GET /api/nodes/status → { 1: "live"|"dead"|"unknown", 2: …, 3: … } */
app.get("/api/nodes/status", async (_req, res) => {
  const status = {};
  for (const id of [1, 2, 3]) {
    try {
      const c = await findContainer(`roach${id}`);
      status[id] = !c ? "unknown" : c.State === "running" ? "live" : "dead";
    } catch {
      status[id] = "unknown";
    }
  }
  res.json(status);
});

/** POST /api/nodes/:id/kill  – stop the roachN container */
app.post("/api/nodes/:id/kill", async (req, res) => {
  const id = Number(req.params.id);
  if (![1, 2, 3].includes(id)) return res.status(400).json({ error: "invalid node id" });
  try {
    const c = await findContainer(`roach${id}`);
    if (!c) return res.status(404).json({ error: `roach${id} not found` });
    await dockerRequest("POST", `/containers/${c.Id}/stop?t=2`);
    console.log(`⚡ Node ${id} stopped`);
    res.json({ node: id, status: "stopped" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/nodes/:id/start – start the roachN container */
app.post("/api/nodes/:id/start", async (req, res) => {
  const id = Number(req.params.id);
  if (![1, 2, 3].includes(id)) return res.status(400).json({ error: "invalid node id" });
  try {
    const c = await findContainer(`roach${id}`);
    if (!c) return res.status(404).json({ error: `roach${id} not found` });
    await dockerRequest("POST", `/containers/${c.Id}/start`);
    console.log(`✅ Node ${id} started`);
    res.json({ node: id, status: "started" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── Boot ────────────────────────────────────────────────────────────────────

waitForDB()
  .then(() => app.listen(PORT, () => console.log(`✓ API server listening on http://0.0.0.0:${PORT}`)))
  .catch((err) => { console.error("Fatal:", err.message); process.exit(1); });
