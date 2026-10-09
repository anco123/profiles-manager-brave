/**
 * editor.js
 * -----------------------------------------------------------------------
 * Logic for the standalone /editor page. Loaded after shared.js, so
 * initCodeEditor/TEMPLATE_GROUPS/SCRIPT_TEMPLATES/insertSnippet/
 * renderChipGroups are already available here.
 *
 * Mental model: "main" is the one tab that's always open and can't be
 * closed, and it's what actually runs (its content is POSTed to
 * /api/profiles/:id/run) -- but it IS a real file too, saved on disk as
 * scripts/main.js, same as any other tab. The only things still special
 * about it: it can't be closed or deleted, and on disk its name is
 * "main.js" while its internal tab key is just "main" (see
 * diskNameFor() below for that one mapping). Every other open tab is a
 * REAL file in scripts/, readable via require('./name') from main or
 * from each other -- closing a tab just hides it from the tab bar, the
 * file stays on disk; deleting (via the file menu's x) actually removes
 * it.
 * -----------------------------------------------------------------------
 */

const tabBar = document.getElementById('tabBar');
const editorOutput = document.getElementById('editorOutput');
const toggleOutputBtn = document.getElementById('toggleOutputBtn');
const outputLabel = document.getElementById('outputLabel');
const newFileBtn = document.getElementById('newFileBtn');
const fileMenu = document.getElementById('fileMenu');
const fileMenuList = document.getElementById('fileMenuList');
const createFileBtn = document.getElementById('createFileBtn');
const toastEl = document.getElementById('toast');

// One CodeMirror instance, reused across tabs -- its content is swapped
// on switch rather than keeping N separate instances alive. Simpler, and
// plenty fast for editing a handful of short scripts.
const editor = initCodeEditor('editorTextarea', null, null);

let openTabs = ['main']; // tab names, in tab-bar order. 'main' is special (see header comment).
let tabContents = { main: '' };
let activeTab = 'main';

// The only place "main" the tab key and "main.js" the on-disk filename
// ever need reconciling -- every read/write against the server goes
// through this so the mapping only has to be right in one spot.
function diskNameFor(tabKey) {
  return tabKey === 'main' ? 'main.js' : tabKey;
}

let toastTimer = null;
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
// Tabs
// -------------------------------------------------------------------
// Manual-save model: editing a file-backed tab only changes it in
// browser memory (tabContents) and marks it dirty here -- nothing
// touches disk until Save (button, or Ctrl/Cmd+S) is explicitly
// pressed. dirtyTabs drives the little unsaved-dot on each tab AND
// blocks Run (see confirmRunBtn below) until everything open is saved,
// so a script can never silently run stale on-disk code while the
// editor shows something newer.
const dirtyTabs = new Set();

function renderTabBar() {
  tabBar.innerHTML = '';
  for (const name of openTabs) {
    const isMain = name === 'main';
    const isDirty = dirtyTabs.has(name);
    const tab = document.createElement('div');
    tab.className = 'editor-tab' + (name === activeTab ? ' is-active' : '') + (isMain ? ' is-main' : '');
    const displayName = isMain ? 'main.js' : name;
    tab.innerHTML =
      `<span>${displayName}${isDirty ? ' <span class="tab-dirty-dot" title="Unsaved changes">\u25cf</span>' : ''}</span>` +
      `<span class="tab-close" title="Close tab">&times;</span>`;
    tab.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-close')) {
        closeTab(name);
      } else {
        switchToTab(name);
      }
    });
    tabBar.appendChild(tab);
  }
}

async function switchToTab(name) {
  if (name === activeTab) return;
  tabContents[activeTab] = editor.getValue(); // remember where we're leaving from -- stays in memory, NOT written to disk

  activeTab = name;
  editor.setValue(tabContents[name] ?? '');
  editor.refresh();
  renderTabBar();
}

async function openFileTab(name, content) {
  if (!openTabs.includes(name)) openTabs.push(name);
  tabContents[name] = content;
  await switchToTab(name);
}

async function closeTab(name) {
  if (name === 'main') return; // main can't be closed, only cleared
  if (activeTab === name) tabContents[name] = editor.getValue();
  if (dirtyTabs.has(name) && !confirm(`"${name}" has unsaved changes. Close without saving them?`)) return;
  openTabs = openTabs.filter((t) => t !== name);
  delete tabContents[name];
  dirtyTabs.delete(name);
  if (activeTab === name) await switchToTab('main');
  else renderTabBar();
  refreshFileMenu();
}

// Writes to disk. `name` is a TAB KEY ('main' or a real filename) --
// mapped to the actual on-disk filename internally, so callers never
// have to remember that "main" the tab is "main.js" the file. Returns
// true/false so callers can tell whether it's safe to clear a dirty
// flag -- a failed save must NOT look saved.
async function saveFile(name, code) {
  const diskName = diskNameFor(name);
  try {
    const res = await fetch(`/api/scripts/${encodeURIComponent(diskName)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    return true;
  } catch (err) {
    showToast(`Couldn't save ${diskName}: ${err.message}`, true);
    return false;
  }
}

// Saves the currently active tab (Save button / Ctrl/Cmd+S) -- creates
// scripts/main.js (or whichever file) the first time, overwrites it
// after that; PUT /api/scripts/:name already does exactly that on the
// server side, nothing extra needed here for the create-vs-overwrite
// distinction.
async function saveActiveTab() {
  const code = editor.getValue();
  tabContents[activeTab] = code;
  const ok = await saveFile(activeTab, code);
  if (ok) {
    dirtyTabs.delete(activeTab);
    renderTabBar();
    showToast(`Saved ${diskNameFor(activeTab)}`);
  }
}

document.getElementById('saveFileBtn').addEventListener('click', saveActiveTab);
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveActiveTab();
  }
});

// Still a safety net for the rare case autosave hasn't caught up yet
// (see the debounce below) -- e.g. closing within 800ms of a keystroke.
window.addEventListener('beforeunload', (e) => {
  if (dirtyTabs.size === 0) return;
  e.preventDefault();
  e.returnValue = '';
});

// Autosave: writes to disk ~800ms after you stop typing, same debounce
// as before -- silent (no toast; a toast every 800ms while typing would
// be noisy), clears the dirty-dot once it lands. The explicit Save
// button/Ctrl+S above still exists for "save RIGHT NOW" with visible
// confirmation, and Run (below) still force-flushes + still refuses to
// run with anything unsaved -- this just means that block rarely
// actually fires in practice, since by the time you go click Run,
// autosave has almost always already caught up.
let autosaveTimer = null;
async function autosaveTab(name) {
  const code = tabContents[name];
  if (code === undefined) return;
  const ok = await saveFile(name, code);
  if (ok && dirtyTabs.has(name)) {
    // Only clear the dot if the content hasn't moved on again since
    // this particular autosave was kicked off (e.g. you kept typing
    // during the network round trip) -- otherwise a slow save could
    // clear the dot for edits it never actually wrote.
    if (tabContents[name] === code) {
      dirtyTabs.delete(name);
      renderTabBar();
    }
  }
}

editor.on('change', () => {
  if (!dirtyTabs.has(activeTab)) {
    dirtyTabs.add(activeTab);
    renderTabBar(); // only re-render on the 0-\u2192dirty transition, not every keystroke
  }
  tabContents[activeTab] = editor.getValue();
  const name = activeTab;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => autosaveTab(name), 800);
});

// -------------------------------------------------------------------
// File menu ("+" button): new file, or open/delete an existing one
// -------------------------------------------------------------------
newFileBtn.addEventListener('click', () => {
  fileMenu.hidden = !fileMenu.hidden;
  if (!fileMenu.hidden) refreshFileMenu();
});

createFileBtn.addEventListener('click', async () => {
  let name = prompt('File name (letters, numbers, - and _ only):', 'helper.js');
  if (!name) return;
  if (!name.endsWith('.js')) name += '.js';
  if (!/^[a-zA-Z0-9_-]+\.js$/.test(name)) {
    return showToast('Invalid name -- letters, numbers, - and _ only', true);
  }
  await saveFile(name, `module.exports = {\n  // your function here\n};\n`);
  await openFileTab(name, `module.exports = {\n  // your function here\n};\n`);
  fileMenu.hidden = true;
  showToast(`Created ${name}`);
});

