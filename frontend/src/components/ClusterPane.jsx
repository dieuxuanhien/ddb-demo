import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";

// Percentage-based positions for PACKET animation (these match card placements below)
const NODE_POS = {
  1: { x: 22, y: 22 },
  2: { x: 72, y: 22 },
  3: { x: 47, y: 64 },
};
const CLIENT_POS = { x: 47, y: 92 };
const EDGES = [[1, 2], [2, 3], [1, 3]];

// ── Animated data-packet ──────────────────────────────────────────────────
function DataPacket({ id, targetNode, fromNode = null, color, onDone }) {
  const [moved, setMoved] = useState(false);
  const from = fromNode != null ? (NODE_POS[fromNode] ?? CLIENT_POS) : CLIENT_POS;
  const to   = NODE_POS[targetNode] ?? NODE_POS[1];

  useEffect(() => {
    const t = setTimeout(() => setMoved(true), 60);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className="packet"
      style={{
        left:            `calc(${moved ? to.x : from.x}% - 6px)`,
        top:             `calc(${moved ? to.y : from.y}% - 6px)`,
        backgroundColor: color,
        boxShadow:       `0 0 10px 3px ${color}88`,
      }}
      onTransitionEnd={() => onDone(id)}
    />
  );
}

// ── Node card ─────────────────────────────────────────────────────────────
const SHARD_COLORS = [
  "bg-blue-500", "bg-purple-500", "bg-green-500",
  "bg-yellow-500", "bg-pink-500", "bg-cyan-500",
];

// eslint-disable-next-line react/display-name
const NodeCard = ({ nodeId, shards, evaluating, highlight, status, onKill, onRestart }) => {
  const isDead     = status === "dead";
  const isStarting = status === "starting";

  let borderClass = "border-[#5865f2]/60 hover:border-[#5865f2]";
  if (evaluating)  borderClass = "border-yellow-400 animate-evaluating";
  if (highlight)   borderClass = "border-discord-green animate-nodeFlashGreen";
  if (isDead)      borderClass = "border-red-600/70";
  if (isStarting)  borderClass = "border-yellow-400/70 animate-pulse";

  return (
    <div
      className={`rounded-xl border-2 p-3 w-40 shadow-xl transition-all duration-300
        ${isDead ? "bg-[#1a1010] opacity-75" : "bg-[#1e2030]"}
        ${borderClass}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        {isDead ? (
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-red-500" />
        ) : isStarting ? (
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-yellow-400 animate-ping" />
        ) : (
          <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0
            ${evaluating ? "bg-yellow-400 animate-pulse" : "bg-discord-green"}`} />
        )}
        <span className={`text-xs font-bold ${isDead ? "text-red-400" : "text-white"}`}>
          Node {nodeId}
        </span>
        <span className="ml-auto text-[9px] text-slate-500 font-mono">roach{nodeId}</span>
      </div>

      {/* Status badge */}
      {isDead && (
        <div className="mb-2 text-center text-[9px] font-bold uppercase tracking-widest
          text-red-400 bg-red-900/30 rounded py-0.5">
          OFFLINE
        </div>
      )}
      {isStarting && (
        <div className="mb-2 text-center text-[9px] font-bold uppercase tracking-widest
          text-yellow-400 bg-yellow-900/20 rounded py-0.5">
          RECOVERING…
        </div>
      )}

      {/* Disk label */}
      {!isDead && (
        <div className="flex items-center gap-1 mb-2 px-1.5 py-1
          bg-slate-900/60 rounded text-[9px] text-slate-500 font-mono">
          <svg className="w-2.5 h-2.5 flex-shrink-0" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2">
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
            <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" />
          </svg>
          <span>isolated storage</span>
        </div>
      )}

      {/* Shards */}
      <div className="space-y-1 min-h-[20px]">
        {shards.length === 0 && !isDead && (
          <p className="text-[10px] text-slate-600 italic px-1">no shards</p>
        )}
        {shards.map((s, i) => (
          <div key={s.id}
            className={`shard-badge flex items-center gap-1.5 px-1.5 py-0.5 rounded
              border border-white/5
              ${isDead ? "bg-slate-900/40 opacity-50" : "bg-slate-800/80"}`}>
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0
              ${isDead ? "bg-slate-600" : SHARD_COLORS[i % SHARD_COLORS.length]}`} />
            <span className={`text-[10px] truncate
              ${isDead ? "text-slate-600 line-through" : "text-slate-300"}`}>
              {s.name}
            </span>
          </div>
        ))}
      </div>

      {/* Kill / Restart button */}
      <div className="mt-2 pt-2 border-t border-white/5">
        {isDead || isStarting ? (
          <button
            onClick={onRestart}
            disabled={isStarting}
            className="w-full text-[10px] py-1 rounded
              bg-emerald-900/40 hover:bg-emerald-800/60
              text-emerald-400 font-medium transition-colors
              disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isStarting ? "Restarting…" : "⟳ Restart Node"}
          </button>
        ) : (
          <button
            onClick={onKill}
            className="w-full text-[10px] py-1 rounded
              bg-red-900/30 hover:bg-red-800/50
              text-red-400 font-medium transition-colors"
          >
            ⚡ Kill Node
          </button>
        )}
      </div>
    </div>
  );
};

// ── Dynamic SVG lines overlay ─────────────────────────────────────────────
function ConnectionLines({ nodeRefs, containerRef, nodeStatuses, evaluating }) {
  const [pts, setPts] = useState({});

  const recalc = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const cRect = container.getBoundingClientRect();
    const next  = {};
    for (const id of [1, 2, 3]) {
      const el = nodeRefs.current[id];
      if (el) {
        const r = el.getBoundingClientRect();
        next[id] = { x: r.left + r.width / 2 - cRect.left, y: r.top + r.height / 2 - cRect.top };
      }
    }
    // Only update state if a position actually changed — avoids infinite render loop
    setPts((prev) => {
      for (const id of [1, 2, 3]) {
        if (!prev[id] || !next[id]) return next;
        if (Math.abs(prev[id].x - next[id].x) > 0.5 || Math.abs(prev[id].y - next[id].y) > 0.5) return next;
      }
      return prev; // same reference → React bails out, no re-render
    });
  }, [containerRef, nodeRefs]);

  useLayoutEffect(() => {
    recalc();
  });                               // run after every render to stay in sync

  useEffect(() => {
    const ro = new ResizeObserver(recalc);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener("resize", recalc);
    return () => { ro.disconnect(); window.removeEventListener("resize", recalc); };
  }, [recalc, containerRef]);

  if (Object.keys(pts).length < 3) return null;

  const deadCount = Object.values(nodeStatuses).filter((s) => s === "dead").length;
  const quorumLost = deadCount >= 2;

  return (
    <svg
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
    >
      {EDGES.map(([a, b]) => {
        const from = pts[a];
        const to   = pts[b];
        if (!from || !to) return null;

        const aLive = nodeStatuses[a] !== "dead";
        const bLive = nodeStatuses[b] !== "dead";
        const bothLive = aLive && bLive;

        let stroke, strokeWidth, strokeDasharray, opacity, animation;

        if (quorumLost) {
          stroke = "#ef4444";
          strokeWidth = 1;
          strokeDasharray = "3 6";
          opacity = 0.3;
          animation = "none";
        } else if (!bothLive) {
          stroke = "#ef4444";
          strokeWidth = 1;
          strokeDasharray = "5 5";
          opacity = 0.25;
          animation = "none";
        } else if (evaluating) {
          stroke = "#faa61a";
          strokeWidth = 2;
          strokeDasharray = "8 4";
          opacity = 0.7;
          animation = "raftFlowFast 0.5s linear infinite";
        } else {
          stroke = "#5865f2";
          strokeWidth = 1.5;
          strokeDasharray = "8 4";
          opacity = 0.5;
          animation = "raftFlow 2s linear infinite";
        }

        return (
          <line
            key={`${a}-${b}`}
            x1={from.x} y1={from.y}
            x2={to.x}   y2={to.y}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDasharray}
            opacity={opacity}
            style={{
              transition: "stroke 0.5s, opacity 0.5s, stroke-width 0.5s",
              animation,
            }}
          />
        );
      })}
    </svg>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function ClusterPane({
  servers, packets, evaluating, nodeHighlight, activityLog,
  nodeStatuses = { 1: "live", 2: "live", 3: "live" },
  onPacketDone, onKillNode, onRestartNode,
}) {
  const containerRef = useRef(null);
  const nodeRefs     = useRef({ 1: null, 2: null, 3: null });

  const nodeShards = { 1: [], 2: [], 3: [] };
  servers.forEach((s) => {
    nodeShards[s.node_id] = nodeShards[s.node_id] ?? [];
    nodeShards[s.node_id].push(s);
  });

  const deadCount = [1, 2, 3].filter((id) => nodeStatuses[id] === "dead").length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-white">
            CockroachDB Cluster
            <span className="ml-2 text-[10px] font-normal text-slate-500 uppercase tracking-widest">
              Shared-Nothing · 3 Nodes
            </span>
          </h2>
          {deadCount > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-900/40 text-red-400 font-medium">
              {deadCount} node{deadCount > 1 ? "s" : ""} offline
            </span>
          )}
        </div>
        {evaluating && (
          <p className="text-[11px] text-yellow-400 mt-0.5 animate-pulse">
            ⚙ Evaluating shard placement…
          </p>
        )}
        {deadCount === 1 && (
          <p className="text-[11px] text-emerald-400 mt-0.5">
            ✓ Cluster operational — quorum maintained (2/3 nodes live)
          </p>
        )}
        {deadCount >= 2 && deadCount < 3 && (
          <p className="text-[11px] text-red-400 mt-0.5 font-semibold animate-pulse">
            🚨 QUORUM LOST — writes blocked ({3 - deadCount}/3 nodes live)
          </p>
        )}
        {deadCount === 3 && (
          <p className="text-[11px] text-red-500 mt-0.5 font-bold">
            ☠ ALL NODES OFFLINE — cluster unreachable
          </p>
        )}
      </div>

      {/* Visualisation */}
      <div className="relative flex-1 overflow-hidden" ref={containerRef}>

        {/* Dynamic connection lines — rendered BEHIND node cards */}
        <ConnectionLines
          nodeRefs={nodeRefs}
          containerRef={containerRef}
          nodeStatuses={nodeStatuses}
          evaluating={evaluating}
        />

        {/* Node cards — absolutely positioned at percentage coordinates */}
        {[1, 2, 3].map((nodeId) => (
          <div
            key={nodeId}
            ref={(el) => { nodeRefs.current[nodeId] = el; }}
            style={{
              position:  "absolute",
              left:      `${NODE_POS[nodeId].x}%`,
              top:       `${NODE_POS[nodeId].y}%`,
              transform: "translate(-50%, -50%)",
            }}
          >
            <NodeCard
              nodeId={nodeId}
              shards={nodeShards[nodeId] ?? []}
              evaluating={evaluating}
              highlight={nodeHighlight === nodeId}
              status={nodeStatuses[nodeId] ?? "live"}
              onKill={() => onKillNode?.(nodeId)}
              onRestart={() => onRestartNode?.(nodeId)}
            />
          </div>
        ))}

        {/* Data packets */}
        {packets.map((p) => (
          <DataPacket key={p.id} id={p.id} targetNode={p.targetNode}
            fromNode={p.fromNode ?? null} color={p.color} onDone={onPacketDone} />
        ))}

        {/* Client indicator */}
        <div
          style={{ position: "absolute", left: `${CLIENT_POS.x}%`, bottom: "4%",
                   transform: "translateX(-50%)" }}
          className="flex flex-col items-center gap-1 pointer-events-none"
        >
          <div className="w-2 h-2 rounded-full bg-[#5865f2] opacity-70
            shadow-[0_0_6px_2px_#5865f288]" />
          <span className="text-[8px] text-slate-600 font-mono uppercase tracking-wider">
            client
          </span>
        </div>

        {/* Legend */}
        <div className="absolute bottom-3 right-3 text-[9px] text-slate-600
          space-y-0.5 pointer-events-none text-right">
          <div className="flex items-center justify-end gap-1.5">
            <span>Raft replication channel</span>
            <span className="w-4 border-t border-[#5865f245]" />
          </div>
          <div className="flex items-center justify-end gap-1.5">
            <span>Write packet → shard owner</span>
            <span className="w-3 h-2.5 rounded-full bg-[#5865f2] shadow-[0_0_6px_2px_#5865f2aa]" />
          </div>
          <div className="flex items-center justify-end gap-1.5">
            <span>Reroute to live replica</span>
            <span className="w-3 h-2.5 rounded-full bg-[#23a55a] shadow-[0_0_6px_2px_#23a55aaa]" />
          </div>
          <div className="flex items-center justify-end gap-1.5">
            <span>Failed packet (dead node)</span>
            <span className="w-3 h-2.5 rounded-full bg-[#ef4444] shadow-[0_0_6px_2px_#ef444488]" />
          </div>
        </div>
      </div>

      {/* Activity log */}
      <div className="border-t border-white/5 flex-shrink-0 h-36 overflow-y-auto
        bg-[#12131a] px-3 py-2">
        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-600 mb-1.5">
          Activity Log
        </p>
        {activityLog.length === 0 && (
          <p className="text-[10px] text-slate-700 italic">
            No events yet. Send a message, create a server, or kill a node.
          </p>
        )}
        {activityLog.map((entry) => (
          <div key={entry.id} className="flex gap-2 text-[10px] mb-1 animate-fadeIn">
            <span className="text-slate-600 flex-shrink-0 font-mono">{entry.ts}</span>
            <span className="text-slate-400">{entry.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
