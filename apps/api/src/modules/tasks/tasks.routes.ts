import { addDays } from '@ams/domain';
import { ApiError, notFound, ruleError } from '../../http/errors';
import { audit } from '../../audit/audit';
import { notify } from '../../audit/notify';
import { assertProjectVisible, authorize, can } from '../../auth/authorize';
import type { Actor } from '../../auth/actor';
import { list } from '../../http/responses';
import { isoDate, isUuid, required, uuidParam } from '../../http/validation';
import type { Tx } from '../../db/pool';
import type { Api } from '../../http/api';
import { findProject } from '../projects';
import { localDate } from '../time/time.routes';

/**
 * Project tasks (migration 010). A planner of the project (projects.plan for it: principal, operations, its PM or a
 * lead) creates, edits, assigns and deletes tasks. The assignee moves the status and adds progress notes; nothing else.
 * An assignee is always on the project team (or its PM or principal), so the person can see the project and log time
 * on it. `add_to_team: true` adds a non-member as a contributor in the same transaction, for a planner only.
 */

export const TASK_STATUSES = ['To do', 'In progress', 'Done', 'Blocked'] as const;
export const TASK_PRIORITIES = ['Low', 'Normal', 'High'] as const;
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 4000;
const NOTE_MAX = 2000;
/** Fields only a planner may change. The assignee may send status and note. */
const PLANNER_FIELDS = ['title', 'description', 'phase_id', 'assignee_id', 'due_date', 'priority', 'sort_order', 'add_to_team'] as const;

const bad = (field: string, message: string, code = 'invalid') => new ApiError(400, 'VALIDATION', message, [{ field, code }]);

const TASK_SQL = `
  select t.*, p.code as project_code, p.name as project_name, p.pm_id, p.principal_id,
    ph.code as phase_code, ph.name as phase_name, a.ref_code as assignee_ref, a.name as assignee_name, a.job_title as assignee_title,
    (select count(*) from task_note n where n.task_id = t.id)::int as note_count
  from task t join project p on p.id = t.project_id left join phase ph on ph.id = t.phase_id left join person a on a.id = t.assignee_id`;

const mayPlan = (actor: Actor, projectId: string) => can(actor, 'projects.plan', { projectId });

function taskView(actor: Actor, r: any) {
  const planner = mayPlan(actor, r.project_id);
  return {
    id: r.id,
    project: { id: r.project_id, code: r.project_code, name: r.project_name },
    phase: r.phase_id ? { id: r.phase_id, code: r.phase_code, name: r.phase_name } : null,
    title: r.title,
    description: r.description,
    assignee: r.assignee_id ? { id: r.assignee_id, ref_code: r.assignee_ref, name: r.assignee_name, job_title: r.assignee_title } : null,
    due_date: r.due_date,
    status: r.status,
    priority: r.priority,
    sort_order: r.sort_order,
    completed_at: r.completed_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
    note_count: r.note_count,
    can_edit: planner,
    can_change_status: planner || r.assignee_id === actor.id,
  };
}

async function loadTask(tx: Tx, id: string) {
  const r = (await tx.query(`${TASK_SQL} where t.id = $1`, [id])).rows[0];
  if (!r) throw notFound('Task');
  return r;
}
async function notesOf(tx: Tx, taskId: string) {
  return (await tx.query(
    `select n.id, n.body, n.created_at, p.id as author_id, p.name as author_name from task_note n join person p on p.id = n.author_id
     where n.task_id = $1 order by n.created_at, n.id`, [taskId],
  )).rows.map((n) => ({ id: n.id, body: n.body, created_at: n.created_at, author: { id: n.author_id, name: n.author_name } }));
}

function text(v: unknown, field: string, what: string, max: number, opts: { required?: boolean } = {}): string | null {
  if (v == null || (typeof v === 'string' && v.trim() === '')) {
    if (opts.required) throw bad(field, `${what} is required.`, 'required');
    return null;
  }
  if (typeof v !== 'string') throw bad(field, `${what} must be text.`);
  if (v.trim().length > max) throw bad(field, `${what} can be at most ${max} characters.`, 'length');
  return v.trim();
}
const oneOf = <T extends string>(v: unknown, values: readonly T[], field: string, what: string): T => {
  if (!values.includes(v as T)) throw bad(field, `${what} is one of ${values.join(', ')}.`, 'enum');
  return v as T;
};
const dueOf = (v: unknown) => (v == null || v === '' ? null : isoDate(v, 'due_date'));
const sortOf = (v: unknown) => {
  if (v == null) return null;
  if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 1_000_000) throw bad('sort_order', 'Sort order is a whole number from 0.');
  return v as number;
};

