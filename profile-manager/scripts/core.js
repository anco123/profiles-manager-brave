// ============================================================
// CORE.JS
// File trung gian tập trung các hàm dùng chung trong /scripts
//
// LƯU Ý:
// - Không chứa lại code của các hàm.
// - Không sửa logic các hàm gốc.
// - Chỉ require và export lại.
// - Các file cũ vẫn có thể require trực tiếp như trước.
// ============================================================


// ============================================================
// HELPERS
// ============================================================

const {
  waitAndScreenshot,
  getPageInfo,
  totp,
  showVisibleCursor,
  moveMouseVisibly,
  clickVisibly,
  typeVisibly,
  focusFieldVaried,
  confirmStepVaried,
  typeWithJitter,
  humanPause,
} = require('./helpers');


// ============================================================
// DOM / CLICK
// ============================================================

const {
  clickElementOnScreen,
} = require('./xlv1_clickElementOnScreen');

const {
  pickSafeClickPoint,
} = require('./xlv1_safeClickPoint');


// ============================================================
// EXCEL
// ============================================================

const {
  readExcelCell,
} = require('./xlv1_readExcelCell');

const {
  writeExcelCell,
} = require('./writeExcelCell');

const {
  exportSnapshotToExcel,
} = require('./xlv1_exportSnapshotToExcel');


// ============================================================
// TWEET
// ============================================================

const {
  findTweetInTimeline,
} = require('./xlv1_findTweetInTimeline');

const {
  openTweetDetail,
} = require('./xlv2_openTweetDetail');

const {
  xlv2_seeTweetInTimeline,
} = require('./xlv2_seeTweetInTimeline');


// ============================================================
// PROFILE / NAVIGATION
// ============================================================

const {
  gotoProfile,
} = require('./xlv2_gotoProfile');

const {
  getXStatus,
} = require('./xlv1_getXStatus');

const {
  getDeviceInfo,
} = require('./xlv1_getDeviceInfo');

const {
  changeProxy,
  getProxyResetUrl,
} = require('./xlv1_changeProxy');

const {
  markProfileForRecreate,
} = require('./xlv1_markProfileForRecreate');


// ============================================================
// X INTERACTION
// ============================================================

const {
  xlv3_like_tweet,
} = require('./xlv3_like_tweet');

const {
  xlv3_retweet_targettw,
} = require('./xlv3_retweet_targettw');

const {
  xlv3_follow_friends,
} = require('./xlv3_follow_friends');

const {
  interactX,
} = require('./xlv3_Interactx');

const {
  browseHomeVaried,
  ambientMouseMove,
  momentumScroll,
} = require('./xlv3_interactXHome');


// ============================================================
// LOGIN
// ============================================================

const {
  loginToX,
} = require('./xlv3_loginX');

const {
  loginByCookie,
  parseCookies,
} = require('./xlv3_loginByCookie');


// ============================================================
// MAIL
// ============================================================

const {
  getMailTmToken,
  waitForVerificationCode,
} = require('./mailtm');


// ============================================================
// OTHER
// ============================================================

const {
  cleanupOldDebugFiles,
  DEBUG_FILE_PATTERN,
} = require('./cleanupDebugFiles');


// ============================================================
// DATA PATHS
// Không phải hàm, nhưng export luôn để những file khác
// có thể lấy path thông qua core.js.
// ============================================================

const {
  DATA_DIR,
  EXCEL_SNAPSHOT_FILE,
  EXCEL_RESULTS_FILE,
} = require('./datapaths');


// ============================================================
// EXPORT
// ============================================================

module.exports = {

  // ---------- Helpers ----------
  waitAndScreenshot,
  getPageInfo,
  totp,
  showVisibleCursor,
  moveMouseVisibly,
  clickVisibly,
  typeVisibly,
  focusFieldVaried,
  confirmStepVaried,
  typeWithJitter,
  humanPause,

  // ---------- DOM / Click ----------
  clickElementOnScreen,
  pickSafeClickPoint,

  // ---------- Excel ----------
  readExcelCell,
  writeExcelCell,
  exportSnapshotToExcel,

  // ---------- Tweet ----------
  findTweetInTimeline,
  openTweetDetail,
  xlv2_seeTweetInTimeline,

  // ---------- Profile / Navigation ----------
  gotoProfile,
  getXStatus,
  getDeviceInfo,
  changeProxy,
  getProxyResetUrl,
  markProfileForRecreate,

  // ---------- X Interaction ----------
  xlv3_like_tweet,
  xlv3_retweet_targettw,
  xlv3_follow_friends,
  interactX,
  browseHomeVaried,
  ambientMouseMove,
  momentumScroll,

  // ---------- Login ----------
  loginToX,
  loginByCookie,
  parseCookies,

  // ---------- Mail ----------
  getMailTmToken,
  waitForVerificationCode,

  // ---------- Other ----------
  cleanupOldDebugFiles,
  DEBUG_FILE_PATTERN,

  // ---------- Data paths ----------
  DATA_DIR,
  EXCEL_SNAPSHOT_FILE,
  EXCEL_RESULTS_FILE,
};