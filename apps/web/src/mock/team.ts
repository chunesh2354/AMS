import type { Expense, Timesheet, TimesheetLineData } from '../api/types';
import { PLAN_WEEKS } from './plan';

export const MY_DAY_COUNTS: Record<string, { reviews: number; missingDays: number; returned: number; leaveDecisions: number }> = {
  P04: { reviews: 2, missingDays: 2, returned: 0, leaveDecisions: 1 },
  P08: { reviews: 0, missingDays: 1, returned: 1, leaveDecisions: 0 },
};

const P1 = 'PRJ-01 Lakeview Residence'; const P2 = 'PRJ-02 Orchard Commercial Block';
const lines = (rows: [string, string, number[], Partial<TimesheetLineData>?][]): TimesheetLineData[] =>
  rows.map(([title, subtitle, hours, extra], i) => ({ id: `${title}-${i}`, title, subtitle, hours, ...extra }));

/** Rohan's week totals 38.50 h with 12.50 h on Thursday. Arjun's week carries the returned line. */
export const TIMESHEETS: Record<string, Record<number, Pick<Timesheet, 'status' | 'lines'>>> = {
  P04: {
    [-1]: { status: 'Approved', lines: lines([
      ['Concept design', P1, [5, 5, 4, 5, 5, 0, 0], { state: 'locked' }],
      ['Working drawings', P1, [3, 3, 3, 3, 3, 0, 0], { state: 'locked' }],
      ['Studio admin', 'Internal', [0, 0, 1, 0, 0, 0, 0], { state: 'locked' }],
    ]) },
    0: { status: 'Not submitted', lines: lines([
      ['Concept design', P1, [4, 4, 3, 6.5, 2, 0, 0]],
      ['Working drawings', P1, [2, 2, 3, 4, 0, 0, 0]],
      ['Schematic design', P2, [0, 1, 1, 2, 0, 0, 0]],
      ['Studio admin', 'Internal', [1, 1, 0, 0, 0, 0, 0]],
      ['Training', 'Internal', [0, 0, 1, 0, 1, 0, 0]],
    ]) },
  },
  P08: {
    0: { status: 'Returned', lines: lines([
      ['Working drawings', P1, [6, 8, 4, 8, 2, 0, 0]],
      ['Concept design', P1, [2, 0, 4, 0, 4, 0, 0], { state: 'returned', reason: 'Returned by Vikram Nair: wrong phase' }],
      ['Site visit', 'No project yet', [0, 0, 0, 0, 2, 0, 0], { state: 'unclassified', reason: 'Choose a project and phase' }],
    ]) },
  },
};

export const EXPENSES: Expense[] = [
  { id: 'x1', amount: 1850, date: '2026-11-03', what: 'Taxi to Lakeview site', where: 'PRJ-01 · Concept design', approval: 'Approved', approvalLabel: 'Finance approved', reimbursement: 'Pending (accounting)', reimbursementLabel: 'Reimbursement pending', receipt: 'Taxi receipt' },
  { id: 'x2', amount: 420, date: '2026-11-05', what: 'Parking at Orchard site', where: 'PRJ-02 · Schematic design', approval: 'Draft', reimbursement: 'Not submitted', receipt: 'Parking slip' },
];

export const LEAVE_BALANCES = [{ label: 'Earned leave', days: 12 }, { label: 'Casual leave', days: 4 }, { label: 'Sick leave', days: 6 }];
export const LEAVE_STRIP = PLAN_WEEKS.map((label, i) => (
  i === 0 ? { label, today: true } : label === '16 Nov' ? { label, kind: 'leave' as const, note: 'Leave 2 d' } : label === '21 Dec' ? { label, kind: 'holiday' as const, note: 'Holiday' } : { label }
));
export const AFFECTED_ASSIGNMENTS = [{ what: 'PRJ-01 · Working drawings', hours: 8 }, { what: 'Staircase details, due 20 Nov', hours: 4 }];
