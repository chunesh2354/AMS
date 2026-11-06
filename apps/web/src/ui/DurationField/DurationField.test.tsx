import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DurationField } from '.';

it('accepts decimals and flags nonsense', async () => {
  const onChange = vi.fn();
  render(<DurationField label="Time" minutes={null} onChange={onChange} />);
  const input = screen.getByLabelText('Time');
  await userEvent.type(input, '6.5');
  expect(onChange).toHaveBeenLastCalledWith(390);
  await userEvent.clear(input);
  await userEvent.type(input, 'abc');
  expect(screen.getByText(/Use h:mm/)).toBeInTheDocument();
});
