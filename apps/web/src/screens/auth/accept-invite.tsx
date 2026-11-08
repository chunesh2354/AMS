import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { ApiFailure, failureMessage, isLive } from '../../api/live';
import { acceptInvite, getInvite, type InviteDetails } from '../../api/live/accounts';
import { Skeleton } from '../../ui/Skeleton';
import { AuthAlert, AuthHeading, AuthPage, AuthSplit, LOGIN_PATHS, SecretInput } from './frame';

/** The server refuses anything shorter (accounts.routes MIN_PASSWORD). */
export const MIN_PASSWORD = 12;
const HOME = '/me/home';

type Load = { state: 'loading' } | { state: 'ready'; invite: InviteDetails } | { state: 'expired' } | { state: 'invalid' } | { state: 'error'; message: string };

/** The invite page's frame: the Practice header, the form side and the studio clock. */
function Frame({ children }: { children: ReactNode }) {
  return <AuthPage><AuthSplit wide>{children}</AuthSplit></AuthPage>;
}

const TICK = 'M5 12.5l4.5 4.5L19 7.5';
const DOT = 'M12 12h.01';

/** One live rule under the password: a dot until it is met, then a tick. Missed rules turn redline after a submit. */
function Rule({ met, missed, children }: { met: boolean; missed: boolean; children: string }) {
  return (
    <li className={`auth-rules__item${met ? ' is-met' : missed ? ' is-missed' : ''}`}>
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d={met ? TICK : DOT} /></svg>
      {children}
      <span className="sr-only">{met ? ', done' : ', not yet'}</span>
    </li>
  );
}

const expiryDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
};

/** /accept-invite/:token, outside the shell. The person sets a password and is signed in. */
export function AcceptInviteScreen({ onAccepted = () => window.location.assign(HOME) }: { onAccepted?: () => void }) {
  const { token = '' } = useParams();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [shown, setShown] = useState(false);
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

  const longEnough = password.length >= MIN_PASSWORD;
  const matches = password.length > 0 && password === confirm;
  const errors = {
    password: !longEnough ? `Use at least ${MIN_PASSWORD} characters` : undefined,
    confirm: !confirm ? 'Enter the password again' : confirm !== password ? 'The passwords do not match' : undefined,
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    setFailure(null);
    if (errors.password || errors.confirm) {
      document.getElementById(errors.password ? 'new-password' : 'confirm-password')?.focus();
      return;
    }
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
    return <Frame><AuthHeading title="Accept invite" /><p className="auth-note" role="status">Invitations work only when the app is connected to the database.</p></Frame>;
  }
  if (load.state === 'loading') return <Frame><Skeleton kind="card" /></Frame>;
  if (load.state === 'expired' || load.state === 'invalid') {
    return (
      <Frame>
        <AuthHeading
          title={load.state === 'expired' ? 'This invite link has expired' : 'This invite link is not valid'}
          lead="Invite links work once and last 72 hours. Ask your firm admin to send you a new one."
        />
        <Link className="auth-button" to={LOGIN_PATHS.chooser}>Go to sign in</Link>
      </Frame>
    );
  }
  if (load.state === 'error') return <Frame><AuthHeading title="Accept invite" /><AuthAlert>{load.message}</AuthAlert></Frame>;

  const { invite } = load;
  const expires = expiryDate(invite.expires_at);
  const passwordError = tried ? errors.password : undefined;
  const confirmError = tried ? errors.confirm : undefined;
  return (
    <Frame>
      <AuthHeading title={`Join ${invite.firm_name}`} lead="Set a password to finish setting up your account." />
      <dl className="auth-facts">
        <dt>Name</dt><dd>{invite.name}</dd>
        <dt>Work email</dt><dd>{invite.work_email}</dd>
        <dt>Company</dt><dd>{invite.firm_name}</dd>
      </dl>
      {failure && <AuthAlert>{failure}</AuthAlert>}
      <form className="auth-form" onSubmit={submit} aria-label="Set your password" noValidate>
        <input type="email" name="username" autoComplete="username" value={invite.work_email} readOnly hidden />
        <div className="auth-field">
          <label className="auth-label" htmlFor="new-password">New password</label>
          <SecretInput
            shown={shown}
            onToggle={() => setShown((s) => !s)}
            inputProps={{
              id: 'new-password',
              name: 'new-password',
              autoComplete: 'new-password',
              autoFocus: true,
              value: password,
              'aria-invalid': passwordError ? true : undefined,
              'aria-describedby': passwordError ? 'pw-rules new-password-error' : 'pw-rules',
              onChange: (e) => setPassword(e.target.value),
            }}
          />
          <ul id="pw-rules" className="auth-rules">
            <Rule met={longEnough} missed={tried}>{`At least ${MIN_PASSWORD} characters`}</Rule>
            <Rule met={matches} missed={tried}>Both passwords match</Rule>
          </ul>
          {passwordError && <p id="new-password-error" className="auth-field-error">{passwordError}</p>}
        </div>
        <div className="auth-field">
          <label className="auth-label" htmlFor="confirm-password">Confirm password</label>
          <input
            id="confirm-password"
            className="auth-input"
            type={shown ? 'text' : 'password'}
            name="confirm-password"
            autoComplete="new-password"
            value={confirm}
            aria-invalid={confirmError ? true : undefined}
            aria-describedby={confirmError ? 'confirm-password-error' : undefined}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {confirmError && <p id="confirm-password-error" className="auth-field-error">{confirmError}</p>}
        </div>
        <button type="submit" className="auth-submit" disabled={busy} aria-busy={busy || undefined}>
          {busy && <Loader2 size={18} strokeWidth={1.5} className="auth-submit__spin" aria-hidden />}
          Set password and sign in
        </button>
        <p className="auth-fineprint">
          {expires ? `This link works once and expires on ${expires}. ` : 'This link works once. '}
          Already set a password? <Link to={LOGIN_PATHS.team}>Sign in</Link>.
        </p>
      </form>
    </Frame>
  );
}
