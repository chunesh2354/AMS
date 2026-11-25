import { hours } from '../../http/responses';
import { isoDate } from '../../http/validation';
import type { Tx } from '../../db/pool';
import { ACTUAL_SQL } from '../projects/projects.routes';
import { localDate } from '../time/time.routes';
import { daysFrom, forecast, type GraphEdge, type GraphTask } from './graph';

/**
 * The schedule of one or more projects (the Gantt): phases with planned dates, delivery progress, forecast end and
 * hours; milestones with dates; tasks with planned and forecast dates and their dependencies.
 *
 * Definitions (all dates in the studio's timezone, calendar days):
 *  - Phase progress is delivery_progress_pct, entered by the PM. Hours never set it (R8).
 *  - Task progress: Done 100; a task with sub-tasks, the share of its sub-tasks that are Done; else from the status
 *    (To do 0, Blocked 0, In progress 50). Hours never set it (R7).
 *  - Task forecast: graph.ts forecast() (dependencies pushed forward, unfinished work not before today).
 *  - Phase forecast end: a Complete or Cancelled phase ends as planned. Otherwise the latest of its planned end, the
 *    forecast end of each of its open tasks, and today when the planned end has passed.
 *  - Phase slip = forecast end - planned end, in days, never below zero (null without a planned end).
 *  - Project: planned start/end are the earliest phase start and the latest phase end (Cancelled phases left out).
 *    Forecast end is the latest phase forecast end or forecast end of an open task without a phase.
 *    slip_days is the worst slip of any phase, or of the project end; slip_driver names it.
 *  - Hours: budget from approved budget lines, actual = approved time (+ imported opening hours), forecast = actual + ETC.
 */

export const SCHEDULE_DEFINITION = [
  'Dates are calendar days in the studio timezone. Today is the studio date unless as_of is given.',
  'Phase progress is the delivery progress the PM entered; hours never set it.',
  'Task progress: Done 100; with sub-tasks, the share of sub-tasks Done; otherwise To do 0, Blocked 0, In progress 50.',
  'Finish-to-start: a successor starts no earlier than the predecessor due date + 1 + lag days.',
  'Task forecast: planned dates pushed later by unfinished predecessors; unfinished work cannot end before today.',
  'Phase forecast end: the latest of the planned end, its open tasks’ forecast ends, and today once the planned end has passed (Complete and Cancelled phases end as planned).',
  'Slip: forecast end minus planned end in days, never below zero. Project slip is the worst phase slip or project-end slip.',
  'Hours: budget from approved budget lines; actual is approved time plus imported opening hours; forecast = actual + ETC.',
];

export type Clock = { tz: string; today: string; as_of: string | null };

/** The studio's date today (or as_of, for a report as of a day). */
export async function firmClock(tx: Tx, asOf: unknown): Promise<Clock> {
  const tz = ((await tx.query('select timezone from firm')).rows[0]?.timezone as string | undefined) || 'Asia/Kolkata';
  const given = asOf != null && asOf !== '' ? isoDate(asOf, 'as_of') : null;
  return { tz, today: given ?? localDate(tz), as_of: given };
}

const latest = (...ds: (string | null | undefined)[]) => ds.reduce<string | null>((m, d) => (d == null ? m : m == null || d > m ? d : m), null);
const earliest = (...ds: (string | null | undefined)[]) => ds.reduce<string | null>((m, d) => (d == null ? m : m == null || d < m ? d : m), null);
const slip = (planned: string | null, fc: string | null) => (planned && fc ? Math.max(0, daysFrom(planned, fc)) : null);

export function taskProgress(status: string, subs: { status: string }[]) {
  if (status === 'Done') return 100;
  if (subs.length) return Math.round((100 * subs.filter((s) => s.status === 'Done').length) / subs.length);
  return status === 'In progress' ? 50 : 0;
}

export type ProjectPlan = ReturnType<typeof build>;

