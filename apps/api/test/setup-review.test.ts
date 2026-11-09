import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTwoDecimals, moneyAmount } from '../src/http/validation';
import { freshApp, type Fresh } from './helpers';

/**
 * Review of the project-setup endpoints: two-decimal percents and amounts are accepted exactly, out-of-range money is a
 * 400 (never a database 500), and another firm's projects, phases, milestones and people are invisible.
 */
let f: Fresh;
let clientId: string;
const other: Record<string, string> = {};
beforeAll(async () => {
  f = await freshApp();
  clientId = (await f.call('P01', 'GET', '/clients')).body.data[0].id;
  expect((await f.call('P01', 'POST', '/projects', fixed('REV-01'))).status).toBe(200);
  expect((await f.call('P01', 'POST', '/projects', {
    code: 'REV-02', name: 'Review percent', client_id: clientId, pm_id: f.id('P02'), billing_method: 'percent_construction', fee_percent: 6,
    phases: [{ code: 'CD', name: 'Concept design' }],
  })).status).toBe(200);

  // A second firm with a project, a phase, a fixed fee, a planned milestone and a person, written as the owner.
  const q = async (sql: string, args: unknown[]) => (await f.owner.query(sql, args)).rows[0].id as string;
  other.firm = await q(`insert into firm (legal_name, trading_name, timezone) values ('Other Studio','Other Studio','Asia/Kolkata') returning id`, []);
  other.person = await q(`insert into person (firm_id, ref_code, name, work_email, job_title) values ($1,'X01','Outsider','outsider@other.test','Architect') returning id`, [other.firm]);
  other.client = await q(`insert into client (firm_id, name) values ($1,'Other client') returning id`, [other.firm]);
  other.project = await q(`insert into project (firm_id, code, name, client_id, pm_id) values ($1,'OTH-01','Other project',$2,$3) returning id`, [other.firm, other.client, other.person]);
  await f.owner.query(`insert into project_membership (firm_id, project_id, person_id, project_role) values ($1,$2,$3,'pm')`, [other.firm, other.project, other.person]);
  other.cv = await q(`insert into contract_version (firm_id, project_id, version_no, effective_from) values ($1,$2,1,'2026-01-01') returning id`, [other.firm, other.project]);
  other.fee = await q(`insert into fee_component (firm_id, contract_version_id, project_id, key, name, billing_method, contracted_amount) values ($1,$2,$3,'main','Fee','fixed_milestone',100000) returning id`, [other.firm, other.cv, other.project]);
  other.phase = await q(`insert into phase (firm_id, project_id, code, name, sort_order) values ($1,$2,'CD','Concept design',0) returning id`, [other.firm, other.project]);
  await f.owner.query(`insert into phase_fee_allocation (firm_id, phase_id, fee_component_id, amount) values ($1,$2,$3,100000)`, [other.firm, other.phase, other.fee]);
  other.milestone = await q(`insert into billing_milestone (firm_id, fee_component_id, phase_id, label, amount) values ($1,$2,$3,'Other stage',50000) returning id`, [other.firm, other.fee, other.phase]);
});
afterAll(async () => { await f?.close(); });

function fixed(code: string, extra: Record<string, unknown> = {}) {
  return {
    code, name: `Review ${code}`, client_id: clientId, pm_id: f.id('P02'), billing_method: 'fixed_percent', contracted_amount: 1000000,
    phases: [{ code: 'CD', name: 'Concept design', fee: 400000 }, { code: 'SD', name: 'Schematic design', fee: 600000 }], ...extra,
  };
}
const phaseOf = async (code: string, phase: string) => (await f.call('P01', 'GET', `/projects/${code}`)).body.phases.find((p: any) => p.code === phase).id as string;
const count = async (sql: string, args: unknown[]) => (await f.owner.query(sql, args)).rows[0].n as number;

