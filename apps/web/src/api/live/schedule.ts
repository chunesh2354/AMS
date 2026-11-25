/**
 * The Gantt schedule (Round 2): GET /projects/:code/schedule, GET /schedule, PUT /phases/:id/dates and
 * PUT /tasks/:id/dates. The shapes are the API's own (apps/api/src/modules/schedule).
 * Mock mode builds the same shape from the sample studio, so the Timeline views render without a server.
 */
import { apiFetch, type ListResponse } from '../live';
import { getProject, getProjects, personName, type ViewerRef } from '../index';
import { getTasks } from '../work';
import { TODAY } from '../../mock/studio-meridian';
import { addDays } from '../../ui/Gantt/model';

type Ref = { id: string; ref_code: string; name: string };
type Hours = string | number;

export type SchedulePhase = {
  id: string; code: string; name: string; status: string; sort_order: number; owner: Ref | null;
  start_date: string | null; end_date: string | null; progress_pct: number; forecast_end: string | null; slip_days: number | null;
  budget_hours: Hours; actual_hours: Hours; etc_hours: Hours; forecast_hours: Hours;
  task_count: number; open_tasks: number; overdue_tasks: number;
};
export type ScheduleTask = {
  id: string; title: string; phase_id: string | null; parent_task_id: string | null; status: string; priority: string; sort_order: number;
  start_date: string | null; due_date: string | null; forecast_start: string | null; forecast_end: string | null; slip_days: number | null;
  progress_pct: number; estimate_hours: Hours | null; overdue: boolean; blocking: boolean; blocks_open_tasks: number; assignee: Ref | null;
  dependencies: { dependency_id: string; predecessor_id: string; type: string; lag_days: number }[];
};
export type ScheduleMilestone = { id: string; label: string; status: string; phase_id: string | null; date: string | null; date_source: 'planned' | 'phase_end' | null };
export type ScheduleDependency = { id: string; predecessor_id: string; successor_id: string; type: string; lag_days: number };
export type ScheduleProjectRef = { id: string; code: string; name: string; client: string; status: string; hold_reason: string | null; pm: Ref };

export type ProjectSchedule = {
  today: string; timezone: string; as_of: string | null;
  project: ScheduleProjectRef;
  can_reschedule: boolean;
  planned_start: string | null; planned_end: string | null; forecast_end: string | null;
  slip_days: number | null; end_slip_days: number | null; slip_driver: { kind: 'phase' | 'project'; id: string | null; name: string } | null;
  progress_pct: number; hours: { budget: Hours; actual: Hours; etc: Hours; forecast: Hours };
  phases: SchedulePhase[]; milestones: ScheduleMilestone[]; tasks: ScheduleTask[]; dependencies: ScheduleDependency[];
  open_tasks: number; overdue_tasks: number; blocking_overdue_tasks: number;
  definition: string[];
};

export type StudioScheduleRow = Omit<ProjectSchedule, 'today' | 'timezone' | 'as_of' | 'tasks' | 'dependencies' | 'definition'>;
export type StudioSchedule = ListResponse<StudioScheduleRow> & { today: string; timezone: string; as_of: string | null; definition: string[] };

export type MovedItem = {
  kind: 'phase' | 'task'; id: string; label: string; cause: 'requested' | 'phase_moved' | 'parent_moved' | 'dependency';
  previous: { start_date: string | null; end_date: string | null }; next: { start_date: string | null; end_date: string | null };
  shifted_days: number | null; audit_event_id: string;
};
export type Violation = { dependency_id?: string; predecessor_id: string; successor_id: string; lag_days: number; earliest_start: string };
export type RescheduleResult = { cascade: boolean; shifted_days: number; moved: MovedItem[]; violations: Violation[]; audit_event_id: string | null };

export const hoursNum = (h: Hours | null | undefined) => (h == null ? 0 : Number(h));

/** GET /projects/:code/schedule */
export const getProjectSchedule = (code: string) => apiFetch<ProjectSchedule>(`/projects/${encodeURIComponent(code)}/schedule`);

/** GET /schedule?pm=&status= (status is a comma list of project statuses). */
export function getStudioSchedule(filter: { pm?: string; status?: string[] } = {}) {
  const q = new URLSearchParams();
  if (filter.pm) q.set('pm', filter.pm);
  if (filter.status?.length) q.set('status', filter.status.join(','));
  const s = q.toString();
  return apiFetch<StudioSchedule>(`/schedule${s ? `?${s}` : ''}`);
}

