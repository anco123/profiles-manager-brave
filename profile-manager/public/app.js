/**
 * app.js
 * -----------------------------------------------------------------------
 * All frontend logic. No framework/build step on purpose -- this is meant
 * to be readable top to bottom. It talks to the API defined in server.js:
 *
 *   GET    /api/profiles          -> list
 *   POST   /api/profiles          -> create
 *   POST   /api/profiles/bulk     (body: { startNumber, count, prefix, ... }) -> bulk create
 *   DELETE /api/profiles/:id      -> delete
 *   POST   /api/profiles/bulk-delete   (body: { ids })
 *   POST   /api/profiles/bulk-proxy    (body: { ids, proxies })
 *   POST   /api/profiles/import        (body: { items: [...] }) -> bulk import, each item may carry its own `fingerprint`
 *   POST   /api/profiles/:id/fingerprint    -> (re)generate a random canvas/WebGL/audio/font identity
 *   DELETE /api/profiles/:id/fingerprint    -> turn the fingerprint layer back off for this profile
 *   POST   /api/profiles/:id/launch
 *   POST   /api/profiles/:id/close
 *   POST   /api/profiles/:id/run   (body: { code }) -- used by /editor (editor.js), not this file
 *   POST   /api/queue/start        (body: { profileIds, maxConcurrent, script })
 *   POST   /api/queue/stop
 *   GET    /api/queue
 *   GET    /api/config             -> { chromePathConfigured }
 * -----------------------------------------------------------------------
 */

const grid = document.getElementById('profileGrid');
const emptyState = document.getElementById('emptyState');
const countLabel = document.getElementById('countLabel');
const cardTemplate = document.getElementById('cardTemplate');
const sortAlphaBtn = document.getElementById('sortAlphaBtn');

const overlay = document.getElementById('overlay');
const createPanel = document.getElementById('createPanel');
const createForm = document.getElementById('createForm');
const toastEl = document.getElementById('toast');

let toastTimer = null;

// -------------------------------------------------------------------
// Small toast helper for success/error feedback
// -------------------------------------------------------------------
function showToast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  toastEl.classList.toggle('is-error', isError);
  requestAnimationFrame(() => toastEl.classList.add('is-visible'));

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('is-visible');
    setTimeout(() => (toastEl.hidden = true), 200);
  }, 2600);
}

