import { useEffect } from 'react';
import { isLive } from '../../api/live';
import { PLATFORM_HOME_PATH, platformLogin, platformMe } from '../../api/live/platform';
import { AuthHeading, AuthPage, AuthSplit, BackToOptions, LOGIN_PATHS } from '../auth/frame';
import { SignInForm } from '../auth/sign-in-form';

const CLOCK = { place: 'Platform time, India', label: 'Platform time' };
const TITLE = 'Platform admin';
const LEAD = 'Sign in to add studios, send owner invites and suspend or reactivate accounts.';

/** /platform/login. A separate sign-in from the firm app: platform admins manage companies, never a firm's work. */
export function PlatformLoginScreen() {
  // Already signed in to the platform: go straight to the panel. A 401 just means showing the form.
  useEffect(() => {
    if (!isLive) return;
    platformMe(false).then(() => window.location.replace(PLATFORM_HOME_PATH)).catch(() => {});
  }, []);

  if (!isLive) {
    return (
      <AuthPage headerEnd={<BackToOptions />}>
        <AuthSplit clock={CLOCK}>
          <AuthHeading title={TITLE} lead={LEAD} />
          <p className="auth-note" role="status">Start the API to use the platform panel.</p>
        </AuthSplit>
      </AuthPage>
    );
  }

  return (
    <SignInForm
      id="platform"
      title={TITLE}
      lead={LEAD}
      formLabel="Platform admin sign in"
      emailPlaceholder="you@company.com"
      emptyEmail="Enter your email."
      extra="Sessions end after 12 hours."
      clock={CLOCK}
      doors={[
        { lead: 'Running a studio?', label: 'Studio principal sign-in', to: LOGIN_PATHS.studio },
        { lead: 'On a studio team?', label: 'Team member sign-in', to: LOGIN_PATHS.team },
      ]}
      signIn={async (email, password) => {
        await platformLogin(email, password);
        window.location.assign(PLATFORM_HOME_PATH);
      }}
    />
  );
}
