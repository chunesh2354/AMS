import { apiFetch, hoursOf, type ListResponse } from '../live';

/**
 * Live clients for the studio calendar, My schedule, studio holidays and a person's capacity.
 * Shapes follow apps/api/src/modules/planning/planning.routes.ts (GET /calendar, /me/schedule, /holidays, /people/:id/capacity).
 */

// ---------- Shapes the server sends ----------

type Ref = { id: string; code: string; name: string };
type PhaseRef = { id: string; code: string; name: string; status?: string };

export type LiveCalendarEvent =
  | { id: string; type: 'phase_start' | 'phase_end'; date: string; title: string; project: Ref; phase: PhaseRef }
  | { id: string; type: 'milestone'; date: string; date_basis: 'phase_end'; title: string; status: string; project: Ref; phase: PhaseRef }
  | {
    id: string; type: 'task_due'; date: string; title: string; status: string; project: Ref; phase: PhaseRef | null;
    task: { id: string; assignee: { id: string; name: string } | null; mine: boolean };
  }
  | {
    id: string; type: 'leave'; date: string; start_date: string; end_date: string; half_day: boolean; status: 'Approved' | 'Pending' | string;
    title: string; label: string; leave_type: { key: string; name: string } | null; person: { id: string; ref_code: string; name: string }; mine: boolean;
  }
  | { id: string; type: 'holiday'; date: string; title: string; half_day: boolean };

export type LiveCalendar = {
  from: string; to: string; today: string; timezone: string; types: string[];
  project: Ref | null; events: LiveCalendarEvent[];
};

export type LiveLeaveRef = {
  id: string | null; status: 'Approved' | 'Pending' | string; start_date: string; end_date: string; half_day: boolean;
  leave_type: { key: string; name: string } | null; label: string;
};
export type LiveAllocation = {
  id: string; project: { id: string; code: string; name: string; status: string }; phase: { id: string; code: string; name: string } | null;
  person: { id: string; ref_code: string; name: string } | null; week_start: string; hours: string; state: 'tentative' | 'confirmed';
  note: string | null; on_hold: boolean; published: boolean; unpublished_change: boolean; overallocation_reason: string | null; can_edit: boolean;
};
/** The Week object of /workload, /me/schedule and /people/:id/capacity. Hours are decimal strings. */
export type LiveWeek = {
  week_start: string; week_end: string; capacity: string; scheduled: string; holiday_hours: string;
  holidays: { date: string; name: string; half_day: boolean }[];
  leave_approved: string; leave_pending: string; on_leave: boolean; leave: LiveLeaveRef[];
  available: string; allocated: string; confirmed_allocations: string; tentative_allocations: string; remaining: string;
  load_pct: number | null; conflict: boolean; over_hours: string; other_hours: string; allocations: LiveAllocation[];
};
export type LiveScheduleDay = {
  date: string; dow: string; scheduled: string; available: string;
  holiday: { name: string; half_day: boolean } | null;
  leave: { status: string; half_day: boolean; leave_type: { key: string; name: string } } | null;
};
export type LiveRevision = { id: string; revision_no: number; published_at: string; published_by: { id: string; name: string } };
export type LiveMySchedule = {
  from: string; to: string; today: string; timezone: string; person: { id: string; name: string };
  last_published: LiveRevision | null; weeks: (LiveWeek & { days: LiveScheduleDay[] })[];
};
export type LiveHoliday = { id: string; date: string; name: string; half_day: boolean };
export type LiveHolidays = ListResponse<LiveHoliday> & { from: string; to: string; can_manage: boolean };
export type LiveCapacityVersion = { id: string; effective_from: string; weekly_hours: string; note: string | null; created_at: string; created_by: string | null };
export type LiveCapacity = {
  person: { id: string; ref_code: string; name: string; job_title: string | null; employment_state: string; login_state: string };
  today: string; timezone: string; view: 'draft' | 'published'; firm_default_weekly_hours: string;
  current: { weekly_hours: string; effective_from: string | null; source: 'person' | 'firm_default' };
  versions: LiveCapacityVersion[]; can_manage: boolean; from: string; to: string; weeks: LiveWeek[];
};

// ---------- Calls ----------

const qs = (p: Record<string, string | number | undefined | null>) => {
  const s = new URLSearchParams();
  Object.entries(p).forEach(([k, v]) => { if (v != null && v !== '') s.set(k, String(v)); });
  const t = s.toString();
  return t ? `?${t}` : '';
};

/** GET /calendar for a date range, optionally one project. Types are filtered on the page, so every type is asked for. */
export const getCalendar = (from: string, to: string, project?: string | null) =>
  apiFetch<LiveCalendar>(`/calendar${qs({ from, to, project })}`);
export const getLiveMySchedule = (from?: string, weeks = 6) => apiFetch<LiveMySchedule>(`/me/schedule${qs({ from, weeks })}`);
export const getHolidays = () => apiFetch<LiveHolidays>('/holidays');
export const addHoliday = (body: { date: string; name: string; half_day: boolean }) =>
  apiFetch<LiveHoliday & { audit_event_id: string }>('/holidays', { method: 'POST', body });
