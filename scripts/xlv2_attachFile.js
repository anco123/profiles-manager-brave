/**
 * scripts/xlv2_attachFile.js
 * -----------------------------------------------------------------------
 * Đính 1 file (VD ảnh chụp từ xlv2_getScreenShot) vào ô comment/reply/đăng
 * bài của X MÀ KHÔNG dùng clipboard của hệ điều hành và KHÔNG mở cửa sổ chọn
 * file thật -- nên 4 profile chạy cùng lúc không thể dán nhầm ảnh của nhau.
 *
 * `input_image_element` (BẠN ĐIỀN SAU -- Locator hoặc chuỗi selector/xpath)
 * dùng được cho CẢ 2 trường hợp, hàm tự nhận ra:
 *   1) Là nút "thêm ảnh" (bấm vào thì X mở cửa sổ chọn file): hàm bấm thật
 *      bằng clickVisibly (có di chuột), đồng thời bắt sự kiện 'filechooser'
 *      của Playwright -> cửa sổ thật không hiện, file được gán thẳng. Trang
 *      vẫn thấy đủ chuỗi "bấm nút -> change" như người dùng thật.
 *   2) Là chính ô <input type="file"> (thường ẩn): gán file thẳng vào đó,
 *      KHÔNG có cú bấm nào trước sự kiện change -- ít giống người hơn (1).
 *
 * Mọi element đều được CHỜ (waitFor) rồi mới đụng tới, không đợi theo thời
 * gian. `opts.previewElement` (tuỳ chọn): element xuất hiện khi ảnh đã đính
 * xong (VD khung xem trước ảnh) -- có truyền thì hàm chờ nó hiện ra mới trả
 * về, nên bước kế tiếp (bấm Reply/Post) chắc chắn thấy ảnh đã sẵn sàng.
 * Lỗi chỉ ghi log rồi trả false, KHÔNG làm sập profile.
 *
 * Usage:
 *   const { xlv2_attachFile } = require('./xlv2_attachFile');
 *   const input_image_element = ' ... '; // <-- điền sau: selector/xpath (hoặc page.locator(...)) của nút thêm ảnh / ô input file
 *   const ok = await xlv2_attachFile(page, log, input_image_element, filePath, { previewElement: ' ... ' });
 *   // filePath: đường dẫn file (hoặc mảng đường dẫn nếu ô cho phép chọn nhiều file), VD giá trị trả về của xlv2_getScreenShot
 *   // trả về true nếu đã đính xong, false nếu lỗi
 * -----------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');

const toLocator = (page, el) => (typeof el === 'string' ? page.locator(el) : el).first();

async function xlv2_attachFile(page, log, input_image_element, filePath, opts = {}) {
  const tag = '[xlv2_attachFile]';
  try {
    const { timeout = 15000, previewElement = null } = opts;
    if (!input_image_element) throw new Error('chưa truyền input_image_element (nút thêm ảnh hoặc ô input file)');
    const files = (Array.isArray(filePath) ? filePath : [filePath]).filter(Boolean);
    if (files.length === 0) throw new Error('chưa truyền đường dẫn file');
    const missing = files.find((f) => !fs.existsSync(f));
    if (missing) throw new Error(`không thấy file: ${missing}`);

    const loc = toLocator(page, input_image_element);
    await loc.waitFor({ state: 'attached', timeout }); // ô input file thường bị ẩn nên chỉ cần "có trong trang"; nút bấm thì clickVisibly bên dưới tự chờ hiện ra
    const isFileInput = await loc.evaluate((el) => el.tagName === 'INPUT' && el.type === 'file');

    if (isFileInput) {
      await loc.setInputFiles(files, { timeout });
    } else {
      const { clickVisibly } = require('./helpers');
      const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout }), clickVisibly(page, loc, timeout)]); // PHẢI đăng ký chờ 'filechooser' TRƯỚC khi bấm -- không thì cửa sổ thật hiện ra và script đứng đó
      await chooser.setFiles(files);
    }

    if (previewElement) await toLocator(page, previewElement).waitFor({ state: 'visible', timeout });
    log(`${tag} Đã đính ${files.map((f) => path.basename(f)).join(', ')} (${isFileInput ? 'gán thẳng vào ô input file' : 'bấm nút + bắt filechooser'}).`);
    return true;
  } catch (e) {
    log(`${tag} LỖI: không đính được file -- bỏ qua, làm tiếp. (${String(e.message).split('\n')[0]})`);
    return false;
  }
}

module.exports = { xlv2_attachFile };
