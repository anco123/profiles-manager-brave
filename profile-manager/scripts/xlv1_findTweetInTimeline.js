/**
 * scripts/xlv1_findTweetInTimeline.js
 * -----------------------------------------------------------------------
 * Dùng chung cho MỌI nơi cần "cuộn xuống dần để tìm 1 tweet cụ thể trên
 * timeline" -- newFile_02.js (tìm bài để retweet), và các file sau này
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

async function findTweetInTimeline(page, log, deps, targetLocator,username, label, maxScrollAttempts = 25) {
  const { ambientMouseMove, moveMouseVisibly } = deps;
  const { gotoProfile } = require('./xlv2_gotoProfile');

  await gotoProfile(page, log, deps, username);

  for (let scrollAttempt = 1; scrollAttempt <= maxScrollAttempts; scrollAttempt++) {
    const found = await targetLocator.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);
    if (found) return true;

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
    await page.mouse.wheel(0, 400 + Math.random() * 400);
    await page.waitForTimeout(1000 + Math.random() * 1000); // cho DOM ảo hoá kịp render thêm bài mới sau khi cuộn
  }

  return false;
}

module.exports = { findTweetInTimeline };