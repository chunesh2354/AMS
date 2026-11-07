import { AFFECTED_ASSIGNMENTS, EXPENSES, LEAVE_BALANCES, LEAVE_STRIP, MY_DAY_COUNTS, TIMESHEETS } from '../mock/team';
import { ALLOCATIONS } from '../mock/plan';
import { LEAVE, TODAY } from '../mock/studio-meridian';
import { TASKS } from '../mock/work';
import { reply } from './access';
import type { Expense, LeaveRequest, MyDay, Timesheet } from './types';

export function getMyDay(viewerId: string): Promise<MyDay> {
  const tasks = TASKS.filter((t) => t.ownerId === viewerId);
  const today = tasks.filter((t) => t.due === TODAY);
  const extra = MY_DAY_COUNTS[viewerId] ?? { reviews: 0, missingDays: 0, returned: 0, leaveDecisions: 0 };
  const week = ALLOCATIONS.filter((a) => a.personId === viewerId && a.week === 0);
  return reply({
    today,
    counts: { dueToday: today.length, blocked: tasks.filter((t) => t.blocked).length, ...extra },
    allocation: week.map((a) => ({ label: a.phaseName, hours: a.hours })),
  });
}
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEK_START = [26, 2, 9];
const RANGE = ['26 Oct to 01 Nov 2026', '02 Nov to 08 Nov 2026', '09 Nov to 15 Nov 2026'];
export function getTimesheet(viewerId: string, offset: number): Promise<Timesheet> {
  const i = offset + 1;
  const start = WEEK_START[i];
  const entry = TIMESHEETS[viewerId]?.[offset];
  return reply({
    offset,
    range: RANGE[i] ?? 'No data for this week',
    status: entry?.status ?? 'Not submitted',
    lines: entry?.lines ?? [],
    days: DAYS.map((label, d) => {
      const n = start + d;
      const date = i === 0 && n > 31 ? n - 31 : n;
      return { key: label, label, date: String(date).padStart(2, '0'), scheduled: d < 5 ? 8 : 0 };
    }),
  });
}
export const getExpenses = (viewerId: string): Promise<Expense[]> => reply(viewerId === 'P04' ? EXPENSES : []);
export const getLeaveBalances = () => reply(LEAVE_BALANCES);
export const getLeaveStrip = () => reply(LEAVE_STRIP);
export const getMyLeave = (viewerId: string): Promise<LeaveRequest[]> => reply(LEAVE.filter((l) => l.personId === viewerId));
export const getAffectedAssignments = () => AFFECTED_ASSIGNMENTS;
