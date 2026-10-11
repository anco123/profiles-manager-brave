/**
 * gpm-proxy-limiter.js — Mở hàng loạt profile GPM Login có giới hạn số cửa sổ.
 *   - MAX_WINDOWS   : tổng số cửa sổ mở cùng lúc.
 *   - MAX_PER_PROXY : số cửa sổ tối đa CÙNG LÚC dùng chung 1 proxy (0 = không giới hạn).
 *                     Profile không gán proxy cũng tính là 1 nhóm riêng "(no proxy)", bị giới hạn y như proxy thật.
 *   - Ngay trước khi mở, đọc lại proxy HIỆN TẠI của profile từ GPM (phòng khi vừa đổi proxy trong GPM).
 *   - Profile bị chặn vì proxy đã đủ slot thì giữ nguyên chỗ trong hàng đợi, mở profile kế tiếp không bị chặn.
 *
 * Yêu cầu: Node 18+ (có fetch sẵn, không cần cài gì), GPM Login đang mở và bật API local.
 * Chạy:
 *   node gpm-proxy-limiter.js                        → chạy hàng đợi theo CONFIG
 *   node gpm-proxy-limiter.js --check                → chỉ kiểm tra proxy từng profile + báo cáo theo cấu hình, KHÔNG mở gì
 *   node gpm-proxy-limiter.js --max=6 --per-proxy=2 --group=<id>   → ghi đè nhanh CONFIG khi tinh chỉnh
 */

const CONFIG = {
  API: 'http://127.0.0.1:19995',  // địa chỉ API local của GPM Login (xem trong Settings của GPM)
  PROFILE_IDS: [],                // danh sách id cần chạy; để rỗng = lấy theo GROUP_ID (rỗng nữa = toàn bộ profile)
  GROUP_ID: '',
  MAX_WINDOWS: 5,
  MAX_PER_PROXY: 2,
  PROXY_LIMITS: {},               // giới hạn riêng từng proxy, ghi đè MAX_PER_PROXY (0 = không giới hạn). VD: { '1.2.3.4:8080': 1, '(no proxy)': 3, 'tm://<key>|True': 1 }
  PROXY_KEY: 'hostport',          // 'hostport' = cùng host:port là 1 proxy | 'user' = phân biệt thêm theo username (proxy xoay/sticky theo user)
  RUN_MS: [60000, 120000],        // task() mặc định: giữ cửa sổ mở ngẫu nhiên trong khoảng này rồi đóng
  START_GAP_MS: [1500, 3000],     // nghỉ giữa 2 lần mở profile
  WIN_SCALE: 0.6,
  POLL_MS: 3000,                  // chu kỳ kiểm tra cửa sổ còn sống không (bạn tự tắt tay thì nhả slot luôn)
  RETRY: 1,                       // số lần thử mở lại nếu GPM start lỗi
  CLOSE_ON_EXIT: true,            // Ctrl+C thì đóng hết profile do script này mở
};

// ===== VIỆC CẦN LÀM VỚI MỖI PROFILE — sửa hàm này theo nhu cầu =====
// info.remote_debugging_address dùng để kết nối Playwright/Puppeteer, VD:
//   const { chromium } = require('playwright');
//   const browser = await chromium.connectOverCDP(`http://${info.remote_debugging_address}`);
//   const ctx = browser.contexts()[0], page = ctx.pages()[0] || await ctx.newPage();
//   await page.goto('https://x.com/home');
async function task(profile, info) {
  await sleep(rand(CONFIG.RUN_MS));
}

// ------------------------------------------------------------------
const NO_PROXY = '(no proxy)';
const STD_PROTOS = ['http', 'https', 'socks4', 'socks5'];
const active = new Map(); // id -> { name, key }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = ([a, b]) => a + Math.random() * (b - a);
const log = (...a) => console.log(`[${new Date().toLocaleTimeString('vi-VN', { hour12: false })}]`, ...a);
const rawProxyOf = (p) => p?.raw_proxy ?? p?.proxy ?? '';
const label = (key) => { const m = key.match(/^([a-z0-9]+):\/\/(.+)$/i); return m ? `${m[1]}://${m[2].slice(0, 4)}…` : key; }; // che API key của tm://, tinsoft://... khi in
const fmtLim = (n) => (n === Infinity ? '∞' : n);

async function api(path) {
  let res;
  try { res = await fetch(CONFIG.API + path, { signal: AbortSignal.timeout(120000) }); }
  catch (e) { throw new Error(`Không kết nối được GPM tại ${CONFIG.API} (GPM đã mở chưa, đúng port chưa?) — ${e.message}`); }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.success === false) throw new Error(`GPM ${path} → ${json?.message || `HTTP ${res.status}`}`);
  return json;
}

const getProfile = async (id) => (await api(`/api/v3/profiles/${id}`)).data;
const startProfile = async (id) => (await api(`/api/v3/profiles/start/${id}?win_scale=${CONFIG.WIN_SCALE}`)).data;
const closeProfile = (id) => api(`/api/v3/profiles/close/${id}`).catch((e) => log(`⚠️  Đóng ${id} lỗi: ${e.message}`));

