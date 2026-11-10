import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SessionProvider } from '../../app/session';
import { PersonScreen } from './person';

// A VITE_LIVE=1 build: the profile comes from GET /people/:id/profile and nothing from the sample studio.
vi.mock('../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/live')>()), isLive: true }));

const R = { restricted: true };
const ME = (caps: Record<string, string>) => ({
  person: { id: 'u-me', ref_code: 'P01', name: 'Mira Iyer', work_email: 'mira@harbour.test', job_title: 'Partner', manager_id: null },
  firm: { id: 'f', trading_name: 'Harbour Works', legal_name: 'Harbour Works LLP', currency: 'INR', timezone: 'Asia/Kolkata', accounting_adapter: 'mock' },
  permission_sets: ['principal'], capabilities: caps, led_projects: [], member_projects: [],
});
const PRINCIPAL = { 'people.view': 'firm', 'people.manage': 'firm', 'rates.bill.manage': 'firm', 'rates.cost.view': 'firm' };
const STAFF = { 'people.view': 'firm', 'capacity.manage': 'own' };

const PROFILE = {
  id: 'u-P05', ref_code: 'P05', name: 'Tara Joshi', work_email: 'tara@harbour.test', job_title: 'Architect',
  employment_state: 'Active', login_state: 'Enabled', invitation_state: 'Accepted', account_types: ['employee'],
  manager: { id: 'u-P02', ref_code: 'P02', name: 'Nila Varma' },
  projects: [{ id: 'prj-1', code: 'HW-01', name: 'Harbour Pavilion', status: 'Active', role: 'contributor' }], hidden_projects: 0,
  time: { week_start: '2026-11-09', weeks: [
    { week_start: '2026-10-19', logged_hours: '40.00', approved_hours: '40.00' }, { week_start: '2026-10-26', logged_hours: '38.00', approved_hours: '30.00' },
    { week_start: '2026-11-02', logged_hours: '40.00', approved_hours: '0.00' }, { week_start: '2026-11-09', logged_hours: '16.50', approved_hours: '0.00' },
  ] },
  rates: { bill_rate: { amount: '1600.00', currency: 'INR' }, bill_effective_from: '2026-04-01', cost_rate: { amount: '640.00', currency: 'INR' }, cost_effective_from: '2026-04-01' },
};
const FENCED = { ...PROFILE, time: R, hidden_projects: 2, projects: [], rates: { bill_rate: R, bill_effective_from: null, cost_rate: R, cost_effective_from: null } };

let me = ME(PRINCIPAL);
let profile: unknown = PROFILE;
const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  const [status, body] = url === '/api/v1/me' ? [200, me]
    : url === '/api/v1/people/P05/profile' ? [200, profile]
      : [404, { error: { code: 'NOT_FOUND', message: 'Person was not found.' } }];
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
});
beforeEach(() => { me = ME(PRINCIPAL); profile = PROFILE; vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); });
afterEach(() => { vi.unstubAllGlobals(); });

const open = (path: string) => render(
  <SessionProvider>
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/firm/people/:id" element={<PersonScreen />} /></Routes>
    </MemoryRouter>
  </SessionProvider>,
);

describe('Person profile in live mode', () => {
  it('shows the API person with only the connected tabs, and no sample studio', async () => {
    open('/firm/people/P05');
    expect(await screen.findByRole('heading', { level: 1, name: 'Tara Joshi' })).toBeInTheDocument();
    expect(screen.getByText('Architect · Manager Nila Varma')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: /sections/ });
    expect([...nav.querySelectorAll('a')].map((a) => a.textContent)).toEqual(['Overview', 'Access', 'Projects', 'Rates']);
    // Logged this week and the four recent weeks.
    expect(screen.getByText('16.50')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Recent time' })).getAllByRole('row')).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Manage in Accounts' })).toBeInTheDocument();
    expect(screen.queryByText('Divya Menon')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit person' })).toBeNull();
  });

  it('shows rates to a principal', async () => {
    open('/firm/people/P05?tab=rates');
    expect(await screen.findByText('₹640')).toBeInTheDocument();
    expect(screen.getByText('₹1,600')).toBeInTheDocument();
  });

  it('lists projects with roles and account types', async () => {
    open('/firm/people/P05?tab=projects');
    expect(await screen.findByText('Harbour Pavilion')).toBeInTheDocument();
    expect(screen.getByText('Contributor')).toBeInTheDocument();
  });

  it('has no Rates tab for staff and fences their view of time and projects', async () => {
    me = ME(STAFF);
    profile = FENCED;
    open('/firm/people/P05?tab=rates');
    expect(await screen.findByRole('heading', { level: 1, name: 'Tara Joshi' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Rates' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getAllByRole('img', { name: /restricted/ })).toHaveLength(2);
    expect(screen.queryByText('₹640')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Manage in Accounts' })).toBeNull();
  });

  it('handles an unknown person', async () => {
    open('/firm/people/P99');
    expect(await screen.findByText('No one has that reference.')).toBeInTheDocument();
  });
});
