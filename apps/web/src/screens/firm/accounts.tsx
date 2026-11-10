import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { ApiFailure, failureMessage, isLive } from '../../api/live';
import {
  ACCOUNT_TYPES, absoluteInviteUrl, accountTypeLabel, createAccount, deactivateAccount, listAccounts, reactivateAccount, resendInvite,
  rolesToAccountTypes, setAccountTypes, type Account, type AccountType, type Invite,
} from '../../api/live/accounts';
import { absoluteResetUrl, issueResetLink, type ResetLink } from '../../api/live/password';
import { PEOPLE } from '../../mock/studio-meridian';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { DataTable, type Column, type DataTableState } from '../../ui/DataTable';
import { Form, FormSection } from '../../ui/Form';
import { InlineAlert } from '../../ui/InlineAlert';
import type { MenuItem } from '../../ui/Menu';
import { PersonPicker } from '../../ui/PersonPicker';
import { Sheet } from '../../ui/Sheet';
import { StatusChip } from '../../ui/StatusChip';
import type { Status } from '../../ui/status-colors';
import { TextArea } from '../../ui/TextArea';
import { TextField } from '../../ui/TextField';
import { useToast } from '../../ui/Toast';
import { COPY_BLOCKED, useCopy } from '../../ui/copy';

export const EMAIL_NOTE = 'Email delivery is not connected yet. Send this link yourself.';
export const RESET_NOTE = 'Email is not connected yet. Send this link to them yourself, over a channel you trust.';
const MOCK_NOTE = 'Nothing is saved in this demo.';
const CAPABILITY = 'manage accounts';
const EMAIL_RE = /^\S+@\S+\.\S+$/;

/** Mock mode: the sample directory, with permission sets shown as account types. */
const mockAccounts = (): Account[] => PEOPLE.map((p) => ({
  id: p.id, ref_code: p.id, name: p.name, work_email: `${p.id.toLowerCase()}@meridian.demo`, job_title: p.title, manager_id: p.managerId,
  account_types: rolesToAccountTypes(p.roles), invitation_state: p.invitation as Account['invitation_state'],
  login_state: String(p.login), employment_state: String(p.employment), created_at: '2026-04-01',
}));

const isRevoked = (a: Account) => a.login_state === 'Revoked';

function TypeChips({ types }: { types: string[] }) {
  if (!types.length) return <span className="ink-2">None</span>;
  return <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 'var(--s-1)' }}>{types.map((t) => <StatusChip key={t} size="sm" status="None" label={accountTypeLabel(t)} />)}</span>;
}

/** Checkbox group with what each account type can see. */
function TypePicker({ value, onChange, error }: { value: AccountType[]; onChange: (v: AccountType[]) => void; error?: string }) {
  const toggle = (t: AccountType, on: boolean) => onChange(on ? ACCOUNT_TYPES.map((a) => a.value).filter((x) => x === t || value.includes(x)) : value.filter((x) => x !== t));
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }} aria-describedby={error ? 'account-type-error' : undefined}>
      <legend className="t-label" style={{ marginBottom: 'var(--s-2)' }}>Account type</legend>
      {ACCOUNT_TYPES.map((a) => (
        <Checkbox key={a.value} label={a.label} description={a.description} checked={value.includes(a.value)} onChange={(e) => toggle(a.value, e.target.checked)} />
      ))}
      <span className="t-caption ink-2">Principal and Finance can see money. Only someone allowed to grant sensitive access can give them.</span>
      {error && <span id="account-type-error" className="field__error" role="alert">{error}</span>}
    </fieldset>
  );
}

/** The invite link, a copy button and the delivery note. */
export function InviteLink({ invite }: { invite: Invite }) {
  const toast = useToast();
  const id = useId();
  const url = absoluteInviteUrl(invite.invite_url);
  const { state, copy } = useCopy();
  const onCopy = async () => {
    if (await copy(url, id)) toast({ variant: 'success', message: 'Invite link copied.' });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
      <TextField id={id} label="Invite link" value={url} readOnly mono onFocus={(e) => e.currentTarget.select()} onClick={(e) => e.currentTarget.select()} helper={`Works once, until ${new Date(invite.invite_expires_at).toLocaleString()}.`} />
      <span><Button onClick={() => void onCopy()}>{state === 'copied' ? 'Copied' : 'Copy link'}</Button></span>
      {state === 'blocked' && <InlineAlert variant="warn" title={COPY_BLOCKED} />}
      <InlineAlert variant="warn" title={EMAIL_NOTE} />
    </div>
  );
}

