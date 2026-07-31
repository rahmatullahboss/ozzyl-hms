import { test, expect } from '@playwright/test';

const BASE_URL = process.env['BASE_URL'] || 'https://hms-saas-production.rahmatullahzisan.workers.dev';

test.describe('🩺 Smoke — Clinical Assessments (/clinical)', () => {
  test('returns 200 OK or redirects to login', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/clinical`);
    const status = response.status();
    
    // Unauthenticated access might return 302/307 (redirect to login) or 200 (if handled client-side)
    expect([200, 302, 307, 308]).toContain(status);
  });
  
  test('static assets load successfully', async ({ page }) => {
    const res = await page.goto(`${BASE_URL}/clinical`);
    
    // Basic verification that the app shell loads without catastrophic failure
    expect(res?.status()).toBeLessThan(400);
    
    // Check if body is present
    const body = await page.$('body');
    expect(body).not.toBeNull();
  });
});
