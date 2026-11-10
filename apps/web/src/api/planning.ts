import { ALLOCATIONS, LEAVE_WEEKS, PLAN_WEEKS, SCHEDULE_P04 } from '../mock/plan';
import { AVAILABILITY, PEOPLE, weekAvailability } from '../mock/studio-meridian';
import { sample } from './access';
import type { Allocation, ScheduleWeek } from './types';

export const getPlan = (): Promise<{ weeks: string[]; allocations: Allocation[] }> => sample(() => ({ weeks: PLAN_WEEKS, allocations: ALLOCATIONS }), { weeks: [], allocations: [] });

/** Hours a person can take in a plan week, after holidays, leave and commitments. */
export function weekCapacity(personId: string, i: number): number {
  const p = PEOPLE.find((x) => x.id === personId);
  if (!p) return 0;
  const w = AVAILABILITY[personId]?.[i] ?? weekAvailability(p, i);
  return w.scheduled - w.holiday - w.leave - w.commitments;
}
export const fullWeekLeave = (personId: string, i: number) => (LEAVE_WEEKS[personId]?.[i] ?? 0) >= 40;

const DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const STARTS = [2, 9, 16, 23];
export function getMySchedule(viewerId: string): Promise<ScheduleWeek[]> {
  if (viewerId === 'P04') return sample(() => SCHEDULE_P04, []);
  return sample(() => STARTS.map((start, w) => ({
    label: PLAN_WEEKS[w],
    days: DOWS.map((dow, d) => {
      const cards = d < 5 ? ALLOCATIONS.filter((a) => a.personId === viewerId && a.week === w).map((a) => ({ hours: a.hours / 5, what: `${a.project} · ${a.phaseName}`, kind: a.kind })) : [];
      return { dow, date: String(start + d).padStart(2, '0'), cards };
    }),
  })), []);
}

export function weekBreakdown(personId: string, i: number) {
  const p = PEOPLE.find((x) => x.id === personId)!;
  return AVAILABILITY[personId]?.[i] ?? weekAvailability(p, i);
}
