import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getOverview, getProjects, hasFinanceAccess, type AttentionItem, type ProjectView } from '../../api';
import { ApiFailure, isLive } from '../../api/live';
import { getLiveOverview, type LiveOverview, type LiveOverviewProject } from '../../api/live/overview';
import { useResource } from '../../api/useResource';
import { useSession } from '../../app/session';
import { sortAttention } from '../../ui/AttentionList';
import { KpiTile } from '../../ui/KpiTile';
import { ListStateBlock, type ListState } from '../../ui/ListState';
import { PageHeader } from '../../ui/PageHeader';
import { QueueCard } from '../../ui/QueueCard';
import { RestrictedCell } from '../../ui/RestrictedCell';
import { Skeleton } from '../../ui/Skeleton';
import { StatusChip } from '../../ui/StatusChip';
import { formatGrouped, formatINR, formatPercent } from '../../ui/format';

/** One verb per kind of problem, so each row says what you will do next. */
const VERB: Partial<Record<AttentionItem['status'], string>> = {
  Overdue: 'Chase payment',
  Excess: 'Review',
  Overrun: 'Review phase',
  Conflict: 'Rebalance',
  'Incomplete data': 'Set rate',
  Returned: 'Fix line',
  'Pending (approval)': 'Review timesheet',
};

const COUNT_WORDS = ['Nothing needs', 'One thing needs', 'Two things need', 'Three things need', 'Four things need', 'Five things need', 'Six things need', 'Seven things need', 'Eight things need', 'Nine things need'];
const needs = (n: number) => `${COUNT_WORDS[n] ?? `${n} things need`} your attention.`;

/** A row may carry its own chip word and verb (live mode); otherwise the verb comes from its status. */
type AttentionRowItem = AttentionItem & { label?: string; verb?: string };

