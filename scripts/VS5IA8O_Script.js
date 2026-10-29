// Code record trên máy DESKTOP-VS5IA8O -- dán (Ctrl+V sau ⏹ Xuất) vào trong thân hàm bên dưới. require / row đã khai báo sẵn ở đầu hàm,
// nên bỏ qua mấy dòng chú thích "Cần có ở đầu file" ở đầu đoạn code xuất ra.
async function VS5IA8O_Script(page, context, log, require, input) {
  const { useLog, isShown, waitEl, waitGone, waitAny, scrollEl, hoverEl, clickEl, typeEl, getText, pause, whileHandle, clickNewTab, closeOtherTabs, dblClickEl, rightClickEl, checkEl, whileGuard } = require('./xlv1_actions');
  useLog(log);
  const row = input ? JSON.parse(input) : {}; // dòng Excel của profile đang chạy (row.D, row.__excelRow...)

}

module.exports = { VS5IA8O_Script };
// const { VS5IA8O_Script } = require('./VS5IA8O_Script'); // gửi vào main.js
// await VS5IA8O_Script(page, context, log, require, input); // gọi trong main.js
