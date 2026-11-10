import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../ui/Toast';
import { ADD_PEOPLE_NOTE, PeopleScreen } from './people';

// A VITE_LIVE=1 build: people are created as accounts in Settings, so the demo Add person wizard must not show.
vi.mock('../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/live')>()), isLive: true }));

// The directory comes from GET /people/directory. P02 is Vikram Nair in the sample studio: the real one must not read as him.
const person = (ref: string, name: string, extra: Record<string, unknown> = {}) => ({
  id: `u-${ref}`, ref_code: ref, name, job_title: 'Architect', employment_state: 'Active', login_state: 'Enabled', invitation_state: 'Accepted',
  account_types: ['employee'], manager: { id: 'u-P01', ref_code: 'P01', name: 'Mira Iyer' }, projects_count: 1,
  this_week: { week_start: '2026-11-09', logged_hours: '12.50' }, ...extra,
});
const DIRECTORY = [
  person('P01', 'Mira Iyer', { job_title: 'Partner', account_types: ['principal'], manager: null, projects_count: 3 }),
  person('P02', 'Nila Varma', { account_types: ['pm'], this_week: { week_start: '2026-11-09', logged_hours: { restricted: true } } }),
  person('P03', 'Dev Shah', { employment_state: 'Ended', login_state: 'Revoked' }),
];
let directory: unknown[] = DIRECTORY;
const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  const body = url.startsWith('/api/v1/people/directory')
    ? { data: directory, page: 1, page_size: 200, total: directory.length, complete: true, missing_count: 0 }
    : { error: { code: 'NOT_FOUND', message: 'Not found' } };
  return new Response(JSON.stringify(body), { status: 'data' in body ? 200 : 404, headers: { 'Content-Type': 'application/json' } });
});
beforeEach(() => { directory = DIRECTORY; vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); });
afterEach(() => { vi.unstubAllGlobals(); });

const open = (path: string) => {
  const router = createMemoryRouter([
    { path: '/firm/people', element: <PeopleScreen /> },
    { path: '/firm/people/:id', element: <p>Profile</p> },
    { path: '/firm/settings/accounts', element: <p>Accounts settings</p> },
  ], { initialEntries: [path] });
  render(<ToastProvider><RouterProvider router={router} /></ToastProvider>);
  return router;
};

describe('People in live mode', () => {
  it('hides Add person and points to Settings, Accounts', async () => {
    const router = open('/firm/people');
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: 'Add person' })).toBeNull();
    expect(ADD_PEOPLE_NOTE).toBe('Add people from Settings, Accounts');
    await userEvent.click(screen.getByRole('button', { name: ADD_PEOPLE_NOTE }));
    expect(router.state.location.pathname).toBe('/firm/settings/accounts');
  });

  it('does not open the demo sheet from ?add=1', async () => {
    open('/firm/people?add=1');
    await screen.findByRole('table');
    expect(screen.queryByRole('dialog', { name: 'Add person' })).toBeNull();
  });

  it('points an empty tab to Settings, Accounts too', async () => {
    open('/firm/people?status=Invited');
    expect(await screen.findByText('No one has been invited yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add person' })).toBeNull();
    expect(screen.getAllByRole('button', { name: ADD_PEOPLE_NOTE })).toHaveLength(2);
  });

  it('lists the active people from the API, with account types and hours, and no sample studio', async () => {
    open('/firm/people');
    expect(await screen.findByText('Nila Varma')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/people/directory?status=all', expect.anything());
    const table = screen.getByRole('table');
    expect(within(table).getByText('Principal')).toBeInTheDocument();
    expect(within(table).getByText('Project manager')).toBeInTheDocument();
    expect(within(table).getByText('12.50 h')).toBeInTheDocument();
    // Fenced hours are restricted, never blank or zero.
    expect(within(table).getAllByRole('img', { name: /restricted/i })).toHaveLength(1);
    // The ended account is on the Deactivated tab only.
    expect(within(table).queryByText('Dev Shah')).toBeNull();
    expect(screen.getByText('2 people')).toBeInTheDocument();
    // Nothing from the sample studio.
    expect(screen.queryByText('Vikram Nair')).toBeNull();
    expect(screen.queryByText('Divya Menon')).toBeNull();
  });

  it('shows deactivated people on their tab', async () => {
    open('/firm/people?status=Deactivated');
    expect(await screen.findByText('Dev Shah')).toBeInTheDocument();
    expect(screen.queryByText('Nila Varma')).toBeNull();
  });

  it('opens a profile by reference', async () => {
    const router = open('/firm/people');
    await userEvent.click(await screen.findByText('Nila Varma'));
    expect(router.state.location.pathname).toBe('/firm/people/P02');
  });
});
