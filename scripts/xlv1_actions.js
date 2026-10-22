/**
 * scripts/xlv1_actions.js
 * -----------------------------------------------------------------------
 * Thao tác "1 tham số = element" -- truyền locator vào là xong, page lấy từ chính locator (el.page()).
 * Bên trong dùng lại đúng các hàm "người thật" của project:
 *   click  -> scrollToElement (lăn chuột thật tới phần tử) + clickVisibly (đi chuột Fitts, điểm nhấn lệch tâm, humanPressMouse)
 *   gõ     -> clickEl rồi humanType (nhịp gõ theo số đo thật + kiểu tay của profile, có gõ sai/xoá với văn bản tự nhiên)
 *   hover  -> moveMouseVisibly tới clickPoint của phần tử
 *   nghỉ   -> humanPause (rung chuột nhẹ trong lúc chờ)
 * Mọi hàm KHÔNG throw: thành công trả true, không làm được trả false + ghi log -- để dùng thẳng trong if/while.
 *
 * Usage (trong main.js / script bất kỳ):
 *   const { useLog, waitEl, clickEl, typeEl, whileHandle } = require('./xlv1_actions');
 *   useLog(log);                                         // 1 lần đầu script -- để log hiện ra màn hình Run
 *   if (await waitEl(page.getByRole('button', { name: 'Next' }))) await clickEl(page.getByRole('button', { name: 'Next' }));
 *   await typeEl(page.locator('input[name="text"]'), 'abc@gmail.com');
 *   await whileHandle([
 *     { el: page.getByRole('button', { name: 'Accept all cookies' }), click: true },
 *     { el: page.locator('input[name="password"]'), type: 'mat_khau' },
 *     { el: page.locator('[data-testid="SideNav_AccountSwitcher_Button"]'), done: true },
 *   ], { timeout: 60000 });
 * -----------------------------------------------------------------------
 */

const helpers = require('./helpers');
const { clickPoint, humanType } = require('./xlv1_humanInput');
const { scrollToElement } = require('./xlv1_scrollToElement');

let log = (...a) => console.log(...a);
function useLog(fn) { if (typeof fn === 'function') log = fn; }

const first = (el) => (el && typeof el.first === 'function' ? el.first() : el);
const nameOf = (el) => { try { return String(el).replace(/\)\.first\(\)$/, ')').replace(/^locator\(|\)$/g, '').slice(0, 80); } catch { return 'phần tử'; } };
// Phần tử đã nằm trọn trong màn hình thì khỏi lăn (popup cố định ở góc, nút đang ngay trước mắt...)
async function inView(t) {
  const box = await t.boundingBox().catch(() => null), vh = (t.page().viewportSize() || { height: 800 }).height;
  return !!box && box.y >= 0 && box.y + Math.min(box.height, 40) <= vh;
}

// deps cho scrollToElement -- ambientMouseMove thật của interactXHome_Update (nhích chuột giữa các lượt lăn), không có thì bỏ qua
function deps() {
  let ambientMouseMove = async () => {};
  try { ambientMouseMove = require('./xlv3_interactXHome_Update').ambientMouseMove; } catch {}
  return { ...helpers, ambientMouseMove };
}

// Phần tử đang hiện trên trang chưa (kiểm tra ngay, không chờ)
async function isShown(el) { return first(el).isVisible().catch(() => false); }

// Chờ phần tử hiện ra -- true/false, không throw
async function waitEl(el, timeout = 15000) {
  const ok = await first(el).waitFor({ state: 'visible', timeout }).then(() => true, () => false);
  if (!ok) log(`[waitEl] Hết ${timeout}ms chưa thấy: ${nameOf(el)}`);
  return ok;
}

// Chờ phần tử biến mất (popup đóng, loading xong...)
async function waitGone(el, timeout = 15000) {
  const ok = await first(el).waitFor({ state: 'hidden', timeout }).then(() => true, () => false);
  if (!ok) log(`[waitGone] Hết ${timeout}ms vẫn còn: ${nameOf(el)}`);
  return ok;
}

// Chờ 1 trong nhiều phần tử hiện ra trước -- trả index cái hiện ra (-1 nếu hết giờ). VD: đăng nhập xong thì ra Home hay ra ô 2FA?
async function waitAny(els, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    for (let i = 0; i < els.length; i++) if (await isShown(els[i])) return i;
    await first(els[0]).page().waitForTimeout(250 + Math.random() * 250);
  }
  log(`[waitAny] Hết ${timeout}ms không thấy phần tử nào trong ${els.length} cái.`);
  return -1;
}

// Lăn chuột thật tới phần tử (không nhảy tức thời như scrollIntoViewIfNeeded)
async function scrollEl(el) {
  const t = first(el);
  if (!(await waitEl(t))) return false;
  if (await inView(t)) return true;
  return scrollToElement(t.page(), log, deps(), t, nameOf(el)).catch((e) => { log(`[scrollEl] ${e.message}`); return false; });
}

