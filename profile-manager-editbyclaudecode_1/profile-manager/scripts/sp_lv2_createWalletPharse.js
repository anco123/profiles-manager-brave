/**
 * scripts/sp_lv2_createWalletPharse.js
 * -----------------------------------------------------------------------
 * Tạo cụm từ khôi phục (BIP-39, 12 hoặc 24 từ) cho ví EVM rồi ghi vào Excel.
 * Chạy ẩn hoàn toàn -- không mở trình duyệt/tab/extension nào, chỉ tính toán
 * trong Node (ethers v6, nguồn ngẫu nhiên crypto.randomBytes).
 *
 * Ô ghi = cột bạn truyền vào + dòng Excel CỦA PROFILE ĐANG CHẠY (row.__excelRow,
 * lấy từ `input` -- dòng phải được import từ Excel, gõ tay thì không có số dòng).
 * Ghi qua writeExcelCell.js -> data/excel-snapshot.json + data/excel-results.xlsx.
 *
 * AN TOÀN: ô đã có cụm từ thì KHÔNG ghi đè (chạy lại không làm mất ví cũ đang có
 * tiền) -- trả về luôn cụm từ cũ. Muốn tạo mới đè lên thì truyền { overwrite: true }.
 * Log chỉ in địa chỉ ví, KHÔNG in cụm từ / private key ra màn hình.
 *
 * Usage:
 *   const { sp_lv2_createWalletPharse } = require('./sp_lv2_createWalletPharse');
 *   const w = await sp_lv2_createWalletPharse(log, input, 'R', 12);   // 12 từ -> cột R
 *   const w = await sp_lv2_createWalletPharse(log, input, 'R', 24, { addressColumn: 'S', privateKeyColumn: 'T' });
 *   // w = { phrase, address, privateKey, excelRow, created }  (created=false nếu ô đã có sẵn)
 * -----------------------------------------------------------------------
 */
const { Mnemonic, HDNodeWallet, randomBytes } = require('ethers');

const EVM_PATH = "m/44'/60'/0'/0/0"; // đường dẫn mặc định của MetaMask/Phantom/OKX... -> import cụm từ vào ví nào cũng ra đúng địa chỉ này

function getExcelRow(input) {
  const row = typeof input === 'string' ? (input.trim() ? JSON.parse(input) : {}) : input;
  const n = typeof row === 'number' ? row : row && row.__excelRow;
  if (!Number.isInteger(n)) throw new Error('[sp_lv2_createWalletPharse] không có số dòng Excel (__excelRow) -- dòng phải được IMPORT từ Excel, không phải gõ tay.');
  return n;
}

function checkColumn(col, name) {
  if (col === undefined || col === null || col === '') return null;
  if (!/^[A-Za-z]{1,3}$/.test(String(col))) throw new Error(`[sp_lv2_createWalletPharse] ${name} phải là chữ cái cột Excel (VD 'R'), nhận được: ${col}`);
  return String(col).toUpperCase();
}

async function sp_lv2_createWalletPharse(log, input, column, words = 12, opts = {}) {
  const tag = '[sp_lv2_createWalletPharse]';
  const { writeExcelCell } = require('./writeExcelCell');
  const { readExcelCell } = require('./xlv1_readExcelCell');

  if (![12, 24].includes(Number(words))) throw new Error(`${tag} words phải là 12 hoặc 24, nhận được: ${words}`);
  const phraseCol = checkColumn(column, 'column');
  if (!phraseCol) throw new Error(`${tag} chưa truyền cột để lưu cụm từ`);
  const addressCol = checkColumn(opts.addressColumn, 'addressColumn'), keyCol = checkColumn(opts.privateKeyColumn, 'privateKeyColumn');
  const excelRow = getExcelRow(input);
  const cell = `${phraseCol}${excelRow}`;

  // Ô đã có cụm từ hợp lệ -> giữ nguyên, không tạo ví mới đè lên.
  const existing = String(readExcelCell(excelRow, phraseCol) ?? '').trim();
  if (existing && !opts.overwrite) {
    if (!Mnemonic.isValidMnemonic(existing)) throw new Error(`${tag} ô ${cell} đã có dữ liệu nhưng không phải cụm từ hợp lệ -- không ghi đè. Xoá ô đó hoặc truyền { overwrite: true }.`);
    const w = HDNodeWallet.fromPhrase(existing, '', EVM_PATH);
    log(`${tag} Ô ${cell} đã có cụm từ (${existing.split(/\s+/).length} từ) -- giữ nguyên, không tạo mới. Địa chỉ: ${w.address}`);
    return { phrase: existing, address: w.address, privateKey: w.privateKey, excelRow, created: false };
  }

  const phrase = Mnemonic.fromEntropy(randomBytes(Number(words) === 24 ? 32 : 16)).phrase; // 16 byte = 12 từ, 32 byte = 24 từ
  const w = HDNodeWallet.fromPhrase(phrase, '', EVM_PATH);

  await writeExcelCell(excelRow, phraseCol, phrase);
  if (addressCol) await writeExcelCell(excelRow, addressCol, w.address);
  if (keyCol) await writeExcelCell(excelRow, keyCol, w.privateKey);

  const saved = [`cụm từ -> ${cell}`, addressCol && `địa chỉ -> ${addressCol}${excelRow}`, keyCol && `private key -> ${keyCol}${excelRow}`].filter(Boolean).join(', ');
  log(`${tag} Đã tạo ví EVM ${words} từ, địa chỉ ${w.address}. Đã lưu: ${saved}.`);
  return { phrase, address: w.address, privateKey: w.privateKey, excelRow, created: true };
}

module.exports = { sp_lv2_createWalletPharse };
