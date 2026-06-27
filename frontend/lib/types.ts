export type Tool =
  | "select"
  | "hand"
  | "pen"
  | "pencil"
  | "marker"
  | "calligraphy"
  | "crayon"
  | "oil"
  | "watercolour"
  | "spray"
  | "rect"
  | "circle"
  | "triangle"
  | "line"
  | "arrow"
  | "diamond"
  | "star"
  | "hexagon"
  | "heart"
  | "eraser";

export interface Point {
  x: number;
  y: number;
}

export interface StrokeMask {
  width: number;
  points: Point[];
}

export interface Stroke {
  strokeId: string;
  color: string;
  width: number;
  tool: Tool;
  points: Point[];
  authorId?: string;
  fillStyle?: "hachure" | "cross-hatch" | "solid" | "none";
  fillColor?: string;
  roughness?: number;
  masks?: StrokeMask[];
}

export interface RemoteUser {
  id: string;
  name: string;
  color: string;
}

export interface CursorState extends RemoteUser {
  x: number;
  y: number;
  lastSeen: number;
  brushWidth?: number;
  tool?: Tool;
}

// ---- Server -> Client ----
export type ServerMessage =
  | { type: "init"; clientId: string; color: string; name: string; strokes: Stroke[]; users: RemoteUser[]; userCount: number }
  | { type: "user_joined"; user: RemoteUser }
  | { type: "user_left"; id: string }
  | { type: "user_renamed"; id: string; name: string }
  | { type: "user_count"; count: number }
  | { type: "stroke_start"; id: string; strokeId: string; color: string; width: number; tool: Tool; point: Point; fillStyle?: "hachure" | "cross-hatch" | "solid" | "none"; fillColor?: string; roughness?: number }
  | { type: "stroke_point"; id: string; strokeId: string; point: Point }
  | { type: "stroke_end"; id: string; strokeId: string }
  | { type: "clear"; id: string }
  | { type: "cursor"; id: string; x: number; y: number; name: string; color: string; brushWidth?: number; tool?: Tool }
  | { type: "undo"; id: string; strokeId: string }
  | { type: "redo"; id: string; stroke: Stroke };

// ---- Client -> Server ----
export type ClientMessage =
  | { type: "stroke_start"; strokeId: string; color: string; width: number; tool: Tool; point: Point; fillStyle?: "hachure" | "cross-hatch" | "solid" | "none"; fillColor?: string; roughness?: number }
  | { type: "stroke_point"; strokeId: string; point: Point }
  | { type: "stroke_end"; strokeId: string }
  | { type: "cursor"; x: number; y: number; brushWidth?: number; tool?: Tool }
  | { type: "clear" }
  | { type: "set_name"; name: string }
  | { type: "undo"; strokeId: string }
  | { type: "redo"; stroke: Stroke };
