import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshApp, type Fresh } from './helpers';
import type { Tx } from '../src/db/pool';
import { isEligibleApprover, needFor, routeApprover } from '../src/modules/approvals/approvals.routes';

/**
 * Review finding: "some managers may now be sent approvals they aren't allowed to approve, so those items get stuck".
 * Routing now sends every request type only to someone who can decide it (capability for the type, and the project
 * for scoped capabilities), falls through designated approver, substitute, project principal, firm fallback and any
 * principal, and refuses at submit (422 NO_APPROVER) rather than create a stuck item. Existing stuck items can be
 * listed (GET /approvals/stuck) and reassigned (POST /approvals/:id/reassign).
 */

/** The owner connection, used as a transaction client for the routing functions (it sees past RLS, which is fine for one firm). */
const owner = (f: Fresh) => f.owner as unknown as Tx;
const approverOf = async (f: Fresh, id: string) => (await f.owner.query('select approver_id from approval_request where id = $1', [id])).rows[0].approver_id as string;
const category = async (f: Fresh) => (await f.owner.query('select id from internal_work_category order by key limit 1')).rows[0].id as string;
const prj = async (f: Fresh, code: string) => (await f.owner.query('select id, pm_id from project where code = $1', [code])).rows[0];
const phaseOf = async (f: Fresh, code: string, phase: string) => (await f.owner.query('select ph.id from phase ph join project p on p.id = ph.project_id where p.code = $1 and ph.code = $2', [code, phase])).rows[0].id as string;
async function logAndSubmit(f: Fresh, ref: string, monday: string, line: { phase_id?: string; internal_category_id?: string }) {
  expect((await f.call(ref, 'POST', '/time-entries', { service_date: monday, duration_hours: 4, ...line })).status).toBe(200);
  return f.call(ref, 'POST', `/timesheets/${monday}/submit`);
}

describe('the seeded demo studio', () => {
  let f: Fresh;
  beforeAll(async () => { f = await freshApp(); });
  afterAll(async () => { await f?.close(); });

  it('has no pending item routed to someone who cannot decide it', async () => {
    const pending = (await f.owner.query(`select id, type, project_id, approver_id, submitter_id from approval_request where status = 'Pending'`)).rows;
    expect(pending.length).toBeGreaterThanOrEqual(4);
    expect(pending.filter((r) => r.type === 'leave')).toHaveLength(2);
    for (const r of pending) {
      const ok = r.approver_id === r.submitter_id || await isEligibleApprover(owner(f), r.approver_id, needFor(r));
      expect(ok, `${r.type} ${r.id}`).toBe(true);
    }
    const stuck = await f.call('P01', 'GET', '/approvals/stuck');
    expect(stuck.status).toBe(200);
    expect(stuck.body.data).toEqual([]);
  });
});

