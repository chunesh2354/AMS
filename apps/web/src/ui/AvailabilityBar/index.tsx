import { formatHours } from '../format';
import { cx } from '../cx';

export type AvailabilityBarProps = { scheduled: number; holiday: number; leave: number; commitments: number; allocated: number; label?: string };

export const availableHours = (p: Pick<AvailabilityBarProps, 'scheduled' | 'holiday' | 'leave' | 'commitments'>) => p.scheduled - p.holiday - p.leave - p.commitments;

/** Scheduled hours split into allocated, commitments and leave or holiday; hours beyond capacity are hatched. */
export function AvailabilityBar({ scheduled, holiday, leave, commitments, allocated, label }: AvailabilityBarProps) {
  const available = availableHours({ scheduled, holiday, leave, commitments });
  const over = Math.max(0, allocated - available);
  const within = allocated - over;
  const off = holiday + leave;
  const total = Math.max(scheduled, within + over + commitments + off, 1);
  const pct = (h: number) => `${(h / total) * 100}%`;
  const summary = `${scheduled} h scheduled, ${holiday} holiday, ${leave} leave, ${commitments} commitment, ${allocated} allocated${over ? `, ${over} h over` : `, ${available - allocated} h free`}`;
  return (
    <div className="avail">
      {label && <span className="t-numeric">{label}</span>}
      <div className="avail__track" role="img" aria-label={label ? `Week of ${label}: ${summary}` : summary}>
        <span className="avail__alloc" style={{ width: pct(within) }} />
        <span className="avail__commit" style={{ width: pct(commitments) }} />
        <span className="avail__off" style={{ width: pct(off) }} />
        <span className="avail__over" style={{ width: pct(over) }} />
      </div>
      <span className={cx('avail__note t-numeric', over > 0 && 'avail__note--over')}>{over > 0 ? `+${formatHours(over)}` : `${formatHours(available - allocated)} free`}</span>
    </div>
  );
}

export function AvailabilityLegend() {
  return (
    <div className="bar__legend">
      <span><i className="bar__sw avail__alloc" />Allocated</span>
      <span><i className="bar__sw avail__commit" />Commitment</span>
      <span><i className="bar__sw avail__off" />Leave, holiday</span>
      <span><i className="bar__sw avail__over" />Over</span>
    </div>
  );
}
