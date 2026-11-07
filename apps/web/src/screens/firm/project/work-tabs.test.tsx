import { expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { openApp } from '../../test-utils';

it('tints the returned time line and keeps its reason', async () => {
  openApp('/firm/projects/PRJ-01/time');
  const row = (await screen.findByText('Returned by Vikram Nair: wrong phase')).closest('tr')!;
  expect(row).toHaveClass('dt__row--warn');
  expect(within(row).getByText('4.00')).toBeInTheDocument();
  expect(within(row).queryByRole('button', { name: 'Approve' })).toBeNull();
});

it('approves a line and asks for a reason before returning one', async () => {
  openApp('/firm/projects/PRJ-01/time');
  const row = (await screen.findByRole('rowheader', { name: /Divya Menon/ })).closest('tr')!;
  await userEvent.click(within(row).getByRole('button', { name: 'Return' }));
  const sheet = await screen.findByRole('dialog', { name: 'Return time' });
  await userEvent.click(within(sheet).getByRole('button', { name: 'Return line' }));
  expect(within(sheet).getByText('Say what needs fixing')).toBeInTheDocument();
  await userEvent.type(within(sheet).getByRole('textbox', { name: 'Reason' }), 'Wrong week');
  await userEvent.click(within(sheet).getByRole('button', { name: 'Return line' }));
  expect(row).toHaveClass('dt__row--warn');
});

it('shows the duplicate alert under the second consultant bill and compares them', async () => {
  openApp('/firm/projects/PRJ-01/costs');
  const alert = await screen.findByText('Possible duplicate');
  expect(alert.closest('tr')).toHaveClass('dt__expand');
  expect(screen.getByText(/same vendor and amount as the one dated 12 Oct 2026/)).toBeInTheDocument();
  expect(screen.getAllByText('₹2,50,000')).toHaveLength(2);
  expect(screen.getByText('₹1,850')).toBeInTheDocument();
  expect(screen.getAllByText('10%')).toHaveLength(2);
  await userEvent.click(screen.getByRole('button', { name: 'Compare bills' }));
  expect(await screen.findByRole('group', { name: 'Bills side by side' })).toBeInTheDocument();
});

it('lists the change awaiting authorization and opens its estimate', async () => {
  openApp('/firm/projects/PRJ-01/changes');
  await userEvent.click(await screen.findByRole('rowheader', { name: 'Courtyard revision' }));
  const sheet = await screen.findByRole('dialog', { name: 'Courtyard revision' });
  expect(within(sheet).getByRole('textbox', { name: 'Hours Δ' })).toHaveValue('40');
  expect(within(sheet).getByText('Client email, courtyard option B')).toBeInTheDocument();
});

it('lists documents with versions', async () => {
  openApp('/firm/projects/PRJ-01/files');
  const row = (await screen.findByRole('rowheader', { name: 'A-101 Ground floor plan' })).closest('tr')!;
  expect(within(row).getByText('v3')).toBeInTheDocument();
});

it('redacts the rate change in the activity feed', async () => {
  openApp('/firm/projects/PRJ-01/activity');
  expect(await screen.findByText('06 Nov 2026')).toBeInTheDocument();
  const row = screen.getByText(/changed a cost rate/).closest('.feed__row') as HTMLElement;
  expect(within(row).getByRole('img', { name: /restricted/ })).toBeInTheDocument();
});
