//Version 1.03 - 2022.08.18

const pt = require("puppeteer");
const fs = require("fs-extra");
const smtp = require("nodemailer");
const exec = require("child_process").exec;
let admin,
  transport,
  needTest = false,
  xfiTask = false,
  netgearTask = false,
  speeds;

async function run() {
  await adminCheck(); //checks for admin.json and speed-test npm requirement
  if (admin.smtp.mode) {
    await buildTransport(); //if smtp is enabled, builds the smtp transporter
  }
  await speedTest();  //runs speed test to see if the reboots are needed
  if (needTest) {
    pt.launch({
      headless: admin.show,
      args: [
        "--disable-web-security",
        "--disable-features=IsolateOrigins,site-per-process",
      ],
    }).then(async (browser) => {
      await adminCheck(); //check for admin.json file
      const p = await browser.newPage();
      if (admin.xfi.mode) {
        await xfiReboot(p);
        await browser.close();
        await p.waitForTimeout(300000); //wait 5 minutes for Xfi Gateway to reboot
        await xfiResult();
        await browser.close();
        if (admin.netgear.mode) {
          await netgearReboot(p);
          await browser.close();
          await p.waitForTimeout(300000); //wait 5 minutes for Netgear Router to reboot
          await netgearResult();
          await browser.close();
        }
      }
      await browser.close();
    });
  }
}

async function speedTest() {
  if(admin.speed.mode) {
    const speedResults = await runCmd("speed-test -j");
    const splitResults = speedResults.split(":");
    const ping = parseInt(splitResults[1].split(",")[0]);
    const down = parseInt(splitResults[2].split(",")[0]);
    const up = parseInt(splitResults[3].split("}")[0]);
    speeds = `P:${ping}  D:${down}  U:${up}`;
    if (
      ping < admin.speed.ping &&
      down > admin.speed.down &&
      up > admin.speed.up
    ) {
      speedTest = true;
    } else {
      speedTest = false;
      result("Speed Test", speedTest);
    }
  } else {
    speedTest = true;
  }
}

async function adminCheck() {
  const npmList = await runCmd("npm list -g");
  if (!npmList.includes("speed-test@")) {
    await runCmd("npm install speed-test -g");
  }
  if (!fs.existsSync("./admin.json")) {
    await fs.writeFile("admin.json", fs.readFileSync("admin-template.json"));
    await adminCheck();
  } else {
    admin = require("../admin.json");
    if (admin.xfi.pass == "password" && admin.netgear.pass == "password") {
      await fs.writeFile(
        "__FIX YOUR ADMIN.JSON__.txt",
        "Your admin.json is still the default settings, please update!"
      );
    } else {
      if (fs.existsSync("__FIX YOUR ADMIN.JSON__.txt")) {
        fs.rm("__FIX YOUR ADMIN.JSON__.txt", { force: true });
      }
    }
  }
}

async function xfiLogin(page) {
  await page.setViewport({ width: 1000, height: 500 });
  await page.goto(`http://${admin.xfi.ip}`);
  await page.click("#username");
  await page.keyboard.type(admin.xfi.user);
  await page.click("#password");
  await page.keyboard.type(admin.xfi.pass);
  await page.click("#pageForm > div.form-btn > input");
}

async function xfiReboot(page) {
  await xfiLogin(page);
  await page.waitForSelector("#internet-usage > div > a", { visible: true });
  await page.goto(`http://${admin.xfi.ip}/restore_reboot.jst`);
  await page.waitForSelector("#btn1", { visible: true });
  await page.click("#btn1");
  await page.waitForTimeout(500);
  await page.click("#popup_ok");
  await page.waitForTimeout(50000);
}

async function xfiResult() {
  try {
    pt.launch({ headless: false }).then(async (browser) => {
      const p = await browser.newPage();
      await xfiLogin(p);
      await p.waitForSelector(
        "#at-a-glance-switch > a:nth-child(1) > li > label",
        { visible: true }
      );
      await p.goto(`http://${admin.xfi.ip}/network_setup.jst`);
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
        xfiTask = true;
      } else {
        xfiTask = false;
      }
      await result("XFi Gateway Reboot", xfiTask);
      await browser.close();
    });
  } catch {
    xfiTask = false;
    await result("XFi Gateway Reboot", xfiTask);
  }
}

async function netgearLogin(page) {
  await page.setViewport({ width: 1000, height: 500 });
  await page.authenticate({
    username: admin.netgear.user,
    password: admin.netgear.pass,
  });
  await page.goto(`http://${admin.netgear.ip}/adv_index.htm`);
}

async function netgearReboot(page) {
  await netgearLogin(page);
  const frame = await page
    .frames()
    .find((frame) => frame.name() === "formframe");
  await frame.waitForTimeout(5000);
  await frame.click("#reboot");
  await frame.waitForTimeout(5000);
  await frame.click("#yes");
}

async function netgearResult() {
  try {
    pt.launch({ headless: false }).then(async (browser) => {
      const p = await browser.newPage();
      await netgearLogin(p);
      const frame = await p
        .frames()
        .find((frame) => frame.name() === "formframe");
      await frame.waitForTimeout(5000);
      let grab = await frame.evaluate(
        () => document.querySelector("*").textContent
      );
      const time = grab.split("System Uptime")[1].substring(0, 3);
      if (time.includes("00")) {
        netgearTask = true;
      } else {
        netgearTask = false;
      }
      await result("Netgear Router Reboot", netgearTask);
      await browser.close();
    });
  } catch {
    netgearTask = false;
    await result("Netgear Router Reboot", netgearTask);
  }
}

async function buildTransport() {
  transport = smtp.createTransport({
    host: admin.smtp.server,
    port: admin.smtp.port,
    secure: admin.smtp.ssl,
    auth: {
      user: admin.smtp.user,
      pass: admin.smtp.pass,
    },
  });
}

async function result(type, task) {
  if (admin.smtp.mode) {
    const today = new Date();
    let title, theResult;
    title = "FAILURE";
    if(admin.speed.mode) {
      theResult = `failed!\n\nSpeed Test Results Before Test: ${speeds}`
    } else {
      theResult = "failed!"
    }
    if (type.includes("Reboot")) {
      if (task) {
        if(admin.speed.mode) {
          theResult = `was successful!\n\nSpeed Test Results Before Test: ${speeds}`;
        } else {
          theResult = "was successful!"
        }
        title = "SUCCESS";
      }
    } else {
      if (!task) {
        theResult = `${speeds
          .replace("P:", "Ping: ")
          .replace("D:", "Download: ")
          .replace("U:", "Upload: ")}\n\nNo Reboots Were Needed!`;
        title = `NO ACTION - ${speeds}`;
      }
    }
    let info = await transport.sendMail({
      from: admin.smtp.user,
      to: admin.smtp.to,
      subject: `${type} ${today.getMonth()}/${today.getDate()}/${today.getFullYear()} - ${title}`,
      text: `${type} ${theResult}`,
    });
  }
}

async function runCmd(cmd) {
  return new Promise((resolve, reject) => {
    let result = "";
    const child = exec(`${cmd}`);
    child.stdout.on("data", function (data) {
      result += data.replace(/[\n\r]+/g, "");
    });
    return child.on("close", function () {
      resolve(result);
    });
  });
}

run();