describe('routing skips people who cannot decide the request', () => {
  let f: Fresh;
  beforeAll(async () => { f = await freshApp(); });
  afterAll(async () => { await f?.close(); });

  it('internal time whose manager is staff goes to the firm fallback approver', async () => {
    await f.owner.query('update person set manager_id = $2 where id = $1', [f.id('P05'), f.id('P04')]);
    const s = await logAndSubmit(f, 'P05', '2026-09-07', { internal_category_id: await category(f) });
    expect(s.status).toBe(200);
    expect(await approverOf(f, s.body.approval_request_ids[0])).toBe(f.id('P01'));
    expect((await f.call('P01', 'POST', `/approvals/${s.body.approval_request_ids[0]}/approve`)).status).toBe(200);
    await f.owner.query('update person set manager_id = $2 where id = $1', [f.id('P05'), f.id('P02')]);
  });

  it('project time whose PM cannot approve time goes to the project principal', async () => {
    const p = await prj(f, 'PRJ-01');
    await f.owner.query('update project set pm_id = $2 where id = $1', [p.id, f.id('P04')]);
    const s = await logAndSubmit(f, 'P05', '2026-09-14', { phase_id: await phaseOf(f, 'PRJ-01', 'WD') });
    expect(s.status).toBe(200);
    expect(await approverOf(f, s.body.approval_request_ids[0])).toBe(f.id('P01'));
    await f.owner.query('update project set pm_id = $2 where id = $1', [p.id, p.pm_id]);
  });

  it("a substitute who does not lead the project is skipped for that project's time, but used for internal time", async () => {
    await f.owner.query(`insert into substitute (firm_id, approver_id, substitute_id, from_date, to_date) values ($1,$2,$3,'2020-01-01','2099-12-31')`, [f.firmId, f.id('P02'), f.id('P03')]);
    const s = await logAndSubmit(f, 'P05', '2026-09-21', { phase_id: await phaseOf(f, 'PRJ-01', 'WD') });
    expect(await approverOf(f, s.body.approval_request_ids[0])).toBe(f.id('P02'));
    expect((await f.call('P02', 'POST', `/approvals/${s.body.approval_request_ids[0]}/approve`)).status).toBe(200);
    const i = await logAndSubmit(f, 'P05', '2026-09-28', { internal_category_id: await category(f) });
    expect(await approverOf(f, i.body.approval_request_ids[0])).toBe(f.id('P03'));
    await f.owner.query('delete from substitute');
  });

  it('leave whose manager is staff goes to the fallback, who holds leave.approve', async () => {
    await f.owner.query('update person set manager_id = $2 where id = $1', [f.id('P08'), f.id('P04')]);
    const r = await f.call('P08', 'POST', '/leave-requests', { leave_type_id: 'earned', start_date: '2027-05-03', end_date: '2027-05-03' });
    expect(r.status).toBe(200);
    expect(r.body.approver.id).toBe(f.id('P01'));
    expect(await approverOf(f, r.body.approval_request_id)).toBe(f.id('P01'));
    await f.owner.query('update person set manager_id = $2 where id = $1', [f.id('P08'), f.id('P02')]);
  });

  it('billing drafts never go to a fallback approver without billing.approve', async () => {
    await f.owner.query('update firm set fallback_approver_id = $1', [f.id('P03')]);
    // P10 prepares; P03 is the fallback but cannot approve billing, so the principal gets it.
    expect(await routeApprover(owner(f), null, f.id('P10'), { capability: 'billing.approve' })).toBe(f.id('P01'));
    // The sole principal's own draft comes back to them (recorded as a self-approval), never to P03.
    expect(await routeApprover(owner(f), null, f.id('P01'), { capability: 'billing.approve' })).toBe(f.id('P01'));
    // P03 is still the fallback for time, where they hold time.approve.
    expect(await routeApprover(owner(f), null, f.id('P01'))).toBe(f.id('P03'));
    await f.owner.query('update firm set fallback_approver_id = $1', [f.id('P01')]);
  });
});

describe('nobody eligible', () => {
  let f: Fresh;
  beforeAll(async () => { f = await freshApp(); });
  afterAll(async () => { await f?.close(); });

  it('refuses leave at submit with 422 NO_APPROVER and saves nothing', async () => {
    await f.owner.query('update person set manager_id = $2 where id = $1', [f.id('P05'), f.id('P04')]);
    await f.owner.query('update firm set fallback_approver_id = null');
    await f.owner.query(`update person set employment_state = 'Ended' where id = $1`, [f.id('P01')]);
    const r = await f.call('P05', 'POST', '/leave-requests', { leave_type_id: 'earned', start_date: '2027-05-03', end_date: '2027-05-03' });
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({ code: 'RULE_VIOLATION', rule: 'NO_APPROVER' });
    expect((await f.owner.query('select count(*)::int n from leave_request where person_id = $1', [f.id('P05')])).rows[0].n).toBe(1);
    expect((await f.owner.query(`select count(*)::int n from approval_request where submitter_id = $1 and type = 'leave'`, [f.id('P05')])).rows[0].n).toBe(0);
  });
});

