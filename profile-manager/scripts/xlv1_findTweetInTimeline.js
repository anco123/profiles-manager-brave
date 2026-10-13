/**
 * scripts/xlv1_findTweetInTimeline.js
 * -----------------------------------------------------------------------
 * Dùng chung cho MỌI nơi cần "tìm 1 tweet cụ thể" -- tìm ngay trên trang đang
 * xem trước (VD đang lướt Home), không có mới vào profile cuộn xuống dần tìm trên
 * timeline -- newFile_02.js (tìm bài để retweet), và các file sau này
 * (like, reply, quote...) đều cần lại đúng việc này.
 *
 * Timeline của X ảo hoá (virtualized) -- tweet nằm xa dưới CHƯA TỪNG
 * được render ra DOM cho tới khi cuộn tới gần đó. waitFor() đứng yên 1
 * chỗ sẽ không bao giờ thấy nếu tweet chưa render, dù cuộn tay vẫn
 * thấy được bình thường -- phải chủ động cuộn mỗi lần chưa thấy, không
 * đứng yên.
 *
 * Usage:
 *   const { findTweetInTimeline } = require('./findTweetInTimeline');
 *   const found = await findTweetInTimeline(page, log, deps, postTweetContainer, `statusId=${statusId}`);
 *   if (!found) throw new Error(...);
 * -----------------------------------------------------------------------
 */

// Thứ tự giống người thật:
//   1) Bài ĐÃ CÓ trên trang đang xem (VD đang lướt Home thấy bài) -> lướt tới bằng con lăn luôn, không vào profile tìm làm gì.
//   2) Không có -> vào profile @username (gotoProfile tự chọn: 88% click link @username có sẵn trên trang, 12% search),
//      rồi cuộn dần xuống tìm; thấy bài trong DOM thì lướt tới cho nằm giữa màn hình.
//   3) Bài quá cũ / đã cuộn qua mà không thấy (VD bài là reply, không hiện ở tab Posts) -> mở thẳng link bài
//      (như người có sẵn link bấm vào), không cuộn mù hết 25 lần -- trước đây bài cũ vài ngày trên profile đăng nhiều là cuộn tới hết giờ script.
//      Ước lượng xa/gần bằng statusId (ID của X tăng theo thời gian): bài trên màn hình càng mới hơn bài đích thì càng còn xa.
// Trả về true khi bài đã nằm trong vùng nhìn thấy.
async function findTweetInTimeline(page, log, deps, targetLocator,username, label, maxScrollAttempts = 25) {
  const { ambientMouseMove, moveMouseVisibly } = deps;
  const { gotoProfile } = require('./xlv2_gotoProfile');
  const { scrollToElement } = require('./xlv1_scrollToElement');
  const inDom = (timeout) => targetLocator.first().waitFor({ state: 'attached', timeout }).then(() => true).catch(() => false);
  const idMatch = String(label).match(/(?:statusId=|\/status\/)(\d+)/);
  const targetId = idMatch ? BigInt(idMatch[1]) : null;

  // ID bài CŨ NHẤT của chính @username đang có trong DOM (bỏ bài ghim / bài đăng lại -- có socialContext). null = chưa có bài nào.
  const oldestOwnId = async () => {
    const ids = await page.evaluate((u) => [...document.querySelectorAll('article[data-testid="tweet"]')]
      .filter((a) => !a.querySelector('[data-testid="socialContext"]'))
      .map((a) => { const t = a.querySelector('a[href] time'); const m = t && t.closest('a').getAttribute('href').match(/^\/([^/]+)\/status\/(\d+)/); return m && m[1].toLowerCase() === u ? m[2] : null; })
      .filter(Boolean), username.toLowerCase()).catch(() => []);
    return ids.length ? ids.map(BigInt).reduce((a, b) => (b < a ? b : a)) : null;
  };
  const openDirectly = async (why) => {
    log(`[findTweetInTimeline] ${why} -- mở thẳng link bài ${label}.`);
    await page.goto(`https://x.com/${username}/status/${targetId}`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    return (await inDom(15000)) && scrollToElement(page, log, deps, targetLocator, label);
  };

  if (await inDom(500)) {
    log(`[findTweetInTimeline] ${label} đang có sẵn trên trang hiện tại -- lướt tới, không cần vào profile @${username}.`);
    if (await scrollToElement(page, log, deps, targetLocator, label)) return true;
    log(`[findTweetInTimeline] Lướt tới ${label} không được -- vào profile @${username} tìm.`);
  }

  await gotoProfile(page, log, deps, username);
  let firstOldest = null;

  for (let scrollAttempt = 1; scrollAttempt <= maxScrollAttempts; scrollAttempt++) {
    if (await inDom(3000) && await scrollToElement(page, log, deps, targetLocator, label)) return true;

    if (targetId !== null) {
      const oldest = await oldestOwnId();
      if (oldest !== null && oldest < targetId) return openDirectly('Đã cuộn qua mốc thời gian của bài mà không thấy (có thể là reply / bài bị ẩn)');
      if (oldest !== null && firstOldest === null) firstOldest = oldest;
      if (oldest !== null && scrollAttempt >= 3 && firstOldest > oldest) {
        const perScroll = Number(firstOldest - oldest) / (scrollAttempt - 1); // mỗi lần cuộn đi lùi được bao nhiêu "thời gian"
        const need = Number(oldest - targetId) / perScroll;
        if (need > maxScrollAttempts - scrollAttempt) return openDirectly(`Bài còn quá xa (ước tính ~${Math.ceil(need)} lần cuộn nữa)`);
      }
    }

    log(`[findTweetInTimeline] Chưa thấy ${label} (lần ${scrollAttempt}/${maxScrollAttempts}) -- cuộn xuống tìm tiếp.`);

    // KHÔNG phải lần cuộn nào cũng di chuột trước -- người thật lăn chuột/trackpad rất nhiều lần mà không di chuyển con trỏ
    // (tay đặt sẵn trên chuột, chỉ lăn) -- đúng "tư duy" đã dùng trong interactXHome.js.
    if (Math.random() < 0.6) await ambientMouseMove(page, moveMouseVisibly);
    const delta = 400 + Math.random() * 400;
    if (typeof deps.momentumScroll === 'function') await deps.momentumScroll(page, delta); else await page.mouse.wheel(0, delta);
    await page.waitForTimeout(1000 + Math.random() * 1000); // cho DOM ảo hoá kịp render thêm bài mới sau khi cuộn
  }

  return targetId !== null ? openDirectly(`Cuộn ${maxScrollAttempts} lần vẫn chưa thấy`) : false;
}

module.exports = { findTweetInTimeline };