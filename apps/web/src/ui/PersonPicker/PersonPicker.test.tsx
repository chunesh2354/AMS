import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PersonPicker } from '.';

const people = [{ id: 'P01', name: 'Asha Rao' }, { id: 'P02', name: 'Vikram Nair' }];

it('lists recents and shows an empty message', async () => {
  render(<PersonPicker label="Who" people={people} recent={['P02']} value={null} />);
  await userEvent.click(screen.getByRole('combobox'));
  expect(screen.getByText('Recent')).toBeInTheDocument();
  await userEvent.type(screen.getByRole('combobox'), 'zzz');
  expect(screen.getByText('No one by that name.')).toBeInTheDocument();
});
