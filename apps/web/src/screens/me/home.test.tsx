import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { routes } from '../../router';
import { SessionProvider } from '../../app/session';
import { ToastProvider } from '../../ui/Toast';
import { SAMPLE_DATA_NOTICE } from '../../api/live';
import type { ApiMyHome, ApiMyWork } from '../../api/live/me';

// A VITE_LIVE=1 build: Home and Work read GET /me/home and GET /me/work and show nothing from the sample studio.
vi.mock('../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/live')>()), isLive: true }));

type Reply = { status: number; body: unknown } | undefined;
let handler: (url: string) => Reply;
const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const r = handler(String(input)) ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
});
const list = (data: unknown[]) => ({ status: 200, body: { data, page: 1, page_size: 50, total: data.length, complete: true, missing_count: 0 } });
const ME = (roles: string[], caps: Record<string, string>) => ({
  status: 200,
  body: {
    person: { id: 'u-me', ref_code: 'P04', name: 'Ravi Kulkarni', work_email: 'ravi@harbour.test', job_title: 'Architect', manager_id: null },
    firm: { id: 'f', trading_name: 'Harbour Works', legal_name: 'Harbour Works LLP', currency: 'INR', timezone: 'Asia/Kolkata', accounting_adapter: 'mock' },
    permission_sets: roles, capabilities: caps, led_projects: [], member_projects: [],
  },
});
const STAFF = ME(['staff'], { 'time.enter': 'own' });
const PM = ME(['pm'], { 'time.enter': 'own', 'time.approve': 'scoped', 'projects.plan': 'scoped' });

const h = (n: number) => n.toFixed(2);
const days = [7, 8, 8, 12.5, 3, 0, 0];
const HOME: ApiMyHome = {
  today: '2026-11-06', timezone: 'Asia/Kolkata', person: { id: 'u-me', name: 'Ravi Kulkarni' }, timer: null,
  week: {
    period_start: '2026-11-02', period_end: '2026-11-08', hours: '38.50', scheduled_hours: '40.00',
    days: days.map((d, i) => ({ date: `2026-11-0${i + 2}`, hours: h(d), scheduled_hours: h(i < 5 ? 8 : 0), over_12h: d > 12 })),
  },
  timesheets: {
    this_week: { period_start: '2026-11-02', status: 'Open', hours: '38.50' },
    last_week: { period_start: '2026-10-26', status: 'Open', hours: '0.00' },
    notices: ['Last week not submitted'],
  },
  returned: [],
  projects: [
    { id: 'p1', code: 'HW-01', name: 'Harbour Pavilion', status: 'Active', role: 'contributor', recent_phases: [{ id: 'ph1', code: 'CD', name: 'Concept design', hours: '19.50', last_date: '2026-11-06' }] },
    { id: 'p2', code: 'HW-02', name: 'Dock Offices', status: 'Active', role: 'lead', recent_phases: [] },
  ],
  pending: { total: 0, by_type: {}, items: [] },
  approvals: null,
};
const WORK: ApiMyWork = {
  today: '2026-11-06', timezone: 'Asia/Kolkata', month: '2026-11', month_start: '2026-11-01', month_end: '2026-11-30', my_hours_month: '34.50',
  projects: [
    {
      id: 'p1', code: 'HW-01', name: 'Harbour Pavilion', client: 'Port Trust', status: 'Active', role: 'contributor', my_hours_month: '30.50',
      phases: [
        { id: 'ph1', code: 'CD', name: 'Concept design', status: 'In progress', start_date: '2026-02-02', end_date: '2026-11-27', current: true, my_hours_month: '19.50' },
        { id: 'ph2', code: 'SD', name: 'Schematic design', status: 'Complete', start_date: '2026-04-13', end_date: '2026-06-26', current: false, my_hours_month: '0.00' },
        { id: 'ph3', code: 'WD', name: 'Working drawings', status: 'In progress', start_date: null, end_date: null, current: false, my_hours_month: '11.00' },
      ],
    },
    {
      id: 'p2', code: 'HW-02', name: 'Dock Offices', client: null, status: 'On hold', role: 'lead', my_hours_month: '4.00',
      phases: [{ id: 'ph4', code: 'SD', name: 'Schematic design', status: 'Not started', start_date: '2026-08-03', end_date: '2026-12-04', current: false, my_hours_month: '4.00' }],
    },
  ],
};

const base = (me: Reply, extra: (url: string) => Reply) => (url: string): Reply => {
  if (url.endsWith('/api/v1/me')) return me;
  if (url.endsWith('/notifications')) return list([]);
  if (url.endsWith('/timers/active')) return { status: 200, body: { active: null } };
  if (url.includes('/approvals?status=Pending')) return list([]);
  return extra(url);
};
const open = (path: string) => {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<SessionProvider><ToastProvider><RouterProvider router={router} /></ToastProvider></SessionProvider>);
  return router;
};

beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('live Home', () => {
  it("shows the week against the schedule, last week's notice and my projects, with no sample data", async () => {
    handler = base(STAFF, (url) => (url.endsWith('/me/home') ? { status: 200, body: HOME } : undefined));
    open('/me/home');
    expect(await screen.findByText('38.50 h of 40.00 h scheduled')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/, Ravi$/);
    expect(screen.getByRole('img', { name: 'Thu: 12.50 h of 8.00 h scheduled, over 12 hours' })).toBeInTheDocument();
    expect(screen.getByText('Last week not submitted')).toBeInTheDocument();
    const projects = screen.getByRole('region', { name: 'My projects' });
    expect(within(projects).getByText('HW-01 Harbour Pavilion')).toBeInTheDocument();
    expect(within(projects).getByText('Contributor')).toBeInTheDocument();
    expect(within(projects).getByText('Recently: Concept design 19.50 h')).toBeInTheDocument();
    expect(within(projects).getByText('No time logged in the last four weeks')).toBeInTheDocument();
    // A staff member approves nothing: no approvals card. Tasks, leave and the sample studio are not shown.
    expect(screen.queryByText('Waiting for me to approve')).toBeNull();
    expect(screen.queryByRole('button', { name: /Request leave/ })).toBeNull();
    expect(screen.queryByText('Due today')).toBeNull();
    expect(screen.queryByText(/Concept option B/)).toBeNull();
    expect(screen.queryByText(SAMPLE_DATA_NOTICE)).toBeNull();
    expect(screen.queryByText(/Studio Meridian|Lakeview/)).toBeNull();
    expect(screen.queryByRole('region', { name: 'Returned to you' })).toBeNull();
  });

  it('lists returned lines with the reason, the running timer, my pending requests and the approval queue', async () => {
    const body: ApiMyHome = {
      ...HOME,
      timer: { id: 't1', started_at: '2026-11-06T04:30:00Z', phase_id: 'ph1', internal_category_id: null, project: { code: 'HW-01', name: 'Harbour Pavilion' }, title: 'Concept design' },
      returned: [{ period_start: '2026-11-02', phase_id: 'ph1', internal_category_id: null, project: { code: 'HW-01', name: 'Harbour Pavilion' }, title: 'Concept design', phase_code: 'CD', hours: '10.00', entries: 3, reason: 'Wrong phase' }],
      timesheets: { ...HOME.timesheets, this_week: { period_start: '2026-11-02', status: 'Returned', hours: '40.00' }, notices: ['This week returned'] },
      pending: { total: 1, by_type: { time: 1 }, items: [{ id: 'a1', type: 'time', label: 'Timesheet', created_at: '2026-11-01T10:00:00Z', period_start: '2026-10-26', project: { code: 'HW-01', name: 'Harbour Pavilion' } }] },
      approvals: { total: 2, by_type: { time: 2 } },
    };
    handler = base(PM, (url) => (url.endsWith('/me/home') ? { status: 200, body } : undefined));
    open('/me/home');
    const returned = await screen.findByRole('region', { name: 'Returned to you' });
    expect(within(returned).getByText('Concept design · HW-01 Harbour Pavilion')).toBeInTheDocument();
    expect(within(returned).getByText(/Wrong phase/)).toBeInTheDocument();
    expect(within(returned).getByText('10.00 h')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /1\s*Returned lines/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2\s*Waiting for me to approve/ })).toBeInTheDocument();
    const timer = screen.getByRole('region', { name: 'Timer running' });
    expect(within(timer).getByText('HW-01 · Concept design')).toBeInTheDocument();
    expect(within(timer).getByText('since 10:00')).toBeInTheDocument();
    const pending = screen.getByRole('region', { name: 'Waiting for approval' });
    expect(within(pending).getByText('Timesheet · HW-01')).toBeInTheDocument();
  });

  it('shows the error state and retries', async () => {
    let fail = true;
    handler = base(STAFF, (url) => (url.endsWith('/me/home') ? (fail ? { status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } } : { status: 200, body: HOME }) : undefined));
    open('/me/home');
    const retry = await screen.findByRole('button', { name: /Try again|Retry/ });
    fail = false;
    await userEvent.click(retry);
    expect(await screen.findByText('38.50 h of 40.00 h scheduled')).toBeInTheDocument();
  });
});

describe('live Work', () => {
  it('lists my projects with phases, status, dates and my hours this month, and my tasks from the API only', async () => {
    handler = base(STAFF, (url) => (url.endsWith('/me/work') ? { status: 200, body: WORK }
      : url.endsWith('/me/tasks') ? { status: 200, body: { ...list([]).body, today: '2026-11-06', overdue: 0, due_soon: 0 } } : undefined));
    open('/me/work');
    const table = await screen.findByRole('table');
    expect(within(table).getByText('HW-01 Harbour Pavilion · Contributor · Active · Port Trust')).toBeInTheDocument();
    expect(within(table).getByText('HW-02 Dock Offices · Lead · On hold')).toBeInTheDocument();
    expect(within(table).getAllByText('Schematic design')).toHaveLength(2);
    expect(within(table).getByText('Done')).toBeInTheDocument();
    expect(within(table).getByText('19.50 h')).toBeInTheDocument();
    expect(within(table).getAllByText('Not set').length).toBe(2);
    expect(screen.getByText('2 projects · 34.50 h in Nov 2026')).toBeInTheDocument();
    // My tasks reads GET /me/tasks (empty here): no sample task, no sample board, and no sample banner.
    expect(await screen.findByText('No open tasks are assigned to you.')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'View' })).toBeNull();
    expect(screen.queryByText(/Stair section/)).toBeNull();
    expect(screen.queryByRole('region', { name: /^(Overdue|Today|This week|Later),/ })).toBeNull();
    expect(screen.queryByText(SAMPLE_DATA_NOTICE)).toBeNull();
  });

  it('says so when I am on no project', async () => {
    handler = base(STAFF, (url) => (url.endsWith('/me/work') ? { status: 200, body: { ...WORK, my_hours_month: '0.00', projects: [] } } : undefined));
    open('/me/work');
    expect(await screen.findByText('You are not on any project team yet.')).toBeInTheDocument();
  });
});
