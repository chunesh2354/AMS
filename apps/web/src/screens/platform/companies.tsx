import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { Copy, Plus } from 'lucide-react';
import { ApiFailure, failureMessage, isLive } from '../../api/live';
import {
  createFirm, getFirm, listFirms, listPlatformAudit, platformLogout, platformMe, reactivateFirm, reissueOwnerInvite, suspendFirm,
  type NewFirm, type NewFirmResult, type OwnerInvite, type PlatformAdmin, type PlatformAuditEntry, type PlatformFirm, type PlatformFirmDetail,
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
import { COPY_BLOCKED, useCopy } from '../../ui/copy';
import { formatDate, formatGrouped, toISO } from '../../ui/format';

export const PRODUCT_NAME = 'Practice platform';

const TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'Australia/Sydney'];
const CURRENCIES = ['INR', 'AED', 'SGD', 'GBP', 'USD', 'AUD'];

const dateOf = (iso: string) => formatDate(iso.slice(0, 10));
/** Same date style as the rest of the app ("08 Nov 2026"), in local time, then the time. */
const dateTimeOf = (iso: string) => {
  const d = new Date(iso);
  return `${formatDate(toISO(d))}, ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
};

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
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--s-2)' }}>
        <span className="sidenav__mark" aria-hidden />
        <strong className="t-h3">{PRODUCT_NAME}</strong>
      </span>
      <span className="ink-2 t-body-sm">Platform admin</span>
      <span style={{ flex: 1 }} />
      {failure && <span role="alert" className="t-body-sm">{failure}</span>}
      {admin && <span className="t-body-sm">{admin.name}</span>}
      {admin && <Button size="dense" variant="ghost" loading={busy} onClick={signOut}>Sign out</Button>}
    </header>
  );
}

type Action = { kind: 'suspend' | 'reactivate'; firm: PlatformFirm; fromDetail?: boolean };

/** The legal name is shown only when it says something the trading name does not. */
const legalDiffers = (f: Pick<PlatformFirm, 'trading_name' | 'legal_name'>) =>
  !!f.legal_name && f.legal_name.trim().toLowerCase() !== f.trading_name.trim().toLowerCase();

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
  const [openFirm, setOpenFirm] = useState<PlatformFirm | null>(null);

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
          {legalDiffers(f) && <div className="t-caption">{f.legal_name}</div>}
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
          onRowClick={(f) => setOpenFirm(f)}
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
      <CompanySheet
        firm={openFirm}
        onClose={() => setOpenFirm(null)}
        onChanged={refresh}
        onStatus={(kind, firm) => { setOpenFirm(null); setAction({ kind, firm, fromDetail: true }); }}
      />
      <StatusSheet
        action={action}
        onClose={() => { if (action?.fromDetail) setOpenFirm(action.firm); setAction(null); }}
        onDone={(msg) => {
          if (action?.fromDetail) setOpenFirm({ ...action.firm, status: action.kind === 'suspend' ? 'Suspended' : 'Active' });
          setAction(null); setNotice(msg); refresh();
        }}
      />
    </>
  );
}

/** Platform audit actions in plain words. An action this screen does not know yet is shown as recorded. */
export function describeAction(e: Pick<PlatformAuditEntry, 'action' | 'firm_name'>): string {
  const firm = e.firm_name ?? 'a company';
  switch (e.action) {
    case 'login': return 'Signed in';
    case 'create_firm': return `Added ${firm}`;
    case 'suspend_firm': return `Suspended ${firm}`;
    case 'reactivate_firm': return `Reactivated ${firm}`;
    case 'reissue_owner_invite': return `Sent a new owner invite for ${firm}`;
    default: return [e.action, e.firm_name].filter(Boolean).join(': ');
  }
}

/** A read-only invite link that selects itself, a Copy button that says when it worked, and a fallback when it did not. */
function InviteLinkField({ url }: { url: string }) {
  const id = useId();
  const { state, copy } = useCopy();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
      <TextField id={id} label="Invite link" value={url} readOnly mono onFocus={(e) => e.currentTarget.select()} onClick={(e) => e.currentTarget.select()} />
      <div><Button icon={<Copy size={16} strokeWidth={1.5} aria-hidden />} onClick={() => void copy(url, id)}>{state === 'copied' ? 'Copied' : 'Copy link'}</Button></div>
      {state === 'copied' && <span className="sr-only" role="status">Invite link copied.</span>}
      {state === 'blocked' && <InlineAlert variant="warn" title={COPY_BLOCKED} />}
    </div>
  );
}

const INVITATION_LABEL: Record<string, string> = { 'Not sent': 'Not sent', Sent: 'Invite sent', Accepted: 'Accepted', Expired: 'Invite expired' };

/** One company: counts, settings and the owner. Never projects, money or the firm's other people. */
function CompanySheet({ firm, onClose, onChanged, onStatus }: {
  firm: PlatformFirm | null;
  onClose: () => void;
  onChanged: () => void;
  onStatus: (kind: 'suspend' | 'reactivate', firm: PlatformFirm) => void;
}) {
  const [detail, setDetail] = useState<PlatformFirmDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [invite, setInvite] = useState<OwnerInvite | null>(null);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const id = firm?.id;

  const load = useCallback(async (firmId: string) => {
    setState('loading');
    try {
      setDetail(await getFirm(firmId));
      setState('ready');
    } catch (e) {
      setError(failureMessage(e));
      setState('error');
    }
  }, []);

  useEffect(() => {
    setDetail(null); setInvite(null); setInviteError(null); setInviting(false);
    if (id) void load(id);
  }, [id, load]);

  if (!firm) return null;
  const shown = detail;
  const status = shown?.status ?? firm.status;
  const pendingOwner = !!shown && shown.owner_invitation_state !== 'Accepted' && !!shown.owner_email;
  const canInvite = pendingOwner && shown?.status === 'Active';
  const current: PlatformFirm = shown ? { ...firm, ...shown } : firm;

  const newInvite = async () => {
    setInviting(true);
    setInviteError(null);
    try {
      setInvite(await reissueOwnerInvite(firm.id));
      onChanged();
      void load(firm.id);
    } catch (e) {
      setInviteError(failureMessage(e));
    } finally {
      setInviting(false);
    }
  };

  const footer = (
    <>
      {status === 'Active'
        ? <Button variant="danger" onClick={() => onStatus('suspend', current)}>Suspend</Button>
        : <Button onClick={() => onStatus('reactivate', current)}>Reactivate</Button>}
      <Button variant="primary" onClick={onClose}>Close</Button>
    </>
  );

  return (
    <Sheet open onClose={onClose} title={firm.trading_name} description="Company detail" size={480} footer={footer}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-5)' }}>
        {state === 'loading' && <ListStateBlock state="loading" label="Company detail" rows={6} />}
        {state === 'error' && <ListStateBlock state="error" label="Company detail" errorMessage={error} onRetry={() => void load(firm.id)} />}
        {state === 'ready' && shown && (
          <>
            <div><StatusChip status={shown.status} /></div>
            {shown.status === 'Suspended' && shown.suspended_reason && (
              <InlineAlert variant="warn" title="Suspended">{shown.suspended_reason}</InlineAlert>
            )}
            <dl className="def-list">
              {legalDiffers(shown) && <><dt>Legal name</dt><dd>{shown.legal_name}</dd></>}
              <dt>Created</dt><dd className="t-numeric">{dateOf(shown.created_at)}</dd>
              <dt>Timezone</dt><dd>{shown.timezone}</dd>
              <dt>Currency</dt><dd>{shown.currency}</dd>
              <dt>People</dt><dd className="t-numeric">{formatGrouped(shown.people)}</dd>
              <dt>Active people</dt><dd className="t-numeric">{formatGrouped(shown.active_people)}</dd>
              <dt>Last login</dt><dd className={shown.last_login_at ? 't-numeric' : undefined}>{shown.last_login_at ? dateTimeOf(shown.last_login_at) : 'Never'}</dd>
            </dl>
            <section aria-label="Owner" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
              <h3 className="t-label">Owner</h3>
              <dl className="def-list">
                <dt>Name</dt><dd>{shown.owner_name ?? 'Not set'}</dd>
                <dt>Email</dt><dd>{shown.owner_email ?? 'Not set'}</dd>
                <dt>Invitation</dt>
                <dd>{shown.owner_invitation_state
                  ? <StatusChip size="sm" status={shown.owner_invitation_state} label={INVITATION_LABEL[shown.owner_invitation_state]} />
                  : 'None'}</dd>
              </dl>
              {inviteError && <InlineAlert variant="danger" title={inviteError} />}
              {invite ? (
                <>
                  <InlineAlert variant="success" title="New invite link ready.">
                    Send it to {shown.owner_name ?? 'the owner'}. It works once and expires on {dateTimeOf(invite.invite_expires_at)}. Earlier links no longer work.
                  </InlineAlert>
                  <InviteLinkField url={new URL(invite.invite_url, window.location.origin).toString()} />
                  <InlineAlert variant="warn" title="Email delivery is not connected.">No email was sent. Share the link with the owner yourself.</InlineAlert>
                </>
              ) : canInvite ? (
                <div><Button loading={inviting} onClick={() => void newInvite()}>New invite link</Button></div>
              ) : pendingOwner ? (
                <span className="t-body-sm ink-2">Reactivate the company to send the owner a new invite link.</span>
              ) : null}
            </section>
          </>
        )}
      </div>
    </Sheet>
  );
}

function groupAudit(entries: PlatformAuditEntry[]): ActivityDay[] {
  const days = new Map<string, ActivityDay>();
  for (const e of entries) {
    const day = dateOf(e.at);
    if (!days.has(day)) days.set(day, { day, events: [] });
    const what = describeAction(e);
    days.get(day)!.events.push({
      id: e.id,
      actor: e.admin_name,
      action: e.reason ? `${what} - ${e.reason}` : what,
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

  const close = () => {
    setForm(EMPTY_FIRM); setErrors({}); setFailure(null); setResult(null); setBusy(false);
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
          <InviteLinkField url={inviteLink} />
          <InlineAlert variant="warn" title="Email delivery is not connected.">No email was sent. Share the link with the owner yourself.</InlineAlert>
          <span className="t-body-sm ink-2">Lost the link? Open the company from the list and choose New invite link.</span>
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
