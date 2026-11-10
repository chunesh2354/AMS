import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { SessionProvider } from '../../app/session';
import { ToastProvider } from '../../ui/Toast';
import { CONNECTED_ROUTES, ApiFailure } from '../../api/live';
import { toOverview, type ApiOverview } from '../../api/live/overview';
import { OverviewScreen } from './overview';

// A VITE_LIVE=1 build: the studio overview reads GET /overview and nothing from the sample studio.
vi.mock('../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/live')>()), isLive: true }));

type Reply = { status: number; body: unknown } | undefined;
let handler: (url: string) => Reply;
const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const r = handler(String(input)) ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
});
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); });
afterEach(() => vi.unstubAllGlobals());

const m = (amount: string) => ({ amount, currency: 'INR' });
const ME = {
  person: { id: 'u-1', ref_code: 'P01', name: 'Mira Iyer', work_email: 'mira@harbour.test', job_title: 'Partner', manager_id: null },
  firm: { id: 'f', trading_name: 'Harbour Works', legal_name: 'Harbour Works LLP', currency: 'INR', timezone: 'Asia/Kolkata', accounting_adapter: 'mock' },
  permission_sets: ['principal'], capabilities: { 'budgets.hours.view': 'firm', 'billing.prepare': 'firm', 'receivables.manage': 'firm' }, led_projects: [], member_projects: [],
};
const att = (type: string, severity: string, title: string, detail: string, age: number, link: string | null) => ({ id: `${type}:1`, type, severity, title, detail, age_days: age, link });

/** The shape GET /overview returns (apps/api/src/modules/overview/overview.routes.ts). */
const OVERVIEW: ApiOverview = {
  as_of: '2026-11-06', timezone: 'Asia/Kolkata', scope: 'firm', period: { from: '2026-11-01', to: '2026-11-06' }, week: { from: '2026-11-02', to: '2026-11-08' },
  figures: {
    ready_to_bill: { value: m('486000.00'), count: 3, complete: true, missing: [] },
    overdue: { value: m('160000.00'), count: 1 },
    utilization: { value: 12.5, billable_hours: '50.00', available_hours: '400.00', people: 10, complete: false, missing: ['Working schedules (a standard 8 h weekday is assumed)', 'Tara Rao cost rate'] },
    approvals_waiting: { count: 2, oldest_days: 4, stale_after_days: 3 },
  },
  attention: [
    att('overdue_invoice', 'danger', 'INV-HW-0042 unpaid', 'HW-01 · Port Trust · ₹1,60,000 outstanding', 40, '/firm/receivables'),
    att('phase_overrun', 'danger', 'HW-01 Working drawings', '200 h budget, 170 h actual, 60 h ETC · forecast +30 h', 2, '/firm/projects/HW-01/phases'),
    att('over_day_hours', 'warn', 'Kabir Sen over 12 h on Thursday', '12.50 h logged on 5 Nov', 1, '/firm/projects/HW-01/time'),
    att('missing_cost_rate', 'warn', 'Tara Rao has no cost rate', 'Utilization and cost reports are incomplete', 9, '/firm/settings/rates'),
    att('returned_lines', 'warn', 'Ila Das: 3 returned lines', 'HW-01 · 10.00 h · wrong phase', 3, null),
  ] as ApiOverview['attention'],
  projects: [
    { id: 'p1', code: 'HW-01', name: 'Harbour Pavilion', client: 'Port Trust', status: 'Active', hold_reason: null, pm: { id: 'u-2', ref_code: 'P02', name: 'Nila Varma' }, fee: m('2400000.00'), delivery_progress_pct: 48, hours: { budget: '1100.00', actual: '820.00', forecast: '1130.00' }, over_budget: true },
    { id: 'p2', code: 'HW-02', name: 'Dock Offices', client: 'Port Trust', status: 'On hold', hold_reason: 'Funding', pm: { id: 'u-2', ref_code: 'P02', name: 'Nila Varma' }, fee: { restricted: true }, delivery_progress_pct: 4, hours: { budget: '280.00', actual: '10.00', forecast: '280.00' }, over_budget: false },
  ],
};

const open = (body: unknown = OVERVIEW, status = 200) => {
  handler = (url) => {
    if (url.endsWith('/api/v1/me')) return { status: 200, body: ME };
    if (url.endsWith('/api/v1/overview')) return { status, body };
    return undefined;
  };
  const router = createMemoryRouter([
    { path: '/firm/overview', element: <OverviewScreen /> },
    { path: '*', element: <p>Elsewhere</p> },
  ], { initialEntries: ['/firm/overview'] });
  render(<SessionProvider><ToastProvider><RouterProvider router={router} /></ToastProvider></SessionProvider>);
  return router;
};

