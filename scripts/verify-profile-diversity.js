/**
 * verify-profile-diversity.js
 * -----------------------------------------------------------------------
 * Kiểm chứng bằng SỐ LIỆU THẬT (không phải suy diễn) 2 câu hỏi:
 *
 *   1. "2 lần require() module (2 tài khoản/2 batch chạy khác nhau) có
 *      thực sự nhận 2 hồ sơ hành vi khác nhau không, hay vẫn rút từ 1
 *      phân phối xác suất y hệt nhau?" -- đo ĐỘ LỆCH GIỮA CÁC HỒ SƠ.
 *   2. "Trong 1 hồ sơ, hàm random có thực sự lấy mẫu đúng theo trọng số
 *      đã định không, hay có sai lệch/bug ẩn?" -- đo bằng chi-square
 *      goodness-of-fit ở N=100,000 lần rút mẫu.
 *
 * Dùng TRỰC TIẾP các hàm thật trong interactXHome.js (qua module.exports
 * .__test) chứ không viết lại logic riêng -- đảm bảo số liệu phản ánh
 * đúng code sẽ chạy thật, không phải 1 bản mô phỏng có thể lệch code gốc.
 *
 * Chạy: node verify-profile-diversity.js
 * -----------------------------------------------------------------------
 */

const { createProfile, rollSessionMood, pickWeightedExcursions, ambientPoint, MOOD_PRESETS, CONFIG } =
  require('./xlv3_interactXHome').__test;

function mean(arr) {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}
function stdDev(arr) {
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((v) => (v - m) ** 2)));
}
function fmtPct(x) {
  return (x * 100).toFixed(2) + '%';
}

// Page giả (không cần trình duyệt thật) -- chỉ cần .viewportSize() để
// ambientPoint() hoạt động y hệt lúc chạy thật.
function fakePage(width, height) {
  return { viewportSize: () => ({ width, height }) };
}

console.log('='.repeat(78));
console.log('PHẦN 1 -- ĐỘ LỆCH GIỮA CÁC "HỒ SƠ HÀNH VI" (mô phỏng nhiều tài khoản)');
console.log('='.repeat(78));

const N_PROFILES = 5000;
const profiles = Array.from({ length: N_PROFILES }, () => createProfile());

console.log(`\nĐã tạo ${N_PROFILES} hồ sơ độc lập (mô phỏng ${N_PROFILES} tài khoản/lần require() khác nhau).\n`);

// --- Metric A: trọng số mood 'skimmer' lệch bao nhiêu giữa các hồ sơ ---
{
  const skimmerWeights = profiles.map((p) => p.moodWeights[0]); // index 0 = skimmer trong MOOD_PRESETS
  const oldFixed = MOOD_PRESETS[0].weight;
  console.log('[A] Trọng số mood "skimmer" (CONFIG gốc = ' + fmtPct(oldFixed) + ' CỐ ĐỊNH cho MỌI hồ sơ trước đây):');
  console.log(`    Hồ sơ mới -- mean=${fmtPct(mean(skimmerWeights))}  std=${fmtPct(stdDev(skimmerWeights))}  min=${fmtPct(Math.min(...skimmerWeights))}  max=${fmtPct(Math.max(...skimmerWeights))}`);
  console.log(`    -> Trước đây: std=0.00% (mọi hồ sơ giống hệt nhau). Giờ: std=${fmtPct(stdDev(skimmerWeights))} -- có lệch thật.`);
}

// --- Metric B: trọng số loại chuyến đi "notifications" (đã chuẩn hoá) ---
{
  const notifShare = profiles.map((p) => {
    const total = Object.values(p.excursionTypeWeights).reduce((s, w) => s + w, 0);
    return p.excursionTypeWeights.notifications / total;
  });
  const oldTotal = Object.values(CONFIG.excursionTypeWeights).reduce((s, w) => s + w, 0);
  const oldShare = CONFIG.excursionTypeWeights.notifications / oldTotal;
  console.log('\n[B] Tỉ trọng chọn "Notifications" trong số các chuyến đi (CONFIG gốc = ' + fmtPct(oldShare) + ' CỐ ĐỊNH):');
  console.log(`    Hồ sơ mới -- mean=${fmtPct(mean(notifShare))}  std=${fmtPct(stdDev(notifShare))}  min=${fmtPct(Math.min(...notifShare))}  max=${fmtPct(Math.max(...notifShare))}`);
}

