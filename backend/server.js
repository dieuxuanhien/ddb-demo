// ---------------------------------------------------------------------------
// server.js  –  Express REST API for the CockroachDB sharding demo
// ---------------------------------------------------------------------------
"use strict";

const express = require("express");
const cors    = require("cors");
const http    = require("http");
const { Pool, types } = require("pg");

const PORT = Number(process.env.PORT) || 3001;
const DEMO_MAX_MESSAGES_PER_SERVER = Number(process.env.DEMO_MAX_MESSAGES_PER_SERVER || 200);

// CockroachDB INT8 (OID 20) would be silently truncated by pg's default
// Number conversion for values > 2^53.  Return them as strings instead.
types.setTypeParser(20, (val) => String(val));

// ── Multi-node connection pool ──────────────────────────────────────────────
// Four independent pools – one per node.  queryDB() tries each in order so
// the app keeps serving even when a node is killed in the demo.
const DB_URLS = [
  process.env.DATABASE_URL || "postgresql://root@roach1:26257/discord_clone?sslmode=disable",
  "postgresql://root@roach2:26257/discord_clone?sslmode=disable",
  "postgresql://root@roach3:26257/discord_clone?sslmode=disable",
  "postgresql://root@roach4:26257/discord_clone?sslmode=disable",
];
const pools = DB_URLS.map((u) => new Pool({ connectionString: u, connectionTimeoutMillis: 3000 }));
const ADMIN_DB_URLS = DB_URLS.map((u) => {
  const parsed = new URL(u);
  parsed.pathname = "/defaultdb";
  return parsed.toString();
});
const adminPools = ADMIN_DB_URLS.map((u) => new Pool({ connectionString: u, connectionTimeoutMillis: 3000 }));

async function queryDB(text, params) {
  const errs = [];
  for (const pool of pools) {
    try { return await pool.query(text, params); }
    catch (e) { errs.push(e.message); }
  }
  throw new Error(`All nodes unavailable: ${errs.join(" | ")}`);
}

async function queryAdmin(text, params) {
  const errs = [];
  for (const pool of adminPools) {
    try { return await pool.query(text, params); }
    catch (e) { errs.push(e.message); }
  }
  throw new Error(`All admin connections unavailable: ${errs.join(" | ")}`);
}

