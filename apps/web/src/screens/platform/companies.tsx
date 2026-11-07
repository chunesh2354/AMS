import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Copy, Plus } from 'lucide-react';
import { ApiFailure, failureMessage, isLive } from '../../api/live';
import {
  createFirm, listFirms, listPlatformAudit, platformLogout, platformMe, reactivateFirm, suspendFirm,
  type NewFirm, type NewFirmResult, type PlatformAdmin, type PlatformAuditEntry, type PlatformFirm,
} from '../../api/live/platform';
import { ActivityFeed, type ActivityDay } from '../../ui/ActivityFeed';
import { Button } from '../../ui/Button';
import { DataTable, type Column, type DataTableState } from '../../ui/DataTable';
import { EmptyState } from '../../ui/EmptyState';
import { Form } from '../../ui/Form';
import { InlineAlert } from '../../ui/InlineAlert';
import { KpiTile } from '../../ui/KpiTile';
import { ListStateBlock } from '../../ui/ListState';
import { PageHeader } from '../../ui/PageHeader';
import { Select } from '../../ui/Select';
import { Sheet } from '../../ui/Sheet';
import { StatusChip } from '../../ui/StatusChip';
import { TextArea } from '../../ui/TextArea';
import { TextField } from '../../ui/TextField';
import { formatDate, formatGrouped } from '../../ui/format';

export const PRODUCT_NAME = 'Practice platform';

const TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'Australia/Sydney'];
const CURRENCIES = ['INR', 'AED', 'SGD', 'GBP', 'USD', 'AUD'];

const dateOf = (iso: string) => formatDate(iso.slice(0, 10));
const dateTimeOf = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** /platform. A layout of its own, outside the firm shell: no firm nav, no firm data, counts only. */
export function PlatformCompaniesScreen() {
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg-plane)' }}>
      {isLive ? <LivePanel /> : (
        <>
          <PlatformBar admin={null} />
          <main style={{ padding: 'var(--s-6) var(--s-4)', maxWidth: 1200, margin: '0 auto' }}>
            <PageHeader title="Companies" />
            <EmptyState message="Start the API to use the platform panel." />
          </main>
        </>
      )}
    </div>
  );
}

function PlatformBar({ admin }: { admin: PlatformAdmin | null }) {
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    setBusy(true);
    setFailure(null);
    try { await platformLogout(); } catch (e) { setFailure(failureMessage(e)); setBusy(false); }
  };
  return (
    <header className="glass glass--bar" style={{ position: 'sticky', top: 0, zIndex: 10, display: 'flex', alignItems: 'center', gap: 'var(--s-4)', padding: 'var(--s-3) var(--s-4)', flexWrap: 'wrap' }}>
      <strong className="t-h3">{PRODUCT_NAME}</strong>
      <span className="t-label">Platform admin</span>
      <span style={{ flex: 1 }} />
      {failure && <span role="alert" className="t-body-sm">{failure}</span>}
      {admin && <span className="t-body-sm">{admin.name}</span>}
      {admin && <Button size="dense" variant="ghost" loading={busy} onClick={signOut}>Sign out</Button>}
    </header>
  );
}

type Action = { kind: 'suspend' | 'reactivate'; firm: PlatformFirm };

