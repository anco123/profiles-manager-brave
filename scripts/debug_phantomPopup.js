/**
 * scripts/debug_phantomPopup.js -- CHẨN ĐOÁN TẠM, xoá sau khi tìm ra lỗi.
 * -----------------------------------------------------------------------
 * Tìm nguyên nhân popup.html của Phantom bị màn đen. Chạy 2 bước:
 *   Bước 1: mở popup.html, ghi lại lỗi console + chữ đang hiển thị +
 *           cài đặt side panel hiện tại.
 *   Bước 2: nếu vẫn đen -> BẬT LẠI side panel rồi reload. Hết đen thì
 *           thủ phạm là setOptions({ enabled: false }) trong
 *           xlv3_loginPhantom.js.
 *
 * Usage (đặt tạm ở ĐẦU main.js):
 *   const { debugPhantomPopup } = require('./debug_phantomPopup');
 *   await debugPhantomPopup(page, context, log);
 *   return; // chỉ chẩn đoán, không chạy phần còn lại của main.js
 * -----------------------------------------------------------------------
 */

const PHANTOM_ID = 'bfnaelmomeimhlpmgjnjophhpkkoljpa';
const POPUP_URL = `chrome-extension://${PHANTOM_ID}/popup.html`;

async function debugPhantomPopup(page, context, log) {
  const p = await context.newPage();
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log(`[console ${m.type()}] ${m.text()}`); });
  p.on('pageerror', (e) => log(`[pageerror] ${e.message}`));

  async function snapshot(label) {
    await p.waitForTimeout(8000); // cho Phantom đủ thời gian render (nền tối lúc đang load là bình thường)
    const text = await p
      .evaluate(() => (document.body ? document.body.innerText : '').trim().slice(0, 300))
      .catch((e) => 'lỗi đọc DOM: ' + e.message);
    const opts = await p
      .evaluate(async () => {
        try { return await chrome.sidePanel.getOptions({}); } catch (e) { return 'lỗi: ' + e.message; }
      })
      .catch((e) => 'lỗi evaluate: ' + e.message);
    log(`===== ${label} =====`);
    log(`URL: ${p.url()}`);
    log(`Chữ đang hiển thị: ${text ? JSON.stringify(text) : '(TRỐNG -- màn đen)'}`);
    log(`Side panel options: ${JSON.stringify(opts)}`);
    return !!text;
  }

  await p.goto(POPUP_URL, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch((e) => log('goto lỗi: ' + e.message));
  const renderedBefore = await snapshot('BƯỚC 1: hiện trạng');

  if (renderedBefore) {
    log('KẾT LUẬN: popup render bình thường trong lần chạy này.');
    return;
  }

  log('Màn đen -> thử BẬT LẠI side panel rồi reload...');
  await p
    .evaluate(async () => { await chrome.sidePanel.setOptions({ enabled: true }); })
    .catch((e) => log('bật lại lỗi: ' + e.message));
  await p.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  const renderedAfter = await snapshot('BƯỚC 2: sau khi bật lại side panel');

  log(renderedAfter
    ? 'KẾT LUẬN: bật lại side panel là hết đen -> thủ phạm là setOptions({ enabled: false }).'
    : 'KẾT LUẬN: bật lại vẫn đen -> KHÔNG phải do side panel, xem các dòng [console error]/[pageerror] ở trên.');
}

module.exports = { debugPhantomPopup };