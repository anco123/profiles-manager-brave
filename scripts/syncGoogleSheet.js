/**
 * scripts/syncGoogleSheet.js
 * -----------------------------------------------------------------------
 * Kéo dữ liệu từ 1 Google Sheet (riêng tư, qua Service Account) về và
 * lưu thành snapshot JSON tại GOOGLE_SHEET_SNAPSHOT_FILE -- ĐÚNG CÙNG
 * ĐỊNH DẠNG mà xlsx-worker.js tạo ra cho Excel (mảng object theo CỘT
 * CHỮ, ví dụ row['D'], bỏ dòng 1 vì đó là header) -- để
 * readGoogleSheetCell.js có thể dùng lại nguyên cách đọc của
 * readExcelCell.js, chỉ đổi file nguồn.
 *
 * ĐÂY LÀ NGUỒN THỨ HAI, HOÀN TOÀN TÁCH RIÊNG khỏi Excel -- không đọc,
 * không ghi, không đụng tới excel-snapshot.json/excel-results.xlsx.
 *
 * Được server.js gọi (require() thường, KHÔNG qua scopedRequire, vì đây
 * chạy ở phía server, không phải trong 1 script người dùng dán vào Run
 * modal) -- xem POST /api/google-sheet-sync.
 *
 * Nhiều tab (VD "REPLY" và "POST"): mỗi tab lưu riêng trong snapshot, đọc
 * bằng readGoogleSheetCell(row, 'tên cột', 'tên tab').
 *
 * Cần:
 *   - File key Service Account tại GOOGLE_SERVICE_ACCOUNT_FILE (xem
 *     datapaths.js) -- JSON tải từ Google Cloud Console, scope chỉ cần
 *     "spreadsheets.readonly" vì đây chỉ ĐỌC.
 *   - Google Sheet đó đã được Share (quyền Viewer là đủ) cho đúng email
 *     "client_email" bên trong file key.
 *
 * Usage:
 *   const { syncGoogleSheetToSnapshot } = require('./syncGoogleSheet');
 *   const { rowCount, sheetName } = await syncGoogleSheetToSnapshot(spreadsheetId, sheetName);
 * -----------------------------------------------------------------------
 */

const fs = require('fs');
const { GOOGLE_SERVICE_ACCOUNT_FILE, GOOGLE_SHEET_SNAPSHOT_FILE } = require('./datapaths');

