async function bindAndLoginToTesseract(page, context, log) {

  // =====================================================
  // 1. LOGIN TESSERACT
  // =====================================================
  await page.goto('https://tesserapp.org/', {
    waitUntil: 'domcontentloaded',
    timeout: 15000
  });

  let element = page
    .locator('xpath=//*[text()="Live"]/../..//*[text()="Sign in"]')
    .first();

  // await element.waitFor({
  //   state: 'visible',
  //   timeout: 15000
  // });

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

  while (Date.now() - startTime < 30000) {

    // =====================================================
    // 2.1. BREAK NẾU WALLET ĐÃ KẾT NỐI
    // =====================================================
    const walletElement = page
      .locator(`xpath=//*[@class="hidden items-center gap-1.5 rounded-[3px] border px-2.5 py-1 transition-colors duration-150 xl:flex border-white/10 bg-white/[0.015] hover:border-white/25 hover:bg-white/[0.03]"]`)
      .first();

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

        await page.waitForTimeout(3000);
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
        'xpath=//*[text()="Sign in with wallet" or text()="Continue with wallet"]'
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

      await signInWithWalletElement.click({
        timeout: 3000
      });

      log('[Phantom] Click Sign in with wallet.');

      await page.waitForTimeout(3000);
      continue;
    }
    

    if (await element.isVisible().catch(() => false)) {
      await page.bringToFront();

      await element.click({
        timeout: 3000
      });

      log('[Phantom] Click Sign in .');

      await page.waitForTimeout(3000);
      continue;
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
      continue;
    }


    await page.waitForTimeout(200);
  }

  log('login done.');


  // =====================================================
  // 3. CLICK WALLET
  // =====================================================
  let elementSecond = page
    .locator(`xpath=//*[@class="hidden items-center gap-1.5 rounded-[3px] border px-2.5 py-1 transition-colors duration-150 xl:flex border-white/10 bg-white/[0.015] hover:border-white/25 hover:bg-white/[0.03]"]`)
    .first();

  await elementSecond.waitFor({
    state: 'visible',
    timeout: 15000
  });

  await page.bringToFront();
  await elementSecond.click();


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
