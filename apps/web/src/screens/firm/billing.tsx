import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getAccounting, getDrafts, getNteExceptions, getPeople, getReadyToBill, getWip, hasFinanceAccess, personName, type BillingDraft, type NteException, type ReadyItem } from '../../api';
import { useResource } from '../../api/useResource';
import { useSession } from '../../app/session';
import { Button } from '../../ui/Button';
import { DataTable, type Column } from '../../ui/DataTable';
import { InlineAlert } from '../../ui/InlineAlert';
import { ListStateBlock } from '../../ui/ListState';
import { PageHeader } from '../../ui/PageHeader';
import { PermissionDenied } from '../../ui/PermissionDenied';
import { Sheet } from '../../ui/Sheet';
import { StatusChip } from '../../ui/StatusChip';
import { useToast } from '../../ui/Toast';
import { formatINR } from '../../ui/format';
import { GenerateDraftSheet } from './generate-draft-sheet';
import { GoTo } from '../shared/go-to';

const TABS = [
  { key: 'ready', label: 'Ready to bill' }, { key: 'drafts', label: 'Drafts' }, { key: 'exceptions', label: 'Exceptions' }, { key: 'wip', label: 'WIP' }, { key: 'accounting', label: 'Accounting' },
];
const projectLabel = (r: { project: string; projectName: string }) => `${r.project} ${r.projectName}`;
type WipRow = { project: string; name: string; entitled: number; invoiced: number };

const readyColumns: Column<ReadyItem>[] = [
  { key: 'project', header: 'Project', value: projectLabel, sortable: true },
  { key: 'component', header: 'Fee component', value: (r) => r.component },
  { key: 'basis', header: 'Basis', value: (r) => r.basis },
  { key: 'amount', header: 'Amount', type: 'money', value: (r) => r.amount, sortable: true, total: (l) => l.reduce((s, x) => s + x.amount, 0) },
  { key: 'status', header: 'Status', type: 'status', value: (r) => r.status },
];
const exceptionColumns: Column<NteException>[] = [
  { key: 'project', header: 'Project', value: projectLabel },
  { key: 'title', header: 'Exception', value: (n) => n.title },
  { key: 'eligible', header: 'Eligible', type: 'money', value: (n) => n.eligible },
  { key: 'excess', header: 'Excess', type: 'money', value: (n) => n.excess },
  { key: 'status', header: 'Status', type: 'status', value: (n) => n.status },
];
const wipColumns: Column<WipRow>[] = [
  { key: 'project', header: 'Project', value: (w) => `${w.project} ${w.name}`, sortable: true },
  { key: 'entitled', header: 'Entitled', type: 'money', value: (w) => w.entitled, total: (l) => l.reduce((s, x) => s + x.entitled, 0) },
  { key: 'invoiced', header: 'Invoiced', type: 'money', value: (w) => w.invoiced, total: (l) => l.reduce((s, x) => s + x.invoiced, 0) },
  { key: 'wip', header: 'WIP', type: 'money', value: (w) => w.entitled - w.invoiced, sortable: true, total: (l) => l.reduce((s, x) => s + x.entitled - x.invoiced, 0) },
];

