import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { openApp } from '../test-utils';

describe('People directory', () => {
  it('lists ten people, with Nisha showing no projects yet', async () => {
    openApp('/firm/people');
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('rowheader')).toHaveLength(10);
    const nisha = within(table).getByText('Nisha Kumar').closest('tr')!;
    expect(within(nisha).getByText('Intern', { selector: 'td' })).toBeInTheDocument();
    expect(within(nisha).getByText('No projects yet')).toBeInTheDocument();
  });
  it('keeps filters in the URL', async () => {
    const router = openApp('/firm/people');
    await screen.findByRole('table');
    await userEvent.click(within(screen.getByRole('group', { name: 'Filters' })).getByRole('button', { name: 'Type' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Part time' }));
    expect(router.state.location.search).toBe('?type=Part+time');
    expect(within(screen.getByRole('table')).getAllByRole('rowheader')).toHaveLength(1);
  });
  it('applies the missing time filter from Overview', async () => {
    openApp('/firm/people?issue=missing-time');
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('rowheader')).toHaveLength(3);
  });
  it('shows an empty state with one action on an empty tab', async () => {
    openApp('/firm/people?status=Invited');
    expect(await screen.findByText('No one has been invited yet.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add person' })).toHaveLength(2);
  });
  it('opens a profile from a row', async () => {
    const router = openApp('/firm/people');
    await userEvent.click(await screen.findByText('Divya Menon'));
    expect(router.state.location.pathname).toBe('/firm/people/P05');
  });
  it.each([['loading', 'Loading'], ['error', /could not be loaded/], ['denied', /permission/]])('reaches the %s state', async (demo, text) => {
    openApp(`/firm/people?demo=${demo}`);
    const found = demo === 'loading' ? await screen.findAllByLabelText(text as string) : [await screen.findByText(text)];
    expect(found.length).toBeGreaterThan(0);
  });
});

describe('Add person wizard', () => {
  const start = async () => {
    openApp('/firm/people');
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Add person' }));
    return screen.findByRole('dialog', { name: 'Add person' });
  };
  it('walks four steps with inline validation and ends in a toast', async () => {
    const dialog = await start();
    const next = () => within(dialog).getByRole('button', { name: /Save and continue|Send invitation/ });
    await userEvent.click(next());
    expect(within(dialog).getByText('Full name is required')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Full name'), 'Tara Sen');
    await userEvent.type(within(dialog).getByLabelText('Work email'), 'tara@meridian.example');
    await userEvent.click(next());
    expect(within(dialog).getByText('Access').closest('li')).toHaveAttribute('aria-current', 'step');
    await userEvent.click(next());
    expect(within(dialog).getByText('Choose a manager')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByLabelText('Manager'));
    await userEvent.click(screen.getByRole('option', { name: /Vikram Nair/ }));
    await userEvent.click(next());
    expect(within(dialog).getByText('Capacity').closest('li')).toHaveAttribute('aria-current', 'step');
    await userEvent.click(next());
    expect(within(dialog).getByText('tara@meridian.example')).toBeInTheDocument();
    await userEvent.click(next());
    expect(await screen.findByText(/Invitation ready for Tara Sen/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('guards unsaved input', async () => {
    const dialog = await start();
    await userEvent.type(within(dialog).getByLabelText('Full name'), 'Tara');
    await userEvent.keyboard('{Escape}');
    expect(within(dialog).getByText('Discard unsaved changes?')).toBeInTheDocument();
  });
});
