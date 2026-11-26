import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshApp, type Fresh } from './helpers';

// The five high-severity findings of the November 2026 audit, each pinned by the scenario that broke it.
let f: Fresh;
beforeAll(async () => { f = await freshApp(); });
afterAll(async () => { await f?.close(); });

const phaseId = async (code: string, phase: string) => (await f.owner.query(
  'select ph.id from phase ph join project p on p.id = ph.project_id where p.code = $1 and ph.code = $2', [code, phase],
)).rows[0].id as string;
const loginState = async (ref: string) => (await f.owner.query('select login_state from person where id = $1', [f.id(ref)])).rows[0].login_state;

describe('revoke-access follows the same rules as deactivate', () => {
  it('an Admin cannot lock out a principal, even with a second (invited, never accepted) principal on file', async () => {
    // P02 becomes a principal who was invited but never accepted: the old check counted them as "another principal".
    await f.owner.query(`insert into permission_grant (firm_id, person_id, permission_set_id, granted_by, reason, sensitive)
      select $1, $2, id, $3, 'test', false from permission_set where key = 'principal'`, [f.firmId, f.id('P02'), f.id('P01')]);
    await f.owner.query(`update person set invitation_state = 'Sent' where id = $1`, [f.id('P02')]);
    const before = (await f.owner.query(`select count(*)::int n from audit_event where action = 'grant_refused' and record_id = $1`, [f.id('P01')])).rows[0].n;

    const r = await f.call('P10', 'POST', `/people/${f.id('P01')}/revoke-access`);
    expect(r.status).toBe(422); // the last accepted principal keeps access, whoever asks
    expect(await loginState('P01')).toBe('Enabled');

    // A sensitive non-principal account (finance) is refused for an Admin, and the refusal is audited.
    await f.owner.query(`insert into permission_grant (firm_id, person_id, permission_set_id, granted_by, reason, sensitive)
      select $1, $2, id, $3, 'test', false from permission_set where key = 'finance'`, [f.firmId, f.id('P07'), f.id('P01')]);
    const fin = await f.call('P10', 'POST', `/people/${f.id('P07')}/revoke-access`);
    expect(fin.status).toBe(403);
    expect(fin.body.error.capability).toBe('permissions.grant.sensitive');
    expect(await loginState('P07')).toBe('Enabled');
    expect((await f.owner.query(`select count(*)::int n from audit_event where action = 'grant_refused' and record_id = $1`, [f.id('P07')])).rows[0].n).toBe(1);
    expect((await f.owner.query(`select count(*)::int n from audit_event where action = 'grant_refused' and record_id = $1`, [f.id('P01')])).rows[0].n).toBe(before);
  });

  it('an Admin can still revoke an ordinary account; open invite and reset links stop working', async () => {
    await f.owner.query(`insert into password_reset_token (firm_id, person_id, token_hash, expires_at, created_by) values ($1,$2,'h-test', now() + interval '1 day', $3)`, [f.firmId, f.id('P09'), f.id('P01')]);
    expect((await f.call('P10', 'POST', `/people/${f.id('P09')}/revoke-access`)).status).toBe(200);
    expect(await loginState('P09')).toBe('Revoked');
    expect((await f.owner.query(`select count(*)::int n from password_reset_token where person_id = $1 and revoked_at is null and used_at is null`, [f.id('P09')])).rows[0].n).toBe(0);
  });

  it('nobody can reactivate their own account (the request used to hang on its own row lock)', async () => {
    const r = await f.call('P10', 'POST', `/accounts/${f.id('P10')}/reactivate`, { reason: 'x' });
    expect(r.status).toBe(422);
  });

  it('nobody can revoke their own access', async () => {
    const r = await f.call('P10', 'POST', `/people/${f.id('P10')}/revoke-access`);
    expect(r.status).toBe(422);
    expect(await loginState('P10')).toBe('Enabled');
  });
});

