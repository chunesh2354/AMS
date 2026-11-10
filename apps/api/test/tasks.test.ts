import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshApp, type Fresh } from './helpers';

/**
 * Project tasks (migration 010). In the demo studio Vikram (P02) is PM of PRJ-01 with Rohan (P04), Divya (P05) and
 * Arjun (P08) as contributors; Meera (P03) is PM of PRJ-02 with Karan (P06) and Sneha (P07). Nisha (P09) is on PRJ-02
 * only through her time, not on PRJ-01's team.
 */
let f: Fresh;
beforeAll(async () => { f = await freshApp(); });
afterAll(async () => { await f?.close(); });

const phaseId = async (project: string, code: string) => (await f.owner.query(
  'select ph.id from phase ph join project p on p.id = ph.project_id where p.code = $1 and ph.code = $2', [project, code],
)).rows[0].id as string;
const taskRow = async (id: string) => (await f.owner.query('select * from task where id = $1', [id])).rows[0];
const isMember = async (project: string, ref: string) => (await f.owner.query(
  'select project_role from project_membership m join project p on p.id = m.project_id where p.code = $1 and m.person_id = $2', [project, f.id(ref)],
)).rows[0]?.project_role ?? null;
const create = (ref: string, project: string, body: Record<string, unknown>) => f.call(ref, 'POST', `/projects/${project}/tasks`, body);

