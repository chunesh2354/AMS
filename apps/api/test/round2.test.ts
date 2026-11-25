import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshApp, type Fresh } from './helpers';
import { cascade, forecast, reaches, type GraphTask } from '../src/modules/schedule/graph';
import { combine, hoursSignal, marginSignal, scheduleSignal, tasksSignal } from '../src/modules/schedule/health';

/**
 * Round 2 (migration 012): sub-tasks, dependencies, followers, time on tasks, the Gantt schedule, rescheduling with
 * cascade, and project health. Demo studio: Vikram (P02) is PM of PRJ-01 and PRJ-03 with Rohan (P04), Divya (P05) and
 * Arjun (P08) on PRJ-01; Meera (P03) is PM of PRJ-02 with Rohan, Karan (P06) and Sneha (P07). Nisha (P09) is on no
 * team. Asha (P01) is the principal; Farah (P10) operations + finance. The seed's today is 2026-11-06, so every
 * date-sensitive call passes as_of=2026-11-06.
 */
const AS_OF = '2026-11-06';
let f: Fresh;
beforeAll(async () => { f = await freshApp(); });
afterAll(async () => { await f?.close(); });

const phaseId = async (fx: Fresh, project: string, code: string) => (await fx.owner.query(
  'select ph.id from phase ph join project p on p.id = ph.project_id where p.code = $1 and ph.code = $2', [project, code],
)).rows[0].id as string;
const create = (fx: Fresh, ref: string, project: string, body: Record<string, unknown>) => fx.call(ref, 'POST', `/projects/${project}/tasks`, body);
const taskRow = async (id: string) => (await f.owner.query('select * from task where id = $1', [id])).rows[0];
const notes = async (fx: Fresh, ref: string, taskId: string, type?: string) => (await fx.owner.query(
  `select event_type, text from notification where person_id = $1 and record_type = 'task' and record_id = $2 ${type ? 'and event_type = $3' : ''} order by created_at`,
  type ? [fx.id(ref), taskId, type] : [fx.id(ref), taskId],
)).rows;
const mk = async (title: string, body: Record<string, unknown> = {}, project = 'PRJ-01', ref = 'P02') => {
  const r = await create(f, ref, project, { title, ...body });
  if (r.status !== 200) throw new Error(`create ${title}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.id as string;
};
const link = (ref: string, successor: string, predecessor: string, lag_days?: number) => f.call(ref, 'POST', `/tasks/${successor}/dependencies`, { predecessor_id: predecessor, ...(lag_days == null ? {} : { lag_days }) });

describe('sub-tasks', () => {
  it('a planner adds sub-tasks, which take the parent phase; anyone who sees the parent lists them', async () => {
    const wd = await phaseId(f, 'PRJ-01', 'WD');
    const parent = await mk('Facade package', { phase_id: wd, assignee_id: f.id('P05'), estimate_hours: 10, start_date: '2027-01-04', due_date: '2027-01-29' });
    const a = await f.call('P02', 'POST', `/tasks/${parent}/subtasks`, { title: 'North elevation', estimate_hours: 6, assignee_id: f.id('P05') });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ parent_task_id: parent, phase: { id: wd }, estimate_hours: '6.00', title: 'North elevation', sort_order: 0 });
    const b = await f.call('P02', 'POST', `/tasks/${parent}/subtasks`, { title: 'South elevation', estimate_hours: '4.5', status: 'Done' });
    expect(b.body.sort_order).toBe(1);

    const listed = await f.call('P05', 'GET', `/tasks/${parent}/subtasks`);
    expect(listed.status).toBe(200);
    expect(listed.body.data.map((t: any) => t.title)).toEqual(['North elevation', 'South elevation']);
    expect(listed.body.can_plan).toBe(false);

    const detail = await f.call('P05', 'GET', `/tasks/${parent}`);
    expect(detail.status).toBe(200);
    expect(detail.body.subtask_count).toBe(2);
    expect(detail.body.subtasks.map((t: any) => t.id)).toEqual([a.body.id, b.body.id]);
    expect(detail.body.estimate).toMatchObject({
      estimate_hours: '10.00', logged_hours: '0.00', remaining_hours: '10.00', over_estimate: false,
      subtasks: { estimate_hours: '10.50', logged_hours: '0.00' }, total: { estimate_hours: '20.50', logged_hours: '0.00' },
    });
    expect(detail.body).toMatchObject({ blocked_by: [], blocks: [], followers: [], is_following: false, start_date: '2027-01-04' });
  });

  it('one level only, planners only, and validated like a task', async () => {
    const parent = await mk('Roof package');
    const sub = (await f.call('P02', 'POST', `/tasks/${parent}/subtasks`, { title: 'Gutters' })).body.id;
    const nested = await f.call('P02', 'POST', `/tasks/${sub}/subtasks`, { title: 'Downpipes' });
    expect(nested.status).toBe(422);
    expect(nested.body.error.details[0].code).toBe('one_level');
    expect((await f.call('P05', 'POST', `/tasks/${parent}/subtasks`, { title: 'Staff sub-task' })).status).toBe(403);
    expect((await f.call('P03', 'POST', `/tasks/${parent}/subtasks`, { title: 'Other PM' })).status).toBe(403);
    expect((await f.call('P09', 'GET', `/tasks/${parent}/subtasks`)).status).toBe(403);
    const order = await f.call('P02', 'POST', `/tasks/${parent}/subtasks`, { title: 'Bad dates', start_date: '2027-02-02', due_date: '2027-02-01' });
    expect(order.status).toBe(400);
    expect(order.body.error.details[0]).toEqual({ field: 'start_date', code: 'order' });
    const est = await f.call('P02', 'POST', `/tasks/${parent}/subtasks`, { title: 'Bad estimate', estimate_hours: -1 });
    expect(est.body.error.details[0].field).toBe('estimate_hours');
    // The database keeps the rule too.
    await expect(f.owner.query('update task set parent_task_id = $1 where id = $2', [sub, (await mk('Loose task'))])).rejects.toThrow(/cannot have sub-tasks/);

    const del = await f.call('P02', 'DELETE', `/tasks/${parent}`);
    expect(del.status).toBe(200);
    expect(await taskRow(sub)).toBeUndefined();
    const ev = (await f.owner.query('select previous from audit_event where id = $1', [del.body.audit_event_id])).rows[0];
    expect(ev.previous.subtask_ids).toEqual([sub]);
  });

  it('PUT /tasks/:id takes start_date and estimate_hours from planners only', async () => {
    const id = await mk('Joinery schedule', { assignee_id: f.id('P05'), due_date: '2027-02-10' });
    const r = await f.call('P02', 'PUT', `/tasks/${id}`, { start_date: '2027-02-01', estimate_hours: 12 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ start_date: '2027-02-01', estimate_hours: '12.00' });
    const ev = (await f.owner.query(`select previous, new from audit_event where id = $1`, [r.body.audit_event_id])).rows[0];
    expect(ev).toEqual({ previous: { start_date: null, estimate_hours: null }, new: { start_date: '2027-02-01', estimate_hours: 12 } });
    expect((await f.call('P02', 'PUT', `/tasks/${id}`, { start_date: '2027-02-11' })).status).toBe(400);
    const staff = await f.call('P05', 'PUT', `/tasks/${id}`, { estimate_hours: 2 });
    expect(staff.status).toBe(403);
    expect(staff.body.error.details).toEqual([{ field: 'estimate_hours', code: 'planner_only' }]);
  });
});

describe('dependencies', () => {
  let a: string; let b: string; let c: string;
  beforeAll(async () => {
    a = await mk('Survey', { due_date: '2027-03-05' });
    b = await mk('Site plan', { due_date: '2027-03-12' });
    c = await mk('Massing', { due_date: '2027-03-19' });
  });

  it('a planner links tasks; both sides show the link', async () => {
    const r = await link('P02', b, a, 1);
    expect(r.status).toBe(200);
    expect(r.body.dependency).toMatchObject({ predecessor_id: a, successor_id: b, type: 'finish_to_start', lag_days: 1 });
    expect(r.body.task.blocked_by).toEqual([expect.objectContaining({ dependency_id: r.body.dependency.id, lag_days: 1, task: expect.objectContaining({ id: a, title: 'Survey' }) })]);
    // successor_id works from the other end.
    const r2 = await f.call('P02', 'POST', `/tasks/${b}/dependencies`, { successor_id: c });
    expect(r2.status).toBe(200);
    expect(r2.body.task.blocks.map((x: any) => x.task.id)).toEqual([c]);
    const detail = (await f.call('P04', 'GET', `/tasks/${b}`)).body;
    expect(detail.blocked_by.map((x: any) => x.task.id)).toEqual([a]);
    expect(detail.blocks.map((x: any) => x.task.id)).toEqual([c]);
    expect((await f.owner.query(`select count(*)::int n from audit_event where record_type = 'task' and action = 'add_dependency' and record_id in ($1, $2)`, [b, c])).rows[0].n).toBe(2);
  });

  it('refuses a cycle, direct or transitive, and a self-link, with 422', async () => {
    const cycle = await link('P02', a, c);
    expect(cycle.status).toBe(422);
    expect(cycle.body.error.rule).toBe('AC-F09-2');
    expect(cycle.body.error.details[0].code).toBe('cycle');
    const back = await link('P02', a, b);
    expect(back.status).toBe(422);
    const self = await link('P02', a, a);
    expect(self.status).toBe(422);
    expect(self.body.error.details[0].code).toBe('self');
    // The trigger refuses a cycle written straight to the database as well.
    await expect(f.owner.query(`insert into task_dependency (firm_id, predecessor_id, successor_id) values ($1,$2,$3)`, [f.firmId, c, a])).rejects.toThrow(/cycle/);
    expect((await f.owner.query('select count(*)::int n from task_dependency where successor_id = $1', [a])).rows[0].n).toBe(0);
  });

  it('refuses duplicates, other projects, a parent and its sub-task, bad lags, and non-planners', async () => {
    expect((await link('P02', b, a)).status).toBe(409);
    const other = await mk('Orchard task', {}, 'PRJ-02', 'P03');
    const cross = await link('P01', a, other);
    expect(cross.status).toBe(422);
    expect(cross.body.error.details[0].code).toBe('other_project');
    const sub = (await f.call('P02', 'POST', `/tasks/${a}/subtasks`, { title: 'Survey brief' })).body.id;
    expect((await link('P02', sub, a)).body.error.details[0].code).toBe('parent_child');
    expect((await link('P02', c, sub, 1000)).status).toBe(400);
    expect((await f.call('P02', 'POST', `/tasks/${c}/dependencies`, { predecessor_id: a, successor_id: b })).status).toBe(400);
    expect((await link('P02', c, randomUUID())).status).toBe(404);
    expect((await link('P05', c, a)).status).toBe(403);
    expect((await link('P03', c, a)).status).toBe(403);
  });

  it('a planner removes a link from either task; an unrelated id is 404', async () => {
    const d = await link('P02', c, a);
    expect(d.status).toBe(200);
    const depId = d.body.dependency.id;
    expect((await f.call('P02', 'DELETE', `/tasks/${b}/dependencies/${depId}`)).status).toBe(404);
    expect((await f.call('P05', 'DELETE', `/tasks/${a}/dependencies/${depId}`)).status).toBe(403);
    const r = await f.call('P02', 'DELETE', `/tasks/${a}/dependencies/${depId}`);
    expect(r.status).toBe(200);
    expect(r.body.deleted).toBe(true);
    expect((await f.owner.query('select 1 from task_dependency where id = $1', [depId])).rowCount).toBe(0);
    expect((await f.owner.query('select action from audit_event where id = $1', [r.body.audit_event_id])).rows[0].action).toBe('remove_dependency');
  });
});

describe('followers', () => {
  let t: string;
  beforeAll(async () => { t = await mk('Lift core detail', { assignee_id: f.id('P08') }); });

  it('anyone who can see the task follows themselves; planners add others who can see it', async () => {
    const me = await f.call('P04', 'POST', `/tasks/${t}/followers`, {});
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ following: true, added: true, person_id: f.id('P04') });
    expect((await f.call('P04', 'POST', `/tasks/${t}/followers`, {})).body.added).toBe(false);
    expect((await f.call('P09', 'POST', `/tasks/${t}/followers`, {})).status).toBe(403);
    expect((await f.call('P04', 'POST', `/tasks/${t}/followers`, { person_id: f.id('P05') })).status).toBe(403);

    const added = await f.call('P02', 'POST', `/tasks/${t}/followers`, { person_id: f.id('P05') });
    expect(added.status).toBe(200);
    expect(added.body.followers.map((x: any) => x.id).sort()).toEqual([f.id('P04'), f.id('P05')].sort());
    expect(await notes(f, 'P05', t, 'task_followed')).toEqual([{ event_type: 'task_followed', text: 'Vikram Nair added you as a follower of "Lift core detail" on PRJ-01.' }]);
    const offTeam = await f.call('P02', 'POST', `/tasks/${t}/followers`, { person_id: f.id('P09') });
    expect(offTeam.status).toBe(422);
    expect(offTeam.body.error.details[0].code).toBe('not_member');
    expect((await f.call('P02', 'POST', `/tasks/${t}/followers`, { person_id: randomUUID() })).status).toBe(400);
    const detail = (await f.call('P04', 'GET', `/tasks/${t}`)).body;
    expect(detail.is_following).toBe(true);
  });

  it('followers hear about status changes and new notes, never about their own', async () => {
    const r = await f.call('P08', 'PUT', `/tasks/${t}`, { status: 'In progress', note: 'Started the core' });
    expect(r.status).toBe(200);
    for (const ref of ['P04', 'P05']) {
      expect(await notes(f, ref, t, 'task_status_changed')).toEqual([{ event_type: 'task_status_changed', text: 'Arjun Das moved "Lift core detail" on PRJ-01 from To do to In progress.' }]);
      expect(await notes(f, ref, t, 'task_note_added')).toEqual([{ event_type: 'task_note_added', text: 'Arjun Das added a note to "Lift core detail" on PRJ-01.' }]);
    }
    // A follower's own note tells the others but not them.
    await f.call('P02', 'POST', `/tasks/${t}/followers`, { person_id: f.id('P08') });
    const own = await f.call('P08', 'PUT', `/tasks/${t}`, { note: 'Check the pit depth' });
    expect(own.status).toBe(200);
    expect((await notes(f, 'P08', t, 'task_note_added')).length).toBe(0);
    expect((await notes(f, 'P04', t, 'task_note_added')).length).toBe(2);
  });

  it('the creator who follows is told once when the assignee completes', async () => {
    await f.call('P02', 'POST', `/tasks/${t}/followers`, {});
    await f.call('P08', 'PUT', `/tasks/${t}`, { status: 'Done' });
    expect((await notes(f, 'P02', t)).map((n) => n.event_type)).toEqual(['task_completed']);
    expect((await notes(f, 'P04', t, 'task_status_changed')).length).toBe(2);
  });

  it('a follower unfollows themselves; a planner removes someone else; staff cannot remove others', async () => {
    expect((await f.call('P04', 'DELETE', `/tasks/${t}/followers/${f.id('P05')}`)).status).toBe(403);
    const self = await f.call('P04', 'DELETE', `/tasks/${t}/followers`);
    expect(self.status).toBe(200);
    expect(self.body).toMatchObject({ following: false, removed: true });
    const other = await f.call('P02', 'DELETE', `/tasks/${t}/followers?person_id=${f.id('P05')}`);
    expect(other.body.removed).toBe(true);
    expect(other.body.followers.map((x: any) => x.id).sort()).toEqual([f.id('P02'), f.id('P08')].sort());
    expect((await f.owner.query(`select count(*)::int n from audit_event where record_type = 'task' and record_id = $1 and action = 'unfollow'`, [t])).rows[0].n).toBe(2);
  });
});

describe('time on tasks', () => {
  let wd: string; let cd: string; let task: string;
  const DAY = '2026-11-24';
  beforeAll(async () => {
    wd = await phaseId(f, 'PRJ-01', 'WD');
    cd = await phaseId(f, 'PRJ-01', 'CD');
    task = await mk('Window schedule', { phase_id: wd, assignee_id: f.id('P05'), estimate_hours: 5 });
  });

  it('POST /time-entries takes a task of the same project and phase (the phase can come from the task)', async () => {
    const r = await f.call('P05', 'POST', '/time-entries', { service_date: DAY, duration_hours: 2, task_id: task });
    expect(r.status).toBe(200);
    expect(r.body.task_id).toBe(task);
    const row = (await f.owner.query('select phase_id, project_id, task_id from time_entry where id = $1', [r.body.id])).rows[0];
    expect(row.phase_id).toBe(wd);
    const explicit = await f.call('P05', 'POST', '/time-entries', { service_date: DAY, duration_hours: 1, phase_id: wd, task_id: task });
    expect(explicit.status).toBe(200);
    const detail = (await f.call('P05', 'GET', `/tasks/${task}`)).body;
    expect(detail.logged_hours).toBe('3.00');
    expect(detail.estimate).toMatchObject({ estimate_hours: '5.00', logged_hours: '3.00', remaining_hours: '2.00' });
    expect(detail.approved_hours).toBe('0.00');
  });

  it('refuses a task of another phase or project, a task with no phase, internal time with a task, and an unknown task', async () => {
    const wrongPhase = await f.call('P05', 'POST', '/time-entries', { service_date: DAY, duration_hours: 1, phase_id: cd, task_id: task });
    expect(wrongPhase.status).toBe(422);
    expect(wrongPhase.body.error.details[0]).toEqual({ field: 'task_id', code: 'not_on_phase' });
    const orchard = await mk('Orchard drawings', { phase_id: await phaseId(f, 'PRJ-02', 'SD') }, 'PRJ-02', 'P03');
    const otherProject = await f.call('P04', 'POST', '/time-entries', { service_date: DAY, duration_hours: 1, phase_id: wd, task_id: orchard });
    expect(otherProject.status).toBe(422);
    const noPhase = await f.call('P05', 'POST', '/time-entries', { service_date: DAY, duration_hours: 1, task_id: await mk('Unphased') });
    expect(noPhase.body.error.details[0].code).toBe('no_phase');
    const cat = (await f.owner.query(`select id from internal_work_category where key = 'admin'`)).rows[0].id;
    const internal = await f.call('P05', 'POST', '/time-entries', { service_date: DAY, duration_hours: 1, internal_category_id: cat, task_id: task });
    expect(internal.status).toBe(422);
    expect(internal.body.error.rule).toBe('R2');
    expect((await f.call('P05', 'POST', '/time-entries', { service_date: DAY, duration_hours: 1, task_id: randomUUID() })).status).toBe(404);
    // Membership rules are unchanged: a task does not let someone off the team log time.
    const offTeam = await f.call('P06', 'POST', '/time-entries', { service_date: DAY, duration_hours: 1, task_id: task });
    expect(offTeam.status).toBe(403);
    expect(offTeam.body.error.code).toBe('NOT_PROJECT_MEMBER');
    // The database refuses a mismatch written directly.
    const e = (await f.owner.query('select id from time_entry where task_id = $1 limit 1', [task])).rows[0].id;
    await expect(f.owner.query('update time_entry set task_id = $2 where id = $1', [e, orchard])).rejects.toThrow(/same project and phase/);
  });

  it('PUT /me/time/cell keeps task lines apart from the plain phase line', async () => {
    const DAY2 = '2026-11-25';
    expect((await f.call('P05', 'PUT', '/me/time/cell', { service_date: DAY2, phase_id: wd, duration_hours: 3 })).status).toBe(200);
    expect((await f.call('P05', 'PUT', '/me/time/cell', { service_date: DAY2, task_id: task, duration_hours: 1.5 })).status).toBe(200);
    expect((await f.call('P05', 'PUT', '/me/time/cell', { service_date: DAY2, phase_id: wd, duration_hours: 4 })).status).toBe(200);
    const rows = (await f.owner.query(`select task_id, duration_hours from time_entry where person_id = $1 and service_date = $2 order by task_id nulls first`, [f.id('P05'), DAY2])).rows;
    expect(rows).toEqual([{ task_id: null, duration_hours: '4.00' }, { task_id: task, duration_hours: '1.50' }]);
    const week = (await f.call('P05', 'GET', `/me/time?period=${DAY2}`)).body;
    const taskLine = week.lines.find((l: any) => l.key === `${wd}:${task}`);
    expect(taskLine).toMatchObject({ phase_id: wd, task_id: task, task: { id: task, title: 'Window schedule' } });
    expect(taskLine.hours[2]).toBe(1.5);
    expect(week.lines.find((l: any) => l.key === wd).hours[2]).toBe(4);
    expect((await f.call('P05', 'PUT', '/me/time/cell', { service_date: DAY2, phase_id: cd, task_id: task, duration_hours: 1 })).status).toBe(422);
    // Clearing the task cell leaves the phase line alone.
    await f.call('P05', 'PUT', '/me/time/cell', { service_date: DAY2, phase_id: wd, task_id: task, duration_hours: 0 });
    expect((await f.owner.query(`select count(*)::int n from time_entry where person_id = $1 and service_date = $2`, [f.id('P05'), DAY2])).rows[0].n).toBe(1);
  });

  it('timers carry the task through to the entry; corrections and phase changes keep the rule', async () => {
    const start = await f.call('P05', 'POST', '/timers/start', { task_id: task });
    expect(start.status).toBe(200);
    expect(start.body).toMatchObject({ phase_id: wd, task_id: task });
    expect((await f.call('P05', 'GET', '/timers/active')).body.active).toMatchObject({ task_id: task, task_title: 'Window schedule', phase_id: wd });
    const stop = await f.call('P05', 'POST', '/timers/stop');
    expect(stop.status).toBe(200);
    expect(stop.body.task_id).toBe(task);
    expect((await f.owner.query('select task_id from time_entry where id = $1', [stop.body.time_entry_id])).rows[0].task_id).toBe(task);
    expect((await f.call('P05', 'POST', '/timers/start', { phase_id: cd, task_id: task })).status).toBe(422);

    // A task with time keeps its phase.
    const move = await f.call('P02', 'PUT', `/tasks/${task}`, { phase_id: cd });
    expect(move.status).toBe(422);
    expect(move.body.error.details[0].code).toBe('has_time');
    // Moving an entry to another phase drops a task that belonged to the old one.
    const e = (await f.owner.query(`select id from time_entry where task_id = $1 and approval_state = 'Draft' order by created_at limit 1`, [task])).rows[0].id;
    expect((await f.call('P05', 'PUT', `/time-entries/${e}`, { phase_id: cd })).status).toBe(200);
    expect((await f.owner.query('select phase_id, task_id from time_entry where id = $1', [e])).rows[0]).toEqual({ phase_id: cd, task_id: null });
    expect((await f.call('P05', 'PUT', `/time-entries/${e}`, { task_id: task })).status).toBe(422);
    expect((await f.call('P05', 'PUT', `/time-entries/${e}`, { phase_id: wd, task_id: task })).status).toBe(200);

    // A correction keeps the task.
    await f.owner.query(`update time_entry set approval_state = 'Approved' where id = $1`, [e]);
    const fix = await f.call('P05', 'POST', `/time-entries/${e}/correct`, { duration_hours: 0.5, reason: 'Overstated' });
    expect(fix.status).toBe(200);
    expect((await f.owner.query('select task_id from time_entry where id = $1', [fix.body.id])).rows[0].task_id).toBe(task);

    // Putting an entry on a task keeps its fee component (R10), on a phase with two components.
    const sd2 = await phaseId(f, 'PRJ-02', 'SD');
    const nte = (await f.owner.query(`select c.id from fee_component c join project p on p.id = c.project_id where p.code = 'PRJ-02' and c.billing_method = 'hourly_nte'`)).rows[0].id;
    await f.owner.query('insert into phase_fee_allocation (firm_id, phase_id, fee_component_id, amount) values ($1,$2,$3,0)', [f.firmId, sd2, nte]);
    const sdTask = await mk('Orchard sections', { phase_id: sd2 }, 'PRJ-02', 'P03');
    const onNte = (await f.call('P04', 'POST', '/time-entries', { service_date: DAY, duration_hours: 1, phase_id: sd2, fee_component_id: nte })).body.id;
    expect((await f.call('P04', 'PUT', `/time-entries/${onNte}`, { task_id: sdTask })).status).toBe(200);
    expect((await f.owner.query('select fee_component_id, task_id from time_entry where id = $1', [onNte])).rows[0]).toEqual({ fee_component_id: nte, task_id: sdTask });

    // Deleting a task keeps its hours on the phase.
    const gone = await mk('Short-lived', { phase_id: wd });
    const kept = (await f.call('P05', 'POST', '/time-entries', { service_date: DAY, duration_hours: 0.5, task_id: gone })).body.id;
    expect((await f.call('P02', 'DELETE', `/tasks/${gone}`)).status).toBe(200);
    expect((await f.owner.query('select phase_id, task_id from time_entry where id = $1', [kept])).rows[0]).toEqual({ phase_id: wd, task_id: null });
  });
});

describe('rescheduling with cascade', () => {
  let a: string; let b: string; let c: string; let d: string; let done: string; let unrelated: string;
  beforeAll(async () => {
    a = await mk('Tender set', { start_date: '2027-01-04', due_date: '2027-01-08', assignee_id: f.id('P04') });
    b = await mk('Tender queries', { start_date: '2027-01-11', due_date: '2027-01-15', assignee_id: f.id('P05') });
    c = await mk('Tender report', { start_date: '2027-01-18', due_date: '2027-01-20' });
    d = await mk('Contract award', { due_date: '2027-01-21' });
    done = await mk('Bidder list', { start_date: '2027-01-11', due_date: '2027-01-11', status: 'Done' });
    unrelated = await mk('Unrelated', { start_date: '2027-01-11', due_date: '2027-01-12' });
    expect((await link('P02', b, a)).status).toBe(200); // B starts the day after A
    expect((await link('P02', c, b, 2)).status).toBe(200); // C starts 3 days after B ends
    expect((await link('P02', d, b, 4)).status).toBe(200); // D (due only) waits 4 days after B
    expect((await link('P02', d, c)).status).toBe(200);
    expect((await link('P02', done, a)).status).toBe(200);
    await f.call('P02', 'POST', `/tasks/${c}/followers`, { person_id: f.id('P08') });
  });

  it('refuses staff and other PMs, and dates out of order', async () => {
    expect((await f.call('P05', 'PUT', `/tasks/${a}/dates`, { start_date: '2027-01-05' })).status).toBe(403);
    expect((await f.call('P03', 'PUT', `/tasks/${a}/dates`, { start_date: '2027-01-05' })).status).toBe(403);
    // Operations and finance hold projects.plan only to view unless a principal grants it.
    expect((await f.call('P10', 'PUT', `/tasks/${a}/dates`, { start_date: '2027-01-05' })).status).toBe(403);
    expect((await f.call('P09', 'PUT', `/tasks/${a}/dates`, { start_date: '2027-01-05' })).status).toBe(403);
    const order = await f.call('P02', 'PUT', `/tasks/${a}/dates`, { start_date: '2027-01-10', due_date: '2027-01-08' });
    expect(order.status).toBe(400);
    expect(order.body.error.details[0]).toEqual({ field: 'start_date', code: 'order' });
    expect((await f.call('P02', 'PUT', `/tasks/${a}/dates`, { due_date: '2027-01-09', end_date: '2027-01-10' })).status).toBe(400);
    expect((await f.call('P02', 'PUT', `/tasks/${a}/dates`, { start_date: '2027-01-05', cascade: 'yes' })).status).toBe(400);
    expect((await taskRow(a)).start_date).toBe('2027-01-04');
  });

  it('without cascade only the task moves, and broken links come back as violations', async () => {
    const r = await f.call('P02', 'PUT', `/tasks/${a}/dates`, { start_date: '2027-01-05', end_date: '2027-01-11' });
    expect(r.status).toBe(200);
    expect(r.body.moved.map((m: any) => m.id)).toEqual([a]);
    expect(r.body.violations).toEqual([expect.objectContaining({ predecessor_id: a, successor_id: b, earliest_start: '2027-01-12' })]);
    expect((await taskRow(b)).start_date).toBe('2027-01-11');
    await f.call('P02', 'PUT', `/tasks/${a}/dates`, { start_date: '2027-01-04', due_date: '2027-01-08' });
  });

  it('with cascade, successors move transitively, with lag, just far enough; Done and unrelated tasks stay', async () => {
    const r = await f.call('P02', 'PUT', `/tasks/${a}/dates`, { start_date: '2027-01-06', due_date: '2027-01-12', cascade: true });
    expect(r.status).toBe(200);
    expect(r.body.task).toMatchObject({ start_date: '2027-01-06', due_date: '2027-01-12' });
    const byId = Object.fromEntries(r.body.moved.map((m: any) => [m.id, m]));
    expect(Object.keys(byId).sort()).toEqual([a, b, c, d].sort());
    expect(byId[a]).toMatchObject({ kind: 'task', cause: 'requested', previous: { start_date: '2027-01-04', end_date: '2027-01-08' }, next: { start_date: '2027-01-06', end_date: '2027-01-12' } });
    // B: earliest start 13 Jan (A ends 12 Jan, lag 0) -> +2 days, duration kept.
    expect(byId[b]).toMatchObject({ cause: 'dependency', shifted_days: 2, next: { start_date: '2027-01-13', end_date: '2027-01-17' } });
    // C: B ends 17 Jan, lag 2 -> starts 20 Jan.
    expect(byId[c]).toMatchObject({ shifted_days: 2, next: { start_date: '2027-01-20', end_date: '2027-01-22' } });
    // D (due only): latest of B + 1 + 4 = 22 Jan and C + 1 = 23 Jan.
    expect(byId[d]).toMatchObject({ next: { start_date: null, end_date: '2027-01-23' }, shifted_days: 2 });
    expect(r.body.violations).toEqual([]);
    expect(await taskRow(done)).toMatchObject({ start_date: '2027-01-11', due_date: '2027-01-11' });
    expect(await taskRow(unrelated)).toMatchObject({ start_date: '2027-01-11', due_date: '2027-01-12' });

    // Each move audited; the assignee and followers told; the actor not.
    for (const id of [a, b, c, d]) {
      const ev = (await f.owner.query(`select previous, new, reason from audit_event where record_type = 'task' and record_id = $1 and action = 'reschedule' order by created_at desc limit 1`, [id])).rows[0];
      expect(ev).toBeTruthy();
      if (id !== a) expect(ev.reason).toBe('Follows "Tender set"');
    }
    expect((await notes(f, 'P04', a, 'task_rescheduled')).at(-1)).toEqual({ event_type: 'task_rescheduled', text: 'Vikram Nair rescheduled "Tender set" on PRJ-01: 2027-01-06 to 2027-01-12.' });
    expect((await notes(f, 'P05', b, 'task_rescheduled')).length).toBe(1);
    expect((await notes(f, 'P08', c, 'task_rescheduled')).length).toBe(1);
    expect((await notes(f, 'P02', a, 'task_rescheduled')).length).toBe(0);

    // Moving earlier never pulls successors back.
    const earlier = await f.call('P02', 'PUT', `/tasks/${a}/dates`, { start_date: '2027-01-04', due_date: '2027-01-08', cascade: true });
    expect(earlier.body.moved.map((m: any) => m.id)).toEqual([a]);
    expect((await taskRow(b)).start_date).toBe('2027-01-13');
  });

  it('a parent moved with cascade takes its open sub-tasks along', async () => {
    const parent = await mk('Fit-out set', { start_date: '2027-03-01', due_date: '2027-03-12' });
    const s1 = (await f.call('P02', 'POST', `/tasks/${parent}/subtasks`, { title: 'Ceilings', start_date: '2027-03-02', due_date: '2027-03-04' })).body.id;
    const s2 = (await f.call('P02', 'POST', `/tasks/${parent}/subtasks`, { title: 'Floors', due_date: '2027-03-05', status: 'Done' })).body.id;
    const r = await f.call('P02', 'PUT', `/tasks/${parent}/dates`, { start_date: '2027-03-08', due_date: '2027-03-19', cascade: true });
    expect(r.body.shifted_days).toBe(7);
    expect(r.body.moved.find((m: any) => m.id === s1)).toMatchObject({ cause: 'parent_moved', next: { start_date: '2027-03-09', end_date: '2027-03-11' } });
    expect((await taskRow(s2)).due_date).toBe('2027-03-05');
  });

  it('moving a phase with cascade moves its open tasks by the same delta, then their successors', async () => {
    const tn = await phaseId(f, 'PRJ-01', 'TN');
    const ss = await phaseId(f, 'PRJ-01', 'SS');
    const t1 = await mk('Issue tender', { phase_id: tn, start_date: '2027-01-11', due_date: '2027-01-15' });
    const t2 = await mk('Tender closed', { phase_id: tn, due_date: '2027-02-05', status: 'Done' });
    const s1 = await mk('Site mobilisation', { phase_id: ss, start_date: '2027-01-18', due_date: '2027-01-22' });
    await link('P02', s1, t1);

    const plain = await f.call('P02', 'PUT', `/phases/${tn}/dates`, { start_date: '2026-12-22', end_date: '2027-02-06' });
    expect(plain.status).toBe(200);
    expect(plain.body.moved.map((m: any) => m.kind)).toEqual(['phase']);
    expect((await taskRow(t1)).start_date).toBe('2027-01-11');

    const r = await f.call('P02', 'PUT', `/phases/${tn}/dates`, { start_date: '2026-12-29', end_date: '2027-02-13', cascade: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ phase: { id: tn, start_date: '2026-12-29', end_date: '2027-02-13' }, shifted_days: 7, cascade: true });
    const byId = Object.fromEntries(r.body.moved.map((m: any) => [m.id, m]));
    expect(byId[tn]).toMatchObject({ kind: 'phase', cause: 'requested', previous: { start_date: '2026-12-22', end_date: '2027-02-06' } });
    expect(byId[t1]).toMatchObject({ cause: 'phase_moved', shifted_days: 7, next: { start_date: '2027-01-18', end_date: '2027-01-22' } });
    expect(byId[s1]).toMatchObject({ cause: 'dependency', next: { start_date: '2027-01-23', end_date: '2027-01-27' } });
    expect(byId[t2]).toBeUndefined();
    const ev = (await f.owner.query('select record_type, previous, new from audit_event where id = $1', [r.body.audit_event_id])).rows[0];
    expect(ev).toMatchObject({ record_type: 'phase', previous: { start_date: '2026-12-22', end_date: '2027-02-06' }, new: { start_date: '2026-12-29', end_date: '2027-02-13', cascade: true } });

    expect((await f.call('P02', 'PUT', `/phases/${tn}/dates`, { start_date: '2027-03-01' })).status).toBe(400);
    expect((await f.call('P05', 'PUT', `/phases/${tn}/dates`, { end_date: '2027-03-01' })).status).toBe(403);
    expect((await f.call('P03', 'PUT', `/phases/${tn}/dates`, { end_date: '2027-03-01' })).status).toBe(403);
    expect((await f.call('P02', 'PUT', `/phases/${randomUUID()}/dates`, { end_date: '2027-03-01' })).status).toBe(404);
    // The principal may reschedule anywhere.
    expect((await f.call('P01', 'PUT', `/phases/${await phaseId(f, 'PRJ-02', 'WD')}/dates`, { end_date: '2027-06-30' })).status).toBe(200);
  });
});

describe('schedule', () => {
  it('GET /projects/:code/schedule: phases, milestones, tasks with forecast and dependencies, today', async () => {
    const cd = await phaseId(f, 'PRJ-01', 'CD');
    const late = await mk('Concept sign-off pack', { phase_id: cd, start_date: '2026-12-01', due_date: '2026-12-10', assignee_id: f.id('P04') });
    const overdue = await mk('Client brief notes', { phase_id: cd, due_date: '2026-11-02' });
    await link('P02', late, overdue);

    const r = await f.call('P05', 'GET', `/projects/PRJ-01/schedule?as_of=${AS_OF}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ today: AS_OF, as_of: AS_OF, timezone: 'Asia/Kolkata', can_reschedule: false, project: { code: 'PRJ-01', pm: { ref_code: 'P02' } } });
    expect(r.body.phases.map((p: any) => p.code)).toEqual(['CD', 'SD', 'DD', 'WD', 'TN', 'SS']);
    const phase = r.body.phases[0];
    expect(phase).toMatchObject({
      code: 'CD', start_date: '2026-02-02', end_date: '2026-11-27', progress_pct: 60, status: 'In progress',
      budget_hours: '140.00', etc_hours: '22.00', forecast_end: '2026-12-10', slip_days: 13,
    });
    expect(typeof phase.actual_hours).toBe('string');
    const t = r.body.tasks.find((x: any) => x.id === late);
    expect(t).toMatchObject({
      start_date: '2026-12-01', due_date: '2026-12-10', forecast_start: '2026-12-01', forecast_end: '2026-12-10', progress_pct: 0,
      assignee: { ref_code: 'P04' }, dependencies: [expect.objectContaining({ predecessor_id: overdue, lag_days: 0 })], overdue: false,
    });
    expect(r.body.tasks.find((x: any) => x.id === overdue)).toMatchObject({ overdue: true, blocking: true, forecast_end: AS_OF, slip_days: 4 });
    // The project slip is the worst phase slip (Working drawings holds a task running to 29 Jan 2027).
    expect(r.body.planned_start).toBe('2026-02-02');
    expect(r.body.slip_days).toBe(Math.max(...r.body.phases.map((p: any) => p.slip_days ?? 0)));
    expect(r.body.phases.find((p: any) => p.code === 'WD')).toMatchObject({ forecast_end: '2027-01-29', slip_days: 42 });
    expect(r.body.slip_driver).toEqual({ kind: 'phase', id: r.body.phases.find((p: any) => p.code === 'WD').id, name: 'Working drawings' });
    expect(r.body.dependencies.length).toBeGreaterThan(0);
    expect(Array.isArray(r.body.definition)).toBe(true);
    expect(r.body.blocking_overdue_tasks).toBe(1);

    const prj2 = await f.call('P03', 'GET', `/projects/PRJ-02/schedule?as_of=${AS_OF}`);
    expect(prj2.body.can_reschedule).toBe(true);
    const ms = prj2.body.milestones;
    expect(ms.map((m: any) => m.label).sort()).toEqual(['Concept design milestone', 'Schematic design milestone']);
    expect(ms.find((m: any) => m.label === 'Schematic design milestone')).toMatchObject({ date: '2026-12-04', date_source: 'phase_end', status: 'Authorized' });
    expect(JSON.stringify(ms)).not.toMatch(/amount/);
    await f.owner.query(`update billing_milestone set planned_date = '2026-11-30' where label = 'Schematic design milestone'`);
    expect((await f.call('P03', 'GET', `/projects/PRJ-02/schedule`)).body.milestones.find((m: any) => m.label === 'Schematic design milestone')).toMatchObject({ date: '2026-11-30', date_source: 'planned' });
    expect((await f.call('P05', 'GET', '/projects/PRJ-02/schedule')).status).toBe(403);
    expect((await f.call('P05', 'GET', '/projects/PRJ-404/schedule')).status).toBe(404);
  });

  it('GET /schedule lists visible projects rolled up, filtered by pm and status', async () => {
    const all = await f.call('P01', 'GET', `/schedule?as_of=${AS_OF}`);
    expect(all.status).toBe(200);
    expect(all.body.data.map((x: any) => x.project.code)).toEqual(['PRJ-01', 'PRJ-02', 'PRJ-03']);
    const row = all.body.data[0];
    expect(row).toMatchObject({ planned_start: '2026-02-02', planned_end: '2027-11-26', can_reschedule: true });
    expect(row.phases[0]).toMatchObject({ code: 'CD', progress_pct: 60 });
    expect(row.tasks).toBeUndefined();
    expect(row.hours).toMatchObject({ budget: '1100.00' });
    expect((await f.call('P01', 'GET', '/schedule?pm=P02')).body.data.map((x: any) => x.project.code)).toEqual(['PRJ-01', 'PRJ-03']);
    expect((await f.call('P01', 'GET', `/schedule?pm=${f.id('P03')}`)).body.data.map((x: any) => x.project.code)).toEqual(['PRJ-02']);
    expect((await f.call('P01', 'GET', '/schedule?status=On%20hold')).body.data.map((x: any) => x.project.code)).toEqual(['PRJ-03']);
    expect((await f.call('P01', 'GET', '/schedule?status=Paused')).status).toBe(400);
    expect((await f.call('P01', 'GET', '/schedule?pm=P99')).status).toBe(400);
    // Staff see the projects they are on; Nisha is on none.
    expect((await f.call('P05', 'GET', '/schedule')).body.data.map((x: any) => x.project.code)).toEqual(['PRJ-01']);
    expect((await f.call('P09', 'GET', '/schedule')).body.data).toEqual([]);
    expect((await f.call('P02', 'GET', '/schedule')).body.data.find((x: any) => x.project.code === 'PRJ-01').can_reschedule).toBe(true);
  });
});

