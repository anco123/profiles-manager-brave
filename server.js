/**
 * server.js
 * -----------------------------------------------------------------------
 * Backend for the profile manager.
 *
 * Five jobs:
 *   1. CRUD API for "profiles" (name + browser settings), stored as JSON.
 *   2. Launch/close a real, isolated Chromium window per profile using
 *      Playwright's launchPersistentContext(), which is the built-in
 *      mechanism for "a browser profile that remembers itself between
 *      launches" -- cookies, localStorage, cache all live in a folder
 *      on disk (data/profiles/<id>/) exactly like a normal Chrome
 *      profile directory.
 *   3. Run a snippet of real Playwright code against a running profile's
 *      page (POST /api/profiles/:id/run) -- this is the "learn
 *      automation" surface; see that route for how it works.
 *   4. Let a script require() helper files from scripts/ -- ordinary
 *      Node.js modules, so logic can be split across files instead of
 *      living in one pasted blob.
 *   5. Run a bounded-concurrency queue of profiles (POST /api/queue/start)
 *      -- keeps up to N windows open, auto-launching the next pending
 *      profile whenever one closes.
 *
 * The base layer is "identity & isolation" only: per-profile user agent,
 * viewport, locale, timezone, proxy, and which browser binary runs
 * (bundled Chromium / system Chrome / a custom executable such as a
 * portable Chrome build).
 *
 * On top of that sits an OPT-IN "deep identity" layer -- canvas, WebGL,
 * audio, and (partially) font fingerprint spoofing -- implemented in
 * fingerprint.js and only active for a profile once it has a
 * `fingerprint` object (via "Generate fingerprint" on a profile card,
 * the auto-fingerprint checkbox on create/bulk-create, or an imported
 * profile that supplied one). Profiles created before this existed just
 * have `fingerprint: null` and behave exactly as before -- see
 * fingerprint.js's top comment for how the spoofing itself works, and
 * the README's fingerprint section for the reasoning and limitations.
 * -----------------------------------------------------------------------
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec, spawn } = require('child_process');
const { chromium } = require('playwright');
const { FP_LAYERS, fpLayersOf, uaMetadataFor, generateFingerprint, normalizeFingerprint, buildFingerprintInitScript, buildBaseStealthInitScript, screenForViewport, plausibleViewport } = require('./fingerprint');
const { checkChromeVersion, resolveChromePath } = require('./chrome-version-check');
const { startRecorder, stopRecorder, pauseRecorder, recorderState, recorderCode, recorderExports, recorderHeader } = require('./recorder');

const app = express();

// Rough country-code -> sensible-default-locale lookup for the "Detect
// location from proxy" feature (see /api/detect-location below). Not
// authoritative -- several countries genuinely have multiple official
// languages and there's no single "correct" answer -- just a reasonable
// starting point the person can override if it doesn't fit.
const LOCALE_BY_COUNTRY = {
  VN: 'vi-VN', US: 'en-US', GB: 'en-GB', CA: 'en-CA', AU: 'en-AU', NZ: 'en-NZ',
  JP: 'ja-JP', KR: 'ko-KR', CN: 'zh-CN', TW: 'zh-TW', HK: 'zh-HK',
  DE: 'de-DE', AT: 'de-AT', CH: 'de-CH', FR: 'fr-FR', ES: 'es-ES', IT: 'it-IT',
  PT: 'pt-PT', BR: 'pt-BR', MX: 'es-MX', AR: 'es-AR', RU: 'ru-RU',
  IN: 'en-IN', ID: 'id-ID', TH: 'th-TH', PH: 'en-PH', MY: 'ms-MY', SG: 'en-SG',
  NL: 'nl-NL', BE: 'nl-BE', SE: 'sv-SE', NO: 'nb-NO', DK: 'da-DK', FI: 'fi-FI',
  PL: 'pl-PL', UA: 'uk-UA', TR: 'tr-TR', SA: 'ar-SA', AE: 'ar-AE', IL: 'he-IL',
  EG: 'ar-EG', ZA: 'en-ZA', GR: 'el-GR', CZ: 'cs-CZ', RO: 'ro-RO', HU: 'hu-HU',
};
const PORT = process.env.PORT || 3000;

// --- tiny .env loader -----------------------------------------------
// Hand-rolled on purpose (a real KEY=value parser is ~10 lines, not
// worth a dependency for). Reads .env once at startup into process.env.
// This is Part V, chapter 3 from the learning roadmap ("process object,
// environment variables") -- .env is just a file-based way to set them
// without exporting anything in your actual shell.
const ENV_FILE = path.join(__dirname, '.env');
const FROM_DOTENV = new Set(); // biến lấy từ .env (machines.json thắng được) -- biến đặt thẳng khi chạy lệnh (DATA_DIR=... npm start) thì không
if (fs.existsSync(ENV_FILE)) {
  fs.readFileSync(ENV_FILE, 'utf-8').split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^(["'])(.*)\1$/, '$2'); // KEY="giá trị" (kiểu .env.example) -> bỏ dấu ngoặc
    if (!(key in process.env)) { process.env[key] = value; FROM_DOTENV.add(key); }
  });
}

// machines.json (CÓ trong git -- 3 máy dùng chung 1 repo, mỗi máy 1 folder profile): cấu hình riêng từng máy theo TÊN MÁY (os.hostname(),
// không phân biệt hoa thường), VD { "PC-NHA": { "DATA_DIR": "..\\Profile", "CHROME_PATH": "..\\GoogleChromePortable\\App\\Chrome-bin\\chrome.exe" } }.
// Pull về máy nào cũng tự lấy đúng cấu hình của máy đó. machines.json THẮNG .env với mục nó ghi (Settings / .env cũ hay còn sót DATA_DIR
// trỏ về data\ -- không được để nó lấn cấu hình theo máy); mục machines.json không ghi thì vẫn lấy ở .env.
const MACHINE = os.hostname();
let MACHINE_CONFIG = null;
try {
  const all = JSON.parse(fs.readFileSync(path.join(__dirname, 'machines.json'), 'utf-8'));
  // không có mục đúng tên máy -> dùng mục "*" (mặc định cho mọi máy khác)
  const mine = Object.entries(all || {}).find(([k]) => k.toLowerCase() === MACHINE.toLowerCase()) || (all && all['*'] ? ['*', all['*']] : null);
  if (mine && mine[1] && typeof mine[1] === 'object') {
    MACHINE_CONFIG = { ...mine[1], key: mine[0] };
    for (const [k, v] of Object.entries(mine[1])) if (k !== 'key' && v != null && String(v).trim() !== '' && (!(k in process.env) || FROM_DOTENV.has(k))) process.env[k] = String(v).trim();
  }
} catch (err) { if (err.code !== 'ENOENT') console.warn(`machines.json lỗi, bỏ qua: ${err.message}`); }
console.log(`Máy này: ${MACHINE}${!MACHINE_CONFIG ? ' (chưa có trong machines.json)' : MACHINE_CONFIG.key === '*' ? ' -- dùng mục mặc định "*" trong machines.json' : ' -- dùng cấu hình trong machines.json'}`);
// DATA_DIR tương đối (..\\Profile) tính từ thư mục project -- ghi lại đường dẫn đầy đủ vào process.env để scripts/datapaths.js đọc cùng 1 chỗ
if (process.env.DATA_DIR && process.env.DATA_DIR.trim()) process.env.DATA_DIR = path.resolve(__dirname, process.env.DATA_DIR.trim());

// THE global override you asked for. When this is set, EVERY profile
// launches with this exact Chrome build -- full stop, no per-profile
// engineMode is even consulted. Set it once in .env (see .env.example),
// never think about it again.
//
// If CHROME_PATH ISN'T set, try to find it automatically instead of
// just giving up -- this project's own convention (see .env.example)
// is a GoogleChromePortable folder sitting as a SIBLING of this project
// folder (…\PROJECT\profile-manager and …\PROJECT\GoogleChromePortable
// side by side). Resolving that relative to __dirname, instead of
// requiring a hardcoded absolute C:\Users\<name>\... path in .env,
// means this keeps working unmodified across different machines or
// Windows user accounts with the same PROJECT folder copied onto them
// -- no per-machine .env edit needed. An explicit CHROME_PATH in .env
// still always wins over this guess.
// Dò tối đa 4 cấp thư mục cha (không chỉ đúng 1 cấp như trước) -- lúc
// đầu profile-manager và GoogleChromePortable nằm ngang hàng nhau
// (1 cấp), nhưng sau khi nhét profile-manager vào 1 folder con "_main"
// mà KHÔNG dời GoogleChromePortable theo, khoảng cách giữa 2 thư mục
// giờ là 2 cấp (_main/profile-manager -> lên 1 là _main -> lên 2 mới
// tới chỗ GoogleChromePortable nằm). Dò rộng ra vài cấp như vầy để lần
// tái cấu trúc SAU (nếu có) cũng tự nhận ra được, không phải quay lại
// sửa .env mỗi lần đổi cấu trúc thư mục.
// Brave portable (thư mục brave-v<phiên bản>-win32-x64 chứa brave.exe, nằm CẠNH project) được ưu tiên trước GoogleChromePortable.
// Có nhiều bản Brave cạnh nhau thì lấy bản số phiên bản cao nhất -- cập nhật Brave chỉ cần giải nén bản mới cạnh bản cũ, không sửa .env.
function autoDetectPortableBrave(dir) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => /^brave(-v[\d.]+.*)?$/i.test(n)); } catch { return ''; }
  const ver = (n) => ((n.match(/v(\d+(?:\.\d+)*)/i) || [, '0'])[1]).split('.').map(Number);
  names.sort((a, b) => { const x = ver(a), y = ver(b); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((y[i] || 0) !== (x[i] || 0)) return (y[i] || 0) - (x[i] || 0); return 0; });
  for (const n of names) { const exe = path.join(dir, n, 'brave.exe'); if (fs.existsSync(exe)) return exe; }
  return '';
}
function autoDetectPortableChrome() {
  for (let levelsUp = 1; levelsUp <= 4; levelsUp++) {
    const dir = path.join(__dirname, ...Array(levelsUp).fill('..'));
    const brave = autoDetectPortableBrave(dir);
    if (brave) return brave;
    const guess = path.join(dir, 'GoogleChromePortable', 'App', 'Chrome-bin', 'chrome.exe');
    if (fs.existsSync(guess)) return guess;
  }
  return '';
}
// resolveChromePath: bỏ dấu ngoặc kép, trỏ vào thư mục / GoogleChromePortable.exe -> tự tìm chrome.exe bên trong (xem chrome-version-check.js)
const CHROME_PATH = resolveChromePath(process.env.CHROME_PATH) || autoDetectPortableChrome();

// Bật/tắt qua Settings panel (gear icon, topbar) -- xem
// clearProfileCache()/CACHE_ONLY_DIR_NAMES phía dưới để biết chính xác
// những gì bị xoá (chỉ cache, không đụng cookie/session). Đọc 1 lần lúc
// khởi động, giống CHROME_PATH/DATA_DIR -- lưu ở Settings xong vẫn cần
// khởi động lại server mới áp dụng.
const AUTO_CLEAR_CACHE_AFTER_RUN = /^(1|true|yes)$/i.test(process.env.AUTO_CLEAR_CACHE_AFTER_RUN || '');

// DATA_DIR defaults to ./data (next to this file) but can be pointed
// anywhere via DATA_DIR in .env -- see the Settings panel (gear icon,
// topbar), which writes that line for you. Changing it does NOT move
// any existing profiles.json / profiles/ folder already there -- copy
// the old `data` folder to the new location yourself first if you want
// to keep what's in it. Also requires a full restart (stop with
// Ctrl+C, `npm start` again) -- this, like CHROME_PATH, is read ONCE
// into a const at startup, not re-read while running.
//
// If DATA_DIR ISN'T set, check for a `Profile` folder sitting as a
// SIBLING of this project (…\PROJECT\profile-manager and …\PROJECT\
// Profile side by side) before falling back to the bundled ./data --
// same portable-across-machines reasoning as CHROME_PATH above. Only
// counts if profiles.json is actually already in there (real,
// established data), so a machine that's never had that sibling folder
// doesn't get treated as if its data went missing -- it just uses the
// bundled ./data folder, same as if DATA_DIR had never existed at all.
function autoDetectDataDir() {
  const sibling = path.join(__dirname, '..', 'Profile');
  return fs.existsSync(path.join(sibling, 'profiles.json')) ? sibling : path.join(__dirname, 'data');
}
const DATA_DIR = process.env.DATA_DIR || autoDetectDataDir();
console.log(`Folder profile: ${DATA_DIR} (${MACHINE_CONFIG && MACHINE_CONFIG.DATA_DIR && process.env.DATA_DIR === path.resolve(__dirname, String(MACHINE_CONFIG.DATA_DIR).trim()) ? 'machines.json' : process.env.DATA_DIR ? (FROM_DOTENV.has('DATA_DIR') ? '.env' : 'biến môi trường lúc chạy') : 'mặc định'})`);
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');
const PROFILES_ROOT = path.join(DATA_DIR, 'profiles'); // one sub-folder per profile = one persistent browser profile
const SCRIPTS_DIR = path.join(__dirname, 'scripts'); // your own helper .js files live here
// User-defined "insert at cursor" quick-snippet buttons shown above the
// editor's tab bar -- see the /api/snippets routes below. Kept as its
// own small JSON file (same one-array-of-objects shape as profiles.json)
// rather than folded into profiles.json or scripts/, since snippets
// aren't profile data and aren't runnable script files of their own.
const SNIPPETS_FILE = path.join(DATA_DIR, 'snippets.json');

// --- make sure our data folders exist on first run ---
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(PROFILES_ROOT, { recursive: true }); // <folder profile>\profiles -- chưa có thì tạo luôn (máy mới, folder Profile chưa từng dùng)
if (!fs.existsSync(PROFILES_ROOT)) fs.mkdirSync(PROFILES_ROOT, { recursive: true });
if (!fs.existsSync(PROFILES_FILE)) fs.writeFileSync(PROFILES_FILE, '[]');
if (!fs.existsSync(SCRIPTS_DIR)) fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
if (!fs.existsSync(SNIPPETS_FILE)) fs.writeFileSync(SNIPPETS_FILE, '[]');

// scripts/cleanupDebugFiles.js was already written for exactly this (see
// its own top comment) but nothing ever actually required/called it --
// login-debug-*.png / link-x-debug-*.png / etc. from scripts like
// Logintaskon.js have been piling up in DATA_DIR unbounded ever since.
// Real require() (not scopedRequire -- that's only for user-picked "main"
// scripts run via the Run modal), same one-shot-at-startup pattern as the
// Chrome version check below. Keeps the last 7 days; safe no-op if the
// module is missing or DATA_DIR has nothing matching yet.
try {
  const { cleanupOldDebugFiles } = require('./scripts/cleanupDebugFiles');
  const cleanup = cleanupOldDebugFiles(DATA_DIR, 7);
  if (cleanup.deleted > 0) {
    console.log(`Cleaned up ${cleanup.deleted} old debug screenshot(s), freed ${(cleanup.freedBytes / 1024 / 1024).toFixed(1)} MB`);
  }
  cleanup.errors.forEach((e) => console.warn(`Debug cleanup: ${e}`));
} catch (err) {
  console.warn(`Debug file cleanup skipped: ${err.message}`);
}

// A short helper with a message + HTTP status, so route handlers can just
// `catch (err) { res.status(err.status || 500).json({ error: err.message }) }`
// instead of re-deriving a status code at every throw site.
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// The `require` given to pasted scripts. For files inside scripts/, it's
// Node's real require() -- modules you write use normal `module.exports`,
// no special API -- resolved only inside that folder, cache cleared on
// every call so edits take effect immediately without restarting the
// server. Additionally allows a short, explicit list of built-in/
// installed modules by name, exactly like requiring them in any normal
// Node project -- no wrapper API to learn for these.
const ALLOWED_BUILTIN_MODULES = ['fs', 'path', 'crypto', '@e965/xlsx'];

function scopedRequire(modulePath) {
  if (ALLOWED_BUILTIN_MODULES.includes(modulePath)) {
    return require(modulePath);
  }
  const resolved = path.resolve(SCRIPTS_DIR, modulePath);
  if (!resolved.startsWith(SCRIPTS_DIR + path.sep) && resolved !== SCRIPTS_DIR) {
    throw new Error(
      `require() in a script can only load files inside scripts/, or one of: ${ALLOWED_BUILTIN_MODULES.join(', ')} (got "${modulePath}")`
    );
  }
  const resolvedFile = require.resolve(resolved);
  delete require.cache[resolvedFile];
  return require(resolvedFile);
}

// scopedRequire() above only busts the Node require cache for whichever
// ONE file it's asked for directly -- exactly the file main.js (or
// whatever script the Run modal picked) itself requires. The problem:
// once that file is actually loaded, ITS OWN require('./whatever')
// calls run through THAT module's native Node require, completely
// bypassing scopedRequire -- so anything a script requires INTERNALLY
// (helpers.js, xlv2_gotoProfile.js, xlv3_retweet_targettw.js, and so on,
// however many levels deep) stays cached from whenever it was FIRST
// loaded, for the rest of this server process's life, no matter how
// many times it's edited and saved afterward. In practice this looked
// like "editing main.js/interactX.js just works, editing anything they
// call into silently keeps running the old code" -- confusing, since
// which files "worked" depended on how deep they sat in the require
// graph, not on anything the person watching did differently.
//
// Fix: before every run, forget EVERY module currently cached from
// inside scripts/ -- not just the entry point -- so the WHOLE
// dependency tree reloads fresh off disk each time, regardless of
// nesting depth.
function clearScriptsRequireCache() {
  const prefix = SCRIPTS_DIR + path.sep;
  for (const cachedPath of Object.keys(require.cache)) {
    if (cachedPath.startsWith(prefix)) delete require.cache[cachedPath];
  }
}

// Giới hạn mặc định của express.json() là 100KB -- quá nhỏ cho snapshot
// toàn bộ sheet Excel nếu file có vài trăm dòng trở lên (dễ vượt 100KB).
// Vượt giới hạn thì Express trả lỗi 413 NGAY LẬP TỨC, trước khi chạy
// vào route -- và vì fetch() không coi mã lỗi HTTP là "thất bại mạng",
// .catch() phía client không bắt được, snapshot lặng lẽ không bao giờ
// được ghi, dù import lại bao nhiêu lần cũng ra kết quả y hệt -- xác
// nhận đúng nguyên nhân qua việc snapshot chưa từng tồn tại trên đĩa dù
// đã import nhiều lần. Tăng lên 50mb cho thoải mái (vẫn chỉ là JSON
// text, không phải file nhị phân, không tốn kém gì khi tăng).
app.use(express.json({ limit: '50mb' }));
// This is a local tool you'll keep editing (or patching), not a public
// site -- browser caching of app.js/editor.js/style.css only causes
// confusion here (you update a file, the browser keeps running the old
// one until a hard refresh). Disabled outright rather than tuned.
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// --- tiny JSON "database" helpers ---
function readProfiles() {
  return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf-8'));
}
function writeProfiles(profiles) {
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2));
}
function readSnippets() {
  return JSON.parse(fs.readFileSync(SNIPPETS_FILE, 'utf-8'));
}
function writeSnippets(snippets) {
  fs.writeFileSync(SNIPPETS_FILE, JSON.stringify(snippets, null, 2));
}

// Snippet thao tác mặc định (dùng scripts/xlv1_actions.js) -- nạp vào snippets.json 1 LẦN mỗi cái; id đã nạp ghi vào
// snippets_seeded.json nên bạn xoá nút nào thì nó không tự hiện lại. Thêm snippet mới vào list này = lần chạy server sau tự có nút.
const DEFAULT_SNIPPETS = [
  ['act_require', 'Actions: require', "const { useLog, isShown, waitEl, waitGone, waitAny, scrollEl, hoverEl, clickEl, typeEl, getText, pause, whileHandle, clickNewTab, closeOtherTabs, dblClickEl, rightClickEl, checkEl } = require('./xlv1_actions');\nuseLog(log);\n"],
  ['act_click', 'Click', "await clickEl(page.locator('SELECTOR'));\n"],
  ['act_type', 'Input', "await typeEl(page.locator('SELECTOR'), 'TEXT');\n"],
  ['act_type_enter', 'Input + Enter', "await typeEl(page.locator('SELECTOR'), 'TEXT', { enter: true });\n"],
  ['act_wait', 'Wait', "await waitEl(page.locator('SELECTOR'), 15000);\n"],
  ['act_wait_click', 'Wait → Click', "if (await waitEl(page.locator('SELECTOR'), 15000)) await clickEl(page.locator('SELECTOR'));\n"],
  ['act_wait_gone', 'Wait gone', "await waitGone(page.locator('SELECTOR'), 15000);\n"],
  ['act_if_shown', 'If shown', "if (await isShown(page.locator('SELECTOR'))) {\n  await clickEl(page.locator('SELECTOR'));\n}\n"],
  ['act_if_show_type', 'If shown → Input', "if (await isShown(page.locator('SELECTOR'))) {\n  await typeEl(page.locator('SELECTOR'), 'TEXT');\n}\n"],
  ['act_if_show_wait', 'If show (wait)', "if (await waitEl(page.locator('SELECTOR'), 5000)) {\n  await clickEl(page.locator('SELECTOR'));\n} else {\n  log('Không thấy SELECTOR');\n}\n"],
  ['act_if_else_show', 'If / else if show', "if (await isShown(page.locator('SELECTOR_A'))) {\n  await clickEl(page.locator('SELECTOR_A'));\n} else if (await isShown(page.locator('SELECTOR_B'))) {\n  await typeEl(page.locator('SELECTOR_B'), 'TEXT');\n} else {\n  log('Không thấy phần tử nào');\n}\n"],
  ['act_wait_any', 'Wait any', "const which = await waitAny([page.locator('SELECTOR_A'), page.locator('SELECTOR_B')], 30000);\nif (which === 0) {\n  // SELECTOR_A hiện ra trước\n} else if (which === 1) {\n  // SELECTOR_B hiện ra trước\n} else {\n  throw new Error('Không thấy phần tử nào');\n}\n"],
  ['act_hover', 'Hover', "await hoverEl(page.locator('SELECTOR'));\n"],
  ['act_scroll', 'Scroll to', "await scrollEl(page.locator('SELECTOR'));\n"],
  ['act_text', 'Get text', "const text = await getText(page.locator('SELECTOR'));\nlog('text: ' + text);\n"],
  ['act_click_tab', 'Click → tab mới', "const newTab = await clickNewTab(page.locator('SELECTOR')); // click rồi xem có mở tab mới không (null = không)\nif (newTab) {\n  // thao tác trên newTab, VD: await clickEl(newTab.locator('SELECTOR'));\n}\nawait closeOtherTabs(page); // đóng hết tab, chỉ giữ tab đầu tiên\n"],
  ['act_close_tabs', 'Close other tabs', "await closeOtherTabs(page); // đóng hết tab, chỉ giữ tab đầu tiên\n"],
  ['act_pause', 'Pause', "await pause(page, 800, 2000);\n"],
  ['act_while', 'While handle', "const res = await whileHandle([\n  { el: page.locator('POPUP_BUTTON'), click: true },\n  { el: page.locator('INPUT'), type: 'TEXT', enter: true },\n  { el: page.locator('ERROR_TEXT'), fail: 'Gặp lỗi' },\n  { el: page.locator('DONE_ELEMENT'), done: true },\n], { timeout: 60000 });\nif (!res.ok) throw new Error('whileHandle: ' + res.reason);\n"],
];
(function seedDefaultSnippets() {
  const seededFile = path.join(DATA_DIR, 'snippets_seeded.json');
  let seeded = [];
  try { seeded = JSON.parse(fs.readFileSync(seededFile, 'utf-8')); } catch {}
  const fresh = DEFAULT_SNIPPETS.filter(([id]) => !seeded.includes(id));
  if (!fresh.length) return;
  const snippets = readSnippets();
  for (const [id, name, code] of fresh) if (!snippets.some((s) => s.id === 'snippet_' + id)) snippets.push({ id: 'snippet_' + id, name, code });
  writeSnippets(snippets);
  fs.writeFileSync(seededFile, JSON.stringify([...seeded, ...fresh.map(([id]) => id)], null, 2));
})();

// Keep track of which profiles currently have a live browser window open.
// Key = profile id, value = { context, page } for that live session.
// This lives in memory only (resets if you restart the server).
const runningContexts = {};

// -------------------------------------------------------------------
// API: list all profiles (with live running/stopped status merged in)
// -------------------------------------------------------------------
app.get('/api/profiles', (req, res) => {
  const profiles = readProfiles();
  const withStatus = profiles.map((p) => ({
    ...p,
    running: Boolean(runningContexts[p.id]),
    // What will ACTUALLY launch, not just what's stored -- if CHROME_PATH
    // is set globally it overrides this profile's own engineMode, so the
    // UI should say so rather than show a label that would be a lie.
    effectiveEngineMode: CHROME_PATH ? 'chrome-portable-global' : p.engineMode,
    dataPath: path.join(PROFILES_ROOT, p.id), // folder trình duyệt của profile -- nút 📁 ở Home
  }));
  res.json(withStatus);
});

// 📁 ở Home: mở folder của profile bằng trình quản lý file của máy (Windows Explorer / Finder / xdg-open). Chưa có folder (chưa Launch lần nào)
// thì tạo trống để vẫn mở được.
app.post('/api/profiles/:id/open-folder', (req, res) => {
  if (!readProfiles().some((p) => p.id === req.params.id)) return res.status(404).json({ error: 'Không thấy profile' });
  const dir = path.join(PROFILES_ROOT, req.params.id);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const [cmd, args] = process.platform === 'win32' ? ['explorer.exe', [dir]] : process.platform === 'darwin' ? ['open', [dir]] : ['xdg-open', [dir]];
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', () => {}); child.unref();
    res.json({ ok: true, path: dir });
  } catch (err) { res.status(500).json({ error: `Không mở được folder ${dir}: ${err.message}`, path: dir }); }
});

// -------------------------------------------------------------------
// API: tell the frontend whether a global Chrome path is configured, so
// it can hide the per-profile engine picker instead of offering a choice
// that would be silently overridden anyway.
// -------------------------------------------------------------------
app.get('/api/config', (req, res) => {
  res.json({ chromePathConfigured: Boolean(CHROME_PATH) });
});

// -------------------------------------------------------------------
// Settings (gear icon, topbar) -- reads/writes .env directly, the same
// file you'd otherwise be hand-editing for CHROME_PATH. Both settings
// here are read into a `const` once at startup (see their definitions
// above), so saving here writes the new line but does NOT apply it to
// the currently-running process -- every response below says so, and
// the panel repeats it, so this doesn't turn into the same "why isn't
// my change showing up" confusion a plain file edit could also cause.
// -------------------------------------------------------------------
function writeEnvValues(updates) {
  const lines = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf-8').split('\n') : [];
  const remainingKeys = new Set(Object.keys(updates));

  const rewritten = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return line;
    const key = trimmed.slice(0, eq).trim();
    if (!updates.hasOwnProperty(key)) return line;
    remainingKeys.delete(key);
    return `${key}=${updates[key]}`;
  });

  // Any key that wasn't already a line in .env gets appended as a new one.
  for (const key of remainingKeys) {
    if (rewritten.length && rewritten[rewritten.length - 1].trim() !== '') rewritten.push('');
    rewritten.push(`${key}=${updates[key]}`);
  }

  fs.writeFileSync(ENV_FILE, rewritten.join('\n'));
}

app.get('/api/settings', (req, res) => {
  res.json({ dataDir: DATA_DIR, chromePath: CHROME_PATH, autoClearCacheAfterRun: AUTO_CLEAR_CACHE_AFTER_RUN, machine: MACHINE, machineConfig: MACHINE_CONFIG });
});

app.post('/api/settings', (req, res) => {
  const { dataDir, chromePath, autoClearCacheAfterRun } = req.body;
  const updates = {};
  if (typeof dataDir === 'string') updates.DATA_DIR = dataDir.trim();
  if (typeof chromePath === 'string') updates.CHROME_PATH = chromePath.trim();
  if (typeof autoClearCacheAfterRun === 'boolean') updates.AUTO_CLEAR_CACHE_AFTER_RUN = autoClearCacheAfterRun ? 'true' : 'false';
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nothing to update' });

  try {
    writeEnvValues(updates);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `Couldn't write .env: ${err.message}` });
  }
});

// -------------------------------------------------------------------
// Script FILE management -- the backend for the tabbed multi-file editor
// at /editor. Each helper "tab" in that UI is a real .js file here in
// scripts/, so anything saved through the editor is immediately
// require()-able from any running script (manual Run, or the Queue's
// auto-run field) -- same folder, same scopedRequire() as always.
// -------------------------------------------------------------------
function validScriptFilename(name) {
  // letters/digits/dash/underscore + .js, no path separators or "..".
  // Deliberately stricter than scopedRequire's boundary check (which
  // just resolves-and-compares) because these routes also WRITE and
  // DELETE files, where a permissive filename is a much bigger foot-gun.
  return /^[a-zA-Z0-9_-]+\.js$/.test(name);
}

// list filenames only (for the editor's "open an existing file" picker)
app.get('/api/scripts', (req, res) => {
  const files = fs.readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith('.js'));
  res.json(files);
});

// read one file's content (for opening it as a tab)
app.get('/api/scripts/:name', (req, res) => {
  if (!validScriptFilename(req.params.name)) return res.status(400).json({ error: 'Invalid filename' });
  const filePath = path.join(SCRIPTS_DIR, req.params.name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.json({ name: req.params.name, code: fs.readFileSync(filePath, 'utf-8') });
});

// create or overwrite a file's content (autosave target while editing a tab)
app.put('/api/scripts/:name', (req, res) => {
  if (!validScriptFilename(req.params.name)) return res.status(400).json({ error: 'Invalid filename' });
  fs.writeFileSync(path.join(SCRIPTS_DIR, req.params.name), req.body.code || '');
  res.json({ success: true });
});

// permanently delete a helper file (distinct from just closing its tab,
// which leaves the file alone -- this is the "actually remove it" action)
app.delete('/api/scripts/:name', (req, res) => {
  if (!validScriptFilename(req.params.name)) return res.status(400).json({ error: 'Invalid filename' });
  if (req.params.name === 'helpers.js') return res.status(400).json({ error: "helpers.js ships as the example -- rename your own file instead of deleting it" });
  if (req.params.name === 'main.js') return res.status(400).json({ error: "main.js là file chạy mặc định của queue -- không xoá được, chỉ xoá nội dung bên trong" });
  const filePath = path.join(SCRIPTS_DIR, req.params.name);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  res.json({ success: true });
});

// -------------------------------------------------------------------
// Quick-snippet buttons above the editor's tab bar: press one, its code
// drops in at wherever your cursor currently is in the active file --
// see editor.js's insertSnippetAtCursor(). Deliberately just a flat
// list of {id, name, code}, same shape/persistence pattern as
// profiles.json -- no folders, no ordering beyond insertion order, kept
// as simple as the feature itself is.
// -------------------------------------------------------------------
app.get('/api/snippets', (req, res) => {
  res.json(readSnippets());
});

app.post('/api/snippets', (req, res) => {
  const { name, code } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  const snippets = readSnippets();
  const snippet = {
    id: 'snippet_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    name: name.trim(),
    code: code || '',
  };
  snippets.push(snippet);
  writeSnippets(snippets);
  res.json(snippet);
});

app.put('/api/snippets/:id', (req, res) => {
  const snippets = readSnippets();
  const snippet = snippets.find((s) => s.id === req.params.id);
  if (!snippet) return res.status(404).json({ error: 'Snippet not found' });
  const { name, code } = req.body;
  if (typeof name === 'string' && name.trim()) snippet.name = name.trim();
  if (typeof code === 'string') snippet.code = code;
  writeSnippets(snippets);
  res.json(snippet);
});

app.delete('/api/snippets/:id', (req, res) => {
  const snippets = readSnippets();
  const next = snippets.filter((s) => s.id !== req.params.id);
  writeSnippets(next);
  res.json({ success: true });
});

// -------------------------------------------------------------------
// "Open in VS Code" -- launches the REAL VS Code app on this machine,
// with its Open Folder pointed at this project's own root (__dirname:
// the folder server.js itself lives in, same level as scripts/ and
// public/) so scripts/, package.json, etc. all show up in one workspace
// exactly like opening it by hand via File > Open Folder would.
//
// Runs through a shell (exec, not execFile) specifically because VS
// Code's own CLI is a `code.cmd` shim on Windows -- a plain child-process
// launch without a shell can't execute a .cmd file at all, only exec's
// shell-wrapped form reliably works across Windows/macOS/Linux here.
// Quoting the path handles folders with spaces in them (e.g. "My
// Projects") on both cmd.exe and POSIX shells.
// -------------------------------------------------------------------
app.post('/api/open-in-vscode', (req, res) => {
  const projectRoot = __dirname;
  exec(`code "${projectRoot}"`, (err) => {
    if (err) {
      // By far the most common cause: the "code" command isn't on PATH.
      // That's a one-time setup step inside VS Code itself (Command
      // Palette -> "Shell Command: Install 'code' command in PATH"),
      // not something this server can fix for you -- send back the
      // folder path too so you can at least open it by hand
      // (File > Open Folder) in the meantime.
      return res.status(500).json({
        error: `Couldn't launch VS Code (${err.message}). Make sure the "code" command is installed on your PATH (VS Code's Command Palette \u2192 "Shell Command: Install 'code' command in PATH"), or open this folder manually instead:`,
        path: projectRoot,
      });
    }
    res.json({ success: true, path: projectRoot });
  });
});

// -------------------------------------------------------------------
// Nút "Reset Done Task" trên trang editor: xem / xoá bộ đánh dấu task đã xong của interactX (data/home-browse/*.json, xem
// scripts/xlv1_homeBrowseCounter.js). Xoá xong thì lần chạy sau mọi task đều được coi là chưa làm.
// -------------------------------------------------------------------
app.get('/api/home-tasks', (req, res) => {
  try { res.json(require('./scripts/xlv1_homeBrowseCounter').summarizeAllTasks()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
// Nút "Update Task State": đọc danh sách task ĐANG có trong code (dòng `const functions = [...]` trong runRandom của
// scripts/xlv3_Interactx.js, bỏ qua dòng đã comment) rồi gộp với đánh dấu đã lưu -> từng tài khoản (cột D Excel + các tài khoản đã có đánh dấu)
// còn thiếu task nào / Done toàn bộ. Chỉ đọc, không ghi gì -- lúc chạy interactX cũng tự gộp đúng như vậy, nút này chỉ để xem.
app.get('/api/home-tasks/state', (req, res) => {
  try {
    const file = path.join(__dirname, 'scripts', 'xlv3_Interactx.js');
    const m = fs.readFileSync(file, 'utf-8').match(/^\s*const functions\s*=\s*\[([^\]]*)\]/m);
    if (!m) return res.status(400).json({ error: 'Không tìm thấy dòng "const functions = [...]" trong scripts/xlv3_Interactx.js' });
    const tasks = m[1].split(',').map((s) => s.trim()).filter((s) => /^[\w$]+$/.test(s));
    let usernames = [];
    try { usernames = JSON.parse(fs.readFileSync(EXCEL_SNAPSHOT_FILE, 'utf-8')).map((r) => r && r.D); } catch (e) {}
    res.json({ tasks, accounts: require('./scripts/xlv1_homeBrowseCounter').taskStateAll(tasks, usernames) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/home-tasks/reset', (req, res) => {
  try { res.json({ success: true, ...require('./scripts/xlv1_homeBrowseCounter').resetAllTasks() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// -------------------------------------------------------------------
// Trang đo thao tác THẬT (public/input-test.html): con lăn chuột / touchpad / di chuột + click / bàn phím trên máy này -> số liệu dùng để
// chỉnh bộ giả lập cho khớp thiết bị thật. Chỉ lưu file vào <DATA_DIR>/input-test/ trên máy, không gửi đi đâu.
// -------------------------------------------------------------------
app.get('/input-test', (req, res) => res.sendFile(path.join(__dirname, 'public', 'input-test.html')));
app.post('/api/input-test', (req, res) => {
  try {
    const dir = path.join(DATA_DIR, 'input-test');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `input-test-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify(req.body));
    res.json({ success: true, file });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// -------------------------------------------------------------------
// The standalone full-page script editor (separate from the dashboard's
// cramped panel). Same origin/port as everything else -- see README
// section 5 for why a second port wasn't worth it.
// -------------------------------------------------------------------
app.get('/editor', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'editor.html'));
});

// -------------------------------------------------------------------
// Excel snapshot: the parsed .xlsx (all rows, from public/xlsx-worker.js)
// only ever lives in the BROWSER's memory -- it's never uploaded as a
// file, only matched against profile names client-side (see
// recomputeExcelMatches() in editor.js) and reduced down to one row per
// profile before being sent as `input`. That's fine for a script that
// only needs its OWN row, but a script can't look at a DIFFERENT row
// (e.g. "current row + 2, column C") from just its own `input` -- there
// is nothing else on disk to read.
//
// This endpoint is editor.js's way of also dropping the FULL parsed
// sheet on disk once, right after import, so any script (running in its
// own separate process -- see main.js's flow) can `require('fs')` +
// `require('./dataPaths')` and read sibling rows itself. Overwritten on
// every import; this is a snapshot of "the last file you imported", not
// a history.
// -------------------------------------------------------------------
const EXCEL_SNAPSHOT_FILE = path.join(DATA_DIR, 'excel-snapshot.json');

app.post('/api/excel-snapshot', (req, res) => {
  const { rows, headerLabels } = req.body;
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows must be an array' });
  fs.writeFileSync(EXCEL_SNAPSHOT_FILE, JSON.stringify(rows));
  // Dòng tiêu đề gốc -- để excel-results.xlsx giữ đúng tên cột (xem EXCEL_HEADER_FILE trong scripts/datapaths.js)
  if (headerLabels && typeof headerLabels === 'object') fs.writeFileSync(path.join(DATA_DIR, 'excel-snapshot-header.json'), JSON.stringify(headerLabels));
  res.json({ success: true, rowCount: rows.length });
});

// -------------------------------------------------------------------
// Nguồn dữ liệu THỨ HAI, song song với Excel ở trên -- KHÔNG đụng tới
// EXCEL_SNAPSHOT_FILE. Kéo trực tiếp 1 Google Sheet (riêng tư, qua
// Service Account) về và lưu thành snapshot riêng -- xem
// scripts/syncGoogleSheet.js cho chi tiết format/xác thực.
// Lỗi thường gặp nhất ở đây là lỗi mạng/xác thực (chưa share Sheet cho
// đúng email Service Account, chưa bật Sheets API, key sai...) -- trả
// thẳng err.message cho giao diện hiện ra, không cần tự đoán.
// -------------------------------------------------------------------
app.post('/api/google-sheet-sync', async (req, res) => {
  const { spreadsheetId, sheetName } = req.body;
  if (!spreadsheetId) return res.status(400).json({ error: 'spreadsheetId is required' });
  try {
    const { syncGoogleSheetToSnapshot } = require('./scripts/syncGoogleSheet');
    const result = await syncGoogleSheetToSnapshot(spreadsheetId, sheetName);
    res.json({ success: true, rowCount: result.rowCount, sheetName: result.sheetName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------------
// Builds a profile object from raw input fields, applying the same
// defaults everywhere. Shared by single-create and bulk-create so the
// two can never drift apart on what a "default" profile looks like.
// -------------------------------------------------------------------
// Normalizes the "extensionPaths" field into a clean string[] of local
// folder paths, one per unpacked extension. Accepts either a real array
// (JSON import, or the dedicated POST /extensions endpoint below) or a
// newline/comma-separated string -- which is what the create forms'
// plain <textarea> actually submits, since HTML has no "multi-value
// field" for this without extra JS wiring.
function normalizeExtensionPaths(input) {
  if (!input) return [];
  const raw = Array.isArray(input) ? input : String(input).split(/[\r\n,]+/);
  return raw.map((p) => (p || '').toString().trim()).filter(Boolean);
}

// -------------------------------------------------------------------
// Danh sách extension TOÀN CỤC -- áp dụng cho MỌI profile, cấu hình 1
// lần ở trang chủ (khác với ô "Extension folders" lúc tạo/sửa từng
// profile riêng, cái đó vẫn còn và được GỘP CHUNG với danh sách này lúc
// launch, xem launchProfileById). Lưu trong data/, KHÔNG lưu trong
// .env như Settings panel (dataDir/chromePath) -- vì.env chỉ đọc 1 lần
// lúc server khởi động (đổi xong phải restart cả server mới có hiệu
// lực), còn danh sách này cần đọc LẠI MỖI LẦN launch 1 profile, để đổi
// xong chỉ cần khởi động lại ĐÚNG profile đó là thấy hiệu lực ngay,
// không cần restart cả server.
// -------------------------------------------------------------------
const GLOBAL_EXTENSIONS_FILE = path.join(DATA_DIR, 'global-extensions.json');

function readGlobalExtensionPaths() {
  if (!fs.existsSync(GLOBAL_EXTENSIONS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(GLOBAL_EXTENSIONS_FILE, 'utf-8'));
  } catch {
    return []; // file lỗi/hỏng -- coi như chưa cấu hình gì, không làm sập launch vì việc này
  }
}

app.get('/api/global-extensions', (req, res) => {
  res.json({ extensionPaths: readGlobalExtensionPaths() });
});

app.post('/api/global-extensions', (req, res) => {
  const extensionPaths = normalizeExtensionPaths(req.body.extensionPaths);
  fs.writeFileSync(GLOBAL_EXTENSIONS_FILE, JSON.stringify(extensionPaths));
  res.json({ extensionPaths });
});

// -------------------------------------------------------------------
// Cài đặt chụp màn hình (thư mục lưu / tiền tố / hậu tố tên file) -- nhập ở
// ô "Chụp màn hình" trên trang editor, scripts/xlv2_getScreenShot.js đọc lại
// file này MỖI LẦN gọi (nên đổi xong không cần restart). defaultDir PHẢI
// khớp DEFAULT_DIR trong xlv2_getScreenShot.js (dùng khi ô thư mục để trống).
// -------------------------------------------------------------------
const SCREENSHOT_SETTINGS_FILE = path.join(DATA_DIR, 'screenshot-settings.json');
const SCREENSHOT_DEFAULT_DIR = path.join(DATA_DIR, 'screenshot', 'kleverWallet');

function readScreenshotSettings() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(SCREENSHOT_SETTINGS_FILE, 'utf-8')) || {}; } catch { /* chưa cấu hình / file hỏng -- coi như trống */ }
  return { dir: String(s.dir || '').trim(), prefix: String(s.prefix || ''), suffix: String(s.suffix || '') };
}