// -------------------------------------------------------------------
// Identicon: a small deterministic pattern per profile id, purely
// cosmetic (so cards are easy to tell apart at a glance). We hash the
// id into a 5x5 grid, mirror it left-right for symmetry, and tint it
// with a hue derived from the same hash.
// -------------------------------------------------------------------
function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function identiconSVG(id) {
  const hash = hashString(id);
  const hue = hash % 360;
  const cell = 8;
  const cols = 5;
  let rects = '';

  for (let y = 0; y < cols; y++) {
    for (let x = 0; x < Math.ceil(cols / 2); x++) {
      const bit = (hash >> (y * 3 + x)) & 1;
      if (!bit) continue;
      const mirroredX = cols - 1 - x;
      rects += `<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}" />`;
      if (mirroredX !== x) {
        rects += `<rect x="${mirroredX * cell}" y="${y * cell}" width="${cell}" height="${cell}" />`;
      }
    }
  }

  return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
    <rect width="40" height="40" fill="hsl(${hue}, 30%, 14%)" />
    <g fill="hsl(${hue}, 65%, 60%)">${rects}</g>
  </svg>`;
}

const ENGINE_LABELS = {
  chromium: 'Chromium',
  chrome: 'Chrome (system)',
  custom: 'Custom exe',
  'chrome-portable-global': 'Chrome Portable (.env)',
};

// -------------------------------------------------------------------
// Multi-select state, shared by the checkbox on each card and the
// drag-select marquee further down. A plain Set of profile ids -- cards
// get rebuilt from scratch on every poll (see renderProfiles), so this
// lives independently of any single card's DOM node.
// -------------------------------------------------------------------
const selectedIds = new Set();
const bulkDeselectBtn = document.getElementById('bulkDeselectBtn');
const bulkProxyBtn = document.getElementById('bulkProxyBtn');
const bulkClearCacheBtn = document.getElementById('bulkClearCacheBtn');
const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
const bulkCountLabel = document.getElementById('bulkCountLabel');

function updateCardSelectionVisual(card, id) {
  const isSelected = selectedIds.has(id);
  card.classList.toggle('is-selected', isSelected);
  const checkbox = card.querySelector('.card-select');
  if (checkbox) checkbox.checked = isSelected;
}

// Buttons live permanently in the topbar now (see index.html) instead
// of a bar that only existed in the DOM while something was selected --
// toggling a whole bar's hidden attribute pushed the grid below it up
// and down on every single selection change, which was disorienting
// mid-drag-select or mid-click on a second checkbox (the thing you were
// about to click had already moved by the time your click landed).
// Disabling/enabling the same three buttons in place has no such effect.
function updateBulkToolbar() {
  const count = selectedIds.size;
  const hasSelection = count > 0;
  bulkDeselectBtn.disabled = !hasSelection;
  bulkProxyBtn.disabled = !hasSelection;
  bulkClearCacheBtn.disabled = !hasSelection;
  bulkDeleteBtn.disabled = !hasSelection;
  bulkCountLabel.hidden = !hasSelection;
  bulkCountLabel.textContent = `${count} selected`;
}

function toggleSelection(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  const card = grid.querySelector(`[data-profile-id="${CSS.escape(id)}"]`);
  if (card) updateCardSelectionVisual(card, id);
  updateBulkToolbar();
}

function clearSelection() {
  selectedIds.clear();
  grid.querySelectorAll('.card').forEach((card) => updateCardSelectionVisual(card, card.dataset.profileId));
  updateBulkToolbar();
}

function selectAllProfiles() {
  lastProfiles.forEach((p) => selectedIds.add(p.id));
  grid.querySelectorAll('.card').forEach((card) => updateCardSelectionVisual(card, card.dataset.profileId));
  updateBulkToolbar();
}

// -------------------------------------------------------------------
// Rendering
// -------------------------------------------------------------------
async function loadProfiles() {
  const res = await fetch('/api/profiles');
  const profiles = await res.json();
  renderProfiles(profiles);
}

let lastProfiles = [];
// false = giữ nguyên thứ tự server trả về (theo thời gian tạo -- thứ
// tự chèn vào profiles.json). true = sắp xếp theo tên A-Z ngay trên
// trình duyệt, không đổi gì phía server/file profiles.json cả.
let sortAlphabetically = false;

function renderProfiles(profiles) {
  lastProfiles = profiles;
  grid.innerHTML = '';
  countLabel.textContent = `${profiles.length} profile${profiles.length === 1 ? '' : 's'}`;
  emptyState.hidden = profiles.length > 0;

  // Cards are rebuilt from scratch every poll, so drop any selected id
  // that no longer exists (deleted through some other path) before we
  // re-render -- otherwise the toolbar count could drift from reality.
  const liveIds = new Set(profiles.map((p) => p.id));
  for (const id of [...selectedIds]) {
    if (!liveIds.has(id)) selectedIds.delete(id);
  }

  // Sort a COPY, never the array itself -- lastProfiles keeps the
  // server's original (creation-time) order so toggling the button
  // back off doesn't need a fresh fetch to "undo" the sort.
  // { numeric: true } makes "P-2" sort before "P-10" instead of after
  // it (plain string compare would put "1" before "2" character-by-
  // character, putting "P-10" before "P-2") -- most profile names here
  // end in a number, so this matters for a sane-looking A-Z order.
  const ordered = sortAlphabetically
    ? [...profiles].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    : profiles;

  for (const profile of ordered) {
    grid.appendChild(buildCard(profile));
  }
  updateBulkToolbar();
}

function buildCard(profile) {
  const node = cardTemplate.content.cloneNode(true);
  const card = node.querySelector('.card');
  card.dataset.profileId = profile.id;

  card.querySelector('.identicon').innerHTML = identiconSVG(profile.id);
  card.querySelector('.card-name').textContent = profile.name;

  // Sets both textContent AND title to the same full value -- .meta dd
  // truncates long values with an ellipsis (needed so a long fingerprint
  // label can't push the card wider than its grid column, see the CSS
  // min-width:0 fix), so this is what makes the FULL value still
  // readable: hovering shows it as a native browser tooltip.
  const setMetaValue = (el, text) => { el.textContent = text; el.title = text; };

  setMetaValue(card.querySelector('.meta-viewport'), `${profile.viewportWidth}\u00d7${profile.viewportHeight}`);
  setMetaValue(card.querySelector('.meta-locale'), profile.locale);
  setMetaValue(card.querySelector('.meta-timezone'), profile.timezoneId);
  setMetaValue(card.querySelector('.meta-proxy'), profile.proxyServer ? 'configured' : '\u2014');
  setMetaValue(card.querySelector('.meta-engine'), ENGINE_LABELS[profile.effectiveEngineMode] || 'Chromium');

  const fingerprintEl = card.querySelector('.meta-fingerprint');
  setMetaValue(fingerprintEl, profile.fingerprint ? profile.fingerprint.label : 'off');
  fingerprintEl.classList.toggle('is-spoofed', Boolean(profile.fingerprint));

  const statusText = card.querySelector('.status-text');
  const launchBtn = card.querySelector('.btn-launch');
  const scriptBtn = card.querySelector('.btn-script');
  const fingerprintBtn = card.querySelector('.btn-fingerprint');

  applyRunningState(card, statusText, launchBtn, scriptBtn, profile.running);
  updateCardSelectionVisual(card, profile.id);

  // Backend now closes a running profile itself before wiping its data
  // (see server.js) instead of refusing the request -- no need to
  // disable this while running anymore, just make the tooltip honest
  // about what clicking it will do in that case.
  fingerprintBtn.title = profile.running
    ? 'Closes this profile, then resets it: new fingerprint + clears all cookies/browsing data'
    : 'Reset this profile: new fingerprint + clears all cookies/browsing data (keeps name, proxy, and other settings)';

  launchBtn.addEventListener('click', () => toggleLaunch(profile.id, profile.running));
  scriptBtn.addEventListener('click', () => window.open(`/editor?profile=${profile.id}`, '_blank'));
  fingerprintBtn.addEventListener('click', () => regenerateFingerprint(profile.id, profile.name, profile.running));
  card.querySelector('.btn-icon-danger').addEventListener('click', () => deleteProfile(profile.id, profile.name));
  card.querySelector('.card-select').addEventListener('change', () => toggleSelection(profile.id));

  return node;
}

function applyRunningState(card, statusText, launchBtn, scriptBtn, running) {
  card.classList.toggle('is-running', running);
  launchBtn.classList.toggle('is-running', running);
  statusText.textContent = running ? 'running' : 'stopped';
  launchBtn.textContent = running ? 'Close' : 'Launch';
  scriptBtn.hidden = !running; // scripting needs a live page, so hide it until one exists
}

// -------------------------------------------------------------------
// Actions
// -------------------------------------------------------------------
async function toggleLaunch(id, isRunning) {
  const endpoint = isRunning ? 'close' : 'launch';
  try {
    const res = await fetch(`/api/profiles/${id}/${endpoint}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    showToast(isRunning ? 'Profile closed' : 'Profile launched');
  } catch (err) {
    showToast(err.message, true);
  } finally {
    loadProfiles();
  }
}

