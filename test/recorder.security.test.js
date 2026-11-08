/**
 * test/recorder.security.test.js -- JS của trang web đang mở trong profile KHÔNG điều khiển được recorder: không thấy / không gọi được
 * binding (kể cả qua bộ điều khiển binding của Playwright), không nghe lén được lệnh qua JSON.stringify, click giả lên giao diện bị bỏ qua,
 * lỗ cũ (sửa bước thành code + testRun = chạy code trên máy) không còn. Ghi thao tác trong iframe (cùng / khác tiến trình) vẫn chạy.
 * Chạy: node test/recorder.security.test.js   (PW_CHROMIUM=đường/dẫn/chrome; mặc định /opt/pw-browsers/chromium nếu có)
 */
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const { chromium } = require('playwright');
process.env.PM_NO_CLIPBOARD = '1';
process.env.PM_REC_OPEN_SHADOW = '1'; // locator thấy nút của giao diện recorder
const rec = require('../recorder');
const A = require('../scripts/xlv1_actions');

const SCRIPTS = path.join(__dirname, '..', 'scripts'), ID = 'test-sec', AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const MARK = path.join(os.tmpdir(), `pm-sec-${process.pid}.txt`); // file mà kẻ tấn công cố tạo ra
let done = 0;
const ok = (name) => { done++; console.log('  ✓ ' + name); };
const until = async (fn, ms = 6000, what = 'điều kiện') => { for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 150))) { const v = await fn(); if (v) return v; } throw new Error('Hết giờ chờ: ' + what); };
// Trang "độc": ghi đè JSON.stringify để nghe lén mọi lệnh đi qua; có iframe cùng site (/frame) và khác site (localhost -> tiến trình riêng)
const EVIL = (port) => `<!doctype html><html><head><meta charset="utf-8"><script>window.sniff = []; const o = JSON.stringify; JSON.stringify = function (x) { const s = o.apply(this, arguments); try { window.sniff.push(String(s)); } catch (e) {} return s; };</script></head>
<body style="padding:40px"><button id="b">Nút</button><iframe id="f1" name="same" src="/frame" style="width:300px;height:80px"></iframe><iframe id="f2" name="cross" src="http://localhost:${port}/frame" style="width:300px;height:80px"></iframe></body></html>`;

