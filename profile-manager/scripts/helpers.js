function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

async function waitAndScreenshot(page, path = 'data/screenshot.png') {
  // FIX: networkidle can hang indefinitely on pages with background
  // polling/websockets/analytics. Race it against a hard timeout and
  // fall back to 'load' so this never blocks the whole script.
  try {
    await page.waitForLoadState('networkidle', { timeout: 8000 });
  } catch {
    await page.waitForLoadState('load').catch(() => {});
  }
  await page.screenshot({ path });
  return path;
}

async function getPageInfo(page) {
  return {
    title: await page.title(),
    url: page.url(),
  };
}

function totp(secretBase32, digits = 6, stepSeconds = 30) {
  const crypto = require('crypto');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = secretBase32.replace(/=+$/, '').toUpperCase().replace(/[^A-Z2-7]/g, '');

  let bits = '';
  for (const char of clean) bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  const keyBytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) keyBytes.push(parseInt(bits.slice(i, i + 8), 2));
  const key = Buffer.from(keyBytes);

  const counter = Math.floor(Date.now() / 1000 / stepSeconds);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter >>> 0, 4);

  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binCode % Math.pow(10, digits)).padStart(digits, '0');
}

async function showVisibleCursor(page) {
  const pos = page.__cursorPos || { x: 0, y: 0 };
  try {
    await page.evaluate((p) => {
      if (document.getElementById('__visible_cursor__')) return;
      const cursor = document.createElement('div');
      cursor.id = '__visible_cursor__';
      cursor.style.cssText = `
        position: fixed; width: 18px; height: 18px;
        margin: -9px 0 0 -9px; border-radius: 50%;
        background: rgba(255, 70, 70, 0.85); border: 2px solid #fff;
        box-shadow: 0 0 6px rgba(0,0,0,0.6); pointer-events: none;
        z-index: 2147483647;
      `;
      cursor.style.left = `${p.x}px`;
      cursor.style.top = `${p.y}px`;
      document.body.appendChild(cursor);
    }, pos);
  } catch {
    // FIX: page navigated / context destroyed mid-call. Nothing to do
    // here except swallow it -- the overlay will be re-injected on the
    // next call once the new document is ready.
  }
}

async function updateCursorDot(page, x, y) {
  try {
    await page.evaluate(({ px, py }) => {
      const c = document.getElementById('__visible_cursor__');
      if (c) { c.style.left = `${px}px`; c.style.top = `${py}px`; }
    }, { px: x, py: y });
  } catch {
    // FIX: same race-condition guard as showVisibleCursor -- a
    // navigation mid-loop used to throw "Execution context was
    // destroyed" and crash the whole script. Now it's a no-op.
  }
}

async function moveMouseVisibly(page, x, y, steps) {
  // FIX (round 2): seed __cursorPos BEFORE showVisibleCursor runs.
  // Previously the overlay was created first using whatever
  // page.__cursorPos happened to be (often undefined -> {x:0,y:0}),
  // so the dot would flash in the top-left corner for a frame before
  // "jumping" to the real starting point once the animation loop
  // began. Seeding first means the dot is created already at the
  // correct starting position.
  if (!page.__cursorPos) {
    const viewport = page.viewportSize() || { width: 1280, height: 800 };
    page.__cursorPos = {
      x: randomBetween(viewport.width * 0.2, viewport.width * 0.8),
      y: randomBetween(viewport.height * 0.2, viewport.height * 0.8),
    };
  }
  await showVisibleCursor(page);

  const start = page.__cursorPos;

  const dx = x - start.x;
  const dy = y - start.y;
  const dist = Math.hypot(dx, dy);

  // FIX (round 2): moving to (approximately) where the cursor already
  // is doesn't need a multi-step Bezier animation -- the old code
  // still ran 8-12 pointless steps for a near-zero-distance move.
  if (dist < 2) {
    await page.mouse.move(x, y).catch(() => {});
    await updateCursorDot(page, x, y);
    page.__cursorPos = { x, y };
    return;
  }

  if (steps === undefined) {
    steps = Math.round(Math.min(50, Math.max(10, dist / 18)) * randomBetween(0.8, 1.25));
  }

  const bow = (Math.random() - 0.5) * Math.min(dist * 0.4, 100);
  const nx = dist === 0 ? 0 : -dy / dist;
  const ny = dist === 0 ? 0 : dx / dist;
  const controlX = (start.x + x) / 2 + nx * bow;
  const controlY = (start.y + y) / 2 + ny * bow;

  const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

  for (let i = 1; i <= steps; i++) {
    const t = easeInOutCubic(i / steps);
    const mt = 1 - t;

    const px = mt * mt * start.x + 2 * mt * t * controlX + t * t * x + (Math.random() - 0.5) * 1.5;
    const py = mt * mt * start.y + 2 * mt * t * controlY + t * t * y + (Math.random() - 0.5) * 1.5;

    try {
      await page.mouse.move(px, py);
    } catch {
      // FIX: page closed/navigated mid-move -- stop the loop instead
      // of continuing to throw on every remaining iteration.
      return;
    }
    await updateCursorDot(page, px, py);

    await page.waitForTimeout(4 + Math.random() * 7);
  }

  if (dist > 40 && Math.random() < 0.18) {
    const overshootX = x + (Math.random() - 0.5) * 16;
    const overshootY = y + (Math.random() - 0.5) * 16;
    await page.mouse.move(overshootX, overshootY).catch(() => {});
    await updateCursorDot(page, overshootX, overshootY);
    await page.waitForTimeout(20 + Math.random() * 50);

    await page.mouse.move(x, y).catch(() => {});
    await updateCursorDot(page, x, y);
  }

  page.__cursorPos = { x, y };
}

