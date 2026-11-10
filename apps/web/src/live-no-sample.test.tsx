import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter, matchPath } from 'react-router-dom';
import { routes } from './router';
import { CONNECTED_ROUTES, SAMPLE_DATA_NOTICE } from './api/live';
import {
  getApprovals, getInvoices, getMyLeave, getNotifications, getOpportunities, getPeople, getPerson, getProject, getProjectPhaseOptions, getProjects,
  getTasks, getAffectedAssignments, personName,
} from './api';
import { NOT_AVAILABLE } from './ui/NotAvailable';
import { defaultContact } from './ui/PermissionDenied';
import { SessionProvider } from './app/session';
import { ToastProvider } from './ui/Toast';

// A VITE_LIVE=1 build. Nothing from the sample studio may reach the page, on any route or in any shared panel.
vi.mock('./api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('./api/live')>()), isLive: true }));

/** Every name the sample studio uses. None of them may show in live mode. */
const DEMO_NAMES = [
  'Asha Rao', 'Vikram Nair', 'Meera Iyer', 'Rohan Shetty', 'Divya Menon', 'Karan Bhat', 'Sneha Pillai', 'Arjun Das', 'Nisha Kumar', 'Farah Khan',
  'Studio Meridian', 'Lakeview', 'Orchard',
];

// The real firm reuses the sample's reference codes (P01, P02, PRJ-01) on purpose: a lookup into the sample data by code would leak its names.
const ME = {
  person: { id: 'u-P01', ref_code: 'P01', name: 'Mira Kapoor', work_email: 'mira@harbour.test', job_title: 'Partner', manager_id: null },
  firm: { id: 'f1', trading_name: 'Harbour Works', legal_name: 'Harbour Works LLP', currency: 'INR', timezone: 'Asia/Kolkata', accounting_adapter: 'mock' },
  permission_sets: ['principal'],
  capabilities: {
    'projects.plan': 'firm', 'projects.view': 'firm', 'billing.prepare': 'firm', 'billing.approve': 'firm', 'finance.view': 'firm',
    'rates.bill.manage': 'firm', 'rates.cost.view': 'firm', 'people.manage': 'firm', 'time.approve': 'firm', 'leave.approve': 'firm',
    'settings.manage': 'firm', 'accounts.manage': 'firm',
  },
  led_projects: ['prj-1'], member_projects: ['prj-1'],
};
const m = (amount: string) => ({ amount, currency: 'INR' });
const PROJECT = {
  id: 'prj-1', code: 'PRJ-01', name: 'Harbour Pavilion', client: 'Port Trust', client_id: 'c1', status: 'Active', hold_reason: null, contract: 'Fixed fee',
  pm: { id: 'u-P01', ref_code: 'P01', name: 'Mira Kapoor' },
  hours: { budget: '100.00', actual: '10.00', forecast: '100.00' }, delivery_progress_pct: 10,
  entitlement: { contracted: m('100000.00'), entitled: m('0.00'), drafted: m('0.00'), invoiced: m('0.00'), collected: m('0.00') },
  contribution: { restricted: true },
  phases: [{ id: 'ph-1', code: 'BR', name: 'Brief', start_date: '2026-11-02', end_date: '2026-12-31', owner: { id: 'u-P02', ref_code: 'P02', name: 'Nila Varma' },
    budget_hours: '100.00', actual_hours: '10.00', etc_hours: '90.00', forecast_hours: '100.00', delivery_progress_pct: 10, fee: m('100000.00'), status: 'In progress' }],
};
const PERSON = (ref: string, name: string) => ({
  id: `u-${ref}`, ref_code: ref, name, job_title: 'Architect', employment_state: 'Active', login_state: 'Enabled', invitation_state: 'Accepted',
  account_types: ['employee'], manager: null, projects_count: 1, this_week: { week_start: '2026-11-09', logged_hours: '4.00' },
});
const list = (data: unknown[]) => ({ data, page: 1, page_size: 50, total: data.length, complete: true, missing_count: 0 });

function reply(url: string): { status: number; body: unknown } {
  const path = url.replace(/^\/api\/v1/, '').split('?')[0];
  if (path === '/me') return { status: 200, body: ME };
  if (path === '/projects') return { status: 200, body: list([PROJECT]) };
  if (path === '/projects/PRJ-01') return { status: 200, body: PROJECT };
  if (path === '/people/directory') return { status: 200, body: list([PERSON('P01', 'Mira Kapoor'), PERSON('P02', 'Nila Varma')]) };
  if (path === '/notifications') return { status: 200, body: list([]) };
  return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
}
const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const r = reply(String(input));
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
});
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); });
afterEach(() => vi.unstubAllGlobals());

async function openLive(path: string) {
  window.history.replaceState(null, '', path.split('?')[0]);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<SessionProvider><ToastProvider><RouterProvider router={router} /></ToastProvider></SessionProvider>);
  await screen.findByText('Harbour Works');
  // Let every load settle, so a late sample fallback would be on the page too.
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return router;
}

const leaks = () => DEMO_NAMES.filter((n) => (document.body.textContent ?? '').includes(n));

