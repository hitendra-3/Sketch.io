"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Canvas, { type CanvasHandle } from "@/components/Canvas";
import Toolbar from "@/components/Toolbar";
import PresenceBar from "@/components/PresenceBar";
import CursorLayer from "@/components/CursorLayer";
import ThemeToggle from "@/components/ThemeToggle";
import NameModal from "@/components/NameModal";
import { wsUrlForRoom } from "@/lib/config";
import type {
  ClientMessage, CursorState, Point, RemoteUser,
  ServerMessage, Stroke, Tool,
} from "@/lib/types";

const RECONNECT_DELAYS = [500, 1000, 2000, 4000, 8000];
const CURSOR_STALE_MS  = 4000;
const MAX_UNDO         = 64;

const SWATCHES = [
  "#1a1a2e", "#6366f1", "#f59e0b",
  "#ef4444", "#10b981", "#a855f7",
  "#f43f5e", "#06b6d4", "#ffffff",
  "#f97316", "#84cc16", "#3b82f6",
];

export default function BoardPage() {
  const { roomId } = useParams<{ roomId: string }>();

  const [hasJoined, setHasJoined]   = useState(false);
  const [name, setName]             = useState("");

  // Tool / styling state
  const [tool, setTool]             = useState<Tool>("pen");
  const [color, setColor]           = useState("#6366f1");
  const [brushWidth, setBrushWidth] = useState(6);
  const [fillStyle, setFillStyle]   = useState<"hachure" | "cross-hatch" | "solid" | "none">("none");
  const [fillColor, setFillColor]   = useState("#6366f1");
  const [roughness, setRoughness]   = useState(0);

  // Sync fillColor to color by default when color changes
  useEffect(() => {
    setFillColor(color);
  }, [color]);

  // Zoom & Pan
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  const [selfId, setSelfId]         = useState("");
  const [selfColor, setSelfColor]   = useState("#6366f1");
  const [users, setUsers]           = useState<RemoteUser[]>([]);
  const [userCount, setUserCount]   = useState(1);
  const [cursors, setCursors]       = useState<Record<string, CursorState>>({});
  const [connStatus, setConnStatus] = useState<"connecting"|"open"|"closed">("connecting");

  // Undo / redo stacks (own strokes only)
  const undoStackRef = useRef<Stroke[]>([]);
  const redoStackRef = useRef<Stroke[]>([]);
  const [undoLen, setUndoLen] = useState(0);
  const [redoLen, setRedoLen] = useState(0);

  // Styles panel auto-fade
  const [stylesPanelFaded, setStylesPanelFaded] = useState(false);
  const stylesFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startStylesFadeTimer = () => {
    if (stylesFadeTimerRef.current) clearTimeout(stylesFadeTimerRef.current);
    stylesFadeTimerRef.current = setTimeout(() => setStylesPanelFaded(true), 5000);
  };
  const handleStylesPanelEnter = () => {
    if (stylesFadeTimerRef.current) clearTimeout(stylesFadeTimerRef.current);
    setStylesPanelFaded(false);
  };
  const handleStylesPanelLeave = () => startStylesFadeTimer();

  // Start the timer when panel first appears (tool changes)
  useEffect(() => {
    setStylesPanelFaded(false);
    startStylesFadeTimer();
    return () => { if (stylesFadeTimerRef.current) clearTimeout(stylesFadeTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  const canvasRef = useRef<CanvasHandle | null>(null);
  const wsRef     = useRef<WebSocket | null>(null);
  const retryRef  = useRef(0);
  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadRef   = useRef(false);
  const nameRef   = useRef(name);
  useEffect(() => { nameRef.current = name; }, [name]);

  useEffect(() => {
    try { const s = localStorage.getItem("sketchio-name"); if (s) setName(s); } catch {}
  }, []);

  // ── Send helper ──────────────────────────────────────────────────────────
  const send = useCallback((msg: ClientMessage | { type: "pong" }) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  // ── Message handler ──────────────────────────────────────────────────────
  const handleMsg = useCallback((msg: ServerMessage | { type: "ping" }) => {
    if (msg.type === "ping") {
      send({ type: "pong" });
      return;
    }

    switch (msg.type) {
      case "init":
        setSelfId(msg.clientId);
        setSelfColor(msg.color);
        setUsers(msg.users);
        setUserCount(msg.userCount);
        canvasRef.current?.redrawAll(msg.strokes);
        break;
      case "user_joined":
        setUsers(p => [...p.filter(u => u.id !== msg.user.id), msg.user]);
        break;
      case "user_left":
        setUsers(p => p.filter(u => u.id !== msg.id));
        setCursors(p => { const n = {...p}; delete n[msg.id]; return n; });
        break;
      case "user_renamed":
        setUsers(p => p.map(u => u.id === msg.id ? {...u, name: msg.name} : u));
        break;
      case "user_count":
        setUserCount(msg.count);
        break;
      case "stroke_start":
        canvasRef.current?.applyRemoteStrokeStart({
          strokeId: msg.strokeId, color: msg.color, width: msg.width,
          tool: msg.tool, points: [msg.point], authorId: msg.id,
          fillStyle: msg.fillStyle, fillColor: msg.fillColor, roughness: msg.roughness,
        });
        break;
      case "stroke_point":
        canvasRef.current?.applyRemoteStrokePoint(msg.strokeId, msg.point);
        break;
      case "stroke_end":
        canvasRef.current?.applyRemoteStrokeEnd(msg.strokeId);
        break;
      case "clear":
        canvasRef.current?.clearCanvas();
        break;
      case "cursor":
        setCursors(p => ({
          ...p,
          [msg.id]: {
            id: msg.id, x: msg.x, y: msg.y,
            name: msg.name, color: msg.color, lastSeen: Date.now(),
            brushWidth: msg.brushWidth, tool: msg.tool,
          },
        }));
        break;
      case "undo":
        canvasRef.current?.removeStroke(msg.strokeId);
        break;
      case "redo":
        canvasRef.current?.addStroke(msg.stroke);
        break;
    }
  }, [send]);

  // ── WebSocket lifecycle ──────────────────────────────────────────────────
  useEffect(() => {
    if (!hasJoined || !roomId) return;
    deadRef.current = false;

    const connect = () => {
      if (deadRef.current) return;
      setConnStatus("connecting");

      const url = wsUrlForRoom(roomId, nameRef.current);
      const ws  = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 0;
        setConnStatus("open");
      };

      ws.onmessage = (e) => {
        try {
          handleMsg(JSON.parse(e.data) as ServerMessage | { type: "ping" });
        } catch { /* ignore malformed frames */ }
      };

      ws.onclose = (ev) => {
        setConnStatus("closed");
        if (deadRef.current) return;
        const delay = RECONNECT_DELAYS[Math.min(retryRef.current++, RECONNECT_DELAYS.length - 1)];
        console.log(`[ws] closed (code=${ev.code}) — reconnecting in ${delay}ms`);
        timerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = (ev) => {
        console.error("[ws] error", ev);
        ws.close();
      };
    };

    connect();

    return () => {
      deadRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [hasJoined, roomId, handleMsg]);

  // ── Stale cursor cleanup ─────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => {
      setCursors(p => {
        const now = Date.now();
        const n: Record<string, CursorState> = {};
        for (const [id, c] of Object.entries(p)) {
          if (now - c.lastSeen < CURSOR_STALE_MS) n[id] = c;
        }
        return n;
      });
    }, 1500);
    return () => clearInterval(t);
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl) {
        if (e.key === "z" && !e.shiftKey) { e.preventDefault(); handleUndo(); }
        if (e.key === "y" || (e.key === "z" && e.shiftKey)) { e.preventDefault(); handleRedo(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ── Undo / Redo ──────────────────────────────────────────────────────────
  const handleUndo = () => {
    const stroke = undoStackRef.current.pop();
    if (!stroke) return;
    redoStackRef.current.push(stroke);
    setUndoLen(undoStackRef.current.length);
    setRedoLen(redoStackRef.current.length);
    canvasRef.current?.removeStroke(stroke.strokeId);
    send({ type: "undo", strokeId: stroke.strokeId });
  };

  const handleRedo = () => {
    const stroke = redoStackRef.current.pop();
    if (!stroke) return;
    undoStackRef.current.push(stroke);
    setUndoLen(undoStackRef.current.length);
    setRedoLen(redoStackRef.current.length);
    canvasRef.current?.addStroke(stroke);
    send({ type: "redo", stroke });
  };

  // Two-step clear confirmation
  const [clearConfirm, setClearConfirm] = useState(false);
  const clearConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClearClick = () => {
    if (!clearConfirm) {
      setClearConfirm(true);
      clearConfirmTimerRef.current = setTimeout(() => setClearConfirm(false), 3000);
    } else {
      if (clearConfirmTimerRef.current) clearTimeout(clearConfirmTimerRef.current);
      setClearConfirm(false);
      canvasRef.current?.clearCanvas();
      send({ type: "clear" });
      undoStackRef.current = []; redoStackRef.current = [];
      setUndoLen(0); setRedoLen(0);
    }
  };

  const handleClear = () => {
    canvasRef.current?.clearCanvas();
    send({ type: "clear" });
    undoStackRef.current = []; redoStackRef.current = [];
    setUndoLen(0); setRedoLen(0);
  };

  const handleJoin = (chosen: string) => {
    setName(chosen);
    nameRef.current = chosen;
    try { localStorage.setItem("sketchio-name", chosen); } catch {}
    setHasJoined(true);
  };

  return (
    <div className="flex h-dvh w-full flex-col bg-paper overflow-hidden select-none">
      {!hasJoined && (
        <NameModal roomId={roomId} defaultName={name || "Guest"} onJoin={handleJoin} />
      )}

      {/* Full-width Presence Header */}
      <PresenceBar
        roomId={roomId}
        users={users.filter(u => u.id !== selfId)}
        selfName={name || "You"}
        selfColor={selfColor}
        userCount={userCount}
        connectionStatus={connStatus}
      />

      {/* Main workspace: sidebar toolbar + canvas */}
      <div className="relative flex min-h-0 flex-1">

        {/* Left Sidebar Toolbar */}
        <Toolbar
          tool={tool}
          setTool={(t) => { setTool(t); }}
          color={color}
          setColor={setColor}
          brushWidth={brushWidth}
          setBrushWidth={setBrushWidth}
          onClear={handleClear}
          onUndo={handleUndo}
          onRedo={handleRedo}
          canUndo={undoLen > 0}
          canRedo={redoLen > 0}
        />

        {/* Canvas area */}
        <div className="relative min-w-0 flex-1 overflow-hidden">
          <Canvas
            ref={canvasRef}
            tool={tool}
            color={color}
            width={brushWidth}
            fillStyle={fillStyle}
            fillColor={fillColor}
            roughness={roughness}
            zoom={zoom}
            panX={panX}
            panY={panY}
            setPan={(x, y) => { setPanX(x); setPanY(y); }}
            setZoom={setZoom}
            disabled={!hasJoined}
            onStrokeStart={(s) => {
              redoStackRef.current = []; setRedoLen(0);
              send({ type: "stroke_start", ...s });
            }}
            onStrokePoint={(strokeId, point) =>
              send({ type: "stroke_point", strokeId, point })
            }
            onStrokeEnd={(strokeId, stroke) => {
              undoStackRef.current = [...undoStackRef.current, stroke].slice(-MAX_UNDO);
              setUndoLen(undoStackRef.current.length);
              send({ type: "stroke_end", strokeId });
            }}
            onCursorMove={(p: Point, meta) =>
              send({
                type: "cursor",
                x: p.x,
                y: p.y,
                brushWidth: meta?.brushWidth,
                tool: meta?.tool,
              })
            }
            onStrokeDelete={(strokeId) => {
              undoStackRef.current = undoStackRef.current.filter((s) => s.strokeId !== strokeId);
              redoStackRef.current = redoStackRef.current.filter((s) => s.strokeId !== strokeId);
              setUndoLen(undoStackRef.current.length);
              setRedoLen(redoStackRef.current.length);
              send({ type: "undo", strokeId });
            }}
            onStrokeUpdate={(stroke) => {
              send({ type: "redo", stroke });
            }}
          />

          {/* Remote cursors translated to zoom/pan */}
          <CursorLayer
            cursors={Object.values(cursors)}
            zoom={zoom}
            panX={panX}
            panY={panY}
          />

          {/* Zoom & Clear controls — bottom left */}
          <div className="absolute bottom-4 left-4 z-30 flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-xl border border-line bg-surface px-2 py-1.5 shadow-md">
              <button
                onClick={() => setZoom(z => Math.max(0.2, +(z - 0.1).toFixed(2)))}
                className="flex h-6 w-6 items-center justify-center rounded-md text-ink-soft hover:bg-accent-soft hover:text-accent"
                title="Zoom Out"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12" /></svg>
              </button>
              <button
                onClick={() => { setZoom(1); setPanX(0); setPanY(0); }}
                className="font-mono text-[11px] font-semibold text-ink-soft hover:text-accent w-10 text-center"
                title="Reset zoom"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                onClick={() => setZoom(z => Math.min(4, +(z + 0.1).toFixed(2)))}
                className="flex h-6 w-6 items-center justify-center rounded-md text-ink-soft hover:bg-accent-soft hover:text-accent"
                title="Zoom In"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              </button>
            </div>
            
            {/* Clear Board — two-step confirm */}
            <button
              onClick={handleClearClick}
              className={`flex h-9 items-center justify-center gap-1.5 rounded-xl border px-3 text-[11px] font-medium shadow-md transition-all duration-200 ${
                clearConfirm
                  ? "border-rose bg-rose text-white scale-105"
                  : "border-line bg-surface text-ink-soft hover:border-rose/60 hover:text-rose hover:bg-rose/5"
              }`}
              title={clearConfirm ? "Click again to confirm" : "Clear Board"}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" /></svg>
              <span>{clearConfirm ? "Sure?" : "Clear"}</span>
            </button>
          </div>


          {/* Connection status banners */}
          {connStatus === "closed" && (
            <div className="absolute bottom-4 right-4 z-30 rounded-full border border-red-300 bg-red-50 px-4 py-1.5 font-mono text-xs text-red-600 shadow dark:border-red-800 dark:bg-red-950/60 dark:text-red-400">
              Disconnected — Reconnecting…
            </div>
          )}
          {connStatus === "connecting" && (
            <div className="absolute bottom-4 right-4 z-30 rounded-full border border-line bg-surface px-4 py-1.5 font-mono text-xs text-ink-soft shadow">
              Connecting…
            </div>
          )}

          <ThemeToggle className="absolute right-4 top-4 z-30 bg-surface shadow-sm" />

          {/* Shape styling panel — also shown for eraser */}
          {["pen", "pencil", "marker", "calligraphy", "crayon", "oil", "watercolour", "rect", "circle", "triangle", "line", "arrow", "diamond", "star", "hexagon", "eraser"].includes(tool) && (
            <div
              className="floating-panel absolute right-4 top-14 z-30 flex w-52 flex-col gap-3 p-3 select-none overflow-y-auto"
              style={{ maxHeight: "calc(100% - 96px)", opacity: stylesPanelFaded ? 0.2 : 1, transition: "opacity 0.6s ease" }}
              onMouseEnter={handleStylesPanelEnter}
              onMouseLeave={handleStylesPanelLeave}
            >
              <h3 className="font-mono text-[9px] font-bold uppercase tracking-wider text-ink-soft border-b border-line pb-1">
                {tool === "eraser" ? "Eraser" : `Styles (${tool})`}
              </h3>

              {/* Eraser size */}
              {tool === "eraser" && (
                <div className="flex flex-col gap-1.5">
                  <span className="flex justify-between text-[10px] font-medium text-ink-soft">
                    <span>Eraser Size</span>
                    <span>{brushWidth}px</span>
                  </span>
                  <input
                    type="range" min={4} max={80} value={brushWidth}
                    onChange={(e) => setBrushWidth(Number(e.target.value))}
                    className="w-full accent-accent"
                  />
                  <div className="flex items-center justify-center py-1">
                    <div
                      style={{ width: Math.min(brushWidth, 52), height: Math.min(brushWidth, 52) }}
                      className="rounded-full border-2 border-dashed border-slate-400"
                    />
                  </div>
                </div>
              )}

              {/* Stroke Color — not shown for eraser */}
              {tool !== "eraser" && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-medium text-ink-soft">Stroke Color</span>
                  <div className="grid grid-cols-4 gap-1">
                    {SWATCHES.map((s) => (
                      <button
                        key={s}
                        onClick={() => setColor(s)}
                        style={{ backgroundColor: s }}
                        className={`h-5 w-full rounded border border-line transition hover:scale-105 ${
                          color === s ? "ring-2 ring-accent ring-offset-1 ring-offset-surface" : ""
                        }`}
                        title={s}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Stroke Width */}
              {tool !== "eraser" && (
                <div className="flex flex-col gap-1.5">
                  <span className="flex justify-between text-[10px] font-medium text-ink-soft">
                    <span>Stroke Width</span>
                    <span>{brushWidth}px</span>
                  </span>
                  <input
                    type="range" min={1} max={40} value={brushWidth}
                    onChange={(e) => setBrushWidth(Number(e.target.value))}
                    className="w-full accent-accent"
                  />
                </div>
              )}

              {/* Roughness (Sketchiness) */}
              {tool !== "eraser" && (
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-medium text-ink-soft">Roughness</span>
                  <div className="grid grid-cols-3 gap-1">
                    {[
                      { label: "Precise", val: 0 },
                      { label: "Normal", val: 1 },
                      { label: "Sketchy", val: 2 },
                    ].map((r) => (
                      <button
                        key={r.val}
                        type="button"
                        onClick={() => setRoughness(r.val)}
                        className={`rounded-md border py-0.5 text-[9px] font-semibold transition ${
                          roughness === r.val
                            ? "border-accent bg-accent-soft text-accent font-bold"
                            : "border-line text-ink-soft hover:bg-accent-soft/30"
                        }`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Fill Style */}
              {["rect", "circle", "triangle", "diamond", "star", "hexagon"].includes(tool) && (
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-medium text-ink-soft">Fill Style</span>
                  <div className="grid grid-cols-2 gap-1">
                    {[
                      { label: "None", val: "none" },
                      { label: "Hachure", val: "hachure" },
                      { label: "Cross-Hatch", val: "cross-hatch" },
                      { label: "Solid", val: "solid" },
                    ].map((f) => (
                      <button
                        key={f.val}
                        type="button"
                        onClick={() => setFillStyle(f.val as any)}
                        className={`rounded-md border py-0.5 text-[9px] font-semibold transition ${
                          fillStyle === f.val
                            ? "border-accent bg-accent-soft text-accent font-bold"
                            : "border-line text-ink-soft hover:bg-accent-soft/30"
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Fill Color */}
              {["rect", "circle", "triangle", "diamond", "star", "hexagon"].includes(tool) && fillStyle !== "none" && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-medium text-ink-soft">Fill Color</span>
                  <div className="grid grid-cols-4 gap-1">
                    {[
                      color,
                      "#ffccd5", "#d8f3dc", "#caf0f8", "#fde2e4", "#ffd166", "#ffffff", "#1e1e1e"
                    ].map((c, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setFillColor(c)}
                        style={{ backgroundColor: c }}
                        className={`h-5 w-full rounded border border-line transition hover:scale-105 ${
                          fillColor === c ? "ring-2 ring-accent ring-offset-1 ring-offset-surface" : ""
                        }`}
                        title={idx === 0 ? "Match Stroke" : c}
                      />
                    ))}
                  </div>
                </div>
              )}

            </div>
          )}
        </div>
      </div>
    </div>
  );
}
