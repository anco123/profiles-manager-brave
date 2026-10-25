/**
 * public/fntransform.js -- nút "⇄ Biến đổi" của editor: đổi các lệnh Playwright thô (con trỏ NHẢY CÓC tới phần tử, gõ tức thì -- dấu vết
 * bot) sang hàm "người thật" của project, để chạy mượt như người:
 *   page.click(sel) / loc.click()        -> clickEl(loc)              (lăn chuột thật, đi chuột Fitts, nhấn kiểu người)
 *   loc.click({ button: 'right' })       -> rightClickEl(loc)         loc.dblclick() / click({ clickCount: 2 }) -> dblClickEl(loc)
 *   page.fill(sel, v) / loc.fill / type / pressSequentially -> typeEl(loc, v)
 *   page.hover(sel) / loc.hover()        -> hoverEl(loc)              loc.check() / uncheck() -> checkEl(loc[, false])
 *   loc.scrollIntoViewIfNeeded()         -> scrollEl(loc)
 *   page.mouse.move(x, y)                -> moveMouseVisibly(page, x, y)        page.mouse.click(x, y) -> đi chuột tới + humanPressMouse
 *   page.mouse.wheel(dx, dy)             -> humanWheel(page, dy)                page.keyboard.type(t) -> humanType(page, t)
 *   page.waitForTimeout(ms)              -> pause(page, ms*0.8, ms*1.2)         (nghỉ có rung chuột nhẹ, thời gian lệch như người)
 * Chỉ đổi lệnh có `await` ở đầu (đọc theo cấu trúc lời gọi, bỏ qua chuỗi / chú thích). Trả về danh sách chỗ đổi (để xem trước, chọn
 * từng cái) + các require cần thêm. Dùng ở editor (window.FN_TRANSFORM) và test (require).
 */