async function refreshFileMenu() {
  const res = await fetch('/api/scripts');
  const files = (await res.json()).filter((f) => f !== 'main.js'); // main.js is always represented by the special 'main' tab already -- listing it again here would let you open a second, disconnected tab pointing at the same file

  fileMenuList.innerHTML = '';
  if (files.length === 0) {
    fileMenuList.innerHTML = '<p class="muted" style="padding:6px 8px;margin:0;font-size:0.78rem;">No other files yet</p>';
    return;
  }
  for (const name of files) {
    const isOpen = openTabs.includes(name);
    const row = document.createElement('div');
    row.className = 'file-menu-row';
    row.innerHTML =
      `<button type="button" class="file-menu-item">${name}${isOpen ? ' <span class="muted" style="font-size:0.7rem;">(open)</span>' : ''}</button>` +
      `<button type="button" class="file-menu-rename" title="Rename">&#9998;</button>` +
      `<button type="button" class="file-menu-delete" title="Delete permanently">&times;</button>`;

    row.querySelector('.file-menu-item').addEventListener('click', async () => {
      if (isOpen) {
        await switchToTab(name);
      } else {
        const fileRes = await fetch(`/api/scripts/${encodeURIComponent(name)}`);
        const data = await fileRes.json();
        await openFileTab(name, data.code);
      }
      fileMenu.hidden = true;
    });

    row.querySelector('.file-menu-rename').addEventListener('click', async (e) => {
      e.stopPropagation();
      await renameFile(name);
    });

    row.querySelector('.file-menu-delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete ${name} permanently? This can't be undone.`)) return;
      const delRes = await fetch(`/api/scripts/${encodeURIComponent(name)}`, { method: 'DELETE' });
      const delData = await delRes.json();
      if (!delRes.ok) return showToast(delData.error, true);

      if (openTabs.includes(name)) removeOpenTabWithoutSaving(name); // it's gone from disk -- don't let a normal close accidentally recreate it
      showToast(`Deleted ${name}`);
      refreshFileMenu();
    });

    fileMenuList.appendChild(row);
  }
}

// Scans main.js's content plus every file in scripts/ for
// require('./oldBase') or require('./oldBase.js') (either quote style)
// and rewrites it to point at newBase instead. Returns how many places
// were changed. Uses a fresh RegExp per call site rather than reusing
// one -- a /g-flagged regex's .test()/.exec() advance their own
// lastIndex, which silently breaks repeated use of the same instance.
async function updateRequireReferences(oldBase, newBase) {
  const escapedOld = oldBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = () => new RegExp(`(require\\(['"]\\./)${escapedOld}(?:\\.js)?(['"]\\))`, 'g');

  let updatedCount = 0;

  if (pattern().test(tabContents.main)) {
    const updatedMain = tabContents.main.replace(pattern(), `$1${newBase}$2`);
    tabContents.main = updatedMain;
    if (activeTab === 'main') editor.setValue(updatedMain);
    const ok = await saveFile('main', updatedMain); // main.js is a real file now too -- persist the rewrite, don't just leave it sitting in memory
    if (ok) dirtyTabs.delete('main');
    updatedCount++;
  }

  const allFiles = await (await fetch('/api/scripts')).json();
  for (const fileName of allFiles) {
    if (fileName === 'main.js') continue; // already handled above via tabContents.main -- the on-disk copy is stale until that save lands, don't double-process it here
    let code = tabContents[fileName];
    if (code === undefined) {
      const res = await fetch(`/api/scripts/${encodeURIComponent(fileName)}`);
      code = (await res.json()).code;
    }
    if (pattern().test(code)) {
      const updated = code.replace(pattern(), `$1${newBase}$2`);
      const ok = await saveFile(fileName, updated);
      if (tabContents[fileName] !== undefined) {
        tabContents[fileName] = updated;
        if (activeTab === fileName) editor.setValue(updated);
        if (ok) dirtyTabs.delete(fileName); // this write just brought disk in sync with memory for this file too
      }
      updatedCount++;
    }
  }
  renderTabBar(); // in case any of the above changed a dirty-dot

  return updatedCount;
}

// Renames a file (any file(name) on disk, open or not) by creating the
// new name with the old content and removing the old one -- there's no
// dedicated rename endpoint, this composes the existing GET/PUT/DELETE
// script routes. If the file is currently open as a tab, the tab is
// updated in place (same content, new label) instead of being lost.
async function renameFile(oldName) {
  let newName = prompt(`Rename "${oldName}" to:`, oldName.replace(/\.js$/, ''));
  if (!newName) return;
  if (!newName.endsWith('.js')) newName += '.js';
  if (!/^[a-zA-Z0-9_-]+\.js$/.test(newName)) {
    return showToast('Invalid name -- letters, numbers, - and _ only', true);
  }
  if (newName === oldName) return;

  try {
    const readRes = await fetch(`/api/scripts/${encodeURIComponent(oldName)}`);
    if (!readRes.ok) throw new Error("Couldn't read the file to rename");
    const { code } = await readRes.json();

    await saveFile(newName, code); // PUT creates it -- no separate "create" step needed

    const delRes = await fetch(`/api/scripts/${encodeURIComponent(oldName)}`, { method: 'DELETE' });
    const delData = await delRes.json();

    if (openTabs.includes(oldName)) {
      const idx = openTabs.indexOf(oldName);
      openTabs[idx] = newName;
      tabContents[newName] = tabContents[oldName];
      delete tabContents[oldName];
      if (dirtyTabs.has(oldName)) { dirtyTabs.delete(oldName); dirtyTabs.add(newName); } // the rename itself only wrote the OLD saved content under the new name -- any unsaved edits still need Save
      if (activeTab === oldName) activeTab = newName;
      if (runSelectedScript === oldName) runSelectedScript = newName;
      renderTabBar();
    }

    // A rename doesn't just move the file -- anything that did
    // require('./oldBase') would otherwise silently break the next time
    // it runs ("Cannot find module ..."), often long after the rename,
    // when it's much less obvious why. Fix those up now instead.
    const refCount = await updateRequireReferences(oldName.replace(/\.js$/, ''), newName.replace(/\.js$/, ''));

    if (!delRes.ok) {
      // e.g. renaming FROM helpers.js, which the backend protects from deletion
      showToast(`Created ${newName}, but couldn't remove ${oldName}: ${delData.error}`, true);
    } else if (refCount > 0) {
      showToast(`Renamed to ${newName}, updated ${refCount} require() reference${refCount > 1 ? 's' : ''}`);
    } else {
      showToast(`Renamed to ${newName}`);
    }
  } catch (err) {
    showToast(err.message, true);
  } finally {
    refreshFileMenu();
  }
}

// Drops a file from the open-tabs state without saving it first -- used
// after the file was just deleted, where a normal close's "save on the
// way out" would silently recreate it.
function removeOpenTabWithoutSaving(name) {
  openTabs = openTabs.filter((t) => t !== name);
  delete tabContents[name];
  dirtyTabs.delete(name);
  if (activeTab === name) {
    activeTab = 'main';
    editor.setValue(tabContents.main ?? '');
    editor.refresh();
  }
  renderTabBar();
}

document.addEventListener('click', (e) => {
  if (!fileMenu.hidden && !fileMenu.contains(e.target) && e.target !== newFileBtn) {
    fileMenu.hidden = true;
  }
});

// -------------------------------------------------------------------
// Templates (shared.js) -- inserted into whichever tab is active
// -------------------------------------------------------------------
renderChipGroups(document.getElementById('editorChipGroups'), editor);

// -------------------------------------------------------------------
// Profile tracking -- used by the Run modal's profile grid. This page
// itself no longer has its own "pick one profile" control; that's what
// the modal's drag-select grid replaces.
// -------------------------------------------------------------------
const preselectId = new URLSearchParams(location.search).get('profile');
let lastProfiles = [];

async function refreshProfiles() {
  const res = await fetch('/api/profiles');
  lastProfiles = await res.json();
  if (!runModalOverlay.hidden) renderRunProfileGrid(); // keep running/stopped dots live while the modal is open
  if (excelImportState) renderExcelSidebarPreview(); // profile list may have changed (added/renamed) -- keep the sidebar match preview current
}

// -------------------------------------------------------------------
// Output panel (shared by manual runs from within the modal's log too)
// -------------------------------------------------------------------
function renderOutput(data, isError) {
  const lines = [...(data.logs || [])];
  if (isError) {
    lines.push(`Error: ${data.error}`);
  } else if (data.result !== null && data.result !== undefined) {
    lines.push(`\u2192 ${JSON.stringify(data.result)}`);
  } else if (lines.length === 0) {
    lines.push('(ran with no output \u2014 try adding a log(...) call)');
  }
  editorOutput.textContent = lines.join('\n');
  editorOutput.classList.toggle('is-error', isError);
  if (editorOutput.classList.contains('is-collapsed')) toggleOutputBtn.click(); // reveal output on a fresh run
}

toggleOutputBtn.addEventListener('click', () => {
  editorOutput.classList.toggle('is-collapsed');
  toggleOutputBtn.classList.toggle('is-collapsed');
});

// -------------------------------------------------------------------
// Run modal -- this IS the queue (README section 11). Pick a script
// (any open tab, not just main), drag-select which profiles to run it
// on, set concurrency/retry/input, hit Run. POSTs straight to the same
// /api/queue/start the old dashboard panel used -- only the UI that
// calls it moved.
// -------------------------------------------------------------------
const runModalOverlay = document.getElementById('runModalOverlay');
const runProfileGrid = document.getElementById('runProfileGrid');
const runSelectionBox = document.getElementById('runSelectionBox');
const runScriptPicker = document.getElementById('runScriptPicker');
const runProfileCount = document.getElementById('runProfileCount');
const runModalStatus = document.getElementById('runModalStatus');
const runModalConfigView = document.getElementById('runModalConfigView');
const runModalLogView = document.getElementById('runModalLogView');
const backToConfigBtn = document.getElementById('backToConfigBtn');
const closeRunModalBtn = document.getElementById('closeRunModalBtn');
const stopRunBtn = document.getElementById('stopRunBtn');

const runSelectedIds = new Set();
let runSelectedScript = 'main';
let queueIsRunning = false; // kept in sync by refreshRunModalStatus -- guards closing the modal
let runModalForceConfig = false; // true after "Configure a new run" -- overrides the log view even if a finished run's log still exists

function openRunModal() {
  if (activeTab === 'main') tabContents.main = editor.getValue();
  runSelectedScript = activeTab; // default to whichever tab you're currently looking at
  renderRunScriptPicker();
  renderRunProfileGrid();
  runModalOverlay.hidden = false;
  refreshRunModalStatus();
  // The Excel import itself lives in the page's left sidebar now, not
  // in this popup -- but "Input data" should still reflect it for
  // whatever's already selected the moment this opens.
  if (excelImportState) applyExcelMatchToRunInput();
}

function closeRunModal() {
  // A running queue is easy to lose track of if this popup can just be
  // dismissed mid-run -- especially with Excel-imported data, where
  // closing and reopening used to silently reset "Input data" back to
  // blank (see openRunModal's comment above). Closing is only allowed
  // once the queue is idle.
  if (queueIsRunning) {
    showToast('Queue đang chạy \u2014 bấm Stop trước nếu muốn đóng', true);
    return;
  }
  runModalOverlay.hidden = true;
}

document.getElementById('openRunModalBtn').addEventListener('click', openRunModal);
closeRunModalBtn.addEventListener('click', closeRunModal);
runModalOverlay.addEventListener('click', (e) => {
  if (e.target === runModalOverlay) closeRunModal(); // click the dimmed backdrop, not the modal itself
});

backToConfigBtn.addEventListener('click', () => {
  runModalForceConfig = true;
  refreshRunModalStatus();
});

function renderRunScriptPicker() {
  runScriptPicker.innerHTML = '';
  for (const name of openTabs) {
    const label = document.createElement('label');
    label.className = 'run-script-option' + (name === runSelectedScript ? ' is-checked' : '');
    const displayName = name === 'main' ? 'main.js' : name;
    label.innerHTML = `<input type="radio" name="runScript" value="${displayName}" ${name === runSelectedScript ? 'checked' : ''} /><span>${displayName}</span>`;
    label.querySelector('input').addEventListener('change', () => {
      runSelectedScript = name;
      renderRunScriptPicker();
    });
    runScriptPicker.appendChild(label);
  }
}

function applyRunChipVisual(chip, id) {
  const selected = runSelectedIds.has(id);
  chip.classList.toggle('is-selected', selected);
  const cb = chip.querySelector('.run-profile-chip-check');
  if (cb) cb.checked = selected;
}

function updateRunProfileCount() {
  runProfileCount.textContent = runSelectedIds.size ? `(${runSelectedIds.size} selected)` : '';
  // Selection changed -- if an Excel file was imported (in the sidebar,
  // independent of this popup), re-fill "Input data" for whichever
  // profiles are selected now. excelImportState/applyExcelMatchToRunInput
  // are declared further down this file but already assigned by the
  // time any of this can actually run (script finishes loading before
  // the user can click anything), so referencing them here is safe.
  if (excelImportState) applyExcelMatchToRunInput();
}

function toggleRunSelection(id) {
  if (runSelectedIds.has(id)) runSelectedIds.delete(id);
  else runSelectedIds.add(id);
  const chip = runProfileGrid.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (chip) applyRunChipVisual(chip, id);
  updateRunProfileCount();
}

function renderRunProfileGrid() {
  // Prune selections for profiles that no longer exist, same reasoning
  // as the dashboard's selectedIds pruning.
  const liveIds = new Set(lastProfiles.map((p) => p.id));
  for (const id of [...runSelectedIds]) if (!liveIds.has(id)) runSelectedIds.delete(id);

  // Always alphabetical here -- unlike the dashboard's optional toggle,
  // picking profiles to run by dragging across this grid only makes
  // sense if they sit in a predictable A-Z order instead of whatever
  // order the API happens to return. Same comparison as the dashboard's
  // Sort A-Z so "P-2" still lands before "P-10".
  const ordered = [...lastProfiles].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  );

  runProfileGrid.innerHTML = '';
  for (const p of ordered) {
    const chip = document.createElement('div');
    chip.className = 'run-profile-chip' + (p.running ? ' is-running' : '');
    chip.dataset.id = p.id;
    chip.title = p.name;
    chip.innerHTML = `<input type="checkbox" class="run-profile-chip-check" /><span class="status-dot"></span><span class="chip-name">${p.name}</span>`;
    chip.querySelector('.run-profile-chip-check').addEventListener('change', () => toggleRunSelection(p.id));
    applyRunChipVisual(chip, p.id);
    runProfileGrid.appendChild(chip);
  }
  updateRunProfileCount();
}

// Drag-select within the modal's profile grid -- same algorithm as the
// dashboard's (mousedown starts tracking, mousemove grows a positioned
// box and checks intersection, mouseup finalizes or falls back to a
// plain click if the drag barely moved). Kept as its own copy rather
// than shared with app.js's version since the two run on different
// pages against different elements/state.
//
// One real difference from the dashboard: this grid lives INSIDE a
// modal and scrolls itself (overflow-y: auto), the page behind it never
// moves. So "auto-scroll while dragging near the edge" here means
// scrolling runProfileGrid.scrollTop, not window.scrollBy.
//
// The Y anchor is tracked in the grid's own CONTENT coordinates -- i.e.
// (clientY - grid's rect.top) + grid.scrollTop -- the exact same trick
// the dashboard uses with e.pageY against window.scrollY, just scoped to
// this one element instead of the whole document. That's what makes a
// chip that was already swept over STAY selected once auto-scroll
// carries it out of view: the box's top/bottom are content-space
// positions that only ever grow apart as you keep dragging past the
// edge, they don't shrink back down just because the viewport moved.
// (A first version measured everything in raw viewport pixels and
// re-checked intersection against the box every frame -- which meant a
// chip dropped its "inside the box" status the instant auto-scroll
// carried it past the box's on-screen edge, silently un-selecting
// anything already swept over. Content-space coordinates avoid that
// because the box never "moves away" from an already-covered chip --
// it only extends further.)
// X doesn't need any of this since the grid never scrolls horizontally.
let isRunDragging = false;
let runDragStartX = 0; // viewport-relative (grid never scrolls horizontally)
let runDragStartY = 0; // grid CONTENT-relative: (clientY - rect.top) + scrollTop at drag start
let runDragStartedOnChip = null;
let lastRunClientX = 0; // last known viewport-relative mouse position
let lastRunClientY = 0;
let runAutoScrollRAF = null;

const RUN_AUTO_SCROLL_EDGE = 40; // px from the top/bottom edge of the profile grid that starts auto-scrolling
const RUN_AUTO_SCROLL_MAX_SPEED = 16; // px scrolled per animation frame right at the very edge

function updateRunSelectionBoxRect() {
  const rect = runProfileGrid.getBoundingClientRect();
  const startViewportY = (runDragStartY - runProfileGrid.scrollTop) + rect.top;
  const left = Math.min(runDragStartX, lastRunClientX);
  const top = Math.min(startViewportY, lastRunClientY);
  runSelectionBox.style.left = `${left}px`;
  runSelectionBox.style.top = `${top}px`;
  runSelectionBox.style.width = `${Math.abs(lastRunClientX - runDragStartX)}px`;
  runSelectionBox.style.height = `${Math.abs(lastRunClientY - startViewportY)}px`;
}

function updateRunDragHover() {
  const boxRect = runSelectionBox.getBoundingClientRect();
  runProfileGrid.querySelectorAll('.run-profile-chip').forEach((chip) => {
    chip.classList.toggle('is-drag-hover', runRectsIntersect(boxRect, chip.getBoundingClientRect()));
  });
}

function runRectsIntersect(a, b) {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

// While dragging, if the mouse sits near the top/bottom edge of the
// profile grid itself, keep scrolling that element every frame (and
// re-run the box/hover update each frame too, since the chips move
// under a stationary mouse as the grid scrolls) -- same idea as the
// dashboard's autoScrollTick, just scoped to this one scrollable box
// instead of the whole window.
function runAutoScrollTick() {
  if (!isRunDragging) {
    runAutoScrollRAF = null;
    return;
  }

  const rect = runProfileGrid.getBoundingClientRect();
  let dy = 0;
  if (lastRunClientY < rect.top + RUN_AUTO_SCROLL_EDGE) {
    dy = -RUN_AUTO_SCROLL_MAX_SPEED * (1 - Math.max(0, lastRunClientY - rect.top) / RUN_AUTO_SCROLL_EDGE);
  } else if (lastRunClientY > rect.bottom - RUN_AUTO_SCROLL_EDGE) {
    dy = RUN_AUTO_SCROLL_MAX_SPEED * (1 - Math.max(0, rect.bottom - lastRunClientY) / RUN_AUTO_SCROLL_EDGE);
  }

  if (dy !== 0) {
    const before = runProfileGrid.scrollTop;
    runProfileGrid.scrollTop += dy;
    if (runProfileGrid.scrollTop !== before) {
      updateRunSelectionBoxRect();
      updateRunDragHover();
    }
  }

  runAutoScrollRAF = requestAnimationFrame(runAutoScrollTick);
}

runProfileGrid.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (e.target.classList.contains('run-profile-chip-check')) return;

  if (!e.shiftKey) {
    runSelectedIds.clear();
    runProfileGrid.querySelectorAll('.run-profile-chip').forEach((c) => applyRunChipVisual(c, c.dataset.id));
  }

  const rect = runProfileGrid.getBoundingClientRect();
  isRunDragging = true;
  runDragStartX = e.clientX;
  runDragStartY = (e.clientY - rect.top) + runProfileGrid.scrollTop;
  lastRunClientX = e.clientX;
  lastRunClientY = e.clientY;
  runDragStartedOnChip = e.target.closest('.run-profile-chip');

  runSelectionBox.hidden = false;
  updateRunSelectionBoxRect();
  e.preventDefault();

  if (!runAutoScrollRAF) runAutoScrollRAF = requestAnimationFrame(runAutoScrollTick);
});

document.addEventListener('mousemove', (e) => {
  if (!isRunDragging) return;
  lastRunClientX = e.clientX;
  lastRunClientY = e.clientY;
  updateRunSelectionBoxRect();
  updateRunDragHover();
});

document.addEventListener('mouseup', (e) => {
  if (!isRunDragging) return;
  isRunDragging = false;
  runSelectionBox.hidden = true;

  const rect = runProfileGrid.getBoundingClientRect();
  const endContentY = (e.clientY - rect.top) + runProfileGrid.scrollTop;
  const dragDistance = Math.hypot(e.clientX - runDragStartX, endContentY - runDragStartY);
  if (dragDistance < 4) {
    if (runDragStartedOnChip) toggleRunSelection(runDragStartedOnChip.dataset.id);
  } else {
    runProfileGrid.querySelectorAll('.run-profile-chip.is-drag-hover').forEach((chip) => {
      runSelectedIds.add(chip.dataset.id);
      chip.classList.remove('is-drag-hover');
      applyRunChipVisual(chip, chip.dataset.id);
    });
    updateRunProfileCount();
  }
  runDragStartedOnChip = null;
});

// -------------------------------------------------------------------
// Import from Excel -- lives on the page itself (left sidebar), matched
// against your WHOLE profile list, independent of the Run popup and
// whatever subset happens to be selected in there at any moment. Fills
// "Input data" by matching a column in the uploaded .xlsx against each
// profile's NAME, rather than by row order -- order-matching (the
// "Input data" textarea's plain manual-typing behavior) silently breaks
// the moment the profile selection changes or the same master
// spreadsheet gets reused against a different subset; name-matching
// survives both. Parsing happens entirely in the browser via SheetJS
// (same CDN-script pattern as CodeMirror above), so this never touches
// the server -- no upload endpoint, no request body size limit to worry
// about for a big spreadsheet.
//
// Rows are keyed by SPREADSHEET COLUMN LETTER (row.A, row.B, row['C']...)
// rather than by header text -- header: 'A' below makes SheetJS parse
// every column positionally instead of using row 1 as field names. Row 1
// is still read separately (headerLabels) purely to show a human label
// next to each letter in the match-column dropdown/preview -- it's
// display-only and never affects what key a script actually reads.
//
// excelMatchByProfileId caches profile.id -> matched row (or null) for
// the CURRENT file+column+profile-list combo, recomputed by
// recomputeExcelMatches() whenever any of those three changes. Two
// consumers read it:
//   - renderExcelSidebarPreview() -- the always-visible full-list
//     preview here in the sidebar (every profile, matched or not)
//   - applyExcelMatchToRunInput() -- called from the Run modal's
//     updateRunProfileCount() whenever its OWN selection changes, which
//     writes just the SELECTED profiles' matched rows into
//     runInputTextarea, in selection order
// Both read from the same cache rather than re-deriving the match
// independently, so the sidebar preview and what actually lands in
// "Input data" can never disagree with each other.
//
// The result written into runInputTextarea is one JSON line per
// profile -- the exact same "Input data" textarea manual typing already
// fills, so nothing downstream (the Run submit handler, POST
// /api/queue/start, the script's `input` argument) needs to know or
// care that this came from Excel instead of a paste. A script reads its
// row back out with `JSON.parse(input)` -- see the "Read imported Excel
// row (input)" snippet in the sidebar's template chips.
// -------------------------------------------------------------------
const importExcelBtn = document.getElementById('importExcelBtn');
const excelFileInput = document.getElementById('excelFileInput');
const excelFileName = document.getElementById('excelFileName');
const clearExcelBtn = document.getElementById('clearExcelBtn');
const excelMatchSection = document.getElementById('excelMatchSection');
const excelMatchColumnSelect = document.getElementById('excelMatchColumnSelect');
const excelMatchSummary = document.getElementById('excelMatchSummary');
const excelMatchPreview = document.getElementById('excelMatchPreview');

let excelImportState = null; // { columnLetters: string[], headerLabels: object, rows: object[] } | null
let excelMatchByProfileId = new Map(); // profile.id -> matched row object | null, see header comment

importExcelBtn.addEventListener('click', () => excelFileInput.click());

clearExcelBtn.addEventListener('click', () => {
  excelImportState = null;
  excelMatchByProfileId = new Map();
  excelFileName.hidden = true;
  clearExcelBtn.hidden = true;
  excelMatchSection.hidden = true;
  // Doesn't touch runInputTextarea's current contents -- clearing the
  // import just stops it from OVERWRITING that textarea on the next
  // selection change; whatever's typed in there stays as-is.
});

// Parses an .xlsx file in a Web Worker (see public/xlsx-worker.js) --
// XLSX.read()/sheet_to_json() are synchronous and can take a real while
// on a big spreadsheet; running that on the main thread used to freeze
// the entire page for however long it took, which is what triggers
// Chrome's "Page Unresponsive -- Wait or Kill this page?" dialog. A
// worker has its own thread, so the page stays fully interactive no
// matter how long parsing takes.
function parseExcelInWorker(buffer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker('/xlsx-worker.js');
    worker.onmessage = (e) => {
      worker.terminate();
      if (e.data.ok) resolve(e.data);
      else reject(new Error(e.data.error));
    };
    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(err.message || 'Worker lỗi không rõ nguyên nhân'));
    };
    worker.postMessage({ buffer }, [buffer]); // transfer (not copy) the bytes -- faster handoff, and editor.js doesn't need `buffer` again after this
  });
}

