const $ = (id) => document.getElementById(id);
const MAX_FILE = 5 * 1024 * 1024;
const CHUNK = 16 * 1024;
const VIEWABLE_EXT = /\.(png|jpe?g|gif|webp|pdf)$/i;
const VIEWABLE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'];
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const socket = io({ autoConnect: false });

let me = null;
let mode = null;
let pc = null, channel = null, rtcPeer = null;
let pendingIce = [], incoming = null, readTimer = null;
let allUsers = [], onlineSet = new Set();

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (res.status === 401) { location.href = '/login.html'; throw new Error('unauthorized'); }
  return res.json();
}
const send = (path, body, method = 'POST') => api(path, { method, body: JSON.stringify(body) });
const setStatus = (t) => ($('status').textContent = t);
const setInputs = (on) => { $('input').disabled = !on; $('file').disabled = !on; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toDataURL = (file) => new Promise((resolve, reject) => {
  const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = reject; fr.readAsDataURL(file);
});
const dmOpen = () => channel && channel.readyState === 'open' && mode?.type === 'dm' && rtcPeer === mode.peer;

function addRow({ sender, text, file, time, tick, sys }) {
  const p = document.createElement('p');
  if (sys) { p.className = 'sys'; p.textContent = text; }
  else {
    p.className = 'msg' + (sender === me ? ' mine' : '');
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = (sender === me ? 'You' : sender) + (time ? ' · ' + new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
    p.append(meta);
    if (file) {
      const b = document.createElement('b'); b.textContent = file.name; p.append(b, ' ');
      const dl = document.createElement('a'); dl.href = file.url; dl.download = file.name; dl.textContent = '(Download)'; p.append(dl);
      if (file.viewUrl) {
        const v = document.createElement('a'); v.href = file.viewUrl; v.target = '_blank'; v.rel = 'noopener'; v.textContent = '(View)';
        p.append(' ', v);
      }
    } else p.append(text);
    if (tick !== undefined) {
      const s = document.createElement('span'); s.className = 'tick' + (tick ? ' read' : ''); s.textContent = tick ? ' ✓✓' : ' ✓'; p.append(s);
    }
  }
  $('msgs').appendChild(p);
  $('msgs').scrollTop = $('msgs').scrollHeight;
}
function markActive() {
  document.querySelectorAll('#users li, #rooms li').forEach((li) => li.classList.toggle('active',
    (mode?.type === 'dm' && li.dataset.name === mode.peer) || (mode?.type === 'room' && li.dataset.room === mode.room)));
}
function rowFromDb(m, kind) {
  const item = { sender: m.sender, time: m.sent_time };
  if (m.has_file) {
    const url = `/api/files/${kind}/${m.id}`;
    item.file = { name: m.file_name, url, viewUrl: VIEWABLE_EXT.test(m.file_name) ? url + '?view=1' : null };
  } else item.text = m.mess_age;
  if (kind === 'dm' && m.sender === me) item.tick = m.read_status;
  return item;
}

(async () => {
  const data = await api('/me');
  me = data.username;
  $('me').textContent = me;
  data.rooms.forEach((room) => {
    const li = document.createElement('li'); li.textContent = room; li.dataset.room = room; li.onclick = () => openRoom(room); $('rooms').appendChild(li);
  });
  allUsers = await api('/users');
  renderUsers();
  socket.connect();
})();

function renderUsers() {
  $('users').innerHTML = '';
  allUsers.forEach((u) => {
    const li = document.createElement('li');
    li.textContent = u; li.className = onlineSet.has(u) ? 'on' : 'off'; li.dataset.name = u;
    li.title = onlineSet.has(u) ? 'Online' : 'Offline';
    li.onclick = () => openDM(u, true);
    $('users').appendChild(li);
  });
  markActive();
}
socket.on('presence', async (list) => { onlineSet = new Set(list); allUsers = await api('/users'); renderUsers(); });
socket.on('connect_error', () => (location.href = '/login.html'));
$('logout').onclick = async () => { await send('/logout', {}); location.href = '/login.html'; };

async function openDM(peer, initiate) {
  const my = (mode = { type: 'dm', peer });
  markActive();
  $('msgs').innerHTML = '';
  setInputs(dmOpen());
  const hist = await api('/history/' + encodeURIComponent(peer));
  if (mode !== my) return;
  hist.forEach((m) => addRow(rowFromDb(m, 'dm')));
  markRead();
  if (!initiate) return setStatus(`Chat with ${peer}`);
  if (!onlineSet.has(peer)) return setStatus(`${peer} is offline. History is shown; live chat needs both people online.`);
  if (!(rtcPeer === peer && channel && channel.readyState === 'open')) call(peer);
}

function createPeerConnection(remote) {
  closeConnection();
  rtcPeer = remote; pendingIce = []; incoming = null;
  pc = new RTCPeerConnection(rtcConfig);
  pc.onicecandidate = (e) => { if (e.candidate) socket.emit('ice', { to: remote, payload: e.candidate }); };
  pc.onconnectionstatechange = () => { if (mode?.peer === remote) setStatus(`Peer connection to ${remote}: ${pc.connectionState}`); };
  pc.ondatachannel = (e) => setupChannel(e.channel);
}

function setupChannel(ch) {
  channel = ch;
  ch.binaryType = 'arraybuffer';
  ch.onopen = () => {
    if (mode?.type === 'dm' && mode.peer === rtcPeer) { setInputs(true); addRow({ sys: true, text: `Direct peer-to-peer link to ${rtcPeer} established.` }); }
  };
  ch.onclose = () => { if (mode?.type === 'dm') setInputs(false); };
  ch.onmessage = (e) => {
    const viewing = mode?.type === 'dm' && mode.peer === rtcPeer;
    if (typeof e.data !== 'string') {
      if (incoming) { incoming.chunks.push(e.data); incoming.got += e.data.byteLength; if (incoming.got > MAX_FILE) incoming = null; }
      return;
    }
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.t === 'text' && viewing) { addRow({ sender: rtcPeer, text: String(m.text), time: Date.now() }); scheduleRead(); }
    else if (m.t === 'file-start') incoming = { name: String(m.name).slice(0, 200), type: String(m.type || ''), chunks: [], got: 0 };
    else if (m.t === 'file-end' && incoming) {
      const type = VIEWABLE_TYPES.includes(incoming.type) ? incoming.type : 'application/octet-stream';
      const url = URL.createObjectURL(new Blob(incoming.chunks, { type }));
      if (viewing) {
        addRow({ sender: rtcPeer, time: Date.now(), file: { name: incoming.name, url, viewUrl: type !== 'application/octet-stream' ? url : null } });
        scheduleRead();
      }
      incoming = null;
    }
  };
}

function closeConnection() {
  if (channel) { channel.onclose = null; channel.close(); channel = null; }
  if (pc) { pc.close(); pc = null; }
}

async function call(remote) {
  createPeerConnection(remote);
  setupChannel(pc.createDataChannel('chat'));
  await pc.setLocalDescription(await pc.createOffer());
  socket.emit('offer', { to: remote, payload: pc.localDescription });
  setStatus(`Connecting to ${remote}...`);
}
socket.on('offer', async ({ from, payload }) => {
  if (!(mode?.type === 'dm' && mode.peer === from)) await openDM(from, false);
  createPeerConnection(from);
  await pc.setRemoteDescription(payload);
  await flushIce();
  await pc.setLocalDescription(await pc.createAnswer());
  socket.emit('answer', { to: from, payload: pc.localDescription });
});
socket.on('answer', async ({ from, payload }) => { if (pc && from === rtcPeer) { await pc.setRemoteDescription(payload); await flushIce(); } });
socket.on('ice', async ({ from, payload }) => {
  if (!pc || from !== rtcPeer) return;
  if (pc.remoteDescription) await pc.addIceCandidate(payload); else pendingIce.push(payload);
});
async function flushIce() { while (pendingIce.length) await pc.addIceCandidate(pendingIce.shift()); }
socket.on('hangup', ({ from }) => {
  if (from !== rtcPeer) return;
  closeConnection();
  if (mode?.peer === from) { setInputs(false); setStatus(`${from} went offline.`); }
});
window.addEventListener('beforeunload', () => { if (rtcPeer) socket.emit('hangup', { to: rtcPeer }); });

async function sendDMFile(file) {
  const ch = channel;
  ch.send(JSON.stringify({ t: 'file-start', name: file.name, type: file.type }));
  for (let o = 0; o < file.size; o += CHUNK) {
    while (ch.bufferedAmount > 1e6) await sleep(20);
    ch.send(await file.slice(o, o + CHUNK).arrayBuffer());
  }
  ch.send(JSON.stringify({ t: 'file-end' }));
  const url = URL.createObjectURL(file);
  const viewable = VIEWABLE_TYPES.includes(file.type);
  addRow({ sender: me, time: Date.now(), tick: false, file: { name: file.name, url, viewUrl: viewable ? url : null } });
  send('/dm-file', { to: rtcPeer, name: file.name, data: await toDataURL(file) }).catch(console.error);
}

const markRead = () => { if (mode?.type === 'dm') api('/read/' + encodeURIComponent(mode.peer), { method: 'PUT' }).catch(() => {}); };
const scheduleRead = () => { clearTimeout(readTimer); readTimer = setTimeout(markRead, 1000); };
window.addEventListener('focus', markRead);
socket.on('read', ({ by }) => {
  if (mode?.type === 'dm' && mode.peer === by)
    document.querySelectorAll('#msgs .tick:not(.read)').forEach((s) => { s.classList.add('read'); s.textContent = ' ✓✓'; });
});

async function openRoom(room) {
  const my = (mode = { type: 'room', room });
  markActive();
  $('msgs').innerHTML = '';
  socket.emit('room:join', room);
  const hist = await api('/rooms/' + encodeURIComponent(room));
  if (mode !== my) return;
  hist.forEach((m) => addRow(rowFromDb(m, 'room')));
  setInputs(true);
  setStatus(`${room} (messages go through the server)`);
}
socket.on('room:message', (m) => { if (mode?.type === 'room' && mode.room === m.room) addRow(rowFromDb(m, 'room')); });
socket.on('room:joined', ({ room, user }) => { if (mode?.type === 'room' && mode.room === room) addRow({ sys: true, text: `${user} joined the room` }); });
socket.on('room:error', (msg) => addRow({ sys: true, text: msg }));

$('form').onsubmit = async (e) => {
  e.preventDefault();
  if (!mode) return;
  const text = $('input').value.trim();
  const file = $('file').files[0];
  if (!text && !file) return;
  if (file && file.size > MAX_FILE) return setStatus('File too large (5 MB max).');
  if (mode.type === 'dm' && !dmOpen()) return setStatus('Not connected to this person yet (they must be online).');
  const m = mode;
  if (file) {
    if (m.type === 'room') socket.emit('room:file', { room: m.room, name: file.name, data: await toDataURL(file) }, (r) => { if (!r.ok) setStatus(r.error); });
    else await sendDMFile(file);
    $('file').value = '';
  }
  if (text) {
    if (m.type === 'room') socket.emit('room:message', { room: m.room, text });
    else {
      channel.send(JSON.stringify({ t: 'text', text }));
      addRow({ sender: me, text, time: Date.now(), tick: false });
      send('/messages', { to: m.peer, text }).catch(console.error);
    }
    $('input').value = '';
  }
};