/** The reset link, a copy button and the note that email is not connected. */
export function ResetLinkView({ link }: { link: ResetLink }) {
  const toast = useToast();
  const id = useId();
  const url = absoluteResetUrl(link.reset_url);
  const { state, copy } = useCopy();
  const onCopy = async () => {
    if (await copy(url, id)) toast({ variant: 'success', message: 'Reset link copied.' });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
      <TextField id={id} label="Reset link" value={url} readOnly mono onFocus={(e) => e.currentTarget.select()} onClick={(e) => e.currentTarget.select()} helper={`Works once, until ${new Date(link.expires_at).toLocaleString()}.`} />
      <span><Button onClick={() => void onCopy()}>{state === 'copied' ? 'Copied' : 'Copy link'}</Button></span>
      {state === 'blocked' && <InlineAlert variant="warn" title={COPY_BLOCKED} />}
      <InlineAlert variant="warn" title={RESET_NOTE} />
    </div>
  );
}

type Draft = { name: string; email: string; title: string; manager: string | null; types: AccountType[] };
const BLANK: Draft = { name: '', email: '', title: '', manager: null, types: ['employee'] };

function AddAccountSheet({ open, onClose, people, onCreated }: { open: boolean; onClose: () => void; people: Account[]; onCreated: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<Draft>(BLANK);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState<string | null>(null);
  const [invite, setInvite] = useState<Invite | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => { setForm((f) => ({ ...f, [k]: v })); if (k === 'email') setEmailTaken(null); };

  const errors = {
    name: !form.name.trim() ? 'Enter their full name' : undefined,
    email: !EMAIL_RE.test(form.email.trim()) ? 'Enter a valid work email' : emailTaken ?? undefined,
    title: !form.title.trim() ? 'Enter their job title' : undefined,
    types: !form.types.length ? 'Choose at least one account type' : undefined,
  };
  const invalid = Object.values(errors).some(Boolean);
  const show = (k: keyof typeof errors) => (tried || (k === 'email' && emailTaken) ? errors[k] : undefined);
  const dirty = !invite && (form.name !== '' || form.email !== '' || form.title !== '');

  const close = () => { setForm(BLANK); setTried(false); setServerError(null); setEmailTaken(null); setInvite(null); setBusy(false); onClose(); };
  const submit = async () => {
    setTried(true);
    setServerError(null);
    if (invalid) return;
    if (!isLive) { toast({ variant: 'success', message: `Account for ${form.name.trim()} checked. ${MOCK_NOTE}` }); close(); return; }
    setBusy(true);
    try {
      const res = await createAccount({ name: form.name.trim(), work_email: form.email.trim(), job_title: form.title.trim(), manager_id: form.manager, account_types: form.types });
      setInvite(res);
      onCreated();
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'DUPLICATE_EMAIL') setEmailTaken(e.message || 'An account with this email already exists');
      else setServerError(failureMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const managers = people.filter((p) => !isRevoked(p)).map((p) => ({ id: p.id, name: p.name, title: p.job_title }));
  return (
    <Sheet
      open={open} onClose={close} size={480} dirty={dirty}
      title={invite ? 'Account created' : 'Add account'}
      description={invite ? `Send ${form.name.trim()} this link to set their password.` : 'They set their own password from an invite link.'}
      footer={invite
        ? <Button variant="primary" onClick={close}>Done</Button>
        : (
          <>
            {tried && invalid && <span className="form__summary" role="status">Fix the highlighted fields to continue</span>}
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={submit}>Create account</Button>
          </>
        )}
    >
      {invite ? <InviteLink invite={invite} /> : (
        <Form onSubmit={(e) => { e.preventDefault(); void submit(); }} aria-label="Add account">
          {serverError && <InlineAlert variant="danger" title={serverError} />}
          <FormSection>
            <TextField label="Full name" value={form.name} onChange={(e) => set('name', e.target.value)} error={show('name')} autoComplete="off" />
            <TextField label="Work email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} error={show('email')} autoComplete="off" />
            <TextField label="Job title" value={form.title} onChange={(e) => set('title', e.target.value)} error={show('title')} />
            <PersonPicker label="Manager" people={managers} value={form.manager} onChange={(id) => set('manager', id)} helper="Optional" />
          </FormSection>
          <TypePicker value={form.types} onChange={(v) => set('types', v)} error={show('types')} />
        </Form>
      )}
    </Sheet>
  );
}

function TypesSheet({ account, onClose, onSaved }: { account: Account | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [types, setTypes] = useState<AccountType[]>([]);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  useEffect(() => {
    setTypes(ACCOUNT_TYPES.map((a) => a.value).filter((t) => account?.account_types.includes(t)));
    setTried(false); setServerError(null);
  }, [account]);
  const error = !types.length ? 'Choose at least one account type' : undefined;
  const save = async () => {
    setTried(true); setServerError(null);
    if (!account || error) return;
    if (!isLive) { toast({ variant: 'success', message: `Account type for ${account.name} checked. ${MOCK_NOTE}` }); onClose(); return; }
    setBusy(true);
    try {
      await setAccountTypes(account.id, types);
      toast({ variant: 'success', message: `Account type for ${account.name} saved.` });
      onSaved(); onClose();
    } catch (e) {
      setServerError(failureMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={!!account} onClose={onClose} size={480} title="Change account type" description={account ? `${account.name}, ${account.work_email}` : undefined}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}
    >
      {serverError && <InlineAlert variant="danger" title={serverError} />}
      <TypePicker value={types} onChange={setTypes} error={tried ? error : undefined} />
    </Sheet>
  );
}

type Pending = { kind: 'invite' | 'reset' | 'deactivate' | 'reactivate'; account: Account };
const CONFIRM: Record<Pending['kind'], { title: string; button: string; body: (a: Account) => string }> = {
  invite: { title: 'Resend invite', button: 'Create new link', body: (a) => `A new invite link is made for ${a.name}. Any earlier link stops working.` },
  reset: { title: 'Reset password link', button: 'Create reset link', body: (a) => `${a.name} can set a new password from this link for 24 hours. Any earlier reset link stops working, and setting a password signs them out everywhere.` },
  deactivate: { title: 'Deactivate account', button: 'Deactivate', body: (a) => `${a.name} is signed out everywhere and can no longer sign in. Their records stay.` },
  reactivate: { title: 'Reactivate account', button: 'Reactivate', body: (a) => `${a.name} can sign in again with their existing password.` },
};

function ConfirmSheet({ pending, onClose, onDone }: { pending: Pending | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [resetLink, setResetLink] = useState<ResetLink | null>(null);
  useEffect(() => { setReason(''); setTried(false); setServerError(null); setInvite(null); setResetLink(null); }, [pending]);
  if (!pending) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;
  const cfg = CONFIRM[pending.kind];
  const { account } = pending;
  const reasonError = pending.kind === 'deactivate' && !reason.trim() ? 'Enter a reason' : undefined;

  const run = async () => {
    setTried(true); setServerError(null);
    if (reasonError) return;
    if (!isLive) { toast({ variant: 'success', message: `${cfg.title} for ${account.name} checked. ${MOCK_NOTE}` }); onClose(); return; }
    setBusy(true);
    try {
      if (pending.kind === 'invite') { setInvite(await resendInvite(account.id)); onDone(); return; }
      if (pending.kind === 'reset') { setResetLink(await issueResetLink(account.id)); return; }
      if (pending.kind === 'deactivate') await deactivateAccount(account.id, reason.trim());
      else await reactivateAccount(account.id);
      toast({ variant: 'success', message: pending.kind === 'deactivate' ? `${account.name} is deactivated.` : `${account.name} is active again.` });
      onDone(); onClose();
    } catch (e) {
      setServerError(failureMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open onClose={onClose} size={480}
      title={invite ? 'New invite link' : resetLink ? 'Password reset link' : cfg.title}
      description={invite || resetLink ? `Send ${account.name} this link.` : cfg.body(account)}
      footer={invite || resetLink ? <Button variant="primary" onClick={onClose}>Done</Button> : (
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={pending.kind === 'deactivate' ? 'danger' : 'primary'} loading={busy} onClick={run}>{cfg.button}</Button>
        </>
      )}
    >
      {serverError && <InlineAlert variant="danger" title={serverError} />}
      {resetLink ? <ResetLinkView link={resetLink} /> : invite ? <InviteLink invite={invite} /> : pending.kind === 'deactivate' && (
        <TextArea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} error={tried ? reasonError : undefined} helper="Kept in the audit log." />
      )}
    </Sheet>
  );
}

/** Settings section: firm accounts, their types, invites and sign-in access. */
export function AccountsSettings() {
  const [rows, setRows] = useState<Account[]>([]);
  const [state, setState] = useState<DataTableState>('loading');
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const load = useCallback(async () => {
    if (!isLive) { const m = mockAccounts(); setRows(m); setState(m.length ? 'ready' : 'empty'); return; }
    setState((s) => (s === 'ready' ? s : 'loading'));
    try {
      const res = await listAccounts();
      setRows(res.data);
      setState(res.data.length ? 'ready' : 'empty');
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 403) { setState('denied'); return; }
      setErrorMessage(failureMessage(e));
      setState('error');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const columns = useMemo<Column<Account>[]>(() => [
    { key: 'name', header: 'Name', type: 'person', value: (r) => r.name, sortable: true },
    { key: 'email', header: 'Work email', value: (r) => r.work_email, sortable: true },
    { key: 'types', header: 'Account type', value: (r) => r.account_types.map(accountTypeLabel).join(', '), render: (r) => <TypeChips types={r.account_types} /> },
    { key: 'invitation', header: 'Invitation', type: 'status', value: (r) => r.invitation_state as Status },
    { key: 'login', header: 'Sign-in', type: 'status', value: (r) => r.login_state as Status },
  ], []);

  const actions = (r: Account): MenuItem[] => [
    { label: 'Change account type', onSelect: () => setEditing(r) },
    { label: 'Resend invite', disabled: r.invitation_state === 'Accepted' || isRevoked(r), onSelect: () => setPending({ kind: 'invite', account: r }) },
    ...(r.invitation_state === 'Accepted' && !isRevoked(r) ? [{ label: 'Reset password link', onSelect: () => setPending({ kind: 'reset', account: r }) }] : []),
    { type: 'separator' },
    isRevoked(r)
      ? { label: 'Reactivate', onSelect: () => setPending({ kind: 'reactivate', account: r }) }
      : { label: 'Deactivate', danger: true, onSelect: () => setPending({ kind: 'deactivate', account: r }) },
  ];

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
        <h2 className="t-h2" style={{ marginRight: 'auto' }}>Accounts</h2>
        {state !== 'denied' && <Button variant="primary" onClick={() => setAdding(true)}>Add account</Button>}
      </div>
      {!isLive && <InlineAlert variant="info" title="Sample accounts. Changes here are not saved." />}
      <DataTable
        label="Accounts" columns={columns} rows={rows} rowKey={(r) => r.id} state={state} onRetry={() => void load()} errorMessage={errorMessage}
        capability={CAPABILITY} rowActions={actions}
        empty={{ message: 'No accounts yet.', action: <Button onClick={() => setAdding(true)}>Add account</Button> }}
      />
      <AddAccountSheet open={adding} onClose={() => setAdding(false)} people={rows} onCreated={() => void load()} />
      <TypesSheet account={editing} onClose={() => setEditing(null)} onSaved={() => void load()} />
      <ConfirmSheet pending={pending} onClose={() => setPending(null)} onDone={() => void load()} />
    </>
  );
}