describe('project health', () => {
  let h: Fresh;
  beforeAll(async () => { h = await freshApp(); });
  afterAll(async () => { await h?.close(); });
  const health = async (ref: string) => {
    const r = await h.call(ref, 'GET', `/projects/health?as_of=${AS_OF}`);
    expect(r.status).toBe(200);
    return r;
  };
  const row = (r: any, code: string) => r.body.data.find((x: any) => x.code === code);

  it('reads the seeded studio: hours over budget is At risk, 90-100% Watch, on hold Watch', async () => {
    const r = await health('P01');
    expect(r.body.data.map((x: any) => x.code)).toEqual(['PRJ-01', 'PRJ-02', 'PRJ-03']);
    expect(r.body.rule.length).toBeGreaterThan(3);
    const p1 = row(r, 'PRJ-01');
    expect(p1.health.status).toBe('At risk');
    expect(p1.hours.forecast_pct).toBeGreaterThan(100);
    expect(p1.health.reasons).toEqual([`Hours forecast ${Number(p1.hours.forecast)} h is ${p1.hours.forecast_pct}% of the ${Number(p1.hours.budget)} h budget`]);
    expect(p1.health.signals.map((s: any) => s.key)).toEqual(['hours', 'schedule', 'tasks', 'status', 'margin']);
    const p2 = row(r, 'PRJ-02');
    expect(p2.hours.forecast_pct).toBeGreaterThanOrEqual(90);
    expect(p2.hours.forecast_pct).toBeLessThanOrEqual(100);
    expect(p2.health).toMatchObject({ status: 'Watch' });
    const p3 = row(r, 'PRJ-03');
    expect(p3.health.status).toBe('Watch');
    expect(p3.health.reasons).toContain('On hold: Client funding, allocations retained');
    expect(p1).toMatchObject({ open_tasks: 0, overdue_tasks: 0, schedule: { planned_start: '2026-02-02', planned_end: '2027-11-26', slip_days: 0 } });
    expect(p1.fee).toMatchObject({ contracted: { amount: '2400000.00' }, authorized: { amount: '240000.00' } });
    expect(p1.margin).toMatchObject({ value_pct: expect.any(Number), complete: expect.any(Boolean) });
    expect(p1.margin_target).toEqual({ value_pct: 20, source: 'firm' });
  });

  it('slip and overdue tasks drive the schedule and tasks signals, with their thresholds', async () => {
    const cd = await phaseId(h, 'PRJ-01', 'CD');
    const late = (await create(h, 'P02', 'PRJ-01', { title: 'Late concept pack', phase_id: cd, due_date: '2026-12-10' })).body.id;
    expect(late).toBeTruthy();
    const dd3 = await phaseId(h, 'PRJ-03', 'DD');
    await create(h, 'P02', 'PRJ-03', { title: 'Slightly late', phase_id: dd3, due_date: '2027-01-20' });
    const sd2 = await phaseId(h, 'PRJ-02', 'SD');
    const x = (await create(h, 'P03', 'PRJ-02', { title: 'Structural input', phase_id: sd2, due_date: '2026-11-01' })).body.id;
    const y = (await create(h, 'P03', 'PRJ-02', { title: 'Coordinated plans', phase_id: sd2, start_date: '2026-11-10', due_date: '2026-11-20' })).body.id;
    await create(h, 'P03', 'PRJ-02', { title: 'Old query', phase_id: sd2, due_date: '2026-11-02' });
    expect((await h.call('P03', 'POST', `/tasks/${y}/dependencies`, { predecessor_id: x })).status).toBe(200);

    const r = await health('P01');
    const p1 = row(r, 'PRJ-01');
    expect(p1.schedule).toMatchObject({ slip_days: 13, forecast_end: '2027-11-26', slip_driver: { name: 'Concept design' } });
    expect(p1.health.reasons).toContain('Forecast to finish 13 days late (Concept design)');
    expect(p1.health.signals.find((s: any) => s.key === 'schedule').status).toBe('At risk');
    const p3 = row(r, 'PRJ-03');
    expect(p3.health.signals.find((s: any) => s.key === 'schedule')).toEqual({ key: 'schedule', status: 'Watch', reason: 'Forecast to finish 5 days late (Design development)' });
    const p2 = row(r, 'PRJ-02');
    expect(p2).toMatchObject({ open_tasks: 3, overdue_tasks: 2, blocking_overdue_tasks: 1 });
    expect(p2.health.status).toBe('At risk');
    expect(p2.health.reasons[0]).toBe('1 overdue task blocks other work: "Structural input"');

    // Unblocked, the overdue tasks are only Watch.
    const dep = (await h.call('P03', 'GET', `/tasks/${y}`)).body.blocked_by[0].dependency_id;
    await h.call('P03', 'DELETE', `/tasks/${y}/dependencies/${dep}`);
    const after = row(await health('P01'), 'PRJ-02');
    expect(after.health.signals.find((s: any) => s.key === 'tasks')).toEqual({ key: 'tasks', status: 'Watch', reason: '2 overdue tasks' });
  });

  it('margin below target is Watch; a PM sees the status and a figure-free reason, never the margin', async () => {
    await h.owner.query(`update project set margin_target_pct = 100 where code = 'PRJ-02'`);
    const p = row(await health('P01'), 'PRJ-02');
    const m = p.health.signals.find((s: any) => s.key === 'margin');
    expect(m.status).toBe('Watch');
    expect(m.reason).toBe(`Margin ${p.margin.value_pct}% is below the 100% target`);
    expect(p.margin_target).toEqual({ value_pct: 100, source: 'project' });
    expect(p.margin.value_pct).toBeLessThan(100);
    expect(p.margin.complete).toBe(false);
    expect(p.margin.missing).toContain('Nisha Kumar cost rate');

    const pm = await health('P03');
    expect(pm.body.data.map((x: any) => x.code)).toEqual(['PRJ-02']);
    const mine = row(pm, 'PRJ-02');
    expect(mine.margin).toEqual({ restricted: true });
    expect(mine.margin_target).toEqual({ restricted: true });
    expect(mine.health.status).toBe(p.health.status);
    expect(mine.health.signals.find((s: any) => s.key === 'margin')).toEqual({ key: 'margin', status: 'Watch', reason: 'Margin is below target (figures restricted)' });
    const text = JSON.stringify(mine);
    expect(text).not.toContain(String(p.margin.value_pct));
    expect(text).not.toContain('contribution');
    // The PM sees their own project's fee (billing.prepare scoped), as on the overview.
    expect(mine.fee.contracted).toBeTruthy();
    // Finance (margin.view) sees the figures.
    expect(row(await health('P10'), 'PRJ-02').margin.value_pct).toBe(p.margin.value_pct);
  });

  it('a PM sees only their own projects, staff are refused', async () => {
    expect((await health('P02')).body.data.map((x: any) => x.code)).toEqual(['PRJ-01', 'PRJ-03']);
    const staff = await h.call('P05', 'GET', '/projects/health');
    expect(staff.status).toBe(403);
    expect(staff.body.error.capability).toBe('budgets.hours.view');
  });

  it('the rule, as pure functions', () => {
    expect(hoursSignal(100, 89).status).toBe('On track');
    expect(hoursSignal(100, 90).status).toBe('Watch');
    expect(hoursSignal(100, 100).status).toBe('Watch');
    expect(hoursSignal(100, 100.5).status).toBe('At risk');
    expect(hoursSignal(0, 5)).toEqual({ key: 'hours', status: 'Watch', reason: 'No approved hours budget; 5 h forecast' });
    expect(hoursSignal(0, 0).status).toBe('On track');
    expect(scheduleSignal(0, null).status).toBe('On track');
    expect(scheduleSignal(1, null)).toEqual({ key: 'schedule', status: 'Watch', reason: 'Forecast to finish 1 day late' });
    expect(scheduleSignal(7, 'X').status).toBe('Watch');
    expect(scheduleSignal(8, 'X').status).toBe('At risk');
    expect(tasksSignal(1, []).status).toBe('Watch');
    expect(tasksSignal(2, [{ title: 'A' }]).status).toBe('At risk');
    expect(marginSignal(null, 20, true).status).toBe('On track');
    expect(marginSignal(25, 20, true).status).toBe('On track');
    expect(marginSignal(12.34, 20, false).reason).toBe('Margin is below target (figures restricted)');
    const c = combine([hoursSignal(100, 95), scheduleSignal(9, 'Tender'), marginSignal(10, 20, true)]);
    expect(c.status).toBe('At risk');
    expect(c.reasons).toEqual(['Forecast to finish 9 days late (Tender)', 'Hours forecast 95 h is 95% of the 100 h budget', 'Margin 10% is below the 20% target']);
  });
});

