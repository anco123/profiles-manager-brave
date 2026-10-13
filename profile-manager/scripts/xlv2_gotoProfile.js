// js
/**
 * Điều hướng tới trang profile của @username trên X (Twitter).
 *
 * Trả về: { suspended: boolean, notFound: boolean }
 * Ném lỗi nếu sau `MAX_ITERATIONS` lần vẫn không xác nhận được đã tới đúng trang.
 *
 * deps cần có: { typeVisibly, clickVisibly, moveMouseVisibly, ambientMouseMove }
 * deps.momentumScroll: tùy chọn -- nếu có (ví dụ export từ interactXHome.js
 * trong cùng dự án), dùng để cuộn dropdown/kết quả có sẵn trong DOM "có
 * quán tính" giống các script khác thay vì 1 cú wheel() thô; không có
 * thì tự rơi về wheel() như cũ.
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
  // Có thể có NHIỀU phần tử cùng khớp selectors.mentionText (ví dụ
  // @TherosHQ xuất hiện ở nhiều chỗ trong DOM cùng lúc) -- chọn giống
  // người thật: ưu tiên link ĐANG HIỆN trên màn hình (random 1 trong số
  // đó), không có thì lấy link GẦN màn hình nhất rồi lướt tới. Bỏ qua
  // link có kích thước 0 (ẩn, nằm trong hover card đã đóng...).
  const existingTargets = page.locator(selectors.mentionText);
  const candidates = await pickOnScreenFirst(page, existingTargets);
  const existingCount = candidates.length;

  // 12%: dù đã thấy sẵn link trên trang vẫn CHỦ ĐỘNG bỏ qua, đi qua
  // luồng search bình thường ở bước 3 -- 88% còn lại click thẳng vào
  // link có sẵn (người thật thấy tên trên màn hình thì bấm luôn).
  const SKIP_EXISTING_TARGET_CHANCE = 0.12;
  const skipExistingTarget = existingCount > 0 && Math.random() < SKIP_EXISTING_TARGET_CHANCE;
  if (skipExistingTarget) {
    log(
      `[gotoProfile] Có ${existingCount} kết quả @${username} sẵn trong DOM nhưng ` +
      `random rơi vào nhánh search (tỷ lệ nhỏ) -- bỏ qua, search như bình thường.`
    );
  }

  const hasExistingTarget = existingCount > 0 && !skipExistingTarget;
  const pickedIndex = hasExistingTarget ? candidates[Math.floor(Math.random() * existingCount)] : -1;
  const existingTarget = hasExistingTarget ? existingTargets.nth(pickedIndex) : null;

  if (hasExistingTarget) {
    log(
      `[gotoProfile] Đã có sẵn ${existingCount} kết quả @${username} trong DOM -- ` +
      `click phần tử #${pickedIndex + 1} (ưu tiên cái đang hiện trên màn hình).`
    );

    // Dùng đúng clickElementOnScreen mà code gốc định gọi (file thật, không
    // phải hàm ma). Hàm này chỉ scroll + click thẳng theo toạ độ, không có
    // các bước actionability/disabled-check như clickVisibly, và không tự
    // bọc lỗi cho scrollIntoViewIfNeeded()/mouse.click() -- bọc try/catch ở
    // đây để 1 lỗi bất ngờ (element detach giữa chừng, trang điều hướng đúng
    // lúc click...) chỉ khiến rơi xuống nhánh search bình thường, không làm
    // crash toàn bộ gotoProfile.
    // selectors.mentionText tìm trên TOÀN BỘ DOM đã tải về, không chỉ
    // phần đang hiện trong viewport -- nhưng click thì bắt buộc phần tử
    // phải NẰM TRONG viewport hiện tại. Nếu phần tử vừa chọn rơi ra
    // ngoài (phía trên/dưới màn hình), lướt tới trước khi click.
    await require('./xlv1_scrollToElement').scrollToElement(page, log, deps, existingTarget, `link @${username}`);

    let clicked = false;
    try {
      clicked = await clickElementOnScreen(page, log, deps, existingTarget);
      if (!clicked) {
        throw new Error('clickElementOnScreen không click được element.');
      }
      // Dừng xem trang 4-8s như nhánh search (bấm vào kết quả xong cũng humanPause 4000, 4000) -- không rút ngắn thời gian nhìn profile.
      // Sau đó chờ thêm tối đa 4 giây để detectProfileState xác nhận trạng thái; hết 4 giây vẫn chưa xác nhận được thì throw -> catch -> search.
      await humanPause(page, 4000, 4000);
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

/** Chờ tối đa timeoutMs tới khi detectProfileState xác nhận đã tới đúng trang @username (xác nhận sớm thì trả về ngay) -- quá hạn thì throw. */
async function waitForProfileState(page, selectors, username, timeoutMs) {
  const end = Date.now() + timeoutMs;
  do {
    const state = await detectProfileState(page, selectors, username);
    if (state.confirmed) return state;
    await page.waitForTimeout(300);
  } while (Date.now() < end);
  throw new Error(`chưa xác nhận được trang @${username} sau ${timeoutMs}ms`);
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

/**
 * Trả về chỉ số (trong locator) các phần tử nên chọn để click: những cái
 * ĐANG nằm trong màn hình; không có cái nào thì trả về đúng 1 cái gần
 * giữa màn hình nhất. Phần tử kích thước 0 (ẩn) bị loại hẳn.
 */
async function pickOnScreenFirst(page, locator) {
  const rects = await locator.evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { top: r.top, h: r.height, w: r.width }; })).catch(() => []);
  const vh = (page.viewportSize() || { height: 800 }).height;
  const usable = rects.map((r, i) => ({ ...r, i })).filter((r) => r.h > 0 && r.w > 0);
  const onScreen = usable.filter((r) => r.top >= 0 && r.top + r.h <= vh);
  if (onScreen.length) return onScreen.map((r) => r.i);
  usable.sort((a, b) => Math.abs(a.top - vh / 2) - Math.abs(b.top - vh / 2));
  return usable.slice(0, 1).map((r) => r.i);
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