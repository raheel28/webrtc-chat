const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('./db');
const { sign, setAuthCookie, auth } = require('./auth');
const { ROOMS, VIEWABLE, fileMime, validFile } = require('./config');

module.exports = function createRoutes({ io, online }) {
  const r = express.Router();
  const wrap = (fn) => (req, res) =>
    fn(req, res).catch((e) => { console.error(e); res.status(500).json({ error: 'Server error' }); });
  const bad = (res, error, code = 400) => res.status(code).json({ error });

  r.post('/register', wrap(async (req, res) => {
    const b = req.body;
    const first_name = String(b.first_name || '').trim();
    const last_name = String(b.last_name || '').trim();
    const username = String(b.username || '').trim();
    const email = String(b.email || '').trim().toLowerCase();
    const gender = String(b.gender || '').trim();
    const phone_number = String(b.phone_number || '').trim();
    const password = String(b.password || '');
    if (!first_name || !last_name) return bad(res, 'First and last name are required');
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return bad(res, 'Username: 3-20 letters, digits or _');
    if (!/^\S+@\S+\.\S+$/.test(email)) return bad(res, 'Enter a valid email');
    if (password.length < 6) return bad(res, 'Password must be at least 6 characters');
    const hash = await bcrypt.hash(password, 10);
    try {
      const q = await pool.query(
        `INSERT INTO users_data (username, first_name, last_name, email, gender, phone_number, pass_word)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, username`,
        [username, first_name, last_name, email, gender, phone_number, hash]);
      setAuthCookie(res, sign(q.rows[0]));
      res.json({ username });
    } catch (e) {
      if (e.code === '23505') return bad(res, String(e.constraint).includes('email') ? 'Email already registered' : 'Username already taken', 409);
      throw e;
    }
  }));

  r.post('/login', wrap(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const q = await pool.query('SELECT id, username, pass_word FROM users_data WHERE email = $1', [email]);
    const user = q.rows[0];
    const ok = user && await bcrypt.compare(String(req.body.password || ''), user.pass_word);
    if (!ok) return bad(res, 'Invalid email or password', 401);
    setAuthCookie(res, sign(user));
    res.json({ username: user.username });
  }));

  r.post('/logout', (req, res) => { res.clearCookie('token'); res.json({ ok: true }); });
  r.get('/me', auth, (req, res) => res.json({ username: req.user.username, rooms: ROOMS }));

  r.get('/users', auth, wrap(async (req, res) => {
    const q = await pool.query('SELECT username FROM users_data WHERE username <> $1 ORDER BY username', [req.user.username]);
    res.json(q.rows.map((x) => x.username));
  }));

  r.get('/history/:user', auth, wrap(async (req, res) => {
    const q = await pool.query(
      `SELECT id, sender, mess_age, file_name, (base IS NOT NULL) AS has_file, read_status, sent_time
       FROM chats
       WHERE (sender = $1 AND recipient = $2) OR (sender = $2 AND recipient = $1)
       ORDER BY sent_time, id`, [req.user.username, req.params.user]);
    res.json(q.rows);
  }));

  r.post('/messages', auth, wrap(async (req, res) => {
    const { to, text } = req.body;
    if (!to || !text || String(text).length > 2000) return bad(res, 'Bad message');
    try {
      await pool.query('INSERT INTO chats (sender, recipient, mess_age) VALUES ($1,$2,$3)',
        [req.user.username, String(to), String(text)]);
    } catch (e) { if (e.code === '23503') return bad(res, 'No such user', 404); throw e; }
    res.json({ ok: true });
  }));

  r.post('/dm-file', auth, wrap(async (req, res) => {
    const { to, name, data } = req.body;
    if (!to || !validFile(name, data)) return bad(res, 'Bad file (max 5 MB)');
    try {
      await pool.query('INSERT INTO chats (sender, recipient, file_name, base) VALUES ($1,$2,$3,$4)',
        [req.user.username, String(to), name, data]);
    } catch (e) { if (e.code === '23503') return bad(res, 'No such user', 404); throw e; }
    res.json({ ok: true });
  }));

  r.put('/read/:user', auth, wrap(async (req, res) => {
    const me = req.user.username, peer = req.params.user;
    const q = await pool.query(
      'UPDATE chats SET read_status = true WHERE sender = $1 AND recipient = $2 AND read_status = false', [peer, me]);
    if (q.rowCount > 0) { const id = online.get(peer); if (id) io.to(id).emit('read', { by: me }); }
    res.json({ updated: q.rowCount });
  }));

  r.get('/rooms/:room', auth, wrap(async (req, res) => {
    if (!ROOMS.includes(req.params.room)) return bad(res, 'No such room', 404);
    const q = await pool.query(
      `SELECT id, sender, mess_age, file_name, (base IS NOT NULL) AS has_file, sent_time
       FROM room_chat WHERE room = $1 ORDER BY sent_time, id`, [req.params.room]);
    res.json(q.rows);
  }));

  r.get('/files/:kind/:id', auth, wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return bad(res, 'Not found', 404);
    let q;
    if (req.params.kind === 'dm')
      q = await pool.query('SELECT file_name, base FROM chats WHERE id = $1 AND base IS NOT NULL AND (sender = $2 OR recipient = $2)', [id, req.user.username]);
    else if (req.params.kind === 'room')
      q = await pool.query('SELECT file_name, base FROM room_chat WHERE id = $1 AND base IS NOT NULL', [id]);
    else return bad(res, 'Not found', 404);
    const row = q.rows[0];
    if (!row) return bad(res, 'Not found', 404);
    const mime = fileMime(row.base);
    const inline = req.query.view === '1' && VIEWABLE.includes(mime);
    res.set({
      'Content-Type': inline ? mime : 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
    });
    res.send(Buffer.from(row.base.slice(row.base.indexOf(',') + 1), 'base64'));
  }));

  return r;
};
