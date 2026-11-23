# Ghi chú: bản Brave của profiles-manager

Tóm tắt những gì đã đổi so với bản gốc (Chrome Portable), lý do, và việc còn dở. Mở phiên Claude mới ở máy khác thì bảo nó đọc file này trước.

## Bố trí thư mục

| Thứ | Ở đâu |
|---|---|
| Project | `C:\PROJECT_MAIN\profiles-manager-brave` |
| Brave portable | `C:\PROJECT_MAIN\brave-v1.102.28-win32-x64\brave.exe` (nằm **cạnh** project, không có trong git) |
| Dữ liệu profile | `F:\AdditionSolfware\An_AntiDetectTool\Profile` (mọi máy, theo mục `"*"` trong `machines.json`) |

- Không cần `.env`. Server tự tìm thư mục `brave-v…-win32-x64` cạnh project (lên tới 4 cấp thư mục cha, nhiều bản thì lấy bản mới nhất); không thấy thì quay về `GoogleChromePortable`. Cập nhật Brave: giải nén bản mới cạnh bản cũ.
- Folder profile chưa có thì server tự tạo lúc khởi động. Máy không có ổ F thì server dừng và báo; cần folder khác thì thêm mục theo tên máy vào `machines.json`.
- Máy mới: `git pull`, `npm ci`, đặt thư mục Brave cạnh project, `npm start`.

## Đã đổi (theo thứ tự commit)

1. **Chuyển sang Brave** (`1dc6128`): `autoDetectPortableBrave` (giờ nằm ở `chrome-version-check.js`); `resolveChromePath` nhận thư mục chứa `brave.exe`.
2. **Client Hints khớp Brave** (`a1edda4`): `uaMetadataFor` trong `fingerprint.js` sinh danh sách brand theo đúng thuật toán GREASE của Chromium (seed = major version). Chạy Brave thì brand là `"Brave"` và version đầy đủ dạng `<major>.0.0.0`. Đã đối chiếu với header thật của Brave 159. Chỉ có tác dụng khi profile có User-Agent riêng.
3. **Tầng fingerprint trên Brave + GPU theo máy** (`3918e32`):
   - Chạy Brave thì tầng **Canvas, Audio, Font mặc định TẮT** (`braveDef: false` trong `FP_LAYERS`): Brave Shields tự làm nhiễu, thêm lớp nữa là chồng nhiễu. Nhiễu `readPixels` của WebGL đi theo tầng Canvas. Vẫn bật lại được ở bảng 🧬.
   - **Dò GPU thật**: lúc khởi động, server mở Brave ẩn 1 lần, đọc `UNMASKED_RENDERER`, lưu `<folder profile>\gpu-cache.json` theo tên máy + bản Brave.
   - **Chọn GPU giả lúc Launch** (`adaptGpuToHost`): cùng hãng, cùng mức shader (`vs_4_1` / `vs_5_0`), cùng kiểu tích hợp / rời, cùng đời với GPU thật; cố định theo profile. GPU giả cũ vẫn hợp thì giữ; không có GPU nào hợp thì báo GPU thật. Chỉ đổi trong lần Launch, fingerprint trên đĩa giữ nguyên.
   - Thêm 7 GPU đời rất cũ mức shader 4_1 (Intel HD 2000/3000, GeForce 210, GT 220, GT 240).
4. **Sửa lỗi làm hỏng web và dấu vết bị soi** (`fd86096`): bật fingerprint thì không vào được web, tắt thì vào được.
   - **Worker**: trước đây bọc `new Worker()` bằng `blob:` nên CSP `worker-src 'self'` của web chặn, worker của web chết. Giờ server chèn `buildWorkerPatchSource()` vào worker qua CDP (`Target.setAutoAttach` + `waitForDebuggerOnStart`, xem `attachWorkerPatch` trong `server.js`), áp cả module worker và Service Worker.
   - **`markNative`**: hàm thay thế là method (không có `prototype`, không gọi được bằng `new`), `length` như bản gốc, getter gọi sai receiver ném `Illegal invocation`, stack trace không lộ script chèn vào. `getParameter` kiểm tra receiver; `enumerateDevices` ghi đè trên `MediaDevices.prototype`.
   - **WebGL**: bỏ lọc danh sách extension (WebGL2 từng mất 15/27).
5. **Folder ổ F + 1 tab** (`b4cbf34`):
   - `machines.json`: mọi máy dùng folder ổ F.
   - Mỗi lần Launch chỉ có 1 tab: Brave mặc định mở lại toàn bộ tab của lần trước. Đặt `session.restore_on_startup = 5` và xoá danh sách tab đã lưu (`Sessions`, `Current/Last Session`, `Current/Last Tabs`) trước khi mở. Cookie, đăng nhập, lịch sử giữ nguyên.

6. **Rà soát + dọn dẹp**:
   - **Chặn web lạ gọi API server** (middleware đầu `server.js`): chỉ nhận header `Host` là localhost / IP / tên máy này (chống DNS rebinding); từ chối yêu cầu `/api` mà trình duyệt đánh dấu `cross-site`, và yêu cầu ghi có `Origin` khác server. Giao diện app, script Node, curl không bị ảnh hưởng.
   - `npm audit fix`: 0 lỗ hổng.
   - Xoá 12 file sao lưu thừa (`* - Copy.js`, `public.zip`, `scripts_backup.rar`…).
   - Banner phiên bản + nhãn trong giao diện ghi đúng Brave; `npm run check-chrome` nhận Brave (hàm tự dò trình duyệt chuyển sang `chrome-version-check.js`, server và lệnh này dùng chung).
   - `.gitattributes` thống nhất kiểu xuống dòng.
   - Test recorder: cả 4 đều qua, nhưng chậm (nested ~140 giây, cả bộ ~6 phút). Đừng chạy với giới hạn thời gian ngắn: bị cắt ngang sẽ báo "Page crashed" giả.

