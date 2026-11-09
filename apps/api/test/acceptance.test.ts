import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FENCED } from '../src/auth/redaction';
import { freshApp, type Fresh } from './helpers';

const WEEK = '2026-11-02';

function withApp() {
  const ctx = {} as { f: Fresh };
  beforeAll(async () => { ctx.f = await freshApp(); });
  afterAll(async () => { await ctx.f?.close(); });
  return ctx;
}
/** Every problem found in a response, as paths. A fenced key must hold exactly {restricted:true}. */
function fenceLeaks(v: unknown, path = '$'): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => fenceLeaks(x, `${path}[${i}]`));
  if (!v || typeof v !== 'object') return [];
  return Object.entries(v).flatMap(([k, val]) => {
    if (k in FENCED) return JSON.stringify(val) === '{"restricted":true}' ? [] : [`${path}.${k}`];
    return fenceLeaks(val, `${path}.${k}`);
  });
}
const phaseId = async (f: Fresh, code: string, phase: string) => (await f.owner.query('select ph.id from phase ph join project p on p.id = ph.project_id where p.code = $1 and ph.code = $2', [code, phase])).rows[0].id as string;
const karanEntry = async (f: Fresh) => (await f.owner.query(`select te.id from time_entry te join person p on p.id = te.person_id where p.ref_code = 'P06' and te.approval_state = 'Approved' and te.duration_hours = 6`)).rows[0].id as string;

describe('firm isolation (RLS through ams_app)', () => {
  const c = withApp();
  it('a second firm is invisible, and no firm set returns nothing', async () => {
    const { owner, appClient, firmId } = c.f;
    const other = (await owner.query(`insert into firm (legal_name, trading_name, timezone) values ('Other','Other','Asia/Kolkata') returning id`)).rows[0].id;
    await owner.query(`insert into client (firm_id, name) values ($1, 'Other firm client')`, [other]);
    const app = await appClient();
    try {
      expect((await app.query('select id from client')).rowCount).toBe(0);
      expect((await app.query('select id from person')).rowCount).toBe(0);
      expect((await app.query('select id from firm')).rowCount).toBe(0);
      await app.query('begin');
      await app.query(`select set_config('app.firm_id', $1, true)`, [firmId]);
      const seen = (await app.query('select name from client')).rows.map((r) => r.name);
      expect(seen.length).toBe(3);
      expect(seen).not.toContain('Other firm client');
      expect((await app.query('select id from firm')).rows.map((r) => r.id)).toEqual([firmId]);
      await expect(app.query(`insert into client (firm_id, name) values ($1, 'Smuggled')`, [other])).rejects.toThrow(/row-level security/);
      await app.query('rollback');
    } finally {
      await app.end();
    }
  });
});

