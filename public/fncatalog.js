/**
 * public/fncatalog.js -- DANH SÁCH HÀM dùng để tương tác với trang, 1 chỗ dùng chung:
 *   - editor (trình duyệt, window.FN_CATALOG): gõ code thì gợi ý hàm (gõ "c" ra clickEl, "i" ra if...), chọn là chèn code + tự thêm require
 *   - recorder.js (server, require): bảng Alt gõ tên hàm để chọn việc làm với phần tử (thay cho các nút)
 * Mỗi hàm: id, name (tên hiện ra), keys (từ để tìm -- cả tiếng Việt không dấu cũng tìm được), group, desc, code (đoạn chèn vào editor:
 * 'SELECTOR' / 'TEXT' là chỗ cần sửa -- chèn xong tự bôi đen SELECTOR), req ({ mod: [tên hàm] } -- require cần có), act (việc tương ứng
 * ở bảng Alt của recorder, chỉ hàm làm việc với 1 phần tử). Tương tác chuột / bàn phím đều dùng hàm "người thật" của project
 * (xlv1_actions / helpers / xlv1_humanInput: lăn chuột thật, đi chuột Fitts, nhấn / gõ theo kiểu tay của profile) -- không nhảy cóc.
 */
(function (root) {
  const A = { './xlv1_actions': null }; // chỉ để nhắc tên module
  const act = (n) => ({ './xlv1_actions': [n] });
  const EL = "page.locator('SELECTOR')";
  const CATALOG = [
    // ---------------- thao tác với 1 phần tử
    { id: 'clickEl', name: 'clickEl -- Click', keys: 'click bam nhan', group: 'Thao tác', desc: 'lăn tới, đi chuột thật, nhấn kiểu người', code: `await clickEl(${EL});`, req: act('clickEl'), act: 'click' },
    { id: 'typeEl', name: 'typeEl -- Gõ chữ', keys: 'type go nhap fill input', group: 'Thao tác', desc: 'click vào ô rồi gõ kiểu người (xoá chữ cũ trước)', code: `await typeEl(${EL}, 'TEXT');`, req: act('typeEl'), act: 'type' },
    { id: 'typeElEnter', name: 'typeEl + Enter', keys: 'type go enter submit', group: 'Thao tác', desc: 'gõ xong nhấn Enter', code: `await typeEl(${EL}, 'TEXT', { enter: true });`, req: act('typeEl') },
    { id: 'hoverEl', name: 'hoverEl -- Rê chuột tới', keys: 'hover re di chuot', group: 'Thao tác', desc: 'đi chuột thật tới phần tử (không click)', code: `await hoverEl(${EL});`, req: act('hoverEl'), act: 'hover' },
    { id: 'dblClickEl', name: 'dblClickEl -- Nhấp đúp', keys: 'dblclick double nhap dup', group: 'Thao tác', desc: 'đi chuột thật rồi nhấn 2 lần sát nhau', code: `await dblClickEl(${EL});`, req: act('dblClickEl'), act: 'dblclick' },
    { id: 'rightClickEl', name: 'rightClickEl -- Chuột phải', keys: 'right chuot phai contextmenu', group: 'Thao tác', desc: 'đi chuột thật rồi nhấn chuột phải', code: `await rightClickEl(${EL});`, req: act('rightClickEl'), act: 'rightClick' },
    { id: 'checkEl', name: 'checkEl -- Tick chọn', keys: 'check tick chon checkbox radio', group: 'Thao tác', desc: 'tick checkbox / radio (đang tick rồi thì thôi)', code: `await checkEl(${EL});`, req: act('checkEl'), act: 'check' },
    { id: 'uncheckEl', name: 'checkEl(false) -- Bỏ tick', keys: 'uncheck bo tick', group: 'Thao tác', desc: 'bỏ tick (đang bỏ rồi thì thôi)', code: `await checkEl(${EL}, false);`, req: act('checkEl'), act: 'uncheck' },
    { id: 'scrollEl', name: 'scrollEl -- Cuộn tới', keys: 'scroll cuon lan', group: 'Thao tác', desc: 'lăn chuột thật cho tới khi phần tử hiện trong màn hình', code: `await scrollEl(${EL});`, req: act('scrollEl'), act: 'scroll' },
    { id: 'pressKeyEl', name: 'Click + nhấn phím', keys: 'press phim key enter tab escape', group: 'Thao tác', desc: 'click vào phần tử rồi nhấn 1 phím (TEXT = tên phím)', code: `await clickEl(${EL}); await page.keyboard.press('Enter');`, req: act('clickEl'), act: 'pressKey' },
    { id: 'selectOption', name: 'selectOption -- Chọn option', keys: 'select chon option dropdown', group: 'Thao tác', desc: 'đi chuột tới ô chọn rồi chọn giá trị', code: `await hoverEl(${EL}); await ${EL}.selectOption('VALUE');`, req: act('hoverEl'), act: 'select' },
    { id: 'setInputFiles', name: 'setInputFiles -- Tải file lên', keys: 'upload tai len file', group: 'Thao tác', desc: 'đưa file vào ô chọn file (TEXT = đường dẫn)', code: `await ${EL}.setInputFiles('duong/dan/file');`, act: 'upload' },
    { id: 'getText', name: 'getText -- Lấy chữ', keys: 'text lay chu doc', group: 'Đọc', desc: "chữ của phần tử ('' nếu không có)", code: `const text = await getText(${EL});`, req: act('getText'), act: 'getText' },
    { id: 'getAttribute', name: 'getAttribute -- Lấy thuộc tính', keys: 'attr thuoc tinh href', group: 'Đọc', desc: 'giá trị 1 thuộc tính (TEXT = tên thuộc tính, mặc định href)', code: `const v = await ${EL}.getAttribute('href');`, act: 'getAttr' },
    { id: 'count', name: 'count -- Đếm', keys: 'count dem so luong', group: 'Đọc', desc: 'số phần tử khớp selector', code: `const n = await ${EL}.count();`, act: 'count' },
    { id: 'isShown', name: 'isShown -- Đang hiện?', keys: 'isshown hien visible', group: 'Đọc', desc: 'kiểm tra ngay, không chờ (true / false)', code: `const shown = await isShown(${EL});`, req: act('isShown') },
    // ---------------- chờ / điều kiện
    { id: 'waitEl', name: 'waitEl -- Chờ hiện', keys: 'wait cho doi hien', group: 'Chờ / If', desc: 'chờ phần tử hiện ra (true / false, không ném lỗi)', code: `await waitEl(${EL}, 15000);`, req: act('waitEl'), act: 'wait' },
    { id: 'waitGone', name: 'waitGone -- Chờ mất', keys: 'wait gone cho mat bien', group: 'Chờ / If', desc: 'chờ phần tử biến mất (loading, popup...)', code: `await waitGone(${EL}, 15000);`, req: act('waitGone'), act: 'waitGone' },
    { id: 'ifClick', name: 'If hiện → Click', keys: 'if neu hien click', group: 'Chờ / If', desc: 'chờ tối đa 5s, có thì click, không thì bỏ qua', code: `if (await waitEl(${EL}, 5000)) await clickEl(${EL});`, req: { './xlv1_actions': ['waitEl', 'clickEl'] }, act: 'ifClick' },
    { id: 'ifType', name: 'If hiện → Gõ', keys: 'if neu hien go type', group: 'Chờ / If', desc: 'chờ tối đa 5s, có thì gõ', code: `if (await waitEl(${EL}, 5000)) await typeEl(${EL}, 'TEXT');`, req: { './xlv1_actions': ['waitEl', 'typeEl'] }, act: 'ifType' },
    { id: 'ifHover', name: 'If hiện → Hover', keys: 'if neu hien hover', group: 'Chờ / If', desc: 'chờ tối đa 5s, có thì rê chuột tới', code: `if (await waitEl(${EL}, 5000)) await hoverEl(${EL});`, req: { './xlv1_actions': ['waitEl', 'hoverEl'] }, act: 'ifHover' },
    { id: 'ifShownBlock', name: 'if (isShown) { ... }', keys: 'if neu block', group: 'Chờ / If', desc: 'khối if theo phần tử đang hiện', code: `if (await isShown(${EL})) {\n  \n}`, req: act('isShown') },
    { id: 'ifElse', name: 'if / else if / else', keys: 'if else neu khong', group: 'Chờ / If', desc: 'rẽ nhánh theo phần tử nào đang hiện', code: `if (await isShown(page.locator('SELECTOR'))) {\n  \n} else if (await isShown(page.locator('SELECTOR_B'))) {\n  \n} else {\n  log('Không thấy phần tử nào');\n}`, req: act('isShown') },
    { id: 'waitAny', name: 'waitAny -- Nhánh: cái nào hiện trước', keys: 'waitany nhanh branch cai nao truoc', group: 'Chờ / If', desc: 'chờ nhiều phần tử, cái nào hiện trước thì làm việc của nó', code: `const which = await waitAny([page.locator('SELECTOR'), page.locator('SELECTOR_B')], 15000);\nif (which === 0) {\n  \n} else if (which === 1) {\n  \n} else {\n  log('Không thấy cái nào');\n}`, req: act('waitAny') },
    // ---------------- vòng lặp
    { id: 'whileTrue', name: 'while (true) -- lặp tới khi break', keys: 'while lap loop vong', group: 'Vòng lặp', desc: 'mỗi vòng xét lần lượt các if, gặp cái nào thì làm rồi quét lại', code: `while (true) {\n  if (await isShown(page.locator('SELECTOR'))) { await clickEl(page.locator('SELECTOR')); continue; }\n  if (await isShown(page.locator('SELECTOR_DONE'))) break;\n  await pause(page, 400, 800);\n}`, req: { './xlv1_actions': ['isShown', 'clickEl', 'pause'] } },
    { id: 'forEachItem', name: 'for ... of -- với từng item', keys: 'for each tung item lap danh sach', group: 'Vòng lặp', desc: 'làm 1 việc trên từng item của danh sách', code: `for (const item of await page.locator('SELECTOR').all()) await clickEl(item.locator('SELECTOR_TRONG_ITEM'));`, req: act('clickEl') },
    { id: 'whileHandle', name: 'whileHandle -- xử lý popup tới khi xong', keys: 'whilehandle popup xu ly', group: 'Vòng lặp', desc: 'phần tử nào hiện thì làm việc của nó, tới khi gặp done', code: `const res = await whileHandle([\n  { el: page.locator('SELECTOR'), click: true },\n  { el: page.locator('SELECTOR_DONE'), done: true },\n], { timeout: 60000 });\nif (!res.ok) throw new Error('whileHandle: ' + res.reason);`, req: act('whileHandle') },
    // ---------------- tab
    { id: 'clickNewTab', name: 'clickNewTab -- Click mở tab mới', keys: 'tab moi newtab popup', group: 'Tab', desc: 'click rồi xem có tab mới không (null = không), xong đóng tab phụ', code: `const newTab = await clickNewTab(${EL});\nif (newTab) {\n  \n}\nawait closeOtherTabs(page);`, req: { './xlv1_actions': ['clickNewTab', 'closeOtherTabs'] } },
    { id: 'closeOtherTabs', name: 'closeOtherTabs -- Đóng tab phụ', keys: 'dong tab close', group: 'Tab', desc: 'đóng hết tab, chỉ giữ tab đầu tiên', code: `await closeOtherTabs(page);`, req: act('closeOtherTabs') },
    // ---------------- trang
    { id: 'goto', name: 'page.goto -- Mở trang', keys: 'goto mo trang url', group: 'Trang', desc: 'mở 1 URL', code: `await page.goto('https://');` },
    { id: 'reload', name: 'page.reload -- Tải lại', keys: 'reload tai lai', group: 'Trang', desc: 'tải lại trang', code: `await page.reload();` },
    { id: 'goBack', name: 'page.goBack -- Quay lại', keys: 'back quay lai', group: 'Trang', desc: 'về trang trước', code: `await page.goBack();` },
    { id: 'loadState', name: 'waitForLoadState -- Chờ tải xong', keys: 'load cho tai xong', group: 'Trang', desc: 'chờ trang tải xong DOM', code: `await page.waitForLoadState('domcontentloaded');` },
    { id: 'screenshot', name: 'xlv2_getScreenShot -- Chụp màn hình', keys: 'screenshot chup man hinh anh', group: 'Trang', desc: 'chụp các phần tử, lưu theo dòng Excel', code: `await xlv2_getScreenShot(page, log, [${EL}], row.__excelRow);`, req: { './xlv2_getScreenShot': ['xlv2_getScreenShot'] } },
    // ---------------- chuột / bàn phím kiểu người (không nhảy cóc)
    { id: 'moveMouseVisibly', name: 'moveMouseVisibly -- Đi chuột tới điểm', keys: 'move di chuot mouse toa do', group: 'Chuột / phím', desc: 'đi chuột kiểu người (Fitts) tới toạ độ x, y', code: `await moveMouseVisibly(page, X, Y);`, req: { './helpers': ['moveMouseVisibly'] } },
    { id: 'ambientMouseMove', name: 'ambientMouseMove -- Lượn chuột vu vơ', keys: 'ambient luon chuot idle ranh', group: 'Chuột / phím', desc: 'lượn chuột nhẹ như người đang đọc (trong lúc chờ)', code: `await ambientMouseMove(page, moveMouseVisibly);`, req: { './xlv3_interactXHome': ['ambientMouseMove'], './helpers': ['moveMouseVisibly'] } },
    { id: 'pause', name: 'pause -- Nghỉ ngẫu nhiên', keys: 'pause nghi cho sleep wait', group: 'Chuột / phím', desc: 'nghỉ min..max ms, rung chuột nhẹ trong lúc chờ', code: `await pause(page, 800, 2000);`, req: act('pause') },
    { id: 'humanType', name: 'humanType -- Gõ phím kiểu người', keys: 'humantype go phim', group: 'Chuột / phím', desc: 'gõ vào chỗ đang focus, nhịp gõ của profile', code: `await humanType(page, 'TEXT');`, req: { './xlv1_humanInput': ['humanType'] } },
    { id: 'humanWheel', name: 'humanWheel -- Lăn chuột', keys: 'wheel lan chuot cuon', group: 'Chuột / phím', desc: 'lăn chuột thật (dương = xuống)', code: `await humanWheel(page, 600);`, req: { './xlv1_humanInput': ['humanWheel'] } },
    { id: 'keyPress', name: 'keyboard.press -- Nhấn phím', keys: 'press phim key enter escape tab', group: 'Chuột / phím', desc: 'nhấn 1 phím (Enter, Escape, Tab, Control+A...)', code: `await page.keyboard.press('Enter');` },
    // ---------------- dữ liệu
    { id: 'row', name: 'row -- Dòng Excel của profile', keys: 'row dong input excel', group: 'Dữ liệu', desc: 'dòng Excel / input của profile đang chạy (row.D, row.__excelRow...)', code: `const row = input ? JSON.parse(input) : {};` },
    { id: 'readGoogleSheetCell', name: 'readGoogleSheetCell -- Đọc ô Google Sheet', keys: 'sheet google doc o', group: 'Dữ liệu', desc: 'ô ở dòng hiện tại, cột (chữ / tên cột), tab', code: `const v = readGoogleSheetCell(row, 'D', 'TAB');`, req: { './readGoogleSheetCell': ['readGoogleSheetCell'] } },
    { id: 'readExcelCell', name: 'readExcelCell -- Đọc ô Excel', keys: 'excel doc o read', group: 'Dữ liệu', desc: 'đọc 1 ô của snapshot Excel (dòng, cột)', code: `const v = readExcelCell(row.__excelRow, 'D');`, req: { './xlv1_readExcelCell': ['readExcelCell'] } },
    { id: 'writeExcelCell', name: 'writeExcelCell -- Ghi ô Excel', keys: 'excel ghi o write', group: 'Dữ liệu', desc: 'ghi kết quả vào 1 ô (dòng, cột, giá trị)', code: `await writeExcelCell(row.__excelRow, 'J', 'Done');`, req: { './writeExcelCell': ['writeExcelCell'] } },
    { id: 'log', name: 'log -- Ghi log', keys: 'log in ghi', group: 'Dữ liệu', desc: 'hiện 1 dòng ở màn hình Run', code: `log('TEXT');` },
    // ---------------- cú pháp
    { id: 'tryCatch', name: 'try / catch', keys: 'try catch loi bat', group: 'Cú pháp', desc: 'bắt lỗi, chạy tiếp', code: `try {\n  \n} catch (e) {\n  log('Lỗi: ' + e.message);\n}` },
    { id: 'throw', name: 'throw -- Báo lỗi dừng script', keys: 'throw loi dung', group: 'Cú pháp', desc: 'dừng script với 1 lỗi', code: `throw new Error('TEXT');` },
  ];
  // Bỏ dấu tiếng Việt + chữ thường -- gõ "go" cũng ra "Gõ", "nhanh" ra "Nhánh"
  const fold = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u0111/g, 'd').replace(/\u0110/g, 'D').toLowerCase();
  // Tìm hàm theo chữ đang gõ: khớp ĐẦU TÊN hàm xếp đầu (gõ "i" ra if..., "c" ra clickEl), rồi khớp đầu 1 từ khoá, rồi khớp giữa chừng;
  // cùng mức thì giữ thứ tự danh sách
  function search(list, q, limit = 12) {
    const f = fold(q).trim();
    if (!f) return [];
    const out = [];
    list.forEach((it, i) => {
      const words = fold(`${it.id} ${it.name} ${it.keys || ''}`).split(/[^a-z0-9]+/).filter(Boolean), hay = words.join(' ');
      const head = [fold(it.id), fold(it.name).split(/[^a-z0-9]+/).filter(Boolean)[0] || ''];
      const sc = head.some((w) => w.startsWith(f)) ? 3 : words.some((w) => w.startsWith(f)) ? 2 : hay.includes(f) ? 1 : 0;
      if (sc) out.push({ it, sc, i });
    });
    return out.sort((a, b) => b.sc - a.sc || a.i - b.i).slice(0, limit).map((x) => x.it);
  }
  const api = { CATALOG, search, fold };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FN_CATALOG = api;
})(typeof window !== 'undefined' ? window : this);