7. **Sửa lỗi CreepJS bắt được lớp fingerprint** (đo bằng CreepJS, Brave chạy ẩn):
   - Trước: bật fingerprint → **423 "lies"**, 20% stealth (gốc ở `Function.toString`). Tắt fingerprint → 6 lies (mức bình thường của Brave).
   - Nguyên nhân 1: khi hàm bọc ném lỗi, `markNative` cắt mất dòng `at Function.toString (<anonymous>)` của hàm native trong stack. Giờ chỉ bỏ các dòng của script chèn vào.
   - Nguyên nhân 2: script fingerprint bỏ qua iframe `about:blank` (điều kiện chỉ chạy trên `http(s)`), nên trong iframe số nhân CPU là của máy thật, và `toString` của iframe đọc được mã nguồn hàm bọc của trang. Giờ vá cả iframe cùng origin, và trang + iframe dùng chung danh sách hàm đã che (`REG_KEY`).
   - Sau khi sửa: bật fingerprint → 6 lies, 0% stealth, giống hệt lúc tắt.
   - Test tự động không hiện cửa sổ: chạy server với `PM_TEST_HEADLESS=1` thì Launch mở Brave ẩn.

## Việc còn dở / hạn chế đã biết

- **Đã xác nhận bằng Brave có cửa sổ (bật / tắt fingerprint):** CreepJS cả 2 đều 0% headless, 0% stealth, 4 lies giống nhau (Screen "failed matchMedia", nhiễu audio, nhiễu canvas, plugins). Cả 4 đều có sẵn ở Brave khi TẮT fingerprint, kể cả khi bỏ giả lập viewport (đã thử, không hết, đã hoàn tác). Pixelscan báo "Your Browser Fingerprint is inconsistent" ở CẢ 2 -- không phải do lớp fingerprint; "No automated behavior detected".
- **Worker thỉnh thoảng không được vá** (~3% worker, đo 210 worker chạy ẩn, nhiều nhất khi tạo hàng loạt cùng lúc): Worker đó báo giá trị Brave thật / tự nhiễu, lệch với trang. Nguyên nhân đã xác định: Playwright cũng tự gắn vào mỗi Worker và tự cho chạy ngay (`Runtime.runIfWaitingForDebugger` trong `coreBundle.js`); Worker KHÔNG chờ phiên CDP của mình (đã thử trì hoãn lệnh cho chạy của mình 1,5 giây: Worker vẫn chạy sau ~20ms). Đã thử và bỏ:
  - Điểm dừng `Debugger.setInstrumentationBreakpoint('beforeScriptExecution')`: tệ hơn (lệnh của mình vẫn tới sau khi Worker chạy; với worker thường, `Runtime.evaluate` gửi sớm bị giữ tới sau code của web và chặn luôn các lệnh sau nó).
  - `Emulation.setHardwareConcurrencyOverride`: Worker không kế thừa.
  - Muốn hết hẳn phải chặn lệnh cho chạy của Playwright (can thiệp nội bộ / sửa `node_modules`) -- chưa làm vì dễ vỡ khi cập nhật Playwright.
  - Đã bỏ biến toàn cục `self.__pmFpPatched` trong worker (web đọc được); server chỉ chèn 1 lần mỗi worker nên không cần.
- Tầng "Chặn hỏi thông báo" làm `Notification.permission = "denied"`: CreepJS tính là 1 dấu hiệu "giống headless" (Chrome thật là `"default"`).

- **Chưa thử fingerprint trên chính web bị chặn.** Mới thử bằng trang soi lỗi tự viết. Nếu vẫn không vào được: lấy tên web, mở profile, tắt dần từng tầng ở bảng 🧬 để tìm tầng gây lỗi.
- **Chưa chạy thử trong app**: phần "chỉ mở 1 tab", và dòng "GPU trên máy này" ở bảng 🧬.
- **SharedWorker** chưa được chèn fingerprint (CDP từ tab không bắt được loại này).
- **GPU giả của NVIDIA / AMD trong `GPU_POOL` thiếu mã thiết bị** `(0x…)`, trong khi Chrome thật thường có. GPU mới thêm thì có.
- **Số nhân CPU / RAM** vẫn lấy theo GPU lúc tạo fingerprint, chưa giới hạn theo máy thật.
- Máy có GPU rất cũ (như Intel HD 3000) chỉ có vài GPU giả hợp, nhiều profile sẽ trùng GPU.
- Thông số kỹ thuật WebGL (giới hạn texture, độ chính xác shader…) luôn là của GPU thật; giả tên chỉ qua được khi GPU giả cùng loại.
- Bản Brave đang dùng là **Nightly**: kém ổn định, cách Brave làm nhiễu có thể đổi giữa các bản.
- Brave tự làm nhiễu canvas lại mỗi phiên, nên mã canvas đổi sau mỗi lần mở profile (bình thường với Brave, nhưng web có thể coi là thiết bị lạ).

## Lưu ý khi làm việc với repo này

- Máy này chưa cấu hình tên / email cho git; các commit dùng `git -c user.name=anco123 -c user.email=52797701+anco123@users.noreply.github.com commit …`.
- Thử nghiệm mở Brave thật sẽ bật cửa sổ trên màn hình người dùng: hỏi trước, đừng mở đi mở lại.
