import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Lock, Paperclip } from 'lucide-react';
import { getOpportunity, getPeople, getProposal } from '../../api';
import { useResource } from '../../api/useResource';
import { Button } from '../../ui/Button';
import { DataTable, type Column } from '../../ui/DataTable';
import { EffectiveDatedList } from '../../ui/EffectiveDatedList';
import { EmptyState } from '../../ui/EmptyState';
import { ListStateBlock } from '../../ui/ListState';
import { PageHeader } from '../../ui/PageHeader';
import { StatusChip } from '../../ui/StatusChip';
import { useToast } from '../../ui/Toast';
import { formatDate } from '../../ui/format';
import { CreateProjectSheet } from './create-project-sheet';
import { GoTo } from '../shared/go-to';
import { isLive } from '../../api/live';
import { NotAvailablePage } from '../../ui/NotAvailable';

type PhaseRow = { name: string; start: string; end: string; hours: number };
type FeeRow = { name: string; method: string; amount: number };
type MilestoneRow = { name: string; due: string; amount: number };

const phaseColumns: Column<PhaseRow>[] = [
  { key: 'name', header: 'Phase', value: (p) => p.name },
  { key: 'dates', header: 'Dates', value: (p) => p.start, render: (p) => <span className="t-numeric" style={{ whiteSpace: 'nowrap' }}>{formatDate(p.start)} to {formatDate(p.end)}</span> },
  { key: 'hours', header: 'Hours', type: 'number', value: (p) => p.hours, total: (r) => r.reduce((s, x) => s + x.hours, 0) },
];
const feeColumns: Column<FeeRow>[] = [
  { key: 'name', header: 'Fee component', value: (f) => f.name },
  { key: 'method', header: 'Method', value: (f) => f.method, render: (f) => <span className="chip chip--sm tone-neutral">{f.method}</span> },
  { key: 'amount', header: 'Amount', type: 'money', value: (f) => f.amount, total: (r) => r.reduce((s, x) => s + x.amount, 0) },
];
const milestoneColumns: Column<MilestoneRow>[] = [
  { key: 'name', header: 'Billing milestone', value: (m) => m.name },
  { key: 'due', header: 'Due', type: 'date', value: (m) => m.due },
  { key: 'amount', header: 'Amount', type: 'money', value: (m) => m.amount, total: (r) => r.reduce((s, x) => s + x.amount, 0) },
];

function MockProposalScreen() {
  const { id = '' } = useParams();
  const toast = useToast();
  const { state, data: p, retry } = useResource(() => getProposal(id), [id]);
  const people = useResource(getPeople, []);
  const [creating, setCreating] = useState(false);
  const opp = getOpportunity(id);
  const crumb = [{ label: 'Pipeline', to: '/firm/pipeline' }, { label: p?.name ?? opp?.name ?? id }];

  if (state === 'ready' && !p) {
    return (
      <>
        <PageHeader title={opp?.name ?? 'Proposal'} subtitle={opp?.client} breadcrumb={crumb} />
        <div className="solid-panel">
          <EmptyState
            message={opp ? 'This opportunity has no proposal yet.' : 'No proposal has that reference.'}
            action={opp ? <Button variant="primary" onClick={() => toast({ variant: 'info', message: 'Proposal editing arrives with the backend.' })}>Start proposal</Button> : undefined}
          />
        </div>
      </>
    );
  }
  if (state !== 'ready' || !p) {
    return (
      <>
        <PageHeader title={opp?.name ?? 'Proposal'} breadcrumb={crumb} />
        <ListStateBlock state={state === 'ready' ? 'empty' : state} label="This proposal" rows={8} onRetry={retry} capability="view proposals" empty={{ message: 'This proposal has no content yet.', action: <GoTo to="/firm/pipeline">Back to Pipeline</GoTo> }} />
      </>
    );
  }
  const current = p.versions.length - 1;
  return (
    <>
      <PageHeader
        title={p.name} subtitle={p.client} breadcrumb={crumb}
        meta={(
          <>
            <span className="chip chip--sm tone-neutral t-numeric">{p.version}</span>
            <StatusChip size="sm" status={p.state} />
            {p.locked && <span className="prio t-body-sm ink-2"><Lock size={14} strokeWidth={1.5} aria-hidden />Accepted versions are read-only</span>}
          </>
        )}
        primaryAction={p.locked && <Button variant="primary" onClick={() => setCreating(true)}>Create project</Button>}
      />
      <div className="cols-8-4">
        <div className="stack-4">
          <section className="solid-panel panel" aria-labelledby="scope">
            <h2 id="scope" className="t-h3">Scope and exclusions</h2>
            <p className="t-body-sm">{p.scope}</p>
            <p className="t-body-sm ink-2">{p.exclusions}</p>
          </section>
          <DataTable label="Phases" columns={phaseColumns} rows={p.phases} rowKey={(x) => x.name} density="dense" />
          <DataTable label="Fee components" columns={feeColumns} rows={p.fees} rowKey={(x) => x.name} density="dense" />
          <DataTable label="Billing milestones" columns={milestoneColumns} rows={p.milestones} rowKey={(x) => x.name} density="dense" />
          <section className="solid-panel panel" aria-labelledby="terms">
            <h2 id="terms" className="t-h3">Terms</h2>
            <p className="t-body-sm">{p.terms}</p>
          </section>
        </div>
        <div className="stack-4">
          <section className="card glass" aria-labelledby="versions">
            <h2 id="versions" className="t-h2">Versions</h2>
            <EffectiveDatedList versions={p.versions} current={current} />
          </section>
          <section className="card glass" aria-labelledby="evidence">
            <h2 id="evidence" className="t-h2">Acceptance evidence</h2>
            {p.evidence
              ? (
                <div className="preview__thumb">
                  <Paperclip size={16} strokeWidth={1.5} aria-hidden />
                  <span><span>{p.evidence.name}</span><br /><span className="ink-2">{p.evidence.by} · <span className="t-numeric">{formatDate(p.evidence.date)}</span></span></span>
                </div>
              )
              : <p className="t-body-sm ink-2">Not accepted yet.</p>}
          </section>
        </div>
      </div>
      <CreateProjectSheet open={creating} onClose={() => setCreating(false)} people={people.data ?? []} proposal={p} />
    </>
  );
}

/** Live mode has no API for this yet: the honest empty state, never the sample studio. */
export function ProposalScreen() {
  return isLive ? <NotAvailablePage title="Proposal" detail="The proposal, its fee and its versions, once proposals are connected." /> : <MockProposalScreen />;
}