/** 0-based column index -> chữ cột kiểu spreadsheet (0 -> 'A', 25 -> 'Z', 26 -> 'AA', ...). */
function columnIndexToLetter(index) {
  let letter = '';
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

/**
 * values: mảng 2 chiều y hệt response.data.values của Sheets API (mỗi
 * dòng là 1 mảng, Google TỰ CẮT BỎ các cell trống ở CUỐI dòng -- các
 * dòng có thể dài khác nhau). Chuyển thành mảng object theo cột chữ,
 * lấy chiều rộng theo dòng DÀI NHẤT trong cả sheet (giống cách
 * xlsx-worker.js lấy "used range" của cả sheet, không phải riêng từng
 * dòng), cell thiếu = '' (defval giống xlsx-worker.js dùng defval:'').
 * Bỏ dòng 1 (header) -- dữ liệu thật bắt đầu từ dòng 2, y hệt Excel.
 */
function convertSheetValuesToSnapshotRows(values) {
  if (!Array.isArray(values) || values.length === 0) return [];

  const maxCols = values.reduce((max, row) => Math.max(max, row.length), 0);
  const columnLetters = [];
  for (let c = 0; c < maxCols; c++) columnLetters.push(columnIndexToLetter(c));

  const dataRows = values.slice(1); // dòng 1 = header, bỏ ra -- rows[0] ứng với dòng Sheet số 2
  return dataRows.map((row) => {
    const obj = {};
    columnLetters.forEach((letter, idx) => {
      const cell = row[idx];
      obj[letter] = cell === undefined || cell === null ? '' : cell;
    });
    return obj;
  });
}

/**
 * Dòng 1 (header) của sheet -> { A: 'username', B: 'status', ... } -- để
 * readGoogleSheetCell.js tra cột THEO TÊN (tên cột bạn tự nhập) thay vì
 * bắt buộc nhớ chữ cột. Cột nào header trống thì không có key.
 */
function convertSheetValuesToHeaders(values) {
  const headers = {};
  const headerRow = Array.isArray(values) && Array.isArray(values[0]) ? values[0] : [];
  headerRow.forEach((cell, idx) => {
    const text = cell === undefined || cell === null ? '' : String(cell).trim();
    if (text) headers[columnIndexToLetter(idx)] = text;
  });
  return headers;
}

/** "REPLY, POST" -> ['REPLY','POST'] (cách nhau dấu phẩy; trống -> []). */
function parseTabNames(sheetName) {
  return String(sheetName || '').split(',').map((name) => name.trim()).filter(Boolean);
}

/**
 * Lấy dữ liệu thô từ Google Sheet -- KHÔNG tự ghi file. sheetName có thể là
 * 1 tab ("REPLY"), nhiều tab cách nhau dấu phẩy ("REPLY, POST"), hoặc để
 * trống = TẤT CẢ các tab của Sheet. Trả về { 'REPLY': {headers, rows}, ... }.
 */
async function fetchGoogleSheetTabs(spreadsheetId, sheetName) {
  if (!spreadsheetId) {
    throw new Error('[syncGoogleSheet] Thiếu spreadsheetId.');
  }
  if (!fs.existsSync(GOOGLE_SERVICE_ACCOUNT_FILE)) {
    throw new Error(
      `[syncGoogleSheet] Chưa có file key Service Account tại ${GOOGLE_SERVICE_ACCOUNT_FILE} -- ` +
      `xem hướng dẫn tạo Service Account + share quyền Viewer cho đúng email đó.`
    );
  }

  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({
    keyFile: GOOGLE_SERVICE_ACCOUNT_FILE,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  let tabNames = parseTabNames(sheetName);
  if (tabNames.length === 0) {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    tabNames = (meta.data.sheets || []).map((sheet) => sheet.properties.title);
    if (tabNames.length === 0) throw new Error('[syncGoogleSheet] Spreadsheet không có tab nào.');
  }

  const tabs = {};
  for (const tabName of tabNames) {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: tabName });
    const values = res.data.values || [];
    tabs[tabName] = { headers: convertSheetValuesToHeaders(values), rows: convertSheetValuesToSnapshotRows(values) };
  }
  return tabs;
}

/**
 * Lấy dữ liệu rồi ghi luôn ra GOOGLE_SHEET_SNAPSHOT_FILE -- dùng bởi POST
 * /api/google-sheet-sync. Định dạng file: { tabs: { 'REPLY': {headers:
 * {A:'tên cột',...}, rows:[...]}, 'POST': {...} } }. Mỗi lần sync GHI ĐÈ
 * toàn bộ file bằng đúng các tab vừa lấy (sync riêng "REPLY" thì "POST"
 * cũ bị bỏ) -- muốn giữ cả hai thì để trống ô tên tab hoặc nhập "REPLY, POST".
 */
async function syncGoogleSheetToSnapshot(spreadsheetId, sheetName) {
  const tabs = await fetchGoogleSheetTabs(spreadsheetId, sheetName);
  fs.writeFileSync(GOOGLE_SHEET_SNAPSHOT_FILE, JSON.stringify({ tabs }));
  const names = Object.keys(tabs);
  return { rowCount: names.reduce((sum, name) => sum + tabs[name].rows.length, 0), sheetName: names.join(', ') };
}

module.exports = {
  fetchGoogleSheetTabs,
  syncGoogleSheetToSnapshot,
  convertSheetValuesToSnapshotRows,
  convertSheetValuesToHeaders,
  columnIndexToLetter,
};