app.get('/api/screenshot-settings', (req, res) => {
  res.json({ ...readScreenshotSettings(), defaultDir: SCREENSHOT_DEFAULT_DIR });
});

app.post('/api/screenshot-settings', (req, res) => {
  const { dir, prefix, suffix } = req.body || {};
  const settings = { dir: String(dir || '').trim(), prefix: String(prefix || ''), suffix: String(suffix || '') };
  fs.writeFileSync(SCREENSHOT_SETTINGS_FILE, JSON.stringify(settings));
  res.json({ ...settings, defaultDir: SCREENSHOT_DEFAULT_DIR });
});

// -------------------------------------------------------------------
// DANH SÁCH PROXY DÙNG CHUNG cho hàng đợi Run (ô "Danh sách proxy" trên
// trang editor). Có danh sách -> mỗi profile hàng đợi mở ra được GÁN TẠM 1
// proxy trong danh sách (proxy đang ít profile dùng nhất, còn dưới "Max per
// proxy"), BỎ QUA proxy riêng trong profiles.json (không ghi đè gì vào đó).
// Danh sách trống -> chạy y như cũ (mỗi profile dùng proxy riêng).
//
// Mỗi dòng: host:port:user:pass|link reset  (link reset tuỳ chọn, cách bằng
// "|" hoặc dấu cách; thiếu thì changeProxy tự tra bảng có sẵn trong
// xlv1_changeProxy.js). Dòng trống / bắt đầu bằng # bị bỏ qua.
//
// Đọc LẠI file mỗi lần fillQueue() chọn proxy -> sửa danh sách lúc đang chạy
// (2 -> 1, 2 -> 3...) có hiệu lực ngay cho các profile mở SAU đó; profile
// đang chạy giữ nguyên proxy đã gán tới khi đóng (kể cả các lần retry).
// -------------------------------------------------------------------
const PROXY_POOL_FILE = path.join(DATA_DIR, 'proxy-pool.json');

