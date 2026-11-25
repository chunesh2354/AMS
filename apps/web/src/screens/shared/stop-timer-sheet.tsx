import { useState } from 'react';
import { ApiFailure, failureMessage } from '../../api/live';
import { stopTimer } from '../../api/live/time';
import { Button } from '../../ui/Button';
import { DurationField } from '../../ui/DurationField';
import { Form, FormSection } from '../../ui/Form';
import { Sheet } from '../../ui/Sheet';
import { formatDate, formatDuration } from '../../ui/format';

/** What the API sends back (409 TIMER_NEEDS_HOURS) when a timer cannot be logged on its elapsed time. */
export type TimerNeedsHours = { message: string; serviceDate: string; elapsedHours: number; roomHours: number };

export function timerNeedsHours(e: unknown): TimerNeedsHours | null {
  if (!(e instanceof ApiFailure) || e.code !== 'TIMER_NEEDS_HOURS') return null;
  const err = ((e.raw as { error?: Record<string, unknown> } | null)?.error ?? {}) as Record<string, unknown>;
  return {
    message: e.message,
    serviceDate: String(err.service_date ?? ''),
    elapsedHours: Number(err.elapsed_hours ?? 0),
    roomHours: Number(err.room_hours ?? 0),
  };
}

/**
 * Stopping a timer that ran past a working day, or whose day is already full: the person says how many hours to keep
 * on the day it started, or discards it. The timer keeps running until one of the two succeeds.
 */
export function StopTimerSheet({ ask, onClose, onStopped }: { ask: TimerNeedsHours; onClose: () => void; onStopped: (message: string) => void }) {
  const maxMinutes = Math.floor(Math.min(ask.elapsedHours, ask.roomHours, 24) * 60);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const day = ask.serviceDate ? formatDate(ask.serviceDate) : 'the day it started';

  const run = async (opts: { duration_hours?: number; discard?: boolean }, done: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await stopTimer(opts);
      onStopped(done);
    } catch (e) {
      setError(failureMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const keep = () => {
    if (!minutes || minutes <= 0) { setError('Enter the hours you worked.'); return; }
    if (minutes > maxMinutes) { setError(`No more than ${formatDuration(maxMinutes)} h on ${day}.`); return; }
    void run({ duration_hours: Number((minutes / 60).toFixed(2)) }, `Timer stopped. ${formatDuration(minutes)} h logged on ${day}.`);
  };

  return (
    <Sheet
      open onClose={onClose} title="Stop timer" dirty={!!minutes}
      description={ask.message}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={() => void run({ discard: true }, 'Timer discarded. No time was logged.')} disabled={busy}>Discard timer</Button>
          <Button variant="primary" onClick={keep} loading={busy} disabled={maxMinutes <= 0}>Log hours</Button>
        </>
      )}
    >
      <Form onSubmit={(e) => { e.preventDefault(); keep(); }}>
        <FormSection>
          {maxMinutes > 0 ? (
            <DurationField
              label="Hours worked" minutes={minutes} onChange={(m) => { setMinutes(m); setError(undefined); }} error={error} autoFocus
              helper={`Logged on ${day}, the day the timer started. Up to ${formatDuration(maxMinutes)} h fit on that day.`}
            />
          ) : (
            <p className="form__summary" role="status">{error ?? `${day} already holds 24 h, so nothing more fits. Discard the timer and log the time on the right day.`}</p>
          )}
        </FormSection>
      </Form>
    </Sheet>
  );
}
