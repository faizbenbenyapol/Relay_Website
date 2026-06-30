// src/signaling.js — Signaling Server สำหรับจับคู่ Peer (WebRTC)
// หน้าที่: จับคู่ผู้ส่ง-ผู้รับด้วยรหัส 6 หลัก, รีเลย์ SDP/ICE, นับสถิติเมื่อส่งเสร็จ
// สำคัญ: ไม่มีไฟล์วิ่งผ่านที่นี่เลย — มีแค่ข้อความ signaling เล็กๆ

const { addTransfer } = require('./db');

/**
 * ติดตั้ง signaling logic บน io (socket.io)
 * @param {import('socket.io').Server} io
 */
function setupSignaling(io) {
  // code(6 หลัก) -> { sender: socketId, receiver: socketId|null }
  const rooms = new Map();

  // สุ่มรหัส 6 หลักที่ยังไม่ถูกใช้ (มี max retry กันค้าง)
  function genCode(maxTries = 1000) {
    for (let i = 0; i < maxTries; i++) {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      if (!rooms.has(code)) return code;
    }
    return null; // ห้องเต็ม
  }

  // เก็บ code ที่แต่ละ socket เปิดไว้ เพื่อ cleanup ตอน disconnect
  const socketToCode = new Map();

  // ล้างห้อง + แจ้งอีกฝั่งให้ทราบว่าจบการเชื่อมต่อ
  function teardownRoom(code, reason) {
    const room = rooms.get(code);
    if (!room) return;
    if (room.sender) io.to(room.sender).emit('peer:gone', { code, reason });
    if (room.receiver) io.to(room.receiver).emit('peer:gone', { code, reason });
    rooms.delete(code);
    // ลบการผูก code ของทั้งสองฝั่ง
    socketToCode.delete(room.sender);
    socketToCode.delete(room.receiver);
  }

  io.on('connection', (socket) => {
    console.log(`[signaling] connect ${socket.id}`);

    // ---- ผู้ส่ง: สร้างห้อง + รับรหัส 6 หลัก ----
    socket.on('room:create', () => {
      // ถ้า socket นี้มีห้องเดิมอยู่แล้ว ทำลายก่อน
      const old = socketToCode.get(socket.id);
      if (old) teardownRoom(old, 'recreate');

      const code = genCode();
      if (!code) {
        return socket.emit('room:error', { message: 'ห้องเต็มชั่วคราว กรุณาลองใหม่' });
      }

      rooms.set(code, { sender: socket.id, receiver: null });
      socketToCode.set(socket.id, code);
      console.log(`[signaling] room:create ${code} by ${socket.id}`);
      socket.emit('room:created', { code });
    });

    // ---- ผู้รับ: กรอกรหัสเข้าร่วมห้อง ----
    socket.on('room:join', ({ code }) => {
      const c = String(code || '').trim();

      // เคลียร์ห้องเดิมหาก client นี้เคยสร้าง/เข้าร่วมห้องอื่นค้างไว้ก่อนหน้า
      const old = socketToCode.get(socket.id);
      if (old) teardownRoom(old, 'recreate');

      const room = rooms.get(c);
      if (!room) return socket.emit('room:error', { message: 'ไม่พบรหัสนี้ อาจหมดอายุหรือผู้ส่งปิดหน้าเว็บแล้ว' });
      if (room.receiver) return socket.emit('room:error', { message: 'รหัสนี้ถูกใช้งานแล้ว' });
      if (room.sender === socket.id) return socket.emit('room:error', { message: 'ไม่สามารถรับไฟล์ของตัวเองได้' });

      room.receiver = socket.id;
      socketToCode.set(socket.id, c);
      console.log(`[signaling] room:join ${c} receiver=${socket.id}`);

      // แจ้งผู้ส่งว่าผู้รับมาแล้ว → ให้เริ่มสร้าง WebRTC offer
      io.to(room.sender).emit('peer:matched', { code: c, role: 'sender' });
      socket.emit('peer:matched', { code: c, role: 'receiver' });
    });

    // ---- รีเลย์ข้อความ signaling (SDP offer/answer + ICE) ----
    // server หาอีกฝั่งในห้องเดียวกันให้เอง (ไม่พึ่ง client ส่ง `to`)
    socket.on('signal', ({ data }) => {
      const roomCode = socketToCode.get(socket.id);
      const room = rooms.get(roomCode);
      if (!room) return;
      const other = room.sender === socket.id ? room.receiver : room.sender;
      if (other) io.to(other).emit('signal', { from: socket.id, data });
    });

    // ---- ผู้ส่งแจ้งว่าส่งไฟล์เสร็จ → นับสถิติรวม ----
    socket.on('transfer:done', ({ files, bytes }) => {
      const roomCode = socketToCode.get(socket.id);
      const room = rooms.get(roomCode);
      // นับเฉพาะถ้าเป็นฝั่งผู้ส่งจริง และยังมีผู้รับอยู่ (กันนับซ้อน/ปลอม)
      if (room && room.sender === socket.id && room.receiver) {
        addTransfer({ files, bytes });
        console.log(`[signaling] transfer:done ${roomCode} files=${files} bytes=${bytes}`);
      }
    });

    // ---- ปิดหน้าเว็บ/ตัดการเชื่อมต่อ → ทำลายห้องทันที ----
    socket.on('disconnect', () => {
      const roomCode = socketToCode.get(socket.id);
      if (roomCode) {
        console.log(`[signaling] disconnect ${socket.id} (code: ${roomCode})`);
        teardownRoom(roomCode, 'peer-disconnected');
      }
    });
  });
}

module.exports = { setupSignaling };