export const removeHoliday = (id: string) => apiFetch<{ id: string; deleted: true }>(`/holidays/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const getCapacity = (person: string, weeks = 8) => apiFetch<LiveCapacity>(`/people/${encodeURIComponent(person)}/capacity${qs({ weeks })}`);
export const putCapacity = (person: string, body: { weekly_hours: number; effective_from: string; note?: string }) =>
  apiFetch<{ id: string; effective_from: string; weekly_hours: string; versions: LiveCapacityVersion[] }>(`/people/${encodeURIComponent(person)}/capacity`, { method: 'PUT', body });

// ---------- Dates (studio calendar dates, no time zone arithmetic) ----------

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => isoOf(new Date(utc(iso).getTime() + n * 86_400_000));
export const daysBetween = (a: string, b: string) => Math.round((utc(b).getTime() - utc(a).getTime()) / 86_400_000);
export const mondayOf = (iso: string) => addDays(iso, -((utc(iso).getUTCDay() + 6) % 7));
export const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
export const shiftMonth = (first: string, n: number) => { const d = utc(first); return isoOf(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))); };
export const dayNum = (iso: string) => utc(iso).getUTCDate();
export const dowIndex = (iso: string) => utc(iso).getUTCDay();
/** "25 Nov" */
export const dm = (iso: string) => `${dayNum(iso)} ${MON[utc(iso).getUTCMonth()]}`;
/** "Wed 25 Nov" */
export const wdm = (iso: string) => `${DOW[dowIndex(iso)]} ${dm(iso)}`;
/** "Wed 25 Nov 2026" */
export const wdmy = (iso: string) => `${wdm(iso)} ${utc(iso).getUTCFullYear()}`;
export const monthLabel = (first: string) => `${MONTH_NAMES[utc(first).getUTCMonth()]} ${utc(first).getUTCFullYear()}`;
/** "23 to 29 Nov 2026", "30 Nov to 6 Dec 2026" */
export function weekLabel(monday: string) {
  const end = addDays(monday, 6);
  const sameMonth = utc(monday).getUTCMonth() === utc(end).getUTCMonth();
  return `${sameMonth ? dayNum(monday) : dm(monday)} to ${dm(end)} ${utc(end).getUTCFullYear()}`;
}
/** The Monday-first grid that shows a month: whole weeks from the Monday on or before the 1st to the Sunday on or after the last day. */
export function monthGrid(first: string) {
  const start = mondayOf(first);
  const last = addDays(shiftMonth(first, 1), -1);
  const weeks = Math.ceil((daysBetween(start, last) + 1) / 7);
  return { start, end: addDays(start, weeks * 7 - 1), weeks };
}

// ---------- The calendar's items, for live events and the mock's demo items alike ----------

/** The Show filters. They match the server's `types`: billing milestones are their own type, dated at their phase's end. */
export type CalFilter = 'phase' | 'milestone' | 'task' | 'leave' | 'holiday';
export type CalRow = { k: string; v: string; red?: boolean };
export type CalItem = {
  id: string;
  filter: CalFilter;
  kind: LiveCalendarEvent['type'];
  /** The day (or first day) it shows on, and the last for leave that spans days. */
  date: string; end: string;
  label: string;
  /** What the list view prints under the label. */
  meta: string;
  /** Task status words, such as "Due in 3 days" or "Overdue by 2 days". */
  status: string;
  overdue: boolean; done: boolean; pending: boolean;
  when: string;
  rows: CalRow[];
  note: string;
  link: { to: string; label: string } | null;
};

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
/** Task statuses are To do, In progress, Done and Blocked (TASK_STATUSES in apps/api/src/modules/tasks/tasks.routes.ts). */
const DONE = ['Done'];

/** One server event as a calendar item. Leave never shows its type here: colleagues see who is away, nothing more. */
export function calItem(e: LiveCalendarEvent, today: string): CalItem {
  const base = { id: e.id, date: e.date, end: e.date, kind: e.type, status: '', overdue: false, done: false, pending: false, when: wdmy(e.date), note: '' };
  const projectText = (p: Ref) => `${p.code} ${p.name}`;
  switch (e.type) {
    case 'phase_start':
    case 'phase_end':
      return {
        ...base, filter: 'phase', label: `${e.project.code} ${e.title}`, meta: `${e.project.name}, ${e.type === 'phase_start' ? 'Phase start' : 'Phase end'}`,
        rows: [{ k: 'Project', v: projectText(e.project) }, { k: 'Type', v: e.type === 'phase_start' ? 'Phase start' : 'Phase end' }, { k: 'Phase', v: e.phase.name }],
        link: { to: `/firm/projects/${encodeURIComponent(e.project.code)}/phases`, label: 'Open phase' },
      };
    case 'milestone':
      return {
        ...base, filter: 'milestone', label: `${e.project.code} ${e.title}`, meta: `${e.project.name}, Billing milestone`, status: e.status,
        rows: [{ k: 'Project', v: projectText(e.project) }, { k: 'Type', v: 'Billing milestone' }, { k: 'Phase', v: e.phase.name }, { k: 'Status', v: e.status }],
        note: 'Falls on the end date of its phase.',
        link: { to: `/firm/projects/${encodeURIComponent(e.project.code)}/billing`, label: 'Open in Billing' },
      };
    case 'task_due': {
      const done = DONE.includes(e.status);
      // Blocked and in-progress tasks past their date are overdue too.
      const d = daysBetween(today, e.date);
      const overdue = !done && d < 0;
      const status = done ? 'Done' : overdue ? `Overdue by ${plural(-d, 'day')}` : d === 0 ? 'Due today' : `Due in ${plural(d, 'day')}`;
      const who = e.task.assignee?.name ?? 'Unassigned';
      return {
        ...base, filter: 'task', label: `${e.project.code} ${e.title}`, meta: `${projectText(e.project)}, ${who}`, status, overdue, done,
        rows: [{ k: 'Project', v: projectText(e.project) }, { k: 'Assignee', v: who }, { k: 'Status', v: status, red: overdue }],
        link: { to: `/firm/projects/${encodeURIComponent(e.project.code)}/tasks`, label: 'Open task' },
      };
    }
    case 'leave': {
      const start = e.start_date, end = e.end_date;
      const n = daysBetween(start, end) + 1;
      const pending = e.status !== 'Approved';
      return {
        ...base, filter: 'leave', date: e.date, end, pending,
        label: `${e.mine ? 'You are' : e.person.name} on leave${pending ? ' (pending)' : ''}`,
        meta: pending ? 'Leave, pending approval' : 'Leave',
        when: n === 1 ? `${wdmy(start)}, ${e.half_day ? 'half day' : '1 day'}` : `${wdm(start)} to ${wdmy(end)}, ${plural(n, 'day')}`,
        rows: [{ k: 'Person', v: e.person.name }, { k: 'Status', v: pending ? 'Pending approval' : 'Approved' }],
        note: 'Everyone sees who is away. The type of leave stays with the person and their approver.',
        link: e.mine ? { to: '/me/leave', label: 'Open leave request' } : null,
      };
    }
    case 'holiday':
      return {
        ...base, filter: 'holiday', label: e.half_day ? `${e.title} (half day)` : e.title, meta: e.half_day ? 'Studio holiday, half day' : 'Studio holiday',
        rows: [{ k: 'Type', v: e.half_day ? 'Studio holiday, half day' : 'Studio holiday' }],
        note: e.half_day ? 'Capacity drops by half a day for the whole studio.' : 'No one is expected to work. Capacity drops by a day for the whole studio.',
        link: null,
      };
  }
}

const ORDER: Record<LiveCalendarEvent['type'], number> = { holiday: 0, phase_start: 1, milestone: 2, task_due: 3, phase_end: 4, leave: 5 };
/** The items on one day, holidays first, leave last. */
export const itemsOn = (items: CalItem[], day: string) =>
  items.filter((it) => day >= it.date && day <= it.end).sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.label.localeCompare(b.label));

// ---------- Weeks ----------

/** The heatmap's four steps: under 50%, 50 to 79%, 80 to 100%, over. Null load (nothing available) reads as away. */
export type LoadLevel = 'free' | 'part' | 'full' | 'over' | 'away';
export function loadLevel(w: Pick<LiveWeek, 'load_pct' | 'conflict' | 'available'> & Partial<Pick<LiveWeek, 'allocated'>>): LoadLevel {
  // Hours decide an overload, as on the heatmap: a rounded load_pct of 100 must not hide 20.5 h booked against 20 h.
  const hoursOver = w.allocated != null && Number(w.available) > 0 && Number(w.allocated) > Number(w.available) + 0.001;
  if (w.conflict || hoursOver || (w.load_pct != null && w.load_pct > 100)) return 'over';
  if (w.load_pct == null) return Number(w.available) > 0 ? 'free' : 'away';
  return w.load_pct >= 80 ? 'full' : w.load_pct >= 50 ? 'part' : 'free';
}

/**
 * A week as AvailabilityBar's numbers. Leave is what is left once the holiday is taken off, so a day that is both
 * counts once and the bar's available hours match the server's.
 */
export function barOf(w: LiveWeek) {
  const scheduled = hoursOf(w.scheduled) ?? 0;
  const holiday = hoursOf(w.holiday_hours) ?? 0;
  const available = hoursOf(w.available) ?? 0;
  const leave = Math.max(0, Math.round((scheduled - holiday - available) * 100) / 100);
  return { scheduled, holiday, leave, commitments: 0, allocated: hoursOf(w.allocated) ?? 0 };
}
