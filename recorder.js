/**
 * recorder.js -- ghi lại thao tác tay trên cửa sổ profile đang mở rồi sinh code dùng scripts/xlv1_actions.js (clickEl, typeEl, ...).
 * -----------------------------------------------------------------------
 * - startRecorder(id, context): gắn binding window.__pmRec + init script vẽ nút "⏺ REC" (góc dưới phải, kéo được) vào mọi trang.
 *   Bấm nút -> bảng các bước đã ghi: đổi hành động, đổi selector, ⬆ cha / ⬇ con, sửa chữ gõ, xoá bước, xem code.
 * - Trang ghi gì: click, gõ (gộp cả ô thành 1 bước), Enter, chọn <select>, chuyển trang. Chỉ sự kiện THẬT (isTrusted) -- nhưng chuột/phím
 *   của Playwright cũng là "thật", nên server.js tự tạm dừng ghi trong lúc Run script (pauseRecorder). Chỉ khung trang chính, không ghi iframe.
 * - Bước + trạng thái giữ ở server (recorders[id]) nên chuyển trang / reload không mất.
 * - Lưu ý: lúc đang ghi, trang có thêm window.__pmRec + 1 thẻ div (shadow DOM) -- trang web có thể thấy. Chỉ bật khi cần ghi.
 * -----------------------------------------------------------------------
 */

const recorders = {}; // id profile -> { enabled, recording, steps, seq }

const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
const ACTIONS = { click: 'Click', type: 'Gõ', hover: 'Hover', wait: 'Wait hiện', waitGone: 'Wait mất', ifClick: 'If hiện → Click', ifType: 'If hiện → Gõ', press: 'Phím', select: 'Chọn option', nav: 'Mở trang', skip: 'Bỏ qua' };

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
    case 'click': return `await clickEl(${sel});`;
    case 'type': return `await typeEl(${sel}, ${txt}${opt});`;
    case 'hover': return `await hoverEl(${sel});`;
    case 'wait': return `await waitEl(${sel}, 15000);`;
    case 'waitGone': return `await waitGone(${sel}, 15000);`;
    case 'ifClick': return `if (await waitEl(${sel}, 5000)) await clickEl(${sel});`;
    case 'ifType': return `if (await waitEl(${sel}, 5000)) await typeEl(${sel}, ${txt}${opt});`;
    case 'press': return `await page.keyboard.press(${q(s.key || 'Enter')});`;
    case 'select': return `await ${sel}.selectOption(${txt});`;
    case 'nav': return s.auto ? `await page.waitForLoadState('domcontentloaded'); // -> ${s.url}` : `await page.goto(${q(s.url)});`;
    default: return '';
  }
}

function buildCode(steps, withRequire = true) {
  const body = steps.map(stepCode).filter(Boolean).join('\n');
  if (!withRequire) return body + '\n';
  return "const { useLog, isShown, waitEl, waitGone, waitAny, scrollEl, hoverEl, clickEl, typeEl, getText, pause, whileHandle } = require('./xlv1_actions');\nuseLog(log);\n\n" + body + '\n';
}

function stateOf(id) {
  const r = recorders[id];
  if (!r) return { enabled: false, recording: false, steps: [], code: '' };
  return { enabled: r.enabled, recording: r.recording, steps: r.steps.map((s) => ({ ...s, code: stepCode(s) })), actions: ACTIONS, code: buildCode(r.steps) };
}

const sameEl = (a, b) => a && b && a.levels && b.levels && a.levels[0]?.css === b.levels[0]?.css;

// Sự kiện từ trang -> bước. Gộp: click vào ô rồi gõ = 1 bước gõ; gõ tiếp cùng ô = cập nhật chữ; Enter sau khi gõ = enter: true.
function onEvent(r, ev) {
  const last = r.steps[r.steps.length - 1], now = Date.now();
  const add = (s) => r.steps.push({ id: ++r.seq, at: now, level: ev.level ?? 0, alt: 0, ...s });
  if (ev.kind === 'nav') {
    if (!/^https?:/.test(ev.url) || (last && last.url === ev.url && last.action === 'nav')) return;
    const auto = !!last && now - last.at < 6000 && ['click', 'type', 'press', 'ifClick'].includes(last.action);
    add({ action: 'nav', url: ev.url, auto });
    return;
  }
  const base = { levels: ev.levels, level: ev.level, url: ev.pageUrl };
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

async function handle(id, page, msg) {
  const r = recorders[id];
  if (!r) return { enabled: false };
  if (msg.op === 'event' && r.recording) onEvent(r, msg.ev);
  else if (msg.op === 'toggle') r.recording = !r.recording;
  else if (msg.op === 'clear') r.steps = [];
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
      for (const k of ['action', 'text', 'enter', 'custom', 'url', 'key', 'auto']) if (p[k] !== undefined) s[k] = p[k];
    }
  }
  return stateOf(id);
}

