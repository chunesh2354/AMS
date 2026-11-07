import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { routes } from './router';
import { SessionProvider } from './app/session';

const open = (path: string) => {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<SessionProvider><RouterProvider router={router} /></SessionProvider>);
  return router;
};

const PATHS = [
  '/firm/overview', '/firm/people', '/firm/people/P05', '/firm/workload', '/firm/pipeline', '/firm/proposals/1', '/firm/projects',
  '/firm/projects/PRJ-01', '/firm/projects/PRJ-01/phases', '/firm/projects/PRJ-01/tasks', '/firm/projects/PRJ-01/staffing',
  '/firm/projects/PRJ-01/time', '/firm/projects/PRJ-01/costs', '/firm/projects/PRJ-01/billing', '/firm/projects/PRJ-01/changes',
  '/firm/projects/PRJ-01/files', '/firm/projects/PRJ-01/activity', '/firm/approvals', '/firm/billing', '/firm/receivables',
  '/firm/reports/utilization', '/firm/settings/profile', '/me/home', '/me/work', '/me/schedule', '/me/time', '/me/expenses', '/me/leave', '/me/profile',
];

describe('router', () => {
  it.each(PATHS)('renders %s inside the shell', (path) => {
    const router = open(path);
    expect(router.state.location.pathname).toBe(path);
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });
  it('redirects the root to Overview', () => {
    expect(open('/').state.location.pathname).toBe('/firm/overview');
  });
  it('fences the Firm interface from staff and hides Firm navigation', async () => {
    open('/firm/billing');
    await userEvent.click(screen.getByRole('button', { name: /Asha Rao.*account menu/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rohan Shetty' }));
    expect(screen.getByText('Ask Asha Rao (Principal)')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Pipeline' })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Interface' })).toBeNull();
  });
  it('switches interface from the sidebar', async () => {
    const router = open('/firm/overview');
    await userEvent.click(screen.getByRole('radio', { name: 'Team' }));
    expect(router.state.location.pathname).toBe('/me/home');
  });
});
