import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshApp, type Fresh } from './helpers';

/**
 * Leave (migration 008): types per firm, balances per person and year, requests that go through the approvals queue.
 * GET /me/leave, POST /leave-requests, POST /leave-requests/:id/withdraw; approve, return and reject in approvals.
 * Requests use 2027 dates so "today" (the studio's) is always before them.
 */
let f: Fresh;
beforeAll(async () => { f = await freshApp(); });
afterAll(async () => { await f?.close(); });

const typeId = async (key: string) => (await f.owner.query('select id from leave_type where key = $1', [key])).rows[0].id as string;
const balance = async (ref: string, year: number, key: string) => (await f.call(ref, 'GET', `/me/leave?year=${year}`)).body.balances.find((b: any) => b.leave_type.key === key);
const leaveRow = async (id: string) => (await f.owner.query('select * from leave_request where id = $1', [id])).rows[0];
const request = async (ref: string, body: Record<string, unknown>) => f.call(ref, 'POST', '/leave-requests', body);

describe('the demo studio', () => {
  it('every firm has the four default leave types', async () => {
    const r = await f.call('P05', 'GET', '/me/leave?year=2026');
    expect(r.status).toBe(200);
    expect(r.body.types.map((t: any) => t.name)).toEqual(['Earned leave', 'Sick leave', 'Casual leave', 'Unpaid leave']);
    expect(r.body.types.find((t: any) => t.key === 'unpaid').tracks_balance).toBe(false);
  });

  it("shows Rohan's balances and approved leave as My leave does", async () => {
    const r = await f.call('P04', 'GET', '/me/leave?year=2026');
    expect(r.status).toBe(200);
    expect(r.body.year).toBe(2026);
    const by = Object.fromEntries(r.body.balances.map((b: any) => [b.leave_type.key, b]));
    expect(by.earned).toMatchObject({ allowance_days: '14.00', taken_days: '2.00', pending_days: '0.00', available_days: '12.00' });
    expect(by.casual.available_days).toBe('4.00');
    expect(by.sick.available_days).toBe('6.00');
    expect(by.unpaid).toMatchObject({ tracks_balance: false, available_days: null });
    expect(r.body.requests).toHaveLength(1);
    expect(r.body.requests[0]).toMatchObject({ start_date: '2026-11-16', end_date: '2026-11-17', days: '2.00', hours: '16.00', status: 'Approved', leave_type: { name: 'Earned leave' } });
  });

  it("puts Karan's and Sneha's leave in Meera's approvals queue", async () => {
    const r = await f.call('P03', 'GET', '/approvals?type=leave');
    expect(r.status).toBe(200);
    expect(r.body.data.map((a: any) => a.submitter.name)).toEqual(['Karan Bhat', 'Sneha Pillai']);
    expect(r.body.data[0]).toMatchObject({ type: 'leave', period: { start: '2026-11-20', end: '2026-11-20' }, hours: '8.00', leave: { leave_type: { name: 'Earned leave' }, days: '1.00' } });
  });
});

