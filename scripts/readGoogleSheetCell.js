/**
 * scripts/readGoogleSheetCell.js
 * -----------------------------------------------------------------------
 * Đọc giá trị tại 1 ô từ snapshot Google Sheet đã sync
 * (data/google-sheet-snapshot.json -- xem datapaths.js, syncGoogleSheet.js,
 * POST /api/google-sheet-sync trong server.js).
 *
 *   - CỘT: bạn tự nhập TÊN CỘT (đúng chữ ở dòng 1 của Google Sheet, không
 *     phân biệt hoa/thường, bỏ khoảng trắng thừa). Chữ cột kiểu 'D' vẫn
 *     dùng được nếu không có cột nào tên trùng.
 *   - DÒNG: truyền số dòng, HOẶC truyền thẳng object input của dòng đang
 *     chạy (có __excelRow) -- tức DÒNG HIỆN TẠI giống dòng đang lấy giá
 *     trị ở Excel. Số dòng Google Sheet = số dòng Excel (cùng đánh số
 *     từ dòng 1 = header).
 *
 * Nguồn THỨ HAI, hoàn toàn tách riêng khỏi Excel (không đụng
 * excel-snapshot.json). Hàm ĐỒNG BỘ (không async), giống readExcelCell.js.
 *
 * Usage:
 *   const { readGoogleSheetCell } = require('./readGoogleSheetCell');
 *   // `row` = object dòng hiện tại như main.js đang dùng (có row.__excelRow)
 *   const v1 = readGoogleSheetCell(row, 'username'); // dòng hiện tại + tên cột
 *   const v2 = readGoogleSheetCell(202, 'username'); // hoặc số dòng cụ thể
 *   const v3 = readGoogleSheetCell(202, 'D');        // hoặc chữ cột
 *   // Sheet có NHIỀU TAB (VD REPLY, POST): truyền tên tab làm tham số thứ 3
 *   const reply = readGoogleSheetCell(row, 'content', 'REPLY');
 *   const post  = readGoogleSheetCell(row, 'content', 'POST');
 * -----------------------------------------------------------------------
 */

function normalizeHeader(text) {
  return String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function readGoogleSheetCell(rowOrInput, column, tabName) {
  const fs = require('fs');
  const { GOOGLE_SHEET_SNAPSHOT_FILE } = require('./datapaths');

  const sheetRowNumber = typeof rowOrInput === 'object' && rowOrInput !== null ? rowOrInput.__excelRow : rowOrInput;
  if (!Number.isInteger(sheetRowNumber)) {
    throw new Error(
      '[readGoogleSheetCell] Thiếu số dòng -- truyền số dòng, hoặc object input có __excelRow ' +
      '(dòng phải được IMPORT từ Excel, không phải gõ tay).'
    );
  }
  if (!fs.existsSync(GOOGLE_SHEET_SNAPSHOT_FILE)) {
    throw new Error('[readGoogleSheetCell] Chưa có snapshot Google Sheet -- bấm "Sync Google Sheet" trên giao diện trước khi chạy.');
  }

  const snapshot = JSON.parse(fs.readFileSync(GOOGLE_SHEET_SNAPSHOT_FILE, 'utf-8'));
  // 3 dạng snapshot: { tabs: {TÊN: {headers, rows}} } (mới, nhiều tab) |
  // { headers, rows } (1 tab, bản trước) | mảng trần (bản cũ nhất, chưa có header) -- 2 dạng sau vẫn đọc được.
  const tabs = snapshot.tabs || { '': Array.isArray(snapshot) ? { headers: null, rows: snapshot } : { headers: snapshot.headers || {}, rows: snapshot.rows } };
  const tabNames = Object.keys(tabs);
  let tab;
  if (tabName === undefined || tabName === null || String(tabName).trim() === '') {
    if (tabNames.length > 1) throw new Error(`[readGoogleSheetCell] Snapshot có nhiều tab (${tabNames.map((n) => `"${n}"`).join(', ')}) -- truyền tên tab làm tham số thứ 3, VD readGoogleSheetCell(row, 'cột', '${tabNames[0]}').`);
    tab = tabs[tabNames[0]];
  } else {
    const key = tabNames.find((n) => normalizeHeader(n) === normalizeHeader(tabName));
    if (key === undefined) throw new Error(`[readGoogleSheetCell] Không có tab "${tabName}" trong snapshot -- các tab đã sync: ${tabNames.map((n) => `"${n}"`).join(', ') || '(không có)'}. Bấm "Sync Google Sheet" lại nếu vừa thêm tab.`);
    tab = tabs[key];
  }
  const rows = tab.rows;
  const headers = tab.headers;

  const wanted = normalizeHeader(column);
  let columnLetter = null;
  if (headers) {
    columnLetter = Object.keys(headers).find((letter) => normalizeHeader(headers[letter]) === wanted) || null;
  }
  if (!columnLetter && /^[A-Za-z]{1,3}$/.test(String(column).trim())) {
    columnLetter = String(column).trim().toUpperCase();
  }
  if (!columnLetter) {
    const available = headers ? Object.values(headers).map((h) => `"${h}"`).join(', ') : '(snapshot cũ chưa có header -- bấm Sync Google Sheet lại)';
    throw new Error(`[readGoogleSheetCell] Không tìm thấy cột "${column}" -- các cột hiện có ở dòng 1: ${available}.`);
  }

  const arrayIndex = sheetRowNumber - 2; // dòng 1 là header -- rows[0] ứng với dòng số 2
  if (arrayIndex < 0 || arrayIndex >= rows.length) {
    throw new Error(`[readGoogleSheetCell] Dòng số ${sheetRowNumber} không tồn tại (snapshot có dữ liệu từ dòng 2 đến dòng ${rows.length + 1}).`);
  }

  return rows[arrayIndex][columnLetter];
}

module.exports = { readGoogleSheetCell };