excelFileInput.addEventListener('change', async () => {
  const file = excelFileInput.files[0];
  if (!file) return;

  // Visible "still working" state -- the worker itself keeps the page
  // responsive, but a big file can still take several real seconds to
  // parse, and with no feedback at all that reads as "did this just do
  // nothing?" rather than "still going".
  importExcelBtn.disabled = true;
  const originalBtnText = importExcelBtn.textContent;
  importExcelBtn.textContent = 'Importing\u2026';

  try {
    const buffer = await file.arrayBuffer();
    const { columnLetters, headerLabels, rows } = await parseExcelInWorker(buffer);

    if (rows.length === 0) {
      showToast('No data rows found below the header row in that sheet', true);
      return;
    }

    excelImportState = { columnLetters, headerLabels, rows };

    // Fire-and-forget: drops the FULL sheet on disk (server-side) so a
    // running script can look up a row other than its own -- see
    // POST /api/excel-snapshot in server.js. Not awaited because nothing
    // in THIS import flow needs it to have finished; only a script run
    // later does, and by then this will long since have landed. A
    // failure here doesn't affect matching/running at all (that's all
    // client-side), so it only surfaces as a toast, not a blocked import.
    //
    // .then() check response.ok -- fetch() KHÔNG tự throw khi server
    // trả lỗi (VD 413 Payload Too Large, 500...), chỉ throw khi mất
    // mạng hoàn toàn -- nếu chỉ dùng .catch() như trước, lỗi phía
    // server bị NUỐT LẶNG LẼ, không toast nào hiện ra -- xác nhận xảy
    // ra thật (nguyên nhân: giới hạn 100KB mặc định của express.json(),
    // đã tăng lên 50mb trong server.js).
    fetch('/api/excel-snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows }),
    }).then((res) => {
      if (!res.ok) {
        showToast(`Imported OK, but server rejected the snapshot save (HTTP ${res.status}) -- cross-row lookups in scripts will fail until this succeeds`, true);
      }
    }).catch(() => {
      showToast('Imported OK, but could not save the full-sheet snapshot to disk (cross-row lookups in scripts will fail until you re-import)', true);
    });

    excelFileName.hidden = false;
    excelFileName.textContent = `"${file.name}": ${rows.length} row(s), columns: ` +
      columnLetters.map((l) => headerLabels[l] ? `${l} (${headerLabels[l]})` : l).join(', ');
    clearExcelBtn.hidden = false;

    excelMatchColumnSelect.innerHTML = columnLetters
      .map((l) => `<option value="${l}">${l}${headerLabels[l] ? ` \u2014 ${headerLabels[l]}` : ''}</option>`)
      .join('');
    // Best-effort default: a column whose header text looks like it means
    // "profile name" -- falls back to column A if nothing matches.
    const guess = columnLetters.find((l) => /^profile ?name$|^name$|^profile$/i.test(headerLabels[l] || ''));
    excelMatchColumnSelect.value = guess || columnLetters[0];

    excelMatchSection.hidden = false;
    renderExcelSidebarPreview();
    if (!runModalOverlay.hidden) applyExcelMatchToRunInput(); // Run popup already open with a selection -- fill it immediately too
    showToast(`Imported ${rows.length} row(s) from "${file.name}"`);
  } catch (err) {
    showToast(`Couldn't read that file: ${err.message}`, true);
  } finally {
    importExcelBtn.disabled = false;
    importExcelBtn.textContent = originalBtnText;
    excelFileInput.value = ''; // allow re-picking the same file after editing/re-saving it
  }
});

