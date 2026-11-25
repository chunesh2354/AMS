import { describe, expect, it } from 'vitest';
import { barOf, calItem, itemsOn, loadLevel, monthGrid, weekLabel, type LiveCalendarEvent, type LiveWeek } from './calendar';

// Shapes follow GET /calendar and the Week object in apps/api/src/modules/planning/planning.routes.ts.
const P = { id: 'prj-1', code: 'PRJ-01', name: 'Harbour Pavilion' };
const PH = { id: 'ph-1', code: 'CD', name: 'Concept design', status: 'In progress' };

describe('calendar dates', () => {
  it('builds a Monday-first month grid of whole weeks', () => {
    expect(monthGrid('2026-11-01')).toEqual({ start: '2026-10-26', end: '2026-12-06', weeks: 6 });
    expect(monthGrid('2027-02-01')).toEqual({ start: '2027-02-01', end: '2027-02-28', weeks: 4 });
  });
  it('words a week across a month end', () => {
    expect(weekLabel('2026-11-23')).toBe('23 to 29 Nov 2026');
    expect(weekLabel('2026-11-30')).toBe('30 Nov to 6 Dec 2026');
  });
});

describe('calendar items from GET /calendar', () => {
  it('links a phase start to the project phases', () => {
    const it = calItem({ id: 'phase_start:ph-1', type: 'phase_start', date: '2026-11-02', title: 'Concept design starts', project: P, phase: PH }, '2026-11-10');
    expect(it).toMatchObject({ filter: 'phase', label: 'PRJ-01 Concept design starts', link: { to: '/firm/projects/PRJ-01/phases', label: 'Open phase' } });
  });

  it('counts task days against the studio today and marks overdue in red', () => {
    const task = (date: string, status = 'To do'): LiveCalendarEvent => ({
      id: `task:${date}`, type: 'task_due', date, title: 'Area statement', status, project: P, phase: null, task: { id: 't', assignee: { id: 'u', name: 'Nila Varma' }, mine: false },
    });
    expect(calItem(task('2026-11-08'), '2026-11-10')).toMatchObject({ overdue: true, status: 'Overdue by 2 days', rows: [{ k: 'Project' }, { k: 'Assignee', v: 'Nila Varma' }, { k: 'Status', red: true }] });
    expect(calItem(task('2026-11-11'), '2026-11-10').status).toBe('Due in 1 day');
    expect(calItem(task('2026-11-10'), '2026-11-10').status).toBe('Due today');
    expect(calItem(task('2026-11-01', 'Done'), '2026-11-10')).toMatchObject({ overdue: false, done: true, status: 'Done' });
    expect(calItem(task('2026-11-12'), '2026-11-10').link).toEqual({ to: '/firm/projects/PRJ-01/tasks', label: 'Open task' });
  });

  it('sends billing milestones to project billing', () => {
    const it = calItem({ id: 'milestone:m', type: 'milestone', date: '2026-11-27', date_basis: 'phase_end', title: 'Concept stage invoice', status: 'Planned', project: P, phase: PH }, '2026-11-10');
    expect(it).toMatchObject({ filter: 'milestone', link: { to: '/firm/projects/PRJ-01/billing', label: 'Open in Billing' } });
  });

  it('shows who is away, never the type of leave, and spans the days', () => {
    const it = calItem({
      id: 'leave:l', type: 'leave', date: '2026-11-16', start_date: '2026-11-16', end_date: '2026-11-18', half_day: false, status: 'Approved',
      title: 'Nila Varma: Earned leave', label: 'Earned leave', leave_type: { key: 'earned', name: 'Earned leave' }, person: { id: 'u', ref_code: 'P02', name: 'Nila Varma' }, mine: false,
    }, '2026-11-10');
    expect(it.label).toBe('Nila Varma on leave');
    expect(JSON.stringify(it)).not.toContain('Earned');
    expect(it.when).toBe('Mon 16 Nov to Wed 18 Nov 2026, 3 days');
    expect(it.link).toBeNull();
    expect(itemsOn([it], '2026-11-17')).toHaveLength(1);
    expect(itemsOn([it], '2026-11-19')).toHaveLength(0);
    const mine = calItem({
      id: 'leave:m', type: 'leave', date: '2026-11-20', start_date: '2026-11-20', end_date: '2026-11-20', half_day: true, status: 'Pending',
      title: 'Earned leave', label: 'Earned leave', leave_type: { key: 'earned', name: 'Earned leave' }, person: { id: 'me', ref_code: 'P04', name: 'Me' }, mine: true,
    }, '2026-11-10');
    expect(mine).toMatchObject({ label: 'You are on leave (pending)', pending: true, link: { to: '/me/leave' }, when: 'Fri 20 Nov 2026, half day' });
  });

  it('sorts a day with holidays first and leave last', () => {
    const items = [
      calItem({ id: 'leave:x', type: 'leave', date: '2026-11-20', start_date: '2026-11-20', end_date: '2026-11-20', half_day: false, status: 'Approved', title: 'A: On leave', label: 'On leave', leave_type: null, person: { id: 'a', ref_code: 'P03', name: 'Aru' }, mine: false }, '2026-11-10'),
      calItem({ id: 'holiday:h', type: 'holiday', date: '2026-11-20', title: 'Studio holiday', half_day: false }, '2026-11-10'),
    ];
    expect(itemsOn(items, '2026-11-20').map((i) => i.filter)).toEqual(['holiday', 'leave']);
  });
});

const week = (extra: Partial<LiveWeek>): LiveWeek => ({
  week_start: '2026-11-16', week_end: '2026-11-22', capacity: '40.00', scheduled: '40.00', holiday_hours: '8.00', holidays: [], leave_approved: '8.00', leave_pending: '0.00',
  on_leave: true, leave: [], available: '24.00', allocated: '20.00', confirmed_allocations: '20.00', tentative_allocations: '0.00', remaining: '4.00',
  load_pct: 83, conflict: false, over_hours: '0.00', other_hours: '0.00', allocations: [], ...extra,
});

describe('week load', () => {
  it('steps like the heatmap: under 50, 50 to 79, 80 to 100, over', () => {
    expect(loadLevel(week({ load_pct: 49 }))).toBe('free');
    expect(loadLevel(week({ load_pct: 50 }))).toBe('part');
    expect(loadLevel(week({ load_pct: 80 }))).toBe('full');
    expect(loadLevel(week({ load_pct: 100 }))).toBe('full');
    expect(loadLevel(week({ load_pct: 101 }))).toBe('over');
    expect(loadLevel(week({ load_pct: 90, conflict: true }))).toBe('over');
    expect(loadLevel(week({ load_pct: null, available: '0.00' }))).toBe('away');
  });

  it('reads an overload from the hours, so a load_pct rounded to 100 cannot hide it (as the heatmap does)', () => {
    expect(loadLevel(week({ load_pct: 100, allocated: '24.10', available: '24.00', conflict: false }))).toBe('over');
    expect(loadLevel(week({ load_pct: 100, allocated: '24.00', available: '24.00' }))).toBe('full');
  });

  it('gives AvailabilityBar the server available hours, counting a holiday that is also leave once', () => {
    // A holiday on a leave day: 8 h holiday, 8 h leave, but only 8 h off in all.
    expect(barOf(week({ holiday_hours: '8.00', leave_approved: '8.00', available: '32.00', allocated: '30.00' }))).toEqual({ scheduled: 40, holiday: 8, leave: 0, commitments: 0, allocated: 30 });
    expect(barOf(week({}))).toEqual({ scheduled: 40, holiday: 8, leave: 8, commitments: 0, allocated: 20 });
  });
});
