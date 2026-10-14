/**
 * scripts/safeClickPoint.js
 * -----------------------------------------------------------------------
 * Dùng chung cho MỌI nơi cần "click an toàn vào tweetText" -- kể cả khi
 * KHÔNG biết trước bài nào (interactXHome.js đọc bài ngẫu nhiên) lẫn
 * khi biết trước bài đích cụ thể (openTweetDetail.js dùng cái này bên
 * trong nó, cho newFile_02.js).
 *
 * VẤN ĐỀ CẦN GIẢI QUYẾT: bên trong data-testid="tweetText" thường có
 * nhiều @mention/#hashtag/link được gắn thẻ <a href="..."> LỒNG bên
 * trong đoạn text đó. Click trúng ngay 1 trong số đó sẽ nhảy sang
 * trang khác hẳn (profile người được nhắc, trang tìm kiếm hashtag, hay
 * 1 link ngoài) thay vì mở đúng tweet -- hàm này tự dò và NÉ những
 * vùng đó khi chọn điểm click.
 *
 * Tách riêng ra file này (không nằm chung trong openTweetDetail.js)
 * vì interactXHome.js cần đúng phần này thôi, không cần và không dùng
 * được phần còn lại của openTweetDetail.js (hàm đó bắt buộc phải biết
 * trước href bài đích cụ thể để xác nhận, còn interactXHome.js mở bài
 * ngẫu nhiên, không có href nào để so khớp trước).
 *
 * Usage:
 *   const { pickSafeClickPoint } = require('./safeClickPoint');
 *   const p = await pickSafeClickPoint(tweetTextLocator);
 *   if (p) { await ambientMouseMove(page, moveMouseVisibly); await clickVisibly(page, p); }
 * -----------------------------------------------------------------------
 */

// Chọn 1 điểm click NGẪU NHIÊN bên trong tweetText nhưng KHÔNG rơi vào
// vùng của bất kỳ phần tử nào có href lồng bên trong (mention/hashtag/
// link). Trả về null nếu thử nhiều lần vẫn không tìm được điểm an toàn
// (hiếm -- gần như toàn bộ text đều là link).
async function pickSafeClickPoint(tweetTextLocator) {
  // "visible" theo Playwright chỉ nghĩa là "có trên DOM, không bị CSS
  // ẩn" -- KHÔNG có nghĩa là đang nằm trong khung nhìn hiện tại. X ảo
  // hoá timeline có thể render sẵn 1-2 bài NGAY DƯỚI rìa màn hình
  // (cuộn mượt hơn) -- phần tử đã "visible" nhưng mắt người chưa thấy
  // được, và boundingBox() bên dưới sẽ tính ra toạ độ NẰM NGOÀI khung
  // nhìn, khiến click trượt vào chỗ trống. Cuộn thêm nếu cần trước khi
  // tính điểm click -- không làm gì nếu đã trong tầm nhìn rồi.
  await tweetTextLocator.scrollIntoViewIfNeeded().catch(() => {});

  const box = await tweetTextLocator.boundingBox();
  if (!box) return null;

  const linkBoxes = await tweetTextLocator.locator('[href]').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    })
  ).catch(() => []);

  const isInsideAnyLink = (x, y) =>
    linkBoxes.some((lb) => x >= lb.x && x <= lb.x + lb.width && y >= lb.y && y <= lb.y + lb.height);

  const maxSampleAttempts = 12; // thử tối đa 12 điểm ngẫu nhiên trước khi bỏ cuộc
  for (let i = 0; i < maxSampleAttempts; i++) {
    const x = box.x + Math.random() * box.width;
    const y = box.y + Math.random() * box.height;
    if (!isInsideAnyLink(x, y)) {
      return { x, y, width: 1, height: 1 }; // "box" 1 điểm -- clickVisibly tự thêm lệch tâm nhỏ quanh nó
    }
  }
  return null;
}

module.exports = { pickSafeClickPoint };