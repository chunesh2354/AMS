import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ownerUrl } from '../src/dev/db';
import { PLATFORM_DEMO_EMAIL, PLATFORM_DEMO_PASSWORD, seedPlatformAdmin } from '../src/dev/platform-admin';
import { freshApp, type Fresh } from './helpers';

const TEST_PORT = 54331;
let f: Fresh;
beforeAll(async () => { f = await freshApp(); });
afterAll(async () => { await f?.close(); });

describe('POST /clients', () => {
  it('a principal creates a client, it is listed, audited and usable for a new project', async () => {
    const r = await f.call('P01', 'POST', '/clients', { name: '  Riverside Housing Trust ' });
    expect(r.status).toBe(200);
    expect(r.body.name).toBe('Riverside Housing Trust');
    expect(r.body.audit_event_id).toBeTruthy();
    const listed = await f.call('P01', 'GET', '/clients');
    expect(listed.body.data.map((c: any) => c.name)).toContain('Riverside Housing Trust');
    const row = (await f.owner.query('select firm_id, created_by from client where id = $1', [r.body.id])).rows[0];
    expect(row).toEqual({ firm_id: f.firmId, created_by: f.id('P01') });

    const p = await f.call('P01', 'POST', '/projects', {
      code: 'PRJ-90', name: 'Riverside Homes', client_id: r.body.id, pm_id: f.id('P02'), billing_method: 'fixed_percent', contracted_amount: 500000,
      phases: [{ code: 'CD', name: 'Concept design' }],
    });
    expect(p.status).toBe(200);
    const view = await f.call('P01', 'GET', '/projects/PRJ-90');
    expect(view.body.client).toBe('Riverside Housing Trust');
  });

  it('refuses a duplicate name, ignoring case and spaces, with 409', async () => {
    const r = await f.call('P01', 'POST', '/clients', { name: 'lakeview trust ' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('DUPLICATE_NAME');
  });

  it('is forbidden without projects.create', async () => {
    for (const ref of ['P04', 'P10']) {
      const r = await f.call(ref, 'POST', '/clients', { name: `Forbidden ${ref}` });
      expect(r.status).toBe(403);
      expect(r.body.error.capability).toBe('projects.create');
    }
    expect((await f.owner.query(`select count(*)::int as n from client where name like 'Forbidden%'`)).rows[0].n).toBe(0);
  });

  it('validates the name', async () => {
    for (const body of [{}, { name: '' }, { name: '   ' }, { name: 42 }, { name: 'x'.repeat(201) }]) {
      const r = await f.call('P01', 'POST', '/clients', body);
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('VALIDATION');
      expect(r.body.error.details[0].field).toBe('name');
    }
  });

  it('renames a client with PUT /clients/:id, refusing a clash and an unknown id', async () => {
    const c = await f.call('P01', 'POST', '/clients', { name: 'Old Name Ltd' });
    const r = await f.call('P01', 'PUT', `/clients/${c.body.id}`, { name: 'New Name Ltd' });
    expect(r.status).toBe(200);
    expect(r.body.name).toBe('New Name Ltd');
    expect((await f.call('P01', 'PUT', `/clients/${c.body.id}`, { name: 'Orchard Developers' })).status).toBe(409);
    expect((await f.call('P01', 'PUT', '/clients/00000000-0000-0000-0000-000000000000', { name: 'Ghost' })).status).toBe(404);
    expect((await f.call('P04', 'PUT', `/clients/${c.body.id}`, { name: 'Nope' })).status).toBe(403);
  });
});

describe('GET /rates', () => {
  it('lists everyone with current bill and cost rates for a cost-rate holder', async () => {
    const r = await f.call('P01', 'GET', '/rates');
    expect(r.status).toBe(200);
    const byRef = new Map(r.body.data.map((x: any) => [x.person.ref_code, x]));
    expect(byRef.size).toBe(10);
    const p02: any = byRef.get('P02');
    expect(p02.bill_rate.amount).toEqual({ amount: '3000.00', currency: 'INR' });
    expect(p02.cost_rate.amount).toEqual({ amount: '1200.00', currency: 'INR' });
    // Nisha has no cost rate: an honest null, never zero.
    expect((byRef.get('P09') as any).cost_rate).toBeNull();
  });

  it('a new rate version becomes current and the old one stays in history', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const c = await f.call('P01', 'POST', '/rates', { person_id: f.id('P05'), rate_type: 'bill', amount: 1800, effective_from: today, change_reason: 'Annual review' });
    expect(c.status).toBe(200);
    const r = await f.call('P01', 'GET', `/rates?as_of=${today}`);
    const p05 = r.body.data.find((x: any) => x.person.ref_code === 'P05');
    expect(p05.bill_rate).toMatchObject({ id: c.body.id, amount: { amount: '1800.00', currency: 'INR' }, effective_from: today });
    const history = await f.call('P01', 'GET', `/people/${f.id('P05')}/rates`);
    expect(history.body.data.filter((x: any) => x.rate_type === 'bill').length).toBe(2);
  });

  it('redacts cost rates for a bill-rate manager without rates.cost.view', async () => {
    await f.owner.query(
      `insert into permission_grant (firm_id, person_id, capability, scope_type, reason) values ($1,$2,'rates.bill.manage','firm','Rate card upkeep')`,
      [f.firmId, f.id('P02')],
    );
    const r = await f.call('P02', 'GET', '/rates');
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBe(10);
    for (const row of r.body.data) expect(row.cost_rate).toEqual({ restricted: true });
    expect(JSON.stringify(r.body)).not.toContain('1200.00');
    const p02 = r.body.data.find((x: any) => x.person.ref_code === 'P02');
    expect(p02.bill_rate.amount.amount).toBe('3000.00');
  });

  it('is forbidden without a rates capability', async () => {
    const r = await f.call('P04', 'GET', '/rates');
    expect(r.status).toBe(403);
    expect(r.body.error.capability).toBe('rates.bill.manage');
  });

  it('validates as_of', async () => {
    const r = await f.call('P01', 'GET', '/rates?as_of=next-week');
    expect(r.status).toBe(400);
    expect(r.body.error.details[0].field).toBe('as_of');
  });
});

describe('default work categories', () => {
  it('the demo firm keeps exactly its own categories', async () => {
    const rows = (await f.owner.query('select key from internal_work_category where firm_id = $1 order by key', [f.firmId])).rows;
    expect(rows.map((r) => r.key)).toEqual(['admin', 'training']);
  });

  it('a firm created through the platform gets them', async () => {
    await seedPlatformAdmin(ownerUrl(TEST_PORT, (f.owner as any).database));
    const login = await f.app.inject({ method: 'POST', url: '/api/v1/platform/auth/login', payload: { email: PLATFORM_DEMO_EMAIL, password: PLATFORM_DEMO_PASSWORD } });
    const admin = login.cookies.find((c) => c.name === 'ams_platform')!.value;
    const res = await f.app.inject({
      method: 'POST', url: '/api/v1/platform/firms', cookies: { ams_platform: admin },
      payload: { trading_name: 'Setup Studio', legal_name: 'Setup Studio LLP', timezone: 'Asia/Kolkata', currency: 'INR', owner_name: 'Tara Owner', owner_email: `owner.${Date.now()}@setup-studio.example` },
    });
    expect(res.statusCode).toBe(200);
    const firmId = JSON.parse(res.body).firm_id;
    const rows = (await f.owner.query('select key, name from internal_work_category where firm_id = $1 order by key', [firmId])).rows;
    expect(rows).toEqual([{ key: 'admin', name: 'Studio admin' }, { key: 'training', name: 'Training' }]);
  });
});
