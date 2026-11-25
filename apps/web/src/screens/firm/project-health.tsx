import { useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Lock } from 'lucide-react';
import { isLive, isRestricted } from '../../api/live';
import { isForbidden } from '../../api/live/project-tabs';
import {
  HEALTH_SORTS, compactINR, feeShares, getProjectHealth, healthCounts, hoursPct, mockProjectHealth, slipText, sortHealth, whyLine,
  type Health, type HealthRow, type HealthSort, type ProjectHealth,
} from '../../api/live/health';
import { Avatar } from '../../ui/Avatar';
import { BudgetBar } from '../../ui/BudgetBar';
import { ListStateBlock } from '../../ui/ListState';
import { Segmented } from '../../ui/Segmented';
import { cx } from '../../ui/cx';
import { formatDate, formatGrouped } from '../../ui/format';
import './project-health.css';

const MARKER: Record<Health, string> = { 'On track': 'marker--filled', Watch: 'marker--done', 'At risk': 'marker--alert' };

export function HealthMark({ status }: { status: Health }) {
  return (
    <span className={cx('ph-status', status === 'At risk' && 'ph-status--risk')}>
      <span className={cx('marker', MARKER[status])} aria-hidden />{status}
    </span>
  );
}

function Locked({ sub }: { sub: string }) {
  return (
    <>
      <span className="ph-lock"><Lock size={14} strokeWidth={1.5} aria-hidden />Restricted</span>
      <span className="ph-num__s">{sub}</span>
    </>
  );
}

function HoursCell({ r }: { r: HealthRow }) {
  const budget = Number(r.hours.budget);
  const actual = Number(r.hours.actual);
  const forecast = Number(r.hours.forecast);
  const pct = hoursPct(r);
  const over = budget > 0 && forecast > budget;
  return (
    <div className="ph-num" role="cell">
      <span>{budget > 0 ? `${formatGrouped(actual)} of ${formatGrouped(budget)} h` : `${formatGrouped(actual)} h, no budget`}</span>
      {budget > 0 && <BudgetBar baseline={budget} actual={actual} forecast={forecast} mini />}
      <span className={cx('ph-num__s', over && 'ph-num__s--red')}>
        Forecast {formatGrouped(forecast)} h{pct != null ? `, ${Math.round(pct)}%` : ''}{over ? `, ${formatGrouped(Number((forecast - budget).toFixed(2)))} h over` : ''}
      </span>
    </div>
  );
}

function FeeCell({ r }: { r: HealthRow }) {
  if (isRestricted(r.fee)) return <div className="ph-num" role="cell"><Locked sub="billing and finance" /></div>;
  const f = feeShares(r.fee);
  if (!f || f.authorized <= 0) return <div className="ph-num" role="cell"><span>No fee authorized</span><span className="ph-num__s">{f && f.billed > 0 ? `${compactINR(f.billed)} billed` : 'nothing billed yet'}</span></div>;
  const unpaid = f.billed - f.collected;
  return (
    <div className="ph-num" role="cell">
      <span>{compactINR(f.collected)} collected</span>
      <div className="ph-fee" role="img" aria-label={`Fee authorized ${compactINR(f.authorized)}, billed ${compactINR(f.billed)}, collected ${compactINR(f.collected)}`}>
        <span className="ph-fee__seg ph-fee__billed" style={{ width: `${f.billedPct}%` }} />
        <span className="ph-fee__seg ph-fee__coll" style={{ width: `${f.collectedPct}%` }} />
      </div>
      <span className="ph-num__s">{compactINR(f.billed)} billed of {compactINR(f.authorized)}{unpaid > 0 ? `, ${compactINR(unpaid)} unpaid` : f.billed > 0 ? ', all paid' : ''}</span>
    </div>
  );
}

function MarginCell({ r }: { r: HealthRow }) {
  if (isRestricted(r.margin) || isRestricted(r.margin_target)) return <div className="ph-num ph-num--r" role="cell"><Locked sub="margin viewers only" /></div>;
  const value = r.margin.value_pct;
  const target = r.margin_target.value_pct;
  const below = value != null && value < target;
  return (
    <div className="ph-num ph-num--r" role="cell">
      <span className={cx(below && 'ph-red')}>{value == null ? 'No fee yet' : `${value}%`}</span>
      <span className="ph-num__s">target {target}%{r.margin.complete ? '' : ', incomplete'}</span>
    </div>
  );
}

function HealthRowView({ r }: { r: HealthRow }) {
  const slip = slipText(r);
  const hold = r.status === 'On hold';
  return (
    <div className={cx('ph-tr ph-tr--body', hold && 'ph-tr--hold')} role="row">
      <div className="ph-pn" role="rowheader">
        <Link className="ph-pn__t" to={`/firm/projects/${encodeURIComponent(r.code)}`}>{r.code} {r.name}</Link>
        <span className="ph-pn__m"><Avatar name={r.pm.name} size={20} />{r.pm.name}{r.client ? `, ${r.client}` : ''}{hold ? ', on hold' : ''}</span>
        <p className={cx('ph-why', r.health.status === 'At risk' && 'ph-red')}>{whyLine(r)}</p>
      </div>
      <div role="cell"><HealthMark status={r.health.status} /></div>
      <HoursCell r={r} />
      <FeeCell r={r} />
      <div className="ph-num ph-num--r" role="cell">
        <span className={cx(slip.late && 'ph-red')}>{slip.value}</span>
        <span className="ph-num__s">{slip.sub}</span>
      </div>
      <MarginCell r={r} />
      <div className="ph-num ph-num--r" role="cell">
        <span>{r.open_tasks} open</span>
        <span className={cx('ph-num__s', r.overdue_tasks > 0 && 'ph-num__s--red')}>{r.overdue_tasks ? `${r.overdue_tasks} overdue` : 'none overdue'}</span>
      </div>
    </div>
  );
}

