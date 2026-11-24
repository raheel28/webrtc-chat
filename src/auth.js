const jwt = require('jsonwebtoken');
const cookie = require('cookie');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('Set JWT_SECRET in .env');

const sign = (u) => jwt.sign({ id: u.id, username: u.username }, JWT_SECRET, { expiresIn: '7d' });
const setAuthCookie = (res, token) =>
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 3600 * 1000 });
const readToken = (cookieHeader) => jwt.verify(cookie.parse(cookieHeader || '').token, JWT_SECRET);

function auth(req, res, next) {
  try { req.user = readToken(req.headers.cookie); next(); }
  catch { res.status(401).json({ error: 'Not logged in' }); }
}
module.exports = { sign, setAuthCookie, readToken, auth };
