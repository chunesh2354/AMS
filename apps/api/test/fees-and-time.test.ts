import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { localDate } from '../src/modules/time/time.routes';
import { freshApp, type Fresh } from './helpers';

/**
 * Projects, fees, time and billing: the project principal is never the PM, a fixed fee always has its fees (and can be
 * set later through PUT /projects/:code/fees), time cannot cite another phase's fee, only a firm-wide planner names a
 * lead, milestones cannot release more than the fee, a rejected draft's fixed-fee amount is ready again, and dates
 * follow the firm's timezone.
 */
let f: Fresh;
let clientId: string;
beforeAll(async () => {
  f = await freshApp();
  clientId = (await f.call('P01', 'GET', '/clients')).body.data[0].id;
});
afterAll(async () => { await f?.close(); });

const phaseOf = async (code: string, phase: string) => (await f.call('P01', 'GET', `/projects/${code}`)).body.phases.find((p: any) => p.code === phase).id as string;
const project = (code: string, extra: Record<string, unknown> = {}) => ({
  code, name: `Fees ${code}`, client_id: clientId, pm_id: f.id('P02'), billing_method: 'fixed_percent', contracted_amount: 1000000,
  phases: [{ code: 'CD', name: 'Concept design', fee: 400000 }, { code: 'SD', name: 'Schematic design', fee: 600000 }], ...extra,
});
const create = async (code: string, extra: Record<string, unknown> = {}) => {
  const r = await f.call('P01', 'POST', '/projects', project(code, extra));
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
};
const principalOf = async (code: string) => (await f.owner.query('select principal_id from project where code = $1', [code])).rows[0].principal_id as string | null;
const grantSet = async (ref: string, key: string) => {
  const set = (await f.owner.query('select id from permission_set where key = $1', [key])).rows[0].id;
  await f.owner.query(
    `insert into permission_grant (firm_id, person_id, permission_set_id, granted_by, reason, sensitive) values ($1,$2,$3,$4,'Test',false)`,
    [f.firmId, f.id(ref), set, f.id('P01')],
  );
};

describe('project principal and PM', () => {
  it('never defaults the principal to the creator when the creator is the PM; null with no other principal', async () => {
    const r = await create('FT-01', { pm_id: f.id('P01') });
    expect(r.principal_id).toBeNull();
    expect(await principalOf('FT-01')).toBeNull();
  });

  it('falls back to another active principal when the creating principal is the PM', async () => {
    await grantSet('P03', 'principal');
    const r = await create('FT-02', { pm_id: f.id('P01') });
    expect(r.principal_id).toBe(f.id('P03'));
    // A creating principal who is not the PM is still the default.
    expect((await create('FT-03')).principal_id).toBe(f.id('P01'));
  });

  it('refuses a principal without the principal set and a PM without the pm or principal set, naming the field', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ principal_id: f.id('P02') }, 'principal_id'],
      [{ principal_id: f.id('P10') }, 'principal_id'],
      [{ pm_id: f.id('P04') }, 'pm_id'],
      [{ pm_id: f.id('P10') }, 'pm_id'],
    ];
    for (const [extra, field] of cases) {
      const r = await f.call('P01', 'POST', '/projects', project('FT-09', extra));
      expect(r.status, JSON.stringify(extra)).toBe(400);
      expect(r.body.error.details[0]).toMatchObject({ field, code: 'not_eligible' });
    }
    expect((await f.owner.query(`select count(*)::int n from project where code = 'FT-09'`)).rows[0].n).toBe(0);
  });

  it('GET /project-candidates lists who may be PM or principal, for a project creator only', async () => {
    const r = await f.call('P01', 'GET', '/project-candidates');
    expect(r.status).toBe(200);
    const by = (ref: string) => r.body.data.find((p: any) => p.ref_code === ref);
    expect(by('P01')).toMatchObject({ can_be_pm: true, can_be_principal: true });
    expect(by('P02')).toMatchObject({ can_be_pm: true, can_be_principal: false });
    expect(by('P04')).toMatchObject({ can_be_pm: false, can_be_principal: false, sets: ['staff'] });
    expect((await f.call('P04', 'GET', '/project-candidates')).status).toBe(403);
  });
});

