import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Receipt, ReceiptText } from 'lucide-react';
import { getCosts, getProjectPhaseOptions, type Cost } from '../../../api';
import { useResource } from '../../../api/useResource';
import { TODAY } from '../../../mock/studio-meridian';
import { Button } from '../../../ui/Button';
import { CompareColumns } from '../../../ui/CompareColumns';
import { DataTable, type Column } from '../../../ui/DataTable';
import { DateField } from '../../../ui/DateField';
import { FileDrop } from '../../../ui/FileDrop';
import { FilterBar, type FilterDef } from '../../../ui/FilterBar';
import { Form, FormSection } from '../../../ui/Form';
import { InlineAlert } from '../../../ui/InlineAlert';
import { MoneyField } from '../../../ui/MoneyField';
import { NumberField } from '../../../ui/NumberField';
import { Segmented } from '../../../ui/Segmented';
import { Select } from '../../../ui/Select';
import { Sheet } from '../../../ui/Sheet';
import { StatusChip } from '../../../ui/StatusChip';
import { TextField } from '../../../ui/TextField';
import { useToast } from '../../../ui/Toast';
import { formatDate, formatINR } from '../../../ui/format';

const billRows = (c: Cost) => [
  { label: 'Date', value: <span className="t-numeric">{formatDate(c.date)}</span> },
  { label: 'Vendor', value: c.who },
  { label: 'Amount', value: <span className="t-numeric">{formatINR(c.amount)}</span> },
  { label: 'Allocation', value: c.allocation },
  { label: 'Approval', value: <StatusChip size="sm" status={c.approval} /> },
];

function AddCostSheet({ open, onClose, phases }: { open: boolean; onClose: () => void; phases: string[] }) {
  const toast = useToast();
  const [type, setType] = useState<'Bill' | 'Expense'>('Bill');
  const [who, setWho] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState<string | null>(TODAY);
  const [phase, setPhase] = useState<string | null>(null);
  const [markup, setMarkup] = useState('');
  const [tried, setTried] = useState(false);
  const close = () => { setType('Bill'); setWho(''); setAmount(null); setDate(TODAY); setPhase(null); setMarkup(''); setTried(false); onClose(); };
  const save = () => {
    if (!who.trim() || !amount || !phase) { setTried(true); return; }
    toast({ variant: 'success', message: `${type} of ${formatINR(amount)} ready for approval. Nothing is saved in this demo.` });
    close();
  };
  return (
    <Sheet open={open} onClose={close} title="Add cost" dirty={who !== '' || amount != null} footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="primary" onClick={save}>Add cost</Button></>}>
      <Form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <FormSection>
          <div className="field"><span className="field__label">Type</span><Segmented label="Type" value={type} onChange={setType} options={[{ value: 'Bill', label: 'Consultant bill' }, { value: 'Expense', label: 'Expense' }]} /></div>
          <FileDrop label="Bill or receipt" accept="image/*,.pdf" />
          <TextField label={type === 'Bill' ? 'Vendor' : 'Person and description'} value={who} onChange={(e) => setWho(e.target.value)} error={tried && !who.trim() ? 'This is required' : undefined} />
        </FormSection>
        <FormSection columns={2}>
          <MoneyField label="Amount" value={amount} onChange={setAmount} error={tried && !amount ? 'Enter an amount' : undefined} />
          <DateField label="Date" value={date} onChange={setDate} today={TODAY} />
          <Select label="Allocation" options={phases.map((p) => ({ value: p, label: p }))} value={phase} onChange={setPhase} error={tried && !phase ? 'Choose a phase' : undefined} />
          <NumberField label="Markup (%)" value={markup} onChange={(e) => setMarkup(e.target.value)} />
        </FormSection>
      </Form>
    </Sheet>
  );
}