describe('a correction is the corrected total for the work, so correcting a correction never bills twice', () => {
  const sumCounted = async (rootId: string) => Number((await f.owner.query(
    `with recursive down as (select * from time_entry where id = $1 union select t.* from time_entry t join down on t.corrected_from_id = down.id)
     select coalesce(sum(duration_hours),0) v from down where approval_state <> 'Amended' or billing_state = 'Billed'`, [rootId],
  )).rows[0].v);
  const approve = (id: string, billed = false) => f.owner.query(
    `update time_entry set approval_state = 'Approved', billing_state = $2 where id = $1`, [id, billed ? 'Billed' : 'Unbilled'],
  );

  it('6 h billed, corrected to 4, then that correction (unbilled) corrected to 3: the work nets 3 h', async () => {
    const wd = await phaseId('PRJ-01', 'WD');
    const e1 = (await f.call('P05', 'POST', '/time-entries', { service_date: '2026-10-05', duration_hours: 6, phase_id: wd })).body.id;
    await approve(e1, true);
    const c1 = await f.call('P05', 'POST', `/time-entries/${e1}/correct`, { duration_hours: 4, reason: 'Two hours were on another job' });
    expect(c1.status, JSON.stringify(c1.body)).toBe(200);
    expect(c1.body.duration_hours).toBe('-2.00');
    await approve(c1.body.id);
    const c2 = await f.call('P05', 'POST', `/time-entries/${c1.body.id}/correct`, { duration_hours: 3, reason: 'One more hour was on another job' });
    expect(c2.status, JSON.stringify(c2.body)).toBe(200);
    expect(c2.body.duration_hours).toBe('-3.00'); // was +3.00: the client would have been billed 9 h
    expect(await sumCounted(e1)).toBe(3);
  });

  it('the same when the first correction was already billed as a credit', async () => {
    const wd = await phaseId('PRJ-01', 'WD');
    const e1 = (await f.call('P05', 'POST', '/time-entries', { service_date: '2026-10-06', duration_hours: 6, phase_id: wd })).body.id;
    await approve(e1, true);
    const c1 = await f.call('P05', 'POST', `/time-entries/${e1}/correct`, { duration_hours: 4, reason: 'Overstated' });
    await approve(c1.body.id, true);
    const c2 = await f.call('P05', 'POST', `/time-entries/${c1.body.id}/correct`, { duration_hours: 3, reason: 'Overstated again' });
    expect(c2.status, JSON.stringify(c2.body)).toBe(200);
    expect(c2.body.duration_hours).toBe('-1.00'); // was +5.00
    expect(await sumCounted(e1)).toBe(3);
  });

  it('a plain unbilled correction still replaces the hours, and the same total is refused', async () => {
    const wd = await phaseId('PRJ-01', 'WD');
    const e1 = (await f.call('P05', 'POST', '/time-entries', { service_date: '2026-10-07', duration_hours: 6, phase_id: wd })).body.id;
    await approve(e1);
    expect((await f.call('P05', 'POST', `/time-entries/${e1}/correct`, { duration_hours: 0, reason: 'x' })).status).toBe(422);
    const c1 = await f.call('P05', 'POST', `/time-entries/${e1}/correct`, { duration_hours: 5, reason: 'Overstated' });
    expect(c1.body.duration_hours).toBe('5.00');
    await approve(c1.body.id);
    expect((await f.call('P05', 'POST', `/time-entries/${c1.body.id}/correct`, { duration_hours: 5, reason: 'Same' })).status).toBe(422);
    expect(await sumCounted(e1)).toBe(5);
  });
  it('undoing an unbilled correction of billed hours retires it without a zero-hour entry', async () => {
    const wd = await phaseId('PRJ-01', 'WD');
    const e1 = (await f.call('P05', 'POST', '/time-entries', { service_date: '2026-10-08', duration_hours: 6, phase_id: wd })).body.id;
    await approve(e1, true);
    const c1 = await f.call('P05', 'POST', `/time-entries/${e1}/correct`, { duration_hours: 4, reason: 'Overstated' });
    await approve(c1.body.id);
    const back = await f.call('P05', 'POST', `/time-entries/${c1.body.id}/correct`, { duration_hours: 6, reason: 'The 6 h was right' });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body.id).toBeNull();
    expect(await sumCounted(e1)).toBe(6);
    expect((await f.owner.query('select approval_state from time_entry where id = $1', [c1.body.id])).rows[0].approval_state).toBe('Amended');
  });
});

