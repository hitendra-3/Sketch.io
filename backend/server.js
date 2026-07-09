const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

const PING_INTERVAL_SECS = 20;
const PONG_TIMEOUT_SECS = 15;
const ROOM_LINGER_SECS = 60;

const USER_COLORS = [
  "#F97316", "#22C55E", "#3B82F6", "#EC4899",
  "#A855F7", "#EAB308", "#14B8A6", "#EF4444",
];
const ADJECTIVES = ["Swift", "Calm", "Bold", "Quiet", "Bright", "Lucky", "Sharp", "Witty"];
const ANIMALS    = ["Otter", "Falcon", "Panda", "Lynx", "Heron", "Fox", "Wren", "Tiger"];

function randomName() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const anim = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return `${adj} ${anim}`;
}

const WRITE_MESSAGE_TYPES = new Set([
  "stroke_start", "stroke_point", "stroke_end", "clear", "undo", "redo",
]);

// Room and clients map
const rooms = new Map();

class Room {
  constructor(id) {
    this.id = id;
    this.clients = new Map(); // id -> clientInfo
    this.strokes = [];
    this.activeStrokes = new Map(); // strokeId -> stroke
    this.cursorTs = new Map(); // clientId -> lastCursorTimestamp
    this.lingerTimer = null;
  }

  broadcast(message, excludeClientId = null) {
    const payload = JSON.stringify(message);
    for (const [cid, client] of this.clients.entries()) {
      if (cid === excludeClientId) continue;
      if (client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(payload);
        } catch (e) {
          console.error(`Failed to send broadcast to ${cid}:`, e);
        }
      }
    }
  }

  getUserList() {
    return Array.from(this.clients.values()).map(c => ({
      id: c.id,
      name: c.name,
      color: c.color
    }));
  }

  cancelLinger() {
    if (this.lingerTimer) {
      clearTimeout(this.lingerTimer);
      this.lingerTimer = null;
    }
  }

  scheduleLinger() {
    this.cancelLinger();
    this.lingerTimer = setTimeout(() => {
      rooms.delete(this.id);
      console.log(`Room ${this.id} expired after linger period`);
    }, ROOM_LINGER_SECS * 1000);
  }
}

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'whiteboard-backend', rooms: rooms.size });
});

app.get('/rooms/:roomId/stats', (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);
  if (!room) {
    return res.json({ exists: false, userCount: 0, strokeCount: 0 });
  }
  res.json({
    exists: true,
    userCount: room.clients.size,
    strokeCount: room.strokes.length
  });
});

// Handle upgrade of http connection to websocket
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const match = url.pathname.match(/^\/ws\/(.+)$/);
  
  if (match) {
    const roomId = match[1];
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, roomId);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws, request, roomId) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const name = url.searchParams.get('name') || '';
  const role = url.searchParams.get('role') || 'editor';

  let room = rooms.get(roomId);
  if (!room) {
    room = new Room(roomId);
    rooms.set(roomId, room);
  }
  room.cancelLinger();

  const clientId = crypto.randomUUID();
  const color = USER_COLORS[room.clients.size % USER_COLORS.length];
  const displayName = (name.trim().slice(0, 24)) || randomName();
  const clientRole = role.trim().toLowerCase() === 'viewer' ? 'viewer' : 'editor';

  const clientInfo = {
    id: clientId,
    ws,
    name: displayName,
    color,
    role: clientRole,
    isAlive: true
  };

  const existingUsers = room.getUserList();
  room.clients.set(clientId, clientInfo);
  console.log(`Client ${clientId} (${displayName}) joined room ${roomId} (${room.clients.size} total)`);

  // Send initial state snapshot
  ws.send(JSON.stringify({
    type: "init",
    clientId: clientId,
    color: color,
    name: displayName,
    role: clientRole,
    strokes: room.strokes,
    users: existingUsers,
    userCount: room.clients.size
  }));

  // Broadcast join and count updates
  room.broadcast({
    type: "user_joined",
    user: { id: clientId, name: displayName, color }
  }, clientId);
  room.broadcast({
    type: "user_count",
    count: room.clients.size
  });

  // Watchdog timer (ping/pong)
  const pingInterval = setInterval(() => {
    if (clientInfo.isAlive === false) {
      console.log(`Ping timeout for client ${clientId} — dropping`);
      ws.terminate();
      return;
    }
    clientInfo.isAlive = false;
    try {
      ws.send(JSON.stringify({ type: "ping" }));
    } catch (e) {
      console.error(`Failed to send ping to client ${clientId}:`, e);
      ws.terminate();
    }
  }, PING_INTERVAL_SECS * 1000);

  ws.on('message', (messageText) => {
    let msg;
    try {
      msg = JSON.parse(messageText);
    } catch (e) {
      return;
    }

    if (msg.type === 'pong') {
      clientInfo.isAlive = true;
      return;
    }

    // Handle messages
    handleMessage(msg, clientInfo, room);
  });

  ws.on('close', () => {
    clearInterval(pingInterval);
    room.clients.delete(clientId);
    room.cursorTs.delete(clientId);
    console.log(`Client ${clientId} left room ${roomId} (${room.clients.size} remaining)`);

    if (room.clients.size > 0) {
      room.broadcast({ type: "user_left", id: clientId });
      room.broadcast({ type: "user_count", count: room.clients.size });
    } else {
      console.log(`Room ${roomId} is empty — starting ${ROOM_LINGER_SECS}s linger timer`);
      room.scheduleLinger();
    }
  });

  ws.on('error', (err) => {
    console.error(`WebSocket error for client ${clientId}:`, err);
    ws.close();
  });
});