excelMatchColumnSelect.addEventListener('change', () => {
  renderExcelSidebarPreview();
  if (!runModalOverlay.hidden) applyExcelMatchToRunInput();
});

// Recomputes excelMatchByProfileId (profile.id -> matched row | null) for
// the CURRENT file + match column + profile list. Cheap enough (a Map
// build over however many profiles/rows exist) to just call before
// every use rather than trying to track every possible staleness cause
// separately.
function recomputeExcelMatches() {
  excelMatchByProfileId = new Map();
  if (!excelImportState) return;
  const { rows } = excelImportState;
  const matchColumn = excelMatchColumnSelect.value;

  const byName = new Map(); // normalized (trimmed, lowercased) Excel value -> row
  // rows[i] is the (i+1)-th DATA row in the sheet, and row 1 was the
  // header (see xlsx-worker.js's allRows.slice(1)) -- so rows[i] is
  // literal spreadsheet row (i + 2). Stamping that onto the row here,
  // once, at match time, is the only place this number is ever known:
  // after this it's just another key inside a plain {A, B, C...} object,
  // same as any real column -- see the "server: chỉnh" plan in the
  // scripts/main.js opening snippet for why a script needs this to look
  // up a DIFFERENT row (e.g. current row + 2).
  rows.forEach((originalRow, i) => {
    const row = { ...originalRow, __excelRow: i + 2 };
    const key = String(row[matchColumn] ?? '').trim().toLowerCase();
    if (key && !byName.has(key)) byName.set(key, row); // first row wins on a duplicate name
  });

  for (const p of lastProfiles) {
    excelMatchByProfileId.set(p.id, byName.get(p.name.trim().toLowerCase()) || null);
  }
}

