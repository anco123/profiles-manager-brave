/**
 * recorder.js -- ghi lại thao tác tay trên cửa sổ profile đang mở rồi sinh code dùng scripts/xlv1_actions.js (clickEl, typeEl, ...).
 * -----------------------------------------------------------------------
 * - startRecorder(id, context): gắn binding window.__pmRec + init script vẽ nút "⏺ REC" (góc dưới phải, kéo được) vào mọi trang.
 *   Bấm nút REC = bắt đầu ghi 1 ĐOẠN; đang ghi bấm lại = TẠM DỪNG (bấm nữa = ghi TIẾP vào cùng đoạn, nối nhiều lần ghi thành 1 đoạn);
 *   nút ⏹ Xuất = kết thúc đoạn + xuất code cả đoạn (editor đang mở tự chèn vào chỗ con trỏ, kèm copy clipboard).
 *   Nút ☰ cạnh đó -> bảng các bước đã ghi: đổi hành động, đổi selector, ⬆ cha / ⬇ con, sửa chữ gõ, xoá bước, xem code.
 * - Giữ Alt + rê chuột: bảng các lớp phần tử chồng nhau dưới con trỏ (elementsFromPoint -- cả lớp phủ trong suốt lẫn nút bị đè bên dưới),
 *   lăn chuột để đổi lớp, nhả Alt thì bảng đứng yên để chọn selector (đếm số khớp bằng chính Playwright) + hành động.
 * - Trang ghi gì: click, gõ (gộp cả ô thành 1 bước), Enter, chọn <select>, chuyển trang. Chỉ sự kiện THẬT (isTrusted) -- nhưng chuột/phím
 *   của Playwright cũng là "thật", nên server.js tự tạm dừng ghi trong lúc Run script (pauseRecorder).
 * - Sau cú click: mở tab mới -> click + chờ tab mới (không chắc có mở nên bọc if), các bước ghi ở tab mới LỒNG vào trong if (chạy trên
 *   tab đó), sau if đóng hết tab chỉ giữ tab đầu tiên (closeOtherTabs); muốn thì đổi sang page.goto (đọc href lúc chạy / URL cố định).
 *   Tải file -> chờ download.
 * - While: mở While (đầu bảng Alt / bảng ☰) -> các bước chọn / ghi sau đó thành các `if (có element) {...; continue;}` trong
 *   `while (true)` (quét lại từ đầu sau mỗi lần làm; giới hạn số giây là tuỳ chọn); thoát bằng "If có → Break" hoặc tick "rồi Break"
 *   ở 1 If; "có trong DOM" = điều kiện count() > 0 (kể cả đang ẩn) thay vì đang hiện. Đóng While -> ghi tiếp như thường.
 *   Hộp thoại alert/confirm không cần ghi: Playwright tự đóng (dismiss) cả lúc ghi lẫn lúc chạy script.
 * - Gõ chữ: so với dòng Excel / Google Sheet của profile đang ghi (snapshot đã import ở editor) -> gợi ý thay chữ cố định bằng
 *   row.U / readGoogleSheetCell(row, 'D', 'TAB'); không khớp thì vẫn chọn tay được từ danh sách cột.
 * - Nhánh: mở Nhánh -> các phần tử chọn sau đó thành các nhánh của 1 waitAny([...]) -- cái nào hiện trước thì làm việc của nhánh đó.
 * - Selector: bỏ chữ phụ thuộc ngôn ngữ khi có lựa chọn khác (mỗi profile 1 locale); thêm được chữ ngôn ngữ khác (name: /^(Like|Thích)$/);
 *   tự ghép selector dự phòng .or(...) khi có 2 selector duy nhất khác loại.
 * - Gợi ý sau click: thấy phần tử mới hiện ra (popup, thông báo...) -> đề xuất thêm bước "Chờ hiện"; click lặp lại cùng 1 kiểu phần tử
 *   trên nhiều item (VD Like nhiều bài) -> đề xuất gộp thành vòng `for (const item of ...all())`.
 * - Ghi được click / gõ trong iframe (page.frameLocator(...)); bảng chọn Alt chỉ ở khung chính.
 * - Bảng ☰ hiện CODE (bấm 1 dòng để chỉnh bước đó); ▶ Chạy thử chạy đoạn đang ghi trên chính trang đó, báo bước nào hỏng.
 * - Bảng Alt CHỈ để làm việc với element (gõ tên việc: click, gõ, if hiện, chờ...). Gọi hàm ở ô ƒ của bảng ☰ (While, Nhánh, if / else,
 *   pause, goto, tab mới, Excel...): hàm có ô element -> bấm 🎯 Pick, giữ Alt chọn element, nhả Alt bấm ✓ Chốt (Enter) -> selector vào hàm.
 * - Con trỏ chèn: ⤵ ở 1 dòng = bước mới chèn sau bước đó; hàm có khối { } -> con trỏ tự vào trong khối (dòng "▸ trống" bấm để vào);
 *   ✕ = lại nối vào cuối. ↑ ↓ đi vào / ra khối (While, Nhánh, hàm có khối).
 * - Ghi theo TRƯỜNG HỢP (kiểu while + nhiều if): trong While giữ Alt lên element -> "Khi hiện / Khi KHÔNG hiện / Khi chữ là… → ghi khối",
 *   thao tác trên trang như thường (mọi bước vào trong if đó), "VÀ ... hiện / không hiện" để ghép điều kiện, ✓ Xong TH ở thanh REC
 *   -> continue (quét lại) / break (thoát While) / đi tiếp. While có giới hạn số vòng (quá thì báo lỗi) + thời gian nghỉ khi chưa khớp.
 * - Bước + trạng thái giữ ở server (recorders[id]) nên chuyển trang / reload không mất.
 * - Lưu ý: lúc đang ghi, trang có thêm window.__pmRec + 1 thẻ div (shadow DOM) -- trang web có thể thấy. Chỉ bật khi cần ghi.
 * -----------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
// Danh sách hàm dùng chung với editor (public/fncatalog.js) -- bảng Alt gõ tên hàm để chọn việc làm với phần tử
const { CATALOG } = require(path.join(__dirname, 'public', 'fncatalog.js'));
const PICK_FNS = CATALOG.filter((f) => f.act).map((f) => ({ act: f.act, name: f.name, desc: f.desc, keys: `${f.id} ${f.keys}` }));
// "Trường hợp": if (điều kiện về element) { các bước ghi sau đó ... continue / break } -- record từng trạng thái của màn hình
const CASE_FNS = [{ act: 'caseShow', name: 'Khi hiện → ghi khối', desc: 'if (đang hiện) { các bước ghi sau đó }', keys: 'khi hien if case truong hop khoi' },
  { act: 'caseHide', name: 'Khi KHÔNG hiện → ghi khối', desc: 'if (!đang hiện) { ... }', keys: 'khi khong hien not if case truong hop' },
  { act: 'caseText', name: 'Khi chữ là… → ghi khối', desc: 'if (chữ của element === ...) { ... } -- ô chữ = chữ cần so', keys: 'khi chu la text if case truong hop' }];
const AND_FNS = [{ act: 'andShow', name: 'VÀ element này hiện', desc: 'thêm điều kiện vào trường hợp đang ghi', keys: 'va and them dieu kien hien' },
  { act: 'andHide', name: 'VÀ element này KHÔNG hiện', desc: 'thêm điều kiện vào trường hợp đang ghi', keys: 'va and them dieu kien khong hien not' }];
// Bảng ☰ "Gọi hàm": mọi hàm trong danh sách (While / Nhánh dùng lệnh ghi riêng của recorder thay cho whileTrue / waitAny). Mỗi hàm gọi ở ☰
// thành 1 bước action 'fn': code mẫu (tpl -- sửa được) + các ô element (page.locator('SELECTOR...')) chọn bằng nút 🎯 Pick rồi giữ Alt
const CAT = Object.fromEntries(CATALOG.map((f) => [f.id, f]));
const CALL_FNS = CATALOG.filter((f) => !['whileTrue', 'waitAny'].includes(f.id)).map((f) => ({ fn: f.id, name: f.name, desc: f.desc, keys: `${f.id} ${f.keys}` }));
const fnKeys = (tpl) => [...new Set([...String(tpl || '').matchAll(/\b(?:page|item\w*)\.locator\('(SELECTOR\w*)'\)/g)].map((m) => m[1]))];
const SLOT_LABEL = (k) => ({ SELECTOR: 'element', SELECTOR_B: 'element B', SELECTOR_DONE: 'element "xong"', SELECTOR_TRONG_ITEM: 'trong mỗi item' }[k] || k.replace(/^SELECTOR_?/, 'element ').toLowerCase());
const holeN = (s) => String(s.tpl || '').split('\n').filter((l) => /^\s+$/.test(l)).length; // dòng chỉ có khoảng trắng = chỗ để chèn bước vào khối { }

const recorders = {}; // id profile -> { enabled, recording, segOpen, steps, seq, segFrom, exports, exportSeq, tabSeq, sources, undo }
// segOpen: đang có 1 đoạn chưa xuất (đang ghi HOẶC tạm dừng); recording: đang ghi thật -- tạm dừng = segOpen && !recording

const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
const ACTIONS = { click: 'Click', type: 'Gõ', hover: 'Hover', wait: 'Wait hiện', waitGone: 'Wait mất', ifClick: 'If hiện → Click', ifType: 'If hiện → Gõ', ifHover: 'If hiện → Hover', loop: 'While', branch: 'Nhánh', forEach: 'Với từng item', getText: 'Lấy text', scroll: 'Cuộn tới', dblclick: 'Nhấp đúp', rightClick: 'Chuột phải', check: 'Tick chọn', uncheck: 'Bỏ tick', pressKey: 'Click + phím', upload: 'Tải file lên', getAttr: 'Lấy thuộc tính', count: 'Đếm', clickTab: 'Click → tab mới (if + đóng tab phụ)', gotoLink: 'Mở link (đọc href lúc chạy)', gotoUrl: 'Mở URL cố định', press: 'Phím', select: 'Chọn option', nav: 'Mở trang', skip: 'Bỏ qua' };
// Nhãn hành động cho bước nằm TRONG While -- trong vòng lặp mọi bước đều là "if đang hiện thì ..." (click / ifClick như nhau)
const LOOP_ACTIONS = { caseShow: 'Khi hiện → ghi khối', caseHide: 'Khi KHÔNG hiện → ghi khối', caseText: 'Khi chữ là… → ghi khối', click: 'If có → Click', type: 'If có → Gõ', hover: 'If có → Hover', loopBreak: 'If có → Break (thoát While)', loopFail: 'If có → Báo lỗi', skip: 'Bỏ qua' };
// Nhãn hành động cho bước nằm trong Nhánh -- mỗi bước là 1 nhánh của waitAny: cái này hiện trước thì làm gì
const BRANCH_ACTIONS = { click: 'Hiện trước → Click', type: 'Hiện trước → Gõ', hover: 'Hiện trước → Hover', wait: 'Hiện trước → Chỉ chờ', loopFail: 'Hiện trước → Báo lỗi', skip: 'Bỏ qua' };
const HEADER = "const { useLog, isShown, waitEl, waitGone, waitAny, scrollEl, hoverEl, clickEl, typeEl, getText, pause, whileHandle, clickNewTab, closeOtherTabs, dblClickEl, rightClickEl, checkEl } = require('./xlv1_actions');\nuseLog(log);\n\n";

// Selector dựa vào CHỮ hiện ra (tên nút, aria-label, placeholder...) -- mỗi profile 1 locale nên chữ có thể khác nhau giữa các profile
const isLangCode = (code) => /getByRole\([^)]*name:|getByText\(|getByPlaceholder\(|getByLabel\(|getByTitle\(|getByAltText\(|\[(aria-label|placeholder|title|alt)=/.test(code || '');
const reEsc = (t) => String(t).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
// Thêm chữ của ngôn ngữ khác (step.langAlt = "Thích|Me gusta"): name: 'Like', exact: true -> name: /^(Like|Thích|Me gusta)$/,
// getByText('Like', { exact: true }) -> getByText(/^(...)$/), [aria-label="Like"] -> :is([aria-label="Like"],[aria-label="Thích"])
function applyLang(code, variants) {
  const vs = String(variants || '').split('|').map((v) => v.replace(/['"\\]/g, '').trim()).filter(Boolean);
  if (!vs.length || !code) return code;
  const unq = (t) => t.replace(/\\(.)/g, '$1'), rx = (t) => `/^(${[t, ...vs].map(reEsc).join('|')})$/`;
  return code.replace(/name: '((?:\\.|[^'\\])*)', exact: true/g, (m, t) => `name: ${rx(unq(t))}`)
    .replace(/(getByText|getByPlaceholder|getByLabel|getByTitle|getByAltText)\('((?:\\.|[^'\\])*)', \{ exact: true \}\)/g, (m, f, t) => `${f}(${rx(unq(t))})`)
    .replace(/\[(aria-label|placeholder|title|alt)="((?:\\.|[^"\\])*)"\]/g, (m, a, t) => `:is(${[t, ...vs].map((x) => `[${a}="${x}"]`).join(',')})`);
}
const isStrongCode = (code) => /getByTestId\(|'#[A-Za-z]|\[(data-testid|name|href|role|id|for)=/.test(code || '');
// Selector dự phòng: 1 selector khác (khác loại, cũng khớp đúng 1) ghép bằng .or(...) -- trang đổi 1 thuộc tính thì cái kia vẫn bắt được.
// Mặc định chỉ ghép khi selector chính YẾU (dựa vào chữ -- đổi theo ngôn ngữ của profile, hay chỉ type / class); chính đã chắc (testid / id /
// name...) thì thôi cho code gọn -- bảng ☰ vẫn bật tay được (step.backup = true / false). Chính dựa vào chữ thì dự phòng phải KHÔNG dựa vào chữ.
function backupOf(step) {
  const lv = step.levels?.[step.level], main = lv && (lv.alts[step.alt] || lv.alts[0]);
  if (!main || step.custom || step.backup === false || !main.unique) return null;
  const mainLang = isLangCode(main.code);
  if (step.backup !== true && isStrongCode(main.code) && !mainLang) return null;
  const key = (/'#([\w-]+)|getByTestId\('([^']+)'|\[(?:data-testid|name|id)="([^"]+)"/.exec(main.code) || []).slice(1).find(Boolean); // cùng id / testid = không phải dự phòng
  return lv.alts.find((a) => a !== main && a.unique && !a.deep && !a.nth && a.code !== main.code && a.kind !== main.kind && !(key && a.code.includes(key)) && (!mainLang || !isLangCode(a.code))) || null;
}
function selOf(step) {
  const lv = step.levels?.[step.level];
  if (!lv) return null;
  if (step.custom) return applyLang(step.custom, step.langAlt);
  const main = (lv.alts[step.alt] || lv.alts[0]).code, bk = backupOf(step);
  return applyLang(bk ? `${main}.or(${bk.code})` : main, step.langAlt);
}
// Đổi page. đầu selector (kể cả trong .or(page...)) sang tab / iframe chứa bước: tab2.frameLocator('iframe#pay').getByRole(...)
const withP = (sel, P = 'page', frame) => (sel || '').replace(/(^|\.or\()page\./g, `$1${P}.${frame ? frame + '.' : ''}`);

// Code của bước 'fn': điền selector của các ô đã chọn vào code mẫu (ô chưa chọn giữ nguyên 'SELECTOR'); item.locator(...) = tìm trong item
function fnCode(s, P = 'page') {
  let t = String(s.tpl || '');
  if (P !== 'page') t = t.replace(/\bpage\b(?=\s*[.,)])/g, P);
  for (const k of fnKeys(t)) {
    const sl = s.slots && s.slots[k], sel = sl && selOf(sl);
    if (!sel) continue;
    t = t.split(`${P}.locator('${k}')`).join(withP(sel, P, sl.frame)).replace(new RegExp(`\\b(item\\w*)\\.locator\\('${k}'\\)`, 'g'), (m, it) => sel.replace(/(^|\.or\()page\./g, `$1${it}.`));
  }
  return t;
}
// Điều kiện của 1 trường hợp: element chính (hiện / không hiện / chữ là...) && các điều kiện ghép thêm (extra)
function caseCond(s, P = 'page') {
  const one = (c) => { const sel = withP(selOf(c), P, c.frame), b = c.cond === 'dom' ? `(await ${sel}.count()) > 0` : `await isShown(${sel})`; return c.neg ? `!(${b})` : b; };
  const main = s.textEq != null && s.textEq !== '' ? `(await getText(${withP(selOf(s), P, s.frame)})) ${s.neg ? '!==' : '==='} ${q(s.textEq)}` : one(s);
  return [main, ...(s.extra || []).map(one)].join(' && ');
}
// require cần thêm cho các bước 'fn' (hàm ngoài xlv1_actions: helpers, xlv1_humanInput, Excel / Sheet...) -- { module: [tên] }
function reqOf(steps) {
  const r = {};
  for (const s of steps) for (const [m, names] of Object.entries((s.action === 'fn' && CAT[s.fn] && CAT[s.fn].req) || {})) r[m] = [...new Set([...(r[m] || []), ...names])];
  return r;
}
const reqLines = (req) => Object.entries(req).filter(([m]) => m !== './xlv1_actions').map(([m, n]) => `const { ${n.join(', ')} } = require('${m}');\n`).join('');

// P: biến của tab mà bước này chạy trên đó -- 'page' (tab đầu), hoặc tabX nếu bước được ghi ở tab mới do 1 bước clickTab mở (xem bodyOf)
function stepCode(s, P = 'page') {
  const sel = withP(selOf(s), P, s.frame), txt = s.text != null && String(s.text).startsWith('=') ? String(s.text).slice(1).trim() : q(s.text ?? '');
  const opt = s.enter ? ', { enter: true }' : '';
  switch (s.action) {
    case 'click': return s.download ? `const [dl${s.id}] = await Promise.all([${P}.waitForEvent('download'), clickEl(${sel})]); log('Đã tải: ' + dl${s.id}.suggestedFilename() + ' -> ' + await dl${s.id}.path()); // dl${s.id}.saveAs('đường dẫn') để lưu hẳn` : `await clickEl(${sel});`;
    case 'clickTab': return `const tab${s.id} = await clickNewTab(${sel}); // click rồi xem có mở tab mới không (null = không); chưa chắc ra ngay thì thêm , { tries: 3 } để tự click lại`;
    case 'type': return `await typeEl(${sel}, ${txt}${opt});`;
    case 'hover': return `await hoverEl(${sel});`;
    case 'wait': return `await waitEl(${sel}, 15000);`;
    case 'waitGone': return `await waitGone(${sel}, 15000);`;
    case 'ifClick': return `if (await waitEl(${sel}, 5000)) await clickEl(${sel});`;
    case 'ifType': return `if (await waitEl(${sel}, 5000)) await typeEl(${sel}, ${txt}${opt});`;
    case 'ifHover': return `if (await waitEl(${sel}, 5000)) await hoverEl(${sel});`;
    case 'loop': return +s.timeout > 0 ? `const end${s.id} = Date.now() + ${+s.timeout * 1000}; // While: lặp tới khi gặp break, tối đa ${+s.timeout} giây -- mỗi vòng xét lần lượt các if, gặp cái nào thì làm rồi quét lại từ đầu`
      : `while (true) { // While: lặp tới khi gặp break -- mỗi vòng xét lần lượt các if, gặp cái nào thì làm rồi quét lại từ đầu`;
    case 'getText': return `const text${s.id} = await getText(${sel}); log('text: ' + text${s.id});`;
    case 'scroll': return `await scrollEl(${sel});`;
    case 'dblclick': return `await dblClickEl(${sel});`;
    case 'rightClick': return `await rightClickEl(${sel});`;
    case 'check': return `await checkEl(${sel});`;
    case 'uncheck': return `await checkEl(${sel}, false);`;
    case 'pressKey': return `await clickEl(${sel}); await ${P}.keyboard.press(${q(s.text || 'Enter')});`;
    case 'upload': return `await ${sel}.setInputFiles(${s.text ? txt : q('duong/dan/file')});`;
    case 'getAttr': return `const attr${s.id} = await ${sel}.getAttribute(${q(s.text || 'href')}); log('attr: ' + attr${s.id});`;
    case 'count': return `const n${s.id} = await ${sel}.count(); log('số phần tử: ' + n${s.id});`;
    case 'forEach': { // gộp từ các click lặp lại: với từng item trong danh sách, làm 1 việc trên phần tử bên trong item
      const L = withP(`page.locator(${q(s.list)})`, P, s.frame), list = +s.limit > 0 ? `(await ${L}.all()).slice(0, ${+s.limit})` : `await ${L}.all()`;
      return `for (const item${s.id} of ${list}) await ${s.innerAction === 'hover' ? 'hoverEl' : 'clickEl'}(item${s.id}.locator(${q(s.inner)})); // với từng item`;
    }
    case 'branch': return `// Nhánh: chờ cái nào hiện trước`;
    case 'gotoLink': return `await ${P}.goto(new URL(await ${sel}.getAttribute('href'), ${P}.url()).href); // click mở tab mới -> mở thẳng link trong tab này`;
    case 'gotoUrl': return `await ${P}.goto(${q(s.tabUrl || s.href || '')}); // click mở tab mới -> mở thẳng URL trong tab này`;
    case 'press': return `await ${P}.keyboard.press(${q(s.key || 'Enter')});`;
    case 'select': return `await hoverEl(${sel}); await ${sel}.selectOption(${txt});`; // đi chuột tới ô chọn trước (moveMouseVisibly của project)
    case 'fn': return fnCode(s, P);
    case 'case': return `if (${caseCond(s, P)}) { ... }`;
    case 'nav': return s.auto ? `await ${P}.waitForLoadState('domcontentloaded'); // -> ${s.url}` : `await ${P}.goto(${q(s.url)});`;
    default: return '';
  }
}

// Tab mới do bước clickTab mở -> tên biến tab đó (tab<id bước>). Bước ghi ở tab đó (s.tab) được lồng vào if (tabX) {...} của bước clickTab.
function tabVars(steps) { const m = {}; for (const s of steps) if (s.action === 'clickTab' && s.opens) m[s.opens] = `tab${s.id}`; return m; }
// Bước TRONG While: if (có element -- kiểm tra ngay, không chờ) { làm; continue; } -- continue = quét lại từ đầu như whileHandle.
// s.cond === 'dom': có trong DOM (count > 0, kể cả đang ẩn), không thì phải đang hiện (isShown). s.thenBreak: làm xong thì break thay vì continue.
function loopCode(s, P = 'page') {
  const sel = withP(selOf(s), P, s.frame), txt = s.text != null && String(s.text).startsWith('=') ? String(s.text).slice(1).trim() : q(s.text ?? '');
  const lv = s.levels && s.levels[s.level], what = lv ? (lv.label || lv.tag) : '';
  const cond = s.cond === 'dom' ? `(await ${sel}.count()) > 0` : `await isShown(${sel})`, next = s.thenBreak ? 'break;' : 'continue;';
  const act = { click: `await clickEl(${sel});`, ifClick: `await clickEl(${sel});`, type: `await typeEl(${sel}, ${txt}${s.enter ? ', { enter: true }' : ''});`, ifType: `await typeEl(${sel}, ${txt}${s.enter ? ', { enter: true }' : ''});`,
    hover: `await hoverEl(${sel});`, ifHover: `await hoverEl(${sel});` }[s.action];
  if (s.action === 'loopBreak') return `if (${cond}) break; // xong -- thoát While`;
  if (s.action === 'loopFail') return `if (${cond}) throw new Error(${q('Gặp: ' + what)});`;
  return act ? `if (${cond}) { ${act} ${next} }${s.thenBreak ? ' // xong -- thoát While' : ''}` : stepCode(s, P); // bước khác (Wait, Lấy text...) để nguyên; chú thích để SAU dấu } (để trong thì nuốt mất dấu })
}
const loopIds = (steps) => new Set(steps.filter((s) => s.action === 'loop').map((s) => s.id));
// Khối chứa 1 bước: 'F<id>:<k>' (lỗ thứ k -- khối { } -- của 1 hàm gọi ở ☰) > 'L<id>' While > 'B<id>' Nhánh > 'T<tab>' tab mới > '' ngoài cùng
function parentKeyOf(steps) {
  const vars = tabVars(steps), loops = loopIds(steps), brs = branchIds(steps), fns = new Set(steps.filter((x) => x.action === 'fn').map((x) => x.id));
  const cases = new Set(steps.filter((x) => x.action === 'case').map((x) => x.id));
  return (x) => (x.blk && fns.has(headOf(x.blk)) ? x.blk : cases.has(x.cs) ? 'C' + x.cs : loops.has(x.loop) ? 'L' + x.loop : brs.has(x.br) ? 'B' + x.br : vars[x.tab] ? 'T' + x.tab : '');
}
const headOf = (key) => (key && key[0] !== 'T' ? +key.slice(1).split(':')[0] : 0); // bước mở khối (While / Nhánh / hàm)
function setParent(s, key) { s.loop = key[0] === 'L' ? headOf(key) : undefined; s.br = key[0] === 'B' ? headOf(key) : undefined; s.blk = key[0] === 'F' ? key : undefined; s.cs = key[0] === 'C' ? headOf(key) : undefined; }
const branchIds = (steps) => new Set(steps.filter((s) => s.action === 'branch').map((s) => s.id));
// Việc của 1 nhánh (cái này hiện trước thì...) -- 1 câu lệnh, đứng sau `if (whichN === k)`
function branchAct(s, P) {
  const sel = withP(selOf(s), P, s.frame), txt = s.text != null && String(s.text).startsWith('=') ? String(s.text).slice(1).trim() : q(s.text ?? '');
  const lv = s.levels && s.levels[s.level], what = lv ? (lv.label || lv.tag) : '';
  return { click: `await clickEl(${sel});`, type: `await typeEl(${sel}, ${txt}${s.enter ? ', { enter: true }' : ''});`, hover: `await hoverEl(${sel});`, loopFail: `throw new Error(${q('Gặp: ' + what)});` }[s.action] || '{} // chỉ chờ cái này hiện';
}
// Dòng code của danh sách bước, MỖI DÒNG NHỚ THUỘC BƯỚC NÀO ({ t, id }) -- bảng ☰ hiện code, bấm 1 dòng mở chỉnh bước đó.
// Mỗi bước nằm trong khối gần nhất chứa nó: While (s.loop) > Nhánh (s.br) > tab mới do clickTab mở (s.tab) > ngoài cùng.
// opt.view: bước bỏ qua vẫn hiện (dòng mờ) để còn bấm vào sửa; opt.test: chèn mốc __pmStep + coi hàm trả false là lỗi (▶ Chạy thử)
function bodyLines(steps, opt = {}) {
  const vars = tabVars(steps), pk = parentKeyOf(steps), out = [], cur = opt.cur;
  const push = (t, id, more) => out.push({ t, id, ...more });
  const okWrap = (c) => c.replace(/^await (clickEl|typeEl|hoverEl|waitEl|waitGone|scrollEl|dblClickEl|rightClickEl|checkEl)\((.*)\);(\s*\/\/.*)?$/, '__pmOk(await $1($2));$3');
  // vạch "▸ chèn vào đây" (bảng ☰): con trỏ chèn đứng sau bước `after` trong khối `key` (after = bước mở khối -> đầu khối)
  const mark = (key, after, ind) => { if (cur && cur.par === key && cur.after === after) push(`${ind}▸ bước mới sẽ chèn vào đây`, after, { cursor: true }); };
  const emit = (key, ind) => {
    mark(key, headOf(key), ind);
    for (const s of steps.filter((x) => pk(x) === key)) { one(s, key, ind); mark(key, s.id, ind); }
  };
  const one = (s, key, ind) => {
    const P = vars[s.tab] || 'page';
    if (s.action === 'fn') { // hàm gọi ở ☰: từng dòng code mẫu; dòng trống trong khối { } = chỗ chứa các bước con
      if (opt.test) push(`${ind}__pmStep = ${s.id};`, s.id);
      let h = 0;
      for (const l of fnCode(s, P).split('\n')) {
        if (!/^\s+$/.test(l)) { push(ind + l, s.id); continue; }
        const k = `F${s.id}:${h++}`;
        if (steps.some((x) => pk(x) === k) || (cur && cur.par === k)) emit(k, ind + l);
        else if (opt.view) push(`${ind}${l}// ▸ trống -- bấm để chèn bước vào đây`, s.id, { hole: k, dim: true });
      }
      return;
    }
    if (s.action === 'case') { // trường hợp: if (điều kiện) { các bước con; continue / break }
      if (opt.test) push(`${ind}__pmStep = ${s.id};`, s.id);
      const lv = s.levels && s.levels[s.level], k = 'C' + s.id;
      push(`${ind}if (${caseCond(s, P)}) { // trường hợp: ${s.textEq ? `chữ ${s.neg ? 'khác' : 'là'} "${s.textEq}"` : s.neg ? 'không hiện' : 'đang hiện'} ${(lv && (lv.label || lv.tag)) || ''}`.trimEnd(), s.id);
      if (steps.some((x) => pk(x) === k) || (cur && cur.par === k)) emit(k, ind + '  ');
      else if (opt.view) push(`${ind}  // ▸ trống -- bấm để ghi các bước vào đây`, s.id, { hole: k, dim: true });
      if (s.end === 'continue' || s.end === 'break') push(`${ind}  ${s.end};${s.end === 'break' ? ' // xong -- thoát While' : ' // quét lại từ đầu'}`, s.id);
      push(`${ind}}`, s.id);
      return;
    }
    if (s.action === 'loop' && +s.maxN > 0) push(`${ind}let n${s.id} = 0;`, s.id);
    let code = key[0] === 'L' ? loopCode(s, P) : stepCode(s, P);
    if (!code) { if (opt.view) push(`${ind}// (bỏ qua) ${(s.levels && s.levels[s.level] && s.levels[s.level].label) || s.action}`, s.id, { dim: true }); return; }
    if (opt.test) { push(`${ind}__pmStep = ${s.id};`, s.id); if (!key) code = okWrap(code); }
    if (s.action === 'branch') {
      const kids = steps.filter((x) => x.br === s.id && x.levels && x.action !== 'skip'), sec = +s.timeout || 15;
      if (!kids.length) { push(`${ind}// Nhánh: chưa có nhánh nào -- chọn phần tử khi đang mở Nhánh`, s.id); return; }
      push(`${ind}const which${s.id} = await waitAny([${kids.map((c) => withP(selOf(c), P, c.frame)).join(', ')}], ${sec * 1000}); // Nhánh: chờ cái nào hiện trước`, s.id);
      kids.forEach((c, k) => push(`${ind}${k ? 'else if' : 'if'} (which${s.id} === ${k}) ${branchAct(c, P)}`, c.id));
      push(`${ind}else log('Nhánh: hết ${sec} giây không thấy cái nào');`, s.id);
      if (opt.view) for (const c of steps.filter((x) => x.br === s.id && (!x.levels || x.action === 'skip'))) push(`${ind}// (bỏ qua) nhánh ${(c.levels && c.levels[c.level] && c.levels[c.level].label) || ''}`, c.id, { dim: true });
      return;
    }
    push(ind + code, s.id);
    if (s.action === 'loop') {
      if (+s.timeout > 0) push(`${ind}while (Date.now() < end${s.id}) {`, s.id); // không giới hạn giây thì dòng code ở trên đã là `while (true) {`
      if (+s.maxN > 0) push(`${ind}  if (++n${s.id} > ${+s.maxN}) throw new Error('While: quá ${+s.maxN} vòng mà chưa xong');`, s.id);
      emit('L' + s.id, ind + '  ');
      push(`${ind}  await ${P}.waitForTimeout(${+s.idle > 0 ? +s.idle : 500}); // chưa gặp cái nào -- nghỉ rồi quét lại`, s.id); push(`${ind}}`, s.id);
    }
    if (s.action !== 'clickTab' || !vars[s.opens]) return;
    push(`${ind}if (${vars[s.opens]}) {`, s.id);
    emit('T' + s.opens, ind + '  ');
    push(`${ind}}`, s.id); push(`${ind}await closeOtherTabs(${P}); // đóng hết tab, chỉ giữ tab đầu tiên`, s.id);
  };
  emit('', '');
  return out;
}
const bodyOf = (steps) => bodyLines(steps).map((l) => l.t).join('\n');

function buildCode(steps, withRequire = true) {
  return (withRequire ? HEADER + reqLines(reqOf(steps)) : '') + bodyOf(steps) + '\n';
}

// ---------------- gợi ý lấy chữ gõ từ Excel / Google Sheet
// Snapshot do editor ghi xuống đĩa (excel-snapshot.json: mảng dòng {A, B, ...}; google-sheet-snapshot.json: { tabs: {TÊN: {headers, rows}} }).
// Dòng của profile = dòng Excel có cột "khớp tên" (editor đang chọn) == tên profile -- giống editor; Google Sheet dùng cùng số dòng.
const readJson = (f) => { try { return f ? JSON.parse(fs.readFileSync(f, 'utf-8')) : null; } catch { return null; } };
const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const colIdx = (l) => l.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colsOf = (rows, heads) => { const set = new Set(Object.keys(heads || {})); for (const x of rows.slice(0, 200)) Object.keys(x || {}).forEach((k) => set.add(k)); return [...set].filter((k) => /^[A-Z]{1,3}$/.test(k)).sort((a, b) => colIdx(a) - colIdx(b)); };
function loadSources(o) {
  if (!o) return [];
  const out = [], excel = readJson(o.excelFile), gs = readJson(o.gsheetFile);
  let rowNum = null;
  if (Array.isArray(excel)) {
    const name = norm(o.profileName).toLowerCase(), i = o.matchColumn && name ? excel.findIndex((x) => x && norm(x[o.matchColumn]).toLowerCase() === name) : -1;
    if (i >= 0) rowNum = i + 2;
    const heads = readJson(o.excelHeaderFile) || {};
    out.push({ kind: 'excel', label: 'Excel', tab: '', rows: excel, row: i >= 0 ? excel[i] : null, heads, cols: colsOf(excel, heads) });
  }
  if (gs) {
    const tabs = gs.tabs || { '': Array.isArray(gs) ? { headers: {}, rows: gs } : gs };
    for (const [t, tab] of Object.entries(tabs)) {
      const rows = (tab && tab.rows) || [];
      out.push({ kind: 'gsheet', label: 'Sheet' + (t ? ' ' + t : ''), tab: t, rows, row: rowNum ? rows[rowNum - 2] || null : null, heads: (tab && tab.headers) || {}, cols: colsOf(rows, tab && tab.headers) });
    }
  }
  return out;
}
const srcCode = (src, c) => (src.kind === 'excel' ? `row.${c}` : `readGoogleSheetCell(row, ${q(c)}${src.tab ? ', ' + q(src.tab) : ''})`);
const srcLabel = (src, c) => `${src.label} cột ${c}${src.heads[c] ? ' · ' + norm(src.heads[c]).slice(0, 30) : ''}`;
// Chữ vừa gõ trùng ô nào: ưu tiên dòng của profile; không có thì tìm ở mọi dòng (biết được CỘT -- lúc chạy mỗi profile lấy dòng của nó)
function suggestFor(r, text) {
  const t = norm(text);
  if (!t || String(text).startsWith('=') || !r.sources) return [];
  const mine = [], other = [];
  for (const src of r.sources) for (const c of src.cols) if (src.row && norm(src.row[c]) === t) mine.push({ code: srcCode(src, c), label: srcLabel(src, c) });
  if (mine.length) return mine.slice(0, 6);
  for (const src of r.sources) for (const c of src.cols) if (src.rows.some((x) => x && norm(x[c]) === t)) other.push({ code: srcCode(src, c), label: srcLabel(src, c) + ' (dòng khác)' });
  return other.slice(0, 6);
}
// Danh sách cột để chọn tay (kèm giá trị ở dòng của profile cho dễ nhận ra)
const sourceList = (r) => (r.sources || []).map((src) => ({ label: src.label, opts: src.cols.map((c) => ({ code: srcCode(src, c), label: `${c}${src.heads[c] ? ' · ' + norm(src.heads[c]).slice(0, 30) : ''}${src.row && norm(src.row[c]) ? ' = ' + norm(src.row[c]).slice(0, 40) : ''}` })) }));

function stateOf(id) {
  const r = recorders[id];
  if (!r) return { enabled: false, recording: false, steps: [], code: '' };
  for (const s of r.steps) if (s.text != null && s.sugFor !== s.text) { s.suggest = suggestFor(r, s.text); s.sugFor = s.text; } // chỉ tính lại khi chữ đổi
  const vars = tabVars(r.steps), loops = loopIds(r.steps), brs = branchIds(r.steps), pk = parentKeyOf(r.steps);
  if (r.cur && r.cur.after && !r.steps.some((x) => x.id === r.cur.after)) r.cur = null; // bước con trỏ đứng sau đã bị xoá
  if (r.armed && !r.steps.some((x) => x.id === r.armed.stepId)) r.armed = null;
  const codeOf = (s) => (loops.has(s.loop) ? loopCode(s, vars[s.tab] || 'page') : brs.has(s.br) ? `if (...) ${branchAct(s, vars[s.tab] || 'page')}` : stepCode(s, vars[s.tab] || 'page'));
  const loopInfo = (s) => (s.action === 'loop' ? { inner: r.steps.filter((x) => x.loop === s.id).length, hasBreak: r.steps.some((x) => x.loop === s.id && (x.action === 'loopBreak' || (x.thenBreak && x.action !== 'skip') || (x.action === 'case' && x.end === 'break'))) } : {});
  const extra = (s) => ({ ...loopInfo(s), code: codeOf(s), tabVar: vars[s.tab], inLoop: loops.has(s.loop), inBranch: brs.has(s.br), lang: !!s.levels && isLangCode(s.custom || ((s.levels[s.level] || {}).alts || [])[s.alt]?.code || ((s.levels[s.level] || {}).alts || [])[0]?.code), bkCode: backupOf({ ...s, backup: true })?.code, bkOn: !!backupOf(s),
    kids: s.action === 'branch' ? r.steps.filter((x) => x.br === s.id).length : undefined, inFn: pk(s)[0] === 'F',
    caseInfo: s.action === 'case' ? { kids: r.steps.filter((x) => x.cs === s.id).length, extra: (s.extra || []).map((c) => ({ code: selOf(c), neg: !!c.neg })) } : undefined,
    slotInfo: s.action === 'fn' ? fnKeys(s.tpl).map((k) => ({ key: k, label: SLOT_LABEL(k), code: s.slots && s.slots[k] ? selOf(s.slots[k]) : null })) : undefined, holes: s.action === 'fn' ? holeN(s) : undefined });
  return { enabled: r.enabled, recording: r.recording, segOpen: r.segOpen, openLoop: loops.has(r.openLoop) ? r.openLoop : null, openBranch: brs.has(r.openBranch) ? r.openBranch : null, loopActions: LOOP_ACTIONS, branchActions: BRANCH_ACTIONS,
    lines: bodyLines(r.steps, { view: true, cur: r.cur }), cur: r.cur || null, armed: r.armed || null, inCase: r.cur && r.cur.par[0] === 'C' ? headOf(r.cur.par) : null, caseFns: CASE_FNS, andFns: AND_FNS, callFns: CALL_FNS, req: reqOf(r.steps), test: r.test || null, canRun: !!r.run, fns: PICK_FNS, segFrom: r.segFrom, exportSeq: r.exportSeq, canUndo: !!r.undo, rowNum: r.rowNum, sources: sourceList(r), steps: r.steps.map((s) => ({ ...s, ...extra(s) })), actions: ACTIONS, code: buildCode(r.steps) };
}

// Dừng 1 đoạn -> code của các bước ghi trong đoạn đó (id >= segFrom) vào hàng đợi; editor hỏi /recorder?since=... rồi tự chèn
function exportSeg(r) {
  const seg = r.steps.filter((s) => s.id >= r.segFrom);
  r.segFrom = r.seq + 1; r.segOpen = false; r.recording = false; r.openLoop = null; r.openBranch = null; r.cur = null; r.armed = null;
  if (!seg.some((s) => stepCode(s))) return null;
  const e = { id: ++r.exportSeq, count: seg.length, body: buildCode(seg, false), req: reqOf(seg) };
  r.exports.push(e);
  if (r.exports.length > 20) r.exports.shift();
  return e;
}

const sameEl = (a, b) => a && b && a.levels && b.levels && a.levels[0]?.css === b.levels[0]?.css && (a.frame || '') === (b.frame || '');

// Sự kiện từ trang -> bước. Gộp: click vào ô rồi gõ = 1 bước gõ; gõ tiếp cùng ô = cập nhật chữ; Enter sau khi gõ = enter: true.
// Bước ghi gần nhất = id lớn nhất (không phải phần tử cuối mảng: có con trỏ chèn thì bước mới nằm giữa danh sách)
const latest = (steps, skip) => { let m = null; for (const x of steps) if ((!skip || !skip(x)) && (!m || x.id > m.id)) m = x; return m; };
// Con trỏ chèn (r.cur = { after, par }): bước mới vào khối `par`, ngay sau bước `after` (after = bước mở khối -> đầu khối, 0 = đầu code);
// không có con trỏ thì nối vào cuối như cũ. Đang trong While / Nhánh theo con trỏ thì bảng Alt hiện việc của While / Nhánh.
function insertStep(r, step) {
  const c = r.cur;
  if (!c) { r.steps.push(step); return step; }
  let key = c.par, i = c.after ? r.steps.findIndex((x) => x.id === c.after) : -1;
  if (c.after && i < 0) { r.cur = null; r.steps.push(step); return step; }
  if (key[0] === 'B' && !step.levels) { const h = r.steps.find((x) => x.id === headOf(key)); key = parentKeyOf(r.steps)(h); i = r.steps.indexOf(h); } // Nhánh chỉ chứa bước có phần tử -> ra sau Nhánh
  setParent(step, key);
  r.steps.splice(i + 1, 0, step);
  r.cur = { after: step.id, par: key };
  return step;
}
function syncOpen(r) { const p = (r.cur && r.cur.par) || ''; r.openLoop = p[0] === 'L' ? headOf(p) : null; r.openBranch = p[0] === 'B' ? headOf(p) : null; }

function onEvent(r, ev, page) {
  const last = latest(r.steps), now = Date.now();
  // tab: ghi ở tab nào (undefined = tab ban đầu); loop: nằm trong While nào; br: là 1 nhánh của Nhánh nào (chỉ bước có phần tử)
  const add = (s) => insertStep(r, { id: ++r.seq, at: now, level: ev.level ?? 0, alt: 0, tab: page && page.__pmTabId, loop: r.openLoop || undefined, br: s.levels && r.openBranch ? r.openBranch : undefined, ...s });
  if (ev.kind === 'nav') {
    if (!/^https?:/.test(ev.url) || (last && last.url === ev.url && last.action === 'nav')) return;
    const tab = page && page.__pmTabId;
    if (tab && last && last.opens === tab) { last.tabUrl = ev.url; return; } // tab mới vừa mở do click (đã đổi thành clickTab / goto) -- lần tải đầu của nó không thành bước
    const auto = !!last && now - last.at < 6000 && ['click', 'type', 'press', 'ifClick'].includes(last.action);
    if (auto && r.openLoop) return; // trong While: trang tự chuyển do click -- vòng sau quét lại là đủ, không cần bước chờ tải
    return add({ action: 'nav', url: ev.url, auto, tab });
  }
  const base = { levels: ev.levels, level: ev.level, url: ev.pageUrl, href: ev.href, linkLevel: ev.linkLevel, frame: ev.frame || undefined };
  if (ev.kind === 'loop') return add({ action: 'loop', timeout: 0, loop: undefined }); // 0 = while (true), thoát bằng break
  if (ev.kind === 'branch') return add({ action: 'branch', timeout: 15, loop: undefined });
  if (ev.kind === 'effect') { // sau 1 cú click có phần tử mới hiện ra (popup, thông báo...) -> gợi ý thêm bước Chờ hiện cho cú click đó
    for (const s of [...r.steps].sort((a, b) => b.id - a.id).slice(0, 4)) {
      if (s.levels && ['click', 'ifClick'].includes(s.action) && !s.effect && !s.effectOff && !s.loop && !s.br && now - s.at < 6000) { s.effect = { levels: ev.levels, level: 0, label: ev.label, tag: ev.tag, frame: ev.frame }; break; }
    }
    return;
  }
  if (ev.kind === 'pick' && /^case(Show|Hide|Text)$/.test(ev.action)) { // mở 1 trường hợp: các bước ghi sau đó vào trong khối if này
    const s = add({ ...base, action: 'case', alt: ev.alt || 0, custom: ev.custom || null, neg: ev.action === 'caseHide', textEq: ev.action === 'caseText' ? String(ev.text ?? '') : undefined, cond: ev.cond, end: r.openLoop ? 'continue' : 'none', extra: [] });
    r.cur = { after: s.id, par: 'C' + s.id }; syncOpen(r);
    return s;
  }
  if (ev.kind === 'pick' && /^and(Show|Hide)$/.test(ev.action)) { // ghép thêm điều kiện vào trường hợp đang ghi
    const c = r.cur && r.cur.par[0] === 'C' && r.steps.find((x) => x.id === headOf(r.cur.par));
    if (c) c.extra = [...(c.extra || []), { levels: ev.levels, level: ev.level ?? 0, alt: ev.alt || 0, custom: ev.custom || null, frame: ev.frame || undefined, neg: ev.action === 'andHide' }];
    return null;
  }
  if (ev.kind === 'pick') return add({ ...base, action: ev.action, alt: ev.alt || 0, custom: ev.custom || null, text: ev.text, enter: !!ev.enter, thenBreak: !!ev.thenBreak, cond: ev.cond });
  if (ev.kind === 'click') {
    const s = add({ ...base, action: 'click', item: ev.item || undefined });
    // click giống hệt cú trước trên 1 item khác cùng danh sách (VD Like bài 1, bài 2...) -> gom nhóm, gợi ý gộp thành vòng với từng item
    const prev = latest(r.steps, (x) => x.id >= s.id);
    if (s.item && prev && prev.action === 'click' && prev.item && prev.item.list === s.item.list && prev.item.inner === s.item.inner && prev.tab === s.tab && !s.loop && !s.br && (prev.frame || '') === (s.frame || '')) {
      s.feGroup = [...(prev.feGroup || [prev.id]), s.id]; prev.feGroup = undefined;
    }
    return s;
  }
  if (ev.kind === 'type') {
    if (last && sameEl(last, ev) && last.action === 'type') { last.text = ev.value; last.at = now; return; }
    if (last && sameEl(last, ev) && last.action === 'click') { Object.assign(last, { action: 'type', text: ev.value, at: now }); return; }
    return add({ ...base, action: 'type', text: ev.value });
  }
  if (ev.kind === 'enter') {
    if (last && sameEl(last, ev) && last.action === 'type') { last.enter = true; last.at = now; return; }
    return add({ action: 'press', key: 'Enter' });
  }
  if (ev.kind === 'select') return add({ ...base, action: 'select', text: ev.value });
}

// Dựng locator từ chuỗi code KHÔNG dùng eval: chuỗi đến từ trang web (trang nào cũng gọi được window.__pmRec), eval = trang chạy code trên máy.
// Chỉ nhận dạng page.<hàm>(<chuỗi / số / true / false / {object}>).<hàm>(...)... với các hàm locator trong LOC_FNS.
const LOC_FNS = new Set(['locator', 'getByRole', 'getByText', 'getByTestId', 'getByPlaceholder', 'getByLabel', 'getByTitle', 'getByAltText', 'filter', 'first', 'last', 'nth', 'or', 'and', 'frameLocator']);
function locOf(page, code) {
  const s = String(code || ''); let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const word = () => { ws(); const m = /^[A-Za-z_$][\w$]*/.exec(s.slice(i)); if (!m) throw 0; i += m[0].length; return m[0]; };
  const val = () => {
    ws(); const c = s[i];
    if (c === "'" || c === '"') { let out = ''; for (i++; s[i] !== c; i++) { if (i >= s.length) throw 0; if (s[i] === '\\') { i++; out += s[i] === 'n' ? '\n' : s[i]; } else out += s[i]; } i++; return out; }
    if (c === '{') { i++; const o = {}; for (ws(); s[i] !== '}'; ws()) { const k = word(); ws(); if (s[i++] !== ':') throw 0; o[k] = val(); ws(); if (s[i] === ',') i++; } i++; return o; }
    if (c === '/') { let src = ''; for (i++; s[i] !== '/'; i++) { if (i >= s.length) throw 0; if (s[i] === '\\') src += s[i++]; src += s[i]; } i++; const fl = /^[gimsuy]*/.exec(s.slice(i))[0]; i += fl.length; return new RegExp(src, fl); } // name: /^(Like|Thích)$/
    if (s.startsWith('page', i) && !/[\w$]/.test(s[i + 4] || '')) return chain(); // .or(page.locator(...))
    const m = /^(-?\d+(\.\d+)?|true|false)/.exec(s.slice(i)); if (!m) throw 0; i += m[0].length; return m[0] === 'true' ? true : m[0] === 'false' ? false : +m[0];
  };
  const chain = () => {
    if (word() !== 'page') throw 0;
    let loc = page;
    for (ws(); s[i] === '.'; ws()) {
      i++;
      const fn = word(); if (!LOC_FNS.has(fn)) throw 0;
      ws(); if (s[i++] !== '(') throw 0;
      const args = []; for (ws(); s[i] !== ')'; ws()) { args.push(val()); ws(); if (s[i] === ',') i++; }
      i++; loc = loc[fn](...args);
    }
    return loc;
  };
  try {
    const loc = chain(); ws();
    return i < s.length || loc === page ? null : loc;
  } catch { return null; }
}