describe('POST /leave-requests', () => {
  it('saves a pending request, routes it to the manager and holds the days as pending', async () => {
    const r = await request('P05', { leave_type_id: await typeId('earned'), start_date: '2027-03-01', end_date: '2027-03-03', reason: 'Family wedding', handover_note: 'Arjun has the WD set' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'Pending', days: '3.00', hours: '24.00', half_day: false, approver: { id: f.id('P02'), name: 'Vikram Nair' }, can_withdraw: true });
    const ar = (await f.owner.query('select type, record_type, record_id, approver_id, submitter_id, status from approval_request where id = $1', [r.body.approval_request_id])).rows[0];
    expect(ar).toEqual({ type: 'leave', record_type: 'leave_request', record_id: r.body.id, approver_id: f.id('P02'), submitter_id: f.id('P05'), status: 'Pending' });
    expect((await f.call('P02', 'GET', '/approvals?type=leave')).body.data.map((a: any) => a.id)).toContain(r.body.approval_request_id);
    expect(await balance('P05', 2027, 'earned')).toMatchObject({ allowance_days: '15.00', pending_days: '3.00', available_days: '12.00' });
    const ev = (await f.owner.query('select action, record_type from audit_event where id = $1', [r.body.audit_event_id])).rows[0];
    expect(ev).toEqual({ action: 'submit', record_type: 'leave_request' });
  });

  it('counts working days only, and half days as half', async () => {
    const r = await request('P08', { leave_type_id: 'casual', start_date: '2027-04-09', end_date: '2027-04-12', half_day: true });
    expect(r.status).toBe(200);
    // Fri 09 and Mon 12 April: two working days, halved.
    expect(r.body).toMatchObject({ days: '1.00', hours: '8.00', half_day: true });
  });

  it('validates the body (400)', async () => {
    const missing = await request('P05', {});
    expect(missing.status).toBe(400);
    expect(missing.body.error.details.map((d: any) => d.field).sort()).toEqual(['end_date', 'leave_type_id', 'start_date']);
    const earned = await typeId('earned');
    const cases: [Record<string, unknown>, string][] = [
      [{ leave_type_id: earned, start_date: '2027-13-01', end_date: '2027-13-02' }, 'start_date'],
      [{ leave_type_id: earned, start_date: '2027-05-05', end_date: '2027-05-04' }, 'end_date'],
      [{ leave_type_id: 'holiday', start_date: '2027-05-04', end_date: '2027-05-04' }, 'leave_type_id'],
      [{ leave_type_id: randomUUID(), start_date: '2027-05-04', end_date: '2027-05-04' }, 'leave_type_id'],
      [{ leave_type_id: earned, start_date: '2027-05-04', end_date: '2027-05-04', half_day: 'yes' }, 'half_day'],
      [{ leave_type_id: earned, start_date: '2027-05-04', end_date: '2027-05-04', reason: 'x'.repeat(2001) }, 'reason'],
    ];
    for (const [body, field] of cases) {
      const r = await request('P05', body);
      expect(r.status, field).toBe(400);
      expect(r.body.error.details[0].field).toBe(field);
    }
  });

  it('refuses dates with no working days, across the year end, and in the past (422)', async () => {
    const weekend = await request('P05', { leave_type_id: 'earned', start_date: '2027-05-08', end_date: '2027-05-09' });
    expect(weekend.status).toBe(422);
    expect(weekend.body.error.rule).toBe('LEAVE_NO_WORKING_DAYS');
    const years = await request('P05', { leave_type_id: 'earned', start_date: '2027-12-30', end_date: '2028-01-04' });
    expect(years.body.error.rule).toBe('LEAVE_YEAR');
    const past = await request('P05', { leave_type_id: 'earned', start_date: '2025-06-02', end_date: '2025-06-02' });
    expect(past.status).toBe(422);
    expect(past.body.error.rule).toBe('LEAVE_PAST');
  });

  it('refuses leave that overlaps pending or approved leave', async () => {
    const r = await request('P05', { leave_type_id: 'casual', start_date: '2027-03-03', end_date: '2027-03-04' });
    expect(r.status).toBe(422);
    expect(r.body.error.rule).toBe('LEAVE_OVERLAP');
    expect(r.body.error.details[0]).toMatchObject({ start_date: '2027-03-01', end_date: '2027-03-03', status: 'Pending' });
  });

  it('refuses more than the balance, except for unpaid leave', async () => {
    const over = await request('P09', { leave_type_id: 'sick', start_date: '2027-06-01', end_date: '2027-06-10' });
    expect(over.status).toBe(422);
    expect(over.body.error.rule).toBe('LEAVE_BALANCE');
    expect(over.body.error.message).toBe('You have 7.00 days of Sick leave left in 2027; this request needs 8.00.');
    const unpaid = await request('P09', { leave_type_id: 'unpaid', start_date: '2027-06-01', end_date: '2027-06-30' });
    expect(unpaid.status).toBe(200);
    expect(unpaid.body.days).toBe('22.00');
  });
});

