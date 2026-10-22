/**
 * scripts/xlv2_checkFollowers.js
 * -----------------------------------------------------------------------
 * Đọc số Followers của profile đang đăng nhập.
 *
 * Luồng:
 *   1) Click AppTabBar_Profile_Link (human click = clickVisibly có sẵn trong deps) -> đợi 1-3 giây.
 *   2) Đợi link Followers hiện ra. NEO vào CHỮ "Followers" (hoặc "Follower" khi chỉ có 1 người), KHÔNG dựa vào
 *      class css-xxx / r-xxx (X đổi bất cứ lúc nào) và cũng không dựa vào href (có khi /followers, có khi /verified_followers).
 *   3) Lấy innerText của cả link (VD "103 Followers") rồi tách số đứng ngay TRƯỚC chữ Followers -- không phụ thuộc cấu trúc span lồng nhau.
 *
 * Đọc được thì GHI luôn vào cột G, dòng excelRow (tham số thứ 4 = row.__excelRow, dòng Excel của profile đang chạy). Không đọc được thì không ghi gì (giữ nguyên giá trị cũ).
 * Trả về SỐ NGUYÊN (VD 103), hoặc null nếu không đọc được. Số rút gọn của X được đổi ra gần đúng: "1.2K" -> 1200, "10.5K" -> 10500, "2M" -> 2000000.
 * KHÔNG ném lỗi: nếu 15 giây vẫn không thấy link Followers / không tách được số / click lỗi -> ghi log [LỖI], trả về null và để nơi gọi làm tiếp.
 *
 * Usage:
 *   const { xlv2_checkFollowers } = require('./xlv2_checkFollowers');
 *   const followers = await xlv2_checkFollowers(page, log, deps, row.__excelRow);   // row = JSON.parse(input)
 * -----------------------------------------------------------------------
 */

// "103 Followers" | "1 Follower" | "1,234 Followers" | "1.2K Followers" | "2M Followers" -> số nguyên (hoặc null nếu không khớp).
function parseFollowerCount(text) {
  const m = String(text).replace(/ /g, ' ').match(/(\d[\d.,]*)\s*([KkMmBb])?\s*Followers?\b/);
  if (!m) return null;
  const suffix = (m[2] || '').toUpperCase();
  if (suffix) return Math.round(parseFloat(m[1].replace(',', '.')) * { K: 1e3, M: 1e6, B: 1e9 }[suffix]); // có K/M/B -> dấu , hoặc . là dấu thập phân
  return parseInt(m[1].replace(/[.,]/g, ''), 10); // không có hậu tố -> , hoặc . là dấu ngăn cách hàng nghìn
}

// Ghi số Followers vào cột G, ĐÚNG dòng Excel của profile đang chạy (excelRow = row.__excelRow). Lỗi ghi chỉ log, không làm hỏng việc đã đọc được.
async function saveToExcelColumnG(log, excelRow, count) {
  if (excelRow === undefined || excelRow === null) { log('[xlv2_checkFollowers] Không ghi được cột G -- thiếu excelRow (input gõ tay, không import từ Excel?).'); return; }
  try { await require('./writeExcelCell').writeExcelCell(excelRow, 'G', count); log(`[xlv2_checkFollowers] Đã ghi ${count} vào ô G${excelRow}.`); }
  catch (e) { log(`[xlv2_checkFollowers] LỖI ghi cột G (dòng ${excelRow}): ${String(e.message).split('\n')[0]}`); }
}

async function xlv2_checkFollowers(page, log, deps, excelRow) {
  try {
    const { clickVisibly, humanPause } = deps;
    const profileLink = page.locator('xpath=//*[@data-testid="AppTabBar_Profile_Link"]').first();
    const followersLink = page.locator('xpath=//a[@role="link"][.//span[normalize-space(.)="Followers" or normalize-space(.)="Follower"]]').first();

    await clickVisibly(page, profileLink);
    log('[xlv2_checkFollowers] Đã bấm vào Profile, chờ link Followers...');
    await humanPause(page, 1000, 3000);
    await followersLink.waitFor({ state: 'visible', timeout: 15000 });

    const raw = ((await followersLink.innerText()) || '').trim();
    const count = parseFollowerCount(raw);
    if (count === null) throw new Error(`Không tách được số từ "${raw}".`);
    log(`[xlv2_checkFollowers] Followers: ${count} (đọc được: "${raw.replace(/\s+/g, ' ')}")`);
    await saveToExcelColumnG(log, excelRow, count);
    return count;
  } catch (e) {
    log(`[xlv2_checkFollowers] LỖI: không đọc được số Followers -- bỏ qua, làm tiếp. (${String(e.message).split('\n')[0]})`);
    return null;
  }
}

module.exports = { xlv2_checkFollowers, parseFollowerCount };