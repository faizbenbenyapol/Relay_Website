// server.js — Express + Socket.io + Stats API + static files
// Relay: ส่งไฟล์ P2P โดยตรง, server ทำหน้าที่เป็น signaling + เก็บสถิติรวมเท่านั้น

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { setupSignaling } = require('./src/signaling');
const { getStats } = require('./src/db');

const app = express();
const server = http.createServer(app);

// อนุญาต reverse proxy (Apache) เก็บ IP/โปรโตคอลจริง
app.set('trust proxy', true);

// ---- Static (หน้าเว็บ) ----
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
}));

// ---- Stats API ----
app.get('/api/stats', (_req, res) => {
  res.json(getStats());
});

// ---- หน้าหลัก ----
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---- Socket.io (Signaling) ----
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : '*';

const io = new Server(server, {
  maxHttpBufferSize: 1e6, // จำกัดขนาดข้อความ signaling ที่ 1MB (ไฟล์ไม่ได้วิ่งผ่านตรงนี้อยู่แล้ว)
  cors: { origin: allowedOrigins },
});
setupSignaling(io);

// ---- เริ่มทำงาน ----
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Relay ทำงานที่ http://localhost:${PORT}`);
  console.log(`Stats API:  http://localhost:${PORT}/api/stats`);
});