function handleMessage(msg, client, room) {
  const msgType = msg.type;
  if (client.role === 'viewer' && WRITE_MESSAGE_TYPES.has(msgType)) {
    return;
  }

  const clientId = client.id;

  if (msgType === "stroke_start") {
    const strokeId = String(msg.strokeId || "");
    const stroke = {
      strokeId,
      color: msg.color || "#000000",
      width: msg.width || 4,
      tool: msg.tool || "pen",
      points: msg.point ? [msg.point] : [],
      authorId: clientId,
      fillStyle: msg.fillStyle,
      fillColor: msg.fillColor,
      roughness: msg.roughness,
    };
    room.activeStrokes.set(strokeId, stroke);
    room.broadcast({
      type: "stroke_start",
      id: clientId,
      strokeId,
      color: stroke.color,
      width: stroke.width,
      tool: stroke.tool,
      point: msg.point,
      fillStyle: stroke.fillStyle,
      fillColor: stroke.fillColor,
      roughness: stroke.roughness,
    }, clientId);

  } else if (msgType === "stroke_point") {
    const strokeId = String(msg.strokeId || "");
    const point = msg.point;
    const stroke = room.activeStrokes.get(strokeId);
    if (stroke && point) {
      stroke.points.push(point);
    }
    room.broadcast({
      type: "stroke_point",
      id: clientId,
      strokeId,
      point,
    }, clientId);

  } else if (msgType === "stroke_end") {
    const strokeId = String(msg.strokeId || "");
    const stroke = room.activeStrokes.get(strokeId);
    if (stroke) {
      room.activeStrokes.delete(strokeId);
      if (stroke.points.length > 0) {
        room.strokes.push(stroke);
      }
    }
    room.broadcast({
      type: "stroke_end",
      id: clientId,
      strokeId,
    }, clientId);

  } else if (msgType === "cursor") {
    const now = Date.now();
    const lastTs = room.cursorTs.get(clientId) || 0;
    if (now - lastTs < 40) { // 40ms rate limit
      return;
    }
    room.cursorTs.set(clientId, now);

    room.broadcast({
      type: "cursor",
      id: clientId,
      x: msg.x,
      y: msg.y,
      name: client.name,
      color: client.color,
      brushWidth: msg.brushWidth,
      tool: msg.tool,
    }, clientId);

  } else if (msgType === "clear") {
    room.strokes = [];
    room.activeStrokes.clear();
    room.broadcast({ type: "clear", id: clientId });

  } else if (msgType === "undo") {
    const strokeId = String(msg.strokeId || "");
    room.strokes = room.strokes.filter(s => s.strokeId !== strokeId);
    room.activeStrokes.delete(strokeId);
    room.broadcast({
      type: "undo",
      id: clientId,
      strokeId,
    }, clientId);

  } else if (msgType === "redo") {
    const stroke = msg.stroke;
    if (stroke && typeof stroke === 'object') {
      room.strokes.push(stroke);
      room.broadcast({
        type: "redo",
        id: clientId,
        stroke,
      }, clientId);
    }

  } else if (msgType === "set_name") {
    const newName = String(msg.name || "").trim().slice(0, 24);
    if (newName) {
      client.name = newName;
      room.broadcast({
        type: "user_renamed",
        id: clientId,
        name: newName,
      }, clientId);
    }
  }
}

const PORT = process.env.PORT || 7860;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});
