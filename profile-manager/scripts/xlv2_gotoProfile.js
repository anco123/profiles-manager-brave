// js
/**
 * Điều hướng tới trang profile của @username trên X (Twitter).
 *
 * Trả về: { suspended: boolean, notFound: boolean }
 * Ném lỗi nếu sau `MAX_ITERATIONS` lần vẫn không xác nhận được đã tới đúng trang.
 *
 * deps cần có: { typeVisibly, clickVisibly, moveMouseVisibly, ambientMouseMove }
 * deps.momentumScroll: tùy chọn -- nếu có (ví dụ export từ interactXHome.js
 * trong cùng dự án), dùng để cuộn dropdown "có quán tính" giống các script
 * khác thay vì 1 cú wheel() thô; không có thì tự rơi về wheel() như cũ.
 *
 * Ngoài deps, còn require() trực tiếp module clickElementOnScreen (không đi
 * qua deps) để click phần tử @username đã có sẵn trong DOM ở bước 2.
 */

const MAX_ITERATIONS = 5;
const RESULT_WAIT_TIMEOUT = 15000;
const STATE_CHECK_TIMEOUT = 6000;
const SEARCH_BOX_WAIT_TIMEOUT = 30000; // chờ ô search hiện ra -- tăng từ 15s lên 30s vì trang tải chậm/mạng lag đôi khi khiến 15s không đủ

// Hàm thật của dự án -- KHÔNG đi qua `deps` (giống cách pickSafeClickPoint
// được require() thẳng trong interactXHome.js), vì đây là helper hành động
// cụ thể chứ không phải primitive dùng chung như moveMouseVisibly/clickVisibly.
// Đổi lại path này nếu file thật không nằm cùng thư mục với gotoProfile.js.
const { clickElementOnScreen } = require('./xlv1_clickElementOnScreen');

async function gotoProfile(page, log, deps, username) {
  const { typeVisibly, clickVisibly, moveMouseVisibly, ambientMouseMove, momentumScroll } = deps;
  const selectors = buildSelectors(username);

  // const usernameElement = `xpath=//*`;
  // const getUsernameElement = page.locator(selectors.mentionText).first();

  // ============================================================
  // 1. KIỂM TRA ĐÃ Ở SẴN TRANG PROFILE ĐÍCH CHƯA
  // ============================================================
  // Yêu cầu cả hai: (a) URL đang khớp /username, và (b) có nút Follow/Following
  // trong DOM. Chỉ check (b) như bản gốc rất dễ bị false-positive khi đang đứng
  // trên trang followers/following của MỘT NGƯỜI KHÁC mà @username nằm trong
  // danh sách đó (nút Follow/Following của họ vẫn tồn tại trong DOM).
  if (urlLooksLikeProfile(page, username) && (await hasFollowOrFollowingInDom(page, selectors))) {
    log(`[gotoProfile] Đã ở sẵn trang @${username} -- bỏ qua search.`);
    return { suspended: false, notFound: false };
  }

  // ============================================================
  // 2. CHƯA Ở PROFILE -> KIỂM TRA DOM CÓ LINK/KẾT QUẢ
  //    TRỎ TỚI @username SẴN KHÔNG
  // ============================================================
  const existingTarget = page.locator(selectors.mentionText).first();
  const hasExistingTarget = (await existingTarget.count()) > 0;

  if (hasExistingTarget) {
    log(`[gotoProfile] Đã có sẵn kết quả @${username} trong DOM -- click trực tiếp.`);

    // Dùng đúng clickElementOnScreen mà code gốc định gọi (file thật, không
    // phải hàm ma). Hàm này chỉ scroll + click thẳng theo toạ độ, không có
    // các bước actionability/disabled-check như clickVisibly, và không tự
    // bọc lỗi cho scrollIntoViewIfNeeded()/mouse.click() -- bọc try/catch ở
    // đây để 1 lỗi bất ngờ (element detach giữa chừng, trang điều hướng đúng
    // lúc click...) chỉ khiến rơi xuống nhánh search bình thường, không làm
    // crash toàn bộ gotoProfile.
    let clicked = false;
    try {
      clicked = await clickElementOnScreen(page, log, deps, existingTarget);
      if (!clicked) {
        throw new Error('clickElementOnScreen không click được element.');
      }
      // Chờ tối đa 4 giây để detectProfileState xác nhận trạng thái.
      // Nếu xác nhận được sớm thì return ngay.
      // Nếu hết 4 giây vẫn chưa xác nhận được thì throw -> catch -> search.
      const state = await waitForProfileState(page,selectors,username,4000);
      logConfirmed(log, username, state);
      return {suspended: state.suspended,notFound: state.notFound};

    } catch (err) {
      log(`[gotoProfile] clickElementOnScreen lỗi: ${err.message} -- chuyển sang search.`);
    }

    if (clicked) {
      await humanPause(page, 4000, 4000);

      const state = await detectProfileState(page, selectors, username);
      if (state.confirmed) {
        logConfirmed(log, username, state);
        return { suspended: state.suspended, notFound: state.notFound };
      }

      log(`[gotoProfile] Click @${username} nhưng chưa xác nhận được profile -- chuyển sang search.`);
    } else {
      log(`[gotoProfile] Không click được kết quả có sẵn của @${username} -- chuyển sang search.`);
    }
  }

  // ============================================================
  // 3. KHÔNG CÓ SẴN -> CHẠY QUY TRÌNH SEARCH BÌNH THƯỜNG
  // ============================================================
  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    await ambientMouseMove(page, moveMouseVisibly);
    await retypeSearch(page, deps, selectors.searchBox, username);

    const firstResult = page.locator(selectors.firstResult);
    const gotFirstResult = await firstResult
      .waitFor({ state: 'visible', timeout: RESULT_WAIT_TIMEOUT })
      .then(() => true)
      .catch(() => false);

    if (!gotFirstResult) {
      log(
        `[gotoProfile] Không thấy kết quả gợi ý nào cho @${username} ` +
        `(lần ${iteration}/${MAX_ITERATIONS}) -- search lại.`
      );
      continue;
    }

    await humanPause(page, 3000, 2000);
    await hoverOver(moveMouseVisibly, page, firstResult);

    const exactMatch = page.locator(selectors.exactMatch).first();
    let gotExactMatch = await exactMatch.isVisible({ timeout: STATE_CHECK_TIMEOUT }).catch(() => false);

    if (!gotExactMatch) {
      await scrollDropdownIntoView(page, moveMouseVisibly, momentumScroll, selectors.dropdown);
      await humanPause(page, 3000, 2000);
      gotExactMatch = await exactMatch.isVisible({ timeout: STATE_CHECK_TIMEOUT }).catch(() => false);
    }

    if (gotExactMatch) {
      await safeClick(clickVisibly, page, exactMatch);
    } else {
      log(
        `[gotoProfile] Không tìm được kết quả khớp chính xác @${username} ` +
        `-- chọn kết quả cuối cùng (dự phòng).`
      );
      const lastResult = page.locator(selectors.lastResult);
      await safeClick(clickVisibly, page, lastResult);
    }

    await humanPause(page, 4000, 4000);

    const state = await detectProfileState(page, selectors, username);
    if (state.confirmed) {
      logConfirmed(log, username, state);
      return { suspended: state.suspended, notFound: state.notFound };
    }

    log(
      `[gotoProfile] Search xong nhưng chưa xác nhận đúng trang @${username} ` +
      `(lần ${iteration}/${MAX_ITERATIONS}) -- search lại.`
    );
  }

  throw new Error(
    `[gotoProfile] Đã thử ${MAX_ITERATIONS} lần vẫn chưa tới được trang @${username}.`
  );
}

