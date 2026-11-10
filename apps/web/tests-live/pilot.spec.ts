import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';

/**
 * The pilot path on a real database: a principal sets up a billable project with a team, a team member logs and submits
 * time, the principal approves it and authorizes fee, and Billing shows it ready. Then membership and password reset.
 * Runs with playwright.live.config.ts (its own API and throwaway database). Writes nothing under docs/.
 */
const PASSWORD = 'meridian-demo-2026';
const BASE = 'http://localhost:4273';
// Unique per run so the suite can rerun against a reused database.
const RUN = String(process.env.E2E_RUN ?? Date.now().toString(36)).toUpperCase();
const CODE = `PIL-${RUN}`;
const NAME = `Pilot House ${RUN}`;
const CLIENT = `Pilot Client ${RUN}`;
// Nisha Kumar (P09) is on no seeded project, so the only project her pickers can offer is the one made here.
const MEMBER = { ref: 'p09', name: 'Nisha Kumar' };
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function login(page: Page, who: string, password = PASSWORD) {
  await page.goto('/login/studio');
  await page.getByLabel('Work email').fill(who.includes('@') ? who : `${who}@meridian.demo`);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}
async function signedIn(page: Page, who: string, password = PASSWORD) {
  await login(page, who, password);
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}
async function session(browser: Browser, who: string, password = PASSWORD) {
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  await signedIn(page, who, password);
  return { ctx, page };
}

/** Select, PersonPicker, MultiSelect and Combobox all render their options in a portal on the body. */
async function pick(scope: Locator, page: Page, label: string, option: RegExp, type?: string) {
  const box = scope.getByRole('combobox', { name: label });
  await box.click();
  if (type) await box.fill(type);
  await page.getByRole('option', { name: option }).first().click();
}

/**
 * MoneyField swaps its grouped text ("2,50,000") for the raw number on focus, so type the way a person does:
 * click in, select all, type. (Playwright's fill selects before that swap and appends to it.)
 */
async function typeMoney(field: Locator, value: string) {
  await field.click();
  await field.press('Control+a');
  await field.pressSequentially(value);
}

/** Opens Log time on My time and returns the sheet with the project picker opened on the project code. */
async function openLogTime(page: Page) {
  await page.goto('/me/time');
  await page.getByRole('button', { name: 'Log time' }).click();
  const sheet = page.getByRole('dialog', { name: 'Log time' });
  const box = sheet.getByRole('combobox', { name: 'Project and phase' });
  await box.click();
  await box.fill(CODE);
  return sheet;
}

test.describe.configure({ mode: 'serial' });
// A stuck click or navigation fails fast with its own call log instead of using up the whole test timeout.
test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

