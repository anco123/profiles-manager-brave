/**
 * scripts/xlv1_markProfileForRecreate.js
 * -----------------------------------------------------------------------
 * Đánh dấu 1 profile "cần xoá và tạo lại (cùng tên)" NGAY SAU KHI nó
 * đóng -- KHÔNG xoá ngay tại đây, vì script đang chạy CHÍNH BÊN TRONG
 * profile đó (xoá thư mục dữ liệu trong khi Chrome của chính nó đang
 * mở sẽ hỏng/crash ngay lập tức). Việc xoá+tạo lại thật sự do
 * server.js tự làm, ngay sau khi profile này đóng hẳn (xem
 * consumePendingRecreate() trong server.js, gọi từ cuối
 * runQueueScriptThenClose()).
 *
 * Cơ chế: ghi vào data/pending-profile-recreate.json (mảng JSON), có
 * khoá file kiểu 'wx' y hệt writeExcelCell.js -- vì nhiều profile chạy
 * song song (maxConcurrent) có thể cùng lúc tự đánh dấu.
 *
 * Usage (trong main.js):
 *   const { markProfileForRecreate } = require('./xlv1_markProfileForRecreate');
 *   await markProfileForRecreate(proxyInfo.profileId, proxyInfo.profileName, currentExcelRow, log);
 * -----------------------------------------------------------------------
 */

async function markProfileForRecreate(profileId, profileName, excelRow, log) {
  const fs = require('fs');
  const path = require('path');
  const { DATA_DIR } = require('./datapaths');

  if (!profileId) {
    throw new Error('[markProfileForRecreate] Thiếu profileId -- proxyInfo.profileId phải có giá trị (server.js tự truyền vào, xem runScriptOnProfile).');
  }

  const file = path.join(DATA_DIR, 'pending-profile-recreate.json');
  const lockFile = file + '.lock';
  const maxLockAttempts = 30;
  const lockRetryDelayMs = 200;
  const staleLockMs = 30000; // khoá cũ hơn 30s coi như bị bỏ rơi -- tự dọn, không kẹt vĩnh viễn

  let locked = false;
  for (let attempt = 0; attempt < maxLockAttempts; attempt++) {
    try {
      fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' }); // 'wx' -- lỗi ngay nếu file ĐÃ tồn tại, nguyên tử ở cấp hệ điều hành
      locked = true;
      break;
    } catch (e) {
      try {
        const stat = fs.statSync(lockFile);
        if (Date.now() - stat.mtimeMs > staleLockMs) fs.unlinkSync(lockFile);
      } catch (e2) { /* lock vừa bị process khác xoá giữa lúc kiểm tra -- bỏ qua, thử lại vòng sau */ }
      await new Promise((resolve) => setTimeout(resolve, lockRetryDelayMs));
    }
  }
  if (!locked) {
    throw new Error(`[markProfileForRecreate] Không lấy được khoá ghi sau ${maxLockAttempts} lần thử -- có process khác đang giữ khoá quá lâu.`);
  }

  try {
    const list = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : [];
    // Không thêm trùng nếu profile này đã được đánh dấu từ trước (VD
    // script bị lỗi giữa chừng rồi chạy lại) -- ghi đè bằng entry mới
    // (excelRow có thể đã khác nếu lần này chạy ở 1 dòng khác).
    const filtered = list.filter((item) => item.profileId !== profileId);
    filtered.push({ profileId, profileName, excelRow, markedAt: new Date().toISOString() });
    fs.writeFileSync(file, JSON.stringify(filtered));
    if (log) log(`[markProfileForRecreate] Đã đánh dấu "${profileName}" (${profileId}) -- sẽ tự xoá và tạo lại NGAY SAU KHI đóng.`);
  } finally {
    fs.unlinkSync(lockFile); // LUÔN mở khoá, kể cả lỗi giữa chừng
  }
}

module.exports = { markProfileForRecreate };