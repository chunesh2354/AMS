import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SCHEDULES_MISSING } from '../src/modules/overview/overview.routes';
import { freshApp, type Fresh } from './helpers';

/**
 * GET /overview, the studio home, against the demo seed (seeded with today = 2026-11-06, a Friday, Asia/Kolkata):
 * figures match the seed facts, a PM sees only their own projects, staff are refused, bad parameters are 400s,
 * "today" follows the studio's timezone, and another firm's records never appear.
 */
const DAY = '2026-11-06';
let f: Fresh;
beforeAll(async () => { f = await freshApp(); });
afterAll(async () => { await f?.close(); });

const overview = (ref: string, qs = `as_of=${DAY}`) => f.call(ref, 'GET', `/overview${qs ? `?${qs}` : ''}`);
const m = (amount: string) => ({ amount, currency: 'INR' });
const ofType = (body: any, type: string) => body.attention.filter((a: any) => a.type === type);

describe('principal, firm-wide', () => {
  it('shows ready to bill ₹4,86,000, INV-DEMO-0007 overdue ₹1,60,000 and the approvals waiting', async () => {
    const r = await overview('P01');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ as_of: DAY, timezone: 'Asia/Kolkata', scope: 'firm', period: { from: '2026-11-01', to: DAY }, week: { from: '2026-11-02', to: '2026-11-08' } });
    expect(r.body.figures.ready_to_bill).toEqual({ value: m('486000.00'), count: 3, complete: true, missing: [] });
    expect(r.body.figures.overdue).toEqual({ value: m('160000.00'), count: 1 });
    expect(r.body.figures.approvals_waiting).toMatchObject({ count: 0, stale_after_days: 3 });
  });

  it('computes utilization from approved billable hours and marks it incomplete, naming the schedules and Nisha Kumar (R22)', async () => {
    const u = (await overview('P01')).body.figures.utilization;
    // No approved billable time falls in 1 to 6 November; ten active people, five weekdays, a standard 8 h day.
    expect(u).toMatchObject({ value: 0, billable_hours: '0.00', available_hours: '400.00', people: 10, complete: false });
    expect(u.missing).toEqual([SCHEDULES_MISSING, 'Nisha Kumar cost rate']);
    // Earlier in October the two approved lines (Karan 6 h on the NTE, Nisha 8 h) count: 14 h of 22 weekdays x 8 h x 10 people.
    const oct = (await overview('P01', 'as_of=2026-10-31')).body.figures.utilization;
    expect(oct).toMatchObject({ billable_hours: '14.00', available_hours: '1760.00', value: 0.8 });
  });

  it('derives every attention row from real conditions, with severity, age and a link', async () => {
    const body = (await overview('P01')).body;
    const [inv] = ofType(body, 'overdue_invoice');
    expect(inv).toMatchObject({ severity: 'danger', title: 'INV-DEMO-0007 unpaid', age_days: 40, link: '/firm/receivables', amount: m('160000.00') });
    expect(inv.detail).toContain('₹1,60,000');
    expect(inv.detail).toContain('follow-up Farah Khan');

    const [nte] = ofType(body, 'nte_excess');
    expect(nte).toMatchObject({ severity: 'danger', age_days: 10, link: '/firm/projects/PRJ-02/billing', amount: m('2000.00') });
    expect(nte.detail).toMatch(/Eligible ₹4,000, excess ₹2,000 over the ₹1,00,000 cap · Karan Bhat/);

    const overruns = ofType(body, 'phase_overrun');
    expect(overruns.map((o: any) => o.title).sort()).toEqual(['PRJ-01 Working drawings', 'PRJ-02 Additional services', 'PRJ-02 Schematic design']);
    const wd = overruns.find((o: any) => o.title === 'PRJ-01 Working drawings');
    expect(wd).toMatchObject({ detail: '200 h budget, 170 h actual, 60 h ETC · forecast +30 h', link: '/firm/projects/PRJ-01/phases' });

    expect(ofType(body, 'over_day_hours')).toEqual([expect.objectContaining({
      severity: 'warn', title: 'Rohan Shetty over 12 h on Thursday', detail: '12.50 h logged on 5 Nov', age_days: 1, link: '/firm/projects/PRJ-01/time',
    })]);
    expect(ofType(body, 'missing_cost_rate')).toEqual([expect.objectContaining({ title: 'Nisha Kumar has no cost rate', link: '/firm/settings/rates' })]);
    const [ret] = ofType(body, 'returned_lines');
    expect(ret).toMatchObject({ title: 'Arjun Das: 3 returned lines', link: '/firm/projects/PRJ-01/time' });
    expect(ret.detail).toBe('PRJ-01 · 10.00 h · Returned by Vikram Nair: wrong phase');

    // Danger first, then the oldest.
    const sev = body.attention.map((a: any) => a.severity);
    expect(sev.indexOf('warn')).toBeGreaterThan(sev.lastIndexOf('danger'));
    expect(body.attention[0].type).toBe('overdue_invoice');
  });

  it('lists the projects with status, fee and progress', async () => {
    const { projects } = (await overview('P01')).body;
    expect(projects.map((p: any) => p.code)).toEqual(['PRJ-01', 'PRJ-02', 'PRJ-03']);
    expect(projects[0]).toMatchObject({ name: 'Lakeview Residence', client: 'Lakeview Trust', status: 'Active', fee: m('2400000.00'), pm: { ref_code: 'P02' }, over_budget: true });
    expect(projects[0].delivery_progress_pct).toBeGreaterThan(0);
    expect(projects[2]).toMatchObject({ status: 'On hold', fee: m('600000.00') });
  });

  it('lists an approval waiting longer than stale_days for its approver', async () => {
    await f.owner.query(`update approval_request set created_at = $1::date - 5 where approver_id = $2`, [DAY, f.id('P02')]);
    const r = await overview('P02');
    expect(r.body.figures.approvals_waiting).toMatchObject({ count: 1, oldest_days: 5 });
    expect(ofType(r.body, 'stale_approval')).toEqual([expect.objectContaining({ title: 'Divya Menon: time waiting 5 days', age_days: 5, link: '/firm/approvals' })]);
    expect(ofType((await overview('P02', `as_of=${DAY}&stale_days=10`)).body, 'stale_approval')).toEqual([]);
  });
});

