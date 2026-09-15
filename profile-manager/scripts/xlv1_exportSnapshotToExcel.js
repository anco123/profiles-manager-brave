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

async function exportSnapshotToExcel() {
  const fs = require('fs');
  const XLSX = require('@e965/xlsx');
  const { EXCEL_SNAPSHOT_FILE, EXCEL_RESULTS_FILE } = require('./datapaths');

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

    // Header dùng chữ cái cột (A, B, C...) -- snapshot hiện tại không
    // lưu tên cột gốc thật (VD "Username"), chỉ có dữ liệu theo chữ
    // cái cột.
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    XLSX.writeFile(workbook, EXCEL_RESULTS_FILE);

    return EXCEL_RESULTS_FILE;
  } finally {
    fs.unlinkSync(lockFile); // LUÔN mở khoá, kể cả lỗi giữa chừng
  }
}

module.exports = { exportSnapshotToExcel };