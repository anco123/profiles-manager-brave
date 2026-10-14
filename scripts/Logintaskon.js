/**
 * scripts/Logintaskon.js
 * -----------------------------------------------------------------------
 * ⭐ ĐÂY LÀ BẢN XỊN NHẤT -- DÙNG FILE NÀY, KHÔNG DÙNG loginTask.js. ⭐
 *
 * loginTask.js là bản cũ hơn, THIẾU hẳn phần xử lý vòng lặp link/unlink
 * tài khoản X (xem linkXAccountOnTaskOn bên dưới) mà file này đã có --
 * chỉ giữ lại loginTask.js để tham khảo lịch sử, không nên require() nó
 * nữa. Nếu sau này cần sửa logic TaskOn, sửa Ở FILE NÀY.
 *
 * (Trước đây file này có bug "top-level await" -- 3 dòng await chạy
 * TRẦN ở cuối file, ngoài mọi hàm, khiến require('./Logintaskon') từ
 * nơi khác sẽ crash ngay lập tức với lỗi "require() cannot be used on
 * an ESM graph with top-level await". Đã vá bằng cách gói lại thành 1
 * hàm export -- xem runLoginTask() ở cuối file.)
 *
 * Usage:
 *   const { runLoginTask } = require('./Logintaskon');
 *   await runLoginTask(page, context, log, require, input);
 * -----------------------------------------------------------------------
 */

async function waitForRewardMode(page) {
  const url = 'https://taskon.xyz/quest/143654301';
  while (true) {
    // Vào trang Quest
    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 20000
      });
    } catch (err) {
      log(`Goto Quest lỗi: ${err.message}`); // console.log không hiện ra trong Running log của app
      continue;
    }
    // Chờ tối đa 20 giây để reward-mode xuất hiện
    const rewardMode = page.locator('.reward-mode');
    try {
      await rewardMode.waitFor({
        state: 'visible',
        timeout: 20000
      });
      // Đã xuất hiện
      return true;
    } catch (err) {
      // Hết 20 giây vẫn chưa thấy
      // while sẽ quay lại và goto trang Quest lần nữa
      continue;
    }
  }
}

