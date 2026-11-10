import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { ApiFailure, failureMessage } from '../../api/live';
import type { StudioClockProps } from '../../ui/StudioClock';
import { AuthAlert, AuthHeading, AuthPage, AuthSplit, BackToOptions, DoorLinks, FORGOT_PASSWORD_HELP, FORGOT_PASSWORD_HREF, SecretInput, type DoorLink } from './frame';

export const BAD_CREDENTIALS = "That email and password don't match. Check both and try again.";

export type SignInFormProps = {
  /** Prefix for element ids, so two forms never share one. */
  id: string;
  title: string;
  lead: string;
  /** The form's accessible name. */
  formLabel: string;
  emailPlaceholder: string;
  /** Says what to type when the email is left empty. */
  emptyEmail?: string;
  /** "keep" shows the Keep me signed in box; anything else is shown in its place. */
  extra: 'keep' | ReactNode;
  doors: DoorLink[];
  clock?: StudioClockProps;
  /** Signs in and moves on. Throws ApiFailure to show the error. */
  signIn: (email: string, password: string, keepSignedIn: boolean) => Promise<void>;
  /** Small print under the other doors, such as the development demo accounts. */
  note?: ReactNode;
};

/** One sign-in page: heading, error, email, password with Show/Hide, the extras row, Sign in, the other doors and the clock. */
export function SignInForm({ id, title, lead, formLabel, emailPlaceholder, emptyEmail = 'Enter your work email.', extra, doors, clock, signIn, note }: SignInFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [keep, setKeep] = useState(true);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const forgotId = useId();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!email.trim()) next.email = emptyEmail;
    else if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = 'Enter a valid email address.';
    if (!password) next.password = 'Enter your password.';
    setErrors(next);
    setFailure(null);
    if (next.email || next.password) {
      document.getElementById(next.email ? `${id}-email` : `${id}-password`)?.focus();
      return;
    }
    setBusy(true);
    try {
      await signIn(email.trim(), password, keep);
    } catch (err) {
      setFailure(err instanceof ApiFailure && err.status === 401 ? BAD_CREDENTIALS : failureMessage(err));
      setBusy(false);
    }
  };

  const emailErr = `${id}-email-error`;
  const passwordErr = `${id}-password-error`;
  return (
    <AuthPage headerEnd={<BackToOptions />}>
      <AuthSplit clock={clock}>
        <AuthHeading title={title} lead={lead} />
        {failure && <AuthAlert>{failure}</AuthAlert>}
        <form className="auth-form" onSubmit={submit} aria-label={formLabel} noValidate>
          <div className="auth-field">
            <label className="auth-label" htmlFor={`${id}-email`}>Work email</label>
            <input
              id={`${id}-email`}
              className="auth-input"
              type="email"
              name="email"
              autoComplete="username"
              placeholder={emailPlaceholder}
              autoFocus
              value={email}
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? emailErr : undefined}
              onChange={(e) => { setEmail(e.target.value); setErrors((x) => ({ ...x, email: undefined })); }}
            />
            {errors.email && <p id={emailErr} className="auth-field-error">{errors.email}</p>}
          </div>
          <div className="auth-field">
            <label className="auth-label" htmlFor={`${id}-password`}>Password</label>
            <SecretInput
              shown={shown}
              onToggle={() => setShown((s) => !s)}
              inputProps={{
                id: `${id}-password`,
                name: 'password',
                autoComplete: 'current-password',
                value: password,
                'aria-invalid': errors.password ? true : undefined,
                'aria-describedby': errors.password ? passwordErr : undefined,
                onChange: (e) => { setPassword(e.target.value); setErrors((x) => ({ ...x, password: undefined })); },
              }}
            />
            {errors.password && <p id={passwordErr} className="auth-field-error">{errors.password}</p>}
          </div>
          <div className="auth-row">
            {extra === 'keep' ? (
              <label className="auth-check">
                <input type="checkbox" name="keep-signed-in" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
                Keep me signed in
              </label>
            ) : <span className="auth-note">{extra}</span>}
            <button
              type="button"
              className="auth-link"
              style={{ background: 'none', border: 0, padding: 0, fontFamily: 'inherit', color: 'inherit', cursor: 'pointer' }}
              aria-expanded={forgotOpen}
              aria-controls={forgotId}
              onClick={() => setForgotOpen((o) => !o)}
            >
              Forgot password?
            </button>
          </div>
          <p id={forgotId} className="auth-fineprint" hidden={!forgotOpen}>
            {FORGOT_PASSWORD_HELP} If you are the only admin, write to <a href={FORGOT_PASSWORD_HREF}>support</a>.
          </p>
          <button type="submit" className="auth-submit" disabled={busy} aria-busy={busy || undefined}>
            {busy && <Loader2 size={18} strokeWidth={1.5} className="auth-submit__spin" aria-hidden />}
            Sign in
          </button>
        </form>
        <DoorLinks links={doors} />
        {note && <p className="auth-fineprint">{note}</p>}
      </AuthSplit>
    </AuthPage>
  );
}
