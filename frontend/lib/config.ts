// Backend WebSocket base URL, e.g. "wss://your-space.hf.space" in
// production or "ws://127.0.0.1:7860" while running the backend locally.
// Set via NEXT_PUBLIC_WS_URL at build/deploy time (see .env.local.example).
import type { RoomRole } from "./types";

export const WS_BASE_URL =
  (import.meta.env.VITE_WS_URL || import.meta.env.NEXT_PUBLIC_WS_URL || "").replace(/\/$/, "") || "ws://127.0.0.1:7860";

export function wsUrlForRoom(roomId: string, name: string, role: RoomRole = "editor"): string {  const encodedName = encodeURIComponent(name);
  const roleParam = role === "viewer" ? "&role=viewer" : "";
  return `${WS_BASE_URL}/ws/${roomId}?name=${encodedName}${roleParam}`;
}

export function shareUrlForRoom(roomId: string, role: RoomRole): string {
  const base = `${typeof window !== "undefined" ? window.location.origin : ""}/board/${roomId}`;
  return role === "viewer" ? `${base}?role=viewer` : base;
}

export function randomRoomId(): string {
  // Short, URL-friendly, easy to read aloud — 3 groups of base36 chars.
  const part = () => Math.random().toString(36).slice(2, 6);
  return `${part()}-${part()}`;
}
