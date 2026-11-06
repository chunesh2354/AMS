import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Combobox } from '.';

const opts = [{ value: 'a', label: 'Lakeview' }, { value: 'b', label: 'Orchard' }];

it('filters and picks with the keyboard', async () => {
  const onChange = vi.fn();
  render(<Combobox label="Client" options={opts} value={null} onChange={onChange} />);
  await userEvent.type(screen.getByRole('combobox'), 'orc{Enter}');
  expect(onChange).toHaveBeenCalledWith('b');
});
it('offers a create option', async () => {
  const onCreate = vi.fn();
  render(<Combobox label="Client" options={opts} value={null} onCreate={onCreate} />);
  await userEvent.type(screen.getByRole('combobox'), 'Meridian{Enter}');
  expect(onCreate).toHaveBeenCalledWith('Meridian');
});
