import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';

/**
 * A brand-new studio on a real database, with nothing from the demo studio anywhere on its pages.
 * The platform admin adds a company; its owner accepts the invite, adds a project manager and an employee, and creates a
 * client and a fixed-fee project for the PM. (a) The PM adds the employee to the team from the project and assigns them
 * a task with a due date; the employee finds it under My work and moves it to In progress, then Done. (b) The owner
 * visits every route, every project tab and every settings section, and opens the command palette and notifications:
 * no demo person, project, client or invoice may show.
 * Runs with playwright.live.config.ts (its own API and throwaway database, seeded with the demo studio). Takes no
 * screenshots and writes nothing under docs/.
 */
const BASE = 'http://localhost:4273';
const PASSWORD = 'fresh-studio-2026';
// Unique per run so the suite can rerun against a reused database.
const RUN = String(process.env.E2E_RUN ?? Date.now().toString(36)).toUpperCase();
const COMPANY = `Kestrel Atelier ${RUN}`;
const DOMAIN = `kestrel-${RUN.toLowerCase()}.demo`;
// None of these contains a demo name or surname.
const OWNER = { name: 'Mira Kapoor', email: `mira.${RUN.toLowerCase()}@${DOMAIN}` };
const PM = { name: 'Dev Sharma', email: `dev.${RUN.toLowerCase()}@${DOMAIN}` };
const EMPLOYEE = { name: 'Isha Kulkarni', email: `isha.${RUN.toLowerCase()}@${DOMAIN}` };
const CODE = `KA-${RUN}`;
const PROJECT = `Kestrel Pavilion ${RUN}`;
const CLIENT = `Tidewater Trust ${RUN}`;
const TASK = `Measure the site ${RUN}`;

/** Anything from the demo studio (Studio Meridian) or the sample screens. */
const DEMO = [
  'Asha Rao', 'Vikram Nair', 'Meera Iyer', 'Rohan Shetty', 'Divya Menon', 'Karan Bhat', 'Sneha Pillai', 'Arjun Das', 'Nisha Kumar', 'Farah Khan',
  'Studio Meridian', 'Lakeview', 'Orchard', 'Heritage', 'INV-DEMO',
];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Select, PersonPicker and Combobox render their options in a portal on the body. */
async function pick(scope: Locator | Page, page: Page, label: string, option: RegExp, type?: string) {
  const box = scope.getByRole('combobox', { name: label });
  await box.click();
  if (type) await box.fill(type);
  await page.getByRole('option', { name: option }).first().click();
}

/** MoneyField swaps grouped text for the raw number on focus, so type the way a person does. */
async function typeMoney(field: Locator, value: string) {
  await field.click();
  await field.press('Control+a');
  await field.pressSequentially(value);
}

/** Opens an invite link in a clean browser context and sets a password. Returns the page, signed in. */
async function acceptInvite(browser: Browser, url: string) {
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto(url);
  await expect(page.getByRole('heading', { name: /^Join / })).toBeVisible();
  await page.getByLabel('New password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Set password and sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/accept-invite'));
  return { ctx, page };
}

async function signIn(browser: Browser, email: string) {
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto('/login/studio');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  return { ctx, page };
}

async function addAccount(page: Page, who: { name: string; email: string }, title: string, check: RegExp[] = []) {
  await page.getByRole('button', { name: 'Add account' }).first().click();
  await page.getByLabel('Full name').fill(who.name);
  await page.getByLabel('Work email').fill(who.email);
  await page.getByLabel('Job title').fill(title);
  for (const t of check) await page.getByRole('checkbox', { name: t }).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Account created')).toBeVisible();
  const url = await page.getByLabel('Invite link').inputValue();
  expect(url).toContain('/accept-invite/');
  await page.getByRole('button', { name: 'Done' }).click();
  return url;
}

/** Waits for the page's requests to settle, then returns the demo names it shows. */
async function demoOnPage(page: Page, scope?: Locator): Promise<string[]> {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(150);
  const text = await (scope ?? page.locator('body')).innerText();
  return DEMO.filter((n) => text.includes(n));
}

