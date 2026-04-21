# CockroachDB Replica Placement Demo

A full-stack web application that demonstrates **distributed database concepts** —
shared-nothing architecture, leaseholder-based routing, and 3-way replica
placement using a real 3-node CockroachDB cluster running entirely in Docker.

```text
┌────────────────────────┬───────────────────────────────┐
│  Discord-like UI       │  CockroachDB Cluster          │
│  (Left pane)           │  (Right pane)                 │
│                        │                               │
│  • Select a server     │  • Node 1 ── Node 2           │
│  • Send messages       │       \      /                │
│  • Create new servers  │        Node 3                 │
│                        │                               │
│  Sending a message →   │  Animated packet reaches the  │
│                        │  leaseholder, then fans out   │
│  Creating a server →   │  Cluster assigns leaseholder  │
│                        │  and shows 3 replicas         │
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

### Replica Placement

The demo now models CockroachDB-style placement:

- `servers.id` determines the leaseholder used for the visual route.
- `messages` uses `PRIMARY KEY (server_id, id)`, so rows are physically keyed by `server_id` first.
- Every server is visualized as replicated on all 3 nodes (RF=3).
- The leaseholder is only a visual routing hint; real CockroachDB can move it.

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

### Open the app

- [http://localhost:3000](http://localhost:3000) — The demo application
- [http://localhost:8080](http://localhost:8080) — CockroachDB Admin UI
- [http://localhost:3001/health](http://localhost:3001/health) — Backend health check

---

## Running the demo

### Send a message

1. Select **General** or **Random** in the left sidebar.
2. Type something in the input box and press **Enter** or ↵.
3. **Watch** the right pane:
   1. A glowing blue packet reaches the leaseholder.
   2. Green packets fan out to the other replicas.
   3. The activity log updates.

### Create a new server

1. Click **Create Server** at the bottom of the sidebar.
2. Enter a name (e.g. `Images`) and click **Create & Route**.
3. **Watch** the right pane:
   1. All three nodes pulse yellow — the cluster is *evaluating* replica placement.
   2. After ~2 s, the leaseholder is highlighted and the other 2 replicas follow.
   3. The server label appears under all three nodes in the visualization.
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

```text
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
```text

---

## Concepts illustrated

* **Shared-Nothing** — Each node has its own Docker volume; no shared disk.
* **Horizontal Fragmentation** — `messages` key starts with `server_id` (`PRIMARY KEY (server_id, id)`).
* **Leaseholder Routing (Demo)** — UI highlights the leaseholder chosen from `server_id`.
* **Replication** — Message write animates to 3 replicas across the cluster.
* **Replication Channel** — Dashed lines between nodes represent Raft protocol traffic.
