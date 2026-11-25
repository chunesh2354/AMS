import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiFailure, parseFailure } from '../../api/live';
import { StopTimerSheet, timerNeedsHours } from './stop-timer-sheet';

const stopTimer = vi.fn();
vi.mock('../../api/live/time', () => ({ stopTimer: (opts: unknown) => stopTimer(opts) }));
afterEach(() => stopTimer.mockReset());

const body = JSON.stringify({ error: {
  code: 'TIMER_NEEDS_HOURS', message: 'This timer has run for 358.00 h since 2026-11-10. Say how many hours you worked, or discard it.',
  details: [], started_at: '2026-11-10T04:00:00Z', service_date: '2026-11-10', elapsed_hours: '358.00', room_hours: '4.00',
} });

describe('stopping a forgotten timer', () => {
  it('reads the 409 TIMER_NEEDS_HOURS body, and nothing else', () => {
    expect(timerNeedsHours(parseFailure(409, body))).toEqual({
      message: expect.stringContaining('358.00 h'), serviceDate: '2026-11-10', elapsedHours: 358, roomHours: 4,
    });
    expect(timerNeedsHours(new ApiFailure(422, 'RULE', 'A day cannot hold more than 24 h.'))).toBeNull();
    expect(timerNeedsHours(new Error('x'))).toBeNull();
  });

  it('logs the hours the person enters, capped to the room left on the day', async () => {
    const ask = timerNeedsHours(parseFailure(409, body))!;
    const onStopped = vi.fn();
    stopTimer.mockResolvedValue({ time_entry_id: 'e1', duration_hours: '3.50' });
    render(<StopTimerSheet ask={ask} onClose={() => {}} onStopped={onStopped} />);
    const field = screen.getByLabelText('Hours worked');
    await userEvent.type(field, '6');
    await userEvent.click(screen.getByRole('button', { name: 'Log hours' }));
    expect(stopTimer).not.toHaveBeenCalled();
    expect(screen.getByText(/No more than 4:00 h/)).toBeInTheDocument();

    await userEvent.clear(field);
    await userEvent.type(field, '3:30');
    await userEvent.click(screen.getByRole('button', { name: 'Log hours' }));
    expect(stopTimer).toHaveBeenCalledWith({ duration_hours: 3.5 });
    expect(onStopped).toHaveBeenCalledWith(expect.stringContaining('3:30 h logged'));
  });

  it('discards the timer without logging time', async () => {
    const onStopped = vi.fn();
    stopTimer.mockResolvedValue({ time_entry_id: null, duration_hours: '0.00', discarded: true });
    render(<StopTimerSheet ask={timerNeedsHours(parseFailure(409, body))!} onClose={() => {}} onStopped={onStopped} />);
    await userEvent.click(screen.getByRole('button', { name: 'Discard timer' }));
    expect(stopTimer).toHaveBeenCalledWith({ discard: true });
    expect(onStopped).toHaveBeenCalledWith('Timer discarded. No time was logged.');
  });

  it('a full day offers only Discard', () => {
    const full = { ...timerNeedsHours(parseFailure(409, body))!, roomHours: 0 };
    render(<StopTimerSheet ask={full} onClose={() => {}} onStopped={() => {}} />);
    expect(screen.queryByLabelText('Hours worked')).toBeNull();
    expect(screen.getByRole('button', { name: 'Log hours' })).toBeDisabled();
    expect(screen.getByText(/already holds 24 h/)).toBeInTheDocument();
  });
});
