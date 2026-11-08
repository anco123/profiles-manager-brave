/**
 * test/recorder.test.js -- test recorder.js trên Chromium headless: ghi While theo trường hợp, mở lại While đã ⏹ Xuất để ghi thêm,
 * màn hình lạ (▶ Chạy thử + code xuất ra chạy thật), gợi ý "Chờ hiện" ở cuối trường hợp. Chuột: hàm người thật của scripts/ (clickEl, hoverEl,
 * clickVisibly) -- không dùng page.click.
 * Chạy: node test/recorder.test.js   (PW_CHROMIUM=đường/dẫn/chrome để đổi trình duyệt; mặc định /opt/pw-browsers/chromium nếu có)
 */
const http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert');
const { chromium } = require('playwright');
process.env.PM_NO_CLIPBOARD = '1'; // test không ghi đè clipboard của máy
process.env.PM_REC_OPEN_SHADOW = '1'; // giao diện recorder dùng shadow DOM mở để locator thấy nút (chạy trong thế giới cách ly nên không vá attachShadow được)
const rec = require('../recorder');
const A = require('../scripts/xlv1_actions');
const helpers = require('../scripts/helpers');

const SCRIPTS = path.join(__dirname, '..', 'scripts'), ID = 'test-rec', AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
let mode = 'normal', page = null, done = 0;
const shots = new Set();
// Trang thử: Next -> ẩn Next, hiện hộp thoại (role=dialog + data-testid -- recorder thấy "element mới hiện sau click"); Đóng -> chữ thường.
// mode 'strange': trang lạ, không có element nào của các trường hợp đã ghi
const PAGE = () => `<!doctype html><html><head><meta charset="utf-8"></head><body style="font:16px sans-serif;padding:40px">${mode === 'strange' ? '<h1 id="lost">Trang lạ: đang bảo trì</h1>' : '<button id="next">Next</button><div id="area"></div>'}
<script>const n = document.getElementById('next'); if (n) n.onclick = () => { n.style.display = 'none'; const a = document.getElementById('area'); a.innerHTML = '<div role="dialog" data-testid="doneDialog">Xong rồi <button id="close">Đóng</button></div>'; document.getElementById('close').onclick = () => { a.innerHTML = '<p>Đã đóng</p>'; }; };</script></body></html>`;

// Chạy code y như runScriptOnProfile của server (AsyncFunction + require trong scripts/, tạm dừng ghi lúc chạy)
async function runCode(code) {
  const logs = [], resume = rec.pauseRecorder(ID);
  page.__profileId = ID;
  try {
    const result = await new AsyncFunction('page', 'context', 'log', 'require', 'input', code)(page, page.context(), (...a) => logs.push(a.join(' ')), (m) => require(m.startsWith('./') ? path.join(SCRIPTS, m) : m), '');
    return { logs, result };
  } catch (e) { e.logs = logs; throw e; } finally { resume(); }
}
const st = () => rec.recorderState(ID);
const until = async (fn, ms = 8000, what = 'điều kiện') => { for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 150))) { const v = fn(); if (v) return v; } throw new Error('Hết giờ chờ: ' + what); };
const call = (msg) => rec.recorderHandle(ID, page, msg); // gửi lệnh như giao diện recorder (từ phía server)
const shotOf = (t) => { const m = /ảnh: (\S+\.png)/.exec(t || ''); if (m) shots.add(m[1]); return m && m[1]; };
// Bấm nút trong giao diện recorder (shadow DOM): đi chuột thật + nhấn (clickVisibly theo toạ độ -- clickEl kiểm tra "bị đè" bằng
// document.elementFromPoint, với phần tử trong shadow DOM luôn ra thẻ host nên báo bị đè oan)
async function uiClick(loc) { await loc.waitFor({ state: 'visible', timeout: 8000 }); await helpers.clickVisibly(page, await loc.boundingBox()); await page.waitForTimeout(300); }
// Giữ Alt + rê chuột lên element, nhả Alt, Enter = ✓ Thêm vào kho (bảng 2 ô đang mở thì điền vào ô Element)
async function altAdd(loc) {
  await page.keyboard.down('Alt'); await A.hoverEl(loc); await page.waitForTimeout(150); await page.keyboard.up('Alt');
  await page.locator('.pick [data-op=pslot]').waitFor({ timeout: 5000 });
  await page.keyboard.press('Enter'); await page.waitForTimeout(500);
}
// Bảng ☰ sang dạng 'Khối' / 'Code' (bấm ▦ Khối / { } Code, bấm lại nếu lần bấm chưa ăn)
async function setView(name) { for (let i = 0; i < 3 && (await page.locator('.hd b').first().innerText()) !== name; i++) { await uiClick(page.locator('.hd [data-op=vblocks]')); await page.waitForTimeout(300); } assert.strictEqual(await page.locator('.hd b').first().innerText(), name); }
// Bảng 2 ô: chọn element bằng Alt rồi ◆ Đặt làm điều kiện if
async function condBy(loc) { await libOff(); await altAdd(loc); await uiClick(page.locator('.side [data-op=sadd]')); }
// Cửa sổ kho element (trái) che nút sát mép trái của trang thử -> thu gọn (« = tắt) trước khi thao tác trên trang
async function libOff() { if (await page.locator('.libw').isVisible()) await uiClick(page.locator('.libw [data-op=loff]')); }
const ok = (name) => { done++; console.log('  ✓ ' + name); };

