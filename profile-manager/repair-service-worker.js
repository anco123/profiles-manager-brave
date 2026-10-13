// repair-service-worker.js -- CHỮA 1 LẦN các profile đã bị màn đen Phantom.
// Đặt ở thư mục gốc project (cạnh server.js). TẮT app (Ctrl+C) và đóng hết
// Chrome trước, rồi chạy:
//   node repair-service-worker.js                 -> chữa TẤT CẢ profile
//   node repair-service-worker.js profile_abc123  -> chỉ chữa 1 profile (thử trước)
//
// Xoá TOÀN BỘ thư mục <profile>/Default/Service Worker. Lần mở sau Chrome
// đăng ký lại service worker từ đầu (cả của Phantom). Không đụng cookie,
// đăng nhập, dữ liệu ví hay extension -- chỉ thư mục Service Worker.
const fs = require('fs');
const path = require('path');

// Tìm DATA_DIR giống hệt server.js: .env DATA_DIR -> thư mục "Profile"
// ngang hàng project (nếu có profiles.json) -> ./data
function resolveDataDir() {
  const envFile = path.join(__dirname, '.env');
  if (fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, 'utf8').match(/^\s*DATA_DIR\s*=\s*(.+?)\s*$/m);
    if (m && m[1]) return m[1].replace(/^["']|["']$/g, '');
  }
  const sibling = path.join(__dirname, '..', 'Profile');
  return fs.existsSync(path.join(sibling, 'profiles.json')) ? sibling : path.join(__dirname, 'data');
}

const profilesRoot = path.join(resolveDataDir(), 'profiles');
if (!fs.existsSync(profilesRoot)) {
  console.error('Không tìm thấy thư mục profiles: ' + profilesRoot);
  process.exit(1);
}

const onlyId = process.argv[2];
const ids = onlyId ? [onlyId] : fs.readdirSync(profilesRoot).filter((d) => fs.statSync(path.join(profilesRoot, d)).isDirectory());

let fixed = 0;
for (const id of ids) {
  const swDir = path.join(profilesRoot, id, 'Default', 'Service Worker');
  if (!fs.existsSync(swDir)) continue;
  try {
    fs.rmSync(swDir, { recursive: true, force: true });
    fixed++;
    console.log('Đã xoá: ' + swDir);
  } catch (e) {
    console.log('LỖI (profile còn mở?): ' + swDir + ' -- ' + e.message);
  }
}
console.log(`\nXong: ${fixed}/${ids.length} profile. Thư mục profiles: ${profilesRoot}`);