// main.js -- entry point, luôn là script được chọn ở "Script to run".
//
// Luồng: kiểm tra X có bị suspend hay không TRƯỚC TIÊN (gọi thẳng fetch
// tới trang cá nhân, không qua Playwright) -- suspend thì DỪNG NGAY,
// không làm gì thêm. Không suspend mới đi tiếp: loginX -> interactX
// (lướt Home) -> loginTaskOn.
//
// Cột Excel (dùng chung 1 dòng cho cả X lẫn TaskOn):
//   D = username X       E = password X        F = 2FA secret X
//   I = x_email_type (chứa "Cookie" -> đăng nhập bằng cookie thay vì mật khẩu)
//   J = chuỗi cookie thật (chỉ dùng khi cột I là kiểu Cookie)
//   N = alias mail.tm    O = mật khẩu mail.tm   P = domain mail.tm
//   M = trạng thái (ghi ngược lại bằng writeExcelCell.js) -- ghi NGAY sau bước check (chưa cần đăng nhập):
//       "Done_X" (hồ sơ hiện bình thường), "Suspended", "NotFound", "Unknown" (không xác định được).
//       Bật RUN_LOGIN thì đăng nhập tiếp: lỗi đăng nhập ghi đè M bằng mã lỗi (VD "Cookie_Login_Failed").

// BẬT (true) = check trạng thái xong thì đăng nhập + làm tiếp các bước sau (interactX...).
// TẮT (false) = chỉ check trạng thái X, ghi kết quả vào cột M rồi dừng -- nhanh, không mở phiên đăng nhập.
const RUN_LOGIN = false;

const { getDeviceInfo } = require('./xlv1_getDeviceInfo');
const { getXStatus } = require('./xlv1_getXStatus');
const { changeProxy } = require('./xlv1_changeProxy');

const { checkAndLoginPhantom } = require('./xlv3_loginPhantom');
const { bindAndLoginToTesseract } = require('./xlv3_bindAndLoginToTesseract');
const { debugPhantomPopup } = require('./debug_phantomPopup');
const { binhdanhocvu } = require('./binhdanhocvu');

const { readGoogleSheetCell } = require('./readGoogleSheetCell');
const { xlv2_checkFollowers } = require('./xlv2_checkFollowers');

// await binhdanhocvu(page, context, log, require);



// Đổi IP proxy TRƯỚC TIÊN, trước khi làm bất kỳ việc gì khác. `proxyInfo`
// do CHÍNH server.js truyền vào (tham số thứ 6, xem runScriptOnProfile
// trong server.js) -- đã tự tra đúng proxy của PROFILE ĐANG CHẠY này,
// không cần tự chọn/truyền tay. Xem comment trong xlv1_changeProxy.js
// để hiểu vì sao cách này hoạt động được dù Playwright không cho đổi
// proxy của browser đang chạy (config proxy giữ nguyên, chỉ IP thật
// đứng sau nó đổi).
await changeProxy(context, proxyInfo, log);

const row = input ? JSON.parse(input) : {};
const username = row.D;
//const username = 'MannsRikki83882';
if (!username) {
  throw new Error('Thiếu username X (kiểm tra cột D trong Excel)');
}

// const phantomSeedPharse = row.R;
// // await debugPhantomPopup(page, context, log);

// const phantomResult = await checkAndLoginPhantom(page, context, log, require, phantomSeedPharse);
// if(1==1){
// ---------- Lấy giá trị row hiện tại + khả năng đọc row khác ----------
// __excelRow = số dòng Excel THẬT (vd: 5, 6, 7...) của dòng đang chạy --
// được public/editor.js gắn kèm lúc so khớp theo tên (xem
// recomputeExcelMatches() trong editor.js). Nếu dòng này = undefined,
// nghĩa là input được gõ tay vào ô "Input data" chứ không phải import
// từ Excel -- lúc đó không có cơ sở để tính +2/-1/... gì cả.
const currentExcelRow = row.__excelRow;
if (currentExcelRow === undefined) {
  log('[cảnh báo] input không có __excelRow -- có thể được nhập tay, không phải import từ Excel.');
} else {
  log(`Dòng Excel hiện tại: ${currentExcelRow}`);
}

