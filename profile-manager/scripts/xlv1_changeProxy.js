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
// giờ xác nhận hoàn toàn bằng bước checkNetworkOnce() (tải thử 1 trang)
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

// Xác nhận mạng đã sống qua context (đúng proxy vừa đổi) -- và QUAN
// TRỌNG HƠN, xác nhận nó THỰC SỰ TỐT chứ không chỉ "có phản hồi".
//
// Bản đầu tiên chỉ vào https://example.org/ (vài trăm byte) -- quá nhẹ,
// mạng yếu vẫn tải xong dễ dàng, không phản ánh đúng "có tốt hay
// không". Bản thứ hai đổi sang tải 300KB từ endpoint đo tốc độ của
// Cloudflare rồi tính KB/s -- gặp đúng vấn đề NGƯỢC LẠI: nhiều proxy/
// ISP xử lý traffic tới domain "speedtest" khác hẳn traffic bình
// thường (route riêng, giới hạn riêng), nên endpoint đó có thể báo
// "kém" dù duyệt web bình thường (đã tự tay thử tinhte.vn) vẫn mượt.
//
// Bản này: tải THẬT 1 trang web bình thường, phổ biến, không có bot-
// detection/CAPTCHA để lo (Wikipedia -- CDN toàn cầu cực ổn định,
// không bị chặn ở hầu hết mọi nơi, kích thước 1 trang vừa phải), rồi
// chỉ đánh giá bằng ĐÚNG tiêu chí đơn giản, thực tế: "trang có tải
// XONG (đủ nội dung thật, không phải trang chặn/rỗng) TRONG thời gian
// cho phép hay không" -- không tính KB/s, không phụ thuộc 1 công thức
// nào cả, đúng cách 1 người bình thường tự đánh giá "mạng có mượt
// không" khi thử load 1 trang.
async function checkNetworkOnce(context, log, timeoutMs = 20000, opts = {}) {
  const {
    url = 'https://www.wikipedia.org/',
    minContentLength = 10_000, // trang thật của Wikipedia luôn > mức này -- lọc trường hợp 1 trang chặn/rỗng trả về "thành công" giả
  } = opts;

  const checkTab = await context.newPage();
  try {
    const startedAt = Date.now();
    // waitUntil: 'load' -- đợi tải xong CẢ ảnh/CSS, không chỉ HTML thô
    // (domcontentloaded), để phản ánh đúng trải nghiệm "trang mượt hay
    // không" như khi tự tay mở trang xem.
    const response = await checkTab.goto(url, { timeout: timeoutMs, waitUntil: 'load' });
    const elapsedMs = Date.now() - startedAt;

    if (!response || !response.ok()) {
      if (log) log(`[changeProxy] Kiểm tra mạng: HTTP ${response ? response.status() : 'không có phản hồi'} -- coi như chưa có mạng.`);
      return false;
    }

    const contentLength = (await checkTab.content()).length;
    if (contentLength < minContentLength) {
      if (log) log(`[changeProxy] Kiểm tra mạng: trang tải xong trong ${elapsedMs}ms nhưng nội dung chỉ ${contentLength} ký tự (dưới ngưỡng ${minContentLength}) -- nghi ngờ đây là trang chặn của proxy/captive portal, không phải trang thật.`);
      return false;
    }

    if (log) log(`[changeProxy] Kiểm tra mạng: tải xong trang thử (${contentLength} ký tự) trong ${elapsedMs}ms -- kết nối tốt.`);
    return true;
  } catch (err) {
    // Không tải xong trong timeoutMs (chậm/đứt giữa chừng), DNS fail,
    // proxy từ chối kết nối... -- log lại URL/tiêu đề trang hiện tại
    // nếu tab còn sống, để biết đang thấy gì thay vì đoán mò.
    let diag = '';
    try {
      const currentUrl = checkTab.url();
      const title = await checkTab.title();
      diag = ` [trang đang thấy: url="${currentUrl}" title="${title}"]`;
    } catch (_) {
      // tab đã hỏng hẳn -- bỏ qua, không có gì thêm để log
    }
    if (log) log(`[changeProxy] Kiểm tra mạng: không tải xong trong ${timeoutMs}ms (${err.message}) -- coi là không ổn định.${diag}`);
    return false;
  } finally {
    await checkTab.close().catch(() => {});
  }
}

// context: BrowserContext của profile đang chạy (main.js đã có sẵn).
// proxyInfo: { proxyServer, proxyUsername, proxyPassword } -- do
// server.js tự truyền vào script (tham số thứ 6, xem runScriptOnProfile
// trong server.js), không cần tự dựng object này.
// opts.checkTimeoutMs: ngân sách cho bước tải dữ liệu kiểm tra mạng
// (mặc định 20s -- xem checkNetworkOnce() ở trên).
// opts.retryDelayMs: đây là proxy XOAY, không có mạng TỐT trong
// checkTimeoutMs thì đợi thêm 40s (mặc định, theo đúng yêu cầu) rồi
// TRUY CẬP LẠI link reset (chứ không chỉ check suông), rồi kiểm tra
// lại. Lặp vô hạn -- không có số lần thử tối đa, vì đây là proxy xoay
// nên kiểu gì cũng sẽ có IP mới dùng được, chỉ là sớm hay muộn.
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
    checkTimeoutMs = 20000, // ngân sách cho mỗi lần checkNetworkOnce() -- xem giải thích ở hàm đó
    retryDelayMs = 40000, // không có mạng TỐT trong checkTimeoutMs thì đợi thêm ngần này rồi bắn lại link reset
  } = opts;

  let attempt = 0;
  while (true) {
    attempt++;
    if (log) log(`[changeProxy] Lần ${attempt}: mở link reset...`);
    try {
      await openResetLink(context, resetUrl, proxyServer, log);
    } catch (err) {
      // BUG ĐÃ SỬA: trước đây 1 lỗi ở CHÍNH bước mở link reset (proxy
      // tunnel chết, timeout, DNS fail -- VD thực tế:
      // ERR_TUNNEL_CONNECTION_FAILED) bay thẳng ra ngoài while loop này,
      // crash luôn cả profile ngay sau ĐÚNG 1 lần thử -- dù đây là
      // proxy XOAY và đây chính xác là kiểu lỗi tạm thời mà cả vòng
      // lặp này sinh ra để chịu đựng (checkNetworkOnce() trả false đã
      // được xử lý đúng từ đầu, chỉ riêng lỗi ở BƯỚC TRƯỚC ĐÓ thì
      // không). Coi như 1 lượt thất bại bình thường -- chờ rồi thử lại,
      // y hệt khi checkNetworkOnce() trả về false. Không log lại chi
      // tiết lỗi ở đây vì openResetLink() đã tự log rồi (xem hàm đó).
      if (log) log(`[changeProxy] Lần ${attempt}: mở link reset thất bại -- đợi ${retryDelayMs}ms rồi thử lại.`);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      continue;
    }

    if (log) log('[changeProxy] Kiểm tra chất lượng mạng...');
    const ok = await checkNetworkOnce(context, log, checkTimeoutMs);
    if (ok) {
      if (log) log(`[changeProxy] Lần ${attempt}: kết nối tốt -- tiếp tục các bước sau.`);
      return; // break -- IP mới đã dùng được VÀ đủ tốt, đi tiếp các bước sau trong main.js
    }

    if (log) log(`[changeProxy] Lần ${attempt}: mạng chưa đạt yêu cầu -- đợi ${retryDelayMs}ms rồi reset lại IP...`);
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
}

module.exports = { changeProxy, getProxyResetUrl };