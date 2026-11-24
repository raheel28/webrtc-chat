require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const createRoutes = require('./src/routes');
const setupSockets = require('./src/sockets');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 8e6 });
const online = new Map();

app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', createRoutes({ io, online }));
app.get('/', (req, res) => res.redirect('/login.html'));
setupSockets(io, online);

const PORT = process.env.PORT || 3000;

const fs = require('fs');
const pool = require('./src/db');
pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'))
  .then(() => server.listen(PORT, () => console.log(`ChatApp running on http://localhost:${PORT}`)))
  .catch((err) => { console.error('Could not set up the database schema:', err.message); process.exit(1); });
