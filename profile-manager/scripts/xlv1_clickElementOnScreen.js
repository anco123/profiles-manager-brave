//js
async function clickElementOnScreen(page, log, deps, element) {
  const { moveMouseVisibly } = deps;

  // 1. Chỉ kiểm tra element có tồn tại trong DOM
  if (await element.count() === 0) {
    log('[clickElementOnScreen] Element không tồn tại trong DOM.');
    return false;
  }

  // 2. Scroll trực tiếp đến element
  await element.scrollIntoViewIfNeeded();

  // 3. Lấy vị trí element sau khi scroll
  const box = await element.boundingBox();

  if (!box) {
    log('[clickElementOnScreen] Không lấy được tọa độ element.');
    return false;
  }

  // 4. Tính điểm click ở giữa element
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  // 5. Di chuyển chuột bằng hàm moveMouseVisibly hiện tại
  await moveMouseVisibly(page, x, y);

  // 6. Click tại vị trí đó
  await page.mouse.click(x, y);

  return true;
}

module.exports = { clickElementOnScreen };
