/**
 * scripts/xlv3_postTweet.js
 * -----------------------------------------------------------------------
 * Đăng 1 tweet mới với nội dung tweetContent (nơi gọi tự lấy rồi truyền vào).
 *
 * Luồng:
 *   1) Click nút SideNav_NewTweet_Button (human click = clickVisibly có sẵn trong deps).
 *   2) Đợi ô soạn tweet (tweetTextarea_0 nằm cùng khối với tweetButton) hiện ra.
 *   3) Click vào ô đó (clickVisibly), rồi NGẪU NHIÊN 1 trong 5 kiểu: Ctrl+A | Backspace 20-40 lần | Ctrl+Backspace 3-10 lần | Ctrl+A rồi Backspace | Ctrl+A rồi Delete;
 *      sau đó gõ tweetContent (typeWithJitter -- gõ từng ký tự, nhịp ngẫu nhiên).
 *   4) Đợi ngẫu nhiên 1-4 giây -> click tweetButton -> đợi ngẫu nhiên 3-6 giây.
 *
 * Usage:
 *   const { xlv3_postTweet } = require('./xlv3_postTweet');
 *   await xlv3_postTweet(page, log, deps, tweetContent);
 * -----------------------------------------------------------------------
 */

async function xlv3_postTweet(page, log, deps, tweetContent) {
  //const { clickVisibly } = deps;
  const { humanPause, typeWithJitter } = require('./helpers');
  //const { humanPause } = require('./helpers');
  const { typeVisibly,clickVisibly, moveMouseVisibly, ambientMouseMove } = deps;

  if (typeof tweetContent !== 'string' || !tweetContent.trim()) throw new Error('[xlv3_postTweet] Thiếu tweetContent -- nơi gọi phải tự lấy rồi truyền vào.');
  log(`[xlv3_postTweet] Bắt đầu đăng tweet (${tweetContent.length} ký tự).`);

  const newTweetBtn = page.locator('xpath=//*[@data-testid="SideNav_NewTweet_Button"]').first();
  const textArea = page.locator('xpath=//*[@data-testid="tweetButton"]/../../../../../../..//*[@data-testid="tweetTextarea_0"]').first();
  const tweetBtn = page.locator('xpath=//*[@data-testid="tweetButton"]').first();

  await clickVisibly(page, newTweetBtn);
  await textArea.waitFor({ state: 'visible', timeout: 15000 });
  log('[xlv3_postTweet] Ô soạn tweet đã hiện.');

  await clickVisibly(page, textArea);
  await clearComposerRandomly(page, log);
  await typeWithJitter(page, textArea, tweetContent);
  log('[xlv3_postTweet] Đã gõ xong nội dung.');

  await humanPause(page, 1000, 4000);
  await clickVisibly(page, tweetBtn);
  log('[xlv3_postTweet] Đã bấm nút đăng.');
  await humanPause(page, 3000, 6000);
  log('[xlv3_postTweet] Xong.');

  await page.locator(`xpath=//*[@data-testid="toast" or text()="Whoops! You already said that."]`).first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
  await humanPause(page, 3000, 1000);

  console.log('doi switch');
  const hasCloseAppbar = await page.locator(`xpath=//*[@data-testid="app-bar-close"]`).first().isVisible({ timeout: 1000 }).catch(() => false);
  if (hasCloseAppbar) {
    await page.locator(`xpath=//*[@data-testid="app-bar-close"]`).first().scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(300 + Math.random() * 400); // 1 nhịp sau khi cuộn, trước khi thao tác

    await ambientMouseMove(page, moveMouseVisibly);
    await clickVisibly(page, page.locator(`xpath=//*[@data-testid="app-bar-close"]`).first());
    // Sau khi click "Got it", đợi random 1–2 giây
    await humanPause(page, 1000, 1000);

    const hasCancelSheet = await page.locator(`xpath=//*[@data-testid="confirmationSheetCancel"]`).first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
    if (!hasCancelSheet) { log('[xlv3_postTweet] Không thấy confirmationSheetCancel sau khi đóng -- bỏ qua bước này.'); return; }
    await page.locator(`xpath=//*[@data-testid="confirmationSheetCancel"]`).first().scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(300 + Math.random() * 400); // 1 nhịp sau khi cuộn, trước khi thao tác

    await ambientMouseMove(page, moveMouseVisibly);
    await clickVisibly(page, page.locator(`xpath=//*[@data-testid="confirmationSheetCancel"]`).first());
    // Sau khi click "Got it", đợi random 1–2 giây
    await humanPause(page, 1000, 1000);
    }



}

// Trước khi gõ: chọn NGẪU NHIÊN 1 trong 5 kiểu thao tác với ô soạn (người thật không lúc nào cũng làm y hệt nhau).
// Lưu ý: kiểu 2 và 3 chỉ xoá chữ nằm TRƯỚC con trỏ và đúng số lần bấm -- ô trống (thường gặp) thì vô hại, ô có sẵn nháp dài thì có thể không xoá hết.
async function clearComposerRandomly(page, log) {
  const rnd = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
  const press = async (key, times) => { for (let i = 0; i < times; i++) { await page.keyboard.press(key); await page.waitForTimeout(30 + Math.random() * 80); } };
  const bsCount = rnd(20, 40), ctrlBsCount = rnd(3, 10);
  const behaviors = [
    { name: 'Ctrl+A', run: async () => { await press('Control+A', 1); } },
    { name: `Backspace x${bsCount}`, run: async () => { await press('Backspace', bsCount); } },
    { name: `Ctrl+Backspace x${ctrlBsCount}`, run: async () => { await press('Control+Backspace', ctrlBsCount); } },
    { name: 'Ctrl+A rồi Backspace', run: async () => { await press('Control+A', 1); await press('Backspace', 1); } },
    { name: 'Ctrl+A rồi Delete', run: async () => { await press('Control+A', 1); await press('Delete', 1); } },
  ];
  const picked = behaviors[Math.floor(Math.random() * behaviors.length)];
  log(`[xlv3_postTweet] Dọn ô soạn trước khi gõ: ${picked.name}`);
  await picked.run();
}

module.exports = { xlv3_postTweet };