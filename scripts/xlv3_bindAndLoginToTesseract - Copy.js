const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function bindAndLoginToTesseract(page, context, log) {

const walletButton = `//*[*[local-name()="svg"] and *[contains(text(),"@")]]`;

const walletElement = page.locator(`xpath=${walletButton}`).first();

const signInButton = `//*[text()="Live"]/../..//*[text()="Sign in"]`;

const signInButtonElement = page.locator(`xpath=${signInButton}`).first();

// =====================================================
// 1. LOGIN TESSERACT
// =====================================================
await page.goto('https://tesserapp.org/', { waitUntil: 'domcontentloaded', timeout: 15000 });

let element = page
  .locator(`xpath=//*[text()="Live"]/../..//*[text()="Sign in"] | //*[@aria-label="Close"] | ${walletButton}`)
  .first();

await element.waitFor({ state: 'visible', timeout: 15000 });

if(await page.locator(`xpath=//*[@aria-label="Close"]`).first().isVisible().catch(() => false) ){
  await page.locator(`xpath=//*[@aria-label="Close"]`).first().click();
  await page.waitForTimeout(3000);
  await page.locator(`xpath=${signInButton} | ${walletButton}`).first().waitFor({ state: 'visible', timeout: 15000 });
}

if(await signInButtonElement.isVisible().catch(() => false) ){
  await signInButtonElement.click();
  await page.waitForTimeout(3000);
}

// await element.waitFor({ state: 'visible', timeout: 15000 });

  // if (await element.isVisible().catch(() => false)) {
  //   log('mo web.');
  // }


  // await element.click();
  await page.waitForTimeout(2000);


  // =====================================================
  // 2. CONNECT PHANTOM
  // =====================================================
  const PHANTOM_ID = 'bfnaelmomeimhlpmgjnjophhpkkoljpa';

  let welcomeBackPoint = {
    x: 0,
    y: 0
  };

  const startTime = Date.now();

  while (Date.now() - startTime < 40000) {


    // =====================================================
    // BKEAK NGOÀI FOR
    // =====================================================
    // if (await walletElement.isVisible().catch(() => false)) {
    //   log('[Phantom] Wallet đã kết nối -> BREAK.');
    //   break;
    // }





    // for (let i = 0; i < 15; i++) {
  

    // for (let i = 1; i <= 10; i++) {

    // =====================================================
    // 2.1. BREAK NẾU WALLET ĐÃ KẾT NỐI
    // =====================================================
    // const walletElement = page
    //   .locator(`xpath=//*[@class="hidden items-center gap-1.5 rounded-[3px] border border-white/10 bg-white/[0.015] px-2.5 py-1 transition-colors duration-150 hover:border-white/25 hover:bg-white/[0.03] xl:flex"]`)
    //   .first();

    if (await walletElement.isVisible().catch(() => false)) {
      log('[Phantom] Wallet đã kết nối -> BREAK.');
      break;
    }


    // =====================================================
    // 2.2. TÌM PHANTOM POPUP
    // =====================================================
    const phantomPopup = context
      .pages()
      .slice()
      .reverse()
      .find(p =>
        !p.isClosed() &&
        p.url().startsWith(`chrome-extension://${PHANTOM_ID}/`)
      );


    // =====================================================
    // 2.3. PHANTOM UNLOCK
    // =====================================================
    if (phantomPopup) {
      const unlockInput = phantomPopup
        .locator('xpath=//input[@data-testid="unlock-form-password-input"]')
        .first();

      if (await unlockInput.isVisible().catch(() => false)) {
        await phantomPopup.bringToFront();

        await unlockInput.click();
        await unlockInput.press('Control+A');
        await unlockInput.press('Backspace');
        await unlockInput.pressSequentially('11111111');

        await phantomPopup.waitForTimeout(500);

        await unlockInput.press('Enter');

        log('[Phantom] Đã nhập password + Enter.');

        await page.waitForTimeout(3000);
        continue;
      }


      // =====================================================
      // 2.4. PHANTOM PRIMARY BUTTON
      // =====================================================
      const primaryButton = phantomPopup
        .locator('xpath=//button[@data-testid="primary-button"]')
        .first();

      if (await primaryButton.isVisible().catch(() => false)) {
        await phantomPopup.bringToFront();

        await primaryButton.click({
          timeout: 3000
        });

        log('[Phantom] Đã click primary-button.');

        //await page.waitForTimeout(3000);
        await sleep(3000);
        continue;
      }
    }


    // =====================================================
    // 2.5. CHỌN PHANTOM TRÊN WEB
    // =====================================================
    const phantomElement = page
      .locator('xpath=(//*[normalize-space(text())="Phantom"])[last()]');

    if (await phantomElement.isVisible().catch(() => false)) {
      await page.bringToFront();

      const clicked = await phantomElement
        .click({
          force: true,
          timeout: 3000
        })
        .then(() => true)
        .catch(() => false);

      if (clicked) {
        log('[Phantom] Click Phantom.');

        await page.waitForTimeout(3000);
        continue;
      }
    }


    // =====================================================
    // 2.6. SIGN IN WITH WALLET / CONTINUE WITH WALLET
    // =====================================================
    const signInWithWalletElement = page
      .locator(
        'xpath=//*[text()="Continue with wallet" or text()="Sign in with wallet"]'
      )
      .first();

    if (await signInWithWalletElement.isVisible().catch(() => false)) {

      const welcomeBackElement = page
        .locator('xpath=//*[text()="Welcome back"]')
        .first();

      if (await welcomeBackElement.isVisible().catch(() => false)) {
        const box = await welcomeBackElement.boundingBox().catch(() => null);

        if (box) {
          const x = box.x + box.width / 2;
          const y = box.y + box.height / 2;

          if (
            Number.isFinite(x) &&
            Number.isFinite(y) &&
            x !== 0 &&
            y !== 0
          ) {
            welcomeBackPoint.x = x;
            welcomeBackPoint.y = y;
          }
        }
      }

      await page.bringToFront();

      // await signInWithWalletElement.click({
      //   timeout: 3000
      // });
      await signInWithWalletElement
      .click({ force: true, timeout: 3000 })
      .catch((e) => log(`[Phantom] Click Sign in with wallet lỗi: ${String(e.message).split('\n')[0]}`));

      log('[Phantom] Click Sign in with wallet.');

      await page.waitForTimeout(3000);
      continue;
    }

    // =====================================================
    // 2.66. close 
    // =====================================================
    const closePopup = page
      .locator(
        'xpath=//*[@aria-label="Close"]'
      )
      .first();

    

    if (await closePopup.isVisible().catch(() => false)) {
      log('[Phantom] close pôppup.');
    }
    

    // =====================================================
    // 2.7. CLICK TỌA ĐỘ WELCOME BACK
    // =====================================================
    if (
      Number.isFinite(welcomeBackPoint.x) &&
      Number.isFinite(welcomeBackPoint.y) &&
      welcomeBackPoint.x !== 0 &&
      welcomeBackPoint.y !== 0
    ) {
      await page.bringToFront();

      await page.mouse.click(
        welcomeBackPoint.x,
        welcomeBackPoint.y
      );

      log('[Phantom] Click tọa độ Welcome back.');

      await page.waitForTimeout(3000);
      // continue;
    }

    // log(i);
    // page.waitForTimeout(2000);
    // }


    



    if (await signInButtonElement.isVisible().catch(() => false)) {
      await page.bringToFront();

      await signInButtonElement.click();

      log('[Phantom] Click Sign in .');

      await page.waitForTimeout(3000);
      continue;
    }


    await page.waitForTimeout(200);
  }

  log('login done.');


  // =====================================================
  // 3. CLICK WALLET
  // =====================================================
  // let elementSecond = page
  //   .locator(`xpath=//*[@class="hidden items-center gap-1.5 rounded-[3px] border border-white/10 bg-white/[0.015] px-2.5 py-1 transition-colors duration-150 hover:border-white/25 hover:bg-white/[0.03] xl:flex"]`)
  //   .first();

  await walletElement.waitFor({
    state: 'visible',
    timeout: 30000
  });

  await page.bringToFront();
  await walletElement.click();


  // =====================================================
  // 4. CHỜ X / TWITTER
  // =====================================================
  elementSecond = page
    .locator('xpath=//*[text()="X / Twitter"]')
    .first();

  await elementSecond.waitFor({
    state: 'visible',
    timeout: 15000
  });

  log('[Twitter] Click Wallet.');

  await page.waitForTimeout(3000);


  // =====================================================
  // 5. LINK X / TWITTER
  // =====================================================
  while (true) {

    const linkedElement = page
      .locator('xpath=//*[text()="X / Twitter"]/../..//*[text()=" linked "]')
      .first();

    if (await linkedElement.isVisible().catch(() => false)) {
      log('[Twitter] X / Twitter đã Linked -> BREAK.');
      break;
    }


    const openElement = page
      .locator('xpath=//*[text()="X / Twitter"]/../..//*[text()=" open "]')
      .first();

    if (await openElement.isVisible().catch(() => false)) {
      const linkXElement = page
        .locator('xpath=//*[text()="Link X"]')
        .first();

      if (await linkXElement.isVisible().catch(() => false)) {
        await linkXElement.click();

        log('[Twitter] Click Link X.');

        await page.waitForTimeout(3000);
        continue;
      }
    }


    const authorizeElement = page
      .locator('xpath=//*[text()="Authorize app"]')
      .first();

    if (await authorizeElement.isVisible().catch(() => false)) {
      await authorizeElement.click();

      log('[Twitter] Click Authorize app.');

      await page.waitForTimeout(3000);
      continue;
    }


    await page.waitForTimeout(200);
  }
}

module.exports = { bindAndLoginToTesseract };