/** YYYY-MM-DD for today plus n days, in the browser's (this machine's) local calendar, as the Calendar draws it. */
function isoIn(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test.describe.configure({ mode: 'serial' });
// A stuck click or navigation fails fast with its own call log instead of using up the whole test timeout.
test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

test('a. a new studio: the PM adds the employee to the team and assigns a task; the employee finishes it', async ({ page, browser }) => {
  test.setTimeout(240_000);
  // The platform admin adds the company with Mira Kapoor as its owner.
  await page.goto('/platform/login');
  await page.getByLabel('Email').fill('admin@platform.demo');
  await page.getByLabel('Password').fill('platform-demo-2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => u.pathname === '/platform');
  await page.getByRole('button', { name: 'Add company' }).first().click();
  await page.getByLabel('Trading name').fill(COMPANY);
  await page.getByLabel('Legal name').fill(`${COMPANY} LLP`);
  await page.getByLabel('Owner name').fill(OWNER.name);
  await page.getByLabel('Owner email').fill(OWNER.email);
  await page.getByRole('button', { name: 'Create company' }).click();
  await expect(page.getByText(`${COMPANY} is ready.`)).toBeVisible();
  const ownerInvite = await page.getByLabel('Invite link').inputValue();
  await page.getByRole('button', { name: 'Done' }).click();

  const owner = await acceptInvite(browser, ownerInvite);
  const o = owner.page;
  expect(await demoOnPage(o), `the new owner's first page (${o.url()})`).toEqual([]);

  // The owner adds a project manager and an employee; both accept their invites.
  await o.goto('/firm/settings/accounts');
  await expect(o.getByRole('heading', { name: 'Accounts' })).toBeVisible();
  const pmInvite = await addAccount(o, PM, 'Project architect', [/^Project manager/]);
  const employeeInvite = await addAccount(o, EMPLOYEE, 'Architect');
  expect(await demoOnPage(o), 'Accounts').toEqual([]);
  const pm = await acceptInvite(browser, pmInvite);
  const employee = await acceptInvite(browser, employeeInvite);

  // The owner creates a client and a fixed-fee project with Dev Sharma as its PM, and no one else on the team.
  await o.goto('/firm/projects');
  await o.getByRole('button', { name: 'Create project' }).first().click();
  const sheet = o.getByRole('dialog', { name: 'Create project' });
  await sheet.getByLabel('Project code').fill(CODE);
  await sheet.getByLabel('Name', { exact: true }).fill(PROJECT);
  await pick(sheet, o, 'Client', /^Add a new client$/);
  await sheet.getByLabel('New client name').fill(CLIENT);
  await pick(sheet, o, 'Project manager', new RegExp(PM.name), 'Dev');
  await sheet.getByRole('button', { name: 'Save and continue' }).click();
  await pick(sheet, o, 'Phase template', /^Refit, 4 phases$/);
  await expect(sheet.getByRole('combobox', { name: 'Fee basis' })).toHaveText(/Fixed fee/);
  await typeMoney(sheet.getByLabel('Contracted fee'), '400000');
  await expect(sheet.getByLabel('Concept design fee')).toHaveValue('1,00,000');
  await sheet.getByRole('button', { name: 'Save and continue' }).click();
  await expect(sheet.getByText(`${CLIENT} (new)`)).toBeVisible();
  await sheet.getByRole('button', { name: 'Create project' }).click();
  await o.waitForURL(new RegExp(`/firm/projects/${esc(CODE)}`));
  expect(await demoOnPage(o), 'the new project').toEqual([]);
  await owner.ctx.close();

  // (a) The PM opens the project's Tasks tab: no tasks yet, and Isha is not on the team.
  const p = pm.page;
  await p.goto(`/firm/projects/${CODE}/tasks`);
  await expect(p.getByText('No tasks yet. Add the first one and assign it to someone on the team.')).toBeVisible();
  const team = p.getByRole('region', { name: 'Team members' });
  await expect(team.getByRole('row', { name: new RegExp(PM.name) })).toBeVisible();
  await expect(team.getByRole('row', { name: new RegExp(EMPLOYEE.name) })).toHaveCount(0);
  expect(await demoOnPage(p), 'the PM\'s Tasks tab').toEqual([]);

  // The PM adds Isha to the team from the project.
  await pick(p, p, 'Add a person', new RegExp(EMPLOYEE.name), 'Isha');
  await p.getByRole('button', { name: 'Add to team' }).click();
  await expect(p.getByText(`${EMPLOYEE.name} added to the team.`)).toBeVisible();
  await expect(team.getByRole('row', { name: new RegExp(EMPLOYEE.name) })).toBeVisible();

  // The PM creates a task for Isha, due in three days.
  const due = isoIn(3);
  await p.getByRole('button', { name: 'New task' }).first().click();
  const taskSheet = p.getByRole('dialog', { name: 'New task' });
  await taskSheet.getByLabel('Title').fill(TASK);
  await pick(taskSheet, p, 'Assignee', new RegExp(EMPLOYEE.name), 'Isha');
  await expect(taskSheet.getByText('People on the project team.')).toBeVisible();
  await taskSheet.getByRole('button', { name: 'Due' }).click();
  await p.locator(`.calendar [data-day="${due}"]`).click();
  await pick(taskSheet, p, 'Priority', /^High$/);
  await taskSheet.getByRole('button', { name: 'Add task' }).click();
  await expect(p.getByText(`${TASK} added for ${EMPLOYEE.name}.`)).toBeVisible();
  await expect(p.getByRole('region', { name: 'Task board' }).getByText(TASK, { exact: true })).toBeVisible();

  // The server has it: assigned to Isha, due that day, To do.
  const listed = await (await p.request.get(`/api/v1/projects/${CODE}/tasks`)).json();
  expect(listed.can_plan).toBe(true);
  expect(listed.data).toHaveLength(1);
  expect(listed.data[0]).toMatchObject({ title: TASK, status: 'To do', priority: 'High', due_date: due, assignee: { name: EMPLOYEE.name } });
  const taskId = listed.data[0].id as string;

  // The employee sees it under My work and moves it to In progress, then Done.
  const e = employee.page;
  await e.goto('/me/work');
  const myTasks = e.getByRole('region', { name: 'My tasks' });
  await expect(myTasks.getByText(TASK, { exact: true })).toBeVisible();
  await expect(myTasks.getByText(CODE).first()).toBeVisible();
  await expect(e.getByText(new RegExp(`${esc(CODE)} ${esc(PROJECT)}`)).first()).toBeVisible();
  expect(await demoOnPage(e), 'the employee\'s My work').toEqual([]);
  await pick(myTasks, e, `Status of ${TASK}`, /^In progress$/);
  await expect(e.getByText(`${TASK} moved to In progress.`)).toBeVisible();
  await e.reload();
  await expect(myTasks.getByRole('combobox', { name: `Status of ${TASK}` })).toHaveText(/In progress/);
  await pick(myTasks, e, `Status of ${TASK}`, /^Done$/);
  await expect(e.getByText(`${TASK} is done.`)).toBeVisible();
  await expect(myTasks.getByText(TASK, { exact: true })).toHaveCount(0);
  await e.reload();
  await expect(e.getByText('No open tasks are assigned to you.')).toBeVisible();

  // The employee may not edit anything else about the task.
  const refused = await e.request.put(`/api/v1/tasks/${taskId}`, { data: { title: 'Renamed by the assignee' } });
  expect(refused.status()).toBe(403);
  await employee.ctx.close();

  // The PM sees it done, and was told.
  const done = await (await p.request.get(`/api/v1/tasks/${taskId}`)).json();
  expect(done).toMatchObject({ status: 'Done', title: TASK });
  expect(done.completed_at).toBeTruthy();
  await p.reload();
  await expect(p.getByRole('region', { name: 'Task board' }).getByText(TASK, { exact: true })).toBeVisible();
  await pm.ctx.close();
});

/** Every route in the router, as the owner (a principal) of the new studio. */
function routesToCrawl(code: string, personRef: string) {
  const projectTabs = ['', '/phases', '/tasks', '/staffing', '/time', '/costs', '/billing', '/changes', '/files', '/activity'];
  const settings = ['profile', 'permissions', 'accounts', 'rates', 'calendars', 'work-categories', 'templates', 'approvals', 'approval-policies', 'integrations', 'imports'];
  const reports = ['utilization', 'contribution', 'budget-vs-actual', 'fee-entitlement', 'work-in-progress', 'receivables-ageing', 'timesheet-compliance'];
  return [
    '/firm/overview', '/firm/people', `/firm/people/${personRef}`, '/firm/workload', '/firm/pipeline', '/firm/proposals/PROP-01', '/firm/projects',
    ...projectTabs.map((t) => `/firm/projects/${code}${t}`),
    // The sample's own codes: a lookup into the sample studio by code would show its names.
    '/firm/projects/PRJ-01', '/firm/people/P02',
    '/firm/approvals', '/firm/billing', '/firm/receivables', '/firm/reports',
    ...reports.map((k) => `/firm/reports/${k}`),
    '/firm/settings',
    ...settings.map((s) => `/firm/settings/${s}`),
    '/me/home', '/me/work', '/me/schedule', '/me/time', '/me/expenses', '/me/leave', '/me/profile',
  ];
}

/** Visits each route, then opens the command palette and notifications. Returns what showed the demo studio. */
async function crawl(page: Page, who: string, routes: string[]): Promise<string[]> {
  const failures: string[] = [];
  for (const route of routes) {
    await page.goto(route);
    const found = await demoOnPage(page);
    if (found.length) failures.push(`${who} ${route}: ${found.join(', ')}`);
    // Signed in, in this studio's shell: the side nav carries its name (so a blank or signed-out page cannot pass).
    else if (!(await page.locator('body').innerText()).includes(COMPANY)) failures.push(`${who} ${route}: not in ${COMPANY}'s shell (${page.url()})`);
  }

  // The command palette, with its project and people search loaded (for anyone who may use the Firm interface).
  await page.goto(routes[0]);
  await page.getByRole('button', { name: /Search people, projects, actions/ }).click();
  const palette = page.getByRole('dialog').last();
  await expect(palette).toBeVisible();
  if (routes[0].startsWith('/firm')) await expect(palette.getByText(`${CODE} ${PROJECT}`)).toBeVisible();
  const inPalette = await demoOnPage(page, palette);
  if (inPalette.length) failures.push(`${who} command palette: ${inPalette.join(', ')}`);
  await page.keyboard.press('Escape');

  // Notifications.
  await page.getByRole('button', { name: /^Notifications/ }).click();
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  const inNotifications = await demoOnPage(page);
  if (inNotifications.length) failures.push(`${who} notifications: ${inNotifications.join(', ')}`);
  return failures;
}

test('b. crawl: no route, palette or notification of the new studio shows the demo studio', async ({ browser }) => {
  test.setTimeout(480_000);
  const owner = await signIn(browser, OWNER.email);
  const people = (await (await owner.page.request.get('/api/v1/people/directory')).json()).data as { ref_code: string; name: string }[];
  expect(people.map((x) => x.name).sort()).toEqual([PM.name, EMPLOYEE.name, OWNER.name].sort());
  const routes = routesToCrawl(CODE, people.find((x) => x.name === PM.name)!.ref_code);

  const failures = await crawl(owner.page, 'owner', routes);
  await owner.ctx.close();
  // The PM sees the same routes with project-scoped access; the employee has My pages only (and the task notification).
  const pm = await signIn(browser, PM.email);
  failures.push(...await crawl(pm.page, 'PM', routes));
  await pm.ctx.close();
  const employee = await signIn(browser, EMPLOYEE.email);
  failures.push(...await crawl(employee.page, 'employee', routes.filter((r) => r.startsWith('/me'))));
  await employee.ctx.close();

  expect(failures, 'routes that show the demo studio').toEqual([]);
});
