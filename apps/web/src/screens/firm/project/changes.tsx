import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { getChanges, getProjectPhaseOptions, type ChangeRequest } from '../../../api';
import { useResource } from '../../../api/useResource';
import { Button } from '../../../ui/Button';
import { DataTable, type Column } from '../../../ui/DataTable';
import { FileDrop } from '../../../ui/FileDrop';
import { FilterBar, type FilterDef } from '../../../ui/FilterBar';
import { Form, FormSection } from '../../../ui/Form';
import { MoneyField } from '../../../ui/MoneyField';
import { NumberField } from '../../../ui/NumberField';
import { Select } from '../../../ui/Select';
import { Sheet } from '../../../ui/Sheet';
import { TextField } from '../../../ui/TextField';
import { useToast } from '../../../ui/Toast';
import { formatDate, formatGrouped, formatINR } from '../../../ui/format';
import { isLive } from '../../../api/live';
import { NotAvailable } from '../../../ui/NotAvailable';

const signed = (v: number, text: string) => (v > 0 ? `+${text}` : text);

function ChangeSheet({ open, change, onClose, phases }: { open: boolean; change: ChangeRequest | null; onClose: () => void; phases: { id: string; name: string }[] }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [hours, setHours] = useState('');
  const [fee, setFee] = useState<number | null>(null);
  const [days, setDays] = useState('');
  const [phase, setPhase] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [seen, setSeen] = useState(false);
  if (open && !seen) {
    setSeen(true); setTried(false);
    setTitle(change?.title ?? ''); setHours(change ? String(change.hours) : ''); setFee(change?.fee ?? null); setDays(change ? String(change.days) : ''); setPhase(change?.phase ?? null);
  }
  if (!open && seen) setSeen(false);
  const save = () => {
    if (!title.trim() || hours === '' || !phase) { setTried(true); return; }
    toast({ variant: 'success', message: `Estimate for ${title.trim()} is ready. Nothing is saved in this demo.` });
    onClose();
  };
  return (
    <Sheet
      open={open} onClose={onClose} title={change ? change.title : 'Raise a change'} description={change ? 'Change' : 'Estimate it before work starts.'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save estimate</Button></>}
    >
      <Form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <FormSection>
          <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} error={tried && !title.trim() ? 'Name the change' : undefined} />
          <Select label="Phase" options={phases.map((p) => ({ value: p.id, label: p.name }))} value={phase} onChange={setPhase} error={tried && !phase ? 'Choose a phase' : undefined} />
        </FormSection>
        <FormSection title="Estimate" columns={2}>
          <NumberField label="Hours Δ" value={hours} onChange={(e) => setHours(e.target.value)} error={tried && hours === '' ? 'Enter hours' : undefined} />
          <MoneyField label="Fee Δ" value={fee} onChange={setFee} />
          <NumberField label="Date Δ (days)" value={days} onChange={(e) => setDays(e.target.value)} />
        </FormSection>
        <FormSection title="Evidence">
          {change?.evidence.length ? <ul className="link-list">{change.evidence.map((d) => <li key={d.name}><span>{d.name}</span><span className="t-numeric ink-2">{formatDate(d.date)}</span></li>)}</ul> : null}
          <FileDrop label="Add evidence" accept="image/*,.pdf,.eml" />
        </FormSection>
      </Form>
    </Sheet>
  );
}

function MockProjectChangesScreen() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const { state, data, retry } = useResource(() => getChanges(id), [id]);
  const [sheet, setSheet] = useState<{ open: boolean; change: ChangeRequest | null }>({ open: params.get('new') === '1', change: null });
  const all = data ?? [];
  const rows = all.filter((c) => !params.get('state') || c.state === params.get('state'));
  const filters: FilterDef[] = [{ type: 'select', key: 'state', label: 'State', options: [...new Set(all.map((c) => c.state as string))].map((s) => ({ value: s, label: s })) }];
  const columns: Column<ChangeRequest>[] = [
    { key: 'title', header: 'Title', value: (c) => c.title, sortable: true },
    { key: 'state', header: 'State', type: 'status', value: (c) => c.state },
    { key: 'hours', header: 'Hours Δ', type: 'number', value: (c) => c.hours, render: (c) => signed(c.hours, formatGrouped(c.hours)) },
    { key: 'fee', header: 'Fee Δ', type: 'money', value: (c) => c.fee, render: (c) => signed(c.fee, formatINR(c.fee)) },
    { key: 'days', header: 'Date Δ (d)', type: 'number', value: (c) => c.days, render: (c) => signed(c.days, formatGrouped(c.days)) },
    { key: 'authorization', header: 'Authorization', value: (c) => c.authorization },
  ];
  const raise = <Button variant="primary" onClick={() => setSheet({ open: true, change: null })}>Raise a change</Button>;
  return (
    <>
      <div className="toolbar toolbar--between"><h2 className="t-h2">Changes</h2>{raise}</div>
      <FilterBar filters={filters} />
      <DataTable
        label="Project changes" columns={columns} rows={rows} rowKey={(c) => c.id} state={state === 'ready' && !rows.length ? 'empty' : state} onRetry={retry}
        capability="view project changes" onRowClick={(c) => setSheet({ open: true, change: c })} empty={{ message: 'No changes have been raised on this project.', action: raise }}
      />
      <ChangeSheet open={sheet.open} change={sheet.change} onClose={() => setSheet({ open: false, change: null })} phases={getProjectPhaseOptions().find((p) => p.code === id)?.phases ?? []} />
    </>
  );
}

/** Live mode has no API for this yet: the honest empty state, never the sample studio. */
export function ProjectChangesScreen() {
  return isLive ? <><h2 className="t-h2">Changes</h2><div className="solid-panel"><NotAvailable detail="Change requests and the fee and scope changes they bring." /></div></> : <MockProjectChangesScreen />;
}
