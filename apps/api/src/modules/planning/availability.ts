import { addDays, weekStart } from '@ams/domain';
import type { Tx } from '../../db/pool';
import { localDate } from '../time/time.routes';

/**
 * THE capacity definition (spec F03, glossary "Scheduled hours" and "Working availability"). Overview utilization,
 * Home's week, the workload grid, My schedule and the Capacity tab all read their hours from here, so they agree.
 *
 *   scheduled  = the weekly hours in force that day (the person's latest person_capacity row on or before the day,
 *                else the firm's default_weekly_hours), spread evenly over Monday to Friday; weekends are 0
 *   holiday    = scheduled on a studio holiday (half of it on a half-day holiday)
 *   leave      = scheduled on a day of approved leave (half of it for half-day leave), minus what the holiday already
 *                took: a day that is both a holiday and leave is counted once, at the larger of the two (AC-F03-2)
 *   available  = scheduled - holiday - leave
 *
 * Pending leave is an overlay (R5): reported as leave_pending, never subtracted. Allocations sum per person and week;
 * a week is in conflict when its confirmed hours exceed available (remaining = available - confirmed < 0).
 * Every date is a YYYY-MM-DD string in the studio's calendar; nothing here reads a local clock.
 */

/** Working days are Monday to Friday until working patterns with days are modelled. */
export const WORKDAYS_PER_WEEK = 5;
/** Weeks the grids show when the caller does not say. */
export const DEFAULT_WEEKS = 8;
export const MAX_WEEKS = 26;

const EPS = 0.004;
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const utcDay = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
/** Monday (1) to Friday (5). */
export const isWorkday = (iso: string) => { const w = utcDay(iso); return w >= 1 && w <= 5; };
export const isMonday = (iso: string) => utcDay(iso) === 1;

/** The studio's timezone and today's date in it. */
export async function studioClock(tx: Tx) {
  const timezone = ((await tx.query('select timezone from firm')).rows[0]?.timezone as string | undefined) || 'Asia/Kolkata';
  return { timezone, today: localDate(timezone) };
}

export type LeaveRef = {
  id: string; person_id: string; status: 'Approved' | 'Pending'; start_date: string; end_date: string; half_day: boolean;
  approver_id: string | null; leave_type: { id: string; key: string; name: string };
};
export type HolidayRef = { id: string; date: string; name: string; half_day: boolean };
export type DayAvailability = {
  date: string;
  scheduled: number;
  holiday: HolidayRef | null;
  holiday_hours: number;
  leave_approved: number;
  leave_pending: number;
  available: number;
  /** Leave requests touching this working day (approved and pending). Callers decide what a viewer may see. */
  leave: LeaveRef[];
};
export type WeekAvailability = {
  week_start: string;
  week_end: string;
  /** Weekly hours in force on the Monday. */
  capacity: number;
  scheduled: number;
  holiday_hours: number;
  leave_approved: number;
  leave_pending: number;
  available: number;
  holidays: HolidayRef[];
  leave: LeaveRef[];
  days: DayAvailability[];
};

type Version = { effective_from: string; weekly_hours: number };

/** Weekly hours in force on a date: the latest version on or before it, else the firm default. */
const weeklyOn = (versions: Version[], date: string, fallback: number) => {
  let v = fallback;
  for (const x of versions) if (x.effective_from <= date) v = x.weekly_hours; else break;
  return v;
};