// Force-closes every window the server currently has open -- the manual
// escape hatch for windows that piled up (a queue script that hung and
// never freed its slot, or profiles launched by hand via the card
// "Launch" button and simply forgotten -- those never counted against
// the queue's "max concurrent" in the first place, since that limit only
// governs windows the QUEUE itself opened). See POST
// /api/profiles/close-all in server.js.
document.getElementById('closeAllRunningBtn').addEventListener('click', async () => {
  if (!confirm('Close every running profile window?')) return;
  try {
    const res = await fetch('/api/profiles/close-all', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    showToast(data.closed.length ? `Closed ${data.closed.length} window(s)` : 'Nothing was running');
  } catch (err) {
    showToast(err.message, true);
  } finally {
    loadProfiles();
  }
});

async function deleteProfile(id, name) {
  if (!confirm(`Delete "${name}"? This removes its saved cookies/storage too.`)) return;
  try {
    const res = await fetch(`/api/profiles/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed');
    showToast('Profile deleted');
  } catch (err) {
    showToast(err.message, true);
  } finally {
    loadProfiles();
  }
}

// Generates (or regenerates) this profile's canvas/WebGL/audio/font
// identity -- see fingerprint.js. Takes effect on the profile's NEXT
// launch; the server rejects this while the profile is currently
// running (the card also disables the button in that state, see
// buildCard, so this mostly guards against a stale/cached render).
async function regenerateFingerprint(id, name, isRunning) {
  const warning = isRunning
    ? `Reset "${name}"? This closes the open window and permanently deletes its cookies/login sessions/browsing data, then gives it a new fingerprint.`
    : `Reset "${name}"? This permanently deletes its cookies/login sessions/browsing data, then gives it a new fingerprint.`;
  if (!confirm(warning)) return;

  try {
    const res = await fetch(`/api/profiles/${id}/fingerprint`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not reset this profile');
    showToast(`Reset "${name}" \u2014 new fingerprint: ${data.fingerprint.label}`);
  } catch (err) {
    showToast(err.message, true);
  } finally {
    loadProfiles();
  }
}

// -------------------------------------------------------------------
// Drag-select (marquee) -- click-drag across the grid to select every
// card the rectangle touches, instead of checking boxes one at a time.
// A plain drag REPLACES the current selection; holding Shift ADDS to it.
// A click that barely moves (dragDistance < 4px) is treated as a normal
// click instead of a drag, toggling just the card under the cursor.
//
// The drag start/end points are tracked in DOCUMENT coordinates (e.pageX/
// pageY), not viewport coordinates -- the grid can be taller than one
// screen, and the page (not some inner container) is what scrolls. The
// box itself is `position: fixed` (viewport-relative), so its on-screen
// rect gets recomputed from the document-coordinate anchor minus the
// CURRENT scroll offset every time either the mouse moves or the page
// auto-scrolls (see autoScrollTick below) -- that's what keeps the box
// glued to the right spot on the page as it scrolls out from under it.
// -------------------------------------------------------------------
const selectionBox = document.getElementById('selectionBox');
let isDragging = false;
let dragStartX = 0; // document-relative (page) coordinates
let dragStartY = 0;
let dragStartedOnCard = null;
let lastClientX = 0; // last known viewport-relative mouse position
let lastClientY = 0;
let autoScrollRAF = null;

const AUTO_SCROLL_EDGE = 56; // px from the top/bottom viewport edge that starts auto-scrolling
const AUTO_SCROLL_MAX_SPEED = 20; // px scrolled per animation frame right at the very edge

function updateSelectionBoxRect() {
  const startViewportX = dragStartX - window.scrollX;
  const startViewportY = dragStartY - window.scrollY;
  const left = Math.min(startViewportX, lastClientX);
  const top = Math.min(startViewportY, lastClientY);
  selectionBox.style.left = `${left}px`;
  selectionBox.style.top = `${top}px`;
  selectionBox.style.width = `${Math.abs(lastClientX - startViewportX)}px`;
  selectionBox.style.height = `${Math.abs(lastClientY - startViewportY)}px`;
}

function updateDragHoverCards() {
  const boxRect = selectionBox.getBoundingClientRect();
  grid.querySelectorAll('.card').forEach((card) => {
    card.classList.toggle('is-drag-hover', rectsIntersect(boxRect, card.getBoundingClientRect()));
  });
}

function rectsIntersect(a, b) {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

// While dragging, if the mouse is sitting near the top or bottom edge of
// the viewport, keep scrolling the page that direction every frame (and
// re-run the box/hover update each frame too, since the cards move under
// a stationary mouse as the page scrolls) -- this is what lets a drag
// that starts on-screen reach profiles further down (or up) the grid
// instead of stopping dead at whatever was visible when the drag began.
function autoScrollTick() {
  if (!isDragging) {
    autoScrollRAF = null;
    return;
  }

  const vh = window.innerHeight;
  let dy = 0;
  if (lastClientY < AUTO_SCROLL_EDGE) {
    dy = -AUTO_SCROLL_MAX_SPEED * (1 - lastClientY / AUTO_SCROLL_EDGE);
  } else if (lastClientY > vh - AUTO_SCROLL_EDGE) {
    dy = AUTO_SCROLL_MAX_SPEED * (1 - (vh - lastClientY) / AUTO_SCROLL_EDGE);
  }

  if (dy !== 0) {
    const before = window.scrollY;
    window.scrollBy(0, dy);
    if (window.scrollY !== before) {
      updateSelectionBoxRect();
      updateDragHoverCards();
    }
  }

  autoScrollRAF = requestAnimationFrame(autoScrollTick);
}

grid.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return; // left button only
  if (e.target.closest('.card-actions') || e.target.classList.contains('card-select')) return; // let buttons/checkbox handle their own clicks

  if (!e.shiftKey) clearSelection(); // fresh drag replaces the old selection unless Shift extends it

  isDragging = true;
  dragStartX = e.pageX;
  dragStartY = e.pageY;
  lastClientX = e.clientX;
  lastClientY = e.clientY;
  dragStartedOnCard = e.target.closest('.card');

  selectionBox.hidden = false;
  updateSelectionBoxRect();
  e.preventDefault(); // stop the browser's native text/image drag-ghost from appearing

  if (!autoScrollRAF) autoScrollRAF = requestAnimationFrame(autoScrollTick);
});

document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  lastClientX = e.clientX;
  lastClientY = e.clientY;
  updateSelectionBoxRect();
  updateDragHoverCards();
});

document.addEventListener('mouseup', (e) => {
  if (!isDragging) return;
  isDragging = false;
  selectionBox.hidden = true;

  const dragDistance = Math.hypot(e.pageX - dragStartX, e.pageY - dragStartY);

  if (dragDistance < 4) {
    // barely moved -- a click, not a drag. Toggle whatever card it landed on, if any.
    if (dragStartedOnCard) toggleSelection(dragStartedOnCard.dataset.profileId);
  } else {
    grid.querySelectorAll('.card.is-drag-hover').forEach((card) => {
      selectedIds.add(card.dataset.profileId);
      card.classList.remove('is-drag-hover');
      updateCardSelectionVisual(card, card.dataset.profileId);
    });
    updateBulkToolbar();
  }

  dragStartedOnCard = null;
});

// -------------------------------------------------------------------
// Ctrl/Cmd+A -- select every profile currently in the grid, same idea
// as the drag-select box above but for "just grab everything" instead
// of drawing a rectangle. Skipped whenever focus is on a real text
// field (any of the create/edit-profile forms, settings inputs, etc.)
// so the browser's native "select all text in this field" still works
// there -- only hijacked when focus is on the page itself (or a
// non-text element like a button), which is where a plain Ctrl+A would
// otherwise do nothing useful anyway.
// -------------------------------------------------------------------
function isTypingTarget(el) {
  if (!el) return false;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
  return false;
}

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !isTypingTarget(document.activeElement) && overlay.hidden) {
    e.preventDefault();
    selectAllProfiles();
  }
});

// -------------------------------------------------------------------
// Create-profile panel
// -------------------------------------------------------------------
function closeAllPanelsInstantly(except) {
  for (const p of [createPanel, bulkCreatePanel, bulkProxyPanel, importPanel, settingsPanel, extensionsPanel]) {
    if (p !== except) {
      p.classList.remove('is-open', 'is-fullscreen');
      p.hidden = true;
    }
  }
}

function openCreatePanel() {
  closeAllPanelsInstantly(createPanel);
  overlay.hidden = false;
  createPanel.hidden = false;
  requestAnimationFrame(() => createPanel.classList.add('is-open'));
}

function closeCreatePanel() {
  createPanel.classList.remove('is-open');
  setTimeout(() => {
    overlay.hidden = true;
    createPanel.hidden = true;
    createForm.reset();
    // form.reset() puts engineModeSelect back to its HTML default ("custom"),
    // but doesn't touch our JS-driven `hidden` attribute -- resync it here.
    executablePathField.hidden = engineModeSelect.value !== 'custom';
  }, 220);
}

document.getElementById('openCreateBtn').addEventListener('click', openCreatePanel);
document.getElementById('emptyCreateBtn').addEventListener('click', openCreatePanel);
document.getElementById('closePanelBtn').addEventListener('click', closeCreatePanel);
document.getElementById('cancelCreateBtn').addEventListener('click', closeCreatePanel);
overlay.addEventListener('click', () => {
  closeCreatePanel();
  closeBulkCreatePanel();
  closeBulkProxyPanel();
  closeImportPanel();
  closeSettingsPanel();
});

// "Custom executable" is the only engine choice that needs a path, so
// that field only appears when it's relevant.
const engineModeSelect = document.getElementById('engineModeSelect');
const executablePathField = document.getElementById('executablePathField');
engineModeSelect.addEventListener('change', () => {
  executablePathField.hidden = engineModeSelect.value !== 'custom';
});

// If CHROME_PATH is set in .env, the whole per-profile engine picker is
// moot -- every launch uses that path regardless of what's selected here.
// Hide the picker and show a one-line note instead of a choice that would
// be silently overridden.
let chromePathConfigured = false;
async function loadConfig() {
  const res = await fetch('/api/config');
  const data = await res.json();
  chromePathConfigured = data.chromePathConfigured;
  document.getElementById('engineConfigSection').hidden = chromePathConfigured;
  document.getElementById('engineConfiguredNote').hidden = !chromePathConfigured;
  document.getElementById('bulkEngineConfigSection').hidden = chromePathConfigured;
  document.getElementById('bulkEngineConfiguredNote').hidden = !chromePathConfigured;
}
loadConfig();

// -------------------------------------------------------------------
// "Detect location from proxy" -- one reusable wiring, two spots that
// use it: the New Profile form's own proxy fields, and Bulk Create's
// separate "test proxy" (detection-only -- bulk-created profiles still
// get their real proxy later via "Change proxy…", same as always; this
// never assigns the tested proxy to anything). Shows what it found and
// offers to fill Locale/Timezone with it -- never applies automatically,
// since a wrong guess here would silently create exactly the kind of
// proxy/timezone mismatch the whole fingerprint layer is trying to avoid.
// -------------------------------------------------------------------
function wireDetectLocation({ button, result, getProxy, targetForm }) {
  button.addEventListener('click', async () => {
    const { proxyServer, proxyUsername, proxyPassword } = getProxy();
    if (!proxyServer) {
      result.hidden = false;
      result.textContent = 'Enter a proxy server first.';
      return;
    }

    button.disabled = true;
    const originalLabel = button.textContent;
    button.textContent = 'Checking\u2026';
    result.hidden = true;

    try {
      const res = await fetch('/api/detect-location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proxyServer, proxyUsername, proxyPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not check this proxy');

      result.hidden = false;
      result.textContent = '';
      const summary = document.createElement('span');
      summary.textContent = `Found: ${data.country}${data.city ? ', ' + data.city : ''} (IP ${data.ip}) \u2014 timezone ${data.timezone}` +
        (data.suggestedLocale ? `, suggested locale ${data.suggestedLocale}` : '');
      result.appendChild(summary);

      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'chip';
      applyBtn.textContent = 'Apply to Locale/Timezone';
      applyBtn.addEventListener('click', () => {
        targetForm.timezoneId.value = data.timezone;
        if (data.suggestedLocale) targetForm.locale.value = data.suggestedLocale;
        showToast('Locale/timezone updated from detected location');
      });
      result.appendChild(document.createElement('br'));
      result.appendChild(applyBtn);
    } catch (err) {
      result.hidden = false;
      result.textContent = err.message;
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  });
}

wireDetectLocation({
  button: document.getElementById('detectLocationBtn'),
  result: document.getElementById('detectLocationResult'),
  getProxy: () => ({
    proxyServer: createForm.proxyServer.value.trim(),
    proxyUsername: createForm.proxyUsername.value.trim(),
    proxyPassword: createForm.proxyPassword.value,
  }),
  targetForm: createForm,
});

createForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(createForm);
  const body = Object.fromEntries(formData.entries());

  try {
    const res = await fetch('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not create profile');
    showToast(`Profile "${data.name}" created`);
    closeCreatePanel();
    loadProfiles();
  } catch (err) {
    showToast(err.message, true);
  }
});

// -------------------------------------------------------------------
// Bulk create -- profiles named sequentially from a starting number,
// e.g. start=2 count=200 -> "2".."201". See POST /api/profiles/bulk.
// -------------------------------------------------------------------
const bulkCreatePanel = document.getElementById('bulkCreatePanel');
const bulkCreateForm = document.getElementById('bulkCreateForm');
const bulkEngineModeSelect = document.getElementById('bulkEngineModeSelect');
const bulkExecutablePathField = document.getElementById('bulkExecutablePathField');

const bulkUseIpTimezoneCheckbox = document.getElementById('bulkUseIpTimezoneCheckbox');
const bulkIpTimezoneFields = document.getElementById('bulkIpTimezoneFields');
bulkUseIpTimezoneCheckbox.addEventListener('change', () => {
  bulkIpTimezoneFields.hidden = !bulkUseIpTimezoneCheckbox.checked;
});

// Bulk create's own "fill locale/timezone from a proxy's IP" no longer
// has its own manual Detect/Apply button -- the detection call it used to
// make (detectLocationForProxy(), the same one behind /api/detect-location)
// launches a real headless browser through the given proxy, which is slow
// and fails often enough on flaky proxy lists that a manual "click to
// test, then click again to apply" dance wasn't worth it here. Ticking
// "Fill locale/timezone from a proxy's IP" and filling in the one-line
// proxy field is enough now -- the actual check runs server-side inside
// POST /api/profiles/bulk when the form submits (see that route), and
// degrades to whatever Locale/Timezone are typed above if it fails,
// rather than blocking the batch.

function openBulkCreatePanel() {
  closeAllPanelsInstantly(bulkCreatePanel);
  overlay.hidden = false;
  bulkCreatePanel.hidden = false;
  requestAnimationFrame(() => bulkCreatePanel.classList.add('is-open'));
}

function closeBulkCreatePanel() {
  bulkCreatePanel.classList.remove('is-open');
  setTimeout(() => {
    overlay.hidden = true;
    bulkCreatePanel.hidden = true;
    bulkCreateForm.reset();
    bulkExecutablePathField.hidden = bulkEngineModeSelect.value !== 'custom';
  }, 220);
}

document.getElementById('openBulkCreateBtn').addEventListener('click', openBulkCreatePanel);
document.getElementById('closeBulkCreateBtn').addEventListener('click', closeBulkCreatePanel);
document.getElementById('cancelBulkCreateBtn').addEventListener('click', closeBulkCreatePanel);

bulkEngineModeSelect.addEventListener('change', () => {
  bulkExecutablePathField.hidden = bulkEngineModeSelect.value !== 'custom';
});

bulkCreateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(bulkCreateForm).entries());
  const submitBtn = document.getElementById('bulkCreateSubmitBtn');

  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating\u2026';
  try {
    const res = await fetch('/api/profiles/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not create profiles');
    if (data.localeDetectionError) {
      showToast(
        `Created ${data.created} profiles: "${data.firstName}" \u2192 "${data.lastName}" \u2014 ` +
        `but couldn't detect locale/timezone from that proxy (${data.localeDetectionError}), used the typed-in values instead`,
        true
      );
    } else {
      showToast(`Created ${data.created} profiles: "${data.firstName}" \u2192 "${data.lastName}"`);
    }
    closeBulkCreatePanel();
    loadProfiles();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create profiles';
  }
});

