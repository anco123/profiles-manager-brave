/**
 * scripts/xlv1_humanInput.js
 * -----------------------------------------------------------------------
 * Mô phỏng con lăn / di chuột / click / gõ phím theo SỐ ĐO THẬT (trang /input-test, Windows, Chrome, scale 100%, 10/2026):
 *   Con lăn : mỗi sự kiện đúng 1 nấc = deltaY 100, wheelDeltaY -120 khớp theo. (Chuột thật đôi khi ra 200/-240 khi Chrome gộp 2 nấc,
 *             nhưng sự kiện giả lập 200 vẫn báo wheelDeltaY -120 -- lệch nhau, lộ -- nên KHÔNG gửi 200.)
 *             1-7 nấc mỗi lượt (trung vị 3), nấc cách nhau 16-90ms (trung vị 32ms). Bản cũ gửi số lẻ (153, 246.7...) -- thiết bị thật không có.
 *   Di chuột: 150-530px mất 0.6-1s (Fitts: xa / đích nhỏ thì lâu hơn), gần thẳng, ~13% vượt đích chút rồi chỉnh; mousemove ~16ms/lần.
 *   Click   : dừng ~250ms trước khi nhấn, giữ 80-125ms, không xê dịch lúc nhấn, điểm nhấn lệch tâm ~9px (theo cỡ nút).
 *   Gõ phím : giữ phím ~96ms; giữa 2 phím trung vị ~176ms (đuôi dài, 10% > 730ms), sau dấu cách ~400ms, trước dấu câu chậm hẳn (dừng
 *             nghĩ); Backspace ~9% số phím (gõ sai rồi khựng ~300-600ms mới xoá 1-3 phím); ~12% phím đè nhau (phím sau nhấn trước khi nhả phím trước). (Đã loại các sự kiện do
 *             Unikey/EVKey tự chèn khi đo -- backspace cách 1-3ms, giữ phím 0.5ms -- tay người không làm được.)
 * Mỗi profile một "kiểu tay" gốc riêng theo id profile (server.js gắn page.__profileId), dao động quanh số đo trên; MỖI LẦN CHẠY lệch
 * thêm ±15% quanh gốc đó (xem persona()), và từng thao tác đều rút thăm ngẫu nhiên -- không lần chạy nào giống lần nào.
 * -----------------------------------------------------------------------
 */

const sleep = (page, ms) => page.waitForTimeout(Math.max(0, ms));

