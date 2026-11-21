require('dotenv').config();               // must run before ./src modules read process.env
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const createRoutes = require('./src/routes');
const setupSockets = require('./src/sockets');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 8e6 });   // allows ~5 MB files in rooms
const online = new Map();                                      // username -> socket.id

app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', createRoutes({ io, online }));
app.get('/', (req, res) => res.redirect('/login.html'));
setupSockets(io, online);

const PORT = process.env.PORT || 3000;

// Create tables on startup. schema.sql only uses CREATE ... IF NOT EXISTS, so this is safe
// on every boot and means a fresh database (e.g. on Render) needs no manual psql step.
const fs = require('fs');
const pool = require('./src/db');
pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'))
  .then(() => server.listen(PORT, () => console.log(`ChatApp running on http://localhost:${PORT}`)))
  .catch((err) => { console.error('Could not set up the database schema:', err.message); process.exit(1); });
