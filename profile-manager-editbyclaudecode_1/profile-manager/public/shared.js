/**
 * shared.js
 * -----------------------------------------------------------------------
 * Loaded by BOTH index.html (the dashboard) and editor.html (the
 * full-page script editor at /editor), before their own page-specific
 * script. Anything that both pages need lives here exactly once:
 *
 *   - initCodeEditor()   turns a <textarea> into a CodeMirror instance
 *                         with an optional fullscreen-expand toggle
 *   - TEMPLATE_GROUPS /
 *     SCRIPT_TEMPLATES   the 12 starter snippets, categorized
 *   - insertSnippet()    inserts a snippet into a given editor
 *   - renderChipGroups() builds the category-labeled chip buttons
 *
 * If you add a 13th snippet, add it here once and it shows up
 * everywhere that calls renderChipGroups().
 * -----------------------------------------------------------------------
 */

// Turns a plain <textarea> into a full CodeMirror editor (line numbers,
// JS syntax highlighting, proper tab handling). If `panel` + `expandBtnId`
// are given, also wires an "expand" button that grows `panel` to a much
// wider/taller view for longer scripts -- pass null for both on a page
// that's already full-size (like /editor) and doesn't need a toggle.
// CodeMirror needs an explicit .refresh() any time its container is
// resized by outside CSS -- it caches layout measurements and won't
// notice a resize on its own.
function initCodeEditor(textareaId, panel, expandBtnId) {
  const textarea = document.getElementById(textareaId);

  // If the CodeMirror CDN <script> tags failed (blocked network/firewall,
  // ad blocker, CDN outage, offline...), `CodeMirror` won't exist. Calling
  // CodeMirror.fromTextArea() would then throw -- and since this function
  // runs near the TOP of app.js/editor.js, that throw would silently stop
  // every line after it, including the code that loads running profiles.
  // A code editor missing its syntax highlighting is a minor loss; a
  // dashboard that can't list your profiles is not. So: fail soft. Return
  // an object with the same methods (getValue/setValue/focus/refresh/on)
  // backed by the plain <textarea>, so every caller downstream keeps working
  // without needing to know which one it got.
  if (typeof CodeMirror === 'undefined') {
    console.error(
      'CodeMirror did not load from cdnjs.cloudflare.com -- using a plain textarea instead. ' +
      'Line numbers/syntax highlighting are off, but everything else (profiles, tabs, running scripts) still works. ' +
      'If this persists, check whether your network/firewall blocks cdnjs.cloudflare.com.'
    );
    textarea.style.display = 'block';
    return {
      getValue: () => textarea.value,
      setValue: (v) => { textarea.value = v; },
      focus: () => textarea.focus(),
      refresh: () => {},
      on: (event, handler) => {
        if (event === 'change') textarea.addEventListener('input', handler);
      },
    };
  }

  const editor = CodeMirror.fromTextArea(textarea, {
    mode: 'javascript',
    theme: 'dracula',
    lineNumbers: true,
    matchBrackets: true,
    indentUnit: 2,
    tabSize: 2,
    lineWrapping: true,
    viewportMargin: Infinity,
  });

  if (panel && expandBtnId) {
    const expandBtn = document.getElementById(expandBtnId);
    expandBtn.addEventListener('click', () => {
      const isFullscreen = panel.classList.toggle('is-fullscreen');
      expandBtn.setAttribute('aria-label', isFullscreen ? 'Collapse editor' : 'Expand editor');
      expandBtn.title = isFullscreen ? 'Collapse editor' : 'Expand editor';
      setTimeout(() => editor.refresh(), 210); // after the width transition finishes
    });
  }

  return editor;
}

