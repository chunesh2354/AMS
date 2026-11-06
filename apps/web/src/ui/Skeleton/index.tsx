import { cx } from '../cx';

export type SkeletonProps = { kind?: 'text' | 'table' | 'card' | 'planner'; rows?: number; width?: string | number };

export function Skeleton({ kind = 'text', rows = 8, width }: SkeletonProps) {
  if (kind === 'table') {
    return (
      <div className="skeleton-table" role="status" aria-label="Loading">
        {Array.from({ length: rows + 1 }, (_, r) => (
          <div key={r} className="skeleton-table__row">{[0, 1, 2, 3].map((c) => <span key={c} className="skeleton skeleton--text" />)}</div>
        ))}
      </div>
    );
  }
  if (kind === 'planner') {
    return (
      <div className="skeleton-planner" role="status" aria-label="Loading">
        {Array.from({ length: 9 * 6 }, (_, i) => <span key={i} className="skeleton" />)}
      </div>
    );
  }
  return <span role="status" aria-label="Loading" className={cx('skeleton', `skeleton--${kind}`)} style={{ width }} />;
}
