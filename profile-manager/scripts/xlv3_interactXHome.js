/**
 * scripts/interactXHome.js
 * -----------------------------------------------------------------------
 * X.com-SPECIFIC behavior for browsing Home.
 *
 *   - Tổng thời lượng phiên: random 20s-60s MỖI LẦN CHẠY, không cố định.
 *   - Hành vi NỀN: đọc + cuộn -- chủ yếu cuộn xuống, thỉnh thoảng cuộn
 *     lên, thỉnh thoảng dừng hẳn 5-10s để "đọc", thỉnh thoảng mở 1 bài
 *     ra đọc kỹ rồi quay lại, thỉnh thoảng like ĐÚNG bài đang đọc,
 *     thỉnh thoảng xem ảnh/video hoặc 1 bài báo được đăng lại nếu bài
 *     đang đọc có kèm theo.
 *   - "Chuyến đi" (rời Home qua tab khác rồi quay lại): Notifications,
 *     Explore, Messages, Profile, Bookmarks. MỖI PHIÊN chọn ngẫu nhiên 1
 *     TẬP CON các chuyến đi này VÀ xáo thứ tự ngẫu nhiên.
 *   - MỌI chỉ số (thời lượng, số lần, có làm hay không...) đều random
 *     mỗi lần gọi, kể cả trong CÙNG 1 loại hành vi.
 *
 * ---------------------------- NÂNG CẤP v3 -------------------------------
 * (tiếp theo v2 -- tâm trạng phiên, phân phối lệch số chuyến đi, các
 * nhịp lơ đãng/skim burst/reread/hover). Bản này thêm:
 *
 *   GIỐNG NGƯỜI THẬT HƠN:
 *   1. Momentum scroll: mọi lượt cuộn "chính" (nền + trong chuyến đi)
 *      giờ chia thành 3-5 tick nhỏ giảm dần thay vì 1 cú wheel() delta
 *      lớn duy nhất -- giống cảm giác cuộn chuột/trackpad có quán tính.
 *   2. Chọn loại chuyến đi có TRỌNG SỐ khác nhau (xem
 *      CONFIG.excursionTypeWeights) thay vì mọi loại xác suất bằng
 *      nhau -- Notifications/Explore đời thực được ghé nhiều hơn hẳn
 *      Messages/Bookmarks.
 *   3. Chuyến đi có thể bị "bỏ dở giữa chừng" (mood.abandonChance) --
 *      đang xem mà chán, cắt ngắn số vòng cuộn/số lần bấm đã định.
 *   4. Thỉnh thoảng ghé tab "Following" trên chính Home rồi quay lại
 *      "For you" -- thêm 1 trục biến thể mới (visitFollowingTab).
 *   5. "Khựng lại" định thần vài giây ngay khi vừa vào Home, trước khi
 *      bắt đầu nhịp nền đầu tiên.
 *   6. Like nhắm vào item ĐANG THỰC SỰ nằm trong viewport
 *      (firstVisibleLocator) thay vì luôn lấy .first() mù trên toàn
 *      trang (có thể trúng item đã cuộn qua khỏi màn hình nhưng DOM ảo
 *      hoá của X còn giữ lại).
 *
 *   ỔN ĐỊNH / CHỐNG LỖI:
 *   7. Chuỗi selector dự phòng cho danh sách thông báo
 *      (locateNotificationItems) -- nếu selector chính không khớp DOM
 *      thật, tự thử các selector khác thay vì bỏ cuộc luôn.
 *   8. Kiểm tra tab thực sự VISIBLE (không chỉ count() > 0) trước khi
 *      bấm, ở mọi chuyến đi.
 *   9. backToHome tự thử lại 1 lần nếu goto lỗi (mất mạng chập chờn).
 *   10. Watchdog lỗi liên tiếp: quá CONFIG.maxConsecutiveErrors lỗi
 *       liền nhau thì tự tải lại Home để hồi phục, tránh lặp lỗi vô hạn.
 *   11. Mỗi "chuyến đi" giờ bọc try/finally quanh toàn bộ thân hàm --
 *       trước đây nếu 1 bước bên trong (ví dụ bấm nút back) throw lỗi
 *       giữa chừng thì backToHome() ở cuối bị bỏ qua luôn, kẹt lại ở
 *       trang không phải Home mà không hay biết.
 *   12. ensureBackOnHome: sau khi mở 1 bài/bài báo rồi page.goBack(),
 *       xác nhận nhẹ đã thực sự về đúng Home chưa, không thì tự gọi
 *       backToHome() -- cùng tinh thần với #11 nhưng cho các bước
 *       "dạo ra rồi quay lại" NGAY TRONG readAndScrollBeat (không đi
 *       qua excursion).
 *
 *   HỢP LÝ HOÁ HÀNH VI (không phải lỗi crash, mà là logic chưa khớp
 *   với ý đồ/thực tế):
 *   13. Like/xem ảnh/xem bài báo trong readAndScrollBeat giờ đều gắn
 *       với ĐÚNG 1 "bài đang đọc" (currentTweet) duy nhất -- trước đây
 *       mỗi hành động tự tìm phần tử khớp đầu tiên trong viewport một
 *       cách ĐỘC LẬP, nên về lý thuyết có thể "like bài A nhưng xem
 *       ảnh của bài C" nếu 2 loại phần tử đó thuộc 2 tweet khác nhau
 *       đang cùng hiện trên màn hình.
 *   14. Số lượng "chuyến đi" giờ bị CHẶN theo thời lượng phiên thực tế
 *       (CONFIG.excursionTimeBudgetMs) -- trước đây random hoàn toàn
 *       độc lập với thời lượng phiên, nên 1 phiên chỉ 20-25s vẫn có
 *       thể roll ra 3-4 chuyến đi, không hợp lý (không người thật nào
 *       tạt qua vài chục giây mà nhảy tab 3-4 lần).
 *
 *   HÀNH VI CHUỘT:
 *   15. ambientPoint/ambientMouseMove: điểm "di chuột ngẫu nhiên" giờ
 *       lấy theo viewport HIỆN TẠI (có margin an toàn) thay vì 1 khung
 *       toạ độ TUYỆT ĐỐI cố định (300-900, 200-500) dùng chung ở 9 chỗ
 *       khác nhau, không đổi bất kể viewport/phiên/lần chạy nào -- gộp
 *       nhiều phiên lại sẽ lộ ra 1 "cụm" vị trí chuột giống hệt nhau,
 *       kiểu dấu vân tay thống kê dễ bị phát hiện dù từng hành động cụ
 *       thể trong 1 phiên đã random.
 *   16. Không phải nhịp cuộn nào cũng di chuột trước -- người thật lăn
 *       chuột/trackpad rất nhiều lần mà không di chuyển con trỏ trước
 *       đó. Thêm xác suất bỏ qua bước di chuột ở readAndScrollBeat và
 *       các vòng lặp cuộn trong chuyến đi/Following, chỉ giữ nguyên
 *       không điều kiện ở 2 chỗ hợp lý: ngay sau khi vừa điều hướng
 *       tới trang mới (settle-in đầu phiên, sau backToHome).
 *   17. BỎ hành vi bấm nút back trên toolbar (data-testid="app-bar-back")
 *       trong checkNotifications theo yêu cầu -- giờ chỉ xem ĐÚNG 1
 *       thông báo (không lặp xem 2 cái nữa vì không còn cách quay lại
 *       danh sách), backToHome() ở khối finally lo phần quay về.
 *   18. backToHome() giờ ƯU TIÊN bấm tab Home (data-testid=
 *       "AppTabBar_Home_Link") -- điều hướng nội bộ SPA giống người
 *       thật, không tải lại trang -- chỉ rớt xuống goto() cứng làm dự
 *       phòng cuối khi tab Home không có/bấm không ăn thua. TRƯỚC ĐÂY
 *       luôn goto() cứng mỗi lần về Home (kể cả watchdog), tải lại
 *       toàn bộ trang mỗi lần, dễ tạo trạng thái DOM tạm thời lúc đang
 *       tải rồi lỡ tay bấm trúng thứ không mong muốn, và nhìn giống hệt
 *       bấm F5 liên tục -- xác nhận từ quan sát thực tế lúc chạy.
 *   19. dismissCloseButtonIfPresent giờ dùng đúng selector
 *       data-testid="app-bar-close" thay vì [role="button"]
 *       [aria-label="Close"] quá rộng -- selector cũ dễ trúng nhầm 1
 *       trong nhiều nút "X" khác nhau trên X.com không phải nút đóng
 *       popup thật -- xác nhận từ quan sát thực tế lúc chạy.
 *   20. BỎ HOÀN TOÀN page.goto('https://x.com/home', ...) khỏi file --
 *       không còn dòng nào tải lại trang để về Home nữa, kể cả làm dự
 *       phòng. backToHome() giờ CHỈ bấm tab Home (data-testid=
 *       "AppTabBar_Home_Link"), không có gì hiện thì bỏ qua và log lại
 *       chứ không tải lại trang. recoverIfOnLoginPage() (trường hợp
 *       trôi hẳn về màn login, tab Home không tồn tại ở đó) dùng
 *       page.goBack() để thoát login trước rồi mới bấm tab Home nếu đã
 *       thấy lại -- theo đúng yêu cầu.
 *
 *   "HỒ SƠ HÀNH VI" (khác biệt GIỮA CÁC LẦN require(), không chỉ giữa
 *   các phiên trong CÙNG 1 lần require()):
 *   20. createProfile()/PROFILE: trước đây, MỌI lần require() module
 *       này (mọi tài khoản/batch chạy) đều rút xác suất từ ĐÚNG 1 bộ
 *       tham số cố định trong CONFIG/MOOD_PRESETS -- gộp nhiều phiên
 *       nhiều tài khoản lại so sánh sẽ lộ ra 1 phân phối giống hệt
 *       nhau tuyệt đối, không giống 1 quần thể người dùng thật (mỗi
 *       người có xu hướng hơi khác nhau). Giờ mỗi lần require() tự
 *       jitter nhẹ (15-50% tuỳ tham số) 1 "hồ sơ" riêng, ÁP DỤNG CHO:
 *       trọng số chọn mood, CƯỜNG ĐỘ hành vi bên trong mỗi mood
 *       (readChance/likeChance/burstChance/abandonChance), trọng số
 *       loại + SỐ LƯỢNG chuyến đi, tần suất ghé Following, margin di
 *       chuột. Đã kiểm chứng bằng mô phỏng ~335,000 lần rút mẫu (xem
 *       verify-profile-diversity.js) -- độ lệch giữa các hồ sơ là THẬT
 *       (không phải nhiễu ngẫu nhiên), và thuật toán sampling vẫn đúng
 *       trọng số đã định (chi-square goodness-of-fit qua ngưỡng).
 *
 *   CẤU TRÚC LẠI:
 *   21. Các con số hay cần tinh chỉnh (thời lượng phiên, trọng số
 *       chuyến đi, tham số tâm trạng...) gom vào CONFIG / MOOD_PRESETS
 *       ở đầu file thay vì rải rác trong thân hàm.
 *
 * Usage:
 *   const helpers = require('./helpers');
 *   const { browseHomeVaried } = require('./interactXHome');
 *   await browseHomeVaried(page, log, helpers);
 *
 * Tham số thứ 3 là module helpers.js ĐÃ require() sẵn (không phải
 * require() lại từ trong file này) -- lý do y hệt các file khác trong
 * dự án: server.js chỉ xoá cache của module mà SCRIPT tự require() trực
 * tiếp, require() lồng bên trong 1 file khác có nguy cơ dính bản cache
 * cũ tuỳ thứ tự gọi.
 * -----------------------------------------------------------------------
 */

