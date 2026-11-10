import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { Copy, Plus } from 'lucide-react';
import { ApiFailure, failureMessage } from '../../api/live';
import { ACCOUNT_TYPES, accountTypeLabel, type AccountType } from '../../api/live/accounts';
import {
  absolutePlatformUrl, addFirmPerson, disablePerson, enablePerson, issuePersonInviteLink, issuePersonResetLink, listFirmPeople, setPersonTypes,
  type PlatformPerson, type PlatformPersonInvite, type PlatformResetLink,
} from '../../api/live/platform';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { DataTable, type Column, type DataTableState } from '../../ui/DataTable';
import { Form } from '../../ui/Form';
import { InlineAlert } from '../../ui/InlineAlert';
import type { MenuItem } from '../../ui/Menu';
import { Sheet } from '../../ui/Sheet';
import { StatusChip } from '../../ui/StatusChip';
import type { Status } from '../../ui/status-colors';
import { TextArea } from '../../ui/TextArea';
import { TextField } from '../../ui/TextField';
import { COPY_BLOCKED, useCopy } from '../../ui/copy';
import { formatDate, toISO } from '../../ui/format';

export const EMAIL_NOT_CONNECTED = 'Email delivery is not connected.';
const EMAIL_RE = /^\S+@\S+\.\S+$/;