describe('a fixed fee needs its fees when it is created', () => {
  it('refuses a fixed fee without the contracted fee or without a fee for every phase', async () => {
    const noFee = await f.call('P01', 'POST', '/projects', project('FT-10', { contracted_amount: null, phases: [{ code: 'CD', name: 'Concept design' }] }));
    expect(noFee.status).toBe(400);
    expect(noFee.body.error.details[0]).toMatchObject({ field: 'contracted_amount', code: 'required' });
    const zero = await f.call('P01', 'POST', '/projects', project('FT-10', { contracted_amount: 0, phases: [{ code: 'CD', name: 'Concept design' }] }));
    expect(zero.status).toBe(400);
    expect(zero.body.error.details[0].field).toBe('contracted_amount');
    const gap = await f.call('P01', 'POST', '/projects', project('FT-10', { phases: [{ code: 'CD', name: 'Concept design', fee: 1000000 }, { code: 'SD', name: 'Schematic design' }] }));
    expect(gap.status).toBe(400);
    expect(gap.body.error.details[0]).toMatchObject({ field: 'phases[1].fee', code: 'required' });
    expect((await f.owner.query(`select count(*)::int n from project where code = 'FT-10'`)).rows[0].n).toBe(0);
  });

  it('a single phase takes the whole contracted fee, so it can be authorized and billed', async () => {
    await create('FT-11', { phases: [{ code: 'CD', name: 'Concept design' }] });
    const view = await f.call('P01', 'GET', '/projects/FT-11');
    expect(view.body.phases[0].fee.amount).toBe('1000000.00');
    const cd = await phaseOf('FT-11', 'CD');
    expect((await f.call('P01', 'POST', '/projects/FT-11/fee-authorizations', { phase_id: cd, cumulative_percent: 10 })).status).toBe(200);
  });
});

