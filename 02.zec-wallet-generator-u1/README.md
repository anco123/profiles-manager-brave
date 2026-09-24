# ZEC Unified + EVM Wallet Generator

Dự án Node.js chạy cục bộ, tạo mỗi dòng gồm:

- mnemonic BIP-39 24 từ hoặc 12 từ;
- Zcash Mainnet Unified Address `u1...` gồm **Orchard + Sapling**;
- Zcash Unified Full Viewing Key `uview1...`;
- địa chỉ EVM và private key EVM;
- tự động xuất toàn bộ kết quả ra file JSON.

## Yêu cầu

- Node.js 22 trở lên.
- Internet chỉ cần ở bước `npm install`. Khi chạy tạo ví, chương trình hoạt động offline.
- Không cần cài Rust; bộ Zcash WebAssembly đã nằm sẵn trong thư mục `vendor/zcash-wasm`.

## Cài đặt và chạy trên Windows

Mở CMD hoặc PowerShell tại thư mục dự án:

```bash
npm install
npm test
npm run generate
```

Chương trình sẽ hỏi:

```text
Mnemonic 12 hay 24 words? [24]:
So luong vi muon tao? [1]:
```

Nhấn Enter để dùng mặc định 24 từ và tạo 1 ví.

## File JSON đầu ra

Sau mỗi lần chạy thành công, chương trình tự tạo một file tại:

```text
output/wallets-YYYY-MM-DDTHH-MM-SS-mmmZ.json
```

File chứa thời gian tạo, tổng số ví, số từ mnemonic và toàn bộ thông tin
mnemonic/ZEC/EVM của từng ví. Tên file có timestamp nên lần chạy sau không
ghi đè kết quả của lần chạy trước.

Đường dẫn chính xác của file JSON cũng được in ở cuối Terminal.

## Loại địa chỉ Zcash

Địa chỉ xuất ra là Unified Address có hai receiver shielded:

```text
Orchard + Sapling
```

Đây không phải transparent address `t1...` và cũng không phải Orchard-only `u1...` ngắn. Địa chỉ đầy đủ thường dài; phải sao chép toàn bộ chuỗi, không được cắt phần cuối.

## Đường dẫn/account

Mỗi dòng sử dụng một mnemonic độc lập nên luôn bắt đầu từ:

```text
ZEC: ZIP-32 account 0
EVM: m/44'/60'/0'/0/0
```

## Lưu ý về khóa Zcash

Unified Address không có một private key đơn lẻ theo kiểu EVM. Mnemonic là bí mật chi tiêu gốc của tài khoản Zcash. `UFVK` chỉ dùng để xem nhưng có thể làm lộ toàn bộ lịch sử giao dịch, vì vậy cũng phải giữ kín.

## Bảo mật

- Chỉ chạy trên máy tin cậy, tốt nhất là máy offline.
- Không dán mnemonic/private key vào chat, email hoặc website.
- File JSON đầu ra chứa mnemonic và private key; không chia sẻ hoặc tải lên mạng.
- Không commit kết quả sinh ví lên Git.
- Luôn chạy `npm test` sau khi cài đặt hoặc chuyển máy.
- Với tài sản có giá trị, nên đối chiếu bằng ví Zcash uy tín trước khi nạp tiền.

## Thành phần Zcash

Phần ZIP-32/ZIP-316 dùng mã WebAssembly xây dựng từ WebZjs và `librustzcash`; giấy phép đi kèm trong `vendor/zcash-wasm`.
