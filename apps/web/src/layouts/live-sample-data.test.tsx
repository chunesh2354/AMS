import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { routes } from '../router';
import { SessionProvider } from '../app/session';
import { ToastProvider } from '../ui/Toast';
import { LogTimeSheet, defaultLogDate } from '../screens/shared/log-time-sheet';
import { pmNameOf, toProjectRow } from '../screens/firm/projects';
import { preparedByName } from '../screens/firm/billing';
import { settingsSectionsFor } from '../screens/firm/settings';
import { brandFor } from './ShellLayout';
import { todayIn } from '../api/live/time';
import { formatDate } from '../ui/format';
import { TODAY } from '../mock/studio-meridian';
import type { Viewer } from '../app/session';

// A VITE_LIVE=1 build: nothing on a connected route may come from the sample studio.
vi.mock('../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/live')>()), isLive: true }));

type Reply = { status: number; body: unknown } | undefined;
let handler: (url: string, init: RequestInit) => Reply;
const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const r = handler(String(input), init) ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
});
const list = (data: unknown[], total = data.length) => ({ status: 200, body: { data, page: 1, page_size: 50, total, complete: true, missing_count: 0 } });

// P02 is Vikram Nair in the sample studio: the real PM with the same ref code must never read as him.
const ME = (roles: string[], caps: Record<string, string>, ref = 'P04') => ({
  status: 200,
  body: {
    person: { id: 'u-me', ref_code: ref, name: 'Mira Iyer', work_email: 'mira@harbour.test', job_title: 'Partner', manager_id: null },
    firm: { id: 'f', trading_name: 'Harbour Works', legal_name: 'Harbour Works LLP', currency: 'INR', timezone: 'Asia/Kolkata', accounting_adapter: 'mock' },
    permission_sets: roles, capabilities: caps, led_projects: [], member_projects: [],
  },
});
const PRINCIPAL_CAPS = { 'projects.view': 'firm', 'rates.bill.manage': 'firm', 'rates.cost.view': 'firm', 'billing.prepare': 'firm', 'time.approve': 'firm' };
const PROJECT = {
  id: 'prj-1', code: 'HW-01', name: 'Harbour Pavilion', client: 'Port Trust', client_id: 'c1', status: 'Active', hold_reason: null, contract: 'Fixed fee',
  pm: { id: 'u-pm', ref_code: 'P02', name: 'Nila Varma' },
  hours: { budget: '310.00', actual: '123.50', forecast: '200.00' }, delivery_progress_pct: 37,
  entitlement: { restricted: true }, contribution: { restricted: true }, phases: [],
};

const openLive = (path: string) => {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<SessionProvider><ToastProvider><RouterProvider router={router} /></ToastProvider></SessionProvider>);
  return router;
};

beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('live shell', () => {
  it('shows the signed-in firm, the real Approvals count and real PM names, and no sample studio', async () => {
    handler = (url) => {
      if (url.endsWith('/me')) return ME(['principal'], PRINCIPAL_CAPS);
      if (url.includes('/approvals?status=Pending')) return list([{}], 3);
      if (url.endsWith('/notifications')) return list([]);
      if (url.endsWith('/timers/active')) return { status: 200, body: { active: null } };
      if (url.endsWith('/projects')) return list([PROJECT]);
      return undefined;
    };
    openLive('/firm/projects');
    expect((await screen.findAllByText('Harbour Works')).length).toBeGreaterThan(0);
    const table = await screen.findByRole('table');
    expect(await within(table).findByText('Harbour Pavilion')).toBeInTheDocument();
    expect(within(table).getAllByText('Nila Varma').length).toBeGreaterThan(0);
    expect(screen.queryByText('Vikram Nair')).toBeNull();
    const approvals = screen.getAllByRole('link').find((a) => a.getAttribute('href') === '/firm/approvals')!;
    await waitFor(() => expect(approvals).toHaveTextContent('3'));
    expect(approvals).not.toHaveTextContent('14');
    expect(screen.queryByText(/Studio Meridian/)).toBeNull();
    // The pill shows no sample timer for a person whose ref code is P04 in the sample studio.
    expect(screen.queryByText('PRJ-01 · Concept design')).toBeNull();
  });

  it('hides the Approvals badge when the count cannot be read', async () => {
    handler = (url) => {
      if (url.endsWith('/me')) return ME(['principal'], PRINCIPAL_CAPS);
      if (url.includes('/approvals?status=Pending')) return { status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } };
      if (url.endsWith('/notifications')) return list([]);
      if (url.endsWith('/projects')) return list([PROJECT]);
      return undefined;
    };
    openLive('/firm/projects');
    await screen.findByText('Harbour Pavilion');
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/approvals?status=Pending'))).toBe(true));
    const approvals = screen.getAllByRole('link').find((a) => a.getAttribute('href') === '/firm/approvals')!;
    expect(approvals.querySelector('.sidenav__badge')).toBeNull();
  });

  it('brandFor is the firm from /me in live mode and the sample studio only in the mock', () => {
    const v = { id: 'P01', name: 'x', title: '', roles: [], firm: { name: 'Harbour Works', timezone: 'Asia/Kolkata', currency: 'INR' } } as Viewer;
    expect(brandFor(v, true)).toBe('Harbour Works');
    expect(brandFor({ ...v, firm: undefined }, true)).toBe('');
    expect(brandFor(v, false)).toMatch(/Studio Meridian/);
  });
});

