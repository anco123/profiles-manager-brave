/**
 * editor.js
 * -----------------------------------------------------------------------
 * Logic for the standalone /editor page. Loaded after shared.js, so
 * initCodeEditor/TEMPLATE_GROUPS/SCRIPT_TEMPLATES/insertSnippet/
 * renderChipGroups are already available here.
 *
 * Mental model: mỗi tab là 1 file THẬT trong scripts/ (tên tab = tên file, kể cả main.js), đọc được qua require('./name')
 * từ file khác. Mở trang không có tab nào -- vùng code hiện danh sách file (fileHome), bấm file nào thì file đó mở ra.
 * Đóng tab chỉ ẩn khỏi thanh tab, file vẫn trên đĩa; đóng tab cuối thì quay về danh sách file. Xoá (nút x trong menu file)
 * mới xoá thật. main.js chỉ còn khác ở chỗ: không xoá / đổi tên được (queue tự chạy mặc định file này).
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

let openTabs = []; // tên file, theo thứ tự trên thanh tab
let tabContents = {};
let activeTab = null; // null = chưa mở file nào -> hiện danh sách file
let loadingTab = false; // true trong lúc switchToTab() nạp file vào editor
const fileHome = document.getElementById('fileHome');
const fileHomeList = document.getElementById('fileHomeList');
const fileHomeSearch = document.getElementById('fileHomeSearch');
const editorCanvas = document.querySelector('.editor-canvas');

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
    const isDirty = dirtyTabs.has(name);
    const tab = document.createElement('div');
    tab.className = 'editor-tab' + (name === activeTab ? ' is-active' : '');
    tab.innerHTML =
      `<span>${name}${isDirty ? ' <span class="tab-dirty-dot" title="Unsaved changes">\u25cf</span>' : ''}</span>` +
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
  // chưa mở file nào -> thay vùng code bằng danh sách file
  const home = !activeTab;
  editorCanvas.hidden = home;
  fileHome.hidden = !home;
  if (home) renderFileHome();
}

// -------------------------------------------------------------------
// Danh sách file (hiện khi chưa mở tab nào): bấm file nào mở file đó
// -------------------------------------------------------------------
let fileHomeFiles = null;
async function renderFileHome(reload = false) {
  if (!fileHomeFiles || reload) {
    try { fileHomeFiles = await (await fetch('/api/scripts')).json(); } catch { fileHomeFiles = []; }
  }
  const term = fileHomeSearch.value.trim().toLowerCase();
  const list = fileHomeFiles.filter((f) => !term || f.toLowerCase().includes(term));
  fileHomeList.innerHTML = '';
  for (const name of list) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'file-home-item' + (name === 'main.js' ? ' is-main' : '');
    btn.textContent = name;
    btn.addEventListener('click', () => openFileTab(name));
    fileHomeList.appendChild(btn);
  }
  if (!list.length) fileHomeList.innerHTML = `<p class="muted file-home-empty">${fileHomeFiles.length ? 'Không có file nào khớp' : 'Chưa có file nào -- bấm "+ File mới"'}</p>`;
}
fileHomeSearch.addEventListener('input', () => renderFileHome());
fileHomeSearch.addEventListener('keydown', (e) => { // Enter = mở file đầu tiên trong danh sách đang lọc
  const first = fileHomeList.querySelector('.file-home-item');
  if (e.key === 'Enter' && first) first.click();
});
document.getElementById('fileHomeNewBtn').addEventListener('click', () => createFileBtn.click());

// Chưa mở file nào thì không có chỗ để chèn code -- báo thay vì chèn vào editor đang ẩn
function needOpenFile() {
  if (activeTab) return false;
  showToast('Mở 1 file trước đã', true);
  return true;
}

async function switchToTab(name) {
  if (activeTab) tabContents[activeTab] = editor.getValue(); // remember where we're leaving from -- stays in memory, NOT written to disk

  activeTab = name;

  // Always pull the CURRENT on-disk content rather than trusting
  // whatever's cached in tabContents -- editing can now happen outside
  // the browser too (see the "Open in VS Code" button), so a stale
  // in-memory copy from whenever this tab was first opened would
  // silently keep showing old code and hide anything changed
  // externally. Skipped only when this tab has unsaved edits sitting in
  // it (the ~800ms autosave in editor.on('change') below almost always
  // clears that within a second anyway) -- never clobber those with
  // whatever's on disk.
  if (!dirtyTabs.has(name)) {
    try {
      const res = await fetch(`/api/scripts/${encodeURIComponent(name)}`);
      if (res.ok) {
        tabContents[name] = (await res.json()).code;
      } else if (res.status === 404) {
        tabContents[name] = ''; // genuinely doesn't exist on disk (e.g. a brand new, never-saved file) -- not stale, just empty
      }
    } catch (err) {
      // Offline/server hiccup -- fall back to whatever was already
      // cached (possibly still just '') rather than the tab erroring out.
    }
  }

  loadingTab = true; // nạp nội dung file vào editor không phải là "sửa" -- không đánh dấu chưa lưu, không tự lưu lại y nguyên
  editor.setValue(tabContents[name] ?? '');
  loadingTab = false;
  renderTabBar(); // hiện lại vùng code (nếu đang ở danh sách file) TRƯỚC refresh, không CodeMirror đo kích thước sai
  editor.refresh();
}

// content: nội dung đã có sẵn (VD file vừa tạo); bỏ trống thì switchToTab tự đọc từ đĩa
async function openFileTab(name, content) {
  if (!openTabs.includes(name)) openTabs.push(name);
  if (content !== undefined) tabContents[name] = content;
  await switchToTab(name);
}

// Bỏ 1 tab khỏi thanh tab; đang xem tab đó thì chuyển sang tab bên cạnh, hết tab thì về danh sách file
async function dropTab(name) {
  const idx = openTabs.indexOf(name);
  openTabs = openTabs.filter((t) => t !== name);
  delete tabContents[name];
  dirtyTabs.delete(name);
  if (activeTab !== name) return renderTabBar();
  activeTab = null;
  const next = openTabs[Math.min(idx, openTabs.length - 1)];
  if (next) await switchToTab(next);
  else { editor.setValue(''); renderFileHome(true); renderTabBar(); }
}

async function closeTab(name) {
  if (activeTab === name) tabContents[name] = editor.getValue();
  if (dirtyTabs.has(name) && !confirm(`"${name}" has unsaved changes. Close without saving them?`)) return;
  await dropTab(name);
  refreshFileMenu();
}

// Writes to disk. Returns true/false so callers can tell whether it's
// safe to clear a dirty flag -- a failed save must NOT look saved.
async function saveFile(name, code) {
  const diskName = name;
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
  if (!activeTab) return;
  const code = editor.getValue();
  tabContents[activeTab] = code;
  const ok = await saveFile(activeTab, code);
  if (ok) {
    dirtyTabs.delete(activeTab);
    renderTabBar();
    showToast(`Saved ${activeTab}`);
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
  if (!activeTab || loadingTab) return; // đang ở danh sách file (editor ẩn) / đang nạp file -- không phải người dùng sửa
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
  const exist = await fetch('/api/scripts').then((r) => r.json()).catch(() => []);
  if (exist.includes(name)) return showToast(`${name} đã có -- đặt tên khác (không ghi đè file cũ)`, true);
  const code = newFileTemplate(name);
  await saveFile(name, code);
  fileHomeFiles = null; // danh sách file có thêm file mới
  await openFileTab(name, code);
  if (typeof editor.setCursor === 'function') { editor.setCursor({ line: 1, ch: 2 }); editor.focus(); } // con trỏ ở sẵn trong thân hàm
  fileMenu.hidden = true;
  showToast(`Đã tạo ${name} -- code record sẽ vào trong hàm ${fileFnName(name)}()`);
});

// File mới = 1 hàm mang tên file (cùng tham số như script chạy: page, context, log, require, input) + module.exports + dòng require
// (để sẵn dạng chú thích) để tự dán vào main.js. Code record chèn vào file này luôn nằm trong { } của hàm đó (xem recIntoFileFn).
const fileFnName = (name) => { const n = name.replace(/\.js$/, '').replace(/[^\w$]/g, '_'); return /^\d/.test(n) ? '_' + n : n; };
function newFileTemplate(name) {
  const fn = fileFnName(name), mod = './' + name.replace(/\.js$/, '');
  return `async function ${fn}(page, context, log, require, input) {\n  \n}\n\nmodule.exports = { ${fn} };\n// const { ${fn} } = require('${mod}'); // gửi vào main.js\n// await ${fn}(page, context, log, require, input); // gọi trong main.js\n`;
}
// File có hàm mang tên file (tạo bằng khung trên): con trỏ đang ở ngoài thân hàm -> đưa vào cuối thân hàm trước khi chèn code record
function recIntoFileFn() {
  if (!activeTab || typeof editor.indexFromPos !== 'function' || typeof topFunctions !== 'function') return;
  const src = editor.getValue(), f = topFunctions(src).find((x) => x.name === fileFnName(activeTab));
  if (!f) return;
  const code = fnSource(src, f.start), open = src.indexOf('{', src.indexOf(')', f.start)) + 1, close = f.start + code.lastIndexOf('}');
  const at = editor.indexFromPos(editor.getCursor());
  if (open > 0 && at >= open && at <= close) return; // đang ở trong thân hàm rồi
  const lineEnd = editor.posFromIndex(close), prev = lineEnd.line - 1;
  if (prev >= 0 && editor.indexFromPos({ line: prev, ch: 0 }) >= open && !editor.getLine(prev).trim()) { if (!editor.getLine(prev)) editor.replaceRange('  ', { line: prev, ch: 0 }); editor.setCursor({ line: prev, ch: editor.getLine(prev).length }); return; } // dòng trống ngay trên } -> chèn ở đó
  editor.replaceRange('\n  ', { line: prev, ch: editor.getLine(prev).length }); // chưa có dòng trống -> thêm 1 dòng ở cuối thân hàm (ngay trên })
  editor.setCursor({ line: prev + 1, ch: 2 });
}

async function refreshFileMenu() {
  const res = await fetch('/api/scripts');
  const files = await res.json();
  fileHomeFiles = files;

  fileMenuList.innerHTML = '';
  if (files.length === 0) {
    fileMenuList.innerHTML = '<p class="muted" style="padding:6px 8px;margin:0;font-size:0.78rem;">No other files yet</p>';
    return;
  }
  for (const name of files) {
    const isOpen = openTabs.includes(name);
    const row = document.createElement('div');
    row.className = 'file-menu-row';
    const isMain = name === 'main.js'; // file chạy mặc định của queue -- server không cho xoá, nên cũng không đổi tên (đổi tên = tạo mới + xoá cũ)
    row.innerHTML =
      `<button type="button" class="file-menu-item">${name}${isOpen ? ' <span class="muted" style="font-size:0.7rem;">(open)</span>' : ''}</button>` +
      (isMain ? '' : `<button type="button" class="file-menu-rename" title="Rename">&#9998;</button>` +
      `<button type="button" class="file-menu-delete" title="Delete permanently">&times;</button>`);

    row.querySelector('.file-menu-item').addEventListener('click', async () => {
      await openFileTab(name);
      fileMenu.hidden = true;
    });

    if (isMain) { fileMenuList.appendChild(row); continue; }
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

      if (openTabs.includes(name)) await dropTab(name); // it's gone from disk -- bỏ tab luôn, không lưu (lưu = tạo lại file vừa xoá)
      showToast(`Deleted ${name}`);
      refreshFileMenu();
    });

    fileMenuList.appendChild(row);
  }
}

// Scans every file in scripts/ for
// require('./oldBase') or require('./oldBase.js') (either quote style)
// and rewrites it to point at newBase instead. Returns how many places
// were changed. Uses a fresh RegExp per call site rather than reusing
// one -- a /g-flagged regex's .test()/.exec() advance their own
// lastIndex, which silently breaks repeated use of the same instance.
async function updateRequireReferences(oldBase, newBase) {
  const escapedOld = oldBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = () => new RegExp(`(require\\(['"]\\./)${escapedOld}(?:\\.js)?(['"]\\))`, 'g');

  let updatedCount = 0;

  const allFiles = await (await fetch('/api/scripts')).json();
  for (const fileName of allFiles) {
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
const confirmRunBtn = document.getElementById('confirmRunBtn');

const runSelectedIds = new Set();
let runSelectedScript = 'main.js';
let queueIsRunning = false; // kept in sync by refreshRunModalStatus -- guards closing the modal
let runModalForceConfig = false; // true after "Configure a new run" -- overrides the log view even if a finished run's log still exists
let runRangeAnchorId = null; // last profile chip clicked (no shift) -- Shift+click another one selects everything between the two

// Whenever there's a live retry pick (failed rows ticked in the log
// view), the CONFIG view's big Run button doubles as Retry too -- so
// bouncing back to "Configure a new run" with a pick still active (very
// easy to do by accident) lands on a button that does the right thing
// -- retry just those ids, reusing the previous run's script/settings
// -- instead of silently re-running runSelectedIds, which is very
// likely still "literally everyone" left over from the run that just
// finished. lastRunConfig/retrySelectedIds are declared further down
// this file but only ever read here once the user can actually click
// anything, so the forward reference is safe. Called after every
// retry-pick change (applyPickedVisuals) and right after a run/retry
// starts, so it's never stale by the time someone looks at the button.
function syncConfirmRunBtnMode() {
  if (retrySelectedIds.size > 0 && lastRunConfig) {
    confirmRunBtn.textContent = `Retry (${retrySelectedIds.size})`;
    confirmRunBtn.dataset.mode = 'retry';
  } else {
    confirmRunBtn.textContent = 'Run';
    confirmRunBtn.dataset.mode = 'run';
  }
}

function openRunModal() {
  runSelectedScript = activeTab || 'main.js'; // default to whichever tab you're currently looking at (chưa mở file nào -> main.js)
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
  for (const name of openTabs.includes(runSelectedScript) ? openTabs : [runSelectedScript, ...openTabs]) {
    const label = document.createElement('label');
    label.className = 'run-script-option' + (name === runSelectedScript ? ' is-checked' : '');
    label.innerHTML = `<input type="radio" name="runScript" value="${name}" ${name === runSelectedScript ? 'checked' : ''} /><span>${name}</span>`;
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

function selectAllRunProfiles() {
  lastProfiles.forEach((p) => runSelectedIds.add(p.id));
  runProfileGrid.querySelectorAll('.run-profile-chip').forEach((chip) => applyRunChipVisual(chip, chip.dataset.id));
  updateRunProfileCount();
}

// Same A-Z order the grid renders in -- shared so Shift+click range-select
// (below) always agrees with what's actually on screen, top to bottom.
function getOrderedRunProfileIds() {
  return [...lastProfiles]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    .map((p) => p.id);
}

// Click = toggle just this one (and remember it as the range anchor).
// Shift+click = select every profile between the anchor and this one,
// same convention as a file explorer / spreadsheet. A shift+click with
// no anchor yet (nothing plain-clicked this session) just falls back to
// a normal toggle.
function handleRunChipActivate(id, shiftKey) {
  if (shiftKey && runRangeAnchorId) {
    const ordered = getOrderedRunProfileIds();
    const from = ordered.indexOf(runRangeAnchorId);
    const to = ordered.indexOf(id);
    if (from !== -1 && to !== -1) {
      const [lo, hi] = from < to ? [from, to] : [to, from];
      for (let i = lo; i <= hi; i++) runSelectedIds.add(ordered[i]);
      runProfileGrid.querySelectorAll('.run-profile-chip').forEach((c) => applyRunChipVisual(c, c.dataset.id));
      updateRunProfileCount();
      runRangeAnchorId = id;
      return;
    }
  }
  toggleRunSelection(id);
  runRangeAnchorId = id;
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
    // click (not change) so Shift's modifier key is actually available;
    // we own checked state entirely via applyRunChipVisual from here on.
    chip.querySelector('.run-profile-chip-check').addEventListener('click', (e) => {
      e.preventDefault();
      handleRunChipActivate(p.id, e.shiftKey);
    });
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
    if (runDragStartedOnChip) handleRunChipActivate(runDragStartedOnChip.dataset.id, e.shiftKey);
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
// Ctrl/Cmd+A while the Run modal is open -- select every profile in the
// picker, same "just grab everything" shortcut as the dashboard's own
// grid. Only active while runModalOverlay is actually visible (so it
// doesn't fight with anything else on the page when the modal is
// closed), and skipped whenever focus is on a real text field --
// including CodeMirror itself, which renders its own contenteditable-
// like surface rather than a plain <textarea>, so a tag/isContentEditable
// check alone wouldn't catch it -- so Ctrl+A still does normal "select
// all text" wherever that's what you'd expect.
// -------------------------------------------------------------------
function isTypingTarget(el) {
  if (!el) return false;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
  if (el.closest && el.closest('.CodeMirror')) return true;
  return false;
}

document.addEventListener('keydown', (e) => {
  if (
    (e.ctrlKey || e.metaKey) &&
    e.key.toLowerCase() === 'a' &&
    !runModalOverlay.hidden &&
    !isTypingTarget(document.activeElement)
  ) {
    e.preventDefault();
    // Whichever of the two views is actually showing right now -- the
    // log view's failed-rows picker, or the config view's profile grid.
    if (!runModalLogView.hidden) selectAllFailedLogsRows();
    else selectAllRunProfiles();
  }
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
const excelImportBadge = document.getElementById('excelImportBadge'); // số dòng đã import, hiện ngay trên tiêu đề (mục thu gọn vẫn thấy)

let excelImportState = null; // { columnLetters: string[], headerLabels: object, rows: object[] } | null
let excelMatchByProfileId = new Map(); // profile.id -> matched row object | null, see header comment

importExcelBtn.addEventListener('click', () => excelFileInput.click());

clearExcelBtn.addEventListener('click', () => {
  excelImportState = null;
  excelMatchByProfileId = new Map();
  excelFileName.hidden = true;
  excelImportBadge.hidden = true;
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
      body: JSON.stringify({ rows, headerLabels }), // headerLabels = dòng tiêu đề -- excel-results.xlsx giữ đúng tên cột gốc
    }).then((res) => {
      if (!res.ok) {
        showToast(`Imported OK, but server rejected the snapshot save (HTTP ${res.status}) -- cross-row lookups in scripts will fail until this succeeds`, true);
      }
    }).catch(() => {
      showToast('Imported OK, but could not save the full-sheet snapshot to disk (cross-row lookups in scripts will fail until you re-import)', true);
    });

    excelImportBadge.hidden = false;
    excelImportBadge.textContent = `· ${rows.length} dòng`;
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
    let savedMatchColumn = null;
    try { savedMatchColumn = localStorage.getItem('excelMatchColumn'); } catch (e) {}
    excelMatchColumnSelect.value = (savedMatchColumn && columnLetters.includes(savedMatchColumn)) ? savedMatchColumn : (guess || columnLetters[0]);

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
  try { localStorage.setItem('excelMatchColumn', excelMatchColumnSelect.value); } catch (e) {} // trang Home (Xoá acc Suspended) dùng lại cột khớp này
  renderExcelSidebarPreview();
  if (!runModalOverlay.hidden) applyExcelMatchToRunInput();
});

// -------------------------------------------------------------------
// Sync Google Sheet -- nguồn THỨ HAI, hoàn toàn tách riêng khỏi Import
// from Excel ở trên (không đọc/ghi excel-snapshot.json, không có
// "match column to profile name" gì cả, chỉ đơn giản kéo cả sheet về
// snapshot riêng -- scripts đọc bằng readGoogleSheetCell(row, col),
// y hệt cách dùng readExcelCell(row, col)). Xem POST
// /api/google-sheet-sync + scripts/syncGoogleSheet.js.
// -------------------------------------------------------------------
const gsheetIdInput = document.getElementById('gsheetIdInput');
const gsheetTabInput = document.getElementById('gsheetTabInput');
const syncGSheetBtn = document.getElementById('syncGSheetBtn');
const gsheetSyncStatus = document.getElementById('gsheetSyncStatus');

// Chỉ để tiện tự điền lại 2 ô input lần sau -- KHÔNG phải nguồn sự
// thật, mỗi lần bấm Sync vẫn gửi đúng giá trị đang có trong 2 ô này.
try {
  gsheetIdInput.value = localStorage.getItem('gsheetId') || '';
  gsheetTabInput.value = localStorage.getItem('gsheetTab') || '';
} catch { /* localStorage có thể bị chặn (chế độ ẩn danh...) -- bỏ qua, chỉ mất tiện lợi tự điền */ }

