import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SessionProvider } from '../../../app/session';
import { OverlaysProvider } from '../../../app/overlays';
import { ToastProvider } from '../../../ui/Toast';
import { ProjectOverviewScreen } from './overview';
import { ProjectPhasesScreen } from './phases';
import { ProjectTimeScreen } from './time';
import { ProjectBillingScreen } from './billing';

// Live mode, as a VITE_LIVE=1 build: every tab must read the API, not the sample studio.
vi.mock('../../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../api/live')>()), isLive: true }));

type Reply = { status: number; body: unknown } | undefined;
let handler: (url: string, init: RequestInit) => Reply;
const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const r = handler(String(input), init) ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
});

const m = (amount: string) => ({ amount, currency: 'INR' });
const list = (data: unknown[], extra: Record<string, unknown> = {}) => ({ status: 200, body: { data, page: 1, page_size: 50, total: data.length, complete: true, missing_count: 0, ...extra } });

const ME = (caps: Record<string, string>) => ({
  person: { id: 'u-pm', ref_code: 'Q02', name: 'Nila Varma', work_email: 'nila@firm.test', job_title: 'Project lead', manager_id: null },
  firm: { id: 'f', trading_name: 'Test Studio', legal_name: 'x', currency: 'INR', timezone: 'Asia/Kolkata', accounting_adapter: 'mock' },
  permission_sets: ['pm'], capabilities: caps, led_projects: ['prj-uuid'], member_projects: ['prj-uuid'],
});

// Names and numbers that the sample studio does not have, so a pass proves the API was read.
const PROJECT = {
  id: 'prj-uuid', code: 'LV-77', name: 'Harbour Pavilion', client: 'Port Trust', client_id: 'c1', status: 'Active', hold_reason: null, contract: 'Fixed fee',
  pm: { id: 'u-pm', ref_code: 'Q02', name: 'Nila Varma' },
  hours: { budget: '310.00', actual: '123.50', forecast: '333.50' },
  delivery_progress_pct: 37,
  entitlement: { contracted: m('900000.00'), entitled: m('120000.00'), drafted: m('0.00'), invoiced: m('60000.00'), collected: m('30000.00') },
  contribution: { restricted: true },
  phases: [
    { id: 'ph-a', code: 'BR', name: 'Brief and survey', start_date: '2026-08-03', end_date: '2026-10-30', owner: { id: 'u-o', ref_code: 'Q07', name: 'Ines Kuruvilla' },
      budget_hours: '110.00', actual_hours: '103.50', etc_hours: '0.00', forecast_hours: '103.50', delivery_progress_pct: 100, fee: m('200000.00'), status: 'Complete' },
    { id: 'ph-b', code: 'MS', name: 'Massing studies', start_date: '2026-11-02', end_date: '2027-01-29', owner: { id: 'u-pm', ref_code: 'Q02', name: 'Nila Varma' },
      budget_hours: '200.00', actual_hours: '20.00', etc_hours: '210.00', forecast_hours: '230.00', delivery_progress_pct: 12, fee: { restricted: true }, status: 'Not started' },
  ],
};

let me = ME({ 'projects.plan': 'scoped', 'billing.prepare': 'scoped' });
const isGet = (init: RequestInit) => (init.method ?? 'GET') === 'GET';

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  me = ME({ 'projects.plan': 'scoped', 'billing.prepare': 'scoped' });
});
afterEach(() => vi.unstubAllGlobals());

function open(path: string) {
  render(
    <SessionProvider>
      <ToastProvider>
        <OverlaysProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/firm/projects/:id" element={<ProjectOverviewScreen />} />
              <Route path="/firm/projects/:id/phases" element={<ProjectPhasesScreen />} />
              <Route path="/firm/projects/:id/time" element={<ProjectTimeScreen />} />
              <Route path="/firm/projects/:id/billing" element={<ProjectBillingScreen />} />
            </Routes>
          </MemoryRouter>
        </OverlaysProvider>
      </ToastProvider>
    </SessionProvider>,
  );
}

const called = (pattern: RegExp) => fetchMock.mock.calls.some(([u]) => pattern.test(String(u)));

