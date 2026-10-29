/**
 * test/recorder.blocks.test.js -- test recorder.js trên Chromium headless: dạng khối của While (if + else, ＋ / ↵, bảng 2 ô: thao tác + kho
 * element), kho element dạng tham chiếu (sửa 1 nơi đổi mọi nơi), bảng chọn Alt hiện HTML gốc 2 cha / 2 con và ghép XPath.
 * Chuột: hàm người thật của scripts/ (clickEl, hoverEl, clickVisibly) -- không dùng page.click.
 * Chạy: node test/recorder.blocks.test.js   (PW_CHROMIUM=đường/dẫn/chrome; mặc định /opt/pw-browsers/chromium nếu có)
 */
const http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert');
const { chromium } = require('playwright');
const rec = require('../recorder');
const A = require('../scripts/xlv1_actions');
const helpers = require('../scripts/helpers');

const SCRIPTS = path.join(__dirname, '..', 'scripts'), ID = 'test-blocks', AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
let page = null, done = 0;
const errs = [];
// Next -> ẩn Next, hiện hộp thoại có nút Đóng; Đóng -> chữ "Đã đóng". Danh sách thẻ để thử bảng chọn XPath (cha / con, trùng nhau)
const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body style="font:16px sans-serif;padding:40px"><button id="next">Next</button><div id="area"></div>
<section aria-label="Feed" style="margin-top:20px"><article data-testid="card"><div class="row"><button type="button" class="act"><span>Like</span></button></div></article>
<article data-testid="card"><div class="row"><button type="button" class="act"><span>Share</span></button></div></article></section>
<script>const n = document.getElementById('next'); n.onclick = () => { n.style.display = 'none'; const a = document.getElementById('area'); a.innerHTML = '<div role="dialog" data-testid="doneDialog">Xong rồi <button id="close">Đóng</button></div>'; document.getElementById('close').onclick = () => { a.innerHTML = '<p>Đã đóng</p>'; }; };</script></body></html>`;

async function runCode(code) {
  const logs = [], resume = rec.pauseRecorder(ID);
  page.__profileId = ID;
  try { return { logs, result: await new AsyncFunction('page', 'context', 'log', 'require', 'input', code)(page, page.context(), (...a) => logs.push(a.join(' ')), (m) => require(m.startsWith('./') ? path.join(SCRIPTS, m) : m), '') }; } catch (e) { e.logs = logs; throw e; } finally { resume(); }
}
const st = () => rec.recorderState(ID);
const until = async (fn, ms = 8000, what = 'điều kiện') => { for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 150))) { const v = fn(); if (v) return v; } throw new Error('Hết giờ chờ: ' + what); };
const call = (msg) => page.evaluate((m) => window.__pmRec(m), msg);
// Bấm trong giao diện recorder (shadow DOM -- clickEl báo "bị đè" oan vì document.elementFromPoint ra thẻ host): đi chuột thật + nhấn theo toạ độ
async function uiClick(loc) { await loc.waitFor({ state: 'visible', timeout: 8000 }); await helpers.clickVisibly(page, await loc.boundingBox()); await page.waitForTimeout(350); }
const side = (sel) => page.locator('.side ' + sel);
const elRow = (name) => page.locator('.side .elr').filter({ has: page.locator('b', { hasText: new RegExp(`^${name}$`) }) });
const ok = (name) => { done++; console.log('  ✓ ' + name); };

(async () => {
  const srv = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); s.end(PAGE); }).listen(0);
  const url = `http://127.0.0.1:${srv.address().port}/`;
  const exe = process.env.PW_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await chromium.launch({ headless: true, executablePath: exe });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript(() => { const o = Element.prototype.attachShadow; Element.prototype.attachShadow = function (init) { return o.call(this, { ...init, mode: 'open' }); }; }); // chỉ trong test: shadow DOM mở để locator thấy nút
    page = await context.newPage();
    page.on('pageerror', (e) => errs.push(e.message)); // lỗi JS của giao diện recorder trong trang
    await page.goto(url);
    await rec.startRecorder(ID, context, { run: (code) => runCode(code) });
    await page.locator('.pill').waitFor();

    // ---- click Next trên trang -> bước + vào kho element
    await A.clickEl(page.locator('#next'));
    const eNext = await until(() => (st().els || []).find((e) => e.code === "page.locator('#next')"), 5000, 'Next vào kho');
    assert.strictEqual(eNext.name, 'Next'); assert.strictEqual(eNext.uses, 1);
    ok('bước ghi được tự vào kho element (tên = chữ của nút)');

    // ---- ▦ Khối -> ＋ While (dạng khối): 1 if (chưa điều kiện) + else, bảng 2 ô mở sẵn ở if
    await uiClick(page.locator('.pill [data-op=menu]'));
    await uiClick(page.locator('.hd [data-op=vblocks]'));
    await uiClick(page.locator('.list [data-op=blockWhile]'));
    await side('.sh').waitFor();
    let s = st();
    const L = s.steps.find((x) => x.action === 'loop'), c1 = s.steps.find((x) => x.action === 'case');
    assert.ok(L && c1 && c1.loop === L.id && !c1.levels, 'While mới có 1 if chưa có điều kiện');
    assert.strictEqual(s.inCase, c1.id, 'con trỏ đang ở trong if');
    assert.ok(await side('[data-sact=cond].on').isVisible(), 'if chưa có điều kiện -> chọn sẵn "Làm điều kiện if"');
    assert.ok(!/isShown/.test(rec.recorderCode(ID, false)), 'if chưa có điều kiện thì chưa ra code');

    // điều kiện = Next (từ kho), thêm Click Next
    await uiClick(elRow('Next'));
    assert.strictEqual(st().steps.find((x) => x.id === c1.id).elId, eNext.id, 'điều kiện if trỏ tới element Next trong kho');
    assert.ok(await side('[data-sact=click].on').isVisible(), 'chọn xong điều kiện -> về thao tác Click');
    await uiClick(elRow('Next'));
    s = st();
    assert.deepStrictEqual(s.steps.filter((x) => x.cs === c1.id).map((x) => x.action), ['click']);
    ok('▦ Khối: ＋ While -> if + else, bảng 2 ô mở; bấm element trong kho làm điều kiện / thêm bước Click');

    // 🎯 Element mới (Đóng -- hiện sau khi bấm Next ở trên) với thao tác Chờ hiện -> vào kho + thêm bước luôn
    await uiClick(side('[data-sact=wait]'));
    await uiClick(side('[data-op=libNew]'));
    assert.ok(st().armed && st().armed.lib, 'đang chờ chọn element mới');
    await page.keyboard.down('Alt'); await A.hoverEl(page.locator('#close')); await page.waitForTimeout(150); await page.keyboard.up('Alt');
    await uiClick(page.locator('.pick [data-op=pslot]'));
    const eClose = await until(() => (st().els || []).find((e) => e.code === "page.locator('#close')"), 5000, 'Đóng vào kho');
    await until(() => st().steps.some((x) => x.cs === c1.id && x.action === 'wait' && x.elId === eClose.id), 5000, 'bước Chờ hiện Đóng');
    assert.ok(!st().armed, 'thêm xong thì thôi chờ chọn');
    ok('🎯 Element mới: giữ Alt chọn -> vào kho + thêm bước với thao tác đang chọn (Chờ hiện)');

    // Xong -> như ✓ Xong TH; ＋ ở if 1 -> if 2 cùng cấp: điều kiện Đóng, Click Đóng, thoát While
    await uiClick(side('[data-op=spClose]'));
    assert.ok(await page.locator('.side').isHidden() && st().inCase == null, 'Xong: đóng bảng, ra khỏi if');
    await uiClick(page.locator(`.bif[data-id="${c1.id}"] [data-op=caseAdd]`));
    await side('.sh').waitFor();
    const c2 = st().steps.find((x) => x.action === 'case' && x.id !== c1.id);
    assert.strictEqual(c2.loop, L.id, 'if 2 cùng cấp trong While');
    await uiClick(elRow('Đóng'));
    await uiClick(elRow('Đóng'));
    await side('[data-f=end]').selectOption('break'); await page.waitForTimeout(400);
    await uiClick(side('[data-op=spClose]'));
    // else: Nghỉ
    await uiClick(page.locator(`.bif.else[data-id="${L.id}"] [data-op=enter]`));
    await uiClick(side('[data-sact=pause]'));
    await uiClick(side('[data-op=spClose]'));
    const code = rec.recorderCode(ID, false), lp = `w${L.id}`;
    const want = new RegExp(`while \\(await ${lp}\\.next\\(\\)\\) \\{[^]*?if \\(await isShown\\(page\\.locator\\('#next'\\)\\)\\) \\{[^]*?await clickEl\\(page\\.locator\\('#next'\\)\\);\\n[^]*?await waitEl\\(page\\.locator\\('#close'\\), 15000\\);\\n\\s+continue;[^]*?if \\(await isShown\\(page\\.locator\\('#close'\\)\\)\\) \\{[^]*?await clickEl\\(page\\.locator\\('#close'\\)\\);\\n\\s+break;[^]*?await pause\\(page, 800, 2000\\);\\n\\s+await ${lp}\\.idle\\(500\\);`);
    assert.ok(want.test(code), 'code While sai:\n' + code);
    ok('＋ thêm if cùng cấp, ↵ else thêm bước; code: if Next {click, chờ Đóng, continue} if Đóng {click, break} else {nghỉ}');

    // ---- kho element là tham chiếu: sửa selector Next 1 lần -> mọi bước dùng Next đổi theo
    await call({ op: 'libCustom', elId: eNext.id, custom: "page.locator('button#next')" });
    const c3 = rec.recorderCode(ID, false);
    assert.strictEqual((c3.match(/button#next/g) || []).length, 3, 'click ngoài While + điều kiện if + click trong if đều đổi:\n' + c3);
    assert.ok(!/'#next'/.test(c3));
    ok('kho element dạng tham chiếu: sửa selector 1 lần -> mọi bước đổi theo');

    // ---- code chạy thật: trang mới -> click Next, While: Next đã ẩn, Đóng hiện -> click Đóng -> break
    await page.goto(url);
    await runCode(rec.recorderHeader + c3.replace(/^await page\.goto[^\n]*\n/m, ''));
    assert.ok(await page.getByText('Đã đóng').isVisible());
    ok('code dạng khối chạy thật được');

    // ---- bảng chọn Alt: HTML gốc 2 cha / 2 con, bấm để ghép XPath (nút Like: 2 nút cùng type / class, khác chữ của con)
    await page.keyboard.down('Alt'); await A.hoverEl(page.locator('button.act').first()); await page.waitForTimeout(150); await page.keyboard.up('Alt');
    const xp = (sel) => page.locator('.pick ' + sel);
    await xp('.xl.me').waitFor({ timeout: 5000 });
    assert.ok(/<button/.test(await xp('.xl.me').innerText()) && /data-testid="card"/.test(await xp('.xl').first().innerText()) && /Like/.test(await xp('.xl').nth(3).innerText()), 'cây HTML: article > div.row > ★button > span Like');
    const xcode = async () => (await xp('.xr code').innerText()).replace(/^xpath=/, '');
    const cnt = async (want) => { for (let i = 0; i < 30; i++) { if ((await xp('.xc').innerText().catch(() => '')).startsWith(want)) return; await page.waitForTimeout(150); } throw new Error(`số khớp phải là ${want}, đang: ${await xp('.xc').innerText()}`); };
    await uiClick(xp('.xl.me [data-p="a:type"]'));
    assert.strictEqual(await xcode(), '//button[@type="button"]'); await cnt('⚠2');
    await uiClick(xp('[data-x=p2][data-p="a:data-testid"]'));
    assert.strictEqual(await xcode(), '//article[@data-testid="card"]//button[@type="button"]');
    await uiClick(xp('[data-x=c0][data-p=t]'));
    assert.strictEqual(await xcode(), '//article[@data-testid="card"]//button[@type="button"][.//span[text()[normalize-space()="Like"]]]'); await cnt('✓1');
    assert.ok(/dựa vào chữ/.test(await xp('.xw').allInnerTexts().then((a) => a.join(' '))), 'cảnh báo 🌐 khi dùng chữ');
    assert.strictEqual(await page.locator('div[style*="dashed"]').count(), 1, 'tô viền đúng 1 chỗ khớp trên trang');
    await uiClick(xp('.xl.me [data-p="c:act"]'));
    await uiClick(xp('.xl.me [data-p=join]'));
    assert.ok((await xcode()).includes('[@type="button" or contains(@class, "act")]'), 'and -> or');
    await uiClick(xp('.xl.me [data-p=join]'));
    await uiClick(xp('.xl.me [data-p=tag]'));
    assert.ok((await xcode()).startsWith('//article[@data-testid="card"]//*[@type="button" and contains(@class, "act")]'), 'thẻ -> *');
    await uiClick(xp('.xl.me [data-p=tag]'));
    await uiClick(xp('[data-x=c0][data-p=sep]')); // / giữa button và span
    assert.ok((await xcode()).endsWith('[./span[text()[normalize-space()="Like"]]]'), '// -> / (con trực tiếp): ' + await xcode());
    await uiClick(xp('[data-x=c0][data-p=sep]'));
    const wantXp = '//article[@data-testid="card"]//button[@type="button" and contains(@class, "act")][.//span[text()[normalize-space()="Like"]]]';
    assert.strictEqual(await xcode(), wantXp); await cnt('✓1');
    ok('bảng chọn Alt: HTML gốc 2 cha / 2 con; bấm thuộc tính / cha / chữ của con / and-or / thẻ-* / ///  -> XPath, đếm số khớp, tô viền, cảnh báo');
    // chọn việc Click -> bước dùng đúng XPath vừa ghép, vào kho element
    await page.keyboard.type('c', { delay: 20 }); await page.keyboard.press('Enter');
    await until(() => (st().els || []).some((e) => e.code === `page.locator('xpath=${wantXp}')`), 6000, 'XPath vào kho');
    assert.ok(rec.recorderCode(ID, false).includes(`await clickEl(page.locator('xpath=${wantXp}'));`));
    assert.strictEqual(await page.locator(`xpath=${wantXp}`).count(), 1);
    ok('Click với XPath ghép tay -> bước + kho element dùng đúng XPath đó');

    // ---- if chưa có điều kiện: dạng ô / dạng code không lỗi, không ra code
    await call({ op: 'blockWhile' });
    for (let i = 0; i < 3 && await page.locator('.panel').isHidden(); i++) { await uiClick(page.locator('.pill [data-op=menu]')); await page.waitForTimeout(300); }
    await uiClick(page.locator('.hd [data-op=view]'));
    await page.waitForTimeout(1800); // bảng làm mới định kỳ 1,5s (lệnh gửi qua call() không tự vẽ lại)
    assert.ok(await page.locator('.st.case', { hasText: 'chưa chọn điều kiện' }).count() >= 1, 'dạng ô hiện if chưa điều kiện');
    assert.deepStrictEqual(errs, [], 'không có lỗi JS trong trang');
    ok('if chưa có điều kiện: dạng ô hiện được, không lỗi JS');

    await rec.stopRecorder(ID, context);
    console.log(`\nOK -- ${done} test qua`);
  } finally { await browser.close(); srv.close(); }
})().catch((e) => { console.error('\n✗ FAIL:', (e && e.stack) || e); process.exit(1); });