// One map of ALL starter snippets, organized into the groups the UI
// renders under.
const TEMPLATE_GROUPS = [
  {
    label: 'Điều hướng',
    items: [
      { key: 'goto', label: 'Go to a URL' },
      { key: 'wait_nav', label: 'Click & wait for load' },
      { key: 'new_tab', label: 'Open link in new tab' },
      { key: 'back', label: 'Go back' },
      { key: 'reload', label: 'Reload page' },
      { key: 'close_tab', label: 'Close this tab' },
    ],
  },
  {
    label: 'Đọc dữ liệu trên trang',
    items: [
      { key: 'title', label: 'Get title & URL' },
      { key: 'extract_list', label: 'Extract a list' },
      { key: 'wait_el', label: 'Wait for element' },
      { key: 'get_attribute', label: 'Get element attribute' },
      { key: 'get_text', label: 'Get element text' },
      { key: 'count_element', label: 'Count elements' },
    ],
  },
  {
    label: 'Tương tác',
    items: [
      { key: 'click', label: 'Click something' },
      { key: 'fill', label: 'Fill a field' },
      { key: 'type_slow', label: 'Type slowly' },
      { key: 'key_press', label: 'Press a key' },
      { key: 'select_dropdown', label: 'Select dropdown' },
      { key: 'upload_file', label: 'Upload a file' },
    ],
  },
  {
    label: 'Cuộn trang',
    items: [
      { key: 'scroll', label: 'Scroll by pixels' },
      { key: 'scroll_top', label: 'Scroll to top' },
      { key: 'scroll_bottom', label: 'Scroll to bottom' },
      { key: 'scroll_to_element', label: 'Scroll to element' },
    ],
  },
  {
    label: 'Điều khiển luồng',
    items: [
      { key: 'for_loop', label: 'For loop' },
      { key: 'if_else', label: 'If / else' },
      { key: 'delay', label: 'Delay / wait' },
      { key: 'throw_error', label: 'Stop with an error' },
    ],
  },
  {
    label: 'Văn bản & số liệu',
    items: [
      { key: 'random_text', label: 'Random text' },
      { key: 'random_number', label: 'Random number' },
      { key: 'regex_match', label: 'Regex match' },
      { key: 'totp_code', label: '2FA code (TOTP)' },
    ],
  },
  {
    label: 'File & Excel',
    items: [
      { key: 'file_read', label: 'Read text file' },
      { key: 'file_write', label: 'Write text file' },
      { key: 'file_append', label: 'Append a line' },
      { key: 'excel_write', label: 'Write Excel file' },
      { key: 'excel_read', label: 'Read Excel file' },
      { key: 'queue_input_row', label: 'Read imported Excel row (input)' },
    ],
  },
  {
    label: 'Clipboard & trang',
    items: [
      { key: 'get_clipboard', label: 'Get clipboard' },
      { key: 'set_clipboard', label: 'Set clipboard' },
      { key: 'execute_js', label: 'Run JS in page' },
    ],
  },
  {
    label: 'Mạng',
    items: [
      { key: 'http_request', label: 'HTTP request' },
      { key: 'http_download', label: 'Download a file' },
    ],
  },
  {
    label: 'Frame',
    items: [
      { key: 'switch_frame', label: 'Read inside an iframe' },
    ],
  },
  {
    label: 'Xuất ra',
    items: [
      { key: 'screenshot', label: 'Screenshot' },
      { key: 'pdf', label: 'Save as PDF' },
    ],
  },
];

