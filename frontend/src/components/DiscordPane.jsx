import { useState, useRef, useEffect } from "react";

export default function DiscordPane({
  servers,
  selectedServer,
  messages,
  username,
  placementByServer = {},
  onSelectServer,
  onSendMessage,
  onCreateServer,
}) {
  const [input, setInput]         = useState("");
  const [newName, setNewName]     = useState("");
  const [showModal, setShowModal] = useState(false);
  const [creating, setCreating]   = useState(false);
  const bottomRef = useRef(null);

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(e) {
    e.preventDefault();
    if (!input.trim()) return;
    await onSendMessage(input);
    setInput("");
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!newName.trim() || creating) return;
    setCreating(true);
    setShowModal(false);
    await onCreateServer(newName.trim());
    setNewName("");
    setCreating(false);
  }

  const nodeColor = {
    1: "bg-blue-500",
    2: "bg-purple-500",
    3: "bg-green-500",
    4: "bg-yellow-500",
  };
  const nodeBorder = {
    1: "border-blue-500/40",
    2: "border-purple-500/40",
    3: "border-green-500/40",
    4: "border-yellow-500/40",
  };

  function leaseholderNodeFromPlacement(serverId) {
    const placement = placementByServer[String(serverId)] ?? placementByServer[serverId] ?? null;
    if (Number.isInteger(placement?.leaseholderNode)) return placement.leaseholderNode;
    return null;
  }

  return (
    <div className="relative flex h-full bg-discord-bg text-discord-heading">
      {/* ── Server sidebar ──────────────────────────────── */}
      <aside className="w-48 flex-shrink-0 bg-discord-sidebar flex flex-col">
        {/* Header */}
        <div className="px-3 py-3 border-b border-black/30 flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-widest text-discord-muted">
            Servers
          </span>
        </div>

        {/* Server list */}
        <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
          {servers.map((srv) => (
            (() => {
              const leaseholderNode = leaseholderNodeFromPlacement(srv.id);
              const leaseholderLabel = Number.isInteger(leaseholderNode) ? `L${leaseholderNode}` : "L?";
              return (
            <button
              key={srv.id}
              onClick={() => onSelectServer(srv)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm
                transition-colors text-left
                ${
                  selectedServer?.id === srv.id
                    ? "bg-discord-accent/20 text-discord-heading"
                    : "text-discord-muted hover:bg-white/5 hover:text-discord-heading"
                }`}
            >
              {/* coloured dot = live leaseholder node from DB metadata */}
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  nodeColor[leaseholderNode] ?? "bg-gray-500"
                }`}
              />
              <span className="truncate">{srv.name}</span>
              <span className="ml-auto text-[9px] text-discord-muted opacity-60">
                {leaseholderLabel} · RF4
              </span>
            </button>
              );
            })()
          ))}

          {servers.length === 0 && (
            <p className="px-2 py-4 text-[11px] text-discord-muted">
              No servers yet
            </p>
          )}
        </nav>

        {/* New server button */}
        <div className="p-2 border-t border-black/30">
          <button
            onClick={() => setShowModal(true)}
            disabled={creating}
            className="w-full flex items-center gap-2 px-3 py-2 rounded
              bg-discord-accent/10 hover:bg-discord-accent/20
              text-discord-accent text-sm font-medium
              transition-colors disabled:opacity-50"
          >
            <span className="text-lg leading-none">＋</span>
            {creating ? "Creating…" : "Create Server"}
          </button>
        </div>
      </aside>

      {/* ── Main chat area ──────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Channel header */}
        <header className="flex items-center gap-2 px-4 py-3 bg-discord-card/70
          border-b border-black/30 flex-shrink-0">
          <span className="text-discord-muted">#</span>
          <span className="font-semibold text-sm">
            {selectedServer ? selectedServer.name : "Select a server"}
          </span>
          {selectedServer && (
            (() => {
              const leaseholderNode = leaseholderNodeFromPlacement(selectedServer.id);
              const leaseholderLabel = Number.isInteger(leaseholderNode) ? `L${leaseholderNode}` : "L?";
              return (
            <span
              className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full
                border ${nodeBorder[leaseholderNode] ?? "border-gray-500/40"}
                text-discord-muted`}
            >
              Leaseholder {leaseholderLabel} · RF4
            </span>
              );
            })()
          )}
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {!selectedServer && (
            <p className="text-discord-muted text-sm text-center mt-12">
              Select a server to start chatting
            </p>
          )}

          {selectedServer && messages.length === 0 && (
            <p className="text-discord-muted text-sm text-center mt-12">
              No messages yet. Say something!
            </p>
          )}

          {messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} self={msg.username === username} />
          ))}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <form
          onSubmit={handleSend}
          className="px-4 pb-4 pt-2 flex-shrink-0"
        >
          <div className="flex items-center gap-2 bg-discord-input rounded-lg px-3 py-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                selectedServer
                  ? `Message #${selectedServer.name}`
                  : "Select a server first"
              }
              disabled={!selectedServer}
              className="flex-1 bg-transparent text-sm text-discord-heading
                placeholder:text-discord-muted outline-none disabled:opacity-40"
            />
            <button
              type="submit"
              disabled={!selectedServer || !input.trim()}
              className="text-discord-muted hover:text-discord-accent
                transition-colors disabled:opacity-30 text-sm"
            >
              ↵
            </button>
          </div>
        </form>
      </div>

      {/* ── Create Server modal ─────────────────────────── */}
      {showModal && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center
            bg-black/60 backdrop-blur-sm"
          onClick={(e) => e.target === e.currentTarget && setShowModal(false)}
        >
          <div className="bg-discord-card rounded-lg p-6 w-80 shadow-2xl
            border border-white/10 animate-fadeIn">
            <h2 className="text-lg font-bold mb-1">Create a Server</h2>
            <p className="text-discord-muted text-sm mb-4">
              CockroachDB chooses a leaseholder and keeps 3 replicas by default.
              This UI reads live leaseholder/replica placement from CockroachDB metadata.
            </p>
            <form onSubmit={handleCreate}>
              <input
                autoFocus
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Images"
                maxLength={40}
                className="w-full bg-discord-input rounded px-3 py-2 text-sm
                  text-discord-heading placeholder:text-discord-muted
                  outline-none border border-white/10 focus:border-discord-accent mb-4"
              />
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-1.5 rounded text-sm text-discord-muted
                    hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newName.trim()}
                  className="px-4 py-1.5 rounded text-sm font-medium
                    bg-discord-accent hover:bg-discord-accent/80
                    disabled:opacity-40 transition-colors"
                >
                  Create &amp; Route
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function MessageBubble({ msg, self }) {
  const time = new Date(msg.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <div className="flex items-start gap-3 animate-fadeIn group">
      {/* Avatar */}
      <div
        className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center
          justify-center text-xs font-bold ${
          self ? "bg-discord-accent" : "bg-discord-input"
        }`}
      >
        {msg.username.slice(0, 2).toUpperCase()}
      </div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span
            className={`text-sm font-medium ${
              self ? "text-discord-accent" : "text-discord-heading"
            }`}
          >
            {msg.username}
          </span>
          <span className="text-[10px] text-discord-muted opacity-0
            group-hover:opacity-100 transition-opacity">
            {time}
          </span>
        </div>
        <p className="text-sm text-[#dbdee1] mt-0.5 break-words">{msg.content}</p>
      </div>
    </div>
  );
}
