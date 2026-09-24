


let button01 = page.locator(`xpath=`)
const visible = await button01.waitFor({state: 'visible',timeout: 3000}).then(() => true).catch(() => false);