// The always-visible sidebar preview -- EVERY profile in the whole
// list, matched or not, independent of anything selected in the Run
// popup (which might not even be open right now).
function renderExcelSidebarPreview() {
  if (!excelImportState) return;
  recomputeExcelMatches();

  if (lastProfiles.length === 0) {
    excelMatchPreview.innerHTML = '';
    excelMatchSummary.textContent = 'No profiles yet.';
    excelMatchSummary.classList.remove('is-warning');
    return;
  }

  let matchedCount = 0;
  const previewRows = lastProfiles.map((p) => {
    const row = excelMatchByProfileId.get(p.id);
    if (row) {
      matchedCount++;
      return `<div class="proxy-target-row is-matched"><span>${p.name}</span><span class="proxy-target-match">matched</span></div>`;
    }
    return `<div class="proxy-target-row is-unmatched"><span>${p.name}</span><span class="proxy-target-match">no row</span></div>`;
  });
  excelMatchPreview.innerHTML = previewRows.join('');

  const { headerLabels } = excelImportState;
  const matchColumn = excelMatchColumnSelect.value;
  const matchColumnLabel = matchColumn + (headerLabels[matchColumn] ? ` (${headerLabels[matchColumn]})` : '');
  const unmatchedCount = lastProfiles.length - matchedCount;
  excelMatchSummary.textContent = unmatchedCount
    ? `${matchedCount}/${lastProfiles.length} matched \u2014 ${unmatchedCount} have no row for column ${matchColumnLabel}`
    : `All ${matchedCount} profile(s) matched.`;
  excelMatchSummary.classList.toggle('is-warning', unmatchedCount > 0);
}

// Called from the Run modal's updateRunProfileCount() whenever ITS
// selection changes -- writes the matched rows for just the currently
// SELECTED profiles into "Input data", in selection order, so line i
// lines up with inputs[i] server-side exactly like manual typing would.
function applyExcelMatchToRunInput() {
  if (!excelImportState) return;
  recomputeExcelMatches(); // cheap; keeps this correct even if profiles/column changed since the sidebar last rendered
  const lines = [...runSelectedIds].map((id) => {
    const row = excelMatchByProfileId.get(id);
    return row ? JSON.stringify(row) : '';
  });
  runInputTextarea.value = lines.join('\n');
}

document.getElementById('confirmRunBtn').addEventListener('click', async () => {
  const ids = [...runSelectedIds];
  if (ids.length === 0) return showToast('Select at least one profile', true);

  if (activeTab === 'main') tabContents.main = editor.getValue();
  else tabContents[activeTab] = editor.getValue();

  // Unsaved file-backed tabs would mean require('./x') inside the
  // running script picks up whatever's STILL on disk from before your
  // latest edits, not what the editor is showing -- refuse to run
  // rather than silently use stale code (or silently save behind your
  // back). "main" is exempt: it isn't a file, its in-memory content is
  // always what actually runs.
  if (dirtyTabs.size > 0) {
    return showToast(`Save before running: ${[...dirtyTabs].join(', ')}`, true);
  }

  const scriptCode = tabContents[runSelectedScript] || '';
  const maxConcurrent = parseInt(document.getElementById('runMaxConcurrent').value, 10) || 1;
  // 0 (hoặc để trống, hoặc gõ số không hợp lệ) = KHÔNG giới hạn theo
  // proxy -- chỉ còn ràng buộc maxConcurrent tổng như trước giờ.
  const maxPerProxy = parseInt(document.getElementById('runMaxPerProxy').value, 10) || 0;
  const retryCount = parseInt(document.getElementById('runRetryCount').value, 10) || 0;
  // Seconds in the UI, ms over the wire -- matches how server.js's
  // queue.scriptTimeoutMs is documented/used. 0/blank/invalid = disabled,
  // same "no limit" convention as maxPerProxy above.
  const scriptTimeoutSeconds = parseInt(document.getElementById('runScriptTimeout').value, 10) || 0;
  const scriptTimeoutMs = scriptTimeoutSeconds > 0 ? scriptTimeoutSeconds * 1000 : 0;
  const inputLines = document.getElementById('runInputTextarea').value.split('\n');
  // A pasted list often has a trailing blank line -- drop extras rather
  // than force an exact-length paste for one stray newline.
  while (inputLines.length > ids.length && inputLines[inputLines.length - 1].trim() === '') inputLines.pop();
  const inputsById = {};
  ids.forEach((id, i) => { inputsById[id] = inputLines[i] || ''; });

  try {
    await startQueueRun(ids, { script: scriptCode, maxConcurrent, maxPerProxy, retryCount, scriptTimeoutMs, inputsById });
    showToast(`Started on ${ids.length} profile(s)`);
    runModalForceConfig = false; // a fresh run always shows its own log view, even if "Configure a new run" was clicked earlier
    // Brand-new run -- any red/picked state from a previous one no
    // longer applies to what's about to show up in the log view.
    retrySelectedIds.clear();
    logsFilterFailedOnly = false;
    logsFilterFailedBtn.classList.remove('is-active');
  } catch (err) {
    showToast(err.message, true);
  } finally {
    refreshRunModalStatus();
  }
});

stopRunBtn.addEventListener('click', async () => {
  await fetch('/api/queue/stop', { method: 'POST' });
  showToast('Stopped (already-running profiles are left alone)');
  refreshRunModalStatus();
});

