import { useCallback, useEffect, useState } from 'react';
import { ApiFailure, failureMessage, isLive, isRestricted, rupees } from '../../api/live';
import { createRate, listRates, type RateCardRow } from '../../api/live/setup';
import { can, useSession } from '../../app/session';
import { PEOPLE } from '../../mock/studio-meridian';
import { Button } from '../../ui/Button';
import { DataTable, RESTRICTED, type Column, type DataTableState } from '../../ui/DataTable';
import { DateField } from '../../ui/DateField';
import { Form, FormSection } from '../../ui/Form';
import { InlineAlert } from '../../ui/InlineAlert';
import { MoneyField } from '../../ui/MoneyField';
import { PersonPicker } from '../../ui/PersonPicker';
import { Select } from '../../ui/Select';
import { Sheet } from '../../ui/Sheet';
import { TextField } from '../../ui/TextField';
import { useToast } from '../../ui/Toast';

const MOCK_NOTE = 'Nothing is saved in this demo.';
const CAPABILITY = 'manage rates';

/** Mock mode: the demo firm's seeded rates (bill, cost). Nisha has no cost rate. */
const MOCK_RATES: Record<string, [number, number | null]> = {
  P01: [6000, 2400], P02: [3000, 1200], P03: [3000, 1200], P04: [2200, 900], P05: [1600, 640],
  P06: [2000, 640], P07: [1600, 640], P08: [1600, 640], P09: [800, null], P10: [1500, 800],
};
const money = (n: number) => ({ amount: n.toFixed(2), currency: 'INR' });
const mockRows = (): RateCardRow[] => PEOPLE.map((p) => {
  const [bill, cost] = MOCK_RATES[p.id] ?? [null, null];
  return {
    person: { id: p.id, ref_code: p.id, name: p.name, job_title: p.title, employment_state: String(p.employment) },
    bill_rate: bill == null ? null : { id: `${p.id}-bill`, amount: money(bill), effective_from: '2026-01-01' },
    cost_rate: cost == null ? null : { id: `${p.id}-cost`, amount: money(cost), effective_from: '2026-01-01' },
  };
});

const today = () => new Date().toISOString().slice(0, 10);
type Draft = { person: string | null; type: 'bill' | 'cost'; amount: number | null; from: string; reason: string };

