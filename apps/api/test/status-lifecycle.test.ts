import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshApp, type Fresh } from './helpers';

/**
 * Project and phase status (contract: status-contract.md). Demo studio: Asha (P01) principal; Vikram (P02) PM of PRJ-01
 * and PRJ-03; Meera (P03) PM of PRJ-02; Rohan (P04) and Divya (P05) staff; Farah (P10) operations + finance with no
 * projects.create grant. Projects made here are hourly, PM P02, with Rohan on the team. as_of=2026-11-06 for health.
 */
const AS_OF = '2026-11-06';
const MIGRATION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../packages/db/migrations/014_phase_status_backfill.sql');
let f: Fresh;
let clientId: string;
beforeAll(async () => {
  f = await freshApp();
  clientId = (await f.call('P01', 'GET', '/clients')).body.data[0].id;
});
afterAll(async () => { await f?.close(); });

type PhaseIn = Record<string, unknown> & { code: string; name: string };
const body = (code: string, phases: PhaseIn[], extra: Record<string, unknown> = {}) => ({
  code, name: `Status ${code}`, client_id: clientId, pm_id: f.id('P02'), billing_method: 'hourly',
  members: [{ person_id: f.id('P04'), role: 'contributor' }], phases, ...extra,
});
async function newProject(code: string, phases: PhaseIn[] = [{ code: 'CD', name: 'Concept design' }, { code: 'SD', name: 'Schematic design' }]) {
  const r = await f.call('P01', 'POST', '/projects', body(code, phases));
  if (r.status !== 200) throw new Error(`create ${code}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.id as string;
}
const view = async (code: string, ref = 'P01') => (await f.call(ref, 'GET', `/projects/${code}`)).body;
const phaseOf = async (code: string, phase: string) => (await view(code)).phases.find((p: any) => p.code === phase);
const auditRow = async (id: string) => (await f.owner.query('select record_type, record_id, action, previous, new, reason from audit_event where id = $1', [id])).rows[0];
const phaseAudits = async (phaseId: string) => (await f.owner.query(
  `select previous, new, reason from audit_event where record_type = 'phase' and record_id = $1 and action = 'update' order by created_at`, [phaseId],
)).rows;
const setStatus = (ref: string, code: string, status: string, reason?: string) => f.call(ref, 'PUT', `/projects/${code}/status`, reason === undefined ? { status } : { status, reason });
const editPhase = (ref: string, id: string, payload: Record<string, unknown>) => f.call(ref, 'PUT', `/phases/${id}`, payload);
const health = async (code: string) => (await f.call('P01', 'GET', `/projects/health?as_of=${AS_OF}`)).body.data.find((x: any) => x.code === code);
const signal = (h: any, key: string) => h.health.signals.find((s: any) => s.key === key);
const endedPerson = async () => (await f.owner.query(
  `insert into person (firm_id, ref_code, name, work_email, job_title, employment_state) values ($1,$3,'Left Studio',$2,'Architect','Ended') returning id`,
  [f.firmId, `left-${randomUUID()}@meridian.demo`, `X${randomUUID().slice(0, 6)}`],
)).rows[0].id as string;

describe('GET /projects/:code: phase fields and permissions', () => {
  it('every phase carries owner, status, dates and budget; the project carries status, hold_reason and permissions', async () => {
    const p = await view('PRJ-01', 'P02');
    const cd = p.phases.find((x: any) => x.code === 'CD');
    expect(cd).toMatchObject({ status: 'In progress', start_date: '2026-02-02', end_date: '2026-11-27', budget_hours: '140.00', owner: { id: f.id('P04'), ref_code: 'P04', name: 'Rohan Shetty' } });
    expect(Object.keys(cd).sort()).toEqual(['actual_hours', 'budget_hours', 'delivery_progress_pct', 'end_date', 'etc_hours', 'fee', 'forecast_hours', 'id', 'code', 'name', 'owner', 'start_date', 'status'].sort());
    expect(Object.keys(cd.owner).sort()).toEqual(['id', 'name', 'ref_code']);
    expect(Object.keys(p).sort()).toEqual(['client', 'client_id', 'code', 'contract', 'contribution', 'delivery_progress_pct', 'entitlement', 'hold_reason', 'hours', 'id', 'labour_cost', 'name', 'permissions', 'phases', 'pm', 'status'].sort());
    expect(p).toMatchObject({ status: 'Active', hold_reason: null });
    expect(p.permissions).toEqual({ edit_phases: true, change_status: true, archive: false });
    expect((await view('PRJ-03', 'P02'))).toMatchObject({ status: 'On hold', hold_reason: 'Client funding, allocations retained' });
  });

  it('permissions follow the viewer: principal all, staff and operations without a grant none', async () => {
    expect((await view('PRJ-01', 'P01')).permissions).toEqual({ edit_phases: true, change_status: true, archive: true });
    expect((await view('PRJ-01', 'P04')).permissions).toEqual({ edit_phases: false, change_status: false, archive: false });
    expect((await view('PRJ-01', 'P10')).permissions).toEqual({ edit_phases: false, change_status: false, archive: false });
    expect((await view('PRJ-02', 'P01')).permissions).toEqual({ edit_phases: true, change_status: true, archive: true });
  });

  it('a phase made without dates, owner or budget reads null for each (also in GET /projects)', async () => {
    await newProject('PRJ-40', [{ code: 'CD', name: 'Concept design' }]);
    const ph = (await view('PRJ-40')).phases[0];
    expect(ph).toMatchObject({ start_date: null, end_date: null, owner: null, budget_hours: null, status: 'Not started' });
    const listed = (await f.call('P02', 'GET', '/projects')).body.data.find((x: any) => x.code === 'PRJ-40');
    expect(listed.phases[0]).toMatchObject({ start_date: null, end_date: null, owner: null, budget_hours: null, status: 'Not started' });
    expect(listed.permissions).toEqual({ edit_phases: true, change_status: true, archive: false });
    expect(listed).toMatchObject({ status: 'Active', hold_reason: null });
  });
});

describe('POST /projects: per-phase dates, hours budget and owner', () => {
  it('stores them', async () => {
    await newProject('PRJ-41', [
      { code: 'CD', name: 'Concept design', start_date: '2026-12-01', end_date: '2027-01-29', budget_hours: 120, owner_id: f.id('P04') },
      { code: 'SD', name: 'Schematic design', start_date: '', end_date: null, budget_hours: '' },
    ]);
    const [cd, sd] = (await view('PRJ-41')).phases;
    expect(cd).toMatchObject({ start_date: '2026-12-01', end_date: '2027-01-29', budget_hours: '120.00', owner: { id: f.id('P04'), ref_code: 'P04' } });
    expect(sd).toMatchObject({ start_date: null, end_date: null, budget_hours: null, owner: null });
  });

  it('refuses one date without the other, start after end, a bad date, a negative budget and an unknown or inactive owner', async () => {
    const ended = await endedPerson();
    const cases: [PhaseIn, string, string][] = [
      [{ code: 'CD', name: 'C', start_date: '2026-12-01' }, 'phases[0].end_date', 'required'],
      [{ code: 'CD', name: 'C', end_date: '2026-12-01' }, 'phases[0].start_date', 'required'],
      [{ code: 'CD', name: 'C', start_date: '2027-01-02', end_date: '2027-01-01' }, 'phases[0].start_date', 'order'],
      [{ code: 'CD', name: 'C', start_date: '2027-13-40', end_date: '2027-12-01' }, 'phases[0].start_date', 'date'],
      [{ code: 'CD', name: 'C', budget_hours: -1 }, 'phases[0].budget_hours', 'range'],
      [{ code: 'CD', name: 'C', budget_hours: 'lots' }, 'phases[0].budget_hours', 'number'],
      [{ code: 'CD', name: 'C', owner_id: randomUUID() }, 'phases[0].owner_id', 'unknown'],
      [{ code: 'CD', name: 'C', owner_id: ended }, 'phases[0].owner_id', 'unknown'],
    ];
    for (const [ph, field, code] of cases) {
      const r = await f.call('P01', 'POST', '/projects', body('PRJ-42', [ph]));
      expect(r.status, JSON.stringify(ph)).toBe(400);
      expect(r.body.error.details[0]).toEqual({ field, code });
    }
    // The second phase is checked too, and nothing is written when one fails.
    const r = await f.call('P01', 'POST', '/projects', body('PRJ-42', [{ code: 'CD', name: 'C' }, { code: 'SD', name: 'S', budget_hours: -5 }]));
    expect(r.body.error.details[0]).toEqual({ field: 'phases[1].budget_hours', code: 'range' });
    expect((await f.owner.query(`select 1 from project where code = 'PRJ-42'`)).rowCount).toBe(0);
  });
});

describe('PUT /projects/:code/status', () => {
  let id: string;
  beforeAll(async () => { id = await newProject('PRJ-60'); });
  const notes = async () => (await f.owner.query(
    `select pe.ref_code, n.event_type, n.text from notification n join person pe on pe.id = n.person_id where n.record_type = 'project' and n.record_id = $1 order by n.created_at, pe.ref_code`, [id],
  )).rows;

  it('validates the target and the reason', async () => {
    for (const status of ['Draft', 'Paused', '', null, 3]) {
      const r = await f.call('P02', 'PUT', '/projects/PRJ-60/status', { status, reason: 'x' });
      expect(r.status).toBe(400);
      expect(r.body.error.details[0]).toEqual({ field: 'status', code: 'enum' });
    }
    for (const reason of [undefined, '', '   ', 7]) {
      const r = await setStatus('P02', 'PRJ-60', 'On hold', reason as any);
      expect(r.status).toBe(400);
      expect(r.body.error.details[0]).toEqual({ field: 'reason', code: 'required' });
    }
    const long = await setStatus('P02', 'PRJ-60', 'On hold', 'x'.repeat(501));
    expect(long.body.error.details[0]).toEqual({ field: 'reason', code: 'length' });
    expect((await setStatus('P01', 'PRJ-60', 'Archived')).body.error.details[0]).toEqual({ field: 'reason', code: 'required' });
    expect((await setStatus('P01', 'PRJ-99X', 'Active')).status).toBe(404);
  });

  it('role checks: staff 403, the PM on another project 403, operations cannot archive, the PM cannot archive their own', async () => {
    expect((await setStatus('P04', 'PRJ-60', 'On hold', 'Waiting')).status).toBe(403);
    expect((await setStatus('P03', 'PRJ-60', 'On hold', 'Waiting')).status).toBe(403);
    expect((await setStatus('P10', 'PRJ-60', 'On hold', 'Waiting')).status).toBe(403);
    const ops = await setStatus('P10', 'PRJ-60', 'Archived', 'Done');
    expect(ops.status).toBe(403);
    expect(ops.body.error.capability).toBe('projects.create');
    const pm = await setStatus('P02', 'PRJ-60', 'Archived', 'Done');
    expect(pm.status).toBe(403);
    expect(pm.body.error.capability).toBe('projects.create');
    expect((await view('PRJ-60')).status).toBe('Active');
  });

  it('the PM puts their project on hold with a reason: stored, audited, and the team (not the actor) told once', async () => {
    const r = await setStatus('P02', 'PRJ-60', 'On hold', '  Client funding paused  ');
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['audit_event_id', 'hold_reason', 'status']);
    expect(r.body).toMatchObject({ status: 'On hold', hold_reason: 'Client funding paused' });
    expect(await auditRow(r.body.audit_event_id)).toEqual({
      record_type: 'project', record_id: id, action: 'change_status',
      previous: { status: 'Active', hold_reason: null }, new: { status: 'On hold', hold_reason: 'Client funding paused' }, reason: 'Client funding paused',
    });
    expect(await view('PRJ-60')).toMatchObject({ status: 'On hold', hold_reason: 'Client funding paused' });
    expect(await notes()).toEqual([{ ref_code: 'P04', event_type: 'project_status_changed', text: 'Vikram Nair put PRJ-60 Status PRJ-60 on hold: Client funding paused' }]);
  });

  it('resume clears hold_reason; delivery complete; a move the machine does not allow is 409 with what is allowed', async () => {
    const resume = await setStatus('P02', 'PRJ-60', 'Active');
    expect(resume.body).toMatchObject({ status: 'Active', hold_reason: null });
    expect((await auditRow(resume.body.audit_event_id)).previous).toEqual({ status: 'On hold', hold_reason: 'Client funding paused' });
    expect((await setStatus('P02', 'PRJ-60', 'Active')).body.error).toMatchObject({ code: 'INVALID_TRANSITION', from: 'Active' });
    const done = await setStatus('P01', 'PRJ-60', 'Delivery complete', 'Handed over');
    expect(done.body).toMatchObject({ status: 'Delivery complete', hold_reason: null });
    expect((await auditRow(done.body.audit_event_id)).reason).toBe('Handed over');
    const bad = await setStatus('P02', 'PRJ-60', 'On hold', 'Again');
    expect(bad.status).toBe(409);
    expect(bad.body.error).toMatchObject({ code: 'INVALID_TRANSITION', from: 'Delivery complete', allowed: ['Active', 'Archived'] });
    // The principal acted: the PM and the team member are each told once, the principal not at all.
    const told = (await notes()).filter((n) => n.text.includes('delivery complete'));
    expect(told.map((n) => n.ref_code)).toEqual(['P02', 'P04']);
  });

  it('archive needs projects.create and a reason; leaving Archived needs it too; restore goes back to Active', async () => {
    const a = await setStatus('P01', 'PRJ-60', 'Archived', 'Closed out');
    expect(a.body).toMatchObject({ status: 'Archived', hold_reason: null });
    expect(await auditRow(a.body.audit_event_id)).toMatchObject({ previous: { status: 'Delivery complete', hold_reason: null }, new: { status: 'Archived', hold_reason: null }, reason: 'Closed out' });
    const pmRestore = await setStatus('P02', 'PRJ-60', 'Active');
    expect(pmRestore.status).toBe(403);
    expect(pmRestore.body.error.capability).toBe('projects.create');
    const odd = await setStatus('P01', 'PRJ-60', 'On hold', 'x');
    expect(odd.body.error).toMatchObject({ code: 'INVALID_TRANSITION', allowed: ['Active'] });
    const restore = await setStatus('P01', 'PRJ-60', 'Active');
    expect(restore.body).toMatchObject({ status: 'Active', hold_reason: null });
    expect((await notes()).at(-1)).toMatchObject({ text: 'Asha Rao restored PRJ-60 Status PRJ-60.' });
  });
});

describe('PUT /phases/:id', () => {
  let cd: string; let sd: string;
  beforeAll(async () => {
    await newProject('PRJ-61', [{ code: 'CD', name: 'Concept design' }, { code: 'SD', name: 'Schematic design', budget_hours: 50, owner_id: f.id('P04') }]);
    const p = await view('PRJ-61');
    cd = p.phases[0].id; sd = p.phases[1].id;
  });

  it('role checks and 404s: staff 403, another PM 403, unknown or malformed id 404', async () => {
    expect((await editPhase('P04', cd, { name: 'X' })).status).toBe(403);
    expect((await editPhase('P03', cd, { name: 'X' })).status).toBe(403);
    expect((await editPhase('P10', cd, { name: 'X' })).status).toBe(403);
    expect((await editPhase('P02', randomUUID(), { name: 'X' })).status).toBe(404);
    expect((await editPhase('P02', 'not-a-uuid', { name: 'X' })).status).toBe(404);
    expect((await phaseOf('PRJ-61', 'CD')).name).toBe('Concept design');
    // The principal may edit any project's phase.
    expect((await editPhase('P01', cd, {})).status).toBe(200);
  });

  it('status via the machine: Complete sets delivery to 100; reopening keeps progress; returns the GET shape', async () => {
    const r = await editPhase('P02', cd, { status: 'Complete', reason: 'Issued' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual(await phaseOf('PRJ-61', 'CD'));
    expect(r.body).toMatchObject({ status: 'Complete', delivery_progress_pct: 100 });
    const [row] = await phaseAudits(cd);
    expect(row).toEqual({ previous: { status: 'Not started', delivery_progress_pct: 0 }, new: { status: 'Complete', delivery_progress_pct: 100 }, reason: 'Issued' });
    const back = await editPhase('P02', cd, { status: 'In progress' });
    expect(back.body).toMatchObject({ status: 'In progress', delivery_progress_pct: 100 });
    expect((await phaseAudits(cd)).at(-1)).toEqual({ previous: { status: 'Complete' }, new: { status: 'In progress' }, reason: null });
    const same = await editPhase('P02', cd, { status: 'In progress' });
    expect(same.status).toBe(409);
    expect(same.body.error).toMatchObject({ code: 'INVALID_TRANSITION', from: 'In progress', allowed: ['Not started', 'Complete', 'Cancelled'] });
    expect((await editPhase('P02', cd, { status: 'Done' })).body.error.details[0]).toEqual({ field: 'status', code: 'enum' });
  });

  it('owner: an active person or null; unknown and inactive people are 400', async () => {
    const r = await editPhase('P02', cd, { owner_id: f.id('P05') });
    expect(r.body.owner).toEqual({ id: f.id('P05'), ref_code: 'P05', name: 'Divya Menon' });
    expect((await phaseAudits(cd)).at(-1)).toMatchObject({ previous: { owner_id: null }, new: { owner_id: f.id('P05') } });
    expect((await editPhase('P02', cd, { owner_id: randomUUID() })).body.error.details[0]).toEqual({ field: 'owner_id', code: 'unknown' });
    expect((await editPhase('P02', cd, { owner_id: await endedPerson() })).body.error.details[0]).toEqual({ field: 'owner_id', code: 'unknown' });
    expect((await editPhase('P02', cd, { owner_id: null })).body.owner).toBeNull();
  });

  it('budget_hours sets, updates and removes the line on the approved budget, and every reader follows', async () => {
    const lines = async (phase: string) => (await f.owner.query(
      `select bl.hours from budget_line bl join budget_version bv on bv.id = bl.budget_version_id where bl.phase_id = $1 and bv.status = 'Approved'`, [phase],
    )).rows.map((x) => x.hours);
    const add = await editPhase('P02', cd, { budget_hours: 80 });
    expect(add.body.budget_hours).toBe('80.00');
    expect(await lines(cd)).toEqual(['80.00']);
    expect((await phaseAudits(cd)).at(-1)).toMatchObject({ previous: { budget_hours: null }, new: { budget_hours: '80.00' } });
    const upd = await editPhase('P02', sd, { budget_hours: '90.5' });
    expect(upd.body.budget_hours).toBe('90.50');
    expect(await lines(sd)).toEqual(['90.50']);
    const p = await view('PRJ-61');
    expect(p.hours.budget).toBe('170.50');
    const sched = (await f.call('P01', 'GET', `/projects/PRJ-61/schedule?as_of=${AS_OF}`)).body;
    expect(sched.hours.budget).toBe('170.50');
    expect(sched.phases.find((x: any) => x.id === sd).budget_hours).toBe('90.50');
    expect((await health('PRJ-61')).hours.budget).toBe('170.50');
    const gone = await editPhase('P02', cd, { budget_hours: null });
    expect(gone.body.budget_hours).toBeNull();
    expect(await lines(cd)).toEqual([]);
    for (const [v, code] of [[-1, 'range'], [100001, 'range'], ['abc', 'number']] as const) {
      expect((await editPhase('P02', cd, { budget_hours: v })).body.error.details[0]).toEqual({ field: 'budget_hours', code });
    }
  });

  it('name is trimmed, 1 to 120 characters; one audit row lists only the changed fields', async () => {
    const before = (await phaseAudits(sd)).length;
    const r = await editPhase('P02', sd, { name: '  Scheme design  ', owner_id: f.id('P04'), budget_hours: 90.5, reason: 'Renamed for the client' });
    expect(r.body.name).toBe('Scheme design');
    const rows = await phaseAudits(sd);
    expect(rows.length).toBe(before + 1);
    expect(rows.at(-1)).toEqual({ previous: { name: 'Schematic design' }, new: { name: 'Scheme design' }, reason: 'Renamed for the client' });
    expect((await editPhase('P02', sd, { name: '   ' })).body.error.details[0]).toEqual({ field: 'name', code: 'required' });
    expect((await editPhase('P02', sd, { name: 'x'.repeat(121) })).body.error.details[0]).toEqual({ field: 'name', code: 'length' });
    // Nothing changed: no audit row.
    await editPhase('P02', sd, { name: 'Scheme design' });
    expect((await phaseAudits(sd)).length).toBe(before + 1);
  });

  it('an archived project is restored before its phases change (409 PROJECT_CLOSED)', async () => {
    expect((await setStatus('P01', 'PRJ-61', 'Archived', 'Parked')).status).toBe(200);
    const r = await editPhase('P02', cd, { name: 'Late change' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: 'PROJECT_CLOSED', message: 'Restore the project before changing it.' });
    expect((await setStatus('P01', 'PRJ-61', 'Active')).status).toBe(200);
    expect((await editPhase('P02', cd, { name: 'Late change' })).status).toBe(200);
  });
});

describe('PUT /phases/:id/progress keeps status in step and validates ETC', () => {
  let a: string; let b: string;
  beforeAll(async () => {
    await newProject('PRJ-62', [{ code: 'A', name: 'Alpha' }, { code: 'B', name: 'Beta' }]);
    const p = await view('PRJ-62');
    a = p.phases[0].id; b = p.phases[1].id;
  });
  const progress = (id: string, payload: Record<string, unknown>) => f.call('P02', 'PUT', `/phases/${id}/progress`, payload);
  const statusOf = async (id: string) => (await f.owner.query('select status, delivery_progress_pct, etc_hours from phase where id = $1', [id])).rows[0];

  it('progress above 0 starts a Not started phase, 100 completes it, below 100 reopens it', async () => {
    expect((await progress(a, { delivery_progress_pct: 40 })).status).toBe(200);
    expect((await statusOf(a)).status).toBe('In progress');
    const done = await progress(a, { delivery_progress_pct: 100, etc_hours: 0 });
    expect((await statusOf(a)).status).toBe('Complete');
    expect(await auditRow(done.body.audit_event_id)).toMatchObject({ action: 'update_progress', previous: { status: 'In progress' }, new: { status: 'Complete' } });
    await progress(a, { delivery_progress_pct: 90 });
    expect((await statusOf(a)).status).toBe('In progress');
    // Reopened at 100 through PUT /phases/:id: saving the same 100 with a new ETC does not complete it again.
    await progress(a, { delivery_progress_pct: 100 });
    await editPhase('P02', a, { status: 'In progress' });
    await progress(a, { delivery_progress_pct: 100, etc_hours: 5 });
    expect(await statusOf(a)).toMatchObject({ status: 'In progress', delivery_progress_pct: '100.00', etc_hours: '5.00' });
  });

  it('a Cancelled phase stays Cancelled at 100; ETC-only saves leave status alone', async () => {
    await editPhase('P02', b, { status: 'Cancelled' });
    await progress(b, { delivery_progress_pct: 100 });
    expect((await statusOf(b)).status).toBe('Cancelled');
    await editPhase('P02', b, { status: 'Not started' });
    await progress(b, { etc_hours: 12 });
    expect(await statusOf(b)).toMatchObject({ status: 'Not started', etc_hours: '12.00' });
  });

  it('etc_hours is a number from 0; delivery 0 to 100', async () => {
    for (const [v, code] of [[-1, 'range'], [100001, 'range'], ['abc', 'number']] as const) {
      const r = await progress(b, { etc_hours: v });
      expect(r.status).toBe(400);
      expect(r.body.error.details[0]).toEqual({ field: 'etc_hours', code });
    }
    expect((await progress(b, { delivery_progress_pct: 101 })).status).toBe(400);
    expect((await progress(b, { delivery_progress_pct: 'half' })).status).toBe(400);
    expect((await f.call('P04', 'PUT', `/phases/${b}/progress`, { etc_hours: 1 })).status).toBe(403);
  });
});

describe('time on closed work', () => {
  let open: string; let cancelled: string; let other: string; let archivedPhase: string;
  beforeAll(async () => {
    await newProject('PRJ-63', [{ code: 'A', name: 'Alpha' }, { code: 'B', name: 'Beta' }, { code: 'C', name: 'Gamma' }]);
    const p = await view('PRJ-63');
    [open, cancelled, other] = p.phases.map((x: any) => x.id);
    await newProject('PRJ-64', [{ code: 'A', name: 'Alpha' }]);
    archivedPhase = (await view('PRJ-64')).phases[0].id;
  });
  const log = (date: string, phase: string, h = 2) => f.call('P04', 'POST', '/time-entries', { service_date: date, duration_hours: h, phase_id: phase });
  const cell = (date: string, phase: string, h: number) => f.call('P04', 'PUT', '/me/time/cell', { service_date: date, duration_hours: h, phase_id: phase });

  it('an archived project refuses new time with 422 PROJECT_CLOSED (entries, grid cells, timers)', async () => {
    expect((await setStatus('P01', 'PRJ-64', 'Archived', 'Closed')).status).toBe(200);
    const r = await log('2026-08-03', archivedPhase);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('PROJECT_CLOSED');
    expect(r.body.error.message).toBe('PRJ-64 is archived. Time can no longer be logged on it.');
    expect((await cell('2026-08-03', archivedPhase, 3)).body.error.code).toBe('PROJECT_CLOSED');
    expect((await f.call('P04', 'POST', '/timers/start', { phase_id: archivedPhase })).body.error.code).toBe('PROJECT_CLOSED');
  });

  it('a cancelled phase refuses new and increased time with 422 PHASE_CANCELLED; lowering, clearing and corrections still work', async () => {
    // Time logged before the phase was cancelled: one draft, one approved.
    expect((await cell('2026-08-10', cancelled, 4)).status).toBe(200);
    expect((await log('2026-08-17', cancelled, 3)).status).toBe(200);
    const sub = await f.call('P04', 'POST', '/timesheets/2026-08-17/submit');
    expect(sub.status).toBe(200);
    expect((await f.call('P02', 'POST', `/approvals/${sub.body.approval_request_ids[0]}/approve`)).status).toBe(200);
    const approved = (await f.owner.query(`select id from time_entry where phase_id = $1 and approval_state = 'Approved'`, [cancelled])).rows[0].id;

    expect((await editPhase('P02', cancelled, { status: 'Cancelled' })).status).toBe(200);
    const r = await log('2026-08-11', cancelled);
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({ code: 'PHASE_CANCELLED', message: 'Beta on PRJ-63 is cancelled. Time can no longer be logged on it.' });
    expect((await cell('2026-08-12', cancelled, 2)).body.error.code).toBe('PHASE_CANCELLED');
    expect((await cell('2026-08-10', cancelled, 5)).body.error.code).toBe('PHASE_CANCELLED');
    expect((await f.call('P04', 'POST', '/timers/start', { phase_id: cancelled })).body.error.code).toBe('PHASE_CANCELLED');
    expect((await cell('2026-08-10', cancelled, 3)).status).toBe(200);
    expect((await cell('2026-08-10', cancelled, 3)).status).toBe(200);
    expect((await cell('2026-08-10', cancelled, 0)).status).toBe(200);
    const fix = await f.call('P04', 'POST', `/time-entries/${approved}/correct`, { duration_hours: 2, reason: 'Fewer hours' });
    expect(fix.status).toBe(200);
  });

  it('moving an entry onto a cancelled phase is refused; edits on its own phase are not', async () => {
    const e = await log('2026-08-24', open);
    expect(e.status).toBe(200);
    const move = await f.call('P04', 'PUT', `/time-entries/${e.body.id}`, { phase_id: cancelled });
    expect(move.status).toBe(422);
    expect(move.body.error.code).toBe('PHASE_CANCELLED');
    const toArchived = await f.call('P04', 'PUT', `/time-entries/${e.body.id}`, { phase_id: archivedPhase });
    expect(toArchived.status).toBe(422);
    expect(toArchived.body.error).toMatchObject({ code: 'PROJECT_CLOSED', rule: 'PROJECT_CLOSED' });
    expect((await f.call('P04', 'PUT', `/time-entries/${e.body.id}`, { phase_id: open, note: 'Same phase' })).status).toBe(200);
    expect((await f.call('P04', 'PUT', `/time-entries/${e.body.id}`, { phase_id: other })).status).toBe(200);
  });

  it('a running timer can still be stopped after its phase is cancelled', async () => {
    const start = await f.call('P04', 'POST', '/timers/start', { phase_id: other });
    expect(start.status).toBe(200);
    expect((await editPhase('P02', other, { status: 'Cancelled' })).status).toBe(200);
    const stop = await f.call('P04', 'POST', '/timers/stop', {});
    expect(stop.status).toBe(200);
    expect(stop.body.time_entry_id).toBeTruthy();
  });

  it('On hold projects and Complete phases still take time', async () => {
    const dd = (await view('PRJ-03')).phases.find((x: any) => x.code === 'DD').id;
    expect((await f.call('P02', 'POST', '/time-entries', { service_date: '2026-08-04', duration_hours: 1, phase_id: dd })).status).toBe(200);
    const sd = (await view('PRJ-01')).phases.find((x: any) => x.code === 'SD');
    expect(sd.status).toBe('Complete');
    expect((await log('2026-08-05', sd.id, 1)).status).toBe(200);
  });
});

describe('Health and overview with closed phases and paused projects', () => {
  const past = (code: string) => [
    { code: 'CD', name: 'Concept design', start_date: '2026-06-01', end_date: '2026-08-31', budget_hours: 100 },
    { code: 'DD', name: 'Design development', start_date: '2026-09-01', end_date: '2027-03-31', budget_hours: 200 },
  ].map((x) => ({ ...x, name: `${x.name} ${code}` }));

  it('a past phase at 100% no longer slips: the false-late At risk goes away', async () => {
    await newProject('PRJ-70', past('PRJ-70'));
    const before = await health('PRJ-70');
    expect(before.schedule.slip_days).toBeGreaterThan(7);
    expect(signal(before, 'schedule').status).toBe('At risk');
    const cd = (await view('PRJ-70')).phases[0].id;
    expect((await f.call('P02', 'PUT', `/phases/${cd}/progress`, { delivery_progress_pct: 100 })).status).toBe(200);
    const after = await health('PRJ-70');
    expect(after.schedule.slip_days).toBe(0);
    expect(signal(after, 'schedule').status).toBe('On track');
    expect(after.health.status).toBe('On track');
  });

  it('an On hold project is Watch with its reason and never At risk from slip; Delivery complete never At risk from slip', async () => {
    await newProject('PRJ-71', past('PRJ-71'));
    expect(signal(await health('PRJ-71'), 'schedule').status).toBe('At risk');
    expect((await setStatus('P02', 'PRJ-71', 'On hold', 'Client review')).status).toBe(200);
    const held = await health('PRJ-71');
    expect(held.health.status).toBe('Watch');
    expect(held.health.reasons).toContain('On hold: Client review');
    expect(signal(held, 'schedule').status).toBe('Watch');
    expect(held.schedule.slip_days).toBeGreaterThan(7);
    expect((await setStatus('P02', 'PRJ-71', 'Delivery complete')).status).toBe(200);
    const delivered = await health('PRJ-71');
    expect(signal(delivered, 'schedule').status).not.toBe('At risk');
    expect(delivered.health.status).not.toBe('At risk');
  });

  it('overview phase overrun and over-budget skip Cancelled phases as well as Complete', async () => {
    await newProject('PRJ-72', [{ code: 'CD', name: 'Overrun phase', budget_hours: 10 }]);
    const cd = (await view('PRJ-72')).phases[0].id;
    await f.call('P02', 'PUT', `/phases/${cd}/progress`, { etc_hours: 25 });
    const overview = async () => (await f.call('P01', 'GET', `/overview?as_of=${AS_OF}`)).body;
    const before = await overview();
    expect(before.attention.map((a: any) => a.title)).toContain('PRJ-72 Overrun phase');
    expect(before.projects.find((p: any) => p.code === 'PRJ-72').over_budget).toBe(true);
    expect((await editPhase('P02', cd, { status: 'Cancelled' })).status).toBe(200);
    const after = await overview();
    expect(after.attention.map((a: any) => a.title)).not.toContain('PRJ-72 Overrun phase');
    expect(after.projects.find((p: any) => p.code === 'PRJ-72').over_budget).toBe(false);
  });
});

describe('migration 014 backfill', () => {
  it('brings phase status in line with delivery progress, once and safely again', async () => {
    const project = (await f.owner.query(`select id from project where code = 'PRJ-40'`)).rows[0].id;
    const rows: [string, number, string, string][] = [
      ['M1', 100, 'Not started', 'Complete'],
      ['M2', 100, 'In progress', 'Complete'],
      ['M3', 100, 'Cancelled', 'Cancelled'],
      ['M4', 50, 'Not started', 'In progress'],
      ['M5', 50, 'Complete', 'Complete'],
      ['M6', 0, 'Not started', 'Not started'],
      ['M7', 0, 'In progress', 'In progress'],
    ];
    for (const [code, pct, status] of rows) {
      await f.owner.query(`insert into phase (firm_id, project_id, code, name, delivery_progress_pct, status) values ($1,$2,$3,$3,$4,$5)`, [f.firmId, project, code, pct, status]);
    }
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    await f.owner.query(sql);
    await f.owner.query(sql);
    const got = (await f.owner.query(`select code, status from phase where project_id = $1 and code like 'M%' order by code`, [project])).rows;
    expect(got).toEqual(rows.map(([code, , , want]) => ({ code, status: want })));
    expect((await f.owner.query(`select 1 from schema_migration where name = '014_phase_status_backfill.sql'`)).rowCount).toBe(1);
  });
});

describe('firm isolation', () => {
  it("another firm's phase and project are out of reach of the new routes", async () => {
    const other = (await f.owner.query(`insert into firm (legal_name, trading_name, timezone) values ('Other2','Other2','Asia/Kolkata') returning id`)).rows[0].id;
    const person = (await f.owner.query(
      `insert into person (firm_id, ref_code, name, work_email, job_title) values ($1,'P11','Outsider',$2,'Architect') returning id`, [other, `outsider-${randomUUID()}@other.test`],
    )).rows[0].id;
    const client = (await f.owner.query(`insert into client (firm_id, name) values ($1, 'Their client') returning id`, [other])).rows[0].id;
    const project = (await f.owner.query(`insert into project (firm_id, code, name, client_id, pm_id) values ($1,'PRJ-09','Their project',$2,$3) returning id`, [other, client, person])).rows[0].id;
    const phase = (await f.owner.query(`insert into phase (firm_id, project_id, code, name) values ($1,$2,'CD','Their phase') returning id`, [other, project])).rows[0].id;
    expect((await editPhase('P01', phase, { status: 'Complete' })).status).toBe(404);
    expect((await setStatus('P01', 'PRJ-09', 'Archived', 'Theirs')).status).toBe(404);
    expect((await editPhase('P01', (await phaseOf('PRJ-01', 'CD')).id, { owner_id: person })).body.error.details[0]).toEqual({ field: 'owner_id', code: 'unknown' });
    expect((await f.owner.query('select status from phase where id = $1', [phase])).rows[0].status).toBe('Not started');
    expect((await f.owner.query('select status from project where id = $1', [project])).rows[0].status).toBe('Active');
  });
});

describe('an archived project: progress and dates are closed too, and the flags say so', () => {
  let a: string;
  beforeAll(async () => {
    await newProject('PRJ-80', [{ code: 'A', name: 'Alpha', start_date: '2026-12-01', end_date: '2027-01-29' }]);
    a = (await view('PRJ-80')).phases[0].id;
  });
  const row = async () => (await f.owner.query('select status, delivery_progress_pct, etc_hours, start_date::text as start_date, end_date::text as end_date from phase where id = $1', [a])).rows[0];

  it('PUT /phases/:id/progress and PUT /phases/:id/dates are 409 PROJECT_CLOSED until restored; staff still 403', async () => {
    expect((await setStatus('P01', 'PRJ-80', 'Archived', 'Parked')).status).toBe(200);
    const before = await row();
    const progress = await f.call('P02', 'PUT', `/phases/${a}/progress`, { delivery_progress_pct: 50, etc_hours: 4 });
    expect(progress.status).toBe(409);
    expect(progress.body.error).toMatchObject({ code: 'PROJECT_CLOSED', message: 'Restore the project before changing it.' });
    const dates = await f.call('P01', 'PUT', `/phases/${a}/dates`, { start_date: '2026-12-08', end_date: '2027-02-05' });
    expect(dates.status).toBe(409);
    expect(dates.body.error).toMatchObject({ code: 'PROJECT_CLOSED', message: 'Restore the project before changing it.' });
    expect((await f.call('P04', 'PUT', `/phases/${a}/progress`, { etc_hours: 1 })).status).toBe(403);
    expect((await f.call('P04', 'PUT', `/phases/${a}/dates`, { start_date: '2026-12-08', end_date: '2027-02-05' })).status).toBe(403);
    expect(await row()).toEqual(before);
    expect((await setStatus('P01', 'PRJ-80', 'Active')).status).toBe(200);
    expect((await f.call('P02', 'PUT', `/phases/${a}/progress`, { delivery_progress_pct: 50, etc_hours: 4 })).status).toBe(200);
    expect((await f.call('P02', 'PUT', `/phases/${a}/dates`, { start_date: '2026-12-08', end_date: '2027-02-05' })).status).toBe(200);
    expect(await row()).toMatchObject({ status: 'In progress', delivery_progress_pct: '50.00', start_date: '2026-12-08', end_date: '2027-02-05' });
  });

  it('permissions.edit_phases and can_reschedule are false while Archived; status and archive stay so it can be restored', async () => {
    expect((await setStatus('P01', 'PRJ-80', 'Archived', 'Parked again')).status).toBe(200);
    expect((await view('PRJ-80', 'P01')).permissions).toEqual({ edit_phases: false, change_status: true, archive: true });
    expect((await view('PRJ-80', 'P02')).permissions).toEqual({ edit_phases: false, change_status: true, archive: false });
    const listed = (await f.call('P01', 'GET', '/projects')).body.data.find((x: any) => x.code === 'PRJ-80');
    expect(listed.permissions.edit_phases).toBe(false);
    expect((await f.call('P01', 'GET', `/projects/PRJ-80/schedule?as_of=${AS_OF}`)).body.can_reschedule).toBe(false);
    const studio = (await f.call('P01', 'GET', `/schedule?status=Archived&as_of=${AS_OF}`)).body.data.find((x: any) => x.project.code === 'PRJ-80');
    expect(studio.can_reschedule).toBe(false);
    expect((await setStatus('P01', 'PRJ-80', 'Active')).status).toBe(200);
    expect((await view('PRJ-80', 'P01')).permissions.edit_phases).toBe(true);
    expect((await f.call('P01', 'GET', `/projects/PRJ-80/schedule?as_of=${AS_OF}`)).body.can_reschedule).toBe(true);
  });
});

describe('time guard side doors: a cell keyed by entry_id and PUT /time-entries/:id', () => {
  let alpha: string; let beta: string; let arch: string;
  beforeAll(async () => {
    await newProject('PRJ-81', [{ code: 'A', name: 'Alpha' }, { code: 'B', name: 'Beta' }]);
    [alpha, beta] = (await view('PRJ-81')).phases.map((x: any) => x.id);
    await newProject('PRJ-82', [{ code: 'A', name: 'Alpha' }]);
    arch = (await view('PRJ-82')).phases[0].id;
  });
  const log = async (date: string, phase: string, h: number) => {
    const r = await f.call('P04', 'POST', '/time-entries', { service_date: date, duration_hours: h, phase_id: phase });
    expect(r.status).toBe(200);
    return r.body.id as string;
  };
  const byEntry = (date: string, entry: string, h: number) => f.call('P04', 'PUT', '/me/time/cell', { service_date: date, duration_hours: h, entry_id: entry });
  const hoursOf = async (id: string) => (await f.owner.query('select duration_hours from time_entry where id = $1', [id])).rows[0]?.duration_hours;

  it('an entry_id cell cannot add hours on a cancelled phase or an archived project; it can lower and clear them', async () => {
    const onBeta = await log('2026-09-07', beta, 3);
    const onArch = await log('2026-09-08', arch, 3);
    const onArch2 = await log('2026-09-10', arch, 2);
    expect((await editPhase('P02', beta, { status: 'Cancelled' })).status).toBe(200);
    expect((await setStatus('P01', 'PRJ-82', 'Archived', 'Closed')).status).toBe(200);
    const up = await byEntry('2026-09-07', onBeta, 5);
    expect(up.status).toBe(422);
    expect(up.body.error.code).toBe('PHASE_CANCELLED');
    const upArch = await byEntry('2026-09-08', onArch, 4);
    expect(upArch.status).toBe(422);
    expect(upArch.body.error.code).toBe('PROJECT_CLOSED');
    expect(await hoursOf(onBeta)).toBe('3.00');
    expect(await hoursOf(onArch)).toBe('3.00');
    expect((await byEntry('2026-09-07', onBeta, 3)).status).toBe(200);
    expect((await byEntry('2026-09-07', onBeta, 1)).status).toBe(200);
    expect(await hoursOf(onBeta)).toBe('1.00');
    expect((await byEntry('2026-09-08', onArch, 0)).status).toBe(200);
    expect(await hoursOf(onArch)).toBeUndefined();
    // PUT /time-entries/:id on the archived project: raising is refused, lowering is not.
    const raise = await f.call('P04', 'PUT', `/time-entries/${onArch2}`, { duration_hours: 3 });
    expect(raise.status).toBe(422);
    expect(raise.body.error.code).toBe('PROJECT_CLOSED');
    expect((await f.call('P04', 'PUT', `/time-entries/${onArch2}`, { duration_hours: 1 })).status).toBe(200);
    expect(await hoursOf(onArch2)).toBe('1.00');
  });

  it('PUT /time-entries/:id refuses raising the hours on a closed phase; lowering and a note are fine', async () => {
    const entry = await log('2026-09-09', alpha, 2);
    expect((await editPhase('P02', alpha, { status: 'Cancelled' })).status).toBe(200);
    const up = await f.call('P04', 'PUT', `/time-entries/${entry}`, { duration_hours: 4 });
    expect(up.status).toBe(422);
    expect(up.body.error.code).toBe('PHASE_CANCELLED');
    const upSame = await f.call('P04', 'PUT', `/time-entries/${entry}`, { duration_hours: 4, phase_id: alpha });
    expect(upSame.status).toBe(422);
    expect(await hoursOf(entry)).toBe('2.00');
    expect((await f.call('P04', 'PUT', `/time-entries/${entry}`, { duration_hours: 1.5 })).status).toBe(200);
    expect((await f.call('P04', 'PUT', `/time-entries/${entry}`, { note: 'Wrapping up' })).status).toBe(200);
    expect((await f.call('P04', 'PUT', `/time-entries/${entry}`, { duration_hours: 1.5, phase_id: alpha })).status).toBe(200);
    expect(await hoursOf(entry)).toBe('1.50');
    // Reopened, the same raise goes through.
    expect((await editPhase('P02', alpha, { status: 'In progress' })).status).toBe(200);
    expect((await f.call('P04', 'PUT', `/time-entries/${entry}`, { duration_hours: 4 })).status).toBe(200);
    expect(await hoursOf(entry)).toBe('4.00');
  });
});

describe('Cancelled phases are out of the project totals but stay in the phases list', () => {
  it('GET /projects/:code and the overview project row leave a Cancelled phase out of hours and fee-weighted delivery', async () => {
    const r = await f.call('P01', 'POST', '/projects', body('PRJ-83', [
      { code: 'A', name: 'Alpha', fee: 100000, budget_hours: 100 },
      { code: 'B', name: 'Beta', fee: 200000, budget_hours: 50 },
    ], { billing_method: 'fixed_percent', contracted_amount: 300000 }));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const [a, b] = (await view('PRJ-83')).phases.map((x: any) => x.id);
    expect((await f.call('P02', 'PUT', `/phases/${a}/progress`, { delivery_progress_pct: 40, etc_hours: 10 })).status).toBe(200);
    expect((await f.call('P02', 'PUT', `/phases/${b}/progress`, { delivery_progress_pct: 10, etc_hours: 20 })).status).toBe(200);
    const row = async () => (await f.call('P01', 'GET', `/overview?as_of=${AS_OF}`)).body.projects.find((p: any) => p.code === 'PRJ-83');
    // (40 x 1 + 10 x 2) / 3 = 20
    expect(await view('PRJ-83')).toMatchObject({ hours: { budget: '150.00', actual: '0.00', forecast: '30.00' }, delivery_progress_pct: 20 });
    expect(await row()).toMatchObject({ hours: { budget: '150.00', actual: '0.00', forecast: '30.00' }, delivery_progress_pct: 20 });

    expect((await editPhase('P02', b, { status: 'Cancelled' })).status).toBe(200);
    const after = await view('PRJ-83');
    expect(after).toMatchObject({ hours: { budget: '100.00', actual: '0.00', forecast: '10.00' }, delivery_progress_pct: 40 });
    expect(after.phases.map((x: any) => [x.code, x.status, x.budget_hours])).toEqual([['A', 'In progress', '100.00'], ['B', 'Cancelled', '50.00']]);
    expect(await row()).toMatchObject({ hours: { budget: '100.00', actual: '0.00', forecast: '10.00' }, delivery_progress_pct: 40 });
    // The schedule already left it out: all three readers agree.
    expect((await f.call('P01', 'GET', `/projects/PRJ-83/schedule?as_of=${AS_OF}`)).body.hours).toMatchObject({ budget: '100.00', forecast: '10.00' });
  });
});

describe('PUT /phases/:id/progress rounds delivery to two decimals', () => {
  it('99.996 is stored as 100.00 and completes the phase; 99.994 is 99.99 and does not', async () => {
    await newProject('PRJ-84', [{ code: 'A', name: 'Alpha' }, { code: 'B', name: 'Beta' }]);
    const [a, b] = (await view('PRJ-84')).phases.map((x: any) => x.id);
    const rowOf = async (id: string) => (await f.owner.query('select status, delivery_progress_pct from phase where id = $1', [id])).rows[0];
    const done = await f.call('P02', 'PUT', `/phases/${a}/progress`, { delivery_progress_pct: 99.996 });
    expect(done.status).toBe(200);
    expect(await rowOf(a)).toEqual({ status: 'Complete', delivery_progress_pct: '100.00' });
    expect(await auditRow(done.body.audit_event_id)).toMatchObject({ previous: { status: 'Not started' }, new: { delivery_progress_pct: 100, status: 'Complete' } });
    // The same figure again, once rounded, is no change: the status is left alone.
    expect((await editPhase('P02', a, { status: 'In progress' })).status).toBe(200);
    expect((await f.call('P02', 'PUT', `/phases/${a}/progress`, { delivery_progress_pct: '99.999', etc_hours: 2 })).status).toBe(200);
    expect(await rowOf(a)).toEqual({ status: 'In progress', delivery_progress_pct: '100.00' });
    expect((await f.call('P02', 'PUT', `/phases/${b}/progress`, { delivery_progress_pct: 99.994 })).status).toBe(200);
    expect(await rowOf(b)).toEqual({ status: 'In progress', delivery_progress_pct: '99.99' });
  });
});

describe('GET /projects/:code/members says who is still employed', () => {
  it('each person carries employment_state, so the owner picker can leave out people who have left', async () => {
    await newProject('PRJ-85', [{ code: 'A', name: 'Alpha' }]);
    const ended = await endedPerson();
    expect((await f.call('P02', 'POST', '/projects/PRJ-85/members', { person_id: ended, role: 'contributor' })).status).toBe(200);
    const members = (await f.call('P02', 'GET', '/projects/PRJ-85/members')).body.data;
    expect(Object.keys(members[0].person).sort()).toEqual(['employment_state', 'id', 'job_title', 'name', 'ref_code']);
    expect(members.map((m: any) => [m.person.id, m.person.employment_state])).toEqual(expect.arrayContaining([
      [f.id('P02'), 'Active'], [f.id('P04'), 'Active'], [ended, 'Ended'],
    ]));
    // The API agrees: an ended team member cannot own a phase.
    const a = (await view('PRJ-85')).phases[0].id;
    expect((await editPhase('P02', a, { owner_id: ended })).body.error.details[0]).toEqual({ field: 'owner_id', code: 'unknown' });
  });
});
