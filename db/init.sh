#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# init.sh  –  Bootstrap the CockroachDB cluster and load the schema.
#
# Strategy (no healthcheck dependency):
#   1. Wait for all 3 nodes to accept TCP connections on port 26257.
#   2. Run `cockroach init` in a retry loop (idempotent – safe to re-run).
#   3. Wait for SQL to become available (signals cluster is fully up).
#   4. Load schema.sql.
# ---------------------------------------------------------------------------
set -euo pipefail

# ── 1. Wait for TCP port 26257 on each node ──────────────────────────────

wait_for_port() {
  local host="$1"
  echo "==> Waiting for ${host}:26257 (TCP)..."
  until bash -c "echo > /dev/tcp/${host}/26257" 2>/dev/null; do
    echo "    ${host} not listening yet – retrying in 2 s..."
    sleep 2
  done
  echo "    ${host} is listening."
}

wait_for_port roach1
wait_for_port roach2
wait_for_port roach3

# ── 2. Run cockroach init (retry loop) ───────────────────────────────────
# Exits 0 on success.  Non-zero might mean "already initialised" (fine) or
# "not ready yet" (retry).  We treat both "already…" patterns as success.

echo ""
echo "==> Initialising cluster..."
while true; do
  output=$(cockroach init --insecure --host=roach1:26257 2>&1) && break
  if echo "$output" | grep -qiE "already been initialized|already part of a cluster"; then
    echo "    Cluster was already initialised – continuing."
    break
  fi
  echo "    Not ready (${output}) – retrying in 3 s..."
  sleep 3
done
echo "    Init done."

# ── 3. Wait for SQL ───────────────────────────────────────────────────────

echo ""
echo "==> Waiting for SQL to become available..."
until cockroach sql --insecure --host=roach1:26257 \
      --execute="SELECT 1" > /dev/null 2>&1; do
  echo "    SQL not ready – retrying in 3 s..."
  sleep 3
done
echo "    SQL is ready."

# ── 4. Load schema ────────────────────────────────────────────────────────

echo ""
echo "==> Loading schema..."
cockroach sql --insecure --host=roach1:26257 < /db/schema.sql

echo ""
echo "==> Done – discord_clone is ready."
