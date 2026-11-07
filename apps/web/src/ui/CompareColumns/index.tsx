import type { ReactNode } from 'react';
import { cx } from '../cx';

export type CompareColumn = { label: string; value?: ReactNode; unit?: string; danger?: boolean; rows?: { label: string; value: ReactNode }[]; actions?: ReactNode };

/** Added for budget revisions and bill comparison: two or three columns side by side on a solid surface. */
export function CompareColumns({ label, columns }: { label: string; columns: CompareColumn[] }) {
  return (
    <div className="compare" role="group" aria-label={label} style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
      {columns.map((c) => (
        <div key={c.label} className="compare__col">
          <span className="t-label ink-2">{c.label}</span>
          {c.value != null && <span className={cx('compare__value', c.danger && 'compare__value--danger')}>{c.value}{c.unit && <span className="kpi__unit"> {c.unit}</span>}</span>}
          {c.rows && (
            <dl className="compare__rows">
              {c.rows.map((r) => <div key={r.label}><dt>{r.label}</dt><dd>{r.value}</dd></div>)}
            </dl>
          )}
          {c.actions}
        </div>
      ))}
    </div>
  );
}
