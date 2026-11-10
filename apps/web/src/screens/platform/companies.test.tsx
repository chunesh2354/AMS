import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const ADMIN = { id: 'adm-1', name: 'Asha Rao', email: 'asha@platform.test' };
const FIRMS = [
  { id: 'f-1', trading_name: 'Studio Meridian', legal_name: 'Meridian Design LLP', status: 'Active', currency: 'INR', timezone: 'Asia/Kolkata', created_at: '2026-01-10T05:00:00Z', people: 18, active_people: 16, last_login_at: '2026-11-07T09:30:00Z' },
  { id: 'f-2', trading_name: 'Northline Architects', legal_name: 'Northline Pvt Ltd', status: 'Suspended', currency: 'INR', timezone: 'Asia/Kolkata', created_at: '2026-03-02T05:00:00Z', people: 4, active_people: 0, last_login_at: null },
];
const AUDIT = [{ id: 'a-1', at: '2026-11-07T10:00:00Z', admin_name: 'Asha Rao', action: 'Suspended company', firm_id: 'f-2', firm_name: 'Northline Architects', reason: 'Unpaid subscription' }];

type Route = { status?: number; body: unknown };
const json = (r: Route) => new Response(JSON.stringify(r.body), { status: r.status ?? 200 });

/** Routes fetch by method and path. Returns the mock so tests can assert what was sent. */
function mockApi(overrides: Record<string, Route> = {}) {
  const routes: Record<string, Route> = {
    'GET /api/v1/platform/me': { body: ADMIN },
    'GET /api/v1/platform/firms': { body: { data: FIRMS } },
    'GET /api/v1/platform/audit': { body: { data: AUDIT } },
    ...overrides,
  };
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    const route = routes[key];
    if (!route) return json({ status: 404, body: { error: { code: 'NOT_FOUND', message: `No mock for ${key}` } } });
    return json(route);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

async function openLive() {
  vi.stubEnv('VITE_LIVE', '1');
  vi.resetModules();
  const { PlatformCompaniesScreen } = await import('./companies');
  render(<PlatformCompaniesScreen />);
}

describe('platform companies panel', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('shows only the start-the-API empty state in mock mode, with no companies', async () => {
    vi.stubEnv('VITE_LIVE', '');
    vi.resetModules();
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);
    const { PlatformCompaniesScreen } = await import('./companies');
    render(<PlatformCompaniesScreen />);
    expect(screen.getByText('Start the API to use the platform panel.')).toBeInTheDocument();
    expect(screen.queryByText('Studio Meridian')).not.toBeInTheDocument();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('lists companies with counts only and the platform activity', async () => {
    mockApi();
    await openLive();
    expect(await screen.findByText('Northline Architects', { selector: 'div' })).toBeInTheDocument();
    expect(screen.getByText('Studio Meridian')).toBeInTheDocument();
    expect(screen.getByText('2 companies')).toBeInTheDocument();
    expect(screen.getByText('Platform admin')).toBeInTheDocument();
    expect(await screen.findByText(/Unpaid subscription/)).toBeInTheDocument();
  });

  it('validates the new company inline, then shows the invite link and the email note', async () => {
    const fetchFn = mockApi({
      'POST /api/v1/platform/firms': { status: 201, body: { firm_id: 'f-3', invite_url: '/accept-invite/tok123', invite_expires_at: '2026-11-11T10:00:00Z', email_sent: false } },
    });
    const user = userEvent.setup();
    await openLive();
    await screen.findByText('Studio Meridian');
    await user.click(screen.getByRole('button', { name: 'Add company' }));
    const sheet = await screen.findByRole('dialog');
    await user.click(within(sheet).getByRole('button', { name: 'Create company' }));
    expect(within(sheet).getByText('Enter the trading name.')).toBeInTheDocument();
    expect(within(sheet).getByText("Enter the owner's email.")).toBeInTheDocument();
    expect(fetchFn.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);

    await user.type(within(sheet).getByLabelText('Trading name'), 'Kiln Studio');
    await user.type(within(sheet).getByLabelText('Legal name'), 'Kiln Studio LLP');
    await user.type(within(sheet).getByLabelText('Owner name'), 'Meera Iyer');
    await user.type(within(sheet).getByLabelText('Owner email'), 'not-an-email');
    await user.click(within(sheet).getByRole('button', { name: 'Create company' }));
    expect(within(sheet).getByText('Enter a valid email address.')).toBeInTheDocument();

    await user.clear(within(sheet).getByLabelText('Owner email'));
    await user.type(within(sheet).getByLabelText('Owner email'), 'meera@kiln.test');
    await user.click(within(sheet).getByRole('button', { name: 'Create company' }));

    expect(await within(sheet).findByDisplayValue(/\/accept-invite\/tok123$/)).toBeInTheDocument();
    expect(within(sheet).getByText('Email delivery is not connected.')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    const post = fetchFn.mock.calls.find(([url, init]) => url === '/api/v1/platform/firms' && init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      trading_name: 'Kiln Studio', legal_name: 'Kiln Studio LLP', timezone: 'Asia/Kolkata', currency: 'INR', owner_name: 'Meera Iyer', owner_email: 'meera@kiln.test',
    });
  });

  it('will not suspend a company without a reason, and warns that everyone is signed out', async () => {
    const fetchFn = mockApi({ 'POST /api/v1/platform/firms/f-1/suspend': { body: { ok: true } } });
    const user = userEvent.setup();
    await openLive();
    await screen.findByText('Studio Meridian');
    await user.click(screen.getByRole('button', { name: 'Actions for Studio Meridian' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Suspend' }));
    const sheet = await screen.findByRole('dialog', { name: 'Suspend Studio Meridian' });
    expect(within(sheet).getByText('Every user in this company is signed out.')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Suspend company' }));
    expect(within(sheet).getByText('Enter why this company is being suspended.')).toBeInTheDocument();
    expect(fetchFn.mock.calls.some(([url]) => String(url).endsWith('/suspend'))).toBe(false);

    await user.type(within(sheet).getByLabelText('Reason'), 'Unpaid subscription');
    await user.click(within(sheet).getByRole('button', { name: 'Suspend company' }));
    await waitFor(() => expect(fetchFn.mock.calls.some(([url]) => String(url).endsWith('/f-1/suspend'))).toBe(true));
    expect(await screen.findByText('Studio Meridian is suspended.')).toBeInTheDocument();
  });

  it('shows the server error when companies cannot load, and when creating fails', async () => {
    mockApi({
      'GET /api/v1/platform/firms': { status: 500, body: { error: { code: 'INTERNAL', message: 'Something went wrong on our side.' } } },
    });
    await openLive();
    expect(await screen.findByText('Something went wrong on our side.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('opens a company from its row: counts and the owner only, and a new invite link that copies', async () => {
    const fetchFn = mockApi({
      'GET /api/v1/platform/firms/f-1': { body: { ...FIRMS[0], suspended_reason: null, owner_name: 'Tara Owner', owner_email: 'tara@meridian.test', owner_invitation_state: 'Expired' } },
      'POST /api/v1/platform/firms/f-1/owner-invite': { body: { invite_url: '/accept-invite/newtok456', invite_expires_at: '2026-11-11T10:00:00Z', email_sent: false } },
    });
    const user = userEvent.setup();
    await openLive();
    await user.click(await screen.findByText('Studio Meridian'));
    const sheet = await screen.findByRole('dialog', { name: 'Studio Meridian' });
    expect(await within(sheet).findByText('Meridian Design LLP')).toBeInTheDocument();
    expect(within(sheet).getByText('Tara Owner')).toBeInTheDocument();
    expect(within(sheet).getByText('tara@meridian.test')).toBeInTheDocument();
    expect(within(sheet).getByRole('status', { name: 'Invite expired' })).toBeInTheDocument();
    expect(within(sheet).getByText('Asia/Kolkata')).toBeInTheDocument();
    expect(within(sheet).getByText('18')).toBeInTheDocument();
    expect(within(sheet).getByText('16')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Suspend' })).toBeInTheDocument();

    await user.click(within(sheet).getByRole('button', { name: 'New invite link' }));
    expect(await within(sheet).findByDisplayValue(/\/accept-invite\/newtok456$/)).toBeInTheDocument();
    expect(fetchFn.mock.calls.some(([url, init]) => url === '/api/v1/platform/firms/f-1/owner-invite' && init?.method === 'POST')).toBe(true);
    await user.click(within(sheet).getByRole('button', { name: 'Copy link' }));
    expect(await within(sheet).findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toMatch(/\/accept-invite\/newtok456$/);
  });

  it('opens a company from the keyboard, and the row menu still works without opening it', async () => {
    mockApi({
      'GET /api/v1/platform/firms/f-2': { body: { ...FIRMS[1], suspended_reason: 'Unpaid subscription', owner_name: 'Ravi Owner', owner_email: 'ravi@northline.test', owner_invitation_state: 'Accepted' } },
    });
    const user = userEvent.setup();
    await openLive();
    await screen.findByText('Studio Meridian');
    await user.click(screen.getByRole('button', { name: 'Actions for Studio Meridian' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Suspend' }));
    expect(await screen.findByRole('dialog', { name: 'Suspend Studio Meridian' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Studio Meridian' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Suspend Studio Meridian' })).not.toBeInTheDocument());

    const row = screen.getByText('Northline Architects', { selector: 'div' }).closest('tr')!;
    row.focus();
    await user.keyboard('{Enter}');
    const sheet = await screen.findByRole('dialog', { name: 'Northline Architects' });
    expect(await within(sheet).findByText('Unpaid subscription')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
    // Accepted: no new invite to send.
    expect(within(sheet).queryByRole('button', { name: 'New invite link' })).not.toBeInTheDocument();
  });

  it('shows a clear message and selects the link when the browser blocks copying', async () => {
    mockApi({
      'POST /api/v1/platform/firms': { body: { firm_id: 'f-3', invite_url: '/accept-invite/tok123', invite_expires_at: '2026-11-11T10:00:00Z', email_sent: false } },
    });
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('blocked')) }, configurable: true });
    Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true, writable: true });
    await openLive();
    await screen.findByText('Studio Meridian');
    await user.click(screen.getByRole('button', { name: 'Add company' }));
    const sheet = await screen.findByRole('dialog');
    await user.type(within(sheet).getByLabelText('Trading name'), 'Kiln Studio');
    await user.type(within(sheet).getByLabelText('Legal name'), 'Kiln Studio LLP');
    await user.type(within(sheet).getByLabelText('Owner name'), 'Meera Iyer');
    await user.type(within(sheet).getByLabelText('Owner email'), 'meera@kiln.test');
    await user.click(within(sheet).getByRole('button', { name: 'Create company' }));
    const field = await within(sheet).findByDisplayValue(/\/accept-invite\/tok123$/) as HTMLInputElement;
    await user.click(within(sheet).getByRole('button', { name: 'Copy link' }));
    expect(await within(sheet).findByText('Copy blocked by the browser. The link is selected; press Ctrl+C.')).toBeInTheDocument();
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length]);
    Reflect.deleteProperty(document, 'execCommand');
  });

  it('shows the legal name in the table only when it differs, and the activity in plain words', async () => {
    mockApi({
      'GET /api/v1/platform/firms': { body: { data: [{ ...FIRMS[0], legal_name: 'Studio Meridian' }, FIRMS[1]] } },
      'GET /api/v1/platform/audit': { body: { data: [
        { id: 'a-1', at: '2026-11-07T10:00:00Z', admin_name: 'Asha Rao', action: 'suspend_firm', firm_id: 'f-2', firm_name: 'Northline Architects', reason: 'Unpaid subscription' },
        { id: 'a-2', at: '2026-11-07T09:00:00Z', admin_name: 'Asha Rao', action: 'reissue_owner_invite', firm_id: 'f-1', firm_name: 'Studio Meridian', reason: null },
        { id: 'a-3', at: '2026-11-07T08:00:00Z', admin_name: 'Asha Rao', action: 'create_firm', firm_id: 'f-1', firm_name: 'Studio Meridian', reason: null },
        { id: 'a-4', at: '2026-11-07T07:00:00Z', admin_name: 'Asha Rao', action: 'login', firm_id: null, firm_name: null, reason: null },
        { id: 'a-5', at: '2026-11-07T06:00:00Z', admin_name: 'Asha Rao', action: 'reactivate_firm', firm_id: 'f-2', firm_name: 'Northline Architects', reason: 'Paid' },
      ] } },
    });
    await openLive();
    await screen.findByText('Northline Pvt Ltd');
    expect(screen.getAllByText('Studio Meridian')).toHaveLength(1);
    expect(await screen.findByText('Suspended Northline Architects - Unpaid subscription')).toBeInTheDocument();
    expect(screen.getByText('Sent a new owner invite for Studio Meridian')).toBeInTheDocument();
    expect(screen.getByText('Added Studio Meridian')).toBeInTheDocument();
    expect(screen.getByText('Signed in')).toBeInTheDocument();
    expect(screen.getByText('Reactivated Northline Architects - Paid')).toBeInTheDocument();
  });

  it('shows a duplicate owner email against the field', async () => {
    mockApi({
      'POST /api/v1/platform/firms': { status: 409, body: { error: { code: 'DUPLICATE_EMAIL', message: 'This email already has an account.' } } },
    });
    const user = userEvent.setup();
    await openLive();
    await screen.findByText('Studio Meridian');
    await user.click(screen.getByRole('button', { name: 'Add company' }));
    const sheet = await screen.findByRole('dialog');
    await user.type(within(sheet).getByLabelText('Trading name'), 'Kiln Studio');
    await user.type(within(sheet).getByLabelText('Legal name'), 'Kiln Studio LLP');
    await user.type(within(sheet).getByLabelText('Owner name'), 'Meera Iyer');
    await user.type(within(sheet).getByLabelText('Owner email'), 'p01@meridian.demo');
    await user.click(within(sheet).getByRole('button', { name: 'Create company' }));
    expect(await within(sheet).findByText('This email already has an account.')).toBeInTheDocument();
  });
});
