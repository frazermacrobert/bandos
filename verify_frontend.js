
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Navigate to the local server
  await page.goto("http://localhost:8000");

  // Click the start button
  await page.click("#startGameBtn");

  // Wait for the topbar to be visible, indicating the game has started
  await page.waitForSelector('#topbar', { state: 'visible' });

  // Take a screenshot
  await page.screenshot({ path: "/home/jules/verification/screenshot.png" });

  await browser.close();
})();
