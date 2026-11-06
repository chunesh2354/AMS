import { act } from 'react';
import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Toast } from '.';

it('auto-dismisses after 4 s and pauses on hover', () => {
  vi.useFakeTimers();
  const onDismiss = vi.fn();
  render(<Toast message="Saved" onDismiss={onDismiss} />);
  fireEvent.mouseEnter(screen.getByRole('status'));
  act(() => { vi.advanceTimersByTime(10000); });
  expect(onDismiss).not.toHaveBeenCalled();
  fireEvent.mouseLeave(screen.getByRole('status'));
  act(() => { vi.advanceTimersByTime(4000); });
  expect(onDismiss).toHaveBeenCalled();
  vi.useRealTimers();
});
