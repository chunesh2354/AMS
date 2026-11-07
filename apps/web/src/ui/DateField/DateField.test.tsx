import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DateField } from '.';

it('selects a day and honours min', async () => {
  const onChange = vi.fn();
  render(<DateField label="Date" value="2026-11-06" min="2026-11-05" onChange={onChange} />);
  await userEvent.click(screen.getByLabelText('Date'));
  expect(screen.getByRole('button', { name: '4 Nov 2026' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: '12 Nov 2026' }));
  expect(onChange).toHaveBeenCalledWith('2026-11-12');
});
