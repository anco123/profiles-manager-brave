while (true) {
    await page.waitForTimeout(6000);
    iterations++;
    if (iterations > maxIterations) {
        await debugShot('link-x-too-many-iterations');
        throw new Error(`Lặp lại quá ${maxIterations} lần vẫn chưa khớp/link được -- dừng lại, xem screenshot`);
    };

    await linkStateLabel.first().waitFor({state: 'visible',timeout: 20000}).catch(async () => {
        await debugShot('link-x-state-label-not-found');
        throw new Error('Không tìm thấy label trạng thái link X (qua icon X cố định) sau 20s');
    });

    const labelText = String((await linkStateLabel.first().textContent().catch(() => '')) || '').trim();
    if (labelText === LINK_TEXT) {
        await page.waitForTimeout(6000);
        const labelText = String((await linkStateLabel.first().textContent().catch(() => '')) || '').trim();
        if (labelText === LINK_TEXT) {
            log('Sau 10 giây label vẫn là "Link X(Twitter) Account" -> thử click link lại.');
            await linkStateLabel.first().click();
            log('Đã click lại "Link X(Twitter) Account".');
            await page.waitForTimeout(3000);
        }
    }

    // Thử chờ OAuth xuất hiện.
    // Nếu OAuth xuất hiện thì authorize lại.
    const oauthAgain = await oauthConsentBtn.first().isVisible().catch(() => false);
    if (oauthAgain) {
        await oauthConsentBtn.first().click();
        log('Đã click lại OAuth Consent Button.');
        await page.waitForTimeout(6000);
    }

    const hasConfirmSecond = await confirmSecondBtn.first().isVisible().catch(() => false);
    if (hasConfirmSecond) {
        await confirmSecondBtn.first().click();
        log(`Link X - lần quét ${check}/10: thấy confirmSecondBtn -> đã click.`);
        await page.waitForTimeout(6000);
    }


    const hasOauthConsentBtn = await oauthConsentBtn.first().isVisible().catch(() => false);
    if (hasOauthConsentBtn) {
        await oauthConsentBtn.first().click();
        log("đã click  oauthen ");
        await page.waitForTimeout(6000);
    }


    // 3. Nếu label đã trở thành username cần link
    const currentAfterLink = currentLabel.toLowerCase();
    if (currentLabel && currentAfterLink !== LINK_TEXT.toLowerCase() && currentAfterLink === expected) {
        await page.waitForTimeout(6000);
        if (currentLabel && currentAfterLink !== LINK_TEXT.toLowerCase() && currentAfterLink === expected) {
            log(`Link X thành công: username hiện tại = "${currentLabel}".`);
            linkSuccess = true;
            await page.waitForTimeout(3000);
            break;
        }
    }

    if (currentLabel && currentAfterLink !== LINK_TEXT.toLowerCase() && currentAfterLink !== expected) {
        await page.waitForTimeout(6000);
        if (currentLabel && currentAfterLink !== LINK_TEXT.toLowerCase() && currentAfterLink !== expected) {
            log('Chưa khớp -- gỡ link cũ để link lại.');
            await linkStateLabel.first().hover().catch(() => {});
            await page.waitForTimeout(300);
            await unlinkIcon.first().waitFor({ state: 'visible', timeout: 10000 }).catch(async () => {
                await debugShot('link-x-unlink-icon-not-found');
                throw new Error('Không tìm thấy nút gỡ link (unlink icon) sau 10s');
            });
            await unlinkIcon.first().click();
            log('Đã click nút gỡ link (unlink).');
            await page.waitForTimeout(6000);
        }
    }

}
