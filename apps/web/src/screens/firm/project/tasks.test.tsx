import { expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { openApp } from '../../test-utils';

it('shows 17 tasks across five stages with one blocked', async () => {
  openApp('/firm/projects/PRJ-01/tasks');
  expect(await screen.findByText('17 tasks, 1 blocked')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'In progress, 5' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Done, 0' })).toHaveTextContent('Nothing done in this period.');
  const card = screen.getByRole('button', { name: /^Stair section at grid C/ });
  expect(within(card).getByText('Blocked')).toBeInTheDocument();
});

it('opens the 640 sheet with the block, checklist and review thread', async () => {
  openApp('/firm/projects/PRJ-01/tasks');
  await userEvent.click(await screen.findByRole('button', { name: /^Stair section at grid C/ }));
  const sheet = await screen.findByRole('dialog', { name: 'Stair section at grid C' });
  expect(sheet).toHaveClass('sheet--640');
  expect(within(sheet).getByText('Blocked: Awaiting structural input')).toBeInTheDocument();
  expect(within(sheet).getByRole('group', { name: 'Review thread' })).toHaveTextContent('Check the landing level');
  expect(within(sheet).getByRole('checkbox', { name: 'Dimensions checked' })).toBeInTheDocument();
  expect(within(sheet).getByRole('button', { name: 'Submit for review' })).toBeDisabled();
});

it('moves a card from the keyboard menu and switches to the list', async () => {
  const router = openApp('/firm/projects/PRJ-01/tasks');
  await userEvent.click(await screen.findByRole('button', { name: 'Move Door hardware notes' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Ready' }));
  expect(screen.getByRole('region', { name: 'Ready, 5' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('radio', { name: 'List' }));
  expect(router.state.location.search).toBe('?view=list');
  expect(await screen.findByRole('table')).toBeInTheDocument();
});