// Di chuột tới phần tử (hover -- mở menu, hiện tooltip...)
async function hoverEl(el) {
  const t = first(el);
  if (!(await scrollEl(t))) return false;
  const box = await t.boundingBox().catch(() => null);
  if (!box) { log(`[hoverEl] Không lấy được toạ độ: ${nameOf(el)}`); return false; }
  const { x, y, size } = clickPoint(box);
  await helpers.moveMouseVisibly(t.page(), x, y, undefined, size);
  return true;
}

// Click tự nhiên: chờ hiện -> lăn tới -> đi chuột -> nhấn
async function clickEl(el, timeout = 15000) {
  const t = first(el);
  if (!(await waitEl(t, timeout))) return false;
  if (!(await inView(t))) await scrollToElement(t.page(), log, deps(), t, nameOf(el)).catch(() => {});
  try { await helpers.clickVisibly(t.page(), t, timeout); return true; } catch (e) { log(`[clickEl] ${nameOf(el)}: ${e.message}`); return false; }
}

// Click vào ô rồi gõ như người. Ô đang có chữ thì Ctrl+A xoá trước (opts.clear=false để giữ lại). opts.enter=true: gõ xong nhấn Enter.
async function typeEl(el, text, opts = {}) {
  const t = first(el), page = t.page();
  if (!(await clickEl(t, opts.timeout))) return false;
  const cur = await t.inputValue().catch(() => t.innerText().catch(() => ''));
  if ((opts.clear ?? true) && cur) {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.waitForTimeout(80 + Math.random() * 150);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(150 + Math.random() * 250);
  }
  await humanType(page, String(text ?? ''), opts.typos === undefined ? {} : { typos: opts.typos });
  if (opts.enter) { await page.waitForTimeout(250 + Math.random() * 500); await page.keyboard.press('Enter'); }
  return true;
}

// Lấy chữ của phần tử ('' nếu không có)
async function getText(el) { return (await first(el).innerText({ timeout: 5000 }).catch(() => '')).trim(); }

// Nghỉ như người (chuột rung nhẹ) -- truyền page hoặc 1 element bất kỳ
async function pause(pageOrEl, minMs = 500, maxMs = 1600) {
  const page = typeof pageOrEl.page === 'function' ? pageOrEl.page() : pageOrEl;
  await helpers.humanPause(page, minMs, maxMs);
}

/**
 * Vòng lặp xử lý: phần tử nào HIỆN RA thì làm việc của nó, lặp tới khi gặp rule done hoặc hết giờ.
 *   { el, click: true }              -> hiện thì click
 *   { el, type: 'chữ', enter: true } -> hiện thì gõ (enter: gõ xong nhấn Enter)
 *   { el, do: async (el) => {...} }  -> hiện thì chạy hàm tuỳ ý
 *   { el, done: true }               -> hiện thì KẾT THÚC vòng lặp (thành công). Có thể kèm click/type -- làm xong rồi mới kết thúc.
 *   { el, fail: 'lý do' }            -> hiện thì KẾT THÚC vòng lặp (thất bại), VD hiện chữ "suspended"
 *   max: số lần tối đa xử lý 1 rule (mặc định: click 3, type 1, do 3) -- tránh click mãi 1 nút không ăn
 * opts: { timeout = 60000, idle = [600, 1400] ms nghỉ mỗi vòng khi không có gì để làm }
 * Trả về { ok: true, rule } khi gặp done; { ok: false, reason } khi gặp fail / hết giờ.
 */
async function whileHandle(rules, opts = {}) {
  const timeout = opts.timeout ?? 60000, [idleMin, idleMax] = opts.idle || [600, 1400];
  const page = first(rules[0].el).page(), end = Date.now() + timeout, count = rules.map(() => 0);
  while (Date.now() < end) {
    let acted = false;
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i], max = r.max ?? (r.type !== undefined ? 1 : 3);
      if (!(await isShown(r.el))) continue;
      if (r.fail) { log(`[whileHandle] Gặp điều kiện dừng: ${r.fail}`); return { ok: false, reason: r.fail, rule: r }; }
      const hasAction = r.click || r.type !== undefined || r.do;
      if (hasAction && count[i] < max) {
        count[i]++;
        log(`[whileHandle] Thấy ${r.name || nameOf(r.el)} -> ${r.do ? 'chạy hàm' : r.type !== undefined ? 'gõ' : 'click'} (lần ${count[i]}/${max})`);
        if (r.do) await r.do(first(r.el)); else if (r.type !== undefined) await typeEl(r.el, r.type, r); else await clickEl(r.el);
        acted = true;
        await pause(page, 600, 1500);
      }
      if (r.done) { log(`[whileHandle] Xong: ${r.name || nameOf(r.el)}`); return { ok: true, rule: r }; }
      if (acted) break; // làm xong 1 việc thì quét lại từ đầu -- trang đã đổi sau thao tác
    }
    if (!acted) await page.waitForTimeout(idleMin + Math.random() * (idleMax - idleMin));
  }
  log(`[whileHandle] Hết ${timeout}ms chưa gặp điều kiện kết thúc.`);
  return { ok: false, reason: 'timeout' };
}

module.exports = { useLog, isShown, waitEl, waitGone, waitAny, scrollEl, hoverEl, clickEl, typeEl, getText, pause, whileHandle };
