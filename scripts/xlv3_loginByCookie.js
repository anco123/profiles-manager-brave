/**
 * scripts/xlv3_loginByCookie.js
 * -----------------------------------------------------------------------
 * Thay thế extension "Radius X Cookie Login" -- cùng logic parse chuỗi
 * cookie/MMO y hệt file popup.js gốc, nhưng set cookie thẳng qua API
 * NATIVE của Playwright (context.addCookies()) thay vì qua
 * chrome.cookies.set() bên trong 1 extension. Không cần cài extension
 * nào cả -- né hoàn toàn mọi vấn đề "Chrome không cài được extension"
 * đã gặp (Chrome 137 xoá --load-extension, --disable-extensions mặc
 * định của Playwright, MAC bảo vệ Secure Preferences...), vì
 * addCookies() là API chính thức của chính Playwright, không đụng gì
 * tới hệ thống extension của Chrome.
 *
 * Cùng CHỮ KÝ HÀM và cùng CÁCH TRẢ VỀ `status` như loginToX() trong
 * xlv3_loginX.js -- main.js gọi hàm nào cũng được, xử lý y hệt nhau
 * (chỉ 'Done_X' là thành công, mọi status khác đều dừng lại).
 *
 * Chấp nhận CÙNG các định dạng chuỗi mà popup.js gốc chấp nhận (đọc từ
 * cột J, cùng dòng với tài khoản đang chạy):
 *   - Mảng JSON cookie: [{"name":"auth_token","value":"..."}, ...]
 *   - "username|password|[JSON_COOKIES]"
 *   - Chuỗi thô chứa "auth_token=..." và "ct0=..."
 *   - Danh sách token cách nhau bởi dấu | ; hoặc khoảng trắng
 *
 * Usage (trong main.js):
 *   const { loginByCookie } = require('./xlv3_loginByCookie');
 *   const result = await loginByCookie(page, context, log, require, input);
 *   log(`Trạng thái đăng nhập X: ${result.status}`);
 * -----------------------------------------------------------------------
 */

// Parse y hệt logic parseCookies() trong popup.js gốc -- copy gần như
// nguyên văn, chỉ đổi cú pháp cho khớp Node.js (không có thay đổi hành
// vi nào so với bản extension).
// THE ACTUAL BUG that made a profile log itself out the instant it
// closed: every cookie pushed below used to have NO `expires` field at
// all. Per plain browser cookie semantics (nothing Playwright-specific
// here) -- a cookie with no `expires` (or `expires: -1`) is a SESSION
// cookie: it only ever lives in memory for that one running browser
// process and is NEVER written to the profile's on-disk Cookies
// database. The moment Chrome closes, it's gone -- which is exactly
// "chạy xong tắt phát là log out luôn". Giving every cookie a real
// future `expires` (Unix seconds) is what makes Chromium persist it to
// disk so it's still there on the NEXT launch of this profile.
// ~1 year out -- comfortably longer than X's own auth_token/ct0
// lifetime, so this is never the reason a session goes stale early.
function farFutureExpiry() {
  return Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
}

function parseCookies(raw) {
  if (!raw || !raw.trim()) return null;
  const str = raw.trim();

  let cookiesToSet = [];
  let username = '';
  let hasCf = false;

  const startB = str.indexOf('[');
  const endB = str.lastIndexOf(']');
  if (startB !== -1 && endB > startB) {
    const jsonStr = str.substring(startB, endB + 1);
    try {
      const list = JSON.parse(jsonStr);
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item && typeof item === 'object') {
            const name = String(item.name || item.key || '').trim();
            const value = String(item.value || item.val || '').trim();
            if (name) {
              if (name === '__cf_bm' || name === '__cuid' || name === 'cf_clearance') {
                hasCf = true;
              }
              // Some cookie-export tools (e.g. EditThisCookie-style JSON)
              // include a real expiry as `expires` or `expirationDate` --
              // honor that if it's a sane positive number, since it's
              // more accurate than our own guess. Otherwise, don't leave
              // it unset (see farFutureExpiry()'s comment above).
              const rawExpiry = item.expires ?? item.expirationDate;
              const expires = (typeof rawExpiry === 'number' && rawExpiry > 0) ? rawExpiry : farFutureExpiry();
              cookiesToSet.push({
                name,
                value,
                domain: item.domain || '.x.com',
                path: item.path || '/',
                secure: true,
                httpOnly: item.httpOnly ?? (name === 'auth_token' || name === '__cf_bm'),
                sameSite: item.sameSite === 'None' ? 'None' : (item.sameSite === 'Lax' ? 'Lax' : (item.sameSite === 'Strict' ? 'Strict' : 'None')),
                expires,
              });
            }
          }
        }
      }
    } catch (e) {
      // JSON lỗi -- rơi xuống nhánh regex bên dưới, y hệt bản gốc
    }
  }

  const parts = str.split('|');
  if (parts.length > 0) {
    const p0 = parts[0].trim();
    if (!p0.startsWith('[') && !p0.startsWith('{') && !p0.includes('@') && !p0.includes('=')) {
      username = p0;
    }
  }

  if (cookiesToSet.length === 0) {
    let auth = '';
    let ct = '';

    const mAuth = str.match(/auth_token=([a-fA-F0-9]{32,64})/);
    if (mAuth) auth = mAuth[1];

    const mCt0 = str.match(/ct0=([a-fA-F0-9]{32,180})/);
    if (mCt0) ct = mCt0[1];

    if (!auth || !ct) {
      const pipeParts = str.split(/[|;\s]+/).map((s) => s.trim()).filter(Boolean);
      for (const p of pipeParts) {
        if (/^[0-9a-fA-F]{40}$/.test(p) && !auth) auth = p;
        else if (p.length >= 32 && /^[0-9a-fA-F]+$/.test(p) && !ct && p !== auth) ct = p;
      }
    }

    // sameSite: 'None' -- y hệt giá trị mặc định (no_restriction) mà
    // bản extension gốc dùng khi gọi chrome.cookies.set() ở nhánh này
    // (không set sameSite tường minh, nên rơi về default no_restriction).
    if (auth) {
      cookiesToSet.push({ name: 'auth_token', value: auth, domain: '.x.com', path: '/', secure: true, httpOnly: true, sameSite: 'None', expires: farFutureExpiry() });
    }
    if (ct) {
      cookiesToSet.push({ name: 'ct0', value: ct, domain: '.x.com', path: '/', secure: true, httpOnly: false, sameSite: 'None', expires: farFutureExpiry() });
    }
  }

  return { cookies: cookiesToSet, username, hasCf };
}