/** Builds the plan of each project id, in a handful of queries. */
export async function plansFor(tx: Tx, projectIds: string[], clock: Clock) {
  const out = new Map<string, ReturnType<typeof build>>();
  if (!projectIds.length) return out;
  const phases = (await tx.query(
    `select ph.*, o.ref_code as owner_ref, o.name as owner_name,
       coalesce((select sum(bl.hours) from budget_line bl join budget_version bv on bv.id = bl.budget_version_id where bl.phase_id = ph.id and bv.status = 'Approved'), 0) as budget_hours,
       ph.opening_actual_hours + coalesce((select sum(te.duration_hours) from time_entry te where te.phase_id = ph.id and ${ACTUAL_SQL}), 0) as actual_hours,
       coalesce((select sum(a.amount) from phase_fee_allocation a where a.phase_id = ph.id), 0) as fee
     from phase ph left join person o on o.id = ph.owner_id where ph.project_id = any($1::uuid[]) order by ph.sort_order, ph.start_date nulls last`, [projectIds],
  )).rows;
  const tasks = (await tx.query(
    `select t.id, t.project_id, t.phase_id, t.parent_task_id, t.title, t.status, t.priority, t.start_date, t.due_date, t.completed_at, t.sort_order,
       t.estimate_hours, a.id as assignee_id, a.ref_code as assignee_ref, a.name as assignee_name
     from task t left join person a on a.id = t.assignee_id where t.project_id = any($1::uuid[])
     order by t.sort_order, t.due_date nulls last, t.created_at`, [projectIds],
  )).rows;
  const edges = (await tx.query(
    `select d.id, d.predecessor_id, d.successor_id, d.type, d.lag_days, t.project_id from task_dependency d join task t on t.id = d.successor_id
     where t.project_id = any($1::uuid[])`, [projectIds],
  )).rows;
  const milestones = (await tx.query(
    `select m.id, m.label, m.status, m.phase_id, m.planned_date, c.project_id from billing_milestone m join fee_component c on c.id = m.fee_component_id
     where c.project_id = any($1::uuid[]) order by m.planned_date nulls last, m.label`, [projectIds],
  )).rows;
  for (const id of projectIds) {
    out.set(id, build(
      clock,
      phases.filter((x) => x.project_id === id),
      tasks.filter((x) => x.project_id === id),
      edges.filter((x) => x.project_id === id),
      milestones.filter((x) => x.project_id === id),
    ));
  }
  return out;
}

