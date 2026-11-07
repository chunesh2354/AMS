import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PeriodNav } from '.';

it('steps back, forward and to today', async () => {
  const onPrev = vi.fn(); const onNext = vi.fn(); const onToday = vi.fn();
  render(<PeriodNav range="02 Nov" onPrev={onPrev} onNext={onNext} onToday={onToday} />);
  await userEvent.click(screen.getByRole('button', { name: 'Previous week' }));
  await userEvent.click(screen.getByRole('button', { name: 'Next week' }));
  await userEvent.click(screen.getByRole('button', { name: 'This week' }));
  expect([onPrev, onNext, onToday].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
});
