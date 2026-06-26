"use client";

import type { CursorState } from "@/lib/types";

interface CursorLayerProps {
  cursors: CursorState[];
  zoom: number;
  panX: number;
  panY: number;
}

export default function CursorLayer({ cursors, zoom, panX, panY }: CursorLayerProps) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {cursors.map((c) => {
        const hasBrush = c.tool && c.brushWidth !== undefined;
        const cursorDiam = hasBrush ? Math.max(4, Math.min(c.brushWidth || 6, 60)) : 0;
        const isEraser = c.tool === "eraser";
        const isShape = c.tool && ["rect", "circle", "triangle", "line", "arrow", "diamond", "star", "hexagon", "heart"].includes(c.tool);

        // Convert virtual canvas coordinates to screen coordinates using zoom/pan
        const screenX = (c.x + panX) * zoom;
        const screenY = (c.y + panY) * zoom;

        return (
          <div
            key={c.id}
            className="absolute transition-[left,top] duration-75 ease-linear"
            style={{ left: `${screenX}px`, top: `${screenY}px` }}
          >
            {/* Brush circle outline centered at cursor */}
            {hasBrush && cursorDiam > 0 && (
              <div
                className="absolute rounded-full"
                style={{
                  width: cursorDiam * zoom,
                  height: cursorDiam * zoom,
                  left: 0,
                  top: 0,
                  transform: "translate(-50%, -50%)",
                  border: isEraser
                    ? "1.5px dashed rgba(100,116,139,0.7)"
                    : `1.5px solid ${c.color}`,
                  backgroundColor: isEraser || isShape
                    ? "transparent"
                    : `${c.color}15`,
                  pointerEvents: "none",
                }}
              />
            )}

            {/* Arrow pointer + name tag */}
            <div className="absolute left-0 top-0 flex items-center">
              <svg width="18" height="18" viewBox="0 0 20 20" className="drop-shadow-sm">
                <path
                  d="M2 2l6.5 16 2.2-6.8L17.5 9 2 2z"
                  fill={c.color}
                  stroke="white"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
              <span
                className="ml-2 inline-block whitespace-nowrap rounded-md px-1.5 py-0.5 font-mono text-[9px] font-semibold text-white shadow-sm"
                style={{ backgroundColor: c.color }}
              >
                {c.name}{hasBrush && c.brushWidth ? ` (${c.brushWidth}px)` : ""}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