(function (root) {
  // ---- đọc code: vị trí nào nằm trong chuỗi / chú thích (bỏ qua khi tìm `await`)
  function codeMask(src) {
    const m = new Uint8Array(src.length); // 1 = trong chuỗi / chú thích
    for (let i = 0; i < src.length; i++) {
      const c = src[i], n = src[i + 1];
      if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') m[i++] = 1; continue; }
      if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2), end = e < 0 ? src.length : e + 2; for (; i < end; i++) m[i] = 1; i--; continue; }
      if (c === "'" || c === '"' || c === '`') { const q = c; m[i++] = 1; while (i < src.length && src[i] !== q) { if (src[i] === '\\') m[i++] = 1; m[i++] = 1; } m[i] = 1; continue; }
    }
    return m;
  }
  // Từ vị trí i (đầu 1 tên), đọc chuỗi lời gọi: ten(.ten(args)?)* -- trả về các đoạn { name, start, end, args (chuỗi gốc trong ngoặc) }
  function readChain(src, i) {
    const segs = [], idRe = /[A-Za-z_$][\w$]*/y;
    const args = (j) => { // j ở '(' -> vị trí sau ')' khớp, bỏ qua chuỗi / ngoặc lồng
      let d = 0;
      for (let k = j; k < src.length; k++) {
        const c = src[k];
        if (c === "'" || c === '"' || c === '`') { for (k++; k < src.length && src[k] !== c; k++) if (src[k] === '\\') k++; continue; }
        if (c === '(' || c === '[' || c === '{') d++;
        else if (c === ')' || c === ']' || c === '}') { d--; if (d === 0) return k + 1; }
      }
      return -1;
    };
    let k = i;
    for (;;) {
      idRe.lastIndex = k; const m = idRe.exec(src);
      if (!m) break;
      const seg = { name: m[0], start: k, end: k + m[0].length, args: null };
      let e = seg.end;
      while (src[e] === ' ') e++;
      if (src[e] === '(') { const close = args(e); if (close < 0) break; seg.args = src.slice(e + 1, close - 1); seg.end = close; }
      segs.push(seg);
      let n = seg.end; while (/\s/.test(src[n] || '')) n++;
      if (src[n] !== '.' || src[n + 1] === '.') break;
      k = n + 1; while (/\s/.test(src[k] || '')) k++;
    }
    return segs;
  }
  // Tách tham số ở cấp ngoài cùng theo dấu phẩy (bỏ qua chuỗi / ngoặc lồng)
  function splitArgs(a) {
    const out = []; let d = 0, cur = '';
    for (let k = 0; k < (a || '').length; k++) {
      const c = a[k];
      if (c === "'" || c === '"' || c === '`') { let j = k + 1; for (; j < a.length && a[j] !== c; j++) if (a[j] === '\\') j++; cur += a.slice(k, j + 1); k = j; continue; }
      if ('([{'.includes(c)) d++; if (')]}'.includes(c)) d--;
      if (c === ',' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += c;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  const isStr = (a) => /^(['"`]).*\1$/s.test(a || '');
  const PAGE_RE = /^(page|tab\w*|newPage|popup\w*|p|pg|page\d+)$/;
  const ACT = './xlv1_actions', HELP = './helpers', HUM = './xlv1_humanInput';

  // 1 lời gọi `await <chuỗi>` -> { text thay thế (không gồm await), req } hoặc null nếu không cần đổi
  function rewrite(recv, name, args) {
    const a = splitArgs(args);
    const pageLike = PAGE_RE.test(recv);
    const mouse = /\.mouse$/.test(recv) && recv.slice(0, -6), kb = /\.keyboard$/.test(recv) && recv.slice(0, -9);
    if (mouse) {
      if (name === 'move' && a.length >= 2) return { t: `moveMouseVisibly(${mouse}, ${a[0]}, ${a[1]})`, req: { [HELP]: ['moveMouseVisibly'] } };
      if (name === 'click' && a.length >= 2 && !/button|clickCount/.test(a[2] || '')) return { t: `moveMouseVisibly(${mouse}, ${a[0]}, ${a[1]}); await humanPressMouse(${mouse})`, req: { [HELP]: ['moveMouseVisibly'], [HUM]: ['humanPressMouse'] } };
      if (name === 'wheel' && a.length >= 2) return { t: `humanWheel(${mouse}, ${a[1]})`, req: { [HUM]: ['humanWheel'] } };
      return null;
    }
    if (kb) return name === 'type' && a.length >= 1 ? { t: `humanType(${kb}, ${a[0]})`, req: { [HUM]: ['humanType'] } } : null;
    if (pageLike && name === 'waitForTimeout' && a.length === 1) {
      const n = /^\d+$/.test(a[0]) ? +a[0] : null;
      return { t: n != null ? `pause(${recv}, ${Math.round(n * 0.8)}, ${Math.round(n * 1.2)})` : `pause(${recv}, ${a[0]}, ${a[0]})`, req: { [ACT]: ['pause'] } };
    }
    // page.click('sel') kiểu cũ (tham số đầu là chuỗi selector) -> locator; còn lại là locator / biến locator
    const pageStyle = isStr(a[0]) && ['click', 'dblclick', 'fill', 'type', 'hover', 'check', 'uncheck', 'tap'].includes(name) && (pageLike || /^[A-Za-z_$][\w$]*$/.test(recv));
    const el = pageStyle ? `${recv}.locator(${a[0]})` : recv, rest = pageStyle ? a.slice(1) : a;
    if (!pageStyle && pageLike) return null; // page.hover() không tham số... không phải lệnh với phần tử
    const opt = rest[0] || '', one = (fn, extra = '') => ({ t: `${fn}(${el}${extra})`, req: { [ACT]: [fn] } });
    switch (name) {
      case 'click': case 'tap': return /button:\s*['"]right['"]/.test(opt) ? one('rightClickEl') : /clickCount:\s*2/.test(opt) ? one('dblClickEl') : /button:\s*['"]middle['"]/.test(opt) ? null : one('clickEl');
      case 'dblclick': return one('dblClickEl');
      case 'fill': case 'type': case 'pressSequentially': return rest.length ? one('typeEl', `, ${rest[0]}`) : null;
      case 'hover': return one('hoverEl');
      case 'check': return one('checkEl');
      case 'uncheck': return one('checkEl', ', false');
      case 'scrollIntoViewIfNeeded': return one('scrollEl');
      default: return null;
    }
  }

  // Quét cả file -> các chỗ đổi { start, end (vị trí trong code), before, after, line, req }
  function findChanges(src) {
    const mask = codeMask(src), out = [], re = /\bawait\s+/g;
    let m;
    while ((m = re.exec(src))) {
      if (mask[m.index]) continue;
      const segs = readChain(src, m.index + m[0].length);
      if (segs.length < 2) continue;
      let t = segs.length - 1;
      while (t > 1 && ['catch', 'then', 'finally'].includes(segs[t].name)) t--; // .click().catch(() => {}) -> đổi click, giữ .catch
      const target = segs[t];
      if (target.args == null) continue;
      const recv = src.slice(segs[0].start, segs[t - 1].end);
      if (/\b(clickEl|typeEl|hoverEl|scrollEl|evaluate|moveMouseVisibly)\b/.test(recv)) continue;
      const r = rewrite(recv, target.name, target.args);
      if (!r) continue;
      const start = segs[0].start, end = target.end, line = src.slice(0, start).split('\n').length;
      out.push({ start, end, before: src.slice(start, end), after: r.t, line, req: r.req });
    }
    return out;
  }

  // Áp các chỗ đổi đã chọn (từ cuối lên để vị trí không lệch) + thêm require còn thiếu lên đầu file
  function applyChanges(src, changes) {
    let out = src;
    for (const c of [...changes].sort((a, b) => b.start - a.start)) out = out.slice(0, c.start) + c.after + out.slice(c.end);
    return addRequires(out, mergeReq(changes.map((c) => c.req)), src); // xét require thiếu trên code GỐC: `const ok = await clickEl(...)` mới đổi không phải là khai báo clickEl
  }
  const mergeReq = (list) => { const r = {}; for (const q of list) for (const [mod, names] of Object.entries(q || {})) r[mod] = [...new Set([...(r[mod] || []), ...names])]; return r; };
  // Tên hàm nào chưa có trong code thì thêm `const { ... } = require('mod');` (xlv1_actions mới thêm thì kèm useLog(log);) -- chèn sau
  // khối require ở đầu file (không có thì dòng đầu)
  // Kế hoạch thêm require: tên còn thiếu của module đã có dòng `const { a, b } = require('mod');` (1 dòng) thì GỘP vào dòng đó (edits),
  // module chưa có thì thêm dòng mới (lines, chèn sau khối require đầu file)
  function planRequires(src, req) {
    const edits = [], rest = {}, all = src.split('\n');
    for (const [mod, names] of Object.entries(req || {})) {
      const miss = names.filter((n) => requireLines(src, { [mod]: [n] }).length);
      if (!miss.length) continue;
      const re = new RegExp(`^(\\s*const \\{)([^}]*)(\\}\\s*=\\s*require\\(['"]${mod.replace(/[./]/g, '\\$&')}['"]\\);?.*)$`), i = all.findIndex((l) => re.test(l));
      if (i < 0) { rest[mod] = miss; continue; }
      const m = all[i].match(re), have = m[2].split(',').map((x) => x.trim()).filter(Boolean);
      all[i] = `${m[1]} ${[...have, ...miss.filter((n) => !have.includes(n))].join(', ')} ${m[3]}`;
      edits.push({ line: i, text: all[i], names: miss, mod });
    }
    return { edits, lines: requireLines(src, rest) };
  }
  function requireLines(src, req) {
    const lines = [];
    for (const [mod, names] of Object.entries(req || {})) {
      const miss = names.filter((n) => !new RegExp(`\\b${n}\\b[^\\n]*require\\(['"]${mod.replace(/[./]/g, '\\$&')}['"]\\)|\\b(const|let|var|function)\\s+[^\\n]*\\b${n}\\b`).test(src) && !new RegExp(`\\{[^}]*\\b${n}\\b[^}]*\\}\\s*=\\s*require\\(`).test(src));
      if (!miss.length) continue;
      const fresh = mod === ACT && !/require\(['"]\.\/xlv1_actions['"]\)/.test(src); // lần đầu dùng xlv1_actions -> kèm useLog(log) để hàm ghi log ra màn hình Run
      if (fresh && !miss.includes('useLog')) miss.unshift('useLog');
      lines.push(`const { ${miss.join(', ')} } = require('${mod}');`);
      if (fresh) lines.push('useLog(log);');
    }
    return lines;
  }
  function addRequires(src, req, checkSrc = src) {
    const plan = planRequires(checkSrc, req), lines = plan.lines, all = src.split('\n');
    for (const e of plan.edits) { const i = all.findIndex((l) => l === checkSrc.split('\n')[e.line]); if (i >= 0) all[i] = e.text; }
    if (!lines.length) return all.join('\n');
    let at = 0;
    for (let i = 0; i < Math.min(all.length, 60); i++) if (/require\(/.test(all[i]) || /^\s*useLog\(/.test(all[i])) at = i + 1;
    all.splice(at, 0, ...lines);
    return all.join('\n');
  }
  const api = { findChanges, applyChanges, addRequires, requireLines, planRequires, mergeReq };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FN_TRANSFORM = api;
})(typeof window !== 'undefined' ? window : this);