async function listProfiles() {
  if (CONFIG.PROFILE_IDS.length) {
    const out = [];
    for (const id of CONFIG.PROFILE_IDS) { try { out.push(await getProfile(id)); } catch (e) { log(`⚠️  Bỏ qua ${id}: ${e.message}`); } }
    return out;
  }
  const seen = new Map(), PER = 100;
  for (let page = 1; page <= 500; page++) {
    const q = new URLSearchParams({ page, per_page: PER, ...(CONFIG.GROUP_ID && { group_id: CONFIG.GROUP_ID }) });
    const json = await api(`/api/v3/profiles?${q}`);
    const items = Array.isArray(json.data) ? json.data : json.data?.data || [];
    const before = seen.size;
    items.forEach((p) => seen.set(p.id, p));
    if (items.length < PER || seen.size === before) break; // hết trang (hoặc API bỏ qua tham số page → trả lặp lại)
  }
  return [...seen.values()];
}

// Hỗ trợ các dạng proxy của GPM: ip:port | ip:port:user:pass | user:pass@ip:port | http(s)/socks4/socks5://... | tm://, tinsoft://... (giữ nguyên chuỗi)
function parseProxy(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const m = s.match(/^([a-z0-9]+):\/\/(.+)$/i);
  const proto = m ? m[1].toLowerCase() : 'http', rest = m ? m[2] : s;
  if (!STD_PROTOS.includes(proto)) return { proto, host: rest, port: '', user: '' };
  let host, port, user = '';
  const at = rest.lastIndexOf('@');
  if (at !== -1) { [user] = rest.slice(0, at).split(':'); [host, port] = rest.slice(at + 1).split(':'); }
  else [host, port, user = ''] = rest.split(':');
  return { proto, host: (host || '').toLowerCase(), port: port || '', user };
}

function proxyKey(raw) {
  const p = parseProxy(raw);
  if (!p) return NO_PROXY;
  if (!STD_PROTOS.includes(p.proto)) return `${p.proto}://${p.host}`;
  const hp = p.port ? `${p.host}:${p.port}` : p.host;
  return CONFIG.PROXY_KEY === 'user' && p.user ? `${hp}:${p.user}` : hp;
}

function limitFor(key) {
  const l = CONFIG.PROXY_LIMITS[key] ?? CONFIG.MAX_PER_PROXY;
  return l > 0 ? l : Infinity;
}

const countByKey = (key) => { let n = 0; for (const a of active.values()) if (a.key === key) n++; return n; };

