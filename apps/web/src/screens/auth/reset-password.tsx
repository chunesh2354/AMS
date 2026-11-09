import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { ApiFailure, failureMessage, isLive } from '../../api/live';
import { getResetLink, resetPassword, type ResetDetails } from '../../api/live/password';
import { Skeleton } from '../../ui/Skeleton';
import { Frame, MIN_PASSWORD, Rule, expiryDate } from './accept-invite';
import { AuthAlert, AuthHeading, LOGIN_PATHS, SecretInput } from './frame';

type Load =
  | { state: 'loading' } | { state: 'ready'; reset: ResetDetails } | { state: 'done'; reset: ResetDetails }
  | { state: 'expired' } | { state: 'invalid' } | { state: 'error'; message: string };

/** /reset-password/:token, outside the shell. The person sets a new password, then signs in with it. */
export function ResetPasswordScreen() {
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
    getResetLink(token)
      .then((reset) => alive && setLoad({ state: 'ready', reset }))
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
    if (load.state !== 'ready') return;
    setTried(true);
    setFailure(null);
    if (errors.password || errors.confirm) {
      document.getElementById(errors.password ? 'new-password' : 'confirm-password')?.focus();
      return;
    }
    setBusy(true);
    try {
      await resetPassword(token, password);
      setLoad({ state: 'done', reset: load.reset });
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 410) setLoad({ state: 'expired' });
      else if (err instanceof ApiFailure && err.status === 404) setLoad({ state: 'invalid' });
      else setFailure(failureMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!isLive) {
    return <Frame><AuthHeading title="Reset password" /><p className="auth-note" role="status">Password reset works only when the app is connected to the database.</p></Frame>;
  }
  if (load.state === 'loading') return <Frame><Skeleton kind="card" /></Frame>;
  if (load.state === 'expired' || load.state === 'invalid') {
    return (
      <Frame>
        <AuthHeading
          title={load.state === 'expired' ? 'This reset link has expired' : 'This reset link is not valid'}
          lead="Reset links work once and last 24 hours. Ask your studio admin for a new one."
        />
        <Link className="auth-button" to={LOGIN_PATHS.chooser}>Go to sign in</Link>
      </Frame>
    );
  }
  if (load.state === 'error') return <Frame><AuthHeading title="Reset password" /><AuthAlert>{load.message}</AuthAlert></Frame>;
  if (load.state === 'done') {
    return (
      <Frame>
        <AuthHeading title="Password changed" lead={`You are signed out everywhere. Sign in to ${load.reset.firm_name} with your new password.`} />
        <p className="auth-note" role="status">Your new password is saved.</p>
        <Link className="auth-button" to={LOGIN_PATHS.chooser}>Go to sign in</Link>
      </Frame>
    );
  }

  const { reset } = load;
  const expires = expiryDate(reset.expires_at);
  const passwordError = tried ? errors.password : undefined;
  const confirmError = tried ? errors.confirm : undefined;
  return (
    <Frame>
      <AuthHeading title="Choose a new password" lead="Set a new password for your account. You will be signed out everywhere." />
      <dl className="auth-facts">
        <dt>Name</dt><dd>{reset.name}</dd>
        <dt>Company</dt><dd>{reset.firm_name}</dd>
      </dl>
      {failure && <AuthAlert>{failure}</AuthAlert>}
      <form className="auth-form" onSubmit={submit} aria-label="Choose a new password" noValidate>
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
          Set new password
        </button>
        <p className="auth-fineprint">
          {expires ? `This link works once and expires on ${expires}. ` : 'This link works once. '}
          Remembered it? <Link to={LOGIN_PATHS.chooser}>Sign in</Link>.
        </p>
      </form>
    </Frame>
  );
}