/** The phase must belong to this project. */
async function phaseOf(tx: Tx, projectId: string, v: unknown): Promise<string | null> {
  if (v == null || v === '') return null;
  if (!isUuid(v)) throw bad('phase_id', 'Choose a phase of this project.', 'unknown');
  const ok = (await tx.query('select 1 from phase where id = $1 and project_id = $2', [v, projectId])).rowCount;
  if (!ok) throw bad('phase_id', 'Choose a phase of this project.', 'unknown');
  return v as string;
}

/**
 * The assignee must be an active person of this studio, with an account that is not deactivated, on the project team (or its PM or principal). With
 * addToTeam a planner puts them on the team as a contributor in the same transaction; returns true when it did.
 */
async function checkAssignee(tx: Tx, actor: Actor, firmId: string, project: any, v: unknown, addToTeam: boolean): Promise<{ id: string | null; added: boolean }> {
  if (v == null || v === '') return { id: null, added: false };
  if (!isUuid(v)) throw bad('assignee_id', 'Choose a person from this studio.', 'unknown');
  const person = (await tx.query('select id, name, employment_state, login_state from person where id = $1', [v])).rows[0];
  if (!person) throw bad('assignee_id', 'Choose a person from this studio.', 'unknown');
  if (person.employment_state === 'Ended') throw bad('assignee_id', `${person.name} has left the studio.`, 'inactive');
  // A deactivated account can never sign in to see or move the task (the team pickers leave them out too).
  if (person.login_state === 'Revoked') throw bad('assignee_id', `${person.name}'s account is deactivated. Reactivate it first, or choose someone else.`, 'inactive');
  const id = person.id as string;
  if (id === project.pm_id || id === project.principal_id) return { id, added: false };
  const member = (await tx.query('select 1 from project_membership where project_id = $1 and person_id = $2', [project.id, id])).rowCount;
  if (member) return { id, added: false };
  if (!addToTeam) {
    throw ruleError('ASSIGNEE_ON_TEAM', `${person.name} is not on the ${project.code} team. Add them to the team first, or choose "add to team".`, [{ field: 'assignee_id', code: 'not_member' }]);
  }
  // Same rule as POST /projects/:code/members for a contributor: projects.plan on this project.
  authorize(actor, 'projects.plan', { projectId: project.id });
  await tx.query(
    'insert into project_membership (firm_id, project_id, person_id, project_role, created_by) values ($1,$2,$3,$4,$5)',
    [firmId, project.id, id, 'contributor', actor.id],
  );
  await audit(tx, actor, firmId, { recordType: 'project_membership', recordId: project.id, action: 'add', next: { person_id: id, role: 'contributor', via: 'task' } });
  return { id, added: true };
}

async function tellAssignee(tx: Tx, actor: Actor, firmId: string, assigneeId: string | null, title: string, projectCode: string, taskId: string) {
  if (!assigneeId || assigneeId === actor.id) return;
  await notify(tx, firmId, assigneeId, 'task_assigned', `${actor.name} assigned you "${title}" on ${projectCode}.`, { type: 'task', id: taskId });
}

async function studioToday(tx: Tx) {
  const tz = ((await tx.query('select timezone from firm')).rows[0]?.timezone as string | undefined) || 'Asia/Kolkata';
  return localDate(tz);
}

