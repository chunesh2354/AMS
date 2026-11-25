import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';

/**
 * Planning on a real database, end to end in the demo studio (Studio Meridian).
 * Asha Rao (P01, principal) adds a new employee with no manager (so leave routes to her, the fallback approver), sets
 * their weekly hours to 30 on the person's Capacity tab and creates a project. In the planner she allocates the employee
 * 20 h on a phase in a week two or more weeks out (adding them to the team when the server asks) and sees the heatmap
 * cell read 20 of 30. The employee does not see it on My schedule until she publishes. The employee requests a day of
 * leave that week and Asha approves it: the cell reads 20 of 24. A studio holiday added in Settings > Calendars shows on
 * the Calendar and takes the week to 18 h available: 20 h confirmed is then over capacity, in red.
 * Staff never reach the planner or the draft plan. Runs with playwright.live.config.ts (its own API and throwaway
 * database). Takes no screenshots and writes nothing under docs/. Dates come from the server's today, never this
 * machine's clock.
 */
const PASSWORD = 'meridian-demo-2026';
const NEW_PASSWORD = 'planning-e2e-2026';
const BASE = 'http://localhost:4273';
// Unique per run so the suite can rerun against a reused database.
const RUN = String(process.env.E2E_RUN ?? Date.now().toString(36)).toUpperCase();
const EMPLOYEE = { name: 'Tara Joshi', email: `tara.${RUN.toLowerCase()}@meridian.demo` };
const CODE = `PLN-${RUN}`;
const PROJECT = `Planning House ${RUN}`;
const HOLIDAY = `Founders day ${RUN}`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------- Dates as the app prints them (UTC arithmetic on YYYY-MM-DD, as the app does) ----------
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const utc = (d: string) => new Date(`${d}T00:00:00Z`);
const addDays = (d: string, n: number) => new Date(utc(d).getTime() + n * 86_400_000).toISOString().slice(0, 10);
/** "7 Dec" */
const dm = (d: string) => `${utc(d).getUTCDate()} ${MON[utc(d).getUTCMonth()]}`;
/** "7 Dec 2026" */
const dmy = (d: string) => `${dm(d)} ${utc(d).getUTCFullYear()}`;
/** "Thursday 10 December", the start of a calendar day cell's name. */
const longDay = (d: string) => `${DAYS[utc(d).getUTCDay()]} ${utc(d).getUTCDate()} ${MONTHS[utc(d).getUTCMonth()]}`;
/** Calendar months from the one holding `from` to the one holding `to`: how many times to press "Next month" in a date picker. */
const monthsAhead = (from: string, to: string) => (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));

async function signIn(browser: Browser, email: string, password = PASSWORD) {
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto('/login/studio');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  return { ctx, page };
}

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

type ApiWeek = { week_start: string; holidays: unknown[]; leave: unknown[]; allocated: string; available: string; conflict: boolean; over_hours: string };
type ApiWorkload = { today: string; weeks: string[]; people: { person: { id: string; ref_code: string; name: string }; weeks: ApiWeek[] }[] };

async function workload(page: Page, from?: string): Promise<ApiWorkload> {
  const res = await page.request.get(`/api/v1/workload?weeks=8${from ? `&from=${from}` : ''}`);
  expect(res.ok(), 'GET /workload').toBeTruthy();
  return res.json();
}
const weekOf = (w: ApiWorkload, name: string, ws: string) => w.people.find((p) => p.person.name === name)?.weeks.find((x) => x.week_start === ws);

/** The heatmap cell for the employee in the target week: a button whose name reads the hours. */
const heatCell = (page: Page, ws: string) => page.getByRole('table', { name: 'Booked hours by person and week' })
  .getByRole('button', { name: new RegExp(`^${esc(EMPLOYEE.name)}, week of ${esc(dm(ws))}:`) });

test.describe.configure({ mode: 'serial' });
// A stuck click or navigation fails fast with its own call log instead of using up the whole test timeout.
test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