// Đếm số phần tử khớp bằng chính Playwright (chính xác hơn ước lượng trong trang, nhất là getByRole / getByText)
async function countLocs(page, codes) {
  return Promise.all((codes || []).slice(0, 40).map(async (c) => {
    const loc = locOf(page, c);
    if (!loc) return null;
    try { return { all: await loc.count(), vis: await loc.filter({ visible: true }).count() }; } catch { return null; }
  }));
}

// "Làm luôn trên trang" ở bảng chọn Alt: làm bằng ĐÚNG các hàm "người thật" của project (scripts/xlv1_actions.js: clickEl / hoverEl / typeEl
// -> lăn chuột thật tới phần tử, đi chuột Fitts moveMouseVisibly, nhấn humanPressMouse, gõ humanType theo kiểu tay của profile) -- KHÔNG dùng
// loc.click() / fill() của Playwright (con trỏ nhảy cóc tới phần tử, gõ tức thì = dấu vết bot ngay trên profile thật). Không làm được (không
// thấy / bị lớp khác đè...) thì báo lỗi ở bước, không bấm "chay" bằng dispatchEvent. Tạm dừng ghi trong lúc làm để không bị ghi lặp.
async function perform(r, page, s) {
  const loc = locOf(page, withP(selOf(s), 'page', s.frame));
  if (!loc) return;
  const { clickEl, hoverEl, typeEl, scrollEl, dblClickEl, rightClickEl, checkEl } = require('./scripts/xlv1_actions');
  r.recording = false;
  try {
    let ok = true;
    if (['hover', 'ifHover'].includes(s.action)) ok = await hoverEl(loc);
    else if (['click', 'ifClick'].includes(s.action)) ok = await clickEl(loc, 5000);
    else if (s.action === 'dblclick') ok = await dblClickEl(loc, 5000);
    else if (s.action === 'rightClick') ok = await rightClickEl(loc, 5000);
    else if (s.action === 'check' || s.action === 'uncheck') ok = await checkEl(loc, s.action === 'check', 5000);
    else if (s.action === 'scroll') ok = await scrollEl(loc);
    else if (s.action === 'pressKey') { ok = await clickEl(loc, 5000); if (ok) await page.keyboard.press(s.text || 'Enter'); }
    else if (['type', 'ifType'].includes(s.action) && !String(s.text ?? '').startsWith('=')) ok = await typeEl(loc, String(s.text ?? ''), { enter: !!s.enter, timeout: 5000 });
    s.error = ok ? null : 'làm trên trang không được (không thấy phần tử / bị lớp khác đè) -- xem lại selector hoặc chọn lớp khác';
  } catch (err) { s.error = 'làm trên trang lỗi: ' + String(err.message || err).split('\n')[0].slice(0, 120); } finally {
    await new Promise((res) => setTimeout(res, 900)); // sự kiện click / chữ gõ (gửi chậm 0,5s) của chính lần làm này về tới server sau 1 nhịp -- đợi rồi mới ghi tiếp
    if (r.enabled) r.recording = true;
  }
}

