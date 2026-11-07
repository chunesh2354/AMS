import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TimerPill } from '.';

it('shows mono elapsed time and stops', async () => {
  const onStop = vi.fn();
  render(<TimerPill state="running" elapsedSeconds={6120} context="PRJ-01" onStop={onStop} />);
  const b = screen.getByRole('button', { name: /Stop timer.*01:42.*PRJ-01/ });
  await userEvent.click(b);
  expect(onStop).toHaveBeenCalled();
});
it('warns after 10 hours', () => {
  render(<TimerPill state="running" elapsedSeconds={36001} />);
  expect(screen.getByRole('button')).toHaveClass('timer--warn');
});
it('offers start when idle', () => {
  render(<TimerPill state="idle" />);
  expect(screen.getByRole('button', { name: 'Start timer' })).toBeInTheDocument();
});