test('a. setup: a new fixed-fee project with a team is timed, approved, authorized and ready to bill', async ({ page, browser }) => {
  await signedIn(page, 'p01');
  await page.goto('/firm/projects');
  await page.getByRole('button', { name: 'Create project' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Create project' });
  const next = () => sheet.getByRole('button', { name: 'Save and continue' }).click();

  // Project: a new client, the principal as PM (so the member's time is routed to her).
  await sheet.getByLabel('Project code').fill(CODE);
  await sheet.getByLabel('Name', { exact: true }).fill(NAME);
  await pick(sheet, page, 'Client', /^Add a new client$/);
  await sheet.getByLabel('New client name').fill(CLIENT);
  await pick(sheet, page, 'Project manager', /Asha Rao/, 'Asha');
  await next();

  // Phases and fee: ₹10,00,000 fixed, split unevenly across the four phases.
  await pick(sheet, page, 'Phase template', /^Refit, 4 phases$/);
  await expect(sheet.getByRole('combobox', { name: 'Fee basis' })).toHaveText(/Fixed fee/);
  await typeMoney(sheet.getByLabel('Contracted fee'), '1000000');
  await expect(sheet.getByLabel('Concept design fee')).toHaveValue('2,50,000');
  await typeMoney(sheet.getByLabel('Concept design fee'), '300000');
  await next();
  // Unbalanced phase fees are refused before anything is sent.
  await expect(sheet.getByRole('alert')).toHaveText('Phase fees add up to ₹10,50,000. They must add up to the fee of ₹10,00,000.');
  await typeMoney(sheet.getByLabel('Site supervision fee'), '200000');
  await next();

  // Team and review.
  await pick(sheet, page, 'Team', new RegExp(MEMBER.name));
  await sheet.getByRole('heading', { name: 'Review' }).click();
  await expect(sheet.getByText(`${CLIENT} (new)`)).toBeVisible();
  await sheet.getByRole('button', { name: 'Create project' }).click();
  await page.waitForURL(new RegExp(`/firm/projects/${esc(CODE)}`));

  // The project's team lists the member.
  await page.goto(`/firm/projects/${CODE}/staffing`);
  await expect(page.getByRole('region', { name: 'Team members' }).getByRole('row', { name: new RegExp(MEMBER.name) })).toBeVisible();

  // The member signs in, logs 6 h on Concept design today, and submits the week.
  const member = await session(browser, MEMBER.ref);
  const log = await openLogTime(member.page);
  await member.page.getByRole('option', { name: `${CODE} · Concept design` }).click();
  await log.getByLabel('Duration (h:mm)').fill('6:00');
  await log.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(member.page.getByText(`Logged 6:00 on ${CODE} · Concept design.`)).toBeVisible();
  await member.page.reload();
  await expect(member.page.getByText(new RegExp(`${esc(CODE)}`)).first()).toBeVisible();
  await member.page.getByRole('button', { name: 'Submit week' }).click();
  await expect(member.page.getByText(/Week submitted with .*1 approval request sent\./)).toBeVisible();

  // The principal (the project's PM) approves it.
  await page.goto('/firm/approvals');
  const item = page.getByRole('listitem').filter({ hasText: MEMBER.name }).filter({ hasText: CODE });
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('6.00 h');
  await expect(item.getByRole('img', { name: 'Approver Asha Rao' })).toBeVisible();
  // The row's actions show on hover.
  await item.hover();
  await item.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText(new RegExp(`^Approved ${MEMBER.name}`))).toBeVisible();
  await expect(item).toHaveCount(0);

  // The member's week now reads Approved.
  await member.page.reload();
  await expect(member.page.getByText('Approved').first()).toBeVisible();
  await member.ctx.close();

  // Authorize 40% of Concept design: ₹1,20,000 of its ₹3,00,000.
  await page.goto(`/firm/projects/${CODE}/billing`);
  const panel = page.getByRole('region', { name: 'Authorize fee for billing' });
  const level = panel.getByLabel('New level for Concept design');
  await level.fill('40');
  await expect(panel.getByText('Entitlement rises by ₹1,20,000')).toBeVisible();
  await panel.getByRole('button', { name: 'Authorize 40% of Concept design' }).click();
  await expect(page.getByText('Authorized 40% of Concept design. It is in Ready to bill.')).toBeVisible();
  await expect(panel.getByRole('listitem').filter({ hasText: 'Concept design' })).toContainText('Authorized 40%.');

  // Billing shows it ready.
  await page.goto('/firm/billing');
  const ready = page.getByRole('region', { name: 'Ready to bill' }).getByRole('row', { name: new RegExp(esc(CODE)) });
  await expect(ready).toHaveCount(1);
  await expect(ready).toContainText('1,20,000');
});

test('b. membership: removing the member hides the project from their My time picker', async ({ page, browser }) => {
  // Before: the member's picker offers the project.
  const member = await session(browser, MEMBER.ref);
  await openLogTime(member.page);
  await expect(member.page.getByRole('option', { name: `${CODE} · Concept design` })).toBeVisible();

  await signedIn(page, 'p01');
  await page.goto(`/firm/projects/${CODE}/staffing`);
  await page.getByRole('button', { name: `Remove ${MEMBER.name}` }).click();
  await expect(page.getByText(`${MEMBER.name} removed from the team.`)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Team members' }).getByRole('row', { name: new RegExp(MEMBER.name) })).toHaveCount(0);

  // After: neither Log time nor Add line offers it, and the server refuses time on it.
  await openLogTime(member.page);
  await expect(member.page.getByRole('option', { name: new RegExp(esc(CODE)) })).toHaveCount(0);
  await expect(member.page.getByText('No project or phase matches.')).toBeVisible();
  const projects = await member.page.request.get('/api/v1/projects');
  expect(projects.ok()).toBeTruthy();
  expect(JSON.stringify(await projects.json())).not.toContain(CODE);
  await member.ctx.close();
});

test('c. reset: a principal issues a reset link for an accepted employee, never for themself', async ({ page, browser }) => {
  const email = `e2e.reset.${RUN.toLowerCase()}@meridian.demo`;
  const name = `Reset Employee ${RUN}`;
  const first = 'pilot-first-2026';
  const second = 'pilot-second-2026';

  await signedIn(page, 'p01');
  await page.goto('/firm/settings/accounts');
  await page.getByRole('button', { name: 'Add account' }).first().click();
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Job title').fill('Architect');
  await page.getByRole('button', { name: 'Create account' }).click();
  const invite = await page.getByLabel('Invite link').inputValue();
  await page.getByRole('button', { name: 'Done' }).click();

  // The employee accepts the invite with a first password.
  const invited = await browser.newContext({ baseURL: BASE });
  const ip = await invited.newPage();
  await ip.goto(invite);
  await ip.getByLabel('New password', { exact: true }).fill(first);
  await ip.getByLabel('Confirm password').fill(first);
  await ip.getByRole('button', { name: 'Set password and sign in' }).click();
  await ip.waitForURL((u) => !u.pathname.startsWith('/accept-invite'));
  await invited.close();

  // The principal issues a reset link.
  await page.reload();
  await expect(page.getByRole('row', { name: new RegExp(esc(email)) }).getByText('Accepted')).toBeVisible();
  await page.getByRole('button', { name: `Actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Reset password link' }).click();
  await page.getByRole('button', { name: 'Create reset link' }).click();
  const url = await page.getByRole('textbox', { name: 'Reset link' }).inputValue();
  expect(url).toMatch(/\/reset-password\/[A-Za-z0-9_-]{32,}$/);
  await page.getByRole('button', { name: 'Done' }).click();

  // The employee sets a new password from the link.
  const resetCtx = await browser.newContext({ baseURL: BASE });
  const rp = await resetCtx.newPage();
  await rp.goto(url);
  await expect(rp.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await expect(rp.getByText(name)).toBeVisible();
  await rp.getByLabel('New password', { exact: true }).fill(second);
  await rp.getByLabel('Confirm password').fill(second);
  await rp.getByRole('button', { name: 'Set new password' }).click();
  await expect(rp.getByRole('heading', { name: 'Password changed' })).toBeVisible();
  // The link works once.
  await rp.goto(url);
  await expect(rp.getByRole('heading', { name: /This reset link (has expired|is not valid)/ })).toBeVisible();
  await resetCtx.close();

  // The old password fails; the new one works.
  const old = await browser.newContext({ baseURL: BASE });
  const op = await old.newPage();
  await login(op, email, first);
  await expect(op.getByRole('alert')).toBeVisible();
  await expect(op).toHaveURL(/\/login/);
  await old.close();
  const fresh = await session(browser, email, second);
  await expect(fresh.page).toHaveURL(/\/me\/home/);
  await fresh.ctx.close();

  // A principal cannot issue a reset link for their own account.
  await page.getByRole('button', { name: 'Actions for Asha Rao' }).click();
  await page.getByRole('menuitem', { name: 'Reset password link' }).click();
  await page.getByRole('button', { name: 'Create reset link' }).click();
  await expect(page.getByRole('dialog', { name: 'Reset password link' }).getByRole('alert'))
    .toHaveText('You cannot issue a reset link for your own account. Use Change password instead.');
  await expect(page.getByRole('textbox', { name: 'Reset link' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel' }).click();
  // And she still signs in with her own password.
  const check = await page.request.post('/api/v1/auth/login', { data: { email: 'p01@meridian.demo', password: PASSWORD } });
  expect(check.ok()).toBeTruthy();
});
