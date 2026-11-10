import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { freshApp, type Fresh } from './helpers';

/**
 * The team member's Home (GET /me/home) and Work (GET /me/work): the seeded week for Rohan (P04), Arjun's (P08)
 * returned line, membership-limited projects, pending requests and the approver's queue, the studio-timezone "today",
 * validation, the capability check and firm isolation.
 */
const DAY = '2026-11-06';
let f: Fresh;
beforeAll(async () => { f = await freshApp(); });
afterAll(async () => { await f?.close(); });

const home = (ref: string, date = DAY) => f.call(ref, 'GET', `/me/home?date=${date}`);
const work = (ref: string, date = DAY) => f.call(ref, 'GET', `/me/work?date=${date}`);

describe('GET /me/home', () => {
  it("shows Rohan's 38.50 h week against the 40 h schedule, with day totals", async () => {
    const r = await home('P04');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.today).toBe(DAY);
    expect(r.body.timezone).toBe('Asia/Kolkata');
    expect(r.body.week.period_start).toBe('2026-11-02');
    expect(r.body.week.period_end).toBe('2026-11-08');
    expect(r.body.week.hours).toBe('38.50');
    expect(r.body.week.scheduled_hours).toBe('40.00');
    expect(r.body.week.days.map((d: any) => d.hours)).toEqual(['7.00', '8.00', '8.00', '12.50', '3.00', '0.00', '0.00']);
    expect(r.body.week.days.map((d: any) => d.scheduled_hours)).toEqual(['8.00', '8.00', '8.00', '8.00', '8.00', '0.00', '0.00']);
    expect(r.body.week.days[3].over_12h).toBe(true);
    expect(r.body.timer).toBeNull();
  });

  it('says last week was not submitted, and this week is open', async () => {
    const r = await home('P04');
    expect(r.body.timesheets.this_week).toMatchObject({ period_start: '2026-11-02', status: 'Open', hours: '38.50' });
    expect(r.body.timesheets.last_week).toMatchObject({ period_start: '2026-10-26', status: 'Open', hours: '0.00' });
    expect(r.body.timesheets.notices).toEqual(['Last week not submitted']);
  });

  it('lists only the projects Rohan is a member of, with his role and the phases he logged time on', async () => {
    const r = await home('P04');
    expect(r.body.projects.map((p: any) => p.code)).toEqual(['PRJ-01', 'PRJ-02']);
    const p1 = r.body.projects[0];
    expect(p1.role).toBe('contributor');
    expect(p1.recent_phases.map((p: any) => [p.code, p.hours])).toEqual([['CD', '19.50'], ['WD', '11.00']]);
    expect(r.body.projects[1].recent_phases.map((p: any) => [p.code, p.hours])).toEqual([['SD', '4.00']]);
    // Staff approve nothing, so there is no approvals queue, not an empty one.
    expect(r.body.approvals).toBeNull();
    expect(r.body.pending).toEqual({ total: 0, by_type: {}, items: [] });
    expect(r.body.returned).toEqual([]);
  });

  it("shows Arjun's returned line for P08 with the approver's reason", async () => {
    const r = await home('P08');
    expect(r.status).toBe(200);
    expect(r.body.returned).toHaveLength(1);
    expect(r.body.returned[0]).toMatchObject({
      period_start: '2026-11-02', title: 'Concept design', phase_code: 'CD', project: { code: 'PRJ-01', name: 'Lakeview Residence' },
      hours: '10.00', entries: 3, reason: 'Returned by Vikram Nair: wrong phase',
    });
    expect(r.body.timesheets.this_week.status).toBe('Returned');
    expect(r.body.timesheets.notices).toContain('This week returned');
    expect(r.body.week.hours).toBe('40.00');
    expect(r.body.projects.map((p: any) => p.code)).toEqual(['PRJ-01']);
  });

  it("shows a submitter's pending request, and the approver's queue", async () => {
    const divya = await home('P05');
    expect(divya.body.pending.total).toBe(1);
    expect(divya.body.pending.items[0]).toMatchObject({ type: 'time', label: 'Timesheet', period_start: '2026-10-26', project: { code: 'PRJ-01' } });
    expect(divya.body.timesheets.last_week.status).toBe('Submitted');
    expect(divya.body.timesheets.notices).toEqual([]);
    const vikram = await home('P02');
    expect(vikram.body.approvals).toEqual({ total: 1, by_type: { time: 1 } });
  });

  it('returns the running timer', async () => {
    const ph = (await f.owner.query(`select ph.id, ph.project_id from phase ph join project p on p.id = ph.project_id where p.code = 'PRJ-01' and ph.code = 'WD'`)).rows[0];
    await f.owner.query('insert into timer (firm_id, person_id, project_id, phase_id, created_by) values ($1,$2,$3,$4,$2)', [f.firmId, f.id('P05'), ph.project_id, ph.id]);
    const r = await home('P05');
    expect(r.body.timer).toMatchObject({ phase_id: ph.id, title: 'Working drawings', project: { code: 'PRJ-01' } });
    expect(typeof r.body.timer.started_at).toBe('string');
  });

  it("defaults today to the studio's timezone", async () => {
    await f.login('P04');
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      // Sunday 15 Nov 23:30 UTC is Monday 16 Nov 05:00 in India.
      vi.setSystemTime(new Date('2026-11-15T23:30:00Z'));
      const r = await f.call('P04', 'GET', '/me/home');
      expect(r.status).toBe(200);
      expect(r.body.today).toBe('2026-11-16');
      expect(r.body.week.period_start).toBe('2026-11-16');
      expect(r.body.timesheets.last_week.period_start).toBe('2026-11-09');
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a malformed date', async () => {
    for (const d of ['yesterday', '2026-13-45', '06-11-2026']) {
      const r = await home('P04', d);
      expect(r.status, d).toBe(400);
      expect(r.body.error.code).toBe('VALIDATION');
      expect(r.body.error.details[0].field).toBe('date');
    }
  });
});

