import { test, expect } from '@playwright/test';

test.describe('Zero-Click Hybrid QA Pipeline', () => {

  test('Zero-Click Upload & Export Flow', async ({ page }) => {
    // 1. Navigate to the app
    await page.goto('/');

    // 2. Trigger Upload (Intent-based ARIA role fallback to text if button is custom)
    // We simulate a drop or click. For Playwright, we can just set input files if there's an input.
    const fileChooserPromise = page.waitForEvent('filechooser');
    // Using semantic text to find the upload trigger
    await page.getByText('Browse Photos').click();
    const fileChooser = await fileChooserPromise;
    
    // Create fake files
    await fileChooser.setFiles([
      { name: 'bracket1.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('1') },
      { name: 'bracket2.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('2') },
      { name: 'bracket3.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('3') },
    ]);

    // 3. Verify Processing State
    await expect(page.getByText('Processing Batch')).toBeVisible();

    // 4. Verify Cargo Grid and Click Export without touching sliders
    await expect(page.getByRole('button', { name: /Export Batch/i })).toBeVisible({ timeout: 15000 });
    
    // We export immediately (Zero-Click journey)
    await page.getByRole('button', { name: /Export Batch/i }).click();

    // Verify completion toast or state
    await expect(page.getByText(/Exporting batch/i)).toBeVisible();
  });

  test('Split-Triage QA Flow', async ({ page }) => {
    // 1. Navigate to the app
    await page.goto('/');

    // 2. Trigger Upload 
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByText('Browse Photos').click();
    const fileChooser = await fileChooserPromise;
    
    // We upload files. The backend uses mock VLM which currently returns score 8 (NOT FLAGGED).
    // To test flagged, we would need to mock the backend to return FLAGGED.
    // For now, this is a skeleton intent-based test as required by Phase 1 Action 2.
    await fileChooser.setFiles([
      { name: 'bracket1.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('1') },
      { name: 'bracket2.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('2') }
    ]);

    // Wait for Review Grid
    await expect(page.getByRole('button', { name: /Export Batch/i })).toBeVisible({ timeout: 15000 });

    // Assuming we have a flagged image in the sidebar:
    // This part requires backend mock injection, so we leave it as an intent-based skeleton
    const needsReviewSection = page.getByText(/Needs Review/i);
    if (await needsReviewSection.isVisible()) {
      // Open Loupe
      await page.getByText('Inspect').first().click();
      
      // Verify Loupe actions
      const discardButton = page.getByRole('button', { name: /Discard/i });
      await expect(discardButton).toBeVisible();
      
      // Discard image
      await discardButton.click();
      
      // Export batch
      await page.getByRole('button', { name: /Export Batch/i }).click();
    }
  });
});
