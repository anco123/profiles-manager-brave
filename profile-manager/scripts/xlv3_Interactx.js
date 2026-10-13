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
  const { browseHomeVaried, ambientMouseMove, momentumScroll } = require('./xlv3_interactXHome_Update');
  //const { browseHomeVaried, ambientMouseMove, momentumScroll } = require('./xlv3_interactXHome');
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
  const deps = { ...helpers, ambientMouseMove, momentumScroll }; // momentumScroll: các task lướt tới bài/link bằng con lăn có quán tính giống lúc lướt Home

  
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
      const Y = 23; 
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
      const Y = 21; 
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
      const Y = 22; 
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

  const postUrl = "https://x.com/StealthEX_io/status/2107410544642666579";

  async function rt_a(page) {
    // if (typeof soFollower === 'number' && soFollower > 100){
      console.log("▶ Running B");

      log('Bắt đầu xlv3_retweet_targettw...');
      await xlv3_retweet_targettw(page, log, deps, postUrl, maxInlineAttempts, maxIterations);
      log('xlv3_retweet_targettw xong');
      console.log('C');


      console.log("✓ Done B");
  }

  async function follow_a(page) {
      console.log("▶ Running C");

      const targetUsername = "cashcat_token";
      await xlv3_follow_friends( page, log, deps, targetUsername);

      console.log("✓ Done C");
  }

  async function follow_b(page) {
    // if (typeof soFollower === 'number' && soFollower > 100){
      console.log("▶ Running E");

      const targetUsername = "Pumpfun";
      await xlv3_follow_friends( page, log, deps, targetUsername);

      console.log("✓ Done E");

  }

  async function follow_c(page) {
      console.log("▶ Running E");

      const targetUsername = "BeldexCoin";
      await xlv3_follow_friends( page, log, deps, targetUsername);

      console.log("✓ Done E");
      }

  


  async function like_tweet_a(page) {
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
  // LƯỚT HOME + CHÈN CÁC HÀM VÀO GIỮA PHIÊN LƯỚT
  // ================================
  // Lần chạy nào cũng lướt Home bình thường, MỖI LẦN chỉ bốc ngẫu nhiên TASKS_PER_RUN task CHƯA XONG trong `functions` để CHÈN vào giữa
  // phiên lướt (vị trí + thứ tự ngẫu nhiên) -- mỗi lần chạy 1 bộ khác nhau, không lần nào cũng làm đủ cả bộ. KHÔNG phụ thuộc functions là
  // hàm gì, thêm/bớt/đổi hàm thoải mái ở runRandom bên dưới.
  // Đánh dấu VĨNH VIỄN theo tên hàm (lưu ở data/home-browse/<username>.json -- xem xlv1_homeBrowseCounter.js): hàm chạy thành công được
  // ghi nhận ngay, các lần sau không chọn lại nữa -> dần dần làm hết cả bộ. Thêm hàm mới (tên mới) thì tự vào vòng chọn ở các lần sau.
  // Đặt lại toàn bộ task -> bấm "Reset Done Task" trên trang editor. Giữ tên hàm mà đổi target bên trong thì phải Reset (hoặc đổi tên hàm).
  // Hàm được chọn mà lỗi giữa phiên lướt / chưa kịp chạy (phiên dừng sớm) -> chạy lại lần lượt sau phiên lướt, thứ tự ngẫu nhiên.
  // Vẫn còn hàm lỗi -> throw để script báo failed (server retry được) -- hàm chưa xong vẫn nằm trong vòng chọn ở các lần sau.
  const TASKS_PER_RUN = [2, 4]; // mỗi lần chạy làm ngẫu nhiên từ 2 tới 4 task chưa xong (còn ít hơn thì làm hết số còn lại)
  const { getTasksDone, markTaskDone } = require('./xlv1_homeBrowseCounter');
  const xUsername = (row.D || '').toString().trim().replace(/^@/, '');

  async function browseHomeAndRun(page, functions) {
    if (!xUsername) log('[interactX] Thiếu username (cột D) -- không ghi nhận được hàm nào đã chạy xong, lần nào cũng chọn trong cả bộ.');
    const done = xUsername ? getTasksDone(xUsername) : [];
    const pending = functions.filter((fn) => !(fn.name && done.includes(fn.name)));
    const want = TASKS_PER_RUN[0] + Math.floor(Math.random() * (TASKS_PER_RUN[1] - TASKS_PER_RUN[0] + 1));
    const picked = shuffle(pending).slice(0, want);
    log(`[interactX] Task đã xong ${functions.length - pending.length}/${functions.length}` + (pending.length ? ` -- lần này làm ${picked.length}: ${picked.map((fn) => fn.name).join(', ')}` : ' -- đã làm hết, chỉ lướt Home (bấm "Reset Done Task" ở editor để làm lại).'));
    // Bọc từng hàm: chạy THÀNH CÔNG thì ghi nhận ngay (giữ nguyên tên hàm cho log). Hàm không tên thì không ghi nhận được -- lần nào cũng có thể được chọn.
    const left = picked.map((fn) => ({ [fn.name]: async (p) => { await fn(p); if (xUsername && fn.name) markTaskDone(xUsername, fn.name); } })[fn.name]);

    // browseHomeVaried tự xoá khỏi `left` hàm nào chạy thành công -- còn lại = lỗi hoặc chưa chạy
    log('Bắt đầu lướt Home...');
    // deadlineAt: mốc hết giờ script do server gắn lên page (theo "script timeout" của queue) -- sắp hết giờ thì phiên lướt tự rút ngắn, làm task liền nhau
    const deadlineAt = page.__scriptDeadlineAt || 0;
    const finished = await browseHomeVaried(page, log, deps, { tasks: left, deadlineAt });
    log(finished ? 'Đã lướt Home xong' : '[interactX] Phiên lướt Home dừng sớm.');

    if (!left.length) return;
    if (page.isClosed()) throw new Error(`[interactX] Trang đã đóng -- còn ${left.length} hàm chưa chạy: ${left.map((fn) => fn.name).join(', ')}`);
    const randomOrder = shuffle(left);
    console.log("Random order (chạy bù):", randomOrder.map(fn => fn.name).join(" → "));
    const failed = [];
    for (const [i, fn] of randomOrder.entries()) { // chạy lần lượt, không chạy song song; 1 hàm lỗi không chặn các hàm sau
      if (deadlineAt && deadlineAt - Date.now() < 45000) { failed.push(...randomOrder.slice(i).map((f) => f.name)); log('[interactX] Sắp hết giờ script -- không chạy bù nữa, để lần chạy sau.'); break; }
      try { await fn(page); }
      catch (e) { if (page.isClosed()) throw e; failed.push(fn.name); log(`[interactX] Hàm "${fn.name}" lỗi: ${e.message}`); }
    }
    if (failed.length) throw new Error(`[interactX] ${failed.length} hàm chưa xong (lỗi / hết giờ): ${failed.join(', ')} -- các lần chạy sau vẫn chọn lại được các hàm này.`);
    console.log("✓ All functions completed");
  }

  const tweetContent = readGoogleSheetCell(row, 'G', 'POST');;

  async function post_a(page) {
    console.log("▶ Running G");

    log('Bắt đầu post');
    await xlv3_postTweet(page, log, deps, tweetContent);
    
  }

  const tweetContent_b = readGoogleSheetCell(row, 'D', 'REPLY');
  const tweetContent_c = tweetContent_b + ' https://x.com/itsgayri/status/2108810072855896358 ';

  async function post_b(page) {
    console.log("▶ Running G");

    log('Bắt đầu post');
    await xlv3_postTweet(page, log, deps, tweetContent_c);
    
  }

  //Bổ sung hàm check lượng follower và lưu vào excel
  // const followersNow = await xlv2_checkFollowers(page, log, require('./helpers'), row.__excelRow);
  // if (typeof followersNow === 'number') soFollower = followersNow; // số vừa check được (mới hơn số lưu từ lần chạy trước) -- các điều kiện soFollower > ... phía dưới dùng số này


   


  async function runRandom(page) {

      //const functions = [b,c,e,d,f];
      const functions = [follow_a,follow_b,follow_c,rt_a,like_tweet_a];

      // Mỗi lần chạy bốc ngẫu nhiên vài task chưa xong, chèn vào GIỮA phiên lướt Home, vị trí + thứ tự ngẫu nhiên (xem browseHomeAndRun)
      await browseHomeAndRun(page, functions);
  }

  // Đây chính là dòng bị thiếu trước đây -- không có dòng này thì
  // runRandom (và toàn bộ a/b/c/d bên trong) chỉ nằm im, không bao giờ
  // chạy, nên log dừng lại ngay sau "Đã lướt Home xong".
  await runRandom(page);
}

module.exports = { interactX };