describe('POST /projects/:code/tasks', () => {
  it('lets the PM create and assign a task on their own project, with audit and a notification', async () => {
    const wd = await phaseId('PRJ-01', 'WD');
    const r = await create('P02', 'PRJ-01', { title: 'Door schedule', phase_id: wd, assignee_id: f.id('P05'), due_date: '2027-01-15', priority: 'High', description: 'Ground floor first' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      title: 'Door schedule', status: 'To do', priority: 'High', due_date: '2027-01-15', description: 'Ground floor first',
      project: { code: 'PRJ-01' }, phase: { id: wd, code: 'WD' }, assignee: { id: f.id('P05'), name: 'Divya Menon' }, can_edit: true, added_to_team: false,
    });
    const actions = (await f.owner.query(`select action from audit_event where record_type = 'task' and record_id = $1 order by created_at, action`, [r.body.id])).rows.map((x) => x.action);
    expect(actions.sort()).toEqual(['assign', 'create']);
    const n = (await f.owner.query(`select event_type, text from notification where person_id = $1 and record_type = 'task' and record_id = $2`, [f.id('P05'), r.body.id])).rows;
    expect(n).toEqual([{ event_type: 'task_assigned', text: 'Vikram Nair assigned you "Door schedule" on PRJ-01.' }]);

    const listed = await f.call('P02', 'GET', '/projects/PRJ-01/tasks');
    expect(listed.status).toBe(200);
    expect(listed.body.can_plan).toBe(true);
    expect(listed.body.data.map((t: any) => t.id)).toContain(r.body.id);
  });

  it('refuses the PM on a project they do not manage', async () => {
    const r = await create('P02', 'PRJ-02', { title: 'Not mine' });
    expect(r.status).toBe(403);
    expect(r.body.error.capability).toBe('projects.plan');
    expect((await f.owner.query(`select count(*)::int n from task where title = 'Not mine'`)).rows[0].n).toBe(0);
  });

  it('refuses staff, even on their own project, and the add_to_team flag does not help', async () => {
    const r = await create('P05', 'PRJ-01', { title: 'Staff task' });
    expect(r.status).toBe(403);
    const withFlag = await create('P05', 'PRJ-01', { title: 'Staff task', assignee_id: f.id('P09'), add_to_team: true });
    expect(withFlag.status).toBe(403);
    expect(await isMember('PRJ-01', 'P09')).toBeNull();
  });

  it('lets the principal create on any project', async () => {
    const r = await create('P01', 'PRJ-02', { title: 'Principal review set', assignee_id: f.id('P07') });
    expect(r.status).toBe(200);
    expect(r.body.assignee.name).toBe('Sneha Pillai');
  });

  it('validates the fields', async () => {
    const noTitle = await create('P02', 'PRJ-01', { title: '  ' });
    expect(noTitle.status).toBe(400);
    expect(noTitle.body.error.details[0].field).toBe('title');
    const priority = await create('P02', 'PRJ-01', { title: 'X', priority: 'Urgent' });
    expect(priority.status).toBe(400);
    expect(priority.body.error.details[0].field).toBe('priority');
    const status = await create('P02', 'PRJ-01', { title: 'X', status: 'Waiting' });
    expect(status.status).toBe(400);
    const due = await create('P02', 'PRJ-01', { title: 'X', due_date: '15/01/2027' });
    expect(due.status).toBe(400);
    expect(due.body.error.details[0].field).toBe('due_date');
    const otherPhase = await create('P02', 'PRJ-01', { title: 'X', phase_id: await phaseId('PRJ-02', 'SD') });
    expect(otherPhase.status).toBe(400);
    expect(otherPhase.body.error.details[0].field).toBe('phase_id');
    const longTitle = await create('P02', 'PRJ-01', { title: 'x'.repeat(201) });
    expect(longTitle.status).toBe(400);
    const unknown = await create('P02', 'PRJ-01', { title: 'X', assignee_id: randomUUID() });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.details[0].field).toBe('assignee_id');
    expect((await f.call('P02', 'GET', '/projects/PRJ-404/tasks')).status).toBe(404);
  });

  it('refuses a non-member assignee without the flag, telling the planner to add them to the team', async () => {
    const r = await create('P02', 'PRJ-01', { title: 'Kitchen elevations', assignee_id: f.id('P06') });
    expect(r.status).toBe(422);
    expect(r.body.error.rule).toBe('ASSIGNEE_ON_TEAM');
    expect(r.body.error.message).toContain('Add them to the team first');
    expect(r.body.error.details[0]).toEqual({ field: 'assignee_id', code: 'not_member' });
    expect(await isMember('PRJ-01', 'P06')).toBeNull();
  });

  it('with add_to_team, a planner adds the assignee as a contributor in the same transaction', async () => {
    const r = await create('P02', 'PRJ-01', { title: 'Kitchen elevations', assignee_id: f.id('P06'), add_to_team: true });
    expect(r.status).toBe(200);
    expect(r.body.added_to_team).toBe(true);
    expect(await isMember('PRJ-01', 'P06')).toBe('contributor');
    const ev = (await f.owner.query(`select action, new from audit_event where record_type = 'project_membership' and new->>'person_id' = $1`, [f.id('P06')])).rows;
    expect(ev).toEqual([{ action: 'add', new: { person_id: f.id('P06'), role: 'contributor', via: 'task' } }]);
    // Karan now sees PRJ-01 and his task.
    const mine = await f.call('P06', 'GET', '/me/tasks');
    expect(mine.body.data.map((t: any) => t.id)).toContain(r.body.id);
    expect((await f.call('P06', 'GET', '/projects/PRJ-01/tasks')).status).toBe(200);
  });

  it('refuses an assignee whose account is deactivated, on the team or not, and adds no one', async () => {
    const before = (await f.owner.query('select login_state from person where id = $1', [f.id('P08')])).rows[0].login_state;
    await f.owner.query(`update person set login_state = 'Revoked' where id = $1`, [f.id('P08')]);
    try {
      const onTeam = await create('P02', 'PRJ-01', { title: 'For a deactivated account', assignee_id: f.id('P08') });
      expect(onTeam.status).toBe(400);
      expect(onTeam.body.error.details[0]).toEqual({ field: 'assignee_id', code: 'inactive' });
      const offTeam = await create('P03', 'PRJ-02', { title: 'For a deactivated account', assignee_id: f.id('P08'), add_to_team: true });
      expect(offTeam.status).toBe(400);
      expect(await isMember('PRJ-02', 'P08')).toBeNull();
      // Nor can a planner reassign an existing task to them.
      const t = await create('P02', 'PRJ-01', { title: 'Reassign to a deactivated account' });
      const re = await f.call('P02', 'PUT', `/tasks/${t.body.id}`, { assignee_id: f.id('P08') });
      expect(re.status).toBe(400);
      expect((await taskRow(t.body.id)).assignee_id).toBeNull();
      expect((await f.owner.query(`select count(*)::int n from task where title = 'For a deactivated account'`)).rows[0].n).toBe(0);
    } finally {
      await f.owner.query('update person set login_state = $2 where id = $1', [f.id('P08'), before]);
    }
  });

  it('validates the task before adding anyone to the team', async () => {
    const r = await create('P02', 'PRJ-01', { title: 'X', assignee_id: f.id('P07'), add_to_team: true, priority: 'Urgent' });
    expect(r.status).toBe(400);
    expect(await isMember('PRJ-01', 'P07')).toBeNull();
  });
});

