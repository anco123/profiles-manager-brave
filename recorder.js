/**
 * recorder.js -- ghi lại thao tác tay trên cửa sổ profile đang mở rồi sinh code dùng scripts/xlv1_actions.js (clickEl, typeEl, ...).
 * -----------------------------------------------------------------------
 * - startRecorder(id, context): gắn binding window.__pmRec + init script vẽ nút "⏺ REC" (góc dưới phải, kéo được) vào mọi trang.
 *   Bấm nút REC = bắt đầu ghi 1 ĐOẠN; bấm lần nữa = dừng + xuất code của đúng đoạn đó (editor đang mở tự chèn vào chỗ con trỏ, kèm copy clipboard).
 *   Nút ☰ cạnh đó -> bảng các bước đã ghi: đổi hành động, đổi selector, ⬆ cha / ⬇ con, sửa chữ gõ, xoá bước, xem code.
 * - Giữ Alt + rê chuột: bảng các lớp phần tử chồng nhau dưới con trỏ (elementsFromPoint -- cả lớp phủ trong suốt lẫn nút bị đè bên dưới),
 *   lăn chuột để đổi lớp, nhả Alt thì bảng đứng yên để chọn selector (đếm số khớp bằng chính Playwright) + hành động.
 * - Trang ghi gì: click, gõ (gộp cả ô thành 1 bước), Enter, chọn <select>, chuyển trang. Chỉ sự kiện THẬT (isTrusted) -- nhưng chuột/phím
 *   của Playwright cũng là "thật", nên server.js tự tạm dừng ghi trong lúc Run script (pauseRecorder). Chỉ khung trang chính, không ghi iframe.
 * - Sau cú click: mở tab mới -> đổi thành page.goto (đọc href lúc chạy, hoặc URL cố định); tải file -> chờ download.
 *   Hộp thoại alert/confirm không cần ghi: Playwright tự đóng (dismiss) cả lúc ghi lẫn lúc chạy script.
 * - Gõ chữ: so với dòng Excel / Google Sheet của profile đang ghi (snapshot đã import ở editor) -> gợi ý thay chữ cố định bằng
 *   row.U / readGoogleSheetCell(row, 'D', 'TAB'); không khớp thì vẫn chọn tay được từ danh sách cột.
 * - Bước + trạng thái giữ ở server (recorders[id]) nên chuyển trang / reload không mất.
 * - Lưu ý: lúc đang ghi, trang có thêm window.__pmRec + 1 thẻ div (shadow DOM) -- trang web có thể thấy. Chỉ bật khi cần ghi.
 * -----------------------------------------------------------------------
 */

const fs = require('fs');

const recorders = {}; // id profile -> { enabled, recording, steps, seq, segFrom, exports, exportSeq, tabSeq, sources, undo }

const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
const ACTIONS = { click: 'Click', type: 'Gõ', hover: 'Hover', wait: 'Wait hiện', waitGone: 'Wait mất', ifClick: 'If hiện → Click', ifType: 'If hiện → Gõ', getText: 'Lấy text', gotoLink: 'Mở link (đọc href lúc chạy)', gotoUrl: 'Mở URL cố định', press: 'Phím', select: 'Chọn option', nav: 'Mở trang', skip: 'Bỏ qua' };
const HEADER = "const { useLog, isShown, waitEl, waitGone, waitAny, scrollEl, hoverEl, clickEl, typeEl, getText, pause, whileHandle } = require('./xlv1_actions');\nuseLog(log);\n\n";

function selOf(step) {
  const lv = step.levels?.[step.level];
  if (!lv) return null;
  if (step.custom) return step.custom;
  return (lv.alts[step.alt] || lv.alts[0]).code;
}

function stepCode(s) {
  const sel = selOf(s), txt = s.text != null && String(s.text).startsWith('=') ? String(s.text).slice(1).trim() : q(s.text ?? '');
  const opt = s.enter ? ', { enter: true }' : '';
  switch (s.action) {
    case 'click': return s.download ? `const [dl${s.id}] = await Promise.all([page.waitForEvent('download'), clickEl(${sel})]); log('Đã tải: ' + dl${s.id}.suggestedFilename() + ' -> ' + await dl${s.id}.path()); // dl${s.id}.saveAs('đường dẫn') để lưu hẳn` : `await clickEl(${sel});`;
    case 'type': return `await typeEl(${sel}, ${txt}${opt});`;
    case 'hover': return `await hoverEl(${sel});`;
    case 'wait': return `await waitEl(${sel}, 15000);`;
    case 'waitGone': return `await waitGone(${sel}, 15000);`;
    case 'ifClick': return `if (await waitEl(${sel}, 5000)) await clickEl(${sel});`;
    case 'ifType': return `if (await waitEl(${sel}, 5000)) await typeEl(${sel}, ${txt}${opt});`;
    case 'getText': return `const text${s.id} = await getText(${sel}); log('text: ' + text${s.id});`;
    case 'gotoLink': return `await page.goto(new URL(await ${sel}.getAttribute('href'), page.url()).href); // click mở tab mới -> mở thẳng link trong tab này`;
    case 'gotoUrl': return `await page.goto(${q(s.tabUrl || s.href || '')}); // click mở tab mới -> mở thẳng URL trong tab này`;
    case 'press': return `await page.keyboard.press(${q(s.key || 'Enter')});`;
    case 'select': return `await ${sel}.selectOption(${txt});`;
    case 'nav': return s.auto ? `await page.waitForLoadState('domcontentloaded'); // -> ${s.url}` : `await page.goto(${q(s.url)});`;
    default: return '';
  }
}

