import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DateRangeField } from '.';

it('commits after picking both ends', async () => {
  const onChange = vi.fn();
  render(<DateRangeField label="Dates" value={{ from: '2026-11-02', to: null }} onChange={onChange} />);
  await userEvent.click(screen.getByLabelText('Dates'));
  await userEvent.click(screen.getByRole('button', { name: '10 Nov 2026' }));
  expect(onChange).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: '12 Nov 2026' }));
  expect(onChange).toHaveBeenCalledWith({ from: '2026-11-10', to: '2026-11-12' });
});
