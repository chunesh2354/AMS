import { expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { openApp } from '../test-utils';

const rowOf = async (name: RegExp) => (await screen.findByRole('rowheader', { name })).closest('[role=row]') as HTMLElement;

it('renders the plan with the conflict, hold badge and unassigned demand', async () => {
  openApp('/firm/workload');
  await screen.findByRole('grid', { name: 'Resource planner' });
  expect(screen.getByRole('button', { name: 'Publish plan (3 changes)' })).toBeInTheDocument();
  const divya = within(await rowOf(/Divya Menon/)).getAllByRole('gridcell');
  expect(divya[2]).toHaveClass('plan__c--conflict');
  expect(divya[2]).toHaveTextContent('+2 h');
  expect(divya[1]).not.toHaveClass('plan__c--conflict');
  expect(document.querySelectorAll('[role=gridcell].plan__c--conflict')).toHaveLength(1);
  expect(within(await rowOf(/Unassigned demand/)).getAllByRole('gridcell')[0]).toHaveTextContent('5 h');
  expect(screen.getByRole('row', { name: /PRJ-03 Heritage Cafe Refit/ })).toHaveTextContent('On hold');
});

it('asks for a reason when the conflict card is opened and saved', async () => {
  openApp('/firm/workload');
  await screen.findByRole('grid', { name: 'Resource planner' });
  const cell = within(await rowOf(/Divya Menon/)).getAllByRole('gridcell')[2];
  await userEvent.click(within(cell).getByRole('button'));
  const sheet = await screen.findByRole('dialog', { name: 'Allocation' });
  expect(within(sheet).getByRole('group', { name: 'Conflict: Overallocated' })).toHaveTextContent('40 h scheduled, 8 holiday, 4 leave, 4 commitment, 26 allocated');
  await userEvent.click(within(sheet).getByRole('button', { name: 'Save allocation' }));
  expect(within(sheet).getByText('Say why this goes ahead')).toBeInTheDocument();
});

it('publishes the three changes', async () => {
  openApp('/firm/workload');
  await userEvent.click(await screen.findByRole('button', { name: 'Publish plan (3 changes)' }));
  expect(screen.getByRole('button', { name: 'Publish plan (0 changes)' })).toBeDisabled();
});

it('prompts for a reason when a keyboard move goes over capacity', async () => {
  openApp('/firm/workload');
  await screen.findByRole('grid', { name: 'Resource planner' });
  // Arjun Das carries 28 h in the week of 16 Nov; capacity there is 30 h. Adding through + stays inside it twice, then goes over.
  const cell = within(await rowOf(/Arjun Das/)).getAllByRole('gridcell')[2];
  cell.focus();
  await userEvent.keyboard('+++');
  expect(await screen.findByRole('dialog', { name: 'This goes over capacity' })).toBeInTheDocument();
});

it('switches to day zoom as read-only', async () => {
  openApp('/firm/workload');
  await screen.findByRole('grid', { name: 'Resource planner' });
  await userEvent.click(screen.getByRole('radio', { name: 'Day' }));
  expect(screen.getByRole('columnheader', { name: /Fri 06/ })).toBeInTheDocument();
  expect(screen.getAllByRole('columnheader')).toHaveLength(8);
});
