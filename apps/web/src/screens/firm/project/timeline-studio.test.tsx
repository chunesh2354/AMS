import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SessionProvider } from '../../../app/session';
import { ToastProvider } from '../../../ui/Toast';
import { ProjectsScreen } from '../projects';

// Live mode, as a VITE_LIVE=1 build: the Projects page's Timeline view reads GET /schedule.
vi.mock('../../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../api/live')>()), isLive: true }));

type Reply = { status: number; body: unknown } | undefined;
const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const r = api(String(input)) ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
});
const ME = {
  person: { id: 'u-pr', ref_code: 'Q01', name: 'Asha Menon', work_email: 'x@firm.test', job_title: 'Principal', manager_id: null },
  firm: { id: 'f', trading_name: 'Test Studio', legal_name: 'x', currency: 'INR', timezone: 'Asia/Kolkata', accounting_adapter: 'mock' },
  permission_sets: ['principal'], capabilities: { 'projects.plan': 'all' }, led_projects: [], member_projects: [],
};
const ref = (id: string, name: string) => ({ id, ref_code: id, name });
const phase = (over: Record<string, unknown>) => ({
  id: 'ph', code: 'WD', name: 'Working drawings', status: 'In progress', sort_order: 1, owner: null, start_date: '2026-09-07', end_date: '2026-12-18',
  progress_pct: 62, forecast_end: '2026-12-18', slip_days: 0, budget_hours: '200.00', actual_hours: '170.00', etc_hours: '60.00', forecast_hours: '230.00',
  task_count: 4, open_tasks: 4, overdue_tasks: 2, ...over,
});
const row = (code: string, name: string, pm: { id: string; ref_code: string; name: string }, over: Record<string, unknown> = {}) => ({
  project: { id: code, code, name, client: 'C', status: 'Active', hold_reason: null, pm }, can_reschedule: true,
  planned_start: '2026-02-02', planned_end: '2027-11-26', forecast_end: '2027-11-26', slip_days: 0, end_slip_days: 0, slip_driver: null,
  progress_pct: 40, hours: { budget: '100', actual: '50', etc: '50', forecast: '100' },
  phases: [phase({ id: `${code}-cd`, name: 'Concept design', forecast_hours: '100.00', budget_hours: '140.00', progress_pct: 100, status: 'Complete', overdue_tasks: 0 })],
  milestones: [{ id: `${code}-m`, label: 'Practical completion', status: 'Planned', phase_id: null, date: '2027-11-26', date_source: 'planned' }],
  open_tasks: 3, overdue_tasks: 0, blocking_overdue_tasks: 0, ...over,
});
const VN = ref('u-vn', 'Vikram Nair'); const MI = ref('u-mi', 'Meera Iyer');
const ROWS = [
  row('PRJ-01', 'Lakeview Residence', VN, { phases: [phase({ id: 'p1-wd' })], overdue_tasks: 2 }),
  row('PRJ-02', 'Riverside Offices', MI, { slip_days: 5, slip_driver: { kind: 'phase', id: 'x', name: 'Design development' } }),
  row('PRJ-03', 'Hillside Library', VN, { project: { id: 'PRJ-03', code: 'PRJ-03', name: 'Hillside Library', client: 'C', status: 'On hold', hold_reason: 'Funding review', pm: VN } }),
];
const urls: string[] = [];
function api(url: string): Reply {
  if (url.endsWith('/me')) return { status: 200, body: ME };
  if (url.includes('/api/v1/schedule')) {
    urls.push(url);
    const q = new URL(url, 'http://x').searchParams;
    const data = ROWS.filter((r) => (!q.get('pm') || r.project.pm.id === q.get('pm')) && (!q.get('status') || q.get('status')!.split(',').includes(r.project.status)));
    return { status: 200, body: { data, page: 1, page_size: 200, total: data.length, complete: true, missing_count: 0, today: '2026-11-25', timezone: 'Asia/Kolkata', as_of: null, definition: [] } };
  }
  if (url.endsWith('/projects')) return { status: 200, body: { data: [], page: 1, page_size: 200, total: 0, complete: true, missing_count: 0 } };
  return undefined;
}
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); urls.length = 0; });
afterEach(() => vi.unstubAllGlobals());

