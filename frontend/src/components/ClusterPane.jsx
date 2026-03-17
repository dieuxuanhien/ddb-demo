import { useState, useEffect, useRef } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Positions expressed as percentages of the visualisation container.
// ─────────────────────────────────────────────────────────────────────────────
const NODE_POS = {
  1: { x: 22, y: 18 },
  2: { x: 72, y: 18 },
  3: { x: 47, y: 62 },
};
const CLIENT_POS = { x: 47, y: 92 };

// Connections to draw (shared-nothing = no shared disk, but nodes replicate
// metadata via the Raft protocol – shown as thin lines)
const EDGES = [
  [1, 2],
  [2, 3],
  [1, 3],
];

// ─────────────────────────────────────────────────────────────────────────────
// Animated data-packet dot
// ─────────────────────────────────────────────────────────────────────────────
function DataPacket({ id, targetNode, color, onDone }) {
  const [moved, setMoved] = useState(false);
  const from = CLIENT_POS;
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
        opacity:         1,
      }}
      onTransitionEnd={() => onDone(id)}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// A single CockroachDB node card
// ─────────────────────────────────────────────────────────────────────────────
function NodeCard({ nodeId, shards, evaluating, highlight }) {
  const pos = NODE_POS[nodeId];
  const isHighlighted = highlight === nodeId;

  const shardColors = ["bg-blue-500", "bg-purple-500", "bg-green-500",
                       "bg-yellow-500", "bg-pink-500", "bg-cyan-500"];

  return (
    <div
      style={{
        position: "absolute",
        left:   `${pos.x}%`,
        top:    `${pos.y}%`,
        transform: "translate(-50%, -50%)",
        width: "160px",
      }}
      className={`rounded-xl border-2 p-3
        bg-[#1e2030] shadow-xl transition-all duration-300
        ${evaluating
          ? "border-yellow-400 animate-evaluating"
          : isHighlighted
            ? "border-discord-green animate-nodeFlashGreen"
            : "border-[#5865f2]/60 hover:border-[#5865f2]"
        }`}
    >
      {/* Node header */}
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`w-2.5 h-2.5 rounded-full flex-shrink-0
            ${evaluating ? "bg-yellow-400 animate-pulse" : "bg-discord-green"}`}
        />
        <span className="text-xs font-bold text-white">Node {nodeId}</span>
        <span className="ml-auto text-[9px] text-slate-500 font-mono">
          roach{nodeId}
        </span>
      </div>

      {/* Disk label */}
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

      {/* Shards hosted on this node */}
      <div className="space-y-1 min-h-[24px]">
        {shards.length === 0 && (
          <p className="text-[10px] text-slate-600 italic px-1">no shards</p>
        )}
        {shards.map((s, i) => (
          <div
            key={s.id}
            className="shard-badge flex items-center gap-1.5 px-1.5 py-0.5
              rounded bg-slate-800/80 border border-white/5"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0
                ${shardColors[i % shardColors.length]}`}
            />
            <span className="text-[10px] text-slate-300 truncate">{s.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export default function ClusterPane({
  servers,
  packets,
  evaluating,
  nodeHighlight,
  activityLog,
  onPacketDone,
}) {
  const containerRef = useRef(null);

  // Map node → shards
  const nodeShards = { 1: [], 2: [], 3: [] };
  servers.forEach((s) => {
    if (nodeShards[s.node_id]) nodeShards[s.node_id].push(s);
    else nodeShards[s.node_id] = [s];
  });

  // SVG edge coordinates (percent → pixel done in SVG viewBox)
  // We use a 100×100 viewBox mapped to the container, so coordinates ARE %.
  function edgePath(from, to) {
    return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/5 flex-shrink-0">
        <h2 className="text-sm font-bold text-white">
          CockroachDB Cluster
          <span className="ml-2 text-[10px] font-normal text-slate-500 uppercase tracking-widest">
            Shared-Nothing · 3 Nodes
          </span>
        </h2>
        {evaluating && (
          <p className="text-[11px] text-yellow-400 mt-0.5 animate-pulse">
            ⚙ Evaluating shard placement…
          </p>
        )}
      </div>

      {/* Visualisation area */}
      <div className="relative flex-1 overflow-hidden" ref={containerRef}>

        {/* SVG connection lines */}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="cluster-svg"
        >
          {EDGES.map(([a, b]) => {
            const from = NODE_POS[a];
            const to   = NODE_POS[b];
            return (
              <path
                key={`${a}-${b}`}
                d={edgePath(from, to)}
                stroke={evaluating ? "#faa61a55" : "#5865f230"}
                strokeWidth="0.5"
                strokeDasharray={evaluating ? "2 2" : "none"}
                fill="none"
                style={{ transition: "stroke 0.4s" }}
              />
            );
          })}

          {/* Client node indicator */}
          <circle
            cx={CLIENT_POS.x}
            cy={CLIENT_POS.y}
            r="1.5"
            fill="#5865f2"
            opacity="0.6"
          />
          <text
            x={CLIENT_POS.x}
            y={CLIENT_POS.y - 3}
            textAnchor="middle"
            fill="#5865f280"
            fontSize="2.5"
            fontFamily="monospace"
          >
            CLIENT
          </text>
        </svg>

        {/* Node cards */}
        {[1, 2, 3].map((nodeId) => (
          <NodeCard
            key={nodeId}
            nodeId={nodeId}
            shards={nodeShards[nodeId] ?? []}
            evaluating={evaluating}
            highlight={nodeHighlight}
          />
        ))}

        {/* Data packets */}
        {packets.map((p) => (
          <DataPacket
            key={p.id}
            id={p.id}
            targetNode={p.targetNode}
            color={p.color}
            onDone={onPacketDone}
          />
        ))}

        {/* Legend */}
        <div className="absolute bottom-3 left-3 text-[9px] text-slate-600
          space-y-0.5 pointer-events-none">
          <div className="flex items-center gap-1.5">
            <span className="w-3 border-t border-[#5865f230]" />
            <span>Raft replication channel</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-2.5 rounded-full bg-[#5865f2]
              shadow-[0_0_6px_2px_#5865f2aa]" />
            <span>Write packet → shard owner</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-2.5 rounded-full bg-[#23a55a]
              shadow-[0_0_6px_2px_#23a55aaa]" />
            <span>Shard assignment</span>
          </div>
        </div>
      </div>

      {/* Activity log */}
      <div className="border-t border-white/5 flex-shrink-0 h-36 overflow-y-auto
        bg-[#12131a] px-3 py-2">
        <p className="text-[9px] font-bold uppercase tracking-widest
          text-slate-600 mb-1.5">
          Activity Log
        </p>
        {activityLog.length === 0 && (
          <p className="text-[10px] text-slate-700 italic">
            No events yet. Send a message or create a server.
          </p>
        )}
        {activityLog.map((entry) => (
          <div key={entry.id} className="flex gap-2 text-[10px] mb-1 animate-fadeIn">
            <span className="text-slate-600 flex-shrink-0 font-mono">
              {entry.ts}
            </span>
            <span className="text-slate-400">{entry.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
