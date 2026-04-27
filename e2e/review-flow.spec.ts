import { test, expect } from '@playwright/test';

const TINY_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBUQEA8VFRUVFRUVFRUVFRUWFxUVFRUYFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGhAQGysmICYtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAXAAEBAQEAAAAAAAAAAAAAAAAAAQID/8QAFhEBAQEAAAAAAAAAAAAAAAAAABEB/9oADAMBAAIQAxAAAAGfA//EABQQAQAAAAAAAAAAAAAAAAAAACD/2gAIAQEAAQUCx//EABQRAQAAAAAAAAAAAAAAAAAAACD/2gAIAQMBAT8Bp//EABQRAQAAAAAAAAAAAAAAAAAAACD/2gAIAQIBAT8Bp//Z';

const jpegBuffer = Buffer.from(TINY_JPEG_BASE64, 'base64');

test.describe('Review Flow', () => {
  test('processes upload and reaches review grid', async ({ page }) => {
    await page.goto('/');
    if (page.url().includes('/login')) test.skip();

    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByText(/browse files/i).click();
    const chooser = await chooserPromise;
    await chooser.setFiles([
      { name: 'b1.jpg', mimeType: 'image/jpeg', buffer: jpegBuffer },
      { name: 'b2.jpg', mimeType: 'image/jpeg', buffer: jpegBuffer },
    ]);

    await expect(page.getByText(/ready for fusion/i)).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: /commence processing/i }).click();
    await expect(page.getByText(/processing your shoot/i)).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/ready for export/i)).toBeVisible({ timeout: 60000 });
  });

  test('proactively refreshes expiring signed urls with scoped auth headers', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('hdr_session_code', 'resume-session');
    });

    await page.route('**/api/v1/sessions/generate', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 'resume-session' }) });
    });
    await page.route('**/api/v1/jobs/active?session_id=resume-session', async (route) => {
      const nowSec = Math.floor(Date.now() / 1000);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jobs: [
            {
              id: 'job-expiring',
              status: 'COMPLETED',
              result: {
                room: 'Kitchen',
                url: 'http://localhost:3000/expired-final.jpg',
                thumb_url: 'http://localhost:3000/expired-thumb.jpg',
                original_url: 'http://localhost:3000/expired-original.jpg',
                blob_path: 'resume-session/hdr.jpg',
                thumb_blob_path: 'resume-session/thumb.jpg',
                original_blob_path: 'resume-session/original.jpg',
                url_expires_at: nowSec + 30,
                thumb_url_expires_at: nowSec + 30,
                original_url_expires_at: nowSec + 30,
              },
            },
          ],
        }),
      });
    });
    await page.route('**/api/v1/jobs/batch-signed-url', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          urls: [{ path: 'resume-session/thumb.jpg', url: 'http://localhost:3000/new-thumb.jpg', expires_at: 9999999999 }],
        }),
      });
    });
    await page.route('**/expired-*.jpg', async (route) => {
      await route.fulfill({ status: 403, contentType: 'text/plain', body: 'expired' });
    });
    await page.route('**/new-thumb.jpg', async (route) => {
      await route.fulfill({ status: 200, contentType: 'image/jpeg', body: jpegBuffer });
    });

    const signedUrlRequest = page.waitForRequest((req) => req.url().includes('/api/v1/jobs/batch-signed-url'));
    await page.goto('/');
    if (page.url().includes('/login')) test.skip();
    await page.getByRole('button', { name: /continue in session/i }).click();
    await expect(page.getByText(/ready for export/i)).toBeVisible({ timeout: 10000 });

    const req = await signedUrlRequest;
    const headers = req.headers();
    expect(Boolean(headers['authorization'] || headers['x-agency-id'])).toBeTruthy();
  });
});
