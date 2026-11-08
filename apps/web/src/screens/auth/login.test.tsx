import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { LoginScreen, StudioLoginScreen, TeamLoginScreen, homeFor } from './login';
import { BAD_CREDENTIALS } from './sign-in-form';
import { FORGOT_PASSWORD_HREF } from './frame';

vi.mock('../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/live')>()), isLive: true }));

type Reply = { status: number; body: unknown };
let replies: Record<string, Reply>;
const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const r = replies[`${init.method ?? 'GET'} ${String(input)}`] ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
});
const SIGNED_OUT: Reply = { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'Sign in' } } };

beforeEach(() => {
  replies = { 'GET /api/v1/me': SIGNED_OUT };
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  // apiFetch leaves a sign-in page alone on a 401, as the real page would be.
  window.history.pushState({}, '', '/login/studio');
});
afterEach(() => vi.unstubAllGlobals());

const open = (el: ReactElement) => render(<MemoryRouter>{el}</MemoryRouter>);

describe('sign-in chooser (/login)', () => {
  it('offers the three doors and the invite hint', () => {
    open(<LoginScreen />);
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in to your studio.' })).toBeInTheDocument();
    const doors = within(screen.getByRole('navigation', { name: 'Sign-in options' }));
    expect(doors.getByRole('link', { name: /^Studio principal/ })).toHaveAttribute('href', '/login/studio');
    expect(doors.getByRole('link', { name: /^Team member/ })).toHaveAttribute('href', '/login/team');
    expect(doors.getByRole('link', { name: /^Platform admin/ })).toHaveAttribute('href', '/platform/login');
    expect(doors.getByText('Got an invite? Open your invite link to set a password.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Help' })).toHaveAttribute('href', 'mailto:support@csdv.in');
  });
});

describe('studio principal sign-in (/login/studio)', () => {
  it('checks the fields before calling the server', async () => {
    open(<StudioLoginScreen />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter your work email.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Work email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Work email')).toHaveFocus();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('shows and hides the password with a pressed toggle', async () => {
    open(<StudioLoginScreen />);
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('has Keep me signed in on by default, a Forgot password link and the other doors', () => {
    open(<StudioLoginScreen />);
    expect(screen.getByRole('heading', { level: 1, name: 'Studio principal' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Keep me signed in' })).toBeChecked();
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', FORGOT_PASSWORD_HREF);
    expect(FORGOT_PASSWORD_HREF).toMatch(/^mailto:support@csdv\.in/);
    expect(screen.getByRole('link', { name: /Team member sign-in/ })).toHaveAttribute('href', '/login/team');
    expect(screen.getByRole('link', { name: /Platform admin sign-in/ })).toHaveAttribute('href', '/platform/login');
    expect(screen.getByRole('link', { name: /All sign-in options/ })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('img', { name: /^Studio time \d\d:\d\d$/ })).toBeInTheDocument();
  });

  it('shows the error alert when the email and password do not match', async () => {
    replies['POST /api/v1/auth/login'] = { status: 401, body: { error: { code: 'INVALID_CREDENTIALS', message: 'That email and password do not match.' } } };
    open(<StudioLoginScreen />);
    await userEvent.type(screen.getByLabelText('Work email'), 'p04@meridian.demo');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(BAD_CREDENTIALS);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('sends the same login as before, then reads /me to choose the landing page', async () => {
    replies['POST /api/v1/auth/login'] = { status: 200, body: { ok: true } };
    open(<StudioLoginScreen />);
    await userEvent.type(screen.getByLabelText('Work email'), ' p01@meridian.demo ');
    await userEvent.type(screen.getByLabelText('Password'), 'meridian-demo-2026');
    replies['GET /api/v1/me'] = { status: 200, body: { permission_sets: ['principal'] } };
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/api/v1/me').length).toBeGreaterThanOrEqual(2));
    const login = fetchMock.mock.calls.find(([url, init]) => url === '/api/v1/auth/login' && init?.method === 'POST');
    expect(JSON.parse(String(login?.[1]?.body))).toEqual({ email: 'p01@meridian.demo', password: 'meridian-demo-2026' });
  });
});

describe('team member sign-in (/login/team)', () => {
  it('is the same form with team copy and links to the other ways in', () => {
    open(<TeamLoginScreen />);
    expect(screen.getByRole('heading', { level: 1, name: 'Team member' })).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Team member sign in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Work email')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByRole('link', { name: /Studio principal sign-in/ })).toHaveAttribute('href', '/login/studio');
    expect(screen.getByText('First time here?')).toBeInTheDocument();
  });
});

describe('landing page after sign-in', () => {
  it('sends staff to their day and anyone with firm rights to the overview', () => {
    expect(homeFor({ permission_sets: ['staff'] })).toBe('/me/home');
    expect(homeFor({ permission_sets: ['staff', 'pm'] })).toBe('/firm/overview');
    expect(homeFor({ permission_sets: ['principal'] })).toBe('/firm/overview');
  });
});
