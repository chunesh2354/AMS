import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getInvoices, hasFinanceAccess, outstanding, personName, type Invoice } from '../../api';
import { ApiFailure, failureMessage, isLive } from '../../api/live';
import { amountErrorOf, getLiveReceivables, recordSettlement, type AgeingBuckets, type LiveInvoice, type SettlementKind } from '../../api/live/receivables';
import { todayIn } from '../../api/live/time';
import { useResource } from '../../api/useResource';
import { can, useSession } from '../../app/session';
import { TODAY } from '../../mock/studio-meridian';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { DataTable, type Column } from '../../ui/DataTable';
import { DateField } from '../../ui/DateField';
import { FilterBar, type FilterDef } from '../../ui/FilterBar';
import { Form, FormSection } from '../../ui/Form';
import { MoneyField } from '../../ui/MoneyField';
import { PageHeader } from '../../ui/PageHeader';
import { PermissionDenied } from '../../ui/PermissionDenied';
import { Segmented } from '../../ui/Segmented';
import { SegmentedBar, type BarSegment } from '../../ui/SegmentedBar';
import { Select } from '../../ui/Select';
import { Sheet } from '../../ui/Sheet';
import { Skeleton } from '../../ui/Skeleton';
import { StatusChip } from '../../ui/StatusChip';
import { TextField } from '../../ui/TextField';
import { useToast } from '../../ui/Toast';
import { formatDate, formatINR } from '../../ui/format';
import { GoTo } from '../shared/go-to';

type Kind = 'Cash' | 'Withholding' | 'Credit';
const FIELD: Record<Kind, 'cash' | 'withholding' | 'credits'> = { Cash: 'cash', Withholding: 'withholding', Credit: 'credits' };
const API_KIND: Record<Kind, SettlementKind> = { Cash: 'cash', Withholding: 'withholding', Credit: 'credit_applied' };
const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

function liveAgeing(a: AgeingBuckets): BarSegment[] {
  const seg = (label: string, value: number, color: BarSegment['color']): BarSegment => ({ label, value, color, display: formatINR(value) });
  return [seg('Current', a.current, 'ok'), seg('30 d', a.d30, 'warn'), seg('60 d', a.d60, 'danger'), seg('90+ d', a.d90, 'neutral')];
}

/**
 * The settlement date the sheet starts on. Live: today in the firm's time zone (from GET /me), so a payment
 * recorded late in the evening is not filed under the UTC date and never under the sample studio's date.
 * Mock: the sample studio's TODAY, so screenshots stay stable.
 */
export const defaultSettlementDate = (live: boolean, timeZone?: string, now: Date = new Date()) => (live ? todayIn(timeZone, now) : TODAY);

type SaveInput = { id: string; kind: Kind; amount: number; date: string; reference: string; key: string };

function ageing(rows: Invoice[]): BarSegment[] {
  const open = rows.filter((i) => outstanding(i) > 0);
  const sum = (test: (d: number) => boolean) => open.filter((i) => test(i.overdueDays)).reduce((s, i) => s + outstanding(i), 0);
  const seg = (label: string, value: number, color: BarSegment['color']): BarSegment => ({ label, value, color, display: formatINR(value) });
  return [seg('Current', sum((d) => d < 30), 'ok'), seg('30 d', sum((d) => d >= 30 && d < 60), 'warn'), seg('60 d', sum((d) => d >= 60 && d < 90), 'danger'), seg('90+ d', sum((d) => d >= 90), 'neutral')];
}