// -------------------------------------------------------------------
// CONFIG -- mọi con số hay cần tinh chỉnh gom về đây, thay vì rải rác
// trong thân các hàm bên dưới.
// -------------------------------------------------------------------
const CONFIG = {
  sessionDurationMsRange: [20000, 60000],
  settleInPauseMsRange: [800, 2600],
  // Phân phối số lượng "chuyến đi" (0..5) -- LỆCH về 1-2 việc, hiếm khi
  // đủ cả 5. Index i = xác suất có đúng i chuyến đi. Đây là "mong
  // muốn" thô ban đầu -- số THỰC TẾ còn bị giới hạn thêm theo thời
  // lượng phiên qua excursionTimeBudgetMs bên dưới (xem browseHomeVaried).
  excursionCountWeights: [0.12, 0.3, 0.28, 0.16, 0.09, 0.05],
  // Ước lượng chi phí thời gian trung bình cho 1 chuyến đi (chuyển tab
  // + dwell + cuộn + quay lại Home) -- dùng để CHẶN số chuyến đi tối đa
  // theo thời lượng phiên đã roll được. Không có giới hạn này thì 1
  // phiên chỉ 20-25s (kiểu "tạt qua xem nhanh") vẫn có thể roll ra 3-4
  // chuyến đi -- không hợp lý, không người thật nào tạt qua 22 giây mà
  // nhảy tab 4 lần.
  excursionTimeBudgetMs: 8000,
  // Trọng số CHỌN loại chuyến đi nào (không phải xác suất tuyệt đối,
  // chỉ là trọng số tương đối khi rút không hoàn lại) -- Notifications
  // và Explore đời thực được ghé nhiều hơn hẳn Messages/Bookmarks.
  excursionTypeWeights: {
    notifications: 3,
    explore: 3,
    profile: 2,
    bookmarks: 1,
    messages: 1,
  },
  followingTabVisitChance: 0.1, // mỗi nhịp nền, xác suất ghé "Following" thay vì đọc/cuộn bình thường
  maxConsecutiveErrors: 5, // lỗi liên tiếp quá số này -- tự tải lại Home để hồi phục
  // Số lần TỐI ĐA thử goBack() để thoát khỏi trạng thái "trôi về login"
  // trong CẢ 1 phiên -- luồng login trên X có thể nhiều bước con, vượt
  // quá số này mà vẫn chưa thoát thì DỪNG hẳn phiên thay vì cứ goBack()
  // thêm (dễ lùi ra khỏi x.com luôn).
  maxLoginRecoveryAttempts: 3,
  // Sau mỗi chuyến đi/task (follow, post...) phải lướt Home thật ít nhất khoảng này rồi mới làm việc đặc biệt tiếp -- không làm dồn liền nhau.
  specialGapMsRange: [6000, 15000],
  // Script có "script timeout" (server truyền mốc hết giờ qua options.deadlineAt): còn ít giờ hơn (số task chưa chạy × số này + 30s)
  // thì thôi lướt/nghỉ giữa các việc, làm task liền nhau rồi kết thúc phiên -- không để script bị cắt ngang lúc đang lướt.
  taskTimeEstimateMs: 60000,
  minTimeLeftToStartTaskMs: 20000, // còn ít hơn số này thì không bắt đầu task mới nữa -- dừng phiên, task còn lại để lần chạy sau
};

// Tâm trạng phiên -- roll 1 LẦN DUY NHẤT mỗi khi gọi browseHomeVaried,
// ảnh hưởng xuyên suốt cả phiên. abandonChance = xác suất 1 chuyến đi
// bị "bỏ dở giữa chừng" thay vì đi hết số vòng đã định.
const MOOD_PRESETS = [
  { name: 'skimmer', weight: 0.3, readChance: [0.12, 0.28], likeChance: 0.14, burstChance: 0.32, abandonChance: 0.3 },
  { name: 'browser', weight: 0.42, readChance: [0.3, 0.5], likeChance: 0.22, burstChance: 0.14, abandonChance: 0.14 },
  { name: 'reader', weight: 0.28, readChance: [0.48, 0.68], likeChance: 0.3, burstChance: 0.05, abandonChance: 0.05 },
];

// Hệ số tăng/giảm xác suất "mở xem thêm" theo tâm trạng.
const OPEN_EXTRA_FACTOR = { skimmer: 0.6, browser: 1.0, reader: 1.5 };

// Click an toàn vào tweetText (né link/hashtag lồng bên trong) --
// KHÔNG còn phụ thuộc gì vào openTweetDetail.js nữa (file đó giờ
// chuyên biệt cho newFile_02.js, cần biết trước href bài đích cụ thể
// mà interactXHome.js không có, vì mở bài ngẫu nhiên).
const { pickSafeClickPoint } = require('./xlv1_safeClickPoint');
const { humanPause } = require('./helpers');

async function dismissRandomNotice(page, log, deps) {
  let  elementA = page.locator('xpath=//*[text()="Happy X anniversary"]');
  let  elementB = page.locator('xpath=//*[text()="Celebrate with a post"]/ancestor::button[1]');

  let  hasA = await elementA.isVisible({ timeout: 500 }).catch(() => false);
  if (hasA) {
    let  hasB = await elementB.isVisible({ timeout: 1000 }).catch(() => false);
    if (hasB) {
        await elementB.scrollIntoViewIfNeeded().catch(() => {});
        await deps.ambientMouseMove(page, deps.moveMouseVisibly);
       
        await deps.clickVisibly(page, elementB);
        log('[Home] Đã đóng thông báo.');
        await humanPause(page, 1000, 2000);
    }
  }

  elementA = page.locator('xpath=//*[text()="Updates to our Terms of Service"]');
  elementB = page.locator('xpath=//*[text()="Got it"]/ancestor::button[1]');

  hasA = await elementA.isVisible({ timeout: 500 }).catch(() => false);
  if (hasA) {
    hasB = await elementB.isVisible({ timeout: 1000 }).catch(() => false);
    if (hasB) {
        await elementB.scrollIntoViewIfNeeded().catch(() => {});
        await deps.ambientMouseMove(page, deps.moveMouseVisibly);
    
        await deps.clickVisibly(page, elementB);
        log('[Home] Đã đóng thông báo.');
        await humanPause(page, 1000, 2000);
    }
  }

  elementB = page.locator('xpath=//*[text()="Got it"]/ancestor::button[1]');

  hasB = await elementB.isVisible({ timeout: 1000 }).catch(() => false);
  if (hasB) {
      await elementB.scrollIntoViewIfNeeded().catch(() => {});
      await deps.ambientMouseMove(page, deps.moveMouseVisibly);

      await deps.clickVisibly(page, elementB);
      log('[Keep less relevant ads] Đã đóng thông báo.');
      await humanPause(page, 1000, 2000);
  }

  elementB = page.locator('xpath=//*[text()="Keep less relevant ads"]/ancestor::button[1]');

  hasB = await elementB.isVisible({ timeout: 1000 }).catch(() => false);
  if (hasB) {
      await elementB.scrollIntoViewIfNeeded().catch(() => {});
      await deps.ambientMouseMove(page, deps.moveMouseVisibly);

      await deps.clickVisibly(page, elementB);
      log('[Keep less relevant ads] Đã đóng thông báo.');
      await humanPause(page, 1000, 2000);
  }


  elementA = page.locator('xpath=//*[text()="An update to your data-sharing settings"]');
  elementB = page.locator('xpath=//*[normalize-space(text())="OK"]/ancestor::button[1]');

  hasA = await elementA.isVisible({ timeout: 500 }).catch(() => false);
  if (hasA) {
    hasB = await elementB.isVisible({ timeout: 1000 }).catch(() => false);
    if (hasB) {
        await elementB.scrollIntoViewIfNeeded().catch(() => {});
        await deps.ambientMouseMove(page, deps.moveMouseVisibly);

        await deps.clickVisibly(page, elementB);
        log('[Home] Đã đóng thông báo.');
        await humanPause(page, 1000, 2000);
    }
  }

  elementB = page.locator('xpath=//*[text()="Yes, that is my number"]/ancestor::button[1]');

  hasB = await elementB.isVisible({ timeout: 1000 }).catch(() => false);
  if (hasB) {
      await elementB.scrollIntoViewIfNeeded().catch(() => {});
      await deps.ambientMouseMove(page, deps.moveMouseVisibly);
      await deps.clickVisibly(page, elementB);
      log('[Keep less relevant ads] Đã đóng thông báo.');
      await humanPause(page, 1000, 2000);
  }

}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function randomInt(min, max) {
  return Math.floor(randomBetween(min, max + 1));
}