// -------------------------------------------------------------------
// Bulk toolbar actions: deselect, delete selected, change proxy
// -------------------------------------------------------------------
document.getElementById('bulkDeselectBtn').addEventListener('click', clearSelection);

document.getElementById('bulkDeleteBtn').addEventListener('click', async () => {
  const ids = [...selectedIds];
  if (ids.length === 0) return;
  if (!confirm(`Delete ${ids.length} selected profile(s)? This also deletes their saved cookies/storage folders on disk. This can't be undone.`)) return;

  try {
    const res = await fetch('/api/profiles/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Bulk delete failed');
    showToast(`Deleted ${data.deleted} profile(s)`);
    selectedIds.clear();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    updateBulkToolbar();
    loadProfiles();
  }
});

// Clear cache -- only removes Chromium's own Cache/Code Cache/GPUCache/
// shader-cache folders for each selected profile (see clearProfileCache()
// in server.js for the exact list); cookies, localStorage, saved logins
// and history are never touched. Any of the selected profiles that's
// currently open gets force-closed first (same reason bulk-delete does --
// Chrome can hold its own cache files open), so the confirm dialog says
// so up front instead of that being a surprise.
document.getElementById('bulkClearCacheBtn').addEventListener('click', async () => {
  const ids = [...selectedIds];
  if (ids.length === 0) return;
  if (!confirm(`Clear cache for ${ids.length} selected profile(s)? Any of them currently open will be closed first. Cookies/logins are not touched.`)) return;

  const btn = document.getElementById('bulkClearCacheBtn');
  btn.disabled = true;
  btn.textContent = 'Clearing\u2026';
  try {
    const res = await fetch('/api/profiles/clear-cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Clear cache failed');
    const mb = (data.totalFreedBytes / (1024 * 1024)).toFixed(1);
    showToast(`Cleared cache for ${data.results.length} profile(s), freed ${mb} MB`);
  } catch (err) {
    showToast(err.message, true);
  } finally {
    btn.textContent = 'Clear cache';
    updateBulkToolbar();
    loadProfiles();
  }
});

