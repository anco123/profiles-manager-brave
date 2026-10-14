/**
 * scripts/xlv1_getXStatus.js
 * -----------------------------------------------------------------------
 * Check 1 username X (Twitter) có bị suspend hay không.
 *
 * ĐỔI LẦN 3: "gọi API ngầm" (dù bằng page.request hay bằng request
 * context riêng) bị đánh giá là không khả thi. Giờ mở hẳn 1 CỬA SỔ ẨN
 * DANH THẬT -- browser MỚI HOÀN TOÀN (chromium.launch(), KHÔNG phải
 * launchPersistentContext() của profile), nên KHÔNG có userDataDir,
 * KHÔNG cookie/session/local storage nào từ trước -- và context lấy từ
 * browser.newContext() (không phải context có sẵn của profile) nên
 * đúng nghĩa "ẩn danh" 100%.
 *
 * "của profile đó" nghĩa là: dùng ĐÚNG proxy (đi qua đúng IP) và ĐÚNG
 * loại Chrome (executablePath/channel) mà profile này đang chạy --
 * cả hai đều lấy từ `proxyInfo` (server.js tự tra profiles.json và
 * truyền vào, xem runScriptOnProfile trong server.js). KHÔNG dùng lại
 * page/context CÓ SẴN của profile -- đó chính là browser đang launch
 * persistent với cookie/session cũ, dùng lại nó thì không còn "ẩn
 * danh" nữa.
 *
 * Duyệt trang THẬT bằng page.goto() (không phải 1 request API trần) --
 * giống hệt 1 người dùng thật mở tab ẩn danh gõ URL vào xem.
 *
 * Lịch sử đổi hàm này (xem lý do đầy đủ ở các lần sửa trước):
 *   1. page.request của Playwright (dùng context/cookie profile) -> SAI
 *   2. https trần của Node (không proxy, không cookie)             -> ĐÚNG nhưng không qua proxy
 *   3. request.newContext + proxy (có proxy, không cookie)         -> chưa xác nhận, đổi hướng
 *   4. Cửa sổ ẩn danh thật: browser mới + đúng proxy + đúng Chrome  -> (bản này)
 *
 * Trả về: 'Suspended' | 'NotFound' (username không tồn tại) | 'Done_X' (thấy hồ sơ bình thường)
 *         | 'Unknown' (không thấy dấu hiệu nào chắc chắn -- trang lỗi, bị chặn, bắt đăng nhập...).
 * Trước đây chỉ trả 'Suspended' / 'Done_X': lấy nội dung NGAY lúc 'load' (X chưa kịp render chữ "Account suspended") và cứ không thấy
 * chữ đó là trả 'Done_X' -- tài khoản bị suspend / trang lỗi đều bị báo nhầm là bình thường, rồi đăng nhập xong main.js ghi luôn Done_X.
 *
 * Usage (trong main.js):
 *   const { getXStatus } = require('./xlv1_getXStatus');
 *   const xStatus = await getXStatus(username, proxyInfo, log); // proxyInfo do server.js tự truyền vào
 * -----------------------------------------------------------------------
 */