async function refreshRunModalStatus() {
  const res = await fetch('/api/queue');
  const data = await res.json();

  queueIsRunning = data.running;
  closeRunModalBtn.classList.toggle('is-locked', queueIsRunning);

  const hasActivity = data.running || data.pending.length > 0 || data.active.length > 0;
  const hasLog = data.log.length > 0;
  runModalStatus.hidden = !hasActivity;
  stopRunBtn.hidden = !data.running;

  if (hasActivity) {
    runModalStatus.textContent =
      `${data.active.length}/${data.maxConcurrent} running \u00b7 ${data.pending.length} pending` +
      (data.hasScript ? ' \u00b7 auto-run + auto-close on' : '') +
      (data.retryCount ? ` \u00b7 retry \u00d7${data.retryCount}` : '') +
      (data.scriptTimeoutMs ? ` \u00b7 timeout ${Math.round(data.scriptTimeoutMs / 1000)}s` : '');
  }

  // Two views, one popup: show the log view once there's a queue
  // running or a finished one to look back at, otherwise the setup
  // quadrants. "Configure a new run" forces setup back up manually
  // without losing the log underneath (starting a new run clears the
  // override -- see confirmRunBtn above).
  const showLogView = hasLog && !runModalForceConfig;
  runModalConfigView.hidden = showLogView;
  runModalLogView.hidden = !showLogView;
  backToConfigBtn.hidden = !(hasLog && !data.running);

  if (showLogView) renderLogsView(data);
}

// -------------------------------------------------------------------
// Log view -- the Run modal's second view (see openRunModal/
// refreshRunModalStatus above), grouping the queue's log (server.js's
// queueLog(): every entry carries a profileId/profileName, not just a
// flat text feed) into a sidebar (every profile with any entries this
// run, finished ones included) and a detail pane (that one profile's
// entries only). A special "Queue" row up top covers the run-level
// messages (started/stopped) that aren't about any single profile, so
// nothing from the log is ever hidden by this grouping. Used to be its
// own separate modal/button ("Running log") -- merged into the Run
// modal so watching a queue never means leaving this popup.
// -------------------------------------------------------------------
const logsModalSidebar = document.getElementById('logsModalSidebar');
const logsModalDetailHead = document.getElementById('logsModalDetailHead');
const logsModalLog = document.getElementById('logsModalLog');
const logsFilterFailedBtn = document.getElementById('logsFilterFailedBtn');
const logsRetryBtn = document.getElementById('logsRetryBtn');
const logsSelectionBox = document.getElementById('logsSelectionBox');

const QUEUE_ROW_KEY = '__queue__'; // not a real profile id -- picks out the profileId===null entries
let logsModalSelectedKey = null; // null until the first render picks a default
let lastRenderedLogSignature = ''; // skip the full sidebar/detail rebuild below when nothing's actually changed since last poll
let logsFilterFailedOnly = false; // "Chỉ hiện lỗi" toggle -- hides every success row when on
const retrySelectedIds = new Set(); // profile ids picked (via drag) to feed the Retry button
// Remembers whatever the LAST successful /api/queue/start actually used
// (initial Run or a previous Retry), so Retry can replay the same
// script/settings for just the profiles picked now -- /api/queue/start
// always takes a full config, there's no "just these ids, same as
// before" shortcut server-side.
let lastRunConfig = null; // { script, maxConcurrent, maxPerProxy, retryCount, inputsById } | null

// Status now comes straight from the server's resultsById (see
// server.js) instead of being inferred client-side from log text --
// this comment marks where that inference function used to live.

function renderLogsView(data) {
  const resultsById = data.resultsById || {};

  // A queue that's mostly idle between actions still gets polled every
  // 4s -- without this, that meant fully tearing down and rebuilding
  // the sidebar (one DOM row per profile) AND re-joining this profile's
  // entire message list into one big string, on EVERY poll, forever,
  // for as long as the modal stayed open. Skip it entirely when nothing
  // that could change a row (a profile's status, or its message count)
  // has actually moved since the last render.
  const signature = data.log.length + '|' + data.active.join(',') + '|' +
    Object.entries(resultsById).map(([id, r]) => `${id}:${r.status}`).join(',');
  if (signature === lastRenderedLogSignature) return;
  lastRenderedLogSignature = signature;

  if (data.log.length === 0 && Object.keys(resultsById).length === 0) {
    logsModalSidebar.innerHTML = '<p class="logs-modal-empty">Nothing has run yet \u2014 start a queue below and its log will show up here.</p>';
    logsModalDetailHead.textContent = '\u2014';
    logsModalLog.textContent = '';
    retrySelectedIds.clear();
    applyPickedVisuals();
    return;
  }

  // Rows and their color now come straight from resultsById -- server.js
  // seeds EVERY selected profile as 'pending' the moment a run starts and
  // flips each one to running/success/failed as it actually happens (see
  // its own comment on resultsById). That's the authoritative, complete
  // picture of this run's profiles; queue.log below is only used to fill
  // in each row's detail lines underneath, same as before -- it no
  // longer decides which rows exist or what color they are. This is
  // what stops a big/chatty run's early profiles from disappearing once
  // queue.log's own cap gets hit: their ROW survives even if some of
  // their detail LINES eventually get trimmed.
  const byKey = new Map();
  byKey.set(QUEUE_ROW_KEY, { name: 'Queue', entries: [], status: null });
  for (const [id, r] of Object.entries(resultsById)) {
    byKey.set(id, { name: r.name || id, entries: [], status: r.status });
  }
  for (const entry of data.log) {
    const key = entry.profileId || QUEUE_ROW_KEY;
    // Falls back to creating a row here only for a profileId that's
    // somehow NOT in resultsById (e.g. a stray log line from before this
    // feature existed, or a recreate-flow message about an id outside
    // the current run) -- shouldn't happen for a normal run, but never
    // silently drop a log line rather than risk it.
    if (!byKey.has(key)) byKey.set(key, { name: entry.profileName || entry.profileId, entries: [], status: 'unknown' });
    if (entry.profileName && byKey.get(key).name !== entry.profileName) byKey.get(key).name = entry.profileName;
    byKey.get(key).entries.push(entry);
  }

  // Drop any retry pick that's no longer a failed profile in this
  // render (queue moved on, or it's not in this log at all anymore) --
  // otherwise the Retry button could quietly include stale ids.
  for (const id of [...retrySelectedIds]) {
    const group = byKey.get(id);
    if (!group || group.status !== 'failed') retrySelectedIds.delete(id);
  }

  // Default selection: the first real profile with activity, so this
  // view lands you somewhere useful immediately instead of on the
  // less-interesting "Queue" row every time.
  if (logsModalSelectedKey === null || !byKey.has(logsModalSelectedKey)) {
    const firstProfileKey = [...byKey.keys()].find((k) => k !== QUEUE_ROW_KEY);
    logsModalSelectedKey = firstProfileKey || QUEUE_ROW_KEY;
  }

  logsModalSidebar.innerHTML = '';
  for (const [key, group] of byKey) {
    if (key === QUEUE_ROW_KEY && group.entries.length === 0) continue; // no run-level messages yet -- skip the row instead of showing it empty
    const row = document.createElement('button');
    row.type = 'button';
    row.dataset.key = key;
    if (group.status) row.dataset.status = group.status;
    row.className = 'logs-modal-row' +
      (key === logsModalSelectedKey ? ' is-selected' : '') +
      (group.status ? ` is-status-${group.status}` : '');

    const dot = document.createElement('span');
    let dotClass = 'logs-modal-dot';
    if (group.status === 'running') dotClass += ' is-running';
    else if (group.status === 'success') dotClass += ' is-success';
    else if (group.status === 'failed') dotClass += ' is-failed';
    dot.className = dotClass;
    row.appendChild(dot);

    // A real checkbox, independent of the drag-select below -- ticking
    // it is the one guaranteed way to add/remove THIS profile from the
    // retry pick one at a time (e.g. drag-picked 1, 2, 3, then just
    // untick 3), regardless of whatever a drag over the exact right
    // pixels does. Only ever interactive on a failed row -- nothing
    // else is retry-able, so it stays there but disabled/invisible for
    // everything else (keeps every row's text lined up at the same x).
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'logs-modal-row-check';
    if (group.status === 'failed') {
      check.checked = retrySelectedIds.has(key);
      check.addEventListener('click', (e) => e.stopPropagation()); // don't ALSO switch the detail pane on every tick
      check.addEventListener('change', () => {
        if (check.checked) retrySelectedIds.add(key);
        else retrySelectedIds.delete(key);
        applyPickedVisuals();
      });
    } else {
      check.disabled = true;
      check.tabIndex = -1;
      check.style.visibility = 'hidden';
    }
    row.appendChild(check);

    const name = document.createElement('span');
    name.className = 'logs-modal-row-name';
    name.textContent = group.name;
    row.appendChild(name);

    const count = document.createElement('span');
    count.className = 'logs-modal-row-count';
    count.textContent = String(group.entries.length);
    row.appendChild(count);

    // Plain click (see the drag-select block below, which only ever
    // acts once the mouse has actually MOVED) still just switches the
    // detail pane, same as always -- picking rows for Retry is a drag-
    // only gesture so it never fights with browsing each profile's log.
    row.addEventListener('click', () => {
      logsModalSelectedKey = key;
      logsModalSidebar.querySelectorAll('.logs-modal-row').forEach((r) => {
        r.classList.toggle('is-selected', r.dataset.key === key);
      });
      renderLogsViewDetail(byKey);
    });
    logsModalSidebar.appendChild(row);
  }

  applyLogsFilter();
  applyPickedVisuals();
  renderLogsViewDetail(byKey);
}

