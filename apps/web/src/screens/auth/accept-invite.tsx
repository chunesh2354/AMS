import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { ApiFailure, failureMessage, isLive } from '../../api/live';
import { acceptInvite, getInvite, type InviteDetails } from '../../api/live/accounts';
import { Button } from '../../ui/Button';
import { Form } from '../../ui/Form';
import { InlineAlert } from '../../ui/InlineAlert';
import { Skeleton } from '../../ui/Skeleton';
import { TextField } from '../../ui/TextField';

export const MIN_PASSWORD = 12;
const HOME = '/me/home';

type Load = { state: 'loading' } | { state: 'ready'; invite: InviteDetails } | { state: 'expired' } | { state: 'invalid' } | { state: 'error'; message: string };

/** The glass card on the plane, like the sign-in screen. */
function Card({ children }: { children: ReactNode }) {
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 'var(--s-4)' }}>
      <div className="glass glass--elevated" style={{ width: '100%', maxWidth: 440, padding: 'var(--s-8)', borderRadius: 'var(--radius-xl)', display: 'flex', flexDirection: 'column', gap: 'var(--s-6)' }}>
        {children}
      </div>
    </main>
  );
}

/** /accept-invite/:token, outside the shell. The person sets a password and is signed in. */
export function AcceptInviteScreen({ onAccepted = () => window.location.assign(HOME) }: { onAccepted?: () => void }) {
  const { token = '' } = useParams();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!isLive) return;
    let alive = true;
    getInvite(token)
      .then((invite) => alive && setLoad({ state: 'ready', invite }))
      .catch((e) => {
        if (!alive) return;
        if (e instanceof ApiFailure && e.status === 410) setLoad({ state: 'expired' });
        else if (e instanceof ApiFailure && e.status === 404) setLoad({ state: 'invalid' });
        else setLoad({ state: 'error', message: failureMessage(e) });
      });
    return () => { alive = false; };
  }, [token]);

  const errors = {
    password: password.length < MIN_PASSWORD ? `Use at least ${MIN_PASSWORD} characters` : undefined,
    confirm: !confirm ? 'Enter the password again' : confirm !== password ? 'The passwords do not match' : undefined,
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    setFailure(null);
    if (errors.password || errors.confirm) return;
    setBusy(true);
    try {
      await acceptInvite(token, password);
      onAccepted();
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 410) setLoad({ state: 'expired' });
      else setFailure(failureMessage(err));
      setBusy(false);
    }
  };

  if (!isLive) {
    return <Card><h1 className="t-h1">Accept invite</h1><InlineAlert variant="info" title="Invitations work only when the app is connected to the database." /></Card>;
  }
  if (load.state === 'loading') return <Card><Skeleton kind="card" /></Card>;
  if (load.state === 'expired' || load.state === 'invalid') {
    return (
      <Card>
        <h1 className="t-h1">{load.state === 'expired' ? 'This invite link has expired' : 'This invite link is not valid'}</h1>
        <p className="t-body-sm">Invite links work once and last 72 hours. Ask your firm admin to send you a new one.</p>
        <span><Button onClick={() => window.location.assign('/login')}>Go to sign in</Button></span>
      </Card>
    );
  }
  if (load.state === 'error') return <Card><h1 className="t-h1">Accept invite</h1><InlineAlert variant="danger" title={load.message} /></Card>;

  const { invite } = load;
  return (
    <Card>
      <div>
        <h1 className="t-h1">Join {invite.firm_name}</h1>
        <p className="t-body-sm">Set a password to finish setting up your account.</p>
      </div>
      <dl className="t-body-sm" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 'var(--s-1) var(--s-4)', margin: 0 }}>
        <dt className="ink-2">Name</dt><dd style={{ margin: 0 }}>{invite.name}</dd>
        <dt className="ink-2">Work email</dt><dd style={{ margin: 0 }}>{invite.work_email}</dd>
        <dt className="ink-2">Company</dt><dd style={{ margin: 0 }}>{invite.firm_name}</dd>
      </dl>
      {failure && <InlineAlert variant="danger" title={failure} />}
      <Form onSubmit={submit} aria-label="Set your password">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' }}>
          <input type="email" name="username" autoComplete="username" value={invite.work_email} readOnly hidden />
          <TextField
            label="Password" type="password" name="new-password" autoComplete="new-password" autoFocus value={password}
            helper={`At least ${MIN_PASSWORD} characters.`} error={tried ? errors.password : undefined}
            onChange={(e) => setPassword(e.target.value)}
          />
          <TextField
            label="Confirm password" type="password" name="confirm-password" autoComplete="new-password" value={confirm}
            error={tried ? errors.confirm : undefined}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <Button type="submit" variant="primary" size="cta" loading={busy}>Set password and sign in</Button>
        </div>
      </Form>
    </Card>
  );
}
