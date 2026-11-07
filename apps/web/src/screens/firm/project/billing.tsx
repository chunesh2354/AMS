import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getDrafts, getFeeComponents, getNteExceptions, getPeople, getReadyToBill, hasFinanceAccess, personName, type BillingDraft, type ReadyItem } from '../../../api';
import { useResource } from '../../../api/useResource';
import { useSession } from '../../../app/session';
import { Button } from '../../../ui/Button';
import { DataTable, RESTRICTED, type Column } from '../../../ui/DataTable';
import { EntitlementBar } from '../../../ui/EntitlementBar';
import { RestrictedCell } from '../../../ui/RestrictedCell';
import { Skeleton } from '../../../ui/Skeleton';
import { ListStateBlock } from '../../../ui/ListState';
import { StatusChip } from '../../../ui/StatusChip';
import { formatINR } from '../../../ui/format';
import { GenerateDraftSheet } from '../generate-draft-sheet';
import { GoTo } from '../../shared/go-to';

export function ProjectBillingScreen() {
  const { id = '' } = useParams();
  const { viewer } = useSession();
  const finance = hasFinanceAccess(viewer);
  const components = useResource(() => getFeeComponents(id), [id]);
  const ready = useResource(() => getReadyToBill(id), [id]);
  const drafts = useResource(() => getDrafts(id), [id]);
  const nte = useResource(() => getNteExceptions(id), [id]);
  const people = useResource(getPeople, []);
  const [generating, setGenerating] = useState(false);
  const money = <T,>(pick: (r: T) => number) => (r: T) => (finance ? pick(r) : RESTRICTED);
  const readyColumns: Column<ReadyItem>[] = [
    { key: 'component', header: 'Fee component', value: (r) => r.component },
    { key: 'basis', header: 'Basis', value: (r) => r.basis },
    { key: 'amount', header: 'Amount', type: 'money', value: money((r) => r.amount), total: finance ? (l) => l.reduce((s, x) => s + x.amount, 0) : undefined },
    { key: 'status', header: 'Status', type: 'status', value: (r) => r.status },
  ];
  const draftColumns: Column<BillingDraft>[] = [
    { key: 'id', header: 'Draft', value: (d) => d.id, render: (d) => <span className="t-numeric">{d.id}</span> },
    { key: 'by', header: 'Prepared by', type: 'person', value: (d) => personName(d.preparedBy) },
    { key: 'amount', header: 'Amount', type: 'money', value: money((d) => d.amount) },
    { key: 'status', header: 'Status', type: 'status', value: (d) => d.status },
  ];
  const generate = <Button variant="primary" disabled={!finance || !ready.data?.length} onClick={() => setGenerating(true)}>Generate draft</Button>;
  const list = components.data ?? [];
  return (
    <>
      <h2 className="t-h2">Billing</h2>
      {components.state === 'loading'
        ? <Skeleton kind="card" />
        : components.state !== 'ready'
          ? <ListStateBlock state={components.state} label="Fee components" onRetry={components.retry} capability="view project billing" empty={{ message: 'This project has no fee components yet.', action: <GoTo to={`/firm/projects/${id}`}>See project overview</GoTo> }} />
          : (
            <div className="stack-4">
              {list.map((c) => (
                <section key={c.name} className="card glass" aria-label={c.name}>
                  <div className="panel__head"><h3 className="t-h3">{c.name}</h3><span className="chip chip--sm tone-neutral">{c.method}</span></div>
                  <EntitlementBar {...c.entitlement} />
                </section>
              ))}
            </div>
          )}
      <div className="two-pane">
        <div className="stack-4">
          <div className="toolbar toolbar--between"><h3 className="t-h3">Ready to bill</h3>{generate}</div>
          <DataTable label="Ready to bill" columns={readyColumns} rows={ready.data ?? []} rowKey={(r) => r.id} density="dense" state={ready.state === 'ready' && !ready.data?.length ? 'empty' : ready.state} onRetry={ready.retry} capability="view project billing" empty={{ message: 'Nothing is ready to bill on this project.', action: <GoTo to={`/firm/projects/${id}/time`}>Review project time</GoTo> }} />
          <h3 className="t-h3">Drafts</h3>
          <DataTable label="Drafts" columns={draftColumns} rows={drafts.data ?? []} rowKey={(d) => d.id} density="dense" state={drafts.state === 'ready' && !drafts.data?.length ? 'empty' : drafts.state} onRetry={drafts.retry} capability="view project billing" empty={{ message: 'No billing drafts on this project yet.', action: <GoTo to="/firm/billing">Open Billing</GoTo> }} />
        </div>
        <aside className="solid-panel panel" aria-labelledby="nte-title">
          <h3 id="nte-title" className="t-h3">NTE exceptions</h3>
          {nte.state === 'empty'
            ? <p className="t-body-sm ink-2">No exceptions on this project.</p>
            : nte.state !== 'ready'
            ? <ListStateBlock state={nte.state} label="NTE exceptions" rows={3} onRetry={nte.retry} capability="view project billing" />
            : nte.data?.length
              ? nte.data.map((n) => (
                <div key={n.id} className="stack-rows">
                  <p className="t-body-sm">{finance
                    ? <>Hourly work is capped at <span className="t-numeric">{formatINR(n.limit)}</span>. Billed to date <span className="t-numeric">{formatINR(n.billed)}</span>.</>
                    : 'Hourly work has reached its limit.'}</p>
                  <dl className="calc">
                    <dt>Requested</dt><dd>{finance ? formatINR(n.requested) : <RestrictedCell />}</dd>
                    <dt>Eligible</dt><dd>{finance ? formatINR(n.eligible) : <RestrictedCell />}</dd>
                    <dt>Excess</dt><dd className="calc__danger">{finance ? formatINR(n.excess) : <RestrictedCell />}</dd>
                  </dl>
                  <div className="panel__head">
                    <StatusChip size="sm" status={n.status} />
                    <Link to={`/firm/projects/${id}/changes?new=1`}>Raise a change</Link>
                  </div>
                  <p className="t-caption ink-2">Excess is not billable without a change.</p>
                </div>
              ))
              : <p className="t-body-sm ink-2">No exceptions on this project.</p>}
        </aside>
      </div>
      <GenerateDraftSheet open={generating} onClose={() => setGenerating(false)} items={ready.data ?? []} excess={nte.data?.reduce((s, n) => s + n.excess, 0)} people={people.data ?? []} />
    </>
  );
}
