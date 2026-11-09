import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshApp, type Fresh } from './helpers';

/**
 * Who approves when the usual approver is the submitter: a PM's own time in a one-principal studio used to come back
 * to the PM and sit there for ever. Routing now never returns the submitter while anyone else can approve; a sole
 * principal approves their own work (audited as self_approval_override); anyone else gets 422 NO_APPROVER.
 * The studio can name a fallback approver in Settings, Approvals (GET/PUT /firm/approvals-settings).
 */

const approverOf = async (f: Fresh, requestId: string) => (await f.owner.query('select approver_id from approval_request where id = $1', [requestId])).rows[0].approver_id as string;
const phaseOf = async (f: Fresh, code: string, phase: string) => (await f.call('P01', 'GET', `/projects/${code}`)).body.phases.find((p: any) => p.code === phase).id as string;
const category = async (f: Fresh) => (await f.owner.query('select id from internal_work_category order by key limit 1')).rows[0].id as string;

async function makeProject(f: Fresh, code: string, pm: string, principal: string) {
  const clientId = (await f.call('P01', 'GET', '/clients')).body.data[0].id;
  const r = await f.call('P01', 'POST', '/projects', {
    code, name: `Routing ${code}`, client_id: clientId, pm_id: f.id(pm), principal_id: f.id(principal), billing_method: 'hourly',
    phases: [{ code: 'CD', name: 'Concept design' }],
  });
  expect(r.status).toBe(200);
  return phaseOf(f, code, 'CD');
}
/** Logs one line in the week of `monday` and submits it; returns the submit response. */
async function logAndSubmit(f: Fresh, ref: string, monday: string, line: { phase_id?: string; internal_category_id?: string }) {
  expect((await f.call(ref, 'POST', '/time-entries', { service_date: monday, duration_hours: 4, ...line })).status).toBe(200);
  return f.call(ref, 'POST', `/timesheets/${monday}/submit`);
}
const grantPrincipal = async (f: Fresh, ref: string) => {
  const set = (await f.owner.query(`select id from permission_set where key = 'principal'`)).rows[0].id;
  await f.owner.query(`insert into permission_grant (firm_id, person_id, permission_set_id, granted_by, reason) values ($1,$2,$3,$4,'Test')`, [f.firmId, f.id(ref), set, f.id('P01')]);
};

describe('a one-principal studio', () => {
  let f: Fresh;
  beforeAll(async () => { f = await freshApp(); });
  afterAll(async () => { await f?.close(); });

  it("routes the sole principal's own PM time back to them, and they approve it with a self_approval_override audit", async () => {
    // The seed names P01 as the fallback approver: that is the submitter here, so it is skipped.
    const cd = await makeProject(f, 'PRJ-70', 'P01', 'P01');
    const s = await logAndSubmit(f, 'P01', '2026-09-07', { phase_id: cd });
    expect(s.status).toBe(200);
    const rid = s.body.approval_request_ids[0];
    expect(await approverOf(f, rid)).toBe(f.id('P01'));

    const queue = (await f.call('P01', 'GET', '/approvals')).body.data.find((a: any) => a.id === rid);
    expect(queue.self_approval).toBe(true);

    const r = await f.call('P01', 'POST', `/approvals/${rid}/approve`);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('Approved');
    const events = (await f.owner.query(`select action, reason, actor_id from audit_event where record_type = 'approval_request' and record_id = $1 order by created_at`, [rid])).rows;
    expect(events.map((e) => e.action)).toEqual(['self_approval_override', 'approve']);
    expect(events[0]).toMatchObject({ reason: 'Self-approved: no other approver in the studio', actor_id: f.id('P01') });
  });

  it("routes the sole principal's internal time the same way", async () => {
    const s = await logAndSubmit(f, 'P01', '2026-09-14', { internal_category_id: await category(f) });
    expect(s.status).toBe(200);
    const rid = s.body.approval_request_ids[0];
    expect(await approverOf(f, rid)).toBe(f.id('P01'));
    expect((await f.call('P01', 'POST', `/approvals/${rid}/approve`)).status).toBe(200);
  });

  it('a non-principal never gets their own work back: a routed-to-self request is still SELF_APPROVAL', async () => {
    const cd = await makeProject(f, 'PRJ-71', 'P02', 'P01');
    const s = await logAndSubmit(f, 'P02', '2026-09-21', { phase_id: cd });
    const rid = s.body.approval_request_ids[0];
    expect(await approverOf(f, rid)).toBe(f.id('P01'));
    await f.owner.query('update approval_request set approver_id = submitter_id where id = $1', [rid]);
    const r = await f.call('P02', 'POST', `/approvals/${rid}/approve`);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('SELF_APPROVAL');
  });
});