describe('PM scope', () => {
  it('Vikram sees only PRJ-01 and PRJ-03, their money, and the people on them', async () => {
    const r = await overview('P02');
    expect(r.status).toBe(200);
    expect(r.body.scope).toBe('projects');
    expect(r.body.projects.map((p: any) => p.code)).toEqual(['PRJ-01', 'PRJ-03']);
    expect(r.body.figures.ready_to_bill.value).toEqual(m('80000.00'));
    expect(r.body.figures.overdue).toEqual({ value: m('160000.00'), count: 1 });
    const types = new Set(r.body.attention.map((a: any) => a.type));
    expect(types.has('nte_excess')).toBe(false);
    expect(types.has('missing_cost_rate')).toBe(false);
    expect(ofType(r.body, 'phase_overrun').map((o: any) => o.title)).toEqual(['PRJ-01 Working drawings']);
    expect(ofType(r.body, 'over_day_hours')).toHaveLength(1);
    expect(r.body.figures.utilization).toMatchObject({ people: 6, available_hours: '240.00' });
    expect(JSON.stringify(r.body)).not.toContain('PRJ-02');
  });

  it('Meera sees PRJ-02 with its NTE excess and no overdue invoice', async () => {
    const r = await overview('P03');
    expect(r.body.projects.map((p: any) => p.code)).toEqual(['PRJ-02']);
    expect(r.body.figures.ready_to_bill.value).toEqual(m('406000.00'));
    expect(r.body.figures.overdue).toEqual({ value: m('0.00'), count: 0 });
    expect(ofType(r.body, 'nte_excess')).toHaveLength(1);
    expect(ofType(r.body, 'overdue_invoice')).toHaveLength(0);
  });

  it('a viewer without the money capabilities gets {restricted:true}, never zero', async () => {
    const set = (await f.owner.query(`select id from permission_set where key = 'operations'`)).rows[0].id;
    await f.owner.query(`insert into permission_grant (firm_id, person_id, permission_set_id, granted_by, reason, sensitive) values ($1,$2,$3,$4,'Test',false)`, [f.firmId, f.id('P07'), set, f.id('P01')]);
    const r = await overview('P07');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.scope).toBe('firm');
    expect(r.body.figures.ready_to_bill).toEqual({ restricted: true });
    expect(r.body.figures.overdue).toEqual({ restricted: true });
    expect(r.body.projects[0].fee).toEqual({ restricted: true });
    expect(ofType(r.body, 'overdue_invoice')).toHaveLength(0);
    expect(ofType(r.body, 'nte_excess')).toHaveLength(0);
    expect(ofType(r.body, 'missing_cost_rate')[0].link).toBeNull();
  });
});

