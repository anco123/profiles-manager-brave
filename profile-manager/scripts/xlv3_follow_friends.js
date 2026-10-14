/**
 * scripts/xlv3_follow_friends.js
 * -----------------------------------------------------------------------
 * ⭐ ĐÂY LÀ BẢN XỊN NHẤT cho việc "follow 1 tài khoản" -- xlv3_follow_someone.js
 * là bản cũ đã ngưng dùng (còn username hard-code, không xử lý
 * suspended), không cần đụng tới nữa. ⭐
 *
 * Follow 1 username CỤ THỂ (nhận thẳng qua tham số) -- KHÔNG còn tự
 * tính "dòng lùi Y" hay tự đọc Excel bên trong file này nữa. Việc
 * "username này lấy từ đâu" (dòng lùi Y, đọc cột nào...) giờ là việc
 * của NƠI GỌI (VD: interactX.js, dùng readExcelCell.js để tự tính rồi
 * truyền username + targetExcelRow đã tính sẵn vào đây).
 *
 * KHÔNG check suspend riêng bằng getXStatus() (cửa sổ ẩn danh) nữa --
 * goto THẲNG tới trang profile rồi đợi 1 trong 3 trạng thái ngay trên
 * chính trang đó: Follow / Following / Account suspended. Đằng nào
 * cũng phải goto tới đây để follow, tách riêng 1 lần check trước chỉ
 * tốn thêm 1 lượt mở browser ẩn danh mà không cần thiết cho trường hợp
 * này -- khác với việc check trạng thái CHÍNH profile đang chạy trong
 * main.js, nơi kết quả sai gây thiệt hại lớn hơn nhiều (đăng nhập/
 * tương tác nhầm trên acc đã suspend); ở đây sai nhiều nhất chỉ là bỏ
 * lỡ/follow nhầm 1 người, không hỏng gì cả.
 *
 * Luồng:
 *   1) goto trang profile của targetUsername.
 *   2) Suspended -> KHÔNG follow, ghi "Suspended" vào cột M của ĐÚNG
 *      dòng Excel của targetUsername (targetExcelRow -- KHÔNG PHẢI
 *      dòng của account đang chạy, xem writeExcelCell.js) rồi dừng.
 *      Following -> đã follow rồi, không làm gì thêm, dừng.
 *      Follow -> bấm follow, đợi chuyển sang Following.
 *
//  * Usage:
//  *   const { runFollowFriends } = require('./xlv3_follow_friends');
//  *   await runFollowFriends(page, log, deps, targetUsername, targetExcelRow);
//  * -----------------------------------------------------------------------
 */