// "Chỉ hiện lỗi" -- hides every success row, leaving failed/running/
// pending/Queue rows exactly as they were. Pure DOM class toggling off
// each row's own data-status, so this can run instantly on a button
// click without waiting for the next poll or touching byKey at all.
function applyLogsFilter() {
  logsModalSidebar.querySelectorAll('.logs-modal-row').forEach((row) => {
    row.classList.toggle('is-hidden-by-filter', logsFilterFailedOnly && row.dataset.status === 'success');
  });
}

logsFilterFailedBtn.addEventListener('click', () => {
  logsFilterFailedOnly = !logsFilterFailedOnly;
  logsFilterFailedBtn.classList.toggle('is-active', logsFilterFailedOnly);
  applyLogsFilter();
});

// Reflects retrySelectedIds onto the DOM (highlight + the Retry
// button's visibility/count) -- called after every drag-select and
// after every rebuild in renderLogsView.
function applyPickedVisuals() {
  logsModalSidebar.querySelectorAll('.logs-modal-row').forEach((row) => {
    const picked = retrySelectedIds.has(row.dataset.key);
    row.classList.toggle('is-picked', picked);
    const cb = row.querySelector('.logs-modal-row-check');
    if (cb && !cb.disabled) cb.checked = picked;
  });
  logsRetryBtn.hidden = retrySelectedIds.size === 0;
  if (retrySelectedIds.size > 0) logsRetryBtn.textContent = `Retry (${retrySelectedIds.size})`;
}

// Drag-select (marquee) over the sidebar's red rows only -- same
// algorithm as the Run modal's profile-grid drag-select above (mousedown
// starts tracking, mousemove grows a positioned box and checks
// intersection, mouseup finalizes), copied rather than shared for the
// same reason that one gives for copying the dashboard's: different
// page state, different target elements. The one real difference: a
// plain click (dragged less than 4px) does NOTHING here instead of
// falling back to toggling a selection -- a click on a row already has
// its OWN meaning (switch the detail pane, see the listener above), so
// only an actual drag ever touches retrySelectedIds.
//
// Same content-space-coordinate + auto-scroll treatment as the Run
// modal's profile grid above (see its comment for the full reasoning):
// logsModalSidebar scrolls itself, so the Y anchor is tracked as
// (clientY - rect.top) + sidebar.scrollTop rather than a raw viewport
// value. With a run of, say, 100 profiles and 20 failed, this list can
// easily be taller than the modal -- dragging from row 61 to row 63
// while it auto-scrolls needs row 61 to stay picked even after it
// scrolls out of view, not drop out the moment it's no longer under the
// box on screen.
let isLogsDragging = false;
let logsDragStartX = 0; // viewport-relative (sidebar never scrolls horizontally)
let logsDragStartY = 0; // sidebar CONTENT-relative: (clientY - rect.top) + scrollTop at drag start
let logsDragMoved = false;
let lastLogsClientX = 0;
let lastLogsClientY = 0;
let logsAutoScrollRAF = null;

const LOGS_AUTO_SCROLL_EDGE = 40; // px from the top/bottom edge of the sidebar that starts auto-scrolling
const LOGS_AUTO_SCROLL_MAX_SPEED = 16; // px scrolled per animation frame right at the very edge

function updateLogsSelectionBoxRect() {
  const rect = logsModalSidebar.getBoundingClientRect();
  const startViewportY = (logsDragStartY - logsModalSidebar.scrollTop) + rect.top;
  const left = Math.min(logsDragStartX, lastLogsClientX);
  const top = Math.min(startViewportY, lastLogsClientY);
  logsSelectionBox.style.left = `${left}px`;
  logsSelectionBox.style.top = `${top}px`;
  logsSelectionBox.style.width = `${Math.abs(lastLogsClientX - logsDragStartX)}px`;
  logsSelectionBox.style.height = `${Math.abs(lastLogsClientY - startViewportY)}px`;
}

function logsRectsIntersect(a, b) {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

function updateLogsDragHover() {
  const boxRect = logsSelectionBox.getBoundingClientRect();
  // Only red (failed) rows are ever eligible -- the box can pass over
  // green/running rows without picking them up, matching "kéo gom các
  // nút đỏ" (gather up the red ones) rather than whatever's underneath.
  logsModalSidebar.querySelectorAll('.logs-modal-row[data-status="failed"]').forEach((row) => {
    row.classList.toggle('is-drag-hover', logsRectsIntersect(boxRect, row.getBoundingClientRect()));
  });
}

function logsAutoScrollTick() {
  if (!isLogsDragging) {
    logsAutoScrollRAF = null;
    return;
  }

  const rect = logsModalSidebar.getBoundingClientRect();
  let dy = 0;
  if (lastLogsClientY < rect.top + LOGS_AUTO_SCROLL_EDGE) {
    dy = -LOGS_AUTO_SCROLL_MAX_SPEED * (1 - Math.max(0, lastLogsClientY - rect.top) / LOGS_AUTO_SCROLL_EDGE);
  } else if (lastLogsClientY > rect.bottom - LOGS_AUTO_SCROLL_EDGE) {
    dy = LOGS_AUTO_SCROLL_MAX_SPEED * (1 - Math.max(0, rect.bottom - lastLogsClientY) / LOGS_AUTO_SCROLL_EDGE);
  }

  if (dy !== 0) {
    const before = logsModalSidebar.scrollTop;
    logsModalSidebar.scrollTop += dy;
    if (logsModalSidebar.scrollTop !== before) {
      if (!logsDragMoved) logsDragMoved = true; // auto-scroll itself counts as a drag, even before the 4px threshold
      updateLogsSelectionBoxRect();
      updateLogsDragHover();
    }
  }

  logsAutoScrollRAF = requestAnimationFrame(logsAutoScrollTick);
}

logsModalSidebar.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (e.target.classList.contains('logs-modal-row-check')) return; // let the checkbox handle its own click/change untouched
  const rect = logsModalSidebar.getBoundingClientRect();
  isLogsDragging = true;
  logsDragMoved = false;
  logsDragStartX = e.clientX;
  logsDragStartY = (e.clientY - rect.top) + logsModalSidebar.scrollTop;
  lastLogsClientX = e.clientX;
  lastLogsClientY = e.clientY;
  logsSelectionBox.hidden = false;
  updateLogsSelectionBoxRect();
  e.preventDefault(); // stop the browser selecting row text while dragging across them

  if (!logsAutoScrollRAF) logsAutoScrollRAF = requestAnimationFrame(logsAutoScrollTick);
});

document.addEventListener('mousemove', (e) => {
  if (!isLogsDragging) return;
  lastLogsClientX = e.clientX;
  lastLogsClientY = e.clientY;
  if (!logsDragMoved) {
    // Same 4px-of-actual-movement threshold as before, just measured in
    // content-space Y instead of raw viewport Y (matters once auto-scroll
    // can also move things -- see logsAutoScrollTick, which sets
    // logsDragMoved directly since the mouse itself may not have moved
    // at all while it does).
    const rect = logsModalSidebar.getBoundingClientRect();
    const curContentY = (e.clientY - rect.top) + logsModalSidebar.scrollTop;
    if (Math.hypot(e.clientX - logsDragStartX, curContentY - logsDragStartY) < 4) return;
    logsDragMoved = true;
  }
  updateLogsSelectionBoxRect();
  updateLogsDragHover();
});

document.addEventListener('mouseup', (e) => {
  if (!isLogsDragging) return;
  isLogsDragging = false;
  logsSelectionBox.hidden = true;
  if (logsDragMoved) {
    if (!e.shiftKey) retrySelectedIds.clear(); // plain drag replaces the pick; Shift-drag adds to it
    logsModalSidebar.querySelectorAll('.logs-modal-row.is-drag-hover').forEach((row) => {
      retrySelectedIds.add(row.dataset.key);
      row.classList.remove('is-drag-hover');
    });
    applyPickedVisuals();
  }
  logsDragMoved = false;
});

