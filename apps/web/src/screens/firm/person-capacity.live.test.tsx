import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SessionProvider } from '../../app/session';
import { ToastProvider } from '../../ui/Toast';
import { PersonScreen } from './person';

// A VITE_LIVE=1 build: the Capacity tab reads GET /people/:id/capacity and saves weekly hours with PUT (planning.routes.ts).
vi.mock('../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/live')>()), isLive: true }));

const ME = (ref: string, caps: Record<string, string>) => ({
  person: { id: `u-${ref}`, ref_code: ref, name: 'Viewer', work_email: 'v@harbour.test', job_title: 'Partner', manager_id: null },
  firm: { id: 'f', trading_name: 'Harbour Works', legal_name: 'Harbour Works LLP', currency: 'INR', timezone: 'Asia/Kolkata', accounting_adapter: 'mock' },
  permission_sets: ['principal'], capabilities: caps, led_projects: [], member_projects: [],
});
const PRINCIPAL = { 'people.view': 'firm', 'people.manage': 'firm', 'capacity.manage': 'firm' };
const PROFILE = {
  id: 'u-P05', ref_code: 'P05', name: 'Tara Joshi', work_email: 'tara@harbour.test', job_title: 'Architect', employment_state: 'Active', login_state: 'Enabled',
  invitation_state: 'Accepted', account_types: ['employee'], manager: null, projects: [], hidden_projects: 0,
  time: { week_start: '2026-11-09', weeks: [] }, rates: { bill_rate: { restricted: true }, bill_effective_from: null, cost_rate: { restricted: true }, cost_effective_from: null },
};
const wk = (start: string, extra: Record<string, unknown> = {}) => ({
  week_start: start, week_end: start, capacity: '40.00', scheduled: '40.00', holiday_hours: '0.00', holidays: [], leave_approved: '0.00', leave_pending: '0.00', on_leave: false, leave: [],
  available: '40.00', allocated: '20.00', confirmed_allocations: '20.00', tentative_allocations: '0.00', remaining: '20.00', load_pct: 50, conflict: false, over_hours: '0.00', other_hours: '0.00', allocations: [], ...extra,
});
const WEEKS = ['2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21', '2026-12-28'].map((d, i) =>
  (i === 1 ? wk(d, { holiday_hours: '8.00', available: '32.00', allocated: '36.00', confirmed_allocations: '36.00', load_pct: 113, conflict: true, over_hours: '4.00' }) : wk(d)));
let versions = [
  { id: 'c-1', effective_from: '2026-01-01', weekly_hours: '40.00', note: null, created_at: '2026-01-01T00:00:00Z', created_by: 'Mira Kapoor' },
];
let canManage = true;
let me = ME('P01', PRINCIPAL);
const capacity = () => ({
  person: { id: 'u-P05', ref_code: 'P05', name: 'Tara Joshi', job_title: 'Architect', employment_state: 'Active', login_state: 'Enabled' },
  today: '2026-11-10', timezone: 'Asia/Kolkata', view: 'draft', firm_default_weekly_hours: '40.00',
  current: { weekly_hours: versions.at(-1)!.weekly_hours, effective_from: versions.at(-1)!.effective_from, source: 'person' },
  versions, can_manage: canManage, from: '2026-11-09', to: '2027-01-03', weeks: WEEKS,
});
const calls: { url: string; method: string; body?: unknown }[] = [];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ url, method, body });
  if (url === '/api/v1/me') return json(200, me);
  if (url === '/api/v1/people/P05/profile') return json(200, PROFILE);
  if (url === '/api/v1/people/P05/capacity?weeks=8') return json(200, capacity());
  if (url === '/api/v1/people/P05/capacity' && method === 'PUT') {
    versions = [...versions, { id: 'c-2', effective_from: body.effective_from, weekly_hours: Number(body.weekly_hours).toFixed(2), note: body.note ?? null, created_at: '', created_by: 'Viewer' }];
    return json(200, { id: 'c-2', effective_from: body.effective_from, weekly_hours: Number(body.weekly_hours).toFixed(2), note: null, versions, audit_event_id: 'e' });
  }
  return json(404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
});
beforeEach(() => {
  calls.length = 0; canManage = true; me = ME('P01', PRINCIPAL);
  versions = [{ id: 'c-1', effective_from: '2026-01-01', weekly_hours: '40.00', note: null, created_at: '2026-01-01T00:00:00Z', created_by: 'Mira Kapoor' }];
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

const open = (path = '/firm/people/P05?tab=capacity') => render(
  <SessionProvider><ToastProvider>
    <MemoryRouter initialEntries={[path]}><Routes><Route path="/firm/people/:id" element={<PersonScreen />} /></Routes></MemoryRouter>
  </ToastProvider></SessionProvider>,
);

describe('Person Capacity tab in live mode', () => {
  it('shows the next 8 weeks, the over-booked week and the weekly hours history', async () => {
    open();
    expect(await screen.findByRole('heading', { name: 'Next 8 weeks' })).toBeInTheDocument();
    const tabs = screen.getByRole('navigation', { name: /sections/ });
    expect([...tabs.querySelectorAll('a')].map((a) => a.textContent)).toEqual(['Overview', 'Access', 'Projects', 'Capacity']);
    expect(screen.getAllByRole('img', { name: /^Week of/ })).toHaveLength(8);
    expect(screen.getByRole('img', { name: /^Week of 16 Nov: 40 h scheduled, 8 holiday, 0 leave, 0 commitment, 36 allocated, 4 h over/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Conflict/ })).toHaveTextContent('4.00 h');
    const history = screen.getByRole('region', { name: 'Weekly hours' });
    expect(within(history).getByText('01 Jan 2026 to open')).toBeInTheDocument();
    expect(within(history).getByText('Set by Mira Kapoor')).toBeInTheDocument();
  });

  it('changes weekly hours from an effective date and reloads', async () => {
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Change weekly hours' }));
    const sheet = await screen.findByRole('dialog', { name: 'Change weekly hours' });
    const hours = within(sheet).getByLabelText('Hours per week');
    await userEvent.clear(hours);
    await userEvent.type(hours, '200');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save hours' }));
    expect(within(sheet).getByText(/Enter hours from 0 to 168/)).toBeInTheDocument();
    await userEvent.clear(hours);
    await userEvent.type(hours, '32');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save hours' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Change weekly hours' })).toBeNull());
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ weekly_hours: 32, effective_from: '2026-11-10' });
    expect(await screen.findByText('10 Nov 2026 to open')).toBeInTheDocument();
    expect(screen.getByText('01 Jan 2026 to 09 Nov 2026')).toBeInTheDocument();
  });

  it('is read-only for view-level capacity.manage (PMs, finance)', async () => {
    me = ME('P01', { 'people.view': 'firm', 'capacity.manage': 'view' });
    canManage = false;
    open();
    expect(await screen.findByRole('heading', { name: 'Next 8 weeks' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change weekly hours' })).toBeNull();
  });

  it('has no Capacity tab for staff on another person', async () => {
    me = ME('P01', { 'people.view': 'firm', 'capacity.manage': 'own' });
    open();
    expect(await screen.findByRole('heading', { level: 1, name: 'Tara Joshi' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Capacity' })).toBeNull();
    expect(calls.some((c) => c.url.includes('/capacity'))).toBe(false);
  });

  it('shows staff their own capacity', async () => {
    me = ME('P05', { 'people.view': 'firm', 'capacity.manage': 'own' });
    canManage = false;
    open();
    expect(await screen.findByRole('heading', { name: 'Next 8 weeks' })).toBeInTheDocument();
  });
});