describe('graph arithmetic', () => {
  const g = (rows: [string, string | null, string | null, boolean?][]) => new Map<string, GraphTask>(rows.map(([id, start, due, done]) => [id, { id, start, due, done: !!done }]));
  it('reaches follows edges forward', () => {
    const e = [{ predecessor_id: 'a', successor_id: 'b', lag_days: 0 }, { predecessor_id: 'b', successor_id: 'c', lag_days: 0 }];
    expect(reaches(e, 'a', 'c')).toBe(true);
    expect(reaches(e, 'c', 'a')).toBe(false);
  });
  it('cascade takes the latest requirement over all moved predecessors, keeps durations, never pulls earlier', () => {
    const t = g([['a', '2027-01-01', '2027-01-10'], ['b', '2027-01-05', '2027-01-06'], ['c', '2027-01-08', '2027-01-09'], ['d', '2027-01-30', '2027-01-31'], ['e', '2027-01-02', '2027-01-03', true]]);
    const e = [
      { predecessor_id: 'a', successor_id: 'c', lag_days: 0 }, { predecessor_id: 'b', successor_id: 'c', lag_days: 10 },
      { predecessor_id: 'c', successor_id: 'd', lag_days: 0 }, { predecessor_id: 'a', successor_id: 'e', lag_days: 0 },
    ];
    const moved = cascade(t, e, new Set(['a', 'b']));
    expect(t.get('c')).toMatchObject({ start: '2027-01-17', due: '2027-01-18' }); // b ends 6th + 1 + 10
    expect(moved.get('c')).toBe(9);
    expect(moved.has('d')).toBe(false); // already after c
    expect(t.get('e')).toMatchObject({ start: '2027-01-02' }); // Done
  });
  it('forecast pushes open work past unfinished predecessors and today', () => {
    const t = g([['a', null, '2026-11-01'], ['b', '2026-11-03', '2026-11-05'], ['c', '2026-12-01', '2026-12-02']]);
    const e = [{ predecessor_id: 'a', successor_id: 'b', lag_days: 0 }];
    const fc = forecast(t, e, '2026-11-06');
    expect(fc.get('a')).toEqual({ start: '2026-11-01', end: '2026-11-06' });
    expect(fc.get('b')).toEqual({ start: '2026-11-07', end: '2026-11-09' });
    expect(fc.get('c')).toEqual({ start: '2026-12-01', end: '2026-12-02' });
  });
});

