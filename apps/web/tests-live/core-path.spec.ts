import { test, expect, type Browser, type Page } from '@playwright/test';

const PASSWORD = 'meridian-demo-2026';
const NEW_PASSWORD = 'studio-invite-2026';
/**
 * The tracked docs/ui-screens/live-*.png change only when asked: UPDATE_LIVE_SCREENSHOTS=1 (run from apps/web).
 * Otherwise each shot goes to this test's folder under test-results, which git ignores.
 */
const shot = (page: Page, name: string) => page.screenshot({
  path: process.env.UPDATE_LIVE_SCREENSHOTS === '1' ? `../../docs/ui-screens/live-${name}.png` : test.info().outputPath(`live-${name}.png`),
  fullPage: true,
});
const dark = async (page: Page, name: string) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  // Controls animate their colours; capture only once every theme transition has finished.
  await page.waitForFunction(() => document.getAnimations().every((a) => !(a instanceof CSSTransition) || a.playState === 'finished'));
  await shot(page, `${name}-dark`);
  await page.emulateMedia({ colorScheme: 'light' });
};
// Unique per run so the suite can rerun against a reused database.
const RUN = String(process.env.E2E_RUN ?? Date.now().toString(36));
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function login(page: Page, who: string, password = PASSWORD) {
  // /login is the chooser; the firm sign-in form lives at /login/studio (and /login/team).
  await page.goto('/login/studio');
  await page.getByLabel('Work email').fill(`${who}@meridian.demo`);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (password === PASSWORD) await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

/** Opens an invite link in a clean browser context and sets a password. Returns the page, signed in. */
async function acceptInvite(browser: Browser, url: string, shotName?: string) {
  const ctx = await browser.newContext({ baseURL: 'http://localhost:4273' });
  const page = await ctx.newPage();
  await page.goto(url);
  await expect(page.getByRole('heading', { name: /^Join / })).toBeVisible();
  if (shotName) await shot(page, `${shotName}-light`);
  await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel('Confirm password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Set password and sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/accept-invite'));
  return { ctx, page };
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
  // The redesign puts Sign out at the foot of the side nav instead of in an account menu.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Sign out' }).click();
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
  // Only the seeded database says this: its Tender and Site supervision phases are "Not started"
  // (the sample studio calls them "Planned"), and it has no Open tasks tile (no tasks endpoint yet).
  const phases = page.getByRole('region', { name: 'Phases' });
  await expect(phases.getByRole('rowheader', { name: 'Tender' })).toBeVisible();
  await expect(phases.getByText('Not started').first()).toBeVisible();
  await expect(phases.getByText('Planned')).toHaveCount(0);
  await expect(page.getByText('Open tasks')).toHaveCount(0);
  // RestrictedCell is a lock icon with an accessible name, not visible text.
  await expect(page.getByRole('img', { name: /^restricted, requires finance permission/ }).first()).toBeVisible();
  await shot(page, 'project-restricted');
});

const FINANCE_NAME = `Test Finance ${RUN}`;
// The server's messages. For the only principal, the last-principal rule answers first (pinned in apps/api/test/accounts.test.ts).
const REFUSALS: [string, string][] = [
  ['Asha Rao', 'The last principal cannot lose principal or access until another is assigned.'],
  [FINANCE_NAME, 'Only a principal can deactivate a principal, finance or other sensitive account.'],
];

async function addAccount(page: Page, name: string, email: string, types: { check?: RegExp[]; uncheck?: RegExp[] } = {}) {
  await page.getByRole('button', { name: 'Add account' }).first().click();
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Job title').fill('Architect');
  for (const t of types.check ?? []) await page.getByRole('checkbox', { name: t }).check();
  for (const t of types.uncheck ?? []) await page.getByRole('checkbox', { name: t }).uncheck();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Account created')).toBeVisible();
  await expect(page.getByText('Email delivery is not connected yet. Send this link yourself.')).toBeVisible();
  const url = await page.getByLabel('Invite link').inputValue();
  expect(url).toContain('/accept-invite/');
  return url;
}

async function firmLogin(browser: Browser, email: string, password: string) {
  const ctx = await browser.newContext({ baseURL: 'http://localhost:4273' });
  const page = await ctx.newPage();
  await page.goto('/login/studio');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  return { ctx, page };
}