function build(clock: Clock, phases: any[], tasks: any[], edges: (GraphEdge & { id: string; type: string })[], milestones: any[]) {
  const { today, tz } = clock;
  const graph = new Map<string, GraphTask>(tasks.map((t) => [t.id, {
    id: t.id, start: t.start_date, due: t.due_date, done: t.status === 'Done', completedOn: t.completed_at ? localDate(tz, new Date(t.completed_at)) : null,
  }]));
  const fc = forecast(graph, edges, today);
  const open = (t: any) => t.status !== 'Done';
  const succOf = new Map<string, string[]>();
  for (const e of edges) succOf.set(e.predecessor_id, [...(succOf.get(e.predecessor_id) ?? []), e.successor_id]);
  const byId = new Map(tasks.map((t) => [t.id, t]));

  const taskOut = tasks.map((t) => {
    const f = fc.get(t.id)!;
    const overdue = open(t) && !!t.due_date && t.due_date < today;
    const openSuccessors = (succOf.get(t.id) ?? []).filter((s) => byId.has(s) && open(byId.get(s)));
    return {
      id: t.id as string, title: t.title as string, phase_id: t.phase_id as string | null, parent_task_id: t.parent_task_id as string | null,
      status: t.status as string, priority: t.priority as string, sort_order: t.sort_order as number,
      start_date: t.start_date as string | null, due_date: t.due_date as string | null,
      forecast_start: f.start, forecast_end: f.end, slip_days: open(t) ? slip(t.due_date, f.end) : null,
      progress_pct: taskProgress(t.status, tasks.filter((s) => s.parent_task_id === t.id)),
      estimate_hours: hours(t.estimate_hours),
      overdue, blocking: overdue && openSuccessors.length > 0, blocks_open_tasks: openSuccessors.length,
      assignee: t.assignee_id ? { id: t.assignee_id, ref_code: t.assignee_ref, name: t.assignee_name } : null,
      dependencies: edges.filter((e) => e.successor_id === t.id).map((e) => ({ dependency_id: e.id, predecessor_id: e.predecessor_id, type: e.type, lag_days: e.lag_days })),
    };
  });

  const phaseOut = phases.map((ph) => {
    const own = taskOut.filter((t) => t.phase_id === ph.id);
    const closed = ph.status === 'Complete' || ph.status === 'Cancelled';
    const forecastEnd = closed
      ? ph.end_date
      : latest(ph.end_date, ...own.filter((t) => t.status !== 'Done').map((t) => t.forecast_end), ph.end_date && ph.end_date < today ? today : null);
    const budget = Number(ph.budget_hours); const actual = Number(ph.actual_hours); const etc = Number(ph.etc_hours);
    return {
      id: ph.id as string, code: ph.code as string, name: ph.name as string, status: ph.status as string, sort_order: ph.sort_order as number,
      owner: ph.owner_id ? { id: ph.owner_id, ref_code: ph.owner_ref, name: ph.owner_name } : null,
      start_date: ph.start_date as string | null, end_date: ph.end_date as string | null,
      progress_pct: Number(ph.delivery_progress_pct),
      forecast_end: forecastEnd as string | null, slip_days: closed ? (ph.end_date ? 0 : null) : slip(ph.end_date, forecastEnd),
      budget_hours: hours(budget), actual_hours: hours(actual), etc_hours: hours(etc), forecast_hours: hours(actual + etc),
      fee_weight: Number(ph.fee),
      task_count: own.length, open_tasks: own.filter((t) => t.status !== 'Done').length, overdue_tasks: own.filter((t) => t.overdue).length,
    };
  });

  const phaseById = new Map(phaseOut.map((p) => [p.id, p]));
  const milestoneOut = milestones.map((m) => {
    const ph = m.phase_id ? phaseById.get(m.phase_id) : undefined;
    const date = m.planned_date ?? ph?.end_date ?? null;
    return {
      id: m.id as string, label: m.label as string, status: m.status as string, phase_id: m.phase_id as string | null,
      date, date_source: m.planned_date ? 'planned' : date ? 'phase_end' : null,
    };
  });

  const live = phaseOut.filter((p) => p.status !== 'Cancelled');
  const plannedStart = earliest(...live.map((p) => p.start_date));
  const plannedEnd = latest(...live.map((p) => p.end_date));
  const forecastEnd = latest(...live.map((p) => p.forecast_end), ...taskOut.filter((t) => !t.phase_id && t.status !== 'Done').map((t) => t.forecast_end));
  const endSlip = slip(plannedEnd, forecastEnd);
  let worst: { days: number; driver: { kind: 'phase' | 'project'; id: string | null; name: string } | null } = { days: 0, driver: null };
  for (const p of live) if ((p.slip_days ?? 0) > worst.days) worst = { days: p.slip_days!, driver: { kind: 'phase', id: p.id, name: p.name } };
  if ((endSlip ?? 0) > worst.days) worst = { days: endSlip!, driver: { kind: 'project', id: null, name: 'Project end' } };

  const weight = live.reduce((s, p) => s + p.fee_weight, 0);
  const progress = live.length
    ? weight > 0 ? live.reduce((s, p) => s + p.progress_pct * p.fee_weight, 0) / weight : live.reduce((s, p) => s + p.progress_pct, 0) / live.length
    : 0;
  const sum = (k: 'budget_hours' | 'actual_hours' | 'etc_hours') => phaseOut.filter((p) => p.status !== 'Cancelled').reduce((s, p) => s + Number(p[k]), 0);
  const budget = sum('budget_hours'); const actual = sum('actual_hours'); const etc = sum('etc_hours');

  return {
    planned_start: plannedStart, planned_end: plannedEnd, forecast_end: forecastEnd,
    slip_days: plannedEnd || live.some((p) => p.end_date) ? worst.days : null, end_slip_days: endSlip, slip_driver: worst.driver,
    progress_pct: Math.round(progress),
    hours: { budget: hours(budget), actual: hours(actual), etc: hours(etc), forecast: hours(actual + etc) },
    phases: phaseOut.map(({ fee_weight: _w, ...p }) => p),
    milestones: milestoneOut,
    tasks: taskOut,
    dependencies: edges.map((e) => ({ id: e.id, predecessor_id: e.predecessor_id, successor_id: e.successor_id, type: e.type, lag_days: e.lag_days })),
    open_tasks: taskOut.filter((t) => t.status !== 'Done').length,
    overdue_tasks: taskOut.filter((t) => t.overdue).length,
    blocking_overdue_tasks: taskOut.filter((t) => t.blocking),
  };
}