function LivePanel() {
  const [admin, setAdmin] = useState<PlatformAdmin | null>(null);
  const [firms, setFirms] = useState<PlatformFirm[]>([]);
  const [state, setState] = useState<DataTableState>('loading');
  const [error, setError] = useState('');
  const [audit, setAudit] = useState<PlatformAuditEntry[]>([]);
  const [auditState, setAuditState] = useState<'ready' | 'loading' | 'error' | 'empty'>('loading');
  const [auditError, setAuditError] = useState('');
  const [adding, setAdding] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadFirms = useCallback(async () => {
    setState('loading');
    try {
      const data = await listFirms();
      setFirms(data);
      setState(data.length ? 'ready' : 'empty');
    } catch (e) {
      setError(failureMessage(e));
      setState(e instanceof ApiFailure && e.status === 403 ? 'denied' : 'error');
    }
  }, []);

  const loadAudit = useCallback(async () => {
    setAuditState('loading');
    try {
      const data = await listPlatformAudit();
      setAudit(data);
      setAuditState(data.length ? 'ready' : 'empty');
    } catch (e) {
      setAuditError(failureMessage(e));
      setAuditState('error');
    }
  }, []);

  useEffect(() => {
    platformMe().then(setAdmin).catch(() => {});
    void loadFirms();
    void loadAudit();
  }, [loadFirms, loadAudit]);

  const refresh = () => { void loadFirms(); void loadAudit(); };

  const counts = useMemo(() => ({
    total: firms.length,
    active: firms.filter((f) => f.status === 'Active').length,
    suspended: firms.filter((f) => f.status === 'Suspended').length,
    people: firms.reduce((n, f) => n + f.people, 0),
  }), [firms]);

  const columns: Column<PlatformFirm>[] = [
    {
      key: 'company', header: 'Company', value: (f) => f.trading_name, sortable: true,
      render: (f) => (
        <div>
          <div>{f.trading_name}</div>
          <div className="t-caption">{f.legal_name}</div>
        </div>
      ),
    },
    { key: 'status', header: 'Status', type: 'status', value: (f) => f.status, render: (f) => <StatusChip status={f.status} size="sm" /> },
    { key: 'people', header: 'People', type: 'number', value: (f) => f.people, render: (f) => <span className="t-numeric">{formatGrouped(f.people)}</span> },
    { key: 'active_people', header: 'Active people', type: 'number', value: (f) => f.active_people, render: (f) => <span className="t-numeric">{formatGrouped(f.active_people)}</span> },
    { key: 'created', header: 'Created', type: 'date', value: (f) => f.created_at, render: (f) => <span className="t-numeric">{dateOf(f.created_at)}</span>, sortable: true },
    { key: 'last_login', header: 'Last login', value: (f) => f.last_login_at ?? '', render: (f) => (f.last_login_at ? <span className="t-numeric">{dateTimeOf(f.last_login_at)}</span> : <span className="t-body-sm">Never</span>) },
  ];

  const loaded = state === 'ready' || state === 'empty';
  const auditDays = useMemo(() => groupAudit(audit), [audit]);

  return (
    <>
      <PlatformBar admin={admin} />
      <main style={{ padding: 'var(--s-6) var(--s-4)', maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--s-6)' }}>
        <PageHeader
          title="Companies"
          meta={loaded ? <span className="t-body-sm">{counts.total} {counts.total === 1 ? 'company' : 'companies'}</span> : undefined}
          primaryAction={<Button variant="primary" icon={<Plus size={16} strokeWidth={1.5} aria-hidden />} onClick={() => setAdding(true)}>Add company</Button>}
        />
        {notice && <InlineAlert variant="success" title={notice} dismissible />}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--s-4)' }}>
          <KpiTile label="Companies" value={loaded ? formatGrouped(counts.total) : '—'} />
          <KpiTile label="Active" value={loaded ? formatGrouped(counts.active) : '—'} />
          <KpiTile label="Suspended" value={loaded ? formatGrouped(counts.suspended) : '—'} />
          <KpiTile label="People" value={loaded ? formatGrouped(counts.people) : '—'} />
        </div>
        <DataTable
          label="Companies"
          columns={columns}
          rows={firms}
          rowKey={(f) => f.id}
          state={state}
          empty={{ message: 'No companies yet. Add the first one.' }}
          errorMessage={error}
          onRetry={loadFirms}
          capability="manage companies"
          rowActions={(f) => (f.status === 'Active'
            ? [{ label: 'Suspend', danger: true, onSelect: () => setAction({ kind: 'suspend', firm: f }) }]
            : [{ label: 'Reactivate', onSelect: () => setAction({ kind: 'reactivate', firm: f }) }])}
        />
        <section className="glass" style={{ padding: 'var(--s-6)', borderRadius: 'var(--radius-xl)', display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' }}>
          <h2 className="t-h3">Activity</h2>
          {auditState === 'ready'
            ? <ActivityFeed days={auditDays} />
            : <ListStateBlock state={auditState} label="Platform activity" empty={{ message: 'No platform activity yet.' }} errorMessage={auditError} onRetry={loadAudit} />}
        </section>
      </main>
      <AddCompanySheet open={adding} onClose={() => setAdding(false)} onCreated={refresh} />
      <StatusSheet
        action={action}
        onClose={() => setAction(null)}
        onDone={(msg) => { setAction(null); setNotice(msg); refresh(); }}
      />
    </>
  );
}

function groupAudit(entries: PlatformAuditEntry[]): ActivityDay[] {
  const days = new Map<string, ActivityDay>();
  for (const e of entries) {
    const day = dateOf(e.at);
    if (!days.has(day)) days.set(day, { day, events: [] });
    const what = [e.action, e.firm_name].filter(Boolean).join(': ');
    days.get(day)!.events.push({
      id: e.id,
      actor: e.admin_name,
      action: e.reason ? `${what}. Reason: ${e.reason}` : what,
      time: new Date(e.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    });
  }
  return [...days.values()];
}

const EMPTY_FIRM: NewFirm = { trading_name: '', legal_name: '', timezone: 'Asia/Kolkata', currency: 'INR', owner_name: '', owner_email: '' };
type FirmErrors = Partial<Record<keyof NewFirm, string>>;

function validateFirm(f: NewFirm): FirmErrors {
  const e: FirmErrors = {};
  if (!f.trading_name.trim()) e.trading_name = 'Enter the trading name.';
  if (!f.legal_name.trim()) e.legal_name = 'Enter the legal name.';
  if (!f.timezone) e.timezone = 'Choose a timezone.';
  if (!f.currency) e.currency = 'Choose a currency.';
  if (!f.owner_name.trim()) e.owner_name = "Enter the owner's name.";
  if (!f.owner_email.trim()) e.owner_email = "Enter the owner's email.";
  else if (!/^\S+@\S+\.\S+$/.test(f.owner_email.trim())) e.owner_email = 'Enter a valid email address.';
  return e;
}

function AddCompanySheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState<NewFirm>(EMPTY_FIRM);
  const [errors, setErrors] = useState<FirmErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<NewFirmResult | null>(null);
  const [copied, setCopied] = useState(false);

  const close = () => {
    setForm(EMPTY_FIRM); setErrors({}); setFailure(null); setResult(null); setCopied(false); setBusy(false);
    onClose();
  };
  const set = (k: keyof NewFirm, v: string) => { setForm((f) => ({ ...f, [k]: v })); setErrors((x) => ({ ...x, [k]: undefined })); };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const next = validateFirm(form);
    setErrors(next);
    setFailure(null);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const trimmed = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()])) as NewFirm;
      setResult(await createFirm(trimmed));
      onCreated();
    } catch (err) {
      if (err instanceof ApiFailure && err.code === 'DUPLICATE_EMAIL') setErrors({ owner_email: err.message });
      else setFailure(failureMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const inviteLink = result ? new URL(result.invite_url, window.location.origin).toString() : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(inviteLink); setCopied(true); } catch { setCopied(false); }
  };

  const dirty = !result && JSON.stringify(form) !== JSON.stringify(EMPTY_FIRM);
  const footer = result
    ? <Button variant="primary" onClick={close}>Done</Button>
    : (
      <>
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={() => void submit()}>Create company</Button>
      </>
    );

  return (
    <Sheet open={open} onClose={close} title="Add company" description="Creates the company, its five account types and an invite for the owner." size={480} footer={footer} dirty={dirty}>
      {result ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' }}>
          <InlineAlert variant="success" title={`${form.trading_name.trim()} is ready.`}>Send this invite link to {form.owner_name.trim()}. It works once and expires on {dateTimeOf(result.invite_expires_at)}.</InlineAlert>
          <TextField label="Invite link" value={inviteLink} readOnly mono />
          <div><Button icon={<Copy size={16} strokeWidth={1.5} aria-hidden />} onClick={copy}>{copied ? 'Copied' : 'Copy link'}</Button></div>
          <InlineAlert variant="warn" title="Email delivery is not connected.">No email was sent. Share the link with the owner yourself.</InlineAlert>
        </div>
      ) : (
        <Form onSubmit={submit} aria-label="Add company" noValidate>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' }}>
            {failure && <InlineAlert variant="danger" title={failure} />}
            <TextField label="Trading name" value={form.trading_name} error={errors.trading_name} onChange={(e) => set('trading_name', e.target.value)} />
            <TextField label="Legal name" value={form.legal_name} error={errors.legal_name} onChange={(e) => set('legal_name', e.target.value)} />
            <Select label="Timezone" options={TIMEZONES.map((t) => ({ value: t, label: t }))} value={form.timezone} error={errors.timezone} onChange={(v) => set('timezone', v)} searchable />
            <Select label="Currency" options={CURRENCIES.map((c) => ({ value: c, label: c }))} value={form.currency} error={errors.currency} onChange={(v) => set('currency', v)} />
            <TextField label="Owner name" value={form.owner_name} error={errors.owner_name} onChange={(e) => set('owner_name', e.target.value)} />
            <TextField label="Owner email" type="email" value={form.owner_email} error={errors.owner_email} helper="The owner becomes the first Principal." onChange={(e) => set('owner_email', e.target.value)} />
            <button type="submit" hidden aria-hidden tabIndex={-1} />
          </div>
        </Form>
      )}
    </Sheet>
  );
}

