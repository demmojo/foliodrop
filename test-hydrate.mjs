import { chromium } from '@playwright/test';
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  
  // Set localStorage before loading the page to simulate returning user
  await page.goto('http://localhost:3000');
  await page.evaluate(() => {
    localStorage.setItem('folio-language', JSON.stringify({ state: { lang: 'es' }, version: 0 }));
  });
  
  await page.reload();
  await page.waitForTimeout(2000);
  
  const text1 = await page.locator('h1').innerText();
  console.log('H1 after reload with ES in localstorage:', text1);
  
  const text2 = await page.locator('text=Importar Exposiciones').count();
  console.log('ES text exists on load?', text2 > 0);
  
  await browser.close();
})();
