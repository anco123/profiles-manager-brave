/**
 * scripts/cleanupDebugFiles.js
 * -----------------------------------------------------------------------
 * Dọn các file debug (`login-debug-*.png`, `link-x-debug-*.png`,
 * `login-task-debug-*.png`, `account-check-debug-*.png/.html`) mà các
 * script trong scripts/ tự chụp mỗi lần chạy login/link task -- mấy file
 * này KHÔNG tự xoá, cứ chạy nhiều là tích, và chính là nguyên nhân đĩa
 * đầy dần dẫn tới banner "Free up space to continue" của Chrome (xem
 * server.js/README). Chỉ động tới các file khớp đúng pattern debug ở
 * NGAY TRONG DATA_DIR -- không đụng tới data/profiles/ (dữ liệu profile
 * Chrome thật, không được xoá tự động).
 *
 * Gọi trực tiếp require() thật (không qua scopedRequire trong
 * server.js) vì file này chỉ được server.js gọi lúc khởi động, không
 * phải chạy từ "Script to run" như main.js.
 * -----------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');

// Đúng các tên file mà helpers.js / loginTask.js / xlv1_getXStatus.js...
// đang dùng để chụp debug (xem waitAndScreenshot() trong helpers.js).
const DEBUG_FILE_PATTERN = /^(login-debug|link-x-debug|login-task-debug|account-check-debug)-\d+\.(png|html)$/;

/**
 * @param {string} dataDir  Thư mục data (DATA_DIR trong server.js/datapaths.js)
 * @param {number} daysToKeep  Giữ lại file mới hơn N ngày, xoá phần còn lại
 * @returns {{ scanned: number, deleted: number, freedBytes: number, errors: string[] }}
 */
function cleanupOldDebugFiles(dataDir, daysToKeep = 7) {
  const result = { scanned: 0, deleted: 0, freedBytes: 0, errors: [] };
  const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;

  let entries;
  try {
    entries = fs.readdirSync(dataDir, { withFileTypes: true });
  } catch (err) {
    result.errors.push(`Không đọc được ${dataDir}: ${err.message}`);
    return result;
  }

  for (const entry of entries) {
    // Chỉ file nằm thẳng trong dataDir, không đệ quy vào profiles/ hay
    // bất kỳ thư mục con nào khác -- tránh đụng nhầm dữ liệu thật.
    if (!entry.isFile() || !DEBUG_FILE_PATTERN.test(entry.name)) continue;

    result.scanned += 1;
    const fullPath = path.join(dataDir, entry.name);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(fullPath);
        result.deleted += 1;
        result.freedBytes += stat.size;
      }
    } catch (err) {
      result.errors.push(`${entry.name}: ${err.message}`);
    }
  }

  return result;
}

module.exports = { cleanupOldDebugFiles, DEBUG_FILE_PATTERN };