async function testGuardUnit() { // whileGuard: vòng khớp trường hợp thì đếm lại; miss vòng LIỀN không khớp = màn hình lạ
  A.useLog(() => {}); // code sinh ra tự useLog(log) lại khi chạy
  const fake = { url: () => 'about:blank', waitForTimeout: async () => {}, screenshot: async () => { throw new Error('không chụp trong unit test'); }, context: () => ({ pages: () => [] }) };
  const w = A.whileGuard(fake, { name: 'Unit', miss: 2 }), seq = ['miss', 'hit', 'miss', 'hit', 'miss', 'miss'];
  let i = 0, err = null;
  try { while (await w.next()) { if (seq[i++] === 'hit') continue; await w.idle(1); } } catch (e) { err = e; }
  assert.ok(err && /Màn hình lạ, chưa có trường hợp cho nó \(2 vòng liền/.test(err.message), 'phải báo màn hình lạ sau 2 vòng liền: ' + (err && err.message));
  assert.strictEqual(i, 6, 'vòng khớp xen giữa phải đếm lại từ 0');
  const t = A.whileGuard(fake, { name: 'Unit', miss: 0, timeout: 0.2 }); let n = 0;
  while (await t.next()) { n++; await new Promise((r) => setTimeout(r, 50)); await t.idle(1); }
  assert.ok(n >= 2, 'hết giờ thì next() trả false');
  ok('whileGuard: đếm vòng trượt liền / đếm lại khi khớp / hết giờ');
}

(async () => {
  await testGuardUnit();
  const srv = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); s.end(PAGE()); }).listen(0);
  const url = `http://127.0.0.1:${srv.address().port}/`;
  const exe = process.env.PW_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await chromium.launch({ headless: true, executablePath: exe });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript(() => { const o = Element.prototype.attachShadow; Element.prototype.attachShadow = function (init) { return o.call(this, { ...init, mode: 'open' }); }; }); // chỉ trong test: shadow DOM mở để locator thấy nút
    page = await context.newPage();
    await page.goto(url);
    await rec.startRecorder(ID, context, { run: (code) => runCode(code) });
    await page.locator('.pill').waitFor();

    // ---- ghi While + trường hợp 1 (Next hiện -> click), ✓ Xong TH -> gợi ý Chờ hiện hộp thoại vừa hiện ra
    await uiClick(page.locator('.pill [data-op=menu]'));
    await setView('Khối');
    await uiClick(page.locator('.list [data-op=blockWhile]'));
    const loopId = await until(() => (st().steps.find((x) => x.action === 'loop') || {}).id, 5000, 'tạo While');
    await condBy(page.locator('#next'));
    const c1 = await until(() => st().steps.find((x) => x.action === 'case' && x.levels), 5000, 'trường hợp 1');
    assert.strictEqual(c1.cs, undefined); assert.strictEqual(c1.loop, loopId, 'trường hợp 1 nằm trong While');
    await A.clickEl(page.locator('#next')); // thao tác thẳng trên trang khi đang ở trong if -> vào if đó
    await until(() => st().steps.some((x) => x.cs === c1.id && x.action === 'click' && x.effect), 6000, 'gợi ý sau click (effect)');
    await uiClick(page.locator('.side [data-op=spClose]')); // Xong = ✓ Xong TH
    const sug = st().steps.find((x) => x.id === c1.id).endSug;
    assert.ok(sug && sug.levels && sug.levels[0].alts.some((a) => /doneDialog/.test(a.code)), 'gợi ý Chờ hiện cho hộp thoại vừa hiện: ' + JSON.stringify(sug && sug.label));
    assert.ok(!st().steps.find((x) => x.cs === c1.id && x.action === 'click').effect, 'gợi ý sau click đã chuyển về cuối trường hợp (không trùng 2 chỗ)');
    await uiClick(page.locator(`.ghost[data-id="${c1.id}"] [data-op=cwOk]`));
    const kids1 = st().steps.filter((x) => x.cs === c1.id);
    assert.deepStrictEqual(kids1.map((x) => x.action), ['click', 'wait'], 'bước Chờ hiện thành bước cuối của trường hợp');
    assert.ok(!st().steps.find((x) => x.id === c1.id).endSug, 'nhận gợi ý xong thì gợi ý biến mất');
    const code1 = rec.recorderCode(ID, false);
    assert.ok(/await waitEl\(page\.getByTestId\('doneDialog'\)[^\n]*\);\n\s+continue;/.test(code1), 'waitEl nằm cuối trường hợp, trước continue:\n' + code1);
    ok('việc 3: ✓ Xong TH gợi ý "Chờ hiện" hộp thoại vừa hiện, nhận gợi ý -> waitEl ở cuối trường hợp');

    // ---- ⏹ Xuất lần 1
    await uiClick(page.locator('.pill [data-op=export]'));
    const ex1 = await until(() => rec.recorderExports(ID, 0)[0], 5000, 'xuất lần 1');
    assert.ok(ex1.body.includes(`whileGuard(page, { name: 'While ${loopId}', miss: 20 })`) && ex1.body.includes(`while (await w${loopId}.next()) {`) && ex1.body.includes(`await w${loopId}.idle(500);`), ex1.body);
    assert.ok(!ex1.replaces.length && !/Bản cập nhật/.test(ex1.body));
    assert.ok(ex1.clip.startsWith('// Cần có ở đầu file') && /\/\/ const \{ useLog, [^}]*whileGuard[^}]*\} = require\('\.\/xlv1_actions'\); useLog\(log\);/.test(ex1.clip) && ex1.clip.endsWith(ex1.body), 'clipboard: chú thích require + code:\n' + ex1.clip.slice(0, 300));
    new AsyncFunction('page', 'log', rec.recorderHeader + ex1.body); // cú pháp hợp lệ
    assert.ok(!st().segOpen && !st().recording, 'xuất xong: đoạn đã đóng');

    // ---- việc 1: mở lại While đã xuất (nút ＋ TH ở dòng While trong bảng ☰), ghi thêm trường hợp 2 (Đóng hiện -> click -> break)
    await setView('Code');
    const line = page.locator(`.ln[data-id="${loopId}"]`).first();
    await A.hoverEl(line);
    await uiClick(page.locator(`.ln[data-id="${loopId}"] [data-op=reopen]`));
    let s = st();
    assert.ok(s.segOpen && s.recording && s.openLoop === loopId && s.cur.par === 'L' + loopId, 'mở lại While: đang ghi, con trỏ ở cuối While');
    await setView('Khối'); // ＋ ở if 1 -> if 2
    await uiClick(page.locator(`.bif[data-id="${c1.id}"] [data-op=caseAdd]`));
    await condBy(page.locator('#close'));
    const c2 = await until(() => st().steps.find((x) => x.action === 'case' && x.id !== c1.id && x.levels), 5000, 'trường hợp 2');
    assert.strictEqual(c2.loop, loopId, 'trường hợp 2 nằm trong While cũ');
    s = st(); assert.ok([loopId, c1.id, c2.id].every((i) => s.segIds.includes(i)), 'có bước mới trong While cũ -> đoạn đang ghi = cả khối While');
    await call({ op: 'update', stepId: c2.id, patch: { end: 'break' } });
    await A.clickEl(page.locator('#close'));
    await until(() => st().steps.some((x) => x.cs === c2.id && x.action === 'click'), 4000, 'click trong trường hợp 2');
    await uiClick(page.locator('.side [data-op=spClose]'));
    await page.waitForTimeout(2500); // gợi ý sau click về sau ~2s -- sau Đóng không có element mới nào đáng chờ
    assert.ok(!(st().steps.find((x) => x.id === c2.id).endSug || {}).levels, 'không có element mới -> không gợi ý Chờ hiện');
    ok('việc 3: không có element mới hiện ra thì không gợi ý');
    assert.strictEqual(st().openLoop, loopId, 'Xong TH -> về lại While');

    // ---- ⏹ Xuất lần 2: ra CẢ khối While đã cập nhật (2 trường hợp), không phải mỗi phần mới
    await uiClick(page.locator('.pill [data-op=export]'));
    const ex2 = await until(() => rec.recorderExports(ID, ex1.id)[0], 5000, 'xuất lần 2');
    assert.deepStrictEqual(ex2.replaces, [`While ${loopId}`]);
    assert.ok(ex2.body.startsWith(`// ⟳ Bản cập nhật của CẢ khối While ${loopId}`), ex2.body);
    for (const t of [`const w${loopId} = whileGuard(page,`, "isShown(page.locator('#next'))", "await waitEl(page.getByTestId('doneDialog')", "isShown(page.locator('#close'))", 'break;', `await w${loopId}.idle(500);`]) assert.ok(ex2.body.includes(t), `xuất lần 2 thiếu "${t}":\n${ex2.body}`);
    assert.ok(!/await page\.goto/.test(ex2.body), 'không kéo theo bước ngoài khối While');
    ok('việc 1: mở lại While đã ⏹ Xuất bằng ＋ ở ☰, ghi thêm trường hợp -> xuất ra cả khối While đã cập nhật');

    // ---- code xuất ra chạy thật trên trang bình thường: Next -> chờ hộp thoại -> Đóng -> break
    await page.goto(url);
    const run1 = await runCode(rec.recorderHeader + ex2.body);
    assert.ok(await page.getByText('Đã đóng').isVisible(), 'chạy hết 2 trường hợp: ' + run1.logs.join('\n'));
    ok('code xuất ra (cả khối While) chạy thật được: 2 trường hợp rồi break');

    // ---- việc 1: mở lại 1 TRƯỜNG HỢP (＋ ở dòng trường hợp), gọi hàm pause ở ô ƒ -> vào cuối trường hợp đó; xuất ra cả khối While
    await uiClick(page.locator('.pill [data-op=menu]'));
    await A.hoverEl(page.locator(`.ln[data-id="${c1.id}"]`).first());
    await uiClick(page.locator(`.ln[data-id="${c1.id}"] [data-op=reopen]`));
    s = st();
    assert.ok(s.recording && s.inCase === c1.id && s.cur.after === kids1[1].id, 'con trỏ ở cuối trường hợp 1 (sau bước chờ)');
    await uiClick(page.locator('.fbar [data-f=fq]'));
    await page.keyboard.type('pause', { delay: 20 }); await page.keyboard.press('Enter');
    const p1 = await until(() => st().steps.find((x) => x.action === 'fn' && x.fn === 'pause'), 5000, 'thêm pause');
    assert.strictEqual(p1.cs, c1.id, 'pause vào trong trường hợp 1');
    await uiClick(page.locator('.pill [data-op=caseEnd]'));
    assert.ok(!st().steps.find((x) => x.id === c1.id).endSug, 'đã kết thúc bằng bước chờ (pause) -> không gợi ý');
    await uiClick(page.locator('.pill [data-op=export]'));
    const ex3 = await until(() => rec.recorderExports(ID, ex2.id)[0], 5000, 'xuất lần 3');
    assert.deepStrictEqual(ex3.replaces, [`While ${loopId}`]);
    assert.ok(/doneDialog'\)[^\n]*\);\n\s+await pause\(page, 800, 2000\);\n\s+continue;/.test(ex3.body) && ex3.body.includes("'#close'"), ex3.body);
    ok('việc 1: mở lại 1 trường hợp đã xuất, thêm bước vào cuối -> xuất ra cả khối While');

    // ---- việc 2: màn hình lạ -- ▶ Chạy thử (nút trong bảng ☰)
    mode = 'strange';
    await call({ op: 'update', stepId: loopId, patch: { miss: 3 } });
    if (await page.locator('.panel').isHidden()) await uiClick(page.locator('.pill [data-op=menu]'));
    await uiClick(page.locator('.hd [data-op=test]'));
    const t = await until(() => { const x = st().test; return x && !x.running && x; }, 30000, 'chạy thử xong');
    assert.ok(!t.ok && /Màn hình lạ, chưa có trường hợp cho nó \(3 vòng liền không khớp/.test(t.error), 'chạy thử phải báo màn hình lạ: ' + JSON.stringify(t));
    assert.strictEqual(t.step, loopId, 'tô đỏ đúng dòng While');
    assert.ok(fs.existsSync(shotOf(t.error)), 'có ảnh chụp màn hình lạ: ' + t.error);
    assert.ok(t.logs.some((l) => /Màn hình lạ/.test(l)), 'log có dòng màn hình lạ');
    ok('việc 2: ▶ Chạy thử gặp màn hình lạ -> chụp ảnh + log + báo lỗi ở dòng While');

    // ---- việc 2: code xuất ra chạy thật (miss mặc định 20) trên trang lạ
    await page.goto(url);
    const err = await runCode(rec.recorderHeader + ex2.body).then(() => null, (e) => e);
    assert.ok(err && /Màn hình lạ, chưa có trường hợp cho nó \(20 vòng liền không khớp/.test(err.message), 'chạy thật phải báo màn hình lạ: ' + (err && err.message));
    assert.ok(fs.existsSync(shotOf(err.message)) && err.logs.some((l) => /Màn hình lạ/.test(l)), 'có ảnh + log');
    ok('việc 2: code xuất ra chạy thật gặp màn hình lạ -> chụp ảnh + log + throw');

    // ---- việc 2: hết giờ (giới hạn 2 giây, tắt đếm vòng trượt) -> chụp + log rồi thoát While, không throw
    await call({ op: 'update', stepId: loopId, patch: { miss: 0, timeout: 2 } });
    await page.goto(url);
    const run2 = await runCode(rec.recorderCode(ID, true));
    const line2 = run2.logs.find((l) => /Màn hình lạ, chưa có trường hợp cho nó \(hết 2 giây/.test(l));
    assert.ok(line2 && fs.existsSync(shotOf(line2)), 'hết giờ: log + ảnh: ' + run2.logs.join('\n'));
    ok('việc 2: While hết giờ -> chụp ảnh + log màn hình lạ, thoát While');

    await rec.stopRecorder(ID, context);
    console.log(`\nOK -- ${done} test qua`);
  } finally {
    for (const f of shots) fs.rmSync(f, { force: true });
    await browser.close(); srv.close();
  }
})().catch((e) => { console.error('\n✗ FAIL:', e && e.stack || e); process.exit(1); });