describe('GET /me/work', () => {
  it("returns Rohan's member projects with phases, status, dates and his hours this month", async () => {
    const r = await work('P04');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.month).toBe('2026-11');
    expect(r.body.month_start).toBe('2026-11-01');
    expect(r.body.month_end).toBe('2026-11-30');
    expect(r.body.projects.map((p: any) => p.code)).toEqual(['PRJ-01', 'PRJ-02']);
    const p1 = r.body.projects[0];
    expect(p1).toMatchObject({ name: 'Lakeview Residence', client: 'Lakeview Trust', role: 'contributor', status: 'Active', my_hours_month: '30.50' });
    expect(p1.phases.map((p: any) => p.code)).toEqual(['CD', 'SD', 'DD', 'WD', 'TN', 'SS']);
    const cd = p1.phases[0];
    expect(cd).toMatchObject({ name: 'Concept design', status: 'In progress', start_date: '2026-02-02', end_date: '2026-11-27', current: true, my_hours_month: '19.50' });
    expect(p1.phases[1]).toMatchObject({ status: 'Complete', current: false, my_hours_month: '0.00' });
    expect(r.body.projects[1].phases.find((p: any) => p.code === 'SD').my_hours_month).toBe('4.00');
    expect(r.body.my_hours_month).toBe('34.50');
    expect(JSON.stringify(r.body)).not.toContain('PRJ-03');
  });

  it('a different month has none of this week', async () => {
    const r = await work('P04', '2026-10-15');
    expect(r.body.month).toBe('2026-10');
    expect(r.body.my_hours_month).toBe('0.00');
  });

  it('refuses a malformed date', async () => {
    const r = await work('P04', 'soon');
    expect(r.status).toBe(400);
    expect(r.body.error.details[0].field).toBe('date');
  });
});

describe('capability', () => {
  it('someone without time.enter gets 403 on both', async () => {
    await f.owner.query('delete from permission_grant where person_id = $1', [f.id('P09')]);
    for (const url of ['/me/home', '/me/work']) {
      const r = await f.call('P09', 'GET', `${url}?date=${DAY}`);
      expect(r.status, url).toBe(403);
      expect(r.body.error).toMatchObject({ code: 'FORBIDDEN_CAPABILITY', capability: 'time.enter' });
    }
  });
});

