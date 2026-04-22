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
const pools = DB_URLS.map((u) => new Pool({ connectionString: u, connectionTimeoutMillis: 2000 }));
const ADMIN_DB_URLS = DB_URLS.map((u) => {
  const parsed = new URL(u);
  parsed.pathname = "/defaultdb";
  return parsed.toString();
});
const adminPools = ADMIN_DB_URLS.map((u) => new Pool({ connectionString: u, connectionTimeoutMillis: 2000 }));
const NODE_IDS = [1, 2, 3];
const nodeBackoffUntil = { 1: 0, 2: 0, 3: 0 };
let lastHealthyNode = 1;
let serversCache = [];
const messagesCache = new Map();
const NODE_BACKOFF_MS = 5000;
const MAX_CACHED_MESSAGE_SERVER_KEYS = 50;
const MAX_CACHED_SERVER_ROWS = 2000;

function setMessagesCache(serverId, rows) {
  const key = String(serverId);
  if (!messagesCache.has(key) && messagesCache.size >= MAX_CACHED_MESSAGE_SERVER_KEYS) {
    const oldestKey = messagesCache.keys().next().value;
    if (oldestKey) messagesCache.delete(oldestKey);
  }
  messagesCache.delete(key); // refresh insertion order (LRU)
  messagesCache.set(key, rows);
}

function getMessagesCache(serverId) {
  const key = String(serverId);
  const val = messagesCache.get(key);
  if (!val) return null;
  messagesCache.delete(key); // refresh insertion order (LRU)
  messagesCache.set(key, val);
  return val;
}

function orderedNodeIds(preferredNode) {
  const unique = [];
  const pushUnique = (id) => {
    const n = Number(id);
    if (NODE_IDS.includes(n) && !unique.includes(n)) unique.push(n);
  };
  pushUnique(preferredNode);
  pushUnique(lastHealthyNode);
  NODE_IDS.forEach(pushUnique);

  const now = Date.now();
  const healthy = unique.filter((id) => nodeBackoffUntil[id] <= now);
  return healthy.length > 0 ? [...healthy, ...unique.filter((id) => nodeBackoffUntil[id] > now)] : unique;
}

async function queryDB(text, params, options = {}) {
  const errs = [];
  for (const nodeId of orderedNodeIds(options.preferredNode)) {
    const pool = pools[nodeId - 1];
    try {
      const result = await pool.query(text, params);
      nodeBackoffUntil[nodeId] = 0;
      lastHealthyNode = nodeId;
      return result;
    }
    catch (e) {
      nodeBackoffUntil[nodeId] = Date.now() + NODE_BACKOFF_MS;
      errs.push(`[roach${nodeId}] ${e.message}`);
    }
  }
  throw new Error(`All nodes unavailable: ${errs.join(" | ")}`);
}

async function queryAdmin(text, params, options = {}) {
  const errs = [];
  for (const nodeId of orderedNodeIds(options.preferredNode)) {
    const pool = adminPools[nodeId - 1];
    try {
      const result = await pool.query(text, params);
      nodeBackoffUntil[nodeId] = 0;
      lastHealthyNode = nodeId;
      return result;
    } catch (e) {
      nodeBackoffUntil[nodeId] = Date.now() + NODE_BACKOFF_MS;
      errs.push(`[roach${nodeId}] ${e.message}`);
    }
  }
  throw new Error(`All admin connections unavailable: ${errs.join(" | ")}`);
}

