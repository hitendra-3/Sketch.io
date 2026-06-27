"use client";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import rough from "roughjs";
import type { Point, Stroke, StrokeMask, Tool } from "@/lib/types";

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
  if (stroke.tool === "eraser") return false;
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

function hitTestWithEraser(stroke: Stroke, x: number, y: number, eraserWidth: number): boolean {
  if (stroke.tool === "eraser") return false;
  if (stroke.points.length === 0) return false;
  const points = stroke.points;
  const threshold = Math.max(12, (stroke.width + eraserWidth) / 2 + 4);

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
    return x >= minX - threshold && x <= maxX + threshold && y >= minY - threshold && y <= maxY + threshold;
  }

  if (stroke.tool === "circle") {
    const p0 = points[0];
    const p1 = points[points.length - 1];
    const cx = (p0.x + p1.x) / 2;
    const cy = (p0.y + p1.y) / 2;
    const rx = Math.abs(p1.x - p0.x) / 2;
    const ry = Math.abs(p1.y - p0.y) / 2;
    if (rx === 0 || ry === 0) return false;
    const dx = (x - cx) / (rx + threshold);
    const dy = (y - cy) / (ry + threshold);
    return dx * dx + dy * dy <= 1.0;
  }

  if (stroke.tool === "line" || stroke.tool === "arrow") {
    const p0 = points[0];
    const p1 = points[points.length - 1];
    return distToSegment(x, y, p0.x, p0.y, p1.x, p1.y) < threshold;
  }

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    let dist = Infinity;
    if (i > 0) {
      dist = distToSegment(x, y, points[i - 1].x, points[i - 1].y, p.x, p.y);
    } else {
      dist = Math.sqrt((x - p.x) ** 2 + (y - p.y) ** 2);
    }
    if (dist < threshold) return true;
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

// ─── Draw a single complete stroke onto a given context ───────────────────────
function getSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(31, h) + id.charCodeAt(i) | 0;
  return Math.abs(h) || 1;
}

function drawStrokeOnCtx(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, stroke: Stroke) {
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
    // Freehand drawing tools
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

  // Apply masks
  if (stroke.masks && stroke.masks.length > 0) {
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "rgba(0,0,0,1)";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    stroke.masks.forEach((mask) => {
      ctx.lineWidth = mask.width;
      ctx.beginPath();
      if (mask.points.length > 0) {
        ctx.moveTo(mask.points[0].x, mask.points[0].y);
        for (let i = 1; i < mask.points.length; i++) {
          ctx.lineTo(mask.points[i].x, mask.points[i].y);
        }
        ctx.stroke();
      }
    });
    ctx.restore();
  }
}

// ─── Paint a single incremental freehand segment onto a context ───────────────
// For shapes, spray, and eraser the caller handles rendering; those return false.
function paintIncrementalSegment(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  prev: Point,
  curr: Point,
  zoom: number, panX: number, panY: number,
  dpr: number
): boolean {
  // These tools need special handling by the caller
  if (SHAPE_TOOLS.has(stroke.tool) || stroke.tool === "spray" || stroke.tool === "eraser") return false;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr * zoom, dpr * zoom);
  ctx.translate(panX, panY);

  if (stroke.tool === "pen" || stroke.tool === "pencil" || stroke.tool === "marker") {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.tool === "marker" ? stroke.width * 3.2 : stroke.width;
    if (stroke.tool === "marker") ctx.globalAlpha = 0.22;
    else if (stroke.tool === "pencil") ctx.globalAlpha = 0.85;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(curr.x, curr.y); ctx.stroke();
  } else {
    renderSegment(ctx, stroke, prev, curr, stroke.width);
  }

  ctx.restore();
  return true;
}

