/**
 * scripts/xlv3_like_tweet.js
 * -----------------------------------------------------------------------
 * TODO: mô tả hành vi thật ở đây.
 *
 * KHÔNG được main.js gọi trực tiếp -- cùng quy ước với newFile_01.js:
 * được 1 file khác (VD: interactX.js) require() và gọi, nhận `deps`
 * (helpers, đã require sẵn) và `row` (đã JSON.parse(input) sẵn) từ
 * bên ngoài truyền xuống. CHƯA được gắn vào interactX.js -- nói mình
 * biết khi nào cần gắn và gắn ở đâu trong chuỗi.
 *
 * Usage (từ file khác, giống newFile_01.js):
 *   const { runNewFile02 } = require('./newFile_02');
 *   await runNewFile02(page, log, deps, row);
 *
 * Việc: cho 1 link bài viết X (postUrl) -- tự phân tích ra username +
 * statusId, dùng gotoProfile.js (DÙNG CHUNG với newFile_01.js) để điều
 * hướng tới đúng trang profile, bấm vào đúng bài viết, chờ vào hẳn
 * trang chi tiết bài viết (nhận biết qua link .../analytics), rồi
 * retweet nếu chưa retweet.
 * -----------------------------------------------------------------------
 */
//const postUrl = 'https://x.com/Toobit_official/status/2091888399095414904';
//const maxIterations = 5; // giới hạn riêng cho việc CHỜ XÁC NHẬN RETWEET -- không liên quan tới việc mở bài ở trên nữa;
//const maxInlineAttempts = 15; // giới hạn -- KHÔNG có giới hạn này thì lặp vĩnh viễn nếu không bao giờ xác nhận được unretweet



