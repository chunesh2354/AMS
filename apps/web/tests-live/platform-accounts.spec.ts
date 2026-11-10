import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';

/**
 * The platform admin's control over a studio's people (migration 009), on a real database: the admin opens Studio
 * Meridian (DEMO), sees its people, hands an employee a one-time reset link (the employee sets the password, the admin
 * never sees it), disables and enables an account, and is refused when trying to disable the only principal.
 * Runs with playwright.live.config.ts (its own API and throwaway database). Takes no screenshots and writes nothing
 * under docs/.
 *
 * The reset uses Karan Bhat (P06), whom no other live spec signs in as, and puts his demo password back at the end so a
 * rerun or a later spec still finds the seed as it was. Divya Menon (P05) ends enabled with her demo password.
 */
const PASSWORD = 'meridian-demo-2026';
const NEW_PASSWORD = 'karan-reset-by-link-2026';
const BASE = 'http://localhost:4273';
const STUDIO = 'Studio Meridian (DEMO)';
const LAST_PRINCIPAL = 'The last principal cannot lose principal or access until another is assigned.';

async function platformSignIn(page: Page) {
  await page.goto('/platform/login');
  await page.getByLabel('Email').fill('admin@platform.demo');
  await page.getByLabel('Password').fill('platform-demo-2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => u.pathname === '/platform');
}

/** Opens the studio's detail sheet and waits for its people. Returns the sheet. */
async function openStudio(page: Page): Promise<Locator> {
  const sheet = page.getByRole('dialog', { name: STUDIO, exact: true });
  if (!(await sheet.isVisible())) {
    await page.getByRole('region', { name: 'Companies', exact: true }).getByText(STUDIO, { exact: true }).click();
  }
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('region', { name: 'People', exact: true }).getByText('Asha Rao')).toBeVisible();
  return sheet;
}

/** The person's row in the studio's People table. */
const personRow = (sheet: Locator, name: string) => sheet.getByRole('region', { name: 'People', exact: true }).getByRole('row', { name: new RegExp(name) });

async function choose(page: Page, sheet: Locator, person: string, item: string) {
  await sheet.getByRole('button', { name: `Actions for ${person}` }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

/** Signs in to the studio app in a clean context. The caller checks where it landed and closes the context. */
async function firmLogin(browser: Browser, who: string, password: string) {
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto('/login/studio');
  await page.getByLabel('Work email').fill(`${who}@meridian.demo`);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  return { ctx, page };
}

async function expectSignedIn(browser: Browser, who: string, password: string) {
  const { ctx, page } = await firmLogin(browser, who, password);
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await ctx.close();
}

async function expectRefused(browser: Browser, who: string, password: string) {
  const { ctx, page } = await firmLogin(browser, who, password);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  await ctx.close();
}

// A stuck click or navigation fails fast with its own call log instead of using up the whole test timeout.
test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });
test.describe.configure({ mode: 'serial' });

