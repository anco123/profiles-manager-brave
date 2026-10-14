/**
 * scripts/loginX.js
 * -----------------------------------------------------------------------
 * Login vào X (Twitter) bằng username/password/2FA lấy từ Excel (cột
 * D/E/F). KHÔNG tự check suspended nữa -- main.js lo việc đó TRƯỚC khi
 * gọi vào file này (qua getXStatus() bằng page.request), nên ở đây chỉ
 * còn mỗi việc login.
 *
 * KHÔNG chạy trực tiếp -- export ra 1 hàm để main.js require() vào rồi
 * gọi.
 *
 * Trả về: { status: 'Done_X', username } khi login thành công.
 *
 * Usage (trong main.js):
 *   const { loginToX } = require('./loginX');
 *   const result = await loginToX(page, context, log, require, input);
 *
 * Cột Excel: D = username, E = password, F = 2FA secret (base32).
 * -----------------------------------------------------------------------
 */

async function loginToX(page, context, log, require, input) {
  const helpers = require('./helpers');
  const { totp, showVisibleCursor, focusFieldVaried, confirmStepVaried, typeWithJitter, humanPause } = helpers;

  const row = input ? JSON.parse(input) : {};
  const username = row.D;
  const password = row.E;
  const totpSecret = row.F;

  if (!username || !password) {
    throw new Error('Thiếu username/password (kiểm tra cột D/E trong Excel)');
  }

  async function debugShot(label) {
    const shotPath = `data/login-debug-${Date.now()}.png`;
    await page.screenshot({ path: shotPath }).catch(() => {});
    log(`[${label}] URL: ${page.url()} | Title: ${await page.title().catch(() => '?')}`);
    log(`[${label}] Screenshot: ${shotPath}`);
  }

  try {
    // ---------- Login ----------
    await page.goto('https://x.com/login?lang=en', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await showVisibleCursor(page);
    log(`Đã vào trang, URL hiện tại: ${page.url()}`);

    // X có nhiều biến thể màn login -- gộp cả 2 selector khả dĩ bằng .or().
    const usernameInput = page.locator('input[autocomplete="username webauthn"], input[autocomplete="username"]')
      .or(page.getByPlaceholder(/email or username/i));
    const homeIndicator = page.locator('[data-testid="SideNav_NewTweet_Button"]');

    // Đợi song song cả 2 khả năng cùng lúc (đã đăng nhập sẵn, hoặc form
    // login hiện ra) -- ai xuất hiện trước thì theo hướng đó.
    const raceResult = await Promise.race([
      usernameInput.first().waitFor({ state: 'visible', timeout: 20000 }).then(() => 'login-form').catch(() => null),
      homeIndicator.waitFor({ state: 'visible', timeout: 20000 }).then(() => 'already-home').catch(() => null),
    ]);

    if (raceResult === 'already-home') {
      log('Profile này đã đăng nhập sẵn -- bỏ qua bước login');
    } else if (raceResult === 'login-form') {
      await humanPause(page); // màn hình vừa hiện ra, nghỉ 1 chút rồi mới gõ

      const field = usernameInput.first();
      const m1 = await focusFieldVaried(page, field);
      log(`Focus username: ${m1}`);
      await typeWithJitter(page, field, username);

      // Nút bước 1 cũng khác tên tuỳ biến thể: "Next" (luồng cũ) hoặc
      // "Continue" (luồng onboarding mới)
      const step1Btn = page.getByRole('button', { name: /^(Next|Continue)$/i }).first();
      const c1 = await confirmStepVaried(page, step1Btn);
      log(`Confirm step 1: ${c1}`);

      // X đôi khi hỏi lại username/SĐT lần 2 nếu nghi ngờ đăng nhập
      const verifyInput = page.locator('input[data-testid="ocfEnterTextTextInput"]');
      if (await verifyInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await humanPause(page);
        const m1b = await focusFieldVaried(page, verifyInput);
        log(`Focus verify: ${m1b}`);
        await typeWithJitter(page, verifyInput, username);
        const c1b = await confirmStepVaried(page, page.getByRole('button', { name: /^(Next|Continue)$/i }).first());
        log(`Confirm verify: ${c1b}`);
      }

      // Password: dùng type="password" -- dấu hiệu chuẩn HTML, ổn định
      // qua mọi biến thể giao diện
      const passwordInput = page.locator('input[type="password"]').first();
      const passwordAppeared = await passwordInput.waitFor({ state: 'visible', timeout: 20000 }).then(() => true).catch(() => false);
      if (!passwordAppeared) {
        await debugShot('password-not-found');
        throw new Error('Không tìm thấy ô password sau 20s');
      }
      await humanPause(page);

      const m2 = await focusFieldVaried(page, passwordInput);
      log(`Focus password: ${m2}`);
      await typeWithJitter(page, passwordInput, password);
      const loginBtn = page.getByRole('button', { name: /^(Log in|Login|Continue)$/i }).first();
      const c2 = await confirmStepVaried(page, loginBtn);
      log(`Confirm login: ${c2}`);

      // 2FA -- autocomplete="one-time-code" là thuộc tính chuẩn HTML cho
      // ô mã một lần, giữ testid cũ làm dự phòng.
      const twoFaInput = page.locator('input[autocomplete="one-time-code"]')
        .or(page.locator('input[data-testid="ocfEnterTextTextInput"]'));
      const twoFaAppeared = await twoFaInput.first().waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);

      if (twoFaAppeared) {
        if (!totpSecret) throw new Error('Tài khoản đòi 2FA nhưng cột F đang trống');
        await humanPause(page);

        const field2fa = twoFaInput.first();
        const m3 = await focusFieldVaried(page, field2fa);
        log(`Focus 2FA: ${m3}`);
        await typeWithJitter(page, field2fa, totp(totpSecret)); // tính mã 6 số hiện tại từ secret ở cột F

        // Nhiều giao diện OTP TỰ ĐỘNG submit ngay khi đủ 6 số, không cần
        // bấm nút nào cả -- kiểm tra đã vào Home chưa TRƯỚC KHI đi tìm
        // nút xác nhận, tránh đợi mù tới khi hết giờ (30s) cho 1 nút có
        // thể sẽ không bao giờ xuất hiện nữa vì trang đã tự chuyển tiếp
        // rồi.
        const autoSubmitted = await homeIndicator.waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false);
        if (autoSubmitted) {
          log('2FA tự động xác nhận (không cần bấm nút) -- đã vào Home.');
        } else {
          const confirmBtn = page.getByRole('button', { name: /^(Next|Continue|Log in|Login)$/i }).first();
          const btnAppeared = await confirmBtn.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
          if (btnAppeared) {
            const c3 = await confirmStepVaried(page, confirmBtn);
            log(`Confirm 2FA: ${c3}`);
          } else {
            log('Không thấy nút xác nhận 2FA -- có thể đã tự submit theo cách khác, tiếp tục kiểm tra Home.');
          }
        }
      } else {
        log('Không thấy ô 2FA (có thể tài khoản này không bật 2FA) -- bỏ qua bước này');
      }

      // Chỉ dựa vào element THẬT trên trang Home, không dựa vào URL --
      // URL của X đổi liên tục tuỳ luồng, không đáng tin để xác nhận.
      const reachedHome = await homeIndicator
        .waitFor({ state: 'visible', timeout: 30000 })
        .then(() => true)
        .catch(() => false);

      if (!reachedHome) {
        await debugShot('not-home');
        throw new Error('Không xác nhận được đã vào Home sau khi login -- có thể gặp captcha hoặc bước khác chưa xử lý');
      }
    } else {
      await debugShot('neither-found');
      throw new Error('Không thấy cả ô username lẫn dấu hiệu đã đăng nhập sau 20s');
    }

    await showVisibleCursor(page);
    log(`Đăng nhập thành công: @${username}`);
    return { status: 'Done_X', username };
  } catch (err) {
    await debugShot('error'); // mọi lỗi trong khối try trên đều tự chụp màn hình lại
    throw err;
  }
}

module.exports = { loginToX };