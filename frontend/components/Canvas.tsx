"use client";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import rough from "roughjs";
import type { Point, Stroke, Tool } from "@/lib/types";

// ─── Seeded PRNG (xorshift32) ─────────────────────────────────────────────────
function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); }
  return h >>> 0;
}
function mkRand(seed: number) {
  let s = (seed | 1) >>> 0;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

// ─── Selection helpers ────────────────────────────────────────────────────────
function distToSegment(x: number, y: number, x1: number, y1: number, x2: number, y2: number) {
  const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (l2 === 0) return Math.sqrt((x - x1) ** 2 + (y - y1) ** 2);
  let t = ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.sqrt((x - (x1 + t * (x2 - x1))) ** 2 + (y - (y1 + t * (y2 - y1))) ** 2);
}

function hitTest(stroke: Stroke, x: number, y: number): boolean {
  if (stroke.points.length === 0) return false;
  const points = stroke.points;

  if (
    stroke.tool === "rect" ||
    stroke.tool === "diamond" ||
    stroke.tool === "triangle" ||
    stroke.tool === "star" ||
    stroke.tool === "hexagon" ||
    stroke.tool === "heart"
  ) {
    const p0 = points[0];
    const p1 = points[points.length - 1];
    const minX = Math.min(p0.x, p1.x);
    const maxX = Math.max(p0.x, p1.x);
    const minY = Math.min(p0.y, p1.y);
    const maxY = Math.max(p0.y, p1.y);
    return x >= minX - 8 && x <= maxX + 8 && y >= minY - 8 && y <= maxY + 8;
  }

  if (stroke.tool === "circle") {
    const p0 = points[0];
    const p1 = points[points.length - 1];
    const cx = (p0.x + p1.x) / 2;
    const cy = (p0.y + p1.y) / 2;
    const rx = Math.abs(p1.x - p0.x) / 2;
    const ry = Math.abs(p1.y - p0.y) / 2;
    if (rx === 0 || ry === 0) return false;
    const dx = (x - cx) / rx;
    const dy = (y - cy) / ry;
    return dx * dx + dy * dy <= 1.2;
  }

  if (stroke.tool === "line" || stroke.tool === "arrow") {
    const p0 = points[0];
    const p1 = points[points.length - 1];
    return distToSegment(x, y, p0.x, p0.y, p1.x, p1.y) < 8;
  }

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const dist = Math.sqrt((x - p.x) ** 2 + (y - p.y) ** 2);
    if (dist < Math.max(8, stroke.width * 1.5)) return true;
  }
  return false;
}

function getStrokeBounds(stroke: Stroke) {
  if (stroke.points.length === 0) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  stroke.points.forEach((p) => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  });
  return { minX, maxX, minY, maxY };
}

// ─── Shape tool set ─────────────────────────────────────────────────────────
const SHAPE_TOOLS = new Set(["rect", "circle", "triangle", "line", "arrow", "diamond", "star", "hexagon", "heart"]);