const ROUTES = [
  '/firm/overview', '/firm/projects', '/firm/projects/PRJ-01', '/firm/projects/PRJ-01/phases', '/firm/projects/PRJ-01/staffing',
  '/firm/projects/PRJ-01/time', '/firm/projects/PRJ-01/costs', '/firm/projects/PRJ-01/billing', '/firm/projects/PRJ-01/changes',
  '/firm/projects/PRJ-01/files', '/firm/projects/PRJ-01/activity',
  '/firm/people', '/firm/people/P02', '/firm/workload', '/firm/pipeline', '/firm/pipeline?view=list', '/firm/proposals/PROP-01',
  '/firm/approvals', '/firm/billing', '/firm/receivables', '/firm/reports/utilization', '/firm/reports/contribution',
  ...['profile', 'accounts', 'rates', 'permissions', 'calendars', 'work-categories', 'templates', 'approval-policies', 'integrations', 'imports'].map((k) => `/firm/settings/${k}`),
  '/me/schedule', '/me/time', '/me/expenses', '/me/leave', '/me/profile',
];

const connected = (path: string) => {
  const pathname = path.split('?')[0];
  return CONNECTED_ROUTES.some((r) => matchPath({ path: r, end: true }, pathname));
};
/** Settings sections and tabs that are live although their route is not listed as a whole. */
const PARTLY_LIVE = ['/firm/projects/PRJ-01/staffing', '/firm/settings/approvals', '/me/profile'];

describe('live mode shows no sample data', () => {
  it.each(ROUTES)('%s', async (path) => {
    await openLive(path);
    expect(leaks()).toEqual([]);
    expect(screen.queryByText(SAMPLE_DATA_NOTICE)).toBeNull();
  });

  // A route with no API yet keeps its title and navigation and says so; it never shows sample rows instead.
  it.each(ROUTES.filter((p) => !connected(p) && !PARTLY_LIVE.includes(p)))('%s says it is not available yet', async (path) => {
    await openLive(path);
    expect(screen.getAllByText(NOT_AVAILABLE).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('row')).toHaveLength(0);
    expect(screen.getAllByRole('navigation').length).toBeGreaterThan(0);
  });

  it('the project Staffing tab shows the real team and no sample plan', async () => {
    await openLive('/firm/projects/PRJ-01/staffing');
    expect(screen.getByRole('heading', { name: 'Team' })).toBeInTheDocument();
    expect(screen.getByText(NOT_AVAILABLE)).toBeInTheDocument();
    expect(leaks()).toEqual([]);
  });

  it('My profile shows the work details from the API, not the sample studio', async () => {
    await openLive('/me/profile');
    expect(screen.getByRole('heading', { level: 1, name: 'Mira Kapoor' })).toBeInTheDocument();
    expect(screen.queryByText(/Farah Khan/)).toBeNull();
    expect(leaks()).toEqual([]);
  });

  it('keeps the page title on a screen with no API yet and says what it will show', async () => {
    await openLive('/firm/workload');
    expect(screen.getByRole('heading', { level: 1, name: 'Workload' })).toBeInTheDocument();
    expect(screen.getByText('Not available yet')).toBeInTheDocument();
  });

  it('the command palette offers only real projects and people', async () => {
    await openLive('/firm/overview');
    await userEvent.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(/Harbour Pavilion/);
    await waitFor(() => expect(within(dialog).getByText('Nila Varma')).toBeInTheDocument());
    expect(leaks()).toEqual([]);
  });

  it('the notifications panel is empty, not sample', async () => {
    await openLive('/firm/overview');
    await userEvent.click(screen.getByRole('button', { name: /notifications/i }));
    expect(await screen.findByText(/No notifications/i)).toBeInTheDocument();
    expect(leaks()).toEqual([]);
  });

  it('the Log time sheet lists real projects only', async () => {
    await openLive('/me/time');
    await userEvent.click(screen.getAllByRole('button', { name: /log time/i })[0]);
    await screen.findByRole('dialog');
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(leaks()).toEqual([]);
  });

  it('the Request leave sheet shows no sample assignments', async () => {
    await openLive('/me/leave');
    const buttons = screen.queryAllByRole('button', { name: /request leave/i });
    if (buttons.length) await userEvent.click(buttons[0]);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(leaks()).toEqual([]);
  });
});

describe('the sample studio is empty in live mode', () => {
  it('every mock getter answers with nothing', async () => {
    expect(await getPeople()).toEqual([]);
    expect(await getPerson('P01')).toBeNull();
    expect(await getProjects({ id: 'P01', roles: ['principal'] })).toEqual([]);
    expect(await getProject('PRJ-01', { id: 'P01', roles: ['principal'] })).toBeNull();
    expect(await getApprovals()).toEqual([]);
    expect(await getInvoices()).toEqual([]);
    expect(await getOpportunities()).toEqual([]);
    expect(await getTasks('PRJ-01')).toEqual([]);
    expect(await getMyLeave('P01')).toEqual([]);
    expect(getProjectPhaseOptions()).toEqual([]);
    expect(getNotifications()).toEqual([]);
    expect(getAffectedAssignments()).toEqual([]);
  });

  it('never reads a reference code as a sample person', () => {
    expect(personName('P01')).not.toBe('Asha Rao');
    expect(personName('P02')).not.toBe('Vikram Nair');
    expect(personName(null)).toBe('None');
  });

  it('asks a principal, not the sample principal, for access', () => {
    expect(defaultContact()).not.toMatch(/Asha Rao/);
    expect(defaultContact(false)).toBe('Asha Rao (Principal)');
  });
});
