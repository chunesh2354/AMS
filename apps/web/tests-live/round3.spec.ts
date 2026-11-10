import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';

/**
 * Round 3 on a real database: a sole principal approves their own time (labelled as a self-approval), fixed fees are
 * required and editable on the Billing tab, and approval rows open the preview without deciding anything.
 * Runs with playwright.live.config.ts (its own API and throwaway database). Takes no screenshots and writes nothing
 * under docs/. Each test stands alone: it makes its own project or its own setup, with a unique RUN suffix.
 *
 * The demo studio has one principal, Asha Rao (P01), who is also the firm's fallback approver (apps/api/src/dev/seed.ts),
 * so her own project time has nobody else to go to and is routed back to her.
 */
const PASSWORD = 'meridian-demo-2026';
const BASE = 'http://localhost:4273';
// Unique per run so the suite can rerun against a reused database.
const RUN = String(process.env.E2E_RUN ?? Date.now().toString(36)).toUpperCase();
/** ApprovalRow's label for a sole principal's own work (apps/web/src/ui/ApprovalRow, SELF_APPROVED_LABEL). */
const SELF_APPROVED = 'Self-approved: no other approver in the studio';
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function signedIn(page: Page, who: string, password = PASSWORD) {
  await page.goto('/login/studio');
  await page.getByLabel('Work email').fill(who.includes('@') ? who : `${who}@meridian.demo`);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

/** A signed-in API session in its own browser context (for setup the UI does not need to prove). */
async function apiSession(browser: Browser, who: string) {
  const ctx = await browser.newContext({ baseURL: BASE });
  const res = await ctx.request.post('/api/v1/auth/login', { data: { email: `${who}@meridian.demo`, password: PASSWORD } });
  expect(res.ok(), `sign in as ${who}`).toBeTruthy();
  return ctx;
}

/** Select, PersonPicker, MultiSelect and Combobox all render their options in a portal on the body. */
async function pick(scope: Locator, page: Page, label: string, option: RegExp, type?: string) {
  const box = scope.getByRole('combobox', { name: label });
  await box.click();
  if (type) await box.fill(type);
  await page.getByRole('option', { name: option }).first().click();
}

/** MoneyField swaps its grouped text for the raw number on focus, so type the way a person does: click, select all, type. */
async function typeMoney(field: Locator, value: string) {
  await field.click();
  await field.press('Control+a');
  if (value === '') await field.press('Backspace');
  else await field.pressSequentially(value);
}

/** Opens Create project and fills step 1: an existing client and the given PM. Returns the sheet. */
async function startProject(page: Page, code: string, name: string, pm: { name: string; type: string }) {
  await page.goto('/firm/projects');
  await page.getByRole('button', { name: 'Create project' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Create project' });
  await sheet.getByLabel('Project code').fill(code);
  await sheet.getByLabel('Name', { exact: true }).fill(name);
  await pick(sheet, page, 'Client', /^Lakeview Trust$/);
  await pick(sheet, page, 'Project manager', new RegExp(pm.name), pm.type);
  await sheet.getByRole('button', { name: 'Save and continue' }).click();
  await expect(sheet.getByRole('combobox', { name: 'Phase template' })).toBeVisible();
  return sheet;
}

async function projectCodes(page: Page): Promise<string> {
  const res = await page.request.get('/api/v1/projects');
  expect(res.ok()).toBeTruthy();
  return JSON.stringify(await res.json());
}

// A stuck click or navigation fails fast with its own call log instead of using up the whole test timeout.
test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

test('a. a sole principal approves their own time, and the inbox labels it a self-approval', async ({ page }) => {
  const code = `SELF-${RUN}`;
  await signedIn(page, 'p01');

  // Asha Rao creates a fixed-fee project that she leads herself. She is the studio's only principal, so the
  // wizard offers no other principal: the review says so.
  const sheet = await startProject(page, code, `Self House ${RUN}`, { name: 'Asha Rao', type: 'Asha' });
  await pick(sheet, page, 'Phase template', /^Refit, 4 phases$/);
  await typeMoney(sheet.getByLabel('Contracted fee'), '400000');
  await expect(sheet.getByLabel('Concept design fee')).toHaveValue('1,00,000');
  await sheet.getByRole('button', { name: 'Save and continue' }).click();
  await expect(sheet.getByText('Another principal of the firm, if there is one')).toBeVisible();
  await sheet.getByRole('button', { name: 'Create project' }).click();
  await page.waitForURL(new RegExp(`/firm/projects/${esc(code)}`));

  // She logs 4 h on Concept design and submits the week.
  await page.goto('/me/time');
  await page.getByRole('button', { name: 'Log time' }).click();
  const log = page.getByRole('dialog', { name: 'Log time' });
  const box = log.getByRole('combobox', { name: 'Project and phase' });
  await box.click();
  await box.fill(code);
  await page.getByRole('option', { name: `${code} · Concept design` }).click();
  await log.getByLabel('Duration (h:mm)').fill('4:00');
  await log.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(`Logged 4:00 on ${code} · Concept design.`)).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Submit week' }).click();
  await expect(page.getByText(/Week submitted with .*1 approval request sent\./)).toBeVisible();

  // Nobody else can approve it, so it is in her own queue, approver herself, labelled as a self-approval.
  await page.goto('/firm/approvals');
  const item = page.getByRole('listitem').filter({ hasText: 'Asha Rao' }).filter({ hasText: code });
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('4.00 h');
  await expect(item.getByRole('img', { name: 'Approver Asha Rao' })).toBeVisible();
  await expect(item.getByText(SELF_APPROVED, { exact: true })).toBeVisible();
  // The preview says the same, and why.
  await item.getByRole('button', { name: new RegExp(esc(code)) }).click();
  const preview = page.getByRole('complementary', { name: 'Preview' });
  await expect(preview.getByText(SELF_APPROVED, { exact: true })).toBeVisible();
  await expect(preview).toContainText('Nobody else in the studio can approve this');

  // She approves it from the row.
  await item.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('Approved Asha Rao, time.')).toBeVisible();
  await expect(item).toHaveCount(0);

  // The server recorded it as approved, routed to herself.
  const res = await page.request.get('/api/v1/approvals?status=Approved');
  expect(res.ok()).toBeTruthy();
  const done = ((await res.json()).data as Array<{ project?: { code?: string } }>).filter((a) => a.project?.code === code);
  expect(done).toHaveLength(1);
  expect(done[0]).toMatchObject({ status: 'Approved', self_approval: true, submitter: { name: 'Asha Rao' }, approver: { name: 'Asha Rao' } });

  // Her week reads Approved.
  await page.goto('/me/time');
  await expect(page.getByText('Approved').first()).toBeVisible();
});

test('b. a fixed fee needs its fees; the Fees editor changes a phase fee and authorizing bills the new amount', async ({ page }) => {
  const code = `FEE-${RUN}`;
  await signedIn(page, 'p01');

  const sheet = await startProject(page, code, `Fee House ${RUN}`, { name: 'Vikram Nair', type: 'Vikram' });
  await pick(sheet, page, 'Phase template', /^Refit, 4 phases$/);
  await expect(sheet.getByRole('combobox', { name: 'Fee basis' })).toHaveText(/Fixed fee/);
  const next = sheet.getByRole('button', { name: 'Save and continue' });

  // No contracted fee: refused on this step.
  await next.click();
  await expect(sheet.getByText('Enter the contracted fee', { exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Fix the highlighted field to continue' })).toBeVisible();
  await expect(sheet.getByRole('combobox', { name: 'Phase template' })).toBeVisible();

  // A contracted fee with a phase left without a fee: refused too.
  await typeMoney(sheet.getByLabel('Contracted fee'), '800000');
  await expect(sheet.getByLabel('Concept design fee')).toHaveValue('2,00,000');
  await typeMoney(sheet.getByLabel('Concept design fee'), '');
  await next.click();
  await expect(sheet.getByRole('alert')).toHaveText('Enter a fee for every phase');
  await expect(sheet.getByRole('combobox', { name: 'Phase template' })).toBeVisible();

  // Nothing was created.
  expect(await projectCodes(page)).not.toContain(code);

  // The server refuses the same two shapes on its own (not just the wizard).
  const me = (await (await page.request.get('/api/v1/me')).json()).person;
  const clients = (await (await page.request.get('/api/v1/clients')).json()).data as { id: string; name: string }[];
  const client = clients.find((c) => c.name === 'Lakeview Trust')!;
  expect(client).toBeTruthy();
  const phases = [['CD', 'Concept design'], ['DD', 'Design development'], ['WD', 'Working drawings'], ['SS', 'Site supervision']].map(([c, n]) => ({ code: c, name: n }));
  const base = { code, name: `Fee House ${RUN}`, client_id: client.id, pm_id: me.id, billing_method: 'fixed_percent' };
  const noFee = await page.request.post('/api/v1/projects', { data: { ...base, phases } });
  expect(noFee.status()).toBe(400);
  expect(await noFee.text()).toContain('A fixed fee needs the contracted fee.');
  const noPhaseFees = await page.request.post('/api/v1/projects', { data: { ...base, contracted_amount: 800000, phases } });
  expect(noPhaseFees.status()).toBe(400);
  expect(await noPhaseFees.text()).toContain('A fixed fee needs a fee for every phase.');
  expect(await projectCodes(page)).not.toContain(code);

  // Split evenly (₹2,00,000 each) and create it.
  await sheet.getByRole('button', { name: 'Split evenly' }).click();
  await expect(sheet.getByLabel('Concept design fee')).toHaveValue('2,00,000');
  await next.click();
  await sheet.getByRole('button', { name: 'Create project' }).click();
  await page.waitForURL(new RegExp(`/firm/projects/${esc(code)}`));

  // Billing tab, Fees: Concept design goes to ₹2,60,000 and Site supervision to ₹1,40,000 (still ₹8,00,000).
  await page.goto(`/firm/projects/${code}/billing`);
  const fees = page.getByRole('region', { name: 'Fees', exact: true });
  await expect(fees.getByText('₹2,00,000').first()).toBeVisible();
  await fees.getByRole('button', { name: 'Edit fees' }).click();
  const edit = fees.getByRole('group', { name: 'Edit fees' });
  await typeMoney(edit.getByLabel('Concept design fee'), '260000');
  await fees.getByRole('button', { name: 'Save fees' }).click();
  // Unbalanced: refused before anything is sent.
  await expect(edit.getByRole('alert')).toHaveText('Phase fees add up to ₹8,60,000. They must add up to the fee of ₹8,00,000.');
  await typeMoney(edit.getByLabel('Site supervision fee'), '140000');
  await fees.getByRole('button', { name: 'Save fees' }).click();
  await expect(page.getByText('Fees saved. ₹8,00,000 across 4 phases.')).toBeVisible();
  await expect(fees.getByRole('group', { name: 'Edit fees' })).toHaveCount(0);
  await expect(fees.getByText('₹2,60,000')).toBeVisible();
  await expect(fees.getByText('₹1,40,000')).toBeVisible();

  // Authorize 40% of Concept design: ₹1,04,000 of its new ₹2,60,000.
  const panel = page.getByRole('region', { name: 'Authorize fee for billing' });
  const cd = panel.getByRole('listitem').filter({ hasText: 'Concept design' });
  await expect(cd).toContainText('Fee ₹2,60,000.');
  await panel.getByLabel('New level for Concept design').fill('40');
  await expect(panel.getByText('Entitlement rises by ₹1,04,000')).toBeVisible();
  await panel.getByRole('button', { name: 'Authorize 40% of Concept design' }).click();
  await expect(page.getByText('Authorized 40% of Concept design. It is in Ready to bill.')).toBeVisible();
  await expect(cd).toContainText('Authorized 40%.');

  // Billing shows the new amount ready.
  await page.goto('/firm/billing');
  const ready = page.getByRole('region', { name: 'Ready to bill' }).getByRole('row', { name: new RegExp(esc(code)) });
  await expect(ready).toHaveCount(1);
  await expect(ready).toContainText('1,04,000');
});

test('c. approval rows: a click on the row opens the preview and decides nothing; an exception row has no Approve', async ({ page, browser }) => {
  // Setup (API): Rohan Shetty submits his seeded week (12.50 h on Thursday), then Asha Rao, a principal, reassigns
  // his PRJ-01 request (flagged over 12 h) and his internal-time request (no flag) to herself, so both are in her queue.
  const rohan = await apiSession(browser, 'p04');
  // The seed puts Rohan's week at the UTC week of the run; any date in it names the week.
  const submit = await rohan.request.post(`/api/v1/timesheets/${new Date().toISOString().slice(0, 10)}/submit`);
  expect(submit.ok(), await submit.text()).toBeTruthy();
  const ids = (await submit.json()).approval_request_ids as string[];
  const requests = await Promise.all(ids.map(async (id) => (await (await rohan.request.get(`/api/v1/approvals/${id}`)).json())));
  await rohan.close();
  const flagged = requests.find((r) => r.project?.code === 'PRJ-01');
  const internal = requests.find((r) => r.type === 'internal_time');
  expect(flagged?.exception_flags).toEqual(['over_12h_day']);
  expect(internal?.exception_flags).toEqual([]);

  const asha = await apiSession(browser, 'p01');
  const me = (await (await asha.request.get('/api/v1/me')).json()).person;
  for (const r of [flagged, internal]) {
    const res = await asha.request.post(`/api/v1/approvals/${r.id}/reassign`, { data: { to: me.id, reason: `Round 3 e2e ${RUN}` } });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
  await asha.close();

  // Below 1280 px the preview opens in a sheet only when a row is opened, so the click is what opens it.
  await page.setViewportSize({ width: 1200, height: 900 });
  await signedIn(page, 'p01');
  await page.goto('/firm/approvals');
  const rows = page.getByRole('listitem').filter({ hasText: 'Rohan Shetty' });
  const plain = rows.filter({ hasText: 'Internal time' });
  const exception = rows.filter({ hasText: 'PRJ-01' });
  await expect(plain).toHaveCount(1);
  await expect(exception).toHaveCount(1);
  const waiting = page.getByText(/^\d+ waiting for you\./);
  const before = await waiting.innerText();
  const allQueue = page.getByRole('navigation', { name: 'Queues' }).getByRole('button', { name: /^All/ });
  const allBefore = await allQueue.innerText();

  // Click the middle of the plain row (its open area, between the type icon and the hours).
  const open = plain.locator('.apr__open');
  const boxOf = (await open.boundingBox())!;
  await page.mouse.click(boxOf.x + boxOf.width / 2, boxOf.y + boxOf.height / 2);
  const sheet = page.getByRole('dialog', { name: 'Rohan Shetty' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('complementary', { name: 'Preview' })).toContainText('Internal time');
  await expect(sheet.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
  await expect(open).toHaveAttribute('aria-current', 'true');
  // Opening it decided nothing: no toast, the item is still there, still pending, and the counts are unchanged.
  await expect(page.getByText(/^Approved Rohan Shetty/)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(plain).toHaveCount(1);
  await expect(waiting).toHaveText(before);
  await expect(allQueue).toHaveText(allBefore);
  const check = await page.request.get(`/api/v1/approvals/${internal.id}`);
  expect((await check.json()).status).toBe('Pending');

  // The exception row (over 12 h) has no row Approve: it cannot join a batch and is approved from the preview.
  await expect(exception).toContainText('Over 12 h day');
  await expect(exception.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
  await expect(exception.getByRole('button', { name: 'Return' })).toBeVisible();
  await expect(exception.getByRole('button', { name: 'Delegate' })).toBeVisible();
  await expect(exception.getByRole('checkbox')).toBeDisabled();
  await expect(plain.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
  await expect(page.getByText(/\d+ exceptions? excluded/)).toBeVisible();
  // Its preview names the exception and keeps the decision there.
  await exception.locator('.apr__open').click();
  const exSheet = page.getByRole('dialog', { name: 'Rohan Shetty' });
  await expect(exSheet.getByText('Exception: over 12 h day')).toBeVisible();
  await expect(exSheet.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(exception).toHaveCount(1);
});