// Jitter 1 số theo tỉ lệ % (giữ dấu, có thể kẹp min/max an toàn) --
// dùng để tạo "hồ sơ hành vi" hơi lệch nhau giữa các lần require() thay
// vì mọi nơi đều rút đúng 1 con số cố định trong CONFIG.
function jitterValue(base, jitterRatio, min, max) {
  const factor = 1 + (Math.random() * 2 - 1) * jitterRatio;
  let v = base * factor;
  if (min !== undefined) v = Math.max(min, v);
  if (max !== undefined) v = Math.min(max, v);
  return v;
}

function normalizeWeights(weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  return weights.map((w) => w / total);
}

// -------------------------------------------------------------------
// "HỒ SƠ HÀNH VI" -- vấn đề cần giải quyết: MỌI lần require() module
// này (mọi tài khoản, mọi lần chạy) đều rút xác suất/khoảng random từ
// ĐÚNG 1 bộ tham số cố định trong CONFIG/MOOD_PRESETS. Trong 1 phiên
// đơn lẻ, việc này không thấy được (đã có random rất nhiều tầng). Nhưng
// gộp NHIỀU phiên/NHIỀU tài khoản lại so sánh thống kê thì sẽ lộ ra: bất
// kỳ 2 tài khoản nào cũng có "P(mood=skimmer) = đúng 30.0%", "trọng số
// ghé Explore = đúng 3/10" -- giống hệt nhau tuyệt đối, điều không xảy
// ra ở 1 quần thể người dùng thật (mỗi người có xu hướng hơi khác nhau).
//
// createProfile() tạo 1 bộ tham số ĐÃ JITTER nhẹ (~15-50% tuỳ tham số,
// xem từng dòng) quanh các con số nền -- mô phỏng "tài khoản/thiết bị
// này có xu hướng hơi khác tài khoản kia" 1 cách hợp lý (không lệch quá
// đà tới mức phá vỡ chủ đích thiết kế ban đầu, ví dụ Explore vẫn luôn
// được ưu tiên hơn Bookmarks, chỉ là mức độ chênh lệch cụ thể thay đổi
// theo từng hồ sơ).
//
// PROFILE (hằng số module-level bên dưới) được tính CHÍNH XÁC 1 LẦN khi
// module này được require() -- theo đúng ghi chú ở đầu file, server.js
// xoá cache module này mỗi lần gọi lại, nghĩa là MỖI LẦN require() lại
// (mỗi tài khoản/batch chạy) sẽ tự nhận 1 hồ sơ mới, trong khi bên
// trong CÙNG 1 lần require() đó (cùng 1 tài khoản, xuyên suốt các phiên
// browseHomeVaried() gọi liên tiếp cho tới lần xoá cache kế tiếp), hồ
// sơ giữ NGUYÊN -- tạo ra "tính cách" nhất quán hợp lý trong ngắn hạn,
// đúng như hành vi 1 người dùng thật (không đổi tính cách liên tục).
//
// Các hàm rollSessionMood/pickWeightedExcursions/ambientPoint bên dưới
// đều nhận profile qua tham số, mặc định dùng PROFILE của module --
// cho phép script kiểm chứng (verify-profile-diversity.js) truyền vào
// nhiều profile khác nhau để đo độ đa dạng giữa các "tài khoản" mô
// phỏng, mà không đụng gì tới luồng chạy thật.
function createProfile() {
  // Bản mood ĐÃ jitter riêng cho hồ sơ này -- không chỉ TRỌNG SỐ chọn
  // mood nào (moodWeights bên dưới), mà cả CƯỜNG ĐỘ hành vi bên trong
  // mỗi mood cũng jitter theo hồ sơ: 2 hồ sơ cùng là "reader" vẫn có
  // thể đọc kỹ nhiều/ít khác nhau 1 chút, like nhiều/ít khác nhau 1
  // chút -- không phải MỌI "reader" trên đời đều đọc kỹ ở đúng 1 mức
  // độ giống hệt nhau.
  const moods = MOOD_PRESETS.map((m) => {
    const r0 = jitterValue(m.readChance[0], 0.15, 0.02, 0.95);
    const r1 = jitterValue(m.readChance[1], 0.15, 0.02, 0.95);
    return {
      ...m,
      readChance: [Math.min(r0, r1), Math.max(r0, r1)], // đảm bảo vẫn đúng thứ tự [min,max] sau khi jitter độc lập
      likeChance: jitterValue(m.likeChance, 0.2, 0.02, 0.6),
      burstChance: jitterValue(m.burstChance, 0.2, 0.01, 0.6),
      abandonChance: jitterValue(m.abandonChance, 0.2, 0.01, 0.6),
    };
  });

  return {
    // Trọng số tâm trạng phiên -- jitter ±25%, kẹp sàn 0.03 để không
    // loại hẳn mood nào khỏi 1 hồ sơ cụ thể, rồi chuẩn hoá lại tổng = 1.
    moodWeights: normalizeWeights(moods.map((m) => jitterValue(m.weight, 0.25, 0.03))),
    moods, // rollSessionMood() trả về từ đây, KHÔNG phải MOOD_PRESETS gốc nữa
    // Trọng số loại chuyến đi -- jitter ±30%, sàn 0.2 để loại nào cũng
    // còn cơ hội được chọn (không tới mức 1 hồ sơ không bao giờ ghé
    // Bookmarks chẳng hạn).
    excursionTypeWeights: Object.fromEntries(
      Object.entries(CONFIG.excursionTypeWeights).map(([name, w]) => [name, jitterValue(w, 0.3, 0.2)])
    ),
    // Trọng số SỐ LƯỢNG chuyến đi (0..5) -- jitter ±25%, sàn 0.01 --
    // có hồ sơ có xu hướng hay "dạo" nhiều tab hơn hồ sơ khác 1 chút.
    excursionCountWeights: normalizeWeights(CONFIG.excursionCountWeights.map((w) => jitterValue(w, 0.25, 0.01))),
    // Xác suất ghé Following mỗi nhịp nền -- jitter ±50% quanh 0.1,
    // kẹp trong [0.02, 0.22] -- có hồ sơ gần như không bao giờ đụng tới
    // Following, có hồ sơ ghé khá thường xuyên.
    followingTabVisitChance: jitterValue(CONFIG.followingTabVisitChance, 0.5, 0.02, 0.22),
    // Margin an toàn cho "điểm di chuột ngẫu nhiên" trong viewport --
    // jitter ±35% quanh 0.12, kẹp [0.05, 0.22].
    ambientMarginRatio: jitterValue(0.12, 0.35, 0.05, 0.22),
  };
}

// Hồ sơ hành vi CỦA LẦN require() NÀY -- xem giải thích chi tiết ở
// createProfile() ngay phía trên.
const PROFILE = createProfile();

// Random "giống người" hơn random đều -- cộng 3 số random đều rồi lấy
// trung bình, xấp xỉ phân phối chuông (Irwin-Hall). Ưu tiên giá trị
// GIỮA khoảng, giảm cảm giác "phẳng" của random đều tuyệt đối.
function humanBetween(min, max) {
  const r = (Math.random() + Math.random() + Math.random()) / 3;
  return min + r * (max - min);
}