async function waitForDB(maxAttempts = 30, delayMs = 3000) {
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      await queryAdmin("SELECT 1");
      console.log("✓ Connected to CockroachDB");
      return;
    } catch (err) {
      console.log(`  DB not ready (attempt ${i}/${maxAttempts}): ${err.message}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error("Could not connect to the database after multiple attempts.");
}

async function ensureSchema() {
  // Allow booting without db/init.sh by creating the DB schema in-app.
  await queryAdmin("CREATE DATABASE IF NOT EXISTS discord_clone");

  await queryDB(`
    CREATE TABLE IF NOT EXISTS servers (
      id INT DEFAULT unique_rowid() PRIMARY KEY,
      name TEXT NOT NULL,
      node_id INT NOT NULL DEFAULT 1
    )
  `);

  await queryDB("CREATE UNIQUE INDEX IF NOT EXISTS servers_name_idx ON servers (name)");

  await queryDB(`
    CREATE TABLE IF NOT EXISTS messages (
      id INT DEFAULT unique_rowid() PRIMARY KEY,
      server_id INT NOT NULL REFERENCES servers (id) ON DELETE CASCADE,
      username TEXT NOT NULL DEFAULT 'User',
      content TEXT NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await queryDB("CREATE INDEX IF NOT EXISTS messages_server_id_idx ON messages (server_id, timestamp DESC)");

  await queryDB(`
    INSERT INTO servers (name, node_id)
    VALUES ('General', 1), ('Random', 2)
    ON CONFLICT (name) DO NOTHING
  `);

  console.log("✓ Database schema verified");
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

async function initCluster(maxAttempts = 30, delayMs = 2000) {
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const c = await findContainer("roach1");
      if (!c) throw new Error("roach1 container not found yet");

      const createExec = await dockerRequest("POST", `/containers/${c.Id}/exec`, {
        AttachStdout: true,
        AttachStderr: true,
        Cmd: ["cockroach", "init", "--insecure", "--host=roach1:26257"],
      });

      if (!createExec.body || !createExec.body.Id) {
        throw new Error("failed to create exec for cockroach init");
      }

      const started = await dockerRequest("POST", `/exec/${createExec.body.Id}/start`, {
        Detach: false,
        Tty: false,
      });

      const output = String(started.body || "");
      if (
        output.includes("Cluster successfully initialized") ||
        output.toLowerCase().includes("already been initialized")
      ) {
        console.log("✓ CockroachDB cluster initialized");
        return;
      }

      if (started.status >= 200 && started.status < 300 && !output.trim()) {
        // Some Docker daemons return empty stdout on success.
        console.log("✓ CockroachDB cluster init attempted");
        return;
      }

      throw new Error(output || `cockroach init failed with status ${started.status}`);
    } catch (err) {
      console.log(`  Cluster init pending (attempt ${i}/${maxAttempts}): ${err.message}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  throw new Error("Could not initialize CockroachDB cluster.");
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
    serversCache = rows.slice(-MAX_CACHED_SERVER_ROWS);
    res.json(rows);
  } catch (err) {
    console.error(err);
    if (serversCache.length > 0) {
      return res.json(serversCache);
    }
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
    serversCache = [...serversCache, rows[0]].slice(-MAX_CACHED_SERVER_ROWS);
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
  const preferredNode = Number(req.query.preferredNode);
  if (!/^\d+$/.test(serverId)) return res.status(400).json({ error: "invalid server id" });
  try {
    const { rows } = await queryDB(
      `SELECT id, server_id, username, content, timestamp
       FROM messages WHERE server_id = $1 ORDER BY timestamp ASC`,
      [serverId],
      { preferredNode }
    );
    setMessagesCache(serverId, rows);
    res.json(rows);
  } catch (err) {
    console.error(err);
    const cachedRows = getMessagesCache(serverId);
    if (cachedRows) {
      return res.json(cachedRows);
    }
    res.status(500).json({ error: err.message });
  }
});

// ── /api/messages ──────────────────────────────────────────────────────────

app.post("/api/messages", async (req, res) => {
  const { server_id, username, content, preferred_node_id } = req.body;
  if (!server_id || !content) return res.status(400).json({ error: "server_id and content are required" });
  try {
    const { rows } = await queryDB(
      `INSERT INTO messages (server_id, username, content)
       VALUES ($1, $2, $3)
       RETURNING id, server_id, username, content, timestamp`,
      [server_id, username || "User", content],
      { preferredNode: Number(preferred_node_id) }
    );
    const prior = getMessagesCache(server_id) || [];
    setMessagesCache(server_id, [...prior, rows[0]]);
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

initCluster()
  .then(() => waitForDB())
  .then(() => ensureSchema())
  .then(() => app.listen(PORT, () => console.log(`✓ API server listening on http://0.0.0.0:${PORT}`)))
  .catch((err) => { console.error("Fatal:", err.message); process.exit(1); });
