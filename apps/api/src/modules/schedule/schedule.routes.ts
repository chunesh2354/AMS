import { notFound } from '../../http/errors';
import { audit } from '../../audit/audit';
import { notify } from '../../audit/notify';
import { assertProjectVisible, authorize, visibleProjects } from '../../auth/authorize';
import type { Actor } from '../../auth/actor';
import { list } from '../../http/responses';
import { isoDate, uuidParam } from '../../http/validation';
import type { Tx } from '../../db/pool';
import type { Api } from '../../http/api';
import { findProject } from '../projects';
import { assertDateOrder, bad, followersToTell, loadTask, mayPlan, taskView } from '../tasks/tasks.routes';
import { lockProject, projectEdges } from '../tasks/relations.routes';
import { cascade, daysFrom, shift, violations, type GraphTask } from './graph';
import { firmClock, plansFor, SCHEDULE_DEFINITION } from './plan';
import { healthRoutes } from './health';

/**
 * The Gantt schedule and rescheduling (migration 012).
 *  - GET /projects/:code/schedule: anyone who can see the project. Milestones carry no amounts (staff see this page).
 *  - GET /schedule?pm=&status=: every project the viewer can see, phases rolled up (no tasks).
 *  - PUT /phases/:id/dates and PUT /tasks/:id/dates: planners only (projects.plan for the project: principal,
 *    operations when granted, the project's PM or a lead). start <= end or 400.
 *    With cascade=true: a moved phase moves its open tasks by the same number of days (the start's shift, else the
 *    end's); a moved parent task moves its open sub-tasks the same way; then successors, transitively, are pushed
 *    later just far enough that finish-to-start + lag holds (graph.ts cascade). Nothing is pulled earlier, Done tasks
 *    never move. Without cascade only the item itself changes, and broken dependencies come back as `violations`.
 *    Every moved item is returned, audited ('reschedule') and its task's assignee and followers are notified.
 */

type Moved = {
  kind: 'phase' | 'task'; id: string; label: string;
  cause: 'requested' | 'phase_moved' | 'parent_moved' | 'dependency';
  previous: { start_date: string | null; end_date: string | null }; next: { start_date: string | null; end_date: string | null };
  shifted_days: number | null;
  audit_event_id: string;
};

/** undefined keeps the current value, null or '' clears it, otherwise a YYYY-MM-DD date. */
const dateField = (v: unknown, field: string, current: string | null) => (v === undefined ? current : v == null || v === '' ? null : isoDate(v, field));
const cascadeOf = (v: unknown) => {
  if (v == null) return false;
  if (typeof v !== 'boolean') throw bad('cascade', 'cascade is true or false.', 'boolean');
  return v;
};
/** How far a move shifted an item: by its start when both have one, else by its end. */
const deltaOf = (prev: { start: string | null; end: string | null }, next: { start: string | null; end: string | null }) =>
  prev.start && next.start ? daysFrom(prev.start, next.start) : prev.end && next.end ? daysFrom(prev.end, next.end) : 0;

async function projectTasks(tx: Tx, projectId: string) {
  return (await tx.query(
    `select t.id, t.title, t.status, t.start_date, t.due_date, t.phase_id, t.parent_task_id, t.assignee_id from task t where t.project_id = $1`, [projectId],
  )).rows;
}

/** Writes the moved tasks, audits each and tells their assignees and followers. Returns the moved list. */
async function applyTaskMoves(tx: Tx, actor: Actor, firmId: string, project: any, rows: any[], graph: Map<string, GraphTask>, causes: Map<string, Moved['cause']>, why: string) {
  const moved: Moved[] = [];
  for (const r of rows) {
    const g = graph.get(r.id)!;
    if (g.start === r.start_date && g.due === r.due_date) continue;
    const cause = causes.get(r.id) ?? 'dependency';
    await tx.query('update task set start_date = $2, due_date = $3, updated_by = $4, updated_at = now() where id = $1', [r.id, g.start, g.due, actor.id]);
    const audit_event_id = await audit(tx, actor, firmId, {
      recordType: 'task', recordId: r.id, action: 'reschedule',
      previous: { start_date: r.start_date, due_date: r.due_date }, next: { start_date: g.start, due_date: g.due, cause },
      reason: cause === 'requested' ? undefined : why,
    });
    moved.push({
      kind: 'task', id: r.id, label: r.title, cause,
      previous: { start_date: r.start_date, end_date: r.due_date }, next: { start_date: g.start, end_date: g.due },
      shifted_days: cause === 'requested' ? null : deltaOf({ start: r.start_date, end: r.due_date }, { start: g.start, end: g.due }),
      audit_event_id,
    });
    const when = g.start && g.due && g.start !== g.due ? `${g.start} to ${g.due}` : g.due ? `due ${g.due}` : g.start ? `starting ${g.start}` : 'no dates';
    const text = `${actor.name} rescheduled "${r.title}" on ${project.code}: ${when}.`;
    const to = new Set<string>();
    if (r.assignee_id) to.add(r.assignee_id);
    for (const id of await followersToTell(tx, firmId, { id: r.id, assignee_id: r.assignee_id, project_id: project.id })) to.add(id);
    to.delete(actor.id);
    for (const p of to) await notify(tx, firmId, p, 'task_rescheduled', text, { type: 'task', id: r.id });
  }
  return moved;
}