// FIX: new helper -- checks the things Playwright's own .click() would
// normally check for you (in viewport, not covered by another
// element) before we bypass .click() to do the manual mouse down/up.
// Without this, a covered or off-screen element gets silently
// "clicked" at a coordinate that isn't actually it.
async function ensureActionable(page, locator, box) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  // re-measure after scrolling, since the box may have moved
  const freshBox = await locator.boundingBox();
  if (!freshBox) throw new Error('ensureActionable: element has no bounding box after scrolling into view');

  const cx = freshBox.x + freshBox.width / 2;
  const cy = freshBox.y + freshBox.height / 2;

  // FIX (round 2): the first pass only checked that *some* element
  // existed at that point, which is true almost always -- it never
  // actually confirmed that element was the target (or inside it).
  // A real overlay/modal/tooltip sitting on top would have passed the
  // old check silently. Now we compare the topmost element at the
  // point against the target node itself.
  const isTopMost = await locator.evaluate(
    (el, { cx, cy }) => {
      const topEl = document.elementFromPoint(cx, cy);
      return !!topEl && (topEl === el || el.contains(topEl));
    },
    { cx, cy }
  ).catch(() => true); // if the check itself fails (e.g. detached node), don't block the click on that

  if (!isTopMost) throw new Error('ensureActionable: target is covered by another element');
  return freshBox;
}