// ---------- Phát hiện tài khoản MỚI (cột C = "new_account") ----------
// KHÔNG tự xoá/tạo lại profile ở đây -- script đang chạy CHÍNH BÊN
// TRONG profile này, xoá thư mục dữ liệu giữa chừng sẽ crash ngay lập
// tức. Chỉ đánh dấu để server.js tự xử lý SAU KHI profile này đã đóng
// hẳn (xem xlv1_markProfileForRecreate.js / consumePendingRecreate()
// trong server.js). Sau khi xử lý xong, server.js sẽ TỰ xoá giá trị
// "new_account" ở cột C -- main.js không tự xoá ở đây, để nếu có lỗi
// giữa chừng thì lần chạy sau vẫn còn thấy dấu hiệu mà thử lại.
if (currentExcelRow !== undefined && (row['C'] || '').toString().trim() === 'new_account') {
  log('[main] Cột C = "new_account" -- đánh dấu profile này cần xoá-tạo-lại (cùng tên) sau khi đóng.');
  const { markProfileForRecreate } = require('./xlv1_markProfileForRecreate');
  await markProfileForRecreate(proxyInfo.profileId, proxyInfo.profileName, currentExcelRow, log);
}

// Đọc 1 DÒNG KHÁC (không phải dòng đang chạy) từ bản snapshot toàn bộ
// sheet mà editor.js lưu lại mỗi lần bạn import file Excel trên giao
// diện (xem POST /api/excel-snapshot trong server.js).
//
// Ví dụ dùng -- dòng hiện tại + 2, lấy cột C:
// const targetRow = readExcelRowByNumber(currentExcelRow + 2);
// const value = targetRow ? targetRow['C'] : undefined;
//
// COPY nguyên khối hàm này (và dòng require ở trên nó) sang script khác
// khi cần dùng lại -- xem comment trong scripts/dataPaths.js để hiểu vì
// sao không thể tự path.join(__dirname, ...) trực tiếp ở đây.
const { EXCEL_SNAPSHOT_FILE } = require('./datapaths');

function readExcelRowByNumber(excelRowNumber) {
  const fs = require('fs');
  if (!fs.existsSync(EXCEL_SNAPSHOT_FILE)) {
    throw new Error('Chưa có snapshot Excel nào -- import lại file Excel trên giao diện trước khi chạy.');
  }
  const allRows = JSON.parse(fs.readFileSync(EXCEL_SNAPSHOT_FILE, 'utf-8'));
  const arrayIndex = excelRowNumber - 2; // dòng 1 là header -- allRows[0] ứng với dòng Excel số 2
  if (arrayIndex < 0 || arrayIndex >= allRows.length) {
    throw new Error(
      `Dòng Excel số ${excelRowNumber} không tồn tại (snapshot có dữ liệu từ dòng 2 đến dòng ${allRows.length + 1}).`
    );
  }
  return allRows[arrayIndex];
}
// -----------------------------------------------------------------------

// Ghi ngược trạng thái vào cột M (xem writeExcelCell.js) -- gói lại
// thành 1 hàm nhỏ ở đây vì được gọi từ 2 chỗ (Suspended và Done_X) và
// cùng cần đúng 1 điều kiện bảo vệ: không có __excelRow (input gõ tay,
// không phải import từ Excel) thì không có dòng nào để ghi vào cả.
// Lỗi ghi (VD: khoá bị giữ quá lâu) chỉ log ra chứ không throw -- ghi
// cột M là một tác dụng phụ, không nên làm sập cả luồng chính vì nó.
const { writeExcelCell } = require('./writeExcelCell');

async function writeStatusColumnM(value) {
  if (currentExcelRow === undefined) {
    log(`[cảnh báo] Không ghi được cột M ("${value}") -- thiếu __excelRow.`);
    return;
  }
  try {
    await writeExcelCell(currentExcelRow, 'M', value);
    log(`Đã ghi cột M dòng ${currentExcelRow}: ${value}`);
  } catch (err) {
    log(`[lỗi] Ghi cột M thất bại: ${err.message}`);
  }
}

const deviceInfo = await getDeviceInfo(page, log);
log(`IP: ${deviceInfo.ip}`);
log(`User-Agent: ${deviceInfo.userAgent}`);

// Thử getXStatus 1 lần -- nếu lỗi vì chính x.com đang chặn RIÊNG proxy
// này (không phải proxy chết, xem cờ xBlockedThisProxy/proxyBroken do
// xlv1_getXStatus.js tự gắn vào lỗi), xoay thêm 1 IP MỚI rồi thử lại
// ĐÚNG 1 lần nữa -- không lặp vô hạn, vì rất có thể là do cả dải IP
// của nhà cung cấp proxy này đang bị x.com để ý, không riêng gì 1 IP.