export function ProjectCostsScreen() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const { state, data, retry } = useResource(() => getCosts(id), [id]);
  const [adding, setAdding] = useState(false);
  const [comparing, setComparing] = useState<Cost | null>(null);
  const all = data ?? [];
  const rows = all.filter((c) => (!params.get('type') || c.type === params.get('type')) && (!params.get('approval') || c.approval === params.get('approval')) && (!params.get('payable') || c.payable === params.get('payable')));
  const uniq = (vals: string[]) => [...new Set(vals)].map((v) => ({ value: v, label: v.replace(/ \((approval|accounting)\)$/, '') }));
  const filters: FilterDef[] = [
    { type: 'select', key: 'type', label: 'Type', options: uniq(all.map((c) => c.type)) },
    { type: 'select', key: 'approval', label: 'Approval', options: uniq(all.map((c) => c.approval)) },
    { type: 'select', key: 'payable', label: 'Payable', options: uniq(all.map((c) => c.payable)) },
  ];
  const original = comparing ? all.find((c) => c.id === comparing.duplicateOf) : undefined;
  const columns: Column<Cost>[] = [
    { key: 'date', header: 'Date', type: 'date', value: (c) => c.date, sortable: true },
    { key: 'type', header: 'Type', value: (c) => c.type, render: (c) => <span className="prio">{c.type === 'Bill' ? <ReceiptText size={16} strokeWidth={1.5} aria-hidden /> : <Receipt size={16} strokeWidth={1.5} aria-hidden />}{c.type}</span> },
    { key: 'who', header: 'Vendor or person', value: (c) => c.who, sortable: true },
    { key: 'amount', header: 'Amount', type: 'money', value: (c) => c.amount, sortable: true },
    { key: 'allocation', header: 'Allocation', value: (c) => c.allocation },
    { key: 'approval', header: 'Approval', type: 'status', value: (c) => c.approval },
    { key: 'payable', header: 'Payable', type: 'status', value: (c) => c.payable },
    { key: 'recharge', header: 'Recharge', type: 'status', value: (c) => c.recharge },
    { key: 'markup', header: 'Markup', type: 'number', value: (c) => c.markup, render: (c) => (c.markup == null ? <span className="ink-2">None</span> : `${c.markup}%`) },
  ];
  const addButton = <Button variant="primary" onClick={() => setAdding(true)}>Add cost</Button>;
  return (
    <>
      <div className="toolbar toolbar--between"><h2 className="t-h2">Costs</h2>{addButton}</div>
      <FilterBar filters={filters} />
      <DataTable
        key={state} label="Project costs" columns={columns} rows={rows} rowKey={(c) => c.id} state={state === 'ready' && !rows.length ? 'empty' : state} onRetry={retry} capability="view project costs"
        empty={{ message: 'No costs have been recorded here yet.', action: addButton }}
        expand={{
          isExpandable: (c) => !!c.duplicateOf,
          defaultOpen: all.filter((c) => c.duplicateOf).map((c) => c.id),
          render: (c) => {
            const first = all.find((x) => x.id === c.duplicateOf);
            return (
              <div className="stack-rows">
                <InlineAlert variant="warn" title="Possible duplicate">This bill has the same vendor and amount as the one dated {first ? formatDate(first.date) : 'earlier'}.</InlineAlert>
                <span><Button size="dense" onClick={() => setComparing(c)}>Compare bills</Button></span>
              </div>
            );
          },
        }}
      />
      <AddCostSheet open={adding} onClose={() => setAdding(false)} phases={getProjectPhaseOptions().find((p) => p.code === id)?.phases.map((p) => p.name) ?? []} />
      <Sheet open={!!comparing} onClose={() => setComparing(null)} size={640} title="Compare bills" description="Structural consultant" footer={<Button variant="ghost" onClick={() => setComparing(null)}>Close</Button>}>
        {comparing && original && <CompareColumns label="Bills side by side" columns={[{ label: 'First bill', rows: billRows(original) }, { label: 'This bill', rows: billRows(comparing) }]} />}
      </Sheet>
    </>
  );
}