const SCRIPT_TEMPLATES = {
  // ---------- Điều hướng ----------
  goto: `await page.goto('https://example.com');\nawait page.waitForLoadState('networkidle');\nlog('Loaded:', await page.title());`,

  wait_nav: `// clicking something that navigates? wait for the new page to actually\n// settle instead of assuming the click alone means it's ready\nawait page.locator('a').first().click();\nawait page.waitForLoadState('networkidle');\nlog('Now on:', page.url());`,

  new_tab: `// waits for a new tab to open, e.g. after clicking a target="_blank" link\nconst [newPage] = await Promise.all([\n  context.waitForEvent('page'),\n  page.locator('a[target="_blank"]').first().click(),\n]);\nawait newPage.waitForLoadState();\nlog('New tab URL:', newPage.url());`,

  back: `await page.goBack();\nlog('Back to:', page.url());`,

  reload: `await page.reload();\nlog('Reloaded:', page.url());`,

  close_tab: `// closes just this page/tab -- other profiles and other tabs in this\n// same profile (if any) are unaffected\nawait page.close();\nlog('Closed this tab');`,

  // ---------- Đọc dữ liệu trên trang ----------
  title: `log('Title:', await page.title());\nlog('URL:', page.url());`,

  extract_list: `// grabs the text of every matching element -- e.g. every headline on a page\nconst items = await page.locator('h2').allTextContents();\nitems.forEach((text, i) => log(\`\${i + 1}. \${text}\`));`,

  wait_el: `// waits (10s by default) for the element to exist and be visible before\n// touching it -- avoids "element not found" races on slower-loading pages\nawait page.locator('.some-class').first().waitFor({ state: 'visible' });\nlog('Element appeared');`,

  get_attribute: `// swap 'a' / 'href' for the real selector + attribute you need\nconst value = await page.locator('a').first().getAttribute('href');\nlog('Attribute:', value);`,

  get_text: `const text = await page.locator('h1').first().textContent();\nlog('Text:', text);`,

  count_element: `const count = await page.locator('a').count();\nlog('Matching elements:', count);`,

  // ---------- Tương tác ----------
  click: `// swap 'a' for a real CSS selector on the current page\nconst box = await page.locator('a').first().boundingBox();\n// steps > 1 glides the cursor through intermediate points instead of\n// jumping straight to the target -- easier to watch, and some UIs need\n// the mouseenter/mouseover events along the way to react correctly\nawait page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });\nawait page.mouse.down();\nawait page.mouse.up();\nlog('Clicked. New URL:', page.url());`,

  fill: `// swap the selector + value for a real field on the page\nawait page.locator('input[type="text"]').first().fill('Hello world');\nlog('Filled the field');`,

  type_slow: `// unlike .fill() (sets the whole value instantly), pressSequentially()\n// sends a real keydown/keyup per character -- needed for search boxes or\n// autocomplete UIs that only react to individual keystrokes\nawait page.locator('input[type="search"]').first().pressSequentially('hello', { delay: 80 });\nlog('Typed character by character');`,

  key_press: `// common keys: Enter, Tab, Escape, ArrowDown, Backspace...\nawait page.keyboard.press('Enter');\nlog('Pressed Enter');`,

  select_dropdown: `// swap the selector + option value for a real <select> on the page\nawait page.locator('select').selectOption('value2');\nlog('Dropdown selected');`,

  upload_file: `// swap the selector + a real file path on your machine\nawait page.locator('input[type="file"]').setInputFiles('C:\\\\path\\\\to\\\\file.png');\nlog('File attached');`,

  // ---------- Cuộn trang ----------
  scroll: `await page.mouse.wheel(0, 2000); // scroll down ~2000px\nlog('Scrolled down');`,

  scroll_top: `await page.evaluate(() => window.scrollTo(0, 0));\nlog('Scrolled to top');`,

  scroll_bottom: `await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));\nlog('Scrolled to bottom');`,

  scroll_to_element: `await page.locator('footer').scrollIntoViewIfNeeded();\nlog('Scrolled to the element');`,

  // ---------- Điều khiển luồng ----------
  for_loop: `for (let i = 1; i <= 5; i++) {\n  log(\`Iteration \${i}\`);\n  // put the code you want repeated here\n}`,

  if_else: `const alreadyLoggedIn = (await page.locator('text=Log out').count()) > 0;\nif (alreadyLoggedIn) {\n  log('Already logged in');\n} else {\n  log('Not logged in yet');\n}`,

  delay: `await page.waitForTimeout(2000); // milliseconds -- change as needed\nlog('Waited 2s');`,

  throw_error: `// stops the script immediately, counted as a failure -- useful to\n// deliberately trigger the Run modal's "Retry on failure" when a page\n// isn't in the state you expected\nif (!page.url().includes('example.com')) {\n  throw new Error('Not on the expected page');\n}`,

  // ---------- Văn bản & số liệu ----------
  random_text: `const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';\nlet text = '';\nfor (let i = 0; i < 8; i++) text += chars[Math.floor(Math.random() * chars.length)];\nlog('Random text:', text);`,

  random_number: `const min = 1, max = 100;\nconst n = Math.floor(Math.random() * (max - min + 1)) + min;\nlog('Random number:', n);`,

  regex_match: `const bodyText = await page.locator('body').textContent();\nconst match = bodyText.match(/\\d{3}-\\d{4}/); // example: a phone-number-shaped pattern\nlog('Regex match:', match ? match[0] : 'not found');`,

  totp_code: `// secret is the base32 string a site shows YOU when YOU turn on 2FA for\n// YOUR OWN account -- the same thing behind that QR code. This computes\n// the same 6-digit code your authenticator app would show right now.\nconst { totp } = require('./helpers');\nconst code = totp('JBSWY3DPEHPK3PXP');\nlog('Current 2FA code:', code);`,

  // ---------- File & Excel ----------
  file_read: `const fs = require('fs');\nconst content = fs.readFileSync('data/notes.txt', 'utf-8');\nlog('File content:', content);`,

  file_write: `const fs = require('fs');\nfs.writeFileSync('data/notes.txt', 'This replaces the whole file\\n');\nlog('File written');`,

  file_append: `const fs = require('fs');\nfs.appendFileSync('data/notes.txt', \`\${new Date().toISOString()}: done\\n\`);\nlog('Line appended');`,

  excel_write: `const xlsx = require('@e965/xlsx');\nconst rows = [\n  { name: 'Client A', proxy: '1.1.1.1:8080' },\n  { name: 'Client B', proxy: '2.2.2.2:8080' },\n];\nconst sheet = xlsx.utils.json_to_sheet(rows);\nconst workbook = xlsx.utils.book_new();\nxlsx.utils.book_append_sheet(workbook, sheet, 'Sheet1');\nxlsx.writeFile(workbook, 'data/output.xlsx');\nlog('Wrote data/output.xlsx');`,

  excel_read: `const xlsx = require('@e965/xlsx');\nconst workbook = xlsx.readFile('data/output.xlsx');\nconst sheet = workbook.Sheets[workbook.SheetNames[0]];\nconst rows = xlsx.utils.sheet_to_json(sheet);\nlog(\`Read \${rows.length} row(s):\`, JSON.stringify(rows[0]));`,

  queue_input_row: `// When "Input data" in the Run modal was filled via "Import from\n// Excel…", each profile's input is a JSON string of the Excel row that\n// matched this profile's name -- parse it to get the columns back.\n// Rows are keyed by SPREADSHEET COLUMN LETTER, not header text --\n// column B is row.B (or row['B']), column C is row.C, and so on,\n// matching whatever letter the "Match Excel column" dropdown showed.\nconst row = input ? JSON.parse(input) : {};\nlog('Row for this profile:', JSON.stringify(row));\nlog('Column B:', row.B, '  Column C:', row.C);`,

  // ---------- Clipboard & trang ----------
  get_clipboard: `// clipboard access needs explicit permission first\nawait context.grantPermissions(['clipboard-read']);\nconst text = await page.evaluate(() => navigator.clipboard.readText());\nlog('Clipboard:', text);`,

  set_clipboard: `await context.grantPermissions(['clipboard-write']);\nawait page.evaluate((text) => navigator.clipboard.writeText(text), 'Text to copy');\nlog('Clipboard set');`,

  execute_js: `// runs real JS INSIDE the page (has access to window/document), not in\n// Node -- for reading things Playwright doesn't have a direct method for\nconst result = await page.evaluate(() => document.title);\nlog('Result from the page:', result);`,

  // ---------- Mạng ----------
  http_request: `// page.request shares this profile's cookies/proxy automatically --\n// prefer it over Node's own fetch() for anything related to this session\nconst response = await page.request.get('https://api.example.com/data');\nconst data = await response.json();\nlog('Status:', response.status(), '| body:', JSON.stringify(data));`,

  http_download: `const response = await page.request.get('https://example.com/file.pdf');\nconst buffer = await response.body();\nrequire('fs').writeFileSync('data/downloaded.pdf', buffer);\nlog('Saved to data/downloaded.pdf');`,

  // ---------- Frame ----------
  switch_frame: `// swap 'iframe' for a real selector if the page has more than one\nconst frame = page.frameLocator('iframe').first();\nconst text = await frame.locator('body').textContent();\nlog('Text inside the iframe:', text);`,

  // ---------- Xuất ra ----------
  screenshot: `await page.screenshot({ path: 'data/last-screenshot.png' });\nlog('Saved screenshot to data/last-screenshot.png');`,

  pdf: `// Chromium only -- Firefox/WebKit don't support page.pdf()\nawait page.pdf({ path: 'data/page.pdf' });\nlog('Saved data/page.pdf');`,
};

