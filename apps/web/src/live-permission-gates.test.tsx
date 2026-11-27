import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { routes } from './router';
import { SessionProvider } from './app/session';
import { ToastProvider } from './ui/Toast';

// A VITE_LIVE=1 build. Buttons a role cannot use must not be offered (found in docs/ux-button-sweep.md):
// a PM saw Create project (sheet stuck on "Loading clients") and Settings (a permission page), and the
// Settings entry of a principal opened "Not available yet" instead of a working section.
vi.mock('./api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('./api/live')>()), isLive: true }));

const FIRM = { id: 'f1', trading_name: 'Harbour Works', legal_name: 'Harbour Works LLP', currency: 'INR', timezone: 'Asia/Kolkata', accounting_adapter: 'mock' };
const PRINCIPAL = {
  person: { id: 'u-1', ref_code: 'P01', name: 'Mira Kapoor', work_email: 'mira@harbour.test', job_title: 'Partner', manager_id: null },
  firm: FIRM, permission_sets: ['principal'],
  capabilities: { 'projects.view': 'firm', 'projects.create': 'firm', 'settings.manage': 'firm', 'accounts.manage': 'firm', 'rates.bill.manage': 'firm' },
  led_projects: [], member_projects: [],
};
const PM = {
  person: { id: 'u-2', ref_code: 'P02', name: 'Nila Varma', work_email: 'nila@harbour.test', job_title: 'Project architect', manager_id: 'u-1' },
  firm: FIRM, permission_sets: ['pm'],
  capabilities: { 'projects.view': 'scoped', 'projects.plan': 'scoped', 'time.approve': 'scoped' },
  led_projects: [], member_projects: [],
};
const list = (data: unknown[]) => ({ data, page: 1, page_size: 50, total: data.length, complete: true, missing_count: 0 });

let me: unknown = PRINCIPAL;
const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const path = String(input).replace(/^\/api\/v1/, '').split('?')[0];
  const r = path === '/me' ? { status: 200, body: me }
    : ['/projects', '/notifications', '/accounts', '/people/directory', '/approvals'].includes(path) ? { status: 200, body: list([]) }
      : { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
});
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); });
afterEach(() => vi.unstubAllGlobals());

async function openLive(path: string, viewer: unknown) {
  me = viewer;
  window.history.replaceState(null, '', path);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<SessionProvider><ToastProvider><RouterProvider router={router} /></ToastProvider></SessionProvider>);
  await screen.findByText('Harbour Works');
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return router;
}
const mainNav = () => screen.getByRole('navigation', { name: 'Main' });

describe('live mode offers only the buttons a role can use', () => {
  it('a principal sees Create project, and Settings opens a working section', async () => {
    const router = await openLive('/firm/projects', PRINCIPAL);
    // The page action, and the empty list's action.
    expect(await screen.findAllByRole('button', { name: 'Create project' })).toHaveLength(2);
    await userEvent.click(within(mainNav()).getByRole('link', { name: 'Settings' }));
    expect(router.state.location.pathname).toBe('/firm/settings/accounts');
  });

  it('a project manager without projects.create sees no Create project, and no Settings entry', async () => {
    await openLive('/firm/projects', PM);
    await screen.findByRole('heading', { level: 1, name: 'Projects' });
    expect(screen.queryByRole('button', { name: 'Create project' })).toBeNull();
    expect(within(mainNav()).queryByRole('link', { name: 'Settings' })).toBeNull();
    expect(within(mainNav()).getByRole('link', { name: 'Projects' })).toBeInTheDocument();
  });

  it('a project manager cannot open the create sheet from a ?new=1 link', async () => {
    await openLive('/firm/projects?new=1', PM);
    await screen.findByRole('heading', { level: 1, name: 'Projects' });
    expect(screen.queryByRole('dialog', { name: 'Create project' })).toBeNull();
  });
});
