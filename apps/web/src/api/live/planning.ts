/**
 * Live client for workload and planning (API migration 011): GET /workload, the /allocations writes and publish.
 * Hours arrive as decimal strings ("8.00"); week_start is always a Monday in the studio's calendar.
 */
import { ApiFailure, apiFetch } from '../live';

type Hours = string | number;
export type PlanRef = { id: string; ref_code: string; name: string };
export type PlanProject = { id: string; code: string; name: string; status: string };
export type PlanPhase = { id: string; code: string; name: string };

export type Allocation = {
  id: string;
  project: PlanProject;
  phase: PlanPhase | null;
  /** Null is unassigned demand. */
  person: PlanRef | null;
  week_start: string;
  hours: Hours;
  state: 'tentative' | 'confirmed';
  note: string | null;
  on_hold: boolean;
  published: boolean;
  unpublished_change: boolean;
  /** Null unless the viewer may plan the project. */
  overallocation_reason: string | null;
  can_edit: boolean;
};

export type WeekLeave = {
  id: string | null; status: 'Approved' | 'Pending'; start_date: string; end_date: string; half_day: boolean;
  leave_type: { key: string; name: string } | null;
  /** "On leave" unless the viewer may see the type. */
  label: string;
};

export type Week = {
  week_start: string; week_end: string;
  capacity: Hours; scheduled: Hours; holiday_hours: Hours;
  holidays: { date: string; name: string; half_day: boolean }[];
  leave_approved: Hours; leave_pending: Hours; on_leave: boolean; leave: WeekLeave[];
  available: Hours; allocated: Hours; confirmed_allocations: Hours; tentative_allocations: Hours; remaining: Hours;
  load_pct: number | null; conflict: boolean; over_hours: Hours;
  /** Hours on projects the viewer cannot open or the filter leaves out: counted in allocated, never named. */
  other_hours: Hours;
  allocations: Allocation[];
};

export type Revision = {
  id: string; revision_no: number; scope: 'firm' | 'project'; project: { id: string; code: string } | null; projects: { id: string; code: string }[];
  published_at: string; published_by: { id: string; name: string }; note: string | null; change_count: number | null; partial: boolean;
};

export type WorkloadPerson = { person: PlanRef & { job_title: string | null }; inactive: boolean; weeks: Week[] };
export type DemandRow = { project: PlanProject; phase: PlanPhase | null; total_hours: Hours; weeks: { week_start: string; hours: Hours; allocations: Allocation[] }[] };
export type WorkloadConflict = { person: PlanRef; week_start: string; available: Hours; confirmed_allocations: Hours; over_hours: Hours };

export type Workload = {
  from: string; to: string; weeks: string[]; today: string; timezone: string; view: 'draft' | 'published';
  project: PlanProject | null; can_plan: boolean; pending_changes: number; last_published: Revision | null;
  unassigned: DemandRow[]; people: WorkloadPerson[]; conflicts: WorkloadConflict[];
};

export type AllocationInput = {
  project_id?: string; week_start?: string; hours?: number; phase_id?: string | null; person_id?: string | null;
  state?: 'tentative' | 'confirmed'; note?: string | null; overallocation_reason?: string | null; add_to_team?: boolean;
};
export type PersonWeek = { person_id: string; week_start: string; available: Hours; allocated: Hours; confirmed_allocations: Hours; remaining: Hours; load_pct: number | null; conflict: boolean; over_hours: Hours };
export type SavedAllocation = Allocation & { added_to_team: boolean; person_week: PersonWeek | null; audit_event_id: string };

export type PublishResult = {
  revision: { id: string; revision_no: number; scope: 'firm' | 'project'; project: { id: string; code: string } | null; note: string | null; published_at: string; published_by: { id: string; name: string }; change_count: number };
  projects: string[]; notified: string[];
  conflicts: { person_id: string; week_start: string; available: Hours; confirmed_allocations: Hours; over_hours: Hours }[];
  audit_event_id: string;
};

export const num = (h: Hours | null | undefined) => (h == null ? 0 : Number(h));

const query = (q: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  Object.entries(q).forEach(([k, v]) => { if (v != null && v !== '') p.set(k, String(v)); });
  const s = p.toString();
  return s ? `?${s}` : '';
};

/** GET /workload: people by week with their availability and allocations, the unassigned demand and the conflicts. */
export const getWorkload = (opts: { from?: string; weeks?: number; project?: string | null } = {}) =>
  apiFetch<Workload>(`/workload${query({ from: opts.from, weeks: opts.weeks ?? 8, project: opts.project })}`);

const allocPath = (id: string) => `/allocations/${encodeURIComponent(id)}`;
export const createAllocation = (body: AllocationInput) => apiFetch<SavedAllocation>('/allocations', { method: 'POST', body });
export const updateAllocation = (id: string, body: AllocationInput) => apiFetch<SavedAllocation>(allocPath(id), { method: 'PUT', body });
export const deleteAllocation = (id: string) => apiFetch<{ id: string; deleted: true; removed_on_publish: boolean; audit_event_id: string }>(allocPath(id), { method: 'DELETE' });
/** POST /allocations/publish. With a project code it publishes that project only. */
export const publishPlan = (body: { project?: string; note?: string } = {}) => apiFetch<PublishResult>('/allocations/publish', { method: 'POST', body });

/** The rule a 422 RULE_VIOLATION names (error.rule), such as PERSON_ON_TEAM or OVERALLOCATION. */
export function ruleOf(e: unknown): string | null {
  if (!(e instanceof ApiFailure) || e.status !== 422) return null;
  const rule = (e.raw as { error?: { rule?: unknown } } | null)?.error?.rule;
  return typeof rule === 'string' ? rule : null;
}

/** A server without the planning API answers 404 on the route itself. */
export const planningMissing = (e: unknown) => e instanceof ApiFailure && e.status === 404;

// ---------- Week arithmetic on YYYY-MM-DD, in UTC so no local offset moves a day ----------

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const utc = (d: string) => new Date(`${d}T00:00:00Z`);
export const addDays = (d: string, n: number) => new Date(utc(d).getTime() + n * 86400000).toISOString().slice(0, 10);
export const mondayOf = (d: string) => addDays(d, -((utc(d).getUTCDay() + 6) % 7));
/** "9 Nov" */
export const dayMonth = (d: string) => `${utc(d).getUTCDate()} ${MON[utc(d).getUTCMonth()]}`;
/** "9 Nov 2026" */
export const dayMonthYear = (d: string) => `${dayMonth(d)} ${utc(d).getUTCFullYear()}`;
/** "Fri 20 Nov" */
export const weekdayDate = (d: string) => `${DOW[utc(d).getUTCDay()]} ${dayMonth(d)}`;

/** Load level from hours, so rounding in load_pct cannot hide an overload. No availability is away, or over if booked. */
export type LoadLevel = 'free' | 'part' | 'full' | 'over' | 'away';
export function loadLevel(allocated: number, available: number): LoadLevel {
  if (available <= 0) return allocated > 0 ? 'over' : 'away';
  if (allocated > available + 0.001) return 'over';
  if (allocated >= 0.8 * available) return 'full';
  if (allocated >= 0.5 * available) return 'part';
  return 'free';
}

/** "8", "7.5": hours without trailing zeros. */
export const fmtH = (h: number) => String(Math.round(h * 100) / 100);