describe('forbidden and validation', () => {
  it('refuses staff, naming budgets.hours.view', async () => {
    const r = await overview('P04');
    expect(r.status).toBe(403);
    expect(r.body.error).toMatchObject({ code: 'FORBIDDEN_CAPABILITY', capability: 'budgets.hours.view' });
  });

  it('refuses a bad as_of or stale_days, naming the field', async () => {
    for (const [qs, field] of [['as_of=06-11-2026', 'as_of'], ['as_of=2026-13-40', 'as_of'], ['stale_days=0', 'stale_days'], ['stale_days=abc', 'stale_days'], ['stale_days=400', 'stale_days']]) {
      const r = await overview('P01', qs);
      expect(r.status, qs).toBe(400);
      expect(r.body.error.details[0].field, qs).toBe(field);
    }
  });
});

describe('today in the studio timezone', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('at 20:00 UTC on 5 November it is already 6 November in Asia/Kolkata', async () => {
    await f.login('P01');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T20:00:00Z'));
    const r = await overview('P01', '');
    expect(r.status).toBe(200);
    expect(r.body.as_of).toBe(DAY);
    expect(ofType(r.body, 'over_day_hours')[0].age_days).toBe(1);
  });
});

describe('firm isolation', () => {
  it("another studio's projects, time and people never appear, and its principal sees only their own", async () => {
    const q = async (sql: string, params: unknown[]) => (await f.owner.query(sql, params)).rows[0];
    const other = (await q(`insert into firm (legal_name, trading_name, timezone) values ('Other','Other','UTC') returning id`, [])).id;
    const hash = (await q('select password_hash from person where id = $1', [f.id('P01')])).password_hash;
    const o1 = (await q(`insert into person (firm_id, ref_code, name, work_email, job_title, password_hash) values ($1,'P01','Olga Outsider','olga@other.test','Principal',$2) returning id`, [other, hash])).id;
    const set = (await q(`insert into permission_set (firm_id, key, name) values ($1,'principal','principal') returning id`, [other])).id;
    await q(`insert into permission_grant (firm_id, person_id, permission_set_id, granted_by, reason, sensitive) values ($1,$2,$3,$2,'Test',false) returning id`, [other, o1, set]);
    const client = (await q(`insert into client (firm_id, name) values ($1,'Other client') returning id`, [other])).id;
    const prj = (await q(`insert into project (firm_id, code, name, client_id, pm_id, status) values ($1,'OTH-01','Other Tower',$2,$3,'Active') returning id`, [other, client, o1])).id;
    await q(`insert into project_membership (firm_id, project_id, person_id, project_role) values ($1,$2,$3,'pm') returning id`, [other, prj, o1]);
    const ph = (await q(`insert into phase (firm_id, project_id, code, name, start_date, end_date) values ($1,$2,'CD','Other concept','2026-11-01','2026-11-30') returning id`, [other, prj])).id;
    const ts = (await q(`insert into timesheet (firm_id, person_id, period_start, period_end, status) values ($1,$2,'2026-11-02','2026-11-08','Returned') returning id`, [other, o1])).id;
    await q(`insert into time_entry (firm_id, person_id, service_date, project_id, phase_id, duration_hours, timesheet_id, approval_state, return_reason) values ($1,$2,'2026-11-04',$3,$4,13,$5,'Returned','Other reason') returning id`, [other, o1, prj, ph, ts]);

    for (const ref of ['P01', 'P02', 'P03']) {
      const s = JSON.stringify((await overview(ref)).body);
      expect(s, ref).not.toContain('OTH-01');
      expect(s, ref).not.toContain('Olga Outsider');
      expect(s, ref).not.toContain('Other reason');
    }
    expect((await overview('P01')).body.figures.utilization.people).toBe(10);

    const login = await f.rawLogin('olga@other.test', 'meridian-demo-2026');
    expect(login.statusCode).toBe(200);
    const cookie = login.cookies.find((c) => c.name === 'ams_session')!.value;
    const res = await f.app.inject({ method: 'GET', url: `/api/v1/overview?as_of=${DAY}`, cookies: { ams_session: cookie } });
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.timezone).toBe('UTC');
    expect(body.projects.map((p: any) => p.code)).toEqual(['OTH-01']);
    expect(body.figures.ready_to_bill.value).toEqual(m('0.00'));
    expect(body.figures.overdue).toEqual({ value: m('0.00'), count: 0 });
    expect(body.figures.utilization.people).toBe(1);
    expect(ofType(body, 'over_day_hours').map((a: any) => a.title)).toEqual(['Olga Outsider over 12 h on Wednesday']);
    const s = JSON.stringify(body);
    for (const x of ['PRJ-01', 'INV-DEMO-0007', 'Rohan Shetty', 'Nisha Kumar']) expect(s).not.toContain(x);
  });
});
