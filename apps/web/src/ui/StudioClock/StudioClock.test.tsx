import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { CLOCK_TICK_MS, StudioClock } from '.';

describe('StudioClock', () => {
  afterEach(() => vi.useRealTimers());

  it('shows the time and date in Asia/Kolkata with a spoken label', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-08T08:30:00Z')); // 14:00 in Kolkata
    render(<StudioClock />);
    expect(screen.getByText('Studio time, Mumbai')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Studio time 14:00' })).toHaveTextContent('14:00');
    expect(screen.getByText('Sunday 8 November 2026')).toBeInTheDocument();
  });

  it('updates every 15 seconds', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-08T08:30:50Z'));
    render(<StudioClock place="Platform time, India" label="Platform time" />);
    expect(screen.getByRole('img', { name: 'Platform time 14:00' })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(CLOCK_TICK_MS); });
    expect(screen.getByRole('img', { name: 'Platform time 14:01' })).toBeInTheDocument();
  });
});