function DraftDetail({ draft, onSubmit }: { draft: BillingDraft; onSubmit: () => void }) {
  const columns: Column<BillingDraft['lines'][number]>[] = [
    { key: 'name', header: 'Line', value: (l) => l.name },
    { key: 'source', header: 'Source', value: (l) => l.source },
    { key: 'qty', header: 'Qty', type: 'number', value: (l) => l.qty },
    { key: 'amount', header: 'Amount', type: 'money', value: (l) => l.amount, total: (r) => r.reduce((s, x) => s + x.amount, 0) },
  ];
  return (
    <section className="stack-4" aria-labelledby="draft-title">
      <div className="toolbar toolbar--between">
        <div className="stacked">
          <span className="toolbar"><h2 id="draft-title" className="t-code-title">{draft.id}</h2><StatusChip size="sm" status={draft.status} /></span>
          <span className="t-body-sm ink-2">{projectLabel(draft)} · Prepared by {personName(draft.preparedBy)}</span>
        </div>
        <Button variant="primary" disabled={draft.status !== 'Approved'} onClick={onSubmit}>Submit to accounting</Button>
      </div>
      <div className="two-pane">
        <DataTable
          key={draft.id} label={`${draft.id} lines`} columns={columns} rows={draft.lines} rowKey={(l) => l.id}
          expand={{ isExpandable: (l) => !!l.detail, defaultOpen: draft.lines.filter((l) => l.detail).map((l) => l.id), render: (l) => <p className="t-body-sm">{l.detail}</p> }}
        />
        <aside className="solid-panel panel" aria-labelledby="calc-title">
          <h3 id="calc-title" className="t-h3">Calculation basis</h3>
          <dl className="calc">
            {draft.basis.map((b) => <div key={b.label} style={{ display: 'contents' }}><dt>{b.label}</dt><dd className={b.danger ? 'calc__danger' : undefined}>{b.value}</dd></div>)}
          </dl>
          {draft.note && <p className="t-caption ink-2">{draft.note}</p>}
        </aside>
      </div>
    </section>
  );
}