// Xáo mảng kiểu Fisher-Yates -- .sort(() => Math.random()-0.5) bị lệch
// phân phối (không đều thật sự), dùng cách đúng chuẩn hơn.
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Điểm ngẫu nhiên bên trong viewport HIỆN TẠI (có margin an toàn khỏi
// mép) -- dùng cho mọi lần "di chuột ngẫu nhiên" (ambient move) giữa
// các hành động. TRƯỚC ĐÂY mọi nơi gọi đều dùng 1 khung toạ độ TUYỆT
// ĐỐI cố định (300-900, 200-500) bất kể kích thước viewport thực tế,
// bất kể phiên/lần chạy nào -- gộp nhiều phiên lại sẽ lộ ra 1 "cụm" vị
// trí chuột giống hệt nhau mọi lúc, kiểu dấu vân tay thống kê dễ bị
// phát hiện dù từng hành động cụ thể đã random.
function ambientPoint(page, marginRatio = PROFILE.ambientMarginRatio) {
  const size = page.viewportSize() || { width: 1280, height: 800 };
  const marginX = size.width * marginRatio;
  const marginY = size.height * marginRatio;
  return {
    x: marginX + Math.random() * Math.max(1, size.width - marginX * 2),
    y: marginY + Math.random() * Math.max(1, size.height - marginY * 2),
  };
}

// Gộp ambientPoint() + gọi moveMouseVisibly() thành 1 bước cho gọn ở
// các nơi gọi.
async function ambientMouseMove(page, moveMouseVisibly) {
  const p = ambientPoint(page);
  await moveMouseVisibly(page, p.x, p.y);
}

function rollSessionMood(profile = PROFILE) {
  const r = Math.random();
  let acc = 0;
  for (let i = 0; i < profile.moods.length; i++) {
    acc += profile.moodWeights[i];
    if (r < acc) return profile.moods[i];
  }
  return profile.moods[profile.moods.length - 1];
}

// Hệ số "ở lại lâu hơn hay ít hơn" theo tâm trạng, dùng để nhân vào các
// khoảng dwell time trong chuyến đi.
function moodDwellScale(mood) {
  if (mood.name === 'skimmer') return randomBetween(0.55, 0.85);
  if (mood.name === 'reader') return randomBetween(1.15, 1.6);
  return randomBetween(0.85, 1.2);
}

// Phân phối số lượng "chuyến đi" trong 1 phiên, mặc định dùng
// CONFIG.excursionCountWeights nhưng cho phép truyền trọng số riêng
// theo hồ sơ (PROFILE.excursionCountWeights) để mỗi hồ sơ có xu hướng
// "dạo" nhiều/ít tab hơi khác nhau.
function rollExcursionCount(max, weights = CONFIG.excursionCountWeights) {
  const r = Math.random();
  let acc = 0;
  for (let i = 0; i <= max; i++) {
    acc += weights[i] ?? 0;
    if (r < acc) return i;
  }
  return max;
}

// Chọn ngẫu nhiên "count" loại chuyến đi KHÔNG lặp, có TRỌNG SỐ khác
// nhau theo CONFIG.excursionTypeWeights (rút không hoàn lại) -- trước
// đây mọi loại có xác suất bằng nhau, không khớp thực tế dùng X hàng
// ngày (Notifications/Explore được ghé nhiều hơn Messages/Bookmarks).
// Thứ tự trả về CHƯA phải thứ tự sẽ diễn ra trong phiên -- gọi
// shuffle() lên kết quả này ở nơi gọi để random hoá thứ tự riêng.
function pickWeightedExcursions(count, profile = PROFILE) {
  const pool = Object.keys(profile.excursionTypeWeights).map((name) => ({
    name,
    weight: profile.excursionTypeWeights[name],
  }));
  const picked = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const total = pool.reduce((s, p) => s + p.weight, 0);
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < pool.length - 1; idx++) {
      if (r < pool[idx].weight) break;
      r -= pool[idx].weight;
    }
    picked.push(pool[idx].name);
    pool.splice(idx, 1);
  }
  return picked;
}

// Cuộn có "quán tính" -- chia 1 lượt cuộn thành 3-5 tick nhỏ giảm dần
// (tick đầu mạnh nhất, nhẹ dần) thay vì 1 cú wheel(    ) delta lớn duy
// nhất, giống cảm giác cuộn chuột/trackpad thật có đà, chậm dần chứ
// không dừng đột ngột.
async function momentumScroll(page, totalDelta) {
  const direction = totalDelta >= 0 ? 1 : -1;
  const magnitude = Math.abs(totalDelta);
  const tickCount = randomInt(3, 5);
  const rawWeights = Array.from({ length: tickCount }, (_, i) => tickCount - i);
  const weightSum = rawWeights.reduce((s, w) => s + w, 0);
  for (let i = 0; i < tickCount; i++) {
    const share = (rawWeights[i] / weightSum) * magnitude * randomBetween(0.85, 1.15);
    await page.mouse.wheel(0, direction * share);
    if (i < tickCount - 1) await page.waitForTimeout(randomBetween(35, 110));
  }
}

// Vài cú cuộn liên tiếp gần nhau, không dừng đọc -- mô phỏng lúc đang
// "lướt nhanh" tìm cái gì đó hoặc chán, khác hẳn nhịp cuộn-đơn bình
// thường bên dưới. (Khác momentumScroll: đây là NHIỀU lượt cuộn ý định
// riêng biệt liên tiếp, không phải 1 lượt chia nhỏ.)
async function scrollBurst(page, ticks, minDelta, maxDelta, minPause, maxPause) {
  for (let i = 0; i < ticks; i++) {
    await page.mouse.wheel(0, randomBetween(minDelta, maxDelta));
    if (i < ticks - 1) await page.waitForTimeout(randomBetween(minPause, maxPause));
  }
}

// Đôi khi "chán" bỏ dở giữa chừng 1 chuyến đi, không làm hết số vòng
// (cuộn/bấm) đã định -- tần suất phụ thuộc tâm trạng phiên.
function maybeAbandonEarly(mood, plannedCount) {
  if (plannedCount <= 1) return plannedCount;
  if (Math.random() < mood.abandonChance) {
    return randomInt(1, plannedCount - 1);
  }
  return plannedCount;
}

// Lấy phần tử ĐẦU TIÊN trong danh sách khớp mà thực sự đang nằm trong
// viewport hiện tại -- tránh trúng item đã cuộn qua khỏi màn hình
// nhưng DOM ảo hoá của X còn giữ lại (dễ xảy ra sau khi vừa cuộn).
// Trả về null nếu không có item nào trong viewport.
async function firstVisibleLocator(page, locator) {
  const rects = await locator
    .evaluateAll((els) => els.map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height };
    }))
    .catch(() => []);
  const vh = await page.evaluate(() => window.innerHeight).catch(() => 900);
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (r.height > 0 && r.bottom > 0 && r.top < vh) {
      return locator.nth(i);
    }
  }
  return null;
}