function parseNodeArray(value) {
  if (Array.isArray(value)) return value.map((v) => Number(v)).filter((n) => Number.isInteger(n));
  if (value == null) return [];
  const raw = String(value).trim();
  if (!raw || raw === "{}") return [];
  const inner = raw.replace(/^\{/, "").replace(/\}$/, "");
  if (!inner) return [];
  return inner
    .split(",")
    .map((part) => Number(String(part).replace(/"/g, "").trim()))
    .filter((n) => Number.isInteger(n));
}

function validateServerId(id) {
  return /^\d+$/.test(String(id));
}

async function getRangePlacementForServer(serverId) {
  if (!validateServerId(serverId)) return null;

  // SHOW RANGE gives real leaseholder + replica placement for this key.
  const stmt = `SHOW RANGE FROM TABLE messages FOR ROW (${serverId}, 0)`;
  const { rows } = await queryDB(stmt);
  if (!rows.length) return null;

  const row = rows[0];
  const replicas = parseNodeArray(row.replicas);
  const votingReplicas = parseNodeArray(row.voting_replicas);
  const chosen = votingReplicas.length ? votingReplicas : replicas;

  return {
    rangeId: row.range_id != null ? Number(row.range_id) : null,
    leaseholderNode: row.lease_holder != null ? Number(row.lease_holder) : null,
    replicas,
    votingReplicas,
    effectiveReplicas: chosen,
  };
}

function isIgnorableSplitError(err) {
  const msg = String(err?.message || "").toLowerCase();
  return msg.includes("existing range boundary") || msg.includes("already split") || msg.includes("duplicate");
}

async function splitRangeForServer(serverId) {
  if (!validateServerId(serverId)) return false;
  try {
    await queryDB(`ALTER TABLE messages SPLIT AT VALUES (${serverId}, 0)`);
    return true;
  } catch (err) {
    if (isIgnorableSplitError(err)) return false;
    throw err;
  }
}

async function scatterMessageRanges() {
  // SCATTER randomizes leaseholders/replica placement across nodes for demo visibility.
  await queryDB("ALTER TABLE messages SCATTER");
}

async function ensureServerRangeSplits() {
  const { rows } = await queryDB("SELECT id FROM servers ORDER BY id");
  for (const row of rows) {
    await splitRangeForServer(String(row.id));
  }
  await scatterMessageRanges();
  console.log("✓ Server range splits ensured for demo");
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
      name TEXT NOT NULL
    )
  `);

  // Backward-compatible migration from earlier demo versions.
  await queryDB("ALTER TABLE servers DROP COLUMN IF EXISTS node_id");

  await queryDB("CREATE UNIQUE INDEX IF NOT EXISTS servers_name_idx ON servers (name)");

  await queryDB(`
    CREATE TABLE IF NOT EXISTS messages (
      id INT DEFAULT unique_rowid() NOT NULL,
      server_id INT NOT NULL REFERENCES servers (id) ON DELETE CASCADE,
      username TEXT NOT NULL DEFAULT 'User',
      content TEXT NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (server_id, id)
    )
  `);

  // If the table already existed with PRIMARY KEY (id), move key prefix to server_id.
  try {
    await queryDB("ALTER TABLE messages ALTER PRIMARY KEY USING COLUMNS (server_id, id)");
  } catch (err) {
    if (!String(err.message).toLowerCase().includes("already")) throw err;
  }

  await queryDB("CREATE INDEX IF NOT EXISTS messages_server_id_idx ON messages (server_id, timestamp DESC)");

  await ensureDemoTuning();

  await queryDB(`
    INSERT INTO servers (name)
    VALUES ('General'), ('Random')
    ON CONFLICT (name) DO NOTHING
  `);

  await ensureServerRangeSplits();

  console.log("✓ Database schema verified");
}

async function ensureDemoTuning() {
  // Cockroach enforces a minimum range_max_bytes of 64 MiB. We use the smallest
  // allowed value to keep demo splits easier to trigger than defaults.
  await queryDB(`
    ALTER TABLE messages CONFIGURE ZONE USING
      num_replicas = 3,
      range_min_bytes = 33554432,
      range_max_bytes = 67108864,
      gc.ttlseconds = 600
  `);

  const { rows } = await queryDB("SHOW ZONE CONFIGURATION FOR TABLE messages");
  const sql = String(rows?.[0]?.raw_config_sql || "");
  if (!sql.includes("range_max_bytes = 67108864")) {
    throw new Error("demo tuning verification failed for messages table zone config");
  }

  console.log("✓ Demo tuning enabled (messages zone + retention cap)");
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
        timeout: 10000, // 10 second timeout
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
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Docker API request timed out"));
    });
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
    const { rows } = await queryDB("SELECT id, name FROM servers ORDER BY id");
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/servers", async (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== "string" || !name.trim())
    return res.status(400).json({ error: "name is required" });

  try {
    const { rows } = await queryDB(
      "INSERT INTO servers (name) VALUES ($1) RETURNING id, name",
      [name.trim()]
    );
    const server = rows[0];

    // Demo behavior: split by server_id immediately, then scatter ranges
    // so newly created servers are more likely to map to different nodes.
    const splitCreated = await splitRangeForServer(String(server.id));
    await scatterMessageRanges();
    const placement = await getRangePlacementForServer(String(server.id));

    res.status(201).json({
      ...server,
      splitCreated,
      placement,
    });
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
       FROM messages WHERE server_id = $1 ORDER BY timestamp DESC LIMIT 100`,
      [serverId]
    );
    res.json(rows.reverse()); // Reverse to show oldest→newest
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

    // Keep demo footprint small by retaining only the latest N messages per server.
    await queryDB(
      `WITH ranked AS (
         SELECT id,
                row_number() OVER (PARTITION BY server_id ORDER BY timestamp DESC, id DESC) AS rn
         FROM messages
         WHERE server_id = $1
       )
       DELETE FROM messages AS m
       USING ranked AS r
       WHERE m.server_id = $1
         AND m.id = r.id
         AND r.rn > $2`,
      [server_id, DEMO_MAX_MESSAGES_PER_SERVER]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── /api/placements – real CockroachDB placement for server_id keys ──────

app.get("/api/placements", async (req, res) => {
  try {
    const idsFromQuery = String(req.query.server_ids || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    let serverIds = idsFromQuery;
    if (serverIds.length === 0) {
      const { rows } = await queryDB("SELECT id FROM servers ORDER BY id");
      serverIds = rows.map((r) => String(r.id));
    }

    const placements = {};
    for (const id of serverIds) {
      if (!validateServerId(id)) continue;
      const placement = await getRangePlacementForServer(id);
      if (placement) placements[id] = placement;
    }

    res.json({
      placements,
      count: Object.keys(placements).length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── /api/nodes – node management ───────────────────────────────────────────

/** GET /api/nodes/status → { 1: "live"|"dead"|"unknown", 2: …, 3: …, 4: … } */
app.get("/api/nodes/status", async (_req, res) => {
  const status = {};
  for (const id of [1, 2, 3, 4]) {
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
  if (![1, 2, 3, 4].includes(id)) return res.status(400).json({ error: "invalid node id" });
  try {
    const c = await findContainer(`roach${id}`);
    if (!c) return res.status(404).json({ error: `roach${id} not found` });
    const result = await dockerRequest("POST", `/containers/${c.Id}/stop?t=2`);
    if (result.status >= 200 && result.status < 300) {
      console.log(`⚡ Node ${id} stopped`);
      res.json({ node: id, status: "stopped" });
    } else {
      throw new Error(`Docker API error: ${result.status} ${result.body}`);
    }
  } catch (err) {
    console.error(`Failed to kill node ${id}:`, err);
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/nodes/:id/start – start the roachN container */
app.post("/api/nodes/:id/start", async (req, res) => {
  const id = Number(req.params.id);
  if (![1, 2, 3, 4].includes(id)) return res.status(400).json({ error: "invalid node id" });
  try {
    const c = await findContainer(`roach${id}`);
    if (!c) return res.status(404).json({ error: `roach${id} not found` });
    const result = await dockerRequest("POST", `/containers/${c.Id}/start`);
    if (result.status >= 200 && result.status < 300) {
      console.log(`✅ Node ${id} started`);
      res.json({ node: id, status: "started" });
    } else {
      throw new Error(`Docker API error: ${result.status} ${result.body}`);
    }
  } catch (err) {
    console.error(`Failed to start node ${id}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// ── Boot ────────────────────────────────────────────────────────────────────

initCluster()
  .then(() => waitForDB())
  .then(() => ensureSchema())
  .then(() => app.listen(PORT, () => console.log(`✓ API server listening on http://0.0.0.0:${PORT}`)))
  .catch((err) => { console.error("Fatal:", err.message); process.exit(1); });