function SettlementSheet({ open, invoice, invoices, today, onClose, onSave }: { open: boolean; invoice: Invoice | null; invoices: Invoice[]; today: string; onClose: () => void; onSave: (input: SaveInput) => void | Promise<string | null> }) {
  const [id, setId] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>('Cash');
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState<string | null>(today);
  const [reference, setReference] = useState('');
  const [tried, setTried] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);
  const [key, setKey] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const openOnes = invoices.filter((i) => outstanding(i) > 0);
  if (open && !wasOpen) { setWasOpen(true); setId(invoice?.id ?? openOnes[0]?.id ?? null); setKind('Cash'); setAmount(null); setDate(today); setReference(''); setTried(false); setKey(newKey()); setServerError(null); setBusy(false); }
  if (!open && wasOpen) setWasOpen(false);
  const current = invoices.find((i) => i.id === id);
  const left = current ? outstanding(current) : 0;
  const remaining = left - (amount ?? 0);
  const amountError = !amount ? 'Enter an amount' : amount > left ? `This is more than the ${formatINR(left)} outstanding` : undefined;
  const save = () => {
    if (!current || amountError) { setTried(true); return; }
    if (busy) return;
    const result = onSave({ id: current.id, kind, amount: amount!, date: date ?? today, reference, key });
    if (result instanceof Promise) {
      setBusy(true);
      void result.then((err) => { setBusy(false); setServerError(err); });
    }
  };
  return (
    <Sheet
      open={open} onClose={onClose} title="Record settlement" description={current ? <>{current.id} · Outstanding <span className="t-numeric">{formatINR(left)}</span></> : undefined} dirty={amount != null}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={busy}>Save settlement</Button></>}
    >
      <Form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <FormSection>
          <Select label="Invoice" options={openOnes.map((i) => ({ value: i.id, label: `${i.id}, ${i.client}` }))} value={id} onChange={setId} />
          <div className="field"><span className="field__label">Type</span><Segmented<Kind> label="Settlement type" value={kind} onChange={setKind} options={(['Cash', 'Withholding', 'Credit'] as Kind[]).map((k) => ({ value: k, label: k }))} /></div>
          <MoneyField label={`${kind} amount`} value={amount} onChange={(v) => { setAmount(v); setServerError(null); }} error={(tried ? amountError : undefined) ?? serverError ?? undefined} />
          <DateField label="Date" value={date} onChange={setDate} today={today} />
          <TextField label="Reference" value={reference} onChange={(e) => setReference(e.target.value)} />
          <dl className="calc"><dt>Remaining after this</dt><dd className={remaining < 0 ? 'calc__danger' : 'calc__strong'}>{formatINR(remaining)}</dd></dl>
        </FormSection>
      </Form>
    </Sheet>
  );
}

const ownerOf = (i: Invoice) => (i as LiveInvoice).ownerName ?? personName(i.ownerId);

