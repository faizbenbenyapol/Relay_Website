// public/js/webrtc.js — หัวใจ P2P: RTCPeerConnection + DataChannel
// - ส่งไฟล์เป็น chunk เล็กๆ (chunking) เพื่อไม่ให้ RAM บวม
// - ควบคุมปริมาณด้วย bufferedAmount (flow control) → รองรับไฟล์ขนาดไม่จำกัด
// - ฝั่งรับเขียนลงดิสก์ผ่าน File System Access API (สตรีมตรง, ไม่เก็บใน RAM)
// - WebRTC มี DTLS = end-to-end encrypted อยู่แล้วโดยธรรมชาติ
// UI เรียกผ่าน hooks: onReady / onMeta / onProgress / onDone / onError

const RTC_CONFIG = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

const CHUNK_SIZE = 64 * 1024;          // 64KB ต่อ chunk
const BUFFER_HIGH = 1 * 1024 * 1024;   // หยุดส่งชั่วคราวเมื่อ buffer >= 1MB
const BUFFER_LOW = 256 * 1024;         // ส่งต่อเมื่อ buffer ลดลงถึง 256KB

// ---------- ผู้ส่ง ----------
// signalingSend: (msg) => void  — ส่งข้อความ signaling ผ่าน socket
// hooks: { onReady, onProgress(percent, speedMBs, sentBytes, totalBytes), onDone, onError }
function createSender(signalingSend, hooks = {}) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  let dc; // DataChannel
  let filesCount = 0;
  let totalBytesSent = 0;

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      hooks.onError?.('การเชื่อมต่อขาดหรือล้มเหลว');
    }
  };

  // รับข้อความ signaling จากผู้รับ (answer/ICE) จาก app.js
  async function handleSignal(data) {
    try {
      if (data.type === 'answer') {
        // คำตอบเป็น { type, sdp } — ใช้ sdp เป็น RTCSessionDescription
        const desc = data.sdp ? data.sdp : data;
        await pc.setRemoteDescription(desc);
      } else if (data.candidate) {
        await pc.addIceCandidate(data);
      }
    } catch (err) {
      hooks.onError?.('จัดการสัญญาณฝั่งส่งล้มเหลว: ' + err.message);
    }
  }

  // เริ่มต้น: สร้าง datachannel + offer → ส่งให้ผู้รับผ่าน signaling
  async function start() {
    try {
      dc = pc.createDataChannel('file', { ordered: true });
      dc.binaryType = 'arraybuffer';
      dc.bufferedAmountLowThreshold = BUFFER_LOW;

      // สำคัญ: เริ่มส่งไฟล์เมื่อ datachannel เปิด
      dc.onopen = () => hooks.onReady?.();
      
      // ดักฟังข้อความตอบกลับจากผู้รับเมื่อได้รับไฟล์ครบถ้วนแล้ว
      dc.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'ack') {
            hooks.onDone?.({ files: filesCount, bytes: totalBytesSent });
          }
        } catch (err) {}
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // รอ ICE gathering เสร็จก่อนส่ง offer (ลด round-trip)
      await waitForIce(pc);
      signalingSend({ type: 'offer', sdp: pc.localDescription });
    } catch (err) {
      hooks.onError?.('ล้มเหลวในการเตรียมการเชื่อมต่อ: ' + err.message);
    }
  }

  // ส่งไฟล์ทีละชิ้น พร้อม flow control
  async function sendFiles(files) {
    if (!dc || dc.readyState !== 'open') {
      return hooks.onError?.('ช่องส่งข้อมูลยังไม่พร้อม');
    }

    const totalSize = files.reduce((s, f) => s + f.size, 0);
    filesCount = files.length;
    totalBytesSent = totalSize;
    let sentBytes = 0;
    let lastTime = performance.now();
    let lastBytes = 0;

    try {
      for (const file of files) {
        // 1) แจ้ง UI ว่าเริ่มส่งไฟล์ใหม่ (สำหรับกรณีส่งหลายไฟล์)
        hooks.onFileStart?.({ name: file.name, size: file.size, mime: file.type || 'application/octet-stream' });

        // 2) ส่ง metadata ก่อน
        dc.send(JSON.stringify({
          type: 'meta',
          name: file.name,
          size: file.size,
          mime: file.type || 'application/octet-stream',
        }));

        // 2) สตรีมเนื้อไฟล์เป็น chunk
        let offset = 0;
        while (offset < file.size) {
          // flow control: รอถ้า buffer มากเกินไป
          if (dc.bufferedAmount > BUFFER_HIGH) {
            await waitForLowBuffer(dc);
          }

          const slice = file.slice(offset, offset + CHUNK_SIZE);
          const buf = await slice.arrayBuffer();
          dc.send(buf);
          offset += buf.byteLength;
          sentBytes += buf.byteLength;

          // 3) รายงานความคืบหน้า + ความเร็ว
          const now = performance.now();
          if (now - lastTime >= 250) { // อัปเดตทุก ~250ms
            const dt = (now - lastTime) / 1000;
            const dBytes = sentBytes - lastBytes;
            const speedMBs = (dBytes / dt) / (1024 * 1024);
            hooks.onProgress?.(
              (sentBytes / totalSize) * 100,
              speedMBs,
              sentBytes,
              totalSize
            );
            lastTime = now;
            lastBytes = sentBytes;
          }
        }
        // ส่งสัญญาณจบไฟล์นี้
        dc.send(JSON.stringify({ type: 'file-end' }));
      }

      // 4) ส่งเสร็จทั้งหมด (ฝั่งส่งจะรอการยืนยัน ACK จากฝั่งรับทาง onmessage ก่อนจบจริง)
      dc.send(JSON.stringify({ type: 'done', files: files.length, bytes: totalSize }));
    } catch (err) {
      hooks.onError?.('การส่งไฟล์ล้มเหลว: ' + err.message);
    }
  }

  function close() {
    try { dc?.close(); } catch {}
    try { pc.close(); } catch {}
  }

  return { start, handleSignal, sendFiles, close };
}

