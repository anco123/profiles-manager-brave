/**
 * chrome-version-check.js
 * -----------------------------------------------------------------------
 * The actual check logic (subprocess + network call), shared by two
 * different callers so it only exists once:
 *
 *   - update-chrome-portable.js: a standalone CLI, run by hand
 *   - server.js: runs this ONCE when the server starts, caches the
 *     result, and serves it from GET /api/chrome-version. Both the
 *     dashboard and /editor fetch that endpoint once on page load and
 *     show a small banner if it's outdated -- see initChromeVersionBanner()
 *     in shared.js. Deliberately NOT a background poller: the check
 *     involves a subprocess launch and a network call, neither of which
 *     needs repeating while you're just sitting on the page, and Chrome
 *     versions don't change minute-to-minute anyway.
 *
 * checkChromeVersion(chromePath) is the one function either caller needs.
 * It never throws -- every failure mode (no CHROME_PATH configured, bad
 * path, offline) comes back as a normal result object with `.error` set,
 * so callers don't need their own try/catch around it.
 * -----------------------------------------------------------------------
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const VERSION_API = 'https://versionhistory.googleapis.com/v1/chrome/platforms/win/channels/stable/versions';

// Pulls the first x.y.z.w-shaped token out of arbitrary text -- tolerant
// of whatever exact prefix a given Chrome build prints ("Google Chrome
// 130.0.6723.92", trailing spaces, etc.), we only care about the number.
function extractVersion(text) {
  const match = text.match(/\d+\.\d+\.\d+\.\d+/);
  return match ? match[0] : null;
}

function majorOf(version) {
  return parseInt(version.split('.')[0], 10);
}

// CHROME_PATH người dùng gõ tay hay sai kiểu: có dấu ngoặc kép bao quanh, trỏ vào THƯ MỤC (GoogleChromePortable, Chrome-bin...) thay vì
// chrome.exe, hoặc trỏ vào GoogleChromePortable.exe (trình khởi động của PortableApps -- mở Chrome rồi thoát, Playwright không dùng được).
// Thư mục -> tự tìm chrome.exe bên trong; launcher -> chrome.exe tương ứng nếu có. Trả về đường dẫn đã sửa (không có gì để sửa thì giữ nguyên).
// Đường dẫn TƯƠNG ĐỐI (..\\GoogleChromePortable\\App\\Chrome-bin\\chrome.exe) tính từ thư mục project (chỗ có server.js) -- chép cả thư mục cha
// (project + GoogleChromePortable nằm cạnh nhau) sang máy / ổ khác vẫn chạy, không phải sửa .env.
function resolveChromePath(p) {
  p = String(p || '').trim().replace(/^(["'])(.*)\1$/, '$2').trim();
  if (!p) return '';
  if (!path.isAbsolute(p)) p = path.resolve(__dirname, p);
  const tries = (dir) => [path.join(dir, 'brave.exe'), path.join(dir, 'App', 'Chrome-bin', 'chrome.exe'), path.join(dir, 'Chrome-bin', 'chrome.exe'), path.join(dir, 'chrome.exe')];
  let st = null; try { st = fs.statSync(p); } catch {}
  if (st && st.isDirectory()) return tries(p).find((f) => fs.existsSync(f)) || p;
  if (st && /portable\.exe$/i.test(p)) return tries(path.dirname(p)).find((f) => fs.existsSync(f)) || p;
  return p;
}

// Thư mục cạnh chrome.exe tên đúng số phiên bản (Chrome-bin\130.0.6723.92\) -- dự phòng khi file .exe không ghi phiên bản
function versionFromFolder(chromePath) {
  try { return fs.readdirSync(path.dirname(chromePath)).filter((d) => /^\d+\.\d+\.\d+\.\d+$/.test(d)).sort((a, b) => b.split('.').map(Number).reduce((r, x, i) => r || x - a.split('.').map(Number)[i], 0))[0] || null; } catch { return null; }
}

function getInstalledVersion(chromePath) {
  chromePath = resolveChromePath(chromePath);
  let st = null; try { st = fs.statSync(chromePath); } catch {}
  if (!st) throw new Error(`Không thấy file "${chromePath}" (CHROME_PATH trong .env / Settings). Sửa lại cho đúng đường dẫn tới ...\\GoogleChromePortable\\App\\Chrome-bin\\chrome.exe`);
  if (st.isDirectory()) throw new Error(`CHROME_PATH đang trỏ vào THƯ MỤC "${chromePath}" và không thấy chrome.exe bên trong -- phải trỏ tới file chrome.exe (thường là ...\\GoogleChromePortable\\App\\Chrome-bin\\chrome.exe)`);
  // Does NOT execute chrome.exe at all -- two rounds of trying to
  // safely invoke it with --version (first with shell:true + manual
  // quoting, then without) both turned out to still let a real window
  // open/attempt a page load on at least one real machine, and neither
  // could be verified from this sandbox (no real Windows/Chrome here).
  // Rather than guess at a third flag combination, this reads the
  // version number straight out of the .exe's own file metadata (the
  // same "File version" you'd see in Explorer's Properties dialog) via
  // PowerShell's Get-Item, which only reads bytes from the file --
  // Chrome is never launched, so there is no process, no window, no
  // page load, and no CLI-flag behavior to depend on at all.
  // ProductVersion trống (một số bản build Chrome / Chromium portable) -> thử FileVersion, rồi tới thư mục số phiên bản cạnh chrome.exe
  let output = '';
  try {
    output = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `$v = (Get-Item -LiteralPath '${chromePath.replace(/'/g, "''")}').VersionInfo; "$($v.ProductVersion) | $($v.FileVersion)"`], { encoding: 'utf-8' });
  } catch (e) { output = ''; }
  const version = extractVersion(output) || versionFromFolder(chromePath);
  if (!version) throw new Error(`Không đọc được phiên bản của "${chromePath}" (thông tin file: "${output.trim()}"). CHROME_PATH có đúng là chrome.exe thật không? -- thường là ...\\GoogleChromePortable\\App\\Chrome-bin\\chrome.exe, không phải GoogleChromePortable.exe`);
  return version;
}

function getLatestStableVersion() {
  return new Promise((resolve, reject) => {
    https.get(VERSION_API, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          // The API returns newest-first, so [0] is current stable.
          const latest = data.versions && data.versions[0] && data.versions[0].version;
          if (!latest) throw new Error('Unexpected response shape from VersionHistory API');
          resolve(latest);
        } catch (err) {
          reject(new Error(`Couldn't parse Google's version API response: ${err.message}`));
        }
      });
    }).on('error', (err) => {
      reject(new Error(`Couldn't reach Google's version API (are you online?): ${err.message}`));
    });
  });
}

// Never throws. Always resolves to:
//   { configured, installed, latest, outdated, majorsBehind, error }
async function checkChromeVersion(chromePath) {
  if (!chromePath) {
    return { configured: false, installed: null, latest: null, outdated: false, majorsBehind: 0, error: null };
  }

  let installed;
  try {
    installed = getInstalledVersion(chromePath);
  } catch (err) {
    return { configured: true, installed: null, latest: null, outdated: false, majorsBehind: 0, error: err.message };
  }

  let latest;
  try {
    latest = await getLatestStableVersion();
  } catch (err) {
    return { configured: true, installed, latest: null, outdated: false, majorsBehind: 0, error: err.message };
  }

  const majorsBehind = Math.max(0, majorOf(latest) - majorOf(installed));
  return { configured: true, installed, latest, outdated: majorsBehind > 0, majorsBehind, error: null };
}

// ---- Tự tìm trình duyệt portable khi CHROME_PATH để trống (server.js + update-chrome-portable.js dùng chung) ----
// Dò lên tối đa 4 cấp thư mục cha của project (file này nằm ở thư mục project). Ưu tiên Brave portable, rồi tới GoogleChromePortable.
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

module.exports = { checkChromeVersion, extractVersion, majorOf, resolveChromePath, autoDetectPortableChrome, autoDetectPortableBrave };