let xStatus;
try {
  xStatus = await getXStatus(username, proxyInfo, log);
} catch (err) {
  if (err.xBlockedThisProxy || err.proxyBroken) {
    log('[main] getXStatus lỗi do proxy -- xoay thêm 1 IP mới rồi thử lại đúng 1 lần...');
    await changeProxy(context, proxyInfo, log);
    xStatus = await getXStatus(username, proxyInfo, log); // để lỗi tự văng ra ngoài nếu vẫn fail -- không retry thêm nữa
  } else {
    throw err; // lỗi khác (không liên quan proxy) -- không có lý do gì để đổi proxy rồi thử lại
  }
}


log(`Kiểm tra X trước tiên -- trạng thái: ${xStatus}`);

// Ghi kết quả check vào cột M NGAY -- không cần đợi đăng nhập. Hồ sơ hiện bình thường = "Done_X".
await writeStatusColumnM(xStatus);
if (xStatus === 'Suspended' || xStatus === 'NotFound' || xStatus === 'Unknown') await yellow(xStatus, xStatus); // đánh dấu vàng trên bảng kết quả Queue
if (xStatus === 'Suspended' || xStatus === 'NotFound') { log(`Tài khoản ${xStatus} -- dừng.`); return; }
if (!RUN_LOGIN) { log('RUN_LOGIN đang tắt -- chỉ check trạng thái, dừng ở đây.'); return; }
// Unknown (trang hồ sơ không hiện dấu hiệu chắc chắn: lỗi / bị chặn / bắt đăng nhập) -- RUN_LOGIN bật thì vẫn thử đăng nhập.
if (xStatus === 'Unknown') log('[cảnh báo] Không xác định được trạng thái X qua cửa sổ ẩn danh -- vẫn thử đăng nhập.');

// ---------- Không suspend -- đi tiếp toàn bộ luồng ----------
// Cột I = x_email_type -- nếu chứa "Cookie" (không phân biệt hoa/thường)
// thì đăng nhập bằng cookie có sẵn (đọc cột J bên trong loginByCookie),
// còn không thì đăng nhập bằng mật khẩu như cũ. Cả 2 hàm cùng chữ ký,
// cùng cách trả "status" -- gọi hàm nào cũng xử lý y hệt nhau phía sau.
const xEmailType = (row['I'] || '').toString();
const isCookieLogin = xEmailType.toLowerCase().includes('cookie');
log(`Cột I (x_email_type): "${xEmailType}" -- ${isCookieLogin ? 'đăng nhập bằng COOKIE (cột J)' : 'đăng nhập bằng mật khẩu (mặc định)'}`);

const result = isCookieLogin
  ? await require('./xlv3_loginByCookie').loginByCookie(page, context, log, require, input)
  : await require('./xlv3_loginX').loginToX(page, context, log, require, input);

log(`Trạng thái đăng nhập X: ${result.status}`);

if (result.status !== 'Done_X') {
  log(`Không phải Done_X (${result.status}) -- dừng lại.`);
  await writeStatusColumnM(result.status); // VD Cookie_Login_Failed / No_Cookie_Found -- ghi đè kết quả check ở trên
  return;
}

await writeStatusColumnM('Done_X');



//const soFollower = 3;
// Số follower ĐÃ LƯU ở cột G -- đọc từ snapshot (cập nhật bởi writeExcelCell) chứ KHÔNG dùng row.G, vì row.G chỉ là giá trị trong file Excel lúc import (không đổi khi hàm check follower ghi thêm). Chuyển về SỐ; ô trống/không phải số -> null (điều kiện > hoặc < sẽ không bao giờ chạy nhầm trên ô trống).
const { readExcelCell } = require('./xlv1_readExcelCell');
const rawG = currentExcelRow === undefined ? row.G : readExcelCell(currentExcelRow, 'G');
const gNum = Number(String(rawG ?? '').trim().replace(/,/g, ''));
const soFollower = (String(rawG ?? '').trim() !== '' && Number.isFinite(gNum)) ? gNum : null;



// const { interactX } = require('./xlv3_Interactx');
// await interactX(page, context, log, require, input, soFollower);



// const bindAndLoginToTesseractRéult = await bindAndLoginToTesseract(page, context, log);
//log(`.status`);



const { exportSnapshotToExcel } = require('./xlv1_exportSnapshotToExcel');
await exportSnapshotToExcel();




// const { runLoginTask } = require('./loginTask');
// await runLoginTask(page, context, log, require, input);

//const fs = require('fs');
//const content = fs.readFileSync('data/notes.txt', 'utf-8');
//log('File content:', content);




// await debugPhantomPopup(page, context, log);