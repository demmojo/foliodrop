import { chromium } from '@playwright/test';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:3000');
  
  await page.waitForTimeout(1000);
  
  // Click the select to open it
  await page.click('select');
  await page.waitForTimeout(500);
  
  // Try selecting by value
  await page.selectOption('select', 'es');
  await page.waitForTimeout(1000);
  
  const val = await page.$eval('select', el => el.value);
  console.log("Select value:", val);
  
  const text2 = await page.locator('text=Importar Exposiciones').count();
  console.log('ES Importar Exposiciones exists?', text2 > 0);
  
  await browser.close();
})();