(async () => {
  const srv = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); s.end(q.url === '/frame' ? '<button id="fb">Trong iframe</button>' : EVIL(srv.address().port)); }).listen(0);
  const url = `http://127.0.0.1:${srv.address().port}/`;
  const exe = process.env.PW_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await chromium.launch({ headless: true, executablePath: exe });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(url);
    const run = (code) => new AsyncFunction('page', 'context', 'log', 'require', 'input', code)(page, context, () => {}, (m) => require(m.startsWith('./') ? path.join(SCRIPTS, m) : m), '');
    await rec.startRecorder(ID, context, { run: (code) => run(code) });
    await page.locator('.pill').waitFor();
    assert.ok(rec.recorderState(ID).steps.length >= 1, 'recorder chạy (có bước mở trang)');

    // ---- 1. trang không thấy binding / biến nào của recorder, kể cả trong bộ điều khiển binding của Playwright
    const seen = await page.evaluate(() => {
      const names = Object.getOwnPropertyNames(window).filter((k) => /^__pm|pmrec/i.test(k));
      const ctl = window.__playwright__binding__controller__, bound = ctl && ctl._bindings ? [...ctl._bindings.keys()] : [];
      return { names, bound, pmRec: typeof window.__pmRec };
    });
    assert.deepStrictEqual(seen.names, [], 'trang thấy biến của recorder: ' + seen.names);
    assert.strictEqual(seen.pmRec, 'undefined');
    assert.ok(!seen.bound.some((n) => /pm/i.test(n)), 'binding của recorder không nằm trong bộ điều khiển binding của Playwright: ' + seen.bound);
    ok('JS của trang không thấy binding / biến nào của recorder');

    // ---- 2. nghe lén JSON.stringify không bắt được lệnh nào (giao diện vẫn gửi lệnh mỗi 1,5s)
    await page.waitForTimeout(3500);
    const sniffed = await page.evaluate(() => window.sniff.filter((s) => /"op"|"msg"|"seq"/.test(s)));
    assert.deepStrictEqual(sniffed, [], 'trang nghe lén được lệnh: ' + sniffed.slice(0, 2));
    ok('ghi đè JSON.stringify không nghe lén được lệnh của recorder');

    // ---- 3. lỗ cũ: trang cố sửa 1 bước thành code + testRun (= chạy code trên máy) -- qua mọi đường trang có thể với tới
    const n0 = JSON.stringify(rec.recorderState(ID).steps.map((x) => [x.id, x.action, x.tpl]));
    await page.evaluate(async (file) => {
      const payload = (name) => JSON.stringify({ name, seq: 1, serializedArgs: [{ o: [] }] });
      const evil = { op: 'update', stepId: 1, patch: { action: 'fn', tpl: `require('fs').writeFileSync(${JSON.stringify(file)}, 'x')` } };
      for (const k of Object.getOwnPropertyNames(window)) { try { if (typeof window[k] === 'function' && /bind/i.test(k)) { window[k](payload('pmRecB')); window[k](JSON.stringify({ seq: 1, msg: evil })); window[k](JSON.stringify({ seq: 2, msg: { op: 'testRun' } })); } } catch (e) {} }
      try { window.__playwright__binding__controller__.callBinding('pmRecB', JSON.stringify({ seq: 1, msg: evil })); } catch (e) {}
    }, MARK);
    await page.waitForTimeout(1500);
    assert.strictEqual(JSON.stringify(rec.recorderState(ID).steps.map((x) => [x.id, x.action, x.tpl])), n0, 'trang sửa được bước');
    assert.ok(!fs.existsSync(MARK), 'trang chạy được code trên máy (file bị tạo)');
    ok('trang không sửa được bước / không chạy được testRun (lỗ cũ đã đóng)');

    // ---- 4. click GIẢ do JS của trang tạo ra lên nút ☰ của giao diện -> bỏ qua; click thật -> mở bảng
    const box = await page.locator('.pill [data-op=menu]').boundingBox();
    await page.evaluate(({ x, y }) => { for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) document.elementFromPoint(x, y).dispatchEvent(new MouseEvent(t, { bubbles: true, composed: true, clientX: x, clientY: y, detail: 1 })); }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await page.waitForTimeout(500);
    assert.ok(await page.locator('.panel').isHidden(), 'click giả mở được bảng ☰');
    await require('../scripts/helpers').clickVisibly(page, box); await page.waitForTimeout(500);
    assert.ok(await page.locator('.panel').isVisible(), 'click thật phải mở được bảng ☰');
    ok('click giả của trang lên giao diện recorder bị bỏ qua, click thật vẫn chạy');

    // ---- 5. ghi thao tác trong iframe vẫn chạy: cùng site (cùng tiến trình) và khác site (tiến trình riêng)
    for (const [fid, tag] of [['f1', 'same'], ['f2', 'cross']]) {
      const before = rec.recorderState(ID).steps.length;
      await A.clickEl(page.frameLocator('#' + fid).locator('#fb'));
      const s = await until(() => rec.recorderState(ID).steps.length > before && rec.recorderState(ID).steps.slice(-1)[0], 6000, 'ghi click trong iframe ' + tag);
      assert.ok(s.action === 'click' && s.frame && s.frame.includes('frameLocator('), `click trong iframe ${tag} phải có frameLocator: ${JSON.stringify(s.frame)}`);
    }
    ok('ghi click trong iframe cùng tiến trình + khác tiến trình (frameLocator) vẫn chạy');

    // ---- 6. đã dừng ghi -> không nhận lệnh nào (kể cả từ giao diện)
    await rec.stopRecorder(ID, context);
    const n1 = rec.recorderState(ID).steps.length;
    await rec.recorderHandle(ID, page, { op: 'blockWhile' });
    assert.strictEqual(rec.recorderState(ID).steps.length, n1, 'đã dừng ghi mà vẫn nhận lệnh');
    await until(async () => (await page.locator('.pill').count()) === 0, 4000, 'giao diện gỡ khỏi trang khi dừng ghi');
    ok('dừng ghi: không nhận lệnh, giao diện gỡ khỏi trang');

    console.log(`\nOK -- ${done} test qua`);
  } finally { fs.rmSync(MARK, { force: true }); await browser.close(); srv.close(); }
})().catch((e) => { console.error('\n✗ FAIL:', (e && e.stack) || e); process.exit(1); });