export function ReceivablesScreen() {
  const { viewer } = useSession();
  const [params] = useSearchParams();
  const toast = useToast();
  const [denied, setDenied] = useState(false);
  const { state, data, retry } = useResource<{ invoices: Invoice[]; ageing: AgeingBuckets | null }>(
    isLive
      ? () => getLiveReceivables().catch((e: unknown) => { if (e instanceof ApiFailure && e.status === 403) setDenied(true); throw e; })
      : () => getInvoices().then((invoices) => ({ invoices, ageing: null })),
    [],
  );
  const [edits, setEdits] = useState<Record<string, Invoice>>({});
  const [sheet, setSheet] = useState<{ open: boolean; invoice: Invoice | null }>({ open: false, invoice: null });
  const today = defaultSettlementDate(isLive, viewer.firm?.timezone);
  const all = useMemo(() => (data?.invoices ?? []).map((i) => edits[i.id] ?? i), [data, edits]);
  const allowed = isLive ? can(viewer, 'receivables.manage') && !denied : hasFinanceAccess(viewer);
  const canRecord = isLive ? can(viewer, 'receivables.manage', { firmWide: true }) : true;
  if (!allowed) return (<><PageHeader title="Receivables" /><div className="solid-panel"><PermissionDenied capability="finance" /></div></>);
  const rows = all.filter((i) => (!params.get('client') || i.client === params.get('client')) && (!params.get('state') || (params.get('state') === 'open') === (outstanding(i) > 0)));
  const filters: FilterDef[] = [
    { type: 'select', key: 'client', label: 'Client', options: [...new Set(all.map((i) => i.client))].map((c) => ({ value: c, label: c })) },
    { type: 'select', key: 'state', label: 'State', options: [{ value: 'open', label: 'Outstanding' }, { value: 'settled', label: 'Settled' }] },
  ];
  const open = all.filter((i) => outstanding(i) > 0);
  const columns: Column<Invoice>[] = [
    { key: 'id', header: 'Invoice', value: (i) => i.id, render: (i) => <span className="t-numeric" style={{ whiteSpace: 'nowrap' }}>{i.id}</span> },
    { key: 'client', header: 'Client, project', value: (i) => i.client, render: (i) => <span className="stacked"><span>{i.client}</span><span className="t-numeric ink-2">{i.project}</span></span> },
    { key: 'issue', header: 'Issue', value: (i) => i.issue, render: (i) => <span className="t-numeric" style={{ whiteSpace: 'nowrap' }}>{formatDate(i.issue)}</span> },
    {
      key: 'due', header: 'Due', value: (i) => i.due,
      render: (i) => <span className="stacked"><span className="t-numeric">{formatDate(i.due)}</span>{outstanding(i) > 0 && i.overdueDays > 0 && <span className="t-caption err-cell">Overdue {i.overdueDays} d</span>}</span>,
    },
    { key: 'gross', header: 'Gross', type: 'money', value: (i) => i.gross, total: (l) => l.reduce((s, x) => s + x.gross, 0) },
    { key: 'cash', header: 'Cash', type: 'money', value: (i) => i.cash, total: (l) => l.reduce((s, x) => s + x.cash, 0) },
    { key: 'withholding', header: 'Withholding', type: 'money', value: (i) => i.withholding, total: (l) => l.reduce((s, x) => s + x.withholding, 0) },
    { key: 'credits', header: 'Credits', type: 'money', value: (i) => i.credits, total: (l) => l.reduce((s, x) => s + x.credits, 0) },
    { key: 'outstanding', header: 'Outstanding', type: 'money', value: outstanding, sortable: true, total: (l) => l.reduce((s, x) => s + outstanding(x), 0) },
    { key: 'dispute', header: 'Dispute', value: (i) => i.dispute, render: (i) => (i.dispute === 'None' ? <span className="ink-2">None</span> : <StatusChip size="sm" status={i.dispute} />) },
    {
      key: 'follow', header: 'Follow-up', value: (i) => i.followUp,
      render: (i) => (i.followUp
        ? <span className="stacked"><span className="dt__person"><Avatar name={ownerOf(i)} size={20} />{ownerOf(i)}</span><span className="t-numeric ink-2">{formatDate(i.followUp)}</span></span>
        : <span className="ink-2">None</span>),
    },
  ];
  return (
    <>
      <PageHeader
        title="Receivables"
        meta={state === 'ready' && <span className="t-numeric ink-2">{open.length} {open.length === 1 ? 'invoice' : 'invoices'} outstanding</span>}
        primaryAction={canRecord ? <Button variant="primary" disabled={!open.length} onClick={() => setSheet({ open: true, invoice: null })}>Record settlement</Button> : undefined}
      />
      {state === 'loading'
        ? <Skeleton kind="card" />
        : state === 'ready' && (
          <section className="card glass" aria-labelledby="ageing-head">
            <div className="panel__head"><h2 id="ageing-head" className="t-h2">Ageing</h2><span className="t-numeric">{formatINR(open.reduce((s, i) => s + outstanding(i), 0))}</span></div>
            <SegmentedBar label="Receivables ageing" segments={data?.ageing ? liveAgeing(data.ageing) : ageing(all)} />
          </section>
        )}
      <FilterBar filters={filters} />
      <DataTable
        tight label="Invoices" columns={columns} rows={rows} rowKey={(i) => i.id} state={state === 'ready' && !rows.length ? 'empty' : state} onRetry={retry} capability="finance"
        empty={{ message: 'No invoices match here.', action: <GoTo to="/firm/billing">Open Billing</GoTo> }}
      />
      <SettlementSheet
        open={sheet.open} invoice={sheet.invoice} invoices={all} today={today} onClose={() => setSheet({ open: false, invoice: null })}
        onSave={({ id, kind, amount, date, reference, key }) => {
          if (isLive) {
            const target = all.find((x) => x.id === id) as LiveInvoice | undefined;
            if (!target) return Promise.resolve('Choose an invoice');
            return recordSettlement(target.uuid, { kind: API_KIND[kind], amount, date, reference }, key).then(
              () => {
                setSheet({ open: false, invoice: null });
                toast({ variant: 'success', message: `${kind} of ${formatINR(amount)} recorded on ${id}.` });
                retry();
                return null;
              },
              (e: unknown) => {
                const inline = amountErrorOf(e);
                if (!inline) toast({ variant: 'danger', message: failureMessage(e) });
                return inline;
              },
            );
          }
          const i = all.find((x) => x.id === id)!;
          const f = FIELD[kind];
          setEdits((e) => ({ ...e, [id]: { ...i, [f]: i[f] + amount } }));
          setSheet({ open: false, invoice: null });
          toast({ variant: 'success', message: `${kind} of ${formatINR(amount)} recorded on ${id} in this view.` });
        }}
      />
    </>
  );
}
