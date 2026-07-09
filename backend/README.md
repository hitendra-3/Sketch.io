# Whiteboard Backend (Node.js Express + WebSockets)

Real-time collaborative whiteboard backend — Node.js + Express + `ws` package.

## Endpoints

- `GET /` — health check
- `GET /rooms/{room_id}/stats` — room statistics (active users, stroke count)
- `WS /ws/{room_id}?name=YourName` — WebSockets connection endpoint

## Local development

Start the backend individually (if not using concurrent root script):
```bash
npm install
npm run dev
```
Runs the server on `http://localhost:7860`.
