// public/js/app.js — Orchestrator: เชื่อม UI ↔ WebRTC ↔ Socket.io
// จัดการ state machine ของทั้งฝั่งส่งและฝั่งรับ

const socket = io(); // เชื่อม signaling server
let role = null;     // 'sender' | 'receiver'
let peer = null;     // createSender / createReceiver instance
let code = null;     // รหัส 6 หลักปัจจุบัน

// ---------- shared utility ----------
// จัดรูปแบบขนาดไฟล์ให้อ่านง่าย (ป้องกัน NaN / undefined)
function formatBytes(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1024 * 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
  return (b / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// ---------- ดึง element ฝั่งต่างๆ ----------
const $ = (id) => document.getElementById(id);

// ฝั่งส่ง
const sendZone = $('sendZone');
const fileInput = $('fileInput');
const codeWrapper = $('codeWrapper');
const codeDisplay = $('codeDisplay');
const copyCodeBtn = $('copyCodeBtn');
const sendStatus = $('sendStatus');
// ฝั่งรับ
const codeInputs = Array.from(document.querySelectorAll('.code-digit'));
const receiveBtn = $('receiveBtn');
const receiveStatus = $('receiveStatus');
// overlay การส่ง
const transferOverlay = $('transferOverlay');
const tFileName = $('tFileName');
const tFileSize = $('tFileSize');
const tSpeed = $('tSpeed');
const tProgress = $('tProgress');
const tProgressPct = $('tProgressPct');
const tSent = $('tSent');
const tTotal = $('tTotal');
const ovLabel = $('ovLabel');

// ---------- helper: show/hide transfer overlay ----------
function showTransfer({ name, size, receiving = false }) {
  tFileName.textContent = name;
  tFileSize.textContent = formatBytes(size);
  tTotal.textContent = formatBytes(size);
  tSent.textContent = '0 B';
  tSpeed.textContent = '0.0 MB/s';
  tProgress.style.width = '0%';
  tProgressPct.textContent = '0%';
  ovLabel.textContent = receiving ? 'กำลังรับไฟล์' : 'กำลังส่งไฟล์';
  transferOverlay.classList.remove('hidden');
  transferOverlay.dataset.receiving = receiving ? '1' : '0';
  // เพิ่ม class สำหรับ animation scan line
  transferOverlay.classList.add('active');
}

function hideTransfer() {
  transferOverlay.classList.remove('active');
  transferOverlay.classList.add('hidden');
}

// ---------- ส่งข้อความ signaling ออกผ่าน socket ----------
// server หาอีกฝั่งในห้องให้เอง — ไม่ต้องส่ง `to`
function signalOut(msg) {
  socket.emit('signal', { data: msg });
}

// ====================================================================
// ฝั่งส่ง (SENDER)
// ====================================================================

let pendingFiles = [];

function startSending(files) {
  if (!files || files.length === 0) return;
  if (peer) peer.close();

  role = 'sender';
  pendingFiles = files; // ตั้งก่อน emit — กัน race condition
  socket.emit('room:create'); // ขอรหัส 6 หลักจาก server
  
  const fileText = files.length === 1 
    ? `ไฟล์ "${files[0].name}" (${formatBytes(files[0].size)})`
    : `${files.length} ไฟล์ (รวม ${formatBytes(files.reduce((a, b) => a + b.size, 0))})`;
  sendStatus.textContent = `เลือก ${fileText} · กำลังสร้างรหัส...`;
}

// ผู้ส่ง: server ส่งรหัส 6 หลักกลับมา
socket.on('room:created', ({ code: c }) => {
  code = c;
  codeDisplay.textContent = c.split('').join(' '); // แสดงหลายๆ ตัวเว้นช่อง
  codeWrapper.classList.remove('hidden');
  codeDisplay.classList.add('show-code'); // animation
  
  const fileText = pendingFiles.length === 1 
    ? `ไฟล์ "${pendingFiles[0].name}"`
    : `${pendingFiles.length} ไฟล์`;
  sendStatus.textContent = `เลือก ${fileText} · รอผู้รับกรอกรหัสนี้บนอุปกรณ์อื่น...`;
});

// ====================================================================
// ฝั่งรับ (RECEIVER)
// ====================================================================

function startReceiving(c) {
  role = 'receiver';
  socket.emit('room:join', { code: c });
  receiveStatus.textContent = 'กำลังค้นหาผู้ส่ง...';
}

// ====================================================================
// รวม peer:matched handler เดียว (ทั้ง sender + receiver)
// ====================================================================
socket.on('peer:matched', ({ code: c, role: r }) => {
  if (r === 'sender') {
    sendStatus.textContent = 'ผู้รับเชื่อมต่อแล้ว! กำลังเตรียมส่ง...';

    peer = window.createSender(signalOut, {
      onReady: () => {
        sendStatus.textContent = 'กำลังส่งไฟล์...';
        peer.sendFiles(pendingFiles);
      },
      onFileStart: (meta) => {
        // อัปเดต overlay ทุกครั้งที่เริ่มส่งไฟล์ใหม่ (รองรับหลายไฟล์)
        showTransfer({ name: meta.name, size: meta.size, receiving: false });
      },
      onProgress: (percent, speedMBs, sent, total) => {
        tProgress.style.width = percent.toFixed(1) + '%';
        tProgressPct.textContent = Math.floor(percent) + '%';
        tSpeed.textContent = speedMBs.toFixed(1) + ' MB/s';
        tSent.textContent = formatBytes(sent);
      },
      onDone: ({ files, bytes }) => {
        socket.emit('transfer:done', { files, bytes }); // นับสถิติรวม
        tProgress.style.width = '100%';
        tProgressPct.textContent = '100%';
        sendStatus.textContent = 'ส่งไฟล์เสร็จสมบูรณ์';
        setTimeout(hideTransfer, 2500);
      },
      onError: (msg) => {
        sendStatus.textContent = 'ผิดพลาด: ' + msg;
      },
    });

    peer.start(); // สร้าง offer + ส่งผ่าน signaling; ส่งไฟล์จริงเริ่มใน onReady
  }

  else if (r === 'receiver') {
    peer = window.createReceiver(signalOut, {
      onMeta: (meta) => {
        showTransfer({ name: meta.name, size: meta.size, receiving: true });
      },
      onProgress: (percent, speed, received, total) => {
        tProgress.style.width = percent.toFixed(1) + '%';
        tProgressPct.textContent = Math.floor(percent) + '%';
        tSent.textContent = formatBytes(received);
        tSpeed.textContent = speed.toFixed(1) + ' MB/s';
      },
      onDone: () => {
        tProgress.style.width = '100%';
        tProgressPct.textContent = '100%';
        receiveStatus.textContent = 'รับไฟล์เสร็จสมบูรณ์';
        setTimeout(hideTransfer, 2500);
      },
      onError: (msg) => {
        receiveStatus.textContent = 'ผิดพลาด: ' + msg;
      },
    });

    receiveStatus.textContent = 'กำลังเชื่อมต่อกับผู้ส่ง...';
  }
});

// ====================================================================
// รับข้อความ signaling จากอีกฝั่ง (ส่งต่อเข้า peer)
// ====================================================================
socket.on('signal', ({ data }) => {
  if (!peer) return;
  peer.handleSignal(data);
});

// ====================================================================
// จบการเชื่อมต่อ / ข้อผิดพลาดจาก server
// ====================================================================
socket.on('peer:gone', ({ reason }) => {
  const target = role === 'sender' ? sendStatus : receiveStatus;
  target.textContent = reason === 'peer-disconnected'
    ? 'อีกฝั่งปิดหน้าเว็บหรือขาดการเชื่อมต่อ'
    : 'การเชื่อมต่อสิ้นสุดแล้ว';
  hideTransfer();
  try { peer?.close(); } catch {}
  peer = null;
});

socket.on('room:error', ({ message }) => {
  receiveStatus.textContent = message;
  // animation: shake ช่องรหัสเมื่อผิด
  codeInputs.forEach(el => el.classList.add('shake'));
  setTimeout(() => codeInputs.forEach(el => el.classList.remove('shake')), 600);
});

// ====================================================================
// ผูก event กับ UI
// ====================================================================

// ---- ฝั่งส่ง: คลิก/ลากไฟล์ ----
sendZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => startSending([...e.target.files]));

['dragenter', 'dragover'].forEach((ev) =>
  sendZone.addEventListener(ev, (e) => {
    e.preventDefault();
    sendZone.classList.add('drag');
  })
);
['dragleave', 'drop'].forEach((ev) =>
  sendZone.addEventListener(ev, (e) => {
    e.preventDefault();
    sendZone.classList.remove('drag');
  })
);
sendZone.addEventListener('drop', (e) => {
  const files = [...e.dataTransfer.files];
  if (files.length) startSending(files);
});

// ---- ฝั่งรับ: ช่องกรอกรหัส ----
codeInputs.forEach((input, idx) => {
  input.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 1);
    // animation: bounce เมื่อพิมพ์ตัวเลข
    if (e.target.value) {
      e.target.classList.add('bounce');
      setTimeout(() => e.target.classList.remove('bounce'), 300);
    }
    if (e.target.value && idx < codeInputs.length - 1) codeInputs[idx + 1].focus();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !e.target.value && idx > 0) codeInputs[idx - 1].focus();
    if (e.key === 'Enter') receiveBtn.click(); // Enter = กดรับ
  });
  input.addEventListener('paste', (e) => {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    const digits = text.replace(/\D/g, '').slice(0, 6).split('');
    if (digits.length >= 6) {
      e.preventDefault();
      codeInputs.forEach((el, i) => {
        el.value = digits[i] || '';
        // staggered bounce animation
        if (digits[i]) {
          setTimeout(() => {
            el.classList.add('bounce');
            setTimeout(() => el.classList.remove('bounce'), 300);
          }, i * 60);
        }
      });
      codeInputs[5].focus();
    }
  });
});

