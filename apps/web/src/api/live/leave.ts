import { apiFetch } from '../live';
import type { LeaveRequest } from '../types';
import type { Status } from '../../ui/status-colors';
import type { StripWeek } from '../../ui/WeekStrip';
import { parseISO } from '../../ui/format';

/** One request from GET /me/leave and POST /leave-requests (apps/api/src/modules/leave/leave.routes.ts, requestView). */
export type LiveLeaveRequest = {
  id: string;
  leave_type: { id: string; key: string; name: string };
  start_date: string;
  end_date: string;
  half_day: boolean;
  days: string;
  hours: string;
  status: 'Pending' | 'Approved' | 'Returned' | 'Rejected' | 'Withdrawn' | string;
  reason: string | null;
  handover_note: string | null;
  approver: { id: string; name: string } | null;
  approval_request_id: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  can_withdraw: boolean;
};
export type LiveLeaveBalance = {
  leave_type: { id: string; key: string; name: string };
  tracks_balance: boolean;
  allowance_days: string | null;
  taken_days: string;
  pending_days: string;
  available_days: string | null;
};
export type LiveLeaveType = { id: string; key: string; name: string; tracks_balance: boolean };
export type LiveMyLeave = { year: number; today: string; day_hours: number; types: LiveLeaveType[]; balances: LiveLeaveBalance[]; requests: LiveLeaveRequest[] };

/** A request in the My leave table, with what live mode needs to act on it. */
export type LeaveRow = LeaveRequest & { canWithdraw?: boolean; approver?: string; decisionReason?: string | null };
export type LeaveBalanceTile = { label: string; days: number };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dm = (iso: string) => { const d = parseISO(iso); return { d: String(d.getDate()).padStart(2, '0'), m: MONTHS[d.getMonth()], y: d.getFullYear() }; };

/** "20 Nov 2026", "16 to 17 Nov 2026", "28 Nov to 02 Dec 2026": the mock's wording. */
export function leaveDates(start: string, end: string): string {
  const a = dm(start), b = dm(end);
  if (start === end) return `${a.d} ${a.m} ${a.y}`;
  if (a.m === b.m) return `${a.d} to ${b.d} ${b.m} ${b.y}`;
  return `${a.d} ${a.m} to ${b.d} ${b.m} ${b.y}`;
}

/** The status-colors vocabulary has no Pending or Withdrawn: pending reads "Pending (approval)", withdrawn "Cancelled". */
export function leaveStatus(s: string): Status {
  if (s === 'Pending') return 'Pending (approval)';
  if (s === 'Withdrawn') return 'Cancelled';
  if (s === 'Approved' || s === 'Returned' || s === 'Rejected') return s;
  return 'None';
}

export function mapLeaveRequest(r: LiveLeaveRequest, personId: string): LeaveRow {
  return {
    id: r.id, personId, type: `${r.leave_type.name}${r.half_day ? ', half days' : ''}`, dates: leaveDates(r.start_date, r.end_date),
    hours: Number(r.hours) || 0, status: leaveStatus(r.status), canWithdraw: r.can_withdraw, approver: r.approver?.name, decisionReason: r.decision_reason,
  };
}

/** Tiles for the types that keep a balance: days still available (allowance less taken and pending). */
export const mapBalances = (b: LiveLeaveBalance[]): LeaveBalanceTile[] =>
  b.filter((x) => x.tracks_balance && x.available_days != null).map((x) => ({ label: x.leave_type.name, days: Number(x.available_days) }));

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/**
 * The next 12 weeks from the studio's today, each marked with the working days of pending or approved leave in it.
 * Holidays have no endpoint yet, so the live strip shows leave only.
 */
export function leaveStrip(today: string, requests: LiveLeaveRequest[], weeks = 12): StripWeek[] {
  const t = parseISO(today);
  const monday = addDays(t, -((t.getDay() + 6) % 7));
  const held = requests.filter((r) => r.status === 'Pending' || r.status === 'Approved');
  return Array.from({ length: weeks }, (_, i) => {
    const start = addDays(monday, i * 7);
    const label = `${String(start.getDate()).padStart(2, '0')} ${MONTHS[start.getMonth()]}`;
    let days = 0;
    for (let k = 0; k < 5; k += 1) {
      const day = iso(addDays(start, k));
      const r = held.find((x) => x.start_date <= day && x.end_date >= day);
      if (r) days += r.half_day ? 0.5 : 1;
    }
    if (i === 0) return days ? { label, today: true, kind: 'leave' as const, note: `Leave ${days} d` } : { label, today: true };
    return days ? { label, kind: 'leave' as const, note: `Leave ${days} d` } : { label };
  });
}

export const liveMyLeave = (year?: number) => apiFetch<LiveMyLeave>(`/me/leave${year ? `?year=${year}` : ''}`);

export type LeaveRequestBody = { leave_type_id: string; start_date: string; end_date: string; half_day: boolean; reason?: string; handover_note?: string };
export const submitLeave = (body: LeaveRequestBody) => apiFetch<LiveLeaveRequest & { approval_request_id: string }>('/leave-requests', { body });
export const withdrawLeave = (id: string) => apiFetch<LiveLeaveRequest>(`/leave-requests/${id}/withdraw`, { method: 'POST', body: {} });

/** The request sheet is opened from anywhere; My leave listens for this to reload after a request is saved. */
export const LEAVE_CHANGED = 'ams:leave-changed';
export const announceLeaveChanged = () => window.dispatchEvent(new Event(LEAVE_CHANGED));
