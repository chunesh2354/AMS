import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshApp, type Fresh } from './helpers';

/** People directory and person profile: GET /people/directory and GET /people/:id/profile. */
let f: Fresh;
beforeAll(async () => { f = await freshApp(); });
afterAll(async () => { await f?.close(); });

// The template is seeded with today = 2026-11-06, so the seed's "this week" is the week of Monday 2 November.
const SEED_WEEK = '2026-11-02';
const R = { restricted: true };

/** A person in another firm, which RLS must hide. */
async function outsider() {
  const other = (await f.owner.query(`insert into firm (legal_name, trading_name, timezone) values ('Other','Other','Asia/Kolkata') returning id`)).rows[0].id;
  return (await f.owner.query(
    `insert into person (firm_id, ref_code, name, work_email, job_title) values ($1,'P11','Outsider',$2,'Architect') returning id`, [other, `outsider-${randomUUID()}@other.test`],
  )).rows[0].id as string;
}

describe('GET /people/directory', () => {
  it('lists the seed studio: active people, account types, manager, projects and this week\'s hours', async () => {
    const r = await f.call('P01', 'GET', `/people/directory?week=${SEED_WEEK}`);
    expect(r.status).toBe(200);
    expect(r.body.week_start).toBe(SEED_WEEK);
    expect(r.body.data.map((p: any) => p.ref_code)).toEqual(['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10']);
    const by = new Map(r.body.data.map((p: any) => [p.ref_code, p]));
    const rohan: any = by.get('P04');
    expect(rohan).toMatchObject({
      name: 'Rohan Shetty', job_title: 'Senior architect', account_types: ['employee'], employment_state: 'Active',
      manager: { id: f.id('P02'), ref_code: 'P02', name: 'Vikram Nair' }, projects_count: 2,
      this_week: { week_start: SEED_WEEK, logged_hours: '38.50' },
    });
    expect((by.get('P10') as any).account_types).toEqual(['admin', 'finance']);
    expect((by.get('P01') as any).manager).toBeNull();
    expect((by.get('P09') as any).projects_count).toBe(0);
    // Arjun: 28 h on WD, 10 h returned and 2 h unclassified are all logged.
    expect((by.get('P08') as any).this_week.logged_hours).toBe('40.00');
    // No rates in the directory at all.
    expect(JSON.stringify(r.body)).not.toMatch(/rate/);
  });

  it('defaults to the studio\'s current week', async () => {
    const r = await f.call('P01', 'GET', '/people/directory');
    expect(r.status).toBe(200);
    expect(r.body.week_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(`${r.body.week_start}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it('lets PM and finance read hours, and fences other people\'s hours from staff', async () => {
    for (const ref of ['P02', 'P10']) {
      const r = await f.call(ref, 'GET', `/people/directory?week=${SEED_WEEK}`);
      expect(r.body.data.find((p: any) => p.ref_code === 'P04').this_week.logged_hours).toBe('38.50');
    }
    const staff = await f.call('P05', 'GET', `/people/directory?week=${SEED_WEEK}`);
    expect(staff.status).toBe(200);
    expect(staff.body.data).toHaveLength(10);
    expect(staff.body.data.find((p: any) => p.ref_code === 'P04').this_week.logged_hours).toEqual(R);
    expect(staff.body.data.find((p: any) => p.ref_code === 'P05').this_week.logged_hours).not.toEqual(R);
  });

  it('filters by status', async () => {
    await f.owner.query(`update person set employment_state = 'Ended', login_state = 'Revoked' where id = $1`, [f.id('P09')]);
    try {
      const active = await f.call('P01', 'GET', '/people/directory');
      expect(active.body.data.map((p: any) => p.ref_code)).not.toContain('P09');
      const ended = await f.call('P01', 'GET', '/people/directory?status=deactivated');
      expect(ended.body.data.map((p: any) => p.ref_code)).toEqual(['P09']);
      expect((await f.call('P01', 'GET', '/people/directory?status=all')).body.data).toHaveLength(10);
    } finally {
      await f.owner.query(`update person set employment_state = 'Active', login_state = 'Enabled' where id = $1`, [f.id('P09')]);
    }
  });

  it('refuses a bad status or week', async () => {
    const s = await f.call('P01', 'GET', '/people/directory?status=gone');
    expect(s.status).toBe(400);
    expect(s.body.error.details[0]).toMatchObject({ field: 'status' });
    const w = await f.call('P01', 'GET', '/people/directory?week=last-week');
    expect(w.status).toBe(400);
    expect(w.body.error.details[0]).toMatchObject({ field: 'week' });
  });

  it('needs people.view', async () => {
    const grants = (await f.owner.query('delete from permission_grant where person_id = $1 returning *', [f.id('P07')])).rows;
    try {
      const r = await f.call('P07', 'GET', '/people/directory');
      expect(r.status).toBe(403);
      expect(r.body.error).toMatchObject({ code: 'FORBIDDEN_CAPABILITY', capability: 'people.view' });
    } finally {
      for (const g of grants) {
        await f.owner.query(
          'insert into permission_grant (id, firm_id, person_id, permission_set_id, granted_by, reason, sensitive) values ($1,$2,$3,$4,$5,$6,$7)',
          [g.id, g.firm_id, g.person_id, g.permission_set_id, g.granted_by, g.reason, g.sensitive],
        );
      }
    }
  });

  it('never lists another firm\'s people', async () => {
    const id = await outsider();
    const r = await f.call('P01', 'GET', '/people/directory?status=all');
    expect(r.body.data.map((p: any) => p.id)).not.toContain(id);
    expect(r.body.data).toHaveLength(10);
  });
});

describe('GET /people/:id/profile', () => {
  it('shows details, account types, manager, projects with roles, recent time and rates to a principal', async () => {
    const r = await f.call('P01', 'GET', `/people/P05/profile?week=${SEED_WEEK}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      id: f.id('P05'), ref_code: 'P05', name: 'Divya Menon', job_title: 'Architect', account_types: ['employee'],
      manager: { ref_code: 'P02', name: 'Vikram Nair' },
      projects: [{ code: 'PRJ-01', name: 'Lakeview Residence', role: 'contributor', status: 'Active' }],
      hidden_projects: 0,
      rates: { bill_rate: { amount: '1600.00', currency: 'INR' }, cost_rate: { amount: '640.00', currency: 'INR' } },
    });
    expect(r.body.time.week_start).toBe(SEED_WEEK);
    expect(r.body.time.weeks.map((w: any) => w.week_start)).toEqual(['2026-10-12', '2026-10-19', '2026-10-26', SEED_WEEK]);
    // Last week: 5 x 8 h submitted, not yet approved.
    expect(r.body.time.weeks[2]).toEqual({ week_start: '2026-10-26', logged_hours: '40.00', approved_hours: '0.00' });
    expect(r.body).not.toHaveProperty('leave');
  });

  it('takes the database id as well as the reference', async () => {
    const r = await f.call('P01', 'GET', `/people/${f.id('P05')}/profile`);
    expect(r.status).toBe(200);
    expect(r.body.ref_code).toBe('P05');
  });

  it('fences the cost rate from a PM and both rates from staff, as restricted, never blank', async () => {
    const pm = await f.call('P02', 'GET', '/people/P05/profile');
    expect(pm.status).toBe(200);
    expect(pm.body.rates.cost_rate).toEqual(R);
    expect(pm.body.rates.bill_rate).toEqual(R);
    expect(JSON.stringify(pm.body.rates)).not.toMatch(/\d/);

    const staff = await f.call('P04', 'GET', '/people/P05/profile');
    expect(staff.status).toBe(200);
    expect(staff.body.rates).toMatchObject({ bill_rate: R, cost_rate: R });
    expect(staff.body.time).toEqual(R);
    expect(JSON.stringify(staff.body.rates)).not.toMatch(/\d/);

    // Finance holds rates.cost.view.
    const fin = await f.call('P10', 'GET', '/people/P05/profile');
    expect(fin.body.rates.cost_rate).toEqual({ amount: '640.00', currency: 'INR' });
  });

  it('shows a missing cost rate as restricted to staff, so a gap reveals nothing', async () => {
    expect((await f.call('P01', 'GET', '/people/P09/profile')).body.rates.cost_rate).toBeNull();
    expect((await f.call('P04', 'GET', '/people/P09/profile')).body.rates.cost_rate).toEqual(R);
  });

  it('names only the projects the viewer can open', async () => {
    // P05 is on PRJ-01 only; P06 is on PRJ-02 only. P06 looking at Rohan (PRJ-01 and PRJ-02) sees PRJ-02 named, PRJ-01 counted.
    const r = await f.call('P06', 'GET', '/people/P04/profile');
    expect(r.body.projects.map((p: any) => p.code)).toEqual(['PRJ-02']);
    expect(r.body.hidden_projects).toBe(1);
    expect((await f.call('P04', 'GET', '/people/P04/profile')).body.projects.map((p: any) => p.code)).toEqual(['PRJ-01', 'PRJ-02']);
  });

  it('always shows a person their own profile, even without people.view', async () => {
    const grants = (await f.owner.query('delete from permission_grant where person_id = $1 returning *', [f.id('P07')])).rows;
    try {
      const own = await f.call('P07', 'GET', '/people/P07/profile');
      expect(own.status).toBe(200);
      expect(own.body.name).toBe('Sneha Pillai');
      const other = await f.call('P07', 'GET', '/people/P05/profile');
      expect(other.status).toBe(403);
      expect(other.body.error.capability).toBe('people.view');
      // Unknown people are refused the same way, so existence is not revealed.
      expect((await f.call('P07', 'GET', '/people/P99/profile')).status).toBe(403);
    } finally {
      for (const g of grants) {
        await f.owner.query(
          'insert into permission_grant (id, firm_id, person_id, permission_set_id, granted_by, reason, sensitive) values ($1,$2,$3,$4,$5,$6,$7)',
          [g.id, g.firm_id, g.person_id, g.permission_set_id, g.granted_by, g.reason, g.sensitive],
        );
      }
    }
  });

  it('refuses a bad week and answers 404 for an unknown or malformed reference', async () => {
    expect((await f.call('P01', 'GET', '/people/P05/profile?week=2026-13-40')).status).toBe(400);
    expect((await f.call('P01', 'GET', '/people/P99/profile')).status).toBe(404);
    expect((await f.call('P01', 'GET', `/people/${encodeURIComponent('P05; drop')}/profile`)).status).toBe(404);
  });

  it('never shows another firm\'s person, by id or by reference', async () => {
    const id = await outsider();
    expect((await f.call('P01', 'GET', `/people/${id}/profile`)).status).toBe(404);
    expect((await f.call('P01', 'GET', '/people/P11/profile')).status).toBe(404);
  });
});
