import { test, expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

/**
 * Round 2 on a real database: the project Timeline (Gantt) reschedules with cascade, a dependency cycle is refused,
 * followers hear about status changes, time is logged on a task from its sheet, and the Projects Health view reads
 * the seeded studio (PRJ-01 At risk on hours; margin fenced for a PM).
 * Runs with playwright.live.config.ts (its own API and throwaway database). Takes no screenshots and writes nothing
 * under docs/. Each test stands alone: it makes its own tasks through the API with a unique RUN suffix, dated a few
 * days after the studio's today so nothing it adds is overdue (overdue tasks would change PRJ-01's health).
 *
 * Demo studio (apps/api/src/dev/seed.ts): Asha Rao (P01) is the principal; Vikram Nair (P02) is PM of PRJ-01 with
 * Rohan Shetty (P04), Divya Menon (P05) and Arjun Das (P08) on the team.
 */
const PASSWORD = 'meridian-demo-2026';
const BASE = 'http://localhost:4273';
const RUN = String(process.env.E2E_RUN ?? Date.now().toString(36)).toUpperCase();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

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

/** Select, PersonPicker and Combobox render their options in a portal on the body. */
async function pick(scope: Locator, page: Page, label: string, option: RegExp, type?: string) {
  const box = scope.getByRole('combobox', { name: label });
  await box.click();
  if (type) await box.fill(type);
  await page.getByRole('option', { name: option }).first().click();
}

/** The studio's today and PRJ-01's Working drawings phase, from the schedule the Timeline reads. */
async function prj01(api: BrowserContext) {
  const r = await api.request.get('/api/v1/projects/PRJ-01/schedule');
  expect(r.ok()).toBeTruthy();
  const s = await r.json();
  const wd = (s.phases as { id: string; code: string }[]).find((p) => p.code === 'WD');
  expect(wd, 'PRJ-01 has a WD phase').toBeTruthy();
  return { today: s.today as string, wd: wd!.id };
}

async function createTask(api: BrowserContext, body: Record<string, unknown>) {
  const r = await api.request.post('/api/v1/projects/PRJ-01/tasks', { data: body });
  expect(r.status(), `create ${String(body.title)}: ${await r.text()}`).toBe(200);
  return (await r.json()).id as string;
}

async function blockedBy(api: BrowserContext, successor: string, predecessor: string) {
  const r = await api.request.post(`/api/v1/tasks/${successor}/dependencies`, { data: { predecessor_id: predecessor } });
  expect(r.status(), await r.text()).toBe(200);
}

async function personId(api: BrowserContext, ref: string) {
  const r = await api.request.get('/api/v1/people');
  expect(r.ok()).toBeTruthy();
  return ((await r.json()).data as { id: string; ref_code: string }[]).find((p) => p.ref_code === ref)!.id;
}

const taskOf = async (api: BrowserContext, id: string) => (await (await api.request.get(`/api/v1/tasks/${id}`)).json());

test('a. the principal moves a task later on the Timeline with the keyboard buttons; its dependent task moves too', async ({ page, browser }) => {
  const vikram = await apiSession(browser, 'p02');
  const { today, wd } = await prj01(vikram);
  const FIRST = `Survey set ${RUN}`;
  const NEXT = `Survey drawings ${RUN}`;
  const first = await createTask(vikram, { title: FIRST, phase_id: wd, start_date: addDays(today, 2), due_date: addDays(today, 4) });
  const next = await createTask(vikram, { title: NEXT, phase_id: wd, start_date: addDays(today, 5), due_date: addDays(today, 7) });
  await blockedBy(vikram, next, first);

  await signedIn(page, 'p01');
  await page.goto('/firm/projects/PRJ-01/timeline');
  const gantt = page.getByRole('table', { name: /phases and tasks on a timeline/ });
  await expect(gantt).toBeVisible();

  // Select the bar (a button), then use the keyboard buttons: three days later, as a draft.
  const bar = gantt.getByRole('button', { name: new RegExp(`^${esc(FIRST)},.*Select to move or change its dates`) });
  await bar.click();
  const controls = page.getByRole('group', { name: `Change the dates of ${FIRST}` });
  await expect(controls).toBeVisible();
  for (let i = 0; i < 3; i++) await controls.getByRole('button', { name: 'Move 1 day later' }).click();
  const changes = page.getByRole('region', { name: 'Unsaved changes' });
  await expect(changes.getByText('Moved: 3 days later. Not saved yet.')).toBeVisible();
  // Nothing is saved yet.
  expect((await taskOf(vikram, first)).due_date).toBe(addDays(today, 4));
  // The successor would now start before the task finishes: warned, and moved on save while cascade is on.
  await expect(changes.getByText(new RegExp(`${esc(NEXT)} starts .*, before ${esc(FIRST)} finishes\\. It moves later when you save\\.`))).toBeVisible();
  await expect(changes.getByRole('switch', { name: 'Move dependent tasks too' })).toBeChecked();
  await changes.getByRole('button', { name: 'Save' }).click();

  const moved = page.getByRole('list', { name: 'Moved items' });
  await expect(moved.getByText(new RegExp(`^${esc(FIRST)}: .*as you asked`))).toBeVisible();
  await expect(moved.getByText(new RegExp(`^${esc(NEXT)}: .*pushed later by a dependency, 3 days`))).toBeVisible();
  await expect(changes).toHaveCount(0);

  // Saved: the task ends three days later and its dependent starts the day after (finish to start, no lag).
  const a = await taskOf(vikram, first);
  expect([a.start_date, a.due_date]).toEqual([addDays(today, 5), addDays(today, 7)]);
  const b = await taskOf(vikram, next);
  expect([b.start_date, b.due_date]).toEqual([addDays(today, 8), addDays(today, 10)]);
  await vikram.close();
});

test('b. a dependency that would make a cycle is refused with the reason', async ({ page, browser }) => {
  const vikram = await apiSession(browser, 'p02');
  const { today, wd } = await prj01(vikram);
  const A = `Brief ${RUN}`; const B = `Massing ${RUN}`; const C = `Facade study ${RUN}`;
  const a = await createTask(vikram, { title: A, phase_id: wd, due_date: addDays(today, 3) });
  const b = await createTask(vikram, { title: B, phase_id: wd, due_date: addDays(today, 6) });
  const c = await createTask(vikram, { title: C, phase_id: wd, due_date: addDays(today, 9) });
  await blockedBy(vikram, b, a);
  await blockedBy(vikram, c, b);

  // A → B → C. Making A wait for C would close the loop.
  await signedIn(page, 'p02');
  await page.goto('/firm/projects/PRJ-01/tasks');
  // The card's own button (its name starts with the title), not the card's "Move …" menu button.
  await page.getByRole('region', { name: 'Task board' }).getByRole('button', { name: new RegExp(`^${esc(A)}`) }).click();
  const sheet = page.getByRole('dialog', { name: A });
  const form = sheet.getByRole('form', { name: 'Add a dependency' });
  await expect(form).toBeVisible();
  await expect(form.getByRole('combobox', { name: 'This task' })).toHaveText(/Is blocked by/);
  await pick(form, page, 'Other task', new RegExp(`^${esc(C)}$`));
  await form.getByRole('button', { name: 'Add dependency' }).click();
  await expect(sheet.getByText(`This would make a cycle: "${C}" already waits, directly or through other tasks, for "${A}".`)).toBeVisible();
  // Nothing was added.
  expect((await taskOf(vikram, a)).blocked_by).toEqual([]);
  await vikram.close();
});

test('c. the assignee follows a task; the planner changes its status; the follower is notified', async ({ page, browser }) => {
  const vikram = await apiSession(browser, 'p02');
  const { today, wd } = await prj01(vikram);
  const TASK = `Lift core detail ${RUN}`;
  const id = await createTask(vikram, { title: TASK, phase_id: wd, assignee_id: await personId(vikram, 'P04'), due_date: addDays(today, 5) });

  // Rohan (the assignee) opens the task from My work and follows it.
  await signedIn(page, 'p04');
  await page.goto('/me/work');
  await page.getByRole('region', { name: 'My tasks' }).getByRole('button', { name: new RegExp(esc(TASK)) }).click();
  const sheet = page.getByRole('dialog', { name: TASK });
  const follow = sheet.getByRole('button', { name: 'Follow', exact: true });
  await follow.click();
  await expect(sheet.getByRole('button', { name: 'Following', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect((await taskOf(vikram, id)).followers.map((f: { ref_code: string }) => f.ref_code)).toContain('P04');

  // Vikram (the PM, a planner) moves it to In progress from the Tasks list.
  const pm = await (await browser.newContext({ baseURL: BASE })).newPage();
  await signedIn(pm, 'p02');
  await pm.goto('/firm/projects/PRJ-01/tasks?view=list');
  await pick(pm.locator('body'), pm, `Status of ${TASK}`, /^In progress$/);
  await expect.poll(async () => (await taskOf(vikram, id)).status).toBe('In progress');
  await pm.context().close();

  // Rohan is told.
  await page.goto('/me/home');
  await page.getByRole('button', { name: /^Notifications/ }).click();
  await expect(page.getByText(`Vikram Nair moved "${TASK}" on PRJ-01 from To do to In progress.`)).toBeVisible();
  await vikram.close();
});

test('d. a team member logs time on a task from its sheet; the task\'s logged hours update', async ({ page, browser }) => {
  const vikram = await apiSession(browser, 'p02');
  const { today, wd } = await prj01(vikram);
  const TASK = `Door schedule ${RUN}`;
  const divya = await personId(vikram, 'P05');
  const id = await createTask(vikram, { title: TASK, phase_id: wd, assignee_id: divya, due_date: addDays(today, 6), estimate_hours: 4 });

  await signedIn(page, 'p05');
  await page.goto('/me/work');
  await page.getByRole('region', { name: 'My tasks' }).getByRole('button', { name: new RegExp(esc(TASK)) }).click();
  const sheet = page.getByRole('dialog', { name: TASK });
  const hours = sheet.getByRole('region', { name: 'Hours', exact: true });
  await expect(hours.getByText('0 h logged against a 4 h estimate.')).toBeVisible();

  const form = sheet.getByRole('form', { name: 'Log time on this task' });
  await form.getByRole('textbox', { name: 'Hours' }).or(form.getByRole('spinbutton', { name: 'Hours' })).fill('1.5');
  await form.getByLabel('What you did').fill('Door schedule first pass');
  await form.getByRole('button', { name: 'Log time' }).click();
  await expect(form.getByRole('status')).toHaveText(/^1\.5 h logged on .*\. It is on your timesheet as a draft\.$/);
  await expect(hours.getByText('1.5 h logged against a 4 h estimate.')).toBeVisible();

  const t = await taskOf(vikram, id);
  expect(Number(t.logged_hours)).toBe(1.5);
  expect(Number(t.estimate.remaining_hours)).toBe(2.5);
  await vikram.close();
});

test('e. Projects Health shows the overrun project At risk with its reason; a PM sees margin as Restricted', async ({ page, browser }) => {
  // The reason comes from the API in the same session (the earlier specs add time on the same database).
  const asha = await apiSession(browser, 'p01');
  const health = await (await asha.request.get('/api/v1/projects/health')).json();
  const row = health.data.find((r: { code: string }) => r.code === 'PRJ-01');
  expect(row.health.status).toBe('At risk');
  const reason = row.health.reasons[0] as string;
  expect(reason).toMatch(/^Hours forecast .* h is .*% of the .* h budget$/);
  await asha.close();

  await signedIn(page, 'p01');
  await page.goto('/firm/projects?view=health');
  const table = page.getByRole('table', { name: 'Project health' });
  const prj = table.getByRole('row').filter({ has: page.getByRole('link', { name: /^PRJ-01 / }) });
  await expect(prj).toHaveCount(1);
  await expect(prj.getByText('At risk', { exact: true })).toBeVisible();
  await expect(prj.getByText(reason, { exact: false })).toBeVisible();
  // The principal sees margin figures.
  await expect(prj.getByText('Restricted')).toHaveCount(0);

  // Vikram (PM of PRJ-01) sees the same status and reason, with margin fenced.
  const pm = await (await browser.newContext({ baseURL: BASE })).newPage();
  await signedIn(pm, 'p02');
  await pm.goto('/firm/projects?view=health');
  const pmRow = pm.getByRole('table', { name: 'Project health' }).getByRole('row').filter({ has: pm.getByRole('link', { name: /^PRJ-01 / }) });
  await expect(pmRow.getByText('At risk', { exact: true })).toBeVisible();
  await expect(pmRow.getByText(reason, { exact: false })).toBeVisible();
  const margin = pmRow.getByRole('cell').filter({ hasText: 'margin viewers only' });
  await expect(margin.getByText('Restricted')).toBeVisible();
  const pmApi = await (await pm.context().request.get('/api/v1/projects/health')).json();
  expect(pmApi.data.find((r: { code: string }) => r.code === 'PRJ-01').margin).toEqual({ restricted: true });
  await pm.context().close();
});