// ─── Paint an eraser segment directly onto the history canvas ─────────────────
function paintEraserSegmentOnHistory(
  histCtx: CanvasRenderingContext2D,
  prev: Point, curr: Point,
  width: number,
  zoom: number, panX: number, panY: number,
  dpr: number
) {
  histCtx.save();
  histCtx.setTransform(1, 0, 0, 1, 0, 0);
  histCtx.scale(dpr * zoom, dpr * zoom);
  histCtx.translate(panX, panY);
  histCtx.globalCompositeOperation = "destination-out";
  histCtx.strokeStyle = "rgba(0,0,0,1)";
  histCtx.lineWidth = width;
  histCtx.lineCap = "round"; histCtx.lineJoin = "round";
  histCtx.beginPath(); histCtx.moveTo(prev.x, prev.y); histCtx.lineTo(curr.x, curr.y); histCtx.stroke();
  histCtx.restore();
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
  onStrokeUpdate?: (stroke: Stroke) => void;
  onCursorMove: (point: Point, metadata?: { brushWidth: number; tool: Tool }) => void;
  disabled?: boolean;
}

const Canvas = forwardRef<CanvasHandle, CanvasProps>(function Canvas(
  {
    tool, color, width,
    fillStyle, fillColor, roughness,
    zoom, panX, panY, setPan, setZoom,
    onStrokeStart, onStrokePoint, onStrokeEnd, onStrokeDelete, onStrokeUpdate,
    onCursorMove, disabled,
  },
  ref
) {
  // ─── Three canvas layers ──────────────────────────────────────────────────
  // Layer 0 (bgCanvas):     Dot grid — only redrawn on zoom/pan
  // Layer 1 (histCanvas):   Completed stroke history — redrawn when strokes commit/remove
  // Layer 2 (activeCanvas): In-progress strokes — cheap per-point incremental paint
  const bgCanvasRef    = useRef<HTMLCanvasElement | null>(null);
  const histCanvasRef  = useRef<HTMLCanvasElement | null>(null);
  const activeCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const bgCtxRef      = useRef<CanvasRenderingContext2D | null>(null);
  const histCtxRef    = useRef<CanvasRenderingContext2D | null>(null);
  const activeCtxRef  = useRef<CanvasRenderingContext2D | null>(null);

  // The interaction canvas (active) also receives pointer events
  const containerRef  = useRef<HTMLDivElement | null>(null);

  const historyRef   = useRef<Stroke[]>([]);
  const activeRef    = useRef<Map<string, Stroke>>(new Map());

  const localStrokeIdRef   = useRef<string | null>(null);
  const lastCursorSentRef  = useRef(0);
  const pointerActiveRef   = useRef(false);
  const sprayIntervalRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPointerPosRef  = useRef<Point | null>(null);
  const shapeStartRef      = useRef<Point | null>(null);

  // Zoom/pan refs for use inside callbacks without stale closure
  const zoomRef  = useRef(zoom);
  const panXRef  = useRef(panX);
  const panYRef  = useRef(panY);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panXRef.current = panX; }, [panX]);
  useEffect(() => { panYRef.current = panY; }, [panY]);

  // Selection state
  const [selectedStrokeId, setSelectedStrokeId] = useState<string | null>(null);
  const isDraggingRef    = useRef(false);
  const dragStartRef     = useRef<Point>({ x: 0, y: 0 });
  const dragStartPointsRef = useRef<Point[]>([]);
  const dragStartMasksRef  = useRef<StrokeMask[]>([]);

  // Panning
  const isPanningRef       = useRef(false);
  const panStartRef        = useRef<Point>({ x: 0, y: 0 });
  const panOffsetStartRef  = useRef<Point>({ x: 0, y: 0 });

  const [spacePressed, setSpacePressed] = useState(false);

  // Local cursor circle
  const [cursorPos, setCursorPos]       = useState<{ x: number; y: number } | null>(null);
  const [cursorVisible, setCursorVisible] = useState(false);

  // Spacebar pan toggle
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === "Space") { e.preventDefault(); setSpacePressed(true); } };
    const up   = (e: KeyboardEvent) => { if (e.code === "Space") setSpacePressed(false); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  // Convert client coordinates → virtual canvas coordinates
  const toVirtual = useCallback((cx: number, cy: number): Point => {
    const c = activeCanvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return {
      x: (cx - r.left) / zoom - panX,
      y: (cy - r.top)  / zoom - panY,
    };
  }, [zoom, panX, panY]);

  // ─── Helpers to apply transform to a context ──────────────────────────────
  const applyTransform = useCallback((ctx: CanvasRenderingContext2D) => {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr * zoom, dpr * zoom);
    ctx.translate(panX, panY);
  }, [zoom, panX, panY]);

  // ─── Redraw background grid ───────────────────────────────────────────────
  const redrawGrid = useCallback(() => {
    const bgCtx = bgCtxRef.current;
    const bgCanvas = bgCanvasRef.current;
    if (!bgCtx || !bgCanvas) return;
    const dpr = window.devicePixelRatio || 1;
    bgCtx.save();
    bgCtx.setTransform(1, 0, 0, 1, 0, 0);
    bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
    bgCtx.scale(dpr * zoom, dpr * zoom);
    bgCtx.translate(panX, panY);
    drawInfiniteGrid(bgCtx, bgCanvas.width / (dpr * zoom), bgCanvas.height / (dpr * zoom), zoom, panX, panY);
    bgCtx.restore();
  }, [zoom, panX, panY]);

  // ─── Redraw history canvas (completed strokes) ────────────────────────────
  const redrawHistory = useCallback((strokes: Stroke[]) => {
    const ctx = histCtxRef.current;
    const canvas = histCanvasRef.current;
    if (!ctx || !canvas) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    applyTransform(ctx);
    strokes.forEach((s) => drawStrokeOnCtx(ctx, canvas, s));
    ctx.restore();
  }, [applyTransform]);

  // ─── Redraw active canvas (in-progress strokes only) ─────────────────────
  const redrawActive = useCallback(() => {
    const ctx = activeCtxRef.current;
    const canvas = activeCanvasRef.current;
    if (!ctx || !canvas) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    applyTransform(ctx);
    activeRef.current.forEach((stroke) => drawStrokeOnCtx(ctx, canvas, stroke));
    ctx.restore();
  }, [applyTransform]);

  // ─── Full redraw (all layers) — called on zoom/pan/init/undo ─────────────
  const redrawAll = useCallback((strokes: Stroke[]) => {
    historyRef.current = strokes;
    redrawGrid();
    redrawHistory(strokes);
    redrawActive();

    // Selection overlay on history canvas (harmless extra draw)
    const ctx = histCtxRef.current;
    const canvas = histCanvasRef.current;
    if (ctx && canvas && tool === "select" && selectedStrokeId) {
      const selStroke = strokes.find((s) => s.strokeId === selectedStrokeId);
      if (selStroke) {
        const bounds = getStrokeBounds(selStroke);
        if (bounds) {
          ctx.save();
          applyTransform(ctx);
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
  }, [redrawGrid, redrawHistory, redrawActive, applyTransform, tool, selectedStrokeId, zoom]);

  // ─── Canvas resize ────────────────────────────────────────────────────────
  const resizeCanvas = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const dpr  = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width  * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    const ws = `${rect.width}px`;
    const hs = `${rect.height}px`;

    const resizeOne = (
      canvasRef: React.RefObject<HTMLCanvasElement | null>,
      ctxRef: React.MutableRefObject<CanvasRenderingContext2D | null>
    ) => {
      const c = canvasRef.current;
      if (!c) return;
      c.width  = w; c.height = h;
      c.style.width  = ws; c.style.height = hs;
      const ctx = c.getContext("2d");
      if (ctx) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctxRef.current = ctx; }
    };

    resizeOne(bgCanvasRef,     bgCtxRef);
    resizeOne(histCanvasRef,   histCtxRef);
    resizeOne(activeCanvasRef, activeCtxRef);

    redrawAll(historyRef.current);
  }, [redrawAll]);

  const deleteStrokeLocal = useCallback((strokeId: string) => {
    historyRef.current = historyRef.current.filter((s) => s.strokeId !== strokeId);
    redrawHistory(historyRef.current);
    onStrokeDelete?.(strokeId);
  }, [onStrokeDelete, redrawHistory]);

  // Delete key for selected stroke
  useEffect(() => {
    const onDel = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedStrokeId && tool === "select") {
        deleteStrokeLocal(selectedStrokeId);
        setSelectedStrokeId(null);
      }
    };
    window.addEventListener("keydown", onDel);
    return () => window.removeEventListener("keydown", onDel);
  }, [selectedStrokeId, tool, deleteStrokeLocal]);

  useEffect(() => {
    resizeCanvas();
    const obs = new ResizeObserver(() => resizeCanvas());
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [resizeCanvas]);

  // On zoom/pan/select changes, redraw all layers
  useEffect(() => {
    redrawAll(historyRef.current);
  }, [zoom, panX, panY, selectedStrokeId, tool, redrawAll]);

  // Wheel-to-zoom (zoom centered on cursor position)
  useEffect(() => {
    const canvas = activeCanvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.08 : 0.93;
      const newZoom = Math.min(4, Math.max(0.2, zoom * factor));
      if (newZoom === zoom) return;
      const r = canvas.getBoundingClientRect();
      const mouseX = e.clientX - r.left;
      const mouseY = e.clientY - r.top;
      const newPanX = mouseX / newZoom - mouseX / zoom + panX;
      const newPanY = mouseY / newZoom - mouseY / zoom + panY;
      setPan(newPanX, newPanY);
      setZoom?.(newZoom);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, panX, panY, setZoom]);

  // ─── Imperative API ───────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    redrawAll,

    applyRemoteStrokeStart: (stroke) => {
      // Add to active map and paint puff/initial point on active canvas
      const s = { ...stroke, points: [...stroke.points] };
      activeRef.current.set(s.strokeId, s);

      // Eraser: no dot puff on start (destination-out on transparent active canvas = no-op)
      if (s.tool === "eraser" || SHAPE_TOOLS.has(s.tool) || s.tool === "spray") return;

      const ctx = activeCtxRef.current;
      const canvas = activeCanvasRef.current;
      if (!ctx || !canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const z = zoomRef.current, px = panXRef.current, py = panYRef.current;
      if (s.points.length > 0) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr * z, dpr * z);
        ctx.translate(px, py);
        renderPuff(ctx, s, s.points[0], 0, s.width);
        ctx.restore();
      }
    },

    applyRemoteStrokePoint: (strokeId, point) => {
      const stroke = activeRef.current.get(strokeId);
      if (!stroke) return;

      const prev = stroke.points[stroke.points.length - 1];
      stroke.points.push(point);

      const dpr = window.devicePixelRatio || 1;
      const z = zoomRef.current, px = panXRef.current, py = panYRef.current;

      if (stroke.tool === "eraser") {
        // Eraser paints directly on history canvas (active canvas is transparent — no-op there)
        const histCtx = histCtxRef.current;
        if (histCtx && prev) {
          paintEraserSegmentOnHistory(histCtx, prev, point, stroke.width, z, px, py, dpr);
        }
        return;
      }

      const ctx = activeCtxRef.current;
      const canvas = activeCanvasRef.current;
      if (!ctx || !canvas) return;

      if (SHAPE_TOOLS.has(stroke.tool)) {
        // For shapes, only update the last point then repaint active canvas
        // (active canvas only has in-progress strokes — cheap)
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.scale(dpr * z, dpr * z);
        ctx.translate(px, py);
        activeRef.current.forEach((s) => drawStrokeOnCtx(ctx, canvas, s));
        ctx.restore();
      } else if (prev) {
        // Freehand: paint only the new segment — zero history touched
        paintIncrementalSegment(ctx, stroke, prev, point, z, px, py, dpr);
      }
    },

    applyRemoteStrokeEnd: (strokeId) => {
      const stroke = activeRef.current.get(strokeId);
      if (!stroke) return;

      activeRef.current.delete(strokeId);

      if (stroke.tool === "eraser") {
        // Apply mask logic to history strokes (same as local eraser end)
        historyRef.current.forEach((existingStroke) => {
          const intersects = stroke.points.some((p) => hitTestWithEraser(existingStroke, p.x, p.y, stroke.width));
          if (intersects) {
            if (!existingStroke.masks) existingStroke.masks = [];
            existingStroke.masks.push({
              width: stroke.width,
              points: stroke.points.map((p) => ({ x: p.x, y: p.y })),
            });
          }
        });
        // Redraw history cleanly with masks applied (erases the live preview dirt)
        redrawHistory(historyRef.current);
        return;
      }

      // Non-eraser: move stroke from active → history
      historyRef.current = [...historyRef.current, stroke];

      // 2. Composite stroke onto history canvas (no full clear)
      const histCtx = histCtxRef.current;
      const histCanvas = histCanvasRef.current;
      if (histCtx && histCanvas) {
        const dpr = window.devicePixelRatio || 1;
        const z = zoomRef.current, px = panXRef.current, py = panYRef.current;
        histCtx.save();
        histCtx.setTransform(1, 0, 0, 1, 0, 0);
        histCtx.scale(dpr * z, dpr * z);
        histCtx.translate(px, py);
        drawStrokeOnCtx(histCtx, histCanvas, stroke);
        histCtx.restore();
      }

      // 3. Repaint active canvas without this stroke (typically just remaining active strokes)
      const activeCtx = activeCtxRef.current;
      const activeCanvas = activeCanvasRef.current;
      if (activeCtx && activeCanvas) {
        const dpr = window.devicePixelRatio || 1;
        const z = zoomRef.current, px = panXRef.current, py = panYRef.current;
        activeCtx.save();
        activeCtx.setTransform(1, 0, 0, 1, 0, 0);
        activeCtx.clearRect(0, 0, activeCanvas.width, activeCanvas.height);
        activeCtx.scale(dpr * z, dpr * z);
        activeCtx.translate(px, py);
        activeRef.current.forEach((s) => drawStrokeOnCtx(activeCtx, activeCanvas, s));
        activeCtx.restore();
      }
    },

    removeStroke: (strokeId) => {
      historyRef.current = historyRef.current.filter((s) => s.strokeId !== strokeId);
      redrawHistory(historyRef.current);
    },

    addStroke: (stroke) => {
      historyRef.current = [...historyRef.current, stroke];
      // Composite onto history canvas directly
      const ctx = histCtxRef.current;
      const canvas = histCanvasRef.current;
      if (ctx && canvas) {
        const dpr = window.devicePixelRatio || 1;
        const z = zoomRef.current, px = panXRef.current, py = panYRef.current;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr * z, dpr * z);
        ctx.translate(px, py);
        drawStrokeOnCtx(ctx, canvas, stroke);
        ctx.restore();
      }
    },

    clearCanvas: () => {
      historyRef.current = [];
      activeRef.current.clear();
      histCtxRef.current?.clearRect(0, 0, histCanvasRef.current?.width ?? 0, histCanvasRef.current?.height ?? 0);
      activeCtxRef.current?.clearRect(0, 0, activeCanvasRef.current?.width ?? 0, activeCanvasRef.current?.height ?? 0);
    },

    updateStroke: (strokeId, updates) => {
      const idx = historyRef.current.findIndex((s) => s.strokeId === strokeId);
      if (idx !== -1) {
        historyRef.current[idx] = { ...historyRef.current[idx], ...updates };
        redrawHistory(historyRef.current);
      }
    },

    getStroke: (strokeId) => historyRef.current.find((s) => s.strokeId === strokeId),
  }), [redrawAll, redrawHistory]);

  // Spray interval
  const startSprayInterval = useCallback((strokeId: string) => {
    if (sprayIntervalRef.current) clearInterval(sprayIntervalRef.current);
    sprayIntervalRef.current = setInterval(() => {
      const pos = lastPointerPosRef.current;
      if (!pos || !pointerActiveRef.current) return;
      const stroke = activeRef.current.get(strokeId);
      if (!stroke) return;
      const pointIdx = stroke.points.length;
      stroke.points.push(pos);

      // Paint puff directly on active canvas
      const ctx = activeCtxRef.current;
      const canvas = activeCanvasRef.current;
      if (ctx && canvas) {
        const dpr = window.devicePixelRatio || 1;
        const z = zoomRef.current, px = panXRef.current, py = panYRef.current;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr * z, dpr * z);
        ctx.translate(px, py);
        renderPuff(ctx, stroke, pos, pointIdx, stroke.width);
        ctx.restore();
      }
      onStrokePoint(strokeId, pos);
    }, 40);
  }, [onStrokePoint]);

  const stopSprayInterval = () => {
    if (sprayIntervalRef.current) { clearInterval(sprayIntervalRef.current); sprayIntervalRef.current = null; }
  };

  // ── Pointer handlers ──────────────────────────────────────────────────────
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    const point = toVirtual(e.clientX, e.clientY);
    lastPointerPosRef.current = point;

    if (tool === "hand" || spacePressed || e.button === 1) {
      isPanningRef.current = true;
      panStartRef.current = { x: e.clientX, y: e.clientY };
      panOffsetStartRef.current = { x: panX, y: panY };
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
      return;
    }

    if (tool === "select") {
      const hitIdx = [...historyRef.current].reverse().findIndex((s) => hitTest(s, point.x, point.y));
      if (hitIdx !== -1) {
        const realIdx = historyRef.current.length - 1 - hitIdx;
        const clicked = historyRef.current[realIdx];
        setSelectedStrokeId(clicked.strokeId);
        isDraggingRef.current = true;
        dragStartRef.current = point;
        dragStartPointsRef.current = clicked.points.map((p) => ({ ...p }));
        dragStartMasksRef.current = clicked.masks ? clicked.masks.map((mask) => ({
          width: mask.width,
          points: mask.points.map((mp) => ({ ...mp })),
        })) : [];
      } else {
        setSelectedStrokeId(null);
      }
      redrawHistory(historyRef.current);
      return;
    }

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
      // Paint initial puff on active canvas
      const ctx = activeCtxRef.current;
      const canvas = activeCanvasRef.current;
      if (ctx && canvas) {
        const dpr = window.devicePixelRatio || 1;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
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

    const canvas = activeCanvasRef.current;
    if (canvas) {
      const r = canvas.getBoundingClientRect();
      setCursorPos({ x: e.clientX - r.left, y: e.clientY - r.top });
    }

    // Throttled cursor broadcast — 80ms (was 50ms)
    const now = performance.now();
    if (now - lastCursorSentRef.current >= 80) {
      lastCursorSentRef.current = now;
      onCursorMove(point, { brushWidth: width, tool });
    }

    if (isPanningRef.current) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setPan(panOffsetStartRef.current.x + dx / zoom, panOffsetStartRef.current.y + dy / zoom);
      return;
    }

    if (isDraggingRef.current && selectedStrokeId) {
      const clicked = historyRef.current.find((s) => s.strokeId === selectedStrokeId);
      if (clicked) {
        const dx = point.x - dragStartRef.current.x;
        const dy = point.y - dragStartRef.current.y;
        clicked.points = dragStartPointsRef.current.map((p) => ({ x: p.x + dx, y: p.y + dy }));
        if (clicked.masks && dragStartMasksRef.current) {
          clicked.masks = dragStartMasksRef.current.map((mask) => ({
            width: mask.width,
            points: mask.points.map((mp) => ({ x: mp.x + dx, y: mp.y + dy })),
          }));
        }
        redrawHistory(historyRef.current);
      }
      return;
    }

    if (!pointerActiveRef.current || disabled) return;
    const strokeId = localStrokeIdRef.current;
    if (!strokeId) return;
    const stroke = activeRef.current.get(strokeId);
    if (!stroke) return;

    if (SHAPE_TOOLS.has(tool)) {
      // For local shape preview: update last point and repaint only active canvas
      stroke.points = [stroke.points[0], point];

      const ctx = activeCtxRef.current;
      const actCanvas = activeCanvasRef.current;
      if (ctx && actCanvas) {
        const dpr = window.devicePixelRatio || 1;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, actCanvas.width, actCanvas.height);
        ctx.scale(dpr * zoom, dpr * zoom);
        ctx.translate(panX, panY);
        activeRef.current.forEach((s) => drawStrokeOnCtx(ctx, actCanvas, s));
        ctx.restore();
      }
      onStrokePoint(strokeId, point);
      return;
    }

    if (tool === "spray") return;

    // Min-move threshold: 3px (was 1.5px) — halves point volume
    const prev = stroke.points[stroke.points.length - 1];
    if (prev) {
      const ddx = point.x - prev.x;
      const ddy = point.y - prev.y;
      if (ddx * ddx + ddy * ddy < 9) return;   // 3² = 9
    }

    if (tool === "eraser") {
      // Eraser: paint directly on history canvas for real-time visual feedback.
      // The active canvas is transparent — destination-out there would be a no-op.
      const histCtx = histCtxRef.current;
      if (histCtx && prev) {
        paintEraserSegmentOnHistory(histCtx, prev, point, stroke.width, zoom, panX, panY, window.devicePixelRatio || 1);
      }
      stroke.points.push(point);
      onStrokePoint(strokeId, point);
      return;
    }

    // All other freehand tools: incremental segment on active canvas only
    const ctx = activeCtxRef.current;
    if (ctx && prev) {
      paintIncrementalSegment(ctx, stroke, prev, point, zoom, panX, panY, window.devicePixelRatio || 1);
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
        deleteStrokeLocal(selectedStrokeId);
        historyRef.current = [...historyRef.current, clicked];
        redrawHistory(historyRef.current);
        onStrokeUpdate?.(clicked);
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
      activeRef.current.delete(strokeId);

      if (stroke.tool === "eraser") {
        historyRef.current.forEach((existingStroke) => {
          const intersects = stroke.points.some((p) => hitTestWithEraser(existingStroke, p.x, p.y, stroke.width));
          if (intersects) {
            if (!existingStroke.masks) existingStroke.masks = [];
            existingStroke.masks.push({
              width: stroke.width,
              points: stroke.points.map((p) => ({ x: p.x, y: p.y })),
            });
            onStrokeDelete?.(existingStroke.strokeId);
            onStrokeUpdate?.(existingStroke);
          }
        });
        // Clear active canvas, then full history redraw (eraser changes history)
        activeCtxRef.current?.clearRect(0, 0, activeCanvasRef.current?.width ?? 0, activeCanvasRef.current?.height ?? 0);
        redrawHistory(historyRef.current);
      } else {
        // Composite local completed stroke onto history canvas
        historyRef.current = [...historyRef.current, stroke];
        const histCtx = histCtxRef.current;
        const histCanvas = histCanvasRef.current;
        if (histCtx && histCanvas) {
          const dpr = window.devicePixelRatio || 1;
          histCtx.save();
          histCtx.setTransform(1, 0, 0, 1, 0, 0);
          histCtx.scale(dpr * zoom, dpr * zoom);
          histCtx.translate(panX, panY);
          drawStrokeOnCtx(histCtx, histCanvas, stroke);
          histCtx.restore();
        }
        // Clear the active canvas (stroke is now on history)
        activeCtxRef.current?.clearRect(0, 0, activeCanvasRef.current?.width ?? 0, activeCanvasRef.current?.height ?? 0);

        onStrokeEnd(strokeId, stroke);
      }
    }
  };

  const cursorDiam = Math.max(4, width * zoom);
  const isEraser   = tool === "eraser";
  const isShape    = SHAPE_TOOLS.has(tool);
  const isPanningCursor = tool === "hand" || spacePressed;

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full overflow-hidden ${
        isPanningCursor ? "cursor-grab active:cursor-grabbing" : tool === "select" ? "cursor-default" : "cursor-none"
      }`}
      onMouseLeave={() => setCursorPos(null)}
    >
      {/* Layer 0: Background dot grid */}
      <canvas
        ref={bgCanvasRef}
        className="absolute inset-0 h-full w-full pointer-events-none bg-paper"
      />
      {/* Layer 1: Completed stroke history */}
      <canvas
        ref={histCanvasRef}
        className="absolute inset-0 h-full w-full pointer-events-none bg-transparent"
      />
      {/* Layer 2: Active (in-progress) strokes — also receives pointer events */}
      <canvas
        ref={activeCanvasRef}
        className="absolute inset-0 h-full w-full touch-none bg-transparent"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endStroke}
        onPointerLeave={endStroke}
        onPointerCancel={endStroke}
      />

      {/* Local circle cursor */}
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
