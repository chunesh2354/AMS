import { expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { openApp } from '../test-utils';

it('My day shows the six cards and today list for Rohan', async () => {
  openApp('/me/home', 'P04');
  expect(await screen.findByRole('heading', { name: 'Good afternoon, Rohan' })).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: /3\s*Due today/ })).toBeInTheDocument();
  for (const n of [/1\s*Blocked/, /2\s*Reviews requested/, /2\s*Missing time days/, /0\s*Returned/, /1\s*Leave decisions/]) expect(screen.getByRole('button', { name: n })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Concept option B — courtyard/ })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: /Concept design 16.00 h, Working drawings 12.00 h/ })).toBeInTheDocument();
});

it('quick actions open the shared sheets and validate', async () => {
  openApp('/me/home', 'P04');
  await userEvent.click(await screen.findByRole('button', { name: 'Log time' }));
  const log = await screen.findByRole('dialog', { name: 'Log time' });
  await userEvent.click(within(log).getByRole('button', { name: 'Save' }));
  expect(within(log).getByText('Choose a project and phase')).toBeInTheDocument();
  expect(within(log).getByText('Enter the time spent')).toBeInTheDocument();
  await userEvent.click(within(log).getByRole('button', { name: 'Cancel' }));
  await userEvent.click(screen.getByRole('button', { name: 'Request leave' }));
  const leave = await screen.findByRole('dialog', { name: 'Request leave' });
  expect(within(leave).getByText('Private reason')).toBeInTheDocument();
  await userEvent.click(within(leave).getByRole('button', { name: 'Submit request' }));
  expect(within(leave).getByText('Choose working days')).toBeInTheDocument();
});

it('My work groups nine tasks and moves them inline', async () => {
  openApp('/me/work', 'P04');
  expect(await screen.findByText('9 tasks')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Overdue, 1' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Today, 3' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'This week, 2' })).toBeInTheDocument();
  const later = screen.getByRole('region', { name: 'Later, 3' });
  const start = within(later).getAllByRole('button', { name: 'Start' })[0];
  await userEvent.click(start);
  expect(within(later).getAllByRole('status', { name: 'In progress' })).toHaveLength(1);
  await userEvent.click(within(later).getByRole('button', { name: 'Block' }));
  const sheet = await screen.findByRole('dialog', { name: 'Block task' });
  await userEvent.click(within(sheet).getByRole('button', { name: 'Block task' }));
  expect(within(sheet).getByText('Say what is blocking this')).toBeInTheDocument();
});

it('My time totals 38.50 h, flags Thursday and locks on submit', async () => {
  openApp('/me/time', 'P04');
  expect(await screen.findByRole('grid', { name: /Timesheet/ })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Thu: 12.50 h of 8.00 h scheduled, over 12 hours' })).toHaveClass('ring--over');
  expect(screen.getByText('Thursday has 12.50 h')).toBeInTheDocument();
  expect(screen.getAllByText('38.50').length).toBeGreaterThan(0);
  expect(screen.getByText('38.50 h')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Submit week' }));
  expect(screen.getByRole('status', { name: 'Submitted' })).toBeInTheDocument();
  expect(screen.getAllByText('Locked.', { exact: false })).toHaveLength(5);
  await userEvent.click(screen.getByRole('button', { name: 'Request correction' }));
  expect(await screen.findByRole('dialog', { name: 'Request correction' })).toBeInTheDocument();
});

it('blocks submit while a line is returned or unclassified', async () => {
  openApp('/me/time', 'P08');
  const row = (await screen.findByRole('img', { name: /Returned\. Returned by Vikram Nair: wrong phase/ })).closest('tr')!;
  expect(row).toHaveClass('ts__row--returned');
  await userEvent.click(screen.getByRole('button', { name: 'Submit week' }));
  expect(screen.getByText('Fix 2 lines before you submit.')).toBeInTheDocument();
  expect(screen.queryByRole('status', { name: 'Submitted' })).toBeNull();
});

it('steps to the approved previous week, read-only', async () => {
  openApp('/me/time', 'P04');
  await userEvent.click(await screen.findByRole('button', { name: 'Previous week' }));
  expect(await screen.findByText('26 Oct to 01 Nov 2026')).toBeInTheDocument();
  expect(await screen.findByRole('status', { name: 'Approved' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Add line' })).toBeNull();
});

it('My expenses shows the approved taxi with a pending reimbursement', async () => {
  openApp('/me/expenses', 'P04');
  expect(await screen.findByText('₹1,850')).toBeInTheDocument();
  expect(screen.getByRole('status', { name: 'Finance approved' })).toBeInTheDocument();
  expect(screen.getByRole('status', { name: 'Reimbursement pending' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'New expense' }));
  const sheet = await screen.findByRole('dialog', { name: 'New expense' });
  await userEvent.click(within(sheet).getByRole('button', { name: 'Submit expense' }));
  expect(within(sheet).getByText('Add the receipt')).toBeInTheDocument();
  expect(within(sheet).getByText('Remaining to allocate')).toBeInTheDocument();
});

it('My leave shows balances, the strip and a cancellable approved request', async () => {
  openApp('/me/leave', 'P04');
  expect(await screen.findByText('Earned leave', { selector: '.kpi__label' })).toBeInTheDocument();
  expect(screen.getByText('Leave 2 d')).toBeInTheDocument();
  expect(await screen.findByText('16 to 17 Nov 2026')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  const sheet = await screen.findByRole('dialog', { name: 'Cancel approved leave' });
  await userEvent.click(within(sheet).getByRole('button', { name: 'Request cancellation' }));
  expect(await screen.findByRole('status', { name: 'Cancellation requested' })).toBeInTheDocument();
});

it('My profile keeps work details read-only and validates personal fields', async () => {
  const router = openApp('/me/profile', 'P04');
  expect(await screen.findByText('Ask Farah Khan to change this.')).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).toBeNull();
  await userEvent.click(screen.getByRole('link', { name: 'Personal details' }));
  expect(router.state.location.search).toBe('?section=personal');
  await userEvent.type(await screen.findByRole('textbox', { name: 'Phone' }), 'abc');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByText('Enter a phone number with 8 to 15 digits')).toBeInTheDocument();
});

it('shows calm empties for someone without team records', async () => {
  openApp('/me/expenses', 'P01');
  expect(await screen.findByText('You have no expenses yet.')).toBeInTheDocument();
});