// -> { proxies: [{ key, proxyServer, proxyUsername, proxyPassword, resetUrl, label }], warnings: [string] }
function parseProxyPoolText(text) {
  const proxies = [];
  const warnings = [];
  const seen = new Set();
  String(text || '').split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const n = idx + 1;
    // Tách proxy / link reset: link là đoạn bắt đầu bằng http(s)://, ngăn với proxy bằng ĐÚNG 1 dấu "-" hoặc "|" (có/không dấu cách quanh nó) hoặc dấu cách, link có thể nằm trong ngoặc kép.
    // Không tách theo mọi dấu "-" vì host/user/link đều có "-" (sp07v2-01..., sp07v2-37100, .../37100-BAGUSQLGWK).
    // VD: host:port:user:pass-"https://..."  |  host:port:user:pass-https://...  |  host:port:user:pass|https://...  |  host:port:user:pass https://...
    const m = line.match(/^(.+?)(?:\s*[|-]\s*|\s+)["']?(https?:\/\/[^"'\s]+)["']?$/i);
    const proxyPart = (m ? m[1] : line).trim().replace(/^["']|["']$/g, '');
    const resetUrl = m ? m[2] : (/https?:\/\//i.test(line) ? 'INVALID' : '');
    if (resetUrl === 'INVALID') { warnings.push(`Dòng ${n}: không tách được proxy và link reset (mẫu: host:port:user:pass-"https://...") -- bỏ qua dòng này.`); return; }
    const parts = proxyPart.split(':');
    if (!(parts.length === 2 || parts.length === 4) || parts.some((p) => !p.trim()) || !/^\d+$/.test(parts[1])) {
      warnings.push(`Dòng ${n}: sai định dạng (cần host:port hoặc host:port:user:pass) -- bỏ qua dòng này.`);
      return;
    }
    if (resetUrl && !/^https?:\/\//i.test(resetUrl)) {
      warnings.push(`Dòng ${n}: link reset phải bắt đầu bằng http:// hoặc https:// -- bỏ qua dòng này.`);
      return;
    }
    const { proxyServer, proxyUsername, proxyPassword } = parseProxyLine(proxyPart);
    const key = `${proxyServer}|${proxyUsername}`;
    if (seen.has(key)) { warnings.push(`Dòng ${n}: trùng proxy đã có ở dòng trên -- bỏ qua dòng này.`); return; }
    seen.add(key);
    if (!resetUrl) warnings.push(`Dòng ${n}: không có link reset -- changeProxy sẽ tra bảng trong xlv1_changeProxy.js (proxy chưa có trong bảng sẽ báo lỗi khi chạy).`);
    proxies.push({ key, proxyServer, proxyUsername, proxyPassword, resetUrl, label: `${parts[0]}:${parts[1]}` });
  });
  return { proxies, warnings };
}

function readProxyPoolText() {
  try { return String(JSON.parse(fs.readFileSync(PROXY_POOL_FILE, 'utf-8')).text || ''); } catch { return ''; } // chưa có file / hỏng -> coi như trống (chạy như cũ)
}

// Proxy THẬT SỰ dùng cho profile `id`: proxy được hàng đợi gán (nếu có), không thì proxy riêng của profile.
// Dùng chung cho launchProfileById (mở Chrome) và runScriptOnProfile (proxyInfo cho changeProxy) -- 2 nơi luôn khớp nhau.
function effectiveProxyFor(id, profile) {
  const assigned = queue.proxyById && queue.proxyById[id];
  if (assigned) return assigned;
  return { proxyServer: profile ? profile.proxyServer : '', proxyUsername: profile ? profile.proxyUsername : '', proxyPassword: profile ? profile.proxyPassword : '', resetUrl: '' };
}

// Số profile ĐANG CHẠY trong hàng đợi đang được gán proxy có key này (kể cả profile đang mở dở / đang chờ retry).
function countAssignedProxy(key) {
  let n = 0;
  for (const activeId of queue.active) { const a = queue.proxyById[activeId]; if (a && a.key === key) n++; }
  return n;
}

// Proxy ít người dùng nhất mà còn dưới maxPerProxy (0 = không giới hạn); hoà nhau thì lấy proxy đứng trước trong danh sách. Hết chỗ -> null.
function pickPoolProxy(pool) {
  let best = null;
  let bestCount = Infinity;
  for (const p of pool) {
    const c = countAssignedProxy(p.key);
    if (queue.maxPerProxy > 0 && c >= queue.maxPerProxy) continue;
    if (c < bestCount) { best = p; bestCount = c; }
  }
  return best;
}

app.get('/api/proxy-pool', (req, res) => {
  const text = readProxyPoolText();
  const { proxies, warnings } = parseProxyPoolText(text);
  res.json({ text, count: proxies.length, warnings });
});

app.post('/api/proxy-pool', (req, res) => {
  const text = String((req.body && req.body.text) || '');
  const { proxies, warnings } = parseProxyPoolText(text);
  fs.writeFileSync(PROXY_POOL_FILE, JSON.stringify({ text }));
  // Danh sách vừa đổi (VD thêm proxy) có thể mở thêm chỗ ngay -- gọi fillQueue() luôn, không đợi tới lúc có profile đóng.
  if (queue.running) fillQueue();
  res.json({ text, count: proxies.length, warnings });
});

function buildProfileObject(fields, nameOverride) {
  const {
    name, userAgent, viewportWidth, viewportHeight, locale, timezoneId,
    proxyServer, proxyUsername, proxyPassword, engineMode, executablePath,
    fingerprint, autoFingerprint,
  } = fields;

  return {
    id: 'profile_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    name: (nameOverride !== undefined ? nameOverride : name || '').toString().trim(),
    userAgent: userAgent || '',
    viewportWidth: parseInt(viewportWidth, 10) || 1366,
    viewportHeight: parseInt(viewportHeight, 10) || 768,
    locale: locale || 'en-US',
    timezoneId: timezoneId || 'Asia/Ho_Chi_Minh',
    proxyServer: proxyServer || '',
    proxyUsername: proxyUsername || '',
    proxyPassword: proxyPassword || '',
    engineMode: engineMode || 'chromium',
    executablePath: executablePath || '',
    // Opt-in deep-identity layer (see fingerprint.js). Three cases:
    //  - an explicit `fingerprint` object was given (e.g. imported JSON)
    //    -> normalize/validate it rather than trust it as-is
    //  - no explicit object, but autoFingerprint is truthy (a checkbox,
    //    or the import route forcing this per item) -> generate a fresh
    //    one. Called fresh per profile, never hoisted outside a bulk
    //    loop, so a 200-profile batch gets 200 DIFFERENT fingerprints,
    //    not one shared fingerprint copy-pasted 200 times.
    //  - neither -> null, meaning "behave exactly like before this
    //    feature existed" (no canvas/WebGL/audio/font overrides at launch)
    fingerprint: fingerprint ? normalizeFingerprint(fingerprint) : (autoFingerprint ? generateFingerprint() : null),
    createdAt: new Date().toISOString(),
  };
}

// -------------------------------------------------------------------
// API: create a profile (just writes config -- no browser opened yet)
// -------------------------------------------------------------------
app.post('/api/profiles', (req, res) => {
  if (!req.body.name || !req.body.name.trim()) {
    return res.status(400).json({ error: 'Profile name is required' });
  }

  const profiles = readProfiles();
  const profile = buildProfileObject(req.body);
  profiles.push(profile);
  writeProfiles(profiles);
  res.status(201).json(profile);
});

// -------------------------------------------------------------------
// API: bulk-create N profiles named sequentially from a starting number
// (optionally prefixed), e.g. start=2, count=200, prefix="Client " ->
// "Client 2", "Client 3", ... "Client 201". Shares locale/timezone/engine
// across the whole batch -- proxies are assigned afterward via
// /api/profiles/bulk-proxy, since a fresh batch usually doesn't have
// proxies picked out yet. Viewport is shared too UNLESS autoFingerprint
// is on, in which case each profile also gets its own small upward
// jitter (see the loop below) -- otherwise a "batch of independent
// users" all reporting the exact same viewport size would be its own
// correlating signal, undermining the whole point of giving each one
// its own fingerprint.
// -------------------------------------------------------------------
const BULK_CREATE_MAX = 5000; // sanity ceiling, not a real expected use size -- catches "typed an extra zero"

app.post('/api/profiles/bulk', async (req, res) => {
  const startNumber = parseInt(req.body.startNumber, 10);
  const count = parseInt(req.body.count, 10);
  const prefix = req.body.prefix || '';

  if (!Number.isInteger(startNumber)) return res.status(400).json({ error: 'Starting number is required' });
  if (!Number.isInteger(count) || count < 1) return res.status(400).json({ error: 'Count must be at least 1' });
  if (count > BULK_CREATE_MAX) return res.status(400).json({ error: `That's a lot -- capped at ${BULK_CREATE_MAX} per batch, in case of a typo` });

  const sharedFields = { ...req.body };

  // "Fill locale/timezone from a proxy's IP" -- one detectLocationForProxy()
  // check (same function/API the per-profile "Change proxy" resync uses,
  // see bulk-proxy below) against the one-line test proxy, applied to the
  // WHOLE batch's shared locale/timezone -- a fresh batch shares those by
  // design (see this route's top comment). Never blocks or fails the
  // batch: a dead/slow test proxy just means the Locale/Timezone typed
  // into the form are used as-is, reported back via localeDetectionError
  // so the frontend can say so, same "one bad proxy doesn't fail
  // everything" rule bulk-proxy follows.
  let localeDetectionError = null;
  if (req.body.useProxyLocation && req.body.testProxyLine && req.body.testProxyLine.trim()) {
    try {
      const proxyFields = parseProxyLine(req.body.testProxyLine);
      const loc = await detectLocationForProxy(proxyFields);
      if (loc.timezone) sharedFields.timezoneId = loc.timezone;
      if (loc.suggestedLocale) sharedFields.locale = loc.suggestedLocale;
    } catch (err) {
      localeDetectionError = err.message;
    }
  }

  const profiles = readProfiles();
  const created = [];
  for (let i = 0; i < count; i++) {
    const fields = { ...sharedFields };
    // Each profile in the batch already gets its own fingerprint when
    // this is checked (see buildProfileObject) -- extend the same idea
    // to viewport. Snapped to a PLAUSIBLE real value (see
    // fingerprint.js's plausibleViewport()) rather than the typed size
    // plus arbitrary drift -- the earlier version of this
    // (baseWidth + Math.random()*160) produced not-quite-round numbers
    // like 1476px that no real person types or drags to, which was
    // itself a tell once you looked at more than one profile.
    if (fields.autoFingerprint) {
      // Sinh fingerprint TRƯỚC ở đây (thay vì để buildProfileObject tự
      // sinh bên trong nó) -- để lấy đúng hostPlatform của fingerprint
      // này cho plausibleViewport() ngay dưới, tránh lệch platform như
      // đã sửa ở fingerprint.js. fields.fingerprint gán rồi thì
      // buildProfileObject() sẽ NORMALIZE cái này thay vì tự sinh lại
      // 1 cái khác -- không sinh trùng 2 lần.
      fields.fingerprint = generateFingerprint();
      const baseWidth = parseInt(fields.viewportWidth, 10) || 1366;
      const baseHeight = parseInt(fields.viewportHeight, 10) || 768;
      const snapped = plausibleViewport(baseWidth, baseHeight, `${prefix}${startNumber + i}`, fields.fingerprint.hostPlatform);
      fields.viewportWidth = snapped.width;
      fields.viewportHeight = snapped.height;
    }
    const profile = buildProfileObject(fields, `${prefix}${startNumber + i}`);
    profiles.push(profile);
    created.push(profile);
  }
  writeProfiles(profiles);
  res.status(201).json({
    created: created.length,
    firstName: created[0].name,
    lastName: created[created.length - 1].name,
    localeDetectionError,
  });
});

// -------------------------------------------------------------------
// API: delete a profile (closes its browser window first, if open,
// then deletes its on-disk profile folder)
// -------------------------------------------------------------------
async function deleteProfileById(id) {
  if (runningContexts[id]) {
    await runningContexts[id].context.close().catch(() => {});
    delete runningContexts[id];
  }
  const profileDir = path.join(PROFILES_ROOT, id);
  if (fs.existsSync(profileDir)) {
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

app.delete('/api/profiles/:id', async (req, res) => {
  const { id } = req.params;
  await deleteProfileById(id);
  writeProfiles(readProfiles().filter((p) => p.id !== id));
  res.json({ success: true });
});

// -------------------------------------------------------------------
// API: bulk-delete -- closes + removes on-disk folders for every id
// given, then rewrites profiles.json exactly ONCE (not once per id,
// which would mean 200 reads+writes of the same file for a 200-profile
// batch). The confirmation popup lives in the frontend; by the time
// this route is hit, the user has already confirmed.
// -------------------------------------------------------------------
app.post('/api/profiles/bulk-delete', async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  if (ids.length === 0) return res.status(400).json({ error: 'No profile ids given' });

  await Promise.all(ids.map((id) => deleteProfileById(id)));

  const idSet = new Set(ids);
  writeProfiles(readProfiles().filter((p) => !idSet.has(p.id)));

  res.json({ deleted: ids.length });
});

// -------------------------------------------------------------------
// API: bulk-rename -- ids[i] đổi tên thành names[i] (trang Home: chọn nhiều profile, xếp A-Z, dán mỗi dòng 1 tên). Dòng trống = giữ
// tên cũ. Chỉ đổi trường name trong profiles.json -- thư mục dữ liệu đặt theo id nên cookie/phiên đăng nhập không bị ảnh hưởng.
// Từ chối nếu sau khi đổi có 2 profile trùng tên (không phân biệt hoa/thường) -- tên profile dùng để khớp dòng Excel, trùng là khớp nhầm.
// -------------------------------------------------------------------
app.post('/api/profiles/bulk-rename', (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  const names = Array.isArray(req.body.names) ? req.body.names : [];
  if (ids.length === 0) return res.status(400).json({ error: 'No profile ids given' });
  const profiles = readProfiles();
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const renames = ids.map((id, i) => [id, String(names[i] ?? '').trim()]).filter(([id, name]) => name && byId.has(id) && byId.get(id).name !== name);
  const finalName = new Map(profiles.map((p) => [p.id, p.name]));
  renames.forEach(([id, name]) => finalName.set(id, name));
  const seen = new Map(), dups = new Set();
  for (const name of finalName.values()) { const k = String(name).trim().toLowerCase(); if (seen.has(k)) dups.add(name); seen.set(k, true); }
  if (dups.size) return res.status(400).json({ error: `Trùng tên sau khi đổi: ${[...dups].join(', ')} -- tên profile dùng để khớp dòng Excel nên không được trùng.` });
  renames.forEach(([id, name]) => { byId.get(id).name = name; });
  writeProfiles(profiles);
  res.json({ renamed: renames.length });
});

// -------------------------------------------------------------------
// API: profile nào có cột M = "Suspended" trong snapshot Excel (nút "Xoá acc Suspended" ở trang Home). Khớp profile <-> dòng Excel
// giống hệt editor: giá trị ở cột `column` (mặc định cột editor đang chọn, do trang Home gửi lên) == tên profile, không phân biệt
// hoa/thường. Chỉ đọc -- việc xoá đi qua /api/profiles/bulk-delete sau khi bạn xác nhận danh sách.
// -------------------------------------------------------------------
app.get('/api/excel-snapshot/info', (req, res) => {
  let rows = [], headerLabels = {};
  try { rows = JSON.parse(fs.readFileSync(EXCEL_SNAPSHOT_FILE, 'utf-8')); } catch (e) { return res.json({ rowCount: 0, columns: [], headerLabels }); }
  try { headerLabels = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'excel-snapshot-header.json'), 'utf-8')) || {}; } catch (e) {}
  const letters = new Set(Object.keys(headerLabels));
  rows.forEach((r) => Object.keys(r || {}).forEach((k) => letters.add(k)));
  const colIndex = (l) => l.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const columns = [...letters].filter((l) => /^[A-Z]+$/.test(l)).sort((a, b) => colIndex(a) - colIndex(b));
  res.json({ rowCount: rows.length, columns, headerLabels });
});

app.get('/api/profiles/suspended', (req, res) => {
  const column = String(req.query.column || '').toUpperCase();
  const statusColumn = String(req.query.statusColumn || 'M').toUpperCase();
  if (!/^[A-Z]+$/.test(column) || !/^[A-Z]+$/.test(statusColumn)) return res.status(400).json({ error: 'column không hợp lệ' });
  let rows;
  try { rows = JSON.parse(fs.readFileSync(EXCEL_SNAPSHOT_FILE, 'utf-8')); } catch (e) { return res.status(400).json({ error: 'Chưa có snapshot Excel -- import file Excel ở trang editor trước.' }); }
  const byName = new Map(readProfiles().map((p) => [String(p.name).trim().toLowerCase(), p]));
  const matches = [], unmatched = [];
  rows.forEach((r, i) => {
    if (String((r || {})[statusColumn] ?? '').trim().toLowerCase() !== 'suspended') return;
    const key = String(r[column] ?? '').trim();
    const p = byName.get(key.toLowerCase());
    if (p) matches.push({ id: p.id, name: p.name, excelRow: i + 2, running: Boolean(runningContexts[p.id]) });
    else unmatched.push({ value: key, excelRow: i + 2 });
  });
  res.json({ matches, unmatched });
});

// -------------------------------------------------------------------
// API: bulk-assign proxies -- ids[i] gets proxies[i], in order. Each
// proxy line accepts "host:port" or "host:port:username:password"
// (the two most common formats proxy lists ship in). Parsing happens
// server-side so the frontend can stay a thin textarea, and so the same
// parser is used no matter what UI eventually calls this.
// -------------------------------------------------------------------
function parseProxyLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return { proxyServer: '', proxyUsername: '', proxyPassword: '' };

  const parts = trimmed.split(':');
  if (parts.length === 2) {
    const [host, port] = parts;
    return { proxyServer: `http://${host}:${port}`, proxyUsername: '', proxyPassword: '' };
  }
  if (parts.length === 4) {
    const [host, port, username, password] = parts;
    return { proxyServer: `http://${host}:${port}`, proxyUsername: username, proxyPassword: password };
  }
  // Already a full URL (http://user:pass@host:port) or something we don't
  // recognize -- pass it through as-is rather than guessing wrong.
  return { proxyServer: trimmed, proxyUsername: '', proxyPassword: '' };
}

// -------------------------------------------------------------------
// runWithConcurrency(items, limit, worker) -> Promise<void>, worker
// results (if any) live wherever worker() itself chooses to put them.
// A hand-rolled pool instead of a dependency: each detectLocationForProxy
// call launches a real headless Chromium process, so running the whole
// batch with Promise.all(items.map(...)) would mean N simultaneous
// browser processes for an N-profile paste -- fine for a handful, not
// for a 200-line proxy list. `limit` caps how many run at once; the next
// queued item starts the moment a slot frees up, not in fixed rounds.
// -------------------------------------------------------------------
async function runWithConcurrency(items, limit, worker) {
  let next = 0;
  async function runNext() {
    while (next < items.length) {
      const i = next++;
      await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
}

const LOCATION_CHECK_CONCURRENCY = 4; // simultaneous headless Chromium launches during an auto-resync, not N

// -------------------------------------------------------------------
// API: bulk-assign proxies -- ids[i] gets proxies[i], in order, AND (by
// default) each profile's locale/timezone gets resynced to match its NEW
// proxy's actual exit location, via the same check the "Detect location
// from proxy" button uses (detectLocationForProxy(), above).
//
// This is opt-OUT (pass syncLocale:false to skip it), not opt-in, on
// purpose: the whole point of this app's fingerprint layer is internal
// consistency, and a profile that keeps yesterday's locale/timezone after
// today's proxy moved it to a different country is exactly the kind of
// mismatch that undermines it -- silently leaving that stale is a worse
// default than the few extra seconds per profile this costs (see
// runWithConcurrency above for why it's not instant on a big batch).
//
// A proxy assignment is never rolled back over a failed location check
// (dead proxy, ip-api timeout, etc.) -- that profile just keeps its
// previous locale/timezone, reported back in `localeFailures` rather than
// failing the whole request over one bad line.
// -------------------------------------------------------------------
app.post('/api/profiles/bulk-proxy', async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  const proxies = Array.isArray(req.body.proxies) ? req.body.proxies : [];
  const syncLocale = req.body.syncLocale !== false;

  if (ids.length === 0) return res.status(400).json({ error: 'No profile ids given' });
  if (ids.length !== proxies.length) {
    return res.status(400).json({ error: `${ids.length} profiles selected but ${proxies.length} proxy lines given -- these must match exactly` });
  }

  const profiles = readProfiles();
  const byId = new Map(profiles.map((p) => [p.id, p]));

  const touched = []; // { profile, proxyFields } -- only ids that actually resolved to a real profile
  let updated = 0;
  for (let i = 0; i < ids.length; i++) {
    const profile = byId.get(ids[i]);
    if (!profile) continue; // silently skip an id that no longer exists rather than failing the whole batch
    const proxyFields = parseProxyLine(proxies[i]);
    Object.assign(profile, proxyFields);
    updated++;
    touched.push({ profile, proxyFields });
  }

  let localeSynced = 0;
  const localeFailures = []; // [{ name, reason }] -- profiles whose proxy changed but location check failed
  if (syncLocale) {
    // A blanked-out proxy line (removing a profile's proxy entirely) has
    // nothing to detect a location FROM -- leave that profile's existing
    // locale/timezone alone rather than erroring on every "no proxy" line
    // in a batch that intentionally clears some profiles' proxies.
    const toCheck = touched.filter((t) => t.proxyFields.proxyServer);
    await runWithConcurrency(toCheck, LOCATION_CHECK_CONCURRENCY, async ({ profile, proxyFields }) => {
      try {
        const loc = await detectLocationForProxy(proxyFields);
        if (loc.timezone) profile.timezoneId = loc.timezone;
        if (loc.suggestedLocale) profile.locale = loc.suggestedLocale;
        localeSynced++;
      } catch (err) {
        localeFailures.push({ name: profile.name, reason: err.message });
      }
    });
  }

  writeProfiles(profiles);
  res.json({ updated, localeSynced, localeFailures });
});

// -------------------------------------------------------------------
// API: import profiles from an array of objects -- the pasted-JSON or
// uploaded-.json-file path through the "Import" panel. Each item can
// carry any subset of the same fields buildProfileObject() understands,
// including its own `fingerprint` sub-object (see fingerprint.js), so
// you can bring in profiles that already have distinct UA/viewport/
// locale/timezone/proxy/fingerprint values instead of everyone in a
// batch sharing one config the way plain "Bulk create" does.
//
// `name` is optional -- items without one get auto-named "Imported N"
// (N = their position in the array) rather than being rejected, since a
// fingerprint export often doesn't carry a naming scheme of its own.
// autoFingerprint is forced on for every item, which (per
// buildProfileObject's rule) only actually fires as a fallback when the
// item didn't already supply its own `fingerprint` -- so every imported
// profile ends up with SOME fingerprint, generated or provided.
//
// A malformed single item is skipped and reported rather than failing
// the whole import -- pasted/exported data is more likely to have an
// occasional bad row than internally generated batches are (see
// bulk-delete above for the same "don't fail the batch over one id"
// reasoning applied to a different route).
// -------------------------------------------------------------------
const IMPORT_MAX = 5000; // same sanity ceiling as bulk-create, same reasoning

app.post('/api/profiles/import', (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : null;
  if (!items) return res.status(400).json({ error: '"items" must be an array' });
  if (items.length === 0) return res.status(400).json({ error: 'No items to import' });
  if (items.length > IMPORT_MAX) return res.status(400).json({ error: `That's a lot -- capped at ${IMPORT_MAX} per import` });

  const profiles = readProfiles();
  const created = [];
  const errors = [];

  items.forEach((item, i) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push({ index: i, error: 'Not a JSON object' });
      return;
    }
    const name = (item.name || '').toString().trim() || `Imported ${i + 1}`;
    try {
      const profile = buildProfileObject({ ...item, autoFingerprint: true }, name);
      profiles.push(profile);
      created.push(profile);
    } catch (err) {
      errors.push({ index: i, error: err.message });
    }
  });

  writeProfiles(profiles);
  res.status(201).json({ created: created.length, errors });
});

