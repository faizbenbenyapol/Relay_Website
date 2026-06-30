// test_runner.js — รันเพื่อทดสอบความสมบูรณ์ในการบันทึกข้อมูลสถิติและการดักจับข้อผิดพลาด

const { addTransfer, getStats, db } = require('./src/db');
const assert = require('assert');

console.log('--- เริ่มการทดสอบระบบฐานข้อมูล ---');

// 1. ดึงสถิติก่อนเริ่มทดสอบ
const initialStats = getStats();
console.log('ค่าสถิติตั้งต้น:', initialStats);
assert.ok(initialStats, 'ต้องมีข้อมูลสถิติตั้งต้น');

// 2. ทดสอบกรณีส่งข้อมูลปกติ
const filesToSend = 5;
const bytesToSend = 1048576 * 10; // 10MB
console.log(`ส่งค่าปกติ: files=${filesToSend}, bytes=${bytesToSend}`);

addTransfer({ files: filesToSend, bytes: bytesToSend });

const statsAfterNormal = getStats();
console.log('สถิติหลังส่งค่าปกติ:', statsAfterNormal);

assert.strictEqual(
  statsAfterNormal.total_files_sent,
  initialStats.total_files_sent + filesToSend,
  'จำนวนไฟล์ควรเพิ่มขึ้นตามจริง'
);
assert.strictEqual(
  statsAfterNormal.total_data_transferred,
  initialStats.total_data_transferred + bytesToSend,
  'ปริมาณข้อมูลควรเพิ่มขึ้นตามจริง'
);
assert.strictEqual(
  statsAfterNormal.total_successful_transfers,
  initialStats.total_successful_transfers + 1,
  'จำนวนครั้งการโอนย้ายสำเร็จควรเพิ่มขึ้น 1 ครั้ง'
);

// 3. ทดสอบการดักจับค่าขยะ / ข้อมูลประสงค์ร้าย (เช่น ค่าติดลบ, Infinity, หรือตัวเลขเกินขีดจำกัด)
const testCases = [
  { files: -1, bytes: 100 },
  { files: 5, bytes: -100 },
  { files: Infinity, bytes: 500 },
  { files: 5, bytes: Infinity },
  { files: 2000, bytes: 500 }, // เกิน 1,000 ไฟล์
  { files: 5, bytes: 200e12 }, // เกิน 100TB
  { files: 'five', bytes: 'huge' }
];

testCases.forEach((tc, idx) => {
  console.log(`ทดสอบเคสประสงค์ร้าย/ขยะ #${idx + 1}: files=${tc.files}, bytes=${tc.bytes}`);
  addTransfer(tc);
});

const statsAfterMalicious = getStats();
console.log('สถิติหลังทดสอบเคสประสงค์ร้าย:', statsAfterMalicious);

// ยืนยันว่าค่าสถิติต้องไม่เปลี่ยนแปลงจากหลังเคสปกติ
assert.strictEqual(
  statsAfterMalicious.total_files_sent,
  statsAfterNormal.total_files_sent,
  'จำนวนไฟล์ต้องเท่าเดิม'
);
assert.strictEqual(
  statsAfterMalicious.total_data_transferred,
  statsAfterNormal.total_data_transferred,
  'ปริมาณข้อมูลต้องเท่าเดิม'
);
assert.strictEqual(
  statsAfterMalicious.total_successful_transfers,
  statsAfterNormal.total_successful_transfers,
  'จำนวนครั้งต้องเท่าเดิม'
);

console.log('🟢 ทุกการทดสอบฝั่ง Database และตรรกะ Sanitization ผ่าน 100%!');
