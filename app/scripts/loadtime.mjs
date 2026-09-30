import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const cdp = await page.context().newCDPSession(page);
// simulate a typical home connection
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: (20 * 1024 * 1024) / 8, uploadThroughput: (5 * 1024 * 1024) / 8 });
const t = Date.now();
await page.goto(process.argv[2] ?? 'http://localhost:4173/');
await page.waitForSelector('.home', { timeout: 120000 });
console.log('ready ms', Date.now() - t);
await browser.close();