/** Same date style as the rest of the app ("08 Nov 2026"), in local time, then the time. */
export const dateTimeOf = (iso: string) => {
  const d = new Date(iso);
  return `${formatDate(toISO(d))}, ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
};

export const INVITATION_LABEL: Record<string, string> = { 'Not sent': 'Not sent', Sent: 'Invite sent', Accepted: 'Accepted', Expired: 'Invite expired' };
const SIGN_IN_LABEL: Record<string, string> = { Enabled: 'Sign-in enabled', Revoked: 'Sign-in disabled', Suspended: 'Sign-in suspended' };

const isAccepted = (p: PlatformPerson) => p.invitation_state === 'Accepted';
const isEnabled = (p: PlatformPerson) => p.login_state === 'Enabled';

/** A read-only link that selects itself, a Copy button that says when it worked, and a fallback when it did not. */
export function LinkField({ label, url, helper }: { label: string; url: string; helper?: string }) {
  const id = useId();
  const { state, copy } = useCopy();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
      <TextField id={id} label={label} value={url} readOnly mono helper={helper} onFocus={(e) => e.currentTarget.select()} onClick={(e) => e.currentTarget.select()} />
      <div><Button icon={<Copy size={16} strokeWidth={1.5} aria-hidden />} onClick={() => void copy(url, id)}>{state === 'copied' ? 'Copied' : 'Copy link'}</Button></div>
      {state === 'copied' && <span className="sr-only" role="status">{label} copied.</span>}
      {state === 'blocked' && <InlineAlert variant="warn" title={COPY_BLOCKED} />}
    </div>
  );
}

function EmailNote({ who }: { who: string }) {
  return <InlineAlert variant="warn" title={EMAIL_NOT_CONNECTED}>No email was sent. Share the link with {who} yourself, over a channel you trust.</InlineAlert>;
}

function TypeChips({ types }: { types: string[] }) {
  if (!types.length) return <span className="ink-2 t-body-sm">None</span>;
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 'var(--s-1)' }}>
      {types.map((t) => <StatusChip key={t} size="sm" status="None" label={accountTypeLabel(t)} />)}
    </span>
  );
}

const ORDERED = ACCOUNT_TYPES.map((a) => a.value);
const known = (types: string[]): AccountType[] => ORDERED.filter((t) => types.includes(t));

/** The five account types as checkboxes, with what each one can see. */
function TypePicker({ value, onChange, error }: { value: AccountType[]; onChange: (v: AccountType[]) => void; error?: string }) {
  const errorId = useId();
  const toggle = (t: AccountType, on: boolean) => onChange(on ? ORDERED.filter((x) => x === t || value.includes(x)) : value.filter((x) => x !== t));
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }} aria-describedby={error ? errorId : undefined}>
      <legend className="t-label" style={{ marginBottom: 'var(--s-2)' }}>Account type</legend>
      {ACCOUNT_TYPES.map((a) => (
        <Checkbox key={a.value} label={a.label} description={a.description} checked={value.includes(a.value)} onChange={(e) => toggle(a.value, e.target.checked)} />
      ))}
      <span className="t-caption ink-2">Every company keeps at least one Principal who can sign in.</span>
      {error && <span id={errorId} className="field__error" role="alert">{error}</span>}
    </fieldset>
  );
}

export type PersonActionKind = 'reset' | 'invite' | 'types' | 'disable' | 'enable';
export type PeopleAction =
  | { kind: 'add'; firmId: string; firmName: string }
  | { kind: PersonActionKind; firmId: string; firmName: string; person: PlatformPerson };

/** The company's people, with what the platform admin can do for each of them. Names and access only. */
export function PeopleSection({ firmId, firmName, notice, onAction }: {
  firmId: string;
  firmName: string;
  notice: string | null;
  onAction: (action: PeopleAction) => void;
}) {
  const [people, setPeople] = useState<PlatformPerson[]>([]);
  const [state, setState] = useState<DataTableState>('loading');
  const [error, setError] = useState('');
  const headingId = useId();

  const load = useCallback(async () => {
    setState('loading');
    try {
      const data = await listFirmPeople(firmId);
      setPeople(data);
      setState(data.length ? 'ready' : 'empty');
    } catch (e) {
      setError(failureMessage(e));
      setState(e instanceof ApiFailure && e.status === 403 ? 'denied' : 'error');
    }
  }, [firmId]);

  useEffect(() => { void load(); }, [load]);

  const act = (kind: PersonActionKind, person: PlatformPerson) => onAction({ kind, firmId, firmName, person });

  const columns: Column<PlatformPerson>[] = [
    {
      key: 'name', header: 'Name', value: (p) => p.name, sortable: true,
      render: (p) => (
        <div style={{ minWidth: 0 }}>
          <div>{p.name}</div>
          <div className="t-caption" style={{ overflowWrap: 'anywhere' }}>{p.work_email}</div>
          {p.job_title && <div className="t-caption ink-2">{p.job_title}</div>}
        </div>
      ),
    },
    { key: 'types', header: 'Account type', value: (p) => p.account_types.map(accountTypeLabel).join(', '), render: (p) => <TypeChips types={p.account_types} /> },
    {
      key: 'access', header: 'Access', value: (p) => p.login_state,
      render: (p) => (
        <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--s-1)' }}>
          <StatusChip size="sm" status={p.invitation_state as Status} label={INVITATION_LABEL[p.invitation_state] ?? p.invitation_state} />
          <StatusChip size="sm" status={p.login_state as Status} label={SIGN_IN_LABEL[p.login_state] ?? p.login_state} />
        </span>
      ),
    },
    {
      key: 'last_sign_in', header: 'Last sign-in', value: (p) => p.last_sign_in_at ?? '', sortable: true,
      render: (p) => (p.last_sign_in_at ? <span className="t-numeric t-body-sm">{dateTimeOf(p.last_sign_in_at)}</span> : <span className="t-body-sm ink-2">Never</span>),
    },
  ];

  const actions = (p: PlatformPerson): MenuItem[] => [
    ...(isAccepted(p) && isEnabled(p) ? [{ label: 'Reset password link', onSelect: () => act('reset', p) }] : []),
    // The server issues an invite only for an Enabled login (an invite for any other could never be accepted).
    ...(!isAccepted(p) && isEnabled(p) ? [{ label: 'New invite link', onSelect: () => act('invite', p) }] : []),
    { label: 'Change account type', onSelect: () => act('types', p) },
    { type: 'separator' },
    isEnabled(p)
      ? { label: 'Disable sign-in', danger: true, onSelect: () => act('disable', p) }
      : { label: 'Enable sign-in', onSelect: () => act('enable', p) },
  ];

  const loaded = state === 'ready' || state === 'empty';
  return (
    <section aria-labelledby={headingId} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--s-3)' }}>
        <h3 id={headingId} className="t-h3">People</h3>
        {loaded && <span className="t-body-sm ink-2">{people.length} {people.length === 1 ? 'person' : 'people'}</span>}
        <span style={{ marginLeft: 'auto' }}>
          <Button size="dense" icon={<Plus size={16} strokeWidth={1.5} aria-hidden />} onClick={() => onAction({ kind: 'add', firmId, firmName })}>Add person</Button>
        </span>
      </div>
      {notice && <InlineAlert variant="success" title={notice} />}
      <DataTable
        label={`People at ${firmName}`}
        columns={columns}
        rows={people}
        rowKey={(p) => p.id}
        state={state}
        density="dense"
        empty={{ message: 'No people yet.' }}
        errorMessage={error}
        onRetry={() => void load()}
        capability="manage people"
        rowActions={actions}
      />
    </section>
  );
}

/** The sheet for one people action. Shown in place of the company sheet, which comes back when this closes. */
export function PeopleActionSheet({ action, onClose, onChanged }: {
  action: PeopleAction | null;
  onClose: () => void;
  /** Something changed on the server. The message, when given, is shown back on the company sheet. */
  onChanged: (message?: string) => void;
}) {
  if (!action) return null;
  switch (action.kind) {
    case 'add': return <AddPersonSheet action={action} onClose={onClose} onChanged={onChanged} />;
    case 'reset':
    case 'invite': return <LinkSheet action={action} kind={action.kind} person={action.person} onClose={onClose} onChanged={onChanged} />;
    case 'types': return <TypesSheet action={action} person={action.person} onClose={onClose} onChanged={onChanged} />;
    case 'disable':
    case 'enable': return <AccessSheet action={action} kind={action.kind} person={action.person} onClose={onClose} onChanged={onChanged} />;
  }
}

type SheetProps = { action: PeopleAction; onClose: () => void; onChanged: (message?: string) => void };

const LINK_COPY = {
  reset: {
    title: 'Reset password link',
    button: 'Create reset link',
    body: (name: string) => `${name} can set a new password from this link, once, for 24 hours. Any earlier reset link stops working, and setting a password signs them out everywhere. You never see or set the password.`,
  },
  invite: {
    title: 'New invite link',
    button: 'Create invite link',
    body: (name: string) => `${name} can accept the invite and set their own password from this link, once, for 72 hours. Any earlier invite link stops working.`,
  },
} as const;

function LinkSheet({ action, kind, person, onClose, onChanged }: SheetProps & { kind: 'reset' | 'invite'; person: PlatformPerson }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; expires: string } | null>(null);
  const copy = LINK_COPY[kind];

  const run = async () => {
    setBusy(true);
    setFailure(null);
    try {
      if (kind === 'reset') {
        const r: PlatformResetLink = await issuePersonResetLink(action.firmId, person.id);
        setLink({ url: r.reset_url, expires: r.expires_at });
      } else {
        const r: PlatformPersonInvite = await issuePersonInviteLink(action.firmId, person.id);
        setLink({ url: r.invite_url, expires: r.invite_expires_at });
      }
      onChanged();
    } catch (e) {
      setFailure(failureMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open onClose={onClose} size={480}
      title={link ? (kind === 'reset' ? 'Password reset link' : 'New invite link') : copy.title}
      description={`${person.name}, ${person.work_email}`}
      footer={link ? <Button variant="primary" onClick={onClose}>Done</Button> : (
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void run()}>{copy.button}</Button>
        </>
      )}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' }}>
        {failure && <InlineAlert variant="danger" title={failure} />}
        {link ? (
          <>
            <InlineAlert variant="success" title={kind === 'reset' ? 'Reset link ready.' : 'New invite link ready.'}>
              It works once and expires on {dateTimeOf(link.expires)}. Earlier links no longer work.
            </InlineAlert>
            <LinkField label={kind === 'reset' ? 'Reset link' : 'Invite link'} url={absolutePlatformUrl(link.url)} />
            <EmailNote who={person.name} />
          </>
        ) : <p className="t-body">{copy.body(person.name)}</p>}
      </div>
    </Sheet>
  );
}

function TypesSheet({ action, person, onClose, onChanged }: SheetProps & { person: PlatformPerson }) {
  const [types, setTypes] = useState<AccountType[]>(() => known(person.account_types));
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const typesError = !types.length ? 'Choose at least one account type.' : undefined;
  const reasonError = !reason.trim() ? 'Enter why the account type is changing.' : undefined;
  const changed = types.join(',') !== known(person.account_types).join(',');

  const save = async () => {
    setTried(true);
    setFailure(null);
    if (typesError || reasonError) return;
    setBusy(true);
    try {
      await setPersonTypes(action.firmId, person.id, types, reason.trim());
      onChanged(`Account type for ${person.name} saved.`);
      onClose();
    } catch (e) {
      setFailure(failureMessage(e));
      setBusy(false);
    }
  };

  return (
    <Sheet
      open onClose={onClose} size={480} dirty={changed || reason.trim() !== ''}
      title="Change account type" description={`${person.name}, ${person.work_email}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Save</Button></>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' }}>
        {failure && <InlineAlert variant="danger" title={failure} />}
        <TypePicker value={types} onChange={setTypes} error={tried ? typesError : undefined} />
        <span className="t-caption ink-2">Giving Principal or Finance makes any open invite or reset link for {person.name} stop working.</span>
        <TextArea label="Reason" value={reason} error={tried ? reasonError : undefined} helper={`Recorded in the platform activity and in ${action.firmName}'s audit log.`} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Sheet>
  );
}