// Đăng nhập TaskOn bằng email mail.tm, lấy mã xác minh thẳng từ API
// mail.tm. TUẦN TỰ từng bước -- mỗi bước ĐỢI ĐÚNG element của bước đó
// xuất hiện rồi mới click/điền, xong mới qua bước kế tiếp. KHÔNG dùng
// vòng lặp "kiểm tra lại từ đầu mỗi vòng" nữa -- đó là nguyên nhân bị
// dính mãi ở bước "Login" (selector đó vẫn khớp liên tục nên không bao
// giờ rơi được xuống bước "Email").
//
// Cột Excel: N = alias mail.tm, O = mật khẩu mail.tm, P = domain mail.tm
async function loginTaskOnLoop(page, log, require, input) {
  const { getMailTmToken, waitForVerificationCode } = require('./mailtm');

  const row = input ? JSON.parse(input) : {};
  const alias = row.N;
  const mailPassword = row.O;
  const domain = row.P;
  const email = alias && domain ? `${alias}@${domain}` : null;

  if (!email || !mailPassword) {
    throw new Error('Thiếu alias/mật khẩu/domain mail.tm (kiểm tra cột N/O/P trong Excel)');
  }

  async function debugShot(label) {
    const shotPath = `data/login-task-debug-${Date.now()}.png`;
    await page.screenshot({ path: shotPath }).catch(() => {});
    log(`[${label}] URL: ${page.url()} | Title: ${await page.title().catch(() => '?')}`);
    log(`[${label}] Screenshot: ${shotPath}`);
  }

  const connectedUser = page.locator('.connected-user');
  const loginTextBtn = page.locator('xpath=//*[text()="Login"]');
  const emailOption = page.locator('xpath=//*[text()="Email"]');
  const emailInput = page.locator('xpath=//input[@placeholder="Please enter Email Address"]');
  const sendCodeBtn = page.locator('xpath=//*[@aria-label="Send Verification Code"]');
  const codeInput = page.locator('xpath=//*[@placeholder="Please enter Verification code"]');

  // TaskOn hay hiện 1 overlay dạng toast tự động (class "auto-dialog",
  // ví dụ báo "đã gửi mã") ngay SAU 1 hành động -- overlay này che mất
  // nút bên dưới, khiến click bị chặn ("intercepts pointer events") tới
  // khi hết 30s mới báo lỗi. Đợi nó tự ẩn đi trước khi click bất cứ gì.
  async function waitOverlayGone() {
    await page.locator('.auto-dialog').first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  try {
    // Đã đăng nhập sẵn -- bỏ qua toàn bộ luồng
    if (await connectedUser.count() > 0) {
      log('Đã đăng nhập TaskOn sẵn (thấy connected-user).');
      return true;
    }

    // Bước 1: đợi + click "Login"
    await loginTextBtn.first().waitFor({ state: 'visible', timeout: 20000 }).catch(async () => {
      await debugShot('step1-login-not-found');
      throw new Error('Không tìm thấy nút "Login" sau 20s');
    });
    await waitOverlayGone();
    await loginTextBtn.first().click();
    log('Đã click "Login".');
    await page.waitForTimeout(2000 + Math.random() * 1000);

    // Bước 2: đợi + click "Email"
    await emailOption.first().waitFor({ state: 'visible', timeout: 20000 }).catch(async () => {
      await debugShot('step2-email-option-not-found');
      throw new Error('Không tìm thấy tùy chọn "Email" sau 20s');
    });
    await waitOverlayGone();
    await emailOption.first().click();
    log('Đã chọn "Email".');
    await page.waitForTimeout(2000 + Math.random() * 1000);

    // Bước 3: đợi ô email + điền
    await emailInput.first().waitFor({ state: 'visible', timeout: 20000 }).catch(async () => {
      await debugShot('step3-email-input-not-found');
      throw new Error('Không tìm thấy ô nhập email sau 20s');
    });
    await emailInput.first().fill(email);
    log(`Đã điền email: ${email}`);
    await page.waitForTimeout(5000); // đúng yêu cầu: đợi 5s sau khi điền email rồi mới bấm gửi mã

    // Bước 4: đợi + click "Send Verification Code"
    await sendCodeBtn.first().waitFor({ state: 'visible', timeout: 20000 }).catch(async () => {
      await debugShot('step4-send-code-btn-not-found');
      throw new Error('Không tìm thấy nút "Send Verification Code" sau 20s');
    });
    await waitOverlayGone();
    await sendCodeBtn.first().click();
    log('Đã click "Send Verification Code".');
    await page.waitForTimeout(2000 + Math.random() * 1000);

    // Bước 5: đợi ô mã, lấy mã từ mail.tm, điền vào
    await codeInput.first().waitFor({ state: 'visible', timeout: 20000 }).catch(async () => {
      await debugShot('step5-code-input-not-found');
      throw new Error('Không tìm thấy ô nhập mã xác minh sau 20s');
    });
    log('Đang lấy mail.tm token để đọc mã xác minh...');
    const mailToken = await getMailTmToken(page, email, mailPassword);
    log('Đang đợi mã xác minh trong hộp thư mail.tm...');
    const code = await waitForVerificationCode(page, mailToken, { timeoutMs: 90000, pollMs: 4000 });
    log(`Đã lấy được mã: ${code}`);
    await codeInput.first().fill(code);
    await page.waitForTimeout(2000 + Math.random() * 1000);

    // Bước 6: xác nhận -- bỏ hẳn việc tìm/click nút "Login" (đã thử
    // click thường, force-click, đợi enabled... vẫn không ổn định). Cứ
    // đợi 3s rồi Tab (chuyển focus từ ô mã sang nút kế tiếp) rồi Enter
    // (kích hoạt) -- đơn giản và chắc ăn hơn hẳn.
    await page.waitForTimeout(3000);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    log('Đã đợi 3s, Tab, Enter để xác nhận.');

    // Bước 7: đợi xác nhận đã đăng nhập
    await connectedUser.first().waitFor({ state: 'visible', timeout: 30000 }).catch(async () => {
      await debugShot('step7-not-connected');
      throw new Error('Không xác nhận được đã đăng nhập (không thấy connected-user) sau 30s');
    });
    log('Đã đăng nhập TaskOn thành công (thấy connected-user).');
    return true;
  } catch (err) {
    // Không chụp thêm ảnh generic ở đây -- mỗi bước ở trên đã tự chụp
    // đúng label của bước đó lúc lỗi rồi, chụp thêm ở đây chỉ dư thừa
    // (ra 2 ảnh gần như giống hệt nhau cho cùng 1 lỗi).
    throw err;
  }
}

// Vào https://taskon.xyz/profile, đảm bảo tài khoản X đang liên kết
// đúng là username X mong muốn -- chưa link thì link mới, link sai tài
// khoản thì gỡ ra rồi link lại, đã đúng rồi thì dừng ngay.
//
// QUAN TRỌNG: chỉ có 1 DUY NHẤT 1 element trạng thái (linkStateLabel,
// tìm qua icon X cố định) -- text của nó đổi qua đổi lại giữa CHÍNH
// XÁC "Link X(Twitter) Account" (chưa link) và username thật (đã
// link). //*[text()="Username"] là 1 element HOÀN TOÀN KHÁC, chỉ để
// biết trang đã load xong, không liên quan gì tới trạng thái link.
//
// Vòng lặp tổng, mỗi vòng đọc lại text hiện tại của linkStateLabel:
//   - Đúng bằng "Link X(Twitter) Account" -- CHƯA link -- click nó, đợi
//     OAuth consent, click, đợi ~10s, rồi đợi linkStateLabel đổi text
//     (khác với "Link X(Twitter) Account") -- quay lại đầu vòng lặp.
//   - Khác "Link X(Twitter) Account" -- ĐÃ link -- so khớp (trim +
//     lowercase) với username X (cột D):
//       - Khớp -- DỪNG (break), xong việc.
//       - Không khớp -- hover vào linkStateLabel để lộ nút unlink, click
//         unlink -> xác nhận dialog -> đợi linkStateLabel đổi text
//         (quay lại thành "Link X(Twitter) Account") -- quay lại vòng
//         lặp, lần sau sẽ vào nhánh link-mới ở trên.
//
// Cột Excel: D = username X (giống hệt loginX.js dùng để so khớp)
async function linkXAccountOnTaskOn(page, log, input) {
  const row = input ? JSON.parse(input) : {};
  const expected = String(row.D || '').trim().toLowerCase();
  if (!expected) {
    throw new Error('Thiếu username X để so khớp (kiểm tra cột D trong Excel)');
  }

  async function debugShot(label) {
    const shotPath = `data/link-x-debug-${Date.now()}.png`;
    await page.screenshot({ path: shotPath }).catch(() => {});
    log(`[${label}] URL: ${page.url()} | Title: ${await page.title().catch(() => '?')}`);
    log(`[${label}] Screenshot: ${shotPath}`);
  }

  await page.goto('https://taskon.xyz/profile', { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Tín hiệu "trang đã load xong" -- KHÔNG liên quan tới trạng thái
  // link X, chỉ để biết yên tâm đọc tiếp.
  const loadedSignal = page.locator('xpath=//*[text()="Username"]');
  await loadedSignal.first().waitFor({ state: 'visible', timeout: 30000 }).catch(async () => {
    await debugShot('link-x-page-not-loaded');
    throw new Error('Trang chưa load xong (không thấy tín hiệu "Username") sau 30s');
  });
  log('Trang đã load xong.');

  const oauthConsentBtn = page.locator('[data-testid="OAuth_Consent_Button"]');
  const unlinkIcon = page.locator('xpath=(//*[@class="unlink-button__icon tw-inline"])[1]');
  const confirmSecondBtn = page.locator('xpath=(//*[@class="confirm-notice__buttons"]//button)[2]');

  // Icon X/Twitter cố định (base64) dùng làm mốc để tìm ĐÚNG label khu
  // vực link X -- label này chính là nguồn DUY NHẤT để biết trạng thái.
  const X_ICON_SRC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACIAAAAiCAYAAAA6RwvCAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAH3SURBVHgBzZeNkYIwEIXjVYAdcB1QAtcBVqBWcFoBdgBWgB1YAtcBJUAHlrCXxxEnEzaQIMi9mR0zIT+fSd4GhDBERLGMTEZN86uSUcgIhU3yYdABvEuYK+AgKnq/KgXz0bGkMiLxfkXd3GJDf/tVi3X1hRVJzdrz+Sw2mw0b2+1WNE0jXHU8Htt+u91uqFkiiDkbj8eDoigi2YCCIKAwDNtAGXVxHDsdgMvl0rZHX4w5oFrYnlRV9ZwYZQWIQVGX5zkNCc8VRF3XNCYx9DDLst4/0gHLsmT7oV6tpgvEKAiEbcCgp9NpEFAJEyvQ+/1OrhoFsQ3MAaKt2ro0TclHoyAQAMylNgH18+ML4QwC4Z+bjtEBkyRpy/idImcQm2MUoKNNXweBdDdwlkbemCovEEg5BglPt7QJuDgI5GvpxUDUFplJjQNcDEQ/E+YK6Ja2Zd3ZQHSb7vf7nmWLopi0RV4g5m1qszQHOBuIDqFfZNwF53NLe4FwKV6XSmqw9BDgSyCut6l6kdIdwwFOAvG5TW2O4QC9QKbcplxSc7W0FWTqbaqSGveuO2RpgNRmpcdLb09orybm4nA4cN0qfNfkssG3WFc3gMSyUIp19fkhP35+ZOEq1tNVMjRtif7BR/hTHYxbPp5HeQ/CAApl3GiZFao7gNic9xdG16HkLDPmwQAAAABJRU5ErkJggg==';
  const linkStateLabel = page.locator(`xpath=//*[@src="${X_ICON_SRC}"]/..//*[@class="label"]`);

  // Poll cho tới khi text của linkStateLabel THAY ĐỔI (khác với
  // oldText) -- dùng cả cho "đợi đổi từ Link... sang username thật" LẪN
  // "đợi đổi từ username sai quay lại Link...". Trả về text mới nếu có,
  // null nếu hết thời gian mà vẫn y hệt oldText.
  async function waitLabelChangedFrom(oldText, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const text = await linkStateLabel.first().textContent().catch(() => '');
      const trimmed = String(text || '').trim();
      if (trimmed && trimmed !== oldText) return trimmed;
      await page.waitForTimeout(300);
    }
    return null;
  }

  const LINK_TEXT = 'Link X(Twitter) Account';
  const maxIterations = 10; // an toàn -- tránh lặp vô hạn nếu có gì đó luôn sai
  let iterations = 0;

  try {
    while (true) {
      iterations++;
      if (iterations > maxIterations) {
        await debugShot('link-x-too-many-iterations');
        throw new Error(`Lặp lại quá ${maxIterations} lần vẫn chưa khớp/link được -- dừng lại, xem screenshot`);
      }

      await linkStateLabel.first().waitFor({ state: 'visible', timeout: 20000 }).catch(async () => {
        await debugShot('link-x-state-label-not-found');
        throw new Error('Không tìm thấy label trạng thái link X (qua icon X cố định) sau 20s');
      });
      const labelText = String((await linkStateLabel.first().textContent().catch(() => '')) || '').trim();

      if (labelText === LINK_TEXT) {
        // Chưa link -- bắt đầu luồng link mới
        await linkStateLabel.first().click();
        log('Đã click "Link X(Twitter) Account".');

        await oauthConsentBtn.waitFor({ state: 'visible', timeout: 30000 }).catch(async () => {
          await debugShot('link-x-oauth-consent-not-found');
          throw new Error('Không thấy OAuth Consent Button sau 30s');
        });
        await oauthConsentBtn.click();
        log('Đã click OAuth Consent Button.');

        await page.waitForTimeout(10000); // đúng yêu cầu: đợi khoảng 10s sau khi authorize

        const updated = await waitLabelChangedFrom(LINK_TEXT, 30000);
        if (!updated) {
          await debugShot('link-x-label-not-updated-after-link');
          throw new Error('Label không cập nhật sang username sau khi link, sau 30s');
        }
        log(`Label đã cập nhật sang "${updated}" -- quay lại kiểm tra.`);
        continue;
      }

      // Label hiện đang là username thật -- so khớp
      const current = labelText.toLowerCase();
      log(`Username hiện đang link trên TaskOn: "${current}" -- cần khớp: "${expected}"`);

      if (current === expected) {
        log('Đã khớp đúng username X -- dừng lại, không cần làm gì thêm.');
        break;
      }

      log('Chưa khớp -- gỡ link cũ để link lại.');
      // Hover vào ĐÚNG linkStateLabel (không phải element đoán mò nữa)
      // để lộ nút unlink.
      await linkStateLabel.first().hover().catch(() => {});
      await page.waitForTimeout(300);
      await unlinkIcon.first().waitFor({ state: 'visible', timeout: 10000 }).catch(async () => {
        await debugShot('link-x-unlink-icon-not-found');
        throw new Error('Không tìm thấy nút gỡ link (unlink icon) sau 10s');
      });
      await unlinkIcon.first().click();
      log('Đã click nút gỡ link (unlink).');

      await confirmSecondBtn.waitFor({ state: 'visible', timeout: 10000 }).catch(async () => {
        await debugShot('link-x-confirm-unlink-not-found');
        throw new Error('Không thấy nút xác nhận gỡ link sau 10s');
      });
      await confirmSecondBtn.click();
      log('Đã xác nhận gỡ link.');

      const reverted = await waitLabelChangedFrom(labelText, 15000);
      if (!reverted) {
        await debugShot('link-x-label-not-reverted-after-unlink');
        throw new Error('Label không đổi lại sau khi gỡ link, sau 15s');
      }
      log(`Label đã đổi lại thành "${reverted}" -- quay lại vòng lặp để link tài khoản đúng.`);
    }
  } catch (err) {
    await debugShot('error');
    throw err;
  }
}

// -------------------------------------------------------------------
// Điểm vào (export) -- nơi khác require('./Logintaskon') rồi gọi hàm
// này. KHÔNG để "await waitForRewardMode(page); ..." chạy trần ở top-
// level nữa (đó chính là nguyên nhân lỗi "require() cannot be used on
// an ESM graph with top-level await" -- Node cấm require() 1 file có
// await nằm NGOÀI mọi hàm). Toàn bộ 3 bước giờ nằm gọn trong hàm này,
// y hệt cách loginTask.js (bản cũ) đã tự vá -- chỉ khác là ở ĐÂY còn
// giữ nguyên phần logic link/unlink đầy đủ hơn.
// -------------------------------------------------------------------
async function runLoginTask(page, context, log, require, input) {
  const found = await waitForRewardMode(page);
  log(
    found
      ? 'Đã vào reward mode'
      : 'Không thấy reward mode'
  );

  await loginTaskOnLoop(page, log, require, input);
  await linkXAccountOnTaskOn(page, log, input);
}

module.exports = { runLoginTask };