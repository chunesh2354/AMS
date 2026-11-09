import type { Timesheet, TimesheetLineData } from '../types';
import type { ProjectPhaseOption } from '../../ui/ProjectPhasePicker';
import type { Status } from '../../ui/status-colors';
import { apiFetch, hoursOf, type ListResponse, type Restricted } from '../live';

/** Shapes returned by apps/api/src/modules/time.ts and projects.ts. */
export type ApiTimeEntry = { id: string; service_date: string; duration_hours: string | Restricted | null; approval_state: string; billing_state: string };
export type ApiTimeLine = {
  key: string; phase_id: string | null; internal_category_id: string | null; title: string; subtitle: string;
  hours: (number | null)[]; entries: ApiTimeEntry[]; reason: string | null; state: 'open' | 'locked' | 'returned' | 'unclassified';
};
export type ApiMyTime = {
  period_start: string; period_end: string; timesheet_id: string | null; status: string; lines: ApiTimeLine[];
  day_totals: (number | null)[]; flags: { code: string; date: string; hours: string }[];
};
export type ApiProjectLite = { id: string; code: string; name: string; phases: { id: string; code?: string; name: string }[] };
export type ApiCategory = { id: string; key: string; name: string };

export type LiveLineMeta = { phaseId: string | null; internalCategoryId: string | null; entries: ApiTimeEntry[] };
export type LiveTimesheet = Timesheet & { period: string; meta: Record<string, LiveLineMeta>; overDays: { date: string; hours: number | null }[] };

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`);

/** Monday (ISO date) of the week `offset` weeks from the week containing `today`. */
export function periodFor(offset: number, today: Date = new Date()): string {
  const d = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + offset * 7);
  return iso(d);
}

const short = (d: Date) => `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]}`;
export function rangeLabel(start: string, end: string): string {
  const e = parse(end);
  return `${short(parse(start))} to ${short(e)} ${e.getUTCFullYear()}`;
}

/** Server timesheet status to a design-system Status. 'Open' has no chip; it reads as Not submitted. */
export function statusOf(s: string): Status {
  const known: Record<string, Status> = { Open: 'Not submitted', Submitted: 'Submitted', Returned: 'Returned', Approved: 'Approved', 'Partially approved': 'Partially approved' };
  return known[s] ?? 'Not submitted';
}

/** Maps GET /me/time to the grid. Missing hours stay 0 only because the grid needs a number per cell; a missing line hours array is an error, not zeros. */
export function mapMyTime(res: ApiMyTime, offset: number): LiveTimesheet {
  const start = parse(res.period_start);
  const meta: Record<string, LiveLineMeta> = {};
  const lines: TimesheetLineData[] = res.lines.map((l) => {
    meta[l.key] = { phaseId: l.phase_id, internalCategoryId: l.internal_category_id, entries: l.entries };
    return {
      id: l.key, title: l.title, subtitle: l.subtitle,
      hours: DAYS.map((_, i) => hoursOf(l.hours[i]) ?? 0),
      state: l.state, reason: l.reason ?? undefined,
    };
  });
  return {
    offset, period: res.period_start, range: rangeLabel(res.period_start, res.period_end), status: statusOf(res.status), lines, meta,
    days: DAYS.map((label, d) => {
      const day = new Date(start.getTime() + d * 86400000);
      return { key: label, label, date: pad(day.getUTCDate()), scheduled: d < 5 ? 8 : 0 };
    }),
    overDays: res.flags.filter((f) => f.code === 'over_12h_day').map((f) => ({ date: f.date, hours: hoursOf(f.hours) })),
  };
}

export function phaseOptions(projects: ApiProjectLite[], categories: ApiCategory[]): ProjectPhaseOption[] {
  const opts: ProjectPhaseOption[] = projects.map((p) => ({ code: p.code, name: p.name, phases: p.phases.map((ph) => ({ id: ph.id, name: ph.name })) }));
  if (categories.length) opts.push({ code: 'Internal', name: 'Internal work', phases: categories.map((c) => ({ id: `cat:${c.id}`, name: c.name })) });
  return opts;
}

/** A picker value is a phase uuid, or `cat:<uuid>` for an internal category. */
export function classification(value: string): { phase_id?: string; internal_category_id?: string } {
  return value.startsWith('cat:') ? { internal_category_id: value.slice(4) } : { phase_id: value };
}

export const getMyTime = async (offset: number) => mapMyTime(await apiFetch<ApiMyTime>(`/me/time?period=${periodFor(offset)}`), offset);
export async function getPhaseOptions(): Promise<ProjectPhaseOption[]> {
  const [p, c] = await Promise.all([apiFetch<ListResponse<ApiProjectLite>>('/projects'), apiFetch<ListResponse<ApiCategory>>('/internal-categories')]);
  return phaseOptions(p.data, c.data);
}
export const putCell = (body: { service_date: string; duration_hours: number; phase_id?: string; internal_category_id?: string; entry_id?: string }) =>
  apiFetch<{ ok: true }>('/me/time/cell', { method: 'PUT', body });
export const submitWeek = (period: string) => apiFetch<{ status: string; approval_request_ids: string[] }>(`/timesheets/${period}/submit`, { method: 'POST', body: {} });
export const correctEntry = (id: string, body: { duration_hours: number; reason: string }) => apiFetch<{ id: string }>(`/time-entries/${id}/correct`, { method: 'POST', body });
export const logEntry = (body: { service_date: string; duration_hours: number; note?: string; phase_id?: string; internal_category_id?: string }) =>
  apiFetch<{ id: string }>('/time-entries', { method: 'POST', body });
export const startTimer = (cls: { phase_id?: string; internal_category_id?: string }) => apiFetch<{ id: string }>('/timers/start', { method: 'POST', body: cls });
export const stopTimer = () => apiFetch<{ time_entry_id: string }>('/timers/stop', { method: 'POST', body: {} });

/** ISO date of grid column `c` in the period starting `period`. */
export const cellDate = (period: string, c: number) => iso(new Date(parse(period).getTime() + c * 86400000));

/** The studio's calendar date (YYYY-MM-DD) in `timeZone`, so a late-evening entry in Bengaluru is not filed under the UTC date. */
export function todayIn(timeZone = 'Asia/Kolkata', now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    // An unknown zone name from the server: fall back to the studio default rather than crash the sheet.
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  }
}

/** GET /timers/active: the person's one running timer, or null. */
export type ApiActiveTimer = { id: string; started_at: string; phase_name: string | null; project_code: string | null; internal_category_id: string | null };
export type ActiveTimerState = { elapsed: number; context: string };

/** Seconds since the timer started and the label the timer pill shows. Null when nothing is running. */
export function timerFromActive(active: ApiActiveTimer | null | undefined, now: Date = new Date()): ActiveTimerState | null {
  if (!active?.started_at) return null;
  const started = Date.parse(active.started_at);
  if (Number.isNaN(started)) return null;
  const context = !active.project_code ? 'Internal work' : active.phase_name ? `${active.project_code} · ${active.phase_name}` : active.project_code;
  return { elapsed: Math.max(0, Math.floor((now.getTime() - started) / 1000)), context };
}
export const getActiveTimer = async () => (await apiFetch<{ active: ApiActiveTimer | null }>('/timers/active'))?.active ?? null;
