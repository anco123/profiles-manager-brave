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

function getInstalledVersion(chromePath) {
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
  const output = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `(Get-Item -LiteralPath '${chromePath}').VersionInfo.ProductVersion`],
    { encoding: 'utf-8' }
  );
  const version = extractVersion(output);
  if (!version) throw new Error(`Read chrome.exe's file metadata but couldn't find a version number in it: "${output.trim()}". Is CHROME_PATH pointing at a real chrome.exe?`);
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

module.exports = { checkChromeVersion, extractVersion, majorOf };
