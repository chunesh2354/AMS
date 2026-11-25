import { ApiError, conflict, notFound, ruleError } from '../../http/errors';
import { audit } from '../../audit/audit';
import { notify } from '../../audit/notify';
import { assertProjectVisible, authorize, visibleProjects } from '../../auth/authorize';
import { loadActor, type Actor } from '../../auth/actor';
import { list } from '../../http/responses';
import { isUuid, uuidParam } from '../../http/validation';
import type { Tx } from '../../db/pool';
import type { Api, Ctx } from '../../http/api';
import { findProject } from '../projects';
import { reaches, type GraphEdge } from '../schedule/graph';
import { assertTaskVisible, bad, createTask, followersOf, loadTask, mayPlan, taskDetail, taskView, TASK_SQL } from './tasks.routes';

/**
 * Sub-tasks, dependencies and followers (migration 012).
 *  - Sub-tasks: one level. Planners (projects.plan for the project) create them; anyone who can see the parent lists them.
 *  - Dependencies: finish-to-start with lag_days, between two tasks of the same project, added and removed by planners.
 *    POST /tasks/:id/dependencies takes predecessor_id (":id is blocked by it") or successor_id (":id blocks it").
 *    Self-links, parent/sub-task links and cycles are 422 (AC-F09-2); a pair that exists already is 409.
 *  - Followers: anyone who can see the task may follow or unfollow themselves; planners add or remove others, who
 *    must be able to see the task themselves (otherwise its notifications would show them a project they cannot open).
 */

export const DEPENDENCY_TYPES = ['finish_to_start'] as const;
const LAG_MAX = 365;

/** Serializes schedule edits on one project: dependencies and date moves. */
export async function lockProject(tx: Tx, projectId: string) {
  await tx.query('select id from project where id = $1 for update', [projectId]);
}

export async function projectEdges(tx: Tx, projectId: string): Promise<(GraphEdge & { id: string; type: string })[]> {
  return (await tx.query(
    `select d.id, d.predecessor_id, d.successor_id, d.type, d.lag_days from task_dependency d join task t on t.id = d.successor_id where t.project_id = $1`, [projectId],
  )).rows;
}

async function plannerTask(tx: Tx, actor: Actor, id: string) {
  const t = await loadTask(tx, uuidParam(id, 'Task'));
  assertProjectVisible(actor, t.project_id);
  authorize(actor, 'projects.plan', { projectId: t.project_id });
  return t;
}

/** Can this person see the task (its assignee, or able to see the project)? */
async function personSeesTask(tx: Tx, firmId: string, personId: string, t: any) {
  if (t.assignee_id === personId) return true;
  const other = await loadActor(tx, personId, firmId, '');
  const v = visibleProjects(other);
  return v === 'all' || v.includes(t.project_id);
}

function lagOf(v: unknown) {
  if (v == null) return 0;
  if (!Number.isInteger(v) || Math.abs(v as number) > LAG_MAX) throw bad('lag_days', `The lag is a whole number of days from -${LAG_MAX} to ${LAG_MAX}.`, 'range');
  return v as number;
}

