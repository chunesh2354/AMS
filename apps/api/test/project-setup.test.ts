import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshApp, type Fresh } from './helpers';

/**
 * A project made only through the API (no seed rows) can be staffed, have time logged and approved by the right
 * person, and be billed: fixed fee per phase after a principal authorizes progress, hourly from approved time,
 * and milestones once authorized.
 */
let f: Fresh;
let clientId: string;
beforeAll(async () => {
  f = await freshApp();
  clientId = (await f.call('P01', 'GET', '/clients')).body.data[0].id;
});
afterAll(async () => { await f?.close(); });

const phaseOf = async (code: string, phase: string) => (await f.call('P01', 'GET', `/projects/${code}`)).body.phases.find((p: any) => p.code === phase).id as string;
const approverOf = async (requestId: string) => (await f.owner.query('select approver_id from approval_request where id = $1', [requestId])).rows[0].approver_id as string;
const project = (code: string, extra: Record<string, unknown> = {}) => ({
  code, name: `Setup ${code}`, client_id: clientId, pm_id: f.id('P02'), billing_method: 'fixed_percent', contracted_amount: 1000000,
  phases: [{ code: 'CD', name: 'Concept design', fee: 400000 }, { code: 'SD', name: 'Schematic design', fee: 600000 }], ...extra,
});

