import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MultiSelect } from '.';

it('adds with Enter and removes with Backspace', async () => {
  const onChange = vi.fn();
  render(<MultiSelect label="Skills" options={[{ value: 'a', label: 'Revit' }]} value={['a']} onChange={onChange} />);
  await userEvent.click(screen.getByRole('combobox'));
  await userEvent.keyboard('{Backspace}');
  expect(onChange).toHaveBeenCalledWith([]);
});
