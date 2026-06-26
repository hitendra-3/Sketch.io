# Sketch.io — Real-time Collaborative Whiteboard

A multiplayer drawing canvas where every stroke syncs instantly over WebSockets. Built from scratch with Next.js, FastAPI, and HTML5 Canvas (no external canvas libraries).

---

## 🏗️ System Design

```mermaid
graph TD
    subgraph Frontend [Next.js Client]
        Canvas[HTML5 Canvas]
        Presence[PresenceBar & CursorLayer]
        State[Local UI State]
    end

    subgraph Backend [FastAPI WebSocket Server]
        WS[WebSocket Endpoint /ws/:roomId]
        Mem[In-Memory Room State]
    end

    Canvas -- "stroke_start / stroke_point / stroke_end" --> WS
    Presence -- "cursor (x, y) / set_name" --> WS
    WS -- "init (State Snapshot)" --> State
    WS -- "Broadcasts (strokes, cursor, user_count)" --> Presence
```

---

## ⚡ Features & Wire Protocol

- **Zero-latency Stroke Sync:** Drawn coordinates are normalized (0 to 1) and broadcast in <50ms.
- **Cursor Presence:** Throttled mouse position updates for all active users.
- **State Replay:** Late joiners or reconnecting clients automatically fetch the full canvas history.

---

## 🛠️ Quick Start

### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 7860 --reload
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

---

## ☁️ Deployment

- **Backend:** Deploy to [Railway](https://railway.com) using the included `Dockerfile` and generate a domain.
- **Frontend:** Deploy to [Vercel](https://vercel.com) with the env variable `NEXT_PUBLIC_WS_URL=wss://your-backend.up.railway.app`.