async function clickVisibly(page, locatorOrBox, timeout = 15000) {
  // Đóng hết tab ngoài tab chính (index 0) trước khi click, phòng
  // extension tự ý bật thêm tab giữa chừng -- xem xlv1_ensureSingleTab.js.
  await require('./xlv1_ensureSingleTab').ensureSingleTab(page.context());

  let box;
  if (locatorOrBox.boundingBox) {
    await locatorOrBox.waitFor({ state: 'visible', timeout });
    box = await locatorOrBox.boundingBox({ timeout });
    if (!box) throw new Error('clickVisibly: target has no bounding box (not visible?)');
    // FIX: this is the actionability check that was missing --
    // scrolls into view and confirms nothing else is sitting on top
    // of the element before we compute a raw coordinate to click.
    //
    // FIX (round 3): "covered by another element" thường là 1 popup/
    // overlay/tooltip VỪA hiện ra (do hover/di chuyển chuột ngay trước
    // đó) đè tạm lên element, không phải element thật sự không click
    // được. Trước khi báo lỗi, né chuột sang 1 điểm NGẪU NHIÊN khác
    // (không đi lại đúng đường cũ vừa làm lộ overlay), đợi 1 chút cho
    // overlay đó tự ổn định/biến mất, rồi đo + kiểm tra lại -- thử tối
    // đa 2 lần trước khi thật sự coi đây là lỗi.
    const MAX_COVERED_RETRIES = 2;
    let coveredErr = null;
    for (let attempt = 0; attempt <= MAX_COVERED_RETRIES; attempt++) {
      try {
        box = await ensureActionable(page, locatorOrBox, box);
        coveredErr = null;
        break;
      } catch (err) {
        const isCoveredErr = /covered by another element/.test(err.message);
        if (!isCoveredErr || attempt === MAX_COVERED_RETRIES) { coveredErr = err; break; }

        const viewport = page.viewportSize() || { width: 1280, height: 800 };
        const awayX = randomBetween(viewport.width * 0.1, viewport.width * 0.9);
        const awayY = randomBetween(viewport.height * 0.1, viewport.height * 0.9);
        await moveMouseVisibly(page, awayX, awayY);
        await page.waitForTimeout(300 + Math.random() * 400);

        // Đo lại box -- phần tử che/layout có thể đã dịch chuyển.
        box = await locatorOrBox.boundingBox({ timeout }).catch(() => box);
        if (!box) { coveredErr = new Error('clickVisibly: target has no bounding box (not visible?)'); break; }
      }
    }
    if (coveredErr) throw coveredErr;

    // FIX (round 2): a disabled element is visible and has a bounding
    // box, so nothing above catches it -- mouse.down()/up() at its
    // coordinates just silently does nothing. Fail loudly instead of
    // leaving the caller to wonder why the form never submitted.
    const enabled = await locatorOrBox.isEnabled().catch(() => true);
    if (!enabled) throw new Error('clickVisibly: target is disabled');
  } else {
    box = locatorOrBox;
  }
  if (!box) throw new Error('clickVisibly: target has no bounding box (not visible?)');

  const offsetX = (Math.random() - 0.5) * Math.min(box.width * 0.5, 14);
  const offsetY = (Math.random() - 0.5) * Math.min(box.height * 0.5, 14);
  const x = box.x + box.width / 2 + offsetX;
  const y = box.y + box.height / 2 + offsetY;

  await moveMouseVisibly(page, x, y);
  await page.evaluate(({ x, y }) => {
    const ripple = document.createElement('div');
    ripple.style.cssText = `
      position: fixed; left: ${x}px; top: ${y}px; width: 8px; height: 8px;
      margin: -4px 0 0 -4px; border-radius: 50%;
      background: rgba(255, 70, 70, 0.9); pointer-events: none;
      z-index: 2147483647; transition: width .3s ease-out, height .3s ease-out, margin .3s ease-out, opacity .3s ease-out;
    `;
    document.body.appendChild(ripple);
    requestAnimationFrame(() => {
      ripple.style.width = '36px';
      ripple.style.height = '36px';
      ripple.style.margin = '-18px 0 0 -18px';
      ripple.style.opacity = '0';
    });
    setTimeout(() => ripple.remove(), 320);
  }, { x, y }).catch(() => {});

  await page.mouse.down();
  await page.waitForTimeout(40 + Math.random() * 90);
  await page.mouse.up();
  return true; // click xong -- lỗi thì đã throw ở trên. Nơi gọi kiểu `clicked = await clickVisibly(...); if (!clicked)` (mở post khi lướt Home, follow_friends) trước đây luôn nhận undefined -> tưởng click hỏng
}

async function typeVisibly(page, locator, text, delay = 70, timeout = 15000) {
  // FIX (round 2): originally used pressSequentially(text, { delay })
  // with one fixed delay for the whole string -- every inter-key gap
  // was identical, which is exactly the kind of uniform timing this
  // whole file is otherwise trying to avoid (see typeWithJitter).
  // Now delay is treated as a center point and jittered per key,
  // keeping the same function signature so existing call sites don't
  // need to change.
  await clickVisibly(page, locator, timeout);
  const spread = delay * 0.4;
  for (const char of text) {
    await locator.pressSequentially(char, { delay: 0 });
    await page.waitForTimeout(Math.max(0, delay - spread + Math.random() * spread * 2));
  }
}

async function randomTabDelay(page) {
  const delay = Math.random() < 0.15
    ? 300 + Math.random() * 500
    : 70 + Math.random() * 180;
  await page.waitForTimeout(delay);
}

async function focusFieldVaried(page, locator, timeout = 15000) {
  await locator.waitFor({ state: 'visible', timeout });

  const method = Math.random() < 0.5 ? 'click' : 'tab';

  if (method === 'click') {
    await clickVisibly(page, locator, timeout);
    return 'click';
  }

  const maxTabs = 25;
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press('Tab');
    await randomTabDelay(page);
    const isFocused = await locator.evaluate((el) => el === document.activeElement).catch(() => false);
    if (isFocused) return 'tab';
  }
  await clickVisibly(page, locator, timeout);
  return 'click-fallback';
}

