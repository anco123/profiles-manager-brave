const PHANTOM_ID = 'bfnaelmomeimhlpmgjnjophhpkkoljpa';
const PHANTOM_PASSWORD = '11111111';
const POPUP_URL = `chrome-extension://${PHANTOM_ID}/popup.html`;
const ONBOARDING_URL = `chrome-extension://${PHANTOM_ID}/onboarding.html`;
const MAX_SEED_ATTEMPTS = 3; // seed sai thật thì điền lại mãi cũng lỗi -- quá số lần này thì dừng hẳn

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const isClosedErr = (e) => /has been closed/i.test(String(e && e.message));

// ===== Tắt hẳn Side Panel của Phantom =====
// Playwright KHÔNG thấy Side Panel (không có trong context.pages()), nên
// nếu Phantom hiện yêu cầu Connect/Sign ở đó thì các script sau (VD
// xlv3_bindAndLoginToTesseract.js) không bấm được. Tắt Side Panel để
// Phantom hiện yêu cầu ở popup/cửa sổ thường -- loại mà code cũ tìm được.
//
// `wp` phải là 1 trang của CHÍNH Phantom (popup.html / onboarding.html):
// chrome.sidePanel gọi từ đó là API side panel CỦA PHANTOM.
//   - setOptions({ enabled: false })             -> tắt hẳn, không chỉ đóng
//   - setPanelBehavior({ openPanelOnActionClick }) -> bấm icon mở popup, không mở side panel
//   - close() trên mọi cửa sổ                     -> đóng panel đang mở (nếu có)
// Gọi mỗi lần chạy (rẻ, vài ms) thay vì tin là cài đặt còn nhớ sau khi
// profile khởi động lại.
async function disablePhantomSidePanel(wp, log) {
  if (!wp || wp.isClosed()) return;
  const result = await wp.evaluate(async () => {
    const out = [];
    const sp = chrome.sidePanel;
    if (!sp) return ['chrome.sidePanel không khả dụng'];

    try { await sp.setOptions({ enabled: false }); out.push('enabled=false'); }
    catch (e) { out.push('setOptions lỗi: ' + e.message); }

    try { await sp.setPanelBehavior({ openPanelOnActionClick: false }); out.push('openOnClick=false'); }
    catch (e) { out.push('setPanelBehavior lỗi: ' + e.message); }

    if (sp.close) {
      const wins = await chrome.windows.getAll();
      for (const w of wins) {
        try { await sp.close({ windowId: w.id }); } catch (e) { /* cửa sổ đó không mở panel -- bỏ qua */ }
      }
      out.push(`đã đóng panel trên ${wins.length} cửa sổ`);
    }
    return out;
  }).catch((e) => ['evaluate lỗi: ' + (e && e.message)]);

  log('[phantom] Tắt Side Panel: ' + result.join(', '));
}