function StatusSheet({ action, onClose, onDone }: { action: Action | null; onClose: () => void; onDone: (message: string) => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setReason(''); setError(undefined); setFailure(null); setBusy(false); }, [action]);

  if (!action) return null;
  const suspend = action.kind === 'suspend';
  const name = action.firm.trading_name;

  const submit = async () => {
    if (!reason.trim()) { setError(suspend ? 'Enter why this company is being suspended.' : 'Enter why this company is being reactivated.'); return; }
    setBusy(true);
    setFailure(null);
    try {
      await (suspend ? suspendFirm : reactivateFirm)(action.firm.id, reason.trim());
      onDone(suspend ? `${name} is suspended.` : `${name} is active again.`);
    } catch (e) {
      setFailure(failureMessage(e));
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={suspend ? `Suspend ${name}` : `Reactivate ${name}`}
      size={480}
      dirty={reason.trim() !== ''}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={suspend ? 'danger' : 'primary'} loading={busy} onClick={() => void submit()}>{suspend ? 'Suspend company' : 'Reactivate company'}</Button>
        </>
      )}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' }}>
        {suspend
          ? <InlineAlert variant="warn" title="Every user in this company is signed out.">Nobody at {name} can sign in until the company is reactivated. Their data is kept.</InlineAlert>
          : <InlineAlert variant="info" title="People can sign in again.">Accounts that were active before the suspension can sign in straight away.</InlineAlert>}
        {failure && <InlineAlert variant="danger" title={failure} />}
        <TextArea label="Reason" value={reason} error={error} helper="Recorded in the platform activity." onChange={(e) => { setReason(e.target.value); setError(undefined); }} />
      </div>
    </Sheet>
  );
}