describe('project overview in live mode', () => {
  it('renders the project from GET /projects/:code and leaves out tiles the API cannot serve', async () => {
    handler = (url) => (url.endsWith('/me') ? { status: 200, body: me } : url.endsWith('/projects/LV-77') ? { status: 200, body: PROJECT } : undefined);
    open('/firm/projects/LV-77');
    const table = await screen.findByRole('region', { name: 'Phases' });
    expect(within(table).getByText('Brief and survey')).toBeInTheDocument();
    expect(within(table).getByText('Not started')).toBeInTheDocument();
    expect(screen.getAllByText('123.5').length).toBeGreaterThan(0);
    expect(screen.getByText('/ 310 h')).toBeInTheDocument();
    expect(screen.getByText('37%')).toBeInTheDocument();
    // Contribution is fenced by the server, so it reads Restricted.
    expect(screen.getAllByRole('img', { name: /^restricted/i }).length).toBeGreaterThan(0);
    // No endpoint for tasks, conflicts or the attention list: nothing from the sample studio is shown.
    expect(screen.queryByText('Open tasks')).toBeNull();
    expect(screen.queryByText('Conflicts')).toBeNull();
    expect(screen.queryByText(/Working drawings/)).toBeNull();
    expect(called(/\/api\/v1\/projects\/LV-77$/)).toBe(true);
  });

  it('shows the permission state when the server refuses', async () => {
    handler = (url) => (url.endsWith('/me') ? { status: 200, body: me }
      : url.endsWith('/projects/LV-77') ? { status: 403, body: { error: { code: 'FORBIDDEN_CAPABILITY', message: 'You are not a member of this project.' } } } : undefined);
    open('/firm/projects/LV-77');
    expect(await screen.findByText(/view this project/i)).toBeInTheDocument();
    expect(screen.queryByText('Brief and survey')).toBeNull();
  });
});

describe('project phases in live mode', () => {
  it('lists the API phases with owner names from the server and a fenced fee', async () => {
    handler = (url) => (url.endsWith('/me') ? { status: 200, body: me } : url.endsWith('/projects/LV-77') ? { status: 200, body: PROJECT } : undefined);
    open('/firm/projects/LV-77/phases');
    const row = (await screen.findByRole('rowheader', { name: 'Massing studies' })).closest('tr')!;
    expect(within(row).getByText('+30')).toHaveClass('err-cell');
    expect(within(row).getByRole('img', { name: /^restricted/i })).toBeInTheDocument();
    expect(screen.getByText('Massing studies is forecast at 230 h against a 200 h budget.')).toBeInTheDocument();
    // Budget revisions have no endpoint yet.
    expect(screen.queryByRole('button', { name: 'Budget revision' })).toBeNull();
  });

  it('saves ETC and delivery with PUT /phases/:id/progress, then reloads', async () => {
    let put: { url: string; body: unknown } | null = null;
    handler = (url, init) => {
      if (url.endsWith('/me')) return { status: 200, body: me };
      if (url.endsWith('/phases/ph-b/progress') && init.method === 'PUT') { put = { url, body: JSON.parse(String(init.body)) }; return { status: 200, body: { ok: true, audit_event_id: 'e1' } }; }
      if (url.endsWith('/projects/LV-77') && isGet(init)) return { status: 200, body: PROJECT };
      return undefined;
    };
    open('/firm/projects/LV-77/phases');
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Massing studies' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit phase' });
    expect(within(sheet).queryByLabelText('Owner')).toBeNull();
    const etc = within(sheet).getByLabelText('ETC (h)');
    await userEvent.clear(etc); await userEvent.type(etc, '190');
    const delivery = within(sheet).getByLabelText('Delivery (%)');
    await userEvent.clear(delivery); await userEvent.type(delivery, '20');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save phase' }));
    await waitFor(() => expect(put).toEqual({ url: '/api/v1/phases/ph-b/progress', body: { etc_hours: 190, delivery_progress_pct: 20 } }));
    expect(await screen.findByText('Massing studies progress saved.')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/projects/LV-77')).length).toBe(2));
  });

  it('shows the server refusal when saving progress is not allowed', async () => {
    handler = (url, init) => {
      if (url.endsWith('/me')) return { status: 200, body: me };
      if (url.endsWith('/progress')) return { status: 403, body: { error: { code: 'FORBIDDEN_CAPABILITY', message: 'You need projects.plan on this project.' } } };
      if (url.endsWith('/projects/LV-77') && isGet(init)) return { status: 200, body: PROJECT };
      return undefined;
    };
    open('/firm/projects/LV-77/phases');
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Brief and survey' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit phase' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save phase' }));
    expect(await screen.findByText('You need projects.plan on this project.')).toBeInTheDocument();
  });
});