function insertSnippet(editor, snippet) {
  const current = editor.getValue();
  editor.setValue(current.trim() ? current.trimEnd() + '\n\n' + snippet : snippet);
  editor.focus();
}

// Builds the category labels + chip buttons into `container` from
// TEMPLATE_GROUPS, wiring each button to insert into `editor`.
function renderChipGroups(container, editor) {
  container.innerHTML = '';
  for (const group of TEMPLATE_GROUPS) {
    const label = document.createElement('p');
    label.className = 'chip-group-label';
    label.textContent = group.label;
    container.appendChild(label);

    const row = document.createElement('div');
    row.className = 'template-row';
    for (const item of group.items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.textContent = item.label;
      btn.addEventListener('click', () => insertSnippet(editor, SCRIPT_TEMPLATES[item.key]));
      row.appendChild(btn);
    }
    container.appendChild(row);
  }
}

// -------------------------------------------------------------------
// Called once by each page's own init (app.js and editor.js) on page
// load. Fetches the ALREADY-COMPUTED result server.js cached at its own
// startup (see the "Chrome version check" comment there) -- this
// function does not itself run the subprocess/network check, just
// reads whatever the server already found, once, no polling, no
// re-check while the page stays open.
async function initChromeVersionBanner() {
  let status;
  try {
    const res = await fetch('/api/chrome-version');
    status = await res.json();
  } catch (err) {
    return; // API unreachable for some reason -- a banner about a banner failing is silly, just skip it
  }

  // Nothing configured, still checking (fetched the instant the server
  // started, before the async check resolved), or fine -- show nothing.
  if (!status.configured || status.checking || (!status.outdated && !status.error)) return;

  const banner = document.createElement('div');
  banner.className = 'chrome-version-banner';

  if (status.error) {
    banner.classList.add('is-muted');
    banner.innerHTML = `<span>Couldn't check Chrome Portable's version: ${status.error}</span>`;
  } else {
    const plural = status.majorsBehind === 1 ? '' : 's';
    banner.innerHTML = `<span>Chrome Portable is out of date &mdash; <strong>${status.majorsBehind} major version${plural} behind</strong> ` +
      `(installed ${status.installed}, latest ${status.latest}). ` +
      `<a href="https://portableapps.com/apps/internet/google_chrome_portable" target="_blank" rel="noopener">Get the update</a></span>`;
  }

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'chrome-version-banner-close';
  closeBtn.setAttribute('aria-label', 'Dismiss');
  closeBtn.textContent = '\u00d7';
  closeBtn.addEventListener('click', () => banner.remove());
  banner.appendChild(closeBtn);

  document.body.prepend(banner);
}