async function startRecorder(id, context) {
  if (!recorders[id]) recorders[id] = { enabled: true, recording: true, steps: [], seq: 0 };
  const r = recorders[id];
  r.enabled = true; r.recording = true;
  if (!context.__pmRecorder) {
    context.__pmRecorder = true;
    await context.exposeBinding('__pmRec', (src, msg) => handle(id, src.page, msg));
    await context.addInitScript(`(${pageRecorder.toString()})()`);
    context.on('close', () => { delete recorders[id]; });
  }
  // Trang đang mở sẵn: init script chỉ chạy cho lần tải trang SAU, nên chèn tay ngay bây giờ
  for (const page of context.pages()) await page.evaluate(`(${pageRecorder.toString()})()`).catch(() => {});
  const pg = context.pages()[0];
  if (!r.steps.length && pg && /^https?:/.test(pg.url())) onEvent(r, { kind: 'nav', url: pg.url() });
  return stateOf(id);
}

async function stopRecorder(id, context) {
  const r = recorders[id];
  if (r) { r.enabled = false; r.recording = false; }
  if (context) for (const page of context.pages()) await page.evaluate(() => window.__pmRecUI && window.__pmRecUI.remove()).catch(() => {});
  return stateOf(id);
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
  let host = null;
  const ours = (e) => host && e.composedPath().includes(host);

  // ---------------- selector
  function cssPath(el) {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
      if (n.id && !/\d{3,}|^[:\-_]/.test(n.id)) { parts.unshift('#' + cssEsc(n.id)); break; }
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
  const ROLE_TAG = { BUTTON: 'button', SELECT: 'combobox', TEXTAREA: 'textbox', H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading', LI: 'listitem', IMG: 'img' };
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
  function withNth(code, list, el) {
    if (list.length <= 1) return { code, unique: true };
    const i = list.indexOf(el);
    return { code: i === 0 ? `${code}.first()` : `${code}.nth(${i})`, unique: false, note: `${list.length} cái giống` };
  }
  function altsFor(el) {
    const alts = [], tag = el.tagName.toLowerCase();
    const tid = el.getAttribute('data-testid');
    if (tid) alts.push({ kind: 'testid', ...withNth(`page.getByTestId(${sq(tid)})`, [...document.querySelectorAll(`[data-testid="${cssEsc(tid)}"]`)], el) });
    if (el.id && !/\d{3,}|^[:\-_]/.test(el.id)) alts.push({ kind: 'id', code: `page.locator(${sq('#' + cssEsc(el.id))})`, unique: true });
    const role = roleOf(el), name = nameOf(el);
    if (role && name && name.length <= 50) {
      const same = [...document.querySelectorAll('*')].filter((n) => n === el || (roleOf(n) === role && nameOf(n) === name && isVis(n)));
      alts.push({ kind: 'role', ...withNth(`page.getByRole(${sq(role)}, { name: ${sq(name)}, exact: true })`, same, el) });
    }
    for (const a of ['name', 'placeholder', 'aria-label', 'type', 'href']) {
      const v = el.getAttribute(a);
      if (!v || (a === 'type' && !['INPUT', 'BUTTON'].includes(el.tagName)) || (a === 'href' && v.length > 80)) continue;
      const css = `${tag}[${a}="${v.replace(/"/g, '\\"')}"]`;
      let list = []; try { list = [...document.querySelectorAll(css)]; } catch {}
      if (list.length) alts.push({ kind: a, ...withNth(`page.locator(${sq(css)})`, list, el) });
      if (a === 'placeholder') alts.push({ kind: 'placeholder', code: `page.getByPlaceholder(${sq(v)}, { exact: true })`, unique: list.length === 1 });
    }
    const own = clean(el.innerText);
    if (own && own.length <= 40 && !alts.some((a) => a.kind === 'role')) {
      const same = [...document.querySelectorAll('body *')].filter((n) => clean(n.innerText) === own && ![...n.children].some((c) => clean(c.innerText) === own) && isVis(n));
      alts.push({ kind: 'text', ...withNth(`page.getByText(${sq(own)}, { exact: true })`, same.includes(el) ? same : [el], el) });
    }
    const cp = cssPath(el);
    let cnt = 1; try { cnt = document.querySelectorAll(cp).length; } catch {}
    alts.push({ kind: 'css', code: `page.locator(${sq(cp)})`, unique: cnt === 1 });
    alts.sort((a, b) => (b.unique ? 1 : 0) - (a.unique ? 1 : 0)); // ưu tiên selector chỉ khớp đúng 1 phần tử (sort ổn định -> giữ thứ tự testid > id > role > ...)
    return alts;
  }
  const INTERACTIVE = 'a,button,input,select,textarea,label,summary,[role=button],[role=link],[role=menuitem],[role=tab],[role=checkbox],[role=option],[role=switch],[role=textbox],[contenteditable=true],[data-testid]';
  function chainFor(target) {
    const levels = [];
    let start = 0;
    for (let n = target, i = 0; n && n.nodeType === 1 && n !== document.body && i < 8; n = n.parentElement, i++) {
      const b = n.getBoundingClientRect();
      levels.push({ tag: n.tagName.toLowerCase(), label: nameOf(n).slice(0, 40), size: `${Math.round(b.width)}×${Math.round(b.height)}`, css: cssPath(n), alts: altsFor(n) });
    }
    const idx = levels.findIndex((l, i) => { let n = target; for (let k = 0; k < i; k++) n = n.parentElement; return n.matches(INTERACTIVE); });
    if (idx > 0) start = idx;
    return { levels, level: start };
  }
  const send = (ev) => call({ op: 'event', ev: { ...ev, pageUrl: location.href } }).then((st) => st && render(st));

  // ---------------- ghi sự kiện
  const editable = (el) => el && (el.isContentEditable || (el.tagName === 'TEXTAREA') || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'file', 'submit', 'button', 'reset', 'image', 'range', 'color'].includes((el.type || '').toLowerCase())));
  const editRoot = (el) => { while (el && el.parentElement && el.parentElement.isContentEditable) el = el.parentElement; return el; };
  const pending = new Map();
  function flushType(el) { const t = pending.get(el); if (!t) return; clearTimeout(t); pending.delete(el); sendType(el); }
  function sendType(el) { const value = el.isContentEditable ? el.innerText.replace(/\n$/, '') : el.value; send({ kind: 'type', value, ...chainFor(el), level: 0 }); }
  const flushAll = () => { for (const el of [...pending.keys()]) flushType(el); };
  document.addEventListener('focusout', (e) => { if (e.isTrusted && !ours(e)) flushAll(); }, true);
  document.addEventListener('click', (e) => {
    if (!e.isTrusted || ours(e)) return;
    flushAll();
    const t = e.target.nodeType === 1 ? e.target : e.target.parentElement;
    if (!t) return;
    if (editable(t) || (t.isContentEditable)) { const root = editRoot(t); send({ kind: 'click', ...chainFor(root), level: 0 }); return; }
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
    send({ kind: 'enter', ...chainFor(t), level: 0 });
  }, true);
  document.addEventListener('change', (e) => {
    if (!e.isTrusted || ours(e) || e.target.tagName !== 'SELECT') return;
    flushAll();
    send({ kind: 'select', value: e.target.value, ...chainFor(e.target), level: 0 });
  }, true);
  let lastUrl = location.href;
  const navTick = () => { if (location.href !== lastUrl) { lastUrl = location.href; send({ kind: 'nav', url: location.href }); } };
  setInterval(navTick, 500);
  addEventListener('pagehide', flushAll); // rời trang (Enter submit form...) -- gửi nốt chữ đang gõ dở
  const hello = () => (typeof window.__pmRec === 'function' ? send({ kind: 'nav', url: location.href }) : setTimeout(hello, 200)); // vừa tải trang mới
  hello();

  // ---------------- giao diện (shadow DOM -- CSS trang web không lọt vào, CSS của mình không lọt ra)
  let st = null, open = false, showCode = false, hl = null, ui = null;
  let tt = null; try { tt = window.trustedTypes && trustedTypes.createPolicy('pmrec', { createHTML: (x) => x }); } catch {} // trang bật Trusted Types (Google...) chặn innerHTML thường
  const setHTML = (el, html) => { el.innerHTML = tt ? tt.createHTML(html) : html; };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const CSS_UI = `*{box-sizing:border-box;font-family:Segoe UI,system-ui,sans-serif;font-size:12px}
    .pill{display:flex;align-items:center;gap:6px;background:#1a1d27;color:#e8e9ed;border:1px solid #2a2e3a;border-radius:999px;padding:6px 12px;cursor:pointer;box-shadow:0 4px 16px #0006;user-select:none}
    .dot{width:10px;height:10px;border-radius:50%;background:#666}.rec .dot{background:#ef4444;animation:p 1.2s infinite}@keyframes p{50%{opacity:.35}}
    .panel{position:absolute;right:0;bottom:44px;width:470px;max-height:72vh;display:flex;flex-direction:column;background:#12141c;color:#e8e9ed;border:1px solid #2a2e3a;border-radius:12px;box-shadow:0 10px 40px #000a;overflow:hidden}
    .panel[hidden]{display:none}.hd{display:flex;gap:6px;align-items:center;padding:8px;border-bottom:1px solid #2a2e3a;cursor:move}.hd b{flex:1}
    button{background:#1a1d27;color:#e8e9ed;border:1px solid #2a2e3a;border-radius:6px;padding:3px 8px;cursor:pointer}button:hover:not(:disabled){border-color:#e8a33d;color:#f5b455}button:disabled{opacity:.35;cursor:default}
    .pri{background:#e8a33d;color:#1a1206;border-color:#e8a33d}.pri:hover{color:#1a1206!important;filter:brightness(1.1)}
    .list{overflow:auto;flex:1;padding:6px}.empty{opacity:.6;padding:16px;text-align:center}
    .st{border:1px solid #2a2e3a;border-radius:8px;padding:6px;margin-bottom:6px;background:#1a1d27}.st:hover{border-color:#e8a33d}
    .r{display:flex;gap:4px;align-items:center;margin-top:4px}.r:first-child{margin-top:0}.n{opacity:.6;min-width:18px}
    select,input{background:#12141c;color:#e8e9ed;border:1px solid #2a2e3a;border-radius:6px;padding:3px 5px;min-width:0}
    .grow{flex:1}.lv{opacity:.75;white-space:nowrap}.code{font-family:Consolas,monospace;font-size:11px;color:#9cdcfe;word-break:break-all;margin-top:4px}
    pre{margin:0;padding:8px;max-height:30vh;overflow:auto;border-top:1px solid #2a2e3a;font-family:Consolas,monospace;font-size:11px;color:#9cdcfe;white-space:pre-wrap}
    .info{opacity:.7;font-size:11px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`;

  function mount() {
    if (!document.body) return setTimeout(mount, 100);
    if (window.__pmRecUI) return;
    host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647';
    window.__pmRecUI = host;
    const root = host.attachShadow({ mode: 'closed' });
    setHTML(root, `<style>${CSS_UI}</style><div class="panel" hidden></div><div class="pill"><span class="dot"></span><span class="lbl">REC</span></div>`);
    ui = { root, pill: root.querySelector('.pill'), panel: root.querySelector('.panel') };
    document.documentElement.appendChild(host);
    // kéo nút / thanh tiêu đề panel để dời chỗ
    let drag = null;
    root.addEventListener('mousedown', (e) => {
      const t = e.composedPath()[0];
      if (!t.closest || t.closest('button,select,input') || !(t.closest('.pill') || t.closest('.hd'))) return;
      const b = host.getBoundingClientRect(); drag = { x: e.clientX, y: e.clientY, r: innerWidth - b.right, b: innerHeight - b.bottom, moved: false }; e.preventDefault();
    });
    addEventListener('mousemove', (e) => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true; host.style.right = Math.max(0, drag.r - dx) + 'px'; host.style.bottom = Math.max(0, drag.b - dy) + 'px'; }, true);
    addEventListener('mouseup', () => { const d = drag; setTimeout(() => { if (drag === d) drag = null; }); }, true);
    ui.pill.addEventListener('click', () => { if (drag && drag.moved) return; open = !open; ui.panel.hidden = !open; if (!open) highlight(null); refresh(); });
    for (const t of ['click', 'change', 'mouseover']) root.addEventListener(t, onPanel);
    for (const t of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'keydown', 'keyup', 'input', 'change']) host.addEventListener(t, (e) => e.stopPropagation()); // trang web không nhận sự kiện của panel
    refresh();
  }
  function highlight(css) {
    if (!hl) { hl = document.createElement('div'); hl.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #e8a33d;background:#e8a33d22;border-radius:3px'; }
    let el = null; try { el = css && document.querySelector(css); } catch {}
    if (!el) { hl.remove(); return; }
    const b = el.getBoundingClientRect();
    Object.assign(hl.style, { left: b.left - 2 + 'px', top: b.top - 2 + 'px', width: b.width + 4 + 'px', height: b.height + 4 + 'px' });
    document.documentElement.appendChild(hl);
  }
  function unmount() { if (host) host.remove(); if (hl) hl.remove(); window.__pmRecUI = null; ui = null; }
  function render(s) { if (!s) return; st = s; if (!s.enabled) return unmount(); if (ui) draw(s); }
  function refresh() { call({ op: 'state' }).then(render); }
  const ELACTS = ['click', 'type', 'hover', 'wait', 'waitGone', 'ifClick', 'ifType', 'select', 'skip'];
  function stepHTML(x, i, acts) {
    const tools = `<span class="grow"></span><button data-op="up" title="Lên trên">↑</button><button data-op="down" title="Xuống dưới">↓</button><button data-op="del" title="Xoá bước">✕</button>`;
    if (!x.levels) return `<div class="st" data-id="${x.id}"><div class="r"><span class="n">${i + 1}</span>
      <select data-f="action"><option value="${x.action === 'skip' ? (x.url ? 'nav' : 'press') : x.action}">${esc(acts[x.url ? 'nav' : 'press'])}</option><option value="skip" ${x.action === 'skip' ? 'selected' : ''}>Bỏ qua</option></select>
      ${x.url ? `<label class="lv"><input type="checkbox" data-f="auto" ${x.auto ? 'checked' : ''}> tự chuyển (do click)</label>` : ''}${tools}</div><div class="code">${esc(x.code || '// (bỏ qua)')}</div></div>`;
    const lv = x.levels[x.level];
    return `<div class="st" data-id="${x.id}" data-css="${esc(lv.css)}"><div class="r"><span class="n">${i + 1}</span>
      <select data-f="action">${ELACTS.map((a) => `<option value="${a}" ${a === x.action ? 'selected' : ''}>${esc(acts[a])}</option>`).join('')}</select>
      <button data-op="parent" title="Chọn phần tử CHA bao ngoài" ${x.level >= x.levels.length - 1 ? 'disabled' : ''}>⬆ cha</button>
      <button data-op="child" title="Quay về phần tử CON bên trong" ${x.level <= 0 ? 'disabled' : ''}>⬇ con</button>
      <span class="lv">cấp ${x.level}/${x.levels.length - 1}</span>${tools}</div>
      <div class="info">&lt;${esc(lv.tag)}&gt; ${esc(lv.size)} ${esc(lv.label)}</div>
      <div class="r"><select data-f="alt" class="grow">${lv.alts.map((a, k) => `<option value="${k}" ${k === x.alt && !x.custom ? 'selected' : ''}>${a.unique ? '' : '⚠ '}${esc(a.kind)}: ${esc(a.code)}${a.note ? ' (' + esc(a.note) + ')' : ''}</option>`).join('')}${x.custom ? `<option value="custom" selected>sửa tay: ${esc(x.custom)}</option>` : ''}</select>
      <button data-op="edit" title="Tự sửa selector">✎</button></div>
      ${['type', 'ifType', 'select'].includes(x.action) ? `<div class="r"><input class="grow" data-f="text" value="${esc(x.text)}" title="Bắt đầu bằng = để dùng biểu thức JS, VD: = row.D">${x.action !== 'select' ? `<label class="lv"><input type="checkbox" data-f="enter" ${x.enter ? 'checked' : ''}> Enter</label>` : ''}</div>` : ''}
      <div class="code">${esc(x.code || '// (bỏ qua)')}</div></div>`;
  }
  function draw(s) {
    ui.pill.classList.toggle('rec', !!s.recording);
    ui.pill.querySelector('.lbl').textContent = (s.recording ? 'REC' : 'Tạm dừng') + ` · ${s.steps.length} bước`;
    if (!open) return;
    const a = ui.root.activeElement;
    if (a && (a.tagName === 'INPUT' && a.type !== 'checkbox' || a.tagName === 'SELECT')) return; // đang sửa 1 ô -- không vẽ lại kẻo mất con trỏ
    const list = ui.panel.querySelector('.list'), scroll = list ? list.scrollTop : 0;
    setHTML(ui.panel, `<div class="hd"><b>Các bước đã ghi</b>
        <button data-op="toggle">${s.recording ? '⏸ Dừng ghi' : '⏺ Ghi tiếp'}</button><button data-op="code">${showCode ? 'Ẩn code' : 'Code'}</button>
        <button data-op="copy" class="pri">Copy code</button><button data-op="clear">Xoá hết</button><button data-op="close" title="Thu nhỏ">—</button></div>
      <div class="list">${s.steps.length ? s.steps.map((x, i) => stepHTML(x, i, s.actions || {})).join('') : '<div class="empty">Chưa có bước nào -- cứ thao tác trên trang, các bước sẽ hiện ở đây.</div>'}</div>
      ${showCode ? `<pre>${esc(s.code)}</pre>` : ''}`);
    ui.panel.querySelector('.list').scrollTop = scroll;
  }
  const upd = (stepId, patch) => call({ op: 'update', stepId, patch }).then((s) => { render(s); const x = s && s.steps.find((y) => y.id === stepId); highlight(x && x.levels ? x.levels[x.level].css : null); });
  function onPanel(e) {
    const el = e.composedPath()[0]; if (!el || !el.closest) return;
    const card = el.closest('.st'), stepId = card ? +card.dataset.id : null, step = st && st.steps.find((x) => x.id === stepId);
    if (e.type === 'mouseover') { highlight(card ? card.dataset.css : null); return; }
    if (e.type === 'change' && el.dataset.f && step) {
      const f = el.dataset.f;
      if (f === 'action') upd(stepId, { action: el.value });
      else if (f === 'alt') { if (el.value !== 'custom') upd(stepId, { alt: +el.value }); }
      else if (f === 'text') upd(stepId, { text: el.value });
      else upd(stepId, { [f]: el.checked });
      el.blur();
      return;
    }
    if (e.type !== 'click') return;
    const btn = el.closest('button'), op = btn && btn.dataset.op; if (!op) return;
    if (op === 'close') { open = false; ui.panel.hidden = true; highlight(null); return; }
    if (op === 'code') { showCode = !showCode; draw(st); return; }
    if (op === 'copy') { const ta = document.createElement('textarea'); ta.value = st.code; document.documentElement.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch {} ta.remove(); if (navigator.clipboard) navigator.clipboard.writeText(st.code).catch(() => {}); btn.textContent = 'Đã copy ✓'; setTimeout(() => draw(st), 1200); return; }
    if (op === 'toggle') { call({ op: 'toggle' }).then(render); return; }
    if (op === 'clear') { if (confirm('Xoá hết các bước đã ghi?')) call({ op: 'clear' }).then(render); return; }
    if (!step) return;
    if (op === 'del') call({ op: 'delete', stepId }).then(render);
    else if (op === 'up' || op === 'down') call({ op: 'move', stepId, dir: op === 'up' ? -1 : 1 }).then(render);
    else if (op === 'parent') upd(stepId, { level: step.level + 1 });
    else if (op === 'child') upd(stepId, { level: step.level - 1 });
    else if (op === 'edit') { const v = prompt('Selector (code Playwright), VD: page.locator(\'button[type="submit"]\')', step.custom || (step.levels[step.level].alts[step.alt] || {}).code); if (v) upd(stepId, { custom: v.trim() }); }
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

module.exports = { startRecorder, stopRecorder, pauseRecorder, recorderState: stateOf, recorderCode: (id, withRequire) => buildCode(recorders[id]?.steps || [], withRequire) };
