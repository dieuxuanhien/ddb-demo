import { useState, useEffect, useCallback, useRef } from "react";
import DiscordPane from "./components/DiscordPane.jsx";
import ClusterPane from "./components/ClusterPane.jsx";

const API = "/api";
let packetIdCounter = 0;

export default function App() {
  const [servers, setServers]               = useState([]);
  const [selectedServer, setSelectedServer] = useState(null);
  const [messages, setMessages]             = useState([]);
  const [packets, setPackets]               = useState([]);
  const [evaluating, setEvaluating]         = useState(false);
  const [nodeHighlight, setNodeHighlight]   = useState(null);
  const [activityLog, setActivityLog]       = useState([]);
  const [nodeStatuses, setNodeStatuses]     = useState({ 1: "live", 2: "live", 3: "live", 4: "live" });
  const [placements, setPlacements]         = useState({});
  const [username]                          = useState("User" + Math.floor(Math.random() * 9000 + 1000));

  const pollRef         = useRef(null);
  const nodeStatusesRef = useRef(nodeStatuses); // always-fresh ref for callbacks
  useEffect(() => { nodeStatusesRef.current = nodeStatuses; }, [nodeStatuses]);

  // ── helpers ────────────────────────────────────────────────────────────────

  const log = useCallback((msg) => {
    setActivityLog((prev) => [
      { id: Date.now() + Math.random(), text: msg, ts: new Date().toLocaleTimeString() },
      ...prev,
    ].slice(0, 50));
  }, []);

  function removePacket(id) {
    setPackets((prev) => prev.filter((p) => p.id !== id));
  }

  function spawnPacket(targetNode, color = "#5865f2", fromNode = null) {
    const id = ++packetIdCounter;
    setPackets((prev) => [...prev, { id, targetNode, color, fromNode }]);
    setTimeout(() => removePacket(id), 2500);
    return id;
  }

  const getPlacement = useCallback((serverId) => {
    const key = String(serverId);
    return placements[key] ?? placements[serverId] ?? null;
  }, [placements]);

  const getReplicaNodes = useCallback((serverId) => {
    const placement = getPlacement(serverId);
    const effective = placement?.effectiveReplicas;
    const voting = placement?.votingReplicas;
    const replicas = placement?.replicas;
    const fromDB = Array.isArray(effective) && effective.length > 0
      ? effective
      : Array.isArray(voting) && voting.length > 0
        ? voting
        : Array.isArray(replicas) && replicas.length > 0
          ? replicas
          : null;

    if (fromDB) return fromDB;
    return [];
  }, [getPlacement]);

  const getLeaseholderNode = useCallback((serverId) => {
    const placement = getPlacement(serverId);
    if (Number.isInteger(placement?.leaseholderNode)) return placement.leaseholderNode;
    const replicas = getReplicaNodes(serverId);
    return replicas[0] ?? null;
  }, [getPlacement, getReplicaNodes]);

  // ── data fetching ──────────────────────────────────────────────────────────

  const fetchServers = useCallback(async () => {
    try {
      const res  = await fetch(`${API}/servers`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setServers(data);
      setSelectedServer((prev) => {
        if (!prev && data.length > 0) return data[0];
        if (prev) return data.find((s) => s.id === prev.id) ?? data[0] ?? null;
        return prev;
      });
    } catch (err) { console.error("fetchServers:", err); }
  }, []);

  const fetchMessages = useCallback(async (serverId) => {
    try {
      const res = await fetch(`${API}/servers/${serverId}/messages`);
      if (!res.ok) throw new Error(await res.text());
      setMessages(await res.json());
    } catch (err) { console.error("fetchMessages:", err); }
  }, []);

  const fetchPlacements = useCallback(async (serverIds) => {
    try {
      if (!Array.isArray(serverIds) || serverIds.length === 0) {
        setPlacements({});
        return {};
      }
      const qs = serverIds.map((id) => String(id)).join(",");
      const res = await fetch(`${API}/placements?server_ids=${encodeURIComponent(qs)}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const nextPlacements = data.placements ?? {};
      setPlacements(nextPlacements);
      return nextPlacements;
    } catch (err) {
      console.error("fetchPlacements:", err);
      return {};
    }
  }, []);

  const fetchNodeStatuses = useCallback(async () => {
    try {
      const res = await fetch(`${API}/nodes/status`);
      if (!res.ok) return;
      const data = await res.json();
      setNodeStatuses((prev) => {
        // detect transitions live→dead for log entries
        for (const id of [1, 2, 3, 4]) {
          if (prev[id] === "live"     && data[id] === "dead")    log(`💀 Node ${id} went offline`);
          if (prev[id] === "dead"     && data[id] === "live")    log(`✅ Node ${id} is back online`);
          if (prev[id] === "starting" && data[id] === "live")    log(`✅ Node ${id} recovered`);
        }
        return data;
      });
    } catch (err) { console.error("fetchNodeStatuses:", err); }
  }, [log]);

  // ── polling ────────────────────────────────────────────────────────────────

  useEffect(() => { fetchServers(); }, [fetchServers]);

  useEffect(() => {
    clearInterval(pollRef.current);
    if (!selectedServer) { setMessages([]); return; }
    fetchMessages(selectedServer.id);
    pollRef.current = setInterval(() => fetchMessages(selectedServer.id), 3000);
    return () => clearInterval(pollRef.current);
  }, [selectedServer, fetchMessages]);

  useEffect(() => {
    if (!servers.length) {
      setPlacements({});
      return;
    }
    const serverIds = servers.map((s) => s.id);
    fetchPlacements(serverIds);
    const t = setInterval(() => fetchPlacements(serverIds), 5000);
    return () => clearInterval(t);
  }, [servers, fetchPlacements]);

  // Poll node statuses every 3 s
  useEffect(() => {
    fetchNodeStatuses();
    const t = setInterval(fetchNodeStatuses, 3000);
    return () => clearInterval(t);
  }, [fetchNodeStatuses]);

  // ── actions ────────────────────────────────────────────────────────────────

  const handleSelectServer = useCallback((server) => {
    setSelectedServer(server);
    setMessages([]);
  }, []);

  const handleSendMessage = useCallback(async (content) => {
    if (!selectedServer || !content.trim()) return;
    let replicaNodes = getReplicaNodes(selectedServer.id);
    let leaseholderNode = getLeaseholderNode(selectedServer.id);

    if (!leaseholderNode || replicaNodes.length === 0) {
      const freshPlacements = await fetchPlacements([selectedServer.id]);
      const placement = freshPlacements[String(selectedServer.id)] ?? null;
      const effective = placement?.effectiveReplicas ?? placement?.votingReplicas ?? placement?.replicas ?? [];
      replicaNodes = Array.isArray(effective) ? effective : [];
      leaseholderNode = Number.isInteger(placement?.leaseholderNode) ? placement.leaseholderNode : (replicaNodes[0] ?? null);
    }

    const statuses    = nodeStatusesRef.current;
    if (!leaseholderNode || replicaNodes.length === 0) {
      log(`⚠ Placement metadata not ready for server_id=${selectedServer.id}; writing without animation`);
    }
    const targetDead  = statuses[leaseholderNode] === "dead";

    if (leaseholderNode && replicaNodes.length > 0 && targetDead) {
      // Visual: request aimed at a down leaseholder node, then routed via a live gateway.
      spawnPacket(leaseholderNode, "#ef4444");
      const liveNode = replicaNodes.find((id) => id !== leaseholderNode && statuses[id] === "live");
      if (liveNode) {
        setTimeout(() => spawnPacket(liveNode, "#23a55a"), 700);
        setTimeout(() => {
          replicaNodes
            .filter((id) => id !== leaseholderNode && id !== liveNode && statuses[id] === "live")
            .forEach((id, index) => {
              setTimeout(() => spawnPacket(id, "#23a55a", liveNode), index * 220);
            });
        }, 900);
        log(`⚡ Leaseholder Node ${leaseholderNode} offline — retry via Node ${liveNode}; surviving replicas stay in sync`);
      } else {
        log(`⚠ No live nodes available — write may fail`);
      }
    } else if (leaseholderNode && replicaNodes.length > 0) {
      spawnPacket(leaseholderNode, "#5865f2");
      setTimeout(() => {
        replicaNodes
          .filter((id) => id !== leaseholderNode)
          .forEach((id, index) => {
            setTimeout(() => spawnPacket(id, "#23a55a", leaseholderNode), index * 220);
          });
      }, 250);
      log(`📨 Writing to leaseholder Node ${leaseholderNode}; replicating server_id=${selectedServer.id} to ${Math.max(replicaNodes.length - 1, 0)} follower nodes`);
    }

    try {
      const res = await fetch(`${API}/messages`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ server_id: selectedServer.id, username, content: content.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      const msg = await res.json();
      setMessages((prev) => [...prev, msg]);
    } catch (err) {
      console.error("sendMessage:", err);
      log(`❌ Error: ${err.message}`);
    }
  }, [selectedServer, username, log, getLeaseholderNode, getReplicaNodes]);

  const handleCreateServer = useCallback(async (name) => {
    if (!name.trim()) return;
    log(`🔍 Cluster assigning leaseholder and 3 replicas for "${name}" from server_id...`);
    setEvaluating(true);

    await new Promise((r) => setTimeout(r, 1800));
    setEvaluating(false);

    try {
      const res = await fetch(`${API}/servers`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) {
        const bodyText = await res.text();
        let errorMsg = `${res.status} ${res.statusText}`;
        try {
          const parsed = JSON.parse(bodyText);
          errorMsg = parsed.error || parsed.message || errorMsg;
        } catch {
          if (bodyText.trim()) errorMsg = bodyText.slice(0, 140);
        }
        throw new Error(errorMsg);
      }
      const newServer = await res.json();
      if (newServer?.splitCreated) {
        log(`✂️ Range split created at key (server_id=${newServer.id}, id=0)`);
      }
      const responsePlacement = newServer?.placement ?? null;
      const freshPlacements = await fetchPlacements([newServer.id]);
      const placement = responsePlacement ?? freshPlacements[String(newServer.id)] ?? null;
      const effective = placement?.effectiveReplicas ?? placement?.votingReplicas ?? placement?.replicas ?? [];
      const replicaNodes = Array.isArray(effective) ? effective : [];
      const targetNode = Number.isInteger(placement?.leaseholderNode) ? placement.leaseholderNode : (replicaNodes[0] ?? null);

      if (targetNode) {
        spawnPacket(targetNode, "#23a55a");
        setTimeout(() => {
          replicaNodes.filter((id) => id !== targetNode).forEach((id, index) => {
            setTimeout(() => spawnPacket(id, "#23a55a", targetNode), index * 220);
          });
        }, 250);
        setNodeHighlight(targetNode);
        setTimeout(() => setNodeHighlight(null), 2000);
        log(`✅ split+scatter applied: server_id=${newServer.id} now maps to range ${placement?.rangeId ?? "?"}, leaseholder Node ${targetNode}`);
      } else {
        log(`ℹ Server created; placement metadata still warming up from CockroachDB`);
      }
      await fetchServers();
      handleSelectServer(newServer);
      log(`🎉 Server "${newServer.name}" created (visualization now uses real DB placement)`);
    } catch (err) {
      console.error("createServer:", err);
      log(`❌ Could not create server: ${err.message}`);
      setEvaluating(false);
    }
  }, [fetchServers, fetchPlacements, getReplicaNodes, handleSelectServer, log]);

  const handleKillNode = useCallback(async (nodeId) => {
    // Capture live state BEFORE the optimistic update
    const currentStatuses = nodeStatusesRef.current;
    const liveAfterKill = [1, 2, 3, 4].filter(
      (id) => id !== nodeId && currentStatuses[id] !== "dead"
    );
    const quorumLost = liveAfterKill.length < 2;

    log(`🔌 Sending SIGTERM to roach${nodeId}…`);
    setNodeStatuses((prev) => ({ ...prev, [nodeId]: "dead" })); // optimistic

    try {
      const res = await fetch(`${API}/nodes/${nodeId}/kill`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());

      log(`💥 Node ${nodeId}: process terminated`);

      // ── Raft response sequence ─────────────────────────────────────────
      setTimeout(() => {
        log(`⏱ Raft: heartbeat timeout — peers marking Node ${nodeId} as dead`);
      }, 400);

      if (!quorumLost && liveAfterKill.length >= 2) {
        const [primary, secondary] = liveAfterKill;

        setTimeout(() => {
          log(`🗳 Raft: surviving replicas on Nodes ${primary} and ${secondary} start election for affected ranges`);
          // Election traffic between surviving replicas.
          spawnPacket(secondary, "#a855f7", primary);
        }, 850);

        setTimeout(() => {
          // Vote response: secondary → primary
          spawnPacket(primary, "#a855f7", secondary);
        }, 1150);

        setTimeout(() => {
          log(`👑 Raft: Node ${primary} becomes leaseholder for some ranges; leadership is redistributed`);
        }, 1500);

        setTimeout(() => {
          log(`✅ Cluster still writable with quorum (${liveAfterKill.length}/4 nodes live); ranges remain replicated but under the ideal 3x factor until Node ${nodeId} returns`);
        }, 2000);

      } else if (liveAfterKill.length === 1) {
        const survivor = liveAfterKill[0];
        setTimeout(() => {
          log(`🚨 QUORUM LOST — only Node ${survivor} remains (need 2/3 replicas for consensus)`);
        }, 600);
        setTimeout(() => {
          log(`📖 Node ${survivor}: serving stale reads from local replicas — writes blocked`);
        }, 1200);

      } else {
        setTimeout(() => {
          log(`☠ ALL NODES OFFLINE — cluster completely unavailable`);
        }, 600);
      }

    } catch (err) {
      log(`❌ Kill failed: ${err.message}`);
      setNodeStatuses((prev) => ({ ...prev, [nodeId]: "live" })); // revert
    }
  }, [log]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRestartNode = useCallback(async (nodeId) => {
    log(`🔄 Restarting Node ${nodeId}…`);
    setNodeStatuses((prev) => ({ ...prev, [nodeId]: "starting" }));
    try {
      const res = await fetch(`${API}/nodes/${nodeId}/start`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      log(`⏳ Node ${nodeId} is coming back online — CockroachDB will rebalance replicas automatically`);
    } catch (err) {
      log(`❌ Restart failed: ${err.message}`);
      setNodeStatuses((prev) => ({ ...prev, [nodeId]: "dead" }));
    }
  }, [log]);

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <div className="w-1/2 flex flex-col border-r border-[#1a1b1e]">
        <DiscordPane
          servers={servers}
          selectedServer={selectedServer}
          messages={messages}
          username={username}
          placementByServer={placements}
          onSelectServer={handleSelectServer}
          onSendMessage={handleSendMessage}
          onCreateServer={handleCreateServer}
        />
      </div>
      <div className="w-1/2 flex flex-col bg-[#16171a]">
        <ClusterPane
          servers={servers}
          packets={packets}
          evaluating={evaluating}
          nodeHighlight={nodeHighlight}
          activityLog={activityLog}
          nodeStatuses={nodeStatuses}
          placementByServer={placements}
          onPacketDone={removePacket}
          onKillNode={handleKillNode}
          onRestartNode={handleRestartNode}
        />
      </div>
    </div>
  );
}