describe('PUT /projects/:code/fees', () => {
  let cd: string; let sd: string;
  beforeAll(async () => {
    // A project from before fees were required: allocations stored as 0 and no contracted fee.
    await create('FT-20');
    await f.owner.query(`update phase_fee_allocation a set amount = 0 from phase ph join project p on p.id = ph.project_id where a.phase_id = ph.id and p.code = 'FT-20'`);
    await f.owner.query(`update fee_component c set contracted_amount = null from project p where p.id = c.project_id and p.code = 'FT-20'`);
    cd = await phaseOf('FT-20', 'CD');
    sd = await phaseOf('FT-20', 'SD');
  });

  it('a project without fees cannot be authorized until its fees are set', async () => {
    const r = await f.call('P01', 'POST', '/projects/FT-20/fee-authorizations', { phase_id: cd, cumulative_percent: 40 });
    expect(r.status).toBe(422);
    expect(r.body.error.rule).toBe('F13');
  });

  it('is forbidden without projects.create or changes.manage on the project', async () => {
    for (const ref of ['P04', 'P10', 'P06']) {
      const r = await f.call(ref, 'PUT', '/projects/FT-20/fees', { contracted_amount: 1000000, phases: [{ phase_id: cd, fee: 400000 }, { phase_id: sd, fee: 600000 }] });
      expect(r.status, ref).toBe(403);
    }
  });

  it('validates the amounts: fees must add up to the contracted fee, every phase once, numbers at least zero', async () => {
    const cases: [Record<string, unknown>, string, string][] = [
      [{ contracted_amount: 1000000, phases: [{ phase_id: cd, fee: 400000 }, { phase_id: sd, fee: 500000 }] }, 'phases', 'fee_sum'],
      [{ contracted_amount: 1000000, phases: [{ phase_id: cd, fee: 1000000 }] }, 'phases', 'missing'],
      [{ contracted_amount: 0, phases: [{ phase_id: cd, fee: 0 }, { phase_id: sd, fee: 0 }] }, 'contracted_amount', 'range'],
      [{ contracted_amount: 'lots', phases: [] }, 'contracted_amount', 'number'],
      [{ contracted_amount: 1000000, phases: [{ phase_id: cd, fee: -1 }, { phase_id: sd, fee: 1000001 }] }, 'phases[0].fee', 'range'],
      [{ contracted_amount: 1000000, phases: [{ phase_id: 'x', fee: 1 }] }, 'phases[0].phase_id', 'unknown'],
      [{ contracted_amount: 1000000, phases: [{ phase_id: cd, fee: 500000 }, { phase_id: cd, fee: 500000 }] }, 'phases[1].phase_id', 'duplicate'],
      [{ phases: [] }, 'contracted_amount', 'required'],
    ];
    for (const [body, field, code] of cases) {
      const r = await f.call('P01', 'PUT', '/projects/FT-20/fees', body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body.error.details[0], JSON.stringify(body)).toMatchObject({ field, code });
    }
  });

  it('sets the fees, after which the project is authorized and billed', async () => {
    const r = await f.call('P01', 'PUT', '/projects/FT-20/fees', { contracted_amount: 1000000, phases: [{ phase_id: cd, fee: 400000 }, { phase_id: sd, fee: 600000 }] });
    expect(r.status).toBe(200);
    expect(r.body.contracted_amount.amount).toBe('1000000.00');
    const row = (await f.owner.query('select action, record_type from audit_event where id = $1', [r.body.audit_event_id])).rows[0];
    expect(row).toEqual({ action: 'set_fees', record_type: 'fee_component' });
    const view = await f.call('P01', 'GET', '/projects/FT-20');
    expect(view.body.phases.map((p: any) => p.fee.amount)).toEqual(['400000.00', '600000.00']);
    expect(view.body.entitlement.contracted.amount).toBe('1000000.00');
    expect((await f.call('P01', 'POST', '/projects/FT-20/fee-authorizations', { phase_id: cd, cumulative_percent: 50 })).status).toBe(200);
    const ready = await f.call('P01', 'GET', '/billing/ready?project=FT-20');
    expect(ready.body.data[0]).toMatchObject({ line_type: 'fixed_progress', current_claim: { amount: '200000.00' } });
  });

  it('cannot reduce a phase below what is already authorized (422); the PM of the project may change fees', async () => {
    const low = await f.call('P01', 'PUT', '/projects/FT-20/fees', { contracted_amount: 1000000, phases: [{ phase_id: cd, fee: 150000 }, { phase_id: sd, fee: 850000 }] });
    expect(low.status).toBe(422);
    expect(low.body.error.rule).toBe('F13');
    expect(low.body.error.details[0]).toMatchObject({ phase_id: cd, code: 'below_authorized', minimum: '200000.00' });
    // Exactly the authorized amount is allowed, by the project's PM (changes.manage on their project).
    const ok = await f.call('P02', 'PUT', '/projects/FT-20/fees', { contracted_amount: 1200000, phases: [{ phase_id: cd, fee: 200000 }, { phase_id: sd, fee: 1000000 }] });
    expect(ok.status).toBe(200);
  });

  it('cannot reduce a phase below what is billed in a live draft', async () => {
    await create('FT-21', { contracted_amount: 100000, phases: [{ code: 'CD', name: 'Concept design', fee: 100000 }] });
    const ph = await phaseOf('FT-21', 'CD');
    expect((await f.call('P01', 'POST', '/projects/FT-21/fee-authorizations', { phase_id: ph, cumulative_percent: 50 })).status).toBe(200);
    expect((await f.call('P10', 'POST', '/billing/drafts', { project: 'FT-21', cutoff_date: '2026-11-06' })).status).toBe(200);
    // 50,000 (50% of 1,00,000) is in a live draft, so the phase cannot go below it.
    const r = await f.call('P01', 'PUT', '/projects/FT-21/fees', { contracted_amount: 49999, phases: [{ phase_id: ph, fee: 49999 }] });

    expect(r.status).toBe(422);
    expect(r.body.error.details[0].minimum).toBe('50000.00');
  });

  it('a project without a fixed fee has no phase fees to set (422)', async () => {
    const r = await f.call('P01', 'POST', '/projects', { ...project('FT-22'), billing_method: 'hourly', contracted_amount: null, phases: [{ code: 'FS', name: 'Feasibility' }] });
    expect(r.status).toBe(200);
    const fs = await phaseOf('FT-22', 'FS');
    const put = await f.call('P01', 'PUT', '/projects/FT-22/fees', { contracted_amount: 1000, phases: [{ phase_id: fs, fee: 1000 }] });
    expect(put.status).toBe(422);
    expect((await f.call('P01', 'PUT', '/projects/NOPE-99/fees', { contracted_amount: 1000, phases: [] })).status).toBe(404);
  });
});