// ─── Infinite dot grid ───────────────────────────────────────────────────────
function drawInfiniteGrid(
  ctx: CanvasRenderingContext2D,
  width: number, height: number,
  zoom: number, panX: number, panY: number
) {
  ctx.save();
  const gridSize = 32;
  const startX = -panX - 100;
  const startY = -panY - 100;
  const endX = startX + width + 200;
  const endY = startY + height + 200;
  const gridStartX = Math.floor(startX / gridSize) * gridSize;
  const gridStartY = Math.floor(startY / gridSize) * gridSize;

  ctx.fillStyle = "rgba(100, 116, 139, 0.16)";
  const dotSize = Math.max(0.8, 1 / zoom);
  for (let x = gridStartX; x < endX; x += gridSize) {
    for (let y = gridStartY; y < endY; y += gridSize) {
      ctx.beginPath();
      ctx.arc(x, y, dotSize, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// ─── Segment rendering ────────────────────────────────────────────────────────
function renderSegment(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  from: Point, to: Point,
  pw: number
) {
  const fx = from.x, fy = from.y;
  const tx = to.x, ty = to.y;
  ctx.save();

  switch (stroke.tool) {
    case "marker": {
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = pw * 3.2;
      ctx.lineCap = "butt"; ctx.lineJoin = "miter";
      ctx.globalAlpha = 0.22;
      ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(tx, ty); ctx.stroke();
      break;
    }
    case "calligraphy": {
      ctx.fillStyle = stroke.color;
      ctx.globalAlpha = 0.92;
      const cdx = tx - fx, cdy = ty - fy;
      const clen = Math.sqrt(cdx * cdx + cdy * cdy);
      const steps = Math.max(1, Math.ceil(clen));
      const angle = Math.PI / 4;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        ctx.beginPath();
        ctx.ellipse(fx + cdx * t, fy + cdy * t, pw * 0.85, pw * 0.16, angle, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "crayon": {
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      for (let pass = 0; pass < 5; pass++) {
        const ox = (Math.random() - 0.5) * pw * 0.55;
        const oy = (Math.random() - 0.5) * pw * 0.55;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = pw * (0.25 + Math.random() * 0.42);
        ctx.globalAlpha = 0.18 + Math.random() * 0.26;
        ctx.beginPath();
        ctx.moveTo(fx + ox, fy + oy); ctx.lineTo(tx + ox, ty + oy); ctx.stroke();
      }
      break;
    }
    case "oil": {
      ctx.lineCap = "round";
      const odx = tx - fx, ody = ty - fy;
      const olen = Math.sqrt(odx * odx + ody * ody) || 1;
      const perpX = -ody / olen, perpY = odx / olen;
      const bristles = 11;
      for (let i = 0; i < bristles; i++) {
        const t = (i / (bristles - 1)) - 0.5;
        const off = t * pw * 0.92;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = Math.max(0.5, pw * 0.11);
        ctx.globalAlpha = 0.3 + Math.random() * 0.38;
        ctx.beginPath();
        ctx.moveTo(fx + perpX * off, fy + perpY * off);
        ctx.lineTo(tx + perpX * off, ty + perpY * off);
        ctx.stroke();
      }
      break;
    }
    case "watercolour": {
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      const spread = pw * 0.55;
      for (let pass = 0; pass < 6; pass++) {
        const ox = (Math.random() - 0.5) * spread;
        const oy = (Math.random() - 0.5) * spread;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = pw * (0.65 + Math.random() * 0.75);
        ctx.globalAlpha = 0.025 + Math.random() * 0.035;
        ctx.beginPath();
        ctx.moveTo(fx + ox, fy + oy); ctx.lineTo(tx + ox, ty + oy); ctx.stroke();
      }
      break;
    }
  }
  ctx.restore();
}

function renderPuff(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke, point: Point, pointIdx: number, pw: number
) {
  const px = point.x, py = point.y;
  ctx.save();

  if (stroke.tool === "spray") {
    const seed = hashStr(stroke.strokeId) ^ (pointIdx * 2654435761);
    const rand = mkRand(seed);
    const radius = pw * 0.92;
    ctx.fillStyle = stroke.color;
    for (let i = 0; i < 30; i++) {
      const angle = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * radius;
      ctx.globalAlpha = rand() * 0.45 + 0.08;
      ctx.beginPath();
      ctx.arc(px + Math.cos(angle) * r, py + Math.sin(angle) * r, rand() * 1.5 + 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    const r = Math.max(0.5, pw / 2);
    if (stroke.tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,1)";
    } else if (stroke.tool === "marker") {
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = stroke.color;
      ctx.globalAlpha = 0.22;
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = stroke.color;
      ctx.globalAlpha = 1;
    }
    ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// ─── Public API ───────────────────────────────────────────────────────────────
export interface CanvasHandle {
  redrawAll: (strokes: Stroke[]) => void;
  applyRemoteStrokeStart: (stroke: Stroke) => void;
  applyRemoteStrokePoint: (strokeId: string, point: Point) => void;
  applyRemoteStrokeEnd: (strokeId: string) => void;
  removeStroke: (strokeId: string) => void;
  addStroke: (stroke: Stroke) => void;
  clearCanvas: () => void;
  updateStroke: (strokeId: string, updates: Partial<Stroke>) => void;
  getStroke: (strokeId: string) => Stroke | undefined;
}

function getSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(31, h) + id.charCodeAt(i) | 0;
  return Math.abs(h) || 1;
}

interface CanvasProps {
  tool: Tool;
  color: string;
  width: number;
  fillStyle: "hachure" | "cross-hatch" | "solid" | "none";
  fillColor: string;
  roughness: number;

  zoom: number;
  panX: number;
  panY: number;
  setPan: (x: number, y: number) => void;
  setZoom?: (z: number) => void;

  onStrokeStart: (s: {
    strokeId: string; color: string; width: number; tool: Tool; point: Point;
    fillStyle?: "hachure" | "cross-hatch" | "solid" | "none";
    fillColor?: string; roughness?: number;
  }) => void;
  onStrokePoint: (strokeId: string, point: Point) => void;
  onStrokeEnd: (strokeId: string, stroke: Stroke) => void;
  onStrokeDelete?: (strokeId: string) => void;
  onCursorMove: (point: Point, metadata?: { brushWidth: number; tool: Tool }) => void;
  disabled?: boolean;
}

const Canvas = forwardRef<CanvasHandle, CanvasProps>(function Canvas(
  {
    tool, color, width,
    fillStyle, fillColor, roughness,
    zoom, panX, panY, setPan, setZoom,
    onStrokeStart, onStrokePoint, onStrokeEnd, onStrokeDelete,
    onCursorMove, disabled,
  },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const historyRef = useRef<Stroke[]>([]);
  const activeRef = useRef<Map<string, Stroke>>(new Map());

  const localStrokeIdRef = useRef<string | null>(null);
  const lastCursorSentRef = useRef(0);
  const pointerActiveRef = useRef(false);
  const sprayIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPointerPosRef = useRef<Point | null>(null);
  const shapeStartRef = useRef<Point | null>(null);

  // Selection state
  const [selectedStrokeId, setSelectedStrokeId] = useState<string | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<Point>({ x: 0, y: 0 });
  const dragStartPointsRef = useRef<Point[]>([]);

  // Panning
  const isPanningRef = useRef(false);
  const panStartRef = useRef<Point>({ x: 0, y: 0 });
  const panOffsetStartRef = useRef<Point>({ x: 0, y: 0 });

  const [spacePressed, setSpacePressed] = useState(false);

  // Local cursor circle
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [cursorVisible, setCursorVisible] = useState(false);

  // Spacebar pan toggle
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === "Space") { e.preventDefault(); setSpacePressed(true); } };
    const up   = (e: KeyboardEvent) => { if (e.code === "Space") setSpacePressed(false); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  // Delete key for selected stroke
  useEffect(() => {
    const onDel = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedStrokeId && tool === "select") {
        onStrokeDelete?.(selectedStrokeId);
        setSelectedStrokeId(null);
      }
    };
    window.addEventListener("keydown", onDel);
    return () => window.removeEventListener("keydown", onDel);
  }, [selectedStrokeId, tool, onStrokeDelete]);

  // Convert client coordinates → virtual canvas coordinates
  const toVirtual = useCallback((cx: number, cy: number): Point => {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return {
      x: (cx - r.left) / zoom - panX,
      y: (cy - r.top)  / zoom - panY,
    };
  }, [zoom, panX, panY]);

  const drawStroke = useCallback((stroke: Stroke) => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;
    const rc = rough.canvas(canvas);

    const options = {
      seed: getSeed(stroke.strokeId),
      stroke: stroke.color,
      strokeWidth: stroke.width,
      fill: stroke.fillStyle && stroke.fillStyle !== "none" ? stroke.fillColor : undefined,
      fillStyle: stroke.fillStyle && stroke.fillStyle !== "none" ? stroke.fillStyle : undefined,
      roughness: stroke.roughness !== undefined ? stroke.roughness : 1.2,
      hachureAngle: 60,
      hachureGap: Math.max(4, stroke.width * 1.5),
    };

    if (stroke.points.length === 0) return;

    if (stroke.tool === "rect") {
      const p0 = stroke.points[0], p1 = stroke.points[stroke.points.length - 1];
      const x = Math.min(p0.x, p1.x), y = Math.min(p0.y, p1.y);
      const w = Math.abs(p1.x - p0.x), h = Math.abs(p1.y - p0.y);
      if (w > 0 && h > 0) rc.rectangle(x, y, w, h, options);
    } else if (stroke.tool === "circle") {
      const p0 = stroke.points[0], p1 = stroke.points[stroke.points.length - 1];
      const cx = (p0.x + p1.x) / 2, cy = (p0.y + p1.y) / 2;
      const rx = Math.abs(p1.x - p0.x) / 2, ry = Math.abs(p1.y - p0.y) / 2;
      if (rx > 0 && ry > 0) rc.ellipse(cx, cy, rx * 2, ry * 2, options);
    } else if (stroke.tool === "triangle") {
      const p0 = stroke.points[0], p1 = stroke.points[stroke.points.length - 1];
      const tx = (p0.x + p1.x) / 2;
      rc.polygon([[tx, p0.y], [p1.x, p1.y], [p0.x, p1.y]], options);
    } else if (stroke.tool === "diamond") {
      const p0 = stroke.points[0], p1 = stroke.points[stroke.points.length - 1];
      const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
      const hw = Math.abs(p1.x - p0.x) / 2, hh = Math.abs(p1.y - p0.y) / 2;
      rc.polygon([[mx, my - hh], [mx + hw, my], [mx, my + hh], [mx - hw, my]], options);
    } else if (stroke.tool === "hexagon") {
      const p0 = stroke.points[0], p1 = stroke.points[stroke.points.length - 1];
      const cx = (p0.x + p1.x) / 2, cy = (p0.y + p1.y) / 2;
      const rx = Math.abs(p1.x - p0.x) / 2, ry = Math.abs(p1.y - p0.y) / 2;
      const verts: [number, number][] = [];
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3 - Math.PI / 2;
        verts.push([cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)]);
      }
      rc.polygon(verts, options);
    } else if (stroke.tool === "star") {
      const p0 = stroke.points[0], p1 = stroke.points[stroke.points.length - 1];
      const cx = (p0.x + p1.x) / 2, cy = (p0.y + p1.y) / 2;
      const rx = Math.abs(p1.x - p0.x) / 2, ry = Math.abs(p1.y - p0.y) / 2;
      const verts: [number, number][] = [];
      const spikes = 5, step = Math.PI / spikes;
      let rot = (Math.PI / 2) * 3;
      for (let i = 0; i < spikes * 2; i++) {
        const r = i % 2 === 0 ? ry : ry * 0.4;
        verts.push([cx + rx * (r / ry) * Math.cos(rot), cy + ry * (r / ry) * Math.sin(rot)]);
        rot += step;
      }
      rc.polygon(verts, options);
    } else if (stroke.tool === "heart") {
      const p0 = stroke.points[0], p1 = stroke.points[stroke.points.length - 1];
      const cx = (p0.x + p1.x) / 2, cy = (p0.y + p1.y) / 2;
      const sw = Math.abs(p1.x - p0.x), sh = Math.abs(p1.y - p0.y);
      const topY = cy - sh / 2, bottomY = cy + sh / 2;
      const leftX = cx - sw / 2, rightX = cx + sw / 2;
      const pathD = `M ${cx} ${cy - sh / 4} C ${cx - sw / 4} ${topY}, ${leftX} ${cy - sh / 4}, ${leftX} ${cy + sh / 8} C ${leftX} ${cy + sh / 2}, ${cx - sw / 4} ${bottomY - sh / 8}, ${cx} ${bottomY} C ${cx + sw / 4} ${bottomY - sh / 8}, ${rightX} ${cy + sh / 2}, ${rightX} ${cy + sh / 8} C ${rightX} ${cy - sh / 4}, ${cx + sw / 4} ${topY}, ${cx} ${cy - sh / 4} Z`;
      rc.path(pathD, options);
    } else if (stroke.tool === "line") {
      const p0 = stroke.points[0], p1 = stroke.points[stroke.points.length - 1];
      rc.line(p0.x, p0.y, p1.x, p1.y, options);
    } else if (stroke.tool === "arrow") {
      const p0 = stroke.points[0], p1 = stroke.points[stroke.points.length - 1];
      rc.line(p0.x, p0.y, p1.x, p1.y, options);
      const dx = p1.x - p0.x, dy = p1.y - p0.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = dx / len, uy = dy / len;
      const headLen = Math.max(10, stroke.width * 3), angle = Math.PI / 6;
      const xL = p1.x - headLen * (ux * Math.cos(angle) - uy * Math.sin(angle));
      const yL = p1.y - headLen * (uy * Math.cos(angle) + ux * Math.sin(angle));
      const xR = p1.x - headLen * (ux * Math.cos(angle) + uy * Math.sin(angle));
      const yR = p1.y - headLen * (uy * Math.cos(angle) - ux * Math.sin(angle));
      rc.line(p1.x, p1.y, xL, yL, options);
      rc.line(p1.x, p1.y, xR, yR, options);
    } else if (stroke.tool === "eraser") {
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
      ctx.lineWidth = stroke.width;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      ctx.stroke();
      ctx.restore();
    } else {
      // Freehand drawing tools — pen/pencil/marker use plain smooth canvas (no roughjs) to avoid shaking
      if (stroke.points.length === 1) {
        ctx.save();
        ctx.fillStyle = stroke.color;
        if (stroke.tool === "marker") ctx.globalAlpha = 0.22;
        ctx.beginPath();
        ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.width / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else {
        if (stroke.tool === "pen" || stroke.tool === "pencil" || stroke.tool === "marker") {
          ctx.save();
          ctx.strokeStyle = stroke.color;
          ctx.lineWidth = stroke.tool === "marker" ? stroke.width * 3.2 : stroke.width;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          if (stroke.tool === "marker") ctx.globalAlpha = 0.22;
          else if (stroke.tool === "pencil") ctx.globalAlpha = 0.85;
          ctx.beginPath();
          ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
          // Smooth bezier through points
          for (let i = 1; i < stroke.points.length - 1; i++) {
            const mx = (stroke.points[i].x + stroke.points[i + 1].x) / 2;
            const my = (stroke.points[i].y + stroke.points[i + 1].y) / 2;
            ctx.quadraticCurveTo(stroke.points[i].x, stroke.points[i].y, mx, my);
          }
          const last = stroke.points[stroke.points.length - 1];
          ctx.lineTo(last.x, last.y);
          ctx.stroke();
          ctx.restore();
        } else {
          ctx.save();
          for (let i = 1; i < stroke.points.length; i++) {
            renderSegment(ctx, stroke, stroke.points[i - 1], stroke.points[i], stroke.width);
          }
          ctx.restore();
        }
      }
    }
  }, []);

  const redrawAll = useCallback((strokes: Stroke[]) => {
    const ctx = ctxRef.current;
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const dpr = window.devicePixelRatio || 1;
    ctx.scale(dpr * zoom, dpr * zoom);
    ctx.translate(panX, panY);

    drawInfiniteGrid(ctx, canvas.width / (dpr * zoom), canvas.height / (dpr * zoom), zoom, panX, panY);

    historyRef.current = strokes;
    strokes.forEach(drawStroke);
    Array.from(activeRef.current.values()).forEach(drawStroke);

    // Selection bounding box
    if (tool === "select" && selectedStrokeId) {
      const selStroke = strokes.find((s) => s.strokeId === selectedStrokeId);
      if (selStroke) {
        const bounds = getStrokeBounds(selStroke);
        if (bounds) {
          ctx.save();
          ctx.strokeStyle = "var(--accent)";
          ctx.lineWidth = 1.5 / zoom;
          ctx.setLineDash([5, 5]);
          ctx.strokeRect(bounds.minX - 6, bounds.minY - 6, bounds.maxX - bounds.minX + 12, bounds.maxY - bounds.minY + 12);
          ctx.fillStyle = "var(--surface)";
          ctx.strokeStyle = "var(--accent)";
          ctx.lineWidth = 1.5 / zoom;
          ctx.setLineDash([]);
          const size = 6 / zoom;
          [
            { x: bounds.minX - 6, y: bounds.minY - 6 },
            { x: bounds.maxX + 6, y: bounds.minY - 6 },
            { x: bounds.minX - 6, y: bounds.maxY + 6 },
            { x: bounds.maxX + 6, y: bounds.maxY + 6 },
          ].forEach((c) => {
            ctx.fillRect(c.x - size / 2, c.y - size / 2, size, size);
            ctx.strokeRect(c.x - size / 2, c.y - size / 2, size, size);
          });
          ctx.restore();
        }
      }
    }
    ctx.restore();
  }, [drawStroke, zoom, panX, panY, selectedStrokeId, tool]);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width  = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    canvas.style.width  = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const ctx = canvas.getContext("2d");
    if (ctx) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctxRef.current = ctx; }
    redrawAll(historyRef.current);
  }, [redrawAll]);

  useEffect(() => {
    resizeCanvas();
    const obs = new ResizeObserver(() => resizeCanvas());
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [resizeCanvas]);

  useEffect(() => {
    redrawAll(historyRef.current);
  }, [zoom, panX, panY, selectedStrokeId, tool, redrawAll]);

  // Wheel-to-zoom (zoom centered on cursor position)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.08 : 0.93;
      const newZoom = Math.min(4, Math.max(0.2, zoom * factor));
      if (newZoom === zoom) return;
      const r = canvas.getBoundingClientRect();
      const mouseX = e.clientX - r.left;
      const mouseY = e.clientY - r.top;
      // Adjust pan so the point under the cursor stays fixed
      const newPanX = mouseX / newZoom - mouseX / zoom + panX;
      const newPanY = mouseY / newZoom - mouseY / zoom + panY;
      setPan(newPanX, newPanY);
      setZoom?.(newZoom);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, panX, panY, setZoom]);

  useImperativeHandle(ref, () => ({
    redrawAll,
    applyRemoteStrokeStart: (stroke) => {
      activeRef.current.set(stroke.strokeId, { ...stroke, points: [...stroke.points] });
      redrawAll(historyRef.current);
    },
    applyRemoteStrokePoint: (strokeId, point) => {
      const stroke = activeRef.current.get(strokeId);
      if (stroke) { stroke.points.push(point); redrawAll(historyRef.current); }
    },
    applyRemoteStrokeEnd: (strokeId) => {
      const stroke = activeRef.current.get(strokeId);
      if (stroke) {
        historyRef.current = [...historyRef.current, stroke];
        activeRef.current.delete(strokeId);
        redrawAll(historyRef.current);
      }
    },
    removeStroke: (strokeId) => {
      historyRef.current = historyRef.current.filter((s) => s.strokeId !== strokeId);
      redrawAll(historyRef.current);
    },
    addStroke: (stroke) => {
      historyRef.current = [...historyRef.current, stroke];
      redrawAll(historyRef.current);
    },
    clearCanvas: () => {
      historyRef.current = [];
      activeRef.current.clear();
      redrawAll([]);
    },
    updateStroke: (strokeId, updates) => {
      const idx = historyRef.current.findIndex((s) => s.strokeId === strokeId);
      if (idx !== -1) {
        historyRef.current[idx] = { ...historyRef.current[idx], ...updates };
        redrawAll(historyRef.current);
      }
    },
    getStroke: (strokeId) => historyRef.current.find((s) => s.strokeId === strokeId),
  }), [redrawAll]);

  // Spray interval
  const startSprayInterval = useCallback((strokeId: string) => {
    if (sprayIntervalRef.current) clearInterval(sprayIntervalRef.current);
    sprayIntervalRef.current = setInterval(() => {
      const pos = lastPointerPosRef.current;
      if (!pos || !pointerActiveRef.current) return;
      const stroke = activeRef.current.get(strokeId);
      if (!stroke) return;
      stroke.points.push(pos);
      redrawAll(historyRef.current);
      onStrokePoint(strokeId, pos);
    }, 40);
  }, [onStrokePoint, redrawAll]);

  const stopSprayInterval = () => {
    if (sprayIntervalRef.current) { clearInterval(sprayIntervalRef.current); sprayIntervalRef.current = null; }
  };

  // ── Pointer handlers ──────────────────────────────────────────────────────
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    const point = toVirtual(e.clientX, e.clientY);
    lastPointerPosRef.current = point;

    // Hand tool or space-pan or middle-click
    if (tool === "hand" || spacePressed || e.button === 1) {
      isPanningRef.current = true;
      panStartRef.current = { x: e.clientX, y: e.clientY };
      panOffsetStartRef.current = { x: panX, y: panY };
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
      return;
    }

    // Select tool
    if (tool === "select") {
      const hitIdx = [...historyRef.current].reverse().findIndex((s) => hitTest(s, point.x, point.y));
      if (hitIdx !== -1) {
        const realIdx = historyRef.current.length - 1 - hitIdx;
        const clicked = historyRef.current[realIdx];
        setSelectedStrokeId(clicked.strokeId);
        isDraggingRef.current = true;
        dragStartRef.current = point;
        dragStartPointsRef.current = clicked.points.map((p) => ({ ...p }));
      } else {
        setSelectedStrokeId(null);
      }
      redrawAll(historyRef.current);
      return;
    }

    // Drawing
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    pointerActiveRef.current = true;
    const strokeId = crypto.randomUUID();
    localStrokeIdRef.current = strokeId;

    const stroke: Stroke = {
      strokeId, color, width, tool, points: [point],
      fillStyle, fillColor, roughness,
    };
    activeRef.current.set(strokeId, stroke);

    if (SHAPE_TOOLS.has(tool)) {
      shapeStartRef.current = point;
    } else {
      const ctx = ctxRef.current;
      if (ctx) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const dpr = window.devicePixelRatio || 1;
        ctx.scale(dpr * zoom, dpr * zoom);
        ctx.translate(panX, panY);
        renderPuff(ctx, stroke, point, 0, width);
        ctx.restore();
      }
    }

    onStrokeStart({ strokeId, color, width, tool, point, fillStyle, fillColor, roughness });
    if (tool === "spray") startSprayInterval(strokeId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const point = toVirtual(e.clientX, e.clientY);
    lastPointerPosRef.current = point;

    // Update local cursor circle position (screen coords)
    const canvas = canvasRef.current;
    if (canvas) {
      const r = canvas.getBoundingClientRect();
      setCursorPos({ x: e.clientX - r.left, y: e.clientY - r.top });
    }

    // Throttled cursor broadcast
    const now = performance.now();
    if (now - lastCursorSentRef.current >= 50) {
      lastCursorSentRef.current = now;
      onCursorMove(point, { brushWidth: width, tool });
    }

    // Panning
    if (isPanningRef.current) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setPan(panOffsetStartRef.current.x + dx / zoom, panOffsetStartRef.current.y + dy / zoom);
      return;
    }

    // Drag selected shape
    if (isDraggingRef.current && selectedStrokeId) {
      const clicked = historyRef.current.find((s) => s.strokeId === selectedStrokeId);
      if (clicked) {
        const dx = point.x - dragStartRef.current.x;
        const dy = point.y - dragStartRef.current.y;
        clicked.points = dragStartPointsRef.current.map((p) => ({ x: p.x + dx, y: p.y + dy }));
        redrawAll(historyRef.current);
      }
      return;
    }

    if (!pointerActiveRef.current || disabled) return;
    const strokeId = localStrokeIdRef.current;
    if (!strokeId) return;
    const stroke = activeRef.current.get(strokeId);
    if (!stroke) return;

    if (SHAPE_TOOLS.has(tool)) {
      stroke.points = [stroke.points[0], point];
      redrawAll(historyRef.current);
      onStrokePoint(strokeId, point);
      return;
    }

    if (tool === "spray") return;

    const prev = stroke.points[stroke.points.length - 1];
    if (prev) {
      const ddx = point.x - prev.x;
      const ddy = point.y - prev.y;
      if (ddx * ddx + ddy * ddy < 1.5) return;
    }

    const ctx = ctxRef.current;
    if (ctx) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const dpr = window.devicePixelRatio || 1;
      ctx.scale(dpr * zoom, dpr * zoom);
      ctx.translate(panX, panY);
      if (prev) {
        if (tool === "pen" || tool === "pencil" || tool === "marker" || tool === "eraser") {
          if (tool === "eraser") {
            ctx.globalCompositeOperation = "destination-out";
            ctx.strokeStyle = "rgba(0,0,0,1)";
            ctx.lineWidth = stroke.width;
          } else {
            ctx.globalCompositeOperation = "source-over";
            ctx.strokeStyle = stroke.color;
            ctx.lineWidth = tool === "marker" ? stroke.width * 3.2 : stroke.width;
            if (tool === "marker") ctx.globalAlpha = 0.22;
            else if (tool === "pencil") ctx.globalAlpha = 0.85;
          }
          ctx.lineCap = "round"; ctx.lineJoin = "round";
          ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(point.x, point.y); ctx.stroke();
        } else {
          renderSegment(ctx, stroke, prev, point, stroke.width);
        }
      }
      ctx.restore();
    }
    stroke.points.push(point);
    onStrokePoint(strokeId, point);
  };

  const endStroke = () => {
    if (isPanningRef.current) { isPanningRef.current = false; return; }

    if (isDraggingRef.current && selectedStrokeId) {
      isDraggingRef.current = false;
      const clicked = historyRef.current.find((s) => s.strokeId === selectedStrokeId);
      if (clicked) {
        onStrokeDelete?.(selectedStrokeId);
        onStrokeEnd(selectedStrokeId, clicked);
      }
      return;
    }

    if (!pointerActiveRef.current) return;
    pointerActiveRef.current = false;
    stopSprayInterval();
    const strokeId = localStrokeIdRef.current;
    localStrokeIdRef.current = null;
    shapeStartRef.current = null;
    if (!strokeId) return;
    const stroke = activeRef.current.get(strokeId);
    if (stroke) {
      historyRef.current = [...historyRef.current, stroke];
      activeRef.current.delete(strokeId);
      onStrokeEnd(strokeId, stroke);
    }
  };

  // Cursor appearance — size in screen pixels = brush width (virtual) * zoom
  const cursorDiam = Math.max(4, width * zoom);
  const isEraser = tool === "eraser";
  const isShape = SHAPE_TOOLS.has(tool);
  const isPanningCursor = tool === "hand" || spacePressed;

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full overflow-hidden ${
        isPanningCursor ? "cursor-grab active:cursor-grabbing" : tool === "select" ? "cursor-default" : "cursor-none"
      }`}
      onMouseLeave={() => setCursorPos(null)}
    >
      <canvas
        ref={canvasRef}
        className="h-full w-full touch-none bg-paper"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endStroke}
        onPointerLeave={endStroke}
        onPointerCancel={endStroke}
      />

      {/* Local circle cursor — no CSS transition so it tracks the pointer exactly */}
      {cursorPos && !isPanningCursor && tool !== "select" && (
        <div
          className="pointer-events-none absolute rounded-full"
          style={{
            left: cursorPos.x,
            top: cursorPos.y,
            width: cursorDiam,
            height: cursorDiam,
            transform: "translate(-50%, -50%)",
            border: isEraser ? "2px dashed rgba(100,116,139,0.8)" : `2px solid ${color}`,
            backgroundColor: isEraser || isShape ? "transparent" : `${color}22`,
            boxShadow: isEraser ? "none" : `0 0 0 1px rgba(0,0,0,0.15)`,
            zIndex: 50,
          }}
        />
      )}
    </div>
  );
});

export default Canvas;