async function xlv3_follow_friends(page, log, deps, targetUsername) {
  const { clickVisibly, moveMouseVisibly, ambientMouseMove, momentumScroll } = deps;
  const { gotoProfile } = require('./xlv2_gotoProfile');
  const { writeExcelCell } = require('./writeExcelCell');
  //const { clickElementOnScreen } = require('./xlv1_clickElementOnScreen');
  const { humanPause } = require('./helpers');

  
  if (!targetUsername) {
    throw new Error('[xlv3_follow_friends] Thiếu targetUsername -- nơi gọi phải tự me rồi truyền vào.');
  }
  log(`[xlv3_follow_friends] Username đích: @${targetUsername}`);

  // gotoProfile() giờ tự nhận diện luôn cả suspended VÀ notFound (2
  // trong 4 trạng thái hợp lệ để coi là "đã tới nơi") -- không cần tự
  // dò lại ở đây nữa, dùng thẳng kết quả nó trả về.
  const { suspended, notFound } = await gotoProfile(page, log, deps, targetUsername);

  if (suspended || notFound) {
    const reason = suspended ? 'đang bị suspend' : 'không tồn tại (đã xoá/đổi tên)';
    const cellValue = suspended ? 'Suspended' : 'Not_Found';
    log(`[xlv3_follow_friends] @${targetUsername} ${reason} -- bỏ qua, không follow.`);
    return;
  }

  // Vừa tới trang profile -- lướt sơ qua 1 chút trước khi bấm Follow,
  // giống người thật ghé 1 trang mới sẽ xem qua trước, không bấm follow
  // ngay tức khắc lúc trang vừa tải xong.
  await browseProfileBriefly(page, { moveMouseVisibly, ambientMouseMove, momentumScroll });

  const followingSelector = `xpath=//*[@aria-label="Following @${targetUsername}"]`;
  const followSelector = `xpath=//*[@aria-label="Follow @${targetUsername}" or @aria-label="Follow back @${targetUsername}"]`;
  const maxFollowAttempts = 4; // khoảng 3-5 lần bấm Follow -- không phải cứ chưa chuyển "Following" thì click mãi
  let followAttempt = 0;

  while (true) {
    const followingBtn = page.locator(followingSelector).first();
    const followBtn = page.locator(followSelector).first();

    const alreadyFollowing = await followingBtn.isVisible({ timeout: 8000 }).catch(() => false);
    if (alreadyFollowing) {
      log(`[xlv3_follow_friends] Đã follow @${targetUsername} -- dừng.`);
      break;
    }

    followAttempt++;
    if (followAttempt > maxFollowAttempts) {
      throw new Error(`[xlv3_follow_friends] Đã thử ${maxFollowAttempts} lần vẫn chưa thấy chuyển sang "Following @${targetUsername}".`);
    }
    await page.waitForTimeout(3000 + Math.random() * 4000);
    const canFollow = await followBtn.isVisible({ timeout: 6000 }).catch(() => false);
    if (canFollow) {
      await followBtn.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(300 + Math.random() * 400); // 1 nhịp sau khi cuộn, trước khi thao tác
      await ambientMouseMove(page, moveMouseVisibly);
      const clicked = await clickVisibly(page, followBtn);
      await humanPause(page, 1000, 2000);
      

      if (!clicked) {
        log(`[xlv3_follow_friends] Không click được Follow @${targetUsername}.`);
      } else {
        log(`[xlv3_follow_friends] Đã bấm Follow @${targetUsername} (lần ${followAttempt}/${maxFollowAttempts}), chờ xác nhận...`);
      }
    }
    // if (canFollow) {
    //   await clickElementOnScreen(page, log, deps, followBtn, 25)
    //   await ambientMouseMove(page, moveMouseVisibly);
    //   await clickVisibly(page, followBtn);
      
    //   log(`[xlv3_follow_friends] Đã bấm Follow @${targetUsername} (lần ${followAttempt}/${maxFollowAttempts}), chờ xác nhận...`);
    // } else {
    //   log(`[xlv3_follow_friends] Chưa thấy Follow/Following cho @${targetUsername} (lần ${followAttempt}/${maxFollowAttempts}) -- chờ rồi kiểm tra lại.`);
    // }

    await page.waitForTimeout(3000 + Math.random() * 2000);
  }

  log('[xlv3_follow_friends] Kết thúc.');
}

/**
 * Lướt nhẹ trên trang profile vừa tới (1-3 lượt cuộn ngắn, có di chuột và
 * nghỉ giữa mỗi lượt) trước khi bấm Follow -- tránh việc tới trang là bấm
 * Follow ngay trông quá máy móc. Dùng momentumScroll (cuộn có quán tính,
 * giống các script khác trong dự án như xlv3_interactXHome.js) nếu deps
 * có, không có thì rơi về page.mouse.wheel() thô như cách gotoProfile đã
 * làm, không throw.
 */
async function browseProfileBriefly(page, { moveMouseVisibly, ambientMouseMove, momentumScroll }) {
  const scrollTicks = 1 + Math.floor(Math.random() * 3); // 1-3 lượt
  for (let i = 0; i < scrollTicks; i++) {
    await ambientMouseMove(page, moveMouseVisibly);
    const delta = 150 + Math.random() * 350; // cuộn nhẹ, không cuộn sâu xuống hẳn cuối trang
    if (typeof momentumScroll === 'function') {
      await momentumScroll(page, delta);
    } else {
      await require('./xlv1_humanInput').humanWheel(page, delta);
    }
    await page.waitForTimeout(500 + Math.random() * 900);
  }
}

module.exports = { xlv3_follow_friends };