function AccessSheet({ action, kind, person, onClose, onChanged }: SheetProps & { kind: 'disable' | 'enable'; person: PlatformPerson }) {
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const disable = kind === 'disable';
  const reasonError = !reason.trim() ? (disable ? 'Enter why sign-in is being disabled.' : 'Enter why sign-in is being enabled.') : undefined;

  const run = async () => {
    setTried(true);
    setFailure(null);
    if (reasonError) return;
    setBusy(true);
    try {
      await (disable ? disablePerson : enablePerson)(action.firmId, person.id, reason.trim());
      onChanged(disable ? `${person.name} can no longer sign in.` : `${person.name} can sign in again.`);
      onClose();
    } catch (e) {
      setFailure(failureMessage(e));
      setBusy(false);
    }
  };

  return (
    <Sheet
      open onClose={onClose} size={480} dirty={reason.trim() !== ''}
      title={disable ? `Disable sign-in for ${person.name}` : `Enable sign-in for ${person.name}`}
      description={person.work_email}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={disable ? 'danger' : 'primary'} loading={busy} onClick={() => void run()}>{disable ? 'Disable sign-in' : 'Enable sign-in'}</Button>
        </>
      )}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' }}>
        {disable
          ? <InlineAlert variant="warn" title={`${person.name} is signed out everywhere.`}>They cannot sign in, and any open invite or reset link stops working. Their records stay.</InlineAlert>
          : <InlineAlert variant="info" title={`${person.name} can sign in again.`}>They use their existing password. If they have forgotten it, create a reset link afterwards.</InlineAlert>}
        {failure && <InlineAlert variant="danger" title={failure} />}
        <TextArea label="Reason" value={reason} error={tried ? reasonError : undefined} helper={`Recorded in the platform activity and in ${action.firmName}'s audit log.`} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Sheet>
  );
}

