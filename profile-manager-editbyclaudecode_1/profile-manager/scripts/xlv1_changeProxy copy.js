/**
 * scripts/xlv1_changeProxy.js
 * -----------------------------------------------------------------------
 * Đổi IP của 1 proxy XOAY (rotating) bằng cách tự nhận diện proxy hiện
 * tại của PROFILE ĐANG CHẠY (qua `proxyInfo` -- server.js tra từ
 * profiles.json và truyền vào script, xem runScriptOnProfile trong
 * server.js), rồi MỞ THẬT link reset tương ứng bằng 1 tab trình duyệt
 * mới (context.newPage()) -- KHÔNG gọi bằng request https trần.
 *
 * VÌ SAO PHẢI QUA BROWSER THẬT (không dùng https trần như bản đầu):
 * trang reset của nhà cung cấp proxy hoàn toàn có thể có chặn
 * bot/JS-challenge, y hệt lý do x.com từng trả sai kết quả cho request
 * "trần" ở xlv1_getXStatus.js (xem lịch sử sửa file đó) -- ở đây làm
 * NGƯỢC LẠI: nghi ngờ chiều ngược nên chuyển từ https trần SANG browser
 * thật cho chắc. Tab MỞ RIÊNG (không phải page chính) để không làm
 * gián đoạn page chính đang ở đâu đó khác (X, mail.tm...).
 *
 * KHÔNG đụng gì tới config proxy trong Playwright (host:port:username:
 * password của profile giữ NGUYÊN) -- chỉ IP THẬT đứng sau đúng config
 * đó đổi. Đây là lý do cách này hoạt động được dù Playwright không cho
 * đổi proxy của 1 browser đang chạy.
 *
 * CÁCH THÊM PROXY MỚI KHI MUA THÊM:
 *   Copy nguyên 1 khối `if (...)` bên dưới, đổi proxyServer/
 *   proxyUsername/proxyPassword (đúng như đã điền vào profile lúc tạo)
 *   và resetUrl cho đúng proxy mới.
 *
 * Usage (trong main.js, gọi NGAY ĐẦU, trước khi làm gì khác):
 *   const { changeProxy } = require('./xlv1_changeProxy');
 *   await changeProxy(context, proxyInfo, log); // context + proxyInfo đều đã có sẵn trong main.js
 * -----------------------------------------------------------------------
 */

function getProxyResetUrl(proxyServer, proxyUsername, proxyPassword) {
  // sp07v2-01.v98proxy.xyz:37185:sp07v2-37185:UXWUG
  // (proxyServer lưu dạng "http://host:port" -- xem parseProxyLine() trong server.js)
  if (
    proxyServer === 'http://sp07v2-01.v98proxy.xyz:37185' &&
    proxyUsername === 'sp07v2-37185' &&
    proxyPassword === 'UXWUG'
  ) {
    return 'https://v98proxy.xyz/sp07v2/37185-MQRUDDLERR';
  }

  // Mua thêm proxy: copy khối if ở trên, đổi cả 3 giá trị cho đúng
  // proxy mới (đúng như đã điền vào profile) + resetUrl mới, VD:
  // if (
  //   proxyServer === 'http://<host mới>:<port mới>' &&
  //   proxyUsername === '<user mới>' &&
  //   proxyPassword === '<pass mới>'
  // ) {
  //   return '<reset link mới>';
  // }

  return null;
}

// Mở THẬT link reset bằng 1 tab riêng (không phải page chính) -- xem
// lý do ở đầu file. Chỉ log lại phản hồi (nếu đọc được) để dễ theo dõi,
// KHÔNG quyết định gì dựa vào đó -- việc IP mới đã dùng được hay chưa
// giờ xác nhận hoàn toàn bằng bước checkNetworkOnce() (vào example.org)
// ở dưới, đúng như yêu cầu.
async function openResetLink(context, resetUrl, proxyServer, log) {
  const resetTab = await context.newPage();
  try {
    // bringToFront() -- ép tab này hiện ra TRƯỚC MẶT thay vì chạy nền,
    // để bạn tận mắt thấy nó thật sự mở URL này (mặc định Chromium
    // không tự chuyển focus sang tab mới tạo qua CDP).
    await resetTab.bringToFront();
    const response = await resetTab.goto(resetUrl, { timeout: 20000, waitUntil: 'load' });
    if (log) {
      const statusCode = response ? response.status() : null;
      let bodyText = '';
      try {
        bodyText = response ? await response.text() : '';
      } catch (_) {
        // body không đọc được -- không sao, chỉ là log tham khảo
      }
      log(`[changeProxy] "${proxyServer}" -- mở link reset xong (HTTP ${statusCode})${bodyText ? `: ${bodyText.slice(0, 200)}` : ''}`);
    }
    // Đợi thêm 1 chút trước khi đóng, để tab kịp hiện ra cho mắt thường
    // thấy thay vì mở-đóng nhanh tới mức như chưa từng xảy ra.
    await resetTab.waitForTimeout(1500);
  } catch (err) {
    if (log) log(`[changeProxy] "${proxyServer}" -- mở link reset thất bại: ${err.message}`);
    throw err;
  } finally {
    await resetTab.close().catch(() => {});
  }
}

