import { useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { apiFetch, failureMessage, isLive } from '../../api/live';
import { Button } from '../../ui/Button';
import { Form } from '../../ui/Form';
import { InlineAlert } from '../../ui/InlineAlert';
import { TextField } from '../../ui/TextField';

/** Vite removes this from production builds. The demo accounts exist only in the dev seed. */
const DEMO_SIGN_INS = import.meta.env.DEV
  ? 'p01@meridian.demo principal. p02@meridian.demo project manager. p04@meridian.demo staff. p10@meridian.demo operations and finance. Password for all: meridian-demo-2026.'
  : null;

type MeSets = { permission_sets: string[] };
const homeFor = (me: MeSets) => (me.permission_sets.some((s) => s !== 'staff') ? '/firm/overview' : '/me/home');

/** Mock mode has no sign-in, so /login goes straight to the app. */
export function LoginScreen() {
  return isLive ? <LiveLogin /> : <Navigate to="/" replace />;
}

function LiveLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Someone already signed in has no reason to stay here. A 401 just means showing the form.
  useEffect(() => {
    apiFetch<MeSets>('/me').then((me) => window.location.replace(homeFor(me))).catch(() => {});
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!email.trim()) next.email = 'Enter your work email.';
    else if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = 'Enter a valid email address.';
    if (!password) next.password = 'Enter your password.';
    setErrors(next);
    setFailure(null);
    if (next.email || next.password) return;
    setBusy(true);
    try {
      await apiFetch('/auth/login', { body: { email: email.trim(), password } });
      window.location.assign(homeFor(await apiFetch<MeSets>('/me')));
    } catch (err) {
      setFailure(failureMessage(err));
      setBusy(false);
    }
  };

  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 'var(--s-4)' }}>
      <div className="glass glass--elevated" style={{ width: '100%', maxWidth: 400, padding: 'var(--s-8)', borderRadius: 'var(--radius-xl)', display: 'flex', flexDirection: 'column', gap: 'var(--s-6)' }}>
        <div>
          <h1 className="t-h1">Sign in</h1>
          <p className="t-body-sm">Use your work email and password.</p>
        </div>
        {failure && <InlineAlert variant="danger" title={failure} />}
        <Form onSubmit={submit} aria-label="Sign in">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' }}>
            <TextField
              label="Work email"
              type="email"
              name="email"
              autoComplete="username"
              autoFocus
              value={email}
              error={errors.email}
              onChange={(e) => { setEmail(e.target.value); setErrors((x) => ({ ...x, email: undefined })); }}
            />
            <TextField
              label="Password"
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              error={errors.password}
              onChange={(e) => { setPassword(e.target.value); setErrors((x) => ({ ...x, password: undefined })); }}
            />
            <Button type="submit" variant="primary" size="cta" loading={busy}>Sign in</Button>
          </div>
        </Form>
        {DEMO_SIGN_INS && <InlineAlert variant="info" title="Demo sign-ins (development only)">{DEMO_SIGN_INS}</InlineAlert>}
      </div>
    </main>
  );
}