async function checkAndLoginPhantom(page, context, log, require, phantomSeedPharse) {

  // ===== Tab 1: tab làm việc gốc, giữ chỗ, KHÔNG động vào =====
  let holderPage = context.pages().find(p => !p.isClosed());
  if (!holderPage) {
    holderPage = await context.newPage();
  }

  // ===== Debug: biết chính xác cái gì bị đóng =====
  const onContextClose = () => log('[phantom] context bị đóng');
  const onDisconnected = () => log('[phantom] browser disconnected');
  context.on('close', onContextClose);
  context.browser()?.on('disconnected', onDisconnected);

  // ===== Tab 2: tab làm việc Phantom =====
  let workPage = null;

  // Đóng mọi tab trừ các tab trong keepPages. Không bao giờ đóng tab cuối cùng.
  async function closeAllExcept(keepPages) {
    const keep = keepPages.filter(p => p && !p.isClosed());
    if (keep.length === 0) {
      keep.push(await context.newPage());
    }

    let closed = 0;
    for (const p of context.pages()) {
      if (p.isClosed() || keep.includes(p)) continue;
      await p.close({ runBeforeUnload: false }).catch(() => {});
      closed++;
    }
    if (closed > 0) log(`[phantom] đã đóng ${closed} tab thừa`);
  }

  // Lấy tab 2 còn sống + active. Nếu tab 2 đã bị đóng thì tạo tab 2 mới.
  async function getWorkPage() {
    if (!workPage || workPage.isClosed()) {
      log('[phantom] tạo tab 2 (làm việc)');
      workPage = await context.newPage();
      const p = workPage;
      p.on('close', () => log('[phantom] tab 2 bị đóng'));
    }
    await workPage.bringToFront().catch(() => {});
    return workPage;
  }

  // Mở popup.html trên tab 2 -> đợi 5s -> đóng tab thừa (chỉ giữ tab 1 + tab 2) -> active tab 2
  async function openPopupOnWorkTab() {
    const wp = await getWorkPage();
    try {
      await wp.goto(POPUP_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch (e) {
      if (!isClosedErr(e)) throw e;
      log('[phantom] tab 2 bị đóng lúc mở popup.html');
    }

    await sleep(5000); // dùng sleep thay vì page.waitForTimeout vì tab có thể đã chết

    const wp2 = await getWorkPage(); // tạo lại tab 2 nếu bị đóng

    // Đảm bảo tab 1 còn sống
    if (holderPage.isClosed()) {
      holderPage = await context.newPage();
    }

    // Chỉ giữ tab 1 + tab 2, đóng toàn bộ tab tự mở thêm
    await closeAllExcept([holderPage, wp2]);

    // Chỉ active tab 2
    await wp2.bringToFront().catch(() => {});
    return wp2;
  }

  // 1 lượt đi hết màn onboarding: mở onboarding.html -> điền seed -> password -> hoàn tất.
  // Trả về { ok: true } nếu xong, hoặc { seedError: '<nội dung lỗi>' } nếu Phantom báo
  // seed không hợp lệ (data-testid="onboarding-import-secret-recovery-phrase-error-message")
  // -- nơi gọi (loginPhantom) sẽ tự chạy lại lượt mới.
  async function fillOnboardingOnce(wp, seedWords) {
    await wp.goto(ONBOARDING_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await wp.bringToFront();

    // 2. I already have a wallet
    let element = wp.locator('xpath=//button[text()="I already have a wallet" or text()="Tôi đã có Ví rồi" or text()="I Already Have a Wallet"]').first();
    await element.waitFor({ state: 'visible', timeout: 15000 });
    await element.click();

    // 3. Import Recovery Phrase
    element = wp.locator('xpath=//*[text()="Import Recovery Phrase" or text()="Import Secret Recovery Phrase" or text()="Nhập Cụm từ khôi phục"]').first();
    await element.waitFor({ state: 'visible', timeout: 15000 });
    await element.click();

    // 4. Chờ ô seed đầu tiên
    element = wp.locator('xpath=//input[@data-testid="secret-recovery-phrase-word-input-0"]').first();
    await element.waitFor({ state: 'visible', timeout: 15000 });

    // 5. Điền seed
    for (let i = 0; i < seedWords.length; i++) {
      const seedInput = wp.locator(`xpath=//input[@data-testid="secret-recovery-phrase-word-input-${i}"]`).first();
      await seedInput.waitFor({ state: 'visible', timeout: 5000 });
      await seedInput.fill(seedWords[i]);
    }

    // 6. Submit seed
    element = wp.locator('xpath=//*[@data-testid="onboarding-form-submit-button"]').first();
    await element.waitFor({ state: 'visible', timeout: 15000 });
    await element.click();

    // 7. Submit màn tiếp theo
    await wp.waitForTimeout(200);
    element = wp.locator('xpath=//*[@data-testid="onboarding-form-submit-button"]').first();
    await element.waitFor({ state: 'visible', timeout: 15000 });
    await element.click();

    // 8. Chờ 1 TRONG 2: ô password (seed hợp lệ) HOẶC thông báo lỗi seed
    const passwordInput = wp.locator('xpath=//input[@name="password"]').first();
    const seedError = wp.locator('xpath=//*[@data-testid="onboarding-import-secret-recovery-phrase-error-message"]').first();
    await wp.locator('xpath=//input[@name="password"] | //*[@data-testid="onboarding-import-secret-recovery-phrase-error-message"]').first().waitFor({ state: 'visible', timeout: 15000 });

    if (await seedError.isVisible().catch(() => false)) {
      const msg = (await seedError.innerText().catch(() => '')).trim();
      return { seedError: msg || '(không đọc được nội dung lỗi)' };
    }

    await passwordInput.fill(PHANTOM_PASSWORD);

    const confirmPasswordInput = wp.locator('xpath=//input[@name="confirmPassword"]').first();
    await confirmPasswordInput.fill(PHANTOM_PASSWORD);

    // 9. Tick điều khoản
    while (true) {
      await wp.waitForTimeout(1000);
      const checkedElement = wp.locator('xpath=//input[@aria-checked="true"]').first();
      if (await checkedElement.isVisible().catch(() => false)) break;
      const uncheckedElement = wp.locator('xpath=//input[@aria-checked="false"]').first();
      if (await uncheckedElement.isVisible().catch(() => false)) {
        await uncheckedElement.click();
        continue;
      }
      await wp.waitForTimeout(1000);
    }

    // 10. Submit tạo password + các màn hoàn tất
    for (let i = 0; i < 3; i++) {
      element = wp.locator('xpath=//button[@data-testid="onboarding-form-submit-button"]').first();
      await element.waitFor({ state: 'visible', timeout: 15000 });
      await element.click();
      if (i < 2) await wp.waitForTimeout(8000);
    }

    return { ok: true };
  }

  async function loginPhantom() {
    const seedWords = String(phantomSeedPharse || '').trim().split(/\s+/).filter(Boolean);

    if (![12, 24].includes(seedWords.length)) {
      throw new Error(`phantomSeedPharse phải có 12 hoặc 24 từ, hiện có ${seedWords.length} từ.`);
    }

    const wp = await getWorkPage();

    try {
      // Lặp lại cả lượt onboarding khi Phantom báo lỗi seed -- vòng lặp thay vì
      // loginPhantom() tự gọi lại chính nó, để khối finally bên dưới chỉ chạy 1 lần.
      for (let attempt = 1; attempt <= MAX_SEED_ATTEMPTS; attempt++) {
        const r = await fillOnboardingOnce(wp, seedWords);
        if (r.ok) {
          log('[loginPhantom] Login Phantom hoàn tất.');
          return true;
        }
        if (attempt === MAX_SEED_ATTEMPTS) {
          throw new Error(`Phantom báo lỗi seed ${attempt} lần liên tiếp ("${r.seedError}") -- kiểm tra lại seed ở cột R.`);
        }
        log(`[loginPhantom] Phantom báo lỗi seed ("${r.seedError}") -- điền lại từ đầu (lần ${attempt + 1}/${MAX_SEED_ATTEMPTS})...`);
      }
    } finally {
      if (!wp.isClosed()) {
        await wp.bringToFront().catch(() => {});
        await sleep(3000);

        // Onboarding xong Phantom hay tự bật Side Panel -- tắt ngay.
        await disablePhantomSidePanel(wp, log);
      }
    }
  }

  try {
    while (true) {
      await sleep(8000);
      // Mở popup.html trên tab 2 -> đợi 5s -> đóng tab thừa -> active tab 2
      let wp = await openPopupOnWorkTab();

      // Nếu tab 2 vừa bị đóng/tạo lại (url không còn là popup.html) -> thử mở lại 1 lần
      if (!wp.url().startsWith(POPUP_URL)) {
        log('[phantom] tab 2 không còn ở popup.html, thử mở lại 1 lần');
        wp = await openPopupOnWorkTab();
      }

      let needLogin = false;

      if (!wp.url().startsWith(POPUP_URL)) {
        // Popup tự đóng / tự chuyển sang onboarding => ví chưa có
        log('[phantom] popup bị đóng/chuyển trang -> coi như chưa có ví, chuyển sang import');
        needLogin = true;
      } else {
        try {
          const loadedPhantomWallet = wp.locator('xpath=//*[text()="I already have a wallet" or text()="Tôi đã có Ví rồi" or text()="I Already Have a Wallet" or @data-testid="unlock-form-password-input"or text()="Swap"]').first();
          await loadedPhantomWallet.waitFor({ state: 'visible', timeout: 15000 });

          // ===== ĐÃ SỬA: trước đây chỉ cần THẤY MÀN HÌNH (ô mật khẩu hoặc chữ "Swap")
          // là coi như "đã đăng nhập sẵn", không hề kiểm tra bên TRONG ví có tài khoản
          // thật hay không -- 1 ví bị import lỗi giữa chừng (có password nhưng vault
          // rỗng) vẫn hiện đúng những màn hình này, khiến code bỏ qua import mãi mãi.
          // Giờ: gặp ô mật khẩu thì tự nhập mật khẩu mở khoá, đợi tới khi thấy "Swap",
          // rồi trong 8s tiếp theo phải THẤY chữ "Ethereum" (danh sách mạng/token thật)
          // mới tính là ví hợp lệ -- không thấy thì coi như ví lỗi/rỗng, cho import lại
          // giống trường hợp chưa có ví.
          const unlockInput = wp.locator('xpath=//*[@data-testid="unlock-form-password-input"]').first();
          const swapScreen = wp.locator('xpath=//*[text()="Swap"]').first();
          const ethereumElement = wp.locator('xpath=//*[text()="Ethereum"]').first();
          const needToLoginPhantom = wp.locator('xpath=//*[text()="I already have a wallet" or text()="Tôi đã có Ví rồi" or text()="I Already Have a Wallet"]').first();

          const loginDonePhantom = await unlockInput.isVisible().catch(() => false) || await swapScreen.isVisible().catch(() => false);

          if (loginDonePhantom) {
            // Đang ở màn khoá -> nhập mật khẩu, đợi tới khi thấy Swap (mở khoá xong).
            // Đã ở màn Swap sẵn (không qua màn khoá) -> để yên, không đụng gì.
            if (await unlockInput.isVisible().catch(() => false)) {
              await unlockInput.fill(PHANTOM_PASSWORD);
              await wp.waitForTimeout(300);
              await unlockInput.press('Enter');
              log('[phantom] Đã nhập mật khẩu mở khoá Phantom.');
              await swapScreen.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
            }

            // Đã ở màn Swap -- trong 8s có chữ "Ethereum" không: CÓ mới tính là ví hợp
            // lệ (đã đăng nhập sẵn), KHÔNG có thì coi như ví lỗi/rỗng.
            const hasEthereum = await ethereumElement
              .waitFor({ state: 'visible', timeout: 8000 })
              .then(() => true)
              .catch(() => false);

            if (hasEthereum) {
              log('Login Done Phantom');
              // Chạy ở CẢ 2 trường hợp: ví có sẵn từ trước, và vừa import
              // xong (vòng lặp luôn quay lại đây kiểm tra sau khi import).
              await disablePhantomSidePanel(wp, log);
              break;
            }

            log('[phantom] Thấy Swap nhưng không thấy "Ethereum" trong 8s -> coi như ví lỗi/rỗng, import lại.');
            needLogin = true;
          } else {
            needLogin = await needToLoginPhantom.isVisible().catch(() => false);
          }
        } catch (e) {
          if (!isClosedErr(e)) throw e;
          log('[phantom] tab 2 bị đóng lúc kiểm tra ví -> vòng sau kiểm tra lại');
          continue;
        }
      }

      if (needLogin) {
        try {
          await loginPhantom();
          log('đã log xong phantom');
        } catch (e) {
          // Phantom hay TỰ đóng tab onboarding ngay khi vừa xong việc
          // (thấy rõ trong log thực tế: tab bị đóng đúng lúc đang chờ
          // giữa 2 lần bấm submit cuối). Lỗi "has been closed" ở ĐÂY
          // nhiều khả năng là DẤU HIỆU import đã xong chứ không phải
          // thất bại -- không throw ra ngoài làm sập cả hàm, để vòng lặp
          // bên ngoài tự mở lại popup.html và kiểm tra đúng trạng thái ví
          // ở lượt sau (xong thật -> loadedPhantomWallet cho thấy
          // loginDonePhantom; chưa xong -> needToLoginPhantom vẫn hiện,
          // tự thử import lại).
          if (!isClosedErr(e)) throw e;
          log('[phantom] tab bị đóng giữa chừng lúc import ví -- kiểm tra lại trạng thái ở vòng sau.');
        }
      }

      await sleep(6000);
    }
  } finally {
    // Gỡ 2 listener debug -- không để chúng sống dai hơn hàm này và bắt
    // nhầm sự kiện đóng browser xảy ra ở các bước hoàn toàn khác về sau
    // (Tesseract, X, dọn profile...).
    context.off('close', onContextClose);
    context.browser()?.off('disconnected', onDisconnected);

    // Xong hàm: đóng TẤT CẢ tab, chỉ giữ lại tab 1 (tab làm việc gốc) và active nó
    try {
      await closeAllExcept([holderPage]);
      const remain = context.pages().find(p => !p.isClosed());
      if (remain) await remain.bringToFront().catch(() => {});
    } catch (e) {
      log(`[phantom] lỗi khi dọn tab cuối: ${e && e.message}`);
    }
  }
}

module.exports = { checkAndLoginPhantom, disablePhantomSidePanel };