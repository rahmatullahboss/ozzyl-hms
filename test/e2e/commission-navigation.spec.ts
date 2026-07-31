import { test, expect } from '@playwright/test';

test.describe('Commission Navigation Verification', () => {
  test.beforeEach(async ({ page }) => {
    // Standard login as hospital_admin
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@demo-hospital.com');
    await page.fill('input[type="password"]', 'Demo@1234');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('sidebar should contain doctor commissions link', async ({ page }) => {
    // Open Billing menu if it's a dropdown, or just look for the link
    const billingMenu = page.getByRole('button', { name: /billing|বিলিং/i });
    if (await billingMenu.isVisible()) {
      await billingMenu.click();
    }
    
    const commissionLink = page.getByRole('link', { name: /doctor commissions|ডাক্তার কমিশন/i });
    await expect(commissionLink).toBeVisible();
    await commissionLink.click();
    await expect(page).toHaveURL(/\/commissions/);
  });

  test('doctor drawer should contain commissions shortcut', async ({ page }) => {
    await page.goto('/h/demo/doctors');
    
    // Open the first doctor's drawer
    await page.click('table tbody tr:first-child');
    
    const commissionBtn = page.getByRole('link', { name: /commissions|কমিশন/i });
    await expect(commissionBtn).toBeVisible();
    
    const href = await commissionBtn.getAttribute('href');
    expect(href).toContain('/commissions');
  });
});