// Chấp nhận dán cả link đầy đủ (https://docs.google.com/spreadsheets/d/ID/edit#gid=0)
// hoặc chỉ ID trần -- tách ID ra khỏi link nếu cần.
function extractSpreadsheetId(value) {
  const trimmed = (value || '').trim();
  const match = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : trimmed;
}

syncGSheetBtn.addEventListener('click', async () => {
  const spreadsheetId = extractSpreadsheetId(gsheetIdInput.value);
  const sheetName = gsheetTabInput.value.trim();

  if (!spreadsheetId) {
    showToast('Nhập Spreadsheet ID hoặc link Google Sheet trước', true);
    return;
  }

  try {
    localStorage.setItem('gsheetId', gsheetIdInput.value);
    localStorage.setItem('gsheetTab', gsheetTabInput.value);
  } catch { /* xem comment ở trên -- chỉ mất tiện lợi tự điền, không chặn Sync */ }

  syncGSheetBtn.disabled = true;
  const originalBtnText = syncGSheetBtn.textContent;
  syncGSheetBtn.textContent = 'Syncing…';
  gsheetSyncStatus.hidden = true;

  try {
    const res = await fetch('/api/google-sheet-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spreadsheetId, sheetName: sheetName || undefined }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    gsheetSyncStatus.hidden = false;
    gsheetSyncStatus.textContent = `Đã đồng bộ ${data.rowCount} dòng dữ liệu từ tab "${data.sheetName}".`;
    showToast(`Google Sheet synced -- ${data.rowCount} row(s) from "${data.sheetName}"`);
  } catch (err) {
    showToast(`Sync Google Sheet lỗi: ${err.message}`, true);
  } finally {
    syncGSheetBtn.disabled = false;
    syncGSheetBtn.textContent = originalBtnText;
  }
});

// -------------------------------------------------------------------
// Chụp màn hình -- 3 ô cài đặt cho scripts/xlv2_getScreenShot.js (thư mục
// lưu, tiền tố, hậu tố tên file; phần giữa là dòng Excel). Nguồn sự thật là
// file trên server (GET/POST /api/screenshot-settings) vì script chạy phía
// server không đọc được localStorage của trình duyệt. Tự lưu khi rời khỏi ô.
// -------------------------------------------------------------------
const shotDirInput = document.getElementById('shotDirInput');
const shotPrefixInput = document.getElementById('shotPrefixInput');
const shotSuffixInput = document.getElementById('shotSuffixInput');
const shotStatus = document.getElementById('shotStatus');

function applyShotSettings(s) {
  shotDirInput.value = s.dir || '';
  shotDirInput.placeholder = s.defaultDir || '';
  shotPrefixInput.value = s.prefix || '';
  shotSuffixInput.value = s.suffix || '';
}

async function loadShotSettings() {
  try {
    const res = await fetch('/api/screenshot-settings');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    applyShotSettings(await res.json());
  } catch (err) {
    shotStatus.textContent = `Không đọc được cài đặt chụp màn hình: ${err.message}`;
  }
}

async function saveShotSettings() {
  try {
    const res = await fetch('/api/screenshot-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: shotDirInput.value, prefix: shotPrefixInput.value, suffix: shotSuffixInput.value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    applyShotSettings(data);
    shotStatus.textContent = 'Đã lưu. Tên file = tiền tố + dòng Excel + hậu tố + .png';
  } catch (err) {
    shotStatus.textContent = `Lưu cài đặt chụp màn hình lỗi: ${err.message}`;
    showToast(`Lưu cài đặt chụp màn hình lỗi: ${err.message}`, true);
  }
}

[shotDirInput, shotPrefixInput, shotSuffixInput].forEach((input) => input.addEventListener('change', saveShotSettings));
loadShotSettings();

// -------------------------------------------------------------------
// Danh sách proxy dùng chung cho hàng đợi Run (GET/POST /api/proxy-pool) --
// server đọc lại mỗi lần mở profile, nên sửa lúc đang chạy cũng có hiệu lực
// cho các profile mở sau. Tự lưu khi rời khỏi ô; dòng sai được báo ngay.
// -------------------------------------------------------------------
const proxyPoolInput = document.getElementById('proxyPoolInput');
const proxyPoolStatus = document.getElementById('proxyPoolStatus');

function showProxyPoolStatus(d, saved) {
  const head = d.count > 0 ? `${saved ? 'Đã lưu. ' : ''}${d.count} proxy -- mỗi profile được gán proxy ít người dùng nhất.` : `${saved ? 'Đã lưu. ' : ''}Danh sách trống -- mỗi profile dùng proxy riêng như cũ.`;
  proxyPoolStatus.textContent = [head, ...(d.warnings || [])].join('\n');
  proxyPoolStatus.style.whiteSpace = 'pre-line';
}

async function loadProxyPool() {
  try {
    const res = await fetch('/api/proxy-pool');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    proxyPoolInput.value = d.text || '';
    showProxyPoolStatus(d, false);
  } catch (err) {
    proxyPoolStatus.textContent = `Không đọc được danh sách proxy: ${err.message}`;
  }
}

proxyPoolInput.addEventListener('change', async () => {
  try {
    const res = await fetch('/api/proxy-pool', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: proxyPoolInput.value }) });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
    showProxyPoolStatus(d, true);
  } catch (err) {
    proxyPoolStatus.textContent = `Lưu danh sách proxy lỗi: ${err.message}`;
    showToast(`Lưu danh sách proxy lỗi: ${err.message}`, true);
  }
});
loadProxyPool();

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

