
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Navigate to the local server
  await page.goto("http://localhost:8000");

  // Wait for animations to settle
  await page.waitForTimeout(1000);

  // Click the start button once it's enabled, forcing the click to bypass animation checks
  await page.locator('#startGameBtn:not([disabled])').click({ force: true });

  // Wait for the tutorial modal to be visible
  await page.waitForSelector('#tutorialModal.open', { state: 'visible' });

  // Take a screenshot of the modal
  await page.screenshot({ path: "/home/jules/verification/screenshot.png" });

  // Now click the button to close it
  await page.click('#tutorialBtn');

  // Wait for the topbar to be visible, indicating the game has started
  await page.waitForSelector('#topbar', { state: 'visible' });

  await browser.close();
})();
