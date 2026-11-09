import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SessionProvider } from '../../../app/session';
import { OverlaysProvider } from '../../../app/overlays';
import { ToastProvider } from '../../../ui/Toast';
import { ProjectTeamPanel } from './staffing';
import { ProjectBillingScreen } from './billing';
import { nextLevel } from './billing-authorize';

// Live mode: the project team (Staffing tab) and fee authorization (Billing tab).
vi.mock('../../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../api/live')>()), isLive: true }));

type Reply = { status: number; body: unknown } | undefined;
let handler: (url: string, init: RequestInit) => Reply;
const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const r = handler(String(input), init) ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
});
const m = (amount: string) => ({ amount, currency: 'INR' });
const list = (data: unknown[]) => ({ status: 200, body: { data, page: 1, page_size: 200, total: data.length, complete: true, missing_count: 0 } });
const isGet = (init: RequestInit) => (init.method ?? 'GET') === 'GET';
const calls = (method: string, pattern: RegExp) => fetchMock.mock.calls.filter(([u, i]) => pattern.test(String(u)) && ((i as RequestInit | undefined)?.method ?? 'GET') === method);

const ME = (caps: Record<string, string>, led: string[] = ['prj-uuid'], sets = ['pm']) => ({
  person: { id: 'u-pm', ref_code: 'Q02', name: 'Nila Varma', work_email: 'nila@firm.test', job_title: 'Project lead', manager_id: null },
  firm: { id: 'f', trading_name: 'Test Studio', legal_name: 'x', currency: 'INR', timezone: 'Asia/Kolkata', accounting_adapter: 'mock' },
  permission_sets: sets, capabilities: caps, led_projects: led, member_projects: led,
});
let me = ME({ 'projects.plan': 'scoped', 'billing.prepare': 'scoped' });

const PROJECT = {
  id: 'prj-uuid', code: 'LV-77', name: 'Harbour Pavilion', client: 'Port Trust', client_id: 'c1', status: 'Active', hold_reason: null, contract: null,
  pm: { id: 'u-pm', ref_code: 'Q02', name: 'Nila Varma' }, hours: { budget: '0.00', actual: '0.00', forecast: '0.00' }, delivery_progress_pct: 0,
  entitlement: { contracted: m('1000000.00'), entitled: m('0.00'), drafted: m('0.00'), invoiced: m('0.00'), collected: m('0.00') },
  contribution: { restricted: true }, phases: [],
};
const member = (id: string, ref: string, name: string, role: string) => ({ person: { id, ref_code: ref, name, job_title: 'Architect' }, role, is_pm: role === 'pm' });
const PEOPLE = [
  { id: 'u-pm', ref_code: 'Q02', name: 'Nila Varma', job_title: 'Project lead', manager_id: null, employment_state: 'Active', login_state: 'Enabled' },
  { id: 'u-ines', ref_code: 'Q07', name: 'Ines Kuruvilla', job_title: 'Architect', manager_id: null, employment_state: 'Active', login_state: 'Enabled' },
  { id: 'u-tomas', ref_code: 'Q09', name: 'Tomas Pereira', job_title: 'Designer', manager_id: null, employment_state: 'Active', login_state: 'Enabled' },
];

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  me = ME({ 'projects.plan': 'scoped', 'billing.prepare': 'scoped' });
});
afterEach(() => vi.unstubAllGlobals());

function open(path: string, element: ReactElement, route: string) {
  render(
    <SessionProvider>
      <ToastProvider>
        <OverlaysProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes><Route path={route} element={element} /></Routes>
          </MemoryRouter>
        </OverlaysProvider>
      </ToastProvider>
    </SessionProvider>,
  );
}

