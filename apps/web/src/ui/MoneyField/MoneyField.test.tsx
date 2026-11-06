import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MoneyField } from '.';

it('groups en-IN at rest and reports a number', async () => {
  const onChange = vi.fn();
  render(<MoneyField label="Fee" value={400000} onChange={onChange} />);
  const input = screen.getByLabelText('Fee');
  expect(input).toHaveValue('4,00,000');
  await userEvent.click(input);
  expect(input).toHaveValue('400000');
  await userEvent.type(input, '1');
  expect(onChange).toHaveBeenCalledWith(4000001);
});
