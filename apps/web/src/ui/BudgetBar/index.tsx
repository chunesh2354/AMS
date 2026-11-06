import { RestrictedCell } from '../RestrictedCell';
import { formatGrouped, formatHours, formatINR } from '../format';
import { cx } from '../cx';

export type BudgetBarProps = {
  baseline: number;
  revised?: number;
  actual: number;
  forecast: number;
  mini?: boolean;
  showCost?: boolean;
  costBudget?: number;
  costActual?: number;
  costRestricted?: boolean;
};

/** Actual solid, ETC soft, hatch for hours forecast beyond budget, tick at baseline. */
export function BudgetBar({ baseline, revised, actual, forecast, mini, showCost, costBudget, costActual, costRestricted }: BudgetBarProps) {
  const budget = revised ?? baseline;
  const max = Math.max(budget, forecast, actual, baseline, 1);
  const pct = (h: number) => `${(h / max) * 100}%`;
  const within = Math.min(actual, budget);
  const etc = Math.max(0, Math.min(forecast, budget) - actual);
  const over = Math.max(0, forecast - Math.max(budget, actual));
  const overActual = Math.max(0, actual - budget);
  const variance = forecast - budget;
  const summary = `${formatGrouped(actual)} of ${formatGrouped(budget)} hours used, forecast ${formatGrouped(forecast)}${variance > 0 ? `, ${formatGrouped(variance)} over budget` : ''}`;
  return (
    <div className={cx('bar', mini && 'bar--mini')}>
      <div className="bar__wrap" role="img" aria-label={summary}>
        <div className="bar__track">
          <span className="bar__seg bar__seg--actual" style={{ width: pct(within) }} />
          {overActual > 0 && <span className="bar__seg bar__seg--over" style={{ width: pct(overActual) }} />}
          <span className="bar__seg bar__seg--etc" style={{ width: pct(etc) }} />
          <span className="bar__seg bar__seg--over" style={{ width: pct(over) }} />
        </div>
        <span className="bar__tick" style={{ left: pct(baseline) }} />
      </div>
      {!mini && (
        <div className="bar__legend">
          <span><i className="bar__sw bar__seg--actual" />Actual <b>{formatHours(actual)}</b></span>
          <span><i className="bar__sw bar__seg--etc" />ETC <b>{formatHours(Math.max(0, forecast - actual))}</b></span>
          <span>Budget <b>{formatHours(budget)}</b></span>
          {variance > 0 && <span><i className="bar__sw bar__seg--over" />Overrun <b>+{formatHours(variance)}</b></span>}
        </div>
      )}
      {showCost && (
        <div className="bar__cost">
          <span>Cost</span>
          {costRestricted ? <RestrictedCell /> : <b>{formatINR(costActual ?? 0)} / {formatINR(costBudget ?? 0)}</b>}
        </div>
      )}
    </div>
  );
}
