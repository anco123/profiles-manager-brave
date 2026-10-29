/**
 * test/recorder.nested.test.js -- test recorder.js trên Chromium headless: cửa sổ khối (đường dẫn khối, ↰, code bấm được, ▸ chỗ chèn),
 * khối lồng nhau (if trong if, else / else if của if lồng, While lồng, hàm có { } như try / catch), cửa sổ kho element bên trái
 * (tự động / 📌 ghim / « thu gọn / 📦 mở lại). Chuột: hàm người thật của scripts/ (hoverEl, clickVisibly) -- không dùng page.click.
 * Chạy: node test/recorder.nested.test.js   (PW_CHROMIUM=đường/dẫn/chrome; mặc định /opt/pw-browsers/chromium nếu có)
 */
const http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert');
const { chromium } = require('playwright');
process.env.PM_NO_CLIPBOARD = '1'; // test không ghi đè clipboard của máy
const rec = require('../recorder');
const helpers = require('../scripts/helpers');

const SCRIPTS = path.join(__dirname, '..', 'scripts'), ID = 'test-nested', AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
let page = null, done = 0;
const errs = [];
// Start -> hiện bảng: có "Đồng ý" (URL ?agree) hoặc "Để sau" (không có ?agree) + OK; OK -> "Xong". Bấm Đồng ý / Để sau ghi vào #log
const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body style="font:16px sans-serif;padding:40px">
<button id="start">Start</button><div id="panel" hidden><button id="agree">Đồng ý</button><button id="later">Để sau</button><button id="ok">OK</button></div><p id="done" hidden>Xong</p><p id="log"></p>
<script>const q = (s) => document.querySelector(s), flag = location.search.includes('agree');
q('#start').onclick = () => { q('#start').hidden = true; q('#panel').hidden = false; q(flag ? '#later' : '#agree').remove(); };
q('#agree').onclick = () => { q('#log').textContent += 'agreed;'; }; q('#later').onclick = () => { q('#log').textContent += 'later;'; };
q('#ok').onclick = () => { q('#panel').hidden = true; q('#done').hidden = false; };</script></body></html>`;

async function runCode(code) {
  const logs = [], resume = rec.pauseRecorder(ID);
  page.__profileId = ID;
  try { return { logs, result: await new AsyncFunction('page', 'context', 'log', 'require', 'input', code)(page, page.context(), (...a) => logs.push(a.join(' ')), (m) => require(m.startsWith('./') ? path.join(SCRIPTS, m) : m), '') }; } catch (e) { e.logs = logs; throw e; } finally { resume(); }
}
const st = () => rec.recorderState(ID);
const until = async (fn, ms = 8000, what = 'điều kiện') => { for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 150))) { const v = await fn(); if (v) return v; } throw new Error('Hết giờ chờ: ' + what); };
async function uiClick(loc) { await loc.waitFor({ state: 'visible', timeout: 8000 }); await helpers.clickVisibly(page, await loc.boundingBox()); await page.waitForTimeout(350); }
const side = (sel) => page.locator('.side ' + sel);
const code = () => rec.recorderCode(ID, false);
// Ô Element: gõ tay selector rồi Enter (= ＋ Thêm bước / ◆ Đặt làm điều kiện với thao tác đang chọn)
async function typeSel(t) {
  const n = st().steps.length, c0 = JSON.stringify(st().steps.map((x) => [x.id, x.elId]));
  await uiClick(side('[data-f=sel]')); await page.keyboard.press('Control+A'); await page.keyboard.type(t, { delay: 5 }); await page.keyboard.press('Enter');
  await until(() => st().steps.length !== n || JSON.stringify(st().steps.map((x) => [x.id, x.elId])) !== c0, 6000, 'thêm ' + t);
  await page.waitForTimeout(250);
}
const act = (a) => uiClick(side(`[data-sact=${a}]`));
const blk = async (k) => { const k0 = st().cur && st().cur.par; await uiClick(side(`[data-blk=${k}]`)); await until(() => st().cur && st().cur.par !== k0, 5000, 'vào khối ' + k); await page.waitForTimeout(250); };
const crumbText = () => side('.crumb').innerText();
const ok = (name) => { done++; console.log('  ✓ ' + name); };

(async () => {
  const srv = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); s.end(PAGE); }).listen(0);
  const url = `http://127.0.0.1:${srv.address().port}/`;
  const exe = process.env.PW_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await chromium.launch({ headless: true, executablePath: exe });
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await context.addInitScript(() => { const o = Element.prototype.attachShadow; Element.prototype.attachShadow = function (init) { return o.call(this, { ...init, mode: 'open' }); }; }); // chỉ trong test: shadow DOM mở để locator thấy nút
    page = await context.newPage();
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(url);
    await rec.startRecorder(ID, context, { run: async (c) => runCode(c) });
    await page.locator('.pill').waitFor();

    // ---- While (dạng khối) -> if Start { click Start ... }; kho bên trái tự hiện khi đang sửa khối
    await uiClick(page.locator('.pill [data-op=menu]'));
    for (let i = 0; i < 3 && (await page.locator('.hd b').first().innerText()) !== 'Khối'; i++) await uiClick(page.locator('.hd [data-op=vblocks]'));
    await uiClick(page.locator('.list [data-op=blockWhile]'));
    await side('.sh').waitFor();
    assert.ok(await page.locator('.libw').isVisible(), 'kho element (trái) tự hiện khi đang sửa khối');
    const L = st().steps.find((x) => x.action === 'loop'), c1 = st().steps.find((x) => x.action === 'case');
    await typeSel('#start'); // ◆ điều kiện
    assert.ok(st().steps.find((x) => x.id === c1.id).levels, 'if 1 có điều kiện #start');
    await typeSel('#start'); // Click
    assert.ok(/While \d+.*if #start/s.test(await crumbText()), 'đường dẫn khối: While › if #start -- ' + await crumbText());
    ok('kho element bên trái tự hiện khi sửa khối; ô Element gõ tay -> điều kiện + bước; đường dẫn khối');

    // ---- if lồng: ◆ if (#agree) { click #agree } -- rồi else { click #later } -- rồi ↰ ra if Start, click OK
    await blk('if');
    const n1 = st().steps.find((x) => x.action === 'case' && x.cs === c1.id);
    assert.ok(n1 && n1.end === 'none', 'if lồng nằm trong if Start, mặc định đi tiếp (không continue)');
    await typeSel('#agree'); await typeSel('#agree');
    assert.ok(/if #start.*if #agree/s.test(await crumbText()), 'đường dẫn: … › if #start › if #agree');
    await uiClick(side(`.crumb a[data-key="C${c1.id}"]`)); // về if Start, ▸ ở cuối (ngay sau if #agree) -> có ↳ else / ↳ else if
    await side('[data-blk=else]').waitFor();
    await blk('else');
    assert.strictEqual(st().cur.par, 'X' + n1.id, 'đang ở trong else của if #agree');
    await typeSel('#later');
    await uiClick(side('[data-op=sup1]')); // ↰ ra if Start
    assert.strictEqual(st().cur.par, 'C' + c1.id);
    await act('click'); await typeSel('#ok');
    let c = code();
    assert.ok(/if \(await isShown\(page\.locator\('#start'\)\)\) \{[^]*?await clickEl\(page\.locator\('#start'\)\);\n\s+if \(await isShown\(page\.locator\('#agree'\)\)\) \{[^]*?\n\s+await clickEl\(page\.locator\('#agree'\)\);\n\s+\} else \{\n\s+await clickEl\(page\.locator\('#later'\)\);\n\s+\}\n\s+await clickEl\(page\.locator\('#ok'\)\);\n\s+continue;/.test(c), 'if lồng + else:\n' + c);
    ok('◆ if lồng trong if, ↳ else của if lồng, ↰ / bấm đường dẫn để ra khối ngoài; code đúng thứ tự');

    // ---- bấm 1 dòng code -> ▸ chèn sau dòng đó: Chờ hiện #ok ngay sau click Start
    await uiClick(side('.sl code').filter({ hasText: "await clickEl(page.locator('#start'));" }).first());
    assert.ok(await side('.sl.cur').isVisible(), 'hiện ▸ chỗ chèn');
    await act('wait'); await typeSel('#ok');
    c = code();
    assert.ok(/await clickEl\(page\.locator\('#start'\)\);\n\s+await waitEl\(page\.locator\('#ok'\), 15000\);\n\s+if \(await isShown\(page\.locator\('#agree'\)\)\)/.test(c), 'chèn sau dòng đã bấm:\n' + c);
    ok('bấm dòng code -> bước mới chèn ngay sau dòng đó (▸)');
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT }); // SHOT=đường/dẫn.png để xem bố cục 2 cửa sổ

    // ---- else if của if lồng, While lồng, hàm có { } (try / catch): chèn rồi đi vào khối đó -- kiểm tra code rồi xoá đi
    await uiClick(side(`.crumb a[data-key="C${c1.id}"]`));
    await uiClick(side('.sl code').filter({ hasText: "await clickEl(page.locator('#agree'));" }).first()); // ▸ trong if #agree
    await uiClick(side(`.crumb a[data-key="C${c1.id}"]`)); // ▸ cuối if Start = sau OK -> chưa có if ngay trước ▸ -> không có else if
    assert.strictEqual(await side('[data-blk=elif]').count(), 0, 'không có if ngay trước ▸ thì không hiện ↳ else if');
    await uiClick(side('.sl code').filter({ hasText: "} else {" }).first()); // bấm dòng } else { -> vào else của if #agree
    assert.strictEqual(st().cur.par, 'X' + n1.id, 'bấm dòng } else { -> vào else');
    const before = st().steps.map((x) => x.id);
    await blk('while');
    assert.ok((code().match(/whileGuard\(/g) || []).length === 2 && st().cur.par[0] === 'C', 'While lồng (có whileGuard riêng) + vào if đầu của nó');
    await side('[data-f=sfn]').selectOption('tryCatch');
    await until(() => /^F\d+:0$/.test(st().cur.par || ''), 5000, 'vào khối try');
    await page.waitForTimeout(400);
    assert.ok(/ƒ try \/ catch/.test(await crumbText()) && (await side('.scode').innerText()).includes('try {'), 'ƒ try / catch: chèn + đi vào khối { } của nó (hiện trong code, if chưa điều kiện hiện mờ)');
    assert.ok(!/try \{/.test(code()), 'if chưa có điều kiện -> chưa xuất ra code');
    for (const id of st().steps.map((x) => x.id).filter((i) => !before.includes(i)).reverse()) await page.evaluate((m) => window.__pmRec(m), { op: 'delete', stepId: id });
    assert.ok((code().match(/whileGuard\(/g) || []).length === 1 && !/try \{/.test(code()));
    // else if: if Đồng ý nối else if (#later) -- thử ở mức code rồi bỏ
    await page.evaluate((m) => window.__pmRec(m), { op: 'cursor', stepId: n1.id });
    await page.waitForTimeout(1700); // cửa sổ khối theo con trỏ mới (làm mới định kỳ)
    await side('[data-blk=else]').waitFor({ timeout: 4000 });
    assert.strictEqual(await side('[data-blk=elif]').count(), 0, 'if #agree đã có else -> không nối else if được, chỉ "vào else"');
    // else if thật: if #ok mới ở cuối if Start, rồi ↳ else if (#later)
    const before2 = st().steps.map((x) => x.id);
    await uiClick(side(`.crumb a[data-key="C${c1.id}"]`));
    await blk('if'); await typeSel('#ok');
    await uiClick(side(`.crumb a[data-key="C${c1.id}"]`));
    await blk('elif'); await typeSel('#later');
    assert.ok(/if \(await isShown\(page\.locator\('#ok'\)\)\) \{[^]*?\n\s+\} else if \(await isShown\(page\.locator\('#later'\)\)\) \{/.test(code()), '↳ else if nối vào if ngay trước:\n' + code());
    for (const id of st().steps.map((x) => x.id).filter((i) => !before2.includes(i)).reverse()) await page.evaluate((m) => window.__pmRec(m), { op: 'delete', stepId: id });
    ok('↳ else if (nối vào if ngay trước ▸; if đã có else thì chỉ "vào else"); bấm dòng } else { vào else; ⟳ While lồng + ƒ try/catch chèn đúng chỗ và đi vào khối');

    // ---- if 2 của While: #done -> thoát; else của While: nghỉ
    await uiClick(side('[data-op=spClose]'));
    assert.ok(await page.locator('.libw').isHidden(), 'đóng cửa sổ khối -> kho (chế độ tự động) ẩn');
    await uiClick(page.locator(`.bif[data-id="${c1.id}"] [data-op=caseAdd]`));
    await side('.sh').waitFor();
    await typeSel('#done');
    await side('[data-f=end]').selectOption('break'); await page.waitForTimeout(400);
    await uiClick(side('[data-op=spClose]'));
    await uiClick(page.locator(`.bif.else[data-id="${L.id}"] [data-op=enter]`));
    await act('pause'); await uiClick(side('[data-op=sadd]'));
    c = code();
    assert.ok(/\} else if \(await isShown\(page\.locator\('#done'\)\)\) \{[^]*?break;[^]*?\} else \{ \/\/ không khớp trường hợp nào\n\s+await pause/.test(c), c);

    // ---- cửa sổ kho: « thu gọn -> tắt; 📦 -> mở lại; 📌 ghim -> hiện cả khi không sửa khối
    await uiClick(page.locator('.libw [data-op=loff]'));
    assert.ok(await page.locator('.libw').isHidden(), '« thu gọn -> kho tắt dù đang sửa khối');
    await uiClick(side('[data-op=lshow]'));
    assert.ok(await page.locator('.libw').isVisible(), '📦 -> kho mở lại');
    await uiClick(page.locator('.libw [data-op=lpin]'));
    await uiClick(side('[data-op=spClose]'));
    assert.ok(await page.locator('.libw').isVisible() && st().libMode === 'pin', '📌 ghim -> kho vẫn hiện khi không sửa khối');
    await uiClick(page.locator('.libw [data-op=lpin]'));
    assert.ok(await page.locator('.libw').isHidden(), 'bỏ ghim -> về tự động (ẩn khi không sửa khối)');
    ok('kho element: tự động / 📌 ghim / « thu gọn / 📦 mở lại');

    // ---- code chạy thật: có "Đồng ý" -> nhánh if lồng; không có -> nhánh else; rồi OK -> Xong -> thoát While
    const body = rec.recorderCode(ID, true).replace(/^await page\.goto[^\n]*\n/m, '');
    await page.goto(url + '?agree'); await runCode(body);
    assert.strictEqual(await page.locator('#log').innerText(), 'agreed;'); assert.ok(await page.locator('#done').isVisible());
    await page.goto(url); await runCode(body);
    assert.strictEqual(await page.locator('#log').innerText(), 'later;'); assert.ok(await page.locator('#done').isVisible());
    ok('code chạy thật: if lồng / else đúng nhánh theo trang, rồi thoát While');

    assert.deepStrictEqual(errs, [], 'không có lỗi JS trong trang');
    await rec.stopRecorder(ID, context);
    console.log(`\nOK -- ${done} test qua`);
  } finally { await browser.close(); srv.close(); }
})().catch((e) => { console.error('\n✗ FAIL:', (e && e.stack) || e); process.exit(1); });