type Draft = { name: string; email: string; title: string; types: AccountType[] };
const BLANK: Draft = { name: '', email: '', title: '', types: ['employee'] };

function AddPersonSheet({ action, onClose, onChanged }: SheetProps) {
  const [form, setForm] = useState<Draft>(BLANK);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState<string | null>(null);
  const [invite, setInvite] = useState<PlatformPersonInvite | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => { setForm((f) => ({ ...f, [k]: v })); if (k === 'email') setEmailTaken(null); };

  const errors = {
    name: !form.name.trim() ? 'Enter their full name.' : undefined,
    email: !form.email.trim() ? 'Enter their work email.' : !EMAIL_RE.test(form.email.trim()) ? 'Enter a valid email address.' : emailTaken ?? undefined,
    types: !form.types.length ? 'Choose at least one account type.' : undefined,
  };
  const invalid = !!(errors.name || errors.email || errors.types);
  const show = (k: keyof typeof errors) => (tried || (k === 'email' && emailTaken) ? errors[k] : undefined);
  const dirty = !invite && (form.name !== '' || form.email !== '' || form.title !== '');

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setTried(true);
    setFailure(null);
    if (invalid) return;
    setBusy(true);
    try {
      const title = form.title.trim();
      const res = await addFirmPerson(action.firmId, {
        name: form.name.trim(), work_email: form.email.trim(), ...(title ? { job_title: title } : {}), account_types: form.types,
      });
      setInvite(res);
      onChanged(`${res.person.name} added to ${action.firmName}.`);
    } catch (err) {
      if (err instanceof ApiFailure && err.code === 'DUPLICATE_EMAIL') setEmailTaken(err.message || 'This email already has an account.');
      else setFailure(failureMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const name = form.name.trim();
  return (
    <Sheet
      open onClose={onClose} size={480} dirty={dirty}
      title={invite ? 'Person added' : 'Add person'}
      description={invite ? `Send ${name} this link to set their password.` : `Adds someone to ${action.firmName}. They set their own password from an invite link.`}
      footer={invite ? <Button variant="primary" onClick={onClose}>Done</Button> : (
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>Add person</Button>
        </>
      )}
    >
      {invite ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' }}>
          <InlineAlert variant="success" title={`${name} is added.`}>The invite link works once and expires on {dateTimeOf(invite.invite_expires_at)}.</InlineAlert>
          <LinkField label="Invite link" url={absolutePlatformUrl(invite.invite_url)} />
          <EmailNote who={name} />
          <span className="t-body-sm ink-2">Lost the link? Choose New invite link from their row.</span>
        </div>
      ) : (
        <Form onSubmit={submit} aria-label="Add person" noValidate>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' }}>
            {failure && <InlineAlert variant="danger" title={failure} />}
            <TextField label="Full name" value={form.name} error={show('name')} autoComplete="off" onChange={(e) => set('name', e.target.value)} />
            <TextField label="Work email" type="email" value={form.email} error={show('email')} autoComplete="off" onChange={(e) => set('email', e.target.value)} />
            <TextField label="Job title" value={form.title} helper="Optional" onChange={(e) => set('title', e.target.value)} />
            <TypePicker value={form.types} onChange={(v) => set('types', v)} error={show('types')} />
            <button type="submit" hidden aria-hidden tabIndex={-1} />
          </div>
        </Form>
      )}
    </Sheet>
  );
}
