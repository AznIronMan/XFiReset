const pt = require('puppeteer')
let admin = require('./admin.json')
pt.launch({headless:true}).then(async browser => {
    const p = await browser.newPage();
    await p.setViewport({ width: 1000, height: 500 })
    await p.goto(`http://${admin.router.ip}`)
    await p.click('#username')
    await p.keyboard.type(admin.creds.user)
    await p.click('#password')
    await p.keyboard.type(admin.creds.pass)
    await p.click('#pageForm > div.form-btn > input')
    await p.waitForSelector('#internet-usage > div > a', { visible : true,})
    await p.goto(`http://${admin.router.ip}/restore_reboot.jst`)
    await p.waitForSelector('#btn1', {visible:true,})
    await p.click('#btn1')
    await p.waitForTimeout(500);
    await p.click('#popup_ok')
    await browser.close()
 })