/** Day-by-day availability from `from` to `to` (both included) for each person. */
export async function dailyAvailability(tx: Tx, personIds: string[], from: string, to: string): Promise<Map<string, DayAvailability[]>> {
  const out = new Map<string, DayAvailability[]>();
  if (!personIds.length || to < from) { for (const id of personIds) out.set(id, []); return out; }
  const fallback = Number((await tx.query('select default_weekly_hours from firm')).rows[0]?.default_weekly_hours ?? 40);
  const versions = (await tx.query(
    `select person_id, effective_from, weekly_hours from person_capacity where person_id = any($1::uuid[]) and effective_from <= $2 order by person_id, effective_from`,
    [personIds, to],
  )).rows;
  const byPerson = new Map<string, Version[]>();
  for (const v of versions) {
    const list = byPerson.get(v.person_id) ?? [];
    list.push({ effective_from: v.effective_from, weekly_hours: Number(v.weekly_hours) });
    byPerson.set(v.person_id, list);
  }
  const holidays = new Map<string, HolidayRef>((await tx.query(
    'select id, date, name, half_day from firm_holiday where date between $1 and $2', [from, to],
  )).rows.map((h) => [h.date as string, { id: h.id, date: h.date, name: h.name, half_day: !!h.half_day }]));
  const leaveRows: LeaveRef[] = (await tx.query(
    `select r.id, r.person_id, r.status, r.start_date, r.end_date, r.half_day, r.approver_id, t.id as type_id, t.key as type_key, t.name as type_name
     from leave_request r join leave_type t on t.id = r.leave_type_id
     where r.person_id = any($1::uuid[]) and r.status in ('Approved', 'Pending') and r.start_date <= $3 and r.end_date >= $2
     order by r.start_date`,
    [personIds, from, to],
  )).rows.map((r) => ({
    id: r.id, person_id: r.person_id, status: r.status, start_date: r.start_date, end_date: r.end_date, half_day: !!r.half_day,
    approver_id: r.approver_id, leave_type: { id: r.type_id, key: r.type_key, name: r.type_name },
  }));

  for (const id of personIds) {
    const vs = byPerson.get(id) ?? [];
    const mine = leaveRows.filter((l) => l.person_id === id);
    const days: DayAvailability[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const scheduled = isWorkday(d) ? weeklyOn(vs, d, fallback) / WORKDAYS_PER_WEEK : 0;
      const holiday = holidays.get(d) ?? null;
      const holidayHours = holiday && scheduled ? scheduled * (holiday.half_day ? 0.5 : 1) : 0;
      const touching = scheduled ? mine.filter((l) => l.start_date <= d && d <= l.end_date) : [];
      const leaveOf = (status: string) => touching.filter((l) => l.status === status).reduce((m, l) => Math.max(m, scheduled * (l.half_day ? 0.5 : 1)), 0);
      const approved = Math.max(0, leaveOf('Approved') - holidayHours);
      days.push({
        date: d, scheduled, holiday, holiday_hours: holidayHours, leave_approved: approved, leave_pending: leaveOf('Pending'),
        available: Math.max(0, scheduled - holidayHours - approved), leave: touching,
      });
    }
    out.set(id, days);
  }
  return out;
}

/** Sum of available hours over the days (overview utilization). */
export const availableHours = (days: DayAvailability[]) => round2(days.reduce((s, d) => s + d.available, 0));

/** Mondays from the week holding `from`, `weeks` of them. */
export const weekStarts = (from: string, weeks: number) => Array.from({ length: weeks }, (_, i) => addDays(weekStart(from), i * 7));

/** Week-by-week availability for each person, `weeks` weeks from the Monday of `from`. */
export async function weeklyAvailability(tx: Tx, personIds: string[], from: string, weeks: number): Promise<Map<string, WeekAvailability[]>> {
  const starts = weekStarts(from, weeks);
  const daily = await dailyAvailability(tx, personIds, starts[0], addDays(starts[starts.length - 1], 6));
  const out = new Map<string, WeekAvailability[]>();
  for (const id of personIds) {
    const all = daily.get(id) ?? [];
    out.set(id, starts.map((ws, i) => {
      const days = all.slice(i * 7, i * 7 + 7);
      const sum = (k: 'scheduled' | 'holiday_hours' | 'leave_approved' | 'leave_pending' | 'available') => round2(days.reduce((s, d) => s + d[k], 0));
      const leave = new Map<string, LeaveRef>();
      for (const d of days) for (const l of d.leave) leave.set(l.id, l);
      return {
        week_start: ws, week_end: addDays(ws, 6),
        capacity: round2(days[0] ? (isWorkday(days[0].date) ? days[0].scheduled * WORKDAYS_PER_WEEK : 0) : 0),
        scheduled: sum('scheduled'), holiday_hours: sum('holiday_hours'), leave_approved: sum('leave_approved'), leave_pending: sum('leave_pending'),
        available: sum('available'),
        holidays: days.filter((d) => d.holiday && d.scheduled).map((d) => d.holiday!),
        leave: [...leave.values()],
        days,
      };
    }));
  }
  return out;
}

