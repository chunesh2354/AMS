import { useEffect } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { apiFetch, isLive } from '../../api/live';
import { AuthPage, LOGIN_PATHS, SUPPORT_EMAIL } from './frame';
import { SignInForm } from './sign-in-form';

/** Vite removes this from production builds. The demo accounts exist only in the dev seed. */
const DEMO_SIGN_INS = import.meta.env.DEV
  ? 'p01@meridian.demo principal. p02@meridian.demo project manager. p04@meridian.demo staff. p10@meridian.demo operations and finance. Password for all: meridian-demo-2026.'
  : null;

type MeSets = { permission_sets: string[] };
/** Where the app sends someone after sign-in, whichever door they used: anyone with more than staff rights to the firm, the rest to their own day. */
export const homeFor = (me: MeSets) => (me.permission_sets.some((s) => s !== 'staff') ? '/firm/overview' : '/me/home');

/** Someone already signed in has no reason to stay on a sign-in page. A 401 just means showing the page. */
function useLeaveIfSignedIn() {
  useEffect(() => {
    apiFetch<MeSets>('/me').then((me) => window.location.replace(homeFor(me))).catch(() => {});
  }, []);
}

const DOORS = [
  { to: LOGIN_PATHS.studio, title: 'Studio principal', text: 'Run the practice: projects, fees, billing and people.' },
  { to: LOGIN_PATHS.team, title: 'Team member', text: 'Log your time, see your tasks, request leave.' },
  { to: LOGIN_PATHS.platform, title: 'Platform admin', text: 'Add and manage the studios on the platform.' },
];

/** /login: choose a door. Mock mode has no sign-in, so it goes straight to the app. */
export function LoginScreen() {
  return isLive ? <Chooser /> : <Navigate to="/" replace />;
}

function Chooser() {
  useLeaveIfSignedIn();
  return (
    <AuthPage
      headerEnd={<nav aria-label="Help" className="auth-header__nav"><a className="auth-header__link" href={`mailto:${SUPPORT_EMAIL}`}>Help</a></nav>}
      footer={(
        <footer className="auth-footer">
          <span>© 2026 Practice</span>
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </footer>
      )}
    >
      <main className="auth-chooser">
        <section className="auth-chooser__intro">
          <h1 className="auth-display">Sign in to{' '}<br />your studio.</h1>
          <p className="auth-chooser__lead">Practice management for architects: projects, time, fees and invoices in one place. Choose how you work with the studio.</p>
        </section>
        <nav aria-label="Sign-in options" className="auth-doors">
          {DOORS.map((d) => (
            <Link key={d.to} to={d.to} className="auth-door">
              <span className="auth-door__body">
                <span className="auth-door__title">{d.title}</span>
                <span className="auth-door__text">{d.text}</span>
              </span>
              <svg className="auth-door__arrow" aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 5l7 7-7 7" /></svg>
            </Link>
          ))}
          <p className="auth-doors__hint">Got an invite? Open your invite link to set a password.</p>
        </nav>
      </main>
    </AuthPage>
  );
}

async function firmSignIn(email: string, password: string) {
  await apiFetch('/auth/login', { body: { email, password } });
  window.location.assign(homeFor(await apiFetch<MeSets>('/me')));
}

/** /login/studio. The same firm sign-in as the team door; the server decides where each person lands. */
export function StudioLoginScreen() {
  return isLive ? <StudioLogin /> : <Navigate to="/" replace />;
}

function StudioLogin() {
  useLeaveIfSignedIn();
  return (
    <SignInForm
      id="studio"
      title="Studio principal"
      lead="Sign in to run your practice: projects, fees, billing and people."
      formLabel="Studio principal sign in"
      emailPlaceholder="name@studio.com"
      extra="keep"
      doors={[
        { lead: 'On the team, not a principal?', label: 'Team member sign-in', to: LOGIN_PATHS.team },
        { lead: 'Managing studios?', label: 'Platform admin sign-in', to: LOGIN_PATHS.platform },
      ]}
      signIn={firmSignIn}
      note={DEMO_SIGN_INS && `Demo sign-ins (development only). ${DEMO_SIGN_INS}`}
    />
  );
}

/** /login/team. */
export function TeamLoginScreen() {
  return isLive ? <TeamLogin /> : <Navigate to="/" replace />;
}

function TeamLogin() {
  useLeaveIfSignedIn();
  return (
    <SignInForm
      id="team"
      title="Team member"
      lead="Sign in to log your time, see this week's tasks and request leave."
      formLabel="Team member sign in"
      emailPlaceholder="name@studio.com"
      extra="keep"
      doors={[
        { lead: 'Running the studio?', label: 'Studio principal sign-in', to: LOGIN_PATHS.studio },
        { lead: 'First time here?', label: 'Use the link in your invite' },
      ]}
      signIn={firmSignIn}
      note={DEMO_SIGN_INS && `Demo sign-ins (development only). ${DEMO_SIGN_INS}`}
    />
  );
}
