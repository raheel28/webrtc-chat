const pool = require('./db');
const { readToken } = require('./auth');
const { ROOMS, validFile } = require('./config');

module.exports = function setupSockets(io, online) {
  // Every socket is authenticated from the signed cookie before it can do anything.
  io.use((socket, next) => {
    try { socket.data.user = readToken(socket.handshake.headers.cookie); next(); }
    catch { next(new Error('unauthorized')); }
  });

  io.on('connection', (socket) => {
    const me = socket.data.user.username;
    online.set(me, socket.id);
    io.emit('presence', [...online.keys()]);

    // WebRTC signaling relay. The server passes `payload` along without reading it.
    for (const ev of ['offer', 'answer', 'ice', 'hangup']) {
      socket.on(ev, ({ to, payload }) => {
        const id = online.get(to);
        if (id) io.to(id).emit(ev, { from: me, payload });
      });
    }

    // ---------- rooms ----------
    socket.on('room:join', (room) => {
      if (!ROOMS.includes(room)) return;
      for (const r of [...socket.rooms]) if (ROOMS.includes(r)) socket.leave(r);
      socket.join(room);
      socket.to(room).emit('room:joined', { room, user: me });
    });

    // Save first, then broadcast, so every client sees exactly what is stored.
    async function post(room, text, name, data) {
      const q = await pool.query(
        'INSERT INTO room_chat (room, sender, mess_age, file_name, base) VALUES ($1,$2,$3,$4,$5) RETURNING id, sent_time',
        [room, me, text, name, data]);
      io.to(room).emit('room:message', {
        room, id: q.rows[0].id, sender: me, mess_age: text, file_name: name,
        has_file: data !== null, sent_time: q.rows[0].sent_time,
      });
    }

    socket.on('room:message', async ({ room, text } = {}) => {
      if (!ROOMS.includes(room) || !socket.rooms.has(room) || !text || String(text).length > 2000) return;
      try { await post(room, String(text), null, null); }
      catch (e) { console.error(e); socket.emit('room:error', 'Message could not be saved'); }
    });

    socket.on('room:file', async ({ room, name, data } = {}, ack) => {
      if (typeof ack !== 'function') return;
      if (!ROOMS.includes(room) || !socket.rooms.has(room) || !validFile(name, data)) return ack({ ok: false, error: 'Bad file (max 5 MB)' });
      try { await post(room, null, name, data); ack({ ok: true }); }
      catch (e) { console.error(e); ack({ ok: false, error: 'File could not be saved' }); }
    });

    socket.on('disconnect', () => {
      if (online.get(me) === socket.id) { online.delete(me); io.emit('presence', [...online.keys()]); }
    });
  });
};
