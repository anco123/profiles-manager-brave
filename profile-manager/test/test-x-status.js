/**
 * scripts/xlv1_getXStatus.js
 * -----------------------------------------------------------------------
 * Check 1 username X (Twitter) có bị suspend hay không -- fetch thẳng
 * trang cá nhân qua page.request (đi ĐÚNG proxy/context của profile
 * đang chạy, không qua Playwright điều hướng trình duyệt thật).
 *
 * Trả về: 'Suspended' hoặc 'Done_X'.
 *
 * Usage (trong main.js):
 *   const { getXStatus } = require('./xlv1_getXStatus');
 *   const xStatus = await getXStatus(page, username, log);
 * -----------------------------------------------------------------------
 */

async function getXStatus(page, username, log) {
  const url = `https://x.com/${username}`;
  let response;
  try {
    // https (không phải http) -- x.com chạy sau CDN, cổng 80 nhiều khi
    // bị đóng hẳn hoặc chỉ redirect. timeout 15s để không treo vô hạn
    // nếu mạng/proxy có vấn đề.
    response = await page.request.get(url, { timeout: 15000 });
  } catch (err) {
    if (log) log(`[getXStatus] Không fetch được ${url}: ${err.message}`);
    throw err;
  }

  if (log) {
    log('STATUS:', response.status()); // Playwright APIResponse -- status() là HÀM, không phải thuộc tính như fetch() trình duyệt
    log('URL:', response.url());
  }

  const body = await response.text();
  const suspended = body.includes('Account suspended');

  if (log) log(suspended ? '=> SUSPENDED' : '=> KHÔNG THẤY SUSPENDED');

  return suspended ? 'Suspended' : 'Done_X';
}

module.exports = { getXStatus };
const xStatus = await getXStatus(page, "MannsRikki83882", log);
log(`Kiểm tra X trước tiên -- trạng thái: ${xStatus}`);