// -------------------------------------------------------------------
// Bulk proxy change -- one proxy per line, matched in order to the
// currently-selected profiles as they appear on the grid (not the order
// they were clicked in, since that's harder to eyeball while pasting a
// prepared list). See POST /api/profiles/bulk-proxy.
// -------------------------------------------------------------------
const bulkProxyPanel = document.getElementById('bulkProxyPanel');
const proxyTargetList = document.getElementById('proxyTargetList');
const bulkProxyTextarea = document.getElementById('bulkProxyTextarea');
let proxyTargetIds = [];

function openBulkProxyPanel() {
  if (selectedIds.size === 0) return;
  closeAllPanelsInstantly(bulkProxyPanel);

  const targets = lastProfiles.filter((p) => selectedIds.has(p.id)); // grid order, filtered to selected
  proxyTargetIds = targets.map((p) => p.id);
  proxyTargetList.innerHTML = targets
    .map((p, i) => {
      // Hiện proxy HIỆN TẠI của profile đó -- trước khi bạn gõ đè giá
      // trị mới vào textarea bên dưới, để biết đang đổi TỪ đâu, không
      // phải đoán/nhớ lại.
      const current = p.proxyServer
        ? `${p.proxyServer.replace(/^https?:\/\//, '')}${p.proxyUsername ? `:${p.proxyUsername}` : ''}`
        : '(chưa có proxy)';
      return `<div class="proxy-target-row"><span class="proxy-target-index">${i + 1}.</span><span class="proxy-target-name">${p.name}</span><span class="proxy-target-current" title="Proxy hiện tại">${current}</span></div>`;
    })
    .join('');
  bulkProxyTextarea.value = '';

  overlay.hidden = false;
  bulkProxyPanel.hidden = false;
  requestAnimationFrame(() => bulkProxyPanel.classList.add('is-open'));
}

