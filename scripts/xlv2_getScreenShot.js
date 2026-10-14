/**
 * scripts/xlv2_getScreenShot.js
 * -----------------------------------------------------------------------
 * Chụp ảnh đúng VÙNG BAO QUANH 2-3 element (hộp nhỏ nhất ôm trọn tất cả +
 * lề) trên `page` CỦA PROFILE ĐANG CHẠY -- dùng chính page đó, không mở
 * trình duyệt nào khác -- rồi lưu thành .png vào thư mục cấu hình ở trang
 * editor (ô "Chụp màn hình", lưu ở DATA_DIR/screenshot-settings.json, đọc
 * LẠI mỗi lần gọi nên đổi xong có hiệu lực ngay, không cần restart).
 *
 * Tên file = <tiền tố> + <dòng Excel> + <hậu tố> + .png (tiền tố/hậu tố cũng
 * lấy từ ô trên editor, có thể để trống). VD tiền tố "kw_", dòng 602, hậu tố
 * "_ok" -> kw_602_ok.png. Cùng tên thì ghi đè.
 *
 * Mỗi element được CHỜ hiện ra (waitFor visible) trước khi đụng tới -- không
 * dùng chờ theo thời gian. Lỗi (không thấy element, ghi file lỗi...) chỉ ghi
 * log rồi trả null, KHÔNG làm sập cả profile.
 *
 * Usage:
 *   const { xlv2_getScreenShot } = require('./xlv2_getScreenShot');
 *   await xlv2_getScreenShot(page, log, [elA, elB, elC], row.__excelRow);
 *   // mỗi phần tử: Locator của Playwright hoặc chuỗi selector/xpath ('//*[@data-testid="x"]')
 *   // trả về đường dẫn file đã lưu, hoặc null nếu không chụp được
 * -----------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');
const { DATA_DIR, SCREENSHOT_SETTINGS_FILE } = require('./datapaths');

const DEFAULT_DIR = path.join(DATA_DIR, 'screenshot', 'kleverWallet'); // ô thư mục để trống thì lưu vào đây -- phải khớp defaultDir trả về từ GET /api/screenshot-settings (server.js)

function readSettings() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(SCREENSHOT_SETTINGS_FILE, 'utf8')) || {}; } catch { /* chưa cấu hình / file hỏng -- dùng mặc định */ }
  return { dir: String(s.dir || '').trim() || DEFAULT_DIR, prefix: String(s.prefix || ''), suffix: String(s.suffix || '') };
}

const safePart = (v) => String(v).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_'); // ký tự Windows cấm trong tên file

async function xlv2_getScreenShot(page, log, elements, excelRow, opts = {}) {
  const tag = '[xlv2_getScreenShot]';
  try {
    const { padding = 12, timeout = 15000 } = opts;
    if (!Array.isArray(elements) || elements.length === 0) throw new Error('chưa truyền element nào (cần mảng 1-3 element)');
    const locs = elements.map((el) => (typeof el === 'string' ? page.locator(el) : el).first());

    for (let i = 0; i < locs.length; i++) await locs[i].waitFor({ state: 'visible', timeout }); // chờ ĐỦ cả các element hiện ra rồi mới chụp
    await locs[0].scrollIntoViewIfNeeded({ timeout });

    const boxes = [];
    for (let i = 0; i < locs.length; i++) {
      const b = await locs[i].boundingBox();
      if (!b) throw new Error(`element thứ ${i + 1} không có kích thước (vừa biến mất?)`);
      boxes.push(b);
    }
    const view = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight, sx: window.scrollX, sy: window.scrollY }));
    const x1 = Math.min(...boxes.map((b) => b.x)) - padding, y1 = Math.min(...boxes.map((b) => b.y)) - padding;
    const x2 = Math.max(...boxes.map((b) => b.x + b.width)) + padding, y2 = Math.max(...boxes.map((b) => b.y + b.height)) + padding;

    // Vùng nằm gọn trong khung nhìn -> chụp thẳng theo toạ độ khung nhìn (ổn định nhất). Vượt khung nhìn -> chụp cả trang rồi cắt theo toạ độ trang (= toạ độ khung nhìn + vị trí cuộn).
    const fits = x1 >= 0 && y1 >= 0 && x2 <= view.w && y2 <= view.h;
    const ox = fits ? 0 : view.sx, oy = fits ? 0 : view.sy;
    const cx = Math.max(0, x1 + ox), cy = Math.max(0, y1 + oy);
    const clip = { x: cx, y: cy, width: Math.max(1, x2 + ox - cx), height: Math.max(1, y2 + oy - cy) };

    const { dir, prefix, suffix } = readSettings();
    fs.mkdirSync(dir, { recursive: true });
    const hasRow = excelRow !== undefined && excelRow !== null && String(excelRow).trim() !== '';
    if (!hasRow) log(`${tag} thiếu excelRow -- đặt tên file theo thời gian thay cho số dòng.`);
    const file = path.join(dir, `${safePart(prefix)}${safePart(hasRow ? excelRow : Date.now())}${safePart(suffix)}.png`);

    await page.screenshot({ path: file, clip, fullPage: !fits });
    log(`${tag} Đã chụp ${locs.length} element (${Math.round(clip.width)}x${Math.round(clip.height)}px) -> ${file}`);
    return file;
  } catch (e) {
    log(`${tag} LỖI: không chụp được -- bỏ qua, làm tiếp. (${String(e.message).split('\n')[0]})`);
    return null;
  }
}

module.exports = { xlv2_getScreenShot };
