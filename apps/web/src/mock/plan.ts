import type { Allocation, ScheduleWeek } from '../api/types';

export const PLAN_WEEKS = ['02 Nov', '09 Nov', '16 Nov', '23 Nov', '30 Nov', '07 Dec', '14 Dec', '21 Dec', '28 Dec', '04 Jan', '11 Jan', '18 Jan'];
/** Hours of approved leave by person and plan week. */
export const LEAVE_WEEKS: Record<string, Record<number, number>> = { P04: { 2: 16 }, P06: { 6: 40 } };

let n = 0;
const alloc = (personId: string | null, project: string, phaseId: string, phaseName: string, week: number, hours: number, kind: Allocation['kind'] = 'confirmed', published = true): Allocation =>
  ({ id: `al${++n}`, personId, project, phaseId, phaseName, week, hours, kind, published });
const WD = ['p1-wd', 'Working drawings'] as const;
const CON = ['p1-concept', 'Concept design'] as const;
const TEN = ['p1-tender', 'Tender'] as const;
const SCH = ['p2-schematic', 'Schematic design'] as const;
const WD2 = ['p2-wd', 'Working drawings'] as const;
const DD3 = ['p3-dd', 'Design development'] as const;
const series = (person: string, project: string, ph: readonly [string, string], hours: (number | null)[], kind?: Allocation['kind']) =>
  hours.flatMap((h, w) => (h == null ? [] : [alloc(person, project, ph[0], ph[1], w, h, kind)]));

/**
 * The plan for the Resource planner, Project Staffing, My schedule and Person capacity.
 * Only Divya Menon goes over capacity, in the week of 16 Nov. Three cards are unpublished: "Publish plan (3 changes)".
 */
export const ALLOCATIONS: Allocation[] = [
  alloc(null, 'PRJ-01', CON[0], CON[1], 0, 5, 'tentative', false),
  ...series('P02', 'PRJ-01', WD, [24, 24, 20, 24]),
  ...series('P02', 'PRJ-03', DD3, [8, 8, 8, 8], 'hold'),
  alloc('P04', 'PRJ-01', CON[0], CON[1], 0, 16),
  alloc('P04', 'PRJ-01', WD[0], WD[1], 0, 12),
  alloc('P04', 'PRJ-01', CON[0], CON[1], 1, 20),
  ...series('P04', 'PRJ-01', WD, [null, null, 16, 16]),
  alloc('P04', 'PRJ-01', TEN[0], TEN[1], 4, 16, 'tentative', false),
  ...series('P05', 'PRJ-01', WD, [24, 24]),
  alloc('P05', 'PRJ-01', WD[0], WD[1], 2, 26, 'confirmed', false),
  ...series('P05', 'PRJ-01', WD, [null, null, null, 24]),
  ...series('P05', 'PRJ-01', TEN, [null, null, null, null, 16, 16, 8], 'tentative'),
  ...series('P08', 'PRJ-01', WD, [32, 32, 28, 32]),
  ...series('P08', 'PRJ-01', TEN, [null, null, null, null, 16, 16], 'tentative'),
  ...series('P03', 'PRJ-02', SCH, [24, 24, 24, 24, 24]),
  ...series('P03', 'PRJ-02', WD2, [null, null, null, null, null, 24], 'tentative'),
  ...series('P06', 'PRJ-02', SCH, [32, 32, 28, 32, 32]),
  ...series('P06', 'PRJ-02', WD2, [null, null, null, null, null, 32], 'tentative'),
  ...series('P07', 'PRJ-02', SCH, [24, 24, 20, 24, 24, 24]),
];

const C = 'PRJ-01 · Concept design';
const W = 'PRJ-01 · Working drawings';
const plan: Record<string, [number, string][]> = {
  '02': [[4, C], [3, W]], '03': [[4, C], [3, W]], '04': [[4, C], [3, W]], '05': [[4, C], [3, W]],
  '09': [[4, C]], '10': [[4, C]], '11': [[4, C]], '12': [[4, C]], '13': [[4, C]],
  '18': [[8, W]], '19': [[8, W]],
  '23': [[4, W]], '24': [[4, W]], '25': [[4, W]], '26': [[4, W]],
};
const off: Record<string, string> = { 16: 'Leave', 17: 'Leave', 20: 'Holiday' };
const visits: Record<string, string> = { '05': 'Lakeview site', 19: 'Lakeview site', 26: 'Orchard site' };
const DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const SCHEDULE_P04: ScheduleWeek[] = [2, 9, 16, 23].map((start, w) => ({
  label: PLAN_WEEKS[w],
  days: DOWS.map((dow, i) => {
    const date = String(start + i).padStart(2, '0');
    return { dow, date, cards: (plan[date] ?? []).map(([hours, what]) => ({ hours, what, kind: 'confirmed' as const })), off: off[date], visit: visits[date] };
  }),
}));