function getEnteredCode() {
  return codeInputs.map((i) => i.value).join('');
}

receiveBtn.addEventListener('click', () => {
  const c = getEnteredCode();
  if (c.length !== 6) {
    receiveStatus.textContent = 'กรุณากรอกรหัสให้ครบ 6 หลัก';
    codeInputs.forEach(el => el.classList.add('shake'));
    setTimeout(() => codeInputs.forEach(el => el.classList.remove('shake')), 600);
    return;
  }
  startReceiving(c);
});

// ---- ปิด overlay ----
$('closeTransfer')?.addEventListener('click', () => {
  hideTransfer();
  try { peer?.close(); } catch {}
  peer = null;
  if (role === 'sender') {
    sendStatus.textContent = '';
    codeWrapper.classList.add('hidden');
  } else {
    receiveStatus.textContent = '';
    codeInputs.forEach(i => i.value = '');
  }
});

// ---- คัดลอกรหัส 6 หลัก ----
copyCodeBtn.addEventListener('click', () => {
  if (!code) return;
  navigator.clipboard.writeText(code).then(() => {
    const originalText = copyCodeBtn.textContent;
    copyCodeBtn.textContent = 'คัดลอกแล้ว!';
    copyCodeBtn.classList.add('copied');
    setTimeout(() => {
      copyCodeBtn.textContent = originalText;
      copyCodeBtn.classList.remove('copied');
    }, 2000);
  }).catch(err => {
    console.error('Failed to copy code:', err);
  });
});

// ---- ทำความสะอาดตอนปิดหน้าเว็บ ----
window.addEventListener('beforeunload', () => {
  try { peer?.close(); } catch {}
  socket.disconnect();
});

// expose formatBytes ให้ stats.js ใช้ร่วมกัน
window.relayFormatBytes = formatBytes;
