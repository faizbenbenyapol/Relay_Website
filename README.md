# Relay

> ส่งไฟล์ข้ามอุปกรณ์แบบ **Peer-to-Peer (P2P)** โดยตรง — สไตล์ Send Anywhere
> ไม่จำกัดขนาดไฟล์ · เข้ารหัสตั้งต้นถึงปลายทาง · ไม่ต้องสมัครสมาชิก

ไฟล์ถูกส่งตรงระหว่าง browser ผ่าน **WebRTC DataChannel** เซิร์ฟเวอร์ทำหน้าที่เป็นเพียง
**signaling server** เพื่อจับคู่อุปกรณ์ และเก็บสถิติการใช้งานรวมเท่านั้น
**ไฟล์และข้อมูลดิบไม่ผ่านเซิร์ฟเวอร์เลยแม้แต่ไบต์เดียว**

---

## สถาปัตยกรรม

| ส่วน | เทคโนโลยี |
|------|----------|
| Frontend | Vanilla JS + CSS (ไม่มี build step, โหลดเร็ว) |
| Signaling | Node.js + Express + Socket.io |
| สถิติรวม | SQLite (`node:sqlite`, built-in) |
| การส่งข้อมูล | WebRTC DataChannel + DTLS (E2E encrypted) |
| Reverse proxy | Apache → Node:3000 |

### คุณสมบัติด้านความเป็นส่วนตัว
- ไฟล์วิ่ง P2P ตรงระหว่างอุปกรณ์ ไม่ผ่านเซิร์ฟเวอร์
- WebRTC มี DTLS = end-to-end encrypted โดยธรรมชาติ
- เซิร์ฟเวอร์เก็บเฉพาะตัวเลขสถิติรวม (จำนวนไฟล์ / ปริมาณข้อมูล / จำนวนครั้ง)
- ปิดหน้าเว็บหรือส่งเสร็จ → ทำลายการเชื่อมต่อ signaling ทันที

### รองรับไฟล์ขนาดไม่จำกัด
- **Chunking**: อ่านไฟล์ทีละชิ้น 64KB ผ่าน `file.slice()`
- **Flow control**: ควบคุมด้วย `bufferedAmount` — RAM ไม่บวมแม้ไฟล์หลาย GB
- **Stream-to-disk**: ฝั่งรับเขียนลงดิสก์ผ่าน File System Access API ตรงๆ (มี fallback)

---

## โครงสร้างโปรเจกต์

```
relay/
├── server.js              # Express + Socket.io + /api/stats + static
├── src/
│   ├── db.js             # SQLite schema + atomic counters
│   └── signaling.js      # จับคู่ peer + relay SDP/ICE + cleanup
├── public/
│   ├── index.html        # SPA หน้าเดียว
│   ├── styles.css        # ธีม monochrome Anti-AI
│   └── js/
│       ├── webrtc.js     # RTCPeerConnection + chunking + flow control
│       ├── app.js        # orchestrator (UI ↔ WebRTC ↔ Socket)
│       └── stats.js      # สถิติ footer real-time
├── config/apache-relay.conf
└── package.json
```

---

## เริ่มใช้งาน

### 1) ติดตั้ง + รัน Node server

```bash
cd C:\xampp\htdocs\relay
npm install
npm start
```

เข้าทดสอบผ่าน **http://localhost:3000**

### 2) ตั้งค่า Apache reverse proxy (สำหรับ relay.benyapol.online)

ดูวิธีทีละขั้นในไฟล์ [`config/apache-relay.conf`](config/apache-relay.conf)
สรุปคือ: เปิด `mod_proxy`, `mod_proxy_http`, `mod_proxy_wstunnel`, `mod_rewrite`, `mod_ssl`
แล้ว include ไฟล์ config นั้นใน Apache

---

## วิธีใช้งาน

1. **ฝั่งผู้ส่ง**: ลากไฟล์มาวาง (หรือคลิกเลือก) → ระบบจะแสดง **รหัส 6 หลัก** ใหญ่ๆ
2. **ฝั่งผู้รับ**: กรอกรหัส 6 หลักบนอุปกรณ์ปลายทาง → กด **รับไฟล์**
3. ทั้งสองฝั่งต้องเปิดหน้าเว็บค้างไว้จนกว่าจะส่งเสร็จ
4. เมื่อเสร็จ ไฟล์จะถูกบันทึกลงเครื่องผู้รับอัตโนมัติ

---

## API

| Endpoint | คำอธิบาย |
|----------|---------|
| `GET /api/stats` | สถิติรวม `{ total_files_sent, total_data_transferred, total_successful_transfers }` |

### Socket.io Events

| Event | ทิศทาง | คำอธิบาย |
|-------|--------|---------|
| `room:create` | client→server | ขอรหัส 6 หลักใหม่ |
| `room:join` | client→server | เข้าร่วมห้องด้วยรหัส |
| `peer:matched` | server→client | จับคู่สำเร็จ |
| `signal` | สองทิศทาง | relay SDP offer/answer + ICE |
| `transfer:done` | client→server | แจ้งส่งเสร็จ → นับสถิติ |
| `peer:gone` | server→client | อีกฝั่งตัดการเชื่อมต่อ |

---

## ตัวแปรสภาพแวดล้อม

| ตัวแปร | ค่าเริ่มต้น | คำอธิบาย |
|--------|-----------|---------|
| `PORT` | `3000` | พอร์ตของ Node server |
| `NODE_ENV` | — | ตั้ง `production` เพื่อเปิด static cache |

---

## หมายเหตุด้านการใช้งาน

- **File System Access API** (สตรีมลงดิสก์สำหรับไฟล์ใหญ่) รองรับบน Chrome/Edge
  เบราว์เซอร์อื่นจะ fallback เป็น memory blob (เหมาะไฟล์ขนาดเล็กกว่า)
- เพื่อ P2P ผ่าน NAT บางเครือข่าย อาจต้องเพิ่ม TURN server ใน `RTC_CONFIG`
  (`public/js/webrtc.js`) — ดูรายละเอียดที่เอกสาร WebRTC
- การรับไฟล์ของตัวเอง (วนกลับ) ไม่ได้รับการรองรับโดยการออกแบบ
