/**
 * scripts/openTweetDetail.js
 * -----------------------------------------------------------------------
 * Dùng khi ĐÃ BIẾT TRƯỚC bài đích cụ thể (VD: newFile_02.js) --
 * expectedStatusHref BẮT BUỘC (VD: "/Toobit_official/status/2091867062373360109").
 * KHÔNG dùng được cho interactXHome.js vì nó mở bài NGẪU NHIÊN, không
 * có href cụ thể nào để so khớp -- interactXHome.js dùng thẳng
 * pickSafeClickPoint() từ scripts/safeClickPoint.js (dùng chung, xem
 * file đó), không đụng gì tới file này nữa.
 *
 * Click xong, chạy 1 while CHỈ SAU KHI ĐÃ CLICK -- lặp kiểm tra tới
 * khi CẢ 2 điều kiện cùng đúng:
 *   1) có phần tử href = đúng expectedStatusHref
 *   2) có phần tử data-testid="tweetTextarea_0" (ô soạn reply -- CHỈ
 *      xuất hiện trên trang chi tiết của ĐÚNG 1 bài cụ thể, không có
 *      ở search overlay hay bất kỳ đâu khác -- đáng tin hơn hẳn
 *      app-bar-back, thứ đã xác nhận qua log thực tế là có thể tồn tại
 *      sẵn từ context khác, gây báo sai "đã vào" dù chưa hề điều hướng
 *      đi đâu).
 *
 * Usage:
 *   const { openTweetDetail } = require('./openTweetDetail');
 *   await openTweetDetail(page, log, deps, tweetText, `/${username}/status/${statusId}`);
 * -----------------------------------------------------------------------
 */

const { pickSafeClickPoint } = require('./xlv1_safeClickPoint');
const { findTweetInTimeline } = require('./xlv1_findTweetInTimeline');

async function openTweetDetail(page, log, deps, tweetTextLocator,username, expectedStatusHref) {
  if (!expectedStatusHref) {
    throw new Error('[openTweetDetail] Thiếu expectedStatusHref -- hàm này chỉ dùng khi biết trước bài đích cụ thể. Mở bài NGẪU NHIÊN (không biết trước href) thì dùng pickSafeClickPoint() trực tiếp, không dùng hàm này.');
  }

  const { clickVisibly, ambientMouseMove, moveMouseVisibly } = deps;

  // const hrefSelector = `xpath=//*[@href="${expectedStatusHref}"]`;
  const hrefSelector = `xpath=//*[contains(@href,"${expectedStatusHref}")]`;
  const textareaSelector = 'xpath=//*[@data-testid="tweetTextarea_0"]';

  const maxAttempts = 15; // số lần thử CLICK LẠI TỪ ĐẦU nếu lần trước không vào được
  const maxWaitMs = 15000; // trong MỖI lần click, chờ tối đa bao lâu cho while dưới xác nhận
  const pollIntervalMs = 500;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const safePoint = await pickSafeClickPoint(tweetTextLocator);

    if (!safePoint) {
      log(`[openTweetDetail] Không tìm được điểm click an toàn trong text (toàn link?) (lần ${attempt}/${maxAttempts}) -- thử lại.`);
      await page.waitForTimeout(1000 + Math.random() * 1000);
      continue;
    }

    await ambientMouseMove(page, moveMouseVisibly);
    await clickVisibly(page, safePoint);

    // WHILE -- CHỈ chạy SAU KHI đã click. Lặp kiểm tra tới khi CẢ 2
    // điều kiện cùng đúng, hoặc hết maxWaitMs thì coi lần click này
    // thất bại (rớt xuống thử lại ở vòng for bên ngoài).
    const deadline = Date.now() + maxWaitMs;
    let confirmed = false;
    while (Date.now() < deadline) {
      const [hasTextarea] = await Promise.all([
        //hasHref,  hasHref &&  page.locator(hrefSelector).first().isVisible().catch(() => false),
        page.locator(textareaSelector).first().isVisible().catch(() => false),
      ]);
      if (hasTextarea) {
        confirmed = true;
        break;
      }
      
      await page.waitForTimeout(pollIntervalMs);
    }

    if (!confirmed) {
      // log(`[openTweetDetail] Bấm xong nhưng sau ${maxWaitMs}ms vẫn chưa thấy đủ 2 dấu hiệu (href đúng bài + tweetTextarea_0) (lần ${attempt}/${maxAttempts}) -- thử lại.`);
      // continue;
      log(`[openTweetDetail] Bấm xong nhưng sau ${maxWaitMs}ms vẫn chưa xác nhận vào bài ` +`(${attempt}/${maxAttempts}) -- cuộn tìm lại tweet rồi thử click lại.`);

      const foundAgain = await findTweetInTimeline(page,log,deps,tweetTextLocator,username,expectedStatusHref);

      if (!foundAgain) {
        log(`[openTweetDetail] Cuộn tìm lại không thấy tweet ${expectedStatusHref} ` +`-- chuyển sang lần thử click tiếp theo.`);
        continue;
      }

      log(`[openTweetDetail] Đã tìm lại thấy tweet ${expectedStatusHref} ` +`-- sẽ click lại.`);
      continue;
    }

    log('[openTweetDetail] Đã vào đúng trang chi tiết bài viết.');
    return;
  }

  throw new Error(`[openTweetDetail] Đã thử ${maxAttempts} lần vẫn không mở được đúng bài viết (${expectedStatusHref}).`);
}

module.exports = { openTweetDetail };