describe('sessions', () => {
  const c = withApp();
  it('bad password and unknown email give an identical 401', async () => {
    const bad = await c.f.rawLogin('p01@meridian.demo', 'wrong-password');
    const unknown = await c.f.rawLogin('nobody@meridian.demo', 'wrong-password');
    expect(bad.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(bad.body).toBe(unknown.body);
  });
  it('no cookie is 401', async () => {
    const r = await c.f.app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(r.statusCode).toBe(401);
  });
  it('a revoked person gets 401 on the very next request and cannot log in', async () => {
    const { call, id, rawLogin } = c.f;
    expect((await call('P09', 'GET', '/me')).status).toBe(200);
    expect((await call('P01', 'POST', `/people/${id('P09')}/revoke-access`)).status).toBe(200);
    expect((await call('P09', 'GET', '/me')).status).toBe(401);
    expect((await rawLogin('p09@meridian.demo', 'meridian-demo-2026')).statusCode).toBe(401);
  });
  it('the last principal cannot be revoked', async () => {
    const { call, id } = c.f;
    const r = await call('P01', 'POST', `/people/${id('P01')}/revoke-access`);
    expect(r.status).toBe(422);
    expect((await call('P01', 'GET', '/me')).status).toBe(200);
  });
  it('logout ends the session', async () => {
    const { call } = c.f;
    expect((await call('P05', 'POST', '/auth/logout')).status).toBe(200);
    expect((await call('P05', 'GET', '/me')).status).toBe(401);
  });
});

describe('AT-02: no self-escalation', () => {
  const c = withApp();
  it('P10 self-grant and granting P04 finance are both 403, audited, and absent', async () => {
    const { call, id, owner } = c.f;
    const self = await call('P10', 'POST', `/people/${id('P10')}/grants`, { capability: 'rates.cost.view', reason: 'try' });
    expect(self.status).toBe(403);
    const other = await call('P10', 'POST', `/people/${id('P04')}/grants`, { permission_set: 'finance', reason: 'try' });
    expect(other.status).toBe(403);
    const audits = (await owner.query(`select record_id, action from audit_event where action = 'grant_refused' and actor_id = $1`, [id('P10')])).rows;
    expect(audits.map((a) => a.record_id).sort()).toEqual([id('P10'), id('P04')].sort());
    const self2 = await owner.query(`select 1 from permission_grant where person_id = $1 and capability = 'rates.cost.view'`, [id('P10')]);
    expect(self2.rowCount).toBe(0);
    const fin = await owner.query(`select 1 from permission_grant g join permission_set s on s.id = g.permission_set_id where g.person_id = $1 and s.key = 'finance'`, [id('P04')]);
    expect(fin.rowCount).toBe(0);
  });
  it('operations cannot grant a G capability to itself or others (principal only)', async () => {
    const { call, id, owner } = c.f;
    const self = await call('P10', 'POST', `/people/${id('P10')}/grants`, { capability: 'rates.bill.manage', scope_type: 'firm', reason: 'try' });
    expect(self.status).toBe(403);
    const other = await call('P10', 'POST', `/people/${id('P04')}/grants`, { capability: 'billing.prepare', scope_type: 'firm', reason: 'try' });
    expect(other.status).toBe(403);
    const rows = await owner.query(`select 1 from permission_grant where capability in ('rates.bill.manage','billing.prepare') and person_id = any($1)`, [[id('P10'), id('P04')]]);
    expect(rows.rowCount).toBe(0);
  });
  it('the database trigger refuses a sensitive self-grant', async () => {
    const { owner, firmId, id } = c.f;
    await expect(owner.query(
      `insert into permission_grant (firm_id, person_id, capability, scope_type, granted_by, reason, sensitive) values ($1,$2,'rates.cost.view','firm',$2,'direct',true)`,
      [firmId, id('P10')],
    )).rejects.toThrow(/self-grant/);
  });
  it('a principal can grant a sensitive capability to someone else', async () => {
    const { call, id } = c.f;
    const r = await call('P01', 'POST', `/people/${id('P03')}/grants`, { capability: 'margin.view', reason: 'Approved by partners' });
    expect(r.status).toBe(200);
    expect(r.body.audit_event_id).toBeTruthy();
  });
});

describe('AT-03: fenced values', () => {
  const c = withApp();
  it('walking every GET endpoint as P04 leaks no fenced value', async () => {
    const { call, id } = c.f;
    const urls = [
      '/me', '/people', `/people/${id('P04')}/rates`, `/people/${id('P05')}/rates`, '/projects', '/projects/PRJ-01', '/projects/PRJ-02', '/projects/PRJ-03', '/projects/PRJ-01/time', '/clients',
      `/me/time?period=${WEEK}`, '/timers/active', '/internal-categories', '/approvals', '/billing/ready', '/billing/drafts', '/billing/drafts/DRAFT-0012', '/billing/drafts/DRAFT-0012/accounting-status',
      '/billing/wip', '/receivables', '/receivables/ageing', '/integrations', '/integrations/jobs', '/notifications', '/audit',
    ];
    const statuses: Record<string, number> = {};
    for (const u of urls) {
      const r = await call('P04', 'GET', u);
      statuses[u] = r.status;
      expect([200, 403], `${u} gave ${r.status}`).toContain(r.status);
      expect(fenceLeaks(r.body), u).toEqual([]);
    }
    // The ones staff must not reach at all.
    for (const u of ['/billing/ready', '/billing/drafts', '/billing/wip', '/receivables', '/audit', '/integrations']) expect(statuses[u], u).toBe(403);
    // Member projects really are returned, so the fence was exercised.
    const p = await call('P04', 'GET', '/projects/PRJ-01');
    expect(p.status).toBe(200);
    expect(p.body.contribution).toEqual({ restricted: true });
    expect(p.body.labour_cost).toEqual({ restricted: true });
  });
  it('a PM sees contribution restricted; a principal sees it with complete:false and the gap listed', async () => {
    const { call } = c.f;
    const pm = await call('P03', 'GET', '/projects/PRJ-02');
    expect(pm.status).toBe(200);
    expect(pm.body.contribution).toEqual({ restricted: true });
    expect(fenceLeaks(pm.body)).toEqual([]);
    const pr = await call('P01', 'GET', '/projects/PRJ-02');
    expect(pr.body.contribution.complete).toBe(false);
    expect(pr.body.contribution.value.amount).toMatch(/^-?\d+\.\d{2}$/);
    expect(pr.body.contribution.missing.join(' ')).toContain('Nisha Kumar cost rate');
    expect(pr.body.labour_cost.complete).toBe(false);
  });
  it('a sensitive audit row reads restricted for an operations-only viewer', async () => {
    const { call, id, owner } = c.f;
    const rate = await call('P01', 'POST', '/rates', { person_id: id('P05'), rate_type: 'cost', amount: '700.00', effective_from: '2026-12-01', change_reason: 'Annual review' });
    expect(rate.status).toBe(200);
    // Farah without her finance set is operations only.
    await owner.query(`delete from permission_grant g using permission_set s where s.id = g.permission_set_id and g.person_id = $1 and s.key = 'finance'`, [id('P10')]);
    const ops = await call('P10', 'GET', '/audit?record_type=rate_schedule');
    expect(ops.status).toBe(200);
    const row = ops.body.data.find((r: any) => r.sensitive);
    expect(row).toBeTruthy();
    expect(row.new).toEqual({ restricted: true });
    expect(JSON.stringify(ops.body)).not.toContain('700.00');
    const principal = await call('P01', 'GET', '/audit?record_type=rate_schedule');
    expect(principal.body.data.find((r: any) => r.sensitive).new.amount).toBe('700.00');
  });
});

describe('AT-07: hours do not move delivery progress', () => {
  const c = withApp();
  it('Working drawings reads 200/170/60/230 and logging 50 h leaves progress alone', async () => {
    const { call, f } = { call: c.f.call, f: c.f };
    const wd = await phaseId(f, 'PRJ-01', 'WD');
    const before = (await call('P02', 'GET', '/projects/PRJ-01')).body;
    const row = before.phases.find((p: any) => p.code === 'WD');
    expect([row.budget_hours, row.actual_hours, row.etc_hours, row.forecast_hours]).toEqual(['200.00', '170.00', '60.00', '230.00']);
    expect(row.delivery_progress_pct).toBe(62);

    const next = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'];
    for (const d of next) expect((await call('P05', 'POST', '/time-entries', { service_date: d, duration_hours: 10, phase_id: wd })).status).toBe(200);
    const sub = await call('P05', 'POST', '/timesheets/2026-11-09/submit');
    expect(sub.status).toBe(200);
    const approve = await call('P02', 'POST', `/approvals/${sub.body.approval_request_ids[0]}/approve`);
    expect(approve.status).toBe(200);

    const after = (await call('P02', 'GET', '/projects/PRJ-01')).body;
    const row2 = after.phases.find((p: any) => p.code === 'WD');
    expect(row2.delivery_progress_pct).toBe(62);
    expect(after.delivery_progress_pct).toBe(before.delivery_progress_pct);
    expect(row2.actual_hours).toBe('220.00');
    expect(row2.etc_hours).toBe('60.00');
  });
});

describe('AT-10 and time entry rules', () => {
  const c = withApp();
  it('AC-F10-1: 6 h on an exhausted NTE is accepted; ready shows eligible 4000, excess 2000, 6 h retained', async () => {
    const { call, f } = { call: c.f.call, f: c.f };
    const as = await phaseId(f, 'PRJ-02', 'AS');
    const log = await call('P06', 'POST', '/time-entries', { service_date: '2026-11-03', duration_hours: 6, phase_id: as });
    expect(log.status).toBe(200);
    expect(log.body.approval_state).toBe('Draft');
    const ready = await call('P10', 'GET', '/billing/ready');
    expect(ready.status).toBe(200);
    const exc = ready.body.exceptions.find((e: any) => e.project.code === 'PRJ-02');
    expect(exc.eligible.amount).toBe('4000.00');
    expect(exc.excess.amount).toBe('2000.00');
    expect(exc.hours).toBe('6.00');
    const kept = (await f.owner.query('select duration_hours, approval_state from time_entry where id = $1', [await karanEntry(f)])).rows[0];
    expect(kept).toEqual({ duration_hours: '6.00', approval_state: 'Approved' });
  });
  it('AC-F10-2: an unclassified line blocks submit and is listed', async () => {
    const { call, owner, id } = c.f;
    const line = (await owner.query('select id from time_entry where person_id = $1 and phase_id is null and internal_category_id is null', [id('P08')])).rows[0].id;
    const r = await call('P08', 'POST', `/timesheets/${WEEK}/submit`);
    expect(r.status).toBe(422);
    expect(r.body.error.details).toEqual([{ line_id: line, code: 'unclassified' }]);
  });
  it('AC-F10-4: a second timer is 409', async () => {
    const { call, f } = { call: c.f.call, f: c.f };
    const wd = await phaseId(f, 'PRJ-01', 'WD');
    expect((await call('P05', 'POST', '/timers/start', { phase_id: wd })).status).toBe(200);
    const again = await call('P05', 'POST', '/timers/start', { phase_id: wd });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('TIMER_RUNNING');
    const stop = await call('P05', 'POST', '/timers/stop');
    expect(stop.status).toBe(200);
    expect(stop.body.time_entry_id).toBeTruthy();
  });
  it('more than 24 h in a day is 422', async () => {
    const { call, f } = { call: c.f.call, f: c.f };
    const wd = await phaseId(f, 'PRJ-01', 'WD');
    // P08 is on the PRJ-01 team; only team members can log time on a project.
    expect((await call('P08', 'POST', '/time-entries', { service_date: '2026-11-20', duration_hours: 20, phase_id: wd })).status).toBe(200);
    const r = await call('P08', 'POST', '/time-entries', { service_date: '2026-11-20', duration_hours: 5, phase_id: wd });
    expect(r.status).toBe(422);
    expect(r.body.error.details[0].code).toBe('over_24h');
  });
  it('Rohan shows 38.50 h with 12.50 h on Thursday', async () => {
    const r = await c.f.call('P04', 'GET', `/me/time?period=${WEEK}`);
    expect(r.status).toBe(200);
    expect(r.body.day_totals.reduce((a: number, b: number) => a + b, 0)).toBeCloseTo(38.5, 5);
    expect(r.body.day_totals[3]).toBe(12.5);
    expect(r.body.flags).toEqual([{ code: 'over_12h_day', date: '2026-11-05', hours: '12.50' }]);
  });
});

describe('AT-11: approvals', () => {
  const c = withApp();
  let requests: any[] = [];
  const reqFor = (code: string | null) => requests.find((r) => (code ? r.project?.code === code : !r.project));

  it("Rohan's submit makes one request per project, routed to each PM", async () => {
    const { call, id, owner } = c.f;
    const r = await call('P04', 'POST', `/timesheets/${WEEK}/submit`);
    expect(r.status).toBe(200);
    const rows = (await owner.query(`select id, approver_id, project_id from approval_request where id = any($1::uuid[])`, [r.body.approval_request_ids])).rows;
    expect(rows.length).toBe(3); // PRJ-01, PRJ-02 and internal time, each on its own line.
    const p2 = (await call('P02', 'GET', '/approvals')).body.data.filter((x: any) => x.submitter.name === 'Rohan Shetty');
    const p3 = (await call('P03', 'GET', '/approvals')).body.data.filter((x: any) => x.submitter.name === 'Rohan Shetty');
    requests = [...p2, ...p3];
    expect(p2.map((x: any) => x.project?.code ?? 'internal').sort()).toEqual(['PRJ-01', 'internal']);
    expect(p3.map((x: any) => x.project?.code)).toEqual(['PRJ-02']);
    expect(rows.find((x) => x.id === p3[0].id).approver_id).toBe(id('P03'));
    expect(reqFor('PRJ-01').exception_flags).toEqual(['over_12h_day']);
  });
  it("another person's approval is 403", async () => {
    const r = await c.f.call('P03', 'POST', `/approvals/${reqFor('PRJ-01').id}/approve`);
    expect(r.status).toBe(403);
  });
  it('approving one project leaves the sheet Partially approved, with rates stored at approval', async () => {
    const { call, owner, id } = c.f;
    const r = await call('P03', 'POST', `/approvals/${reqFor('PRJ-02').id}/approve`);
    expect(r.status).toBe(200);
    const ts = (await owner.query('select status from timesheet where person_id = $1 and period_start = $2', [id('P04'), WEEK])).rows[0];
    expect(ts.status).toBe('Partially approved');
    const lines = (await owner.query(`select te.bill_rate_schedule_id, te.cost_rate_schedule_id, te.approval_state from time_entry te join approval_request_entry x on x.time_entry_id = te.id where x.approval_request_id = $1`, [reqFor('PRJ-02').id])).rows;
    expect(lines.length).toBe(3);
    for (const l of lines) {
      expect(l.approval_state).toBe('Approved');
      expect(l.bill_rate_schedule_id).toBeTruthy();
      expect(l.cost_rate_schedule_id).toBeTruthy();
    }
  });
  it('approving twice is 409 with what is allowed', async () => {
    const r = await c.f.call('P03', 'POST', `/approvals/${reqFor('PRJ-02').id}/approve`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('INVALID_TRANSITION');
    expect(r.body.error.allowed).toEqual([]);
    expect(r.body.error.from).toBe('Approved');
  });
  it('batch approval skips the over-12h exception', async () => {
    const r = await c.f.call('P02', 'POST', '/approvals/batch-approve', { ids: [reqFor('PRJ-01').id, reqFor(null).id] });
    expect(r.status).toBe(200);
    expect(r.body.approved).toEqual([reqFor(null).id]);
    expect(r.body.skipped).toEqual([{ id: reqFor('PRJ-01').id, reason: 'over_12h_day' }]);
  });
  it('a single-line return needs a reason, and then leaves the rest pending', async () => {
    const { call, owner } = c.f;
    const rid = reqFor('PRJ-01').id;
    const lineId = reqFor('PRJ-01').lines[0].id;
    const none = await call('P02', 'POST', `/approvals/${rid}/return`, { time_entry_ids: [lineId] });
    expect(none.status).toBe(400);
    expect(none.body.error.details).toEqual([{ field: 'reason', code: 'required' }]);
    const ok = await call('P02', 'POST', `/approvals/${rid}/return`, { time_entry_ids: [lineId], reason: 'Wrong phase' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('Pending');
    const e = (await owner.query('select approval_state, return_reason from time_entry where id = $1', [lineId])).rows[0];
    expect(e).toEqual({ approval_state: 'Returned', return_reason: 'Wrong phase' });
  });
  it("a PM's own time routes to the principal", async () => {
    const { call, f, id } = { call: c.f.call, f: c.f, id: c.f.id };
    const wd = await phaseId(f, 'PRJ-01', 'WD');
    expect((await call('P02', 'POST', '/time-entries', { service_date: '2026-11-03', duration_hours: 8, phase_id: wd })).status).toBe(200);
    const s = await call('P02', 'POST', `/timesheets/${WEEK}/submit`);
    expect(s.status).toBe(200);
    const row = (await f.owner.query('select approver_id from approval_request where id = $1', [s.body.approval_request_ids[0]])).rows[0];
    expect(row.approver_id).toBe(id('P01'));
  });
  it('self-approval is 403 even when the request lands in your own queue', async () => {
    const { call, owner, id, f } = { call: c.f.call, owner: c.f.owner, id: c.f.id, f: c.f };
    const wd = await phaseId(f, 'PRJ-01', 'WD');
    expect((await call('P02', 'POST', '/time-entries', { service_date: '2026-11-16', duration_hours: 8, phase_id: wd })).status).toBe(200);
    const s = await call('P02', 'POST', '/timesheets/2026-11-16/submit');
    const rid = s.body.approval_request_ids[0];
    await owner.query('update approval_request set approver_id = $2 where id = $1', [rid, id('P02')]);
    const r = await call('P02', 'POST', `/approvals/${rid}/approve`);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('SELF_APPROVAL');
  });
});

describe('billing readiness', () => {
  const c = withApp();
  it('totals 4,86,000 from 80,000, 4,02,000 and 4,000', async () => {
    const r = await c.f.call('P10', 'GET', '/billing/ready');
    expect(r.status).toBe(200);
    expect(r.body.total).toEqual({ amount: '486000.00', currency: 'INR' });
    expect(r.body.data.map((i: any) => i.current_claim.amount).sort()).toEqual(['4000.00', '402000.00', '80000.00']);
  });
});

describe('AT-15: double billing', () => {
  const c = withApp();
  let winner: any;
  it('two concurrent drafts naming the same entry: one 200, one 409', async () => {
    const { call, f } = { call: c.f.call, f: c.f };
    const entry = await karanEntry(f);
    const body = { project: 'PRJ-02', cutoff_date: '2026-11-06', time_entry_ids: [entry] };
    await Promise.all([f.login('P10')]);
    const [a, b] = await Promise.all([call('P10', 'POST', '/billing/drafts', body), call('P10', 'POST', '/billing/drafts', body)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    winner = a.status === 200 ? a.body : b.body;
    expect(winner.total.amount).toBe('4000.00');
    const third = await call('P10', 'POST', '/billing/drafts', body);
    expect(third.status).toBe(409);
    expect(third.body.error.conflicting_draft_no).toBe(winner.draft_no);
  });
  it('a direct database insert is refused by source_allocation_live', async () => {
    const { owner, firmId, f } = { owner: c.f.owner, firmId: c.f.firmId, f: c.f };
    const line = (await owner.query('select id from billing_line where billing_draft_id = $1', [winner.id])).rows[0].id;
    await expect(owner.query(
      `insert into source_allocation (firm_id, billing_line_id, source_type, source_id, amount_claimed) values ($1,$2,'time_entry',$3,1)`,
      [firmId, line, await karanEntry(f)],
    )).rejects.toThrow(/source_allocation_live/);
  });
  it('a rejected draft releases its sources and can be redrafted', async () => {
    const { call, f } = { call: c.f.call, f: c.f };
    const entry = await karanEntry(f);
    const none = await call('P10', 'POST', `/billing/drafts/${winner.id}/reject`, {});
    expect(none.status).toBe(400);
    expect((await call('P10', 'POST', `/billing/drafts/${winner.id}/reject`, { reason: 'Wrong cutoff' })).status).toBe(200);
    const st = (await f.owner.query('select billing_state from time_entry where id = $1', [entry])).rows[0];
    expect(st.billing_state).toBe('Unbilled');
    const redraft = await call('P10', 'POST', '/billing/drafts', { project: 'PRJ-02', cutoff_date: '2026-11-06', time_entry_ids: [entry] });
    expect(redraft.status).toBe(200);
    expect(redraft.body.total.amount).toBe('4000.00');
    expect(redraft.body.id).not.toBe(winner.id);
  });
  it('an Idempotency-Key replay returns the same draft', async () => {
    const { call } = c.f;
    const h = { 'idempotency-key': 'replay-key-1' };
    const first = await call('P10', 'POST', '/billing/drafts', { project: 'PRJ-01', cutoff_date: '2026-11-06' }, h);
    expect(first.status).toBe(200);
    const second = await call('P10', 'POST', '/billing/drafts', { project: 'PRJ-01', cutoff_date: '2026-11-06' }, h);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.draft_no).toBe(first.body.draft_no);
  });
  it('an approved draft cannot be edited', async () => {
    const r = await c.f.call('P10', 'PUT', '/billing/drafts/DRAFT-0012', { cutoff_date: '2026-11-01' });
    expect(r.status).toBe(409);
  });
  it('finance cannot approve; the principal can', async () => {
    const { call } = c.f;
    const d = (await call('P10', 'GET', '/billing/drafts')).body.data.find((x: any) => x.approval_state === 'Draft');
    const rv = await call('P10', 'POST', `/billing/drafts/${d.id}/review`);
    expect(rv.status).toBe(200);
    const no = await call('P10', 'POST', `/approvals/${rv.body.approval_request_id}/approve`);
    expect(no.status).toBe(403);
    const yes = await call('P01', 'POST', `/approvals/${rv.body.approval_request_id}/approve`);
    expect(yes.status).toBe(200);
    expect((await call('P10', 'GET', `/billing/drafts/${d.id}`)).body.approval_state).toBe('Approved');
  });
  it('staff cannot draft', async () => {
    expect((await c.f.call('P04', 'POST', '/billing/drafts', { project: 'PRJ-01', cutoff_date: '2026-11-06' })).status).toBe(403);
  });
});

describe('AT-16: mock accounting and frozen invoices', () => {
  const c = withApp();
  let invoiceId = '';
  it('DRAFT-0012 totals 5,15,000; a timeout is Uncertain and a retry is refused', async () => {
    const { call } = c.f;
    const d = await call('P10', 'GET', '/billing/drafts/DRAFT-0012');
    expect(d.status).toBe(200);
    expect(d.body.total.amount).toBe('515000.00');
    const t = await call('P10', 'POST', '/billing/drafts/DRAFT-0012/submit', { simulate: 'timeout' });
    expect(t.status).toBe(200);
    expect(t.body.accounting_state).toBe('Uncertain');
    const retry = await call('P10', 'POST', '/billing/drafts/DRAFT-0012/submit', {});
    expect(retry.status).toBe(409);
    expect(retry.body.error.code).toBe('UNCERTAIN_RECONCILE_FIRST');
  });
  it('reconcile finalizes with exactly one invoice and one job', async () => {
    const { call, owner } = c.f;
    const r = await call('P10', 'POST', '/billing/drafts/DRAFT-0012/reconcile');
    expect(r.status).toBe(200);
    expect(r.body.accounting_state).toBe('Finalized');
    invoiceId = r.body.external_invoice.id;
    const draft = (await owner.query(`select id from billing_draft where draft_no = 'DRAFT-0012'`)).rows[0].id;
    expect((await owner.query('select id from external_invoice where billing_draft_id = $1', [draft])).rowCount).toBe(1);
    expect((await owner.query('select id, status from integration_job where record_id = $1', [draft])).rows.map((j) => j.status)).toEqual(['Succeeded']);
    expect((await call('P10', 'POST', '/billing/drafts/DRAFT-0012/submit', {})).status).toBe(409);
    expect((await call('P10', 'GET', '/integrations')).body.accounting.mode).toBe('MOCK');
  });
  it('a lost submission reconciles to Failed, and a retry then works', async () => {
    const { call, owner } = c.f;
    const made = await call('P10', 'POST', '/billing/drafts', { project: 'PRJ-01', cutoff_date: '2026-11-06' });
    expect(made.status).toBe(200);
    const rv = await call('P10', 'POST', `/billing/drafts/${made.body.id}/review`);
    expect((await call('P01', 'POST', `/approvals/${rv.body.approval_request_id}/approve`)).status).toBe(200);
    const t = await call('P10', 'POST', `/billing/drafts/${made.body.id}/submit`, { simulate: 'timeout_lost' });
    expect(t.body.accounting_state).toBe('Uncertain');
    const rec = await call('P10', 'POST', `/billing/drafts/${made.body.id}/reconcile`);
    expect(rec.status).toBe(200);
    expect(rec.body).toMatchObject({ accounting_state: 'Failed', found: false });
    const again = await call('P10', 'POST', `/billing/drafts/${made.body.id}/submit`, {});
    expect(again.status).toBe(200);
    expect(again.body.accounting_state).toBe('Finalized');
    expect((await owner.query('select id from external_invoice where billing_draft_id = $1', [made.body.id])).rowCount).toBe(1);
    expect((await owner.query('select attempts, status from integration_job where record_id = $1', [made.body.id])).rows).toEqual([{ attempts: 2, status: 'Succeeded' }]);
  });
  it('update and delete of a frozen invoice are rejected by the trigger', async () => {
    const { owner } = c.f;
    await expect(owner.query('update external_invoice set net = 1 where id = $1', [invoiceId])).rejects.toThrow();
    await expect(owner.query('delete from external_invoice where id = $1', [invoiceId])).rejects.toThrow();
  });
  it('renaming a project leaves the snapshot alone', async () => {
    const { owner } = c.f;
    await owner.query(`update project set name = 'Renamed Block' where code = 'PRJ-02'`);
    const s = (await owner.query('select snapshot from external_invoice where id = $1', [invoiceId])).rows[0].snapshot;
    expect(s.project.name).toBe('Orchard Commercial Block');
    expect(s.totals.net).toBe('515000.00');
    expect(s.lines.length).toBe(2);
  });
});

describe('AT-17: receivables', () => {
  const c = withApp();
  const inv = async () => (await c.f.owner.query(`select id from external_invoice where invoice_no = 'INV-DEMO-0007'`)).rows[0].id as string;
  it('over-settlement is 422', async () => {
    const r = await c.f.call('P10', 'POST', `/receivables/${await inv()}/settlements`, { kind: 'cash', amount: '160000.01', date: '2026-11-06' });
    expect(r.status).toBe(422);
  });
  it('a PM sees own projects only and cannot settle; staff are refused', async () => {
    const { call } = c.f;
    const own = await call('P02', 'GET', '/receivables');
    expect(own.status).toBe(200);
    expect(own.body.data.map((x: any) => x.invoice_no)).toEqual(['INV-DEMO-0007']);
    expect((await call('P03', 'GET', '/receivables')).body.data).toEqual([]);
    expect((await call('P02', 'POST', `/receivables/${await inv()}/settlements`, { kind: 'cash', amount: '1.00', date: '2026-11-06' })).status).toBe(403);
    expect((await call('P04', 'GET', '/receivables')).status).toBe(403);
    expect((await call('P04', 'POST', `/receivables/${await inv()}/settlements`, { kind: 'cash', amount: '1.00', date: '2026-11-06' })).status).toBe(403);
  });
  it('1,44,000 cash plus 16,000 withholding settles, with three separate figures', async () => {
    const { call } = c.f;
    const id = await inv();
    const one = await call('P10', 'POST', `/receivables/${id}/settlements`, { kind: 'cash', amount: '144000.00', date: '2026-11-06', reference: 'NEFT 1' });
    expect(one.status).toBe(200);
    expect(one.body.invoice.settlement_state).toBe('Part-paid');
    expect(one.body.invoice.outstanding.amount).toBe('16000.00');
    const two = await call('P10', 'POST', `/receivables/${id}/settlements`, { kind: 'withholding', amount: '16000.00', date: '2026-11-06', reference: 'TDS' });
    expect(two.status).toBe(200);
    const i = two.body.invoice;
    expect(i.settlement_state).toBe('Settled');
    expect(i.outstanding.amount).toBe('0.00');
    expect(i.cash.amount).toBe('144000.00');
    expect(i.withholding.amount).toBe('16000.00');
    expect(i.credits.amount).toBe('0.00');
    const age = await call('P10', 'GET', '/receivables/ageing');
    expect(age.body.total.amount).toBe('0.00');
  });
});

describe('AT-12: correcting a billed entry', () => {
  const c = withApp();
  it('keeps the billed original and sends a delta for approval', async () => {
    const { call, owner, f } = { call: c.f.call, owner: c.f.owner, f: c.f };
    const entry = await karanEntry(f);
    const made = await call('P10', 'POST', '/billing/drafts', { project: 'PRJ-02', cutoff_date: '2026-11-06', time_entry_ids: [entry] });
    expect(made.status).toBe(200);
    const rv = await call('P10', 'POST', `/billing/drafts/${made.body.id}/review`);
    expect((await call('P01', 'POST', `/approvals/${rv.body.approval_request_id}/approve`)).status).toBe(200);
    expect((await call('P10', 'POST', `/billing/drafts/${made.body.id}/submit`, {})).body.accounting_state).toBe('Finalized');

    const none = await call('P06', 'POST', `/time-entries/${entry}/correct`, { duration_hours: 4 });
    expect(none.status).toBe(400);

    const r = await call('P06', 'POST', `/time-entries/${entry}/correct`, { duration_hours: 4, reason: 'Two hours were on another job' });
    expect(r.status).toBe(200);
    expect(r.body.duration_hours).toBe('-2.00');
    const orig = (await owner.query('select approval_state, billing_state, duration_hours from time_entry where id = $1', [entry])).rows[0];
    expect(orig).toEqual({ approval_state: 'Amended', billing_state: 'Billed', duration_hours: '6.00' });
    const alloc = await owner.query(`select 1 from source_allocation where source_type = 'time_entry' and source_id = $1 and active`, [entry]);
    expect(alloc.rowCount).toBe(1);
    const delta = (await owner.query('select approval_state, duration_hours, correction_reason, corrected_from_id from time_entry where id = $1', [r.body.id])).rows[0];
    expect(delta).toEqual({ approval_state: 'Submitted', duration_hours: '-2.00', correction_reason: 'Two hours were on another job', corrected_from_id: entry });
  });
});

describe('AT-19: rate history', () => {
  const c = withApp();
  it('a future rate leaves stored ids alone; as_of returns the old rate; an overlap is 409', async () => {
    const { call, owner, id, f } = { call: c.f.call, owner: c.f.owner, id: c.f.id, f: c.f };
    const entry = await karanEntry(f);
    const stored = (await owner.query('select bill_rate_schedule_id from time_entry where id = $1', [entry])).rows[0].bill_rate_schedule_id;
    const up = await call('P01', 'POST', '/rates', { person_id: id('P06'), project_id: (await owner.query(`select id from project where code = 'PRJ-02'`)).rows[0].id, rate_type: 'bill', amount: '1500.00', effective_from: '2027-01-01', change_reason: 'New agreement' });
    expect(up.status).toBe(200);
    expect((await owner.query('select bill_rate_schedule_id from time_entry where id = $1', [entry])).rows[0].bill_rate_schedule_id).toBe(stored);

    const general = await call('P01', 'POST', '/rates', { person_id: id('P05'), rate_type: 'bill', amount: '2000.00', effective_from: '2027-01-01', change_reason: 'Annual review' });
    expect(general.status).toBe(200);
    const asOf = await call('P01', 'GET', `/people/${id('P05')}/rates?as_of=2026-11-06`);
    const bill = asOf.body.data.filter((r: any) => r.rate_type === 'bill');
    expect(bill.length).toBe(1);
    expect(bill[0].amount.amount).toBe('1600.00');

    const overlap = await call('P01', 'POST', '/rates', { person_id: id('P05'), rate_type: 'bill', amount: '2100.00', effective_from: '2027-01-01', change_reason: 'Again' });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.code).toBe('OVERLAPPING_VERSION');
  });
});

describe('audit and projects', () => {
  const c = withApp();
  it('the app role cannot rewrite history', async () => {
    const { appClient, firmId } = c.f;
    const app = await appClient();
    try {
      await app.query('begin');
      await app.query(`select set_config('app.firm_id', $1, true)`, [firmId]);
      await expect(app.query(`update audit_event set action = 'x'`)).rejects.toThrow(/permission denied/);
      await app.query('rollback');
      await app.query('begin');
      await app.query(`select set_config('app.firm_id', $1, true)`, [firmId]);
      await expect(app.query('delete from nte_ledger')).rejects.toThrow(/permission denied/);
      await app.query('rollback');
    } finally {
      await app.end();
    }
  });
  it('privileged actions wrote audit rows; project creation works and a duplicate code is 409', async () => {
    const { call, id, owner } = c.f;
    const clients = await call('P01', 'GET', '/clients');
    expect(clients.status).toBe(200);
    const body = { code: 'PRJ-99', name: 'Test Studio', client_id: clients.body.data[0].id, pm_id: id('P02'), billing_method: 'fixed_percent', contracted_amount: 500000, phases: [{ code: 'CD', name: 'Concept design', fee: 500000, budget_hours: 100 }] };
    const r = await call('P01', 'POST', '/projects', body);
    expect(r.status).toBe(200);
    const row = (await owner.query('select action, record_id, actor_id from audit_event where id = $1', [r.body.audit_event_id])).rows[0];
    expect(row).toEqual({ action: 'create', record_id: r.body.id, actor_id: id('P01') });
    const dup = await call('P01', 'POST', '/projects', body);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_CODE');
    const shown = await call('P01', 'GET', '/projects/PRJ-99');
    expect(shown.status).toBe(200);
    expect(shown.body.phases[0].budget_hours).toBe('100.00');
    expect((await call('P04', 'POST', '/projects', { ...body, code: 'PRJ-98' })).status).toBe(403);
  });
});