describe('firm isolation', () => {
  it("another studio's projects, time, requests and timers never appear, and its person sees only their own", async () => {
    const q = async (sql: string, params: unknown[]) => (await f.owner.query(sql, params)).rows[0];
    const other = (await q(`insert into firm (legal_name, trading_name, timezone) values ('Other','Other','UTC') returning id`, [])).id;
    const hash = (await q('select password_hash from person where id = $1', [f.id('P04')])).password_hash;
    const o1 = (await q(`insert into person (firm_id, ref_code, name, work_email, job_title, password_hash) values ($1,'O1','Other Person','o1@other.test','Architect',$2) returning id`, [other, hash])).id;
    const set = (await q(`insert into permission_set (firm_id, key, name) values ($1,'staff','staff') returning id`, [other])).id;
    await q(`insert into permission_grant (firm_id, person_id, permission_set_id, granted_by, reason, sensitive) values ($1,$2,$3,$2,'Test',false) returning id`, [other, o1, set]);
    const client = (await q(`insert into client (firm_id, name) values ($1,'Other client') returning id`, [other])).id;
    const prj = (await q(`insert into project (firm_id, code, name, client_id, pm_id, status) values ($1,'OTH-01','Other Tower',$2,$3,'Active') returning id`, [other, client, o1])).id;
    await q(`insert into project_membership (firm_id, project_id, person_id, project_role) values ($1,$2,$3,'contributor') returning id`, [other, prj, o1]);
    const ph = (await q(`insert into phase (firm_id, project_id, code, name, start_date, end_date) values ($1,$2,'CD','Other concept','2026-11-01','2026-11-30') returning id`, [other, prj])).id;
    const ts = (await q(`insert into timesheet (firm_id, person_id, period_start, period_end, status) values ($1,$2,'2026-11-02','2026-11-08','Returned') returning id`, [other, o1])).id;
    await q(`insert into time_entry (firm_id, person_id, service_date, project_id, phase_id, duration_hours, timesheet_id, approval_state, return_reason) values ($1,$2,'2026-11-03',$3,$4,5,$5,'Returned','Other reason') returning id`, [other, o1, prj, ph, ts]);
    await q(`insert into approval_request (firm_id, type, record_type, record_id, project_id, submitter_id, approver_id) values ($1,'time','timesheet',$2,$3,$4,$4) returning id`, [other, ts, prj, o1]);
    await q(`insert into timer (firm_id, person_id, project_id, phase_id, created_by) values ($1,$2,$3,$4,$2) returning id`, [other, o1, prj, ph]);

    for (const ref of ['P04', 'P08', 'P02', 'P01']) {
      const h = await home(ref);
      const w = await work(ref);
      for (const body of [h.body, w.body]) {
        const s = JSON.stringify(body);
        expect(s, ref).not.toContain('OTH-01');
        expect(s, ref).not.toContain('Other reason');
        expect(s, ref).not.toContain(prj);
      }
    }
    // The principal's queue counts only this studio's requests.
    expect((await home('P01')).body.approvals.total).toBe(0);

    const login = await f.rawLogin('o1@other.test', 'meridian-demo-2026');
    expect(login.statusCode).toBe(200);
    const cookie = login.cookies.find((c) => c.name === 'ams_session')!.value;
    const get = async (url: string) => JSON.parse((await f.app.inject({ method: 'GET', url: `/api/v1${url}`, cookies: { ams_session: cookie } })).body);
    const oh = await get(`/me/home?date=${DAY}`);
    expect(oh.timezone).toBe('UTC');
    expect(oh.projects.map((p: any) => p.code)).toEqual(['OTH-01']);
    expect(oh.returned.map((r: any) => r.reason)).toEqual(['Other reason']);
    expect(oh.pending.total).toBe(1);
    expect(oh.timer.project.code).toBe('OTH-01');
    expect(JSON.stringify(oh)).not.toContain('PRJ-01');
    const ow = await get(`/me/work?date=${DAY}`);
    expect(ow.projects.map((p: any) => p.code)).toEqual(['OTH-01']);
    expect(ow.my_hours_month).toBe('5.00');
  });
});
