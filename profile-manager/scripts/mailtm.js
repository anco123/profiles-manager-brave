/**
 * scripts/mailtm.js
 * -----------------------------------------------------------------------
 * Helpers for logging into mail.tm's API and pulling a verification code
 * out of an inbox. Generic -- not tied to TaskOn or any one site, so
 * anything else you register with a mail.tm address can reuse this too.
 *
 * API reference used (verified against https://docs.mail.tm/ directly,
 * not guessed): base URL https://api.mail.tm, POST /token to authenticate
 * ({address, password} -> {token}), GET /messages for the inbox list
 * (paginated, "hydra:member" array, each entry has a truncated "intro"
 * only), GET /messages/{id} for the FULL message (has "text" and "html").
 *
 * Usage from a login script:
 *
 *   const { getMailTmToken, waitForVerificationCode } = require('./mailtm');
 *   const token = await getMailTmToken(page, mailAddress, mailPassword);
 *   const code = await waitForVerificationCode(page, token, { sinceMs: Date.now() });
 *
 * Uses page.request (Playwright's built-in HTTP client bound to the
 * profile's own browser context) rather than a bare fetch(), so these
 * calls go through the SAME network path as everything else the script
 * does -- no separate Node-level HTTP setup needed.
 * -----------------------------------------------------------------------
 */

const MAILTM_BASE = 'https://api.mail.tm';

// Authenticates with a mail.tm account (its OWN password -- separate
// from whatever site you're using it to receive codes for) and returns
// the bearer token to use for every subsequent call.
async function getMailTmToken(page, address, password) {
  const res = await page.request.post(`${MAILTM_BASE}/token`, {
    data: { address, password },
  });
  if (!res.ok()) {
    throw new Error(`mail.tm đăng nhập thất bại (HTTP ${res.status()}) -- kiểm tra lại email/mật khẩu mail.tm đúng chưa`);
  }
  const body = await res.json();
  if (!body.token) throw new Error('mail.tm không trả về token -- phản hồi bất thường');
  return body.token;
}

// Polls the inbox (newest message first) until it finds one whose FULL
// body contains a 6-digit code, or gives up after timeoutMs. Checks the
// full message (GET /messages/{id}), not just the list endpoint's
// "intro" preview -- the intro is truncated and can cut off before
// reaching the code.
//
// `sinceMs`, if given, ignores any message created before that time --
// pass Date.now() (captured right before triggering the "send code" on
// the site you're logging into) so a stale code left over from an
// earlier attempt in the same inbox never gets picked up by mistake.
//
// CAVEAT: the code-matching regex (/\b\d{6}\b/) grabs the first bare
// 6-digit run it finds in the email. If a particular site's email
// template has some OTHER unrelated 6-digit number in it (an order id,
// a tracking number...), this could match the wrong thing -- if that
// happens, send the actual email text/HTML and the regex can be
// tightened to look for a specific surrounding phrase instead.
async function waitForVerificationCode(page, token, { timeoutMs = 90000, pollMs = 4000, sinceMs = null } = {}) {
  const deadline = Date.now() + timeoutMs;
  const headers = { Authorization: `Bearer ${token}` };

  while (Date.now() < deadline) {
    const listRes = await page.request.get(`${MAILTM_BASE}/messages`, { headers });
    if (listRes.ok()) {
      const list = await listRes.json();
      const members = (list['hydra:member'] || [])
        .filter((m) => !sinceMs || new Date(m.createdAt).getTime() >= sinceMs)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); // newest first

      for (const meta of members) {
        const fullRes = await page.request.get(`${MAILTM_BASE}/messages/${meta.id}`, { headers });
        if (!fullRes.ok()) continue;
        const full = await fullRes.json();
        const htmlParts = Array.isArray(full.html) ? full.html : (full.html ? [full.html] : []);
        const haystack = [full.subject, full.text, ...htmlParts].filter(Boolean).join('\n');
        const match = haystack.match(/\b\d{6}\b/);
        if (match) return match[0];
      }
    }
    await page.waitForTimeout(pollMs);
  }
  throw new Error(`Không thấy email có mã 6 số trong hộp thư sau ${Math.round(timeoutMs / 1000)}s`);
}

module.exports = { getMailTmToken, waitForVerificationCode };