describe('returned hours can be cleared from the grid', () => {
  it('setting a returned cell to 0 removes the hours (was a 500) and keeps the return on record', async () => {
    const wd = await phaseId('PRJ-01', 'WD');
    const entry = (await f.call('P05', 'POST', '/time-entries', { service_date: '2026-10-12', duration_hours: 3, phase_id: wd })).body.id;
    const sub = await f.call('P05', 'POST', '/timesheets/2026-10-12/submit');
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    const rid = sub.body.approval_request_ids[0];
    const approver = (await f.owner.query('select p.ref_code from approval_request r join person p on p.id = r.approver_id where r.id = $1', [rid])).rows[0].ref_code;
    expect((await f.call(approver, 'POST', `/approvals/${rid}/return`, { time_entry_ids: [entry], reason: 'Not on this project' })).status).toBe(200);

    const cleared = await f.call('P05', 'PUT', '/me/time/cell', { service_date: '2026-10-12', duration_hours: 0, phase_id: wd });
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
    expect((await f.owner.query('select count(*)::int n from time_entry where id = $1', [entry])).rows[0].n).toBe(0);
    expect((await f.owner.query('select count(*)::int n from approval_request where id = $1', [rid])).rows[0].n).toBe(1);
    expect((await f.owner.query(`select count(*)::int n from audit_event where action = 'remove_returned' and record_id = $1`, [entry])).rows[0].n).toBe(1);
    const week = await f.call('P05', 'GET', '/me/time?period=2026-10-12');
    expect(week.body.status).not.toBe('Returned');
  });

  it('withdrawing a returned correction puts the approved hours back; it cannot be rewritten in the grid', async () => {
    const wd = await phaseId('PRJ-01', 'WD');
    const e1 = (await f.call('P05', 'POST', '/time-entries', { service_date: '2026-10-19', duration_hours: 6, phase_id: wd })).body.id;
    await f.owner.query(`update time_entry set approval_state = 'Approved' where id = $1`, [e1]);
    const c = await f.call('P05', 'POST', `/time-entries/${e1}/correct`, { duration_hours: 4, reason: 'Overstated' });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    const approver = (await f.owner.query('select p.ref_code from approval_request r join person p on p.id = r.approver_id where r.id = $1', [c.body.approval_request_id])).rows[0].ref_code;
    expect((await f.call(approver, 'POST', `/approvals/${c.body.approval_request_id}/return`, { time_entry_ids: [c.body.id], reason: 'Check again' })).status).toBe(200);

    const typed = await f.call('P05', 'PUT', '/me/time/cell', { service_date: '2026-10-19', duration_hours: 5, phase_id: wd });
    expect(typed.status).toBe(409);
    expect(typed.body.error.code).toBe('RETURNED_CORRECTION');

    expect((await f.call('P05', 'PUT', '/me/time/cell', { service_date: '2026-10-19', duration_hours: 0, phase_id: wd })).status).toBe(200);
    expect((await f.owner.query('select approval_state, duration_hours from time_entry where id = $1', [e1])).rows[0]).toEqual({ approval_state: 'Approved', duration_hours: '6.00' });
  });
});

describe('real studios never get fake invoices', () => {
  it('a studio with no accounting system gets no invented invoice: the draft waits for the real one', async () => {
    expect((await f.call('P10', 'PUT', '/integrations/accounting', { adapter: 'bogus' })).status).toBe(400);
    expect((await f.call('P10', 'PUT', '/integrations/accounting', { adapter: 'none' })).status).toBe(200);
    expect((await f.call('P10', 'GET', '/integrations')).body.accounting.mode).toBe('NONE');
    const r = await f.call('P10', 'POST', '/billing/drafts/DRAFT-0012/submit', {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.accounting_state).toBe('Pending');
    expect(r.body.message).toMatch(/nothing was sent/);
    expect((await f.owner.query(`select accounting_state from billing_draft where draft_no = 'DRAFT-0012'`)).rows[0].accounting_state).toBe('Pending');
    expect((await f.owner.query(`select count(*)::int n from external_invoice where invoice_no like 'INV-MOCK%'`)).rows[0].n).toBe(0);
    expect((await f.owner.query(`select count(*)::int n from integration_job`)).rows[0].n).toBe(0);
  });

  it('a new studio defaults to no accounting system, and the mock is refused in production', async () => {
    expect((await f.owner.query(`select column_default from information_schema.columns where table_name = 'firm' and column_name = 'accounting_adapter'`)).rows[0].column_default).toContain('none');
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect((await f.call('P10', 'PUT', '/integrations/accounting', { adapter: 'mock' })).status).toBe(400);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
