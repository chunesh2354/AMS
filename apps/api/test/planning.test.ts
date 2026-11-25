import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { freshApp, type Fresh } from './helpers';

/**
 * Planning (migration 011): availability from the one capacity definition (holidays, approved leave with half days,
 * a holiday that is also leave counted once), conflicts and the overallocation reason, draft vs published (My schedule
 * shows the published plan only), publish audit and notifications, a PM limited to their own projects, add_to_team,
 * deactivated people refused, leave type hidden from peers, calendar visibility, holiday permissions, firm isolation
 * and Monday week boundaries in Asia/Kolkata.
 *
 * Seed facts: holidays Fri 20 Nov and Fri 25 Dec 2026; P04 approved leave 16-17 Nov, P05 approved half day 18 Nov
 * (approver P02), P06 pending 20 Nov (approver P03); P05 has a 30 h draft on PRJ-01 Working drawings in the week of
 * 16 Nov; three unpublished cards in revision 1.
 */
const W16 = '2026-11-16';

const workload = (f: Fresh, ref: string, qs = `from=${W16}&weeks=1`) => f.call(ref, 'GET', `/workload?${qs}`);
const row = (body: any, ref: string) => body.people.find((p: any) => p.person.ref_code === ref);
const allocId = async (f: Fresh, ref: string, week: string, hours: number) => (await f.owner.query(
  `select a.id from allocation a join person p on p.id = a.person_id where p.ref_code = $1 and a.week_start = $2 and a.hours = $3`, [ref, week, hours],
)).rows[0].id as string;
const phaseId = async (f: Fresh, code: string, phase: string) => (await f.owner.query(
  'select ph.id from phase ph join project p on p.id = ph.project_id where p.code = $1 and ph.code = $2', [code, phase],
)).rows[0].id as string;

