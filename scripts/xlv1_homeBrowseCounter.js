/**
 * scripts/xlv1_homeBrowseCounter.js
 * -----------------------------------------------------------------------
 * Bộ đánh dấu các task (hàm follow/post/retweet... trong runRandom của xlv3_Interactx.js) đã chạy THÀNH CÔNG cho từng tài khoản X.
 * Đánh dấu VĨNH VIỄN (không tự reset theo ngày): mỗi lần chạy interactX chỉ bốc vài task CHƯA xong, dần dần làm hết cả bộ.
 * Muốn làm lại từ đầu (VD vừa đặt lại toàn bộ task mới) -> bấm nút "Reset Done Task" trên trang editor (server.js gọi resetAllTasks()).
 *
 * Đánh dấu theo TÊN HÀM, lưu ra file trên đĩa -> sửa code / thêm task mới / khởi động lại server không mất đánh dấu.
 * Task mới thêm (tên mới) tự được coi là chưa làm. Giữ nguyên tên hàm mà đổi target bên trong thì vẫn bị coi là đã xong -> đổi tên hàm hoặc bấm Reset.
 *
 * Mỗi tài khoản 1 file: <DATA_DIR>/home-browse/<username>.json = { "done": { "follow_a": "2026-10-13T08:00:00.000Z", ... } } (tên hàm -> lúc xong)
 * Tách riêng từng tài khoản (không dùng chung 1 file) vì nhiều profile chạy SONG SONG -- mỗi profile chỉ ghi file của chính nó, không cần khoá.
 *
 * Usage:
 *   const { getTasksDone, markTaskDone } = require('./xlv1_homeBrowseCounter');
 *   const names = getTasksDone(username);              // tên các hàm đã chạy thành công (từ lần Reset gần nhất)
 *   markTaskDone(username, 'follow_a');                // ghi nhận 1 hàm vừa chạy thành công
 * -----------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./datapaths');

const HOME_BROWSE_DIR = path.join(DATA_DIR, 'home-browse');

// Username X không phân biệt hoa/thường -- chuẩn hoá để "@Abc" và "abc" dùng chung 1 file; ký tự lạ thay bằng "_" cho an toàn tên file.
function fileOf(username) { const name = String(username).trim().replace(/^@/, '').toLowerCase().replace(/[^\w.-]/g, '_'); return path.join(HOME_BROWSE_DIR, `${name}.json`); }

// File chưa có / hỏng -> chưa xong task nào. File kiểu cũ (đánh dấu theo ngày: {date, tasks}) -> giữ các task đó là đã xong.
function readState(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (s && s.done && typeof s.done === 'object') return { done: s.done };
    if (s && Array.isArray(s.tasks)) return { done: Object.fromEntries(s.tasks.map((t) => [t, s.date || ''])) };
  } catch (e) {}
  return { done: {} };
}

// Ghi ra file tạm rồi rename -- tool bị tắt ngang lúc đang ghi cũng không để lại file JSON hỏng.
function writeState(file, state) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(HOME_BROWSE_DIR, { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(state)); fs.renameSync(tmp, file);
}

function getTasksDone(username) { return Object.keys(readState(fileOf(username)).done); }

function markTaskDone(username, taskName) {
  const file = fileOf(username), s = readState(file);
  if (!s.done[taskName]) { s.done[taskName] = new Date().toISOString(); writeState(file, s); }
}

// Thống kê cho nút "Reset Done Task": số tài khoản đang có đánh dấu + tổng số task đã xong.
function summarizeAllTasks() {
  let accounts = 0, done = 0;
  for (const f of fs.existsSync(HOME_BROWSE_DIR) ? fs.readdirSync(HOME_BROWSE_DIR) : []) {
    if (!f.endsWith('.json')) continue;
    const n = Object.keys(readState(path.join(HOME_BROWSE_DIR, f)).done).length;
    if (n) { accounts++; done += n; }
  }
  return { accounts, done };
}

// Xoá đánh dấu của TẤT CẢ tài khoản -- lần chạy sau mọi task đều được coi là chưa làm.
function resetAllTasks() {
  const before = summarizeAllTasks();
  for (const f of fs.existsSync(HOME_BROWSE_DIR) ? fs.readdirSync(HOME_BROWSE_DIR) : []) if (f.endsWith('.json')) fs.rmSync(path.join(HOME_BROWSE_DIR, f), { force: true });
  return before;
}

// Nút "Update Task State": gộp danh sách task HIỆN TẠI trong code (taskNames) với đánh dấu đã lưu của từng tài khoản -> mỗi tài khoản
// đã xong gì / còn thiếu gì. Task mới thêm vào code tự hiện ở "còn thiếu"; task đã xong nhưng không còn trong code thì nằm ở "removed".
// usernames: danh sách tài khoản (VD cột D của Excel) -- tài khoản chưa chạy lần nào (chưa có file) thì thiếu cả bộ.
function taskStateAll(taskNames, usernames = []) {
  const accounts = new Map(); // key = tên file (đã chuẩn hoá) -> tên hiển thị
  for (const u of usernames) { const name = String(u || '').trim().replace(/^@/, ''); if (name) accounts.set(path.basename(fileOf(name)), name); }
  for (const f of fs.existsSync(HOME_BROWSE_DIR) ? fs.readdirSync(HOME_BROWSE_DIR) : []) if (f.endsWith('.json') && !accounts.has(f)) accounts.set(f, f.slice(0, -5));
  return [...accounts].map(([f, username]) => {
    const done = Object.keys(readState(path.join(HOME_BROWSE_DIR, f)).done);
    return { username, done: taskNames.filter((t) => done.includes(t)), missing: taskNames.filter((t) => !done.includes(t)), removed: done.filter((t) => !taskNames.includes(t)) };
  });
}

module.exports = { getTasksDone, markTaskDone, summarizeAllTasks, resetAllTasks, taskStateAll, HOME_BROWSE_DIR };
