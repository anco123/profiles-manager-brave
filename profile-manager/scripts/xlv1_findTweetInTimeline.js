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
//   2) Không có -> vào profile @username (gotoProfile tự chọn: 80% click link @username có sẵn trên trang, 20% search),
//      rồi cuộn dần xuống tìm; thấy bài trong DOM thì lướt tới cho nằm giữa màn hình.
// Trả về true khi bài đã nằm trong vùng nhìn thấy.
async function findTweetInTimeline(page, log, deps, targetLocator,username, label, maxScrollAttempts = 25) {
  const { ambientMouseMove, moveMouseVisibly } = deps;
  const { gotoProfile } = require('./xlv2_gotoProfile');
  const { scrollToElement } = require('./xlv1_scrollToElement');
  const inDom = (timeout) => targetLocator.first().waitFor({ state: 'attached', timeout }).then(() => true).catch(() => false);

  if (await inDom(500)) {
    log(`[findTweetInTimeline] ${label} đang có sẵn trên trang hiện tại -- lướt tới, không cần vào profile @${username}.`);
    if (await scrollToElement(page, log, deps, targetLocator, label)) return true;
    log(`[findTweetInTimeline] Lướt tới ${label} không được -- vào profile @${username} tìm.`);
  }

  await gotoProfile(page, log, deps, username);

  for (let scrollAttempt = 1; scrollAttempt <= maxScrollAttempts; scrollAttempt++) {
    if (await inDom(3000) && await scrollToElement(page, log, deps, targetLocator, label)) return true;

    log(`[findTweetInTimeline] Chưa thấy ${label} (lần ${scrollAttempt}/${maxScrollAttempts}) -- cuộn xuống tìm tiếp.`);

    // KHÔNG phải lần cuộn nào cũng di chuột trước -- người thật lăn
    // chuột/trackpad rất nhiều lần mà không di chuyển con trỏ trước đó
    // (tay đặt sẵn trên chuột, chỉ lăn). Nếu lần nào cũng di chuột
    // trước khi cuộn thì đó lại là 1 pattern lặp lại đều đặn khác --
    // đúng "tư duy" đã dùng trong interactXHome.js (readAndScrollBeat,
    // checkExplore, checkProfile, checkBookmarks đều làm vậy).
    if (Math.random() < 0.6) {
      await ambientMouseMove(page, moveMouseVisibly);
    }
    const delta = 400 + Math.random() * 400;
    if (typeof deps.momentumScroll === 'function') await deps.momentumScroll(page, delta); else await page.mouse.wheel(0, delta);
    await page.waitForTimeout(1000 + Math.random() * 1000); // cho DOM ảo hoá kịp render thêm bài mới sau khi cuộn
  }

  return false;
}

module.exports = { findTweetInTimeline };