/**
 * scripts/exportSnapshotToExcel.js
 * -----------------------------------------------------------------------
 * Chuyển TOÀN BỘ snapshot JSON hiện tại (data/excel-snapshot.json) thành
 * 1 file .xlsx THẬT (data/excel-results.xlsx) -- mở trực tiếp bằng Excel
 * được. KHÁC với đoạn tự sinh .xlsx bên trong writeExcelCell.js (chỉ
 * chạy "tiện thể" mỗi lần ghi 1 ô) -- hàm này gọi ĐỘC LẬP, bất cứ lúc
 * nào cần (VD: sau khi CẢ QUEUE chạy xong, không phải sau mỗi lần ghi
 * 1 ô riêng lẻ).
 *
 * Dùng chung khoá file với writeExcelCell.js (cùng 1 file .lock) --
 * tránh đọc trúng lúc snapshot đang được ghi dở bởi 1 profile khác.
 *
 * Usage:
 *   const { exportSnapshotToExcel } = require('./exportSnapshotToExcel');
 *   const outputPath = await exportSnapshotToExcel();
 *   log(`Đã xuất ra: ${outputPath}`);
 * -----------------------------------------------------------------------
 */

// Ghi `rows` (snapshot: mỗi dòng là { A: ..., B: ..., M: ... }) ra excel-results.xlsx -- KHÔNG tự lấy khoá, nơi gọi phải đang giữ khoá.
// Đặt từng giá trị ĐÚNG cột theo chữ cái (cột M nằm ở cột M thật), dòng 1 là tiêu đề gốc của file import (thiếu thì dùng chữ cái cột).
// Trước đây dùng json_to_sheet: cột xếp theo THỨ TỰ GHI chứ không theo chữ cái -- ghi cột P (ngoài phạm vi file gốc) trước cột M thì
// giá trị P nằm ở cột M thật, M bị đẩy sang N; và dòng tiêu đề chỉ còn A, B, C...
function writeResultsXlsx(rows) {
  const fs = require('fs');
  const XLSX = require('@e965/xlsx');
  const { EXCEL_RESULTS_FILE, EXCEL_HEADER_FILE } = require('./datapaths');
  let header = {};
  try { header = JSON.parse(fs.readFileSync(EXCEL_HEADER_FILE, 'utf-8')) || {}; } catch (e) {}
  const letters = new Set(Object.keys(header));
  rows.forEach((r) => Object.keys(r || {}).forEach((k) => letters.add(k)));
  const cols = [...letters].filter((k) => /^[A-Z]+$/.test(k)).sort((a, b) => XLSX.utils.decode_col(a) - XLSX.utils.decode_col(b));
  const width = cols.length ? XLSX.utils.decode_col(cols[cols.length - 1]) + 1 : 0;
  const line = (get) => { const out = new Array(width).fill(''); cols.forEach((c) => { out[XLSX.utils.decode_col(c)] = get(c); }); return out; };
  const aoa = [line((c) => (header[c] !== undefined && header[c] !== '' ? header[c] : c)), ...rows.map((r) => line((c) => (r && r[c] !== undefined ? r[c] : '')))];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1');
  XLSX.writeFile(workbook, EXCEL_RESULTS_FILE);
  return EXCEL_RESULTS_FILE;
}

async function exportSnapshotToExcel() {
  const fs = require('fs');
  const { EXCEL_SNAPSHOT_FILE } = require('./datapaths');

  const lockFile = EXCEL_SNAPSHOT_FILE + '.lock';
  const maxLockAttempts = 30;
  const lockRetryDelayMs = 200;
  const staleLockMs = 30000; // khoá cũ hơn 30s coi như bị bỏ rơi (process giữ khoá đã crash) -- tự dọn, không kẹt vĩnh viễn

  let locked = false;
  for (let attempt = 0; attempt < maxLockAttempts; attempt++) {
    try {
      fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
      locked = true;
      break;
    } catch (e) {
      try {
        const stat = fs.statSync(lockFile);
        if (Date.now() - stat.mtimeMs > staleLockMs) {
          fs.unlinkSync(lockFile);
        }
      } catch (e2) { /* lock file vừa bị process khác xoá giữa lúc kiểm tra -- bỏ qua, thử lại vòng sau */ }
      await new Promise((resolve) => setTimeout(resolve, lockRetryDelayMs));
    }
  }

  if (!locked) {
    throw new Error(`[exportSnapshotToExcel] Không lấy được khoá đọc sau ${maxLockAttempts} lần thử -- có process khác đang giữ khoá quá lâu.`);
  }

  try {
    if (!fs.existsSync(EXCEL_SNAPSHOT_FILE)) {
      throw new Error('[exportSnapshotToExcel] Chưa có snapshot Excel -- import lại file Excel trên giao diện trước khi chạy.');
    }
    const rows = JSON.parse(fs.readFileSync(EXCEL_SNAPSHOT_FILE, 'utf-8'));
    return writeResultsXlsx(rows);
  } finally {
    fs.unlinkSync(lockFile); // LUÔN mở khoá, kể cả lỗi giữa chừng
  }
}

module.exports = { exportSnapshotToExcel, writeResultsXlsx };