async function xlv3_like_tweet(page, log, deps, postUrl, maxInlineAttempts, maxIterations) {
  const { clickVisibly, moveMouseVisibly, ambientMouseMove } = deps;
  const { gotoProfile } = require('./xlv2_gotoProfile');
  const { openTweetDetail } = require('./xlv2_openTweetDetail');
  const { findTweetInTimeline } = require('./xlv1_findTweetInTimeline');
  const { scrollToElement } = require('./xlv1_scrollToElement');

  

  log('[like] Bắt đầu...');

  // TODO: vẫn là placeholder -- nguồn giá trị thật cho postUrl (cột
  // Excel nào, hay theo cách khác) là câu hỏi còn treo, giống hệt
  // targetUsername ở newFile_01.js.
  //const postUrl = 'https://x.com/Toobit_official/status/2091888399095414904';

  // Tự phân tích URL ra username + statusId -- không hard-code tay 2
  // giá trị đó rời rạc, chỉ cần đổi postUrl là đủ.
  const match = postUrl.match(/x\.com\/([^/]+)\/status\/(\d+)/i);
  if (!match) {
    throw new Error(`[newFile_02] Không phân tích được username/statusId từ URL: "${postUrl}"`);
  }
  const [, username, statusId] = match;
  log(`[newFile_02] Phân tích URL -- username: ${username}, statusId: ${statusId}`);

  // ---- Không vào thẳng profile nữa: findTweetInTimeline bên dưới tìm bài trên trang đang xem trước (VD đang lướt Home),
  // không có mới vào profile @username (gotoProfile: 80% click link có sẵn / 20% search) ----

  // ---- Bấm vào đúng bài viết, chờ vào hẳn trang chi tiết ----
  // BUG ĐÃ SỬA: trước đây gộp chung 1 XPath kiểu
  // "//*[@href=...]/ancestor::article//button[...]" rồi lấy .first()
  // trên CẢ CHUỖI đó -- ancestor::article không đảm bảo chỉ trả về
  // đúng 1 <article> gần nhất (VD: bài dạng trích dẫn có article lồng
  // trong article), nên .first() có thể lấy nhầm nút retweet của MỘT
  // BÀI KHÁC. Sửa bằng cách tách thành LOCATOR CHAIN: tìm đúng link ->
  // lấy ĐÚNG 1 article gần nhất bằng ancestor::article[1] (có chỉ số,
  // không mập mờ) -> mọi thứ sau đó tìm BÊN TRONG đúng article locator
  // này, không còn gộp XPath nữa.
  const statusLink = page.locator(`xpath=//*[@href="/${username}/status/${statusId}" and @role="link"]`).first();
  //const postTweetContainer = statusLink.locator('xpath=ancestor::*[@data-testid="tweet"][1]');
  const postTweetContainer = page.locator(`xpath=//*[contains(@href,"/${username}/status/${statusId}")]/ancestor::*[@data-testid="tweet"]`);
  const postTweetContainerToFind = page.locator(`xpath=//*[contains(@href,"/${username}/status/${statusId}")]/ancestor::*[@data-testid="tweet"]`);
  // Scoped bên trong ĐÚNG postTweetContainer ở trên -- không phải
  // XPath toàn trang nữa, nên chắc chắn không lấy nhầm nút của bài
  // khác.
  const inlineUnretweetBtn = postTweetContainer.locator('button[data-testid="unlike"]');
  const inlineRetweetBtn = postTweetContainer.locator('button[data-testid="like"]');
  // Click vào ĐÚNG tweetText của postTweetContainer (không phải nguyên
  // khối) -- dùng openTweetDetail.js (dùng chung) để tự né các
  // @mention/#hashtag/link lồng bên trong text, tránh nhảy sai trang.
  const tweetText = postTweetContainer.locator('[data-testid="tweetText"]').first();
  const expectedStatusHref = `/${username}/status/${statusId}`;
  // 2 selector này KHÔNG scoped -- dùng khi đã ở hẳn trang chi tiết bài
  // viết (chỉ có đúng 1 bài chính trên trang lúc đó).
  const unretweetSelector = '[data-testid="unlike"]';
  const retweetSelector = '[data-testid="like"]';
  const retweetConfirmSelector = '[data-testid="unlike"]';

  // ---- Tìm bài viết: trang đang xem trước, không có mới vào profile cuộn dần (xem findTweetInTimeline.js) ----
  const foundPost = await findTweetInTimeline(page, log, deps, postTweetContainerToFind,username, `bài viết statusId=${statusId}`);

  if (!foundPost) {
    throw new Error(`[newFile_02] Cuộn nhiều lần vẫn không tìm thấy bài viết statusId=${statusId} trên trang @${username}.`);
  }

  // "visible" đã tìm thấy không có nghĩa là đang NẰM TRONG khung nhìn
  // hiện tại (X có thể render sẵn 1-2 bài ngay dưới rìa màn hình để
  // cuộn mượt hơn) -- cuộn thêm cho chắc trước khi làm bất cứ gì tiếp
  // theo (kiểm tra nút inline, tính điểm click...), không làm gì nếu
  // đã trong tầm nhìn rồi.
  // (findTweetInTimeline đã lướt bài vào giữa màn hình bằng con lăn -- không nhảy scrollIntoViewIfNeeded nữa)
  await page.waitForTimeout(300 + Math.random() * 400);

  // ---- Quyết định NGẪU NHIÊN dùng cách nào: 1) retweet trực tiếp tại
  // timeline, hay 2) mở bài ra rồi retweet trong trang chi tiết -- 2
  // "kiểu người dùng" khác nhau, không nên LUÔN LUÔN ưu tiên 1 cách cố
  // định (dễ tạo pattern lặp lại, giống hệt các chỗ random khác trong
  // dự án này).
  const inlineAlreadyRetweeted = await inlineUnretweetBtn.isVisible({ timeout: 3000 }).catch(() => false);
  const inlineCanRetweet = inlineAlreadyRetweeted
    ? false
    : await inlineRetweetBtn.isVisible({ timeout: 3000 }).catch(() => false);
  const inlineAvailable = inlineAlreadyRetweeted || inlineCanRetweet;

  // Random 50/50 -- nhưng CHỈ khi cách 1 thực sự khả thi (nút đã hiện
  // diện trên timeline). Không khả thi thì không có gì để "chọn ngẫu
  // nhiên" -- bắt buộc rớt xuống cách 2.
  const useInlineMethod = inlineAvailable && Math.random() < 0.5;
  //const useInlineMethod = 0;
	//const useInlineMethod = false;
  //if (useInlineMethod) {
  if (useInlineMethod) {
    log('[newFile_02] Chọn ngẫu nhiên: retweet trực tiếp tại timeline.');

    //const maxInlineAttempts = 15; // giới hạn -- KHÔNG có giới hạn này thì lặp vĩnh viễn nếu không bao giờ xác nhận được unretweet
    for (let attempt = 1; attempt <= maxInlineAttempts; attempt++) {
      const done = await inlineUnretweetBtn.isVisible({ timeout: 3000 }).catch(() => false);
      if (done) {
        log('[newFile_02] Đã retweet (trực tiếp tại timeline) -- dừng.');
        log('[newFile_02] Kết thúc.');
        return;
      }

      const canClick = await inlineRetweetBtn.isVisible({ timeout: 3000 }).catch(() => false);
      if (canClick) {
        // Bài dài -- nút RT có thể nằm ngoài khung nhìn dù khối
        // article đã "visible" (mới thấy phần ĐẦU bài, chưa chắc đã
        // cuộn đủ xa tới nút RT ở cuối bài). Tự cuộn thêm nếu cần,
        // không làm gì nếu đã trong tầm nhìn -- an toàn gọi mỗi lần,
        // kể cả bài ngắn không cần cuộn thêm.
        await scrollToElement(page, log, deps, inlineRetweetBtn, 'nút trên bài'); // lướt bằng con lăn, không nhảy tức thời
        await page.waitForTimeout(300 + Math.random() * 400); // 1 nhịp sau khi cuộn, trước khi thao tác

        await ambientMouseMove(page, moveMouseVisibly);
        await clickVisibly(page, inlineRetweetBtn);
        log(`[newFile_02] Đã bấm Retweet tại timeline (lần ${attempt}/${maxInlineAttempts}), chờ menu xác nhận...`);

        // const retweetConfirmBtn = page.locator(retweetConfirmSelector).first();
        // const gotConfirm = await retweetConfirmBtn
        //   .waitFor({ state: 'visible', timeout: 8000 })
        //   .then(() => true)
        //   .catch(() => false);

        // if (gotConfirm) {
        //   await retweetConfirmBtn.scrollIntoViewIfNeeded().catch(() => {});
        //   await ambientMouseMove(page, moveMouseVisibly);
        //   await clickVisibly(page, retweetConfirmBtn);
        //   log('[newFile_02] Đã bấm xác nhận Retweet.');
        // } else {
        //   log('[newFile_02] Bấm Retweet nhưng không thấy menu xác nhận (retweetConfirm) -- thử lại ở vòng sau.');
        // }
      } else {
        log(`[newFile_02] Chưa thấy retweet/unretweet tại timeline (lần ${attempt}/${maxInlineAttempts}) -- có thể chưa load kịp.`);
      }

      await page.waitForTimeout(2000 + Math.random() * 3000);
    }

    throw new Error(`[newFile_02] Đã thử ${maxInlineAttempts} lần (tại timeline) vẫn chưa xác nhận retweet được bài ${statusId}.`);
  }

  // ---- Cách 2: mở bài viết ra rồi retweet trong trang chi tiết ----
  log(
    `[newFile_02] Chọn ${inlineAvailable ? 'ngẫu nhiên' : '(bắt buộc, không thấy nút tại timeline)'}: mở bài viết ra rồi retweet.`
  );

  // openTweetDetail (dùng chung) tự lo hết việc "bấm vào đúng bài viết
  // an toàn (né link lồng trong text) + xác nhận đã vào đúng bài" --
  // có retry riêng bên trong nó rồi (maxAttempts=5), nên KHÔNG bọc thêm
  // vòng lặp ở đây cho bước mở bài nữa, chỉ gọi 1 lần. Lỗi thật (mở
  // mãi không được) sẽ tự throw lên, không cần newFile_02 tự lặp lại.
  await openTweetDetail(page, log, deps, tweetText,username, expectedStatusHref);

  //const maxIterations = 5; // giới hạn riêng cho việc CHỜ XÁC NHẬN RETWEET -- không liên quan tới việc mở bài ở trên nữa

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    // ---- Kiểm tra/bấm retweet ----
    const alreadyRetweeted = await page.locator(unretweetSelector).first().isVisible({ timeout: 8000 }).catch(() => false);
    if (alreadyRetweeted) {
      log('[newFile_02] Đã retweet -- dừng.');
      log('[newFile_02] Kết thúc.');
      return;
    }

    const canRetweet = await page.locator(retweetSelector).first().isVisible({ timeout: 8000 }).catch(() => false);
    if (canRetweet) {
      const retweetBtn = page.locator(retweetSelector).first();
      await scrollToElement(page, log, deps, retweetBtn, 'nút Like'); // bài dài -- nút có thể ngoài khung nhìn; lướt bằng con lăn
      await page.waitForTimeout(300 + Math.random() * 400);

      await ambientMouseMove(page, moveMouseVisibly);
      await clickVisibly(page, retweetBtn);
      log(`[newFile_02] Đã bấm Retweet (lần ${iteration}/${maxIterations}), chờ menu xác nhận...`);

      // const retweetConfirmBtn = page.locator(retweetConfirmSelector).first();
      // const gotConfirm = await retweetConfirmBtn
      //   .waitFor({ state: 'visible', timeout: 8000 })
      //   .then(() => true)
      //   .catch(() => false);

      // if (gotConfirm) {
      //   await retweetConfirmBtn.scrollIntoViewIfNeeded().catch(() => {});
      //   await ambientMouseMove(page, moveMouseVisibly);
      //   await clickVisibly(page, retweetConfirmBtn);
      //   log('[newFile_02] Đã bấm xác nhận Retweet.');
      // } else {
      //   log('[newFile_02] Bấm Retweet nhưng không thấy menu xác nhận (retweetConfirm) -- thử lại ở vòng sau.');
      // }
    } else {
      log(`[newFile_02] Chưa thấy retweet/unretweet (lần ${iteration}/${maxIterations}) -- có thể chưa load kịp.`);
    }

    await page.waitForTimeout(2000 + Math.random() * 3000);
  }

  throw new Error(`[newFile_02] Đã thử ${maxIterations} lần vẫn chưa xác nhận retweet được bài ${statusId}.`);
}

module.exports = { xlv3_like_tweet };