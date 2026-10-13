/**
 * scripts/xlv1_scrollToElement.js
 * -----------------------------------------------------------------------
 * Lướt TỚI 1 phần tử ĐÃ CÓ trong DOM bằng con lăn chuột (nhiều lượt cuộn có quán tính, dừng nghỉ giữa các lượt) cho tới khi nó nằm
 * quanh giữa màn hình -- thay cho scrollIntoViewIfNeeded() (nhảy tức thời tới đích, không có sự kiện wheel nào, không giống người).
 * Mỗi lượt đo lại vị trí phần tử (timeline X ảo hoá + bài mới chèn vào có thể làm phần tử dịch chuyển trong lúc lướt).
 *
 * Trả về true nếu phần tử đã nằm trong vùng nhìn thấy; false nếu phần tử biến khỏi DOM giữa chừng (bị ảo hoá mất) hoặc quá số lượt.
 * deps: { moveMouseVisibly, ambientMouseMove, momentumScroll? } -- không có momentumScroll thì tự chia wheel() thành vài tick giảm dần.
 *
 * Usage:
 *   const { scrollToElement } = require('./xlv1_scrollToElement');
 *   const ok = await scrollToElement(page, log, deps, locator, 'bài viết statusId=123');
 * -----------------------------------------------------------------------
 */

const rand = (a, b) => a + Math.random() * (b - a);

async function wheelWithMomentum(page, deps, delta) {
  if (typeof deps.momentumScroll === 'function') return deps.momentumScroll(page, delta);
  const ticks = 3 + Math.floor(Math.random() * 3), weights = Array.from({ length: ticks }, (_, i) => ticks - i), sum = weights.reduce((s, w) => s + w, 0);
  for (let i = 0; i < ticks; i++) { await page.mouse.wheel(0, (delta * weights[i]) / sum); if (i < ticks - 1) await page.waitForTimeout(rand(35, 110)); }
}

async function scrollToElement(page, log, deps, locator, label = 'phần tử', maxSteps = 40) {
  const target = locator.first();
  for (let step = 0; step <= maxSteps; step++) {
    const box = await target.boundingBox().catch(() => null);
    if (!box) { log(`[scrollToElement] ${label} không còn trong DOM (timeline ảo hoá) -- dừng lướt.`); return false; }

    const vh = (page.viewportSize() || { height: 800 }).height;
    const visibleH = Math.min(box.height, vh * 0.5); // phần tử cao hơn màn hình: chỉ cần phần đầu vào vùng nhìn
    if (box.y >= vh * 0.08 && box.y + visibleH <= vh * 0.92) return true;

    if (step === 0) log(`[scrollToElement] ${label} đang ${box.y < 0 ? 'ở phía trên' : 'ở phía dưới'} màn hình -- lướt tới.`);
    const remaining = box.y + visibleH / 2 - vh * rand(0.38, 0.55); // điểm dừng lệch ngẫu nhiên quanh giữa màn hình
    const delta = Math.abs(remaining) <= 750 ? remaining * rand(0.92, 1.05) : Math.sign(remaining) * rand(380, 750);
    if (Math.random() < 0.3) await deps.ambientMouseMove(page, deps.moveMouseVisibly); // thỉnh thoảng nhích chuột giữa các lượt lăn
    await wheelWithMomentum(page, deps, delta);
    await page.waitForTimeout(Math.random() < 0.15 ? rand(800, 1600) : rand(250, 700)); // đôi khi dừng lâu hơn như liếc đọc lướt qua
  }
  log(`[scrollToElement] Lướt ${maxSteps} lượt vẫn chưa tới ${label} -- bỏ cuộc.`);
  return false;
}

module.exports = { scrollToElement };
