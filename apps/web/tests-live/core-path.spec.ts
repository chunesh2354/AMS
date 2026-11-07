import { test, expect, type Page } from '@playwright/test';

const PASSWORD = 'meridian-demo-2026';
const shot = (page: Page, name: string) => page.screenshot({ path: `../../docs/ui-screens/live-${name}.png`, fullPage: true });

async function login(page: Page, who: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(`${who}@meridian.demo`);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (password === PASSWORD) await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

test.describe.configure({ mode: 'serial' });

test('1. staff login, my time, edit persists, submit locks', async ({ page }) => {
  await login(page, 'p04', 'wrong-password');
  await expect(page.getByRole('alert')).toBeVisible();
  await shot(page, 'login-error');
  await login(page, 'p04');
  await expect(page).toHaveURL(/\/me\/home/);
  await expect(page.getByRole('navigation').getByText('Firm', { exact: true })).toHaveCount(0);
  await page.goto('/me/time');
  await expect(page.getByText('38.50').first()).toBeVisible();
  await shot(page, 'my-time');
});

test('6. unconnected route shows sample banner; sign out requires login', async ({ page }) => {
  await login(page, 'p10');
  await expect(page).toHaveURL(/\/firm\/overview/);
  await page.goto('/firm/people');
  await expect(page.getByText('Sample data. This screen is not connected to the database yet.')).toBeVisible();
  await shot(page, 'sample-banner');
  await page.getByRole('button', { name: /account|avatar|menu/i }).first().click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/firm/billing');
  await expect(page).toHaveURL(/\/login/);
});

test('4a. finance sees live billing ready total', async ({ page }) => {
  await login(page, 'p10');
  await page.goto('/firm/billing');
  await expect(page.getByText('4,86,000').first()).toBeVisible();
  await shot(page, 'billing-ready');
});

test('5a. receivables shows INV-DEMO-0007', async ({ page }) => {
  await login(page, 'p10');
  await page.goto('/firm/receivables');
  await expect(page.getByText('INV-DEMO-0007').first()).toBeVisible();
  await expect(page.getByText('1,60,000').first()).toBeVisible();
  await shot(page, 'receivables');
});

test('2a. PM sees approvals; PRJ-01 contribution restricted', async ({ page }) => {
  await login(page, 'p02');
  await page.goto('/firm/approvals');
  await shot(page, 'approvals');
  await page.goto('/firm/projects/PRJ-01');
  await expect(page.getByText('Restricted').first()).toBeVisible();
  await shot(page, 'project-restricted');
});