describe('stuck items: GET /approvals/stuck and POST /approvals/:id/reassign', () => {
  let f: Fresh;
  let stuckId: string;
  beforeAll(async () => {
    f = await freshApp();
    // An item routed before the fix: Karan's leave sits with Rohan, who cannot approve leave.
    stuckId = (await f.owner.query(`select a.id from approval_request a join person p on p.id = a.submitter_id where a.type = 'leave' and p.ref_code = 'P06'`)).rows[0].id;
    await f.owner.query('update approval_request set approver_id = $2 where id = $1', [stuckId, f.id('P04')]);
  });
  afterAll(async () => { await f?.close(); });

  it('lists the stuck item for a principal, and refuses staff', async () => {
    const r = await f.call('P01', 'GET', '/approvals/stuck');
    expect(r.status).toBe(200);
    expect(r.body.data.map((a: any) => a.id)).toEqual([stuckId]);
    expect(r.body.data[0].reason).toBe('Rohan Shetty cannot approve this (needs leave.approve).');
    const staff = await f.call('P04', 'GET', '/approvals/stuck');
    expect(staff.status).toBe(403);
  });

  it('needs the capability firm-wide: staff and a scoped PM are refused', async () => {
    const staff = await f.call('P04', 'POST', `/approvals/${stuckId}/reassign`, { to: f.id('P03') });
    expect(staff.status).toBe(403);
    expect(staff.body.error).toMatchObject({ code: 'FORBIDDEN_CAPABILITY', capability: 'leave.approve' });
    const time = (await f.owner.query(`select id from approval_request where type = 'time' and status = 'Pending' limit 1`)).rows[0].id;
    const pm = await f.call('P02', 'POST', `/approvals/${time}/reassign`, { to: f.id('P03') });
    expect(pm.status).toBe(403);
    expect(pm.body.error.capability).toBe('time.approve');
    expect(await approverOf(f, stuckId)).toBe(f.id('P04'));
  });

  it('validates the target', async () => {
    expect((await f.call('P01', 'POST', `/approvals/${stuckId}/reassign`, {})).status).toBe(400);
    const bad = await f.call('P01', 'POST', `/approvals/${stuckId}/reassign`, { to: 'P03' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details[0].field).toBe('to');
    const ineligible = await f.call('P01', 'POST', `/approvals/${stuckId}/reassign`, { to: f.id('P05') });
    expect(ineligible.status).toBe(422);
    expect(ineligible.body.error.rule).toBe('APPROVER_ELIGIBLE');
    const self = await f.call('P01', 'POST', `/approvals/${stuckId}/reassign`, { to: f.id('P06') });
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe('SELF_APPROVAL');
    expect((await f.call('P01', 'POST', `/approvals/${stuckId}/reassign`, { to: randomUUID() })).status).toBe(404);
    expect(await approverOf(f, stuckId)).toBe(f.id('P04'));
  });

  it('reassigns to an eligible person, who can then approve it', async () => {
    const r = await f.call('P01', 'POST', `/approvals/${stuckId}/reassign`, { to: f.id('P03'), reason: 'Rohan cannot approve leave' });
    expect(r.status).toBe(200);
    expect(r.body.approver).toEqual({ id: f.id('P03'), name: 'Meera Iyer' });
    expect(await approverOf(f, stuckId)).toBe(f.id('P03'));
    const ev = (await f.owner.query('select action, previous, new from audit_event where id = $1', [r.body.audit_event_id])).rows[0];
    expect(ev).toMatchObject({ action: 'reassign', previous: { approver_id: f.id('P04') }, new: { approver_id: f.id('P03') } });
    expect((await f.call('P01', 'GET', '/approvals/stuck')).body.data).toEqual([]);
    expect((await f.call('P03', 'POST', `/approvals/${stuckId}/approve`)).status).toBe(200);
    const again = await f.call('P01', 'POST', `/approvals/${stuckId}/reassign`, { to: f.id('P02') });
    expect(again.status).toBe(409);
  });

  it("cannot reach another firm's approvals or people", async () => {
    const other = (await f.owner.query(`insert into firm (legal_name, trading_name, timezone) values ('Other','Other','Asia/Kolkata') returning id`)).rows[0].id;
    const outsider = (await f.owner.query(
      `insert into person (firm_id, ref_code, name, work_email, job_title) values ($1,'P11','Outsider',$2,'Architect') returning id`, [other, `outsider-${randomUUID()}@other.test`],
    )).rows[0].id;
    const theirs = (await f.owner.query(
      `insert into approval_request (firm_id, type, record_type, record_id, submitter_id, approver_id) values ($1,'leave','leave_request',$2,$3,$3) returning id`, [other, randomUUID(), outsider],
    )).rows[0].id;
    expect((await f.call('P01', 'POST', `/approvals/${theirs}/reassign`, { to: f.id('P03') })).status).toBe(404);
    const sneha = (await f.owner.query(`select a.id from approval_request a join person p on p.id = a.submitter_id where a.type = 'leave' and p.ref_code = 'P07'`)).rows[0].id;
    expect((await f.call('P01', 'POST', `/approvals/${sneha}/reassign`, { to: outsider })).status).toBe(404);
    expect((await f.call('P01', 'GET', '/approvals/stuck')).body.data.map((a: any) => a.id)).not.toContain(theirs);
  });
});
