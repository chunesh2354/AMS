import { expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { openApp } from '../../test-utils';

it('shows Working drawings at +30 h and the compare sheet with its overrun', async () => {
  openApp('/firm/projects/PRJ-01/phases');
  const row = (await screen.findByRole('rowheader', { name: 'Working drawings' })).closest('tr')!;
  expect(within(row).getByText('+30')).toHaveClass('err-cell');
  await userEvent.click(screen.getByRole('button', { name: 'Budget revision' }));
  const compare = await screen.findByRole('group', { name: 'Budget compare' });
  expect(within(compare).getByText('230').closest('.compare__value')).toHaveClass('compare__value--danger');
  expect(within(compare).getAllByText('200')).toHaveLength(2);
  expect(screen.getByRole('img', { name: /170 of 200 hours used, forecast 230, 30 over budget/ })).toBeInTheDocument();
  expect(screen.getByText('+30.00 h')).toBeInTheDocument();
});

it('requires a reason before submitting a revision', async () => {
  openApp('/firm/projects/PRJ-01/phases');
  await userEvent.click(await screen.findByRole('button', { name: 'Budget revision' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Submit revision' }));
  expect(screen.getByText('Say why the budget changes')).toBeInTheDocument();
});