test('a. the platform admin sees a studio\'s people and hands an employee a reset link; the employee sets a new password', async ({ page, browser }) => {
  await platformSignIn(page);
  const sheet = await openStudio(page);

  // People and how they sign in; never projects, money or time.
  const people = sheet.getByRole('region', { name: 'People', exact: true });
  for (const [name, email] of [['Asha Rao', 'p01@meridian.demo'], ['Karan Bhat', 'p06@meridian.demo'], ['Farah Khan', 'p10@meridian.demo']]) {
    await expect(people.getByText(name, { exact: true })).toBeVisible();
    await expect(people.getByText(email, { exact: true })).toBeVisible();
  }
  await expect(personRow(sheet, 'Asha Rao').getByRole('status', { name: 'Principal' })).toBeVisible();
  await expect(personRow(sheet, 'Karan Bhat').getByRole('status', { name: 'Sign-in enabled' })).toBeVisible();
  const text = await sheet.innerText();
  for (const leak of ['PRJ-0', 'INV-DEMO', '₹', 'Lakeview', 'argon2']) expect(text, `company sheet leaks ${leak}`).not.toContain(leak);

  // A one-time reset link, after a confirm step that says the admin never sees or sets the password.
  await choose(page, sheet, 'Karan Bhat', 'Reset password link');
  const linkSheet = page.getByRole('dialog', { name: 'Reset password link', exact: true });
  await expect(linkSheet.getByText(/You never see or set the password/)).toBeVisible();
  await linkSheet.getByRole('button', { name: 'Create reset link' }).click();
  const ready = page.getByRole('dialog', { name: 'Password reset link', exact: true });
  await expect(ready.getByText('Reset link ready.')).toBeVisible();
  await expect(ready.getByText('Email delivery is not connected.')).toBeVisible();
  const resetUrl = await ready.getByLabel('Reset link').inputValue();
  expect(resetUrl).toMatch(/^http:\/\/localhost:4273\/reset-password\/[A-Za-z0-9_-]{43}$/);
  await ready.getByRole('button', { name: 'Done' }).click();
  await openStudio(page);

  // The employee opens the link without a session and sets a new password.
  const ctx = await browser.newContext({ baseURL: BASE });
  const employee = await ctx.newPage();
  await employee.goto(resetUrl);
  await expect(employee.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await expect(employee.getByText('Karan Bhat')).toBeVisible();
  await employee.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
  await employee.getByLabel('Confirm password').fill(NEW_PASSWORD);
  await employee.getByRole('button', { name: 'Set new password' }).click();
  await expect(employee.getByRole('heading', { name: 'Password changed' })).toBeVisible();
  // Single use: the same link no longer works.
  await employee.goto(resetUrl);
  await expect(employee.getByRole('heading', { name: /This reset link (is not valid|has expired)/ })).toBeVisible();
  await ctx.close();

  // The new password signs in; the old one does not.
  await expectSignedIn(browser, 'p06', NEW_PASSWORD);
  await expectRefused(browser, 'p06', PASSWORD);

  // The studio's own audit names the platform as the actor.
  const studio = await browser.newContext({ baseURL: BASE });
  expect((await studio.request.post('/api/v1/auth/login', { data: { email: 'p01@meridian.demo', password: PASSWORD } })).ok()).toBeTruthy();
  const audit = await (await studio.request.get('/api/v1/audit?record_type=person')).json();
  const issued = audit.data.find((e: { action: string }) => e.action === 'platform_issue_reset_link');
  expect(issued?.actor).toBe('Platform admin');
  await studio.close();

  // Put Karan's demo password back, through a second one-time link (the platform API, as the admin's own session).
  const firms = (await (await page.request.get('/api/v1/platform/firms')).json()).data as { id: string; trading_name: string }[];
  const firmId = firms.find((f) => f.trading_name === STUDIO)!.id;
  const staff = (await (await page.request.get(`/api/v1/platform/firms/${firmId}/people`)).json()).data as { id: string; work_email: string }[];
  const karan = staff.find((p) => p.work_email === 'p06@meridian.demo')!.id;
  const again = await page.request.post(`/api/v1/platform/firms/${firmId}/people/${karan}/reset-link`, { data: {} });
  expect(again.ok()).toBeTruthy();
  const token = ((await again.json()).reset_url as string).split('/').pop();
  const restore = await page.request.post(`/api/v1/auth/reset/${token}`, { data: { password: PASSWORD } });
  expect(restore.ok(), await restore.text()).toBeTruthy();
  await expectSignedIn(browser, 'p06', PASSWORD);
});

test('b. the platform admin disables and enables sign-in, and cannot disable the only principal', async ({ page, browser }) => {
  await platformSignIn(page);
  let sheet = await openStudio(page);

  // Disable Divya Menon (P05): she cannot sign in.
  await choose(page, sheet, 'Divya Menon', 'Disable sign-in');
  const off = page.getByRole('dialog', { name: 'Disable sign-in for Divya Menon', exact: true });
  await off.getByLabel('Reason').fill('End-to-end: on leave without access');
  await off.getByRole('button', { name: 'Disable sign-in' }).click();
  await expect(off).toBeHidden();
  sheet = await openStudio(page);
  await expect(sheet.getByText('Divya Menon can no longer sign in.')).toBeVisible();
  await expect(personRow(sheet, 'Divya Menon').getByRole('status', { name: 'Sign-in disabled' })).toBeVisible();
  await expectRefused(browser, 'p05', PASSWORD);

  // Enable again: her existing password works.
  await choose(page, sheet, 'Divya Menon', 'Enable sign-in');
  const on = page.getByRole('dialog', { name: 'Enable sign-in for Divya Menon', exact: true });
  await on.getByLabel('Reason').fill('End-to-end: back at work');
  await on.getByRole('button', { name: 'Enable sign-in' }).click();
  await expect(on).toBeHidden();
  sheet = await openStudio(page);
  await expect(sheet.getByText('Divya Menon can sign in again.')).toBeVisible();
  await expect(personRow(sheet, 'Divya Menon').getByRole('status', { name: 'Sign-in enabled' })).toBeVisible();
  await expectSignedIn(browser, 'p05', PASSWORD);

  // The only principal: refused with the server's message, and nothing changes.
  await choose(page, sheet, 'Asha Rao', 'Disable sign-in');
  const last = page.getByRole('dialog', { name: 'Disable sign-in for Asha Rao', exact: true });
  await last.getByLabel('Reason').fill('End-to-end: try the last principal');
  await last.getByRole('button', { name: 'Disable sign-in' }).click();
  await expect(last.getByText(LAST_PRINCIPAL)).toBeVisible();
  await last.getByRole('button', { name: 'Cancel' }).click();
  // A dirty sheet may ask before discarding the typed reason.
  const discard = page.getByRole('button', { name: /^Discard/ });
  if (await discard.isVisible().catch(() => false)) await discard.click();
  sheet = await openStudio(page);
  await expect(personRow(sheet, 'Asha Rao').getByRole('status', { name: 'Sign-in enabled' })).toBeVisible();
  await expectSignedIn(browser, 'p01', PASSWORD);
});
