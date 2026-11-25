/**
 * Live client for project tasks (API migration 010): the project Tasks tab, My work and Home.
 * A planner of the project creates, edits, assigns and deletes; the assignee changes the status and adds notes.
 */
import { apiFetch, type ListResponse } from '../live';
import type { Status } from '../../ui/status-colors';
import type { ApiProject } from './projects';
import { mapMyTime, periodFor, type ApiMyTime, type LiveTimesheet } from './time';

export const TASK_STATUSES = ['To do', 'In progress', 'Blocked', 'Done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_PRIORITIES = ['High', 'Normal', 'Low'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

type Ref = { id: string; ref_code: string; name: string; job_title?: string | null };
export type LiveTask = {
  id: string;
  project: { id: string; code: string; name: string };
  phase: { id: string; code: string; name: string } | null;
  title: string;
  description: string | null;
  assignee: Ref | null;
  due_date: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  sort_order: number;
  completed_at: string | null;
  note_count: number;
  can_edit: boolean;
  can_change_status: boolean;
  /** Round 2 (migration 012). Optional: older replies and fixtures leave them out. */
  parent_task_id?: string | null;
  start_date?: string | null;
  estimate_hours?: string | null;
  logged_hours?: string | null;
  subtask_count?: number;
};
export type TaskNote = { id: string; body: string; created_at: string; author: { id: string; name: string } };
export type TaskRef = { id: string; title: string; status: TaskStatus; start_date: string | null; due_date: string | null; assignee_id: string | null; phase_id: string | null };
export type TaskLink = { dependency_id: string; type: string; lag_days: number; task: TaskRef };
export type TaskFollower = { id: string; ref_code: string; name: string; since?: string };
export type TaskEstimate = {
  estimate_hours: string | null; logged_hours: string; remaining_hours: string | null; over_estimate: boolean;
  subtasks: { estimate_hours: string; logged_hours: string };
  total: { estimate_hours: string | null; logged_hours: string };
};
/** GET /tasks/:id. The round 2 parts are optional: PUT /tasks/:id answers with the task and its notes only. */
export type LiveTaskDetail = LiveTask & {
  notes: TaskNote[]; added_to_team?: boolean;
  subtasks?: LiveTask[]; blocked_by?: TaskLink[]; blocks?: TaskLink[]; followers?: TaskFollower[]; is_following?: boolean;
  approved_hours?: string | null; estimate?: TaskEstimate;
};

export type TaskInput = {
  title?: string;
  description?: string | null;
  phase_id?: string | null;
  assignee_id?: string | null;
  due_date?: string | null;
  start_date?: string | null;
  estimate_hours?: number | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  /** Puts a person who is not on the team on it as a contributor, in the same save. Planners only. */
  add_to_team?: boolean;
  /** A progress note, added to the task. */
  note?: string;
};

const projectPath = (code: string) => `/projects/${encodeURIComponent(code)}/tasks`;
const taskPath = (id: string) => `/tasks/${encodeURIComponent(id)}`;

/** GET /projects/:code/tasks: the tasks and whether the viewer may plan this project. */
export async function listProjectTasks(code: string): Promise<{ tasks: LiveTask[]; canPlan: boolean }> {
  const r = await apiFetch<ListResponse<LiveTask> & { can_plan: boolean }>(projectPath(code));
  return { tasks: r.data, canPlan: !!r.can_plan };
}
export const getTask = (id: string) => apiFetch<LiveTaskDetail>(taskPath(id));
export const createTask = (code: string, body: TaskInput) => apiFetch<LiveTaskDetail>(projectPath(code), { method: 'POST', body });
export const updateTask = (id: string, body: TaskInput) => apiFetch<LiveTaskDetail>(taskPath(id), { method: 'PUT', body });
export const deleteTask = (id: string) => apiFetch<{ id: string; deleted: true }>(taskPath(id), { method: 'DELETE' });

// ---------- Round 2: sub-tasks, dependencies, followers and time on a task ----------

/** POST /tasks/:id/subtasks (planners). A sub-task cannot have sub-tasks of its own (422). */
export const createSubtask = (parentId: string, body: TaskInput) => apiFetch<LiveTaskDetail>(`${taskPath(parentId)}/subtasks`, { method: 'POST', body });

export type DependencyDirection = 'blocked_by' | 'blocks';
/**
 * POST /tasks/:id/dependencies (planners). "blocked_by": this task waits for `otherId`; "blocks": `otherId` waits for
 * this task. Self-links, a task and its sub-task, another project's task and cycles come back as 422 with a sentence.
 */
export const addDependency = (taskId: string, direction: DependencyDirection, otherId: string) =>
  apiFetch<{ dependency: { id: string }; task: LiveTaskDetail }>(`${taskPath(taskId)}/dependencies`, {
    method: 'POST', body: direction === 'blocked_by' ? { predecessor_id: otherId } : { successor_id: otherId },
  });
export const removeDependency = (taskId: string, dependencyId: string) =>
  apiFetch<{ id: string; deleted: true; task: LiveTaskDetail }>(`${taskPath(taskId)}/dependencies/${encodeURIComponent(dependencyId)}`, { method: 'DELETE' });

type FollowReply = { task_id: string; person_id: string; following: boolean; followers: TaskFollower[] };
/** POST /tasks/:id/followers: yourself without a person, someone else (planners) with one. */
export const followTask = (taskId: string, personId?: string) =>
  apiFetch<FollowReply>(`${taskPath(taskId)}/followers`, { method: 'POST', body: personId ? { person_id: personId } : {} });
export const unfollowTask = (taskId: string, personId?: string) =>
  apiFetch<FollowReply>(`${taskPath(taskId)}/followers${personId ? `/${encodeURIComponent(personId)}` : ''}`, { method: 'DELETE' });

/** POST /time-entries on a task: the API files it on the task's phase. */
export const logTaskTime = (body: { task_id?: string; service_date: string; duration_hours: number; note?: string; phase_id?: string; internal_category_id?: string }) =>
  apiFetch<{ id: string; approval_state: string; task_id: string | null }>('/time-entries', { method: 'POST', body });
/** POST /timers/start, with the task when there is one. */
export const startTaskTimer = (body: { phase_id?: string; internal_category_id?: string; task_id?: string }) => apiFetch<{ id: string }>('/timers/start', { method: 'POST', body });
/** PUT /me/time/cell for a line that may be a task line: (phase_id, task_id). */
export const putTaskCell = (body: { service_date: string; duration_hours: number; phase_id?: string; internal_category_id?: string; task_id?: string; entry_id?: string }) =>
  apiFetch<{ ok: true }>('/me/time/cell', { method: 'PUT', body });

/** A /me/time line with the task the API keyed it by (`phase:task`). */
type ApiTaskLine = ApiMyTime['lines'][number] & { task_id?: string | null; task?: { id: string; title: string } | null };
export type TaskLineInfo = { taskId: string; title: string };
export type LiveTimesheetWithTasks = LiveTimesheet & { tasks: Record<string, TaskLineInfo> };

/** Maps GET /me/time like the plain grid, and titles each task line with its task: two lines on one phase never read the same. */
export function mapMyTimeWithTasks(res: ApiMyTime, offset: number): LiveTimesheetWithTasks {
  const sheet = mapMyTime(res, offset);
  const tasks: Record<string, TaskLineInfo> = {};
  for (const l of res.lines as ApiTaskLine[]) {
    if (l.task_id && l.task) tasks[l.key] = { taskId: l.task_id, title: l.task.title };
  }
  return {
    ...sheet, tasks,
    lines: sheet.lines.map((l) => (tasks[l.id] ? { ...l, title: tasks[l.id].title, subtitle: `${l.subtitle ? `${l.subtitle} · ` : ''}${l.title}` } : l)),
  };
}
export const getMyTimeWithTasks = async (offset: number) => mapMyTimeWithTasks(await apiFetch<ApiMyTime>(`/me/time?period=${periodFor(offset)}`), offset);

/** Tasks a dependency may point at: not this task, not its parent or its own sub-tasks, not linked already. */
export function dependencyCandidates(all: LiveTask[], detail: LiveTaskDetail): LiveTask[] {
  const linked = new Set([...(detail.blocked_by ?? []), ...(detail.blocks ?? [])].map((l) => l.task.id));
  const subs = new Set((detail.subtasks ?? []).map((s) => s.id));
  return all.filter((t) => t.id !== detail.id && t.id !== detail.parent_task_id && t.parent_task_id !== detail.id && !subs.has(t.id) && !linked.has(t.id));
}

/** Hours logged against the estimate: widths for the bar and the sentence beside it. */
export function estimateBar(logged: number, estimate: number | null): { loggedPct: number; estimatePct: number | null; overPct: number; note: string; over: boolean } {
  if (estimate == null || estimate <= 0) return { loggedPct: logged > 0 ? 100 : 0, estimatePct: null, overPct: 0, note: 'No estimate', over: false };
  const scale = Math.max(estimate, logged);
  const over = logged > estimate;
  const fmt = (n: number) => `${Number(n.toFixed(2))} h`;
  return {
    loggedPct: (Math.min(logged, estimate) / scale) * 100, estimatePct: (estimate / scale) * 100, overPct: over ? ((logged - estimate) / scale) * 100 : 0,
    note: over ? `${fmt(logged - estimate)} over estimate` : `${fmt(estimate - logged)} left`, over,
  };
}

export type MyTasks = { today: string; tasks: LiveTask[]; overdue: number; dueSoon: number };
/** GET /me/tasks: my open tasks across projects, soonest due first. */
export async function getMyTasksLive(): Promise<MyTasks> {
  const r = await apiFetch<ListResponse<LiveTask> & { today: string; overdue: number; due_soon: number }>('/me/tasks');
  return { today: r.today, tasks: r.data, overdue: r.overdue, dueSoon: r.due_soon };
}

/** The project's phases for the phase picker, from GET /projects/:code. */
export async function getTaskPhases(code: string): Promise<{ id: string; code: string; name: string }[]> {
  const p = await apiFetch<ApiProject>(`/projects/${encodeURIComponent(code)}`);
  return p.phases.map((ph) => ({ id: ph.id, code: ph.code, name: ph.name }));
}

// ---------- Pure helpers the screens share (and the tests check) ----------

/** The design system has no "To do" chip: it reads as Planned's outlined marker, labelled "To do". */
export const statusChip = (s: TaskStatus): { status: Status; label?: string } => (s === 'To do' ? { status: 'Planned', label: 'To do' } : { status: s });
/** TaskRow's priority scale is High / Medium / Low. */
export const rowPriority = (p: TaskPriority): 'High' | 'Medium' | 'Low' => (p === 'Normal' ? 'Medium' : p);

export const NO_PHASE = 'No phase';
export const phaseLabel = (t: LiveTask) => (t.phase ? `${t.phase.code} ${t.phase.name}` : NO_PHASE);

export type DueGroup = 'Overdue' | 'Today' | 'This week' | 'Later' | 'No due date';
export const DUE_GROUPS: DueGroup[] = ['Overdue', 'Today', 'This week', 'Later', 'No due date'];
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Where a task sits against the studio's today: this week means within the next seven days. */
export function dueGroup(due: string | null, today: string): DueGroup {
  if (!due) return 'No due date';
  if (due < today) return 'Overdue';
  if (due === today) return 'Today';
  return due <= addDays(today, 7) ? 'This week' : 'Later';
}
/** Open tasks due within seven days or overdue, soonest first: Home's "Due soon". */
export const dueSoon = (tasks: LiveTask[], today: string) =>
  tasks.filter((t) => t.status !== 'Done' && t.due_date && t.due_date <= addDays(today, 7))
    .sort((a, b) => (a.due_date! < b.due_date! ? -1 : a.due_date! > b.due_date! ? 1 : 0));

/** "Divya Menon will be added to the PRJ-01 team as a contributor." when the chosen person is not on it. */
export function needsTeam(assigneeId: string | null, teamIds: Set<string>) {
  return !!assigneeId && !teamIds.has(assigneeId);
}
