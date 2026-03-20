# CockroachDB Sharding Demo

A full-stack web application that demonstrates **distributed database concepts** —
shared-nothing architecture, horizontal fragmentation (sharding), and dynamic
shard allocation — using a real 3-node CockroachDB cluster running entirely in
Docker.

```
┌────────────────────────┬───────────────────────────────┐
│  Discord-like UI       │  CockroachDB Cluster          │
│  (Left pane)           │  (Right pane)                 │
│                        │                               │
│  • Select a server     │  • Node 1 ── Node 2           │
│  • Send messages       │       \      /                │
│  • Create new servers  │        Node 3                 │
│                        │                               │
│  Sending a message →   │  Animated packet flies to     │
│                        │  the node that owns the shard │
│  Creating a server →   │  Cluster evaluates load,      │
│                        │  assigns shard to least-used  │
└────────────────────────┴───────────────────────────────┘
```

---

## Architecture

| Layer     | Technology                            |
|-----------|---------------------------------------|
| Database  | CockroachDB v23.1 (3-node cluster)    |
| Backend   | Node.js 20 + Express + `pg` driver    |
| Frontend  | React 18 + Vite + Tailwind CSS        |
| Container | Docker Compose                        |

### Shared-Nothing Explained

Each CockroachDB node has its own **isolated Docker volume** (`roach1-data`,
`roach2-data`, `roach3-data`). No volume is shared between nodes. This mirrors
the shared-nothing principle: each node owns its own disk and processes its own
data independently.

### Shard Mapping

The `servers` table has a `node_id` column that records which node "owns" the
shard for the purposes of this visualisation:

| Server  | Node | Docker volume  |
|---------|------|----------------|
| General | 1    | roach1-data    |
| Random  | 2    | roach2-data    |
| (new)   | 3*   | roach3-data    |

*New servers are placed on the least-loaded node (fewest existing shards).

---

## Prerequisites

- **Docker** ≥ 24 with the Compose v2 plugin (`docker compose`)
- Ports **3000**, **3001**, **8080**, **26257** free on your machine

---

## Quick start

```bash
# 1. Clone / enter the repo
cd discord-demo

# 2. Start everything (cluster + backend + frontend)
docker compose up --build

# Optional: run this only if you want to manually pre-seed/reset schema
# bash ./db/init.sh

# First boot takes ~90 s while CockroachDB initialises.
# Watch for: "✓ API server listening on http://0.0.0.0:3001"
```

| URL                        | What                              |
|----------------------------|-----------------------------------|
| http://localhost:3000      | The demo application              |
| http://localhost:8080      | CockroachDB Admin UI              |
| http://localhost:3001/health | Backend health check            |

---

## Running the demo

### Send a message
1. Select **General** or **Random** in the left sidebar.
2. Type something in the input box and press **Enter** or ↵.
3. **Watch** the right pane: a glowing blue packet flies from the client
   indicator to the node that owns that server's shard, and the activity log
   updates.

### Create a new server
1. Click **Create Server** at the bottom of the sidebar.
2. Enter a name (e.g. `Images`) and click **Create & Assign**.
3. **Watch** the right pane:
   - All three nodes pulse yellow – the cluster is *evaluating* shard placement.
   - After ~2 s, a green packet flies to the winning node (least loaded).
   - The shard label appears on that node.
4. The new server is immediately selected; you can send messages to it.

---

## Development (without Docker)

### 1. Start CockroachDB nodes manually

```bash
# Terminal 1
docker run --rm --name roach1 -p 26257:26257 -p 8080:8080 \
  cockroachdb/cockroach:v23.1.11 start \
  --insecure --advertise-addr=localhost --join=localhost:26257

# Initialise (one-time)
docker exec roach1 cockroach init --insecure --host=localhost:26257
docker exec -i roach1 cockroach sql --insecure --host=localhost:26257 < db/schema.sql
```

### 2. Backend

```bash
cd backend
npm install
DATABASE_URL="postgresql://root@localhost:26257/discord_clone?sslmode=disable" \
  node server.js
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

Vite proxies `/api` requests to the backend on port 3001.

---

## File structure

```
discord-demo/
├── docker-compose.yml        # Full-stack orchestration
├── db/
│   ├── init.sh               # Cluster bootstrap script
│   └── schema.sql            # Table definitions + seed data
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   └── server.js             # Express REST API
└── frontend/
    ├── Dockerfile            # Vite build → nginx
    ├── nginx.conf            # SPA routing + /api proxy
    ├── package.json / vite.config.js / tailwind.config.js
    └── src/
        ├── App.jsx             # Global state, split-screen layout
        └── components/
            ├── DiscordPane.jsx # Left pane – chat UI
            └── ClusterPane.jsx # Right pane – cluster visualisation
```

---

## Stopping & clean-up

```bash
# Stop containers (preserves volumes / data)
docker compose down

# Stop AND wipe all data (fresh start)
docker compose down -v
```

---

## Concepts illustrated

| Concept                       | Where you see it                                              |
|-------------------------------|---------------------------------------------------------------|
| **Shared-Nothing**            | Each node has its own Docker volume; no shared disk          |
| **Horizontal Fragmentation**  | `servers` rows each carry a `node_id` (their shard owner)    |
| **Dynamic Shard Allocation**  | New server → backend queries node counts → assigns to min    |
| **Shard Routing**             | Message write → animates to the node that owns that shard    |
| **Replication Channel**       | Dashed lines between nodes represent Raft protocol traffic   |