function closeBulkProxyPanel() {
  bulkProxyPanel.classList.remove('is-open');
  setTimeout(() => {
    overlay.hidden = true;
    bulkProxyPanel.hidden = true;
  }, 220);
}

document.getElementById('bulkProxyBtn').addEventListener('click', openBulkProxyPanel);
document.getElementById('closeBulkProxyBtn').addEventListener('click', closeBulkProxyPanel);

document.getElementById('applyBulkProxyBtn').addEventListener('click', async () => {
  const lines = bulkProxyTextarea.value.split('\n');
  // A pasted list often has a trailing blank line -- drop extras from the
  // end rather than force an exact-length paste for one stray newline.
  while (lines.length > proxyTargetIds.length && lines[lines.length - 1].trim() === '') lines.pop();

  // This now also resyncs locale/timezone per profile by default (server-
  // side, see /api/profiles/bulk-proxy) -- each check launches a real
  // headless browser through that profile's new proxy, so a big batch
  // takes noticeably longer than the old "just write some JSON" version.
  // Disable + relabel the button for the duration so it doesn't read as hung.
  const applyBtn = document.getElementById('applyBulkProxyBtn');
  const originalLabel = applyBtn.textContent;
  applyBtn.disabled = true;
  applyBtn.textContent = `Applying & resyncing locale… (${proxyTargetIds.length} profile${proxyTargetIds.length === 1 ? '' : 's'})`;

  try {
    const res = await fetch('/api/profiles/bulk-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: proxyTargetIds, proxies: lines }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not update proxies');

    // localeSynced/localeFailures only exist on servers that have the
    // auto-resync fix -- guard with typeof so this still degrades cleanly
    // against an older backend that only ever returns { updated }.
    let message = `Updated proxy on ${data.updated} profile(s)`;
    if (typeof data.localeSynced === 'number') {
      message += ` — locale/timezone resynced on ${data.localeSynced}`;
      if (data.localeFailures && data.localeFailures.length) {
        message += `, ${data.localeFailures.length} kept their previous locale/timezone (location check failed)`;
        console.warn('Locale resync failures:', data.localeFailures);
      }
    }
    showToast(message);
    closeBulkProxyPanel();
    loadProfiles();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    applyBtn.disabled = false;
    applyBtn.textContent = originalLabel;
  }
});