test('7. principal adds an employee; the invite sets a password and signs in', async ({ page, browser }) => {
  await page.goto('/login');
  await shot(page, 'login-light');
  await login(page, 'p01');
  await page.goto('/firm/settings/accounts');
  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
  await expect(page.getByText('Asha Rao').first()).toBeVisible();
  await shot(page, 'accounts-light');
  await dark(page, 'accounts');

  const email = `e2e.employee.${RUN}@meridian.demo`;
  const url = await addAccount(page, 'Test Employee', email);
  await page.getByRole('button', { name: 'Done' }).click();

  const invited = await acceptInvite(browser, url, 'accept-invite');
  await expect(invited.page).toHaveURL(/\/me\/home/);
  await expect(invited.page.getByRole('navigation').getByText('Firm', { exact: true })).toHaveCount(0);
  await invited.ctx.close();

  await page.reload();
  await expect(page.getByRole('row', { name: new RegExp(esc(email)) }).getByText('Accepted')).toBeVisible();

  // A finance account for test 8 to try to deactivate.
  await addAccount(page, FINANCE_NAME, `e2e.finance.${RUN}@meridian.demo`, { check: [/^Finance/], uncheck: [/^Employee/] });
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('row', { name: new RegExp(esc(FINANCE_NAME)) }).getByText('Finance', { exact: true })).toBeVisible();
});

test('8. operations cannot deactivate principal or finance accounts and sees the server message', async ({ page }) => {
  await login(page, 'p10');
  await page.goto('/firm/settings/accounts');
  for (const [name, message] of REFUSALS) {
    await page.getByRole('button', { name: `Actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Deactivate' }).click();
    await page.getByLabel('Reason').fill('End-to-end check that this is refused');
    await page.getByRole('button', { name: 'Deactivate', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Deactivate account' }).getByRole('alert')).toHaveText(message);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.reload();
    await expect(page.getByRole('row', { name: new RegExp(esc(name)) }).getByText('Revoked')).toHaveCount(0);
  }
  // The principal can still sign in.
  const check = await page.request.post('/api/v1/auth/login', { data: { email: 'p01@meridian.demo', password: PASSWORD } });
  expect(check.ok()).toBeTruthy();
});

test('9. platform admin adds, suspends and reactivates a company, and sees counts only', async ({ page, browser }) => {
  await page.goto('/platform/login');
  await page.getByLabel('Email').fill('admin@platform.demo');
  await page.getByLabel('Password').fill('platform-demo-2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => u.pathname === '/platform');
  await expect(page.getByRole('table', { name: 'Companies' }).or(page.getByRole('region', { name: 'Companies' })).first()).toBeVisible();
  await expect(page.getByText('Studio Meridian').first()).toBeVisible();
  const text = await page.locator('body').innerText();
  for (const leak of ['PRJ-0', 'INV-DEMO', '₹', 'Asha Rao', 'Vikram Nair', 'Rohan Shetty', 'Farah Khan', 'Lakeview'])
    expect(text, `platform page leaks ${leak}`).not.toContain(leak);
  await shot(page, 'platform-light');
  await dark(page, 'platform');

  const company = `E2E Studio ${RUN}`;
  const owner = `owner.${RUN}@e2e-studio.demo`;
  await page.getByRole('button', { name: 'Add company' }).first().click();
  await page.getByLabel('Trading name').fill(company);
  await page.getByLabel('Legal name').fill(`${company} LLP`);
  await page.getByLabel('Owner name').fill('Test Owner');
  await page.getByLabel('Owner email').fill(owner);
  await page.getByRole('button', { name: 'Create company' }).click();
  await expect(page.getByText(`${company} is ready.`)).toBeVisible();
  const url = await page.getByLabel('Invite link').inputValue();
  expect(url).toContain('/accept-invite/');
  await page.getByRole('button', { name: 'Done' }).click();

  const ownerSession = await acceptInvite(browser, url);
  await expect(ownerSession.page).not.toHaveURL(/\/login/);
  await ownerSession.ctx.close();

  const row = () => page.getByRole('row', { name: new RegExp(esc(company)) });
  await page.getByRole('button', { name: `Actions for ${company}` }).click();
  await page.getByRole('menuitem', { name: 'Suspend' }).click();
  await page.getByLabel('Reason').fill('End-to-end suspension check');
  await page.getByRole('button', { name: 'Suspend company' }).click();
  await expect(row().getByText('Suspended')).toBeVisible();

  // Suspended: the owner cannot sign in to the firm app.
  const refused = await firmLogin(browser, owner, NEW_PASSWORD);
  await expect(refused.page.getByRole('alert')).toBeVisible();
  await expect(refused.page).toHaveURL(/\/login/);
  await refused.ctx.close();

  await page.getByRole('button', { name: `Actions for ${company}` }).click();
  await page.getByRole('menuitem', { name: 'Reactivate' }).click();
  const reason = page.getByLabel('Reason');
  if (await reason.count()) await reason.fill('End-to-end reactivation check');
  await page.getByRole('button', { name: 'Reactivate company' }).click();
  await expect(row().getByText('Active')).toBeVisible();

  // Active again: the owner signs in.
  const allowed = await firmLogin(browser, owner, NEW_PASSWORD);
  await allowed.page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await allowed.ctx.close();
});