describe('two decimals are exact', () => {
  it('hasTwoDecimals accepts every two-decimal value floating point cannot multiply exactly, and refuses a third decimal', () => {
    for (const v of [0.07, 0.29, 1.1, 1.15, 33.33, 57.7, 99.99]) expect(hasTwoDecimals(v), String(v)).toBe(true);
    for (const v of [0.001, 12.345, 33.333]) expect(hasTwoDecimals(v), String(v)).toBe(false);
  });

  it('a fee level such as 1.1% or 33.33% is authorized, stored exactly and released', async () => {
    const cd = await phaseOf('REV-01', 'CD');
    for (const pct of [1.1, 33.33]) {
      const r = await f.call('P01', 'POST', '/projects/REV-01/fee-authorizations', { phase_id: cd, cumulative_percent: pct });
      expect(r.status, `${pct}: ${JSON.stringify(r.body)}`).toBe(200);
      expect(r.body.cumulative_percent).toBe(pct);
    }
    const plan = await f.call('P01', 'GET', '/projects/REV-01/fee-authorizations');
    expect(plan.body.phases.find((p: any) => p.code === 'CD').authorizations.map((a: any) => a.cumulative_percent)).toEqual([1.1, 33.33]);
    // 33.33% of ₹4,00,000 is ₹1,33,320.
    const ready = await f.call('P01', 'GET', '/billing/ready?project=REV-01');
    expect(ready.status).toBe(200);
    expect(ready.body.total.amount).toBe('133320.00');
  });
});

describe('money stays within the money columns', () => {
  it('a milestone amount too large, with fractions of a paisa, or not a number is a 400 and writes nothing', async () => {
    for (const amount of [1e13, 10.005, 'lots', 0]) {
      const r = await f.call('P01', 'POST', '/projects/REV-02/milestones', { label: 'Stage', amount });
      expect(r.status, `${amount}: ${JSON.stringify(r.body)}`).toBe(400);
      expect(r.body.error.details[0].field).toBe('amount');
    }
    expect(await count(`select count(*)::int n from billing_milestone m join fee_component c on c.id = m.fee_component_id join project p on p.id = c.project_id where p.code = 'REV-02'`, [])).toBe(0);
    const ok = await f.call('P01', 'POST', '/projects/REV-02/milestones', { label: 'Stage 1', amount: '125000.50' });
    expect(ok.status).toBe(200);
    expect((await f.owner.query('select amount from billing_milestone where id = $1', [ok.body.id])).rows[0].amount).toBe('125000.50');
  });

  it('POST /projects refuses an oversized or fractional-paisa fee, a non-numeric cap or fee percent, with the field named', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ contracted_amount: 1e13, phases: [{ code: 'CD', name: 'Concept design' }] }, 'contracted_amount'],
      [{ contracted_amount: 100.001, phases: [{ code: 'CD', name: 'Concept design' }] }, 'contracted_amount'],
      [{ contracted_amount: 1e13, phases: [{ code: 'CD', name: 'Concept design', fee: 1e13 }] }, 'contracted_amount'],
      [{ contracted_amount: null, phases: [{ code: 'CD', name: 'Concept design', fee: 1e13 }] }, 'phases[0].fee'],
      [{ billing_method: 'hourly_nte', cap_amount: 'lots', contracted_amount: null, phases: [{ code: 'CD', name: 'Concept design' }] }, 'cap_amount'],
      [{ billing_method: 'hourly_nte', cap_amount: 1e13, contracted_amount: null, phases: [{ code: 'CD', name: 'Concept design' }] }, 'cap_amount'],
      [{ billing_method: 'percent_construction', fee_percent: 'six', contracted_amount: null, phases: [{ code: 'CD', name: 'Concept design' }] }, 'fee_percent'],
      [{ billing_method: 'percent_construction', fee_percent: 1500, contracted_amount: null, phases: [{ code: 'CD', name: 'Concept design' }] }, 'fee_percent'],
    ];
    for (const [extra, field] of cases) {
      const r = await f.call('P01', 'POST', '/projects', fixed('REV-09', extra));
      expect(r.status, `${JSON.stringify(extra)}: ${JSON.stringify(r.body)}`).toBe(400);
      expect(r.body.error.details[0].field).toBe(field);
    }
    expect(await count(`select count(*)::int n from project where code = 'REV-09'`, [])).toBe(0);
    // Valid values still work: 6.25% of construction cost, a cap with paise.
    expect((await f.call('P01', 'POST', '/projects', fixed('REV-10', { billing_method: 'percent_construction', fee_percent: 6.25, contracted_amount: null, phases: [{ code: 'CD', name: 'Concept design' }] }))).status).toBe(200);
    expect((await f.call('P01', 'POST', '/projects', fixed('REV-11', { billing_method: 'hourly_nte', cap_amount: 150000.5, contracted_amount: null, phases: [{ code: 'CD', name: 'Concept design' }] }))).status).toBe(200);
  });

  it('moneyAmount names the field and the rule', () => {
    expect(moneyAmount('12.50', 'amount', 'The amount')).toBe(12.5);
    expect(() => moneyAmount(-1, 'amount', 'The amount')).toThrow('zero or more');
    expect(() => moneyAmount(0, 'amount', 'The amount', { positive: true })).toThrow('above zero');
  });
});

