"use client";
import { useEffect, useRef, useState } from "react";
import type { Tool } from "@/lib/types";

interface ToolbarProps {
  tool: Tool;
  setTool: (t: Tool) => void;
  color: string;
  setColor: (c: string) => void;
  brushWidth: number;
  setBrushWidth: (w: number) => void;
  onClear: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

type ToolDef = { id: Tool; label: string; icon: JSX.Element };

const SELECT_TOOLS: ToolDef[] = [
  { id: "select", label: "Select / Move (V)", icon: <SelectIcon /> },
  { id: "hand",   label: "Hand / Pan (H)",    icon: <HandIcon /> },
];

const DRAW_TOOLS: ToolDef[] = [
  { id: "pen",         label: "Pen",         icon: <PenIcon /> },
  { id: "pencil",      label: "Pencil",      icon: <PencilIcon /> },
  { id: "marker",      label: "Marker",      icon: <MarkerIcon /> },
  { id: "calligraphy", label: "Calligraphy", icon: <CalligraphyIcon /> },
  { id: "crayon",      label: "Crayon",      icon: <CrayonIcon /> },
  { id: "oil",         label: "Oil Brush",   icon: <OilIcon /> },
  { id: "watercolour", label: "Watercolour", icon: <WatercolourIcon /> },
];

const SHAPE_TOOLS: ToolDef[] = [
  { id: "rect",     label: "Rectangle", icon: <RectIcon /> },
  { id: "circle",   label: "Circle",    icon: <CircleShapeIcon /> },
  { id: "triangle", label: "Triangle",  icon: <TriangleIcon /> },
  { id: "line",     label: "Line",      icon: <LineIcon /> },
  { id: "arrow",    label: "Arrow",     icon: <ArrowIcon /> },
  { id: "hexagon",  label: "Hexagon",   icon: <HexagonIcon /> },
];

const FADE_DELAY = 5000; // ms before fading

export default function Toolbar({
  tool, setTool, color, setColor, brushWidth, setBrushWidth,
  onClear, onUndo, onRedo, canUndo, canRedo,
}: ToolbarProps) {
  const [mounted, setMounted] = useState(false);
  const [faded, setFaded] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setMounted(true), []);

  // Start the fade timer on mount, reset on hover
  useEffect(() => {
    if (!mounted) return;
    const start = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setFaded(true), FADE_DELAY);
    };
    start();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [mounted]);

  const handleMouseEnter = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setFaded(false);
  };

  const handleMouseLeave = () => {
    timerRef.current = setTimeout(() => setFaded(true), FADE_DELAY);
  };

  if (!mounted) return <div className="absolute left-3 top-2 w-10 bg-transparent" style={{ maxHeight: "calc(100vh - 80px)" }} />;

  const btn = (active: boolean, disabled = false) =>
    `tool-btn ${disabled ? "opacity-30 cursor-not-allowed" : active ? "active" : ""}`;

  return (
    <div
      className="floating-panel absolute left-3 top-2 z-40 flex flex-col items-center justify-start gap-1 p-1.5 overflow-y-auto"
      style={{
        maxHeight: "calc(100% - 72px)",
        opacity: faded ? 0.2 : 1,
        transition: "opacity 0.6s ease",
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* ── Undo / Redo ── */}
      <div className="flex flex-col items-center gap-1">
        <button onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)" className={btn(false, !canUndo)}>
          <UndoIcon />
        </button>
        <button onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Y)" className={btn(false, !canRedo)}>
          <RedoIcon />
        </button>
      </div>

      <div className="my-0.5 w-5 h-px bg-line" />

      {/* ── Select / Hand ── */}
      <div className="flex flex-col items-center gap-1">
        {SELECT_TOOLS.map(({ id, label, icon }) => (
          <button key={id} onClick={() => setTool(id)} title={label} className={btn(tool === id)}>
            {icon}
          </button>
        ))}
      </div>

      <div className="my-0.5 w-5 h-px bg-line" />

      {/* ── Drawing tools ── */}
      <div className="flex flex-col items-center gap-1">
        {DRAW_TOOLS.map(({ id, label, icon }) => (
          <button key={id} onClick={() => setTool(id)} title={label} className={btn(tool === id)}>
            {icon}
          </button>
        ))}
      </div>

      <div className="my-0.5 w-5 h-px bg-line" />

      {/* ── Shape tools ── */}
      <div className="flex flex-col items-center gap-1">
        {SHAPE_TOOLS.map(({ id, label, icon }) => (
          <button key={id} onClick={() => setTool(id)} title={label} className={btn(tool === id)}>
            {icon}
          </button>
        ))}
      </div>

      <div className="my-0.5 w-5 h-px bg-line" />

      <button onClick={() => setTool("eraser")} title="Eraser" className={btn(tool === "eraser")}>
        <EraserIcon />
      </button>

    </div>
  );
}