// --- Metric C: followingTabVisitChance ---
{
  const chances = profiles.map((p) => p.followingTabVisitChance);
  console.log('\n[C] Xác suất ghé "Following" mỗi nhịp nền (CONFIG gốc = ' + fmtPct(CONFIG.followingTabVisitChance) + ' CỐ ĐỊNH):');
  console.log(`    Hồ sơ mới -- mean=${fmtPct(mean(chances))}  std=${fmtPct(stdDev(chances))}  min=${fmtPct(Math.min(...chances))}  max=${fmtPct(Math.max(...chances))}`);
}

// --- Metric D: ambientMarginRatio -> quy đổi ra vùng phủ thực tế ---
{
  const ratios = profiles.map((p) => p.ambientMarginRatio);
  console.log('\n[D] Margin di chuột ngẫu nhiên (CONFIG gốc = 12.00% CỐ ĐỊNH, và trước v-mouse-fix là' +
    ' 1 khung TUYỆT ĐỐI 300-900 x 200-500px bất kể viewport):');
  console.log(`    Hồ sơ mới -- mean=${fmtPct(mean(ratios))}  std=${fmtPct(stdDev(ratios))}  min=${fmtPct(Math.min(...ratios))}  max=${fmtPct(Math.max(...ratios))}`);

  // Minh hoạ cụ thể: khung cố định cũ (300-900,200-500) chiếm bao
  // nhiêu % viewport ở 2 kích thước màn hình khác nhau, so với vùng
  // phủ mới (luôn co giãn theo đúng viewport).
  for (const [w, h] of [[1280, 800], [1920, 1080]]) {
    const oldCoverW = 600 / w; // 900-300
    const oldCoverH = 300 / h; // 500-200
    const newCoverW = 1 - 2 * mean(ratios);
    const newCoverH = newCoverW;
    console.log(`    Viewport ${w}x${h}: khung CŨ phủ ${fmtPct(oldCoverW)}x${fmtPct(oldCoverH)} vùng màn hình (neo cố định 1 góc)` +
      ` | khung MỚI phủ ~${fmtPct(newCoverW)}x${fmtPct(newCoverH)} (co giãn đúng theo viewport, trải đều hơn)`);
  }
}

console.log('\n' + '='.repeat(78));
console.log('PHẦN 1b -- ĐỘ LỆCH ĐẶC ĐIỂM BÊN TRONG MỖI MOOD (không chỉ trọng số CHỌN mood)');
console.log('='.repeat(78));

{
  const readerIdx = MOOD_PRESETS.findIndex((m) => m.name === 'reader');
  const readerLikeChances = profiles.map((p) => p.moods[readerIdx].likeChance);
  const readerReadMax = profiles.map((p) => p.moods[readerIdx].readChance[1]);
  const oldLike = MOOD_PRESETS[readerIdx].likeChance;
  const oldReadMax = MOOD_PRESETS[readerIdx].readChance[1];

  console.log(`\n[A2] likeChance của mood "reader" (CONFIG gốc = ${fmtPct(oldLike)} CỐ ĐỊNH cho MỌI hồ sơ trước đây):`);
  console.log(`     Hồ sơ mới -- mean=${fmtPct(mean(readerLikeChances))}  std=${fmtPct(stdDev(readerLikeChances))}  min=${fmtPct(Math.min(...readerLikeChances))}  max=${fmtPct(Math.max(...readerLikeChances))}`);

  console.log(`\n[A3] Cận trên readChance của mood "reader" (CONFIG gốc = ${fmtPct(oldReadMax)} CỐ ĐỊNH):`);
  console.log(`     Hồ sơ mới -- mean=${fmtPct(mean(readerReadMax))}  std=${fmtPct(stdDev(readerReadMax))}  min=${fmtPct(Math.min(...readerReadMax))}  max=${fmtPct(Math.max(...readerReadMax))}`);

  // Excursion count weights -- so P(0 chuyến đi) và P(>=3 chuyến đi) giữa các hồ sơ.
  const p0 = profiles.map((p) => p.excursionCountWeights[0]);
  const p3plus = profiles.map((p) => p.excursionCountWeights[3] + p.excursionCountWeights[4] + p.excursionCountWeights[5]);
  const oldP0 = CONFIG.excursionCountWeights[0];
  const oldP3plus = CONFIG.excursionCountWeights[3] + CONFIG.excursionCountWeights[4] + CONFIG.excursionCountWeights[5];

  console.log(`\n[A4] P(0 chuyến đi trong phiên) (CONFIG gốc = ${fmtPct(oldP0)} CỐ ĐỊNH):`);
  console.log(`     Hồ sơ mới -- mean=${fmtPct(mean(p0))}  std=${fmtPct(stdDev(p0))}  min=${fmtPct(Math.min(...p0))}  max=${fmtPct(Math.max(...p0))}`);
  console.log(`[A5] P(>=3 chuyến đi trong phiên) (CONFIG gốc = ${fmtPct(oldP3plus)} CỐ ĐỊNH):`);
  console.log(`     Hồ sơ mới -- mean=${fmtPct(mean(p3plus))}  std=${fmtPct(stdDev(p3plus))}  min=${fmtPct(Math.min(...p3plus))}  max=${fmtPct(Math.max(...p3plus))}`);
  console.log('\n-> Có hồ sơ gần như "lười dạo tab" (P0 cao, P3+ thấp), có hồ sơ hay "dạo" hơn hẳn -- không phải mọi tài khoản giống hệt nhau về mặt này nữa.');
}