export function taskRelationRoutes({ get, post, del }: Api) {
  // ----- Sub-tasks -----
  get('/tasks/:id/subtasks', async ({ tx, actor, params, req }) => {
    const parent = await loadTask(tx, uuidParam(params.id, 'Task'));
    assertTaskVisible(actor, parent);
    const rows = (await tx.query(`${TASK_SQL} where t.parent_task_id = $1 order by t.sort_order, t.created_at`, [parent.id])).rows;
    return { ...list(req, rows.map((r) => taskView(actor, r))), parent_task_id: parent.id, can_plan: mayPlan(actor, parent.project_id) };
  });

  post('/tasks/:id/subtasks', async ({ tx, actor, firmId, params, body }) => {
    const parent = await plannerTask(tx, actor, params.id);
    if (parent.parent_task_id) throw ruleError('F09', 'A sub-task cannot have sub-tasks of its own. Add it to the parent task instead.', [{ field: 'parent_task_id', code: 'one_level' }]);
    const p = await findProject(tx, parent.project_id);
    return createTask(tx, actor, firmId, p, body, parent);
  });

  // ----- Dependencies -----
  post('/tasks/:id/dependencies', async ({ tx, actor, firmId, params, body }) => {
    const t = await plannerTask(tx, actor, params.id);
    const hasPred = body.predecessor_id != null && body.predecessor_id !== '';
    const hasSucc = body.successor_id != null && body.successor_id !== '';
    if (hasPred === hasSucc) {
      throw new ApiError(400, 'VALIDATION', 'Give either predecessor_id (this task waits for it) or successor_id (it waits for this task).', [{ field: 'predecessor_id', code: 'required' }]);
    }
    const otherId = (hasPred ? body.predecessor_id : body.successor_id) as unknown;
    const field = hasPred ? 'predecessor_id' : 'successor_id';
    if (body.type != null && !DEPENDENCY_TYPES.includes(body.type)) throw bad('type', 'The dependency type is finish_to_start.', 'enum');
    const lag = lagOf(body.lag_days);
    if (!isUuid(otherId)) throw notFound('Task');
    if (otherId === t.id) throw ruleError('AC-F09-2', 'A task cannot depend on itself.', [{ field, code: 'self' }]);
    const other = await loadTask(tx, otherId as string);
    if (other.project_id !== t.project_id) throw ruleError('F09', 'Both tasks of a dependency belong to the same project.', [{ field, code: 'other_project' }]);
    if (other.parent_task_id === t.id || t.parent_task_id === other.id) {
      throw ruleError('F09', 'A task and its own sub-task cannot depend on each other: the sub-task is part of the task.', [{ field, code: 'parent_child' }]);
    }
    const pred = hasPred ? other : t;
    const succ = hasPred ? t : other;
    await lockProject(tx, t.project_id);
    const edges = await projectEdges(tx, t.project_id);
    const dup = edges.find((e) => e.predecessor_id === pred.id && e.successor_id === succ.id);
    if (dup) throw conflict('DUPLICATE_DEPENDENCY', `"${succ.title}" already waits for "${pred.title}".`, { conflicting_id: dup.id });
    if (reaches(edges, succ.id, pred.id)) {
      throw ruleError('AC-F09-2', `This would make a cycle: "${pred.title}" already waits, directly or through other tasks, for "${succ.title}".`, [{ field, code: 'cycle' }]);
    }
    const row = (await tx.query(
      `insert into task_dependency (firm_id, predecessor_id, successor_id, type, lag_days, created_by, updated_by) values ($1,$2,$3,'finish_to_start',$4,$5,$5)
       returning id, predecessor_id, successor_id, type, lag_days`,
      [firmId, pred.id, succ.id, lag, actor.id],
    )).rows[0];
    const audit_event_id = await audit(tx, actor, firmId, {
      recordType: 'task', recordId: succ.id, action: 'add_dependency', next: { dependency_id: row.id, predecessor_id: pred.id, successor_id: succ.id, type: row.type, lag_days: lag },
    });
    return { dependency: row, task: await taskDetail(tx, actor, await loadTask(tx, t.id)), audit_event_id };
  });

  del('/tasks/:id/dependencies/:depId', async ({ tx, actor, firmId, params }) => {
    const t = await plannerTask(tx, actor, params.id);
    const depId = uuidParam(params.depId, 'Dependency');
    const d = (await tx.query('select * from task_dependency where id = $1 and (predecessor_id = $2 or successor_id = $2)', [depId, t.id])).rows[0];
    if (!d) throw notFound('Dependency');
    await tx.query('delete from task_dependency where id = $1', [d.id]);
    const audit_event_id = await audit(tx, actor, firmId, {
      recordType: 'task', recordId: d.successor_id, action: 'remove_dependency',
      previous: { dependency_id: d.id, predecessor_id: d.predecessor_id, successor_id: d.successor_id, type: d.type, lag_days: d.lag_days },
    });
    return { id: d.id, deleted: true, task: await taskDetail(tx, actor, await loadTask(tx, t.id)), audit_event_id };
  });

  // ----- Followers -----
  /** Whose follow this is: the body/query person_id, else the caller. Another person needs a planner. */
  const target = (actor: Actor, t: any, v: unknown) => {
    const id = v == null || v === '' ? actor.id : v;
    if (!isUuid(id)) throw bad('person_id', 'Choose a person from this studio.', 'unknown');
    if (id !== actor.id && !mayPlan(actor, t.project_id)) {
      throw new ApiError(403, 'FORBIDDEN_CAPABILITY', 'You can follow or unfollow a task yourself. Adding or removing someone else needs projects.plan for this project.', [], { capability: 'projects.plan' });
    }
    return id as string;
  };

  post('/tasks/:id/followers', async ({ tx, actor, firmId, params, body }) => {
    const t = await loadTask(tx, uuidParam(params.id, 'Task'));
    assertTaskVisible(actor, t);
    const personId = target(actor, t, body.person_id);
    if (personId !== actor.id) {
      const person = (await tx.query('select id, name, employment_state, login_state from person where id = $1', [personId])).rows[0];
      if (!person) throw bad('person_id', 'Choose a person from this studio.', 'unknown');
      if (person.employment_state === 'Ended' || person.login_state === 'Revoked') throw bad('person_id', `${person.name} cannot sign in, so cannot follow a task.`, 'inactive');
      if (!(await personSeesTask(tx, firmId, personId, t))) {
        throw ruleError('F09', `${person.name} is not on the ${t.project_code} team, so cannot follow its tasks. Add them to the team first.`, [{ field: 'person_id', code: 'not_member' }]);
      }
    }
    const added = (await tx.query(
      `insert into task_follower (firm_id, task_id, person_id, created_by, updated_by) values ($1,$2,$3,$4,$4) on conflict (task_id, person_id) do nothing returning id`,
      [firmId, t.id, personId, actor.id],
    )).rowCount;
    let audit_event_id: string | null = null;
    if (added) {
      audit_event_id = await audit(tx, actor, firmId, { recordType: 'task', recordId: t.id, action: 'follow', next: { person_id: personId } });
      if (personId !== actor.id) await notify(tx, firmId, personId, 'task_followed', `${actor.name} added you as a follower of "${t.title}" on ${t.project_code}.`, { type: 'task', id: t.id });
    }
    return { task_id: t.id, person_id: personId, following: true, added: !!added, followers: await followersOf(tx, t.id), audit_event_id };
  });

  const unfollow = async ({ tx, actor, firmId, params, query }: Ctx) => {
    const t = await loadTask(tx, uuidParam(params.id, 'Task'));
    const personId = params.personId ?? query.person_id;
    const self = personId == null || personId === '' || personId === actor.id;
    // A follower may always stop following, even after leaving the team. Everyone else needs to see the task.
    const isFollower = !!(await tx.query('select 1 from task_follower where task_id = $1 and person_id = $2', [t.id, actor.id])).rowCount;
    if (!(self && isFollower)) assertTaskVisible(actor, t);
    const id = target(actor, t, personId);
    const removed = (await tx.query('delete from task_follower where task_id = $1 and person_id = $2', [t.id, id])).rowCount;
    const audit_event_id = removed ? await audit(tx, actor, firmId, { recordType: 'task', recordId: t.id, action: 'unfollow', previous: { person_id: id } }) : null;
    return { task_id: t.id, person_id: id, following: false, removed: !!removed, followers: await followersOf(tx, t.id), audit_event_id };
  };
  del('/tasks/:id/followers', unfollow);
  del('/tasks/:id/followers/:personId', unfollow);
}