function open(path: string) {
  render(
    <SessionProvider><ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/firm/projects" element={<ProjectsScreen />} /></Routes>
      </MemoryRouter>
    </ToastProvider></SessionProvider>,
  );
}

describe('studio timeline in live mode', () => {
  it('keeps List as the default view and switches to the timeline', async () => {
    const user = userEvent.setup();
    open('/firm/projects');
    expect(await screen.findByRole('radio', { name: 'List' })).toBeChecked();
    expect(await screen.findByText('No project matches these filters.')).toBeInTheDocument();
    expect(urls).toEqual([]);
    await user.click(screen.getByRole('radio', { name: 'Timeline' }));
    expect(await screen.findByRole('table', { name: 'All projects on a timeline' })).toBeInTheDocument();
    expect(screen.queryByText('No project matches these filters.')).toBeNull();
  });

  it('shows every project with its state, the on-hold one greyed, the critical overrun, and expands to phases', async () => {
    const user = userEvent.setup();
    open('/firm/projects?view=timeline');
    const table = await screen.findByRole('table', { name: 'All projects on a timeline' });
    expect(within(table).getByRole('link', { name: 'PRJ-01 Lakeview Residence' })).toHaveAttribute('href', '/firm/projects/PRJ-01/timeline');
    expect(within(table).getByText('Working drawings +30 h', { selector: '.gchart__c' })).toBeInTheDocument();
    expect(within(table).getByText('Forecast 5 days late (Design development)')).toBeInTheDocument();
    expect(within(table).getByText('On hold: Funding review')).toBeInTheDocument();
    expect(table.querySelectorAll('.gchart__row--hold').length).toBe(1);
    const crit = screen.getByRole('group', { name: /Critical overrun: PRJ-01 Lakeview Residence, Working drawings/ });
    expect(within(crit).getByText(/Forecast 230 of 200 h, 30 h over budget with 62% done/)).toBeInTheDocument();
    expect(within(crit).getByRole('link', { name: 'Open project timeline' })).toHaveAttribute('href', '/firm/projects/PRJ-01/timeline');
    await user.click(within(table).getByRole('button', { name: 'Expand PRJ-02 Riverside Offices' }));
    expect(within(table).getByText('Concept design')).toBeInTheDocument();
    expect(within(table).getAllByRole('img', { name: /Practical completion/ }).length).toBeGreaterThan(0);
  });

  it('filters by project manager and status through GET /schedule', async () => {
    const user = userEvent.setup();
    open('/firm/projects?view=timeline');
    await screen.findByRole('table', { name: 'All projects on a timeline' });
    expect(urls.at(-1)).toMatch(/\/api\/v1\/schedule$/);
    const pmGroup = screen.getByRole('group', { name: 'Filter by project manager' });
    await user.click(await within(pmGroup).findByRole('button', { name: 'Meera Iyer' }));
    await waitFor(() => expect(urls.at(-1)).toMatch(/\/schedule\?pm=u-mi$/));
    expect(await screen.findByRole('link', { name: 'PRJ-02 Riverside Offices' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('link', { name: 'PRJ-01 Lakeview Residence' })).toBeNull());
    expect(within(pmGroup).getByRole('button', { name: 'Vikram Nair' })).toBeInTheDocument();
    await user.click(within(pmGroup).getByRole('button', { name: 'All' }));
    await user.click(within(screen.getByRole('group', { name: 'Filter by status' })).getByRole('button', { name: 'On hold' }));
    await waitFor(() => expect(urls.at(-1)).toMatch(/\/schedule\?status=On\+hold$/));
    expect(await screen.findByRole('link', { name: 'PRJ-03 Hillside Library' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('link', { name: 'PRJ-02 Riverside Offices' })).toBeNull());
  });
});
