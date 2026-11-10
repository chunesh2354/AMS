import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../ui/Toast';
import { MyLeaveScreen } from './leave';

// A VITE_LIVE=1 build: everything on My leave comes from GET /me/leave.
vi.mock('../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/live')>()), isLive: true }));
const openLeave = vi.fn();
vi.mock('../../app/overlays', () => ({ useOverlays: () => ({ openLeave, openLogTime: vi.fn() }) }));
vi.mock('../../app/session', () => ({ useSession: () => ({ viewer: { id: 'u-P04', firm: { timezone: 'Asia/Kolkata' } } }) }));

const request = (id: string, extra: Record<string, unknown>) => ({
  id, leave_type: { id: 't-1', key: 'earned', name: 'Earned leave' }, half_day: false, reason: null, handover_note: null,
  approver: { id: 'u-P02', name: 'Nila Varma' }, approval_request_id: null, decided_at: null, decision_reason: null, ...extra,
});
const ME_LEAVE = {
  year: 2026, today: '2026-11-10', day_hours: 8,
  types: [{ id: 't-1', key: 'earned', name: 'Earned leave', tracks_balance: true }],
  balances: [
    { leave_type: { id: 't-1', key: 'earned', name: 'Earned leave' }, tracks_balance: true, allowance_days: '18.00', taken_days: '3.00', pending_days: '1.00', available_days: '14.00' },
    { leave_type: { id: 't-4', key: 'unpaid', name: 'Unpaid leave' }, tracks_balance: false, allowance_days: null, taken_days: '0.00', pending_days: '0.00', available_days: null },
  ],
  requests: [
    request('l-1', { start_date: '2026-11-23', end_date: '2026-11-25', days: '3.00', hours: '24.00', status: 'Approved', can_withdraw: true }),
    request('l-2', { start_date: '2026-09-01', end_date: '2026-09-01', days: '1.00', hours: '8.00', status: 'Rejected', can_withdraw: false }),
  ],
};
const calls: { url: string; method: string }[] = [];
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  calls.push({ url, method: init?.method ?? 'GET' });
  if (url.startsWith('/api/v1/me/leave')) return new Response(JSON.stringify(ME_LEAVE), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (url === '/api/v1/leave-requests/l-1/withdraw') return new Response(JSON.stringify({ ...ME_LEAVE.requests[0], status: 'Withdrawn' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), { status: 404 });
});
beforeEach(() => { calls.length = 0; vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); });
afterEach(() => { vi.unstubAllGlobals(); });

const open = () => {
  const router = createMemoryRouter([{ path: '/me/leave', element: <MyLeaveScreen /> }], { initialEntries: ['/me/leave'] });
  render(<ToastProvider><RouterProvider router={router} /></ToastProvider>);
};

describe('My leave in live mode', () => {
  it('shows balances, the strip and requests from GET /me/leave, never the sample data', async () => {
    open();
    const table = await screen.findByRole('table');
    expect(screen.getByText('14.00')).toBeTruthy();
    expect(screen.queryByText('Unpaid leave')).toBeNull();
    expect(within(table).getByText('23 to 25 Nov 2026')).toBeTruthy();
    expect(within(table).getAllByText('Nila Varma').length).toBe(2);
    expect(screen.getByText('Leave 3 d')).toBeTruthy();
    // Sample rows (Rohan's 16 to 17 Nov) never appear.
    expect(screen.queryByText('16 to 17 Nov 2026')).toBeNull();
    expect(calls.every((c) => c.url.startsWith('/api/v1/me/leave'))).toBe(true);
  });

  it('withdraws approved leave through the API and reloads', async () => {
    open();
    await screen.findByRole('table');
    const buttons = screen.getAllByRole('button', { name: 'Withdraw' });
    expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Withdraw leave' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    await screen.findByText('Leave withdrawn, 23 to 25 Nov 2026.');
    expect(calls.some((c) => c.url === '/api/v1/leave-requests/l-1/withdraw' && c.method === 'POST')).toBe(true);
    expect(calls.filter((c) => c.url.startsWith('/api/v1/me/leave')).length).toBeGreaterThanOrEqual(2);
  });

  it('Request leave opens the shared sheet', async () => {
    open();
    await screen.findByRole('table');
    await userEvent.click(screen.getAllByRole('button', { name: 'Request leave' })[0]);
    expect(openLeave).toHaveBeenCalled();
  });
});