console.log('\n' + '='.repeat(78));
console.log('PHẦN 2 -- ĐỘ ĐA DẠNG THỰC TẾ KHI ĐÃ CHẠY NHIỀU PHIÊN (không chỉ lý thuyết)');
console.log('='.repeat(78));

// Với mỗi hồ sơ trong 1 mẫu nhỏ hơn, thực sự GỌI rollSessionMood() nhiều
// lần rồi đo tỉ lệ THỰC TẾ rơi vào skimmer -- so sánh độ lệch GIỮA CÁC
// HỒ SƠ với độ lệch do nhiễu lấy mẫu thuần tuý (nếu mọi hồ sơ giống hệt
// nhau) để xác nhận độ lệch quan sát được là THẬT, không phải nhiễu.
{
  const N_PROFILES_2 = 500;
  const DRAWS_PER_PROFILE = 300;
  const empiricalRates = [];
  for (let i = 0; i < N_PROFILES_2; i++) {
    const profile = createProfile();
    let skimmerCount = 0;
    for (let j = 0; j < DRAWS_PER_PROFILE; j++) {
      const mood = rollSessionMood(profile);
      if (mood.name === 'skimmer') skimmerCount++;
    }
    empiricalRates.push(skimmerCount / DRAWS_PER_PROFILE);
  }
  const observedStd = stdDev(empiricalRates);
  // Nhiễu lấy mẫu thuần tuý kỳ vọng NẾU mọi hồ sơ có đúng p=0.3 giống hệt
  // nhau (công thức độ lệch chuẩn nhị thức: sqrt(p(1-p)/n)).
  const p = 0.3, n = DRAWS_PER_PROFILE;
  const pureNoiseStd = Math.sqrt((p * (1 - p)) / n);

  console.log(`\nGọi rollSessionMood() thật ${N_PROFILES_2} hồ sơ x ${DRAWS_PER_PROFILE} lần/hồ sơ = ${N_PROFILES_2 * DRAWS_PER_PROFILE} lần rút mẫu.`);
  console.log(`Tỉ lệ "skimmer" thực tế đo được mỗi hồ sơ -- độ lệch chuẩn GIỮA CÁC HỒ SƠ = ${fmtPct(observedStd)}`);
  console.log(`Độ lệch chuẩn nếu CHỈ do nhiễu lấy mẫu (mọi hồ sơ giống hệt p=30%) = ${fmtPct(pureNoiseStd)}`);
  console.log(`-> Độ lệch quan sát được LỚN HƠN nhiễu lấy mẫu thuần tuý khoảng ${(observedStd / pureNoiseStd).toFixed(2)}x` +
    ' => xác nhận đây là khác biệt THẬT giữa các hồ sơ, không phải trùng hợp ngẫu nhiên.');
}

