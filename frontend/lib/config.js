export const WS_BASE_URL =
  (import.meta.env.VITE_WS_URL || import.meta.env.NEXT_PUBLIC_WS_URL || "").replace(/\/$/, "") || "ws://127.0.0.1:7860";

export function wsUrlForRoom(roomId, name, role = "editor") {
  const encodedName = encodeURIComponent(name);
  const roleParam = role === "viewer" ? "&role=viewer" : "";
  return `${WS_BASE_URL}/ws/${roomId}?name=${encodedName}${roleParam}`;
}

export function shareUrlForRoom(roomId, role) {
  const base = `${typeof window !== "undefined" ? window.location.origin : ""}/board/${roomId}`;
  return role === "viewer" ? `${base}?role=viewer` : base;
}

export function randomRoomId() {
  const part = () => Math.random().toString(36).slice(2, 6);
  return `${part()}-${part()}`;
}