function AddRateSheet({ open, onClose, rows, costAllowed, onSaved }: { open: boolean; onClose: () => void; rows: RateCardRow[]; costAllowed: boolean; onSaved: () => void }) {
  const toast = useToast();
  const blank = (): Draft => ({ person: null, type: 'bill', amount: null, from: today(), reason: '' });
  const [form, setForm] = useState<Draft>(blank);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  useEffect(() => { if (open) { setForm(blank()); setTried(false); setServerError(null); } }, [open]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setForm((f) => ({ ...f, [k]: v }));

  const errors = {
    person: !form.person ? 'Choose a person' : undefined,
    amount: form.amount == null || !(form.amount >= 0) ? 'Enter a rate per hour' : undefined,
    from: !form.from ? 'Choose the date it applies from' : undefined,
    reason: !form.reason.trim() ? 'Say why the rate changes' : undefined,
  };
  const invalid = Object.values(errors).some(Boolean);
  const show = (k: keyof typeof errors) => (tried ? errors[k] : undefined);
  const name = rows.find((r) => r.person.id === form.person)?.person.name ?? '';

  const submit = async () => {
    setTried(true); setServerError(null);
    if (invalid || !form.person || form.amount == null) return;
    if (!isLive) { toast({ variant: 'success', message: `New ${form.type} rate for ${name} checked. ${MOCK_NOTE}` }); onClose(); return; }
    setBusy(true);
    try {
      await createRate({ person_id: form.person, rate_type: form.type, amount: form.amount, effective_from: form.from, change_reason: form.reason.trim() });
      toast({ variant: 'success', message: `New ${form.type} rate for ${name} saved.` });
      onSaved(); onClose();
    } catch (e) {
      setServerError(e instanceof ApiFailure && e.code === 'OVERLAPPING_VERSION' ? 'A rate version already starts on or after this date. Choose a later date.' : failureMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const people = rows.filter((r) => r.person.employment_state === 'Active').map((r) => ({ id: r.person.id, name: r.person.name, title: r.person.job_title ?? undefined }));
  const types = [{ value: 'bill', label: 'Bill rate' }, ...(costAllowed ? [{ value: 'cost', label: 'Cost rate' }] : [])];
  return (
    <Sheet
      open={open} onClose={onClose} size={480} dirty={!!form.person || form.amount != null || !!form.reason}
      title="Add rate version" description="The current version closes the day before. Past versions are never changed."
      footer={(
        <>
          {tried && invalid && <span className="form__summary" role="status">Fix the highlighted fields to continue</span>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit}>Save rate</Button>
        </>
      )}
    >
      <Form onSubmit={(e) => { e.preventDefault(); void submit(); }} aria-label="Add rate version">
        {serverError && <InlineAlert variant="danger" title={serverError} />}
        <FormSection>
          <PersonPicker label="Person" people={people} value={form.person} onChange={(id) => set('person', id)} error={show('person')} />
          <Select label="Rate type" options={types} value={form.type} onChange={(v) => set('type', v as Draft['type'])} />
          <MoneyField label="Rate per hour" value={form.amount} onChange={(v) => set('amount', v)} error={show('amount')} />
          <DateField label="Applies from" value={form.from} onChange={(v) => set('from', v)} error={show('from')} />
          <TextField label="Reason" value={form.reason} onChange={(e) => set('reason', e.target.value)} error={show('reason')} helper="Kept in the audit trail." />
        </FormSection>
      </Form>
    </Sheet>
  );
}

/** Settings > Rates: everyone's bill rate in force today, and the cost rate for those allowed to see it. */
export function RatesSettings() {
  const { viewer } = useSession();
  const costVisible = can(viewer, 'rates.cost.view', { firmWide: true });
  const costAllowed = can(viewer, 'rates.cost.manage', { firmWide: true });
  const mayAdd = can(viewer, 'rates.bill.manage', { firmWide: true }) || costAllowed;
  const [rows, setRows] = useState<RateCardRow[]>([]);
  const [state, setState] = useState<DataTableState>('loading');
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    if (!isLive) { setRows(mockRows()); setState('ready'); return; }
    setState((s) => (s === 'ready' ? s : 'loading'));
    try {
      const data = await listRates();
      setRows(data);
      setState(data.length ? 'ready' : 'empty');
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 403) setState('denied');
      else { setErrorMessage(failureMessage(e)); setState('error'); }
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const columns: Column<RateCardRow>[] = [
    { key: 'person', header: 'Person', type: 'person', value: (r) => r.person.name, sortable: true },
    { key: 'title', header: 'Title', value: (r) => r.person.job_title ?? '' },
    { key: 'bill', header: 'Bill rate per hour', type: 'money', value: (r) => rupees(r.bill_rate?.amount), sortable: true },
    { key: 'bill_from', header: 'Bill rate from', type: 'date', value: (r) => r.bill_rate?.effective_from ?? null },
    ...(costVisible ? [
      { key: 'cost', header: 'Cost rate per hour', type: 'money' as const, value: (r: RateCardRow) => (isRestricted(r.cost_rate) ? RESTRICTED : rupees(r.cost_rate?.amount)) },
      { key: 'cost_from', header: 'Cost rate from', type: 'date' as const, value: (r: RateCardRow) => (r.cost_rate && !isRestricted(r.cost_rate) ? r.cost_rate.effective_from : null) },
    ] : []),
  ];

  return (
    <>
      <div className="panel__head">
        <h2 className="t-h2">Rates</h2>
        {mayAdd && <Button variant="primary" onClick={() => setAdding(true)}>Add rate version</Button>}
      </div>
      <p className="t-body-sm ink-2">Rates in force today. A new version applies from its date; time already approved keeps the rate it was approved at.</p>
      <DataTable
        label="Rates" columns={columns} rows={rows} rowKey={(r) => r.person.id} state={state} onRetry={() => void load()} errorMessage={errorMessage}
        capability={CAPABILITY} empty={{ message: 'No people yet. Add accounts first, then set their rates.' }}
      />
      <AddRateSheet open={adding} onClose={() => setAdding(false)} rows={rows} costAllowed={costAllowed} onSaved={() => void load()} />
    </>
  );
}