describe('live projects list', () => {
  it('keeps the PM name from the API even when the ref code is a sample one', () => {
    const row = toProjectRow(PROJECT as never);
    expect(row.pmId).toBe('P02');
    expect(pmNameOf(row)).toBe('Nila Varma');
    expect(pmNameOf({ ...row, pmName: undefined })).toBe('Vikram Nair'); // the mock lookup, for mock rows only
  });
});

describe('live billing', () => {
  it('shows the preparer name the server sends, as is', () => {
    expect(preparedByName({ preparedBy: 'Mira Iyer' }, true)).toBe('Mira Iyer');
    expect(preparedByName({ preparedBy: '' }, true)).toBe('Not set');
    expect(preparedByName({ preparedBy: 'P02' }, false)).toBe('Vikram Nair');
  });
});

describe('live Log time sheet', () => {
  it('opens on the studio date, not the mock date, and offers no sample tasks', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-09T20:00:00Z')); // 01:30 on 10 Nov in Bengaluru
    handler = (url) => {
      if (url.endsWith('/me')) return ME(['staff'], {});
      if (url.endsWith('/projects')) return list([{ id: 'prj-1', code: 'HW-01', name: 'Harbour Pavilion', phases: [{ id: 'ph-1', name: 'Concept' }] }]);
      if (url.endsWith('/internal-categories')) return list([]);
      if (url.endsWith('/timers/active')) return { status: 200, body: { active: null } };
      return undefined;
    };
    render(<SessionProvider><ToastProvider><LogTimeSheet open onClose={() => {}} /></ToastProvider></SessionProvider>);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(formatDate('2026-11-10'))).toBeInTheDocument();
    expect(within(dialog).queryByText(formatDate(TODAY))).toBeNull();
    expect(within(dialog).queryByText('Task')).toBeNull();
  });

  it('defaultLogDate is the zone date live and the sample date in the mock', () => {
    const now = new Date('2026-11-09T20:00:00Z');
    expect(defaultLogDate(true, 'Asia/Kolkata', now)).toBe(todayIn('Asia/Kolkata', now));
    expect(defaultLogDate(true, 'Asia/Kolkata', now)).toBe('2026-11-10');
    expect(defaultLogDate(false, 'Asia/Kolkata', now)).toBe(TODAY);
  });
});

describe('Settings > Rates', () => {
  const viewer = (roles: string[], capabilities: Record<string, string>) => ({ id: 'x', name: 'x', title: '', roles, capabilities }) as Viewer;
  const keys = (v: Viewer) => settingsSectionsFor(v).map((s) => s.key);

  it('goes to exactly those holding rates.bill.manage or rates.cost.view', () => {
    expect(keys(viewer(['finance'], { 'rates.bill.manage': 'firm', 'rates.cost.view': 'firm' }))).toEqual(['rates']);
    expect(keys(viewer(['operations'], { 'people.manage': 'firm' }))).not.toContain('rates');
    expect(keys(viewer(['operations'], { 'people.manage': 'firm' }))).toContain('profile');
    expect(keys(viewer(['operations'], { 'rates.bill.manage': 'firm' }))).toContain('rates'); // a granted operations person
    expect(keys(viewer(['pm'], { 'rates.cost.view': 'firm' }))).toEqual(['rates']);
    expect(keys(viewer(['principal'], PRINCIPAL_CAPS))).toHaveLength(10);
    expect(keys(viewer(['pm'], {}))).toEqual([]);
    // A project-scoped grant does not open the firm rate card, which the server also refuses.
    expect(keys(viewer(['pm'], { 'rates.bill.manage': 'scoped' }))).toEqual([]);
  });

  it('lets finance open Settings and lands it on Rates', async () => {
    handler = (url) => {
      if (url.endsWith('/me')) return ME(['finance'], { 'rates.bill.manage': 'firm', 'rates.cost.view': 'firm', 'billing.prepare': 'firm' });
      if (url.includes('/rates')) return list([]);
      if (url.endsWith('/notifications')) return list([]);
      return undefined;
    };
    const router = openLive('/firm/settings/profile');
    await waitFor(() => expect(router.state.location.pathname).toBe('/firm/settings/rates'));
    const nav = await screen.findByRole('navigation', { name: 'Settings' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Rates']);
    expect(screen.queryByText(/change firm settings permission/)).toBeNull();
  });

  it('does not offer Rates to operations, which the server would refuse', async () => {
    handler = (url) => {
      if (url.endsWith('/me')) return ME(['operations'], { 'people.manage': 'firm' });
      if (url.endsWith('/notifications')) return list([]);
      return undefined;
    };
    const router = openLive('/firm/settings/rates');
    await waitFor(() => expect(router.state.location.pathname).toBe('/firm/settings/profile'));
    const nav = await screen.findByRole('navigation', { name: 'Settings' });
    expect(within(nav).queryByRole('link', { name: 'Rates' })).toBeNull();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/rates'))).toBe(false);
  });
});