test('plan, publish, leave and a studio holiday move the heatmap; staff see only the published plan', async ({ browser }) => {
  test.setTimeout(300_000);
  const asha = await signIn(browser, 'p01@meridian.demo');
  const a = asha.page;

  // Asha adds the employee (no manager, so their leave comes to her) and they accept the invite.
  await a.goto('/firm/settings/accounts');
  await a.getByRole('button', { name: 'Add account' }).first().click();
  await a.getByLabel('Full name').fill(EMPLOYEE.name);
  await a.getByLabel('Work email').fill(EMPLOYEE.email);
  await a.getByLabel('Job title').fill('Architect');
  await a.getByRole('button', { name: 'Create account' }).click();
  await expect(a.getByText('Account created')).toBeVisible();
  const invite = await a.getByLabel('Invite link').inputValue();
  await a.getByRole('button', { name: 'Done' }).click();
  {
    const ctx = await browser.newContext({ baseURL: BASE });
    const p = await ctx.newPage();
    await p.goto(invite);
    await p.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
    await p.getByLabel('Confirm password').fill(NEW_PASSWORD);
    await p.getByRole('button', { name: 'Set password and sign in' }).click();
    await p.waitForURL((u) => !u.pathname.startsWith('/accept-invite'));
    await ctx.close();
  }
  const people = (await (await a.request.get('/api/v1/people/directory')).json()).data as { id: string; ref_code: string; name: string }[];
  const tara = people.find((p) => p.name === EMPLOYEE.name)!;
  expect(tara, 'the new employee is in the directory').toBeTruthy();

  // Capacity tab: 30 h a week from today (6 h a day, Monday to Friday).
  await a.goto(`/firm/people/${tara.ref_code}?tab=capacity`);
  await expect(a.getByRole('heading', { name: 'Weekly hours' })).toBeVisible();
  await a.getByRole('button', { name: 'Change weekly hours' }).click();
  const hoursSheet = a.getByRole('dialog', { name: 'Change weekly hours' });
  await hoursSheet.getByLabel('Hours per week').fill('30');
  await hoursSheet.getByRole('button', { name: 'Save hours' }).click();
  await expect(hoursSheet).toBeHidden();
  const cap = await (await a.request.get(`/api/v1/people/${tara.ref_code}/capacity`)).json();
  expect(Number(cap.current.weekly_hours)).toBe(30);

  // The target week: two to four weeks out (inside My schedule's six weeks), with no studio holiday in it yet.
  const before = await workload(a);
  const ws = [2, 3, 4].map((i) => before.weeks[i]).find((w) => !weekOf(before, EMPLOYEE.name, w)!.holidays.length)!;
  expect(ws, 'a week without a studio holiday').toBeTruthy();
  expect(weekOf(before, EMPLOYEE.name, ws)).toMatchObject({ allocated: '0.00', available: '30.00' });
  const leaveDay = addDays(ws, 2); // Wednesday
  const holidayDay = addDays(ws, 3); // Thursday

  // Asha creates a project she leads; the employee is not on its team.
  await a.goto('/firm/projects');
  await a.getByRole('button', { name: 'Create project' }).first().click();
  const sheet = a.getByRole('dialog', { name: 'Create project' });
  await sheet.getByLabel('Project code').fill(CODE);
  await sheet.getByLabel('Name', { exact: true }).fill(PROJECT);
  await pick(sheet, a, 'Client', /^Lakeview Trust$/);
  await pick(sheet, a, 'Project manager', /Asha Rao/, 'Asha');
  await sheet.getByRole('button', { name: 'Save and continue' }).click();
  await pick(sheet, a, 'Phase template', /^Refit, 4 phases$/);
  await typeMoney(sheet.getByLabel('Contracted fee'), '400000');
  await expect(sheet.getByLabel('Concept design fee')).toHaveValue('1,00,000');
  await sheet.getByRole('button', { name: 'Save and continue' }).click();
  await sheet.getByRole('button', { name: 'Create project' }).click();
  await a.waitForURL(new RegExp(`/firm/projects/${esc(CODE)}`));

  // The planner, filtered to the project: Add allocation, 20 h confirmed on Concept design in the target week.
  await a.goto(`/firm/workload?view=planner&project=${CODE}`);
  await expect(a.getByRole('grid', { name: 'Resource planner' })).toBeVisible();
  await a.getByRole('button', { name: 'Add allocation' }).click();
  const alloc = a.getByRole('dialog', { name: 'Add allocation' });
  await pick(alloc, a, 'Person', new RegExp(`^${esc(EMPLOYEE.name)}$`));
  await expect(alloc.getByRole('combobox', { name: 'Project' })).toHaveText(new RegExp(esc(CODE)));
  await pick(alloc, a, 'Phase', /^Concept design$/);
  await pick(alloc, a, 'Week starting', new RegExp(`^Week of ${esc(dmy(ws))}$`));
  await alloc.getByLabel('Hours').fill('20');
  await alloc.getByRole('button', { name: 'Save allocation' }).click();
  // The server asks before adding someone to the team.
  const addToTeam = alloc.getByRole('checkbox', { name: `Add ${EMPLOYEE.name} to the team as a contributor` });
  await expect(addToTeam).toBeVisible();
  await addToTeam.check();
  await alloc.getByRole('button', { name: 'Save allocation' }).click();
  await expect(a.getByText(`Allocation saved and ${EMPLOYEE.name} added to the team. Publish to tell the team.`)).toBeVisible();
  await expect(alloc).toBeHidden();
  const team = await (await a.request.get(`/api/v1/projects/${CODE}/members`)).json();
  expect(JSON.stringify(team)).toContain(EMPLOYEE.name);

  // The heatmap cell now reads 20 of 30, part booked.
  await a.goto('/firm/workload');
  await expect(heatCell(a, ws)).toHaveAccessibleName(`${EMPLOYEE.name}, week of ${dm(ws)}: 20 of 30 hours, part booked`);
  await expect(heatCell(a, ws)).toHaveText('20');

  // Staff never reach the planner or the draft plan; My schedule shows nothing until it is published.
  const tj = await signIn(browser, EMPLOYEE.email, NEW_PASSWORD);
  const e = tj.page;
  expect((await e.request.get('/api/v1/workload')).status()).toBe(403);
  expect((await e.request.get('/api/v1/allocations?view=draft')).status()).toBe(403);
  await e.goto('/firm/workload');
  await expect(e.getByRole('grid', { name: 'Resource planner' })).toHaveCount(0);
  await expect(e.getByRole('button', { name: 'Add allocation' })).toHaveCount(0);
  await expect(e.getByText(/You need the use the Firm interface permission/)).toBeVisible();
  await e.goto('/me/schedule');
  await expect(e.getByRole('heading', { level: 2, name: new RegExp(`^Week of ${esc(dm(ws))}`) })).toBeVisible();
  await expect(e.getByText(CODE)).toHaveCount(0);
  const draftOnly = await (await e.request.get('/api/v1/me/schedule')).json();
  expect(JSON.stringify(draftOnly)).not.toContain(CODE);

  // Asha publishes the project's plan.
  await a.goto(`/firm/workload?view=planner&project=${CODE}`);
  await a.getByRole('button', { name: 'Publish plan (1 change)' }).click();
  const pub = a.getByRole('dialog', { name: 'Publish plan' });
  await pub.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(a.getByText(/Plan revision \d+ published: 1 change, 1 person notified\./)).toBeVisible();

  // Now it is on the employee's schedule.
  await e.reload();
  const bookings = e.getByRole('list', { name: `Bookings, week of ${dm(ws)}` });
  await expect(bookings).toContainText(CODE);
  await expect(bookings).toContainText('Concept design');

  // The employee requests a day of leave that week (Wednesday) and Asha approves it.
  await e.goto('/me/leave');
  await e.getByRole('button', { name: 'Request leave' }).first().click();
  const req = e.getByRole('dialog', { name: 'Request leave' });
  await pick(req, e, 'Type', /^Unpaid leave/);
  await req.getByLabel('Dates').click();
  const day = e.getByRole('button', { name: dmy(leaveDay), exact: true });
  // The picker opens on the studio's current month.
  for (let i = 0; i < monthsAhead(before.today, leaveDay); i += 1) await e.getByRole('button', { name: 'Next month' }).click();
  await day.click();
  await day.click();
  await req.getByRole('button', { name: 'Submit request' }).click();
  await expect(e.getByText(/Leave requested for .*Asha Rao decides\./)).toBeVisible();

  await a.goto('/firm/approvals');
  const item = a.getByRole('listitem').filter({ hasText: EMPLOYEE.name });
  await expect(item).toHaveCount(1);
  await item.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(a.getByText(`Approved ${EMPLOYEE.name}, leave.`)).toBeVisible();
  await expect(item).toHaveCount(0);

  // A day off: 24 h available, 20 h booked is full, not over.
  await a.goto('/firm/workload');
  await expect(heatCell(a, ws)).toHaveAccessibleName(`${EMPLOYEE.name}, week of ${dm(ws)}: 20 of 24 hours, full, 1 day off`);
  expect(weekOf(await workload(a), EMPLOYEE.name, ws)).toMatchObject({ available: '24.00', conflict: false });

  // Asha adds a studio holiday on Thursday in Settings > Calendars.
  await a.goto('/firm/settings/calendars');
  await expect(a.getByRole('heading', { name: 'Calendars' })).toBeVisible();
  const add = a.getByRole('form', { name: 'Add a holiday' });
  await add.getByLabel('Date').click();
  const hday = a.getByRole('button', { name: dmy(holidayDay), exact: true });
  for (let i = 0; i < monthsAhead(before.today, holidayDay); i += 1) await a.getByRole('button', { name: 'Next month' }).click();
  await hday.click();
  await add.getByLabel('Name').fill(HOLIDAY);
  await add.getByRole('button', { name: 'Add holiday' }).click();
  await expect(a.getByText(`${HOLIDAY} on`)).toBeVisible();
  await expect(a.getByRole('region', { name: 'Studio holidays' }).getByRole('row', { name: new RegExp(`^${esc(dmy(holidayDay))} ${esc(HOLIDAY)} Whole day`) })).toBeVisible();

  // The Calendar shows it, and the employee's leave as "on leave", never its type.
  await a.goto('/firm/calendar');
  await a.getByRole('radio', { name: 'Week' }).click();
  // Week view opens on this week (the studio's today, as /workload's first week); step forward to the target week.
  const steps = Math.round((utc(ws).getTime() - utc(before.weeks[0]).getTime()) / (7 * 86_400_000));
  for (let i = 0; i < steps; i += 1) await a.getByRole('button', { name: 'Next week' }).click();
  const thursday = a.getByRole('cell', { name: new RegExp(`^${esc(longDay(holidayDay))}`) });
  await expect(thursday.getByRole('button', { name: `${HOLIDAY}, Studio holiday` })).toBeVisible();
  const wednesday = a.getByRole('cell', { name: new RegExp(`^${esc(longDay(leaveDay))}`) });
  await expect(wednesday.getByRole('button', { name: new RegExp(`^${esc(EMPLOYEE.name)} on leave`) })).toBeVisible();
  await expect(wednesday).not.toContainText('Unpaid');
  // The popover links nowhere for someone else's leave; the holiday's popover names it.
  await thursday.getByRole('button', { name: `${HOLIDAY}, Studio holiday` }).click();
  await expect(a.getByRole('dialog', { name: HOLIDAY })).toContainText('Studio holiday');
  await a.keyboard.press('Escape');

  // The holiday takes the week to 18 h: 20 h confirmed is over capacity, in red.
  await a.goto('/firm/workload');
  const cell = heatCell(a, ws);
  await expect(cell).toHaveAccessibleName(`${EMPLOYEE.name}, week of ${dm(ws)}: 20 of 18 hours, over capacity, 2 days off`);
  await expect(cell).toHaveClass(/heat__cell--over/);
  expect(weekOf(await workload(a), EMPLOYEE.name, ws)).toMatchObject({ available: '18.00', conflict: true, over_hours: '2.00' });
  // The planner lists the conflict.
  await a.goto(`/firm/workload?view=planner&project=${CODE}`);
  await expect(a.getByRole('group', { name: /over capacity/ })).toContainText(`${EMPLOYEE.name}, week of ${dm(ws)}: 20 h confirmed against 18 h available, 2 h over.`);

  // The employee sees the holiday and their own leave on My schedule.
  await e.goto('/me/schedule');
  const daysOff = e.getByRole('list', { name: `Days off, week of ${dm(ws)}` });
  await expect(daysOff).toContainText(HOLIDAY);
  await expect(daysOff).toContainText('Unpaid leave');

  await tj.ctx.close();
  await asha.ctx.close();
});
