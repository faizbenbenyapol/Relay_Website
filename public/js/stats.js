// public/js/stats.js — ดึง + แสดงสถิติรวม (Global Stats) ที่ footer แบบ real-time

const statsEls = {
  files: document.getElementById('statFiles'),
  data: document.getElementById('statData'),
  transfers: document.getElementById('statTransfers'),
};

// จัดรูปแบบปริมาณข้อมูล — ใช้ formatBytes ร่วมกับ app.js (ป้องกัน NaN)
function formatData(bytes) {
  if (window.relayFormatBytes) return window.relayFormatBytes(bytes);
  // fallback ถ้า app.js ยังไม่โหลด
  const b = Number(bytes) || 0;
  if (b < 1024) return b + ' B';
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let val = b / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return val.toFixed(val >= 100 ? 0 : 1) + ' ' + units[i];
}

// เพิ่มจำนวนด้วย comma แบบเรียบ
function formatCount(n) {
  return Number(n).toLocaleString('en-US');
}

// อัปเดต UI จาก object สถิติ
function renderStats(s) {
  if (!s) return;
  if (statsEls.files) statsEls.files.textContent = formatCount(s.total_files_sent);
  if (statsEls.data) statsEls.data.textContent = formatData(s.total_data_transferred);
  if (statsEls.transfers) statsEls.transfers.textContent = formatCount(s.total_successful_transfers);
}

// ดึงครั้งแรก + ตั้งโพลทุก 15 วินาที (น้ำหนักเบา)
async function pollStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    renderStats(data);
  } catch (err) {
    console.warn('[relay:stats] poll failed:', err.message);
  }
}

// ฟังสถิติแบบ push (เมื่อมีการส่งไฟล์สำเร็จ → รีเฟรชทันที)
window.refreshStats = pollStats;

// อัปเดตทันทีที่โหลด + ตั้ง interval
pollStats();
setInterval(pollStats, 15000);