describe('availability and conflicts', () => {
  let f: Fresh;
  beforeAll(async () => { f = await freshApp(); });
  afterAll(async () => { await f?.close(); });

  it("Divya's week of 16 Nov: 40 - 8 holiday - 4 half-day leave = 28 available, 30 h confirmed, 2 h over", async () => {
    const r = await workload(f, 'P01');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ from: W16, to: '2026-11-22', weeks: [W16], timezone: 'Asia/Kolkata', view: 'draft', pending_changes: 3 });
    const w = row(r.body, 'P05').weeks[0];
    expect(w).toMatchObject({
      capacity: '40.00', scheduled: '40.00', holiday_hours: '8.00', leave_approved: '4.00', leave_pending: '0.00', on_leave: true,
      available: '28.00', allocated: '30.00', confirmed_allocations: '30.00', remaining: '-2.00', conflict: true, over_hours: '2.00', load_pct: 107,
    });
    expect(w.holidays).toEqual([{ date: '2026-11-20', name: 'Studio holiday', half_day: false }]);
    expect(w.allocations).toEqual([expect.objectContaining({ hours: '30.00', state: 'confirmed', published: false, unpublished_change: true, can_edit: true })]);
    // The only conflict in the seeded plan.
    expect(r.body.conflicts).toEqual([{ person: expect.objectContaining({ ref_code: 'P05' }), week_start: W16, available: '28.00', confirmed_allocations: '30.00', over_hours: '2.00' }]);
    // Rohan: two days of leave and the holiday leave exactly his 16 h.
    expect(row(r.body, 'P04').weeks[0]).toMatchObject({ leave_approved: '16.00', available: '16.00', allocated: '16.00', conflict: false, load_pct: 100 });
    // Pending leave is an overlay, never subtracted (R5); Karan's pending day is the holiday anyway.
    expect(row(r.body, 'P06').weeks[0]).toMatchObject({ leave_pending: '8.00', available: '32.00' });
    // Sneha is part time from 9 Nov: 32 h spread over five days, less the holiday.
    expect(row(r.body, 'P07').weeks[0]).toMatchObject({ capacity: '32.00', holiday_hours: '6.40', available: '25.60' });
  });

  it('pins the unassigned 5 h on PRJ-01 Concept design and keeps PRJ-03 allocations on hold', async () => {
    const r = await workload(f, 'P01', 'from=2026-11-02&weeks=1');
    expect(r.body.unassigned).toEqual([expect.objectContaining({
      project: expect.objectContaining({ code: 'PRJ-01' }), phase: expect.objectContaining({ code: 'CD', name: 'Concept design' }), total_hours: '5.00',
      weeks: [expect.objectContaining({ week_start: '2026-11-02', hours: '5.00', allocations: [expect.objectContaining({ state: 'tentative', published: false, person: null })] })],
    })]);
    const vikram = row(r.body, 'P02').weeks[0];
    expect(vikram.allocated).toBe('32.00');
    expect(vikram.allocations.find((a: any) => a.project.code === 'PRJ-03')).toMatchObject({ hours: '8.00', on_hold: true, published: true, project: { status: 'On hold' } });
  });

  it('in the published plan the 30 h draft is not there, so Divya has no conflict', async () => {
    const r = await workload(f, 'P01', `from=${W16}&weeks=1&view=published`);
    expect(row(r.body, 'P05').weeks[0]).toMatchObject({ available: '28.00', allocated: '0.00', conflict: false });
    expect(r.body.conflicts).toEqual([]);
  });

  it('a day that is both a holiday and leave reduces availability once (AC-F03-2)', async () => {
    const type = (await f.owner.query(`select id from leave_type where key = 'earned'`)).rows[0].id;
    await f.owner.query(
      `insert into leave_request (firm_id, person_id, leave_type_id, start_date, end_date, days, status, approver_id) values ($1,$2,$3,'2026-11-19','2026-11-20',2,'Approved',$4)`,
      [f.firmId, f.id('P08'), type, f.id('P02')],
    );
    const w = row((await workload(f, 'P01')).body, 'P08').weeks[0];
    expect(w).toMatchObject({ holiday_hours: '8.00', leave_approved: '8.00', available: '24.00', allocated: '28.00', conflict: true, over_hours: '4.00' });
  });

  it('Home and My schedule agree with the workload for the same week', async () => {
    const home = await f.call('P05', 'GET', '/me/home?date=2026-11-18');
    expect(home.status).toBe(200);
    expect(home.body.week).toMatchObject({ scheduled_hours: '40.00', available_hours: '28.00', allocated_hours: '0.00' });
    expect(home.body.week.days[2]).toMatchObject({ date: '2026-11-18', scheduled_hours: '8.00', available_hours: '4.00', leave: { half_day: true } });
    expect(home.body.week.days[4]).toMatchObject({ date: '2026-11-20', available_hours: '0.00', holiday: { name: 'Studio holiday', half_day: false } });
    const s = await f.call('P05', 'GET', `/me/schedule?from=${W16}&weeks=1`);
    expect(s.body.weeks[0]).toMatchObject({ scheduled: '40.00', holiday_hours: '8.00', leave_approved: '4.00', available: '28.00' });
  });

  it('saving a confirmed overload needs a reason: 422 without, saved and audited with one (AC-F08-2)', async () => {
    const body = { project_id: 'PRJ-01', phase_id: await phaseId(f, 'PRJ-01', 'WD'), person_id: f.id('P05'), week_start: '2026-11-23', hours: 20 };
    const no = await f.call('P02', 'POST', '/allocations', body);
    expect(no.status).toBe(422);
    expect(no.body.error).toMatchObject({ code: 'RULE_VIOLATION', rule: 'OVERALLOCATION' });
    expect(no.body.error.details[0]).toMatchObject({ field: 'overallocation_reason', code: 'required', available: '40.00', confirmed_allocations: '44.00', over_hours: '4.00' });
    // Tentative hours do not need one.
    const tent = await f.call('P02', 'POST', '/allocations', { ...body, state: 'tentative' });
    expect(tent.status, JSON.stringify(tent.body)).toBe(200);
    expect(tent.body.person_week).toMatchObject({ allocated: '44.00', confirmed_allocations: '24.00', conflict: false });
    const yes = await f.call('P02', 'POST', '/allocations', { ...body, overallocation_reason: 'Deadline week, agreed with Divya' });
    expect(yes.status, JSON.stringify(yes.body)).toBe(200);
    expect(yes.body).toMatchObject({ hours: '20.00', published: false, overallocation_reason: 'Deadline week, agreed with Divya', person_week: { conflict: true, over_hours: '4.00' } });
    const ev = (await f.owner.query('select action, reason, new from audit_event where id = $1', [yes.body.audit_event_id])).rows[0];
    expect(ev).toMatchObject({ action: 'overallocate', reason: 'Deadline week, agreed with Divya' });
    // Lowering an overloaded allocation needs no reason.
    const lower = await f.call('P02', 'PUT', `/allocations/${yes.body.id}`, { hours: 18 });
    expect(lower.status, JSON.stringify(lower.body)).toBe(200);
  });

  it('validates hours, week_start (a Monday), state and the phase', async () => {
    const base = { project_id: 'PRJ-01', person_id: f.id('P04'), week_start: '2026-11-30', hours: 4 };
    const cases: [Record<string, unknown>, string, string][] = [
      [{ hours: 0 }, 'hours', 'range'], [{ hours: 4.555 }, 'hours', 'precision'], [{ hours: 200 }, 'hours', 'range'],
      [{ week_start: '2026-12-01' }, 'week_start', 'monday'], [{ week_start: '30-11-2026' }, 'week_start', 'date'],
      [{ state: 'maybe' }, 'state', 'enum'], [{ phase_id: await phaseId(f, 'PRJ-02', 'SD') }, 'phase_id', 'unknown'],
    ];
    for (const [over, field, code] of cases) {
      const r = await f.call('P02', 'POST', '/allocations', { ...base, ...over });
      expect(r.status, JSON.stringify(over)).toBe(400);
      expect(r.body.error.details[0]).toMatchObject({ field, code });
    }
    expect((await f.call('P01', 'GET', '/workload?weeks=27')).status).toBe(400);
    expect((await f.call('P01', 'GET', '/workload?view=both')).status).toBe(400);
  });
});

