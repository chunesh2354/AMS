import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

async function openLive(login: Response) {
  vi.stubEnv('VITE_LIVE', '1');
  vi.resetModules();
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/v1/platform/me') return reply(401, { error: { code: 'UNAUTHENTICATED', message: 'Sign in' } });
    if (url === '/api/v1/platform/auth/login' && init?.method === 'POST') return login;
    return reply(404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
  });
  vi.stubGlobal('fetch', fetchFn);
  const { PlatformLoginScreen } = await import('./login');
  render(<MemoryRouter><PlatformLoginScreen /></MemoryRouter>);
  return fetchFn;
}

describe('platform admin sign-in', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('uses the platform login and shows the error alert on a 401', async () => {
    const fetchFn = await openLive(reply(401, { error: { code: 'INVALID_CREDENTIALS', message: 'No' } }));
    expect(screen.getByRole('heading', { level: 1, name: 'Platform admin' })).toBeInTheDocument();
    expect(screen.getByText('Sessions end after 12 hours.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Platform time \d\d:\d\d$/ })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Work email'), 'admin@platform.demo');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("That email and password don't match. Check both and try again.");
    const sent = fetchFn.mock.calls.find(([url]) => url === '/api/v1/platform/auth/login');
    expect(JSON.parse(String(sent?.[1]?.body))).toEqual({ email: 'admin@platform.demo', password: 'wrong' });
  });

  it('links to the studio and team doors', async () => {
    await openLive(reply(200, { ok: true }));
    expect(screen.getByRole('link', { name: /Studio principal sign-in/ })).toHaveAttribute('href', '/login/studio');
    expect(screen.getByRole('link', { name: /Team member sign-in/ })).toHaveAttribute('href', '/login/team');
  });

  it('shows only the start-the-API note in mock mode', async () => {
    vi.stubEnv('VITE_LIVE', '');
    vi.resetModules();
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);
    const { PlatformLoginScreen } = await import('./login');
    render(<MemoryRouter><PlatformLoginScreen /></MemoryRouter>);
    expect(screen.getByText('Start the API to use the platform panel.')).toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
