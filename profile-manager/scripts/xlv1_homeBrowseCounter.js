/**
 * scripts/xlv1_homeBrowseCounter.js
 * -----------------------------------------------------------------------
 * Đếm số lần ĐÃ lướt Home TRONG NGÀY của từng tài khoản X -- interactX dùng để biết hôm nay lướt đủ chưa (xem HOME_BROWSE_PER_DAY trong xlv3_Interactx.js).
 *
 * Lưu mỗi tài khoản 1 file riêng: <DATA_DIR>/home-browse/<username>.json = { "date": "2026-09-27", "count": 1, "last": "<giờ lướt xong gần nhất>" }
 * Tách riêng từng tài khoản (không dùng chung 1 file) vì nhiều profile chạy SONG SONG -- mỗi profile chỉ ghi file của chính nó nên không ghi đè lẫn nhau, không cần khoá như writeExcelCell.js.
 * "Ngày" tính theo giờ của máy đang chạy tool: sang ngày mới thì số lần tự coi như 0, không cần xoá file.
 *
 * Usage:
 *   const { getHomeBrowseCountToday, markHomeBrowsed } = require('./xlv1_homeBrowseCounter');
 *   const done = getHomeBrowseCountToday(username);   // số lần đã lướt hôm nay
 *   const count = markHomeBrowsed(username);           // +1 sau khi lướt xong, trả về số lần mới
 * -----------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./datapaths');

const HOME_BROWSE_DIR = path.join(DATA_DIR, 'home-browse');

function todayKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

// Username X không phân biệt hoa/thường -- chuẩn hoá để "@Abc" và "abc" dùng chung 1 file; ký tự lạ thay bằng "_" cho an toàn tên file.
function fileOf(username) { const name = String(username).trim().replace(/^@/, '').toLowerCase().replace(/[^\w.-]/g, '_'); return path.join(HOME_BROWSE_DIR, `${name}.json`); }

// File chưa có / hỏng / của ngày khác -> coi như hôm nay chưa lướt lần nào.
function getHomeBrowseCountToday(username) { try { const s = JSON.parse(fs.readFileSync(fileOf(username), 'utf-8')); return s.date === todayKey() ? (Number(s.count) || 0) : 0; } catch (e) { return 0; } }

// Ghi ra file tạm rồi rename -- tool bị tắt ngang lúc đang ghi cũng không để lại file JSON hỏng.
function markHomeBrowsed(username) {
  const count = getHomeBrowseCountToday(username) + 1, file = fileOf(username), tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(HOME_BROWSE_DIR, { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify({ date: todayKey(), count, last: new Date().toISOString() })); fs.renameSync(tmp, file);
  return count;
}

module.exports = { getHomeBrowseCountToday, markHomeBrowsed, HOME_BROWSE_DIR };