/** PUT /phases/:id/dates */
export const putPhaseDates = (id: string, body: { start_date: string | null; end_date: string | null; cascade: boolean }) =>
  apiFetch<RescheduleResult & { phase: { id: string; start_date: string | null; end_date: string | null } }>(`/phases/${encodeURIComponent(id)}/dates`, { method: 'PUT', body });

/** PUT /tasks/:id/dates. A task with a due date only sends just the due date. */
export const putTaskDates = (id: string, body: { start_date?: string | null; due_date: string | null; cascade: boolean }) =>
  apiFetch<RescheduleResult>(`/tasks/${encodeURIComponent(id)}/dates`, { method: 'PUT', body });

// ---- Mock mode: the same shapes from the sample studio. Moves apply in the page only. ----

const MOCK_STATUS: Record<string, string> = { Done: 'Complete', Planned: 'Not started', Overrun: 'In progress' };
const mockTaskStatus = (stage: string) => (stage === 'Done' ? 'Done' : stage === 'Planned' || stage === 'Ready' ? 'To do' : 'In progress');

export async function mockProjectSchedule(code: string, viewer: ViewerRef): Promise<ProjectSchedule | null> {
  const p = await getProject(code, viewer);
  if (!p) return null;
  const tasks = await getTasks(code);
  const ref = (id: string): Ref => ({ id, ref_code: id, name: personName(id) });
  const phases: SchedulePhase[] = p.phases.map((ph, i) => ({
    id: ph.id, code: ph.id, name: ph.name, status: MOCK_STATUS[ph.status] ?? ph.status, sort_order: i, owner: ph.ownerId ? ref(ph.ownerId) : null,
    start_date: ph.start, end_date: ph.end, progress_pct: ph.delivery, forecast_end: ph.end, slip_days: 0,
    budget_hours: ph.budget, actual_hours: ph.actual, etc_hours: ph.etc, forecast_hours: ph.actual + ph.etc,
    task_count: 0, open_tasks: 0, overdue_tasks: 0,
  }));
  const st: ScheduleTask[] = tasks.map((t, i) => {
    const status = mockTaskStatus(t.stage);
    const overdue = status !== 'Done' && t.due < TODAY;
    return {
      id: t.id, title: t.title, phase_id: phases.find((ph) => ph.name === t.phase)?.id ?? null, parent_task_id: null, status, priority: t.priority, sort_order: i,
      start_date: addDays(t.due, -4), due_date: t.due, forecast_start: addDays(t.due, -4), forecast_end: overdue ? TODAY : t.due, slip_days: null,
      progress_pct: status === 'Done' ? 100 : status === 'In progress' ? 50 : 0, estimate_hours: t.estimate, overdue, blocking: false, blocks_open_tasks: 0,
      assignee: ref(t.ownerId), dependencies: [],
    };
  });
  const starts = phases.map((x) => x.start_date!).sort(); const ends = phases.map((x) => x.end_date!).sort();
  return {
    today: TODAY, timezone: 'Asia/Kolkata', as_of: null,
    project: { id: p.code, code: p.code, name: p.name, client: p.client, status: p.status, hold_reason: null, pm: ref(p.pmId) },
    can_reschedule: true,
    planned_start: starts[0] ?? null, planned_end: ends.at(-1) ?? null, forecast_end: ends.at(-1) ?? null, slip_days: 0, end_slip_days: 0, slip_driver: null,
    progress_pct: p.delivery, hours: { budget: p.hours.budget, actual: p.hours.actual, etc: p.hours.forecast - p.hours.actual, forecast: p.hours.forecast },
    phases, milestones: [], tasks: st, dependencies: [],
    open_tasks: st.filter((t) => t.status !== 'Done').length, overdue_tasks: st.filter((t) => t.overdue).length, blocking_overdue_tasks: 0,
    definition: [],
  };
}

export async function mockStudioSchedule(viewer: ViewerRef): Promise<StudioSchedule> {
  const projects = await getProjects(viewer);
  const rows: StudioScheduleRow[] = [];
  for (const p of projects) {
    const s = await mockProjectSchedule(p.code, viewer);
    if (!s) continue;
    rows.push(s);
  }
  return { data: rows, page: 1, page_size: rows.length, total: rows.length, complete: true, missing_count: 0, today: TODAY, timezone: 'Asia/Kolkata', as_of: null, definition: [] };
}