// ---------- Allocations ----------

export type PlanView = 'draft' | 'published';
export type AllocationRow = {
  id: string; project_id: string; project_code: string; project_name: string; project_status: string;
  phase_id: string | null; phase_code: string | null; phase_name: string | null;
  person_id: string | null; person_ref: string | null; person_name: string | null;
  week_start: string; hours: number; state: 'tentative' | 'confirmed'; note: string | null; overallocation_reason: string | null;
  updated_at: Date | null;
};

/** Allocations of the draft plan or the published one, in weeks [fromWeek, toWeek] (Mondays, both included). */
export async function loadAllocations(tx: Tx, view: PlanView, f: { fromWeek: string; toWeek: string; personIds?: string[]; projectIds?: string[]; unassignedOnly?: boolean; ids?: string[] }): Promise<AllocationRow[]> {
  const t = view === 'draft'
    ? { table: 'allocation', id: 'a.id', reason: 'a.overallocation_reason', updated: 'a.updated_at' }
    : { table: 'allocation_published', id: 'a.allocation_id', reason: 'null::text', updated: 'a.updated_at' };
  const rows = (await tx.query(
    `select ${t.id} as id, a.project_id, pr.code as project_code, pr.name as project_name, pr.status as project_status,
       a.phase_id, ph.code as phase_code, ph.name as phase_name, a.person_id, pe.ref_code as person_ref, pe.name as person_name,
       a.week_start, a.hours, a.state, a.note, ${t.reason} as overallocation_reason, ${t.updated} as updated_at
     from ${t.table} a join project pr on pr.id = a.project_id left join phase ph on ph.id = a.phase_id left join person pe on pe.id = a.person_id
     where a.week_start between $1 and $2
       and ($3::uuid[] is null or a.person_id = any($3))
       and ($4::uuid[] is null or a.project_id = any($4))
       and (not $5::boolean or a.person_id is null)
       and ($6::uuid[] is null or ${t.id} = any($6))
     order by a.week_start, pr.code, ph.sort_order nulls first, pe.ref_code nulls first, ${t.id}`,
    [f.fromWeek, f.toWeek, f.personIds ?? null, f.projectIds ?? null, !!f.unassignedOnly, f.ids ?? null],
  )).rows;
  return rows.map((r) => ({ ...r, hours: Number(r.hours) }));
}

export type WeekLoad = {
  allocated: number; confirmed_allocations: number; tentative_allocations: number;
  remaining: number; load_pct: number | null; conflict: boolean; over_hours: number;
};
/** Load of one person-week. Confirmed hours above available are the conflict; tentative hours show in the load only. */
export function weekLoad(available: number, allocs: { hours: number; state: string }[]): WeekLoad {
  const confirmed = round2(allocs.filter((a) => a.state === 'confirmed').reduce((s, a) => s + a.hours, 0));
  const tentative = round2(allocs.filter((a) => a.state !== 'confirmed').reduce((s, a) => s + a.hours, 0));
  const allocated = round2(confirmed + tentative);
  const over = round2(confirmed - available);
  return {
    allocated, confirmed_allocations: confirmed, tentative_allocations: tentative,
    remaining: round2(available - confirmed),
    load_pct: available > 0 ? Math.round((allocated / available) * 100) : allocated > 0 ? null : 0,
    conflict: over > EPS, over_hours: over > EPS ? over : 0,
  };
}

/** A person's confirmed hours in one week of the draft plan, optionally leaving out one allocation (the one being saved). */
export async function draftConfirmed(tx: Tx, personId: string, week: string, exceptId?: string) {
  return Number((await tx.query(
    `select coalesce(sum(hours), 0) as h from allocation where person_id = $1 and week_start = $2 and state = 'confirmed' and ($3::uuid is null or id <> $3)`,
    [personId, week, exceptId ?? null],
  )).rows[0].h);
}