describe('deciding leave in the approvals queue', () => {
  it('approve moves the days from pending to taken', async () => {
    const r = await request('P04', { leave_type_id: 'earned', start_date: '2027-02-01', end_date: '2027-02-02' });
    expect(r.status).toBe(200);
    const a = await f.call('P02', 'POST', `/approvals/${r.body.approval_request_id}/approve`);
    expect(a.status).toBe(200);
    expect((await leaveRow(r.body.id)).status).toBe('Approved');
    expect(await balance('P04', 2027, 'earned')).toMatchObject({ allowance_days: '15.00', taken_days: '2.00', pending_days: '0.00', available_days: '13.00' });
    const n = (await f.owner.query(`select 1 from notification where person_id = $1 and event_type = 'leave.approved'`, [f.id('P04')])).rowCount;
    expect(n).toBe(1);
  });

  it('return and reject free the days and record the reason', async () => {
    const r1 = await request('P08', { leave_type_id: 'earned', start_date: '2027-02-08', end_date: '2027-02-08' });
    const ret = await f.call('P02', 'POST', `/approvals/${r1.body.approval_request_id}/return`, { reason: 'Clashes with the client review' });
    expect(ret.status).toBe(200);
    expect(await leaveRow(r1.body.id)).toMatchObject({ status: 'Returned', decision_reason: 'Clashes with the client review' });
    const r2 = await request('P08', { leave_type_id: 'earned', start_date: '2027-02-08', end_date: '2027-02-08' });
    expect(r2.status).toBe(200);
    const rej = await f.call('P02', 'POST', `/approvals/${r2.body.approval_request_id}/reject`, { reason: 'Tender week' });
    expect(rej.status).toBe(200);
    expect((await leaveRow(r2.body.id)).status).toBe('Rejected');
    expect(await balance('P08', 2027, 'earned')).toMatchObject({ taken_days: '0.00', pending_days: '0.00', available_days: '15.00' });
    const noReason = await f.call('P02', 'POST', `/approvals/${r2.body.approval_request_id}/reject`, {});
    expect(noReason.status).toBe(400);
  });

  it('needs leave.approve: staff cannot decide leave, even when it is routed to them', async () => {
    const r = await request('P08', { leave_type_id: 'earned', start_date: '2027-02-15', end_date: '2027-02-15' });
    expect((await f.call('P04', 'POST', `/approvals/${r.body.approval_request_id}/approve`)).status).toBe(403);
    await f.owner.query('update approval_request set approver_id = $2 where id = $1', [r.body.approval_request_id, f.id('P04')]);
    const a = await f.call('P04', 'POST', `/approvals/${r.body.approval_request_id}/approve`);
    expect(a.status).toBe(403);
    expect(a.body.error).toMatchObject({ code: 'FORBIDDEN_CAPABILITY', capability: 'leave.approve' });
    expect((await leaveRow(r.body.id)).status).toBe('Pending');
  });

  it('a submitter cannot approve their own leave', async () => {
    const r = await request('P02', { leave_type_id: 'earned', start_date: '2027-02-22', end_date: '2027-02-22' });
    expect(r.body.approver.id).toBe(f.id('P01'));
    await f.owner.query('update approval_request set approver_id = submitter_id where id = $1', [r.body.approval_request_id]);
    const a = await f.call('P02', 'POST', `/approvals/${r.body.approval_request_id}/approve`);
    expect(a.status).toBe(403);
    expect(a.body.error.code).toBe('SELF_APPROVAL');
  });
});