describe('project team in live mode', () => {
  const teamServer = (members: unknown[]) => (url: string, init: RequestInit): Reply => {
    if (url.endsWith('/me')) return { status: 200, body: me };
    if (url.endsWith('/projects/LV-77') && isGet(init)) return { status: 200, body: PROJECT };
    if (url.endsWith('/people')) return list(PEOPLE);
    if (url.endsWith('/projects/LV-77/members') && isGet(init)) return list(members);
    if (url.endsWith('/projects/LV-77/members') && init.method === 'POST') {
      return { status: 200, body: { members: [...members, member('u-ines', 'Q07', 'Ines Kuruvilla', JSON.parse(String(init.body)).role)], audit_event_id: 'e' } };
    }
    if (url.endsWith('/projects/LV-77/members/u-tomas') && init.method === 'DELETE') return { status: 200, body: { members: members.slice(0, 1), audit_event_id: 'e' } };
    return undefined;
  };

  it('the PM adds a person with a role and removes another; the PM row cannot be removed', async () => {
    handler = teamServer([member('u-pm', 'Q02', 'Nila Varma', 'pm'), member('u-tomas', 'Q09', 'Tomas Pereira', 'contributor')]);
    open('/firm/projects/LV-77/staffing', <ProjectTeamPanel code="LV-77" />, '/firm/projects/:id/staffing');
    const team = await screen.findByRole('region', { name: 'Team' });
    expect(await within(team).findByText('Tomas Pereira')).toBeInTheDocument();
    expect(within(team).getByText('Stays on the team')).toBeInTheDocument();
    expect(within(team).queryByRole('button', { name: 'Remove Nila Varma' })).toBeNull();

    const box = await screen.findByRole('combobox', { name: 'Add a person' });
    await userEvent.click(box);
    await userEvent.type(box, 'Ines');
    await userEvent.click(await screen.findByRole('option', { name: /Ines Kuruvilla/ }));
    await userEvent.click(screen.getByRole('combobox', { name: 'Role' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Lead' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add to team' }));
    expect(await within(team).findByText('Ines Kuruvilla')).toBeInTheDocument();
    expect(JSON.parse(String((calls('POST', /\/members$/)[0]![1] as RequestInit).body))).toEqual({ person_id: 'u-ines', role: 'lead' });

    await userEvent.click(within(team).getByRole('button', { name: 'Remove Tomas Pereira' }));
    await waitFor(() => expect(within(team).queryByText('Tomas Pereira')).toBeNull());
    expect(calls('DELETE', /\/members\/u-tomas$/)).toHaveLength(1);
  });

  it('shows the team without controls to someone who cannot plan the project', async () => {
    me = ME({ 'projects.plan': 'own' }, [], ['staff']);
    handler = teamServer([member('u-pm', 'Q02', 'Nila Varma', 'pm')]);
    open('/firm/projects/LV-77/staffing', <ProjectTeamPanel code="LV-77" />, '/firm/projects/:id/staffing');
    const team = await screen.findByRole('region', { name: 'Team' });
    expect(await within(team).findByText('Nila Varma')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to team' })).toBeNull();
    expect(screen.queryByText('Stays on the team')).toBeNull();
  });

  it('shows a server refusal when adding fails', async () => {
    const base = teamServer([member('u-pm', 'Q02', 'Nila Varma', 'pm')]);
    handler = (url, init) => (url.endsWith('/members') && init.method === 'POST'
      ? { status: 403, body: { error: { code: 'FORBIDDEN_CAPABILITY', message: 'You need projects.plan for this.' } } } : base(url, init));
    open('/firm/projects/LV-77/staffing', <ProjectTeamPanel code="LV-77" />, '/firm/projects/:id/staffing');
    const box = await screen.findByRole('combobox', { name: 'Add a person' });
    await userEvent.click(box);
    await userEvent.type(box, 'Tomas');
    await userEvent.click(await screen.findByRole('option', { name: /Tomas Pereira/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Add to team' }));
    expect(await screen.findByText('You need projects.plan for this.')).toBeInTheDocument();
  });
});

describe('fee authorization on the Billing tab', () => {
  const PLAN = (canAuthorize: boolean, pct = 0) => ({
    project: { id: 'prj-uuid', code: 'LV-77', name: 'Harbour Pavilion' }, can_authorize: canAuthorize,
    components: [{ id: 'fc', name: 'Design services', billing_method: 'fixed_percent' }],
    phases: [
      { phase_id: 'ph-cd', code: 'CD', name: 'Concept design', component: 'Design services', billing_method: 'fixed_percent', fee: m('400000.00'), fixed: true, authorized_percent: pct, authorizations: [] },
      { phase_id: 'ph-sd', code: 'SD', name: 'Schematic design', component: 'Design services', billing_method: 'fixed_percent', fee: m('600000.00'), fixed: true, authorized_percent: 0, authorizations: [] },
    ],
    milestones: [],
  });
  const READY_ITEM = { id: 'fixed_progress:a1', project: { id: 'prj-uuid', code: 'LV-77', name: 'Harbour Pavilion' }, component: 'Design services', billing_method: 'fixed_percent', phase: 'Concept design',
    line_type: 'fixed_progress', label: 'Fixed fee claim, Concept design', basis: {}, previous_net_billing: m('0.00'), current_claim: m('160000.00'), remaining_entitlement: m('240000.00'), status: 'Eligible' };
  const ready = (items: unknown[]) => ({ status: 200, body: { data: items, page: 1, page_size: 200, total: m('0.00'), count: items.length, complete: true, missing_count: 0, exceptions: [], missing: [] } });

  it('a principal authorizes 40% of a phase and sees it become ready to bill', async () => {
    me = ME({ 'billing.prepare': 'firm', 'changes.authorize': 'firm', 'billing.approve': 'firm' }, [], ['principal']);
    let authorized = false;
    handler = (url, init) => {
      if (url.endsWith('/me')) return { status: 200, body: me };
      if (url.endsWith('/projects/LV-77') && isGet(init)) return { status: 200, body: PROJECT };
      if (url.endsWith('/projects/LV-77/fee-authorizations') && isGet(init)) return { status: 200, body: PLAN(true, authorized ? 40 : 0) };
      if (url.endsWith('/projects/LV-77/fee-authorizations') && init.method === 'POST') { authorized = true; return { status: 200, body: { id: 'fa', cumulative_percent: 40, previous_percent: 0, audit_event_id: 'e' } }; }
      if (url.endsWith('/billing/ready?project=LV-77')) return ready(authorized ? [READY_ITEM] : []);
      if (url.endsWith('/billing/drafts?project=LV-77')) return list([]);
      return undefined;
    };
    open('/firm/projects/LV-77/billing', <ProjectBillingScreen />, '/firm/projects/:id/billing');
    const panel = await screen.findByRole('region', { name: 'Authorize fee for billing' });
    const field = await within(panel).findByLabelText('New level for Concept design');
    await userEvent.type(field, '40');
    expect(within(panel).getByText('Entitlement rises by ₹1,60,000')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Authorize 40% of Concept design' }));
    expect(JSON.parse(String((calls('POST', /fee-authorizations$/)[0]![1] as RequestInit).body))).toEqual({ phase_id: 'ph-cd', cumulative_percent: 40 });
    const readyTable = screen.getByRole('region', { name: 'Ready to bill' });
    expect(await within(readyTable).findByText('Fixed fee claim, Concept design')).toBeInTheDocument();
    expect(within(readyTable).getAllByText('₹1,60,000').length).toBeGreaterThan(0);
    expect(await screen.findByText('Authorized 40% of Concept design. It is in Ready to bill.')).toBeInTheDocument();
  });

  it('refuses a level at or below the current one before calling the server', async () => {
    expect(nextLevel('40', 40)).toBeNull();
    expect(nextLevel('101', 0)).toBeNull();
    expect(nextLevel('12.345', 0)).toBeNull();
    expect(nextLevel('', 0)).toBeNull();
    expect(nextLevel('60', 40)).toBe(60);
  });

  it('accepts every two-decimal level, including those floating point cannot multiply by 100 exactly', () => {
    for (const v of ['0.07', '0.29', '1.1', '1.15', '33.33', '57.7', '99.99']) expect(nextLevel(v, 0), v).toBe(Number(v));
    expect(nextLevel('33.333', 0)).toBeNull();
  });

  it('a PM sees authorized levels but cannot authorize', async () => {
    handler = (url, init) => {
      if (url.endsWith('/me')) return { status: 200, body: me };
      if (url.endsWith('/projects/LV-77') && isGet(init)) return { status: 200, body: PROJECT };
      if (url.endsWith('/projects/LV-77/fee-authorizations')) return { status: 200, body: PLAN(false, 40) };
      if (url.endsWith('/billing/ready?project=LV-77')) return ready([READY_ITEM]);
      if (url.endsWith('/billing/drafts?project=LV-77')) return list([]);
      return undefined;
    };
    open('/firm/projects/LV-77/billing', <ProjectBillingScreen />, '/firm/projects/:id/billing');
    const panel = await screen.findByRole('region', { name: 'Authorize fee for billing' });
    expect(await within(panel).findByText('Concept design')).toBeInTheDocument();
    expect(within(panel).getByText('A principal authorizes progress and milestones.')).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: /Authorize/ })).toBeNull();
    // The PM leads this project, so its money is shown, as the server shows it.
    expect(await within(screen.getByRole('region', { name: 'Ready to bill' })).findAllByText('₹1,60,000')).not.toHaveLength(0);
  });

  it('hides money from a viewer whose billing.prepare does not reach this project', async () => {
    me = ME({ 'billing.prepare': 'scoped', 'projects.plan': 'view' }, ['some-other-project']);
    handler = (url, init) => {
      if (url.endsWith('/me')) return { status: 200, body: me };
      if (url.endsWith('/projects/LV-77') && isGet(init)) return { status: 200, body: PROJECT };
      if (url.endsWith('/projects/LV-77/fee-authorizations')) return { status: 200, body: PLAN(false, 40) };
      if (url.endsWith('/billing/ready?project=LV-77')) return ready([READY_ITEM]);
      if (url.endsWith('/billing/drafts?project=LV-77')) return list([]);
      return undefined;
    };
    open('/firm/projects/LV-77/billing', <ProjectBillingScreen />, '/firm/projects/:id/billing');
    const readyTable = await screen.findByRole('region', { name: 'Ready to bill' });
    expect(await within(readyTable).findByText('Fixed fee claim, Concept design')).toBeInTheDocument();
    expect(screen.queryByText('₹1,60,000')).toBeNull();
    expect(screen.queryByText(/₹4,00,000/)).toBeNull();
  });
});