// Kiểm tra nhanh xem PROXY có tự kết nối được domain khác không (dùng
// chính browser/proxy đang mở, không launch thêm gì) -- chỉ chạy khi
// x.com đã lỗi mạng hết cả các lần retry, để phân biệt 2 tình huống
// cần xử lý khác hẳn nhau:
//   - Domain khác CŨNG lỗi  -> proxy thật sự có vấn đề (chưa ổn định
//     sau reset, hết hạn, hoặc bị chặn hẳn) -- cần đổi/reset lại proxy.
//   - Domain khác vẫn OK    -> proxy vẫn sống bình thường, CHỈ x.com
//     đang từ chối riêng IP này -- vấn đề khác hẳn (IP bị x.com gắn
//     cờ), retry/đổi settleMs không giúp được gì ở đây.
async function diagnoseProxyHealth(browser) {
  try {
    const diagContext = await browser.newContext();
    try {
      const diagPage = await diagContext.newPage();
      await diagPage.goto('https://api.ipify.org', { timeout: 10000, waitUntil: 'load' });
      return { ok: true };
    } finally {
      await diagContext.close().catch(() => {});
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Chờ trang hồ sơ hiện ra 1 dấu hiệu CHẮC CHẮN rồi mới kết luận (X là app React -- nội dung render SAU sự kiện 'load').
// Hồ sơ bình thường = có ngày tham gia (UserJoinDate) -- trang suspend / không tồn tại không có dòng này. Thấy hồ sơ rồi vẫn
// chờ thêm 1 nhịp và soi lại chữ suspend, phòng phần đầu hồ sơ hiện trước chữ "Account suspended".
async function detectXStatusOnPage(page, timeoutMs = 20000) {
  const suspended = page.getByText('Account suspended');
  const notFound = page.getByText(/This account doesn['’]?t exist/i);
  const profile = page.locator('[data-testid="UserJoinDate"], [data-testid="UserProfileHeader_Items"]');
  const seen = (loc) => loc.first().isVisible().catch(() => false);
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await seen(suspended)) return 'Suspended';
    if (await seen(notFound)) return 'NotFound';
    if (await seen(profile)) {
      await page.waitForTimeout(1500);
      return (await seen(suspended)) ? 'Suspended' : 'Done_X';
    }
    await page.waitForTimeout(500);
  }
  return 'Unknown';
}

async function getXStatus(username, proxyInfo, log) {
  const { chromium } = require('playwright');
  const url = `https://x.com/${username}`;
  const { proxyServer, proxyUsername, proxyPassword, executablePath, channel } = proxyInfo || {};

  // headless: false -- QUAN TRỌNG. Trước đây để true (ẩn), nhưng x.com
  // có cơ chế phát hiện Chrome headless khá mạnh (navigator.webdriver,
  // thiếu plugin, render khác biệt...), và càng dễ bị soi hơn với
  // traffic ẩn danh (không có cookie/session để "được tin tưởng" như
  // profile chính vốn chạy headless:false vẫn luôn vào được bình
  // thường). Đổi thành false -- cửa sổ ẩn danh này sẽ hiện thật (giống
  // hệt cách profile chính vẫn luôn chạy), thoáng qua rồi tự đóng.
  const launchOptions = { headless: false };
  if (proxyServer) {
    launchOptions.proxy = {
      server: proxyServer,
      username: proxyUsername || undefined,
      password: proxyPassword || undefined,
    };
    if (log) log(`[getXStatus] Dùng proxy: ${proxyServer}`);
  } else if (log) {
    log('[getXStatus] Profile không có proxy -- cửa sổ ẩn danh chạy thẳng từ máy chạy server.');
  }
  // Đúng loại Chrome mà profile này dùng -- không rơi về Chromium
  // bundled mặc định của Playwright (xem comment trong server.js).
  if (executablePath) launchOptions.executablePath = executablePath;
  else if (channel) launchOptions.channel = channel;

  // chromium.launch() -- browser MỚI HOÀN TOÀN, không phải
  // launchPersistentContext() như profile chính đang chạy. Không có
  // userDataDir nghĩa là không có cookie/session/local storage nào từ
  // trước -- đây chính là phần "ẩn danh".
  const browser = await chromium.launch(launchOptions);

  let status;
  let xStatus;
  try {
    // Retry riêng cho lỗi KẾT NỐI PROXY (net::ERR_*) -- khác hẳn lỗi do
    // nội dung trang. Ngay sau khi đổi IP (xlv1_changeProxy.js), proxy
    // xoay có thể chưa ổn định hẳn dù đã đợi settleMs, hoặc đang bị
    // giới hạn số kết nối đồng thời (context cũ + tab reset + browser
    // ẩn danh mới này cùng lúc) -- vài giây sau retry lại thường qua.
    const maxAttempts = 4;
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const incognitoContext = await browser.newContext({ locale: 'en-US' }); // giao diện tiếng Anh -- các chữ dò bên dưới là chữ tiếng Anh
      try {
        const incognitoPage = await incognitoContext.newPage();
        const response = await incognitoPage.goto(url, { timeout: 15000, waitUntil: 'load' });
        status = response ? response.status() : null;
        xStatus = await detectXStatusOnPage(incognitoPage); // chờ React render xong 1 dấu hiệu chắc chắn, không đọc DOM ngay lúc 'load'
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const isNetError = /net::/.test(err.message);
        if (log) log(`[getXStatus] Lần ${attempt}/${maxAttempts} lỗi${isNetError ? ' (lỗi mạng/proxy)' : ''}: ${err.message}`);
        if (!isNetError || attempt === maxAttempts) break; // lỗi không phải do mạng/proxy, hoặc hết lượt -- dừng, không retry vô ích
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt)); // 2s, 4s, 6s -- cho proxy thêm thời gian ổn định
      } finally {
        await incognitoContext.close().catch(() => {});
      }
    }

    if (lastErr) {
      if (/net::/.test(lastErr.message)) {
        if (log) log('[getXStatus] Hết lượt retry với lỗi mạng/proxy -- kiểm tra xem proxy có tự kết nối được domain khác không...');
        const diag = await diagnoseProxyHealth(browser);
        if (diag.ok) {
          if (log) log('[getXStatus] Chẩn đoán: proxy VẪN kết nối bình thường tới domain khác (api.ipify.org) -- x.com đang từ chối RIÊNG proxy/IP này, không phải proxy bị hỏng.');
          // Gắn cờ để main.js biết: đổi proxy khác (đổi IP) mới có cơ
          // hội giải quyết được, retry thêm trên CÙNG IP này vô nghĩa.
          lastErr.xBlockedThisProxy = true;
        } else {
          if (log) log(`[getXStatus] Chẩn đoán: proxy KHÔNG kết nối được domain khác luôn (${diag.error}) -- proxy đang thật sự có vấn đề (chưa ổn định sau reset, hết hạn, hoặc bị chặn).`);
          lastErr.proxyBroken = true;
        }
      }
      throw lastErr;
    }

  } catch (err) {
    if (log) log(`[getXStatus] Không mở được ${url}: ${err.message}`);
    await browser.close().catch(() => {});
    throw err;
  }
  await browser.close().catch(() => {});

  if (log) log('STATUS:', status);

  if (log) log(`=> ${xStatus}${xStatus === 'Unknown' ? ' (không thấy hồ sơ, chữ suspend hay "không tồn tại" -- trang lỗi / bị chặn / bắt đăng nhập)' : ''}`);
  return xStatus;
}

module.exports = { getXStatus, detectXStatusOnPage };

// Chạy độc lập để test 1 username, không cần main.js/profile nào:
//   node xlv1_getXStatus.js <username> [proxyServer] [proxyUsername] [proxyPassword]
// VD:
//   node xlv1_getXStatus.js MannsRikki83882 http://sp07v2-01.v98proxy.xyz:37185 sp07v2-37185 UXWUG
if (require.main === module) {
  const username = process.argv[2];
  if (!username) {
    console.error('Cách dùng: node xlv1_getXStatus.js <username> [proxyServer] [proxyUsername] [proxyPassword]');
    process.exit(1);
  }
  const proxyInfo = {
    proxyServer: process.argv[3] || '',
    proxyUsername: process.argv[4] || '',
    proxyPassword: process.argv[5] || '',
  };
  getXStatus(username, proxyInfo, console.log)
    .then((xStatus) => console.log('\n=> Kết quả:', xStatus))
    .catch((err) => console.error('LỖI:', err.message));
}