describe('time cites only a fee component of its own phase', () => {
  it('refuses a fee component from another project with 422 and accepts the phase\'s own', async () => {
    await create('FT-30', { members: [{ person_id: f.id('P04') }] });
    const cd = await phaseOf('FT-30', 'CD');
    const foreign = (await f.owner.query(`select c.id from fee_component c join project p on p.id = c.project_id where p.code = 'FT-20'`)).rows[0].id;
    const own = (await f.owner.query(`select c.id from fee_component c join project p on p.id = c.project_id where p.code = 'FT-30'`)).rows[0].id;
    const bad = await f.call('P04', 'POST', '/time-entries', { service_date: '2026-10-05', duration_hours: 2, phase_id: cd, fee_component_id: foreign });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details[0]).toMatchObject({ field: 'fee_component_id', code: 'not_on_phase' });
    expect((await f.call('P04', 'POST', '/time-entries', { service_date: '2026-10-05', duration_hours: 2, phase_id: cd, fee_component_id: 'nope' })).status).toBe(422);
    const ok = await f.call('P04', 'POST', '/time-entries', { service_date: '2026-10-05', duration_hours: 2, phase_id: cd, fee_component_id: own });
    expect(ok.status).toBe(200);
    expect((await f.owner.query('select fee_component_id from time_entry where id = $1', [ok.body.id])).rows[0].fee_component_id).toBe(own);
  });
});

describe('the lead role', () => {
  beforeAll(async () => { await create('FT-40'); });
  it('a PM adds contributors, reviewers and viewers but cannot assign or change a lead', async () => {
    for (const role of ['contributor', 'reviewer', 'viewer']) {
      expect((await f.call('P02', 'POST', '/projects/FT-40/members', { person_id: f.id('P05'), role })).status, role).toBe(200);
    }
    const lead = await f.call('P02', 'POST', '/projects/FT-40/members', { person_id: f.id('P05'), role: 'lead' });
    expect(lead.status).toBe(403);
    expect(lead.body.error.capability).toBe('projects.plan');
    // A firm-wide planner (the principal) names the lead.
    const byPrincipal = await f.call('P01', 'POST', '/projects/FT-40/members', { person_id: f.id('P05'), role: 'lead' });
    expect(byPrincipal.status).toBe(200);
    expect(byPrincipal.body.members.find((m: any) => m.person.ref_code === 'P05').role).toBe('lead');
    // The PM cannot demote the lead either.
    expect((await f.call('P02', 'POST', '/projects/FT-40/members', { person_id: f.id('P05'), role: 'viewer' })).status).toBe(403);
    expect((await f.call('P02', 'POST', '/projects/FT-40/members', { person_id: f.id('P05'), role: 'owner' })).status).toBe(400);
  });
});

describe('milestones are capped at the fee', () => {
  it('refuses a milestone that takes the schedule over the fee; a milestone fee is not authorized by percent', async () => {
    await create('FT-50', { billing_method: 'fixed_milestone', contracted_amount: 300000, phases: [{ code: 'CD', name: 'Concept design' }] });
    const cd = await phaseOf('FT-50', 'CD');
    expect((await f.call('P01', 'POST', '/projects/FT-50/milestones', { label: 'Concept', amount: 200000, phase_id: cd })).status).toBe(200);
    const over = await f.call('P01', 'POST', '/projects/FT-50/milestones', { label: 'Too much', amount: 150000 });
    expect(over.status).toBe(422);
    expect(over.body.error.details[0]).toMatchObject({ field: 'amount', code: 'over_fee', remaining: '100000.00' });
    expect((await f.call('P01', 'POST', '/projects/FT-50/milestones', { label: 'Rest', amount: 100000 })).status).toBe(200);
    expect((await f.call('P01', 'POST', '/projects/FT-50/milestones', { label: 'More', amount: 1 })).status).toBe(422);
    // The same fee cannot also be released by percent.
    const pct = await f.call('P01', 'POST', '/projects/FT-50/fee-authorizations', { phase_id: cd, cumulative_percent: 50 });
    expect(pct.status).toBe(422);
    expect(pct.body.error.rule).toBe('F13');
    expect((await f.call('P04', 'POST', '/projects/FT-50/milestones', { label: 'X', amount: 1 })).status).toBe(403);
    expect((await f.call('P01', 'POST', '/projects/FT-50/milestones', { label: 'X', amount: 0 })).status).toBe(400);
  });
});