describe('PUT /tasks/:id', () => {
  let id: string;
  beforeAll(async () => {
    id = (await create('P02', 'PRJ-01', { title: 'Stair section', assignee_id: f.id('P08'), due_date: '2027-01-08' })).body.id;
  });

  it('lets the assignee change the status and add a note', async () => {
    const r = await f.call('P08', 'PUT', `/tasks/${id}`, { status: 'In progress', note: 'Started on grid C' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'In progress', can_edit: false, can_change_status: true, note_count: 1 });
    expect(r.body.notes).toEqual([expect.objectContaining({ body: 'Started on grid C', author: { id: f.id('P08'), name: 'Arjun Das' } })]);
  });

  it('refuses the assignee changing the title or the assignee, and changes nothing', async () => {
    const title = await f.call('P08', 'PUT', `/tasks/${id}`, { title: 'Renamed', status: 'Done' });
    expect(title.status).toBe(403);
    expect(title.body.error.details).toEqual([{ field: 'title', code: 'planner_only' }]);
    const reassign = await f.call('P08', 'PUT', `/tasks/${id}`, { assignee_id: f.id('P04') });
    expect(reassign.status).toBe(403);
    const addTeam = await f.call('P08', 'PUT', `/tasks/${id}`, { assignee_id: f.id('P09'), add_to_team: true });
    expect(addTeam.status).toBe(403);
    expect(await isMember('PRJ-01', 'P09')).toBeNull();
    expect(await taskRow(id)).toMatchObject({ title: 'Stair section', status: 'In progress', assignee_id: f.id('P08') });
  });

  it('refuses a teammate who is not the assignee, and someone off the project', async () => {
    expect((await f.call('P04', 'PUT', `/tasks/${id}`, { status: 'Done' })).status).toBe(403);
    expect((await f.call('P09', 'PUT', `/tasks/${id}`, { status: 'Done' })).status).toBe(403);
    expect((await f.call('P09', 'GET', '/projects/PRJ-01/tasks')).status).toBe(403);
    expect((await taskRow(id)).status).toBe('In progress');
  });

  it('marks it done with completed_at, audits "complete" and tells the planner', async () => {
    const r = await f.call('P08', 'PUT', `/tasks/${id}`, { status: 'Done' });
    expect(r.status).toBe(200);
    expect(r.body.completed_at).toBeTruthy();
    const ev = (await f.owner.query('select action, previous, new from audit_event where id = $1', [r.body.audit_event_id])).rows[0];
    expect(ev).toEqual({ action: 'complete', previous: { status: 'In progress' }, new: { status: 'Done' } });
    const n = (await f.owner.query(`select event_type from notification where person_id = $1 and record_id = $2`, [f.id('P02'), id])).rows;
    expect(n).toEqual([{ event_type: 'task_completed' }]);
    const reopened = await f.call('P08', 'PUT', `/tasks/${id}`, { status: 'In progress' });
    expect(reopened.body.completed_at).toBeNull();
  });

  it('lets the PM edit everything and reassign, which notifies the new assignee', async () => {
    const r = await f.call('P02', 'PUT', `/tasks/${id}`, { title: 'Stair section at grid C', assignee_id: f.id('P04'), priority: 'High', due_date: null });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ title: 'Stair section at grid C', priority: 'High', due_date: null, assignee: { id: f.id('P04') } });
    const n = (await f.owner.query(`select event_type from notification where person_id = $1 and record_id = $2`, [f.id('P04'), id])).rows;
    expect(n).toEqual([{ event_type: 'task_assigned' }]);
    const actions = (await f.owner.query(`select action from audit_event where record_type = 'task' and record_id = $1`, [id])).rows.map((x) => x.action);
    expect(actions).toEqual(expect.arrayContaining(['create', 'assign', 'change_status', 'complete', 'update']));
    // Reassigning to someone off the team needs the flag, as on create.
    const off = await f.call('P02', 'PUT', `/tasks/${id}`, { assignee_id: f.id('P09') });
    expect(off.status).toBe(422);
  });

  it('validates the status', async () => {
    const r = await f.call('P02', 'PUT', `/tasks/${id}`, { status: 'Finished' });
    expect(r.status).toBe(400);
    expect((await f.call('P02', 'PUT', '/tasks/not-a-uuid', { status: 'Done' })).status).toBe(404);
  });
});

