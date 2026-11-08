import { Play, Square } from 'lucide-react';
import { formatElapsed } from '../format';
import { cx } from '../cx';

export const TIMER_WARN_SECONDS = 10 * 3600;

export type TimerPillProps = {
  state: 'idle' | 'running';
  elapsedSeconds?: number;
  context?: string;
  onStart?: () => void;
  onStop?: () => void;
};

/** Idle offers Start. Running shows mono elapsed time; only the dot pulses, and it warns after 10 h. */
export function TimerPill({ state, elapsedSeconds = 0, context, onStart, onStop }: TimerPillProps) {
  if (state === 'idle') {
    return (
      <button type="button" className="timer" onClick={onStart}>
        <Play size={16} strokeWidth={1.5} aria-hidden />Start timer
      </button>
    );
  }
  const warn = elapsedSeconds >= TIMER_WARN_SECONDS;
  const elapsed = formatElapsed(elapsedSeconds);
  return (
    <button
      type="button"
      className={cx('timer', warn && 'timer--warn')}
      onClick={onStop}
    >
      {/* Name built from visible text plus hidden words, so it contains what is shown (WCAG 2.5.3). */}
      <span className="sr-only">Stop timer, </span>
      <span className="timer__dot" aria-hidden />
      <span className="timer__elapsed">{elapsed}</span>
      {context && <><span className="sr-only">, </span><span className="timer__context">{context}</span></>}
      {warn && <span className="sr-only">, running over 10 hours</span>}
      <span className="timer__stop" aria-hidden><Square size={12} strokeWidth={1.5} fill="currentColor" />Stop</span>
    </button>
  );
}