// Shared by both the initial Run and Retry -- POSTs one queue config to
// the server (which always replaces the whole in-memory queue, log
// included) and, once it actually starts, remembers that config as
// lastRunConfig so a LATER Retry (of whatever's still red after this
// one) can reuse it again.
async function startQueueRun(ids, config) {
  // Refresh from the server immediately before POSTing. queueIsRunning is a
  // polled UI value and can be stale if another action started/stopped the
  // queue between polls. The backend is authoritative, but this avoids a
  // needless request and gives a clearer client-side error.
  const statusRes = await fetch('/api/queue');
  const status = await statusRes.json();
  if (status.running) {
    throw new Error('Queue đang chạy — hãy Stop trước khi chạy lần mới');
  }
  if (Array.isArray(status.active) && status.active.length > 0) {
    throw new Error('Vẫn còn profile của lượt chạy trước đang mở — hãy chờ chúng đóng rồi chạy lại');
  }

  const inputs = ids.map((id) => config.inputsById[id] || '');
  const res = await fetch('/api/queue/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profileIds: ids,
      maxConcurrent: config.maxConcurrent,
      maxPerProxy: config.maxPerProxy,
      script: config.script,
      retryCount: config.retryCount,
      scriptTimeoutMs: config.scriptTimeoutMs,
      inputs,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not start');
  lastRunConfig = config;
  return data;
}

logsRetryBtn.addEventListener('click', async () => {
  const ids = [...retrySelectedIds];
  if (ids.length === 0) return;
  if (queueIsRunning) return showToast('Queue đang chạy \u2014 bấm Stop trước khi retry', true);
  if (!lastRunConfig) return showToast('Không tìm thấy cấu hình lần chạy trước để retry', true);

  try {
    await startQueueRun(ids, lastRunConfig);
    showToast(`Retrying ${ids.length} profile(s)`);
    retrySelectedIds.clear();
    logsFilterFailedOnly = false; // it's a fresh run -- nothing's failed yet
    logsFilterFailedBtn.classList.remove('is-active');
    runModalForceConfig = false; // show the new run's log, not the config quadrants
  } catch (err) {
    showToast(err.message, true);
  } finally {
    refreshRunModalStatus();
  }
});

function renderLogsViewDetail(byKey) {
  const group = byKey.get(logsModalSelectedKey);
  if (!group) return;
  logsModalDetailHead.textContent = group.name;
  logsModalLog.textContent = group.entries.map((e) => e.message).join('\n');
  logsModalLog.scrollTop = logsModalLog.scrollHeight;
}

// -------------------------------------------------------------------
// Init
// -------------------------------------------------------------------
editorOutput.textContent = 'Chưa chạy script nào \u2014 bấm "Run\u2026" ở trên.';

// main.js is a real file now -- load whatever was saved last time,
// same as any other file would be, instead of always starting blank.
// A fresh project (no scripts/main.js yet) just keeps the '' default;
// the first Save then creates it, per diskNameFor()/saveFile() above.
(async () => {
  try {
    const res = await fetch('/api/scripts/main.js');
    if (res.ok) {
      const data = await res.json();
      tabContents.main = data.code;
      if (activeTab === 'main') editor.setValue(data.code);
    }
  } catch (err) {
    // Offline/server hiccup on first load -- not fatal, just keep the
    // blank default and let the next Save create the file as normal.
  }
})();

renderTabBar();
refreshProfiles();
refreshRunModalStatus();
initChromeVersionBanner();
setInterval(() => {
  refreshProfiles();
  if (!runModalOverlay.hidden) refreshRunModalStatus();
}, 4000);

// ===========================================================================
// Quick-snippet buttons (above the tab bar): press one, its code drops in
// at wherever your cursor currently is in the active file. User-defined
// and persisted server-side (data/snippets.json) via /api/snippets --
// separate from the built-in template chips in the left sidebar, which
// always APPEND to the end of the file instead, and aren't editable.
// ===========================================================================
const snippetBtnList = document.getElementById('snippetBtnList');
const addSnippetBtn = document.getElementById('addSnippetBtn');
const snippetContextMenu = document.getElementById('snippetContextMenu');
const snippetModalOverlay = document.getElementById('snippetModalOverlay');
const snippetModalTitle = document.getElementById('snippetModalTitle');
const snippetNameInput = document.getElementById('snippetNameInput');
const snippetCodeInput = document.getElementById('snippetCodeInput');
const saveSnippetBtn = document.getElementById('saveSnippetBtn');
const deleteSnippetBtn = document.getElementById('deleteSnippetBtn');
const closeSnippetModalBtn = document.getElementById('closeSnippetModalBtn');

let snippets = [];
let editingSnippetId = null; // null while the modal is creating a brand new one

async function loadSnippets() {
  try {
    const res = await fetch('/api/snippets');
    snippets = await res.json();
  } catch (err) {
    snippets = []; // API unreachable -- just show an empty row rather than blocking the whole editor
  }
  renderSnippetButtons();
}

function renderSnippetButtons() {
  snippetBtnList.innerHTML = '';
  for (const snip of snippets) {
    const wrap = document.createElement('div');
    wrap.className = 'snippet-btn';

    const insertBtn = document.createElement('button');
    insertBtn.type = 'button';
    insertBtn.className = 'snippet-btn-insert';
    insertBtn.textContent = snip.name;
    insertBtn.title = `Insert "${snip.name}" at cursor`;
    insertBtn.addEventListener('click', () => insertSnippetAtCursor(snip.code));

    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'snippet-btn-menu';
    menuBtn.innerHTML = '&#8942;'; // vertical ellipsis -- the "corner" edit/delete affordance
    menuBtn.title = 'Edit or delete this button';
    menuBtn.setAttribute('aria-label', `Edit or delete "${snip.name}"`);
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // don't let this bubble into the document click-outside handler below and instantly reclose the menu it just opened
      openSnippetContextMenu(menuBtn, snip.id);
    });

    wrap.append(insertBtn, menuBtn);
    snippetBtnList.appendChild(wrap);
  }
}

// The actual "insert at cursor" -- replaceSelection() at an empty (i.e.
// collapsed to just a blinking cursor, not actually selecting text)
// selection is exactly CodeMirror's own API for "insert at the caret".
// Falls back to appending if CodeMirror itself failed to load (see
// initCodeEditor()'s fallback object in shared.js, which has no
// cursor/selection concept at all since it's just a plain <textarea>).
function insertSnippetAtCursor(code) {
  if (typeof editor.replaceSelection === 'function') {
    editor.replaceSelection(code);
  } else {
    editor.setValue(editor.getValue() + code);
  }
  editor.focus();
}

function openSnippetContextMenu(anchorEl, id) {
  snippetContextMenu.dataset.targetId = id;
  const rect = anchorEl.getBoundingClientRect();
  snippetContextMenu.style.left = `${rect.left}px`;
  snippetContextMenu.style.top = `${rect.bottom + 4}px`;
  snippetContextMenu.hidden = false;
}

document.addEventListener('click', (e) => {
  if (!snippetContextMenu.hidden && !snippetContextMenu.contains(e.target)) {
    snippetContextMenu.hidden = true;
  }
});

document.getElementById('snippetMenuEditBtn').addEventListener('click', () => {
  const id = snippetContextMenu.dataset.targetId;
  snippetContextMenu.hidden = true;
  openSnippetModal(id);
});

document.getElementById('snippetMenuDeleteBtn').addEventListener('click', () => {
  const id = snippetContextMenu.dataset.targetId;
  snippetContextMenu.hidden = true;
  confirmAndDeleteSnippet(id);
});

function openSnippetModal(id) {
  editingSnippetId = id;
  const snip = id ? snippets.find((s) => s.id === id) : null;
  snippetModalTitle.textContent = snip ? 'Edit snippet' : 'New snippet';
  snippetNameInput.value = snip ? snip.name : '';
  snippetCodeInput.value = snip ? snip.code : '';
  deleteSnippetBtn.hidden = !snip;
  snippetModalOverlay.hidden = false;
  snippetNameInput.focus();
}

function closeSnippetModal() {
  snippetModalOverlay.hidden = true;
  editingSnippetId = null;
}

async function confirmAndDeleteSnippet(id) {
  const snip = snippets.find((s) => s.id === id);
  if (!snip || !confirm(`Delete the "${snip.name}" snippet button? This can't be undone.`)) return;
  try {
    await fetch(`/api/snippets/${id}`, { method: 'DELETE' });
    snippets = snippets.filter((s) => s.id !== id);
    renderSnippetButtons();
  } catch (err) {
    showToast("Couldn't delete the snippet", true);
  }
}

addSnippetBtn.addEventListener('click', () => openSnippetModal(null));
closeSnippetModalBtn.addEventListener('click', closeSnippetModal);
snippetModalOverlay.addEventListener('click', (e) => {
  if (e.target === snippetModalOverlay) closeSnippetModal(); // click on the dimmed backdrop, not the panel itself
});

saveSnippetBtn.addEventListener('click', async () => {
  const name = snippetNameInput.value.trim();
  const code = snippetCodeInput.value;
  if (!name) {
    showToast('Give the button a name first', true);
    return;
  }
  try {
    let saved;
    if (editingSnippetId) {
      const res = await fetch(`/api/snippets/${editingSnippetId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, code }),
      });
      saved = await res.json();
      if (!res.ok) throw new Error(saved.error || 'Save failed');
      const idx = snippets.findIndex((s) => s.id === editingSnippetId);
      if (idx !== -1) snippets[idx] = saved;
    } else {
      const res = await fetch('/api/snippets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, code }),
      });
      saved = await res.json();
      if (!res.ok) throw new Error(saved.error || 'Create failed');
      snippets.push(saved);
    }
    renderSnippetButtons();
    closeSnippetModal();
  } catch (err) {
    showToast(err.message, true);
  }
});

deleteSnippetBtn.addEventListener('click', () => {
  if (editingSnippetId) confirmAndDeleteSnippet(editingSnippetId);
  closeSnippetModal();
});

loadSnippets();