// -------------------------------------------------------------------
// API: (re)generate a random fingerprint for one EXISTING profile --
// what the card's "Generate fingerprint" / "Regenerate" button calls.
// Blocked while running: the new value only takes effect on next launch
// anyway (addInitScript is registered at launch time), so changing it
// under a live window would silently do nothing until relaunch, which
// is more confusing than just asking for a close first.
// -------------------------------------------------------------------
// -------------------------------------------------------------------
// API: full reset for one profile -- a fresh fingerprint AND a wiped
// userDataDir (every cookie/localStorage/IndexedDB/cache entry that
// profile's browser ever wrote), same folder-wipe deleteProfileById()
// does, minus removing the profile from the list. Name, id, proxy,
// viewport, locale/timezone, and engine are all left exactly as they
// were -- only the fingerprint and the on-disk browsing data change.
// Auto-closes a running profile first (same as Delete) rather than
// requiring you to close it yourself -- wiping the folder out from
// under a live Chromium process is asking for trouble either way, so
// this closes it properly before touching disk instead of just
// refusing the request.
// -------------------------------------------------------------------
app.post('/api/profiles/:id/fingerprint', async (req, res) => {
  const { id } = req.params;
  const profiles = readProfiles();
  const profile = profiles.find((p) => p.id === id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  if (runningContexts[id]) {
    await runningContexts[id].context.close().catch(() => {});
    delete runningContexts[id];
  }

  const profileDir = path.join(PROFILES_ROOT, id);
  if (fs.existsSync(profileDir)) {
    fs.rmSync(profileDir, { recursive: true, force: true });
  }

  profile.fingerprint = generateFingerprint();
  writeProfiles(profiles);
  res.json({ fingerprint: profile.fingerprint, dataCleared: true });
});

// -------------------------------------------------------------------
// API: turn OFF the fingerprint layer for one profile (back to
// `fingerprint: null`, i.e. the original UA/viewport/locale/timezone-
// only behavior). Same running-profile guard as above, same reason.
// -------------------------------------------------------------------
app.delete('/api/profiles/:id/fingerprint', (req, res) => {
  const { id } = req.params;
  if (runningContexts[id]) return res.status(400).json({ error: 'Close this profile before changing its fingerprint' });

  const profiles = readProfiles();
  const profile = profiles.find((p) => p.id === id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  profile.fingerprint = null;
  writeProfiles(profiles);
  res.json({ success: true });
});

// Bảng 🧬 các tầng fingerprint: danh sách tầng + tầng đang tắt của profile; lưu = profile.fpOffLayers (dữ liệu fingerprint giữ nguyên)
app.get('/api/fp-layers', (req, res) => res.json(FP_LAYERS));
app.post('/api/profiles/:id/fp-layers', (req, res) => {
  const profiles = readProfiles(), profile = profiles.find((p) => p.id === req.params.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  // body.on = các tầng ĐANG TICK (bảng 🧬); body.off (kiểu cũ) = các tầng bỏ tick
  const on = new Set(Array.isArray(req.body.on) ? req.body.on : FP_LAYERS.filter((l) => l.def !== false && !(req.body.off || []).includes(l.key)).map((l) => l.key)); // kiểu cũ { off }: tầng mặc định tắt vẫn tắt
  profile.fpOffLayers = FP_LAYERS.filter((l) => l.def !== false && !on.has(l.key)).map((l) => l.key);
  profile.fpOnLayers = FP_LAYERS.filter((l) => l.def === false && on.has(l.key)).map((l) => l.key);
  writeProfiles(profiles);
  res.json({ success: true, off: Object.entries(fpLayersOf(profile)).filter(([, v]) => !v).map(([k]) => k), running: Boolean(runningContexts[profile.id]) });
});
// Trang kiểm tra hỏi lại header mà CHÍNH trình duyệt gửi lên (Sec-CH-UA... -- web server đọc thẳng, JS không che được)
app.get('/api/echo-headers', (req, res) => {
  res.set('Accept-CH', 'Sec-CH-UA-Full-Version-List, Sec-CH-UA-Platform-Version');
  res.json(Object.fromEntries(['user-agent', 'sec-ch-ua', 'sec-ch-ua-platform', 'sec-ch-ua-full-version-list', 'accept-language'].map((k) => [k, req.headers[k] || null])));
});
// 🔍 Kiểm tra: mở trang fp-check.html (giá trị từng tầng) trong tab mới của CHÍNH profile đang chạy
app.post('/api/profiles/:id/fp-check', async (req, res) => {
  const running = runningContexts[req.params.id];
  if (!running) return res.status(400).json({ error: 'Launch profile trước rồi mới kiểm tra' });
  try {
    const p = await running.context.newPage();
    await p.goto(`http://127.0.0.1:${PORT}/fp-check.html`);
    await p.bringToFront().catch(() => {});
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Bật / tắt fingerprint (nút ở thẻ profile): chỉ đổi cờ fingerprintOff -- dữ liệu fingerprint KHÔNG bị xoá / tạo mới. Áp dụng từ lần Launch sau.
app.post('/api/profiles/:id/fingerprint-toggle', (req, res) => {
  const profiles = readProfiles(), profile = profiles.find((p) => p.id === req.params.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  if (!profile.fingerprint) return res.status(400).json({ error: 'Profile này chưa có fingerprint -- bấm ↻ để tạo' });
  profile.fingerprintOff = typeof req.body.on === 'boolean' ? !req.body.on : !profile.fingerprintOff;
  writeProfiles(profiles);
  res.json({ success: true, on: !profile.fingerprintOff, running: Boolean(runningContexts[profile.id]) });
});


// -------------------------------------------------------------------
// A small "which profile is this?" badge pinned to the corner of every
// page a profile's window shows -- purely a visual aid for telling a
// desk full of open windows apart at a glance, no automation purpose.
// Injected via context.addInitScript() at launch (see launchProfileById
// below), which re-runs this on every navigation automatically (new
// tab, page.goto, back/forward) -- unlike the Run-script visible-cursor
// overlay in scripts/helpers.js, this needs no script to be running.
// -------------------------------------------------------------------
function buildProfileBadgeInitScript(name) {
  const safeName = JSON.stringify(String(name)); // JSON-escaped so quotes/backslashes in a profile name can't break out of the injected string literal
  return `
(() => {
  // Chỉ chạy trên trang web thật -- KHÔNG chạy trên chrome://, chrome-extension://,
  // devtools://, about:, v.v. Badge này không có ý nghĩa gì trên các trang nội
  // bộ của Chrome, và từng khiến chrome://extensions bị lỗi ngầm khi tự
  // thêm DOM vào trang đó (xem lịch sử debug "Load unpacked" không phản hồi).
  if (!/^https?:$/.test(location.protocol)) return;
  if (window.top !== window.self) return; // only the outermost page gets a badge, not every iframe on it
  const show = () => {
    if (document.getElementById('__profile_badge__')) return;
    const badge = document.createElement('div');
    badge.id = '__profile_badge__';
    badge.textContent = ${safeName};
    badge.style.cssText = 'position:fixed;top:6px;right:6px;z-index:2147483647;' +
      'background:rgba(20,20,20,.72);color:#fff;font:600 12px/1 -apple-system,system-ui,sans-serif;' +
      'padding:4px 9px;border-radius:5px;pointer-events:none;letter-spacing:.02em;' +
      'box-shadow:0 1px 4px rgba(0,0,0,.35);';
    (document.body || document.documentElement).appendChild(badge);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show);
  else show();
})();
`;
}

// -------------------------------------------------------------------
// Prefixes every tab's document.title with "[profile name] " -- this is
// what the OS actually reads for the taskbar hover-preview and Alt+Tab
// switcher, so it's what makes different profiles' windows tell apart
// there (the on-page badge above only helps once you're already
// LOOKING at a given window).
//
// A one-time `document.title = ...` isn't enough -- SPAs like X rewrite
// their own title constantly (e.g. an unread-count prefix), which would
// silently strip ours back off within moments. Instead this patches the
// `title` PROPERTY itself on this one `document` instance, so every
// future write -- whether from the page's own JS or the browser's own
// navigation handling -- gets our prefix re-applied, not just the
// title present at the moment this script ran.
// -------------------------------------------------------------------
function buildProfileTitleInitScript(name) {
  const safePrefix = JSON.stringify(`[${String(name)}] `);
  return `
(() => {
  // Chỉ chạy trên trang web thật -- xem comment y hệt trong
  // buildProfileBadgeInitScript() phía trên. Ghi đè document.title bằng
  // Object.defineProperty trên 1 trang nội bộ như chrome://extensions có
  // thể ném lỗi ngầm giữa chừng, làm dừng luôn JS phía sau của CHÍNH
  // trang đó (VD nút "Load unpacked" không phản hồi gì sau khi chọn
  // folder) -- không có lý do gì để đổi tiêu đề tab của 1 trang nội bộ
  // Chrome cả.
  if (!/^https?:$/.test(location.protocol)) return;
  if (window.top !== window.self) return; // only the outermost page's title matters for the OS window/tab
  try {
    const PREFIX = ${safePrefix};
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'title');
    if (desc && desc.get && desc.set && desc.configurable) {
      Object.defineProperty(document, 'title', {
        configurable: true,
        get() { return desc.get.call(document); },
        set(value) {
          const v = String(value);
          desc.set.call(document, v.startsWith(PREFIX) ? v : PREFIX + v);
        },
      });
    }
    const applyInitial = () => {
      try { if (!document.title.startsWith(PREFIX)) document.title = document.title; } catch (e) {}
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyInitial);
    else applyInitial();
  } catch (e) {}
})();
`;
}

// -------------------------------------------------------------------
// Core launch logic, shared by the manual "Launch" button (the route
// right below) and the queue system (further down). Throws httpError
// on failure; on success it populates runningContexts[id] itself.
// -------------------------------------------------------------------
// ---------------- Sao lưu / khôi phục phiên đăng nhập trong CHÍNH folder profile (<profile>\\session-backup.json, không mã hoá)
// Chrome trên Windows khoá cookie bằng DPAPI của TÀI KHOẢN WINDOWS -> cài lại Win / chép profile sang máy khác là Chrome không đọc được cookie
// cũ (bị out hết tài khoản) dù folder profile còn nguyên. Lúc profile đang mở, Playwright đọc được cookie đã giải mã -> ghi ra file thường cạnh
// profile: mỗi lần tool đóng profile (mọi nút Close / queue / xoá cache... đều qua context.close) + định kỳ SESSION_EVERY_MS lúc đang mở.
// Lần Launch sau: cookie nào Chrome không còn (hoặc còn mà rỗng -- không giải mã được) thì nạp lại từ file; cookie đang có thì giữ nguyên.
const SESSION_FILE = 'session-backup.json', SESSION_EVERY_MS = 3 * 60 * 1000;
async function backupSession(id, context) {
  const cookies = await context.cookies();
  if (!cookies.length) return 0; // không ghi đè bản sao lưu tốt bằng bản rỗng
  const file = path.join(PROFILES_ROOT, id, SESSION_FILE), tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ savedAt: new Date().toISOString(), machine: MACHINE, count: cookies.length, cookies }));
  fs.renameSync(tmp, file); // ghi file tạm rồi đổi tên -- tắt máy giữa chừng không làm hỏng bản cũ
  return cookies.length;
}
async function restoreSession(id, context) {
  let data;
  try { data = JSON.parse(fs.readFileSync(path.join(PROFILES_ROOT, id, SESSION_FILE), 'utf-8')); } catch { return 0; }
  const now = Date.now() / 1000, key = (c) => `${c.name}|${c.domain}|${c.path}`, have = new Map((await context.cookies()).map((c) => [key(c), c.value]));
  const missing = (data.cookies || []).filter((c) => (!have.has(key(c)) || (have.get(key(c)) === '' && c.value !== '')) && !(c.expires > 0 && c.expires < now));
  if (!missing.length) return 0;
  let n = 0;
  try { await context.addCookies(missing); n = missing.length; } catch { for (const c of missing) { try { await context.addCookies([c]); n++; } catch {} } } // 1 cookie lỗi không làm hỏng cả lượt
  console.log(`[session] ${id}: khôi phục ${n} cookie từ ${SESSION_FILE} (sao lưu lúc ${data.savedAt}${data.machine ? ' trên ' + data.machine : ''})`);
  return n;
}

const PW_EXTRA_FLAGS = ['--enable-automation', '--disable-field-trial-config', '--disable-background-networking', '--disable-background-timer-throttling', '--disable-back-forward-cache',
  '--disable-breakpad', '--disable-client-side-phishing-detection', '--disable-component-extensions-with-background-pages', '--disable-component-update', '--disable-default-apps',
  '--disable-dev-shm-usage', '--disable-edgeupdater', '--allow-pre-commit-input', '--disable-hang-monitor', '--disable-ipc-flooding-protection', '--disable-popup-blocking',
  '--disable-prompt-on-repost', '--disable-updater-scheduler', '--force-color-profile=srgb', '--metrics-recording-only', '--password-store=basic', '--use-mock-keychain',
  '--no-service-autorun', '--export-tagged-pdf', '--unsafely-disable-devtools-self-xss-warnings', '--edge-skip-compat-layer-relaunch', '--disable-infobars', '--disable-sync',
  '--enable-unsafe-swiftshader', '--enable-features=CDPScreenshotNewSurface'];

async function launchProfileById(id) {
  if (runningContexts[id]) {
    throw httpError(400, 'This profile is already running');
  }

  const profile = readProfiles().find((p) => p.id === id);
  if (!profile) throw httpError(404, 'Profile not found');

  const userDataDir = path.join(PROFILES_ROOT, id);
  if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

  // Bật sẵn Developer Mode TRƯỚC khi Chrome khởi động -- cả flag CLI
  // (--load-extension) lẫn nút "Load unpacked" thủ công rất có thể đều
  // cần cờ này đã bật SẴN cho đúng profile đó. Một profile MỚI (chưa
  // từng mở tay, chưa từng tự bấm công tắc Developer mode) sẽ KHÔNG có
  // cờ này -- phải tự ghi thẳng vào file Preferences ở đây, vì Chrome
  // chỉ ĐỌC file này lúc khởi động; sửa sau khi cửa sổ đã mở thì vô tác
  // dụng. Không phải khoá thuộc diện "Secure Preferences"/MAC-protected
  // (đó là cho các setting nhạy cảm hơn như search engine mặc định),
  // nên ghi thẳng JSON là an toàn, Chrome đọc lại bình thường không
  // phàn nàn.
  // Same "write straight into Preferences before Chrome reads it" trick as
  // developer_mode below, but for the popups/banners that make a desk full
  // of automated windows annoying to babysit:
  //   - "Save password?" bubble           -> credentials_enable_service +
  //                                           profile.password_manager_enabled
  //   - Site "Allow notifications?" popup -> default_content_setting_values
  //                                           .notifications = 2 (block by
  //                                           default, no per-site prompt)
  //   - "Chrome didn't shut down properly / Restore pages?" infobar -- shows
  //     up whenever Chrome's own exit_type in this profile's Preferences
  //     wasn't left as "Normal" (exactly what happens if this profile's
  //     process got killed instead of closed cleanly, e.g. an orphaned
  //     window left over from a server restart -- see the shutdown handler
  //     near app.listen() for the other half of this fix). Forcing it back
  //     to "Normal"/clean on every launch pre-empts the banner regardless
  //     of how the previous run actually ended.
  //
  // Unlike developer_mode above (only set once, since it's a one-way
  // switch the user might toggle by hand), these are re-applied on EVERY
  // launch -- a Chrome update or the user clicking "Save" on a stray
  // password prompt before this existed could otherwise flip them back.
  try {
    const defaultProfileDir = path.join(userDataDir, 'Default');
    fs.mkdirSync(defaultProfileDir, { recursive: true });
    const preferencesPath = path.join(defaultProfileDir, 'Preferences');
    const prefs = fs.existsSync(preferencesPath)
      ? JSON.parse(fs.readFileSync(preferencesPath, 'utf-8'))
      : {};
    prefs.extensions = prefs.extensions || {};
    prefs.extensions.ui = prefs.extensions.ui || {};
    if (prefs.extensions.ui.developer_mode !== true) {
      prefs.extensions.ui.developer_mode = true;
    }

    prefs.credentials_enable_service = false;
    prefs.profile = prefs.profile || {};
    prefs.profile.password_manager_enabled = false;
    prefs.profile.exit_type = 'Normal';
    prefs.profile.exit_cleanly = true;
    prefs.profile.default_content_setting_values = prefs.profile.default_content_setting_values || {};
    if (fpLayersOf(profile).notif) prefs.profile.default_content_setting_values.notifications = 2; // 2 = block, no popup asking
    else if (prefs.profile.default_content_setting_values.notifications === 2) delete prefs.profile.default_content_setting_values.notifications; // tầng "Chặn hỏi thông báo" tắt -> về mặc định của Chrome (hỏi)
    prefs.autofill = prefs.autofill || {};
    prefs.autofill.credit_card_enabled = false; // "Save card?" bubble

    fs.writeFileSync(preferencesPath, JSON.stringify(prefs));
  } catch (err) {
    console.warn(`Couldn't pre-set Preferences (password/notification popups) for profile ${id}: ${err.message}`);
  }

  // "Continue running background apps when Google Chrome is closed"
  // (chrome://settings/system) is NOT a per-profile pref -- Chromium
  // registers background_mode.enabled on the BROWSER-level "Local State"
  // pref store (chrome/browser/background/background_mode_manager.cc),
  // which lives as its own JSON file at the ROOT of userDataDir, one
  // level up from Default/Preferences above. Writing it into
  // Default/Preferences (as an earlier attempt at this did) has no
  // effect at all -- Chrome never reads that key from there, so the
  // toggle kept showing ON no matter what. --disable-background-mode
  // below still does the actual job (no background process survives
  // closing the window) regardless of this toggle's on-disk value; this
  // is only so chrome://settings itself reports the correct state too.
  try {
    const localStatePath = path.join(userDataDir, 'Local State');
    const localState = fs.existsSync(localStatePath)
      ? JSON.parse(fs.readFileSync(localStatePath, 'utf-8'))
      : {};
    localState.background_mode = localState.background_mode || {};
    localState.background_mode.enabled = false;
    fs.writeFileSync(localStatePath, JSON.stringify(localState));
  } catch (err) {
    console.warn(`Couldn't pre-set Local State (background mode) for profile ${id}: ${err.message}`);
  }

  const launchOptions = {
    headless: false, // a profile manager's whole point is a real window you can drive by hand
    viewport: { width: profile.viewportWidth, height: profile.viewportHeight },
    locale: profile.locale,
    timezoneId: profile.timezoneId,
    // Chrome shows a "You are using an unsupported command-line flag"
    // banner whenever certain flags are present, --no-sandbox among them
    // -- regardless of WHERE that flag came from (Playwright itself on a
    // restrictive host, or baked into a particular Chrome Portable build).
    // --test-type is Chromium's own, widely-used way to suppress exactly
    // this banner (the same technique ChromeDriver uses) -- it doesn't
    // change --no-sandbox's actual effect, just stops the popup about it.
    //
    // --disable-blink-features=AutomationControlled turns off the
    // Blink-level flag CDP automation normally sets, which is what
    // navigator.webdriver (and a few other automation tells) reads from
    // internally -- pairs with buildBaseStealthInitScript() below, which
    // covers the JS-visible side. Always on, same as --test-type, since
    // "this window is being driven through CDP" isn't a per-fingerprint
    // detail, it's true of every profile this app launches.
    args: [
      '--test-type',
      '--disable-blink-features=AutomationControlled',
      // Belt-and-suspenders alongside the Preferences edits above: these
      // three cover the same popups/banners at the command-line-flag
      // level, in case the OS/Chrome build ever ignores one of the
      // Preferences keys. --password-store=basic in particular matters
      // most on Mac/Linux, where Chrome would otherwise use the real OS
      // keychain/keyring for saved passwords -- which pops its OWN native
      // "Chrome wants to use your keychain" prompt outside Chrome
      // entirely, something no Preferences-file edit can suppress.
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
      '--password-store=basic',
      // Tắt hẳn "Continue running background apps when Google Chrome is
      // closed" (chrome://settings > System) ở cấp process -- không phải
      // chỉ uncheck ô đó, mà tắt LUÔN cơ chế background-mode-manager của
      // Chromium. Nếu không, đóng cửa sổ (context.close()) có thể để lại
      // 1 tiến trình chrome.exe "nền" vẫn sống, tự nó giữ khoá userDataDir
      // -- lần launch KẾ TIẾP của đúng profile này gặp lỗi kiểu "Couldn't
      // launch Chrome" dù path chrome.exe hoàn toàn đúng, chỉ vì tiến
      // trình cũ chưa thật sự thoát hẳn.
      '--disable-background-mode',
      // ===== Chống "màn hình đen" / extension đứng hình khi chạy NHIỀU
      // cửa sổ Chrome cùng lúc (đúng cách app này vận hành) =====
      //
      // Từ Chrome ~86+, Windows có tính năng "Native Window Occlusion":
      // Chrome tự hỏi hệ điều hành "cửa sổ này có đang bị cửa sổ khác che
      // hoàn toàn không", và nếu nghĩ là CÓ, nó NGỪNG RENDER cửa sổ đó để
      // tiết kiệm tài nguyên -- kể cả khi cửa sổ thực ra vẫn lộ ra ngoài
      // (chỉ là nhận diện sai). Chạy nhiều cửa sổ Chrome chồng lên nhau
      // (nhiều profile cùng lúc) là ĐÚNG kịch bản khiến việc nhận diện
      // này sai nhiều nhất -- và popup/side panel của extension (Phantom)
      // đặc biệt hay dính, hiện ra thành 1 khối ĐEN THUI thay vì nội dung
      // thật, cho tới khi cửa sổ được "đánh thức" lại (restart Chrome tạo
      // lại renderer process mới -- đúng triệu chứng "restart thì chạy,
      // tắt bật lại thì đen lại" đã gặp trên thực tế).
      //
      // 3 flag dưới đây là tổ hợp tiêu chuẩn mà chính các tool automation
      // (Puppeteer, Playwright test runner của Google) dùng để tắt HẲN
      // các cơ chế "tưởng cửa sổ/tab đang ẩn nên tự giảm hiệu năng render"
      // này -- không đụng gì tới GPU renderer/vendor string hay canvas/
      // WebGL, nên KHÔNG ảnh hưởng gì tới fingerprint đang giả lập:
      '--disable-features=CalculateNativeWinOcclusion',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
    // Playwright bakes --disable-extensions into EVERY launch's default
    // args, silently and unconditionally, unless explicitly told not to.
    // This is the ACTUAL root cause of the whole "extension không cài
    // được qua app" investigation -- it disables the extension system
    // at the browser-PROCESS level (below any JS/CDP/init-script layer),
    // so it doesn't matter whether Developer Mode is on, whether
    // chrome://extensions itself is broken by some injected script, or
    // which --load-extension/--disable-extensions-except flags are also
    // passed -- none of that has any effect while this default flag is
    // in force. Confirmed against Playwright's own generated command
    // line (see microsoft/playwright issues #8129, #27104, #39569) and
    // matches the exact symptom: launching chrome.exe DIRECTLY (no
    // Playwright, no this flag) let "Load unpacked" work fine, while
    // launching through this app (Playwright, WITH this flag) silently
    // refused every attempt, manual or automated, without any
    // JS-visible error at all.
    ignoreDefaultArgs: ['--disable-extensions'],
  };

  if (profile.userAgent && fpLayersOf(profile).ua) launchOptions.userAgent = profile.userAgent; // tầng "User-Agent riêng" (bảng 🧬) tắt -> dùng UA thật của Chrome

  // Nút bật / tắt fingerprint ở Home: tắt = KHÔNG áp lớp giả lập (canvas / WebGL / audio / font, màn hình, tỉ lệ điểm ảnh, vị trí) ở lần Launch
  // này, nhưng profile.fingerprint giữ nguyên -- bật lại là dùng đúng bộ cũ
  const fp = profile.fingerprint && !profile.fingerprintOff ? profile.fingerprint : null;
  const lay = fpLayersOf(profile); // từng tầng bật / tắt riêng (bảng 🧬 ở thẻ profile) -- xem FP_LAYERS trong fingerprint.js
  // Tầng "Cờ khởi động của Playwright" tắt: bỏ các cờ mặc định Playwright tự thêm (Chrome thường không có -- web soi được: --enable-automation
  // -> webdriver, --disable-field-trial-config -> thiếu thử nghiệm của Chrome...). Giữ cờ Playwright cần để điều khiển (--remote-debugging-pipe,
  // --user-data-dir) + vài cờ chỉ tắt hộp thoại lần đầu. Chuỗi phải khớp đúng cờ của Playwright 1.62 -- cờ không có thì Playwright bỏ qua.
  if (!lay.pwflags) launchOptions.ignoreDefaultArgs = [...new Set([...(launchOptions.ignoreDefaultArgs || []), ...PW_EXTRA_FLAGS])];

  if (fp) {
    // Emulates window.screen separately from viewport -- a real
    // un-maximized (or taskbar-shrunk) browser window has a SMALLER
    // viewport than the physical screen; viewport === screen is a subtler
    // tell than it sounds (see fingerprint.js's screenForViewport() for
    // the height-vs-width reasoning -- height in particular should
    // almost never exactly equal viewport height, taskbar + browser
    // chrome always eat some of it).
    //
    // profile.fingerprint.screenWidth/Height are null unless an import
    // explicitly set them (see generateFingerprint()) -- the normal
    // case derives a real, viewport-appropriate resolution fresh every
    // launch instead, seeded by the profile's own id so the SAME
    // profile gets the SAME screen size on every relaunch (deterministic,
    // not re-rolled each time you open it).
    if (!lay.screen) { /* tầng "Kích thước màn hình" đang tắt */ } else if (fp.screenWidth && fp.screenHeight) {
      launchOptions.screen = { width: fp.screenWidth, height: fp.screenHeight };
    } else {
      // Truyền hostPlatform của CHÍNH fingerprint này -- không phải
      // os.platform() của máy chạy server (fallback mặc định nếu bỏ
      // trống). Thiếu dòng này thì 1 profile khai platform macOS
      // (navigator.platform/WebGL/fonts) trên server chạy Windows sẽ bị
      // gán độ phân giải theo danh sách CHỈ DÀNH CHO Windows -- mâu
      // thuẫn nội tại giữa "khai báo là Mac" và "màn hình là màn hình
      // Windows", một dấu hiệu fingerprint không hợp lệ.
      launchOptions.screen = screenForViewport(profile.viewportWidth, profile.viewportHeight, profile.id, fp.hostPlatform);
    }

    // window.devicePixelRatio -- previously never set at all, so every
    // profile silently used Playwright's own default (1) regardless of
    // preset. That's a real gap, not just an unfinished nice-to-have:
    // real macOS Retina displays report 2 almost universally, so a
    // profile claiming macOS while reporting a DPR of 1 is a
    // contradiction of exactly the kind this whole layer exists to
    // avoid -- just one signal deeper than canvas/WebGL. See each
    // preset's deviceScaleFactor in fingerprint.js.
    if (lay.dpr && fp.deviceScaleFactor) {
      launchOptions.deviceScaleFactor = fp.deviceScaleFactor;
    }

    // Only set if explicitly provided (import JSON) -- see fingerprint.js's
    // generateFingerprint(): never auto-populated, no IP-geolocation
    // lookup happens here. Unset behaves exactly like a real unconfigured
    // browser (site asks, browser has nothing to offer/prompts normally).
    if (lay.geo && fp.geolocation) {
      launchOptions.geolocation = fp.geolocation;
      launchOptions.permissions = ['geolocation'];
    }
  }

  const effProxy = effectiveProxyFor(id, profile); // proxy hàng đợi gán từ "Danh sách proxy" (nếu có), không thì proxy riêng của profile
  if (effProxy.proxyServer) {
    launchOptions.proxy = {
      server: effProxy.proxyServer,
      username: effProxy.proxyUsername || undefined,
      password: effProxy.proxyPassword || undefined,
    };

    // Chromium's own WebRTC IP-handling policy, forced via flag instead
    // of the (Windows-registry / macOS-plist / Linux policies.json)
    // mechanism this policy is normally set through -- those aren't
    // practical for a per-profile local tool. disable_non_proxied_udp is
    // the well-documented policy VALUE (Chrome Enterprise's own docs use
    // it), forcing WebRTC through the configured proxy instead of leaking
    // your real IP via STUN regardless of what the page's JS can see.
    //
    // Tied to profile.proxyServer, NOT profile.fingerprint (an earlier
    // version of this code had it backwards) -- confirmed via a real
    // CreepJS run: a fingerprint-enabled profile with NO proxy configured
    // got this flag anyway, and Chromium's WebRTC candidate came back as a
    // synthetic-looking all-zeros address (foundation "0000000000", ip
    // "000.000.000.000") instead of either a real local IP or no candidate
    // at all -- an anomalous, obviously-blocked-looking pattern that's a
    // worse tell than not touching WebRTC. The flag only makes sense when
    // there's an actual proxy for "non-proxied" to be disabled IN FAVOR OF;
    // with no proxy, leave WebRTC alone and let it behave like a real,
    // unconfigured browser. Still confirm at browserleaks.com/webrtc after
    // launching a profile that does have a proxy set.
    launchOptions.args.push('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
  }

  // Extension loading (--disable-extensions-except/--load-extension) is
  // added to launchOptions.args a bit further below, right before launch
  // -- see the block right after the engine-selection if/else chain,
  // using the GLOBAL extension list (see readGlobalExtensionPaths()),
  // same for every profile. Kept separate from the block above only
  // because it needs `launchOptions.args` to already exist.

  // Which browser binary actually runs. A globally configured CHROME_PATH
  // (.env) always wins here, no matter what this profile's own engineMode
  // says -- that's the entire point of setting it once. See README
  // section 10 and .env.example.
  if (CHROME_PATH) {
    launchOptions.executablePath = CHROME_PATH;
  } else if (profile.engineMode === 'chrome') {
    launchOptions.channel = 'chrome'; // use the real, already-installed Google Chrome
  } else if (profile.engineMode === 'custom' && profile.executablePath) {
    launchOptions.executablePath = profile.executablePath; // e.g. a portable Chrome build
  }
  // engineMode === 'chromium' (default) and no CHROME_PATH set: no extra
  // option needed -- Playwright falls back to the bundled Chromium it manages itself.

  // Nạp extension qua --disable-extensions-except/--load-extension --
  // phải đặt TRƯỚC khi launch (đây là launch-time flag, không phải thứ
  // có thể thêm sau khi browser đã mở). Giờ có cơ hội chạy thật vì
  // launchOptions.ignoreDefaultArgs ở trên đã loại bỏ --disable-extensions
  // (flag mặc định của CHÍNH Playwright, không liên quan gì Chrome Portable
  // hay Chrome 137 -- đây mới là thứ đã âm thầm chặn đứng MỌI cách nạp
  // extension qua app từ đầu, kể cả Load unpacked thủ công).
  //
  // CHỈ dùng danh sách TOÀN CỤC (cấu hình 1 lần ở trang chủ, xem
  // readGlobalExtensionPaths()) -- áp dụng cho MỌI profile. Không còn ô
  // "Extension folders" riêng từng profile nữa (đã bỏ theo yêu cầu).
  //
  // LƯU Ý -- vẫn còn 1 giới hạn KHÔNG sửa được bằng code: Google đã xoá
  // hẳn 2 flag này khỏi Chrome BẢN CHÍNH THỨC (Chrome 137+, xem RFC
  // "Removing the --load-extension flag in branded Chrome builds") --
  // nếu Chrome Portable của bạn thuộc diện này, 2 flag dưới đây có thể
  // vẫn không có tác dụng TỰ ĐỘNG (dù Load unpacked THỦ CÔNG qua
  // chrome://extensions vẫn nên chạy được bình thường sau khi sửa
  // ignoreDefaultArgs ở trên). Chromium bundled của Playwright (không
  // set CHROME_PATH) thì KHÔNG bị ảnh hưởng bởi việc xoá flag này.
  //
  // ĐÃ THỬ VÀ XÁC NHẬN KHÔNG DÙNG ĐƯỢC: Extensions.loadUnpacked qua CDP
  // (Playwright's newCDPSession) -- trả về "Method not available", vì
  // API này chỉ khả dụng khi kết nối bằng --remote-debugging-pipe +
  // --enable-unsafe-extension-debugging, còn Playwright dùng transport
  // khác. Không còn thử lại hướng này nữa -- flag CLI ở dưới là cơ chế
  // TỰ ĐỘNG duy nhất còn lại; Load unpacked thủ công 1 lần/profile vẫn
  // luôn là phương án chắc ăn nếu Chrome Portable không hợp tác.
  const allExtensionPaths = readGlobalExtensionPaths();
  if (allExtensionPaths.length) {
    const validExtPaths = allExtensionPaths.filter((p) => {
      const exists = fs.existsSync(p);
      if (!exists) console.warn(`Extension path not found, skipping: ${p}`);
      return exists;
    });
    if (validExtPaths.length) {
      const joined = validExtPaths.join(',');
      // CHỈ --load-extension, KHÔNG kèm --disable-extensions-except --
      // flag đó hoạt động như 1 "danh sách trắng": chặn đứng MỌI
      // extension khác ngoài danh sách này, kể cả Load unpacked THỦ
      // CÔNG sau đó (đúng nguyên nhân lỗi "Installation is not
      // enabled" xuất hiện lại mỗi khi ô Global Extensions có giá trị).
      // --load-extension ĐƠN ĐỘC từng bị coi là "không đủ tin cậy" khi
      // tự động hoá (lý do 2 flag hay đi kèm nhau trong ví dụ chính
      // thức của Playwright) -- nhưng đó là TRƯỚC khi phát hiện
      // --disable-extensions (mặc định của Playwright, xem
      // ignoreDefaultArgs ở trên) mới chính là thứ gây ra sự "không
      // đủ tin cậy" đó. Giờ đã loại bỏ flag mặc định đó rồi, không còn
      // lý do gì để đèo thêm --disable-extensions-except nữa.
      launchOptions.args.push(`--load-extension=${joined}`);
    }
  }

  let context;
  try {
    // The core mechanic: launchPersistentContext keeps everything
    // (cookies, localStorage, IndexedDB, cache) in userDataDir, so
    // closing and relaunching this profile later picks up where it left off.
    context = await chromium.launchPersistentContext(userDataDir, launchOptions);

    try {
      // Must be registered before the first real navigation -- addInitScript
      // only affects documents created/navigated AFTER it's added, and we
      // want it in place for this very first page.goto() below, not just
      // future ones.
      //
      // Base stealth (navigator.webdriver) is unconditional -- every profile
      // launched by this app goes through CDP automation, whether or not it
      // also wants the deep canvas/WebGL/audio/font layer below.
      if (lay.stealth) await context.addInitScript(buildBaseStealthInitScript());

      // A small "which profile is this?" badge pinned to the corner of
      // every page this profile's window ever shows -- also unconditional.
      // Unlike the Run-script visible-cursor overlay (scripts/helpers.js),
      // this needs no script to be running: addInitScript re-injects it on
      // every navigation (new tab, page.goto, back/forward) automatically,
      // for as long as the window stays open, purely so a desk full of
      // open profile windows is identifiable at a glance.
      if (lay.badge) await context.addInitScript(buildProfileBadgeInitScript(profile.name)); // tầng "Nhãn tên profile" (bảng 🧬)

      // Same idea, but for the OS taskbar/Alt+Tab instead of the on-page
      // view -- prefixes every tab's document.title with the profile name.
      if (lay.title) await context.addInitScript(buildProfileTitleInitScript(profile.name)); // tầng "Tên profile ở tiêu đề tab" (bảng 🧬)

      // Deep fingerprint layer stays opt-in: profiles with `fingerprint: null`
      // launch exactly as before, just with the base stealth patch above.
      // Only profiles with a `fingerprint` object pay the extra cost of this one.
      if (fp) {
        await context.addInitScript(buildFingerprintInitScript(fp, '', lay)); // UA riêng: Client Hints do Chrome báo thẳng (setUserAgentOverride bên dưới) -- không giả bằng JS nữa (tránh lệch)
      }

      // User-Agent riêng: báo cho Chrome bộ Client Hints khớp UA đó (mỗi tab, cả tab mở sau) -- header Sec-CH-UA* gửi lên web + navigator.userAgentData
      // cùng version / hệ điều hành với UA. Chỉ đổi UA qua launchOptions.userAgent thì header vẫn báo version Chrome thật (lệch, web thấy được).
      if (launchOptions.userAgent) {
        const { metadata, navPlatform } = uaMetadataFor(launchOptions.userAgent, { brave: /brave\.exe$/i.test(launchOptions.executablePath || '') }); // Brave -> brand "Brave" (khớp header Brave tự gửi)
        const applyUA = async (p) => { try { const cdp = await context.newCDPSession(p); p.__pmUaCdp = cdp; await cdp.send('Emulation.setUserAgentOverride', { userAgent: launchOptions.userAgent, platform: fp ? fp.platform : navPlatform, userAgentMetadata: metadata }); } catch (e) {} }; // giữ phiên CDP sống: đóng phiên = mất override
        for (const p of context.pages()) await applyUA(p);
        context.on('page', applyUA);
      }

      // Không tự mở sẵn trang nào ở đây nữa -- main.js (script được chọn
      // để Run) đã tự gọi changeProxy() làm việc ĐẦU TIÊN rồi mới tự điều
      // hướng trang theo nhu cầu của nó, nên không cần (và không nên) tốn
      // thêm 1 lượt goto + đổi IP THỪA ở đây chỉ để có cái gì đó hiện ra
      // lúc mới mở Chrome. Cửa sổ mở lên là trang mặc định của Chromium
      // (hoặc trống), đợi bấm Run.
      const page = context.pages()[0] || (await context.newPage());

      await restoreSession(id, context).catch((e) => console.warn(`[session] ${id}: không khôi phục được phiên đăng nhập: ${e.message}`));
      const realClose = context.close.bind(context); // mọi chỗ tool đóng profile đều qua đây -> sao lưu phiên đăng nhập trước khi đóng
      context.close = async (...a) => { await backupSession(id, context).catch(() => {}); return realClose(...a); };
      const sessionTimer = setInterval(() => backupSession(id, context).catch(() => {}), SESSION_EVERY_MS); // tắt cửa sổ bằng nút X / tắt máy đột ngột vẫn còn bản gần nhất
      runningContexts[id] = { context, page };
      context.on('close', () => {
        clearInterval(sessionTimer);
        delete runningContexts[id];
        // If this profile was part of the queue's active batch, freeing its
        // slot is what lets the next pending profile launch -- see fillQueue().
        // Exception: a close between retry attempts (retryingIds) should NOT
        // free the slot or advance the queue -- the same profile is about to
        // relaunch right back into that slot. Only the FINAL close of a
        // retry cycle (success or attempts exhausted) reaches here with
        // retryingIds NOT containing this id.
        if (queue.active.has(id) && !retryingIds.has(id)) {
          queue.active.delete(id);
          delete queue.proxyById[id]; // trả lại proxy đã gán (nếu có) cùng lúc với slot
          fillQueue();
        }
      });
    } catch (innerErr) {
      // Context ĐÃ MỞ THẬT (browser process đã chạy) nhưng 1 bước sau đó
      // (addInitScript, ví dụ) lại throw TRƯỚC KHI kịp gán vào
      // runningContexts[id]. Trước đây: context này bị bỏ rơi vĩnh viễn --
      // không nằm trong runningContexts nên không API/nút Stop nào biết
      // nó tồn tại để đóng, cửa sổ cứ đứng đó mãi mãi (1 kiểu window
      // "treo" khác, không liên quan gì tới script loginTask.js). Đóng nó
      // ngay tại đây trước khi ném lỗi tiếp ra ngoài.
      await context.close().catch(() => {});
      throw innerErr;
    }
  } catch (err) {
    console.error('Launch failed:', err.message);

    let friendly = err.message;
    // Trước đây: hễ có CHROME_PATH là ĐÈ LUÔN err.message gốc thành câu
    // "Couldn't launch Chrome at ..." này, BẤT KỂ lỗi thật là gì -- kể cả
    // addInitScript lỗi vì lý do khác hẳn (Chrome vẫn mở HOÀN TOÀN BÌNH
    // THƯỜNG, path chrome.exe không hề sai). Log hiện ra sai lệch hoàn
    // toàn, khiến chẩn đoán sai be bét (y hệt trường hợp vừa xảy ra).
    // Giờ: chỉ đổi thành message "sai đường dẫn" khi lỗi THẬT SỰ trông
    // giống không tìm/chạy được executable -- các trường hợp khác GIỮ
    // NGUYÊN err.message gốc để còn biết lỗi thật.
    const looksLikeBadExecutable = /ENOENT|EACCES|Executable doesn'?t exist|Failed to launch/i.test(err.message);

    if (CHROME_PATH && looksLikeBadExecutable) {
      friendly = `Couldn't launch Chrome at "${CHROME_PATH}" (set in .env). Double-check that path.`;
    } else if (profile.engineMode === 'chromium' && err.message.includes('Executable doesn\'t exist')) {
      friendly = 'Chromium isn\'t downloaded yet. Run: npx playwright install chromium';
    } else if (profile.engineMode === 'chrome' && /channel|doesn\'t exist|not found/i.test(err.message)) {
      friendly = 'Couldn\'t find a system install of Google Chrome. Install Chrome, or switch this profile\'s engine back to "Bundled Chromium".';
    } else if (profile.engineMode === 'custom' && looksLikeBadExecutable) {
      friendly = `Couldn't launch the executable at "${profile.executablePath}". Double-check the path.`;
    }
    // Không khớp mẫu "path sai" nào ở trên -- friendly vẫn là err.message
    // gốc, không bị che nữa.

    throw httpError(500, friendly);
  }
}

// -------------------------------------------------------------------
// API: launch a profile -> opens a real, visible, isolated Chromium
// window configured with that profile's settings.
// -------------------------------------------------------------------
app.post('/api/profiles/:id/launch', async (req, res) => {
  try {
    await launchProfileById(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// -------------------------------------------------------------------
// Record thao tác tay trên cửa sổ profile đang mở -> code clickEl/typeEl... (xem recorder.js).
// Editor bấm "Record" -> start; nút ⏺ REC hiện trong trình duyệt của profile; "Chèn code" -> GET lấy code về.
// Bấm REC trong trình duyệt để dừng 1 đoạn -> code đoạn đó vào hàng đợi; editor hỏi GET ?since=<id export cuối> rồi tự chèn (exports + header).
// -------------------------------------------------------------------
app.post('/api/profiles/:id/recorder/start', async (req, res) => {
  const running = runningContexts[req.params.id];
  if (!running) return res.status(400).json({ error: 'Profile này chưa mở -- Launch trước rồi mới Record.' });
  try {
    // dữ liệu để gợi ý "lấy chữ gõ từ Excel / Google Sheet": cột khớp tên profile do editor gửi lên (giống ô chọn cột ở thanh bên trái)
    const profile = readProfiles().find((p) => p.id === req.params.id);
    const matchColumn = /^[A-Z]{1,3}$/.test(String((req.body || {}).matchColumn || '')) ? req.body.matchColumn : '';
    const data = { excelFile: EXCEL_SNAPSHOT_FILE, excelHeaderFile: path.join(DATA_DIR, 'excel-snapshot-header.json'), gsheetFile: path.join(DATA_DIR, 'google-sheet-snapshot.json'), matchColumn, profileName: profile ? profile.name : '',
      run: (code, input) => runScriptOnProfile(req.params.id, code, input, null, 'record-test.js') }; // nút ▶ Chạy thử trong bảng ☰ -- chạy y như Run
    const st = await startRecorder(req.params.id, running.context, data);
    (running.context.pages()[0] || running.page).bringToFront().catch(() => {});
    res.json(st);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/profiles/:id/recorder/stop', async (req, res) => {
  const running = runningContexts[req.params.id];
  res.json({ ...(await stopRecorder(req.params.id, running && running.context)), header: recorderHeader });
});
app.get('/api/profiles/:id/recorder', (req, res) => {
  res.json({ ...recorderState(req.params.id), code: recorderCode(req.params.id, req.query.require !== '0'), exports: recorderExports(req.params.id, +req.query.since || 0), header: recorderHeader });
});

// -------------------------------------------------------------------
// API: close a running profile's window without deleting it
// -------------------------------------------------------------------
app.post('/api/profiles/:id/close', async (req, res) => {
  const { id } = req.params;
  if (runningContexts[id]) {
    await runningContexts[id].context.close().catch(() => {});
    delete runningContexts[id];
  }
  res.json({ success: true });
});

// -------------------------------------------------------------------
// Force-close every window THIS server process currently knows about.
// Exists for two reasons:
//   1. A manual escape hatch -- if windows have piled up (a hung queue
//      script that never let its slot close, or profiles launched by
//      hand outside the queue), this is one call instead of clicking
//      Close on each one.
//   2. Reused by the shutdown handler below, so Ctrl+C / a graceful
//      server stop actually closes tracked windows instead of leaving
//      them as orphaned OS processes the next server run has no record
//      of (runningContexts is in-memory only -- see its declaration --
//      so a restart otherwise "forgets" every window that's still open).
//
// Deliberately does NOT touch queue.active/queue.pending -- if a queue is
// running, stop it first (POST /api/queue/stop) so it doesn't just
// relaunch replacements for everything this closes.
// -------------------------------------------------------------------
async function closeAllRunningContexts() {
  const ids = Object.keys(runningContexts);
  await Promise.all(
    ids.map((id) => runningContexts[id].context.close().catch(() => {}))
  );
  ids.forEach((id) => delete runningContexts[id]);
  return ids;
}

app.post('/api/profiles/close-all', async (req, res) => {
  const closed = await closeAllRunningContexts();
  res.json({ success: true, closed });
});

// -------------------------------------------------------------------
// "Clear cache" -- ONLY removes Chromium's own disk/code/GPU-shader
// caches for a profile. Deliberately does NOT touch anything that holds
// login state or site data: Cookies, Local Storage, Session Storage,
// IndexedDB, Login Data (saved passwords), Web Data (autofill),
// History, Preferences, or Network/Trust Tokens state -- all of those
// live in files/folders completely separate from the ones below.
// Chromium's own "Clear Browsing Data" dialog draws this exact same
// line, offering "Cached images and files" as an independent checkbox
// from "Cookies and other site data" / "Passwords" / "Autofill data" --
// this endpoint only ever does the equivalent of the first one. Safe to
// run on a profile with an active logged-in session; that session
// survives untouched, only re-downloadable junk (images/scripts/fonts/
// compiled shader & JS bytecode caches) gets deleted.
//
// This list covers every folder name we've seen across Chromium
// versions/platforms; whichever of these don't exist for a given
// profile/Chrome version are just silently skipped, not an error.
const CACHE_ONLY_DIR_NAMES = [
  'Cache', 'Code Cache', 'GPUCache',
  'DawnCache', 'DawnGraphiteCache', 'GraphiteDawnCache',
  'GrShaderCache', 'ShaderCache',
];

// These two live nested one level deeper (inside Default/Service
// Worker/) rather than directly under the profile root or Default/, so
// they're swept separately below instead of via CACHE_ONLY_DIR_NAMES.
// CacheStorage in particular is, in practice, the single biggest
// offender we've seen -- it's the Cache Storage API a site's OWN
// service worker uses (caches.open()/.put() in the page's own JS) to
// stash whatever responses IT wants for offline/fast access. For a
// media-heavy site that can reach into the GBs per profile, dwarfing
// "Cache"/"Code Cache" above -- but it's still pure re-downloadable
// cache, not anything resembling login/session state (X/Twitter's own
// auth lives in cookies, never touched here). Service worker
// REGISTRATIONS themselves live in Default/Service Worker/Database/,
// which is deliberately left alone -- that's closer to "site
// configuration" than "cache", and unregistering it isn't free (the
// site has to re-register its worker from scratch next visit).
// KHÔNG xoá 'Service Worker/ScriptCache' nữa: ngoài script của website,
// thư mục này còn chứa MÃ service worker của EXTENSION (VD background
// của Phantom). Xoá nó mà vẫn giữ Service Worker/Database (danh sách
// đăng ký) làm Chrome thấy đăng ký nhưng không có mã để chạy -> background
// Phantom không khởi động -> popup.html báo "Could not establish
// connection. Receiving end does not exist" và chỉ hiện màn hình đen.
const SERVICE_WORKER_CACHE_SUBDIRS = [
  ['Service Worker', 'CacheStorage'],
];

function dirSizeBytes(dir) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += dirSizeBytes(full);
    } else {
      try { total += fs.statSync(full).size; } catch { /* file vanished mid-scan -- ignore */ }
    }
  }
  return total;
}

// Cache folders can sit either directly under the profile root (some of
// the GPU/shader caches, depending on Chromium version) or inside
// Default/ (the HTTP + code cache) -- check both locations for every
// name instead of guessing which the installed Chrome version uses.
function clearProfileCache(userDataDir) {
  let freedBytes = 0;
  const roots = [userDataDir, path.join(userDataDir, 'Default')];
  for (const root of roots) {
    for (const name of CACHE_ONLY_DIR_NAMES) {
      const dir = path.join(root, name);
      if (!fs.existsSync(dir)) continue;
      freedBytes += dirSizeBytes(dir);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  // Service Worker/* only ever lives under Default/, one level deeper
  // than the flat names swept above.
  for (const relParts of SERVICE_WORKER_CACHE_SUBDIRS) {
    const dir = path.join(userDataDir, 'Default', ...relParts);
    if (!fs.existsSync(dir)) continue;
    freedBytes += dirSizeBytes(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return freedBytes;
}

app.post('/api/profiles/clear-cache', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Pick at least one profile.' });
  }

  const profiles = readProfiles();
  const results = [];
  for (const id of ids) {
    const profile = profiles.find((p) => p.id === id);
    const name = profile ? profile.name : id;

    // Chrome can hold its own cache files open -- same reason every
    // other endpoint here that touches a profile's files on disk
    // (fingerprint reset, delete) closes it first rather than deleting
    // out from under a live process.
    let closed = false;
    if (runningContexts[id]) {
      await runningContexts[id].context.close().catch(() => {});
      delete runningContexts[id];
      closed = true;
    }

    try {
      const freedBytes = clearProfileCache(path.join(PROFILES_ROOT, id));
      results.push({ id, name, freedBytes, closed });
    } catch (err) {
      results.push({ id, name, closed, error: err.message });
    }
  }

  const totalFreedBytes = results.reduce((sum, r) => sum + (r.freedBytes || 0), 0);
  res.json({ success: true, results, totalFreedBytes });
});

// -------------------------------------------------------------------
// API: run a snippet of Playwright code against a *running* profile's
// page. This is the learning-focused piece: `page` and `context` are
// real Playwright objects, so whatever you'd read in the Playwright
// docs (page.click(), page.fill(), page.locator(), ...) works here
// verbatim -- you're driving the exact same browser the "Launch"
// button opened, just via code instead of your mouse.
//
// Security note for yourself: this runs with the same privileges as
// this Node process on your machine (same as pasting code into `node`
// directly) -- fine for your own snippets, don't paste code from
// someone you don't trust.
// -------------------------------------------------------------------
// -------------------------------------------------------------------
// Shared script-execution core. Used by the manual /run route below AND
// by the queue's auto-run-then-close feature further down -- one
// mechanism, two triggers, so there's only one place that can have a bug.
// `page`, `context`, `log`, and `require` are the only things exposed --
// `require` is real Node require(), scoped to scripts/ (scopedRequire()
// near the top of this file).
// -------------------------------------------------------------------
// Dùng chung bởi log() và nhánh catch bên trong runScriptOnProfile bên
// dưới -- quét cả stack tìm dòng ĐẦU TIÊN trỏ vào 1 file thật của
// SCRIPT (main.js nhờ sourceURL, hoặc bất kỳ file nào trong scripts/
// qua require()), bỏ qua các frame nội bộ của Node (dạng "node:fs:...")
// và của chính server.js -- vì lỗi ném ra từ 1 API có sẵn (VD
// fs.readFileSync) sẽ có VÀI dòng đầu tiên nằm sâu trong nội bộ Node,
// dòng thật sự hữu ích (chỗ script gọi fs.readFileSync) nằm sau đó.
function firstUserFrameLocation(stack, scriptName) {
  const lines = (stack || '').split('\n');

  // SyntaxError lúc require() 1 file bị hỏng cú pháp có DÒNG ĐẦU TIÊN
  // của .stack khác hẳn 1 lỗi runtime bình thường: đúng
  // "duong/dan/file.js:SODONG" (không có số cột, không có "at ...") --
  // đây MỚI là vị trí lỗi THẬT (file/dòng thật sự bị hỏng cú pháp).
  // Không bắt riêng dòng này thì các frame "at ..." quét được ở dưới
  // (nếu có) chỉ dẫn tới chỗ GỌI require() tới file hỏng đó (dòng viết
  // require() trong file GỌI), không phải dòng cú pháp thật sự sai bên
  // trong file BỊ GỌI -- vừa bắt được sai đúng kiểu này: file A
  // require() file B bị lỗi cú pháp, log lại chỉ nhầm sang dòng
  // require() trong A thay vì dòng hỏng thật trong B.
  const syntaxErrorHeader = lines[0] && lines[0].match(/^(.+\.[mc]?js):(\d+)$/);
  if (syntaxErrorHeader) {
    return `${path.basename(syntaxErrorHeader[1])}:${syntaxErrorHeader[2]}`;
  }

  for (const raw of lines) {
    const match = raw.match(/\(?([^()\s]+):(\d+):\d+\)?\s*$/);
    if (!match) continue;
    const file = match[1];
    if (file.startsWith('node:') || file === '<anonymous>' || file.endsWith(`${path.sep}server.js`) || file === 'server.js') continue;
    const base = path.basename(file);
    // `new AsyncFunction(...)` luôn tự chèn thêm ĐÚNG 2 dòng vào TRƯỚC
    // phần thân code thật (dòng khai báo danh sách tham số, rồi dòng
    // ") {" mở hàm) -- nên dòng 1 thật trong script lại bị V8 báo thành
    // dòng 3. Trừ ngược lại 2 ở đây để số dòng hiện ra khớp CHÍNH XÁC
    // với số dòng bạn thấy trong chính editor. Chỉ áp dụng cho đúng file
    // được gắn sourceURL (script Run modal đang chạy) -- các file thật
    // trong scripts/ (qua require()) đã đúng dòng thật ngay từ đầu,
    // không đi qua AsyncFunction nên không dính offset này.
    const lineNo = base === scriptName ? Math.max(1, parseInt(match[2], 10) - 2) : match[2];
    return `${base}:${lineNo}`;
  }
  return null;
}

async function runScriptOnProfile(id, code, input = '', onLog = null, scriptName = 'main.js', deadlineAt = 0) {
  const running = runningContexts[id];
  if (!running) throw httpError(400, 'This profile is not running.');
  if (!code || !code.trim()) throw httpError(400, 'Write some code first.');

  // Cho script biết proxy + browser engine hiện tại của ĐÚNG profile
  // này -- Playwright không có API để tự hỏi context "proxy/engine của
  // mày là gì" (không có getter nào cho các launch-time option này),
  // và context/page cũng không có id/profile nào gắn sẵn (xem comment
  // ngay phía trên hàm này) -- nên phải tra lại profiles.json bằng
  // `id` đang có sẵn ở đây. Truyền vào dưới dạng object -- script
  // không dùng tới thì cứ để đó, không phá script cũ nào.
  const profiles = readProfiles();
  const profile = profiles.find((p) => p.id === id);
  const effProxy = effectiveProxyFor(id, profile); // PHẢI giống hệt proxy lúc launchProfileById mở Chrome -- changeProxy reset đúng proxy đang dùng
  const proxyInfo = {
    proxyServer: effProxy.proxyServer,
    proxyUsername: effProxy.proxyUsername,
    proxyPassword: effProxy.proxyPassword,
    resetUrl: effProxy.resetUrl || '', // link reset đi kèm dòng trong "Danh sách proxy" (rỗng nếu dùng proxy riêng của profile) -- xlv1_changeProxy.js ưu tiên link này
    // profileId/profileName -- để script tự biết CHÍNH NÓ là profile
    // nào (VD xlv1_markProfileForRecreate.js cần cái này để đánh dấu
    // đúng profile). Không có API Playwright nào cho context/page tự
    // biết id của chính nó, xem comment ở đầu hàm này.
    profileId: id,
    profileName: profile ? profile.name : '',
  };
  // executablePath/channel -- ĐÚNG logic ưu tiên khi launch thật (xem
  // launchProfileById), để 1 script tự launch thêm 1 browser khác (VD
  // cửa sổ ẩn danh) vẫn dùng đúng cùng loại Chrome, không rơi về
  // Chromium bundled mặc định của Playwright (có thể chưa cài trên máy
  // này nếu chỉ dùng Chrome Portable/Chrome thật riêng).
  if (CHROME_PATH) {
    proxyInfo.executablePath = CHROME_PATH;
  } else if (profile && profile.engineMode === 'chrome') {
    proxyInfo.channel = 'chrome';
  } else if (profile && profile.engineMode === 'custom' && profile.executablePath) {
    proxyInfo.executablePath = profile.executablePath;
  }

  const logs = [];
  // onLog (nếu có) được gọi NGAY LẬP TỨC mỗi khi script gọi log(...) --
  // trước đây log(...) chỉ push vào mảng `logs` NẰM TRONG BỘ NHỚ, và mảng
  // đó chỉ được ai đó nhìn thấy SAU KHI `run(...)` bên dưới resolve hoặc
  // reject xong (return/throw). Nếu script bị treo vô hạn (không bao giờ
  // resolve/reject -- ví dụ 1 vòng while(true) không có trần), TOÀN BỘ
  // log tích luỹ bên trong (kể cả các dòng lỗi lặp lại) không bao giờ lộ
  // ra ngoài -- nhìn từ UI, 1 profile treo LUÔN hiện log trống trơn, dù
  // bên trong nó có đang chạy/lỗi liên tục hay không, khiến không cách
  // nào phân biệt được "treo do đang chạy" với "chưa từng chạy tới".
  // Giờ runQueueScriptThenClose truyền vào 1 onLog đẩy thẳng ra queueLog()
  // -- log hiện real-time trên UI ngay cả khi script chưa (và có thể sẽ
  // không bao giờ) resolve/reject.
  const log = (...args) => {
    const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');

    // Tự thêm [tenFile.js:soDong] vào đầu mỗi dòng -- trước đây log()
    // chỉ hiện đúng NỘI DUNG bạn truyền vào, không có cách nào biết dòng
    // đó xuất phát từ file nào/dòng nào trong lúc soi log 1 lần chạy dài
    // (VD lúc điều tra vụ timeout 120s, hay việc treo giữa chừng ở
    // notes.txt trước đây -- cả 2 lần đó đều phải tự đọc code đoán mò).
    //
    // Cách lấy: new Error().stack tại ĐÚNG chỗ này -- dòng [0] luôn là
    // "Error", dòng [1] luôn là CHÍNH hàm log() này (bỏ qua, vô nghĩa vì
    // luôn là server.js), dòng [2] mới là nơi THẬT SỰ đã gọi log(...):
    //   - Nếu gọi từ ngay trong main.js (hay bất kỳ script nào được chọn
    //     làm entry point) -- SẼ hiện đúng "scriptName:dòng" nhờ
    //     //# sourceURL bên dưới (không có dòng đó, V8 chỉ hiện
    //     "<anonymous>" vì code này được build bằng `new AsyncFunction`
    //     từ 1 CHUỖI, không phải từ 1 file thật trên đĩa).
    //   - Nếu gọi từ 1 file trong scripts/ (interactX.js,
    //     xlv3_follow_friends.js, ...) qua require() -- TỰ ĐỘNG đúng
    //     luôn, không cần làm gì thêm, vì đây là file thật, Node vốn đã
    //     biết chính xác đường dẫn + dòng của nó.
    const loc = firstUserFrameLocation((new Error().stack || '').split('\n')[2], scriptName);
    const tagged = loc ? `[${loc}] ${line}` : line;

    logs.push(tagged);
    if (onLog) onLog(tagged);
  };

  // resultStatus -- mặc định null (nghĩa là "chạy xong bình thường" ->
  // runQueueScriptThenClose tự ghi 'success' như cũ). Script gọi
  // yellow(value, expected) để ĐÁNH DẤU lần chạy này là 1 trường hợp đặc
  // biệt (VD tài khoản X bị suspend -- script vẫn kết thúc bình thường,
  // không throw, nhưng không nên hiện màu xanh "thành công" y hệt 1
  // profile chạy trọn vẹn). Khi value === expected, resultStatus chuyển
  // thành 'warning' -- runQueueScriptThenClose ưu tiên giá trị này thay
  // vì ghi đè lại thành 'success', và editor.js tô chấm tròn màu vàng
  // cho đúng status đó (xem is-warning trong editor.css).
  let resultStatus = null;
  const yellow = (value, expected) => {
    if (value === expected) {
      resultStatus = 'warning';
      log(`[status] Đánh dấu kết quả màu vàng (${JSON.stringify(value)} === ${JSON.stringify(expected)}).`);
    }
  };

  let traced = false;
  try {
    clearScriptsRequireCache();
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    // //# sourceURL cho V8 1 "tên file" để gắn vào stack trace của code
    // này -- không có dòng này, code build từ chuỗi qua `new
    // AsyncFunction` không có file thật nào đứng sau nó cả, nên mọi
    // stack trace/log() gọi từ NGAY TRONG main.js (không qua require())
    // sẽ hiện "<anonymous>" thay vì "main.js:42". Đây LÀ tên file thật
    // (main.js) khi chạy tự động qua queue; khi Run modal chọn 1 tab
    // khác làm entry point, server.js truyền đúng tên file đó vào qua
    // tham số scriptName (xem /api/queue/start).
    const run = new AsyncFunction('page', 'context', 'log', 'require', 'input', 'proxyInfo', 'yellow', `${code}\n//# sourceURL=${scriptName}`);
    // Mốc hết giờ của script (theo "script timeout" của queue, 0 = không giới hạn) -- gắn lên page để script nào cần (VD interactX
    // lướt Home + chèn task) tự co thời gian lại cho kịp, không bị cắt ngang giữa chừng. Không đổi tham số của main.js.
    running.page.__scriptDeadlineAt = deadlineAt || 0;
    running.page.__profileId = id; // xlv1_humanInput.js: mỗi profile 1 "kiểu tay" cố định (tốc độ chuột, nhịp gõ...) theo id
    const resumeRec = pauseRecorder(id); // đang Record thì tạm dừng ghi -- chuột/phím do script gửi cũng là sự kiện "thật", không thì bị ghi lẫn vào
    // Playwright trace: ghi lại từng bước (ảnh, DOM, selector khớp gì, click vào đâu) -- CHỈ lưu file khi script lỗi (xem catch bên dưới),
    // chạy xong không lỗi thì bỏ. Mở bằng: npx playwright show-trace "<file>". Tắt hẳn: PM_TRACE=0 trong .env.
    // traced: CHÍNH lần chạy này bật trace (chạy lồng -- VD ▶ Chạy thử lúc script khác đang chạy -- thì trace đang bật, để lần ngoài tự lo)
    traced = process.env.PM_TRACE !== '0' && !running.__tracing && (running.__tracing = await running.context.tracing.start({ screenshots: true, snapshots: true }).then(() => true, () => false));
    let result;
    try { result = await run(running.page, running.context, log, scopedRequire, input, proxyInfo, yellow); } finally { resumeRec(); }
    if (traced) { running.__tracing = false; await running.context.tracing.stop().catch(() => {}); } // không lỗi -> bỏ trace
    return { logs, result: result === undefined ? null : result, resultStatus };
  } catch (err) {
    if (traced) { // lỗi -> lưu trace, giữ 30 file mới nhất
      running.__tracing = false;
      try {
        const traceDir = path.join(DATA_DIR, 'traces');
        fs.mkdirSync(traceDir, { recursive: true });
        const tracePath = path.join(traceDir, `trace-${scriptName || 'script'}-${id}-${Date.now()}.zip`.replace(/[/\\:*?"<>|]/g, '_'));
        await running.context.tracing.stop({ path: tracePath });
        log(`[trace] Đã lưu diễn biến lúc lỗi: ${tracePath} -- mở bằng: npx playwright show-trace "${tracePath}"`);
        const old = fs.readdirSync(traceDir).filter((f) => f.endsWith('.zip')).map((f) => ({ f, t: fs.statSync(path.join(traceDir, f)).mtimeMs })).sort((a, b) => b.t - a.t).slice(30);
        for (const o of old) fs.unlinkSync(path.join(traceDir, o.f));
      } catch (traceErr) { log(`[trace] Không lưu được trace: ${traceErr.message}`); }
    }
    // Chụp màn hình cho MỌI script khi lỗi -- tập trung ở đây thay vì
    // để từng script tự lo. Trước đây chỉ vài script LOGIN
    // (xlv3_loginX.js, loginTask.js, Logintaskon.js, xlv3_loginByCookie.js)
    // tự định nghĩa debugShot() riêng bên trong nó; toàn bộ nhóm script
    // TƯƠNG TÁC (xlv3_retweet_targettw, xlv2_openTweetDetail,
    // xlv3_follow_friends, xlv3_like_tweet, interactX...) chưa bao giờ có
    // dòng screenshot nào cả. Nên khi lỗi chuyển từ khâu login sang khâu
    // tương tác, ảnh debug "biến mất" -- không phải tính năng bị hỏng, mà
    // là nó chưa từng tồn tại ở nhánh script đang chạy.
    //
    // PHẢI dùng log(...) chứ KHÔNG phải logs.push(...): catch block của
    // runQueueScriptThenClose cố tình KHÔNG forEach lại err.logs nữa (xem
    // comment của nó) vì mọi thứ đã được stream real-time qua onLog --
    // mà onLog chỉ được gọi từ bên trong log(). Push thẳng vào mảng
    // `logs` thì dòng đó không bao giờ tới được UI, nên nhìn từ ngoài
    // trông hệt như "không có ảnh nào được chụp".
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true }); // DATA_DIR có thể nằm ở ổ khác (VD F:\) -- đảm bảo tồn tại trước khi ghi
      const shotPath = path.join(
        DATA_DIR,
        `error-${scriptName || 'script'}-${id}-${Date.now()}.png`.replace(/[/\\:*?"<>|]/g, '_')
      );
      await running.page.screenshot({ path: shotPath });
      log(`[error-screenshot] Đã chụp màn hình lúc lỗi: ${shotPath}`);
      console.log(`[error-screenshot] ${shotPath}`); // hiện cả ở terminal chạy server -- kiểm chứng được kể cả khi bỏ lỡ log trên UI
    } catch (shotErr) {
      log(`[error-screenshot] Không chụp được màn hình lúc lỗi: ${shotErr.message}`);
      console.warn(`[error-screenshot] failed: ${shotErr.message}`);
    }

    // Cùng 1 kiểu gắn vị trí như log() ở trên, nhưng quét CẢ stack (xem
    // firstUserFrameLocation) thay vì chỉ đúng 1 dòng cố định -- lỗi ném
    // từ 1 API có sẵn (VD fs.readFileSync bị ENOENT, xem vụ notes.txt
    // trước đây) có vài dòng đầu nằm trong nội bộ Node, phải bỏ qua
    // chúng mới tới được dòng thật sự hữu ích: chỗ script gọi API đó.
    const loc = firstUserFrameLocation(err.stack, scriptName);
    const wrapped = httpError(400, loc ? `[${loc}] ${err.message}` : err.message);
    wrapped.logs = logs;
    throw wrapped;
  }
}

app.post('/api/profiles/:id/run', async (req, res) => {
  try {
    const { logs, result } = await runScriptOnProfile(req.params.id, req.body.code, req.body.input, null, req.body.scriptName);
    res.json({ success: true, logs, result });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, logs: err.logs || [], error: err.message });
  }
});

// -------------------------------------------------------------------
// Queue: run a specific set of profiles with a max-concurrency limit.
// You pick which profiles and in what order; as each one's window
// closes, the next pending one launches automatically -- this is what
// answers "only keep N windows open, auto-advance as each one ends."
//
// Optionally, `queue.script` runs automatically on every profile the
// queue launches; when that script finishes (success OR error), the
// profile closes on its own -- reusing the exact same context.on('close')
// -> fillQueue() chain a manual close already triggers. No separate
// "advance" logic was needed for this feature; it plugs into the existing
// pipe.
//
// retryCount > 0 relaunches the SAME profile fresh and tries again if a
// run fails -- see retryingIds above launchProfileById, which keeps the
// intermediate closes between attempts from prematurely freeing this
// profile's concurrency slot to some other pending profile.
// -------------------------------------------------------------------
let queueGeneration = 0;

let queue = {
  pending: [], // profile ids not yet launched, in the order they'll launch
  active: new Set(), // profile ids THIS queue currently has running
  maxConcurrent: 1,
  maxPerProxy: 0, // 0 = không giới hạn -- tối đa bao nhiêu profile CÙNG LÚC dùng chung 1 proxyServer
  proxyById: {}, // profile id -> proxy được gán từ "Danh sách proxy" cho lượt chạy này (xem effectiveProxyFor); trả lại khi profile rời queue.active
  poolWaitLogged: false, // đã log "đang chờ vì danh sách proxy hết chỗ" chưa -- chỉ log 1 lần mỗi đợt chờ, không spam
  running: false,
  script: '', // optional: code to auto-run on each launched profile
  retryCount: 0, // extra attempts (relaunch + rerun) after a failure, same profile
  inputsById: {}, // profile id -> input string, available to the script as `input`
  log: [], // human-readable event feed, newest last, capped -- for the UI
  // 0 = no timeout (old behavior, unchanged by default). If > 0, a queue
  // script that runs longer than this is treated as a FAILED attempt and
  // the profile is force-closed -- without this, a script stuck waiting on
  // a selector/dialog that never appears holds its concurrency slot (and
  // its window) open forever, which is what actually causes "max N at a
  // time" to look like it's not being respected: it's not that more than N
  // launch, it's that a stuck one never frees its seat for the next one.
  scriptTimeoutMs: 0,
  // id -> { name, status: 'pending'|'running'|'success'|'failed' }. Why
  // this exists separately from `log` above: `log` is capped (see
  // queueLog()) because a verbose script can log dozens of lines PER
  // PROFILE, and with enough profiles running that total can blow past
  // any reasonable cap -- when it does, queueLog() evicts the OLDEST
  // lines to make room, which used to mean the EARLIEST profiles' only
  // trace in `log` (their "Launched"/"succeeded" lines) got evicted
  // first, and the whole profile visually vanished from the Run modal's
  // sidebar even though it plainly did run. `resultsById` holds exactly
  // ONE entry per profile no matter how chatty its script is, so it's
  // cheap enough (a few hundred bytes even at thousands of profiles) to
  // never cap at all -- a profile's row and color are authoritative and
  // permanent for the life of the run; `log` remains just the scrollable
  // detail feed underneath it.
  resultsById: {},
};

// Updates a profile's authoritative status (see resultsById above).
// `name` is optional so a later call (e.g. a terminal status) can omit
// it and keep whatever name an earlier call already recorded.
function setQueueResult(id, name, status) {
  const prev = queue.resultsById[id];
  queue.resultsById[id] = { name: name || (prev && prev.name) || id, status };
}

const retryingIds = new Set(); // ids currently between retry attempts -- see the close listener in launchProfileById

// Each entry carries WHICH profile it's about (when there is one --
// "Queue started"/"Queue stopped" aren't about any single profile, so
// profileId/profileName stay null for those). This is what lets the
// Logs view (editor.js) group/filter entries per profile instead of
// one undifferentiated stream -- `message` still carries the same
// human-readable text as before (quoted name included) so nothing that
// already just joins these into a scrolling feed needs to change.
// Cap raised from 50 to 2000: the old cap was sized for a compact
// "recent activity" glance; the dedicated Logs view is meant for
// reviewing a whole run's history, so the same 50-entry cap would
// start silently dropping early profiles' logs on any queue bigger
// than a handful of profiles.
// Cap RIÊNG theo từng profileId, KHÔNG dùng chung 1 cap cho cả mảng.
// Trước đây `if (queue.log.length > 2000) queue.log.shift()` xoá dòng
// CŨ NHẤT của TOÀN BỘ mảng bất kể thuộc profile nào -- 1 run 100 profile,
// mỗi profile log vài chục dòng (login/link X/retweet/follow...) là thừa
// sức vượt 2000 dòng rất lâu trước khi chạy tới profile ~99, kéo theo
// log chi tiết của profile 1..45 bị đẩy ra mất sạch dù ROW của chúng
// (lấy từ resultsById, không phải từ đây) vẫn còn hiển thị bình thường.
// Giờ: mỗi profileId (và cả các dòng "Queue" chung, profileId = null)
// được giữ tối đa LOG_CAP_PER_KEY dòng riêng của nó -- 1 profile chạy
// lặp/log nhiều không còn đẩy mất log của profile khác nữa. Vẫn giữ
// thêm 1 trần tổng LOG_CAP_TOTAL để mảng không phình vô hạn nếu 1 run
// có hàng nghìn profile.
const LOG_CAP_PER_KEY = 500;
const LOG_CAP_TOTAL = 50000;

function queueLog(message, profileId = null, profileName = null) {
  const stamp = new Date().toLocaleTimeString();
  queue.log.push({ time: stamp, profileId, profileName, message: `${stamp}  ${message}` });

  // Đếm ngược từ cuối mảng lên: đủ LOG_CAP_PER_KEY dòng của CÙNG profileId
  // (kể cả dòng vừa push) thì dòng CŨ NHẤT của riêng profileId đó (dòng
  // đầu tiên gặp khi đếm ngược, tức xa cuối mảng nhất trong số đã đếm) bị
  // xoá. Chỉ cần xoá đúng 1 dòng mỗi lần push là đủ giữ cap ổn định.
  let countForKey = 0;
  for (let i = queue.log.length - 1; i >= 0; i--) {
    if (queue.log[i].profileId === profileId) {
      countForKey++;
      if (countForKey > LOG_CAP_PER_KEY) {
        queue.log.splice(i, 1);
        break;
      }
    }
  }

  if (queue.log.length > LOG_CAP_TOTAL) queue.log.shift();
}

// Runs queue.script against a just-launched profile, retrying (relaunch +
// rerun, same profile) up to queue.retryCount extra times on failure, then
// closes it for good. NOT awaited by fillQueue's loop -- runs in the
// background so maxConcurrent profiles are genuinely concurrent instead of
// the loop blocking on one full retry cycle at a time.
// -------------------------------------------------------------------
// Xoá + tạo lại (CÙNG TÊN) 1 profile mà chính nó đã tự đánh dấu qua
// xlv1_markProfileForRecreate.js -- script chạy BÊN TRONG profile đó
// không thể tự xoá chính mình giữa chừng (Chrome của nó đang mở), nên
// chỉ ghi lại 1 "phiếu hẹn"; hàm này đọc phiếu hẹn đó và thực thi thật
// SAU KHI profile đã đóng hẳn (gọi từ cuối runQueueScriptThenClose).
//
// Giữ NGUYÊN proxy/viewport/locale/timezone/engine của profile cũ --
// chỉ id + fingerprint + dữ liệu trên đĩa (cookie/session/cache...) là
// mới hoàn toàn. Nếu không có phiếu hẹn nào cho id này thì không làm
// gì cả (đường thoát nhanh, không phải lỗi).
// -------------------------------------------------------------------
const PENDING_RECREATE_FILE = path.join(DATA_DIR, 'pending-profile-recreate.json');

async function consumePendingRecreate(id) {
  const lockFile = PENDING_RECREATE_FILE + '.lock';
  const maxLockAttempts = 30;
  const lockRetryDelayMs = 200;
  const staleLockMs = 30000;

  let locked = false;
  for (let attempt = 0; attempt < maxLockAttempts; attempt++) {
    try {
      fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
      locked = true;
      break;
    } catch (e) {
      try {
        const stat = fs.statSync(lockFile);
        if (Date.now() - stat.mtimeMs > staleLockMs) fs.unlinkSync(lockFile);
      } catch (e2) { /* lock vừa bị xoá bởi process khác giữa lúc kiểm tra -- bỏ qua */ }
      await new Promise((resolve) => setTimeout(resolve, lockRetryDelayMs));
    }
  }
  if (!locked) {
    queueLog(`[recreate] Không lấy được khoá pending-recreate cho "${id}" -- bỏ qua lần này, phiếu hẹn (nếu có) vẫn còn nguyên để lần đóng tiếp theo thử lại.`);
    return;
  }

  // Giữ khoá này XUYÊN SUỐT tới hết việc xoá + ghi profiles.json bên
  // dưới -- KHÔNG chỉ lúc đọc/ghi PENDING_RECREATE_FILE như bản trước
  // (bản trước nhả khoá ra ngay sau đoạn try/finally nhỏ này, RỒI MỚI
  // đọc/ghi profiles.json ở ngoài khoá). 2 profile được đánh dấu
  // recreate gần như cùng lúc cũng đang cùng gọi readProfiles() +
  // writeProfiles() lên CHUNG 1 file profiles.json -- không khoá xuyên
  // suốt thì request thứ 2 hoàn toàn có thể readProfiles() TRƯỚC KHI
  // request thứ nhất kịp writeProfiles() xong, rồi ghi đè lại đúng bản
  // CŨ đó, xoá mất luôn profile mới mà request thứ nhất vừa tạo. Đây
  // chính là lý do một số profile về sau trong 1 lô lớn bị "mất tên":
  // server không còn tìm thấy entry tương ứng trong profiles.json nữa
  // nên phải hiện tạm ID thay cho tên.
  try {
    let matched = null;
    try {
      const list = fs.existsSync(PENDING_RECREATE_FILE) ? JSON.parse(fs.readFileSync(PENDING_RECREATE_FILE, 'utf-8')) : [];
      matched = list.find((item) => item.profileId === id);
      if (matched) {
        fs.writeFileSync(PENDING_RECREATE_FILE, JSON.stringify(list.filter((item) => item.profileId !== id)));
      }
    } catch (err) {
      queueLog(`[recreate] Lỗi đọc/ghi phiếu hẹn cho "${id}": ${err.message}`);
      return;
    }

    if (!matched) return; // không có phiếu hẹn nào cho profile này -- không có gì để làm

    const profiles = readProfiles();
    const oldProfile = profiles.find((p) => p.id === id);
    if (!oldProfile) {
      queueLog(`[recreate] "${matched.profileName}" (${id}) đã bị xoá từ trước bằng cách khác -- bỏ qua phiếu hẹn này.`);
      return;
    }

    queueLog(`[recreate] "${oldProfile.name}" được đánh dấu là tài khoản mới -- xoá và tạo lại (giữ nguyên proxy/viewport/locale/timezone/engine, fingerprint mới)...`, id, oldProfile.name);

    // Xoá thư mục dữ liệu cũ có thể fail -- đặc biệt trên Windows, nơi
    // Chrome vừa đóng đôi khi vẫn giữ khoá thêm một nhịp trên vài file
    // trong đó (lỗi kiểu EBUSY/EPERM). Trước đây lỗi này ném thẳng ra
    // ngoài, làm consumePendingRecreate() chết giữa chừng -- profile
    // MỚI không bao giờ được tạo, còn id cũ thì coi như "mồ côi" khỏi
    // hệ thống (không còn trong profiles.json, không có gì thay thế).
    // Giờ bắt lại, log cảnh báo, rồi vẫn tiếp tục tạo profile mới bình
    // thường; thư mục cũ nếu còn sót chỉ là rác trên đĩa, dọn tay sau
    // cũng được, không ảnh hưởng gì tới profile mới.
    try {
      await deleteProfileById(id);
    } catch (err) {
      queueLog(`[recreate] Không xoá được thư mục dữ liệu cũ của "${oldProfile.name}" (${id}): ${err.message} -- vẫn tiếp tục tạo profile mới.`, id, oldProfile.name);
    }

    const remaining = readProfiles().filter((p) => p.id !== id);

    const newProfile = buildProfileObject(
      {
        name: oldProfile.name,
        userAgent: oldProfile.userAgent,
        viewportWidth: oldProfile.viewportWidth,
        viewportHeight: oldProfile.viewportHeight,
        locale: oldProfile.locale,
        timezoneId: oldProfile.timezoneId,
        proxyServer: oldProfile.proxyServer,
        proxyUsername: oldProfile.proxyUsername,
        proxyPassword: oldProfile.proxyPassword,
        engineMode: oldProfile.engineMode,
        executablePath: oldProfile.executablePath,
        autoFingerprint: true, // luôn sinh fingerprint MỚI -- không copy fingerprint cũ
      },
      oldProfile.name
    );
    remaining.push(newProfile);
    writeProfiles(remaining);

    queueLog(
      `[recreate] Đã tạo lại "${newProfile.name}" (id mới: ${newProfile.id}, fingerprint mới: ${newProfile.fingerprint ? newProfile.fingerprint.label : '(không có)'}).`,
      newProfile.id,
      newProfile.name
    );

    if (matched.excelRow !== undefined && matched.excelRow !== null) {
      try {
        const { writeExcelCell } = require('./scripts/writeExcelCell');
        await writeExcelCell(matched.excelRow, 'C', '');
        queueLog(`[recreate] Đã xoá giá trị "new_account" ở cột C dòng ${matched.excelRow}.`);
      } catch (err) {
        queueLog(`[recreate] [lỗi] Không xoá được cột C dòng ${matched.excelRow}: ${err.message}`);
      }
    }
  } catch (err) {
    // Lưới an toàn cuối cùng -- KHÔNG được để lỗi ở đây thoát ra ngoài
    // thành unhandled rejection: hàm này được `await` từ cuối
    // runQueueScriptThenClose(), nhưng CHÍNH runQueueScriptThenClose lại
    // được fillQueue() gọi mà KHÔNG await (chạy nền) -- nếu nó throw,
    // không có ai bắt cả.
    queueLog(`[recreate] Lỗi không lường trước khi tái tạo "${id}": ${err.message}`);
  } finally {
    fs.unlinkSync(lockFile);
  }
}

async function runQueueScriptThenClose(id, name) {
  const maxAttempts = 1 + Math.max(0, queue.retryCount || 0);
  const input = queue.inputsById[id] || '';
  let attempt = 1;
  let succeeded = false;

  while (attempt <= maxAttempts) {
    // Còn lượt retry -> đánh dấu NGAY TỪ ĐẦU lượt chạy (không phải đợi tới lúc lỗi): cửa sổ bị đóng GIỮA CHỪNG (bạn tắt tay, Chrome sập)
    // sẽ KHÔNG trả slot/proxy cho profile khác, vì ngay sau đó chính profile này mở lại để retry -- trước đây slot bị trả sớm, profile
    // khác mở vào, rồi profile này mở lại -> vượt số cửa sổ đã đặt (VD đặt 4 mà mở 6). Lượt CUỐI thì không đánh dấu: đóng là trả slot.
    if (attempt < maxAttempts) retryingIds.add(id); else retryingIds.delete(id);
    try {
      // NOTE on the timeout race: we can't truly cancel a running async
      // function in JS, so if this times out the original
      // runScriptOnProfile() call keeps executing in the background for a
      // little longer. That's fine here -- we're about to force-close this
      // profile's context right below regardless of which side of the race
      // won, and whatever the abandoned call eventually does with a closed
      // page/context is simply ignored (its logs/result are never read).
      //
      // onLog đẩy từng dòng log(...) của script ra queueLog() NGAY LẬP
      // TỨC, không đợi runScriptOnProfile() resolve/reject -- trước đây
      // chỉ forEach mảng `logs` SAU KHI đã có kết quả (xem lịch sử ngay
      // dưới), nghĩa là 1 script treo vô hạn (không resolve/reject bao
      // giờ) sẽ không bao giờ lộ ra dòng log nào cả, dù bên trong nó có
      // đang chạy/lỗi liên tục hay không -- không cách nào phân biệt
      // "đang treo" với "chưa từng chạy tới" chỉ bằng cách nhìn log.
      const onLog = (line) => queueLog(line, id, name);
      const deadlineAt = queue.scriptTimeoutMs > 0 ? Date.now() + queue.scriptTimeoutMs : 0;
      const scriptOutcome = await (queue.scriptTimeoutMs > 0
        ? Promise.race([
            runScriptOnProfile(id, queue.script, input, onLog, queue.scriptName, deadlineAt),
            new Promise((_, reject) =>
              setTimeout(() => reject(httpError(408, `Script timed out after ${queue.scriptTimeoutMs}ms`)), queue.scriptTimeoutMs)
            ),
          ])
        : runScriptOnProfile(id, queue.script, input, onLog, queue.scriptName, deadlineAt));
      // Không cần forEach `logs` ở đây nữa -- onLog ở trên đã đẩy từng
      // dòng ra real-time trong lúc script chạy rồi, forEach lại sẽ hiện
      // trùng lặp mỗi dòng 2 lần.
      queueLog(`"${name}" succeeded (attempt ${attempt}/${maxAttempts}), closing`, id, name);
      // scriptOutcome.resultStatus: null bình thường (ghi 'success' như
      // cũ); 'warning' nếu script tự gọi yellow(...) đánh dấu -- xem
      // comment resultStatus trong runScriptOnProfile().
      setQueueResult(id, name, (scriptOutcome && scriptOutcome.resultStatus) || 'success');
      succeeded = true;
    } catch (err) {
      // Tương tự -- err.logs không cần forEach lại nữa, đã lên màn hình
      // real-time qua onLog trong lúc script còn đang chạy (kể cả tới
      // đúng dòng làm nó throw).
      queueLog(`"${name}" attempt ${attempt}/${maxAttempts} failed: ${err.message}`, id, name);
    }

    const willRetry = !succeeded && attempt < maxAttempts;
    if (!willRetry) retryingIds.delete(id); // lần đóng này là lần CUỐI của chu kỳ (xong / hết lượt) -> listener 'close' trả slot + gọi fillQueue như bình thường

    if (runningContexts[id]) {
      await runningContexts[id].context.close().catch(() => {});
      // .close() fires the 'close' listener registered in launchProfileById.
      // If willRetry, retryingIds suppresses the advance-queue side effect;
      // otherwise it runs normally (delete from active, fillQueue()).
    }

    if (!willRetry) break;

    attempt++; // retryingIds vẫn giữ id trong lúc mở lại -- đầu vòng lặp sau tự bỏ đánh dấu nếu đây là lượt cuối
    try {
      queueLog(`"${name}" relaunching for retry ${attempt}/${maxAttempts}`, id, name);
      await launchProfileById(id);
    } catch (err) {
      queueLog(`"${name}" couldn't relaunch for retry: ${err.message}`, id, name);
      retryingIds.delete(id); queue.active.delete(id); delete queue.proxyById[id]; fillQueue(); // không có cửa sổ nào để đóng => không có sự kiện 'close' nào trả slot -- phải tự trả slot/proxy + gọi fillQueue(), nếu không slot kẹt vĩnh viễn (chạy 4 cửa sổ thì rớt dần còn 2, queue không bao giờ kết thúc)
      break;
    }
  }

  if (!succeeded) {
    queueLog(`"${name}" gave up after ${Math.min(attempt, maxAttempts)} attempt(s)`, id, name);
    setQueueResult(id, name, 'failed');
    // The relaunch above (if it happened) needs its OWN close to actually
    // advance the queue, since we broke out without another success/retry
    // pass to do it. If we broke out right after a relaunch failure, there's
    // nothing running to close, which is also fine.
    if (runningContexts[id]) {
      await runningContexts[id].context.close().catch(() => {});
    }
  }

  // Luôn kiểm tra phiếu hẹn xoá-tạo-lại ở đây -- dù thành công hay
  // thất bại, profile chắc chắn đã đóng hẳn bằng lúc này (mọi nhánh ở
  // trên đều đã .close() xong), nên an toàn để đụng vào thư mục dữ
  // liệu của nó nếu có phiếu hẹn từ xlv1_markProfileForRecreate.js.
  await consumePendingRecreate(id);

  // Tự xoá cache SAU KHI đã xử lý xong phiếu hẹn tái tạo ở trên -- nếu
  // profile này vừa bị xoá-tạo-lại thì thư mục cũ (đúng "id" này) đã
  // không còn nữa, clearProfileCache() chỉ đơn giản không tìm thấy gì
  // để xoá (mọi fs.existsSync bên trong nó trả về false), không lỗi gì
  // cả. Chỉ xoá đúng các thư mục cache (xem CACHE_ONLY_DIR_NAMES) --
  // cookie/localStorage/IndexedDB/session đăng nhập không đụng tới,
  // dùng chung logic với nút "Clear cache" thủ công trên dashboard.
  if (AUTO_CLEAR_CACHE_AFTER_RUN) {
    try {
      const freedBytes = clearProfileCache(path.join(PROFILES_ROOT, id));
      if (freedBytes > 0) {
        queueLog(`[cache] Đã xoá cache của "${name}" (${(freedBytes / (1024 * 1024)).toFixed(1)} MB).`, id, name);
      }
    } catch (err) {
      queueLog(`[cache] Không xoá được cache của "${name}": ${err.message}`, id, name);
    }
  }
}

// Đếm bao nhiêu profile ĐANG CHẠY (queue.active) dùng CHUNG 1
// proxyServer cụ thể -- dùng để chặn không cho quá maxPerProxy profile
// cùng dùng 1 proxy chạy đồng thời.
//
// Profile KHÔNG gán proxy (proxyServer rỗng) được coi là thuộc về 1
// "nhóm proxy ảo" riêng (nhóm "rỗng") -- CŨNG bị áp dụng đúng giới hạn
// maxPerProxy như mọi proxy thật khác, không được miễn trừ. VD:
// maxPerProxy=1 thì trong số các profile không gán proxy, cũng chỉ có
// đúng 1 cái chạy cùng lúc, không phải chạy thoải mái theo maxConcurrent.
function countActiveByProxy(proxyServer, profiles) {
  let count = 0;
  for (const activeId of queue.active) {
    const p = profiles.find((pr) => pr.id === activeId);
    if (p && p.proxyServer === proxyServer) count++;
  }
  return count;
}

async function fillQueue(generation = queueGeneration) {
  // A queue run is immutable while it is active. The generation guard also
  // protects against any already-running fillQueue() continuation after a
  // stop/start transition.
  if (generation !== queueGeneration || !queue.running) return;

  while (generation === queueGeneration && queue.running && queue.active.size < queue.maxConcurrent && queue.pending.length > 0) {
    const profiles = readProfiles();

    // maxPerProxy = 0 (không set) -- giữ NGUYÊN hành vi FIFO cũ, luôn
    // lấy đúng đầu hàng đợi, không quét gì thêm (tương thích ngược
    // 100% với mọi lần chạy trước đây chưa dùng tính năng này).
    //
    // maxPerProxy > 0 -- quét pending TÌM profile ĐẦU TIÊN không bị
    // chặn bởi giới hạn per-proxy, bỏ qua (giữ nguyên vị trí trong
    // pending, KHÔNG xoá) những profile đang bị proxy của nó chặn --
    // thử lại đúng profile đó ở lượt fillQueue() kế tiếp (khi có 1
    // profile khác dùng chung proxy đó đóng lại, giải phóng slot).
    let candidateIndex = 0;
    // Có "Danh sách proxy" -> không xét proxy riêng của profile nữa: profile đầu hàng nhận proxy ít người dùng nhất còn chỗ.
    // Đọc lại danh sách MỖI vòng -> sửa danh sách giữa chừng (2 -> 1, 2 -> 3) áp dụng ngay cho profile mở sau.
    const pool = parseProxyPoolText(readProxyPoolText()).proxies;
    let assignedProxy = null;
    if (pool.length > 0) {
      assignedProxy = pickPoolProxy(pool);
      if (!assignedProxy) {
        // Mọi proxy trong danh sách đều đủ maxPerProxy -- chờ tới khi có profile đóng (listener 'close' gọi lại fillQueue) hoặc danh sách được thêm proxy (POST /api/proxy-pool gọi lại fillQueue).
        if (!queue.poolWaitLogged) {
          queue.poolWaitLogged = true;
          queueLog(`Đang chờ: cả ${pool.length} proxy trong danh sách đều đã đủ ${queue.maxPerProxy} profile -- đang mở ${queue.active.size}/${queue.maxConcurrent} cửa sổ, profile kế tiếp mở khi có chỗ.`);
        }
        break;
      }
    } else if (queue.maxPerProxy > 0) {
      candidateIndex = -1;
      for (let i = 0; i < queue.pending.length; i++) {
        const id = queue.pending[i];
        const profile = profiles.find((p) => p.id === id);
        const proxyServer = profile ? profile.proxyServer : '';
        if (countActiveByProxy(proxyServer, profiles) < queue.maxPerProxy) {
          candidateIndex = i;
          break;
        }
      }
      if (candidateIndex === -1) {
        // MỌI profile còn lại trong pending đều đang bị proxy của nó
        // chặn (đã đủ maxPerProxy profile chạy rồi) -- không launch
        // được gì thêm lúc này. Dừng vòng lặp -- fillQueue() sẽ tự
        // được gọi lại khi có 1 profile khác đóng (xem 'close' listener
        // trong launchProfileById), lúc đó slot proxy mới trống ra.
        break;
      }
    }

    if (generation !== queueGeneration || !queue.running) break;

    const id = queue.pending.splice(candidateIndex, 1)[0]; // lấy đúng candidate tìm được -- KHÔNG phải luôn luôn đầu hàng khi maxPerProxy đang chặn
    queue.active.add(id);
    if (assignedProxy) { queue.proxyById[id] = assignedProxy; queue.poolWaitLogged = false; } // gán TRƯỚC khi await launch -- fillQueue chạy song song cũng đếm được profile đang mở dở này
    try {
      await launchProfileById(id);
      // The queue may have been stopped (hoặc restart sang generation mới)
      // NGAY TRONG LÚC launchProfileById() đang await -- cửa sổ của profile
      // này lúc này ĐÃ MỞ THÀNH CÔNG và đã có trong runningContexts[id] rồi.
      // Trước đây chỉ `break` ở đây, bỏ mặc cửa sổ đó -- vì runQueueScriptThenClose()
      // (nơi DUY NHẤT gọi .context.close()) chưa bao giờ được gọi cho id
      // này, cửa sổ đứng mãi ở trang example.com, không bao giờ tự đóng
      // (queue.active cũng giữ nguyên id này luôn, dù việc đó vô hại vì
      // generation/running đã đổi nên fillQueue() sau này bỏ qua nó).
      // Đóng luôn context vừa mở ở đây -- .close() sẽ tự bắn listener
      // 'close' đã đăng ký trong launchProfileById() để dọn runningContexts
      // và queue.active như mọi nhánh đóng khác trong file này.
      if (generation !== queueGeneration || !queue.running) {
        if (runningContexts[id]) {
          await runningContexts[id].context.close().catch(() => {});
        }
        break;
      }
      const profile = profiles.find((p) => p.id === id);
      queueLog(`Launched "${profile ? profile.name : id}"` + (assignedProxy ? ` -- proxy ${assignedProxy.label} (${countAssignedProxy(assignedProxy.key)}${queue.maxPerProxy ? '/' + queue.maxPerProxy : ''} profile đang dùng)` : ''), id, profile ? profile.name : id);
      setQueueResult(id, profile ? profile.name : id, 'running');
      if (queue.script) {
        runQueueScriptThenClose(id, profile ? profile.name : id); // not awaited, see comment above
      }
    } catch (err) {
      console.error(`Queue: couldn't launch ${id}: ${err.message}`);
      queueLog(`Couldn't launch ${id}: ${err.message}`, id);
      setQueueResult(id, null, 'failed');
      queue.active.delete(id); // don't let a bad profile permanently occupy a slot
      delete queue.proxyById[id]; // trả lại proxy đã gán
      // loop continues immediately and tries the next pending id
    }
  }

  if (queue.pending.length === 0 && queue.active.size === 0) {
    queue.running = false; // whole queue has drained
  }
}

app.post('/api/queue/start', async (req, res) => {
  const { profileIds, maxConcurrent, maxPerProxy, script, scriptName, retryCount, inputs, scriptTimeoutMs } = req.body;
  if (!Array.isArray(profileIds) || profileIds.length === 0) {
    return res.status(400).json({ error: 'Pick at least one profile for the queue.' });
  }

  // Never replace a live queue. Doing so resets queue.active and lets an
  // older fillQueue() continue launching profiles outside the new limit.
  // Also wait for profiles from a stopped queue to close before starting a
  // new one, because /queue/stop intentionally leaves active profiles alone.
  if (queue.running || queue.active.size > 0) {
    return res.status(409).json({
      error: queue.running
        ? 'Queue is already running. Stop it before starting another run.'
        : 'Previous queue profiles are still running. Wait for them to close before starting another run.',
      running: queue.running,
      active: [...queue.active],
    });
  }

  const inputsById = {};
  if (Array.isArray(inputs)) {
    profileIds.forEach((id, i) => { inputsById[id] = inputs[i] || ''; });
  }

  const nameById = new Map(readProfiles().map((p) => [p.id, p.name]));
  const resultsById = {};
  profileIds.forEach((id) => { resultsById[id] = { name: nameById.get(id) || id, status: 'pending' }; });

  queueGeneration++;
  queue = {
    pending: [...profileIds],
    active: new Set(),
    maxConcurrent: Math.max(1, parseInt(maxConcurrent, 10) || 1),
    // 0 = không giới hạn -- parseInt trả NaN cho input rỗng/không hợp
    // lệ, "|| 0" đưa về đúng nghĩa "không giới hạn" thay vì crash.
    maxPerProxy: Math.max(0, parseInt(maxPerProxy, 10) || 0),
    proxyById: {},
    poolWaitLogged: false,
    running: true,
    script: (script || '').trim(),
    // Tên file THẬT của script đang chạy (VD "main.js", hay bất kỳ tab
    // nào được chọn trong Run modal) -- không phải để hiển thị, mà để
    // gắn vào //# sourceURL khi build AsyncFunction bên dưới, cho log()
    // tự biết log(...) này đang được gọi từ dòng nào trong CHÍNH FILE
    // NÀY. Không có tên thật thì mặc định "main.js", vì đó vẫn luôn
    // đúng cho tuyệt đại đa số các lần chạy (chỉ sai khi ai đó chủ động
    // chọn 1 tab khác làm entry point trong Run modal mà lại không gửi
    // kèm tên file -- một client cũ/lỗi, không phải hành vi bình thường).
    scriptName: (scriptName || '').trim() || 'main.js',
    retryCount: Math.max(0, parseInt(retryCount, 10) || 0),
    inputsById,
    log: [],
    scriptTimeoutMs: Math.max(0, parseInt(scriptTimeoutMs, 10) || 0),
    resultsById,
  };
  queueLog(
    `Queue started: ${profileIds.length} profile(s), max ${queue.maxConcurrent} at a time` +
      (queue.maxPerProxy ? `, max ${queue.maxPerProxy} per proxy` : '') +
      (queue.script ? ', auto-run script enabled' : '') +
      (queue.retryCount ? `, retry x${queue.retryCount}` : '') +
      (queue.scriptTimeoutMs ? `, script timeout ${queue.scriptTimeoutMs}ms` : '')
  );
  { const { proxies, warnings } = parseProxyPoolText(readProxyPoolText()); if (proxies.length) queueLog(`Danh sách proxy: ${proxies.length} proxy (${proxies.map((p) => p.label).join(', ')}) -- mỗi profile được gán tạm 1 proxy trong danh sách, bỏ qua proxy riêng của profile` + (warnings.length ? ` | ${warnings.join(' ')}` : '')); }

  fillQueue(queueGeneration); // don't await -- launches happen in the background, poll GET /api/queue for progress
  res.json({ success: true });
});

app.post('/api/queue/stop', (req, res) => {
  // Stops launching NEW profiles from the queue; leaves whatever is
  // already running alone (those are just regular running profiles now).
  queueGeneration++;
  queue.running = false;
  queue.pending = [];
  queueLog('Queue stopped (profiles already running are left alone)');
  res.json({ success: true });
});

app.get('/api/queue', (req, res) => {
  res.json({
    running: queue.running,
    maxConcurrent: queue.maxConcurrent,
    pending: queue.pending,
    active: [...queue.active],
    hasScript: Boolean(queue.script),
    retryCount: queue.retryCount,
    scriptTimeoutMs: queue.scriptTimeoutMs,
    resultsById: queue.resultsById,
    log: queue.log,
  });
});

// -------------------------------------------------------------------
// Chrome version check -- runs ONCE, right now, as the server starts.
// Not a background poller: it does a subprocess launch + a network
// call, neither cheap enough (or useful enough -- Chrome doesn't ship
// new versions minute to minute) to repeat while the server just sits
// there running. `chromeVersionStatus` starts as "still checking" and
// flips to the real result whenever the async check resolves, WITHOUT
// blocking app.listen() below from happening immediately. The
// dashboard and /editor each fetch GET /api/chrome-version once on
// their own page load and show a small banner if it's outdated -- see
// initChromeVersionBanner() in public/shared.js.
let chromeVersionStatus = { checking: true, configured: false, installed: null, latest: null, outdated: false, majorsBehind: 0, error: null };
checkChromeVersion(CHROME_PATH).then((result) => {
  chromeVersionStatus = { checking: false, ...result };
});

app.get('/api/chrome-version', (req, res) => {
  res.json(chromeVersionStatus);
});

// -------------------------------------------------------------------
// API: given a proxy config, find out where it ACTUALLY exits to --
// not the literal host in proxyServer (irrelevant for rotating/gateway
// proxies, common with residential proxy products, where the connect
// address isn't the real exit IP at all) but the real IP+location a
// destination site would see.
//
// Reuses Playwright itself to do this rather than adding an HTTP-proxy
// client dependency: launches a throwaway, headless, non-persistent
// browser configured with the SAME proxy settings a real profile would
// use, and asks a free, no-key geolocation API
// (ip-api.com, running since 2012, https://ip-api.com/docs) what it
// sees. Headless and throwaway on purpose -- this is a one-off setup
// check, not a browsing session, so it doesn't need
// launchProfileById()'s persistent context, real window, or fingerprint
// layer at all.
//
// Uses CHROME_PATH (Chrome Portable, or whatever's configured) when
// set, same as every real profile does -- falls back to Playwright's
// bundled Chromium only if CHROME_PATH isn't configured at all, so this
// doesn't force a SEPARATE `npx playwright install` just for this one
// check on a setup that otherwise never touches bundled Chromium.
//
// The actual work lives in detectLocationForProxy() (function declaration,
// hoisted, defined further down this file) so /api/profiles/bulk-proxy
// can reuse the exact same check when auto-resyncing locale/timezone on a
// proxy change -- see that route for why that matters.
// -------------------------------------------------------------------
app.post('/api/detect-location', async (req, res) => {
  try {
    const result = await detectLocationForProxy(req.body || {});
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// -------------------------------------------------------------------
// detectLocationForProxy({proxyServer, proxyUsername, proxyPassword})
//   -> { ip, country, countryCode, city, timezone, latitude, longitude, suggestedLocale }
//
// The one place that actually launches a throwaway headless browser
// through a given proxy and asks ip-api.com what it sees -- both
// /api/detect-location (the manual "Detect location from proxy" button
// on the create/bulk-create forms) and /api/profiles/bulk-proxy's
// auto-resync (below) call this same function, so there's exactly one
// implementation of "what does this proxy's exit location look like" to
// keep correct. Throws (never resolves an error shape) so both callers
// can decide what "failed" means for their own situation -- a single
// manual check surfaces the error directly to the user; a bulk proxy
// change treats it as "keep this profile's existing locale/timezone"
// rather than failing the whole batch over one bad proxy line.
// -------------------------------------------------------------------
async function detectLocationForProxy({ proxyServer, proxyUsername, proxyPassword }) {
  if (!proxyServer) throw new Error('proxyServer is required');

  let browser;
  try {
    const launchOpts = {
      headless: true,
      proxy: { server: proxyServer, username: proxyUsername || undefined, password: proxyPassword || undefined },
    };
    if (CHROME_PATH) launchOpts.executablePath = CHROME_PATH;
    browser = await chromium.launch(launchOpts);
    const page = await browser.newPage();
    await page.goto('http://ip-api.com/json/?fields=status,message,query,country,countryCode,city,timezone,lat,lon', { timeout: 15000 });
    const data = JSON.parse(await page.textContent('body'));
    await browser.close();
    browser = null;

    if (data.status !== 'success') throw new Error(data.message || 'Geolocation lookup failed');

    return {
      ip: data.query,
      country: data.country,
      countryCode: data.countryCode,
      city: data.city,
      timezone: data.timezone,
      latitude: data.lat,
      longitude: data.lon,
      suggestedLocale: LOCALE_BY_COUNTRY[data.countryCode] || null,
    };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    throw new Error(`Couldn't check through this proxy: ${err.message}`);
  }
}

// -------------------------------------------------------------------
// Without this, stopping the server (Ctrl+C, nodemon auto-restart on a
// file save, a process manager restart) leaves every currently-open
// window running as an ORPHANED OS process: runningContexts/queue.active
// are in-memory only, so the NEXT server process starts with a totally
// empty idea of what's open, while the actual Chrome windows from before
// are still sitting there on screen. Start a queue after that and its
// maxConcurrent new windows land ON TOP of however many orphans were
// already open -- which is exactly how "max 2 at a time" can visually
// turn into a dozen+ windows over a few restarts, even though the queue
// logic itself is correctly holding to 2 within any single run.
//
// SIGINT = Ctrl+C in the terminal. SIGTERM = how most process managers
// (pm2, systemd, Docker, nodemon's own restart) ask a process to stop.
// Best-effort and time-boxed (5s) -- a stuck browser shouldn't be able to
// hang the shutdown itself; process.exit() below guarantees the process
// still goes down either way.
// -------------------------------------------------------------------
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received -- closing ${Object.keys(runningContexts).length} open window(s) before exit...`);
  await Promise.race([
    closeAllRunningContexts(),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Chỉ nhận kết nối từ CHÍNH máy này -- trước đây listen trên mọi địa chỉ mạng, không mật khẩu, trong khi /api/profiles/:id/run chạy
// code JS tuỳ ý: ai dùng chung wifi/LAN cũng chạy được lệnh trên máy + đọc cookie, mật khẩu, dữ liệu Excel. Cần mở từ máy khác thì đặt
// HOST=0.0.0.0 trong .env (chỉ làm vậy trong mạng tin cậy).
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => {
  console.log(`Profile manager running at http://localhost:${PORT}` + (HOST === '127.0.0.1' ? '' : ` (listening on ${HOST})`));
});