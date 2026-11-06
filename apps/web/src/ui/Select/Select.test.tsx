import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Select } from '.';

it('opens with the keyboard and picks an option', async () => {
  const onChange = vi.fn();
  render(<Select label="Type" options={[{ value: 'a', label: 'One' }, { value: 'b', label: 'Two' }]} value="a" onChange={onChange} />);
  await userEvent.tab();
  await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
  expect(onChange).toHaveBeenCalledWith('b');
  expect(screen.getByRole('combobox')).toHaveFocus();
});
