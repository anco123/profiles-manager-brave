// const { confirmPhantom } = require('./xlv2_phantomConfirm');



// module.exports = { confirmPhantom };

async function bindTesseract(page, context, log) {
    async function loginTesseract(page, context, log) {
        const PHANTOM_ID = 'bfnaelmomeimhlpmgjnjophhpkkoljpa';
        //const startTime = Date.now();

        await page.goto(`https://tesserapp.org/`,
            {
                waitUntil: 'domcontentloaded',
                timeout: 15000
            }
            );

            const startTime = Date.now();
        while (Date.now() - startTime < 20000) {

            // await confirmPhantom(page, context, log);

            // =====================================================
            // 1. BREAK
            // =====================================================
            const walletElement = page
            .locator('xpath=//*[contains(@href,"/u/wallet")]')
            .first();

            if (await walletElement.isVisible().catch(() => false)) {
            log('[Phantom] Wallet đã kết nối -> BREAK.');
            break;
            }


            // =====================================================
            // 2. ELEMENT TRÊN WEB
            // =====================================================
            const signInElement = page
            .locator('xpath=//*[text()="Live"]/../..//*[text()="Sign in"]')
            .first();

            const signInWithWalletElement = page
            .locator('xpath=//*[text()="Sign in with wallet" or text()="Continue with wallet"]')
            .first();

            const hasSignIn = await signInElement
            .isVisible()
            .catch(() => false);

            const hasSignInWithWallet = await signInWithWalletElement
            .isVisible()
            .catch(() => false);


            // // =====================================================
            // // 3. TÌM PHANTOM POPUP
            // // =====================================================
            const phantomPopup = context
              .pages()
              .slice()
              .reverse()
              .find(p =>
                !p.isClosed() &&
                p.url().startsWith(`chrome-extension://${PHANTOM_ID}/`)
              );

            let unlockInput = null;
            let primaryButton = null;

            let hasUnlockInput = false;
            let hasPrimaryButton = false;

            if (phantomPopup) {
              unlockInput = phantomPopup
                .locator('xpath=//input[@data-testid="unlock-form-password-input"]')
                .first();

              primaryButton = phantomPopup
                .locator('xpath=//button[@data-testid="primary-button"]')
                .first();

              hasUnlockInput = await unlockInput
                .isVisible()
                .catch(() => false);

              hasPrimaryButton = await primaryButton
                .isVisible()
                .catch(() => false);
            }


            // =====================================================
            // 4. SIGN IN WITH WALLET
            // =====================================================
            if (hasSignInWithWallet) {
            await signInWithWalletElement.click();

            log('[Phantom] Click Sign in with wallet.');

            await page.waitForTimeout(3000);
            continue;
            }


            // // =====================================================
            // // 5. PHANTOM UNLOCK
            // // =====================================================
            if (hasUnlockInput) {
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


            // // =====================================================
            // // 6. PHANTOM PRIMARY BUTTON
            // // =====================================================
            if (hasPrimaryButton) {
              await phantomPopup.bringToFront();

              await primaryButton.click();

              log('[Phantom] Đã click primary-button.');

              await page.waitForTimeout(3000);
              continue;
            }


            // =====================================================
            // 7. SIGN IN - CHỈ CLICK KHI KHÔNG CÓ TẤT CẢ ELEMENT KHÁC
            // =====================================================
            if (
                hasSignIn &&
                !hasSignInWithWallet &&
                !hasUnlockInput &&
                !hasPrimaryButton
                ) {
                log('[Phantom] Tạm thấy chỉ có Sign in -> chờ 2s để xác nhận lại.');

                await page.waitForTimeout(2000);

                // Check lại Sign in
                const signInElementCheck = page
                    .locator('xpath=//*[text()="Live"]/../..//*[text()="Sign in"]')
                    .first();

                const hasSignInCheck = await signInElementCheck
                    .isVisible()
                    .catch(() => false);

                // Check lại Sign in with wallet
                const signInWithWalletElementCheck = page
                    .locator('xpath=//*[text()="Sign in with wallet"]')
                    .first();

                const hasSignInWithWalletCheck = await signInWithWalletElementCheck
                    .isVisible()
                    .catch(() => false);

                // Check lại popup Phantom
                const phantomPopupCheck = context
                    .pages()
                    .slice()
                    .reverse()
                    .find(p =>
                    !p.isClosed() &&
                    p.url().startsWith(`chrome-extension://${PHANTOM_ID}/`)
                    );

                let hasUnlockInputCheck = false;
                let hasPrimaryButtonCheck = false;

                if (phantomPopupCheck) {
                    const unlockInputCheck = phantomPopupCheck
                    .locator('xpath=//input[@data-testid="unlock-form-password-input"]')
                    .first();

                    const primaryButtonCheck = phantomPopupCheck
                    .locator('xpath=//button[@data-testid="primary-button"]')
                    .first();

                    hasUnlockInputCheck = await unlockInputCheck
                    .isVisible()
                    .catch(() => false);

                    hasPrimaryButtonCheck = await primaryButtonCheck
                    .isVisible()
                    .catch(() => false);
                }

                // Lần 2 vẫn đúng y hệt mới click Sign in
                if (
                    hasSignInCheck &&
                    !hasSignInWithWalletCheck &&
                    !hasUnlockInputCheck &&
                    !hasPrimaryButtonCheck
                ) {
                    await page.bringToFront();

                    await signInElementCheck.click();

                    log('[Phantom] Check 2 lần đều chỉ có Sign in -> Click Sign in.');

                    await page.waitForTimeout(3000);
                }

                continue;
                }


            // Không có gì để làm -> check lại
            await page.waitForTimeout(200);
        }
        }
    await loginTesseract(page, context, log);

   // =====================================================
    // BIND TO TESSERACT
    // =====================================================

    // =====================================================
    // 8. CLICK WALLET
    // =====================================================
    // let element = page
    //     .locator('xpath=//*[contains(@href,"/u/wallet")]')
    //     .first();

    // await element.waitFor({
    //     state: 'visible',
    //     timeout: 15000
    //     });

    // await element.click();

    // element = page
    //     .locator('xpath=//*[text()="X / Twitter"]')
    //     .first();

    // await element.waitFor({
    //     state: 'visible',
    //     timeout: 15000
    //     });

    // log('[Twitter] Click Wallet.');

    // await page.waitForTimeout(3000);




    // =====================================================
    // 9. LINK X / TWITTER
    // =====================================================
    // while (true) {

    //     const linkedElement = page
    //         .locator('xpath=//*[text()="X / Twitter"]/../..//*[text()=" linked "]')
    //         .first();

    //     if (await linkedElement.isVisible().catch(() => false)) {
    //         log('[Twitter] X / Twitter đã Linked -> BREAK.');
    //         break;
    //     }


    //     const openElement = page
    //         .locator('xpath=//*[text()="X / Twitter"]/../..//*[text()=" open "]')
    //         .first();

    //     if (await openElement.isVisible().catch(() => false)) {

    //         element = page
    //         .locator('xpath=//*[text()="Link X"]')
    //         .first();

    //         if (await element.isVisible().catch(() => false)) {
    //         await element.click();

    //         log('[Twitter] Click Link X.');

    //         await page.waitForTimeout(3000);
    //         continue;
    //         }
    //     }


    //     element = page
    //         .locator('xpath=//*[text()="Authorize app"]')
    //         .first();

    //     if (await element.isVisible().catch(() => false)) {
    //         await element.click();

    //         log('[Twitter] Click Authorize app.');

    //         await page.waitForTimeout(3000);
    //         continue;
    //     }


    //     await page.waitForTimeout(200);
    //     }
}

module.exports = { bindTesseract };