describe('a project created in the wizard can be staffed, timed and billed', () => {
  it('saves phase fees, the team and the principal; staff log time; PM time goes to the principal; authorized fee is ready to bill', async () => {
    const r = await f.call('P01', 'POST', '/projects', project('PRJ-50', { principal_id: f.id('P01'), members: [{ person_id: f.id('P04'), role: 'contributor' }] }));
    expect(r.status).toBe(200);
    expect(r.body.principal_id).toBe(f.id('P01'));

    const view = await f.call('P01', 'GET', '/projects/PRJ-50');
    expect(view.body.phases.map((p: any) => p.fee.amount)).toEqual(['400000.00', '600000.00']);
    expect(view.body.entitlement.contracted.amount).toBe('1000000.00');
    const members = await f.call('P02', 'GET', '/projects/PRJ-50/members');
    expect(members.status).toBe(200);
    expect(members.body.data.map((m: any) => [m.person.ref_code, m.role])).toEqual([['P02', 'pm'], ['P04', 'contributor']]);

    // Staff member: sees the project and logs time on it; the PM approves.
    expect((await f.call('P04', 'GET', '/projects')).body.data.map((p: any) => p.code)).toContain('PRJ-50');
    const cd = await phaseOf('PRJ-50', 'CD');
    expect((await f.call('P04', 'POST', '/time-entries', { service_date: '2026-10-05', duration_hours: 6, phase_id: cd })).status).toBe(200);
    const s4 = await f.call('P04', 'POST', '/timesheets/2026-10-05/submit');
    expect(s4.status).toBe(200);
    expect(await approverOf(s4.body.approval_request_ids[0])).toBe(f.id('P02'));
    expect((await f.call('P02', 'POST', `/approvals/${s4.body.approval_request_ids[0]}/approve`)).status).toBe(200);

    // The PM's own time goes to the project principal, and can be approved there.
    expect((await f.call('P02', 'POST', '/time-entries', { service_date: '2026-10-12', duration_hours: 4, phase_id: cd })).status).toBe(200);
    const s2 = await f.call('P02', 'POST', '/timesheets/2026-10-12/submit');
    expect(s2.status).toBe(200);
    expect(await approverOf(s2.body.approval_request_ids[0])).toBe(f.id('P01'));
    expect((await f.call('P01', 'POST', `/approvals/${s2.body.approval_request_ids[0]}/approve`)).status).toBe(200);

    // Nothing is ready on a fixed fee until a principal authorizes progress.
    const before = await f.call('P01', 'GET', '/billing/ready?project=PRJ-50');
    expect(before.body.data).toHaveLength(0);
    const a = await f.call('P01', 'POST', '/projects/PRJ-50/fee-authorizations', { phase_id: cd, cumulative_percent: 40, note: 'Concept issued' });
    expect(a.status).toBe(200);
    expect(a.body.audit_event_id).toBeTruthy();
    const row = (await f.owner.query('select cumulative_percent, note, authorized_by from fee_authorization where id = $1', [a.body.id])).rows[0];
    expect(row).toEqual({ cumulative_percent: '40.00', note: 'Concept issued', authorized_by: f.id('P01') });

    const ready = await f.call('P01', 'GET', '/billing/ready?project=PRJ-50');
    expect(ready.status).toBe(200);
    expect(ready.body.data).toHaveLength(1);
    expect(ready.body.data[0]).toMatchObject({ line_type: 'fixed_progress', phase: 'Concept design', current_claim: { amount: '160000.00' }, remaining_entitlement: { amount: '240000.00' } });
    // The PM (scoped billing.prepare) sees it on their project too.
    expect((await f.call('P02', 'GET', '/billing/ready?project=PRJ-50')).body.data).toHaveLength(1);

    // The latest level counts: 60% of 4,00,000, with nothing billed yet.
    expect((await f.call('P01', 'POST', '/projects/PRJ-50/fee-authorizations', { phase_id: cd, cumulative_percent: 60 })).status).toBe(200);
    expect((await f.call('P01', 'GET', '/billing/ready?project=PRJ-50')).body.data[0].current_claim.amount).toBe('240000.00');

    const plan = await f.call('P02', 'GET', '/projects/PRJ-50/fee-authorizations');
    expect(plan.status).toBe(200);
    expect(plan.body.can_authorize).toBe(false);
    expect(plan.body.phases[0]).toMatchObject({ name: 'Concept design', authorized_percent: 60, fixed: true, fee: { amount: '400000.00' } });
    expect(plan.body.phases[0].authorizations.map((x: any) => x.cumulative_percent)).toEqual([40, 60]);
  });

  it("a PM who is also the project principal has their time sent to the firm's fallback approver, never to themselves", async () => {
    expect((await f.call('P01', 'POST', '/projects', project('PRJ-51', { principal_id: f.id('P02') }))).status).toBe(200);
    const cd = await phaseOf('PRJ-51', 'CD');
    expect((await f.call('P02', 'POST', '/time-entries', { service_date: '2026-10-19', duration_hours: 3, phase_id: cd })).status).toBe(200);
    const s = await f.call('P02', 'POST', '/timesheets/2026-10-19/submit');
    expect(s.status).toBe(200);
    const approver = await approverOf(s.body.approval_request_ids[0]);
    expect(approver).not.toBe(f.id('P02'));
    expect(approver).toBe(f.id('P01'));
  });

  it('defaults the principal to the creating principal when the wizard sends none', async () => {
    const r = await f.call('P01', 'POST', '/projects', project('PRJ-53'));
    expect(r.status).toBe(200);
    expect((await f.owner.query(`select principal_id from project where code = 'PRJ-53'`)).rows[0].principal_id).toBe(f.id('P01'));
  });

  it('bills an hourly project from approved time at bill rates', async () => {
    const r = await f.call('P01', 'POST', '/projects', {
      code: 'PRJ-52', name: 'Hourly study', client_id: clientId, pm_id: f.id('P02'), billing_method: 'hourly', members: [{ person_id: f.id('P04') }],
      phases: [{ code: 'FS', name: 'Feasibility' }],
    });
    expect(r.status).toBe(200);
    const fs = await phaseOf('PRJ-52', 'FS');
    expect((await f.call('P04', 'POST', '/time-entries', { service_date: '2026-09-28', duration_hours: 5, phase_id: fs })).status).toBe(200);
    const s = await f.call('P04', 'POST', '/timesheets/2026-09-28/submit');
    expect((await f.call('P02', 'POST', `/approvals/${s.body.approval_request_ids[0]}/approve`)).status).toBe(200);
    const ready = await f.call('P01', 'GET', '/billing/ready?project=PRJ-52');
    expect(ready.body.data).toHaveLength(1);
    expect(ready.body.data[0]).toMatchObject({ line_type: 'hourly', billing_method: 'hourly', current_claim: { amount: '11000.00' } });
    // Hourly phases have no fixed fee to authorize.
    const a = await f.call('P01', 'POST', '/projects/PRJ-52/fee-authorizations', { phase_id: fs, cumulative_percent: 10 });
    expect(a.status).toBe(422);
  });

  it('schedules a milestone, which is ready to bill only once authorized', async () => {
    const r = await f.call('P01', 'POST', '/projects', {
      code: 'PRJ-54', name: 'Office tower', client_id: clientId, pm_id: f.id('P02'), billing_method: 'percent_construction', fee_percent: 6,
      phases: [{ code: 'CD', name: 'Concept design' }],
    });
    expect(r.status).toBe(200);
    const cd = await phaseOf('PRJ-54', 'CD');
    const m = await f.call('P02', 'POST', '/projects/PRJ-54/milestones', { label: 'Concept sign-off', amount: 250000, phase_id: cd });
    expect(m.status).toBe(200);
    expect((await f.call('P01', 'GET', '/billing/ready?project=PRJ-54')).body.data).toHaveLength(0);
    expect((await f.call('P02', 'POST', `/milestones/${m.body.id}/authorize`)).status).toBe(403);
    const a = await f.call('P01', 'POST', `/milestones/${m.body.id}/authorize`);
    expect(a.status).toBe(200);
    expect(a.body.status).toBe('Authorized');
    const ready = await f.call('P01', 'GET', '/billing/ready?project=PRJ-54');
    expect(ready.body.data).toHaveLength(1);
    expect(ready.body.data[0]).toMatchObject({ line_type: 'percent_schedule', label: 'Concept sign-off', current_claim: { amount: '250000.00' } });
    const again = await f.call('P01', 'POST', `/milestones/${m.body.id}/authorize`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_TRANSITION');
  });
});

describe('project creation validation', () => {
  it('refuses phase fees that do not add up to the fixed fee', async () => {
    const r = await f.call('P01', 'POST', '/projects', project('PRJ-60', { phases: [{ code: 'CD', name: 'Concept design', fee: 400000 }, { code: 'SD', name: 'Schematic design', fee: 500000 }] }));
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION');
    expect(r.body.error.details[0]).toMatchObject({ field: 'phases', code: 'fee_sum' });
    expect((await f.owner.query(`select count(*)::int n from project where code = 'PRJ-60'`)).rows[0].n).toBe(0);
  });

  it('refuses a negative phase fee, an unknown fee basis, an unknown principal, team member or role', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ phases: [{ code: 'CD', name: 'Concept design', fee: -1 }] }, 'phases[0].fee'],
      [{ billing_method: 'barter' }, 'billing_method'],
      [{ principal_id: '00000000-0000-4000-8000-000000000000' }, 'principal_id'],
      [{ members: [{ person_id: '00000000-0000-4000-8000-000000000000' }] }, 'members'],
      [{ members: [{ person_id: 'P04' }] }, 'members'],
      [{ members: [{ person_id: '' }] }, 'members'],
      [{ members: 'P04' }, 'members'],
    ];
    for (const [extra, field] of cases) {
      const r = await f.call('P01', 'POST', '/projects', project('PRJ-61', extra));
      expect(r.status, JSON.stringify(extra)).toBe(400);
      expect(String(r.body.error.details[0].field)).toContain(field.split('[')[0]);
    }
    const role = await f.call('P01', 'POST', '/projects', project('PRJ-61', { members: [{ person_id: f.id('P04'), role: 'owner' }] }));
    expect(role.status).toBe(400);
    expect(role.body.error.details[0]).toMatchObject({ field: 'members[0].role', code: 'enum' });
    expect((await f.owner.query(`select count(*)::int n from project where code = 'PRJ-61'`)).rows[0].n).toBe(0);
  });
});

