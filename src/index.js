//Version 1.04 - 2022.08.18

const pt = require("puppeteer");
const fs = require("fs-extra");
const smtp = require("nodemailer");
const logger = require("node-logger").createLogger(
  `${dateMaker(new Date())}.log`
);
logger.format = function (level, date, message) {
  return `[${level} ${date.getHours().toString()}:${date
    .getMinutes()
    .toString()}:${date.getSeconds().toString()}]${message}`;
};
const exec = require("child_process").exec;
let admin,
  transport,
  needTest = false,
  xfiTask = false,
  netgearTask = false,
  speeds;

async function run() {
  await adminCheck(); //checks for admin.json and speed-test npm requirement
  lg("Starting Run...");
  if (admin.smtp.mode) {
    lg("Building SMTP transport.");
    await buildTransport(); //if smtp is enabled, builds the smtp transporter
    lg("SMTP transport has been built.");
  }
  needTest = await speedTest(); //runs speed test to see if the reboots are needed
  if (needTest) {
    lg(`Starting Virtual Browser (Headless: ${admin.show}`);
    pt.launch({
      headless: admin.show,
      args: [
        "--disable-web-security",
        "--disable-features=IsolateOrigins,site-per-process",
      ],
    }).then(async (browser) => {
      await adminCheck(); //check for admin.json file
      const p = await browser.newPage();
      lg(`XFi:  ${admin.xfi.mode}`);
      lg(`Netgear:  ${admin.netgear.mode}`);
      if (admin.xfi.mode) {
        await xfiReboot(p);
        await browser.close();
        await p.waitForTimeout(300000); //wait 5 minutes for Xfi Gateway to reboot
        await xfiResult();
        await browser.close();
        if (admin.netgear.mode) {
          const q = await browser.newPage();
          await netgearReboot(q);
          await browser.close();
          await q.waitForTimeout(300000); //wait 5 minutes for Netgear Router to reboot
          await netgearResult();
          await browser.close();
        }
      }
      await browser.close();
    });
  }
}

async function speedTest() {
  if (admin.speed.mode) {
    lg("Running Speed Test...");
    const speedResults = await runCmd("fast --upload --json");
    const splitResults = speedResults.split(":");
    const ping = parseInt(splitResults[5].split(",")[0]);
    const down = parseInt(splitResults[1].split(",")[0]);
    const up = parseInt(splitResults[2].split("}")[0]);
    const pingResult = ping > admin.speed.ping;
    const downResult = down < admin.speed.down;
    const upResult = up < admin.speed.up;
    lg("Speed Test Complete...");
    lg(
      `Ping: ${ping} Down: ${down} Up: ${up} Results: [${pingResult},${downResult},${upResult}]`
    );
    let decision = false;
    speeds = `P:${ping}  D:${down}  U:${up}`;
    if (!decision && pingResult) {
      decision = true;
    }
    if (!decision && downResult) {
      decision = true;
    }
    if (!decision && upResult) {
      decision = true;
    }
    if (decision) {
      lg("Result show that SpeedTest is Required. #True");
      return true;
    } else {
      lg("Result show that SpeedTest is NOT Required. #False");
      result("Speed Test", false);
    }
  } else {
    lg("Speed Test Check Disabled, Reboots are required!");
    return true;
  }
}

async function adminCheck() {
  const npmList = await runCmd("npm list -g");
  if (!npmList.includes("fast-cli@")) {
    await runCmd("npm install fast-cli -g");
  }
  if (!fs.existsSync("./admin.json")) {
    await fs.writeFile("admin.json", fs.readFileSync("admin-template.json"));
    await adminCheck();
  } else {
    admin = require("../admin.json");
    if (admin.xfi.pass == "password" && admin.netgear.pass == "password") {
      lg(
        "admin.json is still in raw format, please update admin.json to continue!"
      );
      await fs.writeFile(
        "__FIX YOUR ADMIN.JSON__.txt",
        "Your admin.json is still the default settings, please update!"
      );
    } else {
      if (fs.existsSync("__FIX YOUR ADMIN.JSON__.txt")) {
        lg("Removing fix admin.json reminder since it has been configured.");
        fs.rm("__FIX YOUR ADMIN.JSON__.txt", { force: true });
      }
    }
  }
}

async function xfiLogin(page) {
  lg("XFi Login Start.");
  await page.setViewport({ width: 1000, height: 500 });
  await page.goto(`http://${admin.xfi.ip}`);
  await page.click("#username");
  await page.keyboard.type(admin.xfi.user);
  await page.click("#password");
  await page.keyboard.type(admin.xfi.pass);
  await page.click("#pageForm > div.form-btn > input");
  lg("XFi Login End.");
}

async function xfiReboot(page) {
  lg("XFi Reboot Start.");
  await xfiLogin(page);
  await page.waitForSelector("#internet-usage > div > a", { visible: true });
  await page.goto(`http://${admin.xfi.ip}/restore_reboot.jst`);
  await page.waitForSelector("#btn1", { visible: true });
  await page.click("#btn1");
  await page.waitForTimeout(500);
  await page.click("#popup_ok");
  lg("XFi Reboot Waiting...");
  await page.waitForTimeout(50000);
  lg("XFi Reboot End.");
}

async function xfiResult() {
  lg("XFi Result Start");
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
      lg("XFi Result End - Success");
    });
  } catch (ex) {
    xfiTask = false;
    await result("XFi Gateway Reboot", xfiTask);
    lg(`XFi Result End - Exception: ${ex}`);
  }
}

async function netgearLogin(page) {
  lg("Netgear Login Start.");
  await page.setViewport({ width: 1000, height: 500 });
  await page.authenticate({
    username: admin.netgear.user,
    password: admin.netgear.pass,
  });
  await page.goto(`http://${admin.netgear.ip}/adv_index.htm`);
  lg("Netgear Login End.");
}

async function netgearReboot(page) {
  lg("Netgear Reboot Start.");
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
      lg("Netgear Reboot End - Success.");
    });
  } catch (ex) {
    netgearTask = false;
    await result("Netgear Router Reboot", netgearTask);
    lg(`Netgear Reboot End - Exception ${ex}`);
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
  lg(`Results for ${type}...`);
  const today = new Date();
  let title, theResult;
  title = "FAILURE";
  if (admin.speed.mode) {
    theResult = `failed!\n\nSpeed Test Results Before Test: ${speeds}`;
  } else {
    theResult = "failed!";
  }
  if (type.includes("Reboot")) {
    if (task) {
      if (admin.speed.mode) {
        theResult = `was successful!\n\nSpeed Test Results Before Test: ${speeds}`;
      } else {
        theResult = "was successful!";
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
  lg(theResult);
  if (admin.smtp.mode) {
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

function dateMaker(rawDate) {
  const date = ("0" + rawDate.getDate()).slice(-2);
  const month = ("0" + (rawDate.getMonth() + 1)).slice(-2);
  const year = rawDate.getFullYear();
  const hours = rawDate.getHours();
  const minutes = rawDate.getMinutes();
  const seconds = rawDate.getSeconds();
  console.log(`${year}${month}${date}_${hours}${minutes}${seconds}`);
  return `${year}${month}${date}_${hours}${minutes}${seconds}`;
}

function lg(loginfo) {
  if (admin.log) {
    logger.info(loginfo);
  }
}

run();
