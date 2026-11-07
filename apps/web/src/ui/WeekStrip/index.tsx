import { cx } from '../cx';

export type StripWeek = { label: string; note?: string; kind?: 'leave' | 'holiday'; today?: boolean };

/** Added for My leave: a strip of weeks with leave and holidays hatched. */
export function WeekStrip({ label, weeks }: { label: string; weeks: StripWeek[] }) {
  return (
    <div className="strip" tabIndex={0} role="region" aria-label={label}>
      <ol className="strip__list" style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(72px, 1fr))` }}>
        {weeks.map((w) => (
          <li key={w.label} className={cx('strip__week', w.kind && 'plan__c--off', w.today && 'plan__c--today')}>
            <span className="t-numeric">{w.label}</span>
            <span className="t-caption ink-2">{w.note ?? (w.today ? 'Today' : ' ')}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