describe('a studio with another principal', () => {
  let f: Fresh;
  beforeAll(async () => {
    f = await freshApp();
    await grantPrincipal(f, 'P03');
  });
  afterAll(async () => { await f?.close(); });

  it("routes a principal's own PM time to the other principal, who approves it without any override", async () => {
    const cd = await makeProject(f, 'PRJ-72', 'P01', 'P01');
    const s = await logAndSubmit(f, 'P01', '2026-09-07', { phase_id: cd });
    expect(s.status).toBe(200);
    const rid = s.body.approval_request_ids[0];
    expect(await approverOf(f, rid)).toBe(f.id('P03'));
    expect((await f.call('P01', 'GET', '/approvals')).body.data.some((a: any) => a.id === rid)).toBe(false);
    const queued = (await f.call('P03', 'GET', '/approvals')).body.data.find((a: any) => a.id === rid);
    expect(queued.self_approval).toBe(false);
    expect((await f.call('P01', 'POST', `/approvals/${rid}/approve`)).status).toBe(403);
    expect((await f.call('P03', 'POST', `/approvals/${rid}/approve`)).status).toBe(200);
    const overrides = await f.owner.query(`select 1 from audit_event where action = 'self_approval_override' and record_id = $1`, [rid]);
    expect(overrides.rowCount).toBe(0);
  });
});

