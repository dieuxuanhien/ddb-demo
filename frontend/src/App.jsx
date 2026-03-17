import { useState, useEffect, useCallback, useRef } from "react";
import DiscordPane from "./components/DiscordPane.jsx";
import ClusterPane from "./components/ClusterPane.jsx";

// In Docker (nginx) the proxy rewrites /api → backend:3001
// Locally (Vite dev server) vite.config.js proxies /api → localhost:3001
const API = "/api";

let packetIdCounter = 0;

export default function App() {
  const [servers, setServers]           = useState([]);
  const [selectedServer, setSelectedServer] = useState(null);
  const [messages, setMessages]         = useState([]);
  const [packets, setPackets]           = useState([]);
  const [evaluating, setEvaluating]     = useState(false);
  const [nodeHighlight, setNodeHighlight] = useState(null); // nodeId | null
  const [activityLog, setActivityLog]   = useState([]);
  const [username]                      = useState(
    "User" + Math.floor(Math.random() * 9000 + 1000)
  );
  const pollRef = useRef(null);

  // ── helpers ──────────────────────────────────────────────────────────────

  const log = useCallback((msg) => {
    setActivityLog((prev) => [
      { id: Date.now() + Math.random(), text: msg, ts: new Date().toLocaleTimeString() },
      ...prev,
    ].slice(0, 50));
  }, []);

  function removePacket(id) {
    setPackets((prev) => prev.filter((p) => p.id !== id));
  }

  function spawnPacket(targetNode, color = "#5865f2") {
    const id = ++packetIdCounter;
    setPackets((prev) => [...prev, { id, targetNode, color }]);
    // Safety cleanup after animation finishes
    setTimeout(() => removePacket(id), 2500);
    return id;
  }

  // ── data fetching ─────────────────────────────────────────────────────────

  const fetchServers = useCallback(async () => {
    try {
      const res = await fetch(`${API}/servers`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setServers(data);
      // auto-select first server if none selected
      setSelectedServer((prev) => {
        if (!prev && data.length > 0) return data[0];
        // keep in sync if selected server was updated
        if (prev) return data.find((s) => s.id === prev.id) ?? data[0] ?? null;
        return prev;
      });
    } catch (err) {
      console.error("fetchServers:", err);
    }
  }, []);

  const fetchMessages = useCallback(async (serverId) => {
    try {
      const res = await fetch(`${API}/servers/${serverId}/messages`);
      if (!res.ok) throw new Error(await res.text());
      setMessages(await res.json());
    } catch (err) {
      console.error("fetchMessages:", err);
    }
  }, []);

  // ── initial load + server poll ─────────────────────────────────────────────

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  // Poll messages for selected server every 2 s
  useEffect(() => {
    clearInterval(pollRef.current);
    if (!selectedServer) { setMessages([]); return; }
    fetchMessages(selectedServer.id);
    pollRef.current = setInterval(() => fetchMessages(selectedServer.id), 2000);
    return () => clearInterval(pollRef.current);
  }, [selectedServer, fetchMessages]);

  // ── actions ────────────────────────────────────────────────────────────────

  const handleSelectServer = useCallback((server) => {
    setSelectedServer(server);
    setMessages([]);
  }, []);

  const handleSendMessage = useCallback(async (content) => {
    if (!selectedServer || !content.trim()) return;
    const node = selectedServer.node_id;

    // Trigger data-packet animation before network call
    spawnPacket(node, "#5865f2");
    log(`📨 Writing message to Node ${node} (shard: "${selectedServer.name}")`);

    try {
      const res = await fetch(`${API}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          server_id: selectedServer.id,
          username,
          content: content.trim(),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      // Optimistically append
      const msg = await res.json();
      setMessages((prev) => [...prev, msg]);
    } catch (err) {
      console.error("sendMessage:", err);
      log(`❌ Error sending message: ${err.message}`);
    }
  }, [selectedServer, username, log]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreateServer = useCallback(async (name) => {
    if (!name.trim()) return;

    // ── Animation: evaluate cluster ────────────────────────────────────────
    log(`🔍 Cluster evaluating shard allocation for "${name}"...`);
    setEvaluating(true);

    // Calculate least-loaded node locally for the visual (backend does it too)
    const counts = { 1: 0, 2: 0, 3: 0 };
    servers.forEach((s) => { counts[s.node_id] = (counts[s.node_id] || 0) + 1; });
    const targetNode = Number(
      Object.entries(counts).sort(([, a], [, b]) => a - b)[0][0]
    );

    // Show "evaluating" pulse for 1.8 s then flash the winning node
    await new Promise((r) => setTimeout(r, 1800));
    setEvaluating(false);

    // Spawn a green "shard assignment" packet
    spawnPacket(targetNode, "#23a55a");
    setNodeHighlight(targetNode);
    setTimeout(() => setNodeHighlight(null), 2000);

    log(`✅ Shard "${name}" assigned to Node ${targetNode}`);

    try {
      const res = await fetch(`${API}/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || res.statusText);
      }
      const newServer = await res.json();
      await fetchServers(); // refresh list
      handleSelectServer(newServer);
      log(`🎉 Server "${newServer.name}" is live on Node ${newServer.node_id}`);
    } catch (err) {
      console.error("createServer:", err);
      log(`❌ Could not create server: ${err.message}`);
      setEvaluating(false);
    }
  }, [servers, fetchServers, handleSelectServer, log]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Left pane – Discord UI */}
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

      {/* Right pane – Cluster visualisation */}
      <div className="w-1/2 flex flex-col bg-[#16171a]">
        <ClusterPane
          servers={servers}
          packets={packets}
          evaluating={evaluating}
          nodeHighlight={nodeHighlight}
          activityLog={activityLog}
          onPacketDone={removePacket}
        />
      </div>
    </div>
  );
}