// ================================================================
// Helpers
// ================================================================

function buildSelectors(username) {
  return {
    searchBox: `xpath=//input[@data-testid="SearchBox_Search_Input"]`,
    following: `xpath=//*[@aria-label="Following @${username}"]`,
    follow: `xpath=//*[@aria-label="Follow @${username}" or @aria-label="Follow back @${username}"]`,
    //followBack: `xpath=//*[@aria-label="Follow back @${username}"]`,
    suspended: `xpath=//*[text()='Account suspended']`,
    // FIX: bản gốc dùng "\\u2019" (2 dấu backslash) trong string JS -> ra literal
    // 6 ký tự \u2019 chứ KHÔNG phải ký tự dấu nháy đơn cong (’, U+2019) thật mà
    // X hiển thị, nên selector cũ KHÔNG BAO GIỜ match được. Dùng contains() để
    // né hẳn vấn đề escape ký tự đặc biệt, chắc ăn hơn escape lại cho đúng.
    notFound: `xpath=//*[contains(text(),"doesn") and contains(text(),"t exist")]`,
    // FIX: bản trước match BẤT KỲ phần tử nào có text node đúng "@username",
    // kể cả những chỗ KHÔNG PHẢI link dẫn tới profile -- ví dụ 1 mention
    // nằm trong nội dung tweet/reply/thông báo (chỉ là text tô màu, không
    // phải thẻ <a>), hoặc trường hợp X tách "@" và "username" ra 2 <span>
    // riêng để style khiến text() còn không match được luôn. .first() nhặt
    // đại phần tử đầu tiên khớp trong DOM -- nếu đó không phải link, click
    // "thành công" nhưng không có navigation nào xảy ra, rồi rơi xuống
    // search dù rõ ràng "đã thấy username trên màn hình". Giờ nhắm thẳng
    // vào <a href="/username"> -- chỉ khớp phần tử THỰC SỰ dẫn tới đúng
    // trang profile, bất kể text bên trong nó được chia nhỏ ra sao.
    mentionText: `xpath=//a[@href="/${username}" or @href="/${username}/"]`,
    firstResult: `xpath=(//*[@data-testid="typeaheadResult"])[1]`,
    lastResult: `xpath=(//*[@data-testid="typeaheadResult"])[last()]`,
    exactMatch: `xpath=//*[@data-testid="TypeaheadUser"][.//*[text()="@${username}"]]`,
    // FIX: id "typeaheadDropdown-2" cứng có thể đổi hậu tố tùy session
    // (-1, -2, ...). Dùng starts-with để không phụ thuộc số cụ thể.
    dropdown: `xpath=//*[starts-with(@id,"typeaheadDropdown")]`,
  };
}