// ---------------- --check: báo cáo proxy theo cấu hình ----------------
function report(profiles) {
  const groups = new Map();
  for (const p of profiles) {
    const k = proxyKey(rawProxyOf(p));
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const rows = [...groups].sort((a, b) => b[1].length - a[1].length).map(([k, list]) => {
    const lim = limitFor(k), par = Math.min(list.length, lim);
    return { proxy: label(k), profile: list.length, limit: fmtLim(lim), 'cùng lúc': par, 'số đợt': Math.ceil(list.length / par), 'ví dụ': list.slice(0, 3).map((p) => p.name || p.id).join(', ') };
  });
  console.log(`\nTổng ${profiles.length} profile, ${groups.size} nhóm proxy | MAX_WINDOWS=${CONFIG.MAX_WINDOWS}, MAX_PER_PROXY=${CONFIG.MAX_PER_PROXY || '∞'}, PROXY_KEY=${CONFIG.PROXY_KEY}`);
  console.table(rows);

  const parallel = Math.min(CONFIG.MAX_WINDOWS, rows.reduce((s, r) => s + r['cùng lúc'], 0));
  console.log(`→ Tối đa ${parallel} cửa sổ mở cùng lúc` + (parallel < CONFIG.MAX_WINDOWS ? ` (thấp hơn MAX_WINDOWS=${CONFIG.MAX_WINDOWS} vì giới hạn proxy chặn — thêm proxy hoặc tăng MAX_PER_PROXY)` : ''));
  if (groups.has(NO_PROXY)) console.log(`⚠️  ${groups.get(NO_PROXY).length} profile KHÔNG có proxy (chạy bằng IP thật của máy).`);
  const bottleneck = rows.filter((r) => r['số đợt'] > 1);
  if (bottleneck.length) console.log(`⚠️  ${bottleneck.length} proxy có nhiều profile hơn limit → phải chờ nhau: ${bottleneck.map((r) => `${r.proxy} (${r.profile}/${r.limit})`).join(', ')}`);
  const unknown = Object.keys(CONFIG.PROXY_LIMITS).filter((k) => !groups.has(k));
  if (unknown.length) console.log(`⚠️  PROXY_LIMITS có key không khớp proxy nào (gõ sai?): ${unknown.join(', ')}`);
  console.log('');
}

// ---------------- Hàng đợi: giống fillQueue() của profile-manager ----------------
function watchClosed(addr) {
  let timer;
  const closed = new Promise((resolve) => {
    if (!addr) return;
    timer = setInterval(async () => {
      const alive = await fetch(`http://${addr}/json/version`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok).catch(() => false);
      if (!alive) { clearInterval(timer); resolve('closed'); }
    }, CONFIG.POLL_MS);
  });
  return { closed, stop: () => clearInterval(timer) };
}

async function runQueue(profiles) {
  const pending = profiles.map((p) => ({ id: p.id, name: p.name || p.id, key: proxyKey(rawProxyOf(p)), tries: 0 }));
  const stats = { ok: 0, fail: 0, done: 0 }, total = pending.length;
  let wake = () => {};

  while (pending.length || active.size) {
    const idx = active.size < CONFIG.MAX_WINDOWS ? pending.findIndex((p) => countByKey(p.key) < limitFor(p.key)) : -1;
    if (idx === -1) { await new Promise((r) => { wake = r; setTimeout(r, CONFIG.POLL_MS); }); continue; } // hết slot tổng hoặc mọi profile còn lại đều bị proxy chặn → chờ 1 cửa sổ đóng
    const item = pending.splice(idx, 1)[0];

    // Đọc lại proxy HIỆN TẠI ngay trước khi mở — proxy có thể vừa bị đổi trong GPM sau lúc lấy danh sách
    const fresh = await getProfile(item.id).catch(() => null);
    if (fresh) {
      const k = proxyKey(rawProxyOf(fresh));
      if (k !== item.key) {
        log(`🔄 ${item.name}: proxy đã đổi ${label(item.key)} → ${label(k)}`);
        item.key = k;
        if (countByKey(k) >= limitFor(k)) { pending.splice(idx, 0, item); continue; } // proxy mới đang đủ slot → trả lại đúng chỗ, xét profile khác
      }
    }

    let info;
    try { info = await startProfile(item.id); }
    catch (e) {
      item.tries++;
      const retry = item.tries <= CONFIG.RETRY;
      log(`❌ ${item.name}: mở lỗi (${e.message})` + (retry ? ` — sẽ thử lại (${item.tries}/${CONFIG.RETRY})` : ' — bỏ qua'));
      if (retry) pending.push(item); else { stats.fail++; stats.done++; }
      await sleep(2000);
      continue;
    }

    active.set(item.id, item);
    log(`▶️  ${item.name} | proxy ${label(item.key)} (${countByKey(item.key)}/${fmtLim(limitFor(item.key))}) | cửa sổ ${active.size}/${CONFIG.MAX_WINDOWS} | còn chờ ${pending.length}`);

    const watch = watchClosed(info?.remote_debugging_address);
    Promise.race([task(item, info), watch.closed])
      .then((r) => { stats.ok++; if (r === 'closed') log(`👋 ${item.name}: cửa sổ đã bị tắt tay`); })
      .catch((e) => { stats.fail++; log(`❌ ${item.name}: task lỗi (${e.message})`); })
      .finally(async () => {
        watch.stop();
        await closeProfile(item.id);
        active.delete(item.id);
        log(`⏹  ${item.name} đã đóng | cửa sổ ${active.size}/${CONFIG.MAX_WINDOWS} | xong ${++stats.done}/${total}`);
        wake();
      });

    await sleep(rand(CONFIG.START_GAP_MS));
  }
  log(`✅ Hoàn tất: ${stats.ok} thành công, ${stats.fail} lỗi / ${total} profile.`);
}

// ------------------------------------------------------------------
function applyArgs() {
  for (const a of process.argv.slice(2)) {
    const [k, v] = a.replace(/^--/, '').split('=');
    if (k === 'max') CONFIG.MAX_WINDOWS = Math.max(1, +v || 1);
    if (k === 'per-proxy') CONFIG.MAX_PER_PROXY = Math.max(0, +v || 0);
    if (k === 'group') CONFIG.GROUP_ID = v || '';
    if (k === 'api') CONFIG.API = v;
  }
}

async function main() {
  applyArgs();
  const profiles = await listProfiles();
  if (!profiles.length) return log('Không có profile nào (kiểm tra PROFILE_IDS / GROUP_ID).');
  report(profiles);
  if (process.argv.includes('--check')) return;
  process.on('SIGINT', async () => {
    log(`Ctrl+C — ${CONFIG.CLOSE_ON_EXIT ? `đóng ${active.size} profile đang mở...` : 'thoát (giữ nguyên cửa sổ)'}`);
    if (CONFIG.CLOSE_ON_EXIT) await Promise.all([...active.keys()].map(closeProfile));
    process.exit(130);
  });
  await runQueue(profiles);
}

if (require.main === module) main().catch((e) => { log('Lỗi:', e.message); process.exit(1); });

module.exports = { CONFIG, parseProxy, proxyKey, limitFor, listProfiles, runQueue };
