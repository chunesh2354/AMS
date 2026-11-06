import type { ReactNode } from 'react';
import { IncompleteIndicator } from '../IncompleteIndicator';
import { RestrictedCell } from '../RestrictedCell';
import { cx } from '../cx';

export type KpiTileProps = {
  label: string;
  value?: ReactNode;
  unit?: string;
  delta?: { text: string; direction?: 'up' | 'down' };
  complete?: boolean;
  missing?: string[];
  restricted?: boolean;
  restrictedReason?: string;
  children?: ReactNode;
};

export function KpiTile({ label, value, unit, delta, complete = true, missing = [], restricted, restrictedReason, children }: KpiTileProps) {
  const num = <span className="kpi__num">{value}</span>;
  return (
    <div className="kpi glass">
      <span className="kpi__label">{label}</span>
      <div className="kpi__value">
        {restricted
          ? <RestrictedCell reason={restrictedReason} />
          : <>
              {complete ? num : <IncompleteIndicator missing={missing}>{num}</IncompleteIndicator>}
              {unit && <span className="kpi__unit">{unit}</span>}
            </>}
      </div>
      {delta && !restricted && <span className={cx('kpi__delta', delta.direction && `kpi__delta--${delta.direction}`)}>{delta.text}</span>}
      {!restricted && children}
    </div>
  );
}
