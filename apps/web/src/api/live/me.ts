import type { Status } from '../../ui/status-colors';
import { apiFetch, hoursOf, type Restricted } from '../live';
import { statusOf } from './time';

/** Shapes returned by apps/api/src/modules/me/me.routes.ts (GET /me/home and GET /me/work). */
type H = string | Restricted | null;
type ApiProjectRef = { code: string; name: string } | null;
export type ApiMyHome = {
  today: string; timezone: string;
  person: { id: string; name: string };
  timer: { id: string; started_at: string; phase_id: string | null; internal_category_id: string | null; project: ApiProjectRef; title: string | null } | null;
  week: { period_start: string; period_end: string; hours: H; scheduled_hours: H; days: { date: string; hours: H; scheduled_hours: H; over_12h: boolean }[] };
  timesheets: {
    this_week: { period_start: string; status: string; hours: H };
    last_week: { period_start: string; status: string; hours: H };
    notices: string[];
  };
  returned: { period_start: string; phase_id: string | null; internal_category_id: string | null; project: ApiProjectRef; title: string; phase_code: string | null; hours: H; entries: number; reason: string | null }[];
  projects: { id: string; code: string; name: string; status: string; role: string; recent_phases: { id: string; code: string; name: string; hours: H; last_date: string }[] }[];
  pending: { total: number; by_type: Record<string, number>; items: { id: string; type: string; label: string; created_at: string; period_start: string | null; project: ApiProjectRef }[] };
  approvals: { total: number; by_type: Record<string, number> } | null;
};
export type ApiMyWork = {
  today: string; timezone: string; month: string; month_start: string; month_end: string; my_hours_month: H;
  projects: {
    id: string; code: string; name: string; client: string | null; status: string; role: string; my_hours_month: H;
    phases: { id: string; code: string; name: string; status: string; start_date: string | null; end_date: string | null; current: boolean; my_hours_month: H }[];
  }[];
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ROLE: Record<string, string> = { pm: 'Project manager', lead: 'Lead', contributor: 'Contributor', reviewer: 'Reviewer', viewer: 'Viewer' };
/** A project role as the screen says it. */
export const roleLabel = (r: string) => ROLE[r] ?? r;
/** Phase status to a design-system Status: the database says Complete, the design system says Done. */
export const phaseStatus = (s: string): Status => (s === 'Complete' ? 'Done' : s === 'In progress' ? 'In progress' : s === 'Cancelled' ? 'Cancelled' : 'Not started');
/** Project status to a design-system Status (the database values are all design-system statuses). */
export const projectStatus = (s: string): Status => (['Draft', 'Active', 'On hold', 'Delivery complete', 'Archived'].includes(s) ? (s as Status) : 'Active');
const num = (h: H) => hoursOf(h) ?? 0;
const where = (p: ApiProjectRef, title: string | null) => [p ? p.code : 'Internal', title].filter(Boolean).join(' · ');

/** "Good morning" before noon, "Good afternoon" before 17:00, then "Good evening", on the studio's clock. */
export function greetingFor(timeZone: string, now: Date = new Date()): string {
  let hour: number;
  try {
    hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now));
  } catch {
    hour = now.getHours();
  }
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

export type LiveMyHome = {
  today: string; timeZone: string;
  week: { start: string; end: string; hours: number; scheduled: number; days: { key: string; date: string; hours: number; scheduled: number }[] };
  thisWeek: { status: Status; hours: number };
  lastWeek: { status: Status; hours: number };
  notices: string[];
  timer: { startedAt: string; where: string } | null;
  returned: { key: string; title: string; where: string; week: string; hours: number; reason: string | null }[];
  projects: { id: string; code: string; name: string; status: Status; role: string; recent: { id: string; name: string; hours: number }[] }[];
  pending: { id: string; label: string; where: string; week: string | null }[];
  /** Null when the person approves nothing: then there is no queue to show, not an empty one. */
  approvals: number | null;
};

export function mapMyHome(r: ApiMyHome): LiveMyHome {
  return {
    today: r.today, timeZone: r.timezone,
    week: {
      start: r.week.period_start, end: r.week.period_end, hours: num(r.week.hours), scheduled: num(r.week.scheduled_hours),
      days: r.week.days.map((d, i) => ({ key: DAYS[i] ?? d.date, date: d.date, hours: num(d.hours), scheduled: num(d.scheduled_hours) })),
    },
    thisWeek: { status: statusOf(r.timesheets.this_week.status), hours: num(r.timesheets.this_week.hours) },
    lastWeek: { status: statusOf(r.timesheets.last_week.status), hours: num(r.timesheets.last_week.hours) },
    notices: r.timesheets.notices,
    timer: r.timer ? { startedAt: r.timer.started_at, where: where(r.timer.project, r.timer.title) } : null,
    returned: r.returned.map((l) => ({
      key: `${l.period_start}-${l.phase_id ?? l.internal_category_id ?? l.title}`, title: l.title, where: l.project ? `${l.project.code} ${l.project.name}` : 'Internal',
      week: l.period_start, hours: num(l.hours), reason: l.reason,
    })),
    projects: r.projects.map((p) => ({
      id: p.id, code: p.code, name: p.name, status: projectStatus(p.status), role: roleLabel(p.role),
      recent: p.recent_phases.map((ph) => ({ id: ph.id, name: ph.name, hours: num(ph.hours) })),
    })),
    pending: r.pending.items.map((i) => ({ id: i.id, label: i.label, where: i.project ? i.project.code : 'Internal', week: i.period_start })),
    approvals: r.approvals ? r.approvals.total : null,
  };
}

export type LiveMyWork = {
  today: string; month: string; hours: number;
  projects: {
    id: string; code: string; name: string; client: string | null; status: Status; role: string; hours: number;
    phases: { id: string; code: string; name: string; status: Status; start: string | null; end: string | null; current: boolean; hours: number }[];
  }[];
};

export function mapMyWork(r: ApiMyWork): LiveMyWork {
  return {
    today: r.today, month: r.month, hours: num(r.my_hours_month),
    projects: r.projects.map((p) => ({
      id: p.id, code: p.code, name: p.name, client: p.client, status: projectStatus(p.status), role: roleLabel(p.role), hours: num(p.my_hours_month),
      phases: p.phases.map((ph) => ({ id: ph.id, code: ph.code, name: ph.name, status: phaseStatus(ph.status), start: ph.start_date, end: ph.end_date, current: ph.current, hours: num(ph.my_hours_month) })),
    })),
  };
}

export const getMyHome = async () => mapMyHome(await apiFetch<ApiMyHome>('/me/home'));
export const getMyWork = async () => mapMyWork(await apiFetch<ApiMyWork>('/me/work'));
