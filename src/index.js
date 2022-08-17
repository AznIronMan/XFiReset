//Version 1.01 - 2022.08.16

const pt = require("puppeteer");
const fs = require("fs-extra");
const smtp = require("nodemailer");
let admin = require("./admin.json");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let task = false;

async function run() {
  pt.launch({ headless: admin.dev }).then(async (browser) => {
    await adminCheck(); //check for admin.json file
    const p = await browser.newPage();
    await login(p);
    await p.waitForSelector("#internet-usage > div > a", { visible: true });
    await p.goto(`http://${admin.router.ip}/restore_reboot.jst`);
    await p.waitForSelector("#btn1", { visible: true });
    await p.click("#btn1");
    await p.waitForTimeout(500);
    await p.click('#popup_ok');
    await p.waitForTimeout(50000);
    await browser.close();
    await delay(300000);    //wait 5 minutes for Xfi Gateway to reboot
    await diditWork();
    await browser.close();
  });
}

async function adminCheck() {
  if (!fs.existsSync("../admin.json")) {
    //TO DO: add something to generate admin.json here with prompts?
    console.log(
      "File admin.json missing.  Please download from Github or create from scratch."
    );
    process.exit(1);
  }
}

async function login(page) {
  await page.setViewport({ width: 1000, height: 500 });
  await page.goto(`http://${admin.router.ip}`);
  await page.click("#username");
  await page.keyboard.type(admin.creds.user);
  await page.click("#password");
  await page.keyboard.type(admin.creds.pass);
  await page.click("#pageForm > div.form-btn > input");
}

async function diditWork() {
  try {
    pt.launch({ headless: false }).then(async (browser) => {
      const p = await browser.newPage();
      await login(p);
      await p.waitForSelector(
        "#at-a-glance-switch > a:nth-child(1) > li > label",
        { visible: true }
      );
      await p.goto(`http://${admin.router.ip}/network_setup.jst`);
      await p.waitForSelector(
        "#content > div:nth-child(8) > table > tbody > tr:nth-child(4) > th",
        { visible: true }
      );
      let grab = await p.evaluate(() => document.querySelector("*").innerHTML);
      const time = grab
        .split('<span class="readonlyLabel">System Uptime:</span>')[1]
        .replace(/[\r\n\x0B\x0C\u0085\u2028\u2029]+/g, "")
        .replace('<span class="value">', "")
        .substring(0, 26);
      if (time.includes(" 0h")) {
        task = true;
      } else {
        task = false;
      }
      await result();
    });
  } catch {
    task = false;
    await result();
  }
}

async function result() {
  const t = smtp.createTransport({
    host: admin.smtp.server,
    port: admin.smtp.port,
    secure: admin.smtp.ssl,
    auth: {
      user: admin.smtp.user,
      pass: admin.smtp.pass,
    },
  });
  const today = new Date();
  let title = "FAILURE";
  let theResult = "failed!";
  if (task) {
    theResult = "was successful!";
    title = "SUCCESS";
  }
  let info = await t.sendMail({
    from: admin.smtp.user,
    to: admin.smtp.to,
    subject: `XFi Daily Reboot ${today.getMonth()}/${today.getDate()}/${today.getFullYear()} - ${title}`,
    text: `Your daily reboot of your XFi Gateway ${theResult}`,
  });
}

run();