describe('the fallback approver setting', () => {
  let f: Fresh;
  beforeAll(async () => { f = await freshApp(); });
  afterAll(async () => { await f?.close(); });

  it('lists the current fallback and only active people who hold time.approve', async () => {
    const r = await f.call('P01', 'GET', '/firm/approvals-settings');
    expect(r.status).toBe(200);
    expect(r.body.fallback_approver).toMatchObject({ id: f.id('P01'), name: 'Asha Rao' });
    expect(r.body.fallback_approver_eligible).toBe(true);
    expect(r.body.allow_self_approval).toBe(false);
    const refs = r.body.candidates.map((p: any) => p.ref_code).sort();
    expect(refs).toEqual(['P01', 'P02', 'P03']);
  });

  it('needs firm.settings.manage to read or change it', async () => {
    for (const ref of ['P02', 'P04', 'P10']) {
      const g = await f.call(ref, 'GET', '/firm/approvals-settings');
      expect(g.status).toBe(403);
      expect(g.body.error.capability).toBe('firm.settings.manage');
      const p = await f.call(ref, 'PUT', '/firm/approvals-settings', { fallback_approver_id: f.id('P03') });
      expect(p.status).toBe(403);
    }
    expect((await f.owner.query('select fallback_approver_id from firm')).rows[0].fallback_approver_id).toBe(f.id('P01'));
  });

  it('validates the body and refuses someone who cannot approve time', async () => {
    const missing = await f.call('P01', 'PUT', '/firm/approvals-settings', {});
    expect(missing.status).toBe(400);
    expect(missing.body.error.details).toEqual([{ field: 'fallback_approver_id', code: 'required' }]);
    const bad = await f.call('P01', 'PUT', '/firm/approvals-settings', { fallback_approver_id: 'P03' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION');
    // Staff, and operations/finance without an explicit time.approve grant, cannot approve time.
    for (const ref of ['P04', 'P10']) {
      const r = await f.call('P01', 'PUT', '/firm/approvals-settings', { fallback_approver_id: f.id(ref) });
      expect(r.status).toBe(422);
      expect(r.body.error.rule).toBe('FALLBACK_APPROVER_ELIGIBLE');
    }
    // Someone who has left the studio is refused too.
    await f.owner.query(`update person set employment_state = 'Ended' where id = $1`, [f.id('P03')]);
    expect((await f.call('P01', 'PUT', '/firm/approvals-settings', { fallback_approver_id: f.id('P03') })).status).toBe(422);
    await f.owner.query(`update person set employment_state = 'Active' where id = $1`, [f.id('P03')]);
    const unknown = await f.call('P01', 'PUT', '/firm/approvals-settings', { fallback_approver_id: '00000000-0000-4000-8000-000000000000' });
    expect(unknown.status).toBe(422);
    expect((await f.owner.query('select fallback_approver_id from firm')).rows[0].fallback_approver_id).toBe(f.id('P01'));
  });

  it('saves a fallback with an audit row, and routing then uses it for the sole principal', async () => {
    const r = await f.call('P01', 'PUT', '/firm/approvals-settings', { fallback_approver_id: f.id('P03') });
    expect(r.status).toBe(200);
    expect(r.body.fallback_approver).toMatchObject({ id: f.id('P03'), name: 'Meera Iyer' });
    const ev = (await f.owner.query('select action, previous, new from audit_event where id = $1', [r.body.audit_event_id])).rows[0];
    expect(ev).toEqual({ action: 'approvals_settings.update', previous: { fallback_approver_id: f.id('P01') }, new: { fallback_approver_id: f.id('P03') } });

    const cd = await makeProject(f, 'PRJ-73', 'P01', 'P01');
    const s = await logAndSubmit(f, 'P01', '2026-09-07', { phase_id: cd });
    const rid = s.body.approval_request_ids[0];
    expect(await approverOf(f, rid)).toBe(f.id('P03'));
    expect((await f.call('P03', 'POST', `/approvals/${rid}/approve`)).status).toBe(200);
  });

  it('can be cleared with null', async () => {
    const r = await f.call('P01', 'PUT', '/firm/approvals-settings', { fallback_approver_id: null });
    expect(r.status).toBe(200);
    expect(r.body.fallback_approver).toBeNull();
    expect((await f.owner.query('select fallback_approver_id from firm')).rows[0].fallback_approver_id).toBeNull();
  });
});

describe('nobody can approve', () => {
  let f: Fresh;
  beforeAll(async () => { f = await freshApp(); });
  afterAll(async () => { await f?.close(); });

  it("gives a non-principal a clear 422 and saves nothing, for project and internal time", async () => {
    // P02 leads PRJ-74; its principal (the only one) then leaves and the fallback is cleared: nobody but P02 could approve.
    const cd = await makeProject(f, 'PRJ-74', 'P02', 'P01');
    await f.owner.query('update firm set fallback_approver_id = null');
    await f.owner.query(`update person set employment_state = 'Ended' where id = $1`, [f.id('P01')]);

    const s = await logAndSubmit(f, 'P02', '2026-09-07', { phase_id: cd });
    expect(s.status).toBe(422);
    expect(s.body.error).toMatchObject({ code: 'RULE_VIOLATION', rule: 'NO_APPROVER' });
    expect(s.body.error.message).toMatch(/Ask a principal to set a fallback approver in Settings, Approvals/);
    expect((await f.owner.query('select count(*)::int n from approval_request where submitter_id = $1', [f.id('P02')])).rows[0].n).toBe(0);

    const i = await logAndSubmit(f, 'P02', '2026-09-14', { internal_category_id: await category(f) });
    expect(i.status).toBe(422);
    expect(i.body.error.rule).toBe('NO_APPROVER');
  });
});

describe('the routed approver must hold the capability', () => {
  let f: Fresh;
  beforeAll(async () => { f = await freshApp(); });
  afterAll(async () => { await f?.close(); });

  it('refuses approve and return from an approver without time.approve', async () => {
    // P05's internal time is set to go to P04, a staff member who cannot approve time.
    await f.owner.query('update person set internal_time_approver_id = $2 where id = $1', [f.id('P05'), f.id('P04')]);
    const s = await logAndSubmit(f, 'P05', '2026-09-07', { internal_category_id: await category(f) });
    expect(s.status).toBe(200);
    const rid = s.body.approval_request_ids[0];
    expect(await approverOf(f, rid)).toBe(f.id('P04'));

    const a = await f.call('P04', 'POST', `/approvals/${rid}/approve`);
    expect(a.status).toBe(403);
    expect(a.body.error).toMatchObject({ code: 'FORBIDDEN_CAPABILITY', capability: 'time.approve' });
    const r = await f.call('P04', 'POST', `/approvals/${rid}/return`, { reason: 'Not mine' });
    expect(r.status).toBe(403);
    expect(r.body.error.capability).toBe('time.approve');
    const b = await f.call('P04', 'POST', '/approvals/batch-approve', { ids: [rid] });
    expect(b.body.approved).toEqual([]);
    expect((await f.owner.query('select status from approval_request where id = $1', [rid])).rows[0].status).toBe('Pending');
  });
});