describe('fee authorizations', () => {
  beforeAll(async () => {
    expect((await f.call('P01', 'POST', '/projects', project('PRJ-70'))).status).toBe(200);
  });
  it('is forbidden without changes.authorize or billing.approve', async () => {
    const cd = await phaseOf('PRJ-70', 'CD');
    for (const ref of ['P02', 'P04', 'P10']) {
      const r = await f.call(ref, 'POST', '/projects/PRJ-70/fee-authorizations', { phase_id: cd, cumulative_percent: 20 });
      expect(r.status).toBe(403);
      expect(r.body.error.capability).toBe('changes.authorize');
    }
    expect((await f.call('P04', 'GET', '/projects/PRJ-70/fee-authorizations')).status).toBe(403);
    expect((await f.owner.query('select count(*)::int n from fee_authorization f join phase_fee_allocation a on a.id = f.phase_fee_allocation_id where a.phase_id = $1', [cd])).rows[0].n).toBe(0);
  });
  it('validates the phase and the percent, which must rise and stay at most 100', async () => {
    const cd = await phaseOf('PRJ-70', 'CD');
    const other = await phaseOf('PRJ-50', 'CD');
    for (const [body, field] of [
      [{ cumulative_percent: 20 }, 'phase_id'],
      [{ phase_id: cd }, 'cumulative_percent'],
      [{ phase_id: cd, cumulative_percent: 0 }, 'cumulative_percent'],
      [{ phase_id: cd, cumulative_percent: 101 }, 'cumulative_percent'],
      [{ phase_id: cd, cumulative_percent: 'lots' }, 'cumulative_percent'],
      [{ phase_id: cd, cumulative_percent: 12.345 }, 'cumulative_percent'],
      [{ phase_id: 'nope', cumulative_percent: 20 }, 'phase_id'],
      [{ phase_id: other, cumulative_percent: 20 }, 'phase_id'],
    ] as const) {
      const r = await f.call('P01', 'POST', '/projects/PRJ-70/fee-authorizations', body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body.error.details[0].field).toBe(field);
    }
    expect((await f.call('P01', 'POST', '/projects/PRJ-70/fee-authorizations', { phase_id: cd, cumulative_percent: 100 })).status).toBe(200);
    const lower = await f.call('P01', 'POST', '/projects/PRJ-70/fee-authorizations', { phase_id: cd, cumulative_percent: 50 });
    expect(lower.status).toBe(422);
    expect(lower.body.error.details[0].code).toBe('not_increasing');
    expect((await f.call('P01', 'POST', '/projects/NOPE-1/fee-authorizations', { phase_id: cd, cumulative_percent: 20 })).status).toBe(404);
  });
  it('validates milestones and refuses them on a fee with no schedule', async () => {
    expect((await f.call('P01', 'POST', '/projects/PRJ-70/milestones', { label: 'Stage', amount: 1000 })).status).toBe(422);
    expect((await f.call('P04', 'POST', '/projects/PRJ-70/milestones', { label: 'Stage', amount: 1000 })).status).toBe(403);
    expect((await f.call('P01', 'POST', '/projects/PRJ-70/milestones', { label: '', amount: 1000 })).status).toBe(400);
    expect((await f.call('P01', 'POST', '/projects/PRJ-70/milestones', { label: 'Stage', amount: -5 })).status).toBe(400);
    expect((await f.call('P01', 'POST', '/milestones/not-a-uuid/authorize')).status).toBe(404);
  });
});

