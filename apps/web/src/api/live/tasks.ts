/**
 * Live client for project tasks (API migration 010): the project Tasks tab, My work and Home.
 * A planner of the project creates, edits, assigns and deletes; the assignee changes the status and adds notes.
 */
import { apiFetch, type ListResponse } from '../live';
import type { Status } from '../../ui/status-colors';
import type { ApiProject } from './projects';

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
};
export type TaskNote = { id: string; body: string; created_at: string; author: { id: string; name: string } };
export type LiveTaskDetail = LiveTask & { notes: TaskNote[]; added_to_team?: boolean };

export type TaskInput = {
  title?: string;
  description?: string | null;
  phase_id?: string | null;
  assignee_id?: string | null;
  due_date?: string | null;
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