describe('DELETE /tasks/:id', () => {
  it('is for planners only', async () => {
    const id = (await create('P02', 'PRJ-01', { title: 'Temporary', assignee_id: f.id('P05') })).body.id;
    expect((await f.call('P05', 'DELETE', `/tasks/${id}`)).status).toBe(403);
    expect((await f.call('P03', 'DELETE', `/tasks/${id}`)).status).toBe(403);
    const r = await f.call('P02', 'DELETE', `/tasks/${id}`);
    expect(r.status).toBe(200);
    expect(await taskRow(id)).toBeUndefined();
    expect((await f.owner.query('select action from audit_event where id = $1', [r.body.audit_event_id])).rows[0].action).toBe('delete');
  });
});

describe('GET /me/tasks', () => {
  it('lists only my open tasks, soonest due first', async () => {
    const later = (await create('P02', 'PRJ-01', { title: 'Later one', assignee_id: f.id('P05'), due_date: '2027-03-01' })).body.id;
    const sooner = (await create('P02', 'PRJ-01', { title: 'Sooner one', assignee_id: f.id('P05'), due_date: '2026-12-01' })).body.id;
    const undated = (await create('P02', 'PRJ-01', { title: 'Undated one', assignee_id: f.id('P05') })).body.id;
    const done = (await create('P02', 'PRJ-01', { title: 'Done one', assignee_id: f.id('P05'), status: 'Done' })).body.id;
    await create('P02', 'PRJ-01', { title: 'Someone else', assignee_id: f.id('P04'), due_date: '2026-11-30' });

    const r = await f.call('P05', 'GET', '/me/tasks');
    expect(r.status).toBe(200);
    expect(r.body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const ids = r.body.data.map((t: any) => t.id);
    expect(ids).not.toContain(done);
    expect(r.body.data.every((t: any) => t.assignee.id === f.id('P05'))).toBe(true);
    expect(ids.indexOf(sooner)).toBeLessThan(ids.indexOf(later));
    expect(ids.indexOf(later)).toBeLessThan(ids.indexOf(undated));
    expect(ids[ids.length - 1]).toBe(undated);
  });
});

describe('firm isolation', () => {
  it("another firm's tasks and people are invisible", async () => {
    const other = (await f.owner.query(`insert into firm (legal_name, trading_name, timezone) values ('Other','Other','Asia/Kolkata') returning id`)).rows[0].id;
    const person = (await f.owner.query(
      `insert into person (firm_id, ref_code, name, work_email, job_title) values ($1,'P11','Outsider',$2,'Architect') returning id`, [other, `outsider-${randomUUID()}@other.test`],
    )).rows[0].id;
    const client = (await f.owner.query(`insert into client (firm_id, name) values ($1, 'Their client') returning id`, [other])).rows[0].id;
    const project = (await f.owner.query(`insert into project (firm_id, code, name, client_id, pm_id) values ($1,'PRJ-01','Their project',$2,$3) returning id`, [other, client, person])).rows[0].id;
    const theirs = (await f.owner.query(
      `insert into task (firm_id, project_id, title, assignee_id) values ($1,$2,'Their task',$3) returning id`, [other, project, person],
    )).rows[0].id;

    expect((await f.call('P01', 'GET', `/tasks/${theirs}`)).status).toBe(404);
    expect((await f.call('P01', 'PUT', `/tasks/${theirs}`, { status: 'Done' })).status).toBe(404);
    expect((await f.call('P01', 'DELETE', `/tasks/${theirs}`)).status).toBe(404);
    expect((await taskRow(theirs)).status).toBe('To do');
    const ours = await f.call('P01', 'GET', '/projects/PRJ-01/tasks');
    expect(ours.body.data.map((t: any) => t.id)).not.toContain(theirs);
    const assignOutsider = await create('P01', 'PRJ-01', { title: 'X', assignee_id: person, add_to_team: true });
    expect(assignOutsider.status).toBe(400);
    expect(assignOutsider.body.error.details[0].field).toBe('assignee_id');
    expect((await f.call('P01', 'GET', '/me/tasks')).body.data.map((t: any) => t.id)).not.toContain(theirs);
  });
});