export function BillingScreen() {
  const { viewer } = useSession();
  const [params] = useSearchParams();
  const toast = useToast();
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab')! : 'ready';
  const ready = useResource(() => getReadyToBill(), []);
  const drafts = useResource(() => getDrafts(), []);
  const nte = useResource(() => getNteExceptions(), []);
  const wip = useResource(getWip, []);
  const acct = useResource(getAccounting, []);
  const people = useResource(getPeople, []);
  const [generating, setGenerating] = useState(false);
  const [selected, setSelected] = useState('DRAFT-0012');
  const [submitting, setSubmitting] = useState(false);
  const [finalized, setFinalized] = useState<string[]>([]);
  const draftRows = useMemo(() => (drafts.data ?? []).map((d) => (finalized.includes(d.id) ? { ...d, status: 'Finalized' as const } : d)), [drafts.data, finalized]);
  const draft = draftRows.find((d) => d.id === selected) ?? draftRows[0];
  const total = (ready.data ?? []).reduce((s, r) => s + r.amount, 0);
  const excess = (nte.data ?? []).reduce((s, n) => s + n.excess, 0);

  if (!hasFinanceAccess(viewer)) {
    return (<><PageHeader title="Billing" /><div className="solid-panel"><PermissionDenied capability="finance" /></div></>);
  }
  const draftColumns: Column<BillingDraft>[] = [
    { key: 'id', header: 'Draft', value: (d) => d.id, render: (d) => <span className="t-numeric">{d.id}</span> },
    { key: 'project', header: 'Project', value: projectLabel },
    { key: 'by', header: 'Prepared by', type: 'person', value: (d) => personName(d.preparedBy) },
    { key: 'amount', header: 'Amount', type: 'money', value: (d) => d.amount },
    { key: 'status', header: 'Status', type: 'status', value: (d) => d.status },
  ];
  return (
    <>
      <PageHeader
        title="Billing"
        meta={ready.state === 'ready' && <span className="t-body-sm ink-2">Ready to bill <span className="t-numeric">{formatINR(total)}</span></span>}
        primaryAction={<Button variant="primary" onClick={() => setGenerating(true)}>Generate billing draft</Button>}
        tabs={TABS.map((t) => ({ label: t.label, to: `?tab=${t.key}`, active: t.key === tab }))}
      />
      {tab === 'ready' && <DataTable label="Ready to bill" columns={readyColumns} rows={ready.data ?? []} rowKey={(r) => r.id} state={ready.state === 'ready' && !ready.data?.length ? 'empty' : ready.state} onRetry={ready.retry} capability="finance" empty={{ message: 'Nothing is ready to bill right now.', action: <GoTo to="?tab=wip">See work in progress</GoTo> }} />}
      {tab === 'drafts' && (
        <>
          <DataTable label="Billing drafts" columns={draftColumns} rows={draftRows} rowKey={(d) => d.id} density="dense" state={drafts.state === 'ready' && !draftRows.length ? 'empty' : drafts.state} onRetry={drafts.retry} capability="finance" onRowClick={(d) => setSelected(d.id)} activeKey={draft?.id} empty={{ message: 'No billing drafts yet.', action: <Button variant="primary" onClick={() => setGenerating(true)}>Generate billing draft</Button> }} />
          {drafts.state === 'ready' && draft && <DraftDetail draft={draft} onSubmit={() => setSubmitting(true)} />}
        </>
      )}
      {tab === 'exceptions' && <DataTable label="Billing exceptions" columns={exceptionColumns} rows={nte.data ?? []} rowKey={(n) => n.id} state={nte.state === 'ready' && !nte.data?.length ? 'empty' : nte.state} onRetry={nte.retry} capability="finance" empty={{ message: 'No billing exceptions right now.', action: <GoTo to="?tab=ready">See ready to bill</GoTo> }} />}
      {tab === 'wip' && <DataTable label="Work in progress" columns={wipColumns} rows={wip.data ?? []} rowKey={(w) => w.project} state={wip.state === 'ready' && !wip.data?.length ? 'empty' : wip.state} onRetry={wip.retry} capability="finance" empty={{ message: 'No work in progress.', action: <GoTo to="/firm/projects">Open projects</GoTo> }} />}
      {tab === 'accounting' && (acct.state !== 'ready' || !acct.data
        ? <ListStateBlock state={acct.state === 'ready' ? 'loading' : acct.state} label="Accounting" onRetry={acct.retry} capability="finance" empty={{ message: 'No accounting adapter is set up.', action: <GoTo to="/firm/settings/integrations">Open Integrations</GoTo> }} />
        : (
          <section className="solid-panel panel" aria-labelledby="adapter" style={{ maxWidth: 560 }}>
            <div className="panel__head"><h2 id="adapter" className="t-h2">Accounting adapter</h2><StatusChip size="sm" status={acct.data.mode} /></div>
            <dl className="def-list">
              <dt>Adapter</dt><dd>{acct.data.adapter}</dd>
              <dt>Status</dt><dd><StatusChip size="sm" status={acct.data.status} /></dd>
              <dt>Last success</dt><dd className="t-numeric">{acct.data.lastSuccess}</dd>
              <dt>Sent</dt><dd>{acct.data.sent}</dd>
            </dl>
            <p className="t-caption ink-2">Nothing reaches a real ledger while this adapter is MOCK.</p>
          </section>
        ))}
      <GenerateDraftSheet open={generating} onClose={() => setGenerating(false)} items={ready.data ?? []} excess={excess} people={people.data ?? []} />
      <Sheet
        open={submitting} onClose={() => setSubmitting(false)} title="Submit to accounting" description={draft?.id}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setSubmitting(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => { setFinalized((f) => [...f, draft.id]); setSubmitting(false); toast({ variant: 'success', message: `${draft.id} finalized through the mock adapter.` }); }}>Submit draft</Button>
          </>
        )}
      >
        {draft && acct.data && (
          <div className="stack-4">
            <p className="toolbar"><StatusChip status={acct.data.mode} /><span className="t-body-sm"><span className="t-numeric">{draft.id}</span> goes to the {acct.data.adapter} and becomes a finalized invoice.</span></p>
            <dl className="calc"><dt>Draft total</dt><dd className="calc__strong">{formatINR(draft.amount)}</dd><dt>Client</dt><dd>{draft.client}</dd></dl>
            <InlineAlert variant="warn" title="No real ledger entry is made">This stays true while the adapter is MOCK.</InlineAlert>
          </div>
        )}
      </Sheet>
    </>
  );
}