describe('draft, publish and My schedule', () => {
  let f: Fresh;
  beforeAll(async () => { f = await freshApp(); });
  afterAll(async () => { await f?.close(); });

  it('My schedule shows only the published plan; edits and deletes wait for the next publish (AC-F08-3)', async () => {
    const s0 = await f.call('P05', 'GET', '/me/schedule?from=2026-11-09&weeks=3');
    expect(s0.status, JSON.stringify(s0.body)).toBe(200);
    expect(s0.body.weeks.map((w: any) => w.allocated)).toEqual(['24.00', '0.00', '24.00']);
    expect(s0.body.last_published).toMatchObject({ revision_no: 1 });
    expect(s0.body.weeks[1].days.map((d: any) => d.dow)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(s0.body.weeks[1].days[2].leave).toMatchObject({ status: 'Approved', half_day: true, leave_type: { key: 'earned' } });

    // Change one published allocation and delete another: My schedule is unchanged until the publish.
    const w23 = await allocId(f, 'P05', '2026-11-23', 24);
    const w09 = await allocId(f, 'P05', '2026-11-09', 24);
    const put = await f.call('P02', 'PUT', `/allocations/${w23}`, { hours: 20, note: 'Shorter week' });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body).toMatchObject({ hours: '20.00', published: true, unpublished_change: true });
    const del = await f.call('P02', 'DELETE', `/allocations/${w09}`);
    expect(del.body).toMatchObject({ deleted: true, removed_on_publish: true });
    const s1 = await f.call('P05', 'GET', '/me/schedule?from=2026-11-09&weeks=3');
    expect(s1.body.weeks.map((w: any) => w.allocated)).toEqual(['24.00', '0.00', '24.00']);

    const pending = await f.call('P02', 'GET', '/allocations/pending');
    expect(pending.body.total).toBe(5);
    expect(pending.body.data.map((c: any) => c.kind).sort()).toEqual(['added', 'added', 'added', 'changed', 'removed']);

    const pub = await f.call('P02', 'POST', '/allocations/publish', { note: 'Week of 16 Nov replanned' });
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);
    expect(pub.body.revision).toMatchObject({ revision_no: 2, scope: 'firm', change_count: 5, note: 'Week of 16 Nov replanned', published_by: { id: f.id('P02') } });
    expect(pub.body.projects).toEqual(['PRJ-01']);
    expect(pub.body.conflicts).toEqual([{ person_id: f.id('P05'), week_start: W16, available: '28.00', confirmed_allocations: '30.00', over_hours: '2.00' }]);

    const s2 = await f.call('P05', 'GET', '/me/schedule?from=2026-11-09&weeks=3');
    expect(s2.body.weeks.map((w: any) => w.allocated)).toEqual(['0.00', '30.00', '20.00']);
    expect(s2.body.weeks[1]).toMatchObject({ conflict: true, over_hours: '2.00' });
    expect(s2.body.weeks[2].allocations[0]).toMatchObject({ note: 'Shorter week', published: true, unpublished_change: false });

    // Audited, and the affected people were told what changed.
    const ev = (await f.owner.query('select action, record_type, new, reason from audit_event where id = $1', [pub.body.audit_event_id])).rows[0];
    expect(ev).toMatchObject({ record_type: 'plan_revision', action: 'publish', reason: 'Week of 16 Nov replanned', new: { revision_no: 2, change_count: 5, projects: ['PRJ-01'] } });
    const notes = (await f.owner.query(`select person_id, text from notification where event_type = 'plan.published' order by text`)).rows;
    expect(notes.map((n) => n.person_id).sort()).toEqual([f.id('P04'), f.id('P05')].sort());
    const divya = notes.find((n) => n.person_id === f.id('P05'))!.text;
    expect(divya).toContain('Vikram Nair published plan revision 2');
    expect(divya).toContain('removed PRJ-01 Working drawings, week of 09 Nov: 24 h');
    expect(pub.body.notified).not.toContain(f.id('P02'));

    // Nothing left: a second publish is a 409.
    const again = await f.call('P02', 'POST', '/allocations/publish', {});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('NOTHING_TO_PUBLISH');
    expect((await workload(f, 'P02')).body.pending_changes).toBe(0);
  });

  it('staff cannot read drafts or the workload grid, and cannot allocate', async () => {
    expect((await f.call('P04', 'GET', '/workload')).status).toBe(403);
    expect((await f.call('P04', 'GET', '/workload')).body.error.capability).toBe('capacity.manage');
    const drafts = await f.call('P04', 'GET', '/allocations?view=draft');
    expect(drafts.status).toBe(403);
    const pub = await f.call('P04', 'GET', `/allocations?from=${W16}&weeks=1`);
    expect(pub.status).toBe(200);
    expect(pub.body.view).toBe('published');
    expect(pub.body.data.every((a: any) => a.published && !a.can_edit)).toBe(true);
    const post = await f.call('P04', 'POST', '/allocations', { project_id: 'PRJ-01', person_id: f.id('P04'), week_start: '2026-11-30', hours: 4 });
    expect(post.status).toBe(403);
    expect((await f.call('P04', 'POST', '/allocations/publish', {})).status).toBe(403);
  });
});

