import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { MyScheduleScreen } from './schedule';

// A VITE_LIVE=1 build: My schedule is the published plan from GET /me/schedule (planning.routes.ts), read-only.
vi.mock('../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/live')>()), isLive: true }));

const alloc = (id: string, hours: string, state: 'confirmed' | 'tentative', phase: string | null) => ({
  id, project: { id: 'prj-1', code: 'HW-01', name: 'Harbour Pavilion', status: 'Active' }, phase: phase ? { id: `ph-${phase}`, code: 'X', name: phase } : null,
  person: { id: 'u-P04', ref_code: 'P04', name: 'Tara Joshi' }, week_start: '2026-11-09', hours, state, note: null, on_hold: false, published: true,
  unpublished_change: false, overallocation_reason: null, can_edit: false,
});
const day = (date: string, dow: string, extra: Record<string, unknown> = {}) => ({ date, dow, scheduled: '8.00', available: '8.00', holiday: null, leave: null, ...extra });
const week = (start: string, extra: Record<string, unknown>) => ({
  week_start: start, week_end: start, capacity: '40.00', scheduled: '40.00', holiday_hours: '0.00', holidays: [], leave_approved: '0.00', leave_pending: '0.00', on_leave: false, leave: [],
  available: '40.00', allocated: '0.00', confirmed_allocations: '0.00', tentative_allocations: '0.00', remaining: '40.00', load_pct: 0, conflict: false, over_hours: '0.00', other_hours: '0.00',
  allocations: [], days: [], ...extra,
});
const SCHEDULE = {
  from: '2026-11-09', to: '2026-11-22', today: '2026-11-10', timezone: 'Asia/Kolkata', person: { id: 'u-P04', name: 'Tara Joshi' },
  last_published: { id: 'r-1', revision_no: 3, scope: 'firm', published_at: '2026-11-08T10:00:00Z', published_by: { id: 'u-P01', name: 'Mira Kapoor' } },
  weeks: [
    week('2026-11-09', {
      allocated: '36.00', confirmed_allocations: '30.00', tentative_allocations: '6.00', remaining: '4.00', load_pct: 90,
      allocations: [alloc('a-1', '30.00', 'confirmed', 'Concept design'), alloc('a-2', '6.00', 'tentative', null)],
    }),
    week('2026-11-16', {
      holiday_hours: '8.00', leave_approved: '4.00', available: '28.00', allocated: '32.00', confirmed_allocations: '32.00', load_pct: 114, conflict: true, over_hours: '4.00',
      allocations: [alloc('a-3', '32.00', 'confirmed', 'Working drawings')],
      days: [
        day('2026-11-18', 'Wed', { available: '4.00', leave: { status: 'Approved', half_day: true, leave_type: { key: 'earned', name: 'Earned leave' } } }),
        day('2026-11-20', 'Fri', { available: '0.00', holiday: { name: 'Studio holiday', half_day: false } }),
      ],
    }),
  ],
};
const calls: string[] = [];
const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  calls.push(url);
  return url.startsWith('/api/v1/me/schedule')
    ? new Response(JSON.stringify(SCHEDULE), { status: 200, headers: { 'Content-Type': 'application/json' } })
    : new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), { status: 404 });
});
beforeEach(() => { calls.length = 0; vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); });

const open = () => render(<RouterProvider router={createMemoryRouter([{ path: '/me/schedule', element: <MyScheduleScreen /> }], { initialEntries: ['/me/schedule'] })} />);

describe('My schedule in live mode', () => {
  it('shows the published weeks with project, phase and hours, and capacity against booked', async () => {
    open();
    const first = await screen.findByRole('region', { name: 'Week of 9 Nov, this week' });
    expect(screen.getByText('Plan revision 3, published 08 Nov 2026 by Mira Kapoor.')).toBeInTheDocument();
    const bookings = within(first).getByRole('list', { name: 'Bookings, week of 9 Nov' });
    expect(within(bookings).getAllByRole('listitem')).toHaveLength(2);
    expect(within(bookings).getByText(/Concept design/)).toBeInTheDocument();
    expect(within(bookings).getByText('30.00 h')).toBeInTheDocument();
    expect(within(bookings).getByText(/tentative/)).toBeInTheDocument();
    expect(within(first).getByText('Booked 36.00 h of 40.00 h available')).toBeInTheDocument();
    expect(within(first).getByRole('img', { name: '90% booked' })).toHaveClass('load-cell--full');
    expect(calls).toEqual(['/api/v1/me/schedule?weeks=6']);
  });

  it('shows holidays, own leave and an over-booked week in red', async () => {
    open();
    const second = await screen.findByRole('region', { name: 'Week of 16 Nov' });
    expect(within(second).getByRole('img', { name: '114% booked, over by 4.00 h' })).toHaveClass('load-cell--over');
    expect(within(second).getByText('Over by 4.00 h this week')).toBeInTheDocument();
    const off = within(second).getByRole('list', { name: 'Days off, week of 16 Nov' });
    expect(within(off).getByText('Wed 18 Nov: Earned leave, half day')).toBeInTheDocument();
    expect(within(off).getByText('Fri 20 Nov: Studio holiday')).toBeInTheDocument();
    // Read-only: nothing to drag, edit or submit.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