describe("another firm's records are invisible", () => {
  it("its milestone cannot be authorized: 404, and the row stays Planned", async () => {
    const r = await f.call('P01', 'POST', `/milestones/${other.milestone}/authorize`);
    expect(r.status).toBe(404);
    expect((await f.owner.query('select status from billing_milestone where id = $1', [other.milestone])).rows[0].status).toBe('Planned');
  });

  it('its project is not found for fee authorizations and milestones, and its phase is not a phase of ours', async () => {
    expect((await f.call('P01', 'GET', '/projects/OTH-01/fee-authorizations')).status).toBe(404);
    expect((await f.call('P01', 'POST', '/projects/OTH-01/fee-authorizations', { phase_id: other.phase, cumulative_percent: 50 })).status).toBe(404);
    expect((await f.call('P01', 'POST', '/projects/OTH-01/milestones', { label: 'Sneaky', amount: 1000 })).status).toBe(404);
    const ours = await f.call('P01', 'POST', '/projects/REV-01/fee-authorizations', { phase_id: other.phase, cumulative_percent: 50 });
    expect(ours.status).toBe(400);
    expect(ours.body.error.details[0].field).toBe('phase_id');
    const mine = await f.call('P01', 'POST', '/projects/REV-02/milestones', { label: 'Sneaky', amount: 1000, phase_id: other.phase });
    expect(mine.status).toBe(400);
    const comp = await f.call('P01', 'POST', '/projects/REV-02/milestones', { label: 'Sneaky', amount: 1000, fee_component_id: other.fee });
    expect(comp.status).toBe(422);
    expect(await count(`select count(*)::int n from fee_authorization where firm_id = $1`, [other.firm])).toBe(0);
    expect(await count(`select count(*)::int n from billing_milestone where fee_component_id = $1`, [other.fee])).toBe(1);
  });

  it('its team cannot be read or changed, and its people cannot join ours', async () => {
    expect((await f.call('P01', 'GET', '/projects/OTH-01/members')).status).toBe(404);
    expect((await f.call('P01', 'POST', '/projects/OTH-01/members', { person_id: f.id('P04') })).status).toBe(404);
    expect((await f.call('P01', 'DELETE', `/projects/OTH-01/members/${other.person}`)).status).toBe(404);
    const join = await f.call('P01', 'POST', '/projects/REV-01/members', { person_id: other.person });
    expect(join.status).toBe(400);
    expect(join.body.error.details[0]).toMatchObject({ field: 'person_id', code: 'unknown' });
    expect(await count('select count(*)::int n from project_membership where person_id = $1', [other.person])).toBe(1);
    expect(await count('select count(*)::int n from project_membership where project_id = $1', [other.project])).toBe(1);
  });
});
