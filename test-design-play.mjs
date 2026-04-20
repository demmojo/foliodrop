import { chromium } from '@playwright/test';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:3000');
  
  await page.waitForTimeout(2000);
  const html = await page.content();
  console.log('Upload text exists?', html.includes('Upload Photos'));
  console.log('Drag drop text exists?', html.includes("Drag and drop your photos"));
  
  await browser.close();
})();
