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
  const [nodeStatuses, setNodeStatuses]     = useState({ 1: "live", 2: "live", 3: "live" });
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

  const fetchNodeStatuses = useCallback(async () => {
    try {
      const res = await fetch(`${API}/nodes/status`);
      if (!res.ok) return;
      const data = await res.json();
      setNodeStatuses((prev) => {
        // detect transitions live→dead for log entries
        for (const id of [1, 2, 3]) {
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
    pollRef.current = setInterval(() => fetchMessages(selectedServer.id), 2000);
    return () => clearInterval(pollRef.current);
  }, [selectedServer, fetchMessages]);

  // Poll node statuses every 2 s
  useEffect(() => {
    fetchNodeStatuses();
    const t = setInterval(fetchNodeStatuses, 2000);
    return () => clearInterval(t);
  }, [fetchNodeStatuses]);

  // ── actions ────────────────────────────────────────────────────────────────

  const handleSelectServer = useCallback((server) => {
    setSelectedServer(server);
    setMessages([]);
  }, []);

  const handleSendMessage = useCallback(async (content) => {
    if (!selectedServer || !content.trim()) return;
    const targetNode  = selectedServer.node_id;
    const statuses    = nodeStatusesRef.current;
    const targetDead  = statuses[targetNode] === "dead";

    if (targetDead) {
      // Show failed attempt to dead node, then reroute to a live replica
      spawnPacket(targetNode, "#ef4444");
      const liveNode = [1, 2, 3].find((id) => id !== targetNode && statuses[id] === "live");
      if (liveNode) {
        setTimeout(() => spawnPacket(liveNode, "#23a55a"), 700);
        log(`⚡ Node ${targetNode} offline — CockroachDB rerouting to Node ${liveNode} (live replica)`);
      } else {
        log(`⚠ No live nodes available — write may fail`);
      }
    } else {
      spawnPacket(targetNode, "#5865f2");
      log(`📨 Writing to Node ${targetNode} (shard: "${selectedServer.name}")`);
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
  }, [selectedServer, username, log]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreateServer = useCallback(async (name) => {
    if (!name.trim()) return;
    log(`🔍 Cluster evaluating shard allocation for "${name}"...`);
    setEvaluating(true);

    // Only assign to live nodes
    const statuses = nodeStatusesRef.current;
    const liveNodes = [1, 2, 3].filter((id) => statuses[id] !== "dead");
    const counts = Object.fromEntries(liveNodes.map((id) => [id, 0]));
    servers.forEach((s) => { if (counts[s.node_id] !== undefined) counts[s.node_id]++; });
    const targetNode = Number(
      Object.entries(counts).sort(([, a], [, b]) => a - b)[0]?.[0] || 1
    );

    await new Promise((r) => setTimeout(r, 1800));
    setEvaluating(false);

    spawnPacket(targetNode, "#23a55a");
    setNodeHighlight(targetNode);
    setTimeout(() => setNodeHighlight(null), 2000);
    log(`✅ Shard "${name}" assigned to Node ${targetNode}`);

    try {
      const res = await fetch(`${API}/servers`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || res.statusText); }
      const newServer = await res.json();
      await fetchServers();
      handleSelectServer(newServer);
      log(`🎉 Server "${newServer.name}" is live on Node ${newServer.node_id}`);
    } catch (err) {
      console.error("createServer:", err);
      log(`❌ Could not create server: ${err.message}`);
      setEvaluating(false);
    }
  }, [servers, fetchServers, handleSelectServer, log]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleKillNode = useCallback(async (nodeId) => {
    // Capture live state BEFORE the optimistic update
    const currentStatuses = nodeStatusesRef.current;
    const liveAfterKill = [1, 2, 3].filter(
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
          log(`🗳 Raft: Node ${primary} initiating leaseholder election for vacated ranges`);
          // Raft election packet: primary → secondary
          spawnPacket(secondary, "#a855f7", primary);
        }, 850);

        setTimeout(() => {
          // Vote response: secondary → primary
          spawnPacket(primary, "#a855f7", secondary);
        }, 1150);

        setTimeout(() => {
          log(`👑 Raft: Node ${primary} elected — range leases transferred from Node ${nodeId}`);
        }, 1500);

        setTimeout(() => {
          log(`✅ Lease transfer complete — cluster operational (${liveAfterKill.length}/3 nodes)`);
        }, 2000);

      } else if (liveAfterKill.length === 1) {
        const survivor = liveAfterKill[0];
        setTimeout(() => {
          log(`🚨 QUORUM LOST — only Node ${survivor} remains (need 2/3 for consensus)`);
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
      log(`⏳ Node ${nodeId} is coming back online…`);
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
          onPacketDone={removePacket}
          onKillNode={handleKillNode}
          onRestartNode={handleRestartNode}
        />
      </div>
    </div>
  );
}