// -------------------------------------------------------------------
// Import -- a JSON array of profile-ish objects, pasted or uploaded as
// a .json file. See POST /api/profiles/import (server.js) for exactly
// what each item accepts; this panel is deliberately just a thin
// textarea + file reader, no client-side validation beyond "is it
// JSON" -- the server is the one place that already knows the real
// field rules (buildProfileObject / normalizeFingerprint), and
// duplicating that here would just be two places that could drift.
// -------------------------------------------------------------------
const importPanel = document.getElementById('importPanel');
const importTextarea = document.getElementById('importTextarea');
const importFileInput = document.getElementById('importFileInput');

function openImportPanel() {
  closeAllPanelsInstantly(importPanel);
  importTextarea.value = '';
  importFileInput.value = '';
  overlay.hidden = false;
  importPanel.hidden = false;
  requestAnimationFrame(() => importPanel.classList.add('is-open'));
}

function closeImportPanel() {
  importPanel.classList.remove('is-open');
  setTimeout(() => {
    overlay.hidden = true;
    importPanel.hidden = true;
  }, 220);
}

document.getElementById('openImportBtn').addEventListener('click', openImportPanel);
document.getElementById('closeImportBtn').addEventListener('click', closeImportPanel);

// A chosen file is the source of truth over whatever's in the textarea
// (matches the panel's own top-to-bottom order: file field, then "or
// paste JSON") -- read it into the textarea so there's one code path
// that actually submits, and so the user can see/edit what got loaded.
importFileInput.addEventListener('change', async () => {
  const file = importFileInput.files[0];
  if (!file) return;
  importTextarea.value = await file.text();
});

