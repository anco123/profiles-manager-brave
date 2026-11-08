const os = require('os');

// Tiny public-domain seeded PRNG (mulberry32). Deterministic: same seed
// in -> same sequence out, every time. No dependency worth adding for 8 lines.
function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStringToInt(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
  }
  return h;
}

function extractMajorVersionFromUA(ua) {
  const match = String(ua || '').match(/Chrome\/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

const GENERIC_WEBGL_EXTENSIONS = [
  'ANGLE_instanced_arrays', 'EXT_blend_minmax', 'EXT_color_buffer_half_float',
  'EXT_disjoint_timer_query', 'EXT_float_blend', 'EXT_frag_depth',
  'EXT_shader_texture_lod', 'EXT_texture_compression_bptc', 'EXT_texture_compression_rgtc',
  'EXT_texture_filter_anisotropic', 'EXT_sRGB', 'KHR_parallel_shader_compile',
  'OES_element_index_uint', 'OES_fbo_render_mipmap', 'OES_standard_derivatives',
  'OES_texture_float', 'OES_texture_float_linear', 'OES_texture_half_float',
  'OES_texture_half_float_linear', 'OES_vertex_array_object', 'WEBGL_color_buffer_float',
  'WEBGL_compressed_texture_s3tc', 'WEBGL_compressed_texture_s3tc_srgb',
  'WEBGL_debug_renderer_info', 'WEBGL_debug_shaders', 'WEBGL_depth_texture',
  'WEBGL_draw_buffers', 'WEBGL_lose_context', 'WEBGL_multi_draw',
];

const STANDARD_SCREEN_RESOLUTIONS = [
  { width: 1366, height: 768, platforms: ['win32', 'linux'] },
  { width: 1440, height: 900, platforms: ['darwin'] },
  { width: 1536, height: 864, platforms: ['win32'] },
  { width: 1600, height: 900, platforms: ['win32', 'linux'] },
  { width: 1920, height: 1080, platforms: ['win32', 'linux'] },
  { width: 1920, height: 1200, platforms: ['win32', 'linux'] },
  { width: 2560, height: 1080, platforms: ['win32', 'linux'] },
  { width: 2560, height: 1440, platforms: ['win32', 'linux'] },
  { width: 2560, height: 1600, platforms: ['darwin'] },
  { width: 3440, height: 1440, platforms: ['win32', 'linux'] },
  { width: 3840, height: 2160, platforms: ['win32', 'linux', 'darwin'] },
];

function screenForViewport(viewportWidth, viewportHeight, seed, hostPlatform) {
  const platform = hostPlatform || os.platform();
  const rand = mulberry32(hashStringToInt(String(seed)));
  const candidates = STANDARD_SCREEN_RESOLUTIONS.filter(
    (r) => r.width >= viewportWidth && r.height > viewportHeight && r.platforms.includes(platform)
  );
  if (!candidates.length) {
    return { width: viewportWidth, height: viewportHeight + 120 + Math.floor(rand() * 100) };
  }
  candidates.sort((a, b) => a.width * a.height - b.width * b.height);
  const weights = candidates.map((_, i) => candidates.length - i); // smaller = heavier weight
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rand() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

function plausibleViewportWidths(hostPlatform) {
  const platform = hostPlatform || os.platform();
  const widths = new Set();
  for (const r of STANDARD_SCREEN_RESOLUTIONS) {
    if (!r.platforms.includes(platform)) continue;
    widths.add(r.width);
    widths.add(r.width / 2); // every width here is even, so this is always a clean integer
  }
  return [...widths].sort((a, b) => a - b);
}

function plausibleViewport(targetWidth, targetHeight, seed, hostPlatform) {
  const rand = mulberry32(hashStringToInt(String(seed)));
  const widths = plausibleViewportWidths(hostPlatform);

  const scored = widths.map((w) => ({ w, dist: Math.abs(w - targetWidth) }));
  scored.sort((a, b) => a.dist - b.dist);
  const nearest = scored.slice(0, 4); // the 4 closest plausible options
  const weights = nearest.map((_, i) => nearest.length - i); // closest = heaviest
  const total = weights.reduce((s, x) => s + x, 0);
  let r = rand() * total;
  let chosenWidth = nearest[0].w; // fallback: closest match, not farthest -- only hit on float-rounding edge cases
  for (let i = 0; i < nearest.length; i++) {
    r -= weights[i];
    if (r <= 0) { chosenWidth = nearest[i].w; break; }
  }

  const platform = hostPlatform || os.platform();
  const matchingRes = STANDARD_SCREEN_RESOLUTIONS.find((res) => res.width === chosenWidth && res.platforms.includes(platform));
  const fullHeight = matchingRes ? matchingRes.height : Math.round(chosenWidth * 9 / 16);
  const CHROME_DEDUCTIONS = [117, 133, 149]; // a few real taskbar + browser-chrome combinations (different zoom/DPI)
  const deduction = CHROME_DEDUCTIONS[Math.floor(rand() * CHROME_DEDUCTIONS.length)];
  const chosenHeight = Math.max(480, fullHeight - deduction);

  return { width: chosenWidth, height: chosenHeight };
}

// -------------------------------------------------------------------
// KHO LINH KIỆN -- thay vì mỗi "preset" là 1 khối GPU+CPU+RAM+font dính
// chặt cứng nhắc (bản cũ chỉ có 10 khối, dễ trùng lặp ở quy mô lớn),
// tách thành các kho ĐỘC LẬP rồi ghép ngẫu nhiên lại. Vẫn giữ tính hợp
// lý (không ghép GPU tầm thấp với RAM 32GB) bằng cách mỗi GPU tự khai
// coreOptions/memoryOptions PHÙ HỢP với tầm của nó -- không có 1 kho
// CPU/RAM chung áp dụng mù cho mọi GPU.
//
// Với ~36 GPU (mỗi cái ~2 lựa chọn core, ~2 lựa chọn RAM) x ~3 mức độ
// nét màn hình x ~2-3 biến thể font -- ra được hàng NGHÌN tổ hợp khác
// nhau, thay vì chỉ 10 khối cố định như trước.
// -------------------------------------------------------------------
const GPU_POOL = [
  // ---------------- win32 -- tích hợp, đời cũ/tầm thấp ----------------
  { hostPlatform: 'win32', label: 'Intel UHD 620 (tich hop)', webglVendor: 'Google Inc. (Intel)', webglRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [2, 4], memoryOptions: [4, 8], weight: 10 },
  { hostPlatform: 'win32', label: 'Intel UHD 630 (tich hop)', webglVendor: 'Google Inc. (Intel)', webglRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E92) Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [4, 6], memoryOptions: [8, 16], weight: 9 },
  { hostPlatform: 'win32', label: 'Intel HD 520 (tich hop, doi cu)', webglVendor: 'Google Inc. (Intel)', webglRenderer: 'ANGLE (Intel, Intel(R) HD Graphics 520 (0x00001916) Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [2, 4], memoryOptions: [4, 8], weight: 5 },
  { hostPlatform: 'win32', label: 'Intel HD 4600 (tich hop, doi rat cu)', webglVendor: 'Google Inc. (Intel)', webglRenderer: 'ANGLE (Intel, Intel(R) HD Graphics 4600 (0x00000412) Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [2, 4], memoryOptions: [4, 8], weight: 4 },
  { hostPlatform: 'win32', label: 'Intel HD 5500 (tich hop, doi cu)', webglVendor: 'Google Inc. (Intel)', webglRenderer: 'ANGLE (Intel, Intel(R) HD Graphics 5500 (0x00001616) Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [2, 4], memoryOptions: [4, 8], weight: 5 },
  { hostPlatform: 'win32', label: 'Intel UHD 610 (tich hop)', webglVendor: 'Google Inc. (Intel)', webglRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 610 (0x00003185) Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [2, 4], memoryOptions: [4, 8], weight: 5 },
  { hostPlatform: 'win32', label: 'Intel UHD 605 (tich hop)', webglVendor: 'Google Inc. (Intel)', webglRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 605 (0x00004617) Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [2, 4], memoryOptions: [4, 8], weight: 4 },
  { hostPlatform: 'win32', label: 'AMD Radeon Vega 8 (tich hop)', webglVendor: 'Google Inc. (AMD)', webglRenderer: 'ANGLE (AMD, AMD Radeon(TM) Vega 8 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [4, 6], memoryOptions: [8, 16], weight: 6 },
  { hostPlatform: 'win32', label: 'AMD Radeon R5 Graphics (tich hop, doi cu)', webglVendor: 'Google Inc. (AMD)', webglRenderer: 'ANGLE (AMD, AMD Radeon(TM) R5 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [2, 4], memoryOptions: [4, 8], weight: 4 },
  { hostPlatform: 'win32', label: 'AMD Radeon RX Vega 11 (tich hop)', webglVendor: 'Google Inc. (AMD)', webglRenderer: 'ANGLE (AMD, AMD Radeon(TM) RX Vega 11 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [4, 6], memoryOptions: [8, 16], weight: 5 },
  // ---------------- win32 -- tích hợp, đời mới ----------------
  { hostPlatform: 'win32', label: 'Intel Iris Xe Graphics (tich hop)', webglVendor: 'Google Inc. (Intel)', webglRenderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [4, 8], memoryOptions: [8, 16], weight: 11 },
  { hostPlatform: 'win32', label: 'Intel UHD 730 (tich hop)', webglVendor: 'Google Inc. (Intel)', webglRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 730 (0x00004692) Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [6, 8], memoryOptions: [8, 16], weight: 6 },
  { hostPlatform: 'win32', label: 'Intel Arc Graphics (tich hop, Core Ultra)', webglVendor: 'Google Inc. (Intel)', webglRenderer: 'ANGLE (Intel, Intel(R) Arc(TM) Graphics (0x00007D55) Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [8, 12], memoryOptions: [16, 32], weight: 4 },
  { hostPlatform: 'win32', label: 'AMD Radeon 780M (tich hop, doi moi)', webglVendor: 'Google Inc. (AMD)', webglRenderer: 'ANGLE (AMD, AMD Radeon(TM) 780M Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [6, 8], memoryOptions: [16], weight: 5 },
  { hostPlatform: 'win32', label: 'AMD Radeon 660M (tich hop, doi moi)', webglVendor: 'Google Inc. (AMD)', webglRenderer: 'ANGLE (AMD, AMD Radeon(TM) 660M Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [6, 8], memoryOptions: [8, 16], weight: 4 },
  { hostPlatform: 'win32', label: 'AMD Radeon 610M (tich hop, doi moi)', webglVendor: 'Google Inc. (AMD)', webglRenderer: 'ANGLE (AMD, AMD Radeon(TM) 610M Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [4, 6], memoryOptions: [8, 16], weight: 4 },
  // ---------------- win32 -- rời NVIDIA, tầm thấp/phổ thông ----------------
  { hostPlatform: 'win32', label: 'NVIDIA GTX 950 (roi, doi cu)', webglVendor: 'Google Inc. (NVIDIA)', webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 950 Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [4, 6], memoryOptions: [8], weight: 3 },
  { hostPlatform: 'win32', label: 'NVIDIA GTX 1050 (roi)', webglVendor: 'Google Inc. (NVIDIA)', webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [4, 6], memoryOptions: [8], weight: 6 },
  { hostPlatform: 'win32', label: 'NVIDIA GTX 1050 Ti (roi)', webglVendor: 'Google Inc. (NVIDIA)', webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [4, 6], memoryOptions: [8, 16], weight: 7 },
  { hostPlatform: 'win32', label: 'NVIDIA GTX 1060 (roi)', webglVendor: 'Google Inc. (NVIDIA)', webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [4, 8], memoryOptions: [8, 16], weight: 8 },
  { hostPlatform: 'win32', label: 'NVIDIA GTX 1650 (roi)', webglVendor: 'Google Inc. (NVIDIA)', webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [4, 6], memoryOptions: [8, 16], weight: 8 },
  { hostPlatform: 'win32', label: 'NVIDIA MX150 (laptop, entry-level)', webglVendor: 'Google Inc. (NVIDIA)', webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce MX150 Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [4], memoryOptions: [8], weight: 4 },
  { hostPlatform: 'win32', label: 'NVIDIA MX450 (laptop, entry-level)', webglVendor: 'Google Inc. (NVIDIA)', webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce MX450 Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [4, 6], memoryOptions: [8, 16], weight: 4 },
  { hostPlatform: 'win32', label: 'NVIDIA GTX 1660 (roi)', webglVendor: 'Google Inc. (NVIDIA)', webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [6, 8], memoryOptions: [8, 16], weight: 9 },
  // ---------------- win32 -- rời AMD, tầm thấp/phổ thông ----------------
  { hostPlatform: 'win32', label: 'AMD RX 470 (roi, doi cu)', webglVendor: 'Google Inc. (AMD)', webglRenderer: 'ANGLE (AMD, AMD Radeon(TM) RX 470 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [4, 6], memoryOptions: [8], weight: 3 },
  { hostPlatform: 'win32', label: 'AMD RX 570 (roi)', webglVendor: 'Google Inc. (AMD)', webglRenderer: 'ANGLE (AMD, AMD Radeon(TM) RX 570 Series Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [4, 6], memoryOptions: [8, 16], weight: 5 },
  { hostPlatform: 'win32', label: 'AMD RX 580 (roi)', webglVendor: 'Google Inc. (AMD)', webglRenderer: 'ANGLE (AMD, AMD Radeon RX 580 Series Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [6, 8], memoryOptions: [8, 16], weight: 6 },
  { hostPlatform: 'win32', label: 'AMD RX 5500 XT (roi)', webglVendor: 'Google Inc. (AMD)', webglRenderer: 'ANGLE (AMD, AMD Radeon RX 5500 XT Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [6, 8], memoryOptions: [8, 16], weight: 5 },
  { hostPlatform: 'win32', label: 'AMD RX 6500 XT (roi)', webglVendor: 'Google Inc. (AMD)', webglRenderer: 'ANGLE (AMD, AMD Radeon RX 6500 XT Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [6, 8], memoryOptions: [16], weight: 5 },
  // ---------------- win32 -- rời, tầm trung ----------------
  { hostPlatform: 'win32', label: 'NVIDIA GTX 1070 (roi)', webglVendor: 'Google Inc. (NVIDIA)', webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1070 Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [6, 8], memoryOptions: [16], weight: 5 },
  { hostPlatform: 'win32', label: 'NVIDIA GTX 1080 (roi)', webglVendor: 'Google Inc. (NVIDIA)', webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [8, 12], memoryOptions: [16], weight: 4 },
  { hostPlatform: 'win32', label: 'NVIDIA RTX 2060 (roi)', webglVendor: 'Google Inc. (NVIDIA)', webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [6, 8], memoryOptions: [16], weight: 8 },
  { hostPlatform: 'win32', label: 'NVIDIA RTX 2070 (roi)', webglVendor: 'Google Inc. (NVIDIA)', webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 2070 Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [8, 12], memoryOptions: [16], weight: 6 },
  { hostPlatform: 'win32', label: 'NVIDIA RTX 3050 (roi)', webglVendor: 'Google Inc. (NVIDIA)', webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [6, 8], memoryOptions: [16], weight: 7 },
  { hostPlatform: 'win32', label: 'NVIDIA RTX 3060 (roi)', webglVendor: 'Google Inc. (NVIDIA)', webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [8, 12], memoryOptions: [16], weight: 11 },
  { hostPlatform: 'win32', label: 'AMD RX 5600 XT (roi)', webglVendor: 'Google Inc. (AMD)', webglRenderer: 'ANGLE (AMD, AMD Radeon RX 5600 XT Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [6, 8], memoryOptions: [16], weight: 5 },
  { hostPlatform: 'win32', label: 'AMD RX 5700 XT (roi)', webglVendor: 'Google Inc. (AMD)', webglRenderer: 'ANGLE (AMD, AMD Radeon RX 5700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [8, 12], memoryOptions: [16], weight: 5 },
  { hostPlatform: 'win32', label: 'AMD RX 6600 (roi)', webglVendor: 'Google Inc. (AMD)', webglRenderer: 'ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [8, 12], memoryOptions: [16], weight: 6 },
  { hostPlatform: 'win32', label: 'AMD RX 6700 XT (roi)', webglVendor: 'Google Inc. (AMD)', webglRenderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [8, 12], memoryOptions: [16, 32], weight: 5 },
  // ---------------- win32 -- rời, tầm cao ----------------
  { hostPlatform: 'win32', label: 'NVIDIA RTX 2080 (roi, cao cap)', webglVendor: 'Google Inc. (NVIDIA)', webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 2080 Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [8, 12], memoryOptions: [16, 32], weight: 3 },
  { hostPlatform: 'win32', label: 'NVIDIA RTX 3070 (roi, cao cap)', webglVendor: 'Google Inc. (NVIDIA)', webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [8, 12], memoryOptions: [16, 32], weight: 6 },
  { hostPlatform: 'win32', label: 'NVIDIA RTX 3080 (roi, cao cap)', webglVendor: 'Google Inc. (NVIDIA)', webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [12, 16], memoryOptions: [16, 32], weight: 4 },
  { hostPlatform: 'win32', label: 'NVIDIA RTX 3090 (roi, cao cap)', webglVendor: 'Google Inc. (NVIDIA)', webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3090 Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [12, 16], memoryOptions: [32], weight: 2 },
  { hostPlatform: 'win32', label: 'NVIDIA RTX 4060 (roi, cao cap)', webglVendor: 'Google Inc. (NVIDIA)', webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [8, 12], memoryOptions: [16, 32], weight: 6 },
  { hostPlatform: 'win32', label: 'NVIDIA RTX 4060 Ti (roi, cao cap)', webglVendor: 'Google Inc. (NVIDIA)', webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [8, 12], memoryOptions: [16, 32], weight: 5 },
  { hostPlatform: 'win32', label: 'NVIDIA RTX 4070 (roi, cao cap)', webglVendor: 'Google Inc. (NVIDIA)', webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [8, 16], memoryOptions: [16, 32], weight: 5 },
  { hostPlatform: 'win32', label: 'NVIDIA RTX 4080 (roi, cao cap)', webglVendor: 'Google Inc. (NVIDIA)', webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [12, 16], memoryOptions: [32], weight: 3 },
  { hostPlatform: 'win32', label: 'NVIDIA RTX 4090 (roi, cao cap nhat)', webglVendor: 'Google Inc. (NVIDIA)', webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [16, 24], memoryOptions: [32, 64], weight: 2 },
  { hostPlatform: 'win32', label: 'AMD RX 6800 XT (roi, cao cap)', webglVendor: 'Google Inc. (AMD)', webglRenderer: 'ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [12, 16], memoryOptions: [32], weight: 3 },
  { hostPlatform: 'win32', label: 'AMD RX 6900 XT (roi, cao cap)', webglVendor: 'Google Inc. (AMD)', webglRenderer: 'ANGLE (AMD, AMD Radeon RX 6900 XT Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [12, 16], memoryOptions: [32], weight: 2 },
  { hostPlatform: 'win32', label: 'AMD RX 7600 (roi, cao cap)', webglVendor: 'Google Inc. (AMD)', webglRenderer: 'ANGLE (AMD, AMD Radeon RX 7600 Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [8, 12], memoryOptions: [16, 32], weight: 5 },
  { hostPlatform: 'win32', label: 'AMD RX 7800 XT (roi, cao cap)', webglVendor: 'Google Inc. (AMD)', webglRenderer: 'ANGLE (AMD, AMD Radeon RX 7800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)', coreOptions: [12, 16], memoryOptions: [32], weight: 3 },

  // ---------------- darwin -- Apple Silicon ----------------
  { hostPlatform: 'darwin', label: 'Apple M1', webglVendor: 'Google Inc. (Apple)', webglRenderer: 'ANGLE (Apple, Apple M1, OpenGL 4.1)', coreOptions: [8], memoryOptions: [8, 16], weight: 20 },
  { hostPlatform: 'darwin', label: 'Apple M1 Pro', webglVendor: 'Google Inc. (Apple)', webglRenderer: 'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)', coreOptions: [10], memoryOptions: [16, 32], weight: 10 },
  { hostPlatform: 'darwin', label: 'Apple M1 Max', webglVendor: 'Google Inc. (Apple)', webglRenderer: 'ANGLE (Apple, Apple M1 Max, OpenGL 4.1)', coreOptions: [10], memoryOptions: [32, 64], weight: 5 },
  { hostPlatform: 'darwin', label: 'Apple M2', webglVendor: 'Google Inc. (Apple)', webglRenderer: 'ANGLE (Apple, Apple M2, OpenGL 4.1)', coreOptions: [8], memoryOptions: [8, 16, 24], weight: 18 },
  { hostPlatform: 'darwin', label: 'Apple M2 Pro', webglVendor: 'Google Inc. (Apple)', webglRenderer: 'ANGLE (Apple, Apple M2 Pro, OpenGL 4.1)', coreOptions: [12], memoryOptions: [16, 32], weight: 8 },
  { hostPlatform: 'darwin', label: 'Apple M2 Max', webglVendor: 'Google Inc. (Apple)', webglRenderer: 'ANGLE (Apple, Apple M2 Max, OpenGL 4.1)', coreOptions: [12], memoryOptions: [32, 64], weight: 4 },
  { hostPlatform: 'darwin', label: 'Apple M3', webglVendor: 'Google Inc. (Apple)', webglRenderer: 'ANGLE (Apple, Apple M3, OpenGL 4.1)', coreOptions: [8], memoryOptions: [8, 16, 24], weight: 15 },
  { hostPlatform: 'darwin', label: 'Apple M3 Pro', webglVendor: 'Google Inc. (Apple)', webglRenderer: 'ANGLE (Apple, Apple M3 Pro, OpenGL 4.1)', coreOptions: [12], memoryOptions: [18, 36], weight: 6 },
  { hostPlatform: 'darwin', label: 'Apple M4', webglVendor: 'Google Inc. (Apple)', webglRenderer: 'ANGLE (Apple, Apple M4, OpenGL 4.1)', coreOptions: [10], memoryOptions: [16, 24], weight: 10 },
  // ---------------- darwin -- Mac Intel (doi cu hon) ----------------
  { hostPlatform: 'darwin', label: 'Intel HD 4000 (Mac Intel, doi rat cu)', webglVendor: 'Google Inc. (Intel)', webglRenderer: 'ANGLE (Intel, Intel(R) HD Graphics 4000, OpenGL 4.1)', coreOptions: [2, 4], memoryOptions: [4, 8], weight: 3 },
  { hostPlatform: 'darwin', label: 'Intel Iris Pro 5200 (Mac Intel)', webglVendor: 'Google Inc. (Intel)', webglRenderer: 'ANGLE (Intel, Intel(R) Iris(TM) Pro Graphics 5200, OpenGL 4.1)', coreOptions: [4], memoryOptions: [8, 16], weight: 4 },
  { hostPlatform: 'darwin', label: 'Intel UHD 630 (Mac Intel)', webglVendor: 'Google Inc. (Intel)', webglRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.1)', coreOptions: [4, 8], memoryOptions: [8, 16], weight: 8 },
  { hostPlatform: 'darwin', label: 'Intel Iris Plus 655 (Mac Intel)', webglVendor: 'Google Inc. (Intel)', webglRenderer: 'ANGLE (Intel, Intel(R) Iris(R) Plus Graphics 655, OpenGL 4.1)', coreOptions: [4, 8], memoryOptions: [8, 16], weight: 6 },
  { hostPlatform: 'darwin', label: 'AMD Radeon Pro 560X (Mac Intel, roi)', webglVendor: 'Google Inc. (AMD)', webglRenderer: 'ANGLE (AMD, AMD Radeon Pro 560X OpenGL Engine, OpenGL 4.1)', coreOptions: [4, 8], memoryOptions: [16], weight: 3 },
  { hostPlatform: 'darwin', label: 'AMD Radeon Pro 5300M (Mac Intel, roi)', webglVendor: 'Google Inc. (AMD)', webglRenderer: 'ANGLE (AMD, AMD Radeon Pro 5300M OpenGL Engine, OpenGL 4.1)', coreOptions: [4, 8], memoryOptions: [16], weight: 3 },
  { hostPlatform: 'darwin', label: 'AMD Radeon Pro 5500M (Mac Intel, roi)', webglVendor: 'Google Inc. (AMD)', webglRenderer: 'ANGLE (AMD, AMD Radeon Pro 5500M OpenGL Engine, OpenGL 4.1)', coreOptions: [6, 8], memoryOptions: [16, 32], weight: 4 },

  // ---------------- linux -- Mesa (Intel/AMD dung driver mo) ----------------
  { hostPlatform: 'linux', label: 'Mesa Intel HD 4600', webglVendor: 'Google Inc. (Mesa)', webglRenderer: 'ANGLE (Mesa, Mesa Intel(R) HD Graphics 4600 (HSW GT2), OpenGL 4.6)', coreOptions: [2, 4], memoryOptions: [4, 8], weight: 4 },
  { hostPlatform: 'linux', label: 'Mesa Intel UHD 620', webglVendor: 'Google Inc. (Mesa)', webglRenderer: 'ANGLE (Mesa, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)', coreOptions: [2, 4], memoryOptions: [4, 8], weight: 12 },
  { hostPlatform: 'linux', label: 'Mesa Intel UHD 630', webglVendor: 'Google Inc. (Mesa)', webglRenderer: 'ANGLE (Mesa, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6)', coreOptions: [4, 6], memoryOptions: [8, 16], weight: 8 },
  { hostPlatform: 'linux', label: 'Mesa Intel Iris Xe', webglVendor: 'Google Inc. (Mesa)', webglRenderer: 'ANGLE (Mesa, Mesa Intel(R) Xe Graphics (TGL GT2), OpenGL 4.6)', coreOptions: [4, 8], memoryOptions: [8, 16], weight: 8 },
  { hostPlatform: 'linux', label: 'Mesa Intel Arc Graphics', webglVendor: 'Google Inc. (Mesa)', webglRenderer: 'ANGLE (Mesa, Mesa Intel(R) Arc(TM) Graphics (MTL), OpenGL 4.6)', coreOptions: [8, 12], memoryOptions: [16, 32], weight: 3 },
  { hostPlatform: 'linux', label: 'Mesa AMD RX 580', webglVendor: 'Google Inc. (Mesa)', webglRenderer: 'ANGLE (Mesa, Mesa AMD Radeon RX 580 (radeonsi, polaris10, LLVM 15.0.7, DRM 3.49), OpenGL 4.6)', coreOptions: [6, 8], memoryOptions: [8, 16], weight: 6 },
  { hostPlatform: 'linux', label: 'Mesa AMD RX 6600', webglVendor: 'Google Inc. (Mesa)', webglRenderer: 'ANGLE (Mesa, Mesa AMD Radeon RX 6600 (radeonsi, navi23, LLVM 15.0.7, DRM 3.49), OpenGL 4.6)', coreOptions: [8, 12], memoryOptions: [16], weight: 5 },
  { hostPlatform: 'linux', label: 'Mesa AMD Vega 8', webglVendor: 'Google Inc. (Mesa)', webglRenderer: 'ANGLE (Mesa, Mesa AMD Radeon(TM) Vega 8 Graphics (raven, LLVM 15.0.7, DRM 3.49), OpenGL 4.6)', coreOptions: [4, 6], memoryOptions: [8, 16], weight: 5 },
  // ---------------- linux -- NVIDIA driver rieng (khong qua Mesa) ----------------
  { hostPlatform: 'linux', label: 'NVIDIA GTX 1660 (driver rieng)', webglVendor: 'NVIDIA Corporation', webglRenderer: 'NVIDIA GeForce GTX 1660/PCIe/SSE2', coreOptions: [6, 8], memoryOptions: [8, 16], weight: 6 },
  { hostPlatform: 'linux', label: 'NVIDIA RTX 3060 (driver rieng)', webglVendor: 'NVIDIA Corporation', webglRenderer: 'NVIDIA GeForce RTX 3060/PCIe/SSE2', coreOptions: [8, 12], memoryOptions: [16], weight: 6 },
  { hostPlatform: 'linux', label: 'NVIDIA GTX 1050 Ti (driver rieng)', webglVendor: 'NVIDIA Corporation', webglRenderer: 'NVIDIA GeForce GTX 1050 Ti/PCIe/SSE2', coreOptions: [4, 6], memoryOptions: [8, 16], weight: 4 },
  { hostPlatform: 'linux', label: 'NVIDIA RTX 4070 (driver rieng)', webglVendor: 'NVIDIA Corporation', webglRenderer: 'NVIDIA GeForce RTX 4070/PCIe/SSE2', coreOptions: [8, 16], memoryOptions: [16, 32], weight: 4 },
  { hostPlatform: 'linux', label: 'Mesa AMD RX 6700 XT', webglVendor: 'Google Inc. (Mesa)', webglRenderer: 'ANGLE (Mesa, Mesa AMD Radeon RX 6700 XT (radeonsi, navi22, LLVM 15.0.7, DRM 3.49), OpenGL 4.6)', coreOptions: [8, 12], memoryOptions: [16, 32], weight: 4 },
  { hostPlatform: 'linux', label: 'Mesa AMD RX 7600', webglVendor: 'Google Inc. (Mesa)', webglRenderer: 'ANGLE (Mesa, Mesa AMD Radeon RX 7600 (radeonsi, navi33, LLVM 15.0.7, DRM 3.54), OpenGL 4.6)', coreOptions: [8, 12], memoryOptions: [16, 32], weight: 3 },
];

// Vài mức deviceScaleFactor THẬT (không phải random liên tục) theo OS
// -- Windows đa số 100% (1), 1 số laptop 125%/150%; Mac đa số Retina
// (2), số ít màn ngoài không Retina (1); Linux đa số 100%, số ít HiDPI.
const DEVICE_SCALE_POOL = {
  win32: [{ value: 1, weight: 50 }, { value: 1.25, weight: 30 }, { value: 1.5, weight: 15 }, { value: 2, weight: 5 }],
  darwin: [{ value: 2, weight: 80 }, { value: 1, weight: 20 }],
  linux: [{ value: 1, weight: 70 }, { value: 1.25, weight: 15 }, { value: 1.5, weight: 10 }, { value: 2, weight: 5 }],
};

// navigator.platform theo OS -- Chrome trên Apple Silicon vẫn báo
// 'MacIntel' để tương thích ngược với các trang pattern-match theo đó.
const PLATFORM_STRING = { win32: 'Win32', darwin: 'MacIntel', linux: 'Linux x86_64' };

// Vài biến thể bộ font theo OS -- máy cài thêm phần mềm khác nhau
// (Office, Adobe, gói ngôn ngữ...) thì bộ font cài sẵn hơi khác nhau,
// không phải MỌI máy cùng OS đều có bộ font giống hệt nhau tuyệt đối.
const FONT_VARIANTS = {
  win32: [
    { weight: 50, fonts: ['Arial', 'Calibri', 'Cambria', 'Comic Sans MS', 'Consolas', 'Courier New', 'Georgia', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'] },
    { weight: 30, fonts: ['Arial', 'Calibri', 'Cambria', 'Comic Sans MS', 'Consolas', 'Courier New', 'Georgia', 'Segoe UI', 'Segoe UI Semibold', 'Segoe UI Symbol', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Franklin Gothic Medium'] },
    { weight: 20, fonts: ['Arial', 'Calibri', 'Cambria', 'Consolas', 'Courier New', 'Georgia', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Myriad Pro', 'Minion Pro', 'Bahnschrift'] },
  ],
  darwin: [
    { weight: 50, fonts: ['Helvetica Neue', 'Helvetica', 'Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Menlo', 'Monaco', 'Avenir', 'Futura', 'Optima'] },
    { weight: 50, fonts: ['Helvetica Neue', 'Helvetica', 'Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Menlo', 'Monaco', 'Avenir', 'Futura', 'Optima', 'Palatino', 'Baskerville', 'Papyrus'] },
  ],
  linux: [
    { weight: 60, fonts: ['DejaVu Sans', 'DejaVu Serif', 'Liberation Sans', 'Liberation Serif', 'Liberation Mono', 'Ubuntu', 'Noto Sans', 'Droid Sans'] },
    { weight: 40, fonts: ['DejaVu Sans', 'DejaVu Serif', 'Liberation Sans', 'Liberation Serif', 'Liberation Mono', 'Ubuntu', 'Noto Sans', 'Droid Sans', 'Noto Sans CJK SC', 'Cantarell', 'Roboto'] },
  ],
};

function presetsForHost(hostPlatform) {
  const platform = hostPlatform || os.platform(); // 'win32' | 'darwin' | 'linux' | ...
  const matching = GPU_POOL.filter((p) => p.hostPlatform === platform);
  return matching.length ? matching : GPU_POOL;
}

function pickWeighted(rand, items) {
  const total = items.reduce((sum, p) => sum + p.weight, 0);
  let r = rand() * total;
  for (const p of items) {
    r -= p.weight;
    if (r <= 0) return p;
  }
  return items[items.length - 1]; // floating-point rounding fallback
}

// Chọn ĐỀU (không trọng số) 1 phần tử trong mảng nhỏ -- dùng cho
// coreOptions/memoryOptions của từng GPU (đã tự thân GPU giới hạn sẵn
// lựa chọn hợp lý rồi, không cần thêm trọng số ở đây nữa).
function pickUniform(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}

function generateFingerprint(seed, hostPlatform) {
  const seedInt = seed !== undefined
    ? hashStringToInt(String(seed))
    : (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) | 0;

  const rand = mulberry32(seedInt);
  const resolvedHostPlatform = hostPlatform || os.platform();

  // Chọn GPU trước (trọng số) -- rồi CPU/RAM chỉ chọn trong đúng
  // phạm vi coreOptions/memoryOptions mà chính GPU đó cho phép, tránh
  // ghép vô lý kiểu "GPU tich hop doi cu + RAM 32GB".
  const gpu = pickWeighted(rand, presetsForHost(resolvedHostPlatform));
  const hardwareConcurrency = pickUniform(rand, gpu.coreOptions);
  const deviceMemory = pickUniform(rand, gpu.memoryOptions);

  const scalePool = DEVICE_SCALE_POOL[resolvedHostPlatform] || DEVICE_SCALE_POOL.win32;
  const deviceScaleFactor = pickWeighted(rand, scalePool).value;

  const fontPool = FONT_VARIANTS[resolvedHostPlatform] || FONT_VARIANTS.win32;
  const fonts = pickWeighted(rand, fontPool).fonts.slice(); // .slice() -- KHONG chia se mang goc giua nhieu fingerprint

  const platformString = PLATFORM_STRING[resolvedHostPlatform] || PLATFORM_STRING.win32;

  return {
    label: gpu.label,
    // hostPlatform ('win32'/'darwin'/'linux', Node's os.platform() naming)
    // -- KHÁC với `platform` bên dưới ('Win32'/'MacIntel'/..., kiểu
    // navigator.platform của trình duyệt). Lưu lại để bất kỳ nơi nào
    // sau này cần lọc theo OS (VD: chọn độ phân giải màn hình hợp lý)
    // dùng ĐÚNG platform đã chọn cho fingerprint này -- không phải lấy
    // lại os.platform() của máy đang chạy SERVER (dễ lệch nếu server
    // Windows nhưng fingerprint lại là macOS/Linux).
    hostPlatform: resolvedHostPlatform,
    platform: platformString,
    hardwareConcurrency: hardwareConcurrency,
    deviceMemory: deviceMemory,
    deviceScaleFactor: deviceScaleFactor,
    webglVendor: gpu.webglVendor,
    webglRenderer: gpu.webglRenderer,
    fonts: fonts,
    canvasNoiseSeed: Math.floor(rand() * 0xffffffff),
    audioNoiseSeed: Math.floor(rand() * 0xffffffff),
    mediaDeviceSeed: Math.floor(rand() * 0xffffffff),
    screenWidth: null,
    screenHeight: null,
    geolocation: null,
  };
}

// Giữ tên PRESETS xuất ra ngoài để tương thích ngược (không có nơi nào
// trong project đang dùng trực tiếp tính tới lúc sửa, nhưng phòng hờ
// code ngoài/tuong lai có tham chiếu tên này) -- trỏ thẳng vào
// GPU_POOL, cùng 1 dữ liệu, không phải bản sao.
const PRESETS = GPU_POOL;

function normalizeFingerprint(input, seed) {
  const base = generateFingerprint(seed);
  if (!input || typeof input !== 'object') return base;

  const str = (v, fallback) => (typeof v === 'string' && v.trim() ? v.trim() : fallback);
  const num = (v, fallback) => (v !== null && v !== undefined && Number.isFinite(+v) ? +v : fallback);

  let geolocation = base.geolocation;
  if (input.geolocation && typeof input.geolocation === 'object') {
    const lat = +input.geolocation.latitude, lon = +input.geolocation.longitude;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      geolocation = { latitude: lat, longitude: lon, accuracy: Number.isFinite(+input.geolocation.accuracy) ? +input.geolocation.accuracy : 100 };
    }
  }

  return {
    label: str(input.label, base.label),
    hostPlatform: str(input.hostPlatform, base.hostPlatform),
    platform: str(input.platform, base.platform),
    hardwareConcurrency: num(input.hardwareConcurrency, base.hardwareConcurrency),
    deviceMemory: num(input.deviceMemory, base.deviceMemory),
    deviceScaleFactor: num(input.deviceScaleFactor, base.deviceScaleFactor),
    screenWidth: num(input.screenWidth, base.screenWidth),
    screenHeight: num(input.screenHeight, base.screenHeight),
    webglVendor: str(input.webglVendor, base.webglVendor),
    webglRenderer: str(input.webglRenderer, base.webglRenderer),
    fonts: Array.isArray(input.fonts) && input.fonts.length
      ? input.fonts.filter((f) => typeof f === 'string' && f.trim()).map((f) => f.trim())
      : base.fonts,
    canvasNoiseSeed: num(input.canvasNoiseSeed, base.canvasNoiseSeed),
    audioNoiseSeed: num(input.audioNoiseSeed, base.audioNoiseSeed),
    mediaDeviceSeed: num(input.mediaDeviceSeed, base.mediaDeviceSeed),
    geolocation,
  };
}

// User-Agent riêng -> bộ Client Hints khớp với nó (Emulation.setUserAgentOverride userAgentMetadata): header Sec-CH-UA* + navigator.userAgentData
// cùng báo đúng version / hệ điều hành ghi trong UA (không có thì Chrome gửi version THẬT -> lệch, web phía server thấy)
function uaMetadataFor(ua) {
  const s = String(ua || ''), full = (s.match(/Chrome\/([\d.]+)/) || [])[1] || '130.0.0.0', major = full.split('.')[0];
  const platform = /Windows/.test(s) ? 'Windows' : /Mac OS X|Macintosh/.test(s) ? 'macOS' : /Android/.test(s) ? 'Android' : /CrOS/.test(s) ? 'Chrome OS' : 'Linux';
  const brands = [{ brand: 'Not_A Brand', version: '8' }, { brand: 'Chromium', version: major }, { brand: 'Google Chrome', version: major }];
  return {
    navPlatform: platform === 'Windows' ? 'Win32' : platform === 'macOS' ? 'MacIntel' : platform === 'Android' ? 'Linux armv8l' : 'Linux x86_64',
    metadata: { brands, fullVersionList: brands.map((b) => ({ brand: b.brand, version: b.brand === 'Not_A Brand' ? '8.0.0.0' : full })), fullVersion: full, platform,
      platformVersion: platform === 'Windows' ? '10.0.0' : platform === 'macOS' ? '14.0.0' : platform === 'Android' ? '14.0.0' : '6.5.0',
      architecture: platform === 'Android' ? 'arm' : 'x86', model: '', mobile: platform === 'Android', bitness: '64', wow64: false },
  };
}

// Các TẦNG của fingerprint -- bật / tắt riêng từng tầng cho từng profile (profile.fpOffLayers = ['fonts', ...]) để tìm tầng làm hỏng web.
// kind 'script': đoạn giả lập trong init script; 'launch': tuỳ chọn lúc mở Chrome; 'base': áp cho MỌI profile, kể cả không có / đang OFF fingerprint
const FP_LAYERS = [
  { key: 'pwflags', kind: 'base', name: 'Cờ khởi động của Playwright (~35 cờ)', desc: 'Playwright tự thêm ~35 cờ Chrome thường không có (--enable-automation, --disable-field-trial-config, --disable-component-update, --force-color-profile, --disable-popup-blocking...). TẮT = mở Chrome gần như Chrome thường (webdriver tự là false) -- thử khi web chặn đăng nhập mà trình duyệt thường vẫn vào được' },
  { key: 'notif', kind: 'base', name: 'Chặn hỏi thông báo', desc: 'Chrome chặn sẵn "Cho phép thông báo?" (không hiện popup) -> trang thấy Notification.permission = "denied"; TẮT = như Chrome mặc định ("default", có hỏi)' },
  { key: 'stealth', kind: 'base', name: 'Ẩn dấu vết tự động hoá', desc: 'navigator.webdriver = false (áp cho mọi profile, kể cả không có fingerprint)' },
  { key: 'badge', kind: 'base', def: false, name: 'Nhãn tên profile trên trang', desc: 'thẻ <div id="__profile_badge__"> ghi tên profile ở góc trên phải MỌI trang -- web tìm được trong DOM (áp cả khi fingerprint OFF)' },
  { key: 'title', kind: 'base', def: false, name: 'Tên profile ở tiêu đề tab', desc: 'document.title của trang bị thêm "[tên profile] " + thuộc tính lạ trên document (áp cả khi fingerprint OFF)' },
  { key: 'ua', kind: 'base', name: 'User-Agent riêng của profile', desc: 'dùng UA đặt riêng cho profile + Client Hints khớp UA đó (header Sec-CH-UA và navigator.userAgentData cùng version / hệ điều hành); tắt = UA thật của Chrome -- áp cả khi fingerprint OFF'},
  { key: 'tostring', kind: 'script', name: 'Che toString', desc: 'các hàm bị sửa vẫn trả "[native code]" khi trang soi Function.toString' },
  { key: 'nav', kind: 'script', name: 'Navigator', desc: 'navigator.platform / hardwareConcurrency (số nhân CPU) / deviceMemory (RAM)' },
  { key: 'canvas', kind: 'script', name: 'Canvas', desc: 'nhiễu nhẹ ảnh canvas 2D (getImageData / toDataURL / toBlob) -- đổi canvas hash' },
  { key: 'webgl', kind: 'script', name: 'WebGL', desc: 'GPU vendor / renderer giả, lọc danh sách extension, nhiễu readPixels' },
  { key: 'audio', kind: 'script', name: 'Audio', desc: 'nhiễu nhẹ AudioBuffer -- đổi audio hash' },
  { key: 'fonts', kind: 'script', name: 'Font', desc: 'document.fonts giả: chỉ báo có các font trong danh sách của fingerprint' },
  { key: 'uadata', kind: 'script', name: 'User-Agent Client Hints (JS, cũ)', desc: 'không còn dùng: profile có UA riêng thì Chrome tự báo Client Hints khớp UA (header + navigator.userAgentData) theo tầng "User-Agent riêng"' },
  { key: 'media', kind: 'script', name: 'Thiết bị media', desc: 'mediaDevices.enumerateDevices: mic / loa / camera giả, id cố định theo profile' },
  { key: 'avail', kind: 'script', name: 'Thanh taskbar', desc: 'screen.availHeight nhỏ hơn screen.height (giống có taskbar)' },
  { key: 'conn', kind: 'script', name: 'Mạng', desc: 'navigator.connection: 4g / wifi / rtt 50 / downlink 10' },
  { key: 'workers', kind: 'script', name: 'Worker', desc: 'bọc Worker / SharedWorker / ServiceWorker để áp các tầng trên vào trong worker' },
  { key: 'screen', kind: 'launch', name: 'Kích thước màn hình', desc: 'screen.width / height giả (theo fingerprint hoặc suy từ viewport)' },
  { key: 'dpr', kind: 'launch', name: 'Tỉ lệ điểm ảnh', desc: 'devicePixelRatio (deviceScaleFactor) theo fingerprint' },
  { key: 'geo', kind: 'launch', name: 'Vị trí', desc: 'geolocation theo fingerprint (chỉ khi fingerprint có vị trí)' },
];
// Tầng đang bật của 1 profile: tầng mặc định bật (def !== false) bật trừ khi có trong profile.fpOffLayers; tầng mặc định TẮT (def: false --
// nhãn tên, tiêu đề tab: dấu vết web nhìn thấy) chỉ bật khi có trong profile.fpOnLayers
function fpLayersOf(profile) {
  const off = new Set((profile && profile.fpOffLayers) || []), on = new Set((profile && profile.fpOnLayers) || []);
  return Object.fromEntries(FP_LAYERS.map((l) => [l.key, l.def === false ? on.has(l.key) : !off.has(l.key)]));
}

function buildFingerprintInitScript(fp, customUserAgent, layers) {
  const L = layers || fpLayersOf(null);
  const uaMajor = customUserAgent ? extractMajorVersionFromUA(customUserAgent) : null;

  return `
(() => {
  // Chỉ chạy trên trang web thật -- không đụng vào chrome://, chrome-extension://,
  // devtools://, v.v. Không có lý do gì để giả mạo fingerprint trên
  // chính các trang nội bộ của Chrome, và việc ghi đè hàng loạt
  // prototype (Navigator, Canvas, WebGL, Audio...) trên đó có nguy cơ
  // làm hỏng ngầm JS nội bộ của những trang này (VD chrome://extensions).
  if (!/^https?:$/.test(location.protocol)) return;
  const PLATFORM = ${JSON.stringify(fp.platform)};
  const HARDWARE_CONCURRENCY = ${JSON.stringify(fp.hardwareConcurrency)};
  const DEVICE_MEMORY = ${JSON.stringify(fp.deviceMemory)};
  const WEBGL_VENDOR = ${JSON.stringify(fp.webglVendor)};
  const WEBGL_RENDERER = ${JSON.stringify(fp.webglRenderer)};
  const WEBGL_EXTENSIONS = ${JSON.stringify(GENERIC_WEBGL_EXTENSIONS)};
  const FONTS = ${JSON.stringify(fp.fonts)};
  const CANVAS_SEED = ${JSON.stringify(fp.canvasNoiseSeed)};
  const AUDIO_SEED = ${JSON.stringify(fp.audioNoiseSeed)};
  const MEDIA_SEED = ${JSON.stringify(fp.mediaDeviceSeed || 1)};
  const CUSTOM_UA = ${JSON.stringify(customUserAgent || null)};
  const UA_MAJOR = ${JSON.stringify(uaMajor)};
  const WORKER_PATCH_SOURCE = ${JSON.stringify(buildWorkerPatchSource(fp, customUserAgent, L))};
  const L = ${JSON.stringify(L)}; // tầng đang bật (xem FP_LAYERS)

  function mulberry32(seed) {
    let a = seed | 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function isProbeCanvas(canvas) {
    try {
      if (!canvas) return true;
      if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) return true;
      return canvas.isConnected === false;
    } catch (e) { return true; }
  }

  const nativeStrings = new WeakMap();
  function markNative(fn, name) {
    try { nativeStrings.set(fn, 'function ' + name + '() { [native code] }'); } catch (e) {}
    return fn;
  }
  if (L.tostring) try {
    const origFunctionToString = Function.prototype.toString;
    function patchedToString() {
      if (nativeStrings.has(this)) return nativeStrings.get(this);
      return origFunctionToString.call(this);
    }
    markNative(patchedToString, 'toString');
    Object.defineProperty(Function.prototype, 'toString', { value: patchedToString, writable: true, configurable: true, enumerable: false });
  } catch (e) { /* everything below still works, just without toString cover */ }

  if (L.nav) try {
    Object.defineProperty(Navigator.prototype, 'platform', { get: markNative(() => PLATFORM, 'get platform'), configurable: true, enumerable: true });
    Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: markNative(() => HARDWARE_CONCURRENCY, 'get hardwareConcurrency'), configurable: true, enumerable: true });
    if ('deviceMemory' in Navigator.prototype) {
      Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: markNative(() => DEVICE_MEMORY, 'get deviceMemory'), configurable: true, enumerable: true });
    }
  } catch (e) {}

  // Bisect vong 2: BAT LAI canvas, GIU WebGL tat -- xac dinh xem canvas
  // co vo toi hay khong. Da xac nhan Nhom A (canvas+webgl gop lai) la
  // thu pham, Worker-wrapping va prototype fix deu vo toi.
  if (L.canvas) try {
    function noiseUint8ClampedArray(data, seedMix) {
      let hash = (CANVAS_SEED ^ seedMix) | 0;
      const step = Math.max(1, Math.floor(data.length / 256));
      for (let i = 0; i < data.length; i += step) hash = (Math.imul(hash, 31) + data[i]) | 0;
      const rng = mulberry32(hash >>> 0);
      for (let i = 0; i < data.length; i += 4) {
        const delta = ((rng() * 3) | 0) - 1;
        data[i] += delta; data[i + 1] += delta; data[i + 2] += delta;
      }
    }

    const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = markNative(function (...args) {
      const result = origGetImageData.apply(this, args);
      if (isProbeCanvas(this.canvas)) {
        noiseUint8ClampedArray(result.data, (result.width * 374761393) ^ result.height);
      }
      return result;
    }, 'getImageData');

    if (typeof OffscreenCanvasRenderingContext2D !== 'undefined') {
      const origOffscreenGetImageData = OffscreenCanvasRenderingContext2D.prototype.getImageData;
      OffscreenCanvasRenderingContext2D.prototype.getImageData = markNative(function (...args) {
        const result = origOffscreenGetImageData.apply(this, args);
        if (isProbeCanvas(this.canvas)) {
          noiseUint8ClampedArray(result.data, (result.width * 374761393) ^ result.height);
        }
        return result;
      }, 'getImageData');
    }

    // SỬA LẦN 2: đã thử ca 2 ky thuat nhieu (tao canvas gia / nhieu-
    // tam-roi-khoi-phuc) deu van bi chan dang nhap -- chung to van de
    // KHONG nam o cach lam nhieu, ma o CHINH VIEC gia tri toDataURL/
    // toBlob tra ve bi khac voi that. Rat co the X so hash ket qua nay
    // voi danh sach GPU/driver that da biet -- nhieu vao se thanh
    // "khong khop cai nao ca", tro thanh tin hieu dang ngo hon ca viec
    // KHONG nhieu. Vi day la Chrome that co GPU that (khong phai
    // headless/SwiftShader), gia tri that von da hop le -- nen o day
    // CHU DONG KHONG nhieu toDataURL/toBlob nua, chi giu nhieu o
    // getImageData (da xac nhan an toan qua bisect thuc te).
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = markNative(function (...args) {
      return origToDataURL.apply(this, args);
    }, 'toDataURL');

    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = markNative(function (callback, ...rest) {
      return origToBlob.call(this, callback, ...rest);
    }, 'toBlob');
  } catch (e) {}
  if (L.webgl) try {
    // Da xac nhan qua bisect: WebGL VO TOI, khong lien quan loi chan
    // dang nhap -- bat lai binh thuong.
    function patchWebGL(proto) {
      const origGetParameter = proto.getParameter;
      proto.getParameter = markNative(function (param) {
        // 7936/7937 = VENDOR/RENDERER; 37445/37446 = UNMASKED_VENDOR_WEBGL/
        // UNMASKED_RENDERER_WEBGL -- different Chromium versions surface
        // the real GPU string through one or the other, both covered.
        if (param === 7936 || param === 37445) return WEBGL_VENDOR;
        if (param === 7937 || param === 37446) return WEBGL_RENDERER;
        return origGetParameter.call(this, param);
      }, 'getParameter');
      const origGetSupportedExtensions = proto.getSupportedExtensions;
      proto.getSupportedExtensions = markNative(function () {
        // Only advertise extensions that are BOTH in our curated generic
        // list AND genuinely supported by the underlying GPU/driver --
        // otherwise getExtension() below could return null for something
        // this method just claimed was supported, a self-contradiction
        // that's an easy, specific tell.
        const real = origGetSupportedExtensions.call(this) || [];
        return WEBGL_EXTENSIONS.filter((e) => real.indexOf(e) !== -1);
      }, 'getSupportedExtensions');

      const origGetExtension = proto.getExtension;
      proto.getExtension = markNative(function (name) {
        if (WEBGL_EXTENSIONS.indexOf(name) === -1) return null;
        return origGetExtension.call(this, name);
      }, 'getExtension');

      const origReadPixels = proto.readPixels;
      proto.readPixels = markNative(function (x, y, width, height, format, type, pixels, ...rest) {
        const result = origReadPixels.call(this, x, y, width, height, format, type, pixels, ...rest);
        try {
          if (pixels && pixels.length && format === 6408 && type === 5121 && isProbeCanvas(this.canvas)) {
            let hash = (CANVAS_SEED ^ (width * 374761393) ^ height) | 0;
            const step = Math.max(1, Math.floor(pixels.length / 256));
            for (let i = 0; i < pixels.length; i += step) hash = (Math.imul(hash, 31) + pixels[i]) | 0;
            const rng = mulberry32(hash >>> 0);
            for (let i = 0; i < pixels.length; i += 4) {
              const delta = ((rng() * 3) | 0) - 1;
              pixels[i] = Math.max(0, Math.min(255, pixels[i] + delta));
              pixels[i + 1] = Math.max(0, Math.min(255, pixels[i + 1] + delta));
              pixels[i + 2] = Math.max(0, Math.min(255, pixels[i + 2] + delta));
            }
          }
        } catch (e) {}
        return result;
      }, 'readPixels');
    }
    if (window.WebGLRenderingContext) patchWebGL(WebGLRenderingContext.prototype);
    if (window.WebGL2RenderingContext) patchWebGL(WebGL2RenderingContext.prototype);
  } catch (e) {}

  if (L.audio) try {
    const noisedChannels = new WeakMap(); // AudioBuffer -> Set<channel index>
    function noiseChannelInPlace(buffer, channel, data) {
      let seen = noisedChannels.get(buffer);
      if (!seen) { seen = new Set(); noisedChannels.set(buffer, seen); }
      if (seen.has(channel)) return; // already noised this exact buffer+channel -- idempotent
      seen.add(channel);

      let hash = (AUDIO_SEED ^ (channel * 2654435761) ^ data.length) | 0;
      const step = Math.max(1, Math.floor(data.length / 64));
      for (let i = 0; i < data.length; i += step) hash = (Math.imul(hash, 31) + Math.floor(data[i] * 1e6)) | 0;
      const rng = mulberry32(hash >>> 0);
      for (let i = 0; i < data.length; i += 100) {
        data[i] = data[i] + (rng() - 0.5) * 0.0001;
      }
    }

    const origGetChannelData = AudioBuffer.prototype.getChannelData;
    AudioBuffer.prototype.getChannelData = markNative(function (channel) {
      const data = origGetChannelData.call(this, channel);
      noiseChannelInPlace(this, channel, data);
      return data;
    }, 'getChannelData');

    // copyFromChannel is a second, separate way to read the same samples --
    // fingerprint scripts that use it instead of getChannelData previously
    // bypassed the noise entirely.
    if (typeof AudioBuffer.prototype.copyFromChannel === 'function') {
      const origCopyFromChannel = AudioBuffer.prototype.copyFromChannel;
      AudioBuffer.prototype.copyFromChannel = markNative(function (destination, channel, ...rest) {
        // Force the noise for this (buffer, channel) to exist first, using
        // the real backing data, then let the real copy run so it copies
        // the now-noised samples.
        const full = origGetChannelData.call(this, channel);
        noiseChannelInPlace(this, channel, full);
        return origCopyFromChannel.call(this, destination, channel, ...rest);
      }, 'copyFromChannel');
    }
  } catch (e) {}

  if (L.fonts) try {
    const fakeFontFaces = FONTS.map((name) => new FontFace(name, 'local("' + name + '")'));
    const fontNamesLower = new Set(FONTS.map((f) => f.toLowerCase()));
    const GENERIC_FONT_FAMILIES = new Set([
      'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
      'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded',
      'emoji', 'math', 'fangsong',
    ]);

    function parseFontFamilies(fontStr) {
      const str = String(fontStr || '');
      const withoutStyle = str.replace(/^\\s*((italic|oblique|normal|small-caps|bold|bolder|lighter|[1-9]00)\\s+)+/i, '');
      const withoutSize = withoutStyle.replace(/^[^\\s,]+\\s+/, '');
      return withoutSize.split(',').map((f) => f.trim().replace(/^['"]|['"]$/g, '').toLowerCase()).filter(Boolean);
    }

    function makeFakeFontFaceSet() {
      const target = new EventTarget();
      // FontFaceSet thật kế thừa từ EventTarget, nhưng new EventTarget()
      // KHÔNG tự động cho target instanceof FontFaceSet -- prototype
      // chain vẫn chỉ là EventTarget.prototype, không phải
      // FontFaceSet.prototype. document.fonts instanceof FontFaceSet
      // trên trình duyệt thật luôn là true -- thiếu dòng này là 1 phép
      // kiểm tra instanceof đơn giản cũng đủ lộ ra object bị giả.
      try {
        if (typeof FontFaceSet !== 'undefined') Object.setPrototypeOf(target, FontFaceSet.prototype);
      } catch (e) {}
      const faces = fakeFontFaces.slice();

      Object.defineProperties(target, {
        size: { get: markNative(() => faces.length, 'get size'), configurable: true },
        status: { value: 'loaded', enumerable: true, configurable: true },
        ready: { value: Promise.resolve(target), enumerable: true, configurable: true },
        onloading: { value: null, writable: true, configurable: true },
        onloadingdone: { value: null, writable: true, configurable: true },
        onloadingerror: { value: null, writable: true, configurable: true },
      });

      target.forEach = markNative(function (cb, thisArg) { faces.forEach((f) => cb.call(thisArg, f, f, target)); }, 'forEach');
      target[Symbol.iterator] = markNative(function () { return faces[Symbol.iterator](); }, '[Symbol.iterator]');
      target.entries = markNative(function () { return faces.map((f) => [f, f])[Symbol.iterator](); }, 'entries');
      target.keys = markNative(function () { return faces[Symbol.iterator](); }, 'keys');
      target.values = markNative(function () { return faces[Symbol.iterator](); }, 'values');
      target.has = markNative(function (face) { return faces.indexOf(face) !== -1; }, 'has');
      target.add = markNative(function (face) { if (faces.indexOf(face) === -1) faces.push(face); return target; }, 'add');
      target.delete = markNative(function (face) { const i = faces.indexOf(face); if (i !== -1) faces.splice(i, 1); return i !== -1; }, 'delete');
      target.clear = markNative(function () { faces.length = 0; }, 'clear');
      target.load = markNative(function () { return Promise.resolve(faces.slice()); }, 'load');
      // Real semantics: true only if every comma-separated family in the
      // shorthand would actually resolve to something available. A
      // generic family (serif, sans-serif, ...) always resolves; anything
      // else has to be in this profile's own FONTS list.
      target.check = markNative(function (font) {
        try {
          const families = parseFontFamilies(font);
          if (!families.length) return false;
          return families.every((f) => GENERIC_FONT_FAMILIES.has(f) || fontNamesLower.has(f));
        } catch (e) { return false; }
      }, 'check');

      return target;
    }

    const fakeFontFaceSet = makeFakeFontFaceSet();
    // Patch the prototype, not the 'document' instance -- real document.fonts
    // is an inherited accessor (FontFaceSource mixin on Document.prototype),
    // so patching the instance would make document.hasOwnProperty('fonts')
    // true when it should be false.
    Object.defineProperty(Document.prototype, 'fonts', {
      get: markNative(() => fakeFontFaceSet, 'get fonts'),
      configurable: true,
      enumerable: true,
    });
  } catch (e) {}

  if (CUSTOM_UA && L.uadata) {
    try {
      const version = String(UA_MAJOR || 130);
      const brands = [
        { brand: 'Not_A Brand', version: '8' },
        { brand: 'Chromium', version: version },
        { brand: 'Google Chrome', version: version },
      ];
      const uaPlatform = PLATFORM === 'MacIntel' ? 'macOS' : PLATFORM.indexOf('Linux') === 0 ? 'Linux' : 'Windows';
      const platformVersion = uaPlatform === 'Windows' ? '10.0.0' : uaPlatform === 'macOS' ? '14.0.0' : '6.5.0';
      // Cùng lỗi với FontFaceSet/NetworkInformation phía trên -- object
      // literal {} trần trụi có prototype là Object.prototype, trong
      // khi navigator.userAgentData instanceof NavigatorUAData phải là
      // true trên trình duyệt thật. Object.create(NavigatorUAData.prototype)
      // gắn đúng prototype trước, rồi mới gán thuộc tính vào -- không
      // dùng "mượn prototype từ object thật" như NetworkInformation vì
      // ở đây đang THAY THẾ hẳn dữ liệu (customUserAgent), không có bản
      // gốc nào đáng tin để mượn.
      const uaProto = (typeof NavigatorUAData !== 'undefined') ? NavigatorUAData.prototype : Object.prototype;
      const fakeUAData = ((o, props) => { for (const k of Object.keys(props)) Object.defineProperty(o, k, { value: props[k], enumerable: true, configurable: true, writable: true }); return o; })(Object.create(uaProto), { // defineProperty, KHÔNG Object.assign: brands / platform / mobile ở NavigatorUAData.prototype là getter chỉ đọc -> assign ném lỗi, cả tầng này bị bỏ qua
        brands: brands, mobile: false, platform: uaPlatform,
        getHighEntropyValues: markNative(function () {
          return Promise.resolve({
            brands: brands, mobile: false, platform: uaPlatform, platformVersion: platformVersion,
            architecture: 'x86', bitness: '64', wow64: false, model: '',
            uaFullVersion: version + '.0.0.0', fullVersionList: brands,
          });
        }, 'getHighEntropyValues'),
        toJSON: markNative(function () { return { brands: brands, mobile: false, platform: uaPlatform }; }, 'toJSON'),
      });
      Object.defineProperty(Navigator.prototype, 'userAgentData', { get: markNative(() => fakeUAData, 'get userAgentData'), configurable: true, enumerable: true });
    } catch (e) {}
  }

  if (L.media) try {
    function hashHex(salt) {
      // Real Chrome deviceIds are 64 hex chars (a salted SHA-256 digest);
      // matching the length (not just the shape) avoids an easy tell.
      const rng = mulberry32((MEDIA_SEED ^ salt) >>> 0);
      let out = '';
      for (let i = 0; i < 64; i++) out += (rng() * 16 | 0).toString(16);
      return out;
    }
    function makeFakeDevice(fields) {
      const obj = Object.create(MediaDeviceInfo.prototype);
      Object.defineProperties(obj, {
        deviceId: { value: fields.deviceId, enumerable: true, configurable: true },
        kind: { value: fields.kind, enumerable: true, configurable: true },
        label: { value: fields.label, enumerable: true, configurable: true },
        groupId: { value: fields.groupId, enumerable: true, configurable: true },
        toJSON: {
          value: markNative(function () {
            return { deviceId: fields.deviceId, kind: fields.kind, label: fields.label, groupId: fields.groupId };
          }, 'toJSON'),
          enumerable: false, configurable: true,
        },
      });
      return obj;
    }
    const fakeDeviceFields = [
      { deviceId: hashHex(1), kind: 'audioinput', label: '', groupId: hashHex(10) },
      { deviceId: hashHex(2), kind: 'audiooutput', label: '', groupId: hashHex(10) },
      { deviceId: hashHex(3), kind: 'videoinput', label: '', groupId: hashHex(11) },
    ];
    if (window.MediaDeviceInfo && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices = markNative(function () {
        return Promise.resolve(fakeDeviceFields.map(makeFakeDevice));
      }, 'enumerateDevices');
    }
  } catch (e) {}

  if (L.avail) try {
    if (screen.availHeight === screen.height) {
      let hash = (CANVAS_SEED ^ (screen.width * 2654435761) ^ screen.height) | 0;
      const rng = mulberry32(hash >>> 0);
      // Windows taskbar (~40-48px depending on DPI/scaling), macOS menu
      // bar + dock (~72-96px) -- a few real, discrete values, not a wide
      // continuous random range (same principle as fingerprint.js's
      // plausibleViewport() CHROME_DEDUCTIONS).
      const TASKBAR_DEDUCTIONS = PLATFORM === 'MacIntel' ? [72, 76, 96] : [40, 48, 62];
      const deduction = TASKBAR_DEDUCTIONS[Math.floor(rng() * TASKBAR_DEDUCTIONS.length)];
      const fakeAvailHeight = Math.max(1, screen.height - deduction);
      Object.defineProperty(Screen.prototype, 'availHeight', { get: markNative(() => fakeAvailHeight, 'get availHeight'), configurable: true, enumerable: true });
    }
  } catch (e) {}

  if (L.conn) try {
    if (navigator.connection) {
      const fakeConnection = new EventTarget();
      // Cùng lỗi với FontFaceSet phía trên -- navigator.connection
      // instanceof NetworkInformation phải là true trên trình duyệt
      // thật. Lấy prototype thật từ chính navigator.connection GỐC
      // (Object.getPrototypeOf) thay vì gọi tên "NetworkInformation"
      // trực tiếp -- interface này không phải lúc nào cũng lộ ra thành
      // biến toàn cục window.NetworkInformation ở mọi bản Chrome.
      try {
        Object.setPrototypeOf(fakeConnection, Object.getPrototypeOf(navigator.connection));
      } catch (e) {}
      Object.defineProperties(fakeConnection, {
        effectiveType: { value: '4g', enumerable: true, configurable: true },
        downlink: { value: 10, enumerable: true, configurable: true },
        downlinkMax: { value: Infinity, enumerable: true, configurable: true },
        rtt: { value: 50, enumerable: true, configurable: true },
        saveData: { value: false, enumerable: true, configurable: true },
        type: { value: 'wifi', enumerable: true, configurable: true },
        onchange: { value: null, writable: true, configurable: true },
      });
      Object.defineProperty(Navigator.prototype, 'connection', { get: markNative(() => fakeConnection, 'get connection'), configurable: true, enumerable: true });
    }
  } catch (e) {}

  // Đã bisect và loại trừ: KHÔNG phải nguyên nhân chặn đăng nhập (test
  // thực tế xác nhận). Giữ nguyên hoạt động bình thường.
  if (L.workers) try {
    const OriginalWorker = window.Worker;
    const OriginalSharedWorker = window.SharedWorker;

    function wrappedWorkerUrl(scriptURL) {
      const absoluteUrl = new URL(scriptURL, location.href).href;
      const source = WORKER_PATCH_SOURCE + '\\ntry { importScripts(' + JSON.stringify(absoluteUrl) + '); } catch (e) { throw e; }';
      const blob = new Blob([source], { type: 'text/javascript' });
      return URL.createObjectURL(blob);
    }

    // KNOWN LIMITATION: unlike serviceWorker.register() below (which returns
    // a Promise we can retry on failure), new Worker()/new SharedWorker()
    // return synchronously, and the returned object's identity can't be
    // swapped out after the fact. A worker-src CSP blocking the blob: URL,
    // or a cross-origin scriptURL blocked by CORS inside importScripts, both
    // surface as an async 'error' event on the worker -- *not* a synchronous
    // throw -- so the try/catch below only protects against the (rarer)
    // synchronous construction failures. We attach an error listener so a
    // wrapping-caused failure isn't silently invisible, but we cannot
    // transparently fall back to an unwrapped worker here the way register()
    // can. If a target site is known to run cross-origin/CSP-restricted
    // workers, that's a real gap worth testing against directly.
    if (OriginalWorker) {
      window.Worker = markNative(function (scriptURL, options) {
        if (options && options.type === 'module') return new OriginalWorker(scriptURL, options); // importScripts unavailable in module workers -- don't break real ones
        try {
          const worker = new OriginalWorker(wrappedWorkerUrl(scriptURL), options);
          worker.addEventListener('error', (e) => {
            // Best-effort visibility only -- see limitation above.
          });
          return worker;
        } catch (e) {
          return new OriginalWorker(scriptURL, options); // anything about the wrapping failed synchronously -- real behavior beats a broken page
        }
      }, 'Worker');
      window.Worker.prototype = OriginalWorker.prototype;
    }

    if (OriginalSharedWorker) {
      window.SharedWorker = markNative(function (scriptURL, options) {
        if (options && typeof options === 'object' && options.type === 'module') return new OriginalSharedWorker(scriptURL, options);
        try {
          return new OriginalSharedWorker(wrappedWorkerUrl(scriptURL), options);
        } catch (e) {
          return new OriginalSharedWorker(scriptURL, options);
        }
      }, 'SharedWorker');
      window.SharedWorker.prototype = OriginalSharedWorker.prototype;
    }

    if (navigator.serviceWorker && navigator.serviceWorker.register) {
      const origRegister = navigator.serviceWorker.register.bind(navigator.serviceWorker);
      navigator.serviceWorker.register = markNative(function (scriptURL, options) {
        if (options && options.type === 'module') return origRegister(scriptURL, options);
        // Default scope is normally derived from scriptURL's own directory.
        // Once scriptURL becomes a blob: URL that derivation no longer makes
        // sense, so pin the real default explicitly rather than letting it
        // silently change.
        const absoluteUrl = new URL(scriptURL, location.href).href;
        const resolvedOptions = (options && options.scope)
          ? options
          : Object.assign({}, options, { scope: absoluteUrl.replace(/[^/]*$/, '') });
        try {
          return origRegister(wrappedWorkerUrl(scriptURL), resolvedOptions)
            // register() returns a Promise (unlike new Worker(), which
            // returns synchronously), so a failure here -- e.g. blob: blocked
            // by a worker-src CSP, or the real script failing to import --
            // can be caught and retried with the real, unwrapped script.
            .catch((e) => origRegister(scriptURL, options));
        } catch (e) {
          return origRegister(scriptURL, options);
        }
      }, 'register');
    }
  } catch (e) {}
})();
`;
}

function buildWorkerPatchSource(fp, customUserAgent, layers) {
  const L = layers || fpLayersOf(null); // cùng các tầng đang bật như ở trang
  const uaMajor = customUserAgent ? extractMajorVersionFromUA(customUserAgent) : null;
  return `
const nativeStrings = new WeakMap();
function markNative(fn, name) {
  try { nativeStrings.set(fn, 'function ' + name + '() { [native code] }'); } catch (e) {}
  return fn;
}
if (${!!L.tostring}) try {
  const origFunctionToString = Function.prototype.toString;
  function patchedToString() {
    if (nativeStrings.has(this)) return nativeStrings.get(this);
    return origFunctionToString.call(this);
  }
  markNative(patchedToString, 'toString');
  Object.defineProperty(Function.prototype, 'toString', { value: patchedToString, writable: true, configurable: true, enumerable: false });
} catch (e) {}

function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const CANVAS_SEED = ${JSON.stringify(fp.canvasNoiseSeed)};

if (${!!L.nav}) try {
  const proto = (typeof WorkerNavigator !== 'undefined') ? WorkerNavigator.prototype : Object.getPrototypeOf(navigator);
  Object.defineProperty(proto, 'hardwareConcurrency', { get: markNative(() => ${JSON.stringify(fp.hardwareConcurrency)}, 'get hardwareConcurrency'), configurable: true, enumerable: true });
  if ('deviceMemory' in proto) {
    Object.defineProperty(proto, 'deviceMemory', { get: markNative(() => ${JSON.stringify(fp.deviceMemory)}, 'get deviceMemory'), configurable: true, enumerable: true });
  }
  if ('platform' in proto) {
    Object.defineProperty(proto, 'platform', { get: markNative(() => ${JSON.stringify(fp.platform)}, 'get platform'), configurable: true, enumerable: true });
  }
} catch (e) {}

${customUserAgent ? `
if (${!!L.uadata}) try {
  const version = String(${JSON.stringify(uaMajor || 130)});
  const brands = [{ brand: 'Not_A Brand', version: '8' }, { brand: 'Chromium', version: version }, { brand: 'Google Chrome', version: version }];
  const uaPlatform = ${JSON.stringify(fp.platform)} === 'MacIntel' ? 'macOS' : String(${JSON.stringify(fp.platform)}).indexOf('Linux') === 0 ? 'Linux' : 'Windows';
  const uaProto = (typeof NavigatorUAData !== 'undefined') ? NavigatorUAData.prototype : Object.prototype;
  const fakeUAData = ((o, props) => { for (const k of Object.keys(props)) Object.defineProperty(o, k, { value: props[k], enumerable: true, configurable: true, writable: true }); return o; })(Object.create(uaProto), { // defineProperty, KHÔNG Object.assign: brands / platform / mobile ở NavigatorUAData.prototype là getter chỉ đọc -> assign ném lỗi, cả tầng này bị bỏ qua
    brands: brands, mobile: false, platform: uaPlatform,
    getHighEntropyValues: markNative(function () { return Promise.resolve({ brands: brands, mobile: false, platform: uaPlatform, architecture: 'x86', bitness: '64', wow64: false, model: '', uaFullVersion: version + '.0.0.0', fullVersionList: brands }); }, 'getHighEntropyValues'),
    toJSON: markNative(function () { return { brands: brands, mobile: false, platform: uaPlatform }; }, 'toJSON'),
  });
  const navProto = (typeof WorkerNavigator !== 'undefined') ? WorkerNavigator.prototype : Object.getPrototypeOf(navigator);
  Object.defineProperty(navProto, 'userAgentData', { get: markNative(() => fakeUAData, 'get userAgentData'), configurable: true, enumerable: true });
} catch (e) {}
` : ''}

if (${!!L.webgl}) try {
  const WEBGL_VENDOR = ${JSON.stringify(fp.webglVendor)};
  const WEBGL_RENDERER = ${JSON.stringify(fp.webglRenderer)};
  const WEBGL_EXTENSIONS = ${JSON.stringify(GENERIC_WEBGL_EXTENSIONS)};
  function patchWebGL(proto) {
    const origGetParameter = proto.getParameter;
    proto.getParameter = markNative(function (param) {
      if (param === 7936 || param === 37445) return WEBGL_VENDOR;
      if (param === 7937 || param === 37446) return WEBGL_RENDERER;
      return origGetParameter.call(this, param);
    }, 'getParameter');
    const origGetSupportedExtensions = proto.getSupportedExtensions;
    proto.getSupportedExtensions = markNative(function () {
      const real = origGetSupportedExtensions.call(this) || [];
      return WEBGL_EXTENSIONS.filter((e) => real.indexOf(e) !== -1);
    }, 'getSupportedExtensions');
    const origGetExtension = proto.getExtension;
    proto.getExtension = markNative(function (name) {
      if (WEBGL_EXTENSIONS.indexOf(name) === -1) return null;
      return origGetExtension.call(this, name);
    }, 'getExtension');
    const origReadPixels = proto.readPixels;
    proto.readPixels = markNative(function (x, y, width, height, format, type, pixels, ...rest) {
      const result = origReadPixels.call(this, x, y, width, height, format, type, pixels, ...rest);
      try {
        // Every canvas reachable from inside a worker is an OffscreenCanvas,
        // which is never "on screen" the way a captcha widget's canvas is --
        // always safe to noise, no isProbeCanvas gate needed here.
        if (pixels && pixels.length && format === 6408 && type === 5121) {
          let hash = (CANVAS_SEED ^ (width * 374761393) ^ height) | 0;
          const step = Math.max(1, Math.floor(pixels.length / 256));
          for (let i = 0; i < pixels.length; i += step) hash = (Math.imul(hash, 31) + pixels[i]) | 0;
          const rng = mulberry32(hash >>> 0);
          for (let i = 0; i < pixels.length; i += 4) {
            const delta = ((rng() * 3) | 0) - 1;
            pixels[i] = Math.max(0, Math.min(255, pixels[i] + delta));
            pixels[i + 1] = Math.max(0, Math.min(255, pixels[i + 1] + delta));
            pixels[i + 2] = Math.max(0, Math.min(255, pixels[i + 2] + delta));
          }
        }
      } catch (e) {}
      return result;
    }, 'readPixels');
  }
  if (typeof WebGLRenderingContext !== 'undefined') patchWebGL(WebGLRenderingContext.prototype);
  if (typeof WebGL2RenderingContext !== 'undefined') patchWebGL(WebGL2RenderingContext.prototype);
} catch (e) {}

if (${!!L.canvas}) try {
  // OffscreenCanvas 2D fingerprinting inside a worker was previously
  // untouched -- getImageData/convertToBlob noise only existed on the
  // main thread. This mirrors that defense for the worker context.
  if (typeof OffscreenCanvasRenderingContext2D !== 'undefined') {
    function noiseUint8ClampedArray(data, seedMix) {
      let hash = (CANVAS_SEED ^ seedMix) | 0;
      const step = Math.max(1, Math.floor(data.length / 256));
      for (let i = 0; i < data.length; i += step) hash = (Math.imul(hash, 31) + data[i]) | 0;
      const rng = mulberry32(hash >>> 0);
      for (let i = 0; i < data.length; i += 4) {
        const delta = ((rng() * 3) | 0) - 1;
        data[i] += delta; data[i + 1] += delta; data[i + 2] += delta;
      }
    }

    const origGetImageData = OffscreenCanvasRenderingContext2D.prototype.getImageData;
    OffscreenCanvasRenderingContext2D.prototype.getImageData = markNative(function (...args) {
      const result = origGetImageData.apply(this, args);
      noiseUint8ClampedArray(result.data, (result.width * 374761393) ^ result.height);
      return result;
    }, 'getImageData');

    if (typeof OffscreenCanvas !== 'undefined' && OffscreenCanvas.prototype.convertToBlob) {
      const origConvertToBlob = OffscreenCanvas.prototype.convertToBlob;
      OffscreenCanvas.prototype.convertToBlob = markNative(function (...args) {
        const ctx2d = this.getContext && this.getContext('2d');
        if (!ctx2d) return origConvertToBlob.apply(this, args); // WebGL canvases are covered by the patched readPixels above
        const w = this.width || 1, h = this.height || 1;
        const clone = new OffscreenCanvas(w, h);
        const cctx = clone.getContext('2d');
        cctx.drawImage(this, 0, 0);
        try {
          const imageData = origGetImageData.call(cctx, 0, 0, w, h);
          noiseUint8ClampedArray(imageData.data, (w * 374761393) ^ h);
          cctx.putImageData(imageData, 0, 0);
        } catch (e) { /* tainted -- ship the clean clone */ }
        return origConvertToBlob.apply(clone, args);
      }, 'convertToBlob');
    }
  }
} catch (e) {}
`;
}

function buildBaseStealthInitScript() {
  return `
(() => {
  try {
    // Chỉ chạy trên trang web thật -- xem comment y hệt trong
    // buildFingerprintInitScript(). Không có lý do gì để patch
    // navigator.webdriver/Function.prototype.toString trên các trang
    // nội bộ của Chrome.
    if (!/^https?:$/.test(location.protocol)) return;
    if (navigator.webdriver !== true) return; // flag already did its job -- nothing to patch

    const nativeStrings = new WeakMap();
    function markNative(fn, name) {
      try { nativeStrings.set(fn, 'function ' + name + '() { [native code] }'); } catch (e) {}
      return fn;
    }
    try {
      const origFunctionToString = Function.prototype.toString;
      function patchedToString() {
        if (nativeStrings.has(this)) return nativeStrings.get(this);
        return origFunctionToString.call(this);
      }
      markNative(patchedToString, 'toString');
      Object.defineProperty(Function.prototype, 'toString', { value: patchedToString, writable: true, configurable: true, enumerable: false });
    } catch (e) { /* fallback patch below still applies either way */ }

    Object.defineProperty(Navigator.prototype, 'webdriver', {
      get: markNative(() => false, 'get webdriver'), // false, matching real Chrome -- never undefined
      configurable: true,
      enumerable: true,
    });
  } catch (e) {}
})();
`;
}

module.exports = {
  FP_LAYERS, uaMetadataFor,
  fpLayersOf, generateFingerprint, normalizeFingerprint, buildFingerprintInitScript, buildBaseStealthInitScript, PRESETS, presetsForHost, pickWeighted, extractMajorVersionFromUA, screenForViewport, STANDARD_SCREEN_RESOLUTIONS, plausibleViewport };