/** Kiểm tra URL hiện tại có khớp /username không (chống false-positive ở bước 1). */
function urlLooksLikeProfile(page, username) {
  try {
    const path = new URL(page.url()).pathname.toLowerCase();
    const target = `/${username.toLowerCase()}`;
    return path === target || path.startsWith(`${target}/`);
  } catch {
    return false;
  }
}

/** Check tồn tại trong DOM (không cần visible) nút Follow/Following của username. */
async function hasFollowOrFollowingInDom(page, selectors) {
  if ((await page.locator(selectors.following).count()) > 0) return true;
  return (await page.locator(selectors.follow).count()) > 0;
}

/**
 * Xác nhận trạng thái trang hiện tại: following / not-following / suspended / not-found.
 * `confirmed: true` nghĩa là đã tới đúng trang profile đích (dù ở dạng nào).
 * Gộp lại thành 1 helper để không phải lặp code này 2 lần như bản gốc.
 */
async function detectProfileState(page, selectors, username) {
  if (!urlLooksLikeProfile(page, username)) {
    return { confirmed: false, suspended: false, notFound: false };
  }

  if (await isVisible(page, selectors.following)) {
    return { confirmed: true, suspended: false, notFound: false, following: true };
  }
  if (await isVisible(page, selectors.follow)) {
    return { confirmed: true, suspended: false, notFound: false, following: false };
  }
  if (await isVisible(page, selectors.suspended)) {
    return { confirmed: true, suspended: true, notFound: false };
  }
  if (await isVisible(page, selectors.notFound)) {
    return { confirmed: true, suspended: false, notFound: true };
  }
  return { confirmed: false, suspended: false, notFound: false };
}

function isVisible(page, selector, timeout = STATE_CHECK_TIMEOUT) {
  return page.locator(selector).first().isVisible({ timeout }).catch(() => false);
}

function logConfirmed(log, username, state) {
  const note = state.suspended
    ? ' -- tài khoản này đang bị suspend'
    : state.notFound
      ? ' -- tài khoản này không tồn tại'
      : '';
  log(`[gotoProfile] Đã tới đúng trang @${username}${note}.`);
}

/** Click an toàn: trả về true/false thay vì throw, vì element có thể detach/không click được. */
function safeClick(clickVisibly, page, locator) {
  return clickVisibly(page, locator).then(() => true).catch(() => false);
}

async function hoverOver(moveMouseVisibly, page, locator) {
  const box = await locator.boundingBox().catch(() => null);
  if (!box) return;
  await moveMouseVisibly(page, box.x + box.width / 2, box.y + box.height / 2);
}

async function scrollDropdownIntoView(page, moveMouseVisibly, momentumScroll, dropdownSelector) {
  const box = await page.locator(dropdownSelector).first().boundingBox().catch(() => null);
  if (box) {
    await moveMouseVisibly(page, box.x + box.width / 2, box.y + box.height / 2);
  }

  const delta = 250 + Math.random() * 150;
  // Đồng bộ với cách cuộn "có quán tính" (nhiều tick giảm dần) mà các
  // script khác trong dự án dùng (vd interactXHome.js), thay vì 1 cú
  // wheel() delta lớn duy nhất -- nếu deps không có momentumScroll (script
  // này chạy độc lập, không cùng deps với interactXHome.js) thì rơi về
  // wheel() thô như cũ, không throw.
  if (typeof momentumScroll === 'function') {
    await momentumScroll(page, delta);
  } else {
    await page.mouse.wheel(0, delta);
  }
}

async function retypeSearch(page, deps, searchBoxSelector, username) {
  const { typeVisibly, clickVisibly } = deps;
  const searchBox = page.locator(searchBoxSelector);

  const existingValue = await searchBox.inputValue().catch(() => '');
  if (existingValue) {
    await clickVisibly(page, searchBox);
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
  }

  await typeVisibly(page, searchBox, username, 70, SEARCH_BOX_WAIT_TIMEOUT);
}

function humanPause(page, baseMs, jitterMs) {
  return page.waitForTimeout(baseMs + Math.random() * jitterMs);
}

module.exports = { gotoProfile };