describe('PM scope, add_to_team and deactivated people', () => {
  let f: Fresh;
  beforeAll(async () => { f = await freshApp(); });
  afterAll(async () => { await f?.close(); });

  it("Vikram plans PRJ-01 and PRJ-03 only; PRJ-02 hours count in the load as anonymous other hours", async () => {
    const sd2 = await phaseId(f, 'PRJ-02', 'SD');
    const no = await f.call('P02', 'POST', '/allocations', { project_id: 'PRJ-02', phase_id: sd2, person_id: f.id('P06'), week_start: '2026-11-30', hours: 4 });
    expect(no.status).toBe(403);
    expect(no.body.error.capability).toBe('projects.plan');
    const id = await allocId(f, 'P06', '2026-11-02', 32);
    expect((await f.call('P02', 'PUT', `/allocations/${id}`, { hours: 30 })).status).toBe(403);
    expect((await f.call('P02', 'DELETE', `/allocations/${id}`)).status).toBe(403);
    expect((await f.call('P02', 'POST', '/allocations/publish', { project: 'PRJ-02' })).status).toBe(403);

    const r = await workload(f, 'P02', 'from=2026-11-02&weeks=1');
    expect(r.status).toBe(200);
    expect(row(r.body, 'P06').weeks[0]).toMatchObject({ allocated: '32.00', other_hours: '32.00', allocations: [] });
    expect(JSON.stringify(r.body)).not.toContain('PRJ-02');
    expect(JSON.stringify(r.body)).not.toContain('Schematic design');

    // Meera's draft on PRJ-02 stays pending when Vikram publishes everything he plans.
    const mine = await f.call('P03', 'POST', '/allocations', { project_id: 'PRJ-02', phase_id: sd2, person_id: f.id('P06'), week_start: '2026-11-30', hours: 4, state: 'tentative' });
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    const pub = await f.call('P02', 'POST', '/allocations/publish', {});
    expect(pub.body.projects).toEqual(['PRJ-01']);
    expect((await f.call('P03', 'GET', '/allocations/pending')).body.data).toEqual([expect.objectContaining({ allocation_id: mine.body.id, kind: 'added', project: expect.objectContaining({ code: 'PRJ-02' }) })]);
    const p3 = await f.call('P03', 'POST', '/allocations/publish', { project: 'PRJ-02' });
    expect(p3.body.revision).toMatchObject({ revision_no: 3, scope: 'project', project: { code: 'PRJ-02' }, change_count: 1 });

    // Meera's PRJ-02 revision never reaches Vikram: not as the last publish, not in the history.
    const after = await workload(f, 'P02', 'from=2026-11-02&weeks=1');
    expect(after.body.last_published).toMatchObject({ revision_no: 2, projects: [{ code: 'PRJ-01' }], partial: false });
    expect(JSON.stringify(after.body)).not.toContain('PRJ-02');
    const plans = await f.call('P02', 'GET', '/plans');
    expect(plans.body.data.map((r: any) => r.revision_no)).toEqual([2, 1]);
    expect(plans.body.data[1]).toMatchObject({ projects: [{ code: 'PRJ-01' }, { code: 'PRJ-03' }], note: null, change_count: null, partial: true });
    expect(JSON.stringify(plans.body)).not.toContain('PRJ-02');
    expect((await f.call('P01', 'GET', '/plans')).body.data[0]).toMatchObject({ revision_no: 3, project: { code: 'PRJ-02' }, partial: false });
    expect(JSON.stringify((await f.call('P04', 'GET', '/me/schedule')).body.last_published)).not.toContain('PRJ-03');
  });

  it('allocating someone off the team is 422 unless add_to_team, which adds them as a contributor', async () => {
    const wd = await phaseId(f, 'PRJ-01', 'WD');
    const body = { project_id: 'PRJ-01', phase_id: wd, person_id: f.id('P06'), week_start: '2026-12-07', hours: 8 };
    const no = await f.call('P02', 'POST', '/allocations', body);
    expect(no.status).toBe(422);
    expect(no.body.error).toMatchObject({ rule: 'PERSON_ON_TEAM', details: [{ field: 'person_id', code: 'not_member' }] });
    const yes = await f.call('P02', 'POST', '/allocations', { ...body, add_to_team: true });
    expect(yes.status, JSON.stringify(yes.body)).toBe(200);
    expect(yes.body).toMatchObject({ added_to_team: true, person: { id: f.id('P06') } });
    const m = (await f.owner.query(`select project_role from project_membership m join project p on p.id = m.project_id where p.code = 'PRJ-01' and m.person_id = $1`, [f.id('P06')])).rows;
    expect(m).toEqual([{ project_role: 'contributor' }]);
    // Unassigned demand needs no person.
    const open = await f.call('P02', 'POST', '/allocations', { project_id: 'PRJ-01', phase_id: wd, week_start: '2026-12-07', hours: 12, state: 'tentative', note: 'Second architect' });
    expect(open.status).toBe(200);
    const r = await workload(f, 'P02', 'from=2026-12-07&weeks=1&project=PRJ-01');
    expect(r.body.project).toMatchObject({ code: 'PRJ-01' });
    expect(r.body.unassigned).toEqual([expect.objectContaining({ phase: expect.objectContaining({ code: 'WD' }), total_hours: '12.00' })]);
    expect(r.body.people.map((p: any) => p.person.ref_code)).toContain('P06');
  });

  it('refuses people who left or whose account is deactivated', async () => {
    const sd2 = await phaseId(f, 'PRJ-02', 'SD');
    await f.owner.query(`update person set login_state = 'Revoked' where id = $1`, [f.id('P07')]);
    const r = await f.call('P03', 'POST', '/allocations', { project_id: 'PRJ-02', phase_id: sd2, person_id: f.id('P07'), week_start: '2026-12-14', hours: 8 });
    expect(r.status).toBe(400);
    expect(r.body.error.details[0]).toMatchObject({ field: 'person_id', code: 'inactive' });
    await f.owner.query(`update person set login_state = 'Enabled', employment_state = 'Ended' where id = $1`, [f.id('P07')]);
    const ended = await f.call('P03', 'POST', '/allocations', { project_id: 'PRJ-02', phase_id: sd2, person_id: f.id('P07'), week_start: '2026-12-14', hours: 8 });
    expect(ended.status).toBe(400);
    expect(ended.body.error.details[0].code).toBe('inactive');
    // Still on the grid while they hold allocations, marked inactive, so the planner can reassign.
    expect(row((await workload(f, 'P03', 'from=2026-11-02&weeks=1')).body, 'P07')).toMatchObject({ inactive: true });
  });
});

