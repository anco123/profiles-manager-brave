#!/usr/bin/env node
/**
 * update-chrome-portable.js
 * -----------------------------------------------------------------------
 * A CLI wrapper around chrome-version-check.js -- run it by hand:
 *
 *   node update-chrome-portable.js
 *   (or: npm run check-chrome)
 *
 * As of this project's dashboard/editor also showing an "outdated"
 * banner automatically (see server.js's startup check + shared.js's
 * initChromeVersionBanner()), you mostly won't need to run this by
 * hand anymore -- it's kept as a standalone option for checking from a
 * terminal, or on a machine where you're not running the server.
 *
 * It's a CHECKER, not an installer, and deliberately so -- see
 * chrome-version-check.js's top comment, and README section 13, for
 * why auto-downloading a replacement isn't done here.
 * -----------------------------------------------------------------------
 */

const path = require('path');
const fs = require('fs');
const { checkChromeVersion, resolveChromePath } = require('./chrome-version-check');

// Same tiny hand-rolled .env loader as server.js (kept identical on
// purpose, so this always agrees with the server about what
// CHROME_PATH actually is).
const ENV_FILE = path.join(__dirname, '.env');
if (fs.existsSync(ENV_FILE)) {
  fs.readFileSync(ENV_FILE, 'utf-8').split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^(["'])(.*)\1$/, '$2'); // KEY="giá trị" (kiểu .env.example) -> bỏ dấu ngoặc
    if (!(key in process.env)) process.env[key] = value;
  });
}

const CHROME_PATH = resolveChromePath(process.env.CHROME_PATH);
const PORTABLEAPPS_URL = 'https://portableapps.com/apps/internet/google_chrome_portable';

async function main() {
  if (!CHROME_PATH) {
    console.error('✗ CHROME_PATH is not set in .env -- nothing to check. See .env.example.');
    process.exitCode = 2;
    return;
  }

  const status = await checkChromeVersion(CHROME_PATH);

  if (status.error) {
    console.error('✗', status.error);
    if (status.installed) console.log(`   (Installed version, for reference: ${status.installed})`);
    process.exitCode = 2;
    return;
  }

  console.log(`Installed (${CHROME_PATH}): Chrome ${status.installed}`);
  console.log(`Latest Windows stable:     Chrome ${status.latest}`);

  if (!status.outdated) {
    console.log('\n✓ Up to date -- no action needed.');
    process.exitCode = 0;
  } else {
    console.log(`\n⚠ ${status.majorsBehind} major version${status.majorsBehind === 1 ? '' : 's'} behind.`);
    console.log('  Not urgent by itself (whole browsers of real users sit here too) -- but');
    console.log('  when you do update, grab the real thing here, not a generic installer:');
    console.log(`  ${PORTABLEAPPS_URL}`);
    process.exitCode = 1;
  }
}

main();
