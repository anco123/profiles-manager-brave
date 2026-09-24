const PHANTOM_ID = 'bfnaelmomeimhlpmgjnjophhpkkoljpa';
const PHANTOM_PASSWORD = '11111111';

async function loginPhantom(page, context, log, require, phantomSeedPharse) {
  const phantomSeedPharseSplited = String(phantomSeedPharse || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (![12, 24].includes(phantomSeedPharseSplited.length)) {
    throw new Error(
      `phantomSeedPharse phải có 12 hoặc 24 từ, hiện có ${phantomSeedPharseSplited.length} từ.`
    );
  }

  const phantomPage = await context.newPage();

  // Tab mới -> active luôn
  await phantomPage.bringToFront();

  try {
    // 1. Mở Phantom tại tab mới
    await phantomPage.goto(`chrome-extension://${PHANTOM_ID}/onboarding.html`,
      {
        waitUntil: 'domcontentloaded',
        timeout: 15000
      }
    );

    // Ép Phantom tab tiếp tục là active tab
    await phantomPage.bringToFront();

    // 2. I already have a wallet
    let element = phantomPage.locator('xpath=//button[text()="I already have a wallet" or text()="Tôi đã có Ví rồi"or text()="I Already Have a Wallet"]').first();
    await element.waitFor({ state: 'visible', timeout: 15000 });
    await element.click();

    // 3. Import Recovery Phrase
    element = phantomPage.locator(
      'xpath=//*[text()="Import Recovery Phrase" or text()="Import Secret Recovery Phrase" or text()="Nhập Cụm từ khôi phục"]'
    ).first();
    await element.waitFor({ state: 'visible', timeout: 15000 });
    await element.click();

    // 4. Chờ ô seed đầu tiên
    element = phantomPage.locator(
      'xpath=//input[@data-testid="secret-recovery-phrase-word-input-0"]'
    ).first();
    await element.waitFor({ state: 'visible', timeout: 15000 });

    // 5. Điền seed
    for (let i = 0; i < phantomSeedPharseSplited.length; i++) {
      const seedInput = phantomPage.locator(
        `xpath=//input[@data-testid="secret-recovery-phrase-word-input-${i}"]`
      ).first();

      await seedInput.waitFor({ state: 'visible', timeout: 5000 });
      await seedInput.fill(phantomSeedPharseSplited[i]);
    }

    // 6. Submit seed
    element = phantomPage.locator(
      'xpath=//*[@data-testid="onboarding-form-submit-button"]'
    ).first();
    await element.waitFor({ state: 'visible', timeout: 15000 });
    await element.click();

    // 7. Submit màn tiếp theo
    // GPM cũ cũng bấm onboarding-form-submit-button lần thứ 2.
    // Chờ ngắn để DOM chuyển màn rồi chờ đúng element tiếp theo.
    await phantomPage.waitForTimeout(200);
    element = phantomPage.locator(
      'xpath=//*[@data-testid="onboarding-form-submit-button"]'
    ).first();
    await element.waitFor({ state: 'visible', timeout: 15000 });
    await element.click();

    //77777777777777777777777777777777
    await phantomPage.waitForTimeout(200);
    const nextOrInvalidPass = phantomPage.locator(
      'xpath=//*[@data-testid="onboarding-form-submit-button" or @name="password"]'
    ).first();
    await nextOrInvalidPass.waitFor({ state: 'visible', timeout: 15000 });


    // 8. Password
    const passwordInput = phantomPage
      .locator('xpath=//input[@name="password"]')
      .first();
    
    if (await passwordInput.isVisible().catch(() => false)) {
      await passwordInput.waitFor({
      state: 'visible',
      timeout: 15000
      });

      await passwordInput.click();
      await passwordInput.press('Control+A');
      await passwordInput.press('Backspace');
      await passwordInput.pressSequentially(PHANTOM_PASSWORD);


      const confirmPasswordInput = phantomPage
        .locator('xpath=//input[@name="confirmPassword"]')
        .first();

      await confirmPasswordInput.waitFor({
        state: 'visible',
        timeout: 15000
      });

      await confirmPasswordInput.click();
      await confirmPasswordInput.press('Control+A');
      await confirmPasswordInput.press('Backspace');
      await confirmPasswordInput.pressSequentially(PHANTOM_PASSWORD);
      
      while (true) {
        await phantomPage.waitForTimeout(1000);
        const checkedElement = phantomPage.locator('xpath=//input[@aria-checked="true"]').first();

        if (await checkedElement.isVisible().catch(() => false)) {
          break;
        }

        const uncheckedElement = phantomPage.locator('xpath=//input[@aria-checked="false"]').first();

        if (await uncheckedElement.isVisible().catch(() => false)) {
          await uncheckedElement.click();
          continue;
        }

        await phantomPage.waitForTimeout(1000);
      }

      // 9. Tick điều khoản
      // element = phantomPage.locator('xpath=//input[@aria-checked="false"]').first();
      // await element.waitFor({ state: 'visible', timeout: 15000 });
      // await element.click();

      // 10. Submit tạo password
      element = phantomPage.locator('xpath=//button[@data-testid="onboarding-form-submit-button"]').first();
      await element.waitFor({ state: 'visible', timeout: 15000 });
      await element.click();

      await phantomPage.waitForTimeout(3000);

      element = phantomPage.locator('xpath=//button[@data-testid="onboarding-form-submit-button"]').first();
      await element.waitFor({ state: 'visible', timeout: 15000 });
      await element.click();

      // 11. Màn hoàn tất
      // element = phantomPage.locator('xpath=//*[text()="You\'re all done!" or text()="Continue"]').first();
      // await element.waitFor({ state: 'visible', timeout: 15000 });

      // // 12. Continue
      // element = phantomPage.locator('xpath=//*[@data-testid="onboarding-form-submit-button" or text()="Continue"]').first();
      // await element.waitFor({ state: 'visible', timeout: 15000 });
      // await element.click();

      log('[loginPhantom] Login Phantom hoàn tất.');
      return true;
      
    }


    

    
  } finally {
  // Active tab 1 trước
  if (page && !page.isClosed()) {
    await page.bringToFront().catch(() => {});
  }

  // Đóng Side Panel Phantom
  await phantomPage.evaluate(async () => {
    try {
      const currentWindow = await chrome.windows.getCurrent();

      if (chrome.sidePanel && chrome.sidePanel.close) {
        await chrome.sidePanel.close({
          windowId: currentWindow.id
        });
      }
    } catch (e) {}
  }).catch(() => {});

  // Sau cùng mới đóng tab Phantom
  if (!phantomPage.isClosed()) {
    await phantomPage.close().catch(() => {});
  }
}
}
module.exports = { loginPhantom };