// iframe chứa bước -> chuỗi frameLocator(...) từ khung chính xuống (iframe lồng nhau thì nối nhiều cái). Selector của thẻ <iframe> do
// recorder ở khung cha tính (window.__pmRecSel -- móc ngắn); không có thì lấy id / name / title, cuối cùng là thứ tự iframe.
async function framePrefix(frame) {
  const parts = [];
  for (let f = frame; f && f.parentFrame(); f = f.parentFrame()) {
    const h = await f.frameElement().catch(() => null);
    const css = h && await h.evaluate((el) => {
      if (window.__pmRecSel) { const c = window.__pmRecSel(el); if (c) return c; }
      const t = el.tagName.toLowerCase(), a = (k) => el.getAttribute(k) && document.querySelectorAll(`${t}[${k}="${el.getAttribute(k)}"]`).length === 1 ? `${t}[${k}="${el.getAttribute(k)}"]` : null;
      return a('name') || a('title') || a('id') || `${t} >> nth=${[...document.querySelectorAll(t)].indexOf(el)}`;
    }).catch(() => null);
    if (!css) return null;
    parts.unshift(`frameLocator(${q(css)})`);
  }
  return parts.join('.');
}

// ▶ Chạy thử: chạy đoạn đang ghi (hoặc mọi bước) trên chính trang đang ghi qua runScriptOnProfile của server (r.run) -- giống Run thật.
// Code chạy thử có mốc __pmStep trước mỗi bước + coi clickEl / typeEl... trả false là hỏng -> báo đúng bước hỏng.
async function testRun(r) {
  if (!r.run) return { ok: false, error: 'Server chưa hỗ trợ chạy thử' };
  const steps = r.segOpen ? r.steps.filter((s) => s.id >= r.segFrom) : r.steps;
  if (!steps.length) return { ok: false, error: 'Chưa có bước nào để chạy' };
  const body = bodyLines(steps, { test: true }).map((l) => '  ' + l.t).join('\n');
  const code = HEADER + reqLines(reqOf(steps)) + (/readGoogleSheetCell\(/.test(body) && !reqOf(steps)['./readGoogleSheetCell'] ? "const { readGoogleSheetCell } = require('./readGoogleSheetCell');\n" : '') +
    "const row = input ? JSON.parse(input) : {};\nlet __pmStep = 0;\nconst __pmOk = (v) => { if (v === false) throw new Error('không làm được (hàm trả về false -- xem log)'); return v; };\n" +
    `try {\n${body}\n} catch (e) { e.message = '[pmstep:' + __pmStep + '] ' + e.message; throw e; }\n`;
  const ex = (r.sources || []).find((x) => x.kind === 'excel'), input = ex && ex.row ? JSON.stringify({ ...ex.row, __excelRow: r.rowNum }) : '';
  const t0 = Date.now(), tail = (l) => (l || []).slice(-12).map(String), was = r.recording;
  // tạm dừng ghi suốt lúc chạy thử + thêm 2,5s: chữ gõ (gửi chậm 0,5s) và gợi ý sau click (2s) của chính lần chạy thử về muộn, không được thành bước
  r.recording = false;
  try { const out = await r.run(code, input); return { ok: true, ms: Date.now() - t0, n: steps.length, logs: tail(out && out.logs) }; } catch (err) {
    const msg = String(err.message || err), m = /\[pmstep:(\d+)\]\s*/.exec(msg);
    return { ok: false, ms: Date.now() - t0, n: steps.length, step: m ? +m[1] : null, error: msg.replace(/\[pmstep:\d+\]\s*/, '').slice(0, 300), logs: tail(err.logs) };
  } finally { await new Promise((res) => setTimeout(res, 2500)); if (r.enabled && was) r.recording = true; }
}

// Đóng While / Nhánh: con trỏ chèn (nếu có) ra ngay sau khối đó
function leaveBlock(r, key) {
  r.openLoop = null; r.openBranch = null;
  if (!r.cur || !r.cur.par.startsWith(key)) return;
  const h = r.steps.find((x) => x.id === headOf(key));
  r.cur = h ? { after: h.id, par: parentKeyOf(r.steps)(h) } : null; syncOpen(r);
}
// ↑ / ↓ trong bảng ☰: đổi chỗ với bước cùng khối; bước bên cạnh là While / Nhánh / hàm có khối { } -> đi VÀO khối đó (↑: cuối khối,
// ↓: đầu khối); đang ở đầu / cuối khối -> đi RA ngoài (đứng trước / sau khối). Khối tab mới (clickTab) không ra / vào được.
function moveStep(r, id, dir) {
  const S = r.steps, pk = parentKeyOf(S), s = S.find((x) => x.id === id);
  if (!s) return;
  const key = pk(s), sibs = S.filter((x) => pk(x) === key), nb = sibs[sibs.indexOf(s) + dir];
  const take = () => S.splice(S.indexOf(s), 1);
  if (nb) {
    const holes = nb.action === 'loop' ? ['L' + nb.id] : nb.action === 'case' ? ['C' + nb.id] : nb.action === 'fn' ? Array.from({ length: holeN(nb) }, (_, k) => `F${nb.id}:${k}`) : nb.action === 'branch' && s.levels && s.action !== 'loop' ? ['B' + nb.id] : [];
    if (holes.length && s.action !== 'branch') {
      const k = dir < 0 ? holes[holes.length - 1] : holes[0], kids = S.filter((x) => pk(x) === k);
      take(); setParent(s, k);
      if (dir < 0) S.splice(kids.length ? S.indexOf(kids[kids.length - 1]) + 1 : S.indexOf(nb) + 1, 0, s);
      else S.splice(kids.length ? S.indexOf(kids[0]) : S.indexOf(nb) + 1, 0, s);
    } else { const i = S.indexOf(s), j = S.indexOf(nb); [S[i], S[j]] = [S[j], S[i]]; } // thứ tự trong mảng chỉ có nghĩa giữa các bước cùng khối
    return;
  }
  const head = key && key[0] !== 'T' && S.find((x) => x.id === headOf(key));
  if (!head) return;
  take(); setParent(s, pk(head));
  S.splice(dir < 0 ? S.indexOf(head) : S.indexOf(head) + 1, 0, s);
}

async function handle(id, page, msg, frame) {
  const r = recorders[id];
  if (!r) return { enabled: false };
  if (msg.op === 'count') return { counts: await countLocs(page, msg.codes) };
  let exported = null;
  if (msg.op === 'event' && r.recording) {
    if (frame && page && frame !== page.mainFrame()) { const fp = await framePrefix(frame); if (!fp) return stateOf(id); msg.ev.frame = fp; } // sự kiện trong iframe
    const s = onEvent(r, msg.ev, page); if (s && msg.ev.perform) await perform(r, page, s);
  }
  else if (msg.op === 'testRun') { r.test = { running: true }; r.test = await testRun(r); }
  else if (msg.op === 'testClear') r.test = null;
  else if (msg.op === 'branchStart' && r.segOpen) { r.openLoop = null; const s = onEvent(r, { kind: 'branch' }, page); r.openBranch = s.id; if (r.cur) r.cur = { after: s.id, par: 'B' + s.id }; }
  else if (msg.op === 'branchEnd') leaveBlock(r, 'B' + r.openBranch);
  else if (msg.op === 'fnAdd' && CAT[msg.fn]) { // gọi hàm ở ☰: thêm bước ở con trỏ chèn; hàm có khối { } -> con trỏ vào trong khối
    const f = CAT[msg.fn], st = insertStep(r, { id: ++r.seq, at: Date.now(), action: 'fn', fn: f.id, name: f.name, tpl: f.code, slots: {}, loop: r.openLoop || undefined });
    if (holeN(st)) { r.cur = { after: st.id, par: `F${st.id}:0` }; syncOpen(r); }
    return { ...stateOf(id), added: st.id };
  }
  else if (msg.op === 'fnSlot') { // 🎯 Pick + Chốt: element vào ô của hàm; còn ô trống thì chờ chọn tiếp ô đó
    const st = r.steps.find((x) => x.id === msg.stepId);
    if (st && st.action === 'fn' && /^SELECTOR\w*$/.test(msg.key || '')) {
      st.slots = { ...st.slots, [msg.key]: { levels: msg.levels, level: msg.level || 0, alt: msg.alt || 0, custom: msg.custom || null } };
      const next = fnKeys(st.tpl).find((k) => !st.slots[k]);
      r.armed = next ? { stepId: st.id, key: next } : null;
    }
  }
  else if (msg.op === 'caseEnd') { // ✓ Xong trường hợp: con trỏ ra ngay sau khối, về lại While (nếu có)
    const c = r.cur && r.cur.par[0] === 'C' && r.steps.find((x) => x.id === headOf(r.cur.par));
    if (c) { if (msg.end) c.end = msg.end; r.cur = { after: c.id, par: parentKeyOf(r.steps)(c) }; syncOpen(r); }
  }
  else if (msg.op === 'dropExtra') { const c = r.steps.find((x) => x.id === msg.stepId); if (c && c.extra) c.extra = c.extra.filter((_, i) => i !== msg.i); }
  else if (msg.op === 'arm') r.armed = msg.stepId ? { stepId: msg.stepId, key: msg.key } : null;
  else if (msg.op === 'cursor') { const x = r.steps.find((y) => y.id === msg.stepId); if (x) { r.cur = { after: x.id, par: parentKeyOf(r.steps)(x) }; syncOpen(r); } }
  else if (msg.op === 'cursorHole' && /^[LBFC]\d+(:\d+)?$/.test(msg.key || '')) { r.cur = { after: headOf(msg.key), par: msg.key }; syncOpen(r); }
  else if (msg.op === 'cursorOff') { r.cur = null; r.openLoop = null; r.openBranch = null; }
  else if (msg.op === 'effect') { // nhận / bỏ gợi ý "Chờ hiện" sau click
    const i = r.steps.findIndex((x) => x.id === msg.stepId), s = r.steps[i];
    if (s && s.effect && msg.accept) r.steps.splice(i + 1, 0, { id: ++r.seq, at: Date.now(), action: 'wait', levels: s.effect.levels, level: 0, alt: 0, tab: s.tab, frame: s.effect.frame });
    if (s) { s.effect = null; s.effectOff = true; }
  }
  else if (msg.op === 'forEach') { // gộp nhóm click lặp lại thành 1 bước "với từng item"
    const last = r.steps.find((x) => x.id === msg.stepId);
    if (last && last.feGroup) {
      const ids = new Set(last.feGroup), at = r.steps.findIndex((x) => ids.has(x.id));
      const fe = { id: ++r.seq, at: Date.now(), action: 'forEach', list: last.item.list, inner: last.item.inner, innerAction: 'click', limit: 0, tab: last.tab, frame: last.frame };
      r.steps = r.steps.filter((x) => !ids.has(x.id)); r.steps.splice(at, 0, fe);
    }
  }
  else if (msg.op === 'rec') { if (!r.segOpen) { r.segOpen = true; r.segFrom = r.seq + 1; } r.recording = !r.recording; } // chưa có đoạn -> mở đoạn mới; có rồi -> tạm dừng / ghi tiếp cùng đoạn
  else if (msg.op === 'export') exported = r.segOpen ? exportSeg(r) : null;
  else if (msg.op === 'clear') { if (r.steps.length) r.undo = r.steps; r.steps = []; r.cur = null; r.armed = null; r.openLoop = null; r.openBranch = null; } // giữ lại để Khôi phục
  else if (msg.op === 'undoClear') { if (r.undo) r.steps = [...r.undo, ...r.steps]; r.undo = null; }
  else if (msg.op === 'loopStart' && r.segOpen) { r.openBranch = null; const s = onEvent(r, { kind: 'loop' }, page); r.openLoop = s.id; if (r.cur) r.cur = { after: s.id, par: 'L' + s.id }; }
  else if (msg.op === 'loopEnd') leaveBlock(r, 'L' + r.openLoop);
  else if (msg.op === 'delete') { // xoá While / Nhánh / hàm có khối -> các bước bên trong ra ngoài, vào khối chứa bước bị xoá
    const pk = parentKeyOf(r.steps), d = r.steps.find((s) => s.id === msg.stepId);
    if (d) {
      const out = pk(d), inside = (s) => s.loop === d.id || s.br === d.id || s.cs === d.id || (s.blk && headOf(s.blk) === d.id);
      for (const s of r.steps) if (inside(s)) setParent(s, out);
      if (r.cur && (r.cur.after === d.id || headOf(r.cur.par) === d.id)) { const i = r.steps.indexOf(d); const prev = r.steps.slice(0, i).reverse().find((x) => pk(x) === out); r.cur = { after: prev ? prev.id : headOf(out), par: out }; }
      r.steps = r.steps.filter((s) => s !== d);
    }
    if (r.openLoop === msg.stepId) r.openLoop = null;
    if (r.openBranch === msg.stepId) r.openBranch = null;
  }
  else if (msg.op === 'move') moveStep(r, msg.stepId, msg.dir);
  else if (msg.op === 'update') {
    const s = r.steps.find((x) => x.id === msg.stepId);
    if (s) {
      const p = msg.patch || {};
      if (p.level != null && s.levels && p.level >= 0 && p.level < s.levels.length) { s.level = p.level; s.alt = 0; s.custom = null; }
      if (p.alt != null) { s.alt = p.alt; s.custom = null; }
      for (const k of ['action', 'text', 'enter', 'custom', 'url', 'key', 'auto', 'tabUrl', 'timeout', 'thenBreak', 'cond', 'langAlt', 'backup', 'list', 'inner', 'innerAction', 'limit', 'tpl', 'neg', 'textEq', 'end', 'maxN', 'idle']) if (p[k] !== undefined) s[k] = p[k];
      if (p.action === 'gotoLink' && s.linkLevel >= 0 && s.linkLevel < s.levels.length) Object.assign(s, { level: s.linkLevel, alt: 0, custom: null }); // đọc href -> chọn đúng thẻ <a>
    }
  }
  return { ...stateOf(id), exported };
}

// Tải file ngay sau 1 cú click -> bước click đó thành "click + chờ download"
function watchPage(id, page) {
  if (page.__pmRecWatch) return;
  page.__pmRecWatch = true;
  page.on('download', () => {
    const r = recorders[id], s = r && latest(r.steps);
    if (r && r.enabled && s && s.levels && s.action === 'click' && Date.now() - s.at < 5000) s.download = true;
  });
}

// Tab mới mở ra ngay sau 1 cú click -> đổi bước click thành clickTab: click + chờ tab mới, if có tab thì làm các bước ghi ở tab đó,
// xong đóng hết tab trừ tab đầu tiên (xem bodyOf). Bảng ☰ đổi được sang page.goto: gotoLink (đọc href của thẻ <a> lúc chạy) / gotoUrl.
function onNewTab(id, page) {
  watchPage(id, page);
  const r = recorders[id], t0 = Date.now();
  if (!r || !r.enabled) return;
  const tab = page.__pmTabId = ++r.tabSeq;
  setTimeout(() => { // bước click (đi qua binding) có thể về sau sự kiện mở tab 1 chút
    const isNav = (x) => x.action === 'nav' && x.tab === tab, s = latest(r.steps, isNav);
    if (!s || !s.levels || s.action !== 'click' || s.opens || s.loop || t0 - s.at > 4000) return; // trong While: giữ là click
    const navs = r.steps.filter((x) => isNav(x) && x.id > s.id);
    r.steps = r.steps.filter((x) => !navs.includes(x));
    if (r.cur && navs.some((x) => x.id === r.cur.after)) r.cur.after = s.id;
    s.opens = tab;
    s.action = 'clickTab';
    s.tabUrl = navs.length ? navs[navs.length - 1].url : /^https?:/.test(page.url()) ? page.url() : s.href || '';
  }, 400);
}

// data: { excelFile, excelHeaderFile, gsheetFile, matchColumn, profileName } -- để gợi ý row.X / readGoogleSheetCell (xem loadSources);
// data.run(code, input): chạy code trên profile này giống Run (runScriptOnProfile của server) -- cho nút ▶ Chạy thử
async function startRecorder(id, context, data) {
  if (!recorders[id]) recorders[id] = { enabled: true, recording: false, steps: [], seq: 0, segFrom: 1, exports: [], exportSeq: 0, tabSeq: 0 };
  const r = recorders[id];
  r.sources = loadSources(data); // đọc lại mỗi lần bấm Record (vừa import / sync lại thì có dữ liệu mới)
  r.run = data && data.run;
  const ex = r.sources.find((x) => x.kind === 'excel');
  r.rowNum = ex && ex.row ? ex.rows.indexOf(ex.row) + 2 : null;
  for (const s of r.steps) s.sugFor = undefined;
  if (!r.segOpen) r.segFrom = r.seq + 1; // đang tạm dừng dở 1 đoạn thì ghi tiếp vào đoạn đó
  r.enabled = true; r.recording = true; r.segOpen = true;
  if (!context.__pmRecorder) {
    context.__pmRecorder = true;
    await context.exposeBinding('__pmRec', (src, msg) => handle(id, src.page, msg, src.frame));
    await context.addInitScript(`(${pageRecorder.toString()})()`);
    context.on('page', (p) => onNewTab(id, p));
    context.on('close', () => { delete recorders[id]; });
  }
  for (const page of context.pages()) watchPage(id, page);
  // Trang đang mở sẵn: init script chỉ chạy cho lần tải trang SAU, nên chèn tay ngay bây giờ
  for (const page of context.pages()) for (const f of page.frames()) await f.evaluate(`(${pageRecorder.toString()})()`).catch(() => {}); // cả iframe đang có
  const pg = context.pages()[0];
  if (!r.steps.length && pg && /^https?:/.test(pg.url())) onEvent(r, { kind: 'nav', url: pg.url() });
  return stateOf(id);
}

async function stopRecorder(id, context) {
  const r = recorders[id];
  let exported = null;
  if (r) { if (r.segOpen) exported = exportSeg(r); r.enabled = false; r.recording = false; }
  if (context) for (const page of context.pages()) await page.evaluate(() => window.__pmRecUI && window.__pmRecUI.remove()).catch(() => {});
  return { ...stateOf(id), exported };
}

// ===================================================================== chạy TRONG trang (được toString() rồi chèn vào)
function pageRecorder() {
  const isTop = window.top === window.self; // trong iframe: chỉ ghi click / gõ / chọn (không nút REC, không bảng Alt, không ghi chuyển trang)
  if (window.__pmRecInstalled) { if (isTop && window.__pmRecMount) window.__pmRecMount(); return; } // đã gắn listener rồi (bật ghi lại lần 2) -- chỉ hiện lại nút
  window.__pmRecInstalled = true;
  const call = (msg) => (typeof window.__pmRec === 'function' ? window.__pmRec(msg) : Promise.resolve(null));
  const sq = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const cssEsc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));
  const attrEsc = (s) => String(s).replace(/["\\]/g, '\\$&');
  // id tự sinh (đổi theo lần tải / thứ tự render, nhiều layer còn trùng nhau): uid_10, :r1:, react-select-2-input, mui-123, ember45, dãy 3+ số...
  const goodId = (id) => !/\d{3,}|^[:\-_]|[-_:.]\d+([-_:.]|$)|^[a-z]+\d+$|:\w*\d\w*:/i.test(id);
  let host = null;
  const ours = (e) => host && e.composedPath().includes(host);

  // ---------------- selector
  function cssPath(el) {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
      if (n.id && goodId(n.id)) { parts.unshift('#' + cssEsc(n.id)); break; }
      const tid = n.getAttribute('data-testid');
      let part = n.tagName.toLowerCase();
      if (tid) part += `[data-testid="${tid}"]`;
      const sibs = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName && (!tid || c.getAttribute('data-testid') === tid)) : [];
      if (sibs.length > 1) part += `:nth-of-type(${[...n.parentElement.children].filter((c) => c.tagName === n.tagName).indexOf(n) + 1})`;
      parts.unshift(part);
      if (tid && document.querySelectorAll(`[data-testid="${tid}"]`).length === 1) break;
      if (n === document.body) break;
    }
    return parts.join(' > ');
  }
  const ROLE_TAG = { BUTTON: 'button', SELECT: 'combobox', TEXTAREA: 'textbox', H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading', LI: 'listitem', IMG: 'img', DIALOG: 'dialog', ARTICLE: 'article', NAV: 'navigation', MAIN: 'main' };
  function roleOf(el) {
    const r = el.getAttribute('role');
    if (r) return r.split(' ')[0];
    if (el.tagName === 'A' && el.hasAttribute('href')) return 'link';
    if (el.tagName === 'INPUT') { const t = (el.type || 'text').toLowerCase(); return t === 'checkbox' ? 'checkbox' : t === 'radio' ? 'radio' : ['button', 'submit', 'reset'].includes(t) ? 'button' : ['text', 'email', 'search', 'tel', 'url'].includes(t) ? 'textbox' : null; }
    return ROLE_TAG[el.tagName] || null;
  }
  // Tên giống "accessible name" của getByRole: ô nhập lấy aria-label / <label> / placeholder (KHÔNG lấy chữ đang gõ trong ô)
  const labelOf = (el) => { const l = (el.id && document.querySelector(`label[for="${cssEsc(el.id)}"]`)) || el.closest('label'); return l ? l.innerText : ''; };
  function nameOf(el) {
    const aria = el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') || '').split(' ').map((i) => document.getElementById(i)?.innerText || '').join(' ');
    if (clean(aria)) return clean(aria).slice(0, 60);
    if (el.tagName === 'IMG') return clean(el.alt);
    if (el.tagName === 'INPUT' && ['button', 'submit', 'reset'].includes((el.type || '').toLowerCase())) return clean(el.value);
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable) return clean(labelOf(el) || el.getAttribute('placeholder') || el.getAttribute('title')).slice(0, 60);
    return clean(el.innerText || el.textContent).slice(0, 60);
  }
  // getByRole(name) chỉ khớp khi vai trò đó LẤY TÊN TỪ CHỮ BÊN TRONG (button, link, heading...) -- li / dialog / article... không (getByRole
  // ('listitem', { name: '1' }) khớp 0 cái) trừ khi có aria-label; ô nhập / ảnh lấy tên từ label / placeholder / alt
  const NAME_FROM_TEXT = new Set(['button', 'link', 'heading', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'treeitem', 'cell', 'gridcell', 'columnheader', 'rowheader', 'row', 'tooltip']);
  const roleName = (el, role) => (NAME_FROM_TEXT.has(role) || el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') || ['INPUT', 'TEXTAREA', 'SELECT', 'IMG'].includes(el.tagName) || el.isContentEditable ? nameOf(el) : '');
  const isVis = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  // Trùng nhiều cái: chỉ 1 cái đang hiện (bản ẩn của layout mobile/desktop, menu ẩn...) -> .filter({ visible: true }); không thì mới dùng vị trí .nth()
  function withNth(code, list, el) {
    if (list.length <= 1) return { code, base: code, unique: true };
    const vis = list.filter(isVis);
    if (vis.length === 1 && vis[0] === el) return { code: `${code}.filter({ visible: true })`, base: code, unique: true, note: `${list.length} cái, 1 cái đang hiện` };
    const i = list.indexOf(el);
    return { code: i <= 0 ? `${code}.first()` : `${code}.nth(${i})`, base: code, unique: false, nth: true, note: `${list.length} cái giống` };
  }
  // ưu tiên selector khớp đúng 1 phần tử, có nghĩa (testid/id/role/...) trước đường dẫn css (dễ gãy khi trang đổi bố cục); sort ổn định -> giữ thứ tự testid > id > role > ...
  // ô nhập: name="..." đứng trước getByRole(name: aria-label) -- aria-label đổi theo ngôn ngữ giao diện (VD Discord tiếng Việt), name thì không
  // Xếp hạng (số nhỏ đứng trước): khớp đúng 1 trước; trong đó móc mạnh KHÔNG dựa vào chữ (testid / id / name / href / role) trước, có dựa
  // vào chữ hiện ra (đổi theo ngôn ngữ của profile -- mỗi profile 1 locale) sau, móc yếu (chỉ type / class / thẻ) sau nữa; ô nhập name= lên
  // đầu; đường dẫn css nhiều tầng luôn cuối
  const isLang = (code) => /getByRole\([^)]*name:|getByText\(|getByPlaceholder\(|getByLabel\(|getByTitle\(|getByAltText\(|\[(aria-label|placeholder|title|alt)=/.test(code || '');
  const isStrong = (code) => /getByTestId\(|'#[A-Za-z]|\[(data-testid|name|href|role|id|for)=/.test(code || '');
  const rank = (a) => (a.deep ? 3 : !a.unique ? 2 : a.field && a.kind === 'name' ? -1 : isStrong(a.code) ? (isLang(a.code) ? 0.5 : 0) : isLang(a.code) ? 1 : 1.5);
  const sortAlts = (alts) => alts.sort((a, b) => rank(a) - rank(b));
  // scope/pre: tìm TRONG 1 phần tử cha (scope) và viết code nối tiếp locator của cha đó (pre) -- dùng cho scopedAlts
  function altsFor(el, scope = document, pre = 'page') {
    const alts = [], tag = el.tagName.toLowerCase(), top = scope === document;
    const all = (css) => { try { return [...scope.querySelectorAll(css)]; } catch { return []; } };
    const tid = el.getAttribute('data-testid');
    if (tid) alts.push({ kind: 'testid', ...withNth(`${pre}.getByTestId(${sq(tid)})`, all(`[data-testid="${cssEsc(tid)}"]`), el) });
    if (top && el.id && goodId(el.id)) alts.push({ kind: 'id', ...withNth(`${pre}.locator(${sq('#' + cssEsc(el.id))})`, all('#' + cssEsc(el.id)), el) }); // id trùng cũng có (trang viết ẩu) -> đếm như các selector khác
    const role = roleOf(el), name = roleName(el, role);
    if (role && name && name.length <= 50) {
      const same = all('*').filter((n) => n === el || (roleOf(n) === role && roleName(n, role) === name && isVis(n)));
      alts.push({ kind: 'role', ...withNth(`${pre}.getByRole(${sq(role)}, { name: ${sq(name)}, exact: true })`, same, el) });
    }
    for (const a of ['name', 'placeholder', 'aria-label', 'type', 'href']) {
      const v = el.getAttribute(a);
      if (!v || (a === 'type' && !['INPUT', 'BUTTON'].includes(el.tagName)) || (a === 'href' && v.length > 80)) continue;
      const css = `${tag}[${a}="${attrEsc(v)}"]`, list = all(css);
      if (list.length) alts.push({ kind: a, field: ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName), ...withNth(`${pre}.locator(${sq(css)})`, list, el) });
      if (a === 'placeholder') alts.push({ kind: 'placeholder', code: `${pre}.getByPlaceholder(${sq(v)}, { exact: true })`, base: `${pre}.getByPlaceholder(${sq(v)}, { exact: true })`, unique: list.length === 1 });
    }
    const own = clean(el.innerText);
    if (own && own.length <= 40 && !alts.some((a) => a.kind === 'role')) {
      // chỉ xét phần tử nhỏ (ít con, ít chữ) -- gọi innerText cho cả nghìn khung lớn của trang thì khựng
      const same = all(top ? 'body *' : '*').filter((n) => n === el || (n.childElementCount <= 5 && (n.textContent || '').length <= 300 && clean(n.innerText) === own && ![...n.children].some((c) => clean(c.innerText) === own) && isVis(n)));
      alts.push({ kind: 'text', ...withNth(`${pre}.getByText(${sq(own)}, { exact: true })`, same.includes(el) ? same : [el], el) });
    }
    if (top) { // ghép móc của chính phần tử thành 1 selector ngắn (thay cho đường dẫn css nhiều tầng); thử bản KHÔNG dựa vào chữ trước
      const { tag, out: hs } = hooks(el), nl = hs.filter((h) => !/^\[(aria-label|placeholder|title|alt)=/.test(h));
      for (const sel of [...new Set([nl.length ? tag + nl.slice(0, 3).join('') : '', hs.length ? tag + hs.slice(0, 3).join('') : ''])].filter(Boolean)) alts.push({ kind: 'kết hợp', ...withNth(`page.locator(${sq(sel)})`, all(sel), el) });
    }
    return sortAlts(alts);
  }
  // "Móc" ổn định của 1 phần tử (mảnh selector css), mạnh trước yếu sau. Bỏ id tự sinh, class do công cụ build sinh ra
  // (input__0ed4f, css-1x2y3z, sc-bdfBwQ, r-1abc...) và giá trị có dãy số dài (đếm like, id bài viết trong href...) -- những thứ đổi theo lần tải.
  const HOOK_ATTRS = ['data-testid', 'name', 'aria-label', 'placeholder', 'role', 'type', 'title', 'alt', 'for', 'href'];
  const goodClass = (c) => /^[a-zA-Z][a-zA-Z-]{2,30}$/.test(c) && !/^(css|sc|jsx|emotion|svelte|r)-/.test(c) && (c.match(/[A-Z]/g) || []).length < 3;
  function hooks(el) {
    const tag = el.tagName.toLowerCase(), out = [];
    if (el.id && goodId(el.id)) out.push('#' + cssEsc(el.id));
    for (const a of HOOK_ATTRS) {
      const v = el.getAttribute(a);
      if (!v || v.length > 60 || /\d{3,}/.test(v) || (a === 'type' && !['INPUT', 'BUTTON'].includes(el.tagName)) || (a === 'href' && /^(javascript:|#$)/.test(v))) continue;
      out.push(`[${a}="${attrEsc(v)}"]`);
    }
    for (const c of el.classList) if (goodClass(c)) out.push('.' + cssEsc(c));
    return { tag, out: out.slice(0, 8) };
  }
  // Selector ngắn GHÉP móc: của chính phần tử (1 hoặc 2 móc), chưa duy nhất thì thêm 1 cha gần nhất có móc mạnh (id / data-testid /
  // aria-label / role / name) -- tối đa 2 tầng, VD [data-testid="cardB"] button[aria-label="Like"]. Không bao giờ đi đường dẫn nhiều tầng.
  function comboAlts(el) {
    const { tag, out: hs } = hooks(el), found = [];
    const own = [...hs.map((h) => tag + h), ...hs.flatMap((h, i) => hs.slice(i + 1).map((k) => tag + h + k)), tag].slice(0, 30);
    const uniq = (sel) => { try { const l = document.querySelectorAll(sel); return l.length === 1 && l[0] === el; } catch { return false; } };
    for (const o of own) if (uniq(o)) found.push(o);
    for (let n = el.parentElement, d = 0; n && n !== document.body && d < 10 && found.length < 3; n = n.parentElement, d++) {
      const anchors = hooks(n).out.filter((h) => /^#|^\[(data-testid|aria-label|role|name)=/.test(h)).slice(0, 2);
      for (const a of anchors) { const o = own.slice(0, 12).find((x) => uniq(`${a} ${x}`)); if (o) { found.push(`${a} ${o}`); break; } }
    }
    return [...new Set(found)].sort((a, b) => a.length - b.length).slice(0, 3).map((c) => ({ kind: 'kết hợp', code: `page.locator(${sq(c)})`, base: `page.locator(${sq(c)})`, unique: true, css: c }));
  }
  // css ngắn cho 1 phần tử -- server dùng cho thẻ <iframe> chứa bước (page.frameLocator(...)), xem framePrefix ở server
  window.__pmRecSel = (el) => { const cs = comboAlts(el), c = cs.find((x) => x.css !== el.tagName.toLowerCase()) || cs[0]; return c ? c.css : null; }; // có móc (title / name / id...) trước thẻ trơn
  // Phần tử nằm trong 1 "item" lặp lại (bài viết, dòng danh sách...): danh sách item + selector của phần tử TRONG item -- server gom các
  // click giống nhau trên nhiều item để gợi ý gộp thành vòng `for (const item of ...all())`
  function itemOf(el) {
    const { tag, out: hs } = hooks(el), own = [...hs.map((h) => tag + h), ...hs.flatMap((h, i) => hs.slice(i + 1).map((x) => tag + h + x))];
    for (let n = el.parentElement, d = 0; n && n !== document.body && d < 12; n = n.parentElement, d++) {
      const keys = hooks(n).out.filter((h) => /^\[(data-testid|role)=/.test(h)).map((h) => n.tagName.toLowerCase() + h);
      if (['ARTICLE', 'LI', 'TR'].includes(n.tagName)) keys.push(n.tagName.toLowerCase());
      for (const k of keys) {
        let list = []; try { list = [...document.querySelectorAll(k)]; } catch {}
        if (list.length < 2 || !list.includes(n)) continue;
        const inner = own.find((o) => { try { const l = n.querySelectorAll(o); return l.length === 1 && l[0] === el; } catch { return false; } });
        if (inner) return { list: k, inner, count: list.length };
      }
    }
    return null;
  }
  // Không có selector nào khớp đúng 1 -> tìm cha gần nhất "có tên" duy nhất (id, testid, aria-label, dialog...) rồi tìm TRONG cha đó:
  // page.getByRole('dialog').getByRole('button', { name: 'Đăng' }) thay vì page.getByRole('button', ...).nth(3)
  const LANDMARK = ['dialog', 'alertdialog', 'main', 'navigation', 'banner', 'contentinfo', 'search', 'form', 'menu', 'listbox', 'tablist', 'region'];
  function anchorOf(n) {
    if (n.id && goodId(n.id)) return { code: `page.locator(${sq('#' + cssEsc(n.id))})`, kind: '#' + n.id };
    const tid = n.getAttribute('data-testid');
    if (tid && document.querySelectorAll(`[data-testid="${cssEsc(tid)}"]`).length === 1) return { code: `page.getByTestId(${sq(tid)})`, kind: tid };
    const al = n.getAttribute('aria-label'), role = roleOf(n);
    if (al && clean(al) && clean(al).length <= 50 && document.querySelectorAll(`[aria-label="${attrEsc(al)}"]`).length === 1) return { code: role ? `page.getByRole(${sq(role)}, { name: ${sq(clean(al))}, exact: true })` : `page.locator(${sq(`[aria-label="${attrEsc(al)}"]`)})`, kind: clean(al) };
    if (LANDMARK.includes(role) && n.getAttribute('role') === role && [...document.querySelectorAll(`[role="${role}"]`)].filter(isVis).length === 1) return { code: `page.getByRole(${sq(role)})`, kind: role };
    return null;
  }
  function scopedAlts(el) {
    for (let n = el.parentElement, d = 0; n && n !== document.body && d < 15; n = n.parentElement, d++) {
      const a = anchorOf(n);
      if (!a) continue;
      const inner = altsFor(el, n, a.code).filter((x) => x.unique);
      if (inner.length) return inner.slice(0, 2).map((x) => ({ ...x, kind: `trong ${a.kind.slice(0, 24)} › ${x.kind}` }));
    }
    return [];
  }
  // Cấp được chọn: thêm selector ghép quanh phần tử khi chưa có cái nào duy nhất; đường dẫn css nhiều tầng chỉ là đường cùng
  function bestAlts(el) {
    let alts = altsFor(el);
    if (!alts.some((a) => a.unique)) alts = sortAlts([...alts, ...scopedAlts(el), ...comboAlts(el)]);
    if (!alts.some((a) => a.unique)) { const cp = cssPath(el); alts.push({ kind: 'css (dài, đường cùng)', code: `page.locator(${sq(cp)})`, base: `page.locator(${sq(cp)})`, unique: true, deep: true }); }
    return alts;
  }
  const INTERACTIVE = 'a,button,input,select,textarea,label,summary,[role=button],[role=link],[role=menuitem],[role=tab],[role=checkbox],[role=option],[role=switch],[role=textbox],[contenteditable=true],[data-testid]';
  // opt.level: ép cấp chọn sẵn (không thì lấy phần tử tương tác được gần nhất); opt.alts0: selector đã tính sẵn cho cấp 0 (bảng chọn Alt)
  function chainFor(target, opt = {}) {
    const nodes = [];
    for (let n = target, i = 0; n && n.nodeType === 1 && n !== document.body && i < 8; n = n.parentElement, i++) nodes.push(n);
    const start = opt.level ?? Math.max(0, nodes.findIndex((n) => n.matches(INTERACTIVE)));
    const levels = nodes.map((n, i) => {
      const b = n.getBoundingClientRect();
      return { tag: n.tagName.toLowerCase(), label: nameOf(n).slice(0, 40), size: `${Math.round(b.width)}×${Math.round(b.height)}`, css: cssPath(n), alts: i === 0 && opt.alts0 ? opt.alts0 : i === start ? bestAlts(n) : altsFor(n) };
    });
    const a = target.closest('a[href]');
    let href; try { href = a && new URL(a.getAttribute('href'), location.href).href; } catch {}
    return { levels, level: start, href: href && /^https?:/.test(href) ? href : undefined, linkLevel: nodes.indexOf(a), item: opt.item ? itemOf(nodes[start]) : undefined };
  }
  const send = (ev) => call({ op: 'event', ev: { ...ev, pageUrl: location.href } }).then((st) => st && render(st));

  // ---------------- ghi sự kiện
  const editable = (el) => el && (el.isContentEditable || (el.tagName === 'TEXTAREA') || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'file', 'submit', 'button', 'reset', 'image', 'range', 'color'].includes((el.type || '').toLowerCase())));
  const editRoot = (el) => { while (el && el.parentElement && el.parentElement.isContentEditable) el = el.parentElement; return el; };
  const pending = new Map();
  function flushType(el) { const t = pending.get(el); if (!t) return; clearTimeout(t); pending.delete(el); sendType(el); }
  function sendType(el) { const value = el.isContentEditable ? el.innerText.replace(/\n$/, '') : el.value; send({ kind: 'type', value, ...chainFor(el, { level: 0 }) }); }
  const flushAll = () => { for (const el of [...pending.keys()]) flushType(el); };
  document.addEventListener('focusout', (e) => { if (e.isTrusted && !ours(e)) flushAll(); }, true);
  document.addEventListener('click', (e) => {
    if (!e.isTrusted || ours(e)) return;
    if (pick) closePick(); // click ra ngoài bảng chọn = đóng bảng, cú click vẫn đi tiếp như thường
    flushAll();
    const t = e.target.nodeType === 1 ? e.target : e.target.parentElement;
    if (!t) return;
    if (editable(t) || (t.isContentEditable)) { const root = editRoot(t); send({ kind: 'click', ...chainFor(root, { level: 0 }) }); return; }
    if (t.tagName === 'SELECT' || t.tagName === 'OPTION' || t === document.body || t === document.documentElement) return; // <select> ghi lúc change; click vào nền trang thì bỏ
    send({ kind: 'click', ...chainFor(t, { item: true }) });
    watchEffect();
  }, true);
  // Sau cú click: 2 giây xem có phần tử MỚI hiện ra không (popup, thông báo, menu...) -- có thì gửi lên để gợi ý thêm bước "Chờ hiện"
  // (script chờ đúng kết quả thay vì nghỉ cố định). Chỉ lấy phần tử có móc tốt: role dialog / alert / status..., aria-live, data-testid.
  let effObs = null, effTimer = 0;
  function watchEffect() {
    if (effObs) effObs.disconnect();
    clearTimeout(effTimer);
    const added = new Set();
    effObs = new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && added.size < 300) added.add(n); });
    effObs.observe(document.body || document.documentElement, { childList: true, subtree: true });
    effTimer = setTimeout(() => {
      effObs.disconnect(); effObs = null;
      let best = null, top = 0;
      const score = (el) => {
        if (!el.isConnected || (host && host.contains(el)) || el === hl || !isVis(el)) return;
        const role = el.getAttribute('role') || '', tid = el.getAttribute('data-testid') || '';
        let sc = /^(dialog|alertdialog|alert|status|menu|listbox|tooltip)$/.test(role) || el.tagName === 'DIALOG' ? 5 : 0;
        if (el.hasAttribute('aria-live')) sc += 4;
        if (tid) sc += 3 + (/toast|alert|dialog|modal|confirm|success|error|popup|sheet/i.test(tid) ? 2 : 0);
        if (el.id && goodId(el.id)) sc += 1;
        if (sc > top) { top = sc; best = el; }
      };
      for (const n of added) { score(n); if (n.childElementCount < 400) for (const d of n.querySelectorAll('[role],[data-testid],[aria-live],dialog')) score(d); }
      if (best && top >= 3) send({ kind: 'effect', ...chainFor(best, { level: 0 }), label: quickLabel(best), tag: best.tagName.toLowerCase() });
    }, 2000);
  }
  document.addEventListener('input', (e) => {
    if (!e.isTrusted || ours(e)) return;
    let t = e.target.nodeType === 1 ? e.target : e.target.parentElement;
    if (!t || t.tagName === 'SELECT') return;
    if (t.isContentEditable) t = editRoot(t);
    if (!editable(t)) return;
    clearTimeout(pending.get(t));
    pending.set(t, setTimeout(() => { pending.delete(t); sendType(t); }, 500));
  }, true);
  document.addEventListener('keydown', (e) => {
    if (!e.isTrusted || ours(e) || e.key !== 'Enter' || e.shiftKey) return;
    let t = e.target.nodeType === 1 ? e.target : null;
    if (!t) return;
    if (t.isContentEditable) t = editRoot(t);
    if (!editable(t)) return;
    flushType(t);
    send({ kind: 'enter', ...chainFor(t, { level: 0 }) });
  }, true);
  document.addEventListener('change', (e) => {
    if (!e.isTrusted || ours(e) || e.target.tagName !== 'SELECT') return;
    flushAll();
    send({ kind: 'select', value: e.target.value, ...chainFor(e.target, { level: 0 }) });
  }, true);
  let lastUrl = location.href;
  const navTick = () => { if (location.href !== lastUrl) { lastUrl = location.href; send({ kind: 'nav', url: location.href }); } };
  addEventListener('pagehide', flushAll); // rời trang (Enter submit form...) -- gửi nốt chữ đang gõ dở
  const hello = () => (typeof window.__pmRec === 'function' ? send({ kind: 'nav', url: location.href }) : setTimeout(hello, 200)); // vừa tải trang mới
  if (isTop) { setInterval(navTick, 500); hello(); }

  // ---------------- chặn sự kiện của giao diện recorder ngay ở window (capture -- gắn trước script của trang) để trang không thấy:
  // không thì trang tưởng click ra ngoài -> đóng menu đang mở, gõ trong ô của mình lại dính phím tắt của trang. Tự chuyển vào handler của mình.
  // (shadow DOM đóng nên ở window không thấy phần tử thật bên trong -> tìm lại bằng root.elementFromPoint / root.activeElement)
  let root = null;
  for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'mouseover', 'keydown', 'keyup', 'keypress']) addEventListener(t, (e) => {
    if (!root || !ours(e)) return;
    e.stopImmediatePropagation();
    const el = t.startsWith('key') || (t === 'click' && e.detail === 0) ? root.activeElement : root.elementFromPoint(e.clientX, e.clientY);
    if (el && el.closest) uiEvent(e, el);
  }, true);

  // ---------------- giữ Alt + rê chuột: các lớp phần tử chồng nhau dưới con trỏ; lăn chuột đổi lớp; nhả Alt = bảng đứng yên để chọn
  let mx = -1, my = -1, pick = null, raf = 0; // pick = { live, rows, sel, moved, t0, altObj, custom, editing, text, enter, perform }
  addEventListener('mousemove', (e) => { mx = e.clientX; my = e.clientY; if (pick && pick.live) { pick.moved = true; if (!raf) raf = requestAnimationFrame(() => { raf = 0; updatePick(); }); } }, true);
  addEventListener('keydown', (e) => {
    if (!e.isTrusted || ours(e)) return;
    if (e.key === 'Alt') { if (pick && pick.live) e.preventDefault(); else if (st && (st.recording || st.armed) && ui && !e.repeat && !e.ctrlKey) { e.preventDefault(); startPick(); } return; }
    if (pick && pick.live) closePick(); // Alt + phím khác (Alt+Tab, Alt+←...) là phím tắt, không phải chọn phần tử
    else if (pick && e.key === 'Escape') closePick();
    else if (pick && e.key === 'Enter' && st && st.armed) { e.preventDefault(); e.stopImmediatePropagation(); chotSlot(); }
    else if (!pick && e.key === 'Escape' && st && st.armed) { call({ op: 'arm' }).then(render); toast('Đã huỷ chờ chọn element'); }
  }, true);
  addEventListener('keyup', (e) => { if (e.key !== 'Alt' || !pick || !pick.live) return; e.preventDefault(); if (!pick.moved && Date.now() - pick.t0 < 300) closePick(); else freezePick(); }, true); // preventDefault: Chrome Windows không nhảy focus lên menu ⋮
  addEventListener('blur', () => { if (pick && pick.live) closePick(); });
  addEventListener('wheel', (e) => {
    if (!pick || !pick.live || !pick.rows.length) return;
    e.preventDefault(); e.stopImmediatePropagation();
    pick.sel = Math.max(0, Math.min(pick.rows.length - 1, pick.sel + (e.deltaY > 0 ? 1 : -1)));
    pick.lock = pick.rows[pick.sel].el; pick.moved = true;
    drawPick();
  }, { capture: true, passive: false });
  // Đang giữ Alt mà lỡ click: chặn (Chrome: Alt + click vào link = tải link về), coi như nhả Alt
  for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'auxclick', 'contextmenu']) addEventListener(t, (e) => {
    if (!pick || !pick.live || ours(e)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (t === 'click') freezePick();
  }, true);

  const quickLabel = (el) => clean(el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('alt') || String(el.textContent || '').slice(0, 200) || (el.id ? '#' + el.id : '')).slice(0, 40);
  const hasHook = (el) => el.id || el.hasAttribute('data-testid') || el.hasAttribute('aria-label') || el.hasAttribute('role');
  function stackAt(x, y) {
    const els = document.elementsFromPoint(x, y).filter((el) => el !== host && el !== hl && el !== document.documentElement && el !== document.body);
    const top = els[0], rows = [];
    for (const el of els) {
      const b = el.getBoundingClientRect();
      if (b.width >= innerWidth - 2 && b.height >= innerHeight - 2) continue; // khung bọc cả màn hình
      const prev = rows[rows.length - 1], inter = el.matches(INTERACTIVE);
      const sameBox = prev && Math.abs(b.left - prev.b.left) < 1 && Math.abs(b.top - prev.b.top) < 1 && Math.abs(b.width - prev.b.width) < 1 && Math.abs(b.height - prev.b.height) < 1;
      if (sameBox && !inter && !hasHook(el) && el.contains(prev.el)) { prev.fold++; continue; } // div bọc nhau cùng 1 khung -> gộp 1 dòng
      rows.push({ el, b, inter, under: !!top && !el.contains(top), fold: 0, tag: el.tagName.toLowerCase(), label: quickLabel(el), size: `${Math.round(b.width)}×${Math.round(b.height)}` });
      if (rows.length >= 14) break;
    }
    return rows;
  }
  function startPick() {
    pick = { live: true, rows: [], sel: 0, moved: false, t0: Date.now(), text: '', enter: false, perform: true };
    updatePick();
  }
  function updatePick() {
    if (!pick || !pick.live) return;
    if (mx < 0) { pick.rows = []; return drawPick(); }
    const rows = stackAt(mx, my), keep = pick.lock ? rows.findIndex((r) => r.el === pick.lock) : -1;
    pick.rows = rows;
    pick.sel = keep >= 0 ? keep : Math.max(0, rows.findIndex((r) => r.inter));
    if (keep < 0) pick.lock = null;
    drawPick();
  }
  function freezePick() {
    if (!pick) return;
    pick.live = false;
    if (!pick.rows.length) return closePick();
    for (const r of pick.rows) r.alts = bestAlts(r.el); // tính sẵn cho mọi lớp: menu hover có thể tắt khi chuột rời đi, phần tử biến mất
    selectRow(pick.sel);
  }
  function selectRow(i) {
    const r = pick.rows[i];
    if (!r) return;
    Object.assign(pick, { sel: i, altObj: r.alts[0], altTouched: false, custom: null, editing: false });
    drawPick();
    if (r.counted) return;
    r.counted = true;
    call({ op: 'count', codes: r.alts.map((a) => (a.nth ? a.base : a.code)) }).then((res) => {
      if (!res || !res.counts) return;
      const extra = [];
      r.alts.forEach((a, k) => {
        const c = res.counts[k];
        if (!c) return;
        a.count = c.all; a.unique = !a.nth && c.all === 1;
        const vcode = `${a.base}.filter({ visible: true })`;
        if (a.base && c.all > 1 && c.vis === 1 && !r.alts.some((x) => x.code === vcode)) extra.push({ kind: a.kind + ' (đang hiện)', code: vcode, base: a.base, unique: true, count: 1 });
      });
      r.alts.push(...extra); sortAlts(r.alts);
      if (pick && pick.rows[pick.sel] === r) { if (!pick.altTouched) pick.altObj = r.alts[0]; drawAltSelect(); }
    });
  }
  function closePick() { pick = null; if (ui) ui.pick.hidden = true; boxEl(null); }
  const altLabel = (a) => `${a.count == null ? (a.unique ? '' : '⚠ ') : a.unique ? '✓1 ' : `⚠${a.count} `}${isLang(a.code) ? '🌐 ' : ''}${a.kind}: ${a.code}${a.note && a.count == null ? ' (' + a.note + ')' : ''}`; // 🌐 = dựa vào chữ, đổi theo ngôn ngữ
  function drawAltSelect() {
    const r = pick.rows[pick.sel], s = ui.pick.querySelector('[data-f=palt]');
    if (!s) return;
    const cc = pick.customCount == null ? '' : pick.customCount === 1 ? '✓1 ' : `⚠${pick.customCount} `;
    setHTML(s, r.alts.map((a, k) => `<option value="${k}" ${a === pick.altObj && !pick.custom ? 'selected' : ''}>${esc(altLabel(a))}</option>`).join('') + (pick.custom ? `<option selected>${cc}sửa tay: ${esc(pick.custom)}</option>` : ''));
  }
  // Bấm thuộc tính trong khung HTML: thêm / bỏ vào selector tự ghép <thẻ>[a="..."][b="..."] -> thành selector "sửa tay", Playwright đếm số khớp
  function toggleFrag(frag) {
    const r = pick.rows[pick.sel];
    pick.attrs = pick.attrs || new Set();
    if (pick.attrs.has(frag)) pick.attrs.delete(frag); else pick.attrs.add(frag);
    const css = pick.attrs.size ? r.el.tagName.toLowerCase() + [...pick.attrs].join('') : '';
    pick.custom = css ? `page.locator(${sq(css)})` : null; pick.customCount = null;
    drawPick();
    if (css) call({ op: 'count', codes: [pick.custom] }).then((res) => { if (pick && res && res.counts && res.counts[0]) { pick.customCount = res.counts[0].all; drawAltSelect(); } });
  }
  // Bảng Alt KHÔNG còn nút hàm: gõ tên việc / hàm (c -> clickEl, i -> If hiện..., w -> While / waitEl, n -> Nhánh, đ / dong -> Đóng...)
  // rồi ↑ ↓ Enter hoặc bấm chuột. Danh sách theo ngữ cảnh: thường = hàm có act trong public/fncatalog.js (server gửi state.fns) + mở
  // While / Nhánh; trong While / Nhánh = các nhánh "If có → ..." / "Hiện trước → ..." + Đóng.
  const foldVi = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u0111/g, 'd').replace(/\u0110/g, 'D').toLowerCase();
  // Bảng Alt CHỈ để làm việc với element (click, gõ, if hiện, chờ...); gọi hàm / While / Nhánh ở bảng ☰
  function fnChoices() {
    if (st && st.openLoop) return Object.entries(st.loopActions).filter(([a]) => a !== 'skip').map(([act, name]) => ({ act, name, keys: 'if co ' + act, desc: 'trong While' }));
    if (st && st.openBranch) return Object.entries(st.branchActions).filter(([a]) => a !== 'skip').map(([act, name]) => ({ act, name, keys: 'hien truoc ' + act, desc: 'nhánh của waitAny' }));
    return [...(st && st.inCase ? st.andFns || [] : []), ...((st && st.fns) || []), ...((st && st.caseFns) || [])]; // đang ghi 1 trường hợp: ghép thêm điều kiện (VÀ ...)
  }
  function fnSearch(q, list = fnChoices(), max = 10) {
    const f = foldVi(q).trim();
    if (!f) return [];
    return list.map((it, i) => {
      const words = foldVi(`${it.name} ${it.keys || ''}`).split(/[^a-z0-9]+/).filter(Boolean), head = words.slice(0, 2);
      return { it, i, sc: head.some((w) => w.startsWith(f)) ? 3 : words.some((w) => w.startsWith(f)) ? 2 : words.join(' ').includes(f) ? 1 : 0 };
    }).filter((x) => x.sc).sort((a, b) => b.sc - a.sc || a.i - b.i).slice(0, max).map((x) => x.it);
  }
  const fnListHTML = () => {
    pick.fnRes = fnSearch(pick.q);
    if (!pick.q) return `<div class="fnh">Gõ việc làm với element: <b>c</b> click · <b>g</b> gõ · <b>i</b> if hiện · <b>w</b> chờ · <b>d</b> nhấp đúp -- ↑ ↓ Enter để chọn (gọi hàm / While / Nhánh: ô ƒ ở bảng ☰)</div>`;
    if (!pick.fnRes.length) return '<div class="fnh">Không có hàm nào khớp</div>';
    pick.qi = Math.min(pick.qi || 0, pick.fnRes.length - 1);
    return pick.fnRes.map((x, i) => `<div class="fn${i === pick.qi ? ' on' : ''}" data-i="${i}" data-act="${x.act || x.cmd}"><b>${esc(x.name)}</b><span>${esc(x.desc || '')}</span></div>`).join('');
  };
  function runFn(x) {
    if (!x) return;
    if (x.act) return doPick(x.act);
    const op = { wstart: 'loopStart', wend: 'loopEnd', bstart: 'branchStart', bend: 'branchEnd' }[x.cmd];
    pick.q = ''; pick.qi = 0;
    call({ op }).then((s) => { render(s); drawPick(); }); // bảng vẫn mở để chọn tiếp
  }
  const labelsNow = () => (st && st.openLoop ? st.loopActions : st && st.openBranch ? st.branchActions : (st && st.actions) || {});
  const loopN = () => (st && st.openLoop ? st.steps.filter((x) => x.loop === st.openLoop).length : 0);
  const branchN = () => (st && st.openBranch ? st.steps.filter((x) => x.br === st.openBranch).length : 0);
  // Thanh khối -- luôn ở ĐẦU bảng (chọn While / Nhánh trước rồi mới chọn các phần tử bên trong)
  const caseN = () => (st && st.inCase ? st.steps.filter((x) => x.cs === st.inCase).length : 0);
  const whileBar = (live) => (st && st.inCase
    ? `<div class="wbar on cs"><b>◆ Đang ghi 1 trường hợp</b><span>${caseN()} bước</span>${live ? '' : '<button data-op="caseEnd" title="Xong trường hợp này -- bước sau ra ngoài khối (về lại While)">✓ Xong trường hợp</button>'}</div>`
    : st && st.openLoop
    ? `<div class="wbar on"><b>⟳ Đang trong While</b><span>${loopN()} if</span>${live ? '' : '<button data-op="wend" title="Kết thúc vòng lặp -- bước sau ghi như thường">Đóng While</button>'}</div>`
    : st && st.openBranch
      ? `<div class="wbar on br"><b>⑂ Đang trong Nhánh</b><span>${branchN()} nhánh</span>${live ? '' : '<button data-op="bend" title="Kết thúc Nhánh -- bước sau ghi như thường">Đóng Nhánh</button>'}</div>`
      : '');
  // HTML đầy đủ của phần tử đang chọn (mọi thuộc tính, chữ bên trong, số con) -- để căn đúng phần tử; bảng đứng yên thì bấm thuộc tính
  // để thêm / bỏ vào 1 selector tự ghép (Playwright đếm số khớp ngay). Thuộc tính mờ = tự sinh / đổi theo lần tải, không nên dùng.
  function elBox(r) {
    const el = r.el, tag = el.tagName.toLowerCase(), on = pick.attrs || new Set(), frags = [];
    for (const a of el.attributes) {
      if (a.name === 'class') { for (const c of el.classList) frags.push({ show: '.' + c, frag: '.' + cssEsc(c), weak: !goodClass(c) }); continue; }
      const v = a.value, frag = a.name === 'id' ? '#' + cssEsc(v) : `[${a.name}="${attrEsc(v)}"]`;
      frags.push({ show: `${a.name}="${v.length > 90 ? v.slice(0, 90) + '…' : v}"`, frag, weak: a.name === 'id' ? !goodId(v) : a.name === 'style' || v.length > 90 || /\d{3,}/.test(v) });
    }
    const txt = clean(el.textContent).slice(0, 90);
    return `<div class="elh"><div class="eh">&lt;${tag}</div>${frags.map((f) => `<div class="at${on.has(f.frag) ? ' on' : ''}${f.weak ? ' weak' : ''}" data-frag="${esc(f.frag)}"${pick.live ? '' : ' title="Bấm: thêm / bỏ vào selector tự ghép"'}>${esc(f.show)}</div>`).join('')}<div class="eh">&gt;${txt ? ` <span class="tx">${esc(txt)}</span>` : ''}${el.childElementCount ? ` <span class="kc">· ${el.childElementCount} con</span>` : ''} &lt;/${tag}&gt;</div></div>`;
  }
  function drawPick() {
    if (!ui || !pick) return;
    const p = ui.pick, r = pick.rows[pick.sel], acts = (st && st.actions) || {};
    let html = `<div class="ph"><b>${pick.live ? 'Giữ Alt · lăn chuột đổi lớp · nhả Alt để chọn' : 'Chọn phần tử'}</b>${pick.live ? '' : '<button data-op="pclose" title="Đóng (Esc)">✕</button>'}</div>${whileBar(pick.live)}`;
    const r0 = pick.rows[pick.sel];
    html += pick.rows.length ? `<div class="rows">${pick.rows.map((x, i) => `<div class="row ${i === pick.sel ? 'on' : ''}" data-i="${i}"><span class="star">${x.inter ? '★' : ''}</span>&lt;${esc(x.tag)}&gt; <span class="lb">${esc(x.label)}</span>${x.under ? '<span class="un">dưới lớp phủ</span>' : ''}<span class="sz">${x.size}${x.fold ? ' ×' + (x.fold + 1) : ''}</span></div>`).join('')}</div>${r0 && r0.el.isConnected ? elBox(r0) : ''}` : '<div class="empty">Rê chuột lên phần tử cần chọn</div>';
    const arm = armedInfo();
    if (!pick.live && r && arm) html += `<div class="det"><div class="armbar">🎯 Chọn element cho <b>${esc(arm.label)}</b> của hàm <b>${esc(arm.fn)}</b></div>
      <div class="r"><select data-f="palt" class="grow"></select><button data-op="pedit" title="Tự sửa selector">✎</button></div>
      ${pick.editing ? `<div class="r"><input class="grow" data-f="pcustom" value="${esc(pick.custom || (pick.altObj || {}).code)}" title="Enter để lưu"></div>` : ''}
      <div class="r"><button data-op="pslot" class="pri grow" title="Enter">✓ Chốt element này</button><button data-op="pagain" title="Đóng bảng, giữ Alt chọn lại">↺ Chọn lại</button></div></div>`;
    else if (!pick.live && r) html += `<div class="det">
      <div class="r"><select data-f="palt" class="grow"></select><button data-op="pedit" title="Tự sửa selector">✎</button></div>
      ${pick.editing ? `<div class="r"><input class="grow" data-f="pcustom" value="${esc(pick.custom || (pick.altObj || {}).code)}" title="Enter để lưu"></div>` : ''}
      <div class="r"><input class="grow pq" data-f="pq" value="${esc(pick.q || '')}" placeholder="Gõ tên hàm: c → click, i → if, w → while..." autocomplete="off" spellcheck="false"></div>
      <div class="fnl">${fnListHTML()}</div>
      <div class="r"><input class="grow" data-f="ptext" value="${esc(pick.text)}" placeholder="Chữ / giá trị (Gõ, chọn option, tên phím, thuộc tính, file) -- = để dùng biểu thức JS"><label class="lv"><input type="checkbox" data-f="penter" ${pick.enter ? 'checked' : ''}> Enter</label></div>
      ${srcSelect('psrc')}
      ${st && st.openLoop ? `<div class="r"><label class="lv" title="Làm xong (Click / Gõ / Hover) thì break -- thoát While"><input type="checkbox" data-f="pbreak" ${pick.thenBreak ? 'checked' : ''}> rồi Break</label>
        <label class="lv" title="Điều kiện if: có trong DOM (count() > 0, kể cả đang ẩn) thay vì phải đang hiện"><input type="checkbox" data-f="pdom" ${pick.dom ? 'checked' : ''}> có trong DOM (kể cả ẩn)</label></div>` : ''}
      <label class="lv"><input type="checkbox" data-f="pdo" ${pick.perform ? 'checked' : ''}> Làm luôn trên trang (click, gõ, hover, nhấp đúp, tick...)</label></div>`;
    const hadFocus = root.activeElement;
    setHTML(p, html);
    p.hidden = false;
    if (!pick.live && r) drawAltSelect();
    const fi = p.querySelector(`[data-f=${(hadFocus && hadFocus.dataset && hadFocus.dataset.f) || 'pq'}]`) || p.querySelector('[data-f=pq]'); // bảng đứng yên: con trỏ ở sẵn ô gõ tên hàm (đang gõ ô khác thì giữ ô đó)
    if (fi) { fi.focus(); if (fi.type === 'text' || fi.tagName === 'INPUT' && !fi.type.match(/checkbox/)) fi.setSelectionRange(fi.value.length, fi.value.length); }
    if (pick.live) { // bám theo con trỏ, lật sang bên kia nếu tràn màn hình
      const w = p.offsetWidth, h = p.offsetHeight;
      p.style.left = Math.max(4, mx + 18 + w > innerWidth ? mx - w - 18 : mx + 18) + 'px';
      p.style.top = Math.max(4, my + 18 + h > innerHeight ? my - h - 18 : my + 18) + 'px';
    } else { const b = p.getBoundingClientRect(); if (b.bottom > innerHeight - 4) p.style.top = Math.max(4, innerHeight - b.height - 4) + 'px'; }
    boxEl(r && r.el, r && r.b, true);
  }
  // Ô element đang chờ chọn (bấm 🎯 Pick ở 1 hàm trong bảng ☰) -- giữ ở server nên chuyển trang / reload vẫn còn
  function armedInfo() {
    const a = st && st.armed, x = a && st.steps.find((y) => y.id === a.stepId), sl = x && (x.slotInfo || []).find((z) => z.key === a.key);
    return sl ? { label: sl.label, fn: x.name } : null;
  }
  function chotSlot() {
    const r = pick && pick.rows[pick.sel], a = st && st.armed;
    if (!r || !a) return;
    const ch = chainFor(r.el, { level: 0, alts0: r.alts });
    call({ op: 'fnSlot', stepId: a.stepId, key: a.key, levels: ch.levels, level: 0, alt: Math.max(0, r.alts.indexOf(pick.altObj)), custom: pick.custom }).then((s) => {
      render(s); const n = armedInfo();
      toast(n ? `Đã chốt ✓ -- tiếp: giữ Alt chọn ${n.label}` : 'Đã chốt ✓ -- hàm đã đủ element');
    });
    closePick();
  }
  function doPick(action) {
    const r = pick.rows[pick.sel];
    if (!r) return;
    const ch = chainFor(r.el, { level: 0, alts0: r.alts });
    const perform = pick.perform && ['click', 'type', 'hover', 'ifClick', 'ifType', 'ifHover', 'dblclick', 'rightClick', 'check', 'uncheck', 'scroll', 'pressKey'].includes(action);
    const inLoop = !!(st && st.openLoop);
    if (/^case/.test(action)) { // mở 1 trường hợp
      send({ kind: 'pick', action, ...ch, alt: Math.max(0, r.alts.indexOf(pick.altObj)), custom: pick.custom, text: action === 'caseText' ? (pick.text || clean(r.el.innerText || r.el.value).slice(0, 80)) : '', cond: pick.dom ? 'dom' : undefined });
      toast('◆ Đang ghi trường hợp -- thao tác trên trang, các bước vào trong khối; xong bấm ✓ Xong ở thanh REC');
      return closePick();
    }
    send({ kind: 'pick', action, ...ch, alt: Math.max(0, r.alts.indexOf(pick.altObj)), custom: pick.custom, text: pick.text, enter: pick.enter, perform, thenBreak: inLoop && pick.thenBreak, cond: inLoop && pick.dom ? 'dom' : undefined });
    toast(`Đã ghi: ${labelsNow()[action] || action}${st && st.openLoop ? ' (trong While)' : st && st.openBranch ? ' (nhánh)' : ''}${perform ? ' (đang làm trên trang...)' : ''}`);
    closePick();
  }
  function onPick(e, el) {
    const f = el.dataset && el.dataset.f;
    if (e.type === 'change') {
      if (f === 'palt' && el.value !== '' && pick.rows[pick.sel].alts[+el.value]) { pick.altObj = pick.rows[pick.sel].alts[+el.value]; pick.altTouched = true; pick.custom = null; }
      else if (f === 'pcustom') { pick.custom = el.value.trim() || null; drawAltSelect(); } // không vẽ lại cả bảng: change này có thể do blur lúc bấm nút hành động -> nút dời chỗ, bấm trượt
      else if (f === 'psrc') { if (el.value) { pick.text = '= ' + el.value; drawPick(); } }
      else if (f === 'ptext') pick.text = el.value;
      else if (f === 'penter') pick.enter = el.checked;
      else if (f === 'pdo') pick.perform = el.checked;
      else if (f === 'pbreak') pick.thenBreak = el.checked;
      else if (f === 'pdom') pick.dom = el.checked;
      return;
    }
    if (pick.live) return;
    const row = el.closest('.row'), btn = el.closest('button');
    if (row) { pick.attrs = null; pick.customCount = null; return selectRow(+row.dataset.i); }
    const fn = el.closest('.fn');
    if (fn) return runFn(pick.fnRes[+fn.dataset.i]);
    const at = el.closest('.at');
    if (at) return toggleFrag(at.dataset.frag);
    if (!btn) return;
    if (btn.dataset.op === 'pclose') return closePick();
    if (btn.dataset.op === 'pslot') return chotSlot();
    if (btn.dataset.op === 'caseEnd') { call({ op: 'caseEnd' }).then((s) => { render(s); drawPick(); toast('✓ Xong trường hợp'); }); return; }
    if (btn.dataset.op === 'pagain') { closePick(); return toast('Giữ Alt + rê chuột chọn lại element'); }
    const blk = { wstart: 'loopStart', wend: 'loopEnd', bstart: 'branchStart', bend: 'branchEnd' }[btn.dataset.op];
    if (blk) { call({ op: blk }).then((s) => { render(s); drawPick(); }); return; } // bảng vẫn mở để chọn tiếp
    if (btn.dataset.op === 'pedit') { pick.editing = true; drawPick(); const i = ui.pick.querySelector('[data-f=pcustom]'); if (i) i.focus(); return; }
    if (btn.dataset.act) doPick(btn.dataset.act);
  }

  // ---------------- giao diện (shadow DOM -- CSS trang web không lọt vào, CSS của mình không lọt ra)
  let fq = '', fqi = 0, fqRes = [], expId = null; // ô ƒ Gọi hàm của bảng ☰
  let st = null, open = false, view = 'code', expK = -1, testing = false, lastPanel = '', hl = null, ui = null, editing = null, toastT = 0; // view: 'code' (mặc định) | 'cards'; expK: dòng code đang mở chỉnh
  let tt = null; try { tt = window.trustedTypes && trustedTypes.createPolicy('pmrec', { createHTML: (x) => x }); } catch {} // trang bật Trusted Types (Google...) chặn innerHTML thường
  const setHTML = (el, html) => { el.innerHTML = tt ? tt.createHTML(html) : html; };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const CSS_UI = `*{box-sizing:border-box;font-family:Segoe UI,system-ui,sans-serif;font-size:12px}
    .pill{display:flex;align-items:center;gap:10px;background:#1a1d27;color:#e8e9ed;border:1px solid #3a3f4d;border-radius:999px;padding:7px 7px 7px 18px;min-height:46px;cursor:pointer;box-shadow:0 6px 20px #0008;user-select:none}
    .pill .lbl{font-size:15px;font-weight:600;white-space:nowrap}.pill button{border-radius:999px;padding:6px 14px;font-size:14px}.pill button[hidden]{display:none}.paused .dot{background:#e8a33d}
    .dot{width:14px;height:14px;border-radius:50%;background:#666;flex:none}.rec .dot{background:#ef4444;animation:p 1.2s infinite}@keyframes p{50%{opacity:.35}}
    .panel{position:absolute;right:0;bottom:56px;width:640px;max-width:calc(100vw - 32px);max-height:72vh;display:flex;flex-direction:column;background:#12141c;color:#e8e9ed;border:1px solid #2a2e3a;border-radius:12px;box-shadow:0 10px 40px #000a;overflow:hidden}
    .panel[hidden],.pick[hidden],.toast[hidden]{display:none}.hd{display:flex;gap:6px;align-items:center;padding:8px;border-bottom:1px solid #2a2e3a;cursor:move}.hd b{flex:1;white-space:nowrap}.hd button{white-space:nowrap}
    button{background:#1a1d27;color:#e8e9ed;border:1px solid #2a2e3a;border-radius:6px;padding:3px 8px;cursor:pointer}button:hover:not(:disabled){border-color:#e8a33d;color:#f5b455}button:disabled{opacity:.35;cursor:default}
    .pri{background:#e8a33d;color:#1a1206;border-color:#e8a33d}.pri:hover{color:#1a1206!important;filter:brightness(1.1)}
    .list{overflow:auto;flex:1;padding:6px}.empty{opacity:.6;padding:16px;text-align:center}
    .st{border:1px solid #2a2e3a;border-radius:8px;padding:6px;margin-bottom:6px;background:#1a1d27}.st:hover{border-color:#e8a33d}
    .seg{opacity:.7;font-size:11px;text-align:center;margin:2px 0 6px;color:#ef4444}
    .r{display:flex;gap:4px;align-items:center;margin-top:4px}.r:first-child{margin-top:0}.n{opacity:.6;min-width:18px}
    textarea{width:100%;margin-top:4px;resize:vertical;font-family:Consolas,monospace;font-size:11px;line-height:1.45;background:#0d0f15;color:#d4d4d4;border:1px solid #2a2e3a;border-radius:6px;padding:4px 6px}
    .fbar{position:relative;padding:6px 8px;border-bottom:1px solid #2a2e3a}.fbar input{width:100%;font-size:13px;padding:6px 8px;border-color:#a78bfa88}
    .fnl2{position:absolute;left:8px;right:8px;top:calc(100% - 2px);z-index:5;background:#12141c;border:1px solid #a78bfa;border-radius:8px;max-height:42vh;overflow:auto;padding:3px;box-shadow:0 10px 30px #000c}.fnl2[hidden]{display:none}
    .ln.cur{color:#7ee2a8;background:#3fb9501a;outline:1px dashed #3fb950;cursor:default}.ln.cur button{padding:0 5px;font-size:11px}.ln.hole code{color:#7ee2a8;opacity:.75}.ln.hole:hover code{opacity:1}
    .fnst{border-color:#e8a33d66}.fnst b{color:#f5b455}.slot{padding:2px 4px;border-radius:6px}.slot.on{outline:1px solid #e8a33d;background:#e8a33d14}.slot .sc{font-family:Consolas,monospace;font-size:11px;color:#9cdcfe;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .st.case{border-color:#34d399;background:#34d39912}.st.case b{color:#6ee7b7}.wbar.on.cs{border-color:#34d399;background:#34d3991a}.wbar.on.cs b{color:#6ee7b7}
    .armbar{margin-bottom:4px;padding:5px 6px;border-radius:6px;background:#e8a33d1f;border:1px solid #e8a33d;font-size:12px}.pill.armed{border-color:#e8a33d;box-shadow:0 0 0 2px #e8a33d55,0 6px 20px #0008}
    select,input{background:#12141c;color:#e8e9ed;border:1px solid #2a2e3a;border-radius:6px;padding:3px 5px;min-width:0}
    .grow{flex:1}.lv{opacity:.75;white-space:nowrap}.code{font-family:Consolas,monospace;font-size:11px;color:#9cdcfe;word-break:break-all;margin-top:4px}
    pre{margin:0;padding:8px;max-height:30vh;overflow:auto;border-top:1px solid #2a2e3a;font-family:Consolas,monospace;font-size:11px;color:#9cdcfe;white-space:pre-wrap}
    .sug{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:4px;font-size:11px}.sug span{opacity:.7}.sug button{border-color:#3fb95066;color:#7ee2a8;font-size:11px;padding:2px 6px}
    .info{opacity:.7;font-size:11px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tag{color:#f5b455;font-size:11px;margin-top:3px}
    .pick{position:fixed;width:440px;max-height:80vh;overflow:auto;background:#12141c;color:#e8e9ed;border:1px solid #e8a33d;border-radius:10px;box-shadow:0 10px 40px #000a;padding:6px}
    .ph{display:flex;align-items:center;gap:6px;padding:2px 2px 6px}.ph b{flex:1;font-size:11px;opacity:.85}
    .row{display:flex;gap:4px;align-items:center;padding:3px 5px;border-radius:6px;cursor:pointer;white-space:nowrap}.row:hover{background:#1a1d27}.row.on{background:#e8a33d33;outline:1px solid #e8a33d}
    .star{color:#f5b455;width:10px}.lb{flex:1;overflow:hidden;text-overflow:ellipsis;opacity:.8}.sz{opacity:.55;font-size:11px}.un{color:#9cdcfe;font-size:10px;border:1px solid #9cdcfe55;border-radius:4px;padding:0 3px}
    .wbar{display:flex;align-items:center;gap:6px;margin:0 0 6px;padding:5px 6px;border:1px dashed #2a2e3a;border-radius:8px;font-size:11px}.wbar span{opacity:.7}
    .wbar.on{border:1px solid #a78bfa;background:#a78bfa1a}.wbar.on b{color:#c4b5fd}.wbar button[data-op=wstart]{border-color:#a78bfa;color:#c4b5fd}
    .ag{font-size:10px;opacity:.6;margin:6px 0 2px;text-transform:uppercase;letter-spacing:.03em}
    .st.loop{border-color:#a78bfa;background:#a78bfa14}.st.loop b{color:#c4b5fd}.st.inloop{margin-left:14px;border-left:3px solid #a78bfa}
    .codev{font-family:Consolas,monospace;font-size:12px;line-height:1.55;color:#d4d4d4}
    .ln{display:flex;gap:8px;align-items:flex-start;padding:1px 4px;border-radius:4px;cursor:pointer;white-space:pre-wrap;word-break:break-all}.ln:hover{background:#1a1d27}.ln.on{background:#e8a33d26}
    .ln .no{color:#5a6070;min-width:22px;text-align:right;user-select:none;flex:none}.ln code{flex:1;font-family:inherit}.ln.dim code{opacity:.4}.ln.bad{background:#ef444426;outline:1px solid #ef4444}
    .ln .lt{display:none;gap:2px;flex:none}.ln:hover .lt{display:flex}.ln .lt button{padding:0 5px;font-size:11px}.ln.lang .no::after{content:'🌐';font-size:9px;margin-left:2px}
    .codev i{font-style:normal}.codev .k{color:#c586c0}.codev .s{color:#ce9178}.codev .c{color:#6a9955}.codev .n{color:#b5cea8}
    .ghost{margin:1px 0 3px 30px;font-size:11px;color:#7ee2a8;display:flex;gap:6px;align-items:center;flex-wrap:wrap}.ghost button{font-size:11px;padding:1px 6px;border-color:#3fb95066;color:#7ee2a8}.ghost.err{color:#fca5a5}
    .edit{margin:2px 0 6px 30px}
    .tbar{margin:6px 6px 0;padding:6px 8px;border-radius:8px;font-size:12px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}.tbar.run{background:#3b82f61f;border:1px solid #3b82f6}
    .tbar.ok{background:#22c55e1f;border:1px solid #22c55e}.tbar.bad{background:#ef44441f;border:1px solid #ef4444}.tbar details{width:100%}.tbar pre{max-height:20vh;border:0;padding:4px}
    .wbar.on.br{border-color:#38bdf8;background:#38bdf81a}.wbar.on.br b{color:#7dd3fc}.wbar button[data-op=bstart]{border-color:#38bdf8;color:#7dd3fc}.st.br{border-color:#38bdf8;background:#38bdf814}.st.br b{color:#7dd3fc}.st.inbr{margin-left:14px;border-left:3px solid #38bdf8}
    .elh{margin:6px 0 0;padding:6px;border:1px solid #2a2e3a;border-radius:8px;background:#0d0f15;font-family:Consolas,monospace;font-size:11px;max-height:30vh;overflow:auto}
    .elh .eh{color:#569cd6}.elh .at{color:#9cdcfe;padding:0 4px 0 14px;border-radius:4px;cursor:pointer;word-break:break-all}.elh .at:hover{background:#1a1d27}.elh .at.on{background:#e8a33d33;color:#f5b455}
    .elh .at.weak{opacity:.45}.elh .tx{color:#d4d4d4}.elh .kc{color:#6a9955}
    .pq{font-size:13px;padding:6px 8px;border-color:#e8a33d}.fnl{margin:4px 0 6px;max-height:34vh;overflow:auto}.fnh{opacity:.6;font-size:11px;padding:3px 2px}
    .fn{display:flex;gap:8px;align-items:baseline;padding:4px 6px;border-radius:6px;cursor:pointer}.fn b{white-space:nowrap;font-weight:600}.fn span{opacity:.6;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .fn:hover{background:#1a1d27}.fn.on{background:#e8a33d33;outline:1px solid #e8a33d}
    .det{border-top:1px solid #2a2e3a;margin-top:6px;padding-top:6px}.acts{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0}
    .toast{position:absolute;right:0;bottom:56px;background:#1a1d27;color:#e8e9ed;border:1px solid #e8a33d;border-radius:8px;padding:6px 10px;white-space:nowrap;box-shadow:0 4px 16px #0006}`;

  function mount() {
    if (!document.body) return setTimeout(mount, 100);
    if (window.__pmRecUI) return;
    host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647';
    window.__pmRecUI = host;
    root = host.attachShadow({ mode: 'closed' });
    setHTML(root, `<style>${CSS_UI}</style><div class="panel" hidden></div><div class="toast" hidden></div><div class="pick" hidden></div>
      <div class="pill" title="Bấm: ghi / tạm dừng / ghi tiếp (cùng 1 đoạn). ⏹: xuất code cả đoạn. Giữ Alt + rê chuột: chọn đúng phần tử"><span class="dot"></span><span class="lbl">REC</span><button data-op="caseEnd" title="Xong trường hợp đang ghi -- bước sau ra ngoài khối" hidden>✓ Xong TH</button><button data-op="export" title="Kết thúc đoạn + xuất code (editor + clipboard)" hidden>⏹ Xuất</button><button data-op="menu" title="Các bước đã ghi">☰</button></div>`);
    ui = { root, pill: root.querySelector('.pill'), panel: root.querySelector('.panel'), pick: root.querySelector('.pick'), toast: root.querySelector('.toast') };
    document.documentElement.appendChild(host);
    for (const t of ['input', 'change']) root.addEventListener(t, (e) => uiEvent(e, e.composedPath()[0]));
    for (const t of ['input', 'change']) host.addEventListener(t, (e) => e.stopPropagation()); // trang web không nhận sự kiện của panel
    refresh();
  }
  // kéo nút / thanh tiêu đề panel để dời chỗ
  let drag = null;
  function dragStart(e, el) {
    if (el.closest('button,select,input,label') || !(el.closest('.pill') || el.closest('.hd'))) return;
    const b = host.getBoundingClientRect(); drag = { x: e.clientX, y: e.clientY, r: innerWidth - b.right, b: innerHeight - b.bottom, moved: false };
  }
  const dragEnd = () => { const d = drag; setTimeout(() => { if (drag === d) drag = null; }); };
  addEventListener('mousemove', (e) => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true; host.style.right = Math.max(0, drag.r - dx) + 'px'; host.style.bottom = Math.max(0, drag.b - dy) + 'px'; }, true);
  addEventListener('mouseup', () => { if (drag) dragEnd(); }, true);

  function uiEvent(e, el) {
    const t = e.type, inPick = !!el.closest('.pick');
    if (t === 'mousedown') { // preventDefault: không đổi focus -> menu đang mở trên trang không bị đóng; ô của mình đang focus thì bỏ focus
      if (!el.closest('input,select,textarea,option')) { e.preventDefault(); const a = root.activeElement; if (a && a.blur) a.blur(); } // không bỏ thì draw() tưởng đang gõ, không vẽ lại -> bấm nút như không ăn
      dragStart(e, el);
    }
    else if (t === 'mouseup') dragEnd();
    else if (t === 'mouseover') onOver(el);
    else if (t === 'keydown') {
      if (inPick && pick && el.dataset.f === 'pq' && ['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) {
        e.preventDefault();
        if (e.key === 'Enter') return runFn((pick.fnRes || [])[pick.qi || 0]);
        pick.qi = Math.max(0, Math.min((pick.fnRes || []).length - 1, (pick.qi || 0) + (e.key === 'ArrowDown' ? 1 : -1)));
        setHTML(ui.pick.querySelector('.fnl'), fnListHTML()); return;
      }
      if (el.dataset.f === 'fq' && ['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(e.key)) {
        e.preventDefault();
        if (e.key === 'Enter') return runCall(fqRes[fqi]);
        if (e.key === 'Escape') { fq = ''; el.value = ''; return drawCallList(); }
        fqi = Math.max(0, Math.min(fqRes.length - 1, fqi + (e.key === 'ArrowDown' ? 1 : -1))); return drawCallList();
      }
      if (e.key === 'Escape') { if (pick) closePick(); else if (editing) { editing = null; draw(st); } else if (st && st.armed) { call({ op: 'arm' }).then(render); toast('Đã huỷ chờ chọn element'); } } else if (e.key === 'Enter' && el.tagName === 'INPUT') el.blur();
    }
    else if (t === 'input') {
      if (inPick && pick && el.dataset.f === 'ptext') pick.text = el.value;
      if (inPick && pick && el.dataset.f === 'pq') { pick.q = el.value; pick.qi = 0; setHTML(ui.pick.querySelector('.fnl'), fnListHTML()); }
      if (!inPick && el.dataset.f === 'fq') { fq = el.value; fqi = 0; drawCallList(); }
    }
    else if (t === 'click' || t === 'change') (inPick ? (pick && onPick(e, el)) : onPanel(e, el));
  }
  function onOver(el) {
    if (el.closest('.pick')) { const row = el.closest('.row'), r = row && pick && pick.rows[+row.dataset.i]; if (r) boxEl(r.el, r.b); else if (pick) { const s = pick.rows[pick.sel]; boxEl(s && s.el, s && s.b); } return; }
    if (pick) return;
    const card = el.closest('[data-css]'); highlight(card ? card.dataset.css : null);
  }
  let hlLab = null;
  function boxEl(el, rect, withLabel) {
    if (!hl) {
      hl = document.createElement('div'); hl.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #e8a33d;background:#e8a33d22;border-radius:3px';
      hlLab = document.createElement('div'); hlLab.style.cssText = 'all:initial;position:absolute;left:-2px;white-space:nowrap;font:600 11px/1.6 Consolas,monospace;color:#1a1206;background:#e8a33d;padding:0 6px;border-radius:3px;max-width:70vw;overflow:hidden;text-overflow:ellipsis';
      hl.appendChild(hlLab);
    }
    const b = el && el.isConnected ? el.getBoundingClientRect() : rect;
    if (!b) { hl.remove(); return; }
    Object.assign(hl.style, { left: b.left - 2 + 'px', top: b.top - 2 + 'px', width: b.width + 4 + 'px', height: b.height + 4 + 'px' });
    hlLab.style.display = withLabel && el ? '' : 'none';
    if (withLabel && el) { // nhãn kiểu DevTools: thẻ#id[data-testid] .class  rộng×cao
      const tid = el.getAttribute('data-testid'), cls = [...el.classList].filter(goodClass).slice(0, 2).map((c) => '.' + c).join('');
      hlLab.textContent = `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${tid ? `[data-testid="${tid}"]` : ''}${cls}  ${Math.round(b.width)}×${Math.round(b.height)}`;
      hlLab.style.top = b.top > 22 ? '-20px' : b.height + 4 + 'px';
    }
    document.documentElement.appendChild(hl);
  }
  function highlight(css) { let el = null; try { el = css && document.querySelector(css); } catch {} boxEl(el); }
  function toast(msg) { // bảng ☰ đang mở thì hiện phía trên bảng, không đóng bảng
    if (!ui) return;
    ui.toast.textContent = msg; ui.toast.hidden = false; ui.toast.style.bottom = (open ? ui.panel.offsetHeight + 64 : 56) + 'px';
    clearTimeout(toastT); toastT = setTimeout(() => { ui && (ui.toast.hidden = true); }, 3000);
  }
  function copyText(text) {
    const fallback = () => { const ta = document.createElement('textarea'); ta.value = text; document.documentElement.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch {} ta.remove(); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(fallback); else fallback();
  }
  // Ghi / tạm dừng / ghi tiếp (cùng 1 đoạn)
  function recToggle() {
    const fresh = !(st && st.segOpen);
    call({ op: 'rec' }).then((s) => {
      if (!s) return;
      render(s);
      toast(s.recording ? (fresh ? 'Đang ghi đoạn mới · giữ Alt + rê chuột để chọn đúng phần tử' : 'Ghi tiếp vào đoạn đang ghi') : 'Tạm dừng -- bấm lại để ghi tiếp, ⏹ để xuất cả đoạn');
    });
  }
  // Kết thúc đoạn + xuất code cả đoạn (mọi lần ghi / tạm dừng nối lại)
  function recExport() {
    call({ op: 'export' }).then((s) => {
      if (!s) return;
      render(s);
      if (s.exported) { copyText(s.exported.body); toast(`Đã xuất ${s.exported.count} bước → editor + clipboard`); }
      else toast('Đoạn này chưa có bước nào -- không có gì để xuất');
    });
  }
  function unmount() { closePick(); if (host) host.remove(); if (hl) hl.remove(); window.__pmRecUI = null; ui = null; root = null; }
  function render(s) { if (!s) return; st = s; if (!s.enabled) return unmount(); if (ui) draw(s); }
  function refresh() { call({ op: 'state' }).then(render); }
  const ELACTS = ['click', 'type', 'hover', 'wait', 'waitGone', 'ifClick', 'ifType', 'ifHover', 'getText', 'select', 'dblclick', 'rightClick', 'check', 'uncheck', 'scroll', 'pressKey', 'upload', 'getAttr', 'count', 'skip'];
  // Tô màu code 1 dòng (chuỗi, từ khoá, chú thích, số) -- tách token trên chữ gốc rồi mới escape từng mảnh
  const hlJs = (t) => {
    const re = /('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\/\/.*$|\/\^\(.*?\)\$\/|\b(?:await|const|let|if|else|while|for|of|break|continue|throw|new|true|false|null|try|catch)\b|\b\d+\b)/g;
    let out = '', last = 0, m;
    while ((m = re.exec(t))) { const v = m[0], cls = v.startsWith('//') ? 'c' : /^['"\/]/.test(v) ? 's' : /^\d/.test(v) ? 'n' : 'k'; out += esc(t.slice(last, m.index)) + `<i class="${cls}">${esc(v)}</i>`; last = re.lastIndex; }
    return out + esc(t.slice(last));
  };
  // Gợi ý hiện ngay dưới dòng code của bước: chờ kết quả sau click, gộp click lặp lại thành vòng với từng item
  function ghosts(x) {
    let h = '';
    if (x.effect) h += `<div class="ghost" data-id="${x.id}">💡 sau click hiện &lt;${esc(x.effect.tag)}&gt; ${esc(x.effect.label || '')}<button data-op="effOk" title="Thêm bước Chờ hiện ngay sau cú click">+ Chờ cái này hiện</button><button data-op="effNo" title="Bỏ gợi ý">✕</button></div>`;
    if (x.suggest && x.suggest.length && !String(x.text ?? '').startsWith('=')) h += `<div class="ghost" data-id="${x.id}">💡 chữ "${esc(String(x.text).slice(0, 30))}" khớp ô:${x.suggest.map((g) => `<button data-op="src" data-code="${esc(g.code)}" title="Thay bằng ${esc(g.code)}">${esc(g.label)}</button>`).join('')}</div>`;
    if (x.feGroup && x.feGroup.length >= 2 && x.item) h += `<div class="ghost" data-id="${x.id}">💡 ${x.feGroup.length} click giống nhau trên từng ${esc(x.item.list)} (trang đang có ${x.item.count})<button data-op="feOk">⟲ Gộp thành vòng với từng item</button></div>`;
    return h;
  }
  // Bảng ☰ dạng CODE: mỗi dòng nhớ thuộc bước nào (state.lines từ server) -- bấm 1 dòng mở chỉnh bước đó ngay bên dưới, rê chuột thấy
  // phần tử trên trang; dòng đỏ = bước hỏng khi Chạy thử; 🌐 = selector dựa vào chữ (đổi theo ngôn ngữ của profile)
  function codeView(s) {
    const byId = new Map(s.steps.map((x, i) => [x.id, [x, i]]));
    if (expId != null) { const k = s.lines.findIndex((l) => l.id === expId && !l.cursor && !l.hole); if (k >= 0) expK = k; expId = null; } // vừa gọi hàm -> mở sẵn chỉnh hàm đó
    let html = '', seg = false, no = 0;
    s.lines.forEach((ln, k) => {
      if (ln.cursor) { html += `<div class="ln cur"><span class="no"></span><code>${esc(ln.t)}</code><button data-op="curOff" title="Bỏ con trỏ -- bước mới lại nối vào cuối">✕</button></div>`; return; }
      no++;
      if (ln.hole) { html += `<div class="ln hole" data-hole="${esc(ln.hole)}" title="Bấm: các bước sau ghi vào trong khối này"><span class="no">${no}</span><code>${esc(ln.t)}</code></div>`; return; }
      const [x, i] = byId.get(ln.id) || [];
      if (s.segOpen && !seg && ln.id >= s.segFrom) { seg = true; html += `<div class="seg">— đoạn ${s.recording ? 'đang ghi' : 'tạm dừng'} (⏹ Xuất = xuất cả đoạn) —</div>`; }
      const bad = s.test && !s.test.ok && !s.test.running && s.test.step === ln.id, next = s.lines[k + 1], lastOfStep = !next || next.id !== ln.id;
      html += `<div class="ln${ln.dim ? ' dim' : ''}${bad ? ' bad' : ''}${expK === k ? ' on' : ''}${x && x.lang && !x.langAlt ? ' lang' : ''}" data-id="${ln.id}" data-k="${k}"${x && x.levels ? ` data-css="${esc(x.levels[x.level].css)}"` : ''}><span class="no">${no}</span><code>${hlJs(ln.t)}</code><span class="lt"><button data-op="here" title="Bước mới chèn vào SAU bước này">⤵</button><button data-op="up" title="Lên trên (sát While / hàm có khối thì đi vào trong, ở đầu / cuối khối thì ra ngoài)">↑</button><button data-op="down" title="Xuống dưới">↓</button><button data-op="del" title="Xoá bước">✕</button></span></div>`;
      const lastOfStep2 = lastOfStep || (next && (next.cursor || next.hole) && !s.lines.slice(k + 1).some((l) => l.id === ln.id && !l.cursor && !l.hole));
      if (bad && lastOfStep2) html += `<div class="ghost err">✗ ${esc(s.test.error)}</div>`;
      if (expK === k && x) html += `<div class="edit">${stepHTML(x, i, s.actions || {})}</div>`;
      if (x && lastOfStep) html += ghosts(x);
    });
    return `<div class="codev">${html}</div>`;
  }
  const testBar = (t) => (!t ? '' : t.running ? '<div class="tbar run">▶ Đang chạy thử trên trang này… (đừng thao tác)</div>'
    : t.ok ? `<div class="tbar ok">✓ Chạy thử OK -- ${t.n} bước, ${(t.ms / 1000).toFixed(1)}s<span class="grow"></span><button data-op="tclose">✕</button></div>`
      : `<div class="tbar bad">✗ Chạy thử hỏng${t.step ? ' ở dòng tô đỏ' : ''}: ${esc(t.error)}<span class="grow"></span><button data-op="tclose">✕</button>${t.logs && t.logs.length ? `<details><summary>log</summary><pre>${esc(t.logs.join('\n'))}</pre></details>` : ''}</div>`);
  // Lấy chữ gõ từ Excel / Google Sheet: danh sách cột (server gửi trong state.sources, kèm giá trị ở dòng của profile)
  const srcSelect = (f) => (st && st.sources && st.sources.length ? `<div class="r"><select data-f="${f}" class="grow" title="Thay chữ cố định bằng giá trị ô Excel / Google Sheet ở dòng của profile đang chạy"><option value="">Lấy từ cột Excel / Sheet${st.rowNum ? ` (dòng ${st.rowNum} của profile này)` : ' (chưa khớp dòng của profile này)'}…</option>${st.sources.map((g) => `<optgroup label="${esc(g.label)}">${g.opts.map((o) => `<option value="${esc(o.code)}">${esc(o.label)}</option>`).join('')}</optgroup>`).join('')}</select></div>` : '');
  const sugHTML = (x) => (x.suggest && x.suggest.length ? `<div class="sug"><span>Khớp ô:</span>${x.suggest.map((g) => `<button data-op="src" data-code="${esc(g.code)}" title="Dùng ${esc(g.code)}">${esc(g.label)}</button>`).join('')}</div>` : '');
  function stepHTML(x, i, acts) {
    const tools = `<span class="grow"></span><button data-op="up" title="Lên trên">↑</button><button data-op="down" title="Xuống dưới">↓</button><button data-op="del" title="Xoá bước${x.action === 'loop' ? ' (các If bên trong ra ngoài thành bước thường)' : ''}">✕</button>`;
    if (x.action === 'fn') return `<div class="st fnst" data-id="${x.id}"><div class="r"><span class="n">${i + 1}</span><b>ƒ ${esc(x.name)}</b>${tools}</div>
      ${(x.slotInfo || []).map((sl) => { const on = st.armed && st.armed.stepId === x.id && st.armed.key === sl.key; return `<div class="r slot${on ? ' on' : ''}"><span class="lv">${esc(sl.label)}</span><span class="grow sc">${sl.code ? esc(sl.code) : '— chưa chọn —'}</span><button data-op="arm" data-key="${esc(sl.key)}"${sl.code || on ? '' : ' class="pri"'} title="Bấm rồi giữ Alt chọn element trên trang, nhả Alt bấm ✓ Chốt">${on ? '⏳ chờ Alt… (bấm để huỷ)' : sl.code ? '🎯 Chọn lại' : '🎯 Pick element'}</button></div>`; }).join('')}
      <textarea data-f="tpl" rows="${Math.min(9, String(x.tpl).split('\n').length + 1)}" spellcheck="false" title="Sửa code mẫu: 'SELECTOR' = ô element (chọn bằng 🎯), TEXT / VALUE... = giá trị; dòng trống trong { } = chỗ chèn bước con">${esc(x.tpl)}</textarea>
      ${x.holes ? '<div class="tag">Khối { }: bấm dòng "▸ trống" trong code (hoặc ↑ ↓ 1 bước sát hàm) để đưa bước vào trong khối</div>' : ''}</div>`;
    if (x.action === 'case') {
      const lv = x.levels[x.level], ci = x.caseInfo || { kids: 0, extra: [] };
      return `<div class="st case" data-id="${x.id}" data-css="${esc(lv.css)}"><div class="r"><span class="n">${i + 1}</span><b>◆ Trường hợp</b><span class="lv">khi element</span><select data-f="neg"><option value="0">${x.textEq ? 'có chữ là' : 'đang hiện'}</option><option value="1" ${x.neg ? 'selected' : ''}>${x.textEq ? 'có chữ KHÁC' : 'KHÔNG hiện'}</option></select>${tools}</div>
      <div class="info">&lt;${esc(lv.tag)}&gt; ${esc(lv.size)} ${esc(lv.label)}</div>
      <div class="r"><select data-f="alt" class="grow">${lv.alts.map((a, k) => `<option value="${k}" ${k === x.alt && !x.custom ? 'selected' : ''}>${esc(altLabel(a))}</option>`).join('')}${x.custom ? `<option value="custom" selected>sửa tay: ${esc(x.custom)}</option>` : ''}</select><button data-op="edit" title="Tự sửa selector">✎</button></div>
      ${editing === x.id ? `<div class="r"><input class="grow" data-f="custom" value="${esc(x.custom || (lv.alts[x.alt] || lv.alts[0] || {}).code)}" title="Enter để lưu, Esc để huỷ"></div>` : ''}
      <div class="r"><span class="lv">chữ</span><input class="grow" data-f="textEq" value="${esc(x.textEq || '')}" placeholder="trống = chỉ xét hiện / không hiện; có chữ = so chữ của element"></div>
      ${ci.extra.map((c, k) => `<div class="r"><span class="lv">VÀ ${c.neg ? 'không hiện' : 'hiện'}</span><span class="grow sc">${esc(c.code)}</span><button data-op="dropExtra" data-i="${k}" title="Bỏ điều kiện này">✕</button></div>`).join('')}
      <div class="r"><span class="lv">làm xong thì</span><select data-f="end"><option value="continue" ${x.end === 'continue' ? 'selected' : ''}>quét lại từ đầu (continue)</option><option value="break" ${x.end === 'break' ? 'selected' : ''}>thoát While (break)</option><option value="none" ${!x.end || x.end === 'none' ? 'selected' : ''}>đi tiếp xuống dưới</option></select>
        <label class="lv" title="count() > 0, kể cả đang ẩn"><input type="checkbox" data-f="cond" ${x.cond === 'dom' ? 'checked' : ''}> có trong DOM</label></div>
      <div class="tag">${ci.kids} bước bên trong${st.inCase === x.id ? ' · đang ghi vào đây (✓ Xong ở thanh REC khi làm xong)' : ' · bấm dòng "▸ trống" / ⤵ để ghi thêm vào'} · giữ Alt → "VÀ ..." để ghép điều kiện</div></div>`;
    }
    if (x.action === 'loop') return `<div class="st loop" data-id="${x.id}"><div class="r"><span class="n">${i + 1}</span><b>⟳ While${+x.timeout > 0 ? '' : ' (true)'}</b><span class="lv">giới hạn</span><input type="number" min="0" data-f="timeout" value="${+x.timeout || 0}" style="width:56px" title="0 = while (true), chỉ thoát khi gặp break"><span class="lv">giây (0 = không) · ${x.inner} if${st.openLoop === x.id ? ' · đang mở' : ''}</span>${tools}</div>
      <div class="r"><span class="lv">tối đa</span><input type="number" min="0" data-f="maxN" value="${+x.maxN || 0}" style="width:56px" title="Quá số vòng này thì báo lỗi dừng script (0 = không giới hạn)"><span class="lv">vòng · chưa khớp trường hợp nào thì nghỉ</span><input type="number" min="0" step="100" data-f="idle" value="${+x.idle || 500}" style="width:64px"><span class="lv">ms</span></div>
      ${x.hasBreak ? '' : `<div class="tag">⚠ chưa có Break -- ${+x.timeout > 0 ? `vòng lặp chạy đủ ${+x.timeout} giây mới ra` : 'while (true) sẽ chạy mãi (tới khi hết giờ script)'}; thêm "If có → Break" hoặc tick "rồi Break" ở 1 If</div>`}<div class="code">${esc(x.code)}</div></div>`;
    if (x.action === 'branch') return `<div class="st br" data-id="${x.id}"><div class="r"><span class="n">${i + 1}</span><b>⑂ Nhánh</b><span class="lv">chờ tối đa</span><input type="number" min="1" data-f="timeout" value="${+x.timeout || 15}" style="width:56px"><span class="lv">giây · ${x.kids} nhánh${st.openBranch === x.id ? ' · đang mở' : ''}</span>${tools}</div><div class="tag">Chờ các phần tử bên dưới, cái nào hiện TRƯỚC thì làm việc của nó (waitAny)</div></div>`;
    if (x.action === 'forEach') return `<div class="st" data-id="${x.id}"><div class="r"><span class="n">${i + 1}</span><b>⟲ Với từng item</b>${tools}</div>
      <div class="r"><span class="lv">danh sách</span><input class="grow" data-f="list" value="${esc(x.list)}"></div>
      <div class="r"><span class="lv">trong item</span><input class="grow" data-f="inner" value="${esc(x.inner)}"><select data-f="innerAction"><option value="click" ${x.innerAction !== 'hover' ? 'selected' : ''}>Click</option><option value="hover" ${x.innerAction === 'hover' ? 'selected' : ''}>Hover</option></select></div>
      <div class="r"><span class="lv">tối đa</span><input type="number" min="0" data-f="limit" value="${+x.limit || 0}" style="width:60px"><span class="lv">item (0 = tất cả)</span></div><div class="code">${esc(x.code)}</div></div>`;
    if (x.inLoop) acts = st.loopActions;
    if (x.inBranch) acts = st.branchActions;
    if (!x.levels) return `<div class="st" data-id="${x.id}"><div class="r"><span class="n">${i + 1}</span>
      <select data-f="action"><option value="${x.action === 'skip' ? (x.url ? 'nav' : 'press') : x.action}">${esc(acts[x.url ? 'nav' : 'press'])}</option><option value="skip" ${x.action === 'skip' ? 'selected' : ''}>Bỏ qua</option></select>
      ${x.url ? `<label class="lv"><input type="checkbox" data-f="auto" ${x.auto ? 'checked' : ''}> tự chuyển (do click)</label>` : ''}${tools}</div><div class="code">${esc(x.code || '// (bỏ qua)')}</div></div>`;
    const lv = x.levels[x.level], list = x.inLoop ? Object.keys(st.loopActions).filter((a) => !/^case/.test(a)) : x.inBranch ? Object.keys(st.branchActions) : [...ELACTS, ...(x.opens ? ['clickTab'] : []), ...(x.href ? ['gotoLink'] : []), ...(x.href || x.tabUrl ? ['gotoUrl'] : [])];
    const tags = `${x.frame ? `↳ trong iframe (${x.frame}) ` : ''}${x.inBranch ? '↳ 1 nhánh của Nhánh ' : ''}${x.tabVar ? `↳ ở tab mới (${x.tabVar}) ` : ''}${x.opens ? `↗ click mở tab mới${x.tabUrl ? ': ' + x.tabUrl : ''} ` : ''}${x.download ? '⬇ tải file ' : ''}${x.error ? '⚠ ' + x.error : ''}`;
    const cur = x.inLoop || x.inBranch ? ({ ifClick: 'click', ifType: 'type', ifHover: 'hover' }[x.action] || x.action) : x.action; // trong While / Nhánh click / ifClick như nhau
    return `<div class="st${x.inLoop ? ' inloop' : ''}${x.inBranch ? ' inbr' : ''}" data-id="${x.id}" data-css="${esc(lv.css)}"><div class="r"><span class="n">${i + 1}</span>
      <select data-f="action">${list.map((a) => `<option value="${a}" ${a === cur ? 'selected' : ''}>${esc(acts[a])}</option>`).join('')}</select>
      <button data-op="parent" title="Chọn phần tử CHA bao ngoài" ${x.level >= x.levels.length - 1 ? 'disabled' : ''}>⬆ cha</button>
      <button data-op="child" title="Quay về phần tử CON bên trong" ${x.level <= 0 ? 'disabled' : ''}>⬇ con</button>
      <span class="lv">cấp ${x.level}/${x.levels.length - 1}</span>${tools}</div>
      <div class="info">&lt;${esc(lv.tag)}&gt; ${esc(lv.size)} ${esc(lv.label)}</div>${tags ? `<div class="tag">${esc(tags)}</div>` : ''}
      ${x.inLoop ? `<div class="r">${['loopBreak', 'loopFail'].includes(x.action) ? '' : `<label class="lv"><input type="checkbox" data-f="thenBreak" ${x.thenBreak ? 'checked' : ''}> rồi Break</label>`}<label class="lv" title="count() > 0, kể cả đang ẩn -- bỏ tick = phải đang hiện"><input type="checkbox" data-f="cond" ${x.cond === 'dom' ? 'checked' : ''}> có trong DOM (kể cả ẩn)</label></div>` : ''}
      <div class="r"><select data-f="alt" class="grow">${lv.alts.map((a, k) => `<option value="${k}" ${k === x.alt && !x.custom ? 'selected' : ''}>${esc(altLabel(a))}</option>`).join('')}${x.custom ? `<option value="custom" selected>sửa tay: ${esc(x.custom)}</option>` : ''}</select>
      <button data-op="edit" title="Tự sửa selector">✎</button></div>
      ${x.lang ? `<div class="r"><span class="lv" title="Selector dựa vào chữ hiện ra -- profile khác ngôn ngữ sẽ thấy chữ khác">🌐 chữ ngôn ngữ khác</span><input class="grow" data-f="langAlt" value="${esc(x.langAlt || '')}" placeholder="VD: Thích|Me gusta (cách nhau bằng |)"></div>` : ''}
      ${x.bkCode ? `<div class="r"><label class="lv" title="Ghép thêm 1 selector khác bằng .or(...) -- trang đổi 1 thuộc tính thì cái kia vẫn bắt được"><input type="checkbox" data-f="backup" ${x.bkOn ? 'checked' : ''}> dự phòng .or(${esc(x.bkCode.slice(0, 70))})</label></div>` : ''}
      ${editing === x.id ? `<div class="r"><input class="grow" data-f="custom" value="${esc(x.custom || (lv.alts[x.alt] || lv.alts[0] || {}).code)}" title="Enter để lưu, Esc để huỷ"></div>` : ''}
      ${['type', 'ifType', 'select'].includes(x.action) ? `<div class="r"><input class="grow" data-f="text" value="${esc(x.text)}" title="Bắt đầu bằng = để dùng biểu thức JS, VD: = row.D">${x.action !== 'select' ? `<label class="lv"><input type="checkbox" data-f="enter" ${x.enter ? 'checked' : ''}> Enter</label>` : ''}</div>${sugHTML(x)}${srcSelect('src')}` : ''}
      ${['pressKey', 'upload', 'getAttr'].includes(x.action) ? `<div class="r"><span class="lv">${{ pressKey: 'phím', upload: 'file', getAttr: 'thuộc tính' }[x.action]}</span><input class="grow" data-f="text" value="${esc(x.text || '')}" placeholder="${{ pressKey: 'Enter / Escape / Tab / Control+A...', upload: 'đường dẫn file (= để dùng biểu thức JS)', getAttr: 'href' }[x.action]}"></div>` : ''}
      <div class="code">${esc(x.code || '// (bỏ qua)')}</div></div>`;
  }
  function draw(s) {
    const segN = s.steps.filter((x) => x.id >= s.segFrom).length;
    ui.pill.classList.toggle('rec', !!s.recording);
    ui.pill.classList.toggle('paused', !!s.segOpen && !s.recording);
    const arm = armedInfo();
    ui.pill.classList.toggle('armed', !!arm);
    ui.pill.querySelector('.lbl').textContent = arm ? `🎯 Alt → ${arm.label}` : s.recording ? `REC · ${segN} bước` : s.segOpen ? `⏸ Tạm dừng · ${segN} bước` : 'Ghi';
    ui.pill.querySelector('[data-op=export]').hidden = !s.segOpen;
    ui.pill.querySelector('[data-op=caseEnd]').hidden = !s.inCase;
    if (!open) return;
    const a = ui.root.activeElement;
    if (a && (a.tagName === 'INPUT' && a.type !== 'checkbox' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA')) return; // đang sửa 1 ô -- không vẽ lại kẻo mất con trỏ
    const list = ui.panel.querySelector('.list'), scroll = list ? list.scrollTop : 0;
    const cards = () => s.steps.map((x, i) => (s.segOpen && x.id >= s.segFrom && (i === 0 || s.steps[i - 1].id < s.segFrom) ? `<div class="seg">— đoạn ${s.recording ? 'đang ghi' : 'tạm dừng'} (⏹ Xuất = xuất cả đoạn) —</div>` : '') + stepHTML(x, i, s.actions || {}) + ghosts(x)).join('');
    const blockBtns = s.inCase ? '<button data-op="caseEnd" title="Xong trường hợp đang ghi">✓ Xong trường hợp</button>' : !s.segOpen ? '' : s.openLoop ? '<button data-op="wend" title="Kết thúc vòng lặp">Đóng While</button>' : s.openBranch ? '<button data-op="bend" title="Kết thúc Nhánh">Đóng Nhánh</button>'
      : '<button data-op="wstart" title="Mở vòng lặp while -- bước ghi / chọn sau đó thành các If trong vòng lặp">⟳ While</button><button data-op="bstart" title="Chờ nhiều phần tử, cái nào hiện trước thì làm việc của nó (waitAny)">⑂ Nhánh</button>';
    const html = `<div class="hd"><b>${view === 'code' ? 'Code' : 'Các bước'}</b>
        <button data-op="rec">${s.recording ? '⏸ Tạm dừng' : s.segOpen ? '▶ Ghi tiếp' : '⏺ Ghi đoạn mới'}</button>${s.segOpen ? '<button data-op="export">⏹ Xuất</button>' : ''}${blockBtns}
        ${s.canRun ? `<button data-op="test" title="Chạy ${s.segOpen ? 'đoạn đang ghi' : 'mọi bước'} trên chính trang này, báo bước nào hỏng" ${testing || (s.test && s.test.running) ? 'disabled' : ''}>▶ Chạy thử</button>` : ''}
        <button data-op="copy" class="pri">Copy</button>${!s.steps.length && s.canUndo ? '<button data-op="undo">↶ Khôi phục</button>' : '<button data-op="clear">Xoá hết</button>'}<button data-op="view" title="${view === 'code' ? 'Xem dạng ô (mỗi bước 1 ô)' : 'Xem dạng code'}">${view === 'code' ? '▤' : '{ }'}</button><button data-op="close" title="Thu nhỏ">—</button></div>
      <div class="fbar"><input data-f="fq" value="${esc(fq)}" placeholder="ƒ Gọi hàm: gõ tên -- if, while, nhánh, pause, goto, tab mới, excel..." autocomplete="off" spellcheck="false"><div class="fnl2"${fq ? '' : ' hidden'}>${fq ? callListHTML() : ''}</div></div>
      ${testBar(testing ? { running: true } : s.test)}<div class="list">${s.steps.length ? (view === 'code' ? codeView(s) : cards()) : '<div class="empty">Chưa có bước nào -- cứ thao tác trên trang, code sẽ hiện ở đây. Giữ Alt + rê chuột để chọn đúng phần tử.</div>'}</div>`;
    if (html === lastPanel && ui.panel.firstChild) return; // làm mới định kỳ mà không có gì đổi -> không vẽ lại (đỡ giật, không mất chỗ đang rê / cuộn)
    lastPanel = html;
    setHTML(ui.panel, html);
    ui.panel.querySelector('.list').scrollTop = scroll;
  }
  // Ô ƒ Gọi hàm (bảng ☰): While / Nhánh (lệnh ghi của recorder) + mọi hàm trong danh sách. Chọn -> thêm vào code ở con trỏ chèn;
  // hàm có ô element -> bấm 🎯 Pick rồi giữ Alt chọn; hàm có khối { } -> con trỏ tự vào trong khối
  function callChoices() {
    const c = st && st.openLoop ? [{ cmd: 'wend', name: 'Đóng While', keys: 'dong end ket thuc while', desc: 'bước sau ra ngoài vòng lặp' }]
      : st && st.openBranch ? [{ cmd: 'bend', name: 'Đóng Nhánh', keys: 'dong end ket thuc nhanh', desc: 'bước sau ra ngoài Nhánh' }]
        : [{ cmd: 'wstart', name: '⟳ While -- lặp, element chọn sau thành các If', keys: 'while lap loop vong', desc: 'while (true), thoát bằng break' }, { cmd: 'bstart', name: '⑂ Nhánh -- cái nào hiện trước', keys: 'nhanh branch waitany cai nao truoc', desc: 'waitAny + if / else if' }];
    return [...c, ...((st && st.callFns) || [])];
  }
  function callListHTML() {
    fqRes = fnSearch(fq, callChoices(), 12);
    if (!fqRes.length) return '<div class="fnh">Không có hàm nào khớp</div>';
    fqi = Math.min(fqi, fqRes.length - 1);
    return fqRes.map((x, i) => `<div class="fn${i === fqi ? ' on' : ''}" data-ci="${i}" data-fn="${esc(x.fn || x.cmd)}"><b>${esc(x.name)}</b><span>${esc(x.desc || '')}</span></div>`).join('');
  }
  const drawCallList = () => { const l = ui.panel.querySelector('.fnl2'); if (!l) return; l.hidden = !fq; setHTML(l, fq ? callListHTML() : ''); };
  function runCall(x) {
    if (!x) return;
    fq = ''; fqi = 0;
    const a = root.activeElement; if (a && a.blur) a.blur();
    if (x.cmd) {
      if (['wstart', 'bstart'].includes(x.cmd) && !(st && st.segOpen)) { draw(st); return toast('Bấm ghi trước (⏺) rồi mới mở While / Nhánh'); }
      const op = { wstart: 'loopStart', wend: 'loopEnd', bstart: 'branchStart', bend: 'branchEnd' }[x.cmd];
      call({ op }).then((s) => { render(s); toast({ wstart: '⟳ Đã mở While -- element chọn (giữ Alt) sau đó là các If trong vòng lặp', bstart: '⑂ Đã mở Nhánh -- giữ Alt chọn từng element có thể hiện ra', wend: 'Đã đóng While', bend: 'Đã đóng Nhánh' }[x.cmd]); });
      return;
    }
    call({ op: 'fnAdd', fn: x.fn }).then((s) => {
      if (!s) return;
      expId = s.added; lastPanel = ''; render(s);
      const y = s.steps.find((z) => z.id === s.added);
      toast(`Đã thêm ${x.name}${y && y.slotInfo && y.slotInfo.length ? ' -- bấm 🎯 Pick element' : ''}${y && y.holes ? ' · bước sau ghi vào trong khối' : ''}`);
    });
  }
  const upd = (stepId, patch) => call({ op: 'update', stepId, patch }).then((s) => { render(s); const x = s && s.steps.find((y) => y.id === stepId); highlight(x && x.levels ? x.levels[x.level].css : null); });
  function onPanel(e, el) {
    if (el.closest('.pill')) {
      if (e.type !== 'click' || (drag && drag.moved)) return;
      if (el.closest('[data-op=menu]')) { open = !open; ui.panel.hidden = !open; ui.toast.hidden = true; if (!open) highlight(null); refresh(); }
      else if (el.closest('[data-op=export]')) recExport();
      else if (el.closest('[data-op=caseEnd]')) call({ op: 'caseEnd' }).then((s) => { render(s); toast('✓ Xong trường hợp -- bước sau ra ngoài khối'); });
      else recToggle();
      return;
    }
    const fnEl = el.closest('.fnl2 .fn');
    if (fnEl) { if (e.type === 'click') runCall(fqRes[+fnEl.dataset.ci]); return; }
    if (el.dataset && el.dataset.f === 'fq') return;
    const card = el.closest('[data-id]'), stepId = card ? +card.dataset.id : null, step = st && st.steps.find((x) => x.id === stepId);
    if (e.type === 'change' && el.dataset.f && step) {
      const f = el.dataset.f;
      if (f === 'action') upd(stepId, { action: el.value });
      else if (f === 'alt') { if (el.value !== 'custom') upd(stepId, { alt: +el.value }); }
      else if (f === 'text') upd(stepId, { text: el.value });
      else if (f === 'src') { if (el.value) upd(stepId, { text: '= ' + el.value }); }
      else if (f === 'timeout') upd(stepId, { timeout: Math.max(0, +el.value || 0) });
      else if (f === 'cond') upd(stepId, { cond: el.checked ? 'dom' : null });
      else if (['list', 'inner', 'innerAction', 'langAlt'].includes(f)) upd(stepId, { [f]: el.value.trim() });
      else if (f === 'limit') upd(stepId, { limit: Math.max(0, +el.value || 0) });
      else if (f === 'custom') { editing = null; if (el.value.trim()) upd(stepId, { custom: el.value.trim() }); else draw(st); }
      else if (f === 'tpl') upd(stepId, { tpl: el.value });
      else if (f === 'neg') upd(stepId, { neg: el.value === '1' });
      else if (f === 'textEq') upd(stepId, { textEq: el.value });
      else if (f === 'end') upd(stepId, { end: el.value });
      else if (f === 'maxN' || f === 'idle') upd(stepId, { [f]: Math.max(0, +el.value || 0) });
      else upd(stepId, { [f]: el.checked });
      el.blur();
      return;
    }
    if (e.type !== 'click') return;
    const btn = el.closest('button'), op = btn && btn.dataset.op, ln = el.closest('.ln');
    const hole = el.closest('[data-hole]');
    if (hole && !btn) { call({ op: 'cursorHole', key: hole.dataset.hole }).then((s) => { render(s); toast('▸ Bước mới sẽ ghi vào trong khối này'); }); return; }
    if (ln && !btn) { const k = +ln.dataset.k; expK = expK === k ? -1 : k; editing = null; draw(st); return; } // bấm 1 dòng code: mở / đóng chỉnh bước đó
    if (!op) return;
    if (op === 'caseEnd') { call({ op: 'caseEnd' }).then((s) => { render(s); toast('✓ Xong trường hợp'); }); return; }
    if (op === 'curOff') { call({ op: 'cursorOff' }).then((s) => { render(s); toast('Bước mới lại nối vào cuối'); }); return; }
    if (op === 'close') { open = false; ui.panel.hidden = true; highlight(null); return; }
    if (op === 'view') { view = view === 'code' ? 'cards' : 'code'; expK = -1; draw(st); return; }
    if (op === 'test') { testing = true; draw(st); call({ op: 'testRun' }).then((s) => { testing = false; render(s); }); return; } // testing: đợt làm mới định kỳ về trước không đè lại kết quả cũ
    if (op === 'tclose') { call({ op: 'testClear' }).then(render); return; }
    if (op === 'bstart' || op === 'bend') { call({ op: op === 'bstart' ? 'branchStart' : 'branchEnd' }).then((s) => { render(s); toast(op === 'bstart' ? '⑂ Đã mở Nhánh -- chọn (giữ Alt) từng phần tử có thể hiện ra, mỗi cái 1 nhánh' : 'Đã đóng Nhánh'); }); return; }
    if (op === 'copy') { copyText(st.code); btn.textContent = 'Đã copy ✓'; setTimeout(() => { lastPanel = ''; draw(st); }, 1200); return; }
    if (op === 'rec') { recToggle(); return; }
    if (op === 'export') { recExport(); return; }
    if (op === 'clear') { call({ op: 'clear' }).then(render); return; } // không hỏi lại (confirm() bị Playwright tự đóng) -- xoá nhầm thì bấm Khôi phục
    if (op === 'undo') { call({ op: 'undoClear' }).then(render); return; }
    if (op === 'wstart' || op === 'wend') { call({ op: op === 'wstart' ? 'loopStart' : 'loopEnd' }).then((s) => { render(s); toast(op === 'wstart' ? '⟳ Đã mở While -- bước ghi / chọn sau đó là các If trong vòng lặp' : 'Đã đóng While'); }); return; }
    if (!step) return;
    if (op === 'src') { upd(stepId, { text: '= ' + btn.dataset.code }); return; }
    if (op === 'effOk' || op === 'effNo') { call({ op: 'effect', stepId, accept: op === 'effOk' }).then(render); return; }
    if (op === 'feOk') { call({ op: 'forEach', stepId }).then((s) => { render(s); toast('⟲ Đã gộp thành vòng với từng item'); }); return; }
    if (op === 'dropExtra') { call({ op: 'dropExtra', stepId, i: +btn.dataset.i }).then(render); return; }
    if (op === 'here') { call({ op: 'cursor', stepId }).then((s) => { render(s); toast('▸ Bước mới sẽ chèn sau bước này'); }); return; }
    if (op === 'arm') { const on = st.armed && st.armed.stepId === stepId && st.armed.key === btn.dataset.key; call({ op: 'arm', stepId: on ? null : stepId, key: btn.dataset.key }).then((s) => { render(s); toast(on ? 'Đã huỷ chờ chọn element' : '🎯 Giữ Alt + rê chuột lên element, nhả Alt rồi bấm ✓ Chốt (Enter)'); }); return; }
    if (op === 'del') { expK = -1; call({ op: 'delete', stepId }).then(render); }
    else if (op === 'up' || op === 'down') call({ op: 'move', stepId, dir: op === 'up' ? -1 : 1 }).then(render);
    else if (op === 'parent') upd(stepId, { level: step.level + 1 });
    else if (op === 'child') upd(stepId, { level: step.level - 1 });
    else if (op === 'edit') { editing = editing === stepId ? null : stepId; draw(st); const i = ui.panel.querySelector('[data-f=custom]'); if (i) i.focus(); }
  }
  const tryMount = window.__pmRecMount = () => (typeof window.__pmRec === 'function' ? call({ op: 'state' }).then((s) => { if (s && s.enabled) mount(); }) : setTimeout(tryMount, 200));
  if (!isTop) return; // iframe: tới đây là đủ (ghi sự kiện); giao diện chỉ ở khung chính
  tryMount();
  // đồng bộ với server (bước ghi từ tab khác, tắt record từ editor...)
  setInterval(() => { if (window.__pmRecUI) refresh(); }, 1500);
}

// Tạm dừng ghi (lúc chạy script) -- trả về hàm để bật lại đúng trạng thái cũ
function pauseRecorder(id) {
  const r = recorders[id];
  if (!r || !r.recording) return () => {};
  r.recording = false;
  return () => { if (recorders[id] === r && r.enabled) r.recording = true; };
}

// Code các đoạn đã dừng (bấm REC lần 2) có id > since -- editor tự chèn
const recorderExports = (id, since = 0) => (recorders[id]?.exports || []).filter((e) => e.id > since);

module.exports = { startRecorder, stopRecorder, pauseRecorder, recorderState: stateOf, recorderExports, recorderHeader: HEADER, recorderCode: (id, withRequire) => buildCode(recorders[id]?.steps || [], withRequire) };