/** "How health is worked out": the API's own rule sentences and thresholds, never a copy kept in the client. */
function HowHealth({ data }: { data: ProjectHealth }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const t = data.thresholds;
  return (
    <section className="ph-how">
      <button type="button" className={cx('ph-how__h', open && 'is-open')} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        How health is worked out<ChevronRight size={16} strokeWidth={1.5} aria-hidden />
      </button>
      {open && (
        <div id={id} className="ph-how__b">
          <ul className="ph-how__list">{data.rule.map((line) => <li key={line} className="t-body-sm">{line}</li>)}</ul>
          {t && (
            <dl className="def-list ph-how__thr" aria-label="Thresholds">
              <dt>Hours, Watch from</dt><dd className="t-numeric">{t.hours_watch_pct}% of budget</dd>
              <dt>Hours, At risk above</dt><dd className="t-numeric">{t.hours_at_risk_above_pct}% of budget</dd>
              <dt>Slip, Watch from</dt><dd className="t-numeric">{t.slip_watch_days} {t.slip_watch_days === 1 ? 'day' : 'days'}</dd>
              <dt>Slip, At risk above</dt><dd className="t-numeric">{t.slip_at_risk_above_days} days</dd>
            </dl>
          )}
          {data.marginDefinition && <p className="t-caption ink-2">{data.marginDefinition}</p>}
        </div>
      )}
    </section>
  );
}

const load = () => (isLive ? getProjectHealth() : Promise.resolve(mockProjectHealth()));

/**
 * The Health view of Projects, from GET /projects/health: counts by status, then one row per project with hours
 * (used, forecast, budget tick, redline over), fee (authorized, billed, collected), schedule slip, margin against
 * target, open and overdue tasks, and the health status with the API's reasons. Mock mode shows sample rows.
 */
export function ProjectHealthView() {
  const [data, setData] = useState<ProjectHealth | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [sort, setSort] = useState<HealthSort>('risk');
  useEffect(() => {
    let live = true;
    setState('loading');
    load().then(
      (d) => { if (live) { setData(d); setState('ready'); } },
      (e: unknown) => { if (live) setState(isForbidden(e) ? 'denied' : 'error'); },
    );
    return () => { live = false; };
  }, [attempt]);
  const rows = useMemo(() => sortHealth(data?.rows ?? [], sort), [data, sort]);
  const effective = state === 'ready' && !rows.length ? 'empty' : state;
  if (effective !== 'ready' || !data) {
    return <ListStateBlock state={effective === 'ready' ? 'loading' : effective} label="Project health" rows={4} onRetry={() => setAttempt((a) => a + 1)} capability="view project health" empty={{ message: 'No projects to read yet.' }} />;
  }
  const marginHidden = rows.some((r) => isRestricted(r.margin));
  return (
    <div className="ph">
      <div className="ph-sum" aria-label="Projects by health">
        {healthCounts(rows).map((c) => (
          <div key={c.status} className="ph-sum__i">
            <span className={cx('ph-sum__v', c.status === 'At risk' && c.count > 0 && 'ph-red')}>{c.count}</span>
            <HealthMark status={c.status} />
          </div>
        ))}
        <p className="t-caption ink-2 ph-sum__asof">Figures as of {formatDate(data.asOf ?? data.today)}.</p>
      </div>
      <div className="ph-bar">
        <span className="t-body-sm ink-2">Sort by</span>
        <Segmented label="Sort by" value={sort} onChange={setSort} options={HEALTH_SORTS} />
        <ul className="ph-legend" aria-label="Legend">
          <li><span className="ph-sw ph-sw--used" aria-hidden />Hours used</li>
          <li><span className="ph-sw ph-sw--fc" aria-hidden />Forecast</li>
          <li><span className="ph-sw ph-sw--bud" aria-hidden />Budget</li>
          <li><span className="ph-sw ph-sw--over" aria-hidden />Over budget</li>
          <li><span className="ph-sw ph-sw--auth" aria-hidden />Fee authorized</li>
          <li><span className="ph-sw ph-sw--billed" aria-hidden />Billed</li>
          <li><span className="ph-sw ph-sw--coll" aria-hidden />Collected</li>
        </ul>
      </div>
      <div className="ph-tbl" role="table" aria-label="Project health" aria-rowcount={rows.length + 1}>
        <div className="ph-tr ph-tr--head" role="row">
          <span role="columnheader">Project</span>
          <span role="columnheader">Health</span>
          <span role="columnheader">Hours budget</span>
          <span role="columnheader">Fee</span>
          <span role="columnheader" className="ph-r">Schedule slip</span>
          <span role="columnheader" className="ph-r">Margin</span>
          <span role="columnheader" className="ph-r">Tasks</span>
        </div>
        {rows.map((r) => <HealthRowView key={r.id} r={r} />)}
      </div>
      {!data.complete && <p className="t-caption ink-2">Showing the first {rows.length} projects.</p>}
      {marginHidden && <p className="t-body-sm ink-2">Margin is visible to principals and finance. Health still takes it into account, so a project can show Watch for a reason you cannot see here.</p>}
      <HowHealth data={data} />
    </div>
  );
}
