/**
 * scripts/xlv1_getDeviceInfo.js
 * -----------------------------------------------------------------------
 * Lấy IP public + User-Agent ĐANG THỰC SỰ ĐI RA của profile đang chạy --
 * dùng page.request (giống hệt xlv1_getXStatus.js), nên đi ĐÚNG qua
 * proxy/context của profile đó. KHÔNG dùng module https trần của Node --
 * làm vậy sẽ đi thẳng từ máy host, bỏ qua proxy của profile, cho ra
 * IP/UA SAI (đây là lý do bản test-x-status.js đứng riêng trước đó
 * không dùng lại được nguyên xi ở đây).
 *
 * Usage (trong main.js):
 *   const { getDeviceInfo } = require('./xlv1_getDeviceInfo');
 *   const { ip, userAgent } = await getDeviceInfo(page, log);
 * -----------------------------------------------------------------------
 */

async function getDeviceInfo(page, log) {
  let ip = null;
  let userAgent = null;

  try {
    const ipRes = await page.request.get('https://api.ipify.org', { timeout: 15000 });
    ip = (await ipRes.text()).trim();
  } catch (err) {
    if (log) log(`[getDeviceInfo] Không lấy được IP: ${err.message}`);
  }

  try {
    // httpbin.org/user-agent trả về ĐÚNG header mà server nó nhận được
    // (dạng JSON {"user-agent": "..."}) -- đáng tin hơn tự đoán, vì
    // Playwright tự gắn User-Agent của Chrome thật, khác hẳn 1 request
    // trần không set gì.
    const uaRes = await page.request.get('https://httpbin.org/user-agent', { timeout: 15000 });
    userAgent = (await uaRes.text()).trim();
  } catch (err) {
    if (log) log(`[getDeviceInfo] Không lấy được User-Agent: ${err.message}`);
  }

  return { ip, userAgent };
}

module.exports = { getDeviceInfo };