describe('a rejected draft makes its fixed-fee amount ready again', () => {
  it('releases 30% twice, rejects the first draft, and the first 30% is ready again', async () => {
    await create('FT-60', { phases: [{ code: 'CD', name: 'Concept design', fee: 1000000 }] });
    const cd = await phaseOf('FT-60', 'CD');
    const ready = async () => (await f.call('P10', 'GET', '/billing/ready?project=FT-60')).body.data;
    const draft = async () => {
      const r = await f.call('P10', 'POST', '/billing/drafts', { project: 'FT-60', cutoff_date: '2026-11-06' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return r.body;
    };
    expect((await f.call('P01', 'POST', '/projects/FT-60/fee-authorizations', { phase_id: cd, cumulative_percent: 30 })).status).toBe(200);
    const d1 = await draft();
    expect(d1.total.amount).toBe('300000.00');
    expect((await f.call('P01', 'POST', '/projects/FT-60/fee-authorizations', { phase_id: cd, cumulative_percent: 60 })).status).toBe(200);
    const d2 = await draft();
    expect(d2.total.amount).toBe('300000.00');
    expect(await ready()).toHaveLength(0);

    expect((await f.call('P10', 'POST', `/billing/drafts/${d1.id}/reject`, { reason: 'Wrong client contact' })).status).toBe(200);
    const again = await ready();
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ line_type: 'fixed_progress', current_claim: { amount: '300000.00' }, previous_net_billing: { amount: '300000.00' } });
    const d3 = await draft();
    expect(d3.total.amount).toBe('300000.00');
    expect(await ready()).toHaveLength(0);
  });
});

describe('dates follow the firm timezone', () => {
  it('localDate: 05:00 in India is the next calendar day from UTC', () => {
    expect(localDate('Asia/Kolkata', new Date('2026-03-01T23:30:00Z'))).toBe('2026-03-02');
    expect(localDate('UTC', new Date('2026-03-01T23:30:00Z'))).toBe('2026-03-01');
    expect(localDate('Not/AZone', new Date('2026-03-01T23:30:00Z'))).toBe('2026-03-01');
  });

  it('a timer started at 05:00 IST stops into that IST day, not the previous UTC day', async () => {
    await create('FT-70', { members: [{ person_id: f.id('P04') }] });
    const cd = await phaseOf('FT-70', 'CD');
    const pid = (await f.owner.query(`select id from project where code = 'FT-70'`)).rows[0].id;
    await f.owner.query(
      `insert into timer (firm_id, person_id, project_id, phase_id, started_at, created_by) values ($1,$2,$3,$4,'2026-03-01T23:30:00Z',$2)`,
      [f.firmId, f.id('P04'), pid, cd],
    );
    const r = await f.call('P04', 'POST', '/timers/stop');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await f.owner.query('select service_date from time_entry where id = $1', [r.body.time_entry_id])).rows[0].service_date).toBe('2026-03-02');
  });

  it('the default timesheet period is the firm-local week at 05:00 IST on a Monday', async () => {
    await f.login('P04');
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      // Sunday 15 Nov 23:30 UTC is Monday 16 Nov 05:00 in India: a new week.
      vi.setSystemTime(new Date('2026-11-15T23:30:00Z'));
      const r = await f.call('P04', 'GET', '/me/time');
      expect(r.status).toBe(200);
      expect(r.body.period_start).toBe('2026-11-16');
    } finally {
      vi.useRealTimers();
    }
  });
});
