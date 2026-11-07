import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getOpportunities, getPeople, personName, type Opportunity, type OpportunityStage } from '../../api';
import { useResource } from '../../api/useResource';
import { TODAY } from '../../mock/studio-meridian';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { DataTable, type Column } from '../../ui/DataTable';
import { DateField } from '../../ui/DateField';
import { FilterBar, type FilterDef } from '../../ui/FilterBar';
import { Form, FormSection } from '../../ui/Form';
import { KanbanBoard } from '../../ui/KanbanBoard';
import { ListStateBlock } from '../../ui/ListState';
import { MoneyField } from '../../ui/MoneyField';
import { PageHeader } from '../../ui/PageHeader';
import { PersonPicker } from '../../ui/PersonPicker';
import { Segmented } from '../../ui/Segmented';
import { Sheet } from '../../ui/Sheet';
import { StatusChip } from '../../ui/StatusChip';
import { TextField } from '../../ui/TextField';
import { useToast } from '../../ui/Toast';
import { formatDate, formatINR } from '../../ui/format';

const STAGES: OpportunityStage[] = ['New', 'Qualified', 'Proposal', 'Won', 'Lost', 'On hold'];

function Card({ o }: { o: Opportunity }) {
  const owner = personName(o.ownerId);
  return (
    <>
      <span className="t-caption ink-2">{o.client}</span>
      <span className="bcard__title">{o.name}</span>
      <span className="t-numeric">{formatINR(o.fee)}</span>
      <span className="bcard__meta">
        <Avatar name={owner} size={20} />
        {o.next ? <span>Next action <span className="t-numeric ink-2">{formatDate(o.next)}</span></span> : <span>No next action</span>}
      </span>
      {o.overdue && <StatusChip size="sm" status="Overdue" />}
    </>
  );
}

function AddOpportunitySheet({ open, onClose, people, onAdd }: { open: boolean; onClose: () => void; people: { id: string; name: string; title: string }[]; onAdd: (o: Opportunity) => void }) {
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [fee, setFee] = useState<number | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const close = () => { setName(''); setClient(''); setFee(null); setOwner(null); setNext(null); setTried(false); onClose(); };
  const save = () => {
    if (!name.trim() || !client.trim() || !owner) { setTried(true); return; }
    onAdd({ id: `OPP-${name}`, stage: 'New', name: name.trim(), client: client.trim(), fee: fee ?? 0, ownerId: owner, next });
    close();
  };
  return (
    <Sheet open={open} onClose={close} title="Add opportunity" dirty={name !== '' || client !== ''} footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="primary" onClick={save}>Add opportunity</Button></>}>
      <Form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <FormSection>
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} error={tried && !name.trim() ? 'Name the opportunity' : undefined} />
          <TextField label="Client" value={client} onChange={(e) => setClient(e.target.value)} error={tried && !client.trim() ? 'Name the client' : undefined} />
          <MoneyField label="Estimated fee" value={fee} onChange={setFee} />
          <PersonPicker label="Owner" people={people} value={owner} onChange={setOwner} error={tried && !owner ? 'Choose an owner' : undefined} />
          <DateField label="Next action" value={next} onChange={setNext} today={TODAY} />
        </FormSection>
      </Form>
    </Sheet>
  );
}

export function PipelineScreen() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const { state, data, retry } = useResource(getOpportunities, []);
  const people = useResource(getPeople, []);
  const [added, setAdded] = useState<Opportunity[]>([]);
  const [moved, setMoved] = useState<Record<string, OpportunityStage>>({});
  const [adding, setAdding] = useState(false);
  const view = params.get('view') === 'list' ? 'list' : 'board';
  const all = useMemo(() => [...(data ?? []), ...added].map((o) => (moved[o.id] ? { ...o, stage: moved[o.id] } : o)), [data, added, moved]);
  const rows = all.filter((o) => !params.get('owner') || o.ownerId === params.get('owner'));
  const filters: FilterDef[] = [{ type: 'select', key: 'owner', label: 'Owner', options: [...new Set(all.map((o) => o.ownerId))].map((o) => ({ value: o, label: personName(o) })) }];
  const open = (o: Opportunity) => navigate(`/firm/proposals/${o.proposalId ?? o.id}`);
  const columns: Column<Opportunity>[] = [
    { key: 'name', header: 'Name', value: (o) => o.name, sortable: true },
    { key: 'client', header: 'Client', value: (o) => o.client, sortable: true },
    { key: 'stage', header: 'Stage', type: 'status', value: (o) => o.stage, sortable: true },
    { key: 'fee', header: 'Est. fee', type: 'money', value: (o) => o.fee, sortable: true },
    { key: 'owner', header: 'Owner', type: 'person', value: (o) => personName(o.ownerId) },
    { key: 'next', header: 'Next action', value: (o) => o.next, render: (o) => (o.next ? <span className="chip-row"><span className="t-numeric">{formatDate(o.next)}</span>{o.overdue && <StatusChip size="sm" status="Overdue" />}</span> : <span className="ink-2">None</span>) },
  ];
  const setView = (v: string) => setParams((prev) => { const n = new URLSearchParams(prev); if (v === 'board') n.delete('view'); else n.set('view', v); return n; }, { replace: true });
  const add = <Button variant="primary" onClick={() => setAdding(true)}>Add opportunity</Button>;
  const effective = state === 'ready' && !rows.length ? 'empty' : state;
  return (
    <>
      <PageHeader
        title="Pipeline" meta={state === 'ready' && <span className="t-numeric ink-2">{all.length} opportunities</span>}
        secondaryActions={<Segmented label="View" value={view} onChange={setView} options={[{ value: 'board', label: 'Board' }, { value: 'list', label: 'List' }]} />}
        primaryAction={add}
      />
      <FilterBar filters={filters} />
      {effective !== 'ready'
        ? <ListStateBlock state={effective} label="Pipeline" rows={8} onRetry={retry} capability="view the pipeline" empty={{ message: 'No opportunities yet.', action: add }} />
        : view === 'board'
          ? (
            <KanbanBoard
              label="Pipeline board" itemKey={(o) => o.id} itemLabel={(o) => o.name} renderCard={(o) => <Card o={o} />} onOpen={open}
              onMove={(o, to) => { setMoved((m) => ({ ...m, [o.id]: to as OpportunityStage })); toast({ variant: 'info', message: `${o.name} moved to ${to}.` }); }}
              columns={STAGES.map((s) => ({ key: s, label: s, items: rows.filter((o) => o.stage === s), emptyText: 'Nothing in this stage.' }))}
            />
          )
          : <DataTable label="Opportunities" columns={columns} rows={rows} rowKey={(o) => o.id} onRowClick={open} />}
      <AddOpportunitySheet
        open={adding} onClose={() => setAdding(false)} people={(people.data ?? []).filter((p) => !p.roles.every((r) => r === 'staff')).map((p) => ({ id: p.id, name: p.name, title: p.title }))}
        onAdd={(o) => { setAdded((a) => [...a, o]); toast({ variant: 'success', message: `${o.name} added in this view.` }); }}
      />
    </>
  );
}
