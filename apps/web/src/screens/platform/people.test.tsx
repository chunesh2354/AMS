import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const ADMIN = { id: 'adm-1', name: 'Asha Rao', email: 'asha@platform.test' };
const FIRM = { id: 'f-1', trading_name: 'Studio Meridian', legal_name: 'Meridian Design LLP', status: 'Active', currency: 'INR', timezone: 'Asia/Kolkata', created_at: '2026-01-10T05:00:00Z', people: 3, active_people: 2, last_login_at: '2026-11-07T09:30:00Z' };
const DETAIL = { ...FIRM, suspended_reason: null, owner_name: 'Tara Owner', owner_email: 'tara@meridian.test', owner_invitation_state: 'Accepted' };
const TARA = { id: 'p-1', name: 'Tara Owner', work_email: 'tara@meridian.test', job_title: 'Principal', account_types: ['principal'], invitation_state: 'Accepted', login_state: 'Enabled', last_sign_in_at: '2026-11-07T09:30:00Z' };
const NEW_HIRE = { id: 'p-2', name: 'Kiran Pending', work_email: 'kiran@meridian.test', job_title: null, account_types: ['employee', 'pm'], invitation_state: 'Sent', login_state: 'Enabled', last_sign_in_at: null };
const GONE = { id: 'p-3', name: 'Dev Gone', work_email: 'dev@meridian.test', job_title: 'Architect', account_types: ['employee'], invitation_state: 'Accepted', login_state: 'Revoked', last_sign_in_at: '2026-10-01T09:30:00Z' };
const PEOPLE = [TARA, NEW_HIRE, GONE];
const BASE = '/api/v1/platform/firms/f-1/people';

type Route = { status?: number; body: unknown };
const json = (r: Route) => new Response(JSON.stringify(r.body), { status: r.status ?? 200 });

function mockApi(overrides: Record<string, Route> = {}) {
  const routes: Record<string, Route> = {
    'GET /api/v1/platform/me': { body: ADMIN },
    'GET /api/v1/platform/firms': { body: { data: [FIRM] } },
    'GET /api/v1/platform/audit': { body: { data: [] } },
    'GET /api/v1/platform/firms/f-1': { body: DETAIL },
    [`GET ${BASE}`]: { body: { data: PEOPLE } },
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

const sent = (fn: ReturnType<typeof mockApi>, method: string, url: string) => fn.mock.calls.find(([u, init]) => u === url && init?.method === method);
const bodyOf = (fn: ReturnType<typeof mockApi>, method: string, url: string) => JSON.parse(String(sent(fn, method, url)?.[1]?.body));
const unprocessable = (message: string): Route => ({ status: 422, body: { error: { code: 'RULE', message } } });

/** Opens the platform panel and the Studio Meridian sheet, and waits for its people. */
async function openCompany() {
  vi.stubEnv('VITE_LIVE', '1');
  vi.resetModules();
  const { PlatformCompaniesScreen } = await import('./companies');
  const user = userEvent.setup();
  render(<PlatformCompaniesScreen />);
  await user.click(await screen.findByText('Studio Meridian'));
  const sheet = await screen.findByRole('dialog', { name: 'Studio Meridian' });
  await within(sheet).findByRole('region', { name: 'People' });
  await within(sheet).findByText('kiran@meridian.test');
  return { user, sheet };
}

async function choose(user: ReturnType<typeof userEvent.setup>, sheet: HTMLElement, person: string, item: string) {
  await user.click(within(sheet).getByRole('button', { name: `Actions for ${person}` }));
  await user.click(await screen.findByRole('menuitem', { name: item }));
}

async function menuItems(user: ReturnType<typeof userEvent.setup>, sheet: HTMLElement, person: string) {
  await user.click(within(sheet).getByRole('button', { name: `Actions for ${person}` }));
  const items = (await screen.findAllByRole('menuitem')).map((i) => i.textContent);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('menuitem')).not.toBeInTheDocument());
  return items;
}