function AttentionRows({ items, state, onRetry }: { items: AttentionRowItem[]; state: ListState; onRetry: () => void }) {
  const effective = state === 'ready' && items.length === 0 ? 'empty' : state;
  return (
    <section className="ov-section ov-attention" aria-label="Needs attention">
      <header className="ov-section__head">
        <h2 className="t-h2">Needs attention</h2>
        {effective === 'ready' && <span className="t-body-sm ink-2 t-numeric">{items.length} open</span>}
      </header>
      {effective !== 'ready'
        ? <ListStateBlock state={effective} label="Needs attention" onRetry={onRetry} capability="view firm attention items" empty={{ message: 'Nothing needs attention right now.' }} />
        : (
          <ul className="ov-attention__list">
            {sortAttention(items).map((a) => {
              const titleId = `att-${a.id}`;
              return (
                <li key={a.id} className="ov-attention__row">
                  <span className="ov-attention__main">
                    <StatusChip dot status={a.status} label={a.label} />
                    <span className="ov-attention__text">
                      <span id={titleId} className="ov-attention__title">{a.title}</span>
                      <span className="t-body-sm ink-2">{a.detail}</span>
                    </span>
                  </span>
                  <span className="ov-attention__age t-numeric">{a.ageDays} {a.ageDays === 1 ? 'day' : 'days'}</span>
                  <span className="ov-attention__act">
                    {a.to && <Link to={a.to} className="btn btn--secondary" aria-describedby={titleId}>{a.verb ?? VERB[a.status] ?? 'Open'}</Link>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
    </section>
  );
}

function ProjectRows({ projects, finance }: { projects: ProjectView[]; finance: boolean }) {
  return (
    <section className="ov-section ov-projects" aria-labelledby="ov-projects-h">
      <header className="ov-section__head">
        <h2 id="ov-projects-h" className="t-h2">Projects</h2>
        <Link to="/firm/projects" className="ov-link">All projects</Link>
      </header>
      <ul className="ov-projects__list">
        {projects.map((p) => (
          <li key={p.code}>
            <Link to={`/firm/projects/${p.code}`} className="ov-project">
              <span className="ov-project__line">
                <span className="ov-project__name">{p.code} {p.name}</span>
              </span>
              <span className="ov-project__line t-body-sm ink-2">
                <span>{p.client}</span>
                {finance && <span className="t-numeric">{p.contract}</span>}
              </span>
              <span className="ov-project__progress">
                <StatusChip size="sm" status={p.status} />
                <span className="ov-project__bar" aria-hidden><span style={{ width: `${Math.max(0, Math.min(100, p.delivery))}%` }} /></span>
                <span className="t-caption ink-2 t-numeric">{p.delivery}% complete</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Live mode reads GET /overview; the sample studio stays exactly as it was in mock mode. */
export function OverviewScreen() {
  return isLive ? <LiveOverviewScreen /> : <MockOverviewScreen />;
}

function MockOverviewScreen() {
  const navigate = useNavigate();
  const { viewer } = useSession();
  const { state, data, retry } = useResource(() => getOverview(viewer), [viewer.id]);
  const projects = useResource(() => getProjects(viewer), [viewer.id]);
  const finance = hasFinanceAccess(viewer);
  const first = viewer.name.split(' ')[0];
  const approvals = data?.queues.find((q) => q.key === 'approvals');
  const overdue = data && !data.ageing.restricted ? data.ageing.value.filter((a) => a.bucket !== 'Current').reduce((s, a) => s + a.amount, 0) : 0;
  const overdueInvoices = data?.queues.find((q) => q.key === 'overdue')?.count ?? 0;
  const loading = state === 'loading' || !data;
  return (
    <div className="scr-overview">
      <PageHeader
        display
        title={`Good afternoon, ${first}`}
        meta={<span className="t-body ink-2">{data && state === 'ready' ? needs(data.attention.length) : 'This week in the studio.'}</span>}
        secondaryActions={<Link to="/firm/approvals" className="btn btn--secondary">Review approvals</Link>}
        primaryAction={<Link to="/firm/billing" className="btn btn--primary">Prepare invoices</Link>}
      />

      <section className="ov-figures" aria-label="Key figures">
        {loading
          ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} kind="card" />)
          : (
            <>
              <KpiTile
                label="Ready to bill"
                restricted={data.readyToBill.restricted}
                value={data.readyToBill.restricted ? undefined : formatINR(data.readyToBill.value)}
                delta={{ text: 'Approved time and fee stages not yet invoiced.' }}
              >
                <Link to="/firm/billing" className="ov-link">Prepare invoices</Link>
              </KpiTile>
              <div className="ov-figure--overdue">
                <KpiTile
                  label="Overdue"
                  restricted={data.ageing.restricted}
                  value={data.ageing.restricted ? undefined : formatINR(overdue)}
                  delta={{ text: overdueInvoices === 1 ? 'One invoice is past its due date.' : `${overdueInvoices} invoices are past their due date.` }}
                >
                  <Link to="/firm/receivables" className="ov-link">Open receivables</Link>
                </KpiTile>
              </div>
              <KpiTile
                label="Utilization"
                value={formatPercent(data.utilization.value)}
                complete={data.utilization.missing.length === 0}
                missing={data.utilization.missing}
                delta={{ text: data.utilization.missing.length ? `Billable share of logged hours. Missing: ${data.utilization.missing.join(', ')}.` : 'Billable share of logged hours this month.' }}
              >
                <Link to="/firm/people" className="ov-link">See people</Link>
              </KpiTile>
              <KpiTile label="Approvals waiting" value={approvals ? String(approvals.count) : '0'} delta={{ text: 'Timesheets, leave, expenses, bills and changes.' }}>
                <Link to="/firm/approvals" className="ov-link">Open approvals</Link>
              </KpiTile>
            </>
          )}
      </section>

      <div className="ov-columns">
        <AttentionRows items={data?.attention ?? []} state={state === 'ready' && !data ? 'loading' : state} onRetry={retry} />
        <div className="ov-side">
          {projects.data && projects.data.length > 0 && <ProjectRows projects={projects.data} finance={finance} />}
          <section className="ov-section ov-queues" aria-labelledby="ov-queues-h">
            <header className="ov-section__head"><h2 id="ov-queues-h" className="t-h2">Queues</h2></header>
            <div className="ov-queues__list">
              {loading
                ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} />)
                : data.queues.map((q) => <QueueCard key={q.key} count={q.count} label={q.label} severity={q.severity} restricted={q.restricted} onClick={() => navigate(q.to)} />)}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function LiveProjectRows({ projects }: { projects: LiveOverviewProject[] }) {
  return (
    <section className="ov-section ov-projects" aria-labelledby="ov-projects-h">
      <header className="ov-section__head">
        <h2 id="ov-projects-h" className="t-h2">Projects</h2>
        <Link to="/firm/projects" className="ov-link">All projects</Link>
      </header>
      <ul className="ov-projects__list">
        {projects.map((p) => (
          <li key={p.code}>
            <Link to={`/firm/projects/${p.code}`} className="ov-project">
              <span className="ov-project__line">
                <span className="ov-project__name">{p.code} {p.name}</span>
              </span>
              <span className="ov-project__line t-body-sm ink-2">
                <span>{p.client}</span>
                {p.fee.restricted
                  ? <RestrictedCell reason="Fee needs billing or receivables permission" />
                  : <span className="t-numeric">Fee {formatINR(p.fee.value)}</span>}
              </span>
              <span className="ov-project__progress">
                <StatusChip size="sm" status={p.status} />
                <span className="ov-project__bar" aria-hidden><span style={{ width: `${Math.max(0, Math.min(100, p.delivery))}%` }} /></span>
                <span className="t-caption ink-2 t-numeric">{p.delivery}% complete{p.overBudget ? ' · over budget' : ''}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LiveFigures({ data }: { data: LiveOverview }) {
  const { readyToBill: ready, overdue, utilization: u, approvalsWaiting: w } = data;
  const hoursText = `${formatGrouped(u.billableHours)} h of ${formatGrouped(u.availableHours)} h available`;
  return (
    <>
      <KpiTile
        label="Ready to bill"
        restricted={ready.restricted}
        value={ready.restricted ? undefined : formatINR(ready.value.amount)}
        complete={ready.restricted || ready.value.complete}
        missing={ready.restricted ? [] : ready.value.missing}
        delta={{ text: 'Approved time and fee stages not yet invoiced.' }}
      >
        <Link to="/firm/billing" className="ov-link">Prepare invoices</Link>
      </KpiTile>
      <div className="ov-figure--overdue">
        <KpiTile
          label="Overdue"
          restricted={overdue.restricted}
          value={overdue.restricted ? undefined : formatINR(overdue.value.amount)}
          delta={overdue.restricted ? undefined : { text: overdue.value.count === 1 ? 'One invoice is past its due date.' : `${overdue.value.count} invoices are past their due date.` }}
        >
          <Link to="/firm/receivables" className="ov-link">Open receivables</Link>
        </KpiTile>
      </div>
      <KpiTile
        label="Utilization"
        value={u.value == null ? 'No hours' : formatPercent(u.value)}
        complete={u.complete}
        missing={u.missing}
        delta={{ text: `Approved billable hours this month: ${hoursText}.${u.missing.length ? ` Missing: ${u.missing.join(', ')}.` : ''}` }}
      />
      <KpiTile
        label="Approvals waiting"
        value={String(w.count)}
        delta={{ text: w.count === 0 ? 'Nothing is waiting for your decision.' : `Waiting for you; the oldest for ${w.oldestDays} ${w.oldestDays === 1 ? 'day' : 'days'}.` }}
      >
        <Link to="/firm/approvals" className="ov-link">Open approvals</Link>
      </KpiTile>
    </>
  );
}

/** Live mode: every figure, row and project comes from GET /overview. The sample queues have no endpoint, so they are not shown. */
function LiveOverviewScreen() {
  const { viewer } = useSession();
  const [denied, setDenied] = useState(false);
  const { state, data, retry } = useResource(
    () => getLiveOverview().catch((e: unknown) => { if (e instanceof ApiFailure && e.status === 403) setDenied(true); throw e; }),
    [viewer.id],
  );
  const first = viewer.name.split(' ')[0];
  const listState: ListState = denied ? 'denied' : state === 'ready' && !data ? 'loading' : state;
  const shown = listState === 'ready' && data ? data : null;
  return (
    <div className="scr-overview">
      <PageHeader
        display
        title={`Good afternoon, ${first}`}
        meta={<span className="t-body ink-2">{shown ? needs(shown.attention.length) : 'This week in the studio.'}</span>}
        secondaryActions={<Link to="/firm/approvals" className="btn btn--secondary">Review approvals</Link>}
        primaryAction={<Link to="/firm/billing" className="btn btn--primary">Prepare invoices</Link>}
      />

      {listState !== 'denied' && listState !== 'error' && (
        <section className="ov-figures" aria-label="Key figures">
          {shown ? <LiveFigures data={shown} /> : Array.from({ length: 4 }, (_, i) => <Skeleton key={i} kind="card" />)}
        </section>
      )}

      <div className="ov-columns">
        <AttentionRows items={shown ? shown.attention : []} state={listState} onRetry={retry} />
        <div className="ov-side">
          {shown && shown.projects.length > 0 && <LiveProjectRows projects={shown.projects} />}
        </div>
      </div>
    </div>
  );
}
