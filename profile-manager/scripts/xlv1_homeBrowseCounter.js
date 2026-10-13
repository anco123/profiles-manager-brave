/**
 * scripts/xlv1_homeBrowseCounter.js
 * -----------------------------------------------------------------------
 * Ghi nhận các hàm (follow/post/...) mà interactX đã chạy THÀNH CÔNG TRONG NGÀY cho từng tài khoản X -- lần chạy lại trong ngày
 * vẫn lướt Home bình thường nhưng bỏ qua các hàm này, chỉ chèn các hàm còn thiếu/lỗi (xem browseHomeAndRun trong xlv3_Interactx.js).
 *
 * Lưu mỗi tài khoản 1 file riêng: <DATA_DIR>/home-browse/<username>.json = { "date": "2026-09-27", "tasks": ["follow_fr_a", ...] }
 * Tách riêng từng tài khoản (không dùng chung 1 file) vì nhiều profile chạy SONG SONG -- mỗi profile chỉ ghi file của chính nó nên không ghi đè lẫn nhau, không cần khoá như writeExcelCell.js.
 * "Ngày" tính theo giờ của máy đang chạy tool: sang ngày mới thì coi như chưa chạy hàm nào, không cần xoá file.
 *
 * Usage:
 *   const { getTasksDoneToday, markTaskDone } = require('./xlv1_homeBrowseCounter');
 *   const names = getTasksDoneToday(username);         // tên các hàm đã chạy thành công hôm nay
 *   markTaskDone(username, 'follow_fr_a');             // ghi nhận 1 hàm vừa chạy thành công
 * -----------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./datapaths');

const HOME_BROWSE_DIR = path.join(DATA_DIR, 'home-browse');

function todayKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

// Username X không phân biệt hoa/thường -- chuẩn hoá để "@Abc" và "abc" dùng chung 1 file; ký tự lạ thay bằng "_" cho an toàn tên file.
function fileOf(username) { const name = String(username).trim().replace(/^@/, '').toLowerCase().replace(/[^\w.-]/g, '_'); return path.join(HOME_BROWSE_DIR, `${name}.json`); }

// File chưa có / hỏng / của ngày khác -> coi như hôm nay chưa chạy hàm nào.
function readToday(username) {
  try { const s = JSON.parse(fs.readFileSync(fileOf(username), 'utf-8')); if (s.date === todayKey()) return { date: s.date, tasks: Array.isArray(s.tasks) ? s.tasks : [] }; } catch (e) {}
  return { date: todayKey(), tasks: [] };
}

// Ghi ra file tạm rồi rename -- tool bị tắt ngang lúc đang ghi cũng không để lại file JSON hỏng.
function writeToday(username, state) {
  const file = fileOf(username), tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(HOME_BROWSE_DIR, { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(state)); fs.renameSync(tmp, file);
}

function getTasksDoneToday(username) { return readToday(username).tasks; }

function markTaskDone(username, taskName) {
  const s = readToday(username);
  if (!s.tasks.includes(taskName)) { s.tasks.push(taskName); writeToday(username, s); }
}

module.exports = { getTasksDoneToday, markTaskDone, HOME_BROWSE_DIR };