import { ChevronRight, TrendingDown, TrendingUp } from 'lucide-react';
import { RestrictedCell } from '../RestrictedCell';
import { formatGrouped } from '../format';
import type { Tone } from '../status-colors';

export type QueueCardProps = {
  count: number;
  label: string;
  severity?: Extract<Tone, 'ok' | 'warn' | 'danger' | 'neutral'>;
  trend?: { direction: 'up' | 'down'; text: string };
  restricted?: boolean;
  onClick?: () => void;
};

export function QueueCard({ count, label, severity = 'neutral', trend, restricted, onClick }: QueueCardProps) {
  const body = (
    <>
      <span className="queue__count">
        {restricted ? <RestrictedCell /> : <span className="queue__num">{formatGrouped(count)}</span>}
        {trend && !restricted && (
          <span className="queue__trend">
            {trend.direction === 'up' ? <TrendingUp size={16} strokeWidth={1.5} aria-hidden /> : <TrendingDown size={16} strokeWidth={1.5} aria-hidden />}
            {trend.text}
          </span>
        )}
      </span>
      <span className="queue__label">{label}{onClick && !restricted && <ChevronRight className="queue__chevron" size={16} strokeWidth={1.5} aria-hidden />}</span>
    </>
  );
  const cls = `queue glass tone-${severity}`;
  // A restricted card holds its own focusable lock, so it cannot also be a button.
  return onClick && !restricted ? <button type="button" className={cls} onClick={onClick} aria-label={`${formatGrouped(count)} ${label}, open list`}>{body}</button> : <div className={cls}>{body}</div>;
}