// Tự đọc input/cột J -- KHÔNG cần nơi gọi (main.js) tự parse row hay tự
// try/catch gì cả, y hệt cách loginToX() tự lo phần đó cho chính nó.
async function loginByCookie(page, context, log, require, input) {
  const row = input ? JSON.parse(input) : {};
  const cookieString = row['J'] || '';

  // Dấu hiệu "đã đăng nhập" -- CÙNG selector mà loginToX() dùng để biết
  // khi nào bỏ qua bước login.
  const homeIndicator = page.locator('[data-testid="SideNav_NewTweet_Button"]');

  // Kiểm tra phiên HIỆN TẠI trước khi đụng gì tới cookie -- y hệt cách
  // loginToX() luôn thử vào Home trước rồi mới quyết định có cần login
  // hay không. Trước đây hàm này CỨ MỖI LẦN CHẠY đều context.clearCookies()
  // rồi nạp lại đúng chuỗi TĨNH từ cột J, bất kể phiên hiện tại còn dùng
  // tốt hay không -- mà X lại hay tự làm mới ct0/auth_token qua mỗi lần
  // dùng, nên hễ giá trị cũ trong Excel bị X coi là hết hạn/thay thế thì
  // lần chạy sau chính là tự tay đăng xuất profile của mình. Giờ nếu
  // phiên hiện tại (cookie đã có sẵn trong profile, có thể đã được X tự
  // làm mới qua nhiều lần chạy trước) vẫn còn vào được Home, bỏ qua toàn
  // bộ bước xoá+nạp cookie, giữ nguyên session đang có.
  await require('./xlv1_ensureSingleTab').ensureSingleTab(context, log);
  await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  const alreadyLoggedIn = await homeIndicator.first().waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
  if (alreadyLoggedIn) {
    log('[loginByCookie] Profile này đã đăng nhập sẵn (cookie hiện tại còn dùng được) -- bỏ qua nạp lại cookie từ Excel.');
    return { status: 'Done_X' };
  }
  log('[loginByCookie] Chưa đăng nhập (hoặc cookie hiện tại đã hết hạn) -- thử nạp cookie từ cột J...');

  const parsed = parseCookies(cookieString);
  if (!parsed || parsed.cookies.length === 0) {
    log('[loginByCookie] Không tìm thấy cookie hợp lệ trong cột J.');
    return { status: 'No_Cookie_Found' };
  }
  log(`[loginByCookie] Nhận diện được ${parsed.cookies.length} cookie${parsed.username ? ` cho @${parsed.username}` : ''}${parsed.hasCf ? ' (kèm Cloudflare token)' : ''}.`);

  try {
    // Xoá cookie CŨ của .x.com/.twitter.com trước -- y hệt hành vi
    // "xoá sạch rồi nạp mới" của extension gốc, tránh cookie cũ còn sót
    // lẫn với cookie mới gây xung đột phiên. An toàn để làm ở đây vì đã
    // xác nhận phiên cũ KHÔNG còn dùng được ở bước kiểm tra phía trên.
    await context.clearCookies({ domain: '.x.com' }).catch(() => {});
    await context.clearCookies({ domain: '.twitter.com' }).catch(() => {});

    await context.addCookies(parsed.cookies);
    log(`[loginByCookie] Đã nạp ${parsed.cookies.length} cookie qua context.addCookies().`);

    await require('./xlv1_ensureSingleTab').ensureSingleTab(context, log);
    await page.goto('https://x.com/home');
  } catch (err) {
    log(`[loginByCookie] Lỗi khi nạp cookie: ${err.message}`);
    return { status: 'Cookie_Login_Failed' };
  }

  // Xác nhận cookie vừa nạp THẬT SỰ vào được Home -- trước đây cứ nạp
  // xong (dù cookie trong Excel còn hạn hay không) là trả thẳng Done_X,
  // nên cookie hết hạn/sai vẫn báo thành công, để main.js chạy tiếp
  // interactX() trên 1 trang chưa đăng nhập (lỗi lung tung không liên
  // quan gì tới nguyên nhân thật).
  const reachedHome = await homeIndicator.first().waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
  if (!reachedHome) {
    const shotPath = `data/login-debug-${Date.now()}.png`;
    await page.screenshot({ path: shotPath }).catch(() => {});
    log(`[loginByCookie] Nạp cookie xong nhưng KHÔNG vào được Home -- cookie trong cột J có thể đã hết hạn. Screenshot: ${shotPath}`);
    return { status: 'Cookie_Login_Failed' };
  }

  return { status: 'Done_X' };
}

module.exports = { loginByCookie, parseCookies };