describe('platform company people', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('lists the people with their account types, invitation and sign-in markers and last sign-in', async () => {
    mockApi();
    const { sheet } = await openCompany();
    const table = within(sheet).getByRole('region', { name: 'People' });
    expect(within(sheet).getByText('3 people')).toBeInTheDocument();
    const kiran = within(table).getByText('Kiran Pending').closest('tr')!;
    expect(within(kiran).getByText('kiran@meridian.test')).toBeInTheDocument();
    expect(within(kiran).getByRole('status', { name: 'Employee' })).toBeInTheDocument();
    expect(within(kiran).getByRole('status', { name: 'Project manager' })).toBeInTheDocument();
    expect(within(kiran).getByRole('status', { name: 'Invite sent' })).toBeInTheDocument();
    expect(within(kiran).getByRole('status', { name: 'Sign-in enabled' })).toBeInTheDocument();
    expect(within(kiran).getByText('Never')).toBeInTheDocument();
    const dev = within(table).getByText('Dev Gone').closest('tr')!;
    expect(within(dev).getByRole('status', { name: 'Sign-in disabled' })).toBeInTheDocument();
    const tara = within(table).getByText('tara@meridian.test').closest('tr')!;
    expect(within(tara).getByRole('status', { name: 'Principal' })).toBeInTheDocument();
    expect(within(tara).getByText(/07 Nov 2026/)).toBeInTheDocument();
  });

  it('offers only the actions that fit each person', async () => {
    mockApi();
    const { user, sheet } = await openCompany();
    expect(await menuItems(user, sheet, 'Tara Owner')).toEqual(['Reset password link', 'Change account type', 'Disable sign-in']);
    expect(await menuItems(user, sheet, 'Kiran Pending')).toEqual(['New invite link', 'Change account type', 'Disable sign-in']);
    expect(await menuItems(user, sheet, 'Dev Gone')).toEqual(['Change account type', 'Enable sign-in']);
  });

  it('offers no new invite link to someone whose sign-in is not enabled (the server refuses it)', async () => {
    const held = { ...NEW_HIRE, id: 'p-4', name: 'Lee Held', work_email: 'lee@meridian.test', login_state: 'Suspended' };
    mockApi({ [`GET ${BASE}`]: { body: { data: [...PEOPLE, held] } } });
    const { user, sheet } = await openCompany();
    expect(await menuItems(user, sheet, 'Lee Held')).toEqual(['Change account type', 'Enable sign-in']);
  });

  it('creates a one-time reset link, shows it with Copy and the email note, then returns to the company', async () => {
    const fn = mockApi({ [`POST ${BASE}/p-1/reset-link`]: { body: { reset_url: '/reset-password/rst789', expires_at: '2026-11-11T10:00:00Z', email_sent: false } } });
    const { user, sheet } = await openCompany();
    await choose(user, sheet, 'Tara Owner', 'Reset password link');
    const linkSheet = await screen.findByRole('dialog', { name: 'Reset password link' });
    expect(screen.queryByRole('dialog', { name: 'Studio Meridian' })).not.toBeInTheDocument();
    expect(within(linkSheet).getByText(/You never see or set the password/)).toBeInTheDocument();
    expect(sent(fn, 'POST', `${BASE}/p-1/reset-link`)).toBeUndefined();

    await user.click(within(linkSheet).getByRole('button', { name: 'Create reset link' }));
    const field = await within(linkSheet).findByDisplayValue(/\/reset-password\/rst789$/) as HTMLInputElement;
    expect(field).toHaveAttribute('readonly');
    expect(field.value.startsWith(window.location.origin)).toBe(true);
    expect(within(linkSheet).getByText('Email delivery is not connected.')).toBeInTheDocument();
    await user.click(within(linkSheet).getByRole('button', { name: 'Copy link' }));
    expect(await within(linkSheet).findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toMatch(/\/reset-password\/rst789$/);

    await user.click(within(linkSheet).getByRole('button', { name: 'Done' }));
    expect(await screen.findByRole('dialog', { name: 'Studio Meridian' })).toBeInTheDocument();
  });

  it('creates a new invite link for someone who has not accepted', async () => {
    const fn = mockApi({ [`POST ${BASE}/p-2/invite-link`]: { body: { invite_url: '/accept-invite/inv321', invite_expires_at: '2026-11-13T10:00:00Z', email_sent: false } } });
    const { user, sheet } = await openCompany();
    await choose(user, sheet, 'Kiran Pending', 'New invite link');
    const linkSheet = await screen.findByRole('dialog', { name: 'New invite link' });
    expect(within(linkSheet).getByText(/72 hours/)).toBeInTheDocument();
    await user.click(within(linkSheet).getByRole('button', { name: 'Create invite link' }));
    expect(await within(linkSheet).findByDisplayValue(/\/accept-invite\/inv321$/)).toBeInTheDocument();
    expect(within(linkSheet).getByLabelText('Invite link')).toHaveAttribute('readonly');
    expect(within(linkSheet).getByText('Email delivery is not connected.')).toBeInTheDocument();
    expect(sent(fn, 'POST', `${BASE}/p-2/invite-link`)).toBeDefined();
  });

  it('shows the server message when a link is refused', async () => {
    mockApi({ [`POST ${BASE}/p-1/reset-link`]: unprocessable('Only accepted accounts that can sign in get a reset link.') });
    const { user, sheet } = await openCompany();
    await choose(user, sheet, 'Tara Owner', 'Reset password link');
    const linkSheet = await screen.findByRole('dialog', { name: 'Reset password link' });
    await user.click(within(linkSheet).getByRole('button', { name: 'Create reset link' }));
    expect(await within(linkSheet).findByText('Only accepted accounts that can sign in get a reset link.')).toBeInTheDocument();
    expect(within(linkSheet).queryByRole('textbox', { name: 'Reset link' })).not.toBeInTheDocument();
  });

  it('changes the account type only with a reason, and shows the last-principal refusal from the server', async () => {
    const fn = mockApi({ [`PUT ${BASE}/p-1/types`]: unprocessable('Every company needs at least one Principal who can sign in.') });
    const { user, sheet } = await openCompany();
    await choose(user, sheet, 'Tara Owner', 'Change account type');
    const typeSheet = await screen.findByRole('dialog', { name: 'Change account type' });
    const boxes = within(typeSheet).getAllByRole('checkbox');
    expect(boxes).toHaveLength(5);
    expect(within(typeSheet).getByRole('checkbox', { name: /Principal/ })).toBeChecked();

    await user.click(within(typeSheet).getByRole('checkbox', { name: /Principal/ }));
    await user.click(within(typeSheet).getByRole('button', { name: 'Save' }));
    expect(within(typeSheet).getByText('Choose at least one account type.')).toBeInTheDocument();
    expect(within(typeSheet).getByText('Enter why the account type is changing.')).toBeInTheDocument();
    expect(sent(fn, 'PUT', `${BASE}/p-1/types`)).toBeUndefined();

    await user.click(within(typeSheet).getByRole('checkbox', { name: /Employee/ }));
    await user.click(within(typeSheet).getByRole('checkbox', { name: /Admin/ }));
    await user.type(within(typeSheet).getByLabelText('Reason'), 'Stepping back from the practice');
    await user.click(within(typeSheet).getByRole('button', { name: 'Save' }));
    expect(await within(typeSheet).findByText('Every company needs at least one Principal who can sign in.')).toBeInTheDocument();
    expect(bodyOf(fn, 'PUT', `${BASE}/p-1/types`)).toEqual({ account_types: ['admin', 'employee'], reason: 'Stepping back from the practice' });
  });

  it('saves a new account type and says so back on the company', async () => {
    const fn = mockApi({ [`PUT ${BASE}/p-2/types`]: { body: { person: { ...NEW_HIRE, account_types: ['finance'] } } } });
    const { user, sheet } = await openCompany();
    await choose(user, sheet, 'Kiran Pending', 'Change account type');
    const typeSheet = await screen.findByRole('dialog', { name: 'Change account type' });
    await user.click(within(typeSheet).getByRole('checkbox', { name: /Employee/ }));
    await user.click(within(typeSheet).getByRole('checkbox', { name: /Project manager/ }));
    await user.click(within(typeSheet).getByRole('checkbox', { name: /Finance/ }));
    await user.type(within(typeSheet).getByLabelText('Reason'), 'Moved to accounts');
    await user.click(within(typeSheet).getByRole('button', { name: 'Save' }));
    const company = await screen.findByRole('dialog', { name: 'Studio Meridian' });
    expect(await within(company).findByText('Account type for Kiran Pending saved.')).toBeInTheDocument();
    expect(bodyOf(fn, 'PUT', `${BASE}/p-2/types`)).toEqual({ account_types: ['finance'], reason: 'Moved to accounts' });
  });

  it('disables sign-in only with a reason, warns about sessions and links, and shows a refusal', async () => {
    const fn = mockApi({ [`POST ${BASE}/p-1/disable`]: unprocessable('Tara Owner is the last Principal who can sign in.') });
    const { user, sheet } = await openCompany();
    await choose(user, sheet, 'Tara Owner', 'Disable sign-in');
    const confirm = await screen.findByRole('dialog', { name: 'Disable sign-in for Tara Owner' });
    expect(within(confirm).getByText('Tara Owner is signed out everywhere.')).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Disable sign-in' }));
    expect(within(confirm).getByText('Enter why sign-in is being disabled.')).toBeInTheDocument();
    expect(sent(fn, 'POST', `${BASE}/p-1/disable`)).toBeUndefined();
    await user.type(within(confirm).getByLabelText('Reason'), 'Left the studio');
    await user.click(within(confirm).getByRole('button', { name: 'Disable sign-in' }));
    expect(await within(confirm).findByText('Tara Owner is the last Principal who can sign in.')).toBeInTheDocument();
    expect(bodyOf(fn, 'POST', `${BASE}/p-1/disable`)).toEqual({ reason: 'Left the studio' });
  });

  it('disables and enables sign-in, then reloads the people', async () => {
    const fn = mockApi({
      [`POST ${BASE}/p-2/disable`]: { body: { person: { ...NEW_HIRE, login_state: 'Revoked' } } },
      [`POST ${BASE}/p-3/enable`]: { body: { person: { ...GONE, login_state: 'Enabled' } } },
    });
    const { user, sheet } = await openCompany();
    await choose(user, sheet, 'Kiran Pending', 'Disable sign-in');
    let confirm = await screen.findByRole('dialog', { name: 'Disable sign-in for Kiran Pending' });
    await user.type(within(confirm).getByLabelText('Reason'), 'Offer withdrawn');
    await user.click(within(confirm).getByRole('button', { name: 'Disable sign-in' }));
    let company = await screen.findByRole('dialog', { name: 'Studio Meridian' });
    expect(await within(company).findByText('Kiran Pending can no longer sign in.')).toBeInTheDocument();

    await within(company).findByText('kiran@meridian.test');
    await choose(user, company, 'Dev Gone', 'Enable sign-in');
    confirm = await screen.findByRole('dialog', { name: 'Enable sign-in for Dev Gone' });
    await user.type(within(confirm).getByLabelText('Reason'), 'Rejoined');
    await user.click(within(confirm).getByRole('button', { name: 'Enable sign-in' }));
    company = await screen.findByRole('dialog', { name: 'Studio Meridian' });
    expect(await within(company).findByText('Dev Gone can sign in again.')).toBeInTheDocument();
    expect(bodyOf(fn, 'POST', `${BASE}/p-3/enable`)).toEqual({ reason: 'Rejoined' });
    expect(fn.mock.calls.filter(([u, init]) => u === BASE && (init?.method ?? 'GET') === 'GET').length).toBeGreaterThanOrEqual(3);
  });

  it('adds a person after inline checks and shows their invite link', async () => {
    const fn = mockApi({
      [`POST ${BASE}`]: { status: 201, body: { person: { ...NEW_HIRE, id: 'p-9', name: 'Meera Iyer', work_email: 'meera@meridian.test', account_types: ['pm'], invitation_state: 'Sent' }, invite_url: '/accept-invite/new999', invite_expires_at: '2026-11-13T10:00:00Z', email_sent: false } },
    });
    const { user, sheet } = await openCompany();
    await user.click(within(sheet).getByRole('button', { name: 'Add person' }));
    const add = await screen.findByRole('dialog', { name: 'Add person' });
    await user.click(within(add).getByRole('checkbox', { name: /Employee/ }));
    await user.click(within(add).getByRole('button', { name: 'Add person' }));
    expect(within(add).getByText('Enter their full name.')).toBeInTheDocument();
    expect(within(add).getByText('Enter their work email.')).toBeInTheDocument();
    expect(within(add).getByText('Choose at least one account type.')).toBeInTheDocument();
    expect(sent(fn, 'POST', BASE)).toBeUndefined();

    await user.type(within(add).getByLabelText('Full name'), ' Meera Iyer ');
    await user.type(within(add).getByLabelText('Work email'), 'meera@meridian.test');
    await user.click(within(add).getByRole('checkbox', { name: /Project manager/ }));
    await user.click(within(add).getByRole('button', { name: 'Add person' }));

    const done = await screen.findByRole('dialog', { name: 'Person added' });
    expect(await within(done).findByDisplayValue(/\/accept-invite\/new999$/)).toBeInTheDocument();
    expect(within(done).getByText('Email delivery is not connected.')).toBeInTheDocument();
    expect(within(done).getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(bodyOf(fn, 'POST', BASE)).toEqual({ name: 'Meera Iyer', work_email: 'meera@meridian.test', account_types: ['pm'] });

    await user.click(within(done).getByRole('button', { name: 'Done' }));
    const company = await screen.findByRole('dialog', { name: 'Studio Meridian' });
    expect(await within(company).findByText('Meera Iyer added to Studio Meridian.')).toBeInTheDocument();
  });

  it('sends the job title when given and shows a duplicate email against the field', async () => {
    const fn = mockApi({ [`POST ${BASE}`]: { status: 409, body: { error: { code: 'DUPLICATE_EMAIL', message: 'This email already has an account.' } } } });
    const { user, sheet } = await openCompany();
    await user.click(within(sheet).getByRole('button', { name: 'Add person' }));
    const add = await screen.findByRole('dialog', { name: 'Add person' });
    await user.type(within(add).getByLabelText('Full name'), 'Meera Iyer');
    await user.type(within(add).getByLabelText('Work email'), 'tara@meridian.test');
    await user.type(within(add).getByLabelText('Job title'), 'Architect');
    await user.click(within(add).getByRole('button', { name: 'Add person' }));
    expect(await within(add).findByText('This email already has an account.')).toBeInTheDocument();
    expect(bodyOf(fn, 'POST', BASE)).toEqual({ name: 'Meera Iyer', work_email: 'tara@meridian.test', job_title: 'Architect', account_types: ['employee'] });
  });

  it('shows the error and a retry when the people cannot load, and keeps the rest of the company', async () => {
    vi.stubEnv('VITE_LIVE', '1');
    vi.resetModules();
    mockApi({ [`GET ${BASE}`]: { status: 500, body: { error: { code: 'INTERNAL', message: 'Something went wrong on our side.' } } } });
    const { PlatformCompaniesScreen } = await import('./companies');
    const user = userEvent.setup();
    render(<PlatformCompaniesScreen />);
    await user.click(await screen.findByText('Studio Meridian'));
    const sheet = await screen.findByRole('dialog', { name: 'Studio Meridian' });
    expect(await within(sheet).findByText('Something went wrong on our side.')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(within(sheet).getByText('Tara Owner')).toBeInTheDocument();
  });

  it('describes the people actions in the platform activity', async () => {
    vi.resetModules();
    const { describeAction } = await import('./companies');
    expect(describeAction({ action: 'issue_reset_link', firm_name: 'Studio Meridian' })).toBe('Created a password reset link at Studio Meridian');
    expect(describeAction({ action: 'disable', firm_name: 'Studio Meridian' })).toBe('Disabled sign-in for a person at Studio Meridian');
    expect(describeAction({ action: 'some_new_thing', firm_name: 'Studio Meridian' })).toBe('Some new thing: Studio Meridian');
  });
});