describe('project time in live mode', () => {
  const TIME = [
    { person: { id: 'u-o', ref_code: 'Q07', name: 'Ines Kuruvilla' }, phase: { id: 'ph-b', name: 'Massing studies' }, draft: '0.00', submitted: '16.00', returned: '0.00', approved: '4.50', return_reason: null },
    { person: { id: 'u-x', ref_code: 'Q09', name: 'Tomas Pereira' }, phase: { id: 'ph-a', name: 'Brief and survey' }, draft: '0.00', submitted: '0.00', returned: '6.00', approved: '0.00', return_reason: 'Returned by Nila Varma: wrong phase' },
  ];

  it('renders GET /projects/:code/time with server names, returned hours and the approvals link', async () => {
    handler = (url) => (url.endsWith('/me') ? { status: 200, body: me } : url.endsWith('/projects/LV-77/time') ? list(TIME) : undefined);
    open('/firm/projects/LV-77/time');
    const ines = (await screen.findByRole('rowheader', { name: /Ines Kuruvilla/ })).closest('tr')!;
    expect(within(ines).getByText('16.00')).toBeInTheDocument();
    expect(within(ines).getByRole('link', { name: 'Review in Approvals' })).toHaveAttribute('href', '/firm/approvals');
    expect(within(ines).queryByRole('button', { name: 'Approve' })).toBeNull();
    const tomas = screen.getByText('Returned by Nila Varma: wrong phase').closest('tr')!;
    expect(tomas).toHaveClass('dt__row--warn');
    expect(within(tomas).getByText('6.00')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Returned \(h\)/ })).toBeInTheDocument();
    // The sample date range belongs to the demo studio.
    expect(screen.queryByText('01 Sep to 08 Nov 2026')).toBeNull();
  });

  it('shows the permission state for a 403', async () => {
    handler = (url) => (url.endsWith('/me') ? { status: 200, body: me }
      : url.endsWith('/projects/LV-77/time') ? { status: 403, body: { error: { code: 'FORBIDDEN_CAPABILITY', message: 'No.' } } } : undefined);
    open('/firm/projects/LV-77/time');
    expect(await screen.findByText(/view project time/i)).toBeInTheDocument();
  });
});

describe('project billing in live mode', () => {
  const READY = {
    data: [{ id: 'fixed_progress:a1', project: { id: 'prj-uuid', code: 'LV-77', name: 'Harbour Pavilion' }, component: 'Fixed fee', billing_method: 'fixed_percent', phase: 'Brief and survey',
      line_type: 'fixed_progress', label: 'Fixed fee claim, Brief and survey', basis: {}, previous_net_billing: m('0.00'), current_claim: m('73000.00'), remaining_entitlement: m('127000.00'), status: 'Eligible' }],
    // The server spreads the list envelope, then replaces total with the money total.
    page: 1, page_size: 50, complete: true, missing_count: 0, total: m('73000.00'), count: 1,
    exceptions: [{ id: 'nte:c2', project: { id: 'prj-uuid', code: 'LV-77', name: 'Harbour Pavilion' }, component: 'Extra services', title: 'Hourly NTE limit reached', status: 'Excess', hours: '9.00',
      cap: m('50000.00'), consumed: m('41000.00'), requested: m('17000.00'), eligible: m('9000.00'), excess: m('8000.00') }],
    missing: [],
  };
  const DRAFT = {
    id: 'd-uuid', draft_no: 'DRAFT-0042', project: { id: 'prj-uuid', code: 'LV-77', name: 'Harbour Pavilion' }, client: 'Port Trust', cutoff_date: '2026-11-01', prepared_by: 'Odile Fernandes',
    approval_state: 'Draft', accounting_state: 'Not sent', pm_confirmed: false, total: m('55000.00'), external_invoice: null, job: null, lines: [],
  };

  it('reads ready, exceptions and drafts filtered by the project, and hides fee components', async () => {
    handler = (url) => {
      if (url.endsWith('/me')) return { status: 200, body: me };
      if (url.endsWith('/billing/ready?project=LV-77')) return { status: 200, body: READY };
      if (url.endsWith('/billing/drafts?project=LV-77')) return list([DRAFT]);
      return undefined;
    };
    open('/firm/projects/LV-77/billing');
    const ready = await screen.findByRole('region', { name: 'Ready to bill' });
    expect(await within(ready).findByText('Fixed fee claim, Brief and survey')).toBeInTheDocument();
    expect(within(ready).getAllByText('₹73,000').length).toBeGreaterThan(0);
    const drafts = screen.getByRole('region', { name: 'Drafts' });
    expect(await within(drafts).findByText('DRAFT-0042')).toBeInTheDocument();
    expect(within(drafts).getByText('Odile Fernandes')).toBeInTheDocument();
    expect(await screen.findByText('₹8,000')).toBeInTheDocument();
    // Fee components have no endpoint: the sample cards are not shown.
    expect(screen.queryByRole('region', { name: 'Design services' })).toBeNull();
    // A PM with scoped billing.prepare cannot create a draft (the server needs it firm-wide).
    expect(screen.getByRole('button', { name: 'Generate draft' })).toBeDisabled();
  });

  it('shows the permission state when the server refuses billing for this viewer', async () => {
    me = ME({});
    handler = (url) => (url.endsWith('/me') ? { status: 200, body: me }
      : url.includes('/billing/') ? { status: 403, body: { error: { code: 'FORBIDDEN_CAPABILITY', message: 'No.' } } } : undefined);
    open('/firm/projects/LV-77/billing');
    await waitFor(() => expect(screen.getAllByText(/view project billing/i).length).toBeGreaterThan(0));
    expect(screen.queryByText('Fixed fee claim, Brief and survey')).toBeNull();
  });
});
