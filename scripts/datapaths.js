/**
 * scripts/datapaths.js
 * -----------------------------------------------------------------------
 * Đường dẫn tuyệt đối tới file dữ liệu dùng chung (hiện tại: snapshot
 * Excel), để các script khác không phải tự đoán đường dẫn.
 *
 * TẠI SAO CẦN FILE RIÊNG NÀY (thay vì main.js tự path.join(__dirname, ...)):
 * code trong main.js/interactX.js/... KHÔNG chạy như 1 module Node bình
 * thường -- server.js nạp nó bằng `new AsyncFunction(...)` (xem
 * runScriptOnProfile() trong server.js), tức là code của bạn chỉ là 1
 * CHUỖI KÝ TỰ được biến thành hàm, không phải file được require() thật.
 * Hệ quả: bên trong main.js, __dirname và module KHÔNG tồn tại -- gọi
 * tới sẽ báo lỗi "__dirname is not defined".
 *
 * File NÀY thì khác -- nó được nạp qua scopedRequire() -> require() thật
 * của Node (vì đường dẫn không nằm trong ALLOWED_BUILTIN_MODULES nên rơi
 * vào nhánh require(resolved) thật trong server.js), nên __dirname ở
 * ĐÂY hợp lệ, trỏ đúng .../profile-manager/scripts.
 *
 * LƯU Ý ĐÃ SỬA: trước đây file này chỉ đoán data/ nằm cạnh scripts/,
 * KHÔNG biết tới việc server.js có thể TỰ CHUYỂN sang dùng 1 thư mục
 * "Profile" (viết hoa, ngang hàng với profile-manager) nếu thư mục đó
 * đã có sẵn profiles.json (xem autoDetectDataDir() trong server.js) --
 * xác nhận đây là nguyên nhân snapshot Excel "biến mất" dù đã import:
 * server.js ghi vào Profile/excel-snapshot.json, còn file này (bản cũ)
 * lại tìm ở profile-manager/data/excel-snapshot.json -- 2 nơi khác
 * nhau, không bao giờ gặp nhau. Giờ đã lặp lại Y HỆT logic tự dò đó.
 * -----------------------------------------------------------------------
 */
const path = require('path');
const fs = require('fs');

// Y HỆT autoDetectDataDir() trong server.js -- PHẢI khớp tuyệt đối.
// __dirname ở ĐÂY là .../profile-manager/scripts (sâu hơn __dirname
// của server.js đúng 1 cấp, vì server.js nằm ở .../profile-manager) --
// nên lùi lên 2 cấp (không phải 1) để ra đúng cùng 1 thư mục cha mà
// server.js dùng làm mốc so sánh.
function autoDetectDataDir() {
  const sibling = path.join(__dirname, '..', '..', 'Profile');
  return fs.existsSync(path.join(sibling, 'profiles.json')) ? sibling : path.join(__dirname, '..', 'data');
}

const DATA_DIR = process.env.DATA_DIR || autoDetectDataDir();
const EXCEL_SNAPSHOT_FILE = path.join(DATA_DIR, 'excel-snapshot.json');
const EXCEL_RESULTS_FILE = path.join(DATA_DIR, 'excel-results.xlsx');
// Dòng tiêu đề (dòng 1) của file Excel import gần nhất: { A: 'STT', B: 'Name', ... } -- snapshot ở trên chỉ chứa dữ liệu từ dòng 2,
// file này để excel-results.xlsx giữ đúng tên cột gốc thay vì A, B, C... (xem writeResultsXlsx trong xlv1_exportSnapshotToExcel.js).
const EXCEL_HEADER_FILE = path.join(DATA_DIR, 'excel-snapshot-header.json');

// Nguồn dữ liệu THỨ HAI, song song với Excel ở trên -- KHÔNG liên quan,
// không đọc/ghi đè lẫn nhau. GOOGLE_SHEET_SNAPSHOT_FILE là bản snapshot
// JSON của Google Sheet (viết bởi syncGoogleSheet.js, đọc bởi
// readGoogleSheetCell.js), cùng định dạng mảng-object-theo-cột-chữ như
// excel-snapshot.json. GOOGLE_SERVICE_ACCOUNT_FILE là file key .json của
// Google Service Account dùng để xác thực với Google Sheets API -- đặt
// cùng thư mục DATA_DIR, KHÔNG commit lên git.
const GOOGLE_SHEET_SNAPSHOT_FILE = path.join(DATA_DIR, 'google-sheet-snapshot.json');
const GOOGLE_SERVICE_ACCOUNT_FILE = path.join(DATA_DIR, 'google-service-account.json');

// Cài đặt chụp màn hình (thư mục / tiền tố / hậu tố) -- nhập ở ô "Chụp màn
// hình" trên trang editor, server.js ghi (POST /api/screenshot-settings),
// xlv2_getScreenShot.js đọc lại MỖI LẦN gọi.
const SCREENSHOT_SETTINGS_FILE = path.join(DATA_DIR, 'screenshot-settings.json');

module.exports = {
  DATA_DIR,
  SCREENSHOT_SETTINGS_FILE,
  EXCEL_SNAPSHOT_FILE,
  EXCEL_RESULTS_FILE,
  EXCEL_HEADER_FILE,
  GOOGLE_SHEET_SNAPSHOT_FILE,
  GOOGLE_SERVICE_ACCOUNT_FILE,
};