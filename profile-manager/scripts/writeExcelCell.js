/**
 * scripts/writeExcelCell.js
 * -----------------------------------------------------------------------
 * Ghi 1 giá trị vào ĐÚNG 1 ô (dòng + cột) trong snapshot Excel đã import
 * (data/excel-snapshot.json -- xem dataPaths.js, POST /api/excel-snapshot
 * trong server.js). Dùng chung cho mọi script cần ghi kết quả ngược lại
 * Excel (VD: kết quả check suspend của 1 tài khoản khác).
 *
 * GIỚI HẠN THẬT SỰ CẦN BIẾT: hàm này CHỈ ghi vào snapshot JSON nội bộ
 * -- KHÔNG ghi được vào file .xlsx GỐC bạn import trên giao diện. File
 * .xlsx gốc chỉ tồn tại trong bộ nhớ trình duyệt lúc chọn file (qua
 * <input type="file">) -- trình duyệt KHÔNG cho JS biết đường dẫn thật
 * trên đĩa của file đó (giới hạn bảo mật chuẩn), nên server/script
 * không có cách nào mở lại đúng file đó để ghi đè.
 *
 * RỦI RO GHI ĐỒNG THỜI: server.js cho nhiều profile chạy SONG SONG
 * (maxConcurrent). Nếu 2 profile CÙNG LÚC gọi hàm này (dù ghi ô khác
 * nhau), cả 2 đều đọc-sửa-ghi NGUYÊN file JSON -- không có khoá thì ai
 * ghi SAU sẽ vô tình ghi đè mất thay đổi của người ghi TRƯỚC. Hàm này
 * dùng khoá kiểu "tạo file độc quyền" (fs flag 'wx' -- nguyên tử ở cấp
 * hệ điều hành) để giảm rủi ro, kèm tự dọn khoá "mồ côi" (process giữ
 * khoá bị crash, không kịp mở khoá) nếu quá 30s.
 *
 * File này ĐÃ tự động ghi ra `.xlsx` thật (data/excel-results.xlsx)
 * mỗi lần gọi -- mở trực tiếp bằng Excel được, không cần bấm "Export"
 * thủ công ở đâu cả. Đây KHÔNG PHẢI file gốc bạn import -- là 1 file
 * HOÀN TOÀN MỚI server tự tạo và tự cập nhật (server không có quyền
 * truy cập file gốc, xem đoạn trên).
 *
 * Usage:
 *   const { writeExcelCell } = require('./writeExcelCell');
 *   await writeExcelCell(targetExcelRow, 'J', 'Done_X');
 * -----------------------------------------------------------------------
 */

async function writeExcelCell(excelRowNumber, columnLetter, value) {
  const fs = require('fs');
  const { EXCEL_SNAPSHOT_FILE } = require('./datapaths');

  const lockFile = EXCEL_SNAPSHOT_FILE + '.lock';
  const maxLockAttempts = 30;
  const lockRetryDelayMs = 200;
  const staleLockMs = 30000; // khoá cũ hơn 30s coi như bị bỏ rơi (process giữ khoá đã crash) -- tự dọn, không kẹt vĩnh viễn

  let locked = false;
  for (let attempt = 0; attempt < maxLockAttempts; attempt++) {
    try {
      fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' }); // 'wx' -- lỗi ngay nếu file ĐÃ tồn tại, không có khoảng hở để 2 process cùng "tạo thành công"
      locked = true;
      break;
    } catch (e) {
      try {
        const stat = fs.statSync(lockFile);
        if (Date.now() - stat.mtimeMs > staleLockMs) {
          fs.unlinkSync(lockFile); // khoá "mồ côi" -- xoá đi, thử lại ngay vòng sau
        }
      } catch (e2) { /* lock file vừa bị process khác xoá giữa lúc kiểm tra -- bỏ qua, thử lại vòng sau */ }
      await new Promise((resolve) => setTimeout(resolve, lockRetryDelayMs));
    }
  }

  if (!locked) {
    throw new Error(`[writeExcelCell] Không lấy được khoá ghi sau ${maxLockAttempts} lần thử -- có process khác đang giữ khoá quá lâu.`);
  }

  try {
    if (!fs.existsSync(EXCEL_SNAPSHOT_FILE)) {
      throw new Error('[writeExcelCell] Chưa có snapshot Excel nào -- import lại file Excel trên giao diện trước khi chạy.');
    }
    const rows = JSON.parse(fs.readFileSync(EXCEL_SNAPSHOT_FILE, 'utf-8'));
    const arrayIndex = excelRowNumber - 2; // dòng 1 là header -- rows[0] ứng với dòng Excel số 2
    if (arrayIndex < 0 || arrayIndex >= rows.length) {
      throw new Error(`[writeExcelCell] Dòng Excel số ${excelRowNumber} không tồn tại (snapshot có dữ liệu từ dòng 2 đến dòng ${rows.length + 1}).`);
    }
    rows[arrayIndex][columnLetter] = value;
    fs.writeFileSync(EXCEL_SNAPSHOT_FILE, JSON.stringify(rows));

    // Viết luôn ra .xlsx thật -- VẪN đang trong lúc giữ khoá, nên an toàn với việc ghi đồng thời y hệt bước ghi JSON ở trên.
    // Đúng cột theo chữ cái + giữ tiêu đề gốc (xem writeResultsXlsx).
    require('./xlv1_exportSnapshotToExcel').writeResultsXlsx(rows);
  } finally {
    fs.unlinkSync(lockFile); // LUÔN mở khoá, kể cả lỗi giữa chừng -- không thì mọi lần ghi SAU đều bị kẹt vĩnh viễn
  }
}

module.exports = { writeExcelCell };