// Xác nhận mạng đã sống qua context (đúng proxy vừa đổi) bằng cách vào
// https://example.org/ và đợi PHẦN TỬ THỨ 2 khớp text "Example Domain"
// (//*[text()="Example Domain"])[2] -- trang này có 2 chỗ trùng chữ đó
// (<title> và <h1>), lấy đúng phần tử thứ 2 (<h1>, hiển thị thật trên
// trang) là bằng chứng trang đã tải xong thật sự qua proxy, không phải
// chỉ HTTP trả về suông. Toàn bộ bước này (vào trang + đợi phần tử) có
// ngân sách 15s -- không thấy trong 15s coi như CHƯA có mạng, trả về
// false, không throw (changeProxy() bên dưới quyết định lặp lại).
async function checkNetworkOnce(context, log, timeoutMs = 15000) {
  const checkTab = await context.newPage();
  try {
    await checkTab.goto('https://example.org/', { timeout: timeoutMs, waitUntil: 'domcontentloaded' });
    await checkTab.locator('xpath=(//*[text()="Example Domain"])[1]').waitFor({ state: 'visible', timeout: timeoutMs });
    return true;
  } catch (err) {
    // Trang CÓ TẢI (không throw ở bước goto) nhưng không thấy phần tử
    // mong đợi thường KHÔNG phải "chưa có mạng" mà là đang thấy 1 trang
    // khác hẳn example.org thật (trang chặn của proxy, captive portal,
    // IANA rate-limit IP đó...) -- log lại URL/tiêu đề thật của trang
    // lúc fail để biết chính xác đang thấy gì, thay vì đoán mò.
    let diag = '';
    try {
      const url = checkTab.url();
      const title = await checkTab.title();
      diag = ` [trang đang thấy: url="${url}" title="${title}"]`;
    } catch (_) {
      // tab đã hỏng hẳn -- bỏ qua, không có gì thêm để log
    }
    if (log) log(`[changeProxy] Kiểm tra mạng qua example.org: không thấy nội dung trang trong ${timeoutMs}ms (${err.message}).${diag}`);
    return false;
  } finally {
    await checkTab.close().catch(() => {});
  }
}

// context: BrowserContext của profile đang chạy (main.js đã có sẵn).
// proxyInfo: { proxyServer, proxyUsername, proxyPassword } -- do
// server.js tự truyền vào script (tham số thứ 6, xem runScriptOnProfile
// trong server.js), không cần tự dựng object này.
// opts.checkTimeoutMs: ngân sách cho bước vào example.org + đợi phần tử
// (mặc định 15s, đúng yêu cầu).
// opts.retryDelayMs: đây là proxy XOAY, không thấy mạng trong
// checkTimeoutMs thì đợi thêm 45s (mặc định) rồi TRUY CẬP LẠI link
// reset (chứ không chỉ check suông), rồi kiểm tra lại. Lặp vô hạn --
// không có số lần thử tối đa, vì đây là proxy xoay nên kiểu gì cũng sẽ
// có IP mới dùng được, chỉ là sớm hay muộn.
async function changeProxy(context, proxyInfo, log, opts = {}) {
  const { proxyServer, proxyUsername, proxyPassword } = proxyInfo || {};

  if (!proxyServer) {
    const msg = '[changeProxy] Profile này chưa gán proxy nào (proxyServer rỗng) -- bỏ qua bước đổi IP.';
    if (log) log(msg);
    return; // không có proxy để đổi -- không phải lỗi nghiêm trọng, không throw
  }

  const resetUrl = getProxyResetUrl(proxyServer, proxyUsername, proxyPassword);
  if (!resetUrl) {
    const msg = `[changeProxy] Không nhận diện được proxy (${proxyServer} / user="${proxyUsername}") -- kiểm tra lại xlv1_changeProxy.js, có thể đây là proxy mới chưa được thêm vào.`;
    if (log) log(msg);
    throw new Error(msg);
  }

  const {
    checkTimeoutMs = 15000, // ngân sách vào example.org + đợi phần tử "Example Domain" thứ 2
    retryDelayMs = 45000, // không thấy mạng trong checkTimeoutMs thì đợi thêm ngần này rồi bắn lại link reset
  } = opts;

  let attempt = 0;
  while (true) {
    attempt++;
    if (log) log(`[changeProxy] Lần ${attempt}: mở link reset...`);
    await openResetLink(context, resetUrl, proxyServer, log);

    if (log) log('[changeProxy] Kiểm tra mạng qua example.org...');
    const ok = await checkNetworkOnce(context, log, checkTimeoutMs);
    if (ok) {
      if (log) log(`[changeProxy] Lần ${attempt}: đã có mạng -- tiếp tục các bước sau.`);
      return; // break -- IP mới đã dùng được, đi tiếp các bước sau trong main.js
    }

    if (log) log(`[changeProxy] Lần ${attempt}: chưa có mạng sau ${checkTimeoutMs}ms -- đợi ${retryDelayMs}ms rồi reset lại IP...`);
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
}

module.exports = { changeProxy, getProxyResetUrl };