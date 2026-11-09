import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../ui/Toast';
import { ADD_PEOPLE_NOTE, PeopleScreen } from './people';

// A VITE_LIVE=1 build: people are created as accounts in Settings, so the demo Add person wizard must not show.
vi.mock('../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/live')>()), isLive: true }));

const open = (path: string) => {
  const router = createMemoryRouter([
    { path: '/firm/people', element: <PeopleScreen /> },
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
});
