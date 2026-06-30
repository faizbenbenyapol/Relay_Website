// src/db.js — เก็บสถิติการใช้งานรวม (Global Stats) ด้วย node:sqlite (built-in, ไม่ต้อง compile)
// หมายเหตุ: เก็บเฉพาะตัวเลขยอดรวมเท่านั้น ไม่มีไฟล์หรือข้อมูลดิบของผู้ใช้ผ่านมาเลย
// ⚠️ node:sqlite เป็น experimental API ใน Node.js 22+ — ติดตามสถานะที่ https://nodejs.org/api/sqlite.html

// ตรวจสอบเวอร์ชัน Node.js ก่อนใช้ node:sqlite (ต้อง >= 22)
const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
if (nodeMajor < 22) {
  console.error(`[database] ต้องการ Node.js >= 22 (ปัจจุบัน: ${process.versions.node}) เพื่อใช้งาน node:sqlite`);
  process.exit(1);
}

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// สร้างโฟลเดอร์ data/ ถ้ายังไม่มี (เก็บไฟล์ .db)
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'stats.db'));

// ---- Schema: ตารางเดียว แถวเดียว (singleton) ----
db.exec(`
  CREATE TABLE IF NOT EXISTS global_stats (
    id                          INTEGER PRIMARY KEY CHECK (id = 1),
    total_files_sent            INTEGER NOT NULL DEFAULT 0,
    total_data_transferred      INTEGER NOT NULL DEFAULT 0,
    total_successful_transfers  INTEGER NOT NULL DEFAULT 0,
    updated_at                  INTEGER NOT NULL DEFAULT 0
  );
`);

// มั่นใจว่ามีแถว id=1 อยู่เสมอ
db.exec(`
  INSERT INTO global_stats (id, updated_at)
  VALUES (1, 0)
  ON CONFLICT(id) DO NOTHING;
`);

// ---- Prepared statements ----
const stmtAdd = db.prepare(`
  UPDATE global_stats
  SET total_files_sent           = total_files_sent + :files,
      total_data_transferred     = total_data_transferred + :bytes,
      total_successful_transfers = total_successful_transfers + 1,
      updated_at                 = :now
  WHERE id = 1;
`);

const stmtGet = db.prepare(`
  SELECT total_files_sent, total_data_transferred, total_successful_transfers, updated_at
  FROM global_stats
  WHERE id = 1;
`);

/**
 * บันทึกการโอนสำเร็จ 1 ครั้ง (atomic, นับจากฝั่งผู้ส่งเท่านั้นเพื่อกันนับซ้อน)
 * @param {{ files: number, bytes: number }} payload
 */
function addTransfer({ files, bytes }) {
  const f = Number(files) || 0;
  const b = Number(bytes) || 0;
  if (f <= 0 || b <= 0) return; // ป้องกันขยะ/ค่าผิดปกติ

  // ป้องกันค่าแปลกปลอม เช่น Infinity หรือจำนวนมหาศาลเกินจริง (จำกัดสูงสุด 1,000 ไฟล์ และ 100TB ต่อครั้ง)
  if (!Number.isFinite(f) || !Number.isFinite(b) || f > 1000 || b > 100e12) return;

  try {
    stmtAdd.run({ files: f, bytes: b, now: Date.now() });
  } catch (err) {
    console.error('[database] addTransfer failed to write stats:', err.message);
  }
}

/** ดึงสถิติรวมปัจจุบัน */
function getStats() {
  return stmtGet.get();
}

module.exports = { db, addTransfer, getStats };