describe('privacy, calendar and holidays', () => {
  let f: Fresh;
  beforeAll(async () => { f = await freshApp(); });
  afterAll(async () => { await f?.close(); });

  it('leave type is shown to the approver and people.manage, "On leave" to everyone else', async () => {
    const leaveOf = async (ref: string) => row((await workload(f, ref)).body, 'P05').weeks[0].leave[0];
    expect(await leaveOf('P02')).toMatchObject({ label: 'Earned leave', leave_type: { key: 'earned' }, half_day: true });
    expect(await leaveOf('P01')).toMatchObject({ label: 'Earned leave' });
    const peer = await leaveOf('P03');
    expect(peer).toEqual({ id: null, status: 'Approved', start_date: '2026-11-18', end_date: '2026-11-18', half_day: true, leave_type: null, label: 'On leave' });
  });

  it('the calendar is limited to visible projects; colleagues show as "On leave", pending leave only to the person', async () => {
    await f.owner.query(
      `insert into task (firm_id, project_id, title, due_date) select firm_id, id, 'Issue CD set', '2026-11-25' from project where code = 'PRJ-01'`,
    );
    const p04 = await f.call('P04', 'GET', '/calendar?from=2026-11-01&to=2026-11-30');
    expect(p04.status, JSON.stringify(p04.body)).toBe(200);
    const types = (b: any) => new Set(b.events.map((e: any) => e.type));
    expect([...types(p04.body)].sort()).toEqual(['holiday', 'leave', 'phase_end', 'task_due']);
    expect(p04.body.events.find((e: any) => e.type === 'holiday')).toMatchObject({ date: '2026-11-20', title: 'Studio holiday' });
    expect(p04.body.events.find((e: any) => e.type === 'task_due')).toMatchObject({ date: '2026-11-25', title: 'Issue CD set', project: { code: 'PRJ-01' } });
    expect(p04.body.events.find((e: any) => e.type === 'phase_end')).toMatchObject({ date: '2026-11-27', project: { code: 'PRJ-01' }, phase: { code: 'CD' } });
    const leave = p04.body.events.filter((e: any) => e.type === 'leave');
    expect(leave.find((e: any) => e.mine)).toMatchObject({ label: 'Earned leave', title: 'Earned leave' });
    expect(leave.find((e: any) => e.person.ref_code === 'P05')).toMatchObject({ label: 'On leave', title: 'Divya Menon: On leave', leave_type: null });
    // Karan's pending request is for Karan and his approver.
    expect(leave.some((e: any) => e.person.ref_code === 'P06')).toBe(false);
    const p06 = await f.call('P06', 'GET', '/calendar?from=2026-11-01&to=2026-11-30');
    expect(p06.body.events.find((e: any) => e.type === 'leave' && e.mine)).toMatchObject({ status: 'Pending', label: 'Earned leave' });
    expect(JSON.stringify(p06.body)).not.toContain('PRJ-01');
    expect(JSON.stringify(p06.body)).not.toContain('Issue CD set');
    // Asking for a project you are not on is refused; types are validated.
    expect((await f.call('P06', 'GET', '/calendar?project=PRJ-01')).status).toBe(403);
    expect((await f.call('P04', 'GET', '/calendar?types=holiday,birthday')).status).toBe(400);
    // December on PRJ-02: Schematic design ends with its billing milestone (dated by the phase end, no amount), Working drawings starts.
    const dec = await f.call('P06', 'GET', '/calendar?from=2026-12-01&to=2026-12-31&types=phase,milestone');
    expect(dec.body.events.map((e: any) => [e.type, e.date, e.project.code])).toEqual([
      ['milestone', '2026-12-04', 'PRJ-02'], ['phase_end', '2026-12-04', 'PRJ-02'], ['phase_start', '2026-12-07', 'PRJ-02'],
    ]);
    const ms = dec.body.events.find((e: any) => e.type === 'milestone');
    expect(ms).toMatchObject({ title: 'Schematic design milestone', date_basis: 'phase_end', status: 'Authorized', phase: { code: 'SD' } });
    expect(ms).not.toHaveProperty('amount');
    const only = await f.call('P04', 'GET', '/calendar?from=2026-11-01&to=2026-12-31&types=holiday');
    expect(only.body.events.map((e: any) => e.date)).toEqual(['2026-11-20', '2026-12-25']);
  });

  it('holidays: everyone reads, firm.settings.manage adds and removes, and availability follows', async () => {
    expect((await f.call('P04', 'GET', '/holidays')).body.data.map((h: any) => h.date)).toEqual(['2026-11-20', '2026-12-25']);
    const pm = await f.call('P02', 'POST', '/holidays', { date: '2026-11-30', name: 'Studio offsite' });
    expect(pm.status).toBe(403);
    expect(pm.body.error.capability).toBe('firm.settings.manage');
    const ok = await f.call('P01', 'POST', '/holidays', { date: '2026-11-30', name: 'Studio offsite', half_day: true });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await f.call('P01', 'POST', '/holidays', { date: '2026-11-30', name: 'Again' })).status).toBe(409);
    const s = await f.call('P04', 'GET', '/me/schedule?from=2026-11-30&weeks=1');
    expect(s.body.weeks[0]).toMatchObject({ holiday_hours: '4.00', available: '36.00' });
    expect(s.body.weeks[0].days[0].holiday).toEqual({ name: 'Studio offsite', half_day: true });
    expect((await f.call('P02', 'DELETE', `/holidays/${ok.body.id}`)).status).toBe(403);
    expect((await f.call('P01', 'DELETE', `/holidays/${ok.body.id}`)).status).toBe(200);
    expect((await f.call('P04', 'GET', '/me/schedule?from=2026-11-30&weeks=1')).body.weeks[0].available).toBe('40.00');
  });

  it('capacity: staff read their own, operations change it, PMs and staff cannot', async () => {
    expect((await f.call('P04', 'GET', '/people/P07/capacity')).status).toBe(403);
    const own = await f.call('P07', 'GET', '/people/P07/capacity?from=2026-11-02&weeks=2');
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect(own.body.versions.map((v: any) => [v.effective_from, v.weekly_hours])).toEqual([['2026-01-01', '40.00'], ['2026-11-09', '32.00']]);
    expect(own.body.weeks.map((w: any) => w.capacity)).toEqual(['40.00', '32.00']);
    expect(own.body.view).toBe('published');
    expect((await f.call('P07', 'PUT', '/people/P07/capacity', { weekly_hours: 20 })).status).toBe(403);
    expect((await f.call('P02', 'PUT', '/people/P04/capacity', { weekly_hours: 20 })).status).toBe(403);
    expect((await f.call('P02', 'GET', '/people/P04/capacity')).status).toBe(200);
    const put = await f.call('P10', 'PUT', `/people/${f.id('P04')}/capacity`, { weekly_hours: 30, effective_from: '2026-11-23', note: 'Study leave term' });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body).toMatchObject({ weekly_hours: '30.00', effective_from: '2026-11-23' });
    expect((await f.owner.query('select action from audit_event where id = $1', [put.body.audit_event_id])).rows[0].action).toBe('create');
    const w = await workload(f, 'P01', 'from=2026-11-16&weeks=2');
    expect(row(w.body, 'P04').weeks.map((x: any) => x.capacity)).toEqual(['40.00', '30.00']);
    expect((await f.call('P10', 'PUT', `/people/${f.id('P04')}/capacity`, { weekly_hours: 170 })).status).toBe(400);
    // The overview's month-to-date available hours are untouched by a change dated after it.
    expect((await f.call('P01', 'GET', '/overview?as_of=2026-11-06')).body.figures.utilization.available_hours).toBe('400.00');
  });
});