export function taskRoutes({ get, post, put, del }: Api) {
  get('/projects/:code/tasks', async ({ tx, actor, params, req }) => {
    const p = await findProject(tx, params.code);
    assertProjectVisible(actor, p.id);
    const rows = (await tx.query(
      `${TASK_SQL} where t.project_id = $1
       order by case t.status when 'Blocked' then 0 when 'In progress' then 1 when 'To do' then 2 else 3 end, t.sort_order, t.due_date nulls last, t.created_at`, [p.id],
    )).rows;
    return { ...list(req, rows.map((r) => taskView(actor, r))), can_plan: mayPlan(actor, p.id) };
  });

  post('/projects/:code/tasks', async ({ tx, actor, firmId, params, body }) => {
    const p = await findProject(tx, params.code);
    authorize(actor, 'projects.plan', { projectId: p.id });
    required(body, ['title']);
    const title = text(body.title, 'title', 'Title', TITLE_MAX, { required: true })!;
    const description = text(body.description, 'description', 'Description', DESCRIPTION_MAX);
    const status = body.status == null ? 'To do' : oneOf(body.status, TASK_STATUSES, 'status', 'Status');
    const priority = body.priority == null ? 'Normal' : oneOf(body.priority, TASK_PRIORITIES, 'priority', 'Priority');
    const due = dueOf(body.due_date);
    const phaseId = await phaseOf(tx, p.id, body.phase_id);
    const sort = sortOf(body.sort_order)
      ?? Number((await tx.query('select coalesce(max(sort_order) + 1, 0) n from task where project_id = $1', [p.id])).rows[0].n);
    const assignee = await checkAssignee(tx, actor, firmId, p, body.assignee_id, body.add_to_team === true);

    const id = (await tx.query(
      `insert into task (firm_id, project_id, phase_id, title, description, assignee_id, due_date, status, priority, sort_order, completed_at, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, case when $8 = 'Done' then now() end, $11, $11) returning id`,
      [firmId, p.id, phaseId, title, description, assignee.id, due, status, priority, sort, actor.id],
    )).rows[0].id as string;
    const audit_event_id = await audit(tx, actor, firmId, {
      recordType: 'task', recordId: id, action: 'create', next: { project: p.code, title, assignee_id: assignee.id, due_date: due, status, priority },
    });
    if (assignee.id) await audit(tx, actor, firmId, { recordType: 'task', recordId: id, action: 'assign', next: { assignee_id: assignee.id } });
    await tellAssignee(tx, actor, firmId, assignee.id, title, p.code, id);
    return { ...taskView(actor, await loadTask(tx, id)), notes: [], added_to_team: assignee.added, audit_event_id };
  });

  get('/tasks/:id', async ({ tx, actor, params }) => {
    const t = await loadTask(tx, uuidParam(params.id, 'Task'));
    if (t.assignee_id !== actor.id) assertProjectVisible(actor, t.project_id);
    return { ...taskView(actor, t), notes: await notesOf(tx, t.id) };
  });

  put('/tasks/:id', async ({ tx, actor, firmId, params, body }) => {
    const prev = await loadTask(tx, uuidParam(params.id, 'Task'));
    const planner = mayPlan(actor, prev.project_id);
    const assignee = prev.assignee_id === actor.id;
    if (!planner && !assignee) {
      // Someone who cannot see the project learns nothing about the task.
      assertProjectVisible(actor, prev.project_id);
      throw new ApiError(403, 'FORBIDDEN_CAPABILITY', 'You need projects.plan for this project, or to be the assignee.', [], { capability: 'projects.plan' });
    }
    if (!planner) {
      const extra = PLANNER_FIELDS.filter((f) => body[f] !== undefined);
      if (extra.length) {
        throw new ApiError(403, 'FORBIDDEN_CAPABILITY', 'As the assignee you can change the status and add notes. Ask the project manager to change the rest.', extra.map((field) => ({ field, code: 'planner_only' })), { capability: 'projects.plan' });
      }
    }

    const next = {
      title: prev.title as string, description: prev.description as string | null, phase_id: prev.phase_id as string | null,
      assignee_id: prev.assignee_id as string | null, due_date: prev.due_date as string | null, status: prev.status as string,
      priority: prev.priority as string, sort_order: prev.sort_order as number,
    };
    if (body.status !== undefined) next.status = oneOf(body.status, TASK_STATUSES, 'status', 'Status');
    const note = text(body.note, 'note', 'Note', NOTE_MAX);
    let added = false;
    if (planner) {
      if (body.title !== undefined) next.title = text(body.title, 'title', 'Title', TITLE_MAX, { required: true })!;
      if (body.description !== undefined) next.description = text(body.description, 'description', 'Description', DESCRIPTION_MAX);
      if (body.phase_id !== undefined) next.phase_id = await phaseOf(tx, prev.project_id, body.phase_id);
      if (body.due_date !== undefined) next.due_date = dueOf(body.due_date);
      if (body.priority !== undefined) next.priority = oneOf(body.priority, TASK_PRIORITIES, 'priority', 'Priority');
      if (body.sort_order !== undefined) next.sort_order = sortOf(body.sort_order) ?? prev.sort_order;
      if (body.assignee_id !== undefined && (body.assignee_id || null) !== prev.assignee_id) {
        const p = await findProject(tx, prev.project_id);
        const a = await checkAssignee(tx, actor, firmId, p, body.assignee_id, body.add_to_team === true);
        next.assignee_id = a.id;
        added = a.added;
      }
    }

    await tx.query(
      `update task set title = $2, description = $3, phase_id = $4, assignee_id = $5, due_date = $6, status = $7, priority = $8, sort_order = $9,
         completed_at = case when $7 = 'Done' then coalesce(completed_at, now()) end, updated_by = $10, updated_at = now() where id = $1`,
      [prev.id, next.title, next.description, next.phase_id, next.assignee_id, next.due_date, next.status, next.priority, next.sort_order, actor.id],
    );
    if (note) await tx.query('insert into task_note (firm_id, task_id, author_id, body, created_by) values ($1,$2,$3,$4,$3)', [firmId, prev.id, actor.id, note]);

    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== prev[k]);
    let audit_event_id: string | null = null;
    const record = async (action: string, keys: string[], extra: Record<string, unknown> = {}) => {
      audit_event_id = await audit(tx, actor, firmId, {
        recordType: 'task', recordId: prev.id, action,
        previous: Object.fromEntries(keys.map((k) => [k, prev[k]])), next: { ...Object.fromEntries(keys.map((k) => [k, (next as any)[k]])), ...extra },
      });
    };
    const other = changed.filter((k) => k !== 'assignee_id' && k !== 'status');
    if (other.length) await record('update', other);
    if (changed.includes('status')) await record(next.status === 'Done' ? 'complete' : 'change_status', ['status'], note ? { note } : {});
    else if (note) audit_event_id = await audit(tx, actor, firmId, { recordType: 'task', recordId: prev.id, action: 'add_note', next: { note } });
    if (changed.includes('assignee_id')) {
      await record('assign', ['assignee_id']);
      await tellAssignee(tx, actor, firmId, next.assignee_id, next.title, prev.project_code, prev.id);
    }
    // The planner hears when the assignee finishes or blocks their task.
    if (!planner && changed.includes('status') && (next.status === 'Done' || next.status === 'Blocked') && prev.created_by && prev.created_by !== actor.id) {
      await notify(tx, firmId, prev.created_by, `task_${next.status === 'Done' ? 'completed' : 'blocked'}`, `${actor.name} marked "${next.title}" ${next.status === 'Done' ? 'done' : 'blocked'} on ${prev.project_code}.`, { type: 'task', id: prev.id });
    }
    return { ...taskView(actor, await loadTask(tx, prev.id)), notes: await notesOf(tx, prev.id), added_to_team: added, audit_event_id };
  });

  del('/tasks/:id', async ({ tx, actor, firmId, params }) => {
    const prev = await loadTask(tx, uuidParam(params.id, 'Task'));
    assertProjectVisible(actor, prev.project_id);
    authorize(actor, 'projects.plan', { projectId: prev.project_id });
    await tx.query('delete from task where id = $1', [prev.id]);
    const audit_event_id = await audit(tx, actor, firmId, {
      recordType: 'task', recordId: prev.id, action: 'delete', previous: { project: prev.project_code, title: prev.title, assignee_id: prev.assignee_id, status: prev.status },
    });
    return { id: prev.id, deleted: true, audit_event_id };
  });

  /** My open tasks across projects, soonest due first (no due date last). `today` lets the page group by due date. */
  get('/me/tasks', async ({ tx, actor, req }) => {
    authorize(actor, 'time.enter', { ownerId: actor.id });
    const today = await studioToday(tx);
    const rows = (await tx.query(
      `${TASK_SQL} where t.assignee_id = $1 and t.status <> 'Done'
       order by t.due_date nulls last, case t.priority when 'High' then 0 when 'Normal' then 1 else 2 end, p.code, t.sort_order`, [actor.id],
    )).rows;
    const data = rows.map((r) => taskView(actor, r));
    const soon = addDays(today, 7);
    return {
      ...list(req, data), today,
      overdue: data.filter((t) => t.due_date && t.due_date < today).length,
      due_soon: data.filter((t) => t.due_date && t.due_date >= today && t.due_date <= soon).length,
    };
  });
}