describe('POST /leave-requests/:id/withdraw', () => {
  it('withdraws pending leave and its approval request', async () => {
    const r = await request('P06', { leave_type_id: 'earned', start_date: '2027-03-15', end_date: '2027-03-16' });
    const w = await f.call('P06', 'POST', `/leave-requests/${r.body.id}/withdraw`, {});
    expect(w.status).toBe(200);
    expect(w.body).toMatchObject({ status: 'Withdrawn', can_withdraw: false });
    expect((await f.owner.query('select status from approval_request where id = $1', [r.body.approval_request_id])).rows[0].status).toBe('Withdrawn');
    expect((await f.call('P03', 'GET', '/approvals?type=leave')).body.data.map((a: any) => a.id)).not.toContain(r.body.approval_request_id);
  });

  it('withdraws approved future leave and gives the days back', async () => {
    const r = await request('P06', { leave_type_id: 'earned', start_date: '2027-03-22', end_date: '2027-03-24' });
    expect((await f.call('P03', 'POST', `/approvals/${r.body.approval_request_id}/approve`)).status).toBe(200);
    expect((await balance('P06', 2027, 'earned')).taken_days).toBe('3.00');
    const w = await f.call('P06', 'POST', `/leave-requests/${r.body.id}/withdraw`, { reason: 'Trip cancelled' });
    expect(w.status).toBe(200);
    expect(await balance('P06', 2027, 'earned')).toMatchObject({ taken_days: '0.00', available_days: '15.00' });
    const again = await f.call('P06', 'POST', `/leave-requests/${r.body.id}/withdraw`, {});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_TRANSITION');
  });

  it("refuses someone else's request (403) and an unknown id (404)", async () => {
    const r = await request('P07', { leave_type_id: 'earned', start_date: '2027-03-29', end_date: '2027-03-29' });
    const other = await f.call('P06', 'POST', `/leave-requests/${r.body.id}/withdraw`, {});
    expect(other.status).toBe(403);
    expect(other.body.error).toMatchObject({ code: 'FORBIDDEN_CAPABILITY', capability: 'leave.request' });
    expect((await leaveRow(r.body.id)).status).toBe('Pending');
    expect((await f.call('P07', 'POST', `/leave-requests/${randomUUID()}/withdraw`, {})).status).toBe(404);
    expect((await f.call('P07', 'POST', '/leave-requests/not-an-id/withdraw', {})).status).toBe(404);
  });
});

describe('firm isolation', () => {
  it("another firm's leave types and requests are invisible", async () => {
    const other = (await f.owner.query(`insert into firm (legal_name, trading_name, timezone) values ('Other','Other','Asia/Kolkata') returning id`)).rows[0].id;
    const person = (await f.owner.query(
      `insert into person (firm_id, ref_code, name, work_email, job_title) values ($1,'P11','Outsider',$2,'Architect') returning id`, [other, `outsider-${randomUUID()}@other.test`],
    )).rows[0].id;
    const otherType = (await f.owner.query(`select id from leave_type where firm_id = $1 and key = 'earned'`, [other])).rows[0].id;
    const theirs = (await f.owner.query(
      `insert into leave_request (firm_id, person_id, leave_type_id, start_date, end_date, days) values ($1,$2,$3,'2027-07-01','2027-07-01',1) returning id`, [other, person, otherType],
    )).rows[0].id;

    const mine = await f.call('P01', 'GET', '/me/leave?year=2027');
    expect(mine.body.types).toHaveLength(4);
    expect(mine.body.types.map((t: any) => t.id)).not.toContain(otherType);
    const useTheirType = await request('P05', { leave_type_id: otherType, start_date: '2027-07-01', end_date: '2027-07-01' });
    expect(useTheirType.status).toBe(400);
    expect(useTheirType.body.error.details[0].field).toBe('leave_type_id');
    expect((await f.call('P01', 'POST', `/leave-requests/${theirs}/withdraw`, {})).status).toBe(404);
    expect((await leaveRow(theirs)).status).toBe('Pending');
  });
});
