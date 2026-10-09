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



async function interactX(page, context, log, require, input,soFollower) {
  const helpers = require('./helpers');
  const { browseHomeVaried, ambientMouseMove } = require('./xlv3_interactXHome');
  const { xlv3_follow_friends } = require('./xlv3_follow_friends');
  //const { xlv3_follow_someone } = require('./xlv3_follow_someone');
  const { xlv3_like_tweet } = require('./xlv3_like_tweet');
  const { xlv3_retweet_targettw } = require('./xlv3_retweet_targettw');
  const { xlv3_reply_tweet } = require('./xlv3_reply_tweet');
  const { xlv3_postTweet } = require('./xlv3_postTweet');
  const { xlv2_checkFollowers } = require('./xlv2_checkFollowers');

  const row = input ? JSON.parse(input) : {};

  // deps gộp cả helpers.js lẫn ambientMouseMove (vốn sống trong
  // interactXHome.js) thành 1 object duy nhất -- interactX.js là tầng
  // nông nhất biết cần cả 2 thứ này, nên nó gánh việc require, còn
  // browseHomeVaried/runNewFile01 chỉ nhận deps đã gộp sẵn, không tự
  // require gì thêm.
  const deps = { ...helpers, ambientMouseMove };

  
const { readGoogleSheetCell } = require('./readGoogleSheetCell');

  

  
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

  async function follow_fr_a(page) {

      console.log("▶ Running A");

      const currentExcelRow = row.__excelRow;
      if (currentExcelRow === undefined) { 
        throw new Error( '[interactX] Thiếu __excelRow trong input -- dòng này phải được IMPORT từ Excel (không phải gõ tay), vì follow_friends cần biết số dòng để tính dòng lùi.' ); 
      }
      // SỐ BẠN LÙI
      const Y = 18; 
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

  async function follow_fr_b(page) {
      console.log("▶ Running A");

      const currentExcelRow = row.__excelRow;
      if (currentExcelRow === undefined) { 
        throw new Error( '[interactX] Thiếu __excelRow trong input -- dòng này phải được IMPORT từ Excel (không phải gõ tay), vì follow_friends cần biết số dòng để tính dòng lùi.' ); 
      }
      // SỐ BẠN LÙI
      const Y = 19; 
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

  async function follow_fr_c(page) {
      console.log("▶ Running A");

      const currentExcelRow = row.__excelRow;
      if (currentExcelRow === undefined) { 
        throw new Error( '[interactX] Thiếu __excelRow trong input -- dòng này phải được IMPORT từ Excel (không phải gõ tay), vì follow_friends cần biết số dòng để tính dòng lùi.' ); 
      }
      // SỐ BẠN LÙI
      const Y = 20; 
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

  const postUrl = "https://x.com/KN99XRewards/status/2107561342232117312";

  async function rt_a(page) {
    if (typeof soFollower === 'number' && soFollower > 100){
      console.log("▶ Running B");

      log('Bắt đầu xlv3_retweet_targettw...');
      await xlv3_retweet_targettw(page, log, deps, postUrl, maxInlineAttempts, maxIterations);
      log('xlv3_retweet_targettw xong');
      console.log('C');


      console.log("✓ Done B");
  }}

  async function follow_a(page) {
      console.log("▶ Running C");

      const targetUsername = "FastBridgeApp";
      await xlv3_follow_friends( page, log, deps, targetUsername);

      console.log("✓ Done C");
  }

  async function follow_b(page) {
    // if (typeof soFollower === 'number' && soFollower > 100){
      console.log("▶ Running E");

      const targetUsername = "KN99XRewards";
      await xlv3_follow_friends( page, log, deps, targetUsername);

      console.log("✓ Done E");

  }

  async function follow_c(page) {
      console.log("▶ Running E");

      const targetUsername = "Bifu_ZH";
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
  //const content = row.U;
  // const content = readGoogleSheetCell(row, 'C', 'REPLY');;

  // async function reply_a(page) {
  //   console.log("▶ Running F");

  //   log('Bắt đầu xlv3_like_targettw...');
  //   await xlv3_reply_tweet(page, log, deps, postUrl, maxInlineAttempts, maxIterations, content,input);
  //   log('xlv3_like_targettw xong');

  //   console.log("✓ Done F");
  // }

  // ================================
  // RUN RANDOM
  // ================================

  // ================================
  // LƯỚT HOME -- GIỚI HẠN SỐ LẦN MỖI NGÀY
  // ================================
  // HOME_BROWSE_PER_DAY = số lần lướt Home MỖI NGÀY cho mỗi tài khoản X -- TỰ SET Ở ĐÂY (1, 2, ...).
  //   1 -> mỗi ngày lướt 1 lần; lần chạy sau trong CÙNG ngày thấy đã lướt rồi thì bỏ qua.
  //   2 -> mỗi ngày lướt 2 lần; lần chạy nào thấy chưa đủ thì lướt bù ngay trong lần đó cho đủ 2.
  // Số lần đã lướt lưu theo username (cột D) ở data/home-browse/<username>.json (xem xlv1_homeBrowseCounter.js); sang ngày mới tự tính lại từ 0.
  // Phiên lướt bị dừng sớm (trang đóng, không hồi phục được về Home...) thì KHÔNG tính -- lần chạy sau sẽ lướt bù.
  const HOME_BROWSE_PER_DAY = 1;

  const { getHomeBrowseCountToday, markHomeBrowsed } = require('./xlv1_homeBrowseCounter');
  const xUsername = (row.D || '').toString().trim().replace(/^@/, '');

  if (!xUsername) {
    // Không có username thì không biết đếm cho tài khoản nào -- lướt 1 lần như cũ, không ghi nhận.
    log('[interactX] Thiếu username (cột D) -- không kiểm tra được số lần lướt trong ngày, lướt Home 1 lần như bình thường.');
    await browseHomeVaried(page, log, deps);
    log('Đã lướt Home xong');
  } else {
    const doneToday = getHomeBrowseCountToday(xUsername);
    if (doneToday >= HOME_BROWSE_PER_DAY) {
      log(`[interactX] @${xUsername} hôm nay đã lướt Home ${doneToday}/${HOME_BROWSE_PER_DAY} lần -- đủ rồi, bỏ qua.`);
    } else {
      log(`[interactX] @${xUsername} hôm nay đã lướt Home ${doneToday}/${HOME_BROWSE_PER_DAY} lần -- lướt thêm ${HOME_BROWSE_PER_DAY - doneToday} lần cho đủ.`);
      for (let i = doneToday; i < HOME_BROWSE_PER_DAY; i++) {
        if (i > doneToday) await helpers.humanPause(page, 3000, 8000); // nghỉ vài giây giữa 2 phiên lướt liền nhau
        log(`Bắt đầu lướt Home (lần ${i + 1}/${HOME_BROWSE_PER_DAY} hôm nay)...`);
        const finished = await browseHomeVaried(page, log, deps);
        if (!finished) { log('[interactX] Phiên lướt Home dừng sớm -- không tính lần này, lần chạy sau sẽ lướt bù.'); break; }
        const count = markHomeBrowsed(xUsername);
        log(`Đã lướt Home xong (${count}/${HOME_BROWSE_PER_DAY} lần hôm nay)`);
      }
    }
  }

  const tweetContent = readGoogleSheetCell(row, 'F', 'POST');;

  async function post_a(page) {
    console.log("▶ Running G");

    log('Bắt đầu post');
    await xlv3_postTweet(page, log, deps, tweetContent);
    
  }

  const tweetContent_b = readGoogleSheetCell(row, 'D', 'REPLY');
  const tweetContent_c = tweetContent_b + ' https://x.com/FastBridgeApp/status/2098030510836695450 ';

  async function post_b(page) {
    console.log("▶ Running G");

    log('Bắt đầu post');
    await xlv3_postTweet(page, log, deps, tweetContent_c);
    
  }

  //Bổ sung hàm check lượng follower và lưu vào excel
  const followersNow = await xlv2_checkFollowers(page, log, require('./helpers'), row.__excelRow);
  if (typeof followersNow === 'number') soFollower = followersNow; // số vừa check được (mới hơn số lưu từ lần chạy trước) -- các điều kiện soFollower > ... phía dưới dùng số này


   


  async function runRandom(page) {

      //const functions = [b,c,e,d,f];
      const functions = [follow_fr_a,follow_fr_b,follow_fr_c,post_b,post_a];

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