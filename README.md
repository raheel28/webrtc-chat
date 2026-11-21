# ChatApp

Real-time chat that uses the right transport for each feature.

| Feature | Transport | Why |
|---|---|---|
| One-to-one text and files | WebRTC data channel (browser to browser) | Delivery doesn't pass through the server; low latency |
| WebRTC setup (offer / answer / ICE) | Socket.IO signaling relay | WebRTC does not define signaling, so the app supplies it |
| Group rooms | Socket.IO through the server | Fan-out is simple server-side; WebRTC group chat needs a mesh or media server |
| Accounts, history, read receipts | Express + PostgreSQL, JWT in an httpOnly cookie | Identity is verified server-side on every route and socket |

## Run
1. `createdb chatapp && psql chatapp -f schema.sql`
2. `cp .env.example .env`, then set `DATABASE_URL` and a long random `JWT_SECRET`
3. `npm install && npm start`
4. Open http://localhost:3000 in two browsers (or one normal and one private window), register two users, click one from the other.

## Layout
```
server.js        bootstrap: Express + Socket.IO
src/auth.js      JWT cookie helpers + auth middleware
src/routes.js    REST API: accounts, history, read receipts, file download
src/sockets.js   socket auth, presence, signaling relay, rooms
src/config.js    rooms list, file limits, file validation
public/app.js    client: WebRTC (offer/answer/ICE, data channel, file chunking), rooms, read receipts
```

## Design notes
- **Delivery is peer-to-peer, history is not.** The server can't observe P2P messages in transit, but the sender's browser reports each message to `/api/messages` and `/api/dm-file` so history survives reloads. So the server does store DM content; the P2P path removes it from the delivery path, not from storage. A real E2E-private design would encrypt before reporting.
- **Read receipts:** the recipient marks messages read on opening the chat; the server updates `chats.read_status` and tells the sender over the socket.
- **Files:** DM files are chunked (16 KB) over the data channel with back-pressure. Stored files (max 5 MB, base64 in Postgres) are served through an access-checked endpoint; only image/PDF types open inline, everything else downloads.
- Passwords: bcrypt. SQL: parameterized. Rendering: `textContent`, so no HTML injection.

## Known limitations
- No TURN server: strict NATs may fail to connect.
- No glare handling if both users call each other at the same instant.
- One active peer connection per tab; a DM needs both people online.
- Base64-in-Postgres file storage doesn't scale; object storage would be the next step.
- Single server process; multiple processes would need the Socket.IO Redis adapter.