/** Runs the cascade from the seeds (already moved in `graph`) and writes everything that moved. */
async function settle(tx: Tx, actor: Actor, firmId: string, project: any, rows: any[], graph: Map<string, GraphTask>, seeds: Set<string>, causes: Map<string, Moved['cause']>, doCascade: boolean, why: string) {
  const edges = await projectEdges(tx, project.id);
  if (doCascade) for (const id of cascade(graph, edges, seeds).keys()) causes.set(id, 'dependency');
  const moved = await applyTaskMoves(tx, actor, firmId, project, rows, graph, causes, why);
  const touched = new Set([...seeds, ...moved.map((m) => m.id)]);
  return { moved, violations: violations(graph, edges, touched) };
}

function graphOf(rows: any[]) {
  return new Map<string, GraphTask>(rows.map((r) => [r.id, { id: r.id, start: r.start_date, due: r.due_date, done: r.status === 'Done' }]));
}

export function scheduleRoutes(api: Api) {
  const { get, put } = api;
  healthRoutes(api);

  get('/projects/:code/schedule', async ({ tx, actor, params, query }) => {
    const p = await findProject(tx, params.code);
    assertProjectVisible(actor, p.id);
    const clock = await firmClock(tx, query.as_of);
    const plan = (await plansFor(tx, [p.id], clock)).get(p.id)!;
    const { blocking_overdue_tasks, ...rest } = plan;
    return {
      today: clock.today, timezone: clock.tz, as_of: clock.as_of,
      project: { id: p.id, code: p.code, name: p.name, client: p.client_name, status: p.status, hold_reason: p.hold_reason, pm: { id: p.pm_id, ref_code: p.pm_ref, name: p.pm_name } },
      can_reschedule: mayPlan(actor, p.id),
      ...rest,
      blocking_overdue_tasks: blocking_overdue_tasks.length,
      definition: SCHEDULE_DEFINITION,
    };
  });

  get('/schedule', async ({ tx, actor, query, req }) => {
    const v = visibleProjects(actor);
    let pmId: string | null = null;
    if (query.pm != null && query.pm !== '') {
      const pm = (await tx.query('select id from person where id::text = $1 or ref_code = $1', [String(query.pm)])).rows[0];
      if (!pm) throw bad('pm', 'Choose a person from this studio.', 'unknown');
      pmId = pm.id;
    }
    const STATUSES = ['Draft', 'Active', 'On hold', 'Delivery complete', 'Archived'];
    const statuses = query.status != null && query.status !== '' ? String(query.status).split(',').map((s) => s.trim()).filter(Boolean) : null;
    const unknown = statuses?.find((s) => !STATUSES.includes(s));
    if (unknown) throw bad('status', `A project status is one of ${STATUSES.join(', ')}.`, 'enum');
    const clock = await firmClock(tx, query.as_of);
    const rows = (await tx.query(
      `select p.id, p.code, p.name, p.status, p.hold_reason, c.name as client, pm.id as pm_id, pm.ref_code as pm_ref, pm.name as pm_name
       from project p join client c on c.id = p.client_id join person pm on pm.id = p.pm_id
       where ($1::uuid[] is null or p.id = any($1)) and ($2::uuid is null or p.pm_id = $2)
         and (case when $3::text[] is null then p.status <> 'Archived' else p.status = any($3) end)
       order by p.code`,
      [v === 'all' ? null : v, pmId, statuses],
    )).rows;
    const plans = await plansFor(tx, rows.map((r) => r.id), clock);
    const data = rows.map((p) => {
      const plan = plans.get(p.id)!;
      return {
        project: { id: p.id, code: p.code, name: p.name, client: p.client, status: p.status, hold_reason: p.hold_reason, pm: { id: p.pm_id, ref_code: p.pm_ref, name: p.pm_name } },
        can_reschedule: mayPlan(actor, p.id),
        planned_start: plan.planned_start, planned_end: plan.planned_end, forecast_end: plan.forecast_end,
        slip_days: plan.slip_days, end_slip_days: plan.end_slip_days, slip_driver: plan.slip_driver,
        progress_pct: plan.progress_pct, hours: plan.hours,
        open_tasks: plan.open_tasks, overdue_tasks: plan.overdue_tasks, blocking_overdue_tasks: plan.blocking_overdue_tasks.length,
        phases: plan.phases, milestones: plan.milestones,
      };
    });
    return { ...list(req, data), today: clock.today, timezone: clock.tz, as_of: clock.as_of, definition: SCHEDULE_DEFINITION };
  });

  put('/phases/:id/dates', async ({ tx, actor, firmId, params, body }) => {
    const id = uuidParam(params.id, 'Phase');
    const ph = (await tx.query('select id, project_id, code, name, start_date, end_date from phase where id = $1', [id])).rows[0];
    if (!ph) throw notFound('Phase');
    assertProjectVisible(actor, ph.project_id);
    authorize(actor, 'projects.plan', { projectId: ph.project_id });
    const start = dateField(body.start_date, 'start_date', ph.start_date);
    const end = dateField(body.end_date, 'end_date', ph.end_date);
    assertDateOrder(start, end);
    const doCascade = cascadeOf(body.cascade);
    const project = await findProject(tx, ph.project_id);
    await lockProject(tx, project.id);

    const moved: Moved[] = [];
    let audit_event_id: string | null = null;
    if (start !== ph.start_date || end !== ph.end_date) {
      await tx.query('update phase set start_date = $2, end_date = $3, updated_by = $4, updated_at = now() where id = $1', [id, start, end, actor.id]);
      audit_event_id = await audit(tx, actor, firmId, {
        recordType: 'phase', recordId: id, action: 'reschedule', previous: { start_date: ph.start_date, end_date: ph.end_date }, next: { start_date: start, end_date: end, cascade: doCascade },
      });
      moved.push({ kind: 'phase', id, label: ph.name, cause: 'requested', previous: { start_date: ph.start_date, end_date: ph.end_date }, next: { start_date: start, end_date: end }, shifted_days: null, audit_event_id });
    }
    const rows = await projectTasks(tx, project.id);
    const graph = graphOf(rows);
    const seeds = new Set<string>();
    const causes = new Map<string, Moved['cause']>();
    const delta = deltaOf({ start: ph.start_date, end: ph.end_date }, { start, end });
    if (doCascade && delta !== 0) {
      for (const r of rows.filter((x) => x.phase_id === id && x.status !== 'Done')) {
        const g = graph.get(r.id)!;
        g.start = shift(g.start, delta); g.due = shift(g.due, delta);
        seeds.add(r.id); causes.set(r.id, 'phase_moved');
      }
    }
    const done = await settle(tx, actor, firmId, project, rows, graph, seeds, causes, doCascade, `Moved with phase ${ph.code} ${ph.name}`);
    return {
      phase: { id, code: ph.code, name: ph.name, start_date: start, end_date: end },
      cascade: doCascade, shifted_days: delta, moved: [...moved, ...done.moved], violations: done.violations, audit_event_id,
    };
  });

  put('/tasks/:id/dates', async ({ tx, actor, firmId, params, body }) => {
    const t = await loadTask(tx, uuidParam(params.id, 'Task'));
    assertProjectVisible(actor, t.project_id);
    authorize(actor, 'projects.plan', { projectId: t.project_id });
    if (body.due_date !== undefined && body.end_date !== undefined && body.due_date !== body.end_date) {
      throw bad('end_date', 'Send the end as due_date or end_date, not two different dates.', 'conflict');
    }
    const endField = body.due_date !== undefined ? 'due_date' : 'end_date';
    const start = dateField(body.start_date, 'start_date', t.start_date);
    const due = dateField(body.due_date !== undefined ? body.due_date : body.end_date, endField, t.due_date);
    assertDateOrder(start, due);
    const doCascade = cascadeOf(body.cascade);
    const project = await findProject(tx, t.project_id);
    await lockProject(tx, project.id);

    const rows = await projectTasks(tx, project.id);
    const graph = graphOf(rows);
    const g = graph.get(t.id)!;
    g.start = start; g.due = due;
    const seeds = new Set([t.id]);
    const causes = new Map<string, Moved['cause']>([[t.id, 'requested']]);
    const delta = deltaOf({ start: t.start_date, end: t.due_date }, { start, end: due });
    if (doCascade && delta !== 0) {
      for (const r of rows.filter((x) => x.parent_task_id === t.id && x.status !== 'Done')) {
        const s = graph.get(r.id)!;
        s.start = shift(s.start, delta); s.due = shift(s.due, delta);
        seeds.add(r.id); causes.set(r.id, 'parent_moved');
      }
    }
    const done = await settle(tx, actor, firmId, project, rows, graph, seeds, causes, doCascade, `Follows "${t.title}"`);
    const audit_event_id = done.moved.find((m) => m.id === t.id)?.audit_event_id ?? null;
    return { task: taskView(actor, await loadTask(tx, t.id)), cascade: doCascade, shifted_days: delta, moved: done.moved, violations: done.violations, audit_event_id };
  });
}

