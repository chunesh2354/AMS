import { cx } from '../cx';

export type QueueRailItem = { key: string; label: string; count: number };
export type QueueRailProps = { label: string; items: QueueRailItem[]; value: string; onChange: (key: string) => void };

/** Added for the Approval inbox: glass rail of queues with mono counts. */
export function QueueRail({ label, items, value, onChange }: QueueRailProps) {
  return (
    <nav className="queue-rail glass" aria-label={label}>
      {items.map((q) => (
        <button key={q.key} type="button" className={cx('queue-rail__item', q.key === value && 'is-on')} aria-current={q.key === value ? 'true' : undefined} onClick={() => onChange(q.key)}>
          <span>{q.label}</span>{' '}<span className="t-numeric">{q.count}</span>
        </button>
      ))}
    </nav>
  );
}