describe('firm isolation and Monday weeks in Asia/Kolkata', () => {
  let f: Fresh;
  beforeAll(async () => { f = await freshApp(); });
  afterAll(async () => { await f?.close(); });

  it("another studio's holidays and allocations never appear or count", async () => {
    const q = async (sql: string, params: unknown[]) => (await f.owner.query(sql, params)).rows[0];
    const other = (await q(`insert into firm (legal_name, trading_name, timezone) values ('Other','Other','UTC') returning id`, [])).id;
    const o1 = (await q(`insert into person (firm_id, ref_code, name, work_email, job_title) values ($1,'P01','Olga Outsider','olga2@other.test','Principal') returning id`, [other])).id;
    const client = (await q(`insert into client (firm_id, name) values ($1,'Other client') returning id`, [other])).id;
    const prj = (await q(`insert into project (firm_id, code, name, client_id, pm_id) values ($1,'OTH-01','Other Tower',$2,$3) returning id`, [other, client, o1])).id;
    await q(`insert into firm_holiday (firm_id, date, name) values ($1,'2026-11-17','Other holiday') returning id`, [other]);
    await q(`insert into allocation (firm_id, project_id, person_id, week_start, hours) values ($1,$2,$3,'2026-11-16',40) returning id`, [other, prj, o1]);

    const w = await workload(f, 'P01');
    const s = JSON.stringify(w.body);
    for (const x of ['Other holiday', 'OTH-01', 'Olga Outsider']) expect(s).not.toContain(x);
    expect(row(w.body, 'P05').weeks[0].available).toBe('28.00');
    expect(w.body.pending_changes).toBe(3);
    expect(JSON.stringify((await f.call('P01', 'GET', '/holidays')).body)).not.toContain('Other holiday');
    expect(JSON.stringify((await f.call('P01', 'GET', '/calendar?from=2026-11-01&to=2026-11-30')).body)).not.toContain('Other');
    expect((await f.call('P01', 'GET', '/allocations?from=2026-11-16&weeks=1')).body.data.some((a: any) => a.project.code === 'OTH-01')).toBe(false);
  });

  it('weeks start on the Monday of the studio calendar, not UTC', async () => {
    await f.login('P05');
    await f.login('P01');
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      // Sunday 15 Nov 23:30 UTC is Monday 16 Nov 05:00 in India.
      vi.setSystemTime(new Date('2026-11-15T23:30:00Z'));
      const s = await f.call('P05', 'GET', '/me/schedule');
      expect(s.status).toBe(200);
      expect(s.body).toMatchObject({ today: '2026-11-16', from: W16, to: '2027-01-10' });
      expect(s.body.weeks).toHaveLength(8);
      expect(s.body.weeks[0].days[0]).toMatchObject({ date: W16, dow: 'Mon' });
      expect((await f.call('P01', 'GET', '/workload')).body.from).toBe(W16);
      expect((await f.call('P01', 'GET', '/calendar')).body.from).toBe(W16);
    } finally {
      vi.useRealTimers();
    }
    // Any day of a week reads as its Monday.
    expect((await f.call('P01', 'GET', '/workload?from=2026-11-22&weeks=1')).body.weeks).toEqual([W16]);
    expect((await f.call('P05', 'GET', '/me/schedule?from=2026-11-18&weeks=1')).body.from).toBe(W16);
  });
});
