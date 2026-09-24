/**
 * scripts/interactX.js
 * -----------------------------------------------------------------------
 * Bước "interact" chạy SAU khi loginX.js xác nhận tài khoản ở trạng thái
 * Done_X (main.js là nơi quyết định có gọi file này hay không, dựa vào
 * status loginX.js trả về).
 *
 * Hiện tại chỉ gọi browseHomeVaried() (lướt Home với hành vi đa dạng) --
 * đây là hành vi "interact" duy nhất đã xây xong. Đây là chỗ để thêm các
 * hành vi khác sau này (vd: vào 1 trang cụ thể làm quest, tương tác 1
 * tweet cụ thể...) -- nói tôi biết cần thêm gì để mở rộng file này.
 *
 * KHÔNG chạy trực tiếp -- export ra 1 hàm để main.js require() vào rồi
 * gọi, cùng kiểu với loginX.js.
 *
 * Usage (trong main.js):
 *   const { interactX } = require('./interactX');
 *   await interactX(page, context, log, require, input);
 * -----------------------------------------------------------------------
 */



async function interactX(page, context, log, require, input) {
  const helpers = require('./helpers');
  const { browseHomeVaried, ambientMouseMove } = require('./xlv3_interactXHome');
  const { xlv3_follow_friends } = require('./xlv3_follow_friends');
  //const { xlv3_follow_someone } = require('./xlv3_follow_someone');
  const { xlv3_like_tweet } = require('./xlv3_like_tweet');
  const { xlv3_retweet_targettw } = require('./xlv3_retweet_targettw');
  const { xlv3_reply_tweet } = require('./xlv3_reply_tweet');

  const row = input ? JSON.parse(input) : {};

  // deps gộp cả helpers.js lẫn ambientMouseMove (vốn sống trong
  // interactXHome.js) thành 1 object duy nhất -- interactX.js là tầng
  // nông nhất biết cần cả 2 thứ này, nên nó gánh việc require, còn
  // browseHomeVaried/runNewFile01 chỉ nhận deps đã gộp sẵn, không tự
  // require gì thêm.
  const deps = { ...helpers, ambientMouseMove };

  

  
  const { readExcelCell } = require('./xlv1_readExcelCell');

  // Cấu hình target cho retweet/like -- khai báo Ở ĐÂY (thay vì bên
  // trong b()) vì cả b() lẫn d() đều cần tới, và closure của a/b/c/d
  // chỉ nhìn thấy biến khai báo trong phạm vi interactX() này, không
  // nhìn thấy biến cục bộ của nhau. (Trước đây b() tự khai báo riêng,
  // d() dùng ké -- chạy được với a/b/c nhưng ReferenceError ngay khi
  // rơi vào d(), vì lúc đó b() còn chưa từng chạy để tạo ra chúng.)
  
  const maxInlineAttempts = 15;
  const maxIterations = 15;


  // ================================
  // RANDOM ORDER
  // ================================

  function shuffle(array) {
      const result = [...array]; // Không làm thay đổi mảng gốc

      for (let i = result.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));

          [result[i], result[j]] = [result[j], result[i]];
      }

      return result;
  }


  // ================================
  // 3 FUNCTIONS
  // ================================

  async function ab(page) {
      console.log("▶ Running A");

      const currentExcelRow = row.__excelRow;
      if (currentExcelRow === undefined) { 
        throw new Error( '[interactX] Thiếu __excelRow trong input -- dòng này phải được IMPORT từ Excel (không phải gõ tay), vì follow_friends cần biết số dòng để tính dòng lùi.' ); 
      }
      // SỐ BẠN LÙI
      const Y = 9; 
      const usernameColumn = 'D';
      if (currentExcelRow <= Y + 1) { log( `[interactX] Dòng hiện tại ${currentExcelRow} <= ${Y} -- bỏ qua follow_friends.` ); }
      else { 
        const targetExcelRow = currentExcelRow - Y; 
        const targetUsername = readExcelCell( targetExcelRow, usernameColumn );
        if (!targetUsername) { 
          throw new Error( `[interactX] Không tìm thấy username ở dòng đích ${targetExcelRow}, cột ${usernameColumn} (ô rỗng?).` ); 
        }

        log( `Bắt đầu follow_friends (dòng hiện tại: ${currentExcelRow}, lùi ${Y} -> dòng đích: ${targetExcelRow}, username: @${targetUsername})...` );
        await xlv3_follow_friends( page, log, deps, targetUsername ); 
        log('follow_friends xong');
        
      }

      console.log("✓ Done A");
  }

  async function ac(page) {
      console.log("▶ Running A");

      const currentExcelRow = row.__excelRow;
      if (currentExcelRow === undefined) { 
        throw new Error( '[interactX] Thiếu __excelRow trong input -- dòng này phải được IMPORT từ Excel (không phải gõ tay), vì follow_friends cần biết số dòng để tính dòng lùi.' ); 
      }
      // SỐ BẠN LÙI
      const Y = 10; 
      const usernameColumn = 'D';
      if (currentExcelRow <= Y + 1) { log( `[interactX] Dòng hiện tại ${currentExcelRow} <= ${Y} -- bỏ qua follow_friends.` ); }
      else { 
        const targetExcelRow = currentExcelRow - Y; 
        const targetUsername = readExcelCell( targetExcelRow, usernameColumn );
        if (!targetUsername) { 
          throw new Error( `[interactX] Không tìm thấy username ở dòng đích ${targetExcelRow}, cột ${usernameColumn} (ô rỗng?).` ); 
        }

        log( `Bắt đầu follow_friends (dòng hiện tại: ${currentExcelRow}, lùi ${Y} -> dòng đích: ${targetExcelRow}, username: @${targetUsername})...` );
        await xlv3_follow_friends( page, log, deps, targetUsername ); 
        log('follow_friends xong');
        
      }

      console.log("✓ Done A");
  }

  const postUrl = "https://x.com/auraseaonly/status/2099970529965060381";

  async function b(page) {
      console.log("▶ Running B");

      log('Bắt đầu xlv3_retweet_targettw...');
      await xlv3_retweet_targettw(page, log, deps, postUrl, maxInlineAttempts, maxIterations);
      log('xlv3_retweet_targettw xong');
      console.log('C');


      console.log("✓ Done B");
  }

  async function c(page) {
      console.log("▶ Running C");

      const targetUsername = "auraseaonly";
      await xlv3_follow_friends( page, log, deps, targetUsername);

      console.log("✓ Done C");
  }

  async function e(page) {
      console.log("▶ Running E");

      const targetUsername = "zecpunksnft";
      await xlv3_follow_friends( page, log, deps, targetUsername);

      console.log("✓ Done E");
  }

  async function d(page) {
      console.log("▶ Running D");

      log('Bắt đầu xlv3_like_targettw...');
      await xlv3_like_tweet(page, log, deps, postUrl, maxInlineAttempts, maxIterations);
      log('xlv3_like_targettw xong');

      console.log("✓ Done D");
  }

    //const row = input ? JSON.parse(input) : {};
    const content = row.U;

    async function f(page) {
        console.log("▶ Running F");

        log('Bắt đầu xlv3_like_targettw...');
        await xlv3_reply_tweet(page, log, deps, postUrl, maxInlineAttempts, maxIterations, content,input);
        log('xlv3_like_targettw xong');

        console.log("✓ Done F");
    }

  // ================================
  // RUN RANDOM
  // ================================

  log('Bắt đầu lướt Home...');
  await browseHomeVaried(page, log, deps);
  log('Đã lướt Home xong');


  async function runRandom(page) {

      //const functions = [b,c,e,d,f];
      const functions = [ac,ab];

      // Random thứ tự
      const randomOrder = shuffle(functions);

      console.log(
          "Random order:",
          randomOrder.map(fn => fn.name).join(" → ")
      );

      // Chạy lần lượt, không chạy song song
      for (const fn of randomOrder) {
          await fn(page);
      }

      console.log("✓ All functions completed");
  }

  // Đây chính là dòng bị thiếu trước đây -- không có dòng này thì
  // runRandom (và toàn bộ a/b/c/d bên trong) chỉ nằm im, không bao giờ
  // chạy, nên log dừng lại ngay sau "Đã lướt Home xong".
  await runRandom(page);
}

module.exports = { interactX };