async function confirmStepVaried(page, buttonLocator, timeout = 15000) {
  await buttonLocator.waitFor({ state: 'visible', timeout });

  const method = ['click', 'enter', 'tab-enter'][Math.floor(Math.random() * 3)];

  if (method === 'click') {
    await clickVisibly(page, buttonLocator, timeout);
    return 'click';
  }

  if (method === 'enter') {
    // FIX: previously pressed Enter unconditionally, with no check on
    // what actually had focus. If focus was sitting in a text field
    // (e.g. right after typing), Enter could submit the wrong form,
    // insert a newline, or trigger an unrelated default button.
    const alreadyFocused = await buttonLocator.evaluate((el) => el === document.activeElement).catch(() => false);
    if (alreadyFocused) {
      await page.keyboard.press('Enter');
      return 'enter';
    }
    // not focused on the target -- fall through to the tab-to-find-it path
  }

  const maxTabs = 15;
  let focused = await buttonLocator.evaluate((el) => el === document.activeElement).catch(() => false);
  for (let i = 0; i < maxTabs && !focused; i++) {
    await page.keyboard.press('Tab');
    await randomTabDelay(page);
    focused = await buttonLocator.evaluate((el) => el === document.activeElement).catch(() => false);
  }
  if (focused) {
    await page.keyboard.press('Enter');
    return 'tab-enter';
  }
  await clickVisibly(page, buttonLocator, timeout);
  return 'tab-enter-fallback-click';
}

async function typeWithJitter(page, locator, text, minDelay = 40, maxDelay = 160, timeout = 15000) {
  await locator.waitFor({ state: 'visible', timeout });
  for (const char of text) {
    await locator.pressSequentially(char, { delay: 0 });
    await page.waitForTimeout(minDelay + Math.random() * (maxDelay - minDelay));
  }
}

async function humanPause(page, minMs = 500, maxMs = 1600) {
  const totalMs = minMs + Math.random() * (maxMs - minMs);

  // Trước đây đây là page.waitForTimeout() thuần -- chuột đứng im
  // TUYỆT ĐỐI suốt cả khoảng này, kể cả những lần pause dài gần 1.6s.
  // Con người thật gần như không bao giờ để chuột bất động lâu như
  // vậy dù không định click gì -- vài hệ thống anti-bot chấm điểm dựa
  // trên đúng kiểu "khoảng lặng chuột" này. Chèn 1-2 lần rung nhẹ
  // trong lúc chờ, dùng LẠI moveMouseVisibly() đã có (đường cong +
  // easing + overshoot ngẫu nhiên) thay vì viết cơ chế di chuyển mới.
  if (!page.__cursorPos) {
    // Chưa có vị trí chuột thật nào trước đó (chưa từng click/move) --
    // rung ở đây sẽ làm chuột "từ hư không" nhảy vào giữa màn hình,
    // giả hơn là cứ đứng yên. Chỉ rung khi đã có vị trí thật để rung
    // QUANH nó.
    await page.waitForTimeout(totalMs);
    return;
  }

  // Pause càng ngắn thì càng ít lý do để rung (con người cũng không
  // kịp "nhấp nhổm" chuột trong nửa giây) -- xác suất/số lần rung tăng
  // dần theo độ dài của pause.
  const jiggleCount = totalMs < 700
    ? (Math.random() < 0.3 ? 1 : 0)
    : (Math.random() < 0.55 ? 1 : 2);

  if (jiggleCount === 0) {
    await page.waitForTimeout(totalMs);
    return;
  }

  const viewport = page.viewportSize() || { width: 1280, height: 800 };
  const segments = jiggleCount + 1;
  let used = 0;

  for (let i = 0; i < jiggleCount; i++) {
    const segmentMs = totalMs / segments;
    await page.waitForTimeout(segmentMs);
    used += segmentMs;

    // Rung nhẹ 15-50px quanh vị trí HIỆN TẠI -- không đi xa, không
    // băng qua phần tử khác trên trang, chỉ đủ để không đứng yên tuyệt
    // đối. Kẹp trong viewport để không móc chuột ra ngoài màn hình.
    const cur = page.__cursorPos;
    const angle = Math.random() * Math.PI * 2;
    const radius = 15 + Math.random() * 35;
    const targetX = Math.min(Math.max(cur.x + Math.cos(angle) * radius, 10), viewport.width - 10);
    const targetY = Math.min(Math.max(cur.y + Math.sin(angle) * radius, 10), viewport.height - 10);

    await moveMouseVisibly(page, targetX, targetY);
  }

  await page.waitForTimeout(Math.max(0, totalMs - used));
}

module.exports = {
  waitAndScreenshot,
  getPageInfo,
  totp,
  showVisibleCursor,
  moveMouseVisibly,
  clickVisibly,
  typeVisibly,
  focusFieldVaried,
  confirmStepVaried,
  typeWithJitter,
  humanPause,
};