describe('project team', () => {
  beforeAll(async () => {
    expect((await f.call('P01', 'POST', '/projects', project('PRJ-80'))).status).toBe(200);
  });
  it('the PM adds and removes a member; membership controls who sees the project', async () => {
    expect((await f.call('P05', 'GET', '/projects/PRJ-80')).status).toBe(403);
    const add = await f.call('P02', 'POST', '/projects/PRJ-80/members', { person_id: f.id('P05'), role: 'contributor' });
    expect(add.status).toBe(200);
    expect(add.body.audit_event_id).toBeTruthy();
    expect(add.body.members.map((m: any) => m.person.ref_code)).toEqual(['P02', 'P05']);
    expect((await f.call('P05', 'GET', '/projects/PRJ-80')).status).toBe(200);
    // Same person again changes the role, no duplicate row.
    const lead = await f.call('P02', 'POST', '/projects/PRJ-80/members', { person_id: f.id('P05'), role: 'lead' });
    expect(lead.body.members.find((m: any) => m.person.ref_code === 'P05').role).toBe('lead');
    const del = await f.call('P02', 'DELETE', `/projects/PRJ-80/members/${f.id('P05')}`);
    expect(del.status).toBe(200);
    expect(del.body.members.map((m: any) => m.person.ref_code)).toEqual(['P02']);
    expect((await f.call('P05', 'GET', '/projects/PRJ-80')).status).toBe(403);
    expect((await f.call('P02', 'DELETE', `/projects/PRJ-80/members/${f.id('P05')}`)).status).toBe(404);
  });
  it('cannot remove the PM', async () => {
    const r = await f.call('P01', 'DELETE', `/projects/PRJ-80/members/${f.id('P02')}`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('IS_PM');
    expect((await f.call('P01', 'POST', '/projects/PRJ-80/members', { person_id: f.id('P02') })).status).toBe(409);
  });
  it('is forbidden to staff and to a PM of another project', async () => {
    for (const ref of ['P04', 'P03']) {
      const r = await f.call(ref, 'POST', '/projects/PRJ-80/members', { person_id: f.id('P06') });
      expect(r.status).toBe(403);
      expect(r.body.error.capability).toBe('projects.plan');
      expect((await f.call(ref, 'DELETE', `/projects/PRJ-80/members/${f.id('P02')}`)).status).toBe(403);
    }
  });
  it('validates the person and role', async () => {
    for (const body of [{}, { person_id: 'P06' }, { person_id: '00000000-0000-4000-8000-000000000000' }, { person_id: f.id('P06'), role: 'pm' }, { person_id: f.id('P06'), role: 'boss' }]) {
      const r = await f.call('P02', 'POST', '/projects/PRJ-80/members', body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body.error.code).toBe('VALIDATION');
    }
  });
});

describe('POST /rates validates the person', () => {
  const rate = (person_id: unknown) => ({ person_id, rate_type: 'bill', amount: 2500, effective_from: '2026-12-01', change_reason: 'Annual review' });
  it('an unknown or malformed person is 404, not a 500', async () => {
    expect((await f.call('P01', 'POST', '/rates', rate('00000000-0000-4000-8000-000000000000'))).status).toBe(404);
    expect((await f.call('P01', 'POST', '/rates', rate('P04'))).status).toBe(404);
    expect((await f.call('P01', 'POST', '/rates', { ...rate(f.id('P04')), rate_type: 'gold' })).status).toBe(400);
  });
  it("another firm's person is refused, and nothing is written", async () => {
    const other = (await f.owner.query(`insert into firm (legal_name, trading_name, timezone) values ('Other','Other','Asia/Kolkata') returning id`)).rows[0].id;
    const person = (await f.owner.query(
      `insert into person (firm_id, ref_code, name, work_email, job_title) values ($1,'X01','Outsider','outsider@other.test','Architect') returning id`, [other],
    )).rows[0].id;
    const r = await f.call('P01', 'POST', '/rates', rate(person));
    expect(r.status).toBe(404);
    expect((await f.owner.query('select count(*)::int n from rate_schedule where person_id = $1', [person])).rows[0].n).toBe(0);
  });
  it('a known person still works', async () => {
    const r = await f.call('P01', 'POST', '/rates', rate(f.id('P04')));
    expect(r.status).toBe(200);
  });
});

describe('only the project team can record time on it', () => {
  it('refuses a non-member and a removed member, even with a known phase id, on every way of logging time', async () => {
    expect((await f.call('P01', 'POST', '/projects', project('PRJ-60', { principal_id: f.id('P01'), members: [{ person_id: f.id('P05'), role: 'contributor' }] }))).status).toBe(200);
    const cd = await phaseOf('PRJ-60', 'CD');

    // P06 was never on the team.
    const outsider = await f.call('P06', 'POST', '/time-entries', { service_date: '2026-10-06', duration_hours: 2, phase_id: cd });
    expect(outsider.status).toBe(403);
    expect(outsider.body.error.code).toBe('NOT_PROJECT_MEMBER');
    expect((await f.call('P06', 'PUT', '/me/time/cell', { service_date: '2026-10-06', duration_hours: 2, phase_id: cd })).status).toBe(403);
    expect((await f.call('P06', 'POST', '/timers/start', { phase_id: cd })).status).toBe(403);

    // P05 can log time while on the team, and not after being removed.
    expect((await f.call('P05', 'POST', '/time-entries', { service_date: '2026-10-06', duration_hours: 2, phase_id: cd })).status).toBe(200);
    expect((await f.call('P02', 'DELETE', `/projects/PRJ-60/members/${f.id('P05')}`)).status).toBe(200);
    const removed = await f.call('P05', 'POST', '/time-entries', { service_date: '2026-10-07', duration_hours: 2, phase_id: cd });
    expect(removed.status).toBe(403);
    expect(removed.body.error.code).toBe('NOT_PROJECT_MEMBER');

    // The PM and the project principal can always record time on their project; nothing extra was written.
    expect((await f.call('P02', 'POST', '/time-entries', { service_date: '2026-10-08', duration_hours: 1, phase_id: cd })).status).toBe(200);
    expect((await f.call('P01', 'POST', '/time-entries', { service_date: '2026-10-08', duration_hours: 1, phase_id: cd })).status).toBe(200);
    const rows = (await f.owner.query('select count(*)::int as n from time_entry where phase_id = $1', [cd])).rows[0].n;
    expect(rows).toBe(3);
  });
});