// Shared by the log view's small "Retry (N)" button AND the config
// view's big Run button whenever IT is in retry mode (see
// syncConfirmRunBtnMode above) -- reruns exactly `ids`, reusing the
// PREVIOUS run's script/settings (lastRunConfig) rather than whatever's
// currently sitting in the config form. lastRunConfig/logsFilterFailedBtn
// etc. are declared further down this file but only read once a click
// actually happens, so the forward reference is safe.
async function runRetrySelected(ids) {
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
    syncConfirmRunBtnMode();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    refreshRunModalStatus();
  }
}

confirmRunBtn.addEventListener('click', async () => {
  // The big Run button doubles as Retry once there's a live pick from
  // the log view's failed-rows filter (see syncConfirmRunBtnMode) --
  // handle that FIRST so bouncing back to "Configure a new run" with a
  // pick still active can never fall through to a full re-run of
  // runSelectedIds below.
  if (confirmRunBtn.dataset.mode === 'retry') {
    await runRetrySelected([...retrySelectedIds]);
    return;
  }

  const ids = [...runSelectedIds];
  if (ids.length === 0) return showToast('Select at least one profile', true);

  if (activeTab) tabContents[activeTab] = editor.getValue();

  // Unsaved file-backed tabs would mean require('./x') inside the
  // running script picks up whatever's STILL on disk from before your
  // latest edits, not what the editor is showing -- refuse to run
  // rather than silently use stale code (or silently save behind your
  // back).
  if (dirtyTabs.size > 0) {
    return showToast(`Save before running: ${[...dirtyTabs].join(', ')}`, true);
  }

  // The dirty-check above guarantees nothing is unsaved right now, so
  // disk and the editor agree for every open tab -- but a script that
  // was never opened this session (most commonly main.js now that the
  // editor opens on the file list, not on a file) has nothing in
  // tabContents at all yet. Fetch it fresh rather than risk sending an
  // empty script to the queue.
  let scriptCode;
  try {
    const res = await fetch(`/api/scripts/${encodeURIComponent(runSelectedScript)}`);
    scriptCode = res.ok ? (await res.json()).code : '';
  } catch (err) {
    scriptCode = tabContents[runSelectedScript] || ''; // offline hiccup -- fall back to whatever's cached rather than running nothing at all
  }
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
    await startQueueRun(ids, { script: scriptCode, scriptName: runSelectedScript, maxConcurrent, maxPerProxy, retryCount, scriptTimeoutMs, inputsById });
    showToast(`Started on ${ids.length} profile(s)`);
    runModalForceConfig = false; // a fresh run always shows its own log view, even if "Configure a new run" was clicked earlier
    // Brand-new run -- any red/picked state from a previous one no
    // longer applies to what's about to show up in the log view.
    retrySelectedIds.clear();
    logsFilterFailedOnly = false;
    logsFilterFailedBtn.classList.remove('is-active');
    syncConfirmRunBtnMode();
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
const logsYellowCountNum = document.getElementById('logsYellowCountNum');
const logsGreenCountNum = document.getElementById('logsGreenCountNum');
const logsRedCountNum = document.getElementById('logsRedCountNum');
const logsSelectionBox = document.getElementById('logsSelectionBox');

const QUEUE_ROW_KEY = '__queue__'; // not a real profile id -- picks out the profileId===null entries
let logsModalSelectedKey = null; // null until the first render picks a default
let lastRenderedLogSignature = ''; // skip the full sidebar/detail rebuild below when nothing's actually changed since last poll
let logsFilterFailedOnly = false; // "Chỉ hiện lỗi" toggle -- hides every success + warning (vàng) row when on
const retrySelectedIds = new Set(); // profile ids picked (via drag) to feed the Retry button
let logsRangeAnchorKey = null; // last failed row clicked (no shift) -- Shift+click another one picks everything between the two
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
  // Bộ đếm màu vàng: đếm đúng những profile mà chấm tròn bên sidebar đang vàng (status 'warning' trong resultsById) -- cùng 1 nguồn dữ liệu nên 2 chỗ luôn khớp nhau.
  if (logsYellowCountNum) logsYellowCountNum.textContent = Object.values(resultsById).filter((r) => r.status === 'warning').length; // có kiểm tra null: nếu editor.html chưa cập nhật (thiếu ô đếm) thì bỏ qua, KHÔNG được làm hỏng việc vẽ danh sách profile
  // Bộ đếm xanh/đỏ: cùng nguồn resultsById với chấm tròn bên sidebar -- xanh = 'success', đỏ = 'failed' (chạy lỗi/ngắt quãng); cũng có kiểm tra null như bộ đếm vàng.
  const countByStatus = (st) => Object.values(resultsById).filter((r) => r.status === st).length;
  if (logsGreenCountNum) logsGreenCountNum.textContent = countByStatus('success');
  if (logsRedCountNum) logsRedCountNum.textContent = countByStatus('failed');

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
    else if (group.status === 'warning') dotClass += ' is-warning';
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
      check.addEventListener('click', (e) => {
        e.stopPropagation(); // don't ALSO switch the detail pane on every tick
        e.preventDefault(); // we manage checked state ourselves (needed for Shift-range below)
        handleLogsRowCheckActivate(key, e.shiftKey);
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

// "Chỉ hiện lỗi" -- hides every success AND warning (vàng) row, leaving
// failed/running/pending/Queue rows exactly as they were. Pure DOM class toggling off
// each row's own data-status, so this can run instantly on a button
// click without waiting for the next poll or touching byKey at all.
function applyLogsFilter() {
  logsModalSidebar.querySelectorAll('.logs-modal-row').forEach((row) => {
    row.classList.toggle('is-hidden-by-filter', logsFilterFailedOnly && (row.dataset.status === 'success' || row.dataset.status === 'warning'));
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
  syncConfirmRunBtnMode();
}

// Checkbox click on a failed row: plain click toggles just that one
// (and remembers it as the range anchor); Shift+click picks every
// failed row between the anchor and this one, in the order they're
// actually listed top to bottom -- same convention as the profile grid's
// handleRunChipActivate above. No anchor yet just falls back to a plain
// toggle.
function handleLogsRowCheckActivate(key, shiftKey) {
  const failedKeysInOrder = [...logsModalSidebar.querySelectorAll('.logs-modal-row[data-status="failed"]')]
    .map((r) => r.dataset.key);
  if (shiftKey && logsRangeAnchorKey) {
    const from = failedKeysInOrder.indexOf(logsRangeAnchorKey);
    const to = failedKeysInOrder.indexOf(key);
    if (from !== -1 && to !== -1) {
      const [lo, hi] = from < to ? [from, to] : [to, from];
      for (let i = lo; i <= hi; i++) retrySelectedIds.add(failedKeysInOrder[i]);
      logsRangeAnchorKey = key;
      applyPickedVisuals();
      return;
    }
  }
  if (retrySelectedIds.has(key)) retrySelectedIds.delete(key);
  else retrySelectedIds.add(key);
  logsRangeAnchorKey = key;
  applyPickedVisuals();
}

// Ctrl/Cmd+A while the log view is showing -- picks every currently
// VISIBLE failed row for the Retry button. "Chỉ hiện lỗi" only ever
// hides success/warning rows (failed ones are never hidden by it), so today
// this is just "every failed row" either way; :not(.is-hidden-by-filter)
// keeps it correct if that filter is ever extended.
function selectAllFailedLogsRows() {
  logsModalSidebar.querySelectorAll('.logs-modal-row[data-status="failed"]:not(.is-hidden-by-filter)').forEach((row) => {
    retrySelectedIds.add(row.dataset.key);
  });
  applyPickedVisuals();
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
      scriptName: config.scriptName,
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

logsRetryBtn.addEventListener('click', () => runRetrySelected([...retrySelectedIds]));

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

// Không mở sẵn file nào (kể cả main.js) -- renderTabBar() thấy chưa có tab thì hiện danh sách file, bấm file nào mở file đó
// (switchToTab() đọc nội dung mới nhất trên đĩa đúng lúc mở). Run vẫn chạy được dù chưa mở file: Run handler tự đọc file
// runSelectedScript ngay trước khi gửi đi.
// Mẫu code ở thanh bên trái chèn vào file đang mở -- chưa mở file thì chặn lại, không chèn vào editor đang ẩn
document.getElementById('editorChipGroups').addEventListener('click', (e) => { if (e.target.closest('button') && needOpenFile()) e.stopPropagation(); }, true);

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
  if (needOpenFile()) return false;
  if (typeof editor.replaceSelection === 'function') {
    editor.replaceSelection(code);
  } else {
    editor.setValue(editor.getValue() + code);
  }
  editor.focus();
  return true;
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

// Opens the real VS Code app (Open Folder) pointed at this project's
// root -- see POST /api/open-in-vscode in server.js for the actual
// launch + why it needs a shell (Windows' code.cmd shim).
document.getElementById('openVsCodeBtn').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/open-in-vscode', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Couldn't open VS Code");
    showToast('Opening in VS Code\u2026');
  } catch (err) {
    showToast(err.message, true);
  }
});

// Nút "Reset Done Task": xoá đánh dấu task đã xong của interactX (tất cả tài khoản) -- bấm mỗi khi đặt lại toàn bộ task mới.
document.getElementById('resetDoneTasksBtn').addEventListener('click', async () => {
  try {
    const sum = await fetch('/api/home-tasks').then((r) => r.json());
    if (sum.error) throw new Error(sum.error);
    if (!sum.done) { showToast('Chưa có task nào được đánh dấu xong -- không cần reset.'); return; }
    if (!confirm(`Đang có ${sum.done} task đã xong trên ${sum.accounts} tài khoản.\nXoá hết đánh dấu để lần chạy sau làm lại toàn bộ task?`)) return;
    const res = await fetch('/api/home-tasks/reset', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Reset không thành công');
    showToast(`Đã reset ${data.done} task đã xong của ${data.accounts} tài khoản.`);
  } catch (err) {
    showToast(err.message, true);
  }
});

// Nút "Update Task State": server gộp danh sách task HIỆN TẠI trong code (const functions = [...] ở xlv3_Interactx.js) với các task đã xong
// -> từng tài khoản còn thiếu task nào (task mới thêm vào code tự hiện ở đây) hay đã Done toàn bộ. Chỉ để xem, lúc chạy interactX cũng tự gộp y như vậy.
const taskStateOverlay = document.getElementById('taskStateOverlay');
const taskStateBody = document.getElementById('taskStateBody');
const taskStateOnlyMissing = document.getElementById('taskStateOnlyMissing');
let taskStateData = null;

const taskStateSummary = document.getElementById('taskStateSummary');
const taskStateSearch = document.getElementById('taskStateSearch');
const taskStateList = document.getElementById('taskStateList');

function renderTaskState() {
  const { tasks, accounts } = taskStateData;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const doneAll = accounts.filter((a) => !a.missing.length).length;
  const q = taskStateSearch.value.trim().toLowerCase().replace(/^@/, '');
  const shown = (taskStateOnlyMissing.checked ? accounts.filter((a) => a.missing.length) : accounts)
    .filter((a) => !q || String(a.username).toLowerCase().includes(q))
    .sort((a, b) => b.missing.length - a.missing.length);
  taskStateSummary.innerHTML = `Task trong code (<b>${tasks.length}</b>): ${tasks.map(esc).join(', ') || '(trống)'}<br>` +
    `<b>${doneAll}/${accounts.length}</b> tài khoản Done toàn bộ, <b>${accounts.length - doneAll}</b> tài khoản vẫn còn task chưa làm` +
    ` -- đang hiện <b>${shown.length}</b> dòng${shown.length > 12 ? ' (cuộn trong danh sách để xem hết)' : ''}.`;
  taskStateList.innerHTML = shown.length ? shown.map((a) => `<div class="task-state-row"><span class="task-state-user">@${esc(a.username)}</span><span>` +
      (a.missing.length ? `<span class="task-state-missing">Còn ${a.missing.length}: ${a.missing.map(esc).join(', ')}</span>` : '<span class="task-state-done">Done toàn bộ</span>') +
      (a.removed.length ? `<span class="task-state-removed">Đã xong nhưng không còn trong code: ${a.removed.map(esc).join(', ')}</span>` : '') +
      '</span></div>').join('')
    : `<div class="task-state-empty">${!accounts.length ? 'Chưa có tài khoản nào (chưa import Excel và chưa chạy lần nào).' : q ? 'Không có username nào khớp.' : 'Tất cả tài khoản đã Done toàn bộ.'}</div>`;
}

async function loadTaskState() {
  try {
    const res = await fetch('/api/home-tasks/state');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Không đọc được trạng thái task');
    taskStateData = data;
    renderTaskState();
    taskStateOverlay.hidden = false;
  } catch (err) {
    showToast(err.message, true);
  }
}

document.getElementById('taskStateBtn').addEventListener('click', loadTaskState);
document.getElementById('refreshTaskStateBtn').addEventListener('click', loadTaskState);
taskStateOnlyMissing.addEventListener('change', () => taskStateData && renderTaskState());
taskStateSearch.addEventListener('input', () => taskStateData && renderTaskState());
document.getElementById('closeTaskStateBtn').addEventListener('click', () => { taskStateOverlay.hidden = true; });
taskStateOverlay.addEventListener('click', (e) => { if (e.target === taskStateOverlay) taskStateOverlay.hidden = true; });

// -------------------------------------------------------------------
// Record thao tác (recorder.js ở server): chọn profile -> nút ⏺ REC hiện trong trình duyệt của profile đó -> thao tác tay ->
// "Chèn code" lấy code clickEl/typeEl... về chèn vào chỗ con trỏ. Chưa mở profile thì tự Launch trước.
// Bấm REC trong trình duyệt để dừng 1 đoạn -> lần poll sau tự chèn code của đúng đoạn đó (recLastExport = id đoạn cuối đã chèn).
// -------------------------------------------------------------------
const recModalOverlay = document.getElementById('recModalOverlay');
const recProfileList = document.getElementById('recProfileList');
const recSearch = document.getElementById('recSearch');
const recBar = document.getElementById('recBar');
const recBarText = document.getElementById('recBarText');
let recProfileId = null, recPollTimer = null, recLastExport = 0;

function renderRecProfiles() {
  const term = recSearch.value.trim().toLowerCase();
  // xếp theo abc (số theo thứ tự tự nhiên: acc_2 trước acc_10); profile đang mở vẫn có chấm xanh để nhận ra
  const list = lastProfiles.filter((p) => !term || p.name.toLowerCase().includes(term)).sort((a, b) => a.name.localeCompare(b.name, 'vi', { numeric: true, sensitivity: 'base' }));
  recProfileList.innerHTML = '';
  for (const p of list) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rec-profile' + (p.running ? ' is-running' : '');
    btn.innerHTML = `<span class="rec-run-dot"></span><span></span><span class="rec-state">${p.running ? 'đang mở' : 'chưa mở -- sẽ Launch'}</span>`;
    btn.children[1].textContent = p.name;
    btn.addEventListener('click', () => startRecording(p));
    recProfileList.appendChild(btn);
  }
  if (!list.length) recProfileList.innerHTML = '<p class="rec-hint">Không có profile nào.</p>';
}

async function startRecording(p) {
  try {
    if (!p.running) {
      showToast(`Đang mở ${p.name}...`);
      const r = await fetch(`/api/profiles/${p.id}/launch`, { method: 'POST' });
      if (!r.ok) throw new Error((await r.json()).error || 'Launch lỗi');
    }
    const res = await fetch(`/api/profiles/${p.id}/recorder/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ matchColumn: excelMatchColumnSelect.value }) }); // cột khớp tên profile -> recorder gợi ý row.X / readGoogleSheetCell
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    recProfileId = p.id;
    recLastExport = data.exportSeq || 0; // đoạn đã xuất từ lần record trước -- không chèn lại
    recBar.dataset.name = p.name;
    recModalOverlay.hidden = true;
    updateRecBar(data);
    clearInterval(recPollTimer);
    recPollTimer = setInterval(pollRecorder, 2000);
    showToast(`Đang ghi ${p.name} -- thao tác trên trình duyệt, bấm nút REC góc dưới phải để xem các bước`);
  } catch (err) {
    showToast(err.message, true);
  }
}

function updateRecBar(st) {
  if (!st || !st.enabled) { recBar.hidden = true; clearInterval(recPollTimer); recProfileId = null; return; }
  recBar.hidden = false;
  recBar.classList.toggle('is-paused', !st.recording);
  recBarText.textContent = `${st.recording ? 'Đang ghi' : 'Tạm dừng'}: ${recBar.dataset.name} · ${st.steps.length} bước`;
}

// Code record dùng tới mà file đang mở chưa có thì thêm vào đầu đoạn: require xlv1_actions, `row` (dòng Excel của profile), readGoogleSheetCell
// ---- ✨ Định dạng code bằng Prettier (tải từ CDN lần đầu dùng). Dòng dài tới 150 ký tự mới xuống dòng -- code gọn, ít xuống dòng.
// Code script là THÂN 1 hàm async (có await / return ở ngoài cùng) -- parser babel của Prettier chấp nhận.
const PRETTIER_CDN = 'https://cdn.jsdelivr.net/npm/prettier@3.3.3/';
const PRETTIER_OPTS = { parser: 'babel', printWidth: 150, tabWidth: 2, singleQuote: true, semi: true, trailingComma: 'es5', arrowParens: 'always', bracketSpacing: true };
let prettierLoading = null;
function loadPrettier() {
  if (window.prettier && window.prettierPlugins && window.prettierPlugins.babel && window.prettierPlugins.estree) return Promise.resolve();
  const add = (f) => new Promise((ok, bad) => { const sc = document.createElement('script'); sc.src = PRETTIER_CDN + f; sc.onload = ok; sc.onerror = () => bad(new Error('không tải được ' + f)); document.head.appendChild(sc); });
  if (!prettierLoading) prettierLoading = add('standalone.js').then(() => Promise.all([add('plugins/babel.js'), add('plugins/estree.js')])).catch((e) => { prettierLoading = null; throw e; });
  return prettierLoading;
}
async function formatJs(code) {
  await loadPrettier();
  return window.prettier.format(code, { ...PRETTIER_OPTS, plugins: [window.prettierPlugins.babel, window.prettierPlugins.estree] });
}
// Lỗi cú pháp của Prettier -> 1 dòng dễ đọc (dòng mấy, lỗi gì)
const fmtErr = (e) => String((e && e.message) || e).split('\n')[0].replace(/\s*\(\d+:\d+\)\s*$/, '') + (e && e.loc && e.loc.start ? ` (dòng ${e.loc.start.line})` : '');
async function formatEditor() {
  if (needOpenFile()) return;
  const sel = typeof editor.somethingSelected === 'function' && editor.somethingSelected();
  let a, b; // đoạn bôi đen -> lấy trọn các dòng của đoạn đó
  if (sel) { const f = editor.getCursor('from'), t = editor.getCursor('to'), tl = t.ch === 0 && t.line > f.line ? t.line - 1 : t.line; a = CodeMirror.Pos(f.line, 0); b = CodeMirror.Pos(tl, editor.getLine(tl).length); }
  const src = sel ? editor.getRange(a, b) : editor.getValue();
  let out;
  try { out = await formatJs(src); } catch (e) { return showToast('Không định dạng được: ' + fmtErr(e), true); }
  if (sel) { // giữ thụt lề của dòng đầu đoạn cho cả đoạn
    const ind = (src.match(/^[ \t]*/) || [''])[0];
    out = out.replace(/\n$/, '').split('\n').map((l) => (l ? ind + l : l)).join('\n');
    if (out !== src) editor.replaceRange(out, a, b, '+format');
  } else if (out !== src) {
    const cur = editor.getCursor(), scroll = editor.getScrollInfo();
    editor.operation(() => { editor.replaceRange(out, CodeMirror.Pos(0, 0), CodeMirror.Pos(editor.lastLine()), '+format'); editor.setCursor(Math.min(cur.line, editor.lastLine()), 0); });
    editor.scrollTo(scroll.left, scroll.top);
  }
  showToast(out === src ? 'Code đã gọn sẵn rồi' : '✨ Đã định dạng (Ctrl+Z để hoàn tác)');
}
document.getElementById('formatBtn').addEventListener('click', formatEditor);
if (typeof editor.addKeyMap === 'function') editor.addKeyMap({ 'Shift-Alt-F': () => formatEditor() });
// Code record chèn vào: định dạng trước (lỗi thì chèn nguyên văn), thụt lề theo chỗ con trỏ
async function prettyInsert(code) {
  recIntoFileFn();
  let out = code;
  try { out = (await formatJs(code)).replace(/\n$/, '') + '\n'; } catch {}
  if (typeof editor.getCursor === 'function') {
    const c = editor.getCursor(), line = editor.getLine(c.line), before = line.slice(0, c.ch);
    if (/^\s+$/.test(before)) out = out.split('\n').map((l, i) => (i && l ? before + l : l)).join('\n');
    if (!line.slice(c.ch).trim()) out = out.replace(/\n$/, ''); // phần còn lại của dòng trống -> không để thừa 1 dòng trống
  }
  return insertSnippetAtCursor(out);
}

function recPrelude(body, header, req) {
  const cur = editor.getValue();
  let pre = cur.includes("require('./xlv1_actions')") ? '' : header || '';
  const miss = ['clickNewTab', 'closeOtherTabs', 'dblClickEl', 'rightClickEl', 'checkEl'].filter((f) => new RegExp(`\\b${f}\\(`).test(body) && !new RegExp(`\\b${f}\\b`).test(cur));
  if (!pre && miss.length) pre += `const { ${miss.join(', ')} } = require('./xlv1_actions');\n`; // file require từ trước khi có các hàm này
  if (req && window.FN_TRANSFORM) { const r = { ...req }; delete r['./xlv1_actions']; for (const l of window.FN_TRANSFORM.requireLines(cur + '\n' + pre, r)) pre += l + '\n'; } // hàm gọi ở bảng ☰ của recorder: helpers, xlv1_humanInput, Excel...
  if (/readGoogleSheetCell\(/.test(body) && !/require\(['"]\.\/readGoogleSheetCell['"]\)/.test(cur + pre)) pre += "const { readGoogleSheetCell } = require('./readGoogleSheetCell');\n";
  if (/\brow\.[A-Z]|readGoogleSheetCell\(row\b/.test(body) && !/\b(const|let|var)\s+row\b/.test(cur + pre + body)) pre += 'const row = input ? JSON.parse(input) : {};\n';
  return pre + (pre && !pre.endsWith('\n\n') ? '\n' : '') + body;
}

// Chèn code các đoạn vừa dừng (exports có id > recLastExport)
let recWaitWarned = false;
function applyRecExports(list, header) {
  for (const e of list || []) {
    if (e.id <= recLastExport) continue;
    if (!activeTab) { if (!recWaitWarned) showToast('Có code vừa ghi -- mở 1 file để chèn vào', true); recWaitWarned = true; return; } // giữ lại, lần poll sau (đã mở file) mới chèn
    recWaitWarned = false;
    recLastExport = e.id;
    prettyInsert(recPrelude(e.body, header, e.req));
    showToast(`Đã chèn ${e.count} bước vừa ghi`);
  }
}

async function pollRecorder() {
  if (!recProfileId) return;
  try {
    const st = await (await fetch(`/api/profiles/${recProfileId}/recorder?since=${recLastExport}`)).json();
    applyRecExports(st.exports, st.header);
    updateRecBar(st);
  } catch {}
}

document.getElementById('openRecordBtn').addEventListener('click', async () => {
  await refreshProfiles().catch(() => {});
  recSearch.value = '';
  renderRecProfiles();
  recModalOverlay.hidden = false;
  recSearch.focus();
});
recSearch.addEventListener('input', renderRecProfiles);
document.getElementById('closeRecModalBtn').addEventListener('click', () => { recModalOverlay.hidden = true; });
recModalOverlay.addEventListener('click', (e) => { if (e.target === recModalOverlay) recModalOverlay.hidden = true; });

document.getElementById('recInsertBtn').addEventListener('click', async () => {
  if (!recProfileId) return;
  const st = await (await fetch(`/api/profiles/${recProfileId}/recorder?require=0`)).json();
  if (!st.steps || !st.steps.length) return showToast('Chưa ghi bước nào', true);
  // recPrelude: đã require / khai báo row rồi thì không chèn lại (khai báo const trùng = lỗi cú pháp)
  if (await prettyInsert(recPrelude(st.code, st.header, st.req))) showToast(`Đã chèn ${st.steps.length} bước`);
});
document.getElementById('recStopBtn').addEventListener('click', async () => {
  if (!recProfileId) return;
  const st = await fetch(`/api/profiles/${recProfileId}/recorder/stop`, { method: 'POST' }).then((r) => r.json()).catch(() => null);
  if (st && st.exported) applyRecExports([st.exported], st.header); // đang ghi dở 1 đoạn -> chèn nốt đoạn đó
  updateRecBar(null);
  showToast('Đã dừng record');
});

// ---- Gợi ý hàm khi gõ: danh sách ở public/fncatalog.js (gõ "c" ra clickEl, "i" ra if..., "w" ra while / waitEl -- không dấu cũng tìm
// được). Tự hiện khi gõ chữ ở đầu câu lệnh (đầu dòng, sau await / ; / { / `) `), Ctrl+Space để gọi ở chỗ bất kỳ. Chọn -> chèn đoạn code đúng
// thụt lề, thêm require còn thiếu lên đầu file, bôi đen sẵn 'SELECTOR' để dán selector vào.
const FX_LIB_FILES = ['helpers.js', 'xlv1_actions.js', 'xlv1_humanInput.js']; // file định nghĩa chính các hàm người thật -- không gợi ý / biến đổi trong đó
const fxBase = (n) => String(n || '').split(/[\\/]/).pop();
function fnWordAt(cm) {
  const cur = cm.getCursor(), line = cm.getLine(cur.line);
  let s = cur.ch; while (s > 0 && /[\w$]/.test(line[s - 1])) s--;
  return { from: CodeMirror.Pos(cur.line, s), to: cur, word: line.slice(s, cur.ch), before: line.slice(0, s) };
}
function fnInsert(cm, data, c) {
  const f = c.fn, w = data.w, indent = (cm.getLine(w.from.line).match(/^\s*/) || [''])[0];
  let code = /\bawait\s+$/.test(w.before) ? f.code.replace(/^await /, '') : f.code;
  code = code.split('\n').join('\n' + indent);
  const plan = window.FN_TRANSFORM ? window.FN_TRANSFORM.planRequires(cm.getValue(), f.req) : { edits: [], lines: [] }, req = plan.lines; // xét trên code TRƯỚC khi chèn (`const text = await getText(...)` không phải khai báo getText)
  cm.operation(() => {
    for (const e of plan.edits) if (e.line !== data.from.line) cm.replaceRange(e.text, CodeMirror.Pos(e.line, 0), CodeMirror.Pos(e.line, cm.getLine(e.line).length), '+fnhint'); // module đã require -> gộp tên mới vào dòng đó (chỉ đổi 1 dòng, không lệch vị trí chèn)
    cm.replaceRange(code, data.from, data.to, '+fnhint');
    let start = cm.indexFromPos(data.from), end = start + code.length;
    if (plan.edits.length) showToast('Đã thêm: ' + plan.edits.map((e) => `${e.names.join(', ')} ← ${e.mod}`).join(' · '));
    if (req.length) { // chèn sau khối require ở đầu file (giống FN_TRANSFORM.addRequires)
      let at = 0; for (let i = 0; i < Math.min(cm.lineCount(), 60); i++) if (/require\(/.test(cm.getLine(i)) || /^\s*useLog\(/.test(cm.getLine(i))) at = i + 1;
      const add = req.join('\n') + '\n', atIdx = cm.indexFromPos(CodeMirror.Pos(at, 0));
      cm.replaceRange(add, CodeMirror.Pos(at, 0), undefined, '+fnhint');
      if (atIdx <= start) { start += add.length; end += add.length; }
      showToast('Đã thêm: ' + req.filter((l) => /require/.test(l)).map((l) => l.replace(/^const \{ (.*) \} = require\('(.*)'\);$/, '$1 ← $2')).join(' · '));
    }
    const m = /SELECTOR\w*|TEXT|VALUE|\bX\b|https:\/\//.exec(cm.getValue().slice(start, end));
    if (m) cm.setSelection(cm.posFromIndex(start + m.index), cm.posFromIndex(start + m.index + m[0].length));
    else { const nl = code.indexOf('\n' + indent + '  \n'); cm.setCursor(cm.posFromIndex(nl >= 0 ? start + nl + indent.length + 3 : end)); } // khối rỗng { } -> con trỏ vào trong
  });
}
function fnHint(cm, opts) {
  if (!window.FN_CATALOG || FX_LIB_FILES.includes(fxBase(activeTab))) return null;
  const w = fnWordAt(cm);
  if (!w.word && !opts.manual) return null;
  const list = w.word ? window.FN_CATALOG.search(window.FN_CATALOG.CATALOG, w.word, 12) : window.FN_CATALOG.CATALOG;
  if (!list.length) return null;
  const data = { from: w.from, to: w.to, w, list: list.map((fn) => ({ text: fn.code, fn, hint: fnInsert, render: (el) => {
    const b = document.createElement('b'); b.textContent = fn.name;
    const d = document.createElement('span'); d.className = 'fn-hint-desc'; d.textContent = fn.desc || '';
    const g = document.createElement('span'); g.className = 'fn-hint-group'; g.textContent = fn.group;
    el.append(b, d, g);
  } })) };
  return data;
}
if (typeof CodeMirror !== 'undefined' && editor.showHint) {
  const showFnHint = (cm, manual) => cm.showHint({ hint: fnHint, completeSingle: false, manual, closeCharacters: /[\s()\[\]{};:>,.'"`=]/ });
  editor.addKeyMap({ 'Ctrl-Space': (cm) => showFnHint(cm, true) });
  editor.on('inputRead', (cm, ch) => {
    if (ch.origin !== '+input' || cm.state.completionActive || !/^[A-Za-z]$/.test(ch.text[0] || '')) return;
    const tok = cm.getTokenAt(cm.getCursor());
    if (/string|comment/.test(tok.type || '')) return;
    const w = fnWordAt(cm);
    if (w.word.length === 1 && /^(\s*|.*[;{}]\s*|.*\bawait\s+|.*\)\s+)$/.test(w.before)) showFnHint(cm, false); // chỉ ở đầu câu lệnh -- gõ tên biến giữa dòng không bị bật
  });
}

// ---- Nút ⇄ Biến đổi: quét file đang mở, đổi lệnh Playwright thô (con trỏ nhảy cóc, gõ tức thì) sang hàm người thật của project
// (public/fntransform.js): page.click / loc.click -> clickEl, fill -> typeEl, mouse.move -> moveMouseVisibly, waitForTimeout -> pause...
// Xem trước từng chỗ, bỏ tick chỗ không muốn đổi; Áp dụng = 1 lần Ctrl+Z là hoàn tác.
const fxOverlay = document.getElementById('fxOverlay'), fxList = document.getElementById('fxList'), fxAll = document.getElementById('fxAll');
let fxSrc = '', fxChanges = [];
function openTransform() {
  if (needOpenFile()) return;
  if (!window.FN_TRANSFORM) return showToast('Không tải được fntransform.js', true);
  if (FX_LIB_FILES.includes(fxBase(activeTab))) return showToast(`${fxBase(activeTab)} là file định nghĩa chính các hàm người thật -- không biến đổi (sẽ tự gọi lại chính nó)`, true);
  fxSrc = editor.getValue(); fxChanges = window.FN_TRANSFORM.findChanges(fxSrc);
  if (!fxChanges.length) return showToast('Không có lệnh nào cần đổi -- file đã dùng hàm người thật');
  const req = window.FN_TRANSFORM.requireLines(fxSrc, window.FN_TRANSFORM.mergeReq(fxChanges.map((c) => c.req)));
  document.getElementById('fxSummary').innerHTML = `Tìm thấy <b>${fxChanges.length}</b> lệnh nhảy cóc / gõ tức thì trong <b>${escapeHtmlFx(fxBase(activeTab))}</b>.${req.length ? ` Sẽ thêm lên đầu file: <code>${req.map(escapeHtmlFx).join('</code> <code>')}</code>` : ''}`;
  fxList.innerHTML = fxChanges.map((c, i) => `<label class="fx-row"><input type="checkbox" data-i="${i}" checked><span class="fx-line">${c.line}</span><span class="fx-code"><span class="fx-before">${escapeHtmlFx(c.before)}</span><span class="fx-after">${escapeHtmlFx(c.after)}</span></span></label>`).join('');
  fxAll.checked = true;
  fxOverlay.hidden = false;
}
const escapeHtmlFx = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function applyTransform() {
  const picked = [...fxList.querySelectorAll('input[data-i]:checked')].map((x) => fxChanges[+x.dataset.i]);
  fxOverlay.hidden = true;
  if (!picked.length) return;
  if (editor.getValue() !== fxSrc) return showToast('File đã đổi trong lúc xem trước -- bấm ⇄ Biến đổi lại', true);
  const out = window.FN_TRANSFORM.applyChanges(fxSrc, picked);
  if (typeof editor.operation === 'function') { // thay cả file trong 1 lần sửa -> Ctrl+Z hoàn tác 1 phát, giữ vị trí cuộn
    const scroll = editor.getScrollInfo(), cur = editor.getCursor();
    editor.operation(() => { editor.replaceRange(out, CodeMirror.Pos(0, 0), CodeMirror.Pos(editor.lastLine()), '+fntransform'); editor.setCursor(cur); });
    editor.scrollTo(scroll.left, scroll.top);
  } else editor.setValue(out);
  showToast(`Đã đổi ${picked.length} lệnh sang hàm người thật (Ctrl+Z để hoàn tác)`);
}
document.getElementById('transformBtn').addEventListener('click', openTransform);
document.getElementById('fxApplyBtn').addEventListener('click', applyTransform);
for (const id of ['fxCloseBtn', 'fxCancelBtn']) document.getElementById(id).addEventListener('click', () => { fxOverlay.hidden = true; });
fxOverlay.addEventListener('click', (e) => { if (e.target === fxOverlay) fxOverlay.hidden = true; });
fxAll.addEventListener('change', () => { for (const x of fxList.querySelectorAll('input[data-i]')) x.checked = fxAll.checked; });

// ---- Nút 📤 Export hàm: các hàm khai báo ở ngoài cùng của file đang mở -> đưa vào 1 FILE CHỨA HÀM (chính file này, file có sẵn hoặc
// file mới): chép code hàm sang (kèm các require nó dùng), thêm vào module.exports. Dòng `const { ... } = require('./file');` cho main.js
// chỉ HIỆN RA để tự copy -- không bao giờ tự sửa main.js. File đang mở cũng không bị sửa khi đưa sang file khác (chỉ chép).
const xpOverlay = document.getElementById('xpOverlay'), xpList = document.getElementById('xpList'), xpTarget = document.getElementById('xpTarget'), xpNewName = document.getElementById('xpNewName');
const XP_SELF = '__self__', XP_NEW = '__new__';
// Hàm ở ngoài cùng (đầu dòng, không thụt lề): function a() / async function a() / const a = (...) => / const a = async function...
const TOP_FN_RE = /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/gm;
function topFunctions(src) {
  const out = []; let m; TOP_FN_RE.lastIndex = 0;
  while ((m = TOP_FN_RE.exec(src))) { const n = m[1] || m[2]; if (!out.some((x) => x.name === n)) out.push({ name: n, start: m.index }); }
  return out;
}
// Đoạn code của 1 hàm: từ dòng khai báo tới dấu } khớp của thân hàm (bỏ qua chuỗi / chú thích / template); arrow không có { } thì tới hết câu lệnh
function fnSource(src, start) {
  let i = start, depth = 0, opened = false;
  const skipStr = (q) => { for (i++; i < src.length && src[i] !== q; i++) if (src[i] === '\\') i++; };
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { skipStr(c); continue; }
    if (c === '{') { depth++; opened = true; }
    else if (c === '}') { depth--; if (opened && depth === 0) { i++; break; } }
    else if (!opened && (c === ';' || c === '\n') && depth === 0 && /=>/.test(src.slice(start, i)) && !/=>\s*$/.test(src.slice(start, i))) break; // const f = (x) => x + 1;
  }
  if (src[i] === ';') i++;
  return src.slice(start, i);
}
const EXPORTS_RE = /module\.exports\s*=\s*\{([\s\S]*?)\}\s*;?/;
function exportedNames(src) {
  const m = EXPORTS_RE.exec(src), names = m ? m[1].split(',').map((x) => x.trim().split(':')[0].trim()).filter(Boolean) : [];
  for (const x of src.matchAll(/(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/g)) names.push(x[1]);
  return names;
}
function withExports(src, names) { // gộp tên vào module.exports = { ... } (giữ các mục cũ, kể cả dạng a: b); chưa có thì thêm cuối file
  const m = EXPORTS_RE.exec(src);
  if (!m) return src.replace(/\s*$/, '') + `\n\nmodule.exports = { ${names.join(', ')} };\n`;
  const items = m[1].split(',').map((x) => x.trim()).filter(Boolean), have = items.map((x) => x.split(':')[0].trim());
  return src.slice(0, m.index) + `module.exports = { ${[...items, ...names.filter((n) => !have.includes(n))].join(', ')} };` + src.slice(m.index + m[0].length);
}
// require của file nguồn mà code các hàm chép sang có dùng tới -> { module: [tên] } để thêm vào file đích
function usedRequires(src, code) {
  const req = {};
  for (const m of src.matchAll(/const\s*\{([^}]*)\}\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const names = m[1].split(',').map((x) => x.trim().split(':').pop().trim()).filter((n) => n && new RegExp(`\\b${n}\\b`).test(code));
    if (names.length) req[m[2]] = [...new Set([...(req[m[2]] || []), ...names])];
  }
  return req;
}
const xpModule = (name) => './' + name.replace(/\.js$/, '');
const xpDest = () => (xpTarget.value === XP_SELF ? activeTab : xpTarget.value === XP_NEW ? (xpNewName.value.trim() ? xpNewName.value.trim().replace(/(\.js)?$/, '.js') : '') : xpTarget.value);
async function xpRead(name) { // nội dung file: đang mở ở tab thì lấy bản trong editor (kể cả chưa lưu), không thì đọc từ đĩa ('' = chưa có)
  if (name === activeTab) return editor.getValue();
  if (openTabs.includes(name) && tabContents[name] != null) return tabContents[name];
  const res = await fetch(`/api/scripts/${encodeURIComponent(name)}`).catch(() => null);
  return res && res.ok ? (await res.json()).code : '';
}
const xpPicked = () => [...xpList.querySelectorAll('input[data-n]:checked')].map((x) => x.dataset.n);
const xpLine = () => { const names = xpPicked(), d = xpDest(); return names.length && d ? `const { ${names.join(', ')} } = require('${xpModule(d)}');` : ''; };
function xpPreview() {
  xpNewName.hidden = xpTarget.value !== XP_NEW;
  document.getElementById('xpPreview').textContent = xpLine() || (xpPicked().length ? '(nhập tên file mới)' : '(chưa chọn hàm nào)');
}
async function openExportFns() {
  if (needOpenFile()) return;
  if (!window.FN_TRANSFORM) return showToast('Không tải được fntransform.js', true);
  const src = editor.getValue(), fns = topFunctions(src), done = exportedNames(src);
  if (!fns.length) return showToast('File này chưa có hàm nào khai báo ở ngoài cùng (function tên() / const tên = async () =>)', true);
  document.getElementById('xpSummary').innerHTML = `<b>${escapeHtmlFx(activeTab)}</b> có <b>${fns.length}</b> hàm. Tick hàm cần dùng, chọn file chứa hàm -- hàm được chép sang (kèm require nó dùng) và thêm vào <code>module.exports</code> của file đó. <b>main.js không bị đụng tới</b>: dòng require ở dưới bạn tự copy.`;
  xpList.innerHTML = fns.map((f) => `<label class="fx-row xp-row"><input type="checkbox" data-n="${escapeHtmlFx(f.name)}"><span class="fx-code"><span class="fx-after xp-name">${escapeHtmlFx(f.name)}</span></span><span class="xp-tag">${done.includes(f.name) ? 'đã export ở file này' : ''}</span></label>`).join('');
  const files = (await (await fetch('/api/scripts')).json().catch(() => [])).filter((f) => f !== activeTab && f !== 'main.js').sort((a, b) => a.localeCompare(b));
  xpTarget.innerHTML = (activeTab !== 'main.js' ? `<option value="${XP_SELF}">chính file này (${escapeHtmlFx(activeTab)})</option>` : '') + files.map((f) => `<option value="${escapeHtmlFx(f)}">${escapeHtmlFx(f)}</option>`).join('') + `<option value="${XP_NEW}">+ File mới…</option>`;
  if (activeTab === 'main.js') xpTarget.value = XP_NEW; // từ main.js: mặc định tạo file hàm mới (không sửa main.js)
  xpNewName.value = '';
  document.getElementById('xpAll').checked = false;
  xpOverlay.hidden = false;
  xpPreview();
}
async function applyExportFns() {
  const names = xpPicked(), dest = xpDest();
  if (!names.length) return showToast('Chưa chọn hàm nào', true);
  if (!dest) return showToast('Nhập tên file mới', true);
  if (dest === 'main.js') return showToast('Không đưa vào main.js -- chọn file chứa hàm khác', true);
  if (!/^[\w.\- ]+\.js$/.test(dest)) return showToast('Tên file không hợp lệ', true);
  const src = editor.getValue();
  if (dest === activeTab) { // chính file này: chỉ thêm module.exports (sửa trong editor -> Ctrl+Z được), lưu
    const out = withExports(src, names);
    if (out !== src) editor.replaceRange(out, CodeMirror.Pos(0, 0), CodeMirror.Pos(editor.lastLine()), '+export');
    await saveActiveTab();
  } else { // file khác: chép code hàm còn thiếu sang + require nó dùng + module.exports; file đang mở giữ nguyên
    let d = await xpRead(dest);
    const have = topFunctions(d).map((f) => f.name), fns = topFunctions(src).filter((f) => names.includes(f.name) && !have.includes(f.name));
    const code = fns.map((f) => fnSource(src, f.start).trim()).join('\n\n');
    if (code) {
      const m = EXPORTS_RE.exec(d), at = m ? m.index : d.length; // chèn TRƯỚC module.exports (nếu có)
      d = d.slice(0, at).replace(/\s*$/, d.trim() ? '\n\n' : '') + code + '\n' + (m ? '\n' + d.slice(at) : '');
      d = window.FN_TRANSFORM.addRequires(d, usedRequires(src, code));
    }
    d = withExports(d, names);
    if (!(await saveFile(dest, d))) return;
    if (openTabs.includes(dest)) { tabContents[dest] = d; dirtyTabs.delete(dest); renderTabBar(); }
    refreshFileMenu && refreshFileMenu();
  }
  const line = xpLine();
  copyToClipboardFx(line);
  document.getElementById('xpPreview').textContent = line;
  showToast(`📤 Đã đưa ${names.length} hàm vào ${dest} -- dòng require đã copy, tự dán vào main.js`);
}
function copyToClipboardFx(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).catch(() => {});
  const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch {} ta.remove();
}
document.getElementById('exportFnBtn').addEventListener('click', openExportFns);
document.getElementById('xpApplyBtn').addEventListener('click', applyExportFns);
document.getElementById('xpCopyBtn').addEventListener('click', () => { const l = xpLine(); if (!l) return showToast('Chưa có dòng nào để copy', true); copyToClipboardFx(l); showToast('📋 Đã copy -- dán vào main.js'); });
for (const id of ['xpCloseBtn', 'xpCancelBtn']) document.getElementById(id).addEventListener('click', () => { xpOverlay.hidden = true; });
xpOverlay.addEventListener('click', (e) => { if (e.target === xpOverlay) xpOverlay.hidden = true; });
xpList.addEventListener('change', xpPreview);
xpTarget.addEventListener('change', xpPreview);
xpNewName.addEventListener('input', xpPreview);
document.getElementById('xpAll').addEventListener('change', (e) => { for (const x of xpList.querySelectorAll('input[data-n]')) x.checked = e.target.checked; xpPreview(); });