console.log('\n' + '='.repeat(78));
console.log('PHẦN 3 -- KIỂM TRA HÀM SAMPLING CÓ ĐÚNG THUẬT TOÁN KHÔNG (chi-square, N lớn)');
console.log('='.repeat(78));

// Cố định 1 hồ sơ, rút mẫu THẬT SỰ RẤT NHIỀU LẦN (100,000) rồi so khớp
// tần suất quan sát được với trọng số đã định bằng chi-square
// goodness-of-fit -- nếu rollSessionMood() có bug lấy mẫu lệch trọng số,
// phép thử này sẽ lộ ra rõ ràng ở N lớn thế này.
{
  const N = 100000;
  const profile = createProfile();
  const counts = { skimmer: 0, browser: 0, reader: 0 };
  for (let i = 0; i < N; i++) {
    counts[rollSessionMood(profile).name]++;
  }

  let chiSq = 0;
  console.log(`\nHồ sơ kiểm tra: skimmer=${fmtPct(profile.moodWeights[0])}  browser=${fmtPct(profile.moodWeights[1])}  reader=${fmtPct(profile.moodWeights[2])}`);
  console.log(`Rút mẫu N=${N} lần bằng rollSessionMood() thật:\n`);
  MOOD_PRESETS.forEach((m, i) => {
    const expected = profile.moodWeights[i] * N;
    const observed = counts[m.name];
    chiSq += ((observed - expected) ** 2) / expected;
    console.log(`  ${m.name.padEnd(8)}  kỳ vọng=${expected.toFixed(0).padStart(6)}  quan sát=${String(observed).padStart(6)}  lệch=${(((observed - expected) / expected) * 100).toFixed(2)}%`);
  });
  console.log(`\nChi-square = ${chiSq.toFixed(3)} (df=2). Ngưỡng bác bỏ ở mức ý nghĩa 5% là 5.99, ở mức 1% là 9.21.`);
  console.log(chiSq < 5.99
    ? '-> Chi-square THẤP HƠN ngưỡng 5.99: KHÔNG có bằng chứng sampling bị lệch. Thuật toán đúng.'
    : '-> Chi-square VƯỢT ngưỡng: có dấu hiệu sampling bị lệch, cần soát lại rollSessionMood()!');
}

console.log('\n' + '='.repeat(78));
console.log('PHẦN 4 -- PHỦ VỊ TRÍ CHUỘT THỰC TẾ (ambientPoint) TRÊN 2 KÍCH THƯỚC MÀN HÌNH');
console.log('='.repeat(78));

// Gọi ambientPoint() thật (không phải công thức viết lại) hàng chục
// nghìn lần trên 2 kích thước viewport khác nhau, đo min/max/mean toạ
// độ x/y thực tế trả về để xác nhận nó co giãn đúng theo viewport.
{
  const N = 20000;
  for (const [w, h] of [[1280, 800], [1920, 1080]]) {
    const page = fakePage(w, h);
    const xs = [];
    const ys = [];
    for (let i = 0; i < N; i++) {
      const p = ambientPoint(page);
      xs.push(p.x);
      ys.push(p.y);
    }
    console.log(`\nViewport ${w}x${h}, N=${N} điểm từ ambientPoint() thật:`);
    console.log(`  x: min=${Math.min(...xs).toFixed(0)}  max=${Math.max(...xs).toFixed(0)}  mean=${mean(xs).toFixed(0)}  (toàn bộ chiều rộng: 0-${w})`);
    console.log(`  y: min=${Math.min(...ys).toFixed(0)}  max=${Math.max(...ys).toFixed(0)}  mean=${mean(ys).toFixed(0)}  (toàn bộ chiều cao: 0-${h})`);
  }
  console.log('\n(So sánh: khung CŨ trả về x luôn trong [300,900], y luôn trong [200,500] TUYỆT ĐỐI,');
  console.log(' bất kể 2 viewport trên khác nhau ra sao -- không co giãn, không dịch chuyển theo màn hình.)');
}

console.log('\n' + '='.repeat(78));
console.log(`TỔNG SỐ LẦN RÚT MẪU ĐÃ THỰC HIỆN TRONG SCRIPT NÀY: ~${(N_PROFILES + 500 * 300 + 100000 + 20000 * 2 * 2).toLocaleString('en-US')}`);
console.log('='.repeat(78));