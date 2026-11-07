import { useEffect, useState, type FormEvent } from 'react';
import { failureMessage, isLive } from '../../api/live';
import { PLATFORM_HOME_PATH, platformLogin, platformMe } from '../../api/live/platform';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { Form } from '../../ui/Form';
import { InlineAlert } from '../../ui/InlineAlert';
import { TextField } from '../../ui/TextField';

/** /platform/login. A separate sign-in from the firm app: platform admins manage companies, never a firm's work. */
export function PlatformLoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in to the platform: go straight to the panel. A 401 just means showing the form.
  useEffect(() => {
    if (!isLive) return;
    platformMe(false).then(() => window.location.replace(PLATFORM_HOME_PATH)).catch(() => {});
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!email.trim()) next.email = 'Enter your email.';
    else if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = 'Enter a valid email address.';
    if (!password) next.password = 'Enter your password.';
    setErrors(next);
    setFailure(null);
    if (next.email || next.password) return;
    setBusy(true);
    try {
      await platformLogin(email.trim(), password);
      window.location.assign(PLATFORM_HOME_PATH);
    } catch (err) {
      setFailure(failureMessage(err));
      setBusy(false);
    }
  };

  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 'var(--s-4)', background: 'var(--bg-plane)' }}>
      <div className="glass glass--elevated" style={{ width: '100%', maxWidth: 400, padding: 'var(--s-8)', borderRadius: 'var(--radius-xl)', display: 'flex', flexDirection: 'column', gap: 'var(--s-6)' }}>
        <div>
          <h1 className="t-h1">Platform admin</h1>
          <p className="t-body-sm">Sign in to manage companies. This is not the firm sign-in.</p>
        </div>
        {!isLive ? (
          <EmptyState message="Start the API to use the platform panel." />
        ) : (
          <>
            {failure && <InlineAlert variant="danger" title={failure} />}
            <Form onSubmit={submit} aria-label="Platform admin sign in" noValidate>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' }}>
                <TextField
                  label="Email"
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
          </>
        )}
      </div>
    </main>
  );
}
