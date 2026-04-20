import { test, expect } from '@playwright/test';

test.describe('Folio App - Full Flow', () => {

  test('completes full upload, processing, and review flow with real backend', async ({ page }) => {
    // 1. Navigate to the app
    await page.goto('/');

    // 2. Verify Initial State
    await expect(page.locator('h1')).toContainText('Folio');
    await expect(page.getByText('Upload Photos', { exact: false })).toBeVisible();

    // 3. Simulate Drag and Drop to trigger Flow A (Confirmation Gate)
    // Instead of mocking, we let it hit the real `uvicorn` backend running with TESTING=true
    await page.evaluate(() => {
      const dropzone = document.querySelector('[data-testid="dropzone"]');
      if (dropzone) {
        const file1 = new File(['1'], 'ev-2.jpg', { type: 'image/jpeg' });
        const file2 = new File(['2'], 'ev0.jpg', { type: 'image/jpeg' });
        const file3 = new File(['3'], 'ev+2.jpg', { type: 'image/jpeg' });
        const dt = new DataTransfer();
        dt.items.add(file1);
        dt.items.add(file2);
        dt.items.add(file3);
        
        const dropEvent = new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
        });
        Object.defineProperty(dropEvent, 'dataTransfer', { value: dt });
        dropzone.dispatchEvent(dropEvent);
      }
    });

    // 4. Verify Confirmation Gate and stats (3 brackets -> 1 photo)
    await expect(page.getByText('Ready to Enhance')).toBeVisible();
    await expect(page.getByText('Uploaded Photos')).toBeVisible();
    await expect(page.getByText('3', { exact: true })).toBeVisible(); // 3 brackets

    // 5. Start Processing
    const startButton = page.getByTestId('begin-processing');
    await expect(startButton).toBeVisible();
    await startButton.click();

    // 6. Verify Processing Console (Flow B)
    await expect(page.getByText('Enhancing Photos')).toBeVisible();
    
    // The console takes ~2.5 seconds to complete (6 stages * 0.4s delay)
    // We wait for the review grid to appear
    await expect(page.getByText('Your Enhanced Photos')).toBeVisible({ timeout: 10000 });

    // 7. Verify Review Grid (Flow C)
    await expect(page.getByText('Property')).toBeVisible();
    await expect(page.getByText('Download All (ZIP)')).toBeVisible();
  });
});