// RNG có seed (mulberry32) -- kiểu tay cố định theo profile
function seeded(str) {
  let h = 1779033703 ^ String(str).length;
  for (let i = 0; i < String(str).length; i++) { h = Math.imul(h ^ String(str).charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h |= 0; h = (h + 0x6d2b79f5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const between = (r, a, b) => a + r() * (b - a);
// Phân phối lệch phải (log-normal) quanh trung vị -- thời gian thao tác người thật đều có đuôi dài, không phải random đều
const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
const lognormal = (median, sigma) => median * Math.exp(sigma * gauss());
// Lệch 2 phía khác nhau: phía nhanh hẹp (sigmaLow), phía chậm dài (sigmaHigh) -- nhịp gõ thật hiếm khi nhanh hơn ~120ms nhưng hay khựng lâu
const skewed = (median, sigmaLow, sigmaHigh) => { const z = gauss(); return median * Math.exp(z * (z < 0 ? sigmaLow : sigmaHigh)); };

function persona(page) {
  if (page.__inputPersona) return page.__inputPersona;
  const r = page.__profileId ? seeded(page.__profileId) : Math.random;
  const base = {
    wheelBurst: between(r, 2, 4),          // số nấc trung bình mỗi lượt lăn
    wheelGap: between(r, 18, 32),          // ms giữa 2 nấc trong 1 lượt (đã trừ hao độ trễ của lệnh wheel)
    moveSpeed: between(r, 0.8, 1.25),      // nhân thời gian di chuột (Fitts)
    moveCurve: between(r, 0.12, 0.28),     // độ cong đường đi (tỉ lệ khoảng cách)
    overshoot: between(r, 0.08, 0.18),
    prePress: between(r, 220, 360),        // ms dừng ngắm trước khi nhấn (trung vị phần "dừng hẳn"; ~30% lần nhấn gần như ngay khi tới)
    clickHold: between(r, 74, 100),
    keyHold: between(r, 80, 108),
    keyFlight: between(r, 145, 205),       // ms từ lúc nhấn phím trước tới lúc nhấn phím sau (trung vị, chữ thường giữa từ)
    typoRate: between(r, 0.03, 0.06),
    thinkPause: between(r, 0.012, 0.03),   // tỉ lệ dừng nghĩ 1-2.5s giữa chừng
  };
  // Mỗi LẦN CHẠY lệch thêm ±15% quanh kiểu tay gốc của profile (hôm nhanh hôm chậm, lúc tỉnh lúc mệt) -- cùng 1 profile mà các lần chạy
  // vẫn khác nhau; kiểu tay gốc (theo id) chỉ giữ cho mỗi tài khoản có nét riêng, không phải 500 profile cùng 1 nhịp.
  const day = Math.random() < 0.5 ? between(Math.random, 0.85, 1) : between(Math.random, 1, 1.15); // nhịp chung cả phiên: nhanh/chậm hơn mọi khi
  const wobble = () => between(Math.random, 0.9, 1.1);                                              // từng thông số lệch thêm chút riêng
  page.__inputPersona = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v * wobble() * (/Gap|Speed|prePress|Hold|Flight/.test(k) ? day : 1)]));
  return page.__inputPersona;
}

// ---------------------------------------------------------------- con lăn
// Lăn khoảng `delta` px (âm = lên) bằng các nấc 100 thật. Nhiều nấc thì chia thành vài lượt, nghỉ giữa các lượt như người thật.
async function humanWheel(page, delta) {
  const p = persona(page);
  const dir = delta < 0 ? -1 : 1;
  let notches = Math.max(1, Math.round(Math.abs(delta) / 100));
  while (notches > 0) {
    const burst = Math.min(notches, Math.max(1, Math.round(lognormal(p.wheelBurst, 0.45))));
    let left = burst;
    while (left > 0) {
      await page.mouse.wheel(0, dir * 100);
      left -= 1;
      if (left > 0) await sleep(page, Math.random() < 0.3 ? between(Math.random, 11, 14) : lognormal(p.wheelGap, 0.55));
    }
    notches -= burst;
    if (notches > 0) await sleep(page, lognormal(650, 0.4)); // nghỉ giữa 2 lượt lăn
  }
}

// ---------------------------------------------------------------- di chuột
// Đi từ vị trí hiện tại tới (x, y). targetSize = cỡ đích (px) cho Fitts -- đích nhỏ / xa thì đi lâu hơn.
async function humanMove(page, from, x, y, targetSize = 40, onPoint = null) {
  const p = persona(page);
  const dx = x - from.x, dy = y - from.y, dist = Math.hypot(dx, dy);
  if (dist < 2) { await page.mouse.move(x, y).catch(() => {}); if (onPoint) await onPoint(x, y); return; }
  const fitts = 200 + 200 * Math.log2(dist / Math.max(8, targetSize) + 1);
  const duration = Math.min(2500, fitts * p.moveSpeed * between(Math.random, 0.8, 1.25));
  const steps = Math.max(4, Math.round(duration / 16.5));
  const bow = (Math.random() - 0.5) * 2 * p.moveCurve * Math.min(dist, 400);
  const nx = -dy / dist, ny = dx / dist;
  const cx = (from.x + x) / 2 + nx * bow, cy = (from.y + y) / 2 + ny * bow;
  const over = dist > 80 && Math.random() < p.overshoot ? between(Math.random, 4, 18) : 0; // vượt đích chút rồi kéo về
  const ex = x + (dx / dist) * over, ey = y + (dy / dist) * over;
  const ease = (t) => t * t * t * (10 - 15 * t + 6 * t * t); // minimum-jerk: tăng tốc êm rồi giảm tốc êm khi tới đích, như tay người
  for (let i = 1; i <= steps; i++) {
    const t = ease(i / steps), mt = 1 - t;
    const px = mt * mt * from.x + 2 * mt * t * cx + t * t * ex + (Math.random() - 0.5) * 1.2;
    const py = mt * mt * from.y + 2 * mt * t * cy + t * t * ey + (Math.random() - 0.5) * 1.2;
    try { await page.mouse.move(px, py); } catch { return; }
    if (onPoint) await onPoint(px, py);
    await sleep(page, Math.random() < 0.06 ? 30 : between(Math.random, 12.5, 15)); // ~60Hz (đã trừ hao độ trễ của lệnh move), thỉnh thoảng rớt 1 khung
  }
  if (over) {
    await sleep(page, lognormal(90, 0.4));
    const back = Math.max(3, Math.round(over / 3));
    for (let i = 1; i <= back; i++) { const t = i / back; try { await page.mouse.move(ex + (x - ex) * t, ey + (y - ey) * t); } catch { return; } if (onPoint) await onPoint(x, y); await sleep(page, 16); }
  } else {
    await page.mouse.move(x, y).catch(() => {});
    if (onPoint) await onPoint(x, y);
  }
}

// Điểm nhấn lệch tâm theo cỡ nút (trung vị ~9px với nút 18-60px), luôn nằm trong HÌNH ELIP nội tiếp nút (trong 80% bán kính) --
// nút like / retweet / reply của X là hình tròn, góc khung chữ nhật bao quanh nằm ngoài nút.
function clickPoint(box) {
  const size = Math.min(box.width, box.height);
  const g = () => { let v = 0; for (let i = 0; i < 3; i++) v += Math.random() - 0.5; return v / 0.9; }; // gần chuẩn
  const rx = box.width / 2, ry = box.height / 2;
  let ox = g() * Math.min(rx * 0.8, Math.max(2, size * 0.5)), oy = g() * Math.min(ry * 0.8, Math.max(2, size * 0.5));
  const k = Math.hypot(ox / (rx * 0.8), oy / (ry * 0.8));
  if (k > 1) { ox /= k; oy /= k; }
  return { x: box.x + rx + ox, y: box.y + ry + oy, size };
}

async function humanPressMouse(page) {
  const p = persona(page);
  // Đo được rất rộng: ~30% lần nhấn gần như ngay khi chuột tới (0-90ms), còn lại dừng ngắm quanh 250-400ms
  await sleep(page, Math.random() < 0.3 ? between(Math.random, 0, 90) : Math.min(900, lognormal(p.prePress, 0.35)));
  await page.mouse.down();
  await sleep(page, Math.min(220, lognormal(p.clickHold, 0.2)));
  await page.mouse.up();
}

// ---------------------------------------------------------------- bàn phím (bố cục US)
const SHIFTED = '~!@#$%^&*()_+{}|:"<>?';
const ROWS = ['`1234567890-=', 'qwertyuiop[]\\', "asdfghjkl;'", 'zxcvbnm,./'];
function neighbor(ch) { // phím bên cạnh trên bàn phím -- kiểu gõ trượt tay
  const lower = ch.toLowerCase();
  for (let r = 0; r < ROWS.length; r++) {
    const c = ROWS[r].indexOf(lower);
    if (c < 0) continue;
    const opts = [ROWS[r][c - 1], ROWS[r][c + 1], ROWS[r - 1] && ROWS[r - 1][c], ROWS[r + 1] && ROWS[r + 1][c]].filter((k) => k && /[a-z]/.test(k));
    if (!opts.length) return null;
    const k = opts[Math.floor(Math.random() * opts.length)];
    return ch === lower ? k : k.toUpperCase();
  }
  return null;
}
const needsShift = (ch) => /[A-Z]/.test(ch) || SHIFTED.includes(ch);
const typable = (ch) => /^[\x20-\x7e]$/.test(ch);

// Gõ `text` vào phần tử đang focus. opts.typos: cho phép gõ sai rồi xoá (mặc định CHỈ với văn bản tự nhiên -- có chữ + dấu cách, dài
// > 15 ký tự; KHÔNG với mật khẩu / username / mã 2FA, vì ô OTP có thể tự submit khi đủ 6 số).
async function humanType(page, text, opts = {}) {
  const p = persona(page);
  const allowTypos = opts.typos ?? (/[a-z]/i.test(text) && / /.test(text) && text.length > 15);
  // Lập lịch theo thời điểm NHẤN phím (down-to-down) như số đo -- phím trước chưa nhả mà đã tới lúc nhấn phím sau thì phím sau nhấn
  // trước (đè phím, ~10% như tay thật). Bản cũ chờ khoảng nghỉ SAU khi nhả phím trước -> nhịp bị cộng thêm thời gian giữ phím.
  let lastDown = Date.now(), held = null; // held = { key, upAt, shift }
  const waitUntil = (t) => sleep(page, t - Date.now());
  const release = async () => { if (!held) return; await waitUntil(held.upAt); await page.keyboard.up(held.key); if (held.shift) { await sleep(page, lognormal(25, 0.5)); await page.keyboard.up('Shift'); } held = null; };
  const press = async (ch, flight) => {
    const at = lastDown + flight, hold = Math.min(250, lognormal(p.keyHold, 0.3));
    if (ch.length === 1 && !typable(ch)) { await release(); await waitUntil(at); await page.keyboard.insertText(ch); lastDown = Date.now(); return; } // ký tự ngoài bàn phím US (emoji...) -- chèn thẳng
    const shift = needsShift(ch);
    if (held && (shift || held.shift || held.upAt <= at)) await release(); // không đè phím khi có Shift
    if (shift) { await waitUntil(at - lognormal(70, 0.4)); await page.keyboard.down('Shift'); }
    await waitUntil(at);
    await page.keyboard.down(ch);
    lastDown = Date.now();
    if (held) await release(); // phím trước được nhả SAU khi phím này đã nhấn (đè phím)
    held = { key: ch, upAt: lastDown + hold, shift };
  };
  const flush = release;
  const flightFor = (prev, ch) => {
    let m = p.keyFlight;
    if (prev === ' ') m *= 2.4;               // đầu từ mới -- chậm nhất (đo được ~400ms)
    else if (ch === ' ') m *= 1.1;
    else if (/[.,!?;:]/.test(ch)) m *= 2.6; // cuối câu / dấu câu thường khựng lại
    let f = skewed(m, 0.4, 0.9); // số đo: p25 ~0.7x trung vị, p90 ~4x trung vị
    if (Math.random() < p.thinkPause) f += between(Math.random, 900, 2500); // khựng lại nghĩ
    return Math.min(4000, Math.max(25, f));
  };
  let prev = '';
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const wrong = allowTypos && /[a-z]/i.test(ch) && Math.random() < p.typoRate ? neighbor(ch) : null;
    if (wrong) {
      await press(wrong, flightFor(prev, wrong));
      // gõ thêm 0-2 ký tự đúng rồi mới phát hiện sai (giống đo được: thường xoá 1-3 phím)
      const extra = Math.min(chars.length - i - 1, Math.random() < 0.4 ? 0 : Math.random() < 0.6 ? 1 : 2);
      const extraChars = chars.slice(i + 1, i + 1 + extra).filter(typable);
      for (const e of extraChars) await press(e, flightFor(wrong, e));
      await flush();
      await sleep(page, lognormal(380, 0.35)); // khựng lại khi thấy gõ sai
      for (let b = 0; b <= extraChars.length; b++) await press('Backspace', b ? lognormal(130, 0.35) : 0);
      await flush();
      prev = '';
    }
    await press(ch, flightFor(prev, ch));
    prev = ch;
  }
  await flush();
}

module.exports = { persona, humanWheel, humanMove, clickPoint, humanPressMouse, humanType };
