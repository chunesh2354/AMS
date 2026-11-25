import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SessionProvider } from '../../app/session';
import { ToastProvider } from '../../ui/Toast';
import { CalendarScreen } from './calendar';

// A VITE_LIVE=1 build: everything comes from GET /calendar (planning.routes.ts), never the design's demo items.
vi.mock('../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/live')>()), isLive: true }));

const ME = {
  person: { id: 'u-P01', ref_code: 'P01', name: 'Mira Kapoor', work_email: 'mira@harbour.test', job_title: 'Partner', manager_id: null },
  firm: { id: 'f1', trading_name: 'Harbour Works', legal_name: 'Harbour Works LLP', currency: 'INR', timezone: 'Asia/Kolkata', accounting_adapter: 'mock' },
  permission_sets: ['principal'], capabilities: { 'people.view': 'firm', 'projects.view': 'firm' }, led_projects: [], member_projects: [],
};
const P = { id: 'prj-1', code: 'HW-01', name: 'Harbour Pavilion' };
const PROJECT = {
  id: 'prj-1', code: 'HW-01', name: 'Harbour Pavilion', client: 'Port Trust', client_id: 'c1', status: 'Active', hold_reason: null, contract: 'Fixed fee',
  pm: { id: 'u-P01', ref_code: 'P01', name: 'Mira Kapoor' }, hours: { budget: '100.00', actual: '10.00', forecast: '100.00' }, delivery_progress_pct: 10,
  entitlement: { contracted: { amount: '1.00', currency: 'INR' }, entitled: { amount: '0.00', currency: 'INR' }, drafted: { amount: '0.00', currency: 'INR' }, invoiced: { amount: '0.00', currency: 'INR' }, collected: { amount: '0.00', currency: 'INR' } },
  contribution: { restricted: true }, phases: [],
};
const CAL = {
  from: '2026-10-26', to: '2026-12-06', today: '2026-11-10', timezone: 'Asia/Kolkata', types: ['phase', 'milestone', 'task', 'leave', 'holiday'], project: null,
  events: [
    { id: 'phase_start:ph-1', type: 'phase_start', date: '2026-11-02', title: 'Brief starts', project: P, phase: { id: 'ph-1', code: 'BR', name: 'Brief', status: 'In progress' } },
    { id: 'leave:u-P02:2026-11-16', type: 'leave', date: '2026-11-16', start_date: '2026-11-16', end_date: '2026-11-17', half_day: false, status: 'Approved', title: 'Nila Varma: On leave', label: 'On leave', leave_type: null, person: { id: 'u-P02', ref_code: 'P02', name: 'Nila Varma' }, mine: false },
    { id: 'task:t-1', type: 'task_due', date: '2026-11-12', title: 'Site survey', status: 'To do', project: P, phase: null, task: { id: 't-1', assignee: { id: 'u-P02', name: 'Nila Varma' }, mine: false } },
    { id: 'holiday:h-1', type: 'holiday', date: '2026-11-20', title: 'Studio holiday', half_day: false },
    { id: 'milestone:m-1', type: 'milestone', date: '2026-11-27', date_basis: 'phase_end', title: 'Brief invoice', status: 'Planned', project: P, phase: { id: 'ph-1', code: 'BR', name: 'Brief' } },
  ],
};
const list = (data: unknown[]) => ({ data, page: 1, page_size: 200, total: data.length, complete: true, missing_count: 0 });
const calls: string[] = [];
const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  calls.push(url);
  const path = url.replace(/^\/api\/v1/, '').split('?')[0];
  const [status, body] = path === '/me' ? [200, ME] : path === '/projects' ? [200, list([PROJECT])] : path === '/calendar' ? [200, CAL] : [404, { error: { code: 'NOT_FOUND', message: 'Not found' } }];
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
});
beforeEach(() => {
  calls.length = 0;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T06:00:00Z'));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const open = () => render(
  <SessionProvider><ToastProvider>
    <MemoryRouter initialEntries={['/firm/calendar']}><Routes><Route path="/firm/calendar" element={<CalendarScreen />} /></Routes></MemoryRouter>
  </ToastProvider></SessionProvider>,
);

describe('Calendar in live mode', () => {
  it('asks GET /calendar for the month grid and shows its events, never the demo items', async () => {
    open();
    const grid = await screen.findByRole('table', { name: 'November 2026' });
    expect(calls).toContain('/api/v1/calendar?from=2026-10-26&to=2026-12-06');
    expect(within(grid).getByRole('cell', { name: /^Tuesday 10 November, today/ })).toBeInTheDocument();
    expect(within(grid).getByText('HW-01 Brief starts')).toBeInTheDocument();
    // Leave spans both days and never shows a type.
    expect(within(grid).getAllByText('Nila Varma on leave')).toHaveLength(2);
    expect(within(grid).getByRole('button', { name: /^Studio holiday/ })).toBeInTheDocument();
    for (const demo of ['Karan Bhat', 'Lakeview', 'Diwali', 'Divya Menon']) expect(screen.queryByText(new RegExp(demo))).toBeNull();
  });

  it('opens a task with its assignee and a link to the project tasks', async () => {
    open();
    const grid = await screen.findByRole('table', { name: 'November 2026' });
    await userEvent.click(within(grid).getByRole('button', { name: /HW-01 Site survey, Due in 2 days/ }));
    const pop = await screen.findByRole('dialog', { name: 'HW-01 Site survey' });
    expect(within(pop).getByText('Nila Varma')).toBeInTheDocument();
    expect(within(pop).getByRole('link', { name: 'Open task' })).toHaveAttribute('href', '/firm/projects/HW-01/tasks');
    // Keyboard: focus moves into the popover, Tab reaches Close and then the source link.
    await userEvent.tab();
    expect(within(pop).getByRole('button', { name: 'Close' })).toHaveFocus();
    await userEvent.tab();
    expect(within(pop).getByRole('link', { name: 'Open task' })).toHaveFocus();
    await userEvent.click(within(pop).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'HW-01 Site survey' })).toBeNull());
  });

  it('filters by project on the server and by type on the page', async () => {
    open();
    await screen.findByRole('table', { name: 'November 2026' });
    await userEvent.click(screen.getByRole('button', { name: /Billing milestones/ }));
    expect(screen.queryByText('HW-01 Brief invoice')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Billing milestones/ }));
    expect(screen.getByText('HW-01 Brief invoice')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Project'));
    await userEvent.click(await screen.findByRole('option', { name: 'HW-01 Harbour Pavilion' }));
    await waitFor(() => expect(calls).toContain('/api/v1/calendar?from=2026-10-26&to=2026-12-06&project=HW-01'));
  });

  it('asks for one week in the week view', async () => {
    open();
    await screen.findByRole('table', { name: 'November 2026' });
    await userEvent.click(screen.getByRole('radio', { name: 'Week' }));
    expect(await screen.findByRole('table', { name: '9 to 15 Nov 2026' })).toBeInTheDocument();
    expect(calls).toContain('/api/v1/calendar?from=2026-11-09&to=2026-11-15');
  });
});