document.getElementById('applyImportBtn').addEventListener('click', async () => {
  let items;
  try {
    items = JSON.parse(importTextarea.value);
  } catch (err) {
    showToast('Not valid JSON: ' + err.message, true);
    return;
  }
  if (!Array.isArray(items)) {
    showToast('Top level must be a JSON array of profile objects', true);
    return;
  }

  const submitBtn = document.getElementById('applyImportBtn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Importing\u2026';
  try {
    const res = await fetch('/api/profiles/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Import failed');

    const errorNote = data.errors.length ? `, ${data.errors.length} skipped` : '';
    showToast(`Imported ${data.created} profile(s)${errorNote}`, data.errors.length > 0 && data.created === 0);
    if (data.errors.length) console.warn('Import errors:', data.errors);
    closeImportPanel();
    loadProfiles();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Import';
  }
});

// -------------------------------------------------------------------
// Settings (gear icon, topbar) -- GET/POST /api/settings, backed by
// .env on the server (see writeEnvValues() there). Loads current
// values fresh every time the panel opens rather than caching them, so
// it can't show something stale after a manual .env edit outside the UI.
// -------------------------------------------------------------------
const settingsPanel = document.getElementById('settingsPanel');
const settingsDataDirInput = document.getElementById('settingsDataDir');
const settingsChromePathInput = document.getElementById('settingsChromePath');
const settingsAutoClearCacheInput = document.getElementById('settingsAutoClearCache');

async function openSettingsPanel() {
  closeAllPanelsInstantly(settingsPanel);
  overlay.hidden = false;
  settingsPanel.hidden = false;
  requestAnimationFrame(() => settingsPanel.classList.add('is-open'));

  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    settingsDataDirInput.value = data.dataDir || '';
    settingsChromePathInput.value = data.chromePath || '';
    settingsAutoClearCacheInput.checked = Boolean(data.autoClearCacheAfterRun);
  } catch (err) {
    showToast('Could not load current settings: ' + err.message, true);
  }
}

function closeSettingsPanel() {
  settingsPanel.classList.remove('is-open');
  setTimeout(() => {
    overlay.hidden = true;
    settingsPanel.hidden = true;
  }, 220);
}

document.getElementById('openSettingsBtn').addEventListener('click', openSettingsPanel);
document.getElementById('closeSettingsBtn').addEventListener('click', closeSettingsPanel);
document.getElementById('cancelSettingsBtn').addEventListener('click', closeSettingsPanel);

document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
  const btn = document.getElementById('saveSettingsBtn');
  btn.disabled = true;
  btn.textContent = 'Saving\u2026';
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataDir: settingsDataDirInput.value.trim(),
        chromePath: settingsChromePathInput.value.trim(),
        autoClearCacheAfterRun: settingsAutoClearCacheInput.checked,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save settings');
    showToast('Saved to .env \u2014 restart the server (Ctrl+C, then npm start) to apply it');
    closeSettingsPanel();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save to .env';
  }
});

// -------------------------------------------------------------------
// Extensions (puzzle-piece icon, topbar) -- GET/POST /api/global-extensions.
// Unlike Settings above, this is stored in data/ (not .env) and is read
// FRESH by the server on every profile launch -- so saving here needs
// only that profile's NEXT launch, not a full server restart.
// -------------------------------------------------------------------
const extensionsPanel = document.getElementById('extensionsPanel');
const globalExtensionsInput = document.getElementById('globalExtensionsInput');

async function openExtensionsPanel() {
  closeAllPanelsInstantly(extensionsPanel);
  overlay.hidden = false;
  extensionsPanel.hidden = false;
  requestAnimationFrame(() => extensionsPanel.classList.add('is-open'));

  try {
    const res = await fetch('/api/global-extensions');
    const data = await res.json();
    globalExtensionsInput.value = (data.extensionPaths || []).join('\n');
  } catch (err) {
    showToast('Could not load current extensions: ' + err.message, true);
  }
}

function closeExtensionsPanel() {
  extensionsPanel.classList.remove('is-open');
  setTimeout(() => {
    overlay.hidden = true;
    extensionsPanel.hidden = true;
  }, 220);
}

document.getElementById('openExtensionsBtn').addEventListener('click', openExtensionsPanel);
document.getElementById('closeExtensionsBtn').addEventListener('click', closeExtensionsPanel);
document.getElementById('cancelExtensionsBtn').addEventListener('click', closeExtensionsPanel);

document.getElementById('saveExtensionsBtn').addEventListener('click', async () => {
  const btn = document.getElementById('saveExtensionsBtn');
  btn.disabled = true;
  btn.textContent = 'Saving\u2026';
  try {
    const res = await fetch('/api/global-extensions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ extensionPaths: globalExtensionsInput.value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save extensions');
    showToast(
      data.extensionPaths.length
        ? `Saved -- ${data.extensionPaths.length} extension folder(s), applies on each profile's next launch`
        : 'Saved -- no global extension folders set'
    );
    closeExtensionsPanel();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
});

// -------------------------------------------------------------------
// Sort A-Z toggle -- purely a display-order preference (re-renders
// from the already-fetched lastProfiles, no request needed), so it
// takes effect instantly and survives the next poll too.
// -------------------------------------------------------------------
sortAlphaBtn.addEventListener('click', () => {
  sortAlphabetically = !sortAlphabetically;
  sortAlphaBtn.classList.toggle('is-active', sortAlphabetically);
  sortAlphaBtn.textContent = sortAlphabetically ? 'Sorted A-Z' : 'Sort A-Z';
  renderProfiles(lastProfiles);
});

// -------------------------------------------------------------------
// Poll every few seconds so running/stopped status stays fresh even
// if a window was closed manually by the user instead of via the UI,
// and so the queue's progress is visible without re-opening the panel.
// -------------------------------------------------------------------
loadProfiles();
initChromeVersionBanner();
setInterval(loadProfiles, 4000);