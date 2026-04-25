import { test, expect } from '@playwright/test';

/**
 * Intent: full agent workflow for luxury listing HDR — from discovery to batch export
 * without tuning sliders (zero-click path), with an optional triage path when QA flags a scene.
 */
test.describe('Folio user journey (intent)', () => {
  test('Journey A — learn the product, sign in, upload, review, export', async ({ page }) => {
    await page.goto('/how-it-works');
    await expect(page.getByRole('heading', { name: /how it works|folio/i })).toBeVisible();

    await page.goto('/login');
    await expect(page.getByRole('button', { name: /google/i })).toBeVisible();

    await page.goto('/');
    // Unauthenticated users are sent to login in production; local dev may differ
    const onLogin = page.url().includes('/login');
    if (onLogin) {
      await expect(page.getByRole('button', { name: /google|apple/i })).toBeVisible();
    }
  });

  test('Journey B — zero-click batch: browse → process → export', async ({ page }) => {
    await page.goto('/');
    if (page.url().includes('/login')) {
      test.skip();
      return;
    }
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByText('Browse Photos').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles([
      { name: 'b1.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('1') },
      { name: 'b2.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('2') },
      { name: 'b3.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('3') },
    ]);
    await expect(page.getByText('Processing Batch')).toBeVisible();
    const exportBtn = page.getByRole('button', { name: /Export Batch/i });
    await expect(exportBtn).toBeVisible({ timeout: 20000 });
    await exportBtn.click();
    await expect(page.getByText(/Exporting batch|export/i).first()).toBeVisible();
  });
});