describe('firm isolation', () => {
  it("another firm's tasks, phases and projects are out of reach of every new route", async () => {
    const other = (await f.owner.query(`insert into firm (legal_name, trading_name, timezone) values ('Other','Other','Asia/Kolkata') returning id`)).rows[0].id;
    const person = (await f.owner.query(
      `insert into person (firm_id, ref_code, name, work_email, job_title) values ($1,'P11','Outsider',$2,'Architect') returning id`, [other, `outsider-${randomUUID()}@other.test`],
    )).rows[0].id;
    const client = (await f.owner.query(`insert into client (firm_id, name) values ($1, 'Their client') returning id`, [other])).rows[0].id;
    const project = (await f.owner.query(`insert into project (firm_id, code, name, client_id, pm_id) values ($1,'PRJ-09','Their project',$2,$3) returning id`, [other, client, person])).rows[0].id;
    const phase = (await f.owner.query(`insert into phase (firm_id, project_id, code, name, start_date, end_date) values ($1,$2,'CD','Their phase','2026-01-01','2026-12-31') returning id`, [other, project])).rows[0].id;
    const theirs = (await f.owner.query(`insert into task (firm_id, project_id, phase_id, title, due_date) values ($1,$2,$3,'Their task','2026-12-01') returning id`, [other, project, phase])).rows[0].id;
    const ours = await mk('Our task');

    expect((await f.call('P01', 'GET', `/tasks/${theirs}/subtasks`)).status).toBe(404);
    expect((await f.call('P01', 'POST', `/tasks/${theirs}/subtasks`, { title: 'X' })).status).toBe(404);
    expect((await f.call('P01', 'POST', `/tasks/${theirs}/dependencies`, { predecessor_id: ours })).status).toBe(404);
    expect((await f.call('P01', 'POST', `/tasks/${ours}/dependencies`, { predecessor_id: theirs })).status).toBe(404);
    expect((await f.call('P01', 'POST', `/tasks/${theirs}/followers`, {})).status).toBe(404);
    expect((await f.call('P01', 'POST', `/tasks/${ours}/followers`, { person_id: person })).status).toBe(400);
    expect((await f.call('P01', 'PUT', `/tasks/${theirs}/dates`, { due_date: '2026-12-05' })).status).toBe(404);
    expect((await f.call('P01', 'PUT', `/phases/${phase}/dates`, { end_date: '2026-12-30' })).status).toBe(404);
    expect((await f.call('P01', 'GET', '/projects/PRJ-09/schedule')).status).toBe(404);
    expect((await f.call('P04', 'POST', '/time-entries', { service_date: '2026-11-26', duration_hours: 1, task_id: theirs })).status).toBe(404);
    expect((await f.call('P01', 'GET', '/schedule')).body.data.map((x: any) => x.project.code)).not.toContain('PRJ-09');
    expect((await f.call('P01', 'GET', `/projects/health?as_of=${AS_OF}`)).body.data.map((x: any) => x.code)).not.toContain('PRJ-09');
    expect((await f.owner.query('select due_date from task where id = $1', [theirs])).rows[0].due_date).toBe('2026-12-01');
    // The database refuses a dependency across firms, and the app role sees no other firm's rows.
    await expect(f.owner.query('insert into task_dependency (firm_id, predecessor_id, successor_id) values ($1,$2,$3)', [f.firmId, theirs, ours])).rejects.toThrow(/same project/);
    await f.owner.query('insert into task_follower (firm_id, task_id, person_id) values ($1,$2,$3)', [other, theirs, person]);
    const app = await f.appClient();
    try {
      await app.query('begin');
      await app.query(`select set_config('app.firm_id', $1, true)`, [f.firmId]);
      expect((await app.query('select 1 from task_follower where task_id = $1', [theirs])).rowCount).toBe(0);
      await expect(app.query('insert into task_follower (firm_id, task_id, person_id) values ($1,$2,$3)', [other, theirs, person])).rejects.toThrow(/row-level security/);
      await app.query('rollback');
    } finally {
      await app.end();
    }
  });
});