describe('Studio overview in live mode', () => {
  it('is a connected route, so it shows no sample data banner', () => {
    expect(CONNECTED_ROUTES).toContain('/firm/overview');
  });

  it('shows the key figures from GET /overview, with utilization marked incomplete', async () => {
    open();
    expect(await screen.findByText('₹4,86,000')).toBeInTheDocument();
    expect(screen.getByText('₹1,60,000')).toBeInTheDocument();
    expect(screen.getByText('One invoice is past its due date.')).toBeInTheDocument();
    expect(screen.getByText('13%')).toBeInTheDocument();
    expect(screen.getByText(/50 h of 400 h available\. Missing: Working schedules .*Tara Rao cost rate\./)).toBeInTheDocument();
    expect(screen.getByText('Waiting for you; the oldest for 4 days.')).toBeInTheDocument();
    expect(screen.getByText('Five things need your attention.')).toBeInTheDocument();
    // Nothing from the sample studio, and no queue cards (they have no endpoint yet).
    expect(screen.queryByText(/Asha|INV-DEMO-0007|PRJ-01/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Queues' })).toBeNull();
    expect(fetchMock.mock.calls.map(([u]) => String(u))).toContain('/api/v1/overview');
  });

  it('lists the attention rows severity first, and each verb opens the right screen', async () => {
    const router = open();
    await screen.findByText('INV-HW-0042 unpaid');
    const list = screen.getByRole('region', { name: 'Needs attention' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('INV-HW-0042 unpaid');
    expect(rows[0]).toHaveTextContent('40 days');
    expect(within(list).getByRole('img', { name: 'Long day' })).toBeInTheDocument();
    // A row without a link has no button.
    expect(within(rows.find((r) => r.textContent?.includes('Ila Das'))!).queryByRole('link')).toBeNull();
    for (const [verb, to] of [['Review phase', '/firm/projects/HW-01/phases'], ['Check hours', '/firm/projects/HW-01/time'], ['Set rate', '/firm/settings/rates'], ['Chase payment', '/firm/receivables']] as const) {
      if (router.state.location.pathname !== '/firm/overview') { await router.navigate('/firm/overview'); }
      await userEvent.click(await screen.findByRole('link', { name: verb }));
      expect(router.state.location.pathname).toBe(to);
    }
  });

  it('lists the projects with status, fee and progress, fencing a fee it may not show', async () => {
    open();
    const projects = await screen.findByRole('region', { name: 'Projects' });
    expect(within(projects).getByText('HW-01 Harbour Pavilion')).toBeInTheDocument();
    expect(within(projects).getByText('Fee ₹24,00,000')).toBeInTheDocument();
    expect(within(projects).getByText('48% complete · over budget')).toBeInTheDocument();
    expect(within(projects).getByRole('status', { name: 'On hold' })).toBeInTheDocument();
    expect(within(projects).getByRole('img', { name: /restricted/ })).toBeInTheDocument();
  });

  it('fences money the viewer may not see, never showing zero or blank', async () => {
    open({ ...OVERVIEW, figures: { ...OVERVIEW.figures, ready_to_bill: { restricted: true }, overdue: { restricted: true } } });
    const figures = await screen.findByRole('region', { name: 'Key figures' });
    expect(await within(figures).findAllByRole('img', { name: /restricted/ })).toHaveLength(2);
    expect(within(figures).queryByText(/₹/)).toBeNull();
  });

  it('shows the permission state when the server refuses', async () => {
    open({ error: { code: 'FORBIDDEN_CAPABILITY', message: 'You need budgets.hours.view for this.', details: [], capability: 'budgets.hours.view' } }, 403);
    expect(await screen.findByText(/permission/i)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Key figures' })).toBeNull();
  });
});

describe('toOverview', () => {
  it('refuses a missing amount instead of a silent zero', () => {
    const bad = { ...OVERVIEW, figures: { ...OVERVIEW.figures, overdue: { value: null, count: 1 } } } as unknown as ApiOverview;
    expect(() => toOverview(bad)).toThrow(ApiFailure);
  });
  it('maps each attention type to its chip and verb, and a missing link to no button', () => {
    const o = toOverview(OVERVIEW);
    expect(o.attention.map((a) => [a.status, a.verb])).toEqual([
      ['Overdue', 'Chase payment'], ['Overrun', 'Review phase'], ['Pending (approval)', 'Check hours'], ['Incomplete data', 'Set rate'], ['Returned', 'Open time'],
    ]);
    expect(o.attention[4].to).toBeUndefined();
    expect(o.projects[1].fee).toEqual({ restricted: true });
  });
});
