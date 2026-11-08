import { formatHours } from '../format';
import { cx } from '../cx';

export const OVER_DAY_HOURS = 12;
export type DayTotalRingProps = { hours: number; scheduled: number; label?: string };

/** Hours against the scheduled day. Over 12 h turns warn. */
export function DayTotalRing({ hours, scheduled, label }: DayTotalRingProps) {
  const over = hours > OVER_DAY_HOURS;
  const R = 17; const C = 2 * Math.PI * R;
  const part = scheduled > 0 ? Math.min(1, hours / scheduled) : hours > 0 ? 1 : 0;
  const unscheduled = scheduled === 0 && hours === 0;
  const text = `${label ? `${label}: ` : ''}${formatHours(hours)} of ${formatHours(scheduled)} scheduled${over ? ', over 12 hours' : ''}`;
  if (unscheduled) {
    return <span className="ring ring--none" role="img" aria-label={`${label ? `${label}: ` : ''}nothing scheduled`} title="Nothing scheduled"><span className="ring__text ink-3" aria-hidden>{'–'}</span></span>;
  }
  return (
    <span className={cx('ring', over && 'ring--over')} role="img" aria-label={text} title={text}>
      <svg viewBox="0 0 40 40" width={40} height={40} aria-hidden>
        <circle cx={20} cy={20} r={R} className="ring__track" />
        {part > 0 && <circle cx={20} cy={20} r={R} className="ring__value" strokeDasharray={`${part * C} ${C}`} transform="rotate(-90 20 20)" />}
      </svg>
      <span className="ring__text" aria-hidden>{hours.toFixed(2)}</span>
    </span>
  );
}