// ---------- ผู้รับ ----------
// signalingSend, hooks: { onReady, onMeta(file), onProgress(percent, speedMBs, received, total), onDone, onError }
function createReceiver(signalingSend, hooks = {}) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  let dc;
  let sink = null;     // stream sink (File System Access หรือ memory blob)
  let chunks = [];     // fallback กรณีไม่รองรับ File System Access API
  let current = null;  // metadata ของไฟล์ปัจจุบัน
  let received = 0;
  let lastTime = performance.now();
  let lastBytes = 0;
  let lastSpeed = 0;

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') hooks.onError?.('การเชื่อมต่อล้มเหลว');
  };

  pc.ondatachannel = (event) => {
    dc = event.channel;
    dc.binaryType = 'arraybuffer';
    dc.onmessage = onMessage;
    dc.onopen = () => hooks.onReady?.();
    dc.onclose = () => finalize?.(true);
  };

  async function onMessage(event) {
    const data = event.data;

    // 1) ข้อความควบคุมเป็น string
    if (typeof data === 'string') {
      let msg;
      try { msg = JSON.parse(data); } catch { return; } // ข้ามข้อความไม่รู้จัก
      if (msg.type === 'meta') {
        current = msg;
        received = 0;
        chunks = [];
        lastTime = performance.now();
        lastBytes = 0;
        lastSpeed = 0;
        try {
          sink = await openSink(msg);
          hooks.onMeta?.(msg);
        } catch (err) {
          hooks.onError?.('ไม่สามารถบันทึกไฟล์หรือการเขียนไฟล์ล้มเหลว: ' + err.message);
          close(); // ปิด datachannel และ RTCPeerConnection ทันทีเพื่อหยุดรับส่งข้อมูล
          return;
        }
      } else if (msg.type === 'file-end') {
        await sink?.close?.();
        sink = null;
      } else if (msg.type === 'done') {
        finalize(false);
        // ส่งข้อความ acknowledgment (ack) กลับไปยังฝั่งส่ง เพื่อยืนยันว่าฝั่งรับบันทึกไฟล์/สร้างไฟล์ลงดิสก์เสร็จสมบูรณ์แล้ว
        try {
          dc.send(JSON.stringify({ type: 'ack' }));
        } catch (err) {}
        hooks.onDone?.(msg);
      }
      return;
    }

    // 2) chunk ไบนารี → เขียนลง sink
    if (sink) {
      await sink.write(data);
    } else {
      chunks.push(data); // fallback
    }
    received += data.byteLength;

    if (current) {
      const now = performance.now();
      if (now - lastTime >= 250) {
        const dt = (now - lastTime) / 1000;
        const dBytes = received - lastBytes;
        lastSpeed = (dBytes / dt) / (1024 * 1024);
        lastTime = now;
        lastBytes = received;
      }
      hooks.onProgress?.(
        (received / current.size) * 100,
        lastSpeed,
        received,
        current.size
      );
    }
  }

  // เปิด sink: ใช้ File System Access API (สตรีมตรงเข้าดิสก์) ถ้ารองรับ
  // ไม่งั้นเก็บใน memory blob (เหมาะไฟล์เล็กเท่านั้น)
  async function openSink(meta) {
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: meta.name,
        });
        return await handle.createWritable();
      } catch (e) {
        if (e.name === 'AbortError') throw e; // ผู้ใช้ยกเลิก
        // ไม่รองรับ/ถูกบล็อก → ใช้ memory แทน
      }
    }
    return {
      _mem: true,
      async write(chunk) { chunks.push(chunk); },
      async close() {},
    };
  }

  // ปิด/บันทึกไฟล์ (กรณีใช้ memory)
  let finalize = (closedByPeer) => {
    if (closedByPeer && current) {
      hooks.onError?.('การเชื่อมต่อขาดหาย ไฟล์ที่ได้รับอาจไม่สมบูรณ์');
    }
    // ใช้ chunks.length แทนการตรวจสอบ sink?._mem เนื่องจากในขั้นตอน file-end เรามีการตั้งค่า sink = null ไปแล้ว
    if (!closedByPeer && chunks.length && current) {
      const blob = new Blob(chunks, { type: current.mime });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = current.name;
      a.click();
      URL.revokeObjectURL(a.href);
    }
    chunks = [];
    current = null;
    received = 0;
  };

  // รับ offer จากผู้ส่ง → สร้าง answer ส่งกลับ
  async function handleSignal(data) {
    try {
      if (data.type === 'offer') {
        await pc.setRemoteDescription(data.sdp ? data.sdp : data);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await waitForIce(pc);
        signalingSend({ type: 'answer', sdp: pc.localDescription });
      } else if (data.candidate) {
        await pc.addIceCandidate(data);
      }
    } catch (err) {
      hooks.onError?.('จัดการสัญญาณล้มเหลว: ' + err.message);
    }
  }

  function close() {
    try { dc?.close(); } catch {}
    try { pc.close(); } catch {}
  }

  return { handleSignal, close };
}

// ---------- helpers ----------
// รอ ICE gathering เสร็จ (เพื่อส่ง SDP ที่สมบูรณ์ในครั้งเดียว)
function waitForIce(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (pc.iceGatheringState === 'complete') {
        cleanup();
      }
    };
    const timer = setTimeout(() => {
      cleanup();
    }, 1500);

    function cleanup() {
      pc.removeEventListener('icegatheringstatechange', check);
      clearTimeout(timer);
      resolve();
    }
    pc.addEventListener('icegatheringstatechange', check);
  });
}

// รอจน bufferedAmount ลดต่ำลง (flow control ฝั่งส่ง)
function waitForLowBuffer(dc) {
  if (dc.readyState !== 'open' || dc.bufferedAmount <= BUFFER_LOW) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onLow = () => {
      dc.removeEventListener('close', onClose);
      resolve();
    };
    const onClose = () => {
      dc.removeEventListener('bufferedamountlow', onLow);
      reject(new Error('Data channel closed while waiting for buffer'));
    };
    dc.addEventListener('bufferedamountlow', onLow, { once: true });
    dc.addEventListener('close', onClose, { once: true });
  });
}

// expose
window.createSender = createSender;
window.createReceiver = createReceiver;