// -------------------------------------------------------------------
// Hành vi NỀN: 1 "nhịp" đọc + cuộn. Gọi lặp lại liên tục xuyên suốt
// phiên (trừ lúc đang trong 1 "chuyến đi"). Trả về true nếu vừa dùng 1
// lượt like (để vòng ngoài trừ vào quỹ like còn lại).
// -------------------------------------------------------------------
async function readAndScrollBeat(page, log, moveMouseVisibly, clickVisibly, canLike, mood,deps) {
  // Thỉnh thoảng KHÔNG cuộn tiếp ngay -- chỉ dừng lại, nhích chuột nhẹ
  // như đang lơ đãng hoặc đọc lại dòng cũ.
  if (Math.random() < 0.08) {
    await ambientMouseMove(page, moveMouseVisibly);
    await page.waitForTimeout(randomBetween(800, 2200));
    if (Math.random() < 0.4) {
      await ambientMouseMove(page, moveMouseVisibly);
    }
    log('[browse] Dừng lơ đãng một chút, chưa cuộn tiếp...');
    return false;
  }

  // Di chuột trước khi cuộn -- nhưng KHÔNG PHẢI LÚC NÀO CŨNG CẦN, người
  // thật lăn chuột/trackpad rất nhiều lần mà không di chuyển con trỏ
  // trước đó (tay đặt sẵn trên chuột, chỉ lăn). Nếu nhịp nào cũng di
  // chuột trước khi cuộn thì đó lại là 1 pattern lặp lại đều đặn khác.
  if (Math.random() < 0.55) {
    await ambientMouseMove(page, moveMouseVisibly);
  }
  if (Math.random() < mood.burstChance) {
    const ticks = randomInt(2, 4);
    await scrollBurst(page, ticks, 260, 700, 120, 380);
    log(`[browse] Lướt nhanh liên tiếp ${ticks} cú (skim burst)...`);
    await page.waitForTimeout(randomBetween(300, 900));
    return false;
  }

  // Chủ yếu cuộn xuống (đọc tiếp), thỉnh thoảng cuộn lên -- giờ dùng
  // momentum scroll (nhiều tick giảm dần) thay vì 1 cú delta lớn.
  const scrollDownChance = randomBetween(0.72, 0.9);
  if (Math.random() < scrollDownChance) {
    await momentumScroll(page, randomBetween(220, 650));
  } else {
    await momentumScroll(page, -randomBetween(120, 400));
  }

  let likedThisBeat = false;
  const openFactor = OPEN_EXTRA_FACTOR[mood.name] ?? 1;

  const stopsToRead = Math.random() < humanBetween(mood.readChance[0], mood.readChance[1]);
  if (stopsToRead) {
    await page.waitForTimeout(humanBetween(5000, 10000));

    // Xác định ĐÚNG 1 "bài đang đọc" (tweet rõ nhất trong viewport) MỘT
    // LẦN DUY NHẤT, rồi dùng CHUNG cho like/ảnh/bài báo bên dưới --
    // trước đây mỗi hành động tự tìm phần tử khớp đầu tiên trong
    // viewport MỘT CÁCH ĐỘC LẬP, nên về lý thuyết có thể "like bài A
    // nhưng lại xem ảnh của bài C" nếu 2 loại phần tử đó tình cờ thuộc
    // 2 tweet khác nhau đang cùng hiện trên màn hình -- không giống
    // người thật (người thật like/xem ảnh/xem bài báo đều gắn với
    // ĐÚNG 1 bài cụ thể, không phải mỗi việc nhắm 1 bài ngẫu nhiên).
    const currentTweet = await firstVisibleLocator(page, page.locator('[data-testid="tweet"]'));

    // Đang dừng đọc -- thỉnh thoảng like ĐÚNG bài đang xem.
    if (currentTweet && canLike && Math.random() < mood.likeChance) {
      const likeBtn = currentTweet.locator('[data-testid="like"]').first();
      if (await likeBtn.count().catch(() => 0) > 0) {
        await dismissRandomNotice(page, log, deps);
        await clickVisibly(page, likeBtn).catch(() => {});
        log('[browse] Đã like bài đang đọc.');
        likedThisBeat = true;
      }
    }

    if (currentTweet && Math.random() < 0.18 * openFactor) {
      const photo = currentTweet.locator('[data-testid="tweetPhoto"]').first();
      if (await photo.count().catch(() => 0) > 0) {
        await dismissRandomNotice(page, log, deps);
        await clickVisibly(page, photo).catch(() => {});
        log('[browse] Xem ảnh/video trong bài đang đọc...');
        await page.waitForTimeout(randomBetween(2000, 5500));
        await page.keyboard.press('Escape').catch(() => {}); // viewer ảnh/video trên X đóng bằng Esc
        await page.waitForTimeout(randomBetween(500, 1200));
      }
    }

    if (currentTweet && Math.random() < 0.13 * openFactor) {
      const article = currentTweet.locator('[alt="Article cover image"]').first();
      if (await article.count().catch(() => 0) > 0) {
        await dismissRandomNotice(page, log, deps);
        await clickVisibly(page, article).catch(() => {});
        log('[browse] Mở xem 1 bài báo được đăng lại...');
        await page.waitForTimeout(randomBetween(2000, 6000));
        await page.goBack({ timeout: 15000 }).catch(() => {});
        // Đã có lần quan sát thực tế: goBack() ở đây khiến CẢ TAB bị
        // đóng luôn (không rõ nguyên nhân từ phía Chrome/profile, không
        // phải lỗi logic ở đây) -- không phải chỉ điều hướng nhầm URL.
        // Không check sớm thì mọi lệnh Playwright sau đó (kể cả các
        // isVisible() bên trong ensureBackOnHome/backToHome) đều crash
        // ngay lập tức nhưng bị .catch() nuốt mất, khiến log tưởng nhầm
        // là "chưa thấy, thử lại" trong khi thực ra trang đã chết hẳn --
        // dừng NGAY và rõ ràng ở đây thay vì dò dẫm vô ích rồi crash mù
        // mờ ở 1 chỗ khác xa hơn.
        if (page.isClosed()) {
          throw new Error('Trang đã bị đóng ngay sau goBack() (mở bài báo) -- dừng phiên lướt Home tại đây.');
        }
        await page.waitForTimeout(randomBetween(1000, 2200));
        await ensureBackOnHome(page, log, moveMouseVisibly, clickVisibly);
      }
    }

    if (Math.random() < 0.15) {
      await momentumScroll(page, -randomBetween(80, 220));
      await page.waitForTimeout(randomBetween(600, 1500));
      log('[browse] Cuộn lại chút để đọc lại...');
    }
  } else {
    await page.waitForTimeout(randomBetween(500, 1600));

    if (Math.random() < 0.12) {
      const linkCandidates = page.locator('[data-testid="tweet"] a');
      const link = await firstVisibleLocator(page, linkCandidates);
      if (link) {
        await link.hover({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(randomBetween(400, 1200));
        log('[browse] Rê chuột qua 1 link, không bấm...');
      }
    }
  }

  if (Math.random() < 0.1 * openFactor) {
  const tweets = page.locator('[data-testid="tweet"]');
  const count = await tweets.count().catch(() => 0);

  if (count > 0) {
    const tweet = tweets.nth(Math.floor(Math.random() * count));
    const tweetText = tweet.locator('[data-testid="tweetText"]').first();
    const hasText = (await tweetText.count().catch(() => 0)) > 0;

    const beforeUrl = page.url();
    let opened = false;

    log('[browse] Mở xem 1 bài, đang chờ xác nhận...');

    try {
      let clicked = false;

      if (hasText) {
        // Tìm điểm click an toàn, tránh mention, hashtag và link.
        const safePoint = await pickSafeClickPoint(tweetText);

        if (safePoint) {
          await ambientMouseMove(page, moveMouseVisibly);
          await dismissRandomNotice(page, log, deps);

          clicked = await clickVisibly(page, safePoint);
        } else {
          await dismissRandomNotice(page, log, deps);

          clicked = await clickVisibly(page, tweet);
        }
      } else {
        // Tweet chỉ có ảnh/video hoặc không có tweetText.
        await dismissRandomNotice(page, log, deps);

        clicked = await clickVisibly(page, tweet);
      }

      if (!clicked) {
        throw new Error('clickVisibly trả về false');
      }

      // Điều kiện 1: URL phải chuyển sang trang chi tiết post.
      const reachedPostUrl = await page
        .waitForURL(
          url =>
            url.href !== beforeUrl &&
            /\/status\/\d+(?:\/|$)/.test(url.pathname),
          { timeout: 10000 }
        )
        .then(() => true)
        .catch(() => false);

      if (!reachedPostUrl) {
        throw new Error(
          'Đã click nhưng URL không chuyển sang trang /status/'
        );
      }

      // Điều kiện 2: ô trả lời phải xuất hiện.
      const tweetTextarea = page
        .locator('xpath=//*[@data-testid="tweetTextarea_0"]')
        .first();

      const textareaAppeared = await tweetTextarea
        .waitFor({
          state: 'visible',
          timeout: 10000,
        })
        .then(() => true)
        .catch(() => false);

      if (!textareaAppeared) {
        throw new Error(
          'Đã vào URL post nhưng tweetTextarea_0 không xuất hiện'
        );
      }

      opened = true;
      log(
        '[browse] Đã mở post thành công: tìm thấy tweetTextarea_0.'
      );
    } catch (err) {
      log(`[browse] Mở post thất bại: ${err.message}`);
    }

    if (page.isClosed()) {
      throw new Error(
        'Trang đã bị đóng trong lúc mở chi tiết tweet.'
      );
    }

    if (opened) {
      // Chỉ đọc khi đã xác nhận thật sự vào post.
      await page.waitForTimeout(randomBetween(2000, 6000));

      // Quay lại bằng tab Home, không dùng page.goBack().
      await backToHome(
        page,
        log,
        moveMouseVisibly,
        clickVisibly,
        deps
      ).catch(err => {
        log(`[browse] Không quay lại Home được: ${err.message}`);
      });
    } else {
      // Click không mở được post: không gọi goBack().
      log(
        '[browse] Post không tải được, bấm Home để hồi phục...'
      );

      await page.keyboard.press('Escape').catch(() => {});

      await backToHome(
        page,
        log,
        moveMouseVisibly,
        clickVisibly,
        deps
      ).catch(err => {
        log(`[browse] Hồi phục về Home thất bại: ${err.message}`);
      });

      await page.waitForTimeout(randomBetween(1000, 2200));
    }
  }
}

return likedThisBeat;
}

// Quay lại Home sau 1 chuyến đi -- LUÔN bấm vào tab Home trên thanh
// điều hướng (data-testid="AppTabBar_Home_Link"), đúng cách người thật
// quay lại Home: điều hướng NỘI BỘ trong SPA, không bao giờ tải lại
// trang. TRƯỚC ĐÂY dùng goto() cứng (toàn bộ hoặc làm dự phòng), tải
// lại toàn bộ trang, dễ tạo ra trạng thái DOM tạm thời lúc đang tải rồi
// lỡ tay bấm trúng thứ không mong muốn, và nhìn giống hệt bấm F5 liên
// tục -- đã bỏ hoàn toàn theo yêu cầu, không còn goto() nào trong hàm
// này nữa.
async function backToHome(page, log, moveMouseVisibly, clickVisibly,deps) {
  // Lớp bảo vệ THỨ 2 (bên cạnh check ngay sau goBack() ở
  // readAndScrollBeat) -- phòng trường hợp việc đóng tab xảy ra KHÔNG
  // đồng bộ (Chrome xử lý xong việc đóng chậm hơn vài chục ms so với
  // lúc goBack() trả về), khiến check đầu bị lọt. backToHome() được
  // gọi từ RẤT NHIỀU nơi (5 "chuyến đi" + watchdog + ensureBackOnHome),
  // đặt check ở đây bảo vệ được TẤT CẢ, không chỉ riêng đường goBack().
  if (page.isClosed()) {
    throw new Error('backToHome(): trang đã bị đóng, không thể thao tác gì thêm.');
  }

  const homeTab = page.locator('[data-testid="AppTabBar_Home_Link"]');
  const homeTabVisible = await homeTab.first().isVisible({ timeout: 3000 }).catch(() => false);

  if (!homeTabVisible) {
    log('[browse] Không thấy tab Home trên toolbar để bấm -- bỏ qua, không tải lại trang.');
    return;
  }
  await dismissRandomNotice(page, log, deps);
  await clickVisibly(page, homeTab.first()).catch(() => {});
  await ambientMouseMove(page, moveMouseVisibly);
  await page.locator('xpath=//*[text()="For you"]').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
}

// Sau khi rời Home TẠM THỜI (mở 1 bài/bài báo rồi page.goBack()), xác
// nhận nhẹ xem đã thực sự về đúng Home chưa -- nếu goBack() vì lý do
// gì đó (lịch sử SPA lệch, mạng chậm...) không đưa về đúng chỗ, tự gọi
// backToHome() để hồi phục thay vì để các bước sau đó chạy mù trên 1
// trang không phải Home mà không ai hay.
async function ensureBackOnHome(page, log, moveMouseVisibly, clickVisibly) {
  const maxAttempts = 3; // giới hạn số lần thử -- không lặp mãi nếu Home không bao giờ xuất hiện
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (page.isClosed()) {
      throw new Error('ensureBackOnHome(): trang đã bị đóng, dừng lại thay vì lặp tiếp vô ích.');
    }

    const onHome = await page.locator('xpath=//*[text()="For you"]').first().isVisible({ timeout: 5000 }).catch(() => false);
    if (onHome) return; // đã về đúng Home -- xong, không cần làm gì thêm

    log(`[browse] goBack() có vẻ không về đúng Home (lần ${attempt}/${maxAttempts}) -- bấm tab Home rồi kiểm tra lại.`);
    await backToHome(page, log, moveMouseVisibly, clickVisibly);
  }
  log(`[browse] Sau ${maxAttempts} lần thử vẫn chưa xác nhận về Home -- bỏ cuộc, đi tiếp.`);
}

// Thỉnh thoảng ghé qua tab "Following" trên chính Home rồi quay lại
// "For you" -- thêm 1 trục biến thể mới, trước đây phiên nào cũng chỉ
// ở đúng 1 tab "For you" suốt.
async function visitFollowingTab(page, log, moveMouseVisibly, clickVisibly,deps) {
  const followingTab = page.locator('xpath=//*[text()="Following"]').first();
  const visible = await followingTab.isVisible({ timeout: 1000 }).catch(() => false);
  if (!visible) return;

  await dismissRandomNotice(page, log, deps);
  await clickVisibly(page, followingTab).catch(() => {});
  log('[browse] Ghé xem tab Following một lát...');
  await page.waitForTimeout(randomBetween(1500, 3500));

  const ticks = randomInt(1, 2);
  for (let i = 0; i < ticks; i++) {
    if (Math.random() < 0.6) await ambientMouseMove(page, moveMouseVisibly); // không phải lần cuộn nào cũng cần di chuột trước
    await momentumScroll(page, randomBetween(200, 500));
    await page.waitForTimeout(randomBetween(800, 2000));
  }

  const forYouTab = page.locator('xpath=//*[text()="For you"]').first();
  const forYouVisible = await forYouTab.isVisible({ timeout: 1000 }).catch(() => false);
  if (forYouVisible) {
    await dismissRandomNotice(page, log, deps);
    await clickVisibly(page, forYouTab).catch(() => {});
    await forYouTab.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  }
  await page.waitForTimeout(randomBetween(500, 1200));
}

// Chuỗi selector dự phòng cho danh sách "item" thông báo -- CHƯA XÁC
// MINH được đúng selector thật trên DOM X, nên thử lần lượt vài
// phương án phổ biến thay vì phụ thuộc 100% vào 1 selector duy nhất.
// Nếu không cái nào khớp, gửi tôi selector đúng để thêm vào danh sách.
const NOTIFICATION_ITEM_SELECTORS = [
  '[data-testid="cellInnerDiv"]',
  '[data-testid="notification"]',
  'article',
];

async function locateNotificationItems(page) {
  for (const sel of NOTIFICATION_ITEM_SELECTORS) {
    const items = page.locator(sel);
    const count = await items.count().catch(() => 0);
    if (count > 0) return items;
  }
  return null;
}

async function checkNotifications(page, log, moveMouseVisibly, clickVisibly, mood,deps) {
  const tab = page.locator('[data-testid="AppTabBar_Notifications_Link"]');
  const tabVisible = await tab.first().isVisible({ timeout: 1000 }).catch(() => false);
  if (!tabVisible) return;

  // BỌC try/finally: dù bất kỳ bước nào bên trong throw lỗi (kể cả sau
  // khi đã điều hướng rời khỏi Home), vẫn LUÔN cố quay lại Home ở cuối
  // -- trước đây nếu click nút back lỗi thì backToHome() bị bỏ qua
  // luôn, để script kẹt lại ở màn chi tiết 1 thông báo.
  try {
    await dismissRandomNotice(page, log, deps);
    await clickVisibly(page, tab.first());
    log('[browse] Ghé xem Thông báo...');
    const scale = moodDwellScale(mood);
    await page.waitForTimeout(humanBetween(1500, 3500) * scale);

    // Thỉnh thoảng chỉ LIẾC qua rồi rời đi ngay, không bấm vào thông báo
    // nào cả.
    const justGlance = Math.random() < 0.22;
    if (!justGlance) {
      // Xem ĐÚNG 1 thông báo rồi thôi -- KHÔNG bấm nút back trên toolbar
      // (app-bar-back) để quay lại danh sách xem thêm cái khác nữa; đã
      // bỏ hành vi đó theo yêu cầu. Việc quay lại Home đã có backToHome()
      // ở khối finally bên dưới lo, không cần điều hướng lùi ở đây nữa.
      const items = await locateNotificationItems(page);
      const count = items ? await items.count().catch(() => 0) : 0;
      if (count > 0) {
        const item = items.nth(Math.floor(Math.random() * count));
        await dismissRandomNotice(page, log, deps);
        await clickVisibly(page, item).catch(() => {});
        log('[browse] Xem 1 thông báo...');
        await page.waitForTimeout(randomBetween(1500, 3500) * scale);
      }
    } else {
      log('[browse] Chỉ liếc qua Thông báo rồi rời đi...');
    }
  } finally {
    await backToHome(page, log, moveMouseVisibly, clickVisibly).catch(() => {});
  }
}

async function checkExplore(page, log, moveMouseVisibly, clickVisibly, mood,deps) {
  const tab = page.locator('[data-testid="AppTabBar_Explore_Link"]');
  const tabVisible = await tab.first().isVisible({ timeout: 1000 }).catch(() => false);
  if (!tabVisible) return;

  try {
    await dismissRandomNotice(page, log, deps);
    await clickVisibly(page, tab.first());
    log('[browse] Ghé xem Explore/Trending...');
    const scale = moodDwellScale(mood);
    await page.waitForTimeout(humanBetween(1500, 3500) * scale);

    let scrollCount = mood.name === 'skimmer' ? randomInt(0, 2) : randomInt(1, 3);
    scrollCount = maybeAbandonEarly(mood, scrollCount);
    for (let i = 0; i < scrollCount; i++) {
      if (Math.random() < 0.6) await ambientMouseMove(page, moveMouseVisibly); // không phải lần cuộn nào cũng cần di chuột trước
      await momentumScroll(page, randomBetween(200, 550));
      await page.waitForTimeout(randomBetween(1000, 2500) * scale);
    }
  } finally {
    await backToHome(page, log, moveMouseVisibly, clickVisibly).catch(() => {});
  }
}

async function checkMessages(page, log, moveMouseVisibly, clickVisibly, mood,deps) {
  const tab = page.locator('[data-testid="AppTabBar_DirectMessage_Link"]');
  const tabVisible = await tab.first().isVisible({ timeout: 1000 }).catch(() => false);
  if (!tabVisible) return;

  try {
    await dismissRandomNotice(page, log, deps);
    await clickVisibly(page, tab.first());
    log('[browse] Ghé check tin nhắn...');
    await page.waitForTimeout(humanBetween(1500, 4000) * moodDwellScale(mood));
  } finally {
    await backToHome(page, log, moveMouseVisibly, clickVisibly).catch(() => {});
  }
}

async function checkProfile(page, log, moveMouseVisibly, clickVisibly, mood) {
  const tab = page.locator('[data-testid="AppTabBar_Profile_Link"]');
  const tabVisible = await tab.first().isVisible({ timeout: 1000 }).catch(() => false);
  if (!tabVisible) return;

  try {
    await clickVisibly(page, tab.first());
    log('[browse] Ghé xem bài viết của mình...');
    const scale = moodDwellScale(mood);
    await page.waitForTimeout(humanBetween(1500, 3500) * scale);

    let scrollCount = mood.name === 'skimmer' ? randomInt(0, 2) : randomInt(1, 3);
    scrollCount = maybeAbandonEarly(mood, scrollCount);
    for (let i = 0; i < scrollCount; i++) {
      if (Math.random() < 0.6) await ambientMouseMove(page, moveMouseVisibly); // không phải lần cuộn nào cũng cần di chuột trước
      await momentumScroll(page, randomBetween(200, 550));
      await page.waitForTimeout(randomBetween(1000, 2500) * scale);
    }
  } finally {
    await backToHome(page, log, moveMouseVisibly, clickVisibly).catch(() => {});
  }
}

async function checkBookmarks(page, log, moveMouseVisibly, clickVisibly, mood,deps) {
  const link = page.locator('[aria-label="History"]');
  const linkVisible = await link.first().isVisible({ timeout: 1000 }).catch(() => false);
  if (!linkVisible) return;

  try {
    await dismissRandomNotice(page, log, deps);
    await clickVisibly(page, link.first());
    log('[browse] Ghé xem Bookmarks...');
    const scale = moodDwellScale(mood);
    await page.waitForTimeout(humanBetween(1500, 3500) * scale);

    let scrollCount = mood.name === 'skimmer' ? randomInt(0, 1) : randomInt(1, 2);
    scrollCount = maybeAbandonEarly(mood, scrollCount);
    for (let i = 0; i < scrollCount; i++) {
      if (Math.random() < 0.6) await ambientMouseMove(page, moveMouseVisibly); // không phải lần cuộn nào cũng cần di chuột trước
      await momentumScroll(page, randomBetween(200, 550));
      await page.waitForTimeout(randomBetween(1000, 2500) * scale);
    }
  } finally {
    await backToHome(page, log, moveMouseVisibly, clickVisibly).catch(() => {});
  }
}

const EXCURSION_HANDLERS = {
  notifications: checkNotifications,
  explore: checkExplore,
  messages: checkMessages,
  profile: checkProfile,
  bookmarks: checkBookmarks,
};

// X thỉnh thoảng tự bật lên đủ loại popup không báo trước lúc nào -- nút
// đóng popup thật có data-testid="app-bar-close". TRƯỚC ĐÂY dùng selector
// quá rộng [role="button"][aria-label="Close"] -- X.com có RẤT NHIỀU nút
// "X" khác nhau cho nhiều mục đích khác nhau (xoá gợi ý, ẩn bài khỏi
// timeline...), selector rộng dễ bấm trúng nhầm nút không phải "đóng
// popup", đẩy trang vào trạng thái lạ rồi kéo theo hàng loạt lượt
// backToHome() không cần thiết (nhìn giống F5 liên tục) -- xác nhận từ
// quan sát thực tế lúc chạy, không phải suy đoán.
async function dismissCloseButtonIfPresent(page, log, clickVisibly,deps) {
  const closeBtn = page.locator('[data-testid="app-bar-close"]');
  const present = await closeBtn.first().isVisible({ timeout: 500 }).catch(() => false);
  if (!present) return false;
  await dismissRandomNotice(page, log, deps);
  await clickVisibly(page, closeBtn.first()).catch(() => closeBtn.first().click({ timeout: 3000 }).catch(() => {}));
  log('[browse] Đóng 1 popup/overlay bất ngờ hiện ra (app-bar-close)');
  return true;
}

// Đôi khi 1 cú click vô tình đưa trang trôi về màn login -- kiểm tra
// URL trước mỗi hành động, thấy trôi về login thì tự cố quay lại Home
// bằng goBack() (KHÔNG dùng goto() theo yêu cầu). QUAN TRỌNG: luồng
// login trên X thường có NHIỀU bước con (mỗi bước tự đẩy 1 mốc lịch sử
// riêng), nên 1 lần goBack() có thể CHƯA thoát hẳn khỏi login -- nếu
// hàm này bị gọi lại LIÊN TỤC mỗi vòng lặp mà không giới hạn, sẽ gọi
// goBack() dồn dập nhiều lần trong tích tắc, lùi qua LUÔN cả Home, cả
// lần điều hướng đầu tiên tới x.com, rồi lùi RA HẲN NGOÀI x.com (ví dụ
// về lại trang trước đó trong lịch sử tab, kiểu google.com) -- ĐÃ XÁC
// NHẬN xảy ra thật khi test. Giới hạn số lần thử qua recoveryState, và
// DỪNG HẲN phiên ngay nếu phát hiện đã lùi ra khỏi x.com -- an toàn hơn
// nhiều so với cố lùi thêm (dễ lùi xa hơn nữa) hoặc cứ chạy tiếp mù
// trên 1 trang hoàn toàn không liên quan.
async function recoverIfOnLoginPage(page, log, lastAction, moveMouseVisibly, clickVisibly, recoveryState,deps) {
  const url = page.url();
  if (!url.includes('/i/flow/login') && !url.includes('/login')) return false;

  if (recoveryState.count >= CONFIG.maxLoginRecoveryAttempts) {
    log(`[browse] Vẫn ở URL giống login (${url}) sau ${recoveryState.count} lần thử goBack() -- DỪNG thử thêm, dừng phiên để an toàn.`);
    recoveryState.giveUp = true;
    return true;
  }

  recoveryState.count++;
  log(`[browse] Bị trôi về trang login (${url}) sau hành động "${lastAction || 'không rõ'}" -- goBack() lần ${recoveryState.count}/${CONFIG.maxLoginRecoveryAttempts}.`);
  await page.goBack({ timeout: 15000 }).catch(() => {});

  const afterUrl = page.url();
  if (!afterUrl.includes('x.com') && !afterUrl.includes('twitter.com')) {
    log(`[browse] goBack() đã lùi RA KHỎI x.com (đang ở ${afterUrl}) -- DỪNG lại ngay, dừng phiên để an toàn.`);
    recoveryState.giveUp = true;
    return true;
  }

  const homeTab = page.locator('[data-testid="AppTabBar_Home_Link"]');
  const homeTabVisible = await homeTab.first().isVisible({ timeout: 3000 }).catch(() => false);
  if (homeTabVisible) {
    await dismissRandomNotice(page, log, deps);
    await clickVisibly(page, homeTab.first()).catch(() => {});
    await ambientMouseMove(page, moveMouseVisibly);
  } else {
    log('[browse] goBack() khỏi login không thấy tab Home -- bỏ qua, không tải lại trang.');
  }
  await page.locator('xpath=//*[text()="For you"]').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  return true;
}

// Quỹ like cho CẢ phiên, tuỳ tâm trạng.
function rollLikesBudget(mood) {
  if (mood.name === 'skimmer') return randomInt(0, 1);
  if (mood.name === 'reader') return randomInt(1, 3);
  return randomInt(1, 2);
}

// -------------------------------------------------------------------
// Hàm chính. Tổng thời lượng phiên random 20s-60s MỖI LẦN GỌI. Roll 1
// "tâm trạng phiên" duy nhất, chọn ngẫu nhiên 1 tập con các "chuyến đi"
// (phân phối lệch cho SỐ LƯỢNG, trọng số cho LOẠI, thứ tự xáo ngẫu
// nhiên riêng), rải chúng vào các mốc thời gian ngẫu nhiên trong suốt
// phiên, xen giữa hành vi nền (đọc + cuộn / ghé Following) diễn ra liên
// tục. Có watchdog tự hồi phục nếu lỗi liên tiếp quá nhiều lần.
// -------------------------------------------------------------------
// options.tasks: mảng HÀM BẤT KỲ dạng async (page) => {...} (follow/post/reply/retweet... -- file này không cần biết hàm làm gì).
//   Mỗi hàm được CHÈN VÀO GIỮA phiên lướt ở 1 thời điểm ngẫu nhiên, thứ tự xáo ngẫu nhiên. Hàm nào chạy THÀNH CÔNG thì bị XOÁ khỏi
//   chính mảng truyền vào -- sau khi gọi xong, mảng chỉ còn các hàm bị LỖI hoặc CHƯA chạy (VD phiên dừng sớm), nơi gọi tự chạy lại.
//   Thời gian chạy hàm KHÔNG trừ vào thời lượng lướt -- deadline tự lùi lại đúng bằng thời gian hàm chiếm.
// options.deadlineAt: mốc hết giờ của cả script (ms, 0 = không giới hạn) -- sắp hết giờ thì bỏ lướt, làm task liền nhau (xem CONFIG.taskTimeEstimateMs).
async function browseHomeVaried(page, log, deps = {}, options = {}) {
  const { moveMouseVisibly, clickVisibly, showVisibleCursor } = deps;
  const taskQueue = options.tasks || [];
  const tasks = shuffle(taskQueue);
  const taskName = (fn) => fn.name || 'task';
  const hardDeadline = options.deadlineAt || 0;
  const timeLeft = () => (hardDeadline ? hardDeadline - Date.now() : Infinity);
  if (!moveMouseVisibly || !clickVisibly) {
    throw new Error(
      'browseHomeVaried needs moveMouseVisibly and clickVisibly -- call it as ' +
      'browseHomeVaried(page, log, require("./helpers"))'
    );
  }

  if (showVisibleCursor) await showVisibleCursor(page);

  const mood = rollSessionMood();

  const [minDuration, maxDuration] = CONFIG.sessionDurationMsRange;
  const durationMs = randomBetween(minDuration, maxDuration);
  let deadline = Date.now() + durationMs;
  log(`[browse] Phiên lướt Home lần này dài ${Math.round(durationMs / 1000)}s, tâm trạng: ${mood.name}.`);

  // Có thể được gọi khi đang ở trang khác (VD vừa check followers ở trang Profile) -- về Home trước khi bắt đầu lướt.
  const onHome = await page.locator('xpath=//*[text()="For you"]').first().isVisible().catch(() => false);
  if (!onHome) await backToHome(page, log, moveMouseVisibly, clickVisibly, deps).catch(() => {});

  // "Khựng lại" định thần vài giây ngay khi vừa vào Home -- người thật
  // không bấm cuộn ngay tích tắc khi trang vừa load xong.
  await ambientMouseMove(page, moveMouseVisibly);
  await page.waitForTimeout(humanBetween(...CONFIG.settleInPauseMsRange));

  // Chọn ngẫu nhiên 1 TẬP CON các chuyến đi (phân phối lệch cho số
  // lượng, trọng số cho loại nào được chọn) rồi xáo thứ tự ngẫu nhiên
  // RIÊNG -- đảm bảo 2 lần chạy không bao giờ giống nhau cả về "có làm
  // gì" lẫn "thứ tự làm".
  const allExcursions = Object.keys(EXCURSION_HANDLERS);
  // Số chuyến đi "mong muốn" theo phân phối lệch, rồi CHẶN LẠI theo
  // thời lượng phiên thực tế -- phiên càng ngắn thì càng ít chuyến đi
  // khả thi, tránh trường hợp phiên 20s mà vẫn nhảy tab 3-4 lần.
  const maxAffordableExcursions = Math.max(
    0,
    Math.floor((durationMs - CONFIG.settleInPauseMsRange[1]) / CONFIG.excursionTimeBudgetMs)
  );
  const excursionCount = Math.min(rollExcursionCount(allExcursions.length, PROFILE.excursionCountWeights), maxAffordableExcursions);
  const excursions = shuffle(pickWeightedExcursions(excursionCount));
  log(`[browse] Chuyến đi phiên này (đã xáo thứ tự, ${excursions.length} việc): ${excursions.join(', ') || '(không có, chỉ đọc + cuộn)'}`);

  const earliestMs = 3000;
  const latestMs = Math.max(earliestMs + 1000, durationMs - 5000);
  const excursionTimes = excursions
    .map(() => Date.now() + humanBetween(earliestMs, latestMs))
    .sort((a, b) => a - b);

  // Mốc thời gian ngẫu nhiên cho từng task, rải trong cùng khoảng với các chuyến đi.
  const taskTimes = tasks.map(() => Date.now() + humanBetween(earliestMs, latestMs)).sort((a, b) => a - b);
  if (tasks.length) log(`[browse] Việc chèn vào giữa phiên (${tasks.length}): ${tasks.map(taskName).join(' → ')}`);

  let likesLeft = rollLikesBudget(mood);
  let excursionIndex = 0;
  let taskIndex = 0;
  let rushLogged = false;
  let nextSpecialAt = 0; // mốc sớm nhất được làm chuyến đi/task tiếp theo (xem CONFIG.specialGapMsRange)
  let lastAction = 'start';
  let consecutiveErrors = 0;
  const recoveryState = { count: 0, giveUp: false }; // theo dõi số lần thử goBack() thoát login xuyên suốt cả phiên

  // Lùi deadline + mọi mốc chưa tới thêm đúng thời gian task vừa chiếm -- thời gian lướt thật không bị task "ăn" mất.
  const shiftSchedule = (ms) => {
    deadline += ms;
    for (let i = excursionIndex; i < excursionTimes.length; i++) excursionTimes[i] += ms;
    for (let i = taskIndex; i < taskTimes.length; i++) taskTimes[i] += ms;
  };

  while (Date.now() < deadline || taskIndex < tasks.length) { // hết giờ mà còn task chưa chạy thì vẫn lướt tiếp tới khi chạy hết
    if (timeLeft() < CONFIG.minTimeLeftToStartTaskMs) {
      log(`[browse] Sắp hết giờ script (còn ${Math.round(timeLeft() / 1000)}s) -- dừng phiên${taskIndex < tasks.length ? `, ${tasks.length - taskIndex} việc chưa chạy để lần sau` : ''}.`);
      return false;
    }
    const rush = timeLeft() < (tasks.length - taskIndex) * CONFIG.taskTimeEstimateMs + 30000;
    if (rush && taskIndex >= tasks.length) { log(`[browse] Còn ${Math.round(timeLeft() / 1000)}s trước khi hết giờ script -- kết thúc phiên lướt sớm.`); return true; }
    if (rush && !rushLogged) { rushLogged = true; log(`[browse] Còn ${Math.round(timeLeft() / 1000)}s trước khi hết giờ script -- bỏ lướt, làm liền ${tasks.length - taskIndex} việc còn lại.`); }
    const special = rush || Date.now() >= nextSpecialAt;
    const recovered = await recoverIfOnLoginPage(page, log, lastAction, moveMouseVisibly, clickVisibly, recoveryState);
    
    await dismissRandomNotice(page, log, deps);

    if (recoveryState.giveUp) {
      log('[browse] Dừng phiên sớm -- không thể hồi phục an toàn về Home sau khi trôi khỏi login.');
      return false; // dừng sớm -- chưa lướt đủ thời lượng
    }
    if (recovered) { lastAction = 'recover'; consecutiveErrors = 0; continue; }
    await dismissCloseButtonIfPresent(page, log, clickVisibly);

    // Watchdog: lỗi liên tiếp quá nhiều -- thử quay lại Home để hồi
    // phục thay vì cứ lặp lại lỗi vô hạn. Dùng chung backToHome() (chỉ
    // bấm tab Home, không còn goto() nào).
    if (consecutiveErrors >= CONFIG.maxConsecutiveErrors) {
      log(`[browse] Lỗi liên tiếp ${consecutiveErrors} lần -- watchdog tự đưa về Home để hồi phục.`);
      if (page.isClosed()) {
        log('[browse] Trang đã đóng -- dừng hẳn phiên lướt Home (watchdog).');
        return false; // dừng sớm -- chưa lướt đủ thời lượng
      }
      await backToHome(page, log, moveMouseVisibly, clickVisibly).catch(() => {});
      consecutiveErrors = 0;
      continue;
    }

    // Tới lúc cho chuyến đi tiếp theo chưa?
    if (special && !rush && timeLeft() > 60000 && excursionIndex < excursions.length && Date.now() >= excursionTimes[excursionIndex]) {
      const name = excursions[excursionIndex];
      excursionIndex++;
      lastAction = name;
      try {
        await EXCURSION_HANDLERS[name](page, log, moveMouseVisibly, clickVisibly, mood);
        consecutiveErrors = 0;
      } catch (err) {
        // Kiểm tra NGAY TẠI ĐÂY (trong catch), không phải đoán trước --
        // lúc exception thực sự văng ra thì trang đã ở trạng thái CUỐI
        // CÙNG (đóng hay chưa), không còn race condition kiểu "vừa check
        // xong thì 1 chút sau mới đóng" như đặt check ở chỗ khác trước
        // khi lỗi xảy ra.
        if (page.isClosed()) {
          log(`[browse] Trang đã đóng (phát hiện khi xử lý lỗi chuyến đi "${name}") -- dừng hẳn phiên lướt Home.`);
          return false; // dừng sớm -- chưa lướt đủ thời lượng
        }
        consecutiveErrors++;
        log(`[browse] Chuyến đi "${name}" bị lỗi, bỏ qua: ${err.message}`);
        await page.waitForTimeout(500);
      }
      nextSpecialAt = Date.now() + humanBetween(...CONFIG.specialGapMsRange);
      continue;
    }

    // Tới lúc chèn task (follow/post/reply/retweet...) chưa? Lỗi của task KHÔNG tính vào watchdog -- log rồi lướt tiếp.
    if (special && taskIndex < tasks.length && (rush || Date.now() >= taskTimes[taskIndex])) {
      const task = tasks[taskIndex];
      taskIndex++;
      lastAction = `task:${taskName(task)}`;
      const t0 = Date.now();
      log(`[browse] Chèn việc "${taskName(task)}" vào giữa phiên lướt...`);
      let lastTaskOk = false;
      try {
        await task(page);
        lastTaskOk = true;
        log(`[browse] Việc "${taskName(task)}" xong, quay lại lướt Home.`);
      } catch (err) {
        if (page.isClosed()) {
          log(`[browse] Trang đã đóng (khi chạy việc "${taskName(task)}") -- dừng hẳn phiên lướt Home.`);
          return false; // dừng sớm -- hàm này + các hàm sau vẫn còn trong mảng tasks của nơi gọi
        }
        log(`[browse] Việc "${taskName(task)}" bị lỗi, để chạy lại sau phiên lướt: ${err.message}`);
      }
      if (lastTaskOk) taskQueue.splice(taskQueue.indexOf(task), 1); // chạy thành công -- xoá khỏi mảng của nơi gọi; lỗi thì giữ lại để nơi gọi chạy lại
      // Task làm ngay trên Home (VD retweet bài đang thấy trên feed) thì đứng nguyên đó lướt tiếp -- bấm tab Home lúc này sẽ đẩy feed về đầu.
      const stillOnHome = /^\/home\/?$/.test(new URL(page.url()).pathname);
      if (!stillOnHome) await backToHome(page, log, moveMouseVisibly, clickVisibly, deps).catch(() => {});
      shiftSchedule(Date.now() - t0);
      nextSpecialAt = Date.now() + humanBetween(...CONFIG.specialGapMsRange);
      deadline = Math.max(deadline, nextSpecialAt); // task cuối xong thì vẫn lướt thêm 1 đoạn, không thoát phiên ngay sau khi post/follow
      continue;
    }

    // Thỉnh thoảng ghé "Following" thay vì 1 nhịp đọc + cuộn bình
    // thường.
    if (Math.random() < PROFILE.followingTabVisitChance) {
      lastAction = 'followingTab';
      try {
        await visitFollowingTab(page, log, moveMouseVisibly, clickVisibly);
        consecutiveErrors = 0;
      } catch (err) {
        if (page.isClosed()) {
          log('[browse] Trang đã đóng (phát hiện khi xử lý lỗi ghé Following) -- dừng hẳn phiên lướt Home.');
          return false; // dừng sớm -- chưa lướt đủ thời lượng
        }
        consecutiveErrors++;
        log(`[browse] Ghé Following bị lỗi, bỏ qua: ${err.message}`);
        await page.waitForTimeout(500);
      }
      continue;
    }

    // Hành vi nền: đọc + cuộn
    lastAction = 'readAndScroll';
    try {
      await dismissRandomNotice(page, log, deps);
      const liked = await readAndScrollBeat(page, log, moveMouseVisibly, clickVisibly, likesLeft > 0, mood);
      if (liked) likesLeft--;
      consecutiveErrors = 0;
    } catch (err) {
      if (page.isClosed()) {
        log('[browse] Trang đã đóng (phát hiện khi xử lý lỗi đọc + cuộn) -- dừng hẳn phiên lướt Home.');
        return false; // dừng sớm -- chưa lướt đủ thời lượng
      }
      consecutiveErrors++;
      log(`[browse] Bỏ qua 1 đoạn đọc bị lỗi: ${err.message}`);
      await page.waitForTimeout(500);
    }

    await dismissRandomNotice(page, log, deps);
  }
  return true; // lướt đủ hết thời lượng phiên -- interactX dựa vào giá trị này để tính 1 lần lướt trong ngày
}

module.exports = { browseHomeVaried, ambientMouseMove, momentumScroll };

// Export riêng, CHỈ để verify-profile-diversity.js (hoặc test khác) dùng
// kiểm chứng độ đa dạng giữa các hồ sơ -- không ảnh hưởng gì tới cách
// dùng thật (require('./interactXHome').browseHomeVaried vẫn y hệt).
module.exports.__test = {
  createProfile,
  rollSessionMood,
  pickWeightedExcursions,
  rollExcursionCount,
  ambientPoint,
  CONFIG,
  MOOD_PRESETS,
  PROFILE,
};