function buildCode(steps, withRequire = true) {
  const body = steps.map(stepCode).filter(Boolean).join('\n');
  return (withRequire ? HEADER : '') + body + '\n';
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
  return { enabled: r.enabled, recording: r.recording, segFrom: r.segFrom, exportSeq: r.exportSeq, canUndo: !!r.undo, rowNum: r.rowNum, sources: sourceList(r), steps: r.steps.map((s) => ({ ...s, code: stepCode(s) })), actions: ACTIONS, code: buildCode(r.steps) };
}

// Dừng 1 đoạn -> code của các bước ghi trong đoạn đó (id >= segFrom) vào hàng đợi; editor hỏi /recorder?since=... rồi tự chèn
function exportSeg(r) {
  const seg = r.steps.filter((s) => s.id >= r.segFrom);
  r.segFrom = r.seq + 1;
  if (!seg.some((s) => stepCode(s))) return null;
  const e = { id: ++r.exportSeq, count: seg.length, body: buildCode(seg, false) };
  r.exports.push(e);
  if (r.exports.length > 20) r.exports.shift();
  return e;
}

const sameEl = (a, b) => a && b && a.levels && b.levels && a.levels[0]?.css === b.levels[0]?.css;

// Sự kiện từ trang -> bước. Gộp: click vào ô rồi gõ = 1 bước gõ; gõ tiếp cùng ô = cập nhật chữ; Enter sau khi gõ = enter: true.
function onEvent(r, ev, page) {
  const last = r.steps[r.steps.length - 1], now = Date.now();
  const add = (s) => { const step = { id: ++r.seq, at: now, level: ev.level ?? 0, alt: 0, ...s }; r.steps.push(step); return step; };
  if (ev.kind === 'nav') {
    if (!/^https?:/.test(ev.url) || (last && last.url === ev.url && last.action === 'nav')) return;
    const tab = page && page.__pmTabId;
    if (tab && last && last.tab === tab) { last.tabUrl = ev.url; return; } // tab mới vừa mở do click (đã đổi thành goto) -- chỉ cập nhật URL, không thêm bước
    const auto = !!last && now - last.at < 6000 && ['click', 'type', 'press', 'ifClick'].includes(last.action);
    return add({ action: 'nav', url: ev.url, auto, tab });
  }
  const base = { levels: ev.levels, level: ev.level, url: ev.pageUrl, href: ev.href, linkLevel: ev.linkLevel };
  if (ev.kind === 'pick') return add({ ...base, action: ev.action, alt: ev.alt || 0, custom: ev.custom || null, text: ev.text, enter: !!ev.enter });
  if (ev.kind === 'click') return add({ ...base, action: 'click' });
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
const LOC_FNS = new Set(['locator', 'getByRole', 'getByText', 'getByTestId', 'getByPlaceholder', 'getByLabel', 'getByTitle', 'getByAltText', 'filter', 'first', 'last', 'nth']);
function locOf(page, code) {
  const s = String(code || ''); let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const word = () => { ws(); const m = /^[A-Za-z_$][\w$]*/.exec(s.slice(i)); if (!m) throw 0; i += m[0].length; return m[0]; };
  const val = () => {
    ws(); const c = s[i];
    if (c === "'" || c === '"') { let out = ''; for (i++; s[i] !== c; i++) { if (i >= s.length) throw 0; if (s[i] === '\\') { i++; out += s[i] === 'n' ? '\n' : s[i]; } else out += s[i]; } i++; return out; }
    if (c === '{') { i++; const o = {}; for (ws(); s[i] !== '}'; ws()) { const k = word(); ws(); if (s[i++] !== ':') throw 0; o[k] = val(); ws(); if (s[i] === ',') i++; } i++; return o; }
    const m = /^(-?\d+(\.\d+)?|true|false)/.exec(s.slice(i)); if (!m) throw 0; i += m[0].length; return m[0] === 'true' ? true : m[0] === 'false' ? false : +m[0];
  };
  try {
    if (word() !== 'page') return null;
    let loc = page;
    for (ws(); i < s.length; ws()) {
      if (s[i++] !== '.') return null;
      const fn = word(); if (!LOC_FNS.has(fn)) return null;
      ws(); if (s[i++] !== '(') return null;
      const args = []; for (ws(); s[i] !== ')'; ws()) { args.push(val()); ws(); if (s[i] === ',') i++; }
      i++; loc = loc[fn](...args);
    }
    return loc === page ? null : loc;
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

// "Làm luôn trên trang" ở bảng chọn Alt: Playwright tự làm bằng đúng selector vừa chọn (tạm dừng ghi để không bị ghi lặp)
async function perform(r, page, s) {
  const loc = locOf(page, selOf(s));
  if (!loc) return;
  r.recording = false;
  try {
    if (s.action === 'hover') await loc.hover({ timeout: 3000 });
    else if (['click', 'ifClick'].includes(s.action)) {
      // phần tử bị lớp khác đè (chọn "dưới lớp phủ" ở bảng Alt) -> Playwright click không tới, bấm thẳng vào phần tử để còn ghi tiếp
      try { await loc.click({ timeout: 2500 }); } catch (err) { await loc.dispatchEvent('click', {}, { timeout: 1500 }); s.error = 'bị phần tử khác đè, đã bấm thẳng bằng dispatchEvent -- script thật có thể phải click lớp đè hoặc { force: true }'; return; }
    } else if (['type', 'ifType'].includes(s.action) && !String(s.text ?? '').startsWith('=')) { await loc.fill(String(s.text ?? ''), { timeout: 3000 }); if (s.enter) await loc.press('Enter'); }
    s.error = null;
  } catch (err) { s.error = 'làm trên trang lỗi: ' + String(err.message || err).split('\n')[0].slice(0, 120); } finally {
    await new Promise((res) => setTimeout(res, 300)); // sự kiện click/gõ của Playwright về tới server sau 1 nhịp -- đợi rồi mới ghi tiếp
    if (r.enabled) r.recording = true;
  }
}

async function handle(id, page, msg) {
  const r = recorders[id];
  if (!r) return { enabled: false };
  if (msg.op === 'count') return { counts: await countLocs(page, msg.codes) };
  let exported = null;
  if (msg.op === 'event' && r.recording) { const s = onEvent(r, msg.ev, page); if (s && msg.ev.perform) await perform(r, page, s); }
  else if (msg.op === 'toggle') { if (r.recording) { r.recording = false; exported = exportSeg(r); } else { r.recording = true; r.segFrom = r.seq + 1; } }
  else if (msg.op === 'clear') { if (r.steps.length) r.undo = r.steps; r.steps = []; } // giữ lại để Khôi phục
  else if (msg.op === 'undoClear') { if (r.undo) r.steps = [...r.undo, ...r.steps]; r.undo = null; }
  else if (msg.op === 'delete') r.steps = r.steps.filter((s) => s.id !== msg.stepId);
  else if (msg.op === 'move') {
    const i = r.steps.findIndex((s) => s.id === msg.stepId), j = i + msg.dir;
    if (i >= 0 && j >= 0 && j < r.steps.length) [r.steps[i], r.steps[j]] = [r.steps[j], r.steps[i]];
  } else if (msg.op === 'update') {
    const s = r.steps.find((x) => x.id === msg.stepId);
    if (s) {
      const p = msg.patch || {};
      if (p.level != null && s.levels && p.level >= 0 && p.level < s.levels.length) { s.level = p.level; s.alt = 0; s.custom = null; }
      if (p.alt != null) { s.alt = p.alt; s.custom = null; }
      for (const k of ['action', 'text', 'enter', 'custom', 'url', 'key', 'auto', 'tabUrl']) if (p[k] !== undefined) s[k] = p[k];
    }
  }
  return { ...stateOf(id), exported };
}

// Tải file ngay sau 1 cú click -> bước click đó thành "click + chờ download"
function watchPage(id, page) {
  if (page.__pmRecWatch) return;
  page.__pmRecWatch = true;
  page.on('download', () => {
    const r = recorders[id], s = r && r.steps[r.steps.length - 1];
    if (r && r.enabled && s && s.levels && s.action === 'click' && Date.now() - s.at < 5000) s.download = true;
  });
}

// Tab mới mở ra ngay sau 1 cú click -> đổi bước click thành page.goto trong tab hiện tại (script khỏi phải xử lý tab mới):
// có href -> đọc href của thẻ <a> lúc chạy (link mỗi lần mỗi khác vẫn đúng); không có href (trang tự window.open) -> URL cố định của tab mới.
function onNewTab(id, page) {
  watchPage(id, page);
  const r = recorders[id], t0 = Date.now();
  if (!r || !r.enabled) return;
  const tab = page.__pmTabId = ++r.tabSeq;
  setTimeout(() => { // bước click (đi qua binding) có thể về sau sự kiện mở tab 1 chút
    let i = r.steps.length - 1;
    while (i >= 0 && r.steps[i].action === 'nav' && r.steps[i].tab === tab) i--;
    const s = r.steps[i];
    if (!s || !s.levels || s.action !== 'click' || s.tab || t0 - s.at > 4000) return;
    const navs = r.steps.slice(i + 1);
    r.steps = r.steps.slice(0, i + 1);
    s.tab = tab;
    s.action = s.href ? 'gotoLink' : 'gotoUrl';
    if (s.href && s.linkLevel >= 0 && s.linkLevel < s.levels.length) Object.assign(s, { level: s.linkLevel, alt: 0, custom: null });
    s.tabUrl = navs.length ? navs[navs.length - 1].url : /^https?:/.test(page.url()) ? page.url() : s.href || '';
  }, 400);
}

// data: { excelFile, excelHeaderFile, gsheetFile, matchColumn, profileName } -- để gợi ý row.X / readGoogleSheetCell (xem loadSources)
async function startRecorder(id, context, data) {
  if (!recorders[id]) recorders[id] = { enabled: true, recording: false, steps: [], seq: 0, segFrom: 1, exports: [], exportSeq: 0, tabSeq: 0 };
  const r = recorders[id];
  r.sources = loadSources(data); // đọc lại mỗi lần bấm Record (vừa import / sync lại thì có dữ liệu mới)
  const ex = r.sources.find((x) => x.kind === 'excel');
  r.rowNum = ex && ex.row ? ex.rows.indexOf(ex.row) + 2 : null;
  for (const s of r.steps) s.sugFor = undefined;
  if (!r.recording) r.segFrom = r.seq + 1;
  r.enabled = true; r.recording = true;
  if (!context.__pmRecorder) {
    context.__pmRecorder = true;
    await context.exposeBinding('__pmRec', (src, msg) => handle(id, src.page, msg));
    await context.addInitScript(`(${pageRecorder.toString()})()`);
    context.on('page', (p) => onNewTab(id, p));
    context.on('close', () => { delete recorders[id]; });
  }
  for (const page of context.pages()) watchPage(id, page);
  // Trang đang mở sẵn: init script chỉ chạy cho lần tải trang SAU, nên chèn tay ngay bây giờ
  for (const page of context.pages()) await page.evaluate(`(${pageRecorder.toString()})()`).catch(() => {});
  const pg = context.pages()[0];
  if (!r.steps.length && pg && /^https?:/.test(pg.url())) onEvent(r, { kind: 'nav', url: pg.url() });
  return stateOf(id);
}

async function stopRecorder(id, context) {
  const r = recorders[id];
  let exported = null;
  if (r) { if (r.recording) exported = exportSeg(r); r.enabled = false; r.recording = false; }
  if (context) for (const page of context.pages()) await page.evaluate(() => window.__pmRecUI && window.__pmRecUI.remove()).catch(() => {});
  return { ...stateOf(id), exported };
}

// ===================================================================== chạy TRONG trang (được toString() rồi chèn vào)
function pageRecorder() {
  if (window.top !== window.self) return;
  if (window.__pmRecInstalled) { if (window.__pmRecMount) window.__pmRecMount(); return; } // đã gắn listener rồi (bật ghi lại lần 2) -- chỉ hiện lại nút
  window.__pmRecInstalled = true;
  const call = (msg) => (typeof window.__pmRec === 'function' ? window.__pmRec(msg) : Promise.resolve(null));
  const sq = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const cssEsc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));
  const attrEsc = (s) => String(s).replace(/["\\]/g, '\\$&');
  const goodId = (id) => !/\d{3,}|^[:\-_]/.test(id);
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
  const rank = (a) => (a.unique ? (a.kind === 'css' ? 1 : 0) : 2);
  const sortAlts = (alts) => alts.sort((a, b) => rank(a) - rank(b));
  // scope/pre: tìm TRONG 1 phần tử cha (scope) và viết code nối tiếp locator của cha đó (pre) -- dùng cho scopedAlts
  function altsFor(el, scope = document, pre = 'page') {
    const alts = [], tag = el.tagName.toLowerCase(), top = scope === document;
    const all = (css) => { try { return [...scope.querySelectorAll(css)]; } catch { return []; } };
    const tid = el.getAttribute('data-testid');
    if (tid) alts.push({ kind: 'testid', ...withNth(`${pre}.getByTestId(${sq(tid)})`, all(`[data-testid="${cssEsc(tid)}"]`), el) });
    if (top && el.id && goodId(el.id)) alts.push({ kind: 'id', code: `${pre}.locator(${sq('#' + cssEsc(el.id))})`, unique: true });
    const role = roleOf(el), name = nameOf(el);
    if (role && name && name.length <= 50) {
      const same = all('*').filter((n) => n === el || (roleOf(n) === role && nameOf(n) === name && isVis(n)));
      alts.push({ kind: 'role', ...withNth(`${pre}.getByRole(${sq(role)}, { name: ${sq(name)}, exact: true })`, same, el) });
    }
    for (const a of ['name', 'placeholder', 'aria-label', 'type', 'href']) {
      const v = el.getAttribute(a);
      if (!v || (a === 'type' && !['INPUT', 'BUTTON'].includes(el.tagName)) || (a === 'href' && v.length > 80)) continue;
      const css = `${tag}[${a}="${attrEsc(v)}"]`, list = all(css);
      if (list.length) alts.push({ kind: a, ...withNth(`${pre}.locator(${sq(css)})`, list, el) });
      if (a === 'placeholder') alts.push({ kind: 'placeholder', code: `${pre}.getByPlaceholder(${sq(v)}, { exact: true })`, base: `${pre}.getByPlaceholder(${sq(v)}, { exact: true })`, unique: list.length === 1 });
    }
    const own = clean(el.innerText);
    if (own && own.length <= 40 && !alts.some((a) => a.kind === 'role')) {
      // chỉ xét phần tử nhỏ (ít con, ít chữ) -- gọi innerText cho cả nghìn khung lớn của trang thì khựng
      const same = all(top ? 'body *' : '*').filter((n) => n === el || (n.childElementCount <= 5 && (n.textContent || '').length <= 300 && clean(n.innerText) === own && ![...n.children].some((c) => clean(c.innerText) === own) && isVis(n)));
      alts.push({ kind: 'text', ...withNth(`${pre}.getByText(${sq(own)}, { exact: true })`, same.includes(el) ? same : [el], el) });
    }
    if (top) {
      const cp = cssPath(el);
      let cnt = 1; try { cnt = document.querySelectorAll(cp).length; } catch {}
      alts.push({ kind: 'css', code: `page.locator(${sq(cp)})`, base: `page.locator(${sq(cp)})`, unique: cnt === 1 });
    }
    return sortAlts(alts);
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
  function bestAlts(el) { const alts = altsFor(el); return alts.some((a) => a.unique && a.kind !== 'css') ? alts : sortAlts([...alts, ...scopedAlts(el)]); }
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
    return { levels, level: start, href: href && /^https?:/.test(href) ? href : undefined, linkLevel: nodes.indexOf(a) };
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
    send({ kind: 'click', ...chainFor(t) });
  }, true);
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
  setInterval(navTick, 500);
  addEventListener('pagehide', flushAll); // rời trang (Enter submit form...) -- gửi nốt chữ đang gõ dở
  const hello = () => (typeof window.__pmRec === 'function' ? send({ kind: 'nav', url: location.href }) : setTimeout(hello, 200)); // vừa tải trang mới
  hello();

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
    if (e.key === 'Alt') { if (pick && pick.live) e.preventDefault(); else if (st && st.recording && ui && !e.repeat && !e.ctrlKey) { e.preventDefault(); startPick(); } return; }
    if (pick && pick.live) closePick(); // Alt + phím khác (Alt+Tab, Alt+←...) là phím tắt, không phải chọn phần tử
    else if (pick && e.key === 'Escape') closePick();
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
  const altLabel = (a) => `${a.count == null ? (a.unique ? '' : '⚠ ') : a.unique ? '✓1 ' : `⚠${a.count} `}${a.kind}: ${a.code}${a.note && a.count == null ? ' (' + a.note + ')' : ''}`;
  function drawAltSelect() {
    const r = pick.rows[pick.sel], s = ui.pick.querySelector('[data-f=palt]');
    if (!s) return;
    setHTML(s, r.alts.map((a, k) => `<option value="${k}" ${a === pick.altObj && !pick.custom ? 'selected' : ''}>${esc(altLabel(a))}</option>`).join('') + (pick.custom ? `<option selected>sửa tay: ${esc(pick.custom)}</option>` : ''));
  }
  const PICK_ACTS = ['click', 'type', 'hover', 'wait', 'waitGone', 'ifClick', 'ifType', 'getText'];
  function drawPick() {
    if (!ui || !pick) return;
    const p = ui.pick, r = pick.rows[pick.sel], acts = (st && st.actions) || {};
    let html = `<div class="ph"><b>${pick.live ? 'Giữ Alt · lăn chuột đổi lớp · nhả Alt để chọn' : 'Chọn phần tử'}</b>${pick.live ? '' : '<button data-op="pclose" title="Đóng (Esc)">✕</button>'}</div>`;
    html += pick.rows.length ? `<div class="rows">${pick.rows.map((x, i) => `<div class="row ${i === pick.sel ? 'on' : ''}" data-i="${i}"><span class="star">${x.inter ? '★' : ''}</span>&lt;${esc(x.tag)}&gt; <span class="lb">${esc(x.label)}</span>${x.under ? '<span class="un">dưới lớp phủ</span>' : ''}<span class="sz">${x.size}${x.fold ? ' ×' + (x.fold + 1) : ''}</span></div>`).join('')}</div>` : '<div class="empty">Rê chuột lên phần tử cần chọn</div>';
    if (!pick.live && r) html += `<div class="det">
      <div class="r"><select data-f="palt" class="grow"></select><button data-op="pedit" title="Tự sửa selector">✎</button></div>
      ${pick.editing ? `<div class="r"><input class="grow" data-f="pcustom" value="${esc(pick.custom || (pick.altObj || {}).code)}" title="Enter để lưu"></div>` : ''}
      <div class="r"><input class="grow" data-f="ptext" value="${esc(pick.text)}" placeholder="Chữ để gõ (cho Gõ) -- bắt đầu bằng = để dùng biểu thức JS"><label class="lv"><input type="checkbox" data-f="penter" ${pick.enter ? 'checked' : ''}> Enter</label></div>
      ${srcSelect('psrc')}
      <div class="acts">${PICK_ACTS.map((a) => `<button data-act="${a}" ${a === 'click' ? 'class="pri"' : ''}>${esc(acts[a] || a)}</button>`).join('')}</div>
      <label class="lv"><input type="checkbox" data-f="pdo" ${pick.perform ? 'checked' : ''}> Làm luôn trên trang (Click / Gõ / Hover)</label></div>`;
    setHTML(p, html);
    p.hidden = false;
    if (!pick.live && r) drawAltSelect();
    if (pick.live) { // bám theo con trỏ, lật sang bên kia nếu tràn màn hình
      const w = p.offsetWidth, h = p.offsetHeight;
      p.style.left = Math.max(4, mx + 18 + w > innerWidth ? mx - w - 18 : mx + 18) + 'px';
      p.style.top = Math.max(4, my + 18 + h > innerHeight ? my - h - 18 : my + 18) + 'px';
    } else { const b = p.getBoundingClientRect(); if (b.bottom > innerHeight - 4) p.style.top = Math.max(4, innerHeight - b.height - 4) + 'px'; }
    boxEl(r && r.el, r && r.b);
  }
  function doPick(action) {
    const r = pick.rows[pick.sel];
    if (!r) return;
    const ch = chainFor(r.el, { level: 0, alts0: r.alts });
    const perform = pick.perform && ['click', 'type', 'hover', 'ifClick', 'ifType'].includes(action);
    send({ kind: 'pick', action, ...ch, alt: Math.max(0, r.alts.indexOf(pick.altObj)), custom: pick.custom, text: pick.text, enter: pick.enter, perform });
    toast(`Đã ghi: ${((st && st.actions) || {})[action] || action}${perform ? ' (đang làm trên trang...)' : ''}`);
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
      return;
    }
    if (pick.live) return;
    const row = el.closest('.row'), btn = el.closest('button');
    if (row) return selectRow(+row.dataset.i);
    if (!btn) return;
    if (btn.dataset.op === 'pclose') return closePick();
    if (btn.dataset.op === 'pedit') { pick.editing = true; drawPick(); const i = ui.pick.querySelector('[data-f=pcustom]'); if (i) i.focus(); return; }
    if (btn.dataset.act) doPick(btn.dataset.act);
  }

  // ---------------- giao diện (shadow DOM -- CSS trang web không lọt vào, CSS của mình không lọt ra)
  let st = null, open = false, showCode = false, hl = null, ui = null, editing = null, toastT = 0;
  let tt = null; try { tt = window.trustedTypes && trustedTypes.createPolicy('pmrec', { createHTML: (x) => x }); } catch {} // trang bật Trusted Types (Google...) chặn innerHTML thường
  const setHTML = (el, html) => { el.innerHTML = tt ? tt.createHTML(html) : html; };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const CSS_UI = `*{box-sizing:border-box;font-family:Segoe UI,system-ui,sans-serif;font-size:12px}
    .pill{display:flex;align-items:center;gap:6px;background:#1a1d27;color:#e8e9ed;border:1px solid #2a2e3a;border-radius:999px;padding:4px 4px 4px 12px;cursor:pointer;box-shadow:0 4px 16px #0006;user-select:none}
    .pill button{border-radius:999px;padding:2px 8px}
    .dot{width:10px;height:10px;border-radius:50%;background:#666}.rec .dot{background:#ef4444;animation:p 1.2s infinite}@keyframes p{50%{opacity:.35}}
    .panel{position:absolute;right:0;bottom:44px;width:470px;max-height:72vh;display:flex;flex-direction:column;background:#12141c;color:#e8e9ed;border:1px solid #2a2e3a;border-radius:12px;box-shadow:0 10px 40px #000a;overflow:hidden}
    .panel[hidden],.pick[hidden],.toast[hidden]{display:none}.hd{display:flex;gap:6px;align-items:center;padding:8px;border-bottom:1px solid #2a2e3a;cursor:move}.hd b{flex:1}
    button{background:#1a1d27;color:#e8e9ed;border:1px solid #2a2e3a;border-radius:6px;padding:3px 8px;cursor:pointer}button:hover:not(:disabled){border-color:#e8a33d;color:#f5b455}button:disabled{opacity:.35;cursor:default}
    .pri{background:#e8a33d;color:#1a1206;border-color:#e8a33d}.pri:hover{color:#1a1206!important;filter:brightness(1.1)}
    .list{overflow:auto;flex:1;padding:6px}.empty{opacity:.6;padding:16px;text-align:center}
    .st{border:1px solid #2a2e3a;border-radius:8px;padding:6px;margin-bottom:6px;background:#1a1d27}.st:hover{border-color:#e8a33d}
    .seg{opacity:.7;font-size:11px;text-align:center;margin:2px 0 6px;color:#ef4444}
    .r{display:flex;gap:4px;align-items:center;margin-top:4px}.r:first-child{margin-top:0}.n{opacity:.6;min-width:18px}
    select,input{background:#12141c;color:#e8e9ed;border:1px solid #2a2e3a;border-radius:6px;padding:3px 5px;min-width:0}
    .grow{flex:1}.lv{opacity:.75;white-space:nowrap}.code{font-family:Consolas,monospace;font-size:11px;color:#9cdcfe;word-break:break-all;margin-top:4px}
    pre{margin:0;padding:8px;max-height:30vh;overflow:auto;border-top:1px solid #2a2e3a;font-family:Consolas,monospace;font-size:11px;color:#9cdcfe;white-space:pre-wrap}
    .sug{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:4px;font-size:11px}.sug span{opacity:.7}.sug button{border-color:#3fb95066;color:#7ee2a8;font-size:11px;padding:2px 6px}
    .info{opacity:.7;font-size:11px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tag{color:#f5b455;font-size:11px;margin-top:3px}
    .pick{position:fixed;width:380px;max-height:80vh;overflow:auto;background:#12141c;color:#e8e9ed;border:1px solid #e8a33d;border-radius:10px;box-shadow:0 10px 40px #000a;padding:6px}
    .ph{display:flex;align-items:center;gap:6px;padding:2px 2px 6px}.ph b{flex:1;font-size:11px;opacity:.85}
    .row{display:flex;gap:4px;align-items:center;padding:3px 5px;border-radius:6px;cursor:pointer;white-space:nowrap}.row:hover{background:#1a1d27}.row.on{background:#e8a33d33;outline:1px solid #e8a33d}
    .star{color:#f5b455;width:10px}.lb{flex:1;overflow:hidden;text-overflow:ellipsis;opacity:.8}.sz{opacity:.55;font-size:11px}.un{color:#9cdcfe;font-size:10px;border:1px solid #9cdcfe55;border-radius:4px;padding:0 3px}
    .det{border-top:1px solid #2a2e3a;margin-top:6px;padding-top:6px}.acts{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0}
    .toast{position:absolute;right:0;bottom:44px;background:#1a1d27;color:#e8e9ed;border:1px solid #e8a33d;border-radius:8px;padding:6px 10px;white-space:nowrap;box-shadow:0 4px 16px #0006}`;

  function mount() {
    if (!document.body) return setTimeout(mount, 100);
    if (window.__pmRecUI) return;
    host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647';
    window.__pmRecUI = host;
    root = host.attachShadow({ mode: 'closed' });
    setHTML(root, `<style>${CSS_UI}</style><div class="panel" hidden></div><div class="toast" hidden></div><div class="pick" hidden></div>
      <div class="pill" title="Bấm: bắt đầu ghi / dừng + xuất code đoạn vừa ghi. Giữ Alt + rê chuột: chọn đúng phần tử"><span class="dot"></span><span class="lbl">REC</span><button data-op="menu" title="Các bước đã ghi">☰</button></div>`);
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
    else if (t === 'keydown') { if (e.key === 'Escape') { if (pick) closePick(); else if (editing) { editing = null; draw(st); } } else if (e.key === 'Enter' && el.tagName === 'INPUT') el.blur(); }
    else if (t === 'input') { if (inPick && pick && el.dataset.f === 'ptext') pick.text = el.value; }
    else if (t === 'click' || t === 'change') (inPick ? (pick && onPick(e, el)) : onPanel(e, el));
  }
  function onOver(el) {
    if (el.closest('.pick')) { const row = el.closest('.row'), r = row && pick && pick.rows[+row.dataset.i]; if (r) boxEl(r.el, r.b); else if (pick) { const s = pick.rows[pick.sel]; boxEl(s && s.el, s && s.b); } return; }
    if (pick) return;
    const card = el.closest('.st'); highlight(card ? card.dataset.css : null);
  }
  function boxEl(el, rect) {
    if (!hl) { hl = document.createElement('div'); hl.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #e8a33d;background:#e8a33d22;border-radius:3px'; }
    const b = el && el.isConnected ? el.getBoundingClientRect() : rect;
    if (!b) { hl.remove(); return; }
    Object.assign(hl.style, { left: b.left - 2 + 'px', top: b.top - 2 + 'px', width: b.width + 4 + 'px', height: b.height + 4 + 'px' });
    document.documentElement.appendChild(hl);
  }
  function highlight(css) { let el = null; try { el = css && document.querySelector(css); } catch {} boxEl(el); }
  function toast(msg) { if (!ui) return; ui.toast.textContent = msg; ui.toast.hidden = false; ui.panel.hidden = true; open = false; clearTimeout(toastT); toastT = setTimeout(() => { ui && (ui.toast.hidden = true); }, 3000); }
  function copyText(text) {
    const fallback = () => { const ta = document.createElement('textarea'); ta.value = text; document.documentElement.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch {} ta.remove(); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(fallback); else fallback();
  }
  function toggleRec() {
    call({ op: 'toggle' }).then((s) => {
      if (!s) return;
      render(s);
      if (s.exported) { copyText(s.exported.body); toast(`Đã xuất ${s.exported.count} bước → editor + clipboard`); }
      else toast(s.recording ? 'Đang ghi đoạn mới · giữ Alt + rê chuột để chọn đúng phần tử' : 'Đã dừng -- đoạn này chưa có bước nào');
    });
  }
  function unmount() { closePick(); if (host) host.remove(); if (hl) hl.remove(); window.__pmRecUI = null; ui = null; root = null; }
  function render(s) { if (!s) return; st = s; if (!s.enabled) return unmount(); if (ui) draw(s); }
  function refresh() { call({ op: 'state' }).then(render); }
  const ELACTS = ['click', 'type', 'hover', 'wait', 'waitGone', 'ifClick', 'ifType', 'getText', 'select', 'skip'];
  // Lấy chữ gõ từ Excel / Google Sheet: danh sách cột (server gửi trong state.sources, kèm giá trị ở dòng của profile)
  const srcSelect = (f) => (st && st.sources && st.sources.length ? `<div class="r"><select data-f="${f}" class="grow" title="Thay chữ cố định bằng giá trị ô Excel / Google Sheet ở dòng của profile đang chạy"><option value="">Lấy từ cột Excel / Sheet${st.rowNum ? ` (dòng ${st.rowNum} của profile này)` : ' (chưa khớp dòng của profile này)'}…</option>${st.sources.map((g) => `<optgroup label="${esc(g.label)}">${g.opts.map((o) => `<option value="${esc(o.code)}">${esc(o.label)}</option>`).join('')}</optgroup>`).join('')}</select></div>` : '');
  const sugHTML = (x) => (x.suggest && x.suggest.length ? `<div class="sug"><span>Khớp ô:</span>${x.suggest.map((g) => `<button data-op="src" data-code="${esc(g.code)}" title="Dùng ${esc(g.code)}">${esc(g.label)}</button>`).join('')}</div>` : '');
  function stepHTML(x, i, acts) {
    const tools = `<span class="grow"></span><button data-op="up" title="Lên trên">↑</button><button data-op="down" title="Xuống dưới">↓</button><button data-op="del" title="Xoá bước">✕</button>`;
    if (!x.levels) return `<div class="st" data-id="${x.id}"><div class="r"><span class="n">${i + 1}</span>
      <select data-f="action"><option value="${x.action === 'skip' ? (x.url ? 'nav' : 'press') : x.action}">${esc(acts[x.url ? 'nav' : 'press'])}</option><option value="skip" ${x.action === 'skip' ? 'selected' : ''}>Bỏ qua</option></select>
      ${x.url ? `<label class="lv"><input type="checkbox" data-f="auto" ${x.auto ? 'checked' : ''}> tự chuyển (do click)</label>` : ''}${tools}</div><div class="code">${esc(x.code || '// (bỏ qua)')}</div></div>`;
    const lv = x.levels[x.level], list = [...ELACTS, ...(x.href ? ['gotoLink'] : []), ...(x.href || x.tabUrl ? ['gotoUrl'] : [])];
    const tags = `${x.tab ? `↗ click mở tab mới${x.tabUrl ? ': ' + x.tabUrl : ''} ` : ''}${x.download ? '⬇ tải file ' : ''}${x.error ? '⚠ ' + x.error : ''}`;
    return `<div class="st" data-id="${x.id}" data-css="${esc(lv.css)}"><div class="r"><span class="n">${i + 1}</span>
      <select data-f="action">${list.map((a) => `<option value="${a}" ${a === x.action ? 'selected' : ''}>${esc(acts[a])}</option>`).join('')}</select>
      <button data-op="parent" title="Chọn phần tử CHA bao ngoài" ${x.level >= x.levels.length - 1 ? 'disabled' : ''}>⬆ cha</button>
      <button data-op="child" title="Quay về phần tử CON bên trong" ${x.level <= 0 ? 'disabled' : ''}>⬇ con</button>
      <span class="lv">cấp ${x.level}/${x.levels.length - 1}</span>${tools}</div>
      <div class="info">&lt;${esc(lv.tag)}&gt; ${esc(lv.size)} ${esc(lv.label)}</div>${tags ? `<div class="tag">${esc(tags)}</div>` : ''}
      <div class="r"><select data-f="alt" class="grow">${lv.alts.map((a, k) => `<option value="${k}" ${k === x.alt && !x.custom ? 'selected' : ''}>${esc(altLabel(a))}</option>`).join('')}${x.custom ? `<option value="custom" selected>sửa tay: ${esc(x.custom)}</option>` : ''}</select>
      <button data-op="edit" title="Tự sửa selector">✎</button></div>
      ${editing === x.id ? `<div class="r"><input class="grow" data-f="custom" value="${esc(x.custom || (lv.alts[x.alt] || lv.alts[0] || {}).code)}" title="Enter để lưu, Esc để huỷ"></div>` : ''}
      ${['type', 'ifType', 'select'].includes(x.action) ? `<div class="r"><input class="grow" data-f="text" value="${esc(x.text)}" title="Bắt đầu bằng = để dùng biểu thức JS, VD: = row.D">${x.action !== 'select' ? `<label class="lv"><input type="checkbox" data-f="enter" ${x.enter ? 'checked' : ''}> Enter</label>` : ''}</div>${sugHTML(x)}${srcSelect('src')}` : ''}
      <div class="code">${esc(x.code || '// (bỏ qua)')}</div></div>`;
  }
  function draw(s) {
    const segN = s.steps.filter((x) => x.id >= s.segFrom).length;
    ui.pill.classList.toggle('rec', !!s.recording);
    ui.pill.querySelector('.lbl').textContent = s.recording ? `REC · ${segN} bước` : 'Ghi';
    if (!open) return;
    const a = ui.root.activeElement;
    if (a && (a.tagName === 'INPUT' && a.type !== 'checkbox' || a.tagName === 'SELECT')) return; // đang sửa 1 ô -- không vẽ lại kẻo mất con trỏ
    const list = ui.panel.querySelector('.list'), scroll = list ? list.scrollTop : 0;
    const cards = s.steps.map((x, i) => (s.recording && x.id >= s.segFrom && (i === 0 || s.steps[i - 1].id < s.segFrom) ? '<div class="seg">— đoạn đang ghi (bấm REC để dừng + xuất) —</div>' : '') + stepHTML(x, i, s.actions || {}));
    setHTML(ui.panel, `<div class="hd"><b>Các bước đã ghi</b>
        <button data-op="toggle">${s.recording ? '⏹ Dừng + xuất' : '⏺ Ghi đoạn mới'}</button><button data-op="code">${showCode ? 'Ẩn code' : 'Code'}</button>
        <button data-op="copy" class="pri">Copy hết</button>${!s.steps.length && s.canUndo ? '<button data-op="undo">↶ Khôi phục</button>' : '<button data-op="clear">Xoá hết</button>'}<button data-op="close" title="Thu nhỏ">—</button></div>
      <div class="list">${s.steps.length ? cards.join('') : '<div class="empty">Chưa có bước nào -- cứ thao tác trên trang, các bước sẽ hiện ở đây. Giữ Alt + rê chuột để chọn đúng phần tử.</div>'}</div>
      ${showCode ? `<pre>${esc(s.code)}</pre>` : ''}`);
    ui.panel.querySelector('.list').scrollTop = scroll;
  }
  const upd = (stepId, patch) => call({ op: 'update', stepId, patch }).then((s) => { render(s); const x = s && s.steps.find((y) => y.id === stepId); highlight(x && x.levels ? x.levels[x.level].css : null); });
  function onPanel(e, el) {
    if (el.closest('.pill')) {
      if (e.type !== 'click' || (drag && drag.moved)) return;
      if (el.closest('[data-op=menu]')) { open = !open; ui.panel.hidden = !open; ui.toast.hidden = true; if (!open) highlight(null); refresh(); }
      else toggleRec();
      return;
    }
    const card = el.closest('.st'), stepId = card ? +card.dataset.id : null, step = st && st.steps.find((x) => x.id === stepId);
    if (e.type === 'change' && el.dataset.f && step) {
      const f = el.dataset.f;
      if (f === 'action') upd(stepId, { action: el.value });
      else if (f === 'alt') { if (el.value !== 'custom') upd(stepId, { alt: +el.value }); }
      else if (f === 'text') upd(stepId, { text: el.value });
      else if (f === 'src') { if (el.value) upd(stepId, { text: '= ' + el.value }); }
      else if (f === 'custom') { editing = null; if (el.value.trim()) upd(stepId, { custom: el.value.trim() }); else draw(st); }
      else upd(stepId, { [f]: el.checked });
      el.blur();
      return;
    }
    if (e.type !== 'click') return;
    const btn = el.closest('button'), op = btn && btn.dataset.op; if (!op) return;
    if (op === 'close') { open = false; ui.panel.hidden = true; highlight(null); return; }
    if (op === 'code') { showCode = !showCode; draw(st); return; }
    if (op === 'copy') { copyText(st.code); btn.textContent = 'Đã copy ✓'; setTimeout(() => draw(st), 1200); return; }
    if (op === 'toggle') { toggleRec(); return; }
    if (op === 'clear') { call({ op: 'clear' }).then(render); return; } // không hỏi lại (confirm() bị Playwright tự đóng) -- xoá nhầm thì bấm Khôi phục
    if (op === 'undo') { call({ op: 'undoClear' }).then(render); return; }
    if (!step) return;
    if (op === 'src') { upd(stepId, { text: '= ' + btn.dataset.code }); return; }
    if (op === 'del') call({ op: 'delete', stepId }).then(render);
    else if (op === 'up' || op === 'down') call({ op: 'move', stepId, dir: op === 'up' ? -1 : 1 }).then(render);
    else if (op === 'parent') upd(stepId, { level: step.level + 1 });
    else if (op === 'child') upd(stepId, { level: step.level - 1 });
    else if (op === 'edit') { editing = editing === stepId ? null : stepId; draw(st); const i = ui.panel.querySelector('[data-f=custom]'); if (i) i.focus(); }
  }
  const tryMount = window.__pmRecMount = () => (typeof window.__pmRec === 'function' ? call({ op: 'state' }).then((s) => { if (s && s.enabled) mount(); }) : setTimeout(tryMount, 200));
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
