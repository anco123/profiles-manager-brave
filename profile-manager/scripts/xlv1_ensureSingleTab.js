// js
/**
 * scripts/xlv1_ensureSingleTab.js
 * -----------------------------------------------------------------------
 * Đóng hết mọi tab TRỪ tab index 0 trong context, trước khi thực hiện
 * goto/click trên tab chính -- phòng trường hợp 1 extension (vd Phantom)
 * tự ý bật thêm 1 tab mới giữa chừng lúc đang thao tác, khiến bước
 * tiếp theo lỡ bị thực hiện nhầm trên SAI tab (hoặc page.locator ở tab
 * chính bỗng không còn đúng focus/trạng thái mong đợi nữa).
 *
 * CHỈ gọi hàm này ở những chỗ thao tác trên TAB CHÍNH (tab index 0).
 * KHÔNG gọi ở những chỗ đang CHỦ ĐỘNG cần có >1 tab để làm việc, vì gọi
 * ở đó sẽ xoá mất đúng tab đang cần dùng:
 *   - xlv1_changeProxy.js (tự mở/đóng tab reset/check mạng riêng)
 *   - xlv1_getXStatus.js (browser/context ẩn danh HOÀN TOÀN riêng biệt,
 *     không chung context với tab chính)
 *   - xlv3_loginPhantom.js (toàn bộ thao tác trên tab popup/onboarding
 *     của chính extension Phantom)
 *   - đoạn tìm & thao tác với `phantomPopup` trong
 *     xlv3_bindAndLoginToTesseract.js (unlockInput/primaryButton) --
 *     tab đó CHÍNH LÀ cái tab phụ cần giữ lại để click vào.
 *
 * SỬA LẦN 2: p.close() của Playwright thỉnh thoảng TREO VÔ THỜI HẠN với
 * đúng loại tab mà hàm này sinh ra để dọn -- tab popup do extension (vd
 * Phantom) tự mở -- thay vì resolve hay reject. .catch(() => {}) KHÔNG
 * cứu được trường hợp này vì catch chỉ bắt reject, không bắt được 1
 * promise treo mãi không bao giờ settle. Hậu quả thực tế: cả automation
 * đứng hình vĩnh viễn ngay tại lần click tiếp theo, dù nơi gọi có bọc
 * .catch() cho clickVisibly() đi nữa (không có gì để catch khi promise
 * chưa bao giờ reject). Giờ mỗi lần close() có 1 timeout riêng (đua với
 * setTimeout) -- quá hạn thì BỎ QUA tab đó (không chờ thêm), không để 1
 * tab "cứng đầu" chặn đứng toàn bộ phiên.
 *
 * Usage:
 *   const { ensureSingleTab } = require('./xlv1_ensureSingleTab');
 *   await ensureSingleTab(context, log); // trước goto hoặc trước click trên tab chính
 */
const CLOSE_TIMEOUT_MS = 3000;

function closeWithTimeout(p, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, timedOut: true });
    }, timeoutMs);

    p.close().then(
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: true });
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, timedOut: false });
      }
    );
  });
}

async function ensureSingleTab(context, log) {
  const pages = context.pages();
  if (!pages || pages.length <= 1) return;

  const extras = pages.filter((p, i) => i >= 1 && p && !p.isClosed());
  if (extras.length === 0) return;

  // Đóng song song, mỗi tab 1 timeout riêng -- tổng thời gian chờ bị
  // chặn trên ~CLOSE_TIMEOUT_MS, không cộng dồn theo số tab.
  const results = await Promise.all(extras.map((p) => closeWithTimeout(p, CLOSE_TIMEOUT_MS)));

  const closedCount = results.filter((r) => r.ok).length;
  const stuckCount = results.filter((r) => r.timedOut).length;

  if (closedCount > 0 && log) {
    log(`[ensureSingleTab] Đã đóng ${closedCount} tab ngoài tab chính (index 0).`);
  }
  if (stuckCount > 0 && log) {
    log(`[ensureSingleTab] ${stuckCount} tab không đóng được trong ${CLOSE_TIMEOUT_MS}ms -- bỏ qua, không chờ thêm (có thể do extension giữ tab).`);
  }
}

module.exports = { ensureSingleTab };