// ── Icon helper ───────────────────────────────────────────────────────────────
const I = ({ children, size = 16 }: { children: React.ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);

// ── Mode icons ────────────────────────────────────────────────────────────────
function SelectIcon() { return <I><path d="m4 4 7.07 17 2.51-7.39L21 11.07z" /><path d="M14 14l6 6" /></I>; }
function HandIcon() { return <I size={15}><path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v5" /><path d="M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8" /><path d="M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8" /><path d="M6 14a2 2 0 0 0-2-2 2 2 0 0 0-2 2v4a7 7 0 0 0 7 7h3a8 8 0 0 0 8-8v-5a2 2 0 0 0-2-2 2 2 0 0 0-2 2" /></I>; }

// ── Draw icons ────────────────────────────────────────────────────────────────
function PenIcon() { return <I><path d="M12 19l7-7 3 3-7 7-3-3z" /><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" /><circle cx="11" cy="11" r="2" /></I>; }
function PencilIcon() { return <I><line x1="18" y1="2" x2="22" y2="6" /><path d="M7.5 20.5L19 9l-4-4L3.5 16.5 2 22z" /><line x1="15" y1="5" x2="19" y2="9" /></I>; }
function MarkerIcon() { return <I><path d="M9 11l4 4L20 8a2 2 0 0 0-3-3L9 11z" /><path d="M9 11L5 15a2 2 0 0 0 0 3l1 1a2 2 0 0 0 3 0l4-4" /><line x1="5" y1="20" x2="3" y2="22" /></I>; }
function CalligraphyIcon() { return <I><path d="M3 17c3-3 6-6 8-8" /><path d="M11 9c2-2 4-3 6-3 0 2-1 4-3 6" /><path d="M5 21c1-2 4-7 6-9" /><circle cx="19" cy="5" r="2" /></I>; }
function CrayonIcon() { return <I><path d="M6 20L17 9l-4-4L2 16l4 4z" /><path d="M17 9l3-3a1 1 0 0 0-3-3l-3 3" /><line x1="8" y1="18" x2="12" y2="14" /></I>; }
function OilIcon() { return <I><path d="M3 22l9-9" /><path d="M6 6l2 2-4 4 4 4 4-4" /><path d="M17.5 3A3.5 3.5 0 0 1 21 6.5c0 2-2 4-4 6l-3-3c2-2 4-4 4-6 0-.83-.67-1.5-1.5-1.5" /></I>; }
function WatercolourIcon() { return <I><path d="M12 2a5 5 0 0 1 5 5c0 5-5 13-5 13S7 12 7 7a5 5 0 0 1 5-5z" /><circle cx="12" cy="7" r="2" fill="currentColor" /></I>; }

// ── Shape icons ───────────────────────────────────────────────────────────────
function RectIcon() { return <I><rect x="3" y="5" width="18" height="14" rx="2" /></I>; }
function CircleShapeIcon() { return <I><circle cx="12" cy="12" r="9" /></I>; }
function TriangleIcon() { return <I><path d="M12 3L22 21H2L12 3z" /></I>; }
function LineIcon() { return <I><line x1="4" y1="20" x2="20" y2="4" /></I>; }
function ArrowIcon() { return <I><line x1="4" y1="20" x2="20" y2="4" /><polyline points="14 4 20 4 20 10" /></I>; }
function DiamondIcon() { return <I><polygon points="12 2 22 12 12 22 2 12" /></I>; }
function StarIcon() { return <I><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26" /></I>; }
function HexagonIcon() { return <I><polygon points="12 2 21 6.5 21 17.5 12 22 3 17.5 3 6.5" /></I>; }

// ── Util icons ────────────────────────────────────────────────────────────────
function EraserIcon() { return <I><path d="M20 20H7L3.5 16.5a2 2 0 0 1 0-2.83l8.17-8.17a2 2 0 0 1 2.83 0l5.66 5.66a2 2 0 0 1 0 2.83L13.5 20" /><path d="M7 20l-4-4" /></I>; }
function UndoIcon() { return <I><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></I>; }
function RedoIcon() { return <I><path d="M15 14l5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></I>; }
