/**
 * scripts/readExcelCell.js
 * -----------------------------------------------------------------------
 * Đọc giá trị tại ĐÚNG 1 ô (dòng + cột) từ snapshot Excel đã import
 * (data/excel-snapshot.json -- xem dataPaths.js, POST /api/excel-snapshot
 * trong server.js). Dùng chung cho mọi script cần đọc dữ liệu ở 1 dòng
 * KHÁC với dòng đang chạy -- VD xlv3_follow_friends.js đọc username ở
 * dòng lùi Y so với dòng hiện tại.
 *
 * KHÔNG cần khoá file như writeExcelCell.js -- đọc đồng thời không có
 * rủi ro "2 process cùng ghi đè nhau" như lúc viết, dù nhiều profile
 * chạy song song cùng đọc snapshot 1 lúc vẫn an toàn.
 *
 * Đây là hàm ĐỒNG BỘ (không async) -- không có thao tác chờ/khoá nào
 * cần await, khác với writeExcelCell.js.
 *
 * Usage:
 *   const { readExcelCell } = require('./readExcelCell');
 *   const targetUsername = readExcelCell(202, 'D'); // đọc cột D, dòng Excel số 202
 * -----------------------------------------------------------------------
 */

function readExcelCell(excelRowNumber, columnLetter) {
  const fs = require('fs');
  const { EXCEL_SNAPSHOT_FILE } = require('./datapaths');

  if (!fs.existsSync(EXCEL_SNAPSHOT_FILE)) {
    throw new Error('[readExcelCell] Chưa có snapshot Excel -- import lại file Excel trên giao diện trước khi chạy.');
  }

  const rows = JSON.parse(fs.readFileSync(EXCEL_SNAPSHOT_FILE, 'utf-8'));
  const arrayIndex = excelRowNumber - 2; // dòng 1 là header -- rows[0] ứng với dòng Excel số 2
  if (arrayIndex < 0 || arrayIndex >= rows.length) {
    throw new Error(`[readExcelCell] Dòng Excel số ${excelRowNumber} không tồn tại (snapshot có dữ liệu từ dòng 2 đến dòng ${rows.length + 1}).`);
  }

  return rows[arrayIndex][columnLetter];
}

module.exports = { readExcelCell };