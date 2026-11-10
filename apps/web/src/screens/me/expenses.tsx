import { useState } from 'react';
import { Plus, Receipt, X } from 'lucide-react';
import { getExpenses, getProjectPhaseOptions } from '../../api';
import { useResource } from '../../api/useResource';
import { useSession } from '../../app/session';
import { TODAY } from '../../mock/studio-meridian';
import { Button } from '../../ui/Button';
import { DateField } from '../../ui/DateField';
import { FileDrop } from '../../ui/FileDrop';
import { Form, FormSection } from '../../ui/Form';
import { IconButton } from '../../ui/IconButton';
import { ListStateBlock } from '../../ui/ListState';
import { MoneyField } from '../../ui/MoneyField';
import { PageHeader } from '../../ui/PageHeader';
import { ProjectPhasePicker } from '../../ui/ProjectPhasePicker';
import { Sheet } from '../../ui/Sheet';
import { StatusChip } from '../../ui/StatusChip';
import { TextField } from '../../ui/TextField';
import { useToast } from '../../ui/Toast';
import { formatDate, formatINR } from '../../ui/format';
import { isLive } from '../../api/live';
import { NotAvailablePage } from '../../ui/NotAvailable';

const projects = getProjectPhaseOptions();
type Row = { id: number; phase: string | null; amount: number | null };

function NewExpenseSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState<string | null>(TODAY);
  const [what, setWhat] = useState('');
  const [rows, setRows] = useState<Row[]>([{ id: 0, phase: null, amount: null }]);
  const [tried, setTried] = useState(false);
  const close = () => { setFile(null); setAmount(null); setDate(TODAY); setWhat(''); setRows([{ id: 0, phase: null, amount: null }]); setTried(false); onClose(); };
  const allocated = rows.reduce((s, r) => s + (r.amount ?? 0), 0);
  const remaining = (amount ?? 0) - allocated;
  const invalid = !file || !amount || !what.trim() || remaining !== 0 || rows.some((r) => !r.phase);
  const save = () => {
    if (invalid) { setTried(true); return; }
    toast({ variant: 'success', message: `Expense of ${formatINR(amount!)} submitted. Nothing is saved in this demo.` });
    close();
  };
  const patch = (id: number, p: Partial<Row>) => setRows((l) => l.map((r) => (r.id === id ? { ...r, ...p } : r)));
  return (
    <Sheet
      open={open} onClose={close} title="New expense" dirty={!!file || amount != null || what !== ''}
      footer={(
        <>
          {tried && invalid && <span className="form__summary" role="status">Fix the highlighted fields to submit</span>}
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={save}>Submit expense</Button>
        </>
      )}
    >
      <Form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <FormSection>
          <FileDrop label="Receipt" accept="image/*,.pdf" files={file ? [{ name: file }] : []} onFiles={(f) => setFile(f[0]?.name ?? null)} error={tried && !file ? 'Add the receipt' : undefined} />
        </FormSection>
        <FormSection columns={2}>
          <MoneyField label="Amount" value={amount} onChange={setAmount} error={tried && !amount ? 'Enter an amount' : undefined} />
          <DateField label="Date" value={date} onChange={setDate} today={TODAY} max={TODAY} />
        </FormSection>
        <FormSection>
          <TextField label="Description" value={what} onChange={(e) => setWhat(e.target.value)} error={tried && !what.trim() ? 'Say what this was for' : undefined} />
        </FormSection>
        <FormSection title="Allocation">
          {rows.map((r, i) => (
            <div key={r.id} className="alloc-row">
              <ProjectPhasePicker label={`Project and phase ${i + 1}`} projects={projects} recent={['p1-concept']} value={r.phase} onChange={(v) => patch(r.id, { phase: v })} error={tried && !r.phase ? 'Choose a phase' : undefined} />
              <MoneyField label={`Amount ${i + 1}`} value={r.amount} onChange={(v) => patch(r.id, { amount: v })} />
              {rows.length > 1 && <IconButton dense label={`Remove row ${i + 1}`} icon={<X size={16} strokeWidth={1.5} aria-hidden />} onClick={() => setRows((l) => l.filter((x) => x.id !== r.id))} />}
            </div>
          ))}
          <span><Button size="dense" variant="ghost" icon={<Plus size={16} strokeWidth={1.5} aria-hidden />} onClick={() => setRows((l) => [...l, { id: Math.max(...l.map((x) => x.id)) + 1, phase: null, amount: null }])}>Add allocation row</Button></span>
          <dl className="calc"><dt>Remaining to allocate</dt><dd className={remaining !== 0 ? 'calc__danger' : 'calc__strong'}>{formatINR(remaining)}</dd></dl>
        </FormSection>
      </Form>
    </Sheet>
  );
}

function MockMyExpensesScreen() {
  const { viewer } = useSession();
  const { state, data, retry } = useResource(() => getExpenses(viewer.id), [viewer.id]);
  const [adding, setAdding] = useState(false);
  const items = data ?? [];
  const add = <Button variant="primary" onClick={() => setAdding(true)}>New expense</Button>;
  const effective = state === 'ready' && !items.length ? 'empty' : state;
  return (
    <>
      <PageHeader title="My expenses" meta={state === 'ready' && <span className="t-numeric ink-2">{items.length} expenses</span>} primaryAction={add} />
      {effective !== 'ready'
        ? <ListStateBlock state={effective} label="Your expenses" onRetry={retry} capability="view your expenses" empty={{ message: 'You have no expenses yet.', action: add }} />
        : (
          <ul className="card-grid" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {items.map((e) => (
              <li key={e.id} className="expense glass">
                <span className="receipt" title={e.receipt}><Receipt size={20} strokeWidth={1.5} aria-hidden /><span className="sr-only">{e.receipt}</span></span>
                <div className="expense__body">
                  <div className="expense__top"><span className="t-numeric" style={{ fontSize: 15 }}>{formatINR(e.amount)}</span><span className="t-numeric ink-2">{formatDate(e.date)}</span></div>
                  <span className="t-body-sm" style={{ fontWeight: 500 }}>{e.what}</span>
                  <span className="t-caption ink-2">{e.where}</span>
                  <span className="chip-row" style={{ marginTop: 'var(--s-1)' }}>
                    <StatusChip size="sm" status={e.approval} label={e.approvalLabel} />
                    <StatusChip size="sm" status={e.reimbursement} label={e.reimbursementLabel} />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      <NewExpenseSheet open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

/** Live mode has no API for this yet: the honest empty state, never the sample studio. */
export function MyExpensesScreen() {
  return isLive ? <NotAvailablePage title="My expenses" detail="Expenses you claim and where each one stands." /